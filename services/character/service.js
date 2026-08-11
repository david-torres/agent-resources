const {
  cloneInput,
  normalizeCharacterInput,
  normalizeGearItems,
  normalizeAbilityItems,
  normalizeAbilityPerks,
  parseInteger,
  normalizeStatsPayload
} = require('./input');
const { deriveCharacterTotals } = require('../../util/character-derived');
const { remapPerkAbilityIds, remapPerkAbilityIdsByName } = require('../../util/ability-perks');
const { diffChildRows, resolveCompoundLinks } = require('../../util/reconcile');
const { validateAbilityPerks } = require('../../util/validate');
const { AuthorizationError } = require('../../util/errors');
const { canMutateCharacter } = require('./policy');

const V2_ONLY_FIELDS = ['quirks', 'accessories', 'ability_perks'];

const REQUIRED_ADAPTER_METHODS = [
  'getRulesVersion',
  'resolveClassReference',
  'getCharacter',
  'createCharacterRow',
  'updateCharacterRow',
  'getChildRows',
  'insertChildRows',
  'updateChildRow',
  'deleteChildRows',
  'getClassContentLookupMaps',
  'getRealMissions',
  'listOffscreenMissions',
  // Mutation capabilities (delete/markDeceased/upgradeClass/updateStats/levelUp).
  'fetchCharacterOwnership',
  'deleteCharacter',
  'setDeceased',
  'updateClass',
  'updateOwnedFields',
  'getClassRulesVersion',
  'fetchAllowedAbilityIds',
  'fetchExistingPerks',
  'levelUpAtomic',
  'createBackfillMission',
  'getAvailableHostedMissions',
  'createOffscreenMissionRow',
  'findUpgradeTargets',
  // Offscreen-mission capabilities (create/update/deleteOffscreenMission).
  'getOffscreenMissionRow',
  'getSourceMissionForCredit',
  'getConduitCredits',
  'insertOffscreenMission',
  'updateOffscreenMissionRow',
  'deleteOffscreenMissionRow'
];

// Loads the full character row (admin-privileged; includes traits/gear/
// abilities/ability_perks) and throws unless the actor may mutate it.
// Mirrors services/mission/service.js#requireEditable.
const requireOwnedCharacter = async (adapter, actor, id) => {
  const { data: character, error } = await adapter.getCharacter(id);
  if (error) throw error;
  if (!character) throw new AuthorizationError('Character not found', { reason: 'not_found' });
  if (!canMutateCharacter(actor, character)) {
    throw new AuthorizationError('Not authorized to modify this character', { reason: 'not_owner' });
  }
  return character;
};

// Leaner ownership probe (id/creator_id/class_id only) — used by upgradeClass,
// matching the pre-refactor inline admin select.
const requireOwnedCharacterLean = async (adapter, actor, id) => {
  const { data: character, error } = await adapter.fetchCharacterOwnership(id);
  if (error) throw error;
  if (!character) throw new AuthorizationError('Character not found', { reason: 'not_found' });
  if (!canMutateCharacter(actor, character)) {
    throw new AuthorizationError('Not authorized to modify this character', { reason: 'not_owner' });
  }
  return character;
};

const resolveSubmittedGear = (gear, gearNameToClassId) => {
  const submitted = Array.isArray(gear) ? gear : (gear ? [gear] : []);
  return submitted.map(item => {
    if (!item) return null;
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (!trimmed) return null;
      const name = trimmed.includes('::') ? trimmed.split('::')[1].trim() : trimmed;
      return name ? { name, class_id: gearNameToClassId.get(name) || null } : null;
    }
    if (typeof item === 'object' && item.name) {
      return { name: item.name, class_id: item.class_id || gearNameToClassId.get(item.name) || null };
    }
    return null;
  }).filter(Boolean);
};

/**
 * Application boundary for character writes. The adapter owns storage and
 * catalog queries; this service owns validation, authorization, sequencing,
 * and reconciliation decisions.
 */
class CharacterService {
  constructor(adapter) {
    const missing = REQUIRED_ADAPTER_METHODS.filter(method => typeof adapter?.[method] !== 'function');
    if (missing.length > 0) {
      throw new TypeError(`CharacterService requires adapter methods: ${missing.join(', ')}`);
    }
    this.adapter = adapter;
  }

  async createCharacter(input, actor) {
    // Preserve historical ordering: creation chooses the version before a
    // class-name lookup may populate class_id.
    const rulesVersion = await this.adapter.getRulesVersion(input.class_id);
    const prepared = await this.adapter.resolveClassReference(input);
    const normalized = normalizeCharacterInput(prepared, { rulesVersion, creatorId: actor.id });
    if (normalized.error) return { data: null, error: normalized.error };

    const { data: characterInput, childData } = normalized;
    if (typeof this.adapter.saveCharacterAtomic === 'function') {
      return this.saveCharacterAtomic({
        id: null, actor, characterInput, childData, rulesVersion, previousAbilities: []
      });
    }
    const created = await this.adapter.createCharacterRow(characterInput);
    if (created.error || !created.data || created.data.length === 0) {
      return created.error ? created : { data: null, error: 'Character creation returned no rows' };
    }
    const character = created.data[0];

    const traitsResult = await this.reconcileTraits(character.id, childData.traits);
    if (traitsResult.error) return { data: null, error: traitsResult.error };

    if (childData.classGear) {
      const gearResult = await this.reconcileGear(character.id, childData.classGear);
      if (gearResult.error) return { data: null, error: gearResult.error };
    }

    let abilityRows = null;
    if (childData.classAbilities) {
      const abilityResult = await this.reconcileAbilities(character.id, childData.classAbilities);
      if (abilityResult.error) return { data: null, error: abilityResult.error };
      abilityRows = abilityResult.data;
    }

    if (rulesVersion === 'v2') {
      const perks = remapPerkAbilityIdsByName(childData.abilityPerks, abilityRows || []);
      const perksResult = await this.reconcilePerks(character.id, perks);
      if (perksResult.error) return { data: null, error: perksResult.error };
    }
    return { data: character, error: created.error };
  }

  async updateCharacter(id, input, actor) {
    const existing = await this.adapter.getCharacter(id);
    if (existing.error) return { data: null, error: existing.error };
    if (existing.data.creator_id != actor.id) {
      throw new AuthorizationError('Not authorized to modify this character', { reason: 'not_owner' });
    }

    // A character's class is IMMUTABLE on update: the STORED class_id always
    // wins over whatever was submitted.
    //
    // Why: the edit form's Class <select> is built from the *editing user's*
    // currently-unlocked classes (routes/characters.js#filterClassDataForUser),
    // so as soon as a character's class stops being unlocked -- a
    // class_unlocks.expires_at lapsing, or a class's is_public flipping false --
    // the form renders no <option> for it, the browser auto-selects the first
    // enabled one, `required` is satisfied, and an otherwise-untouched save
    // silently reassigns the character to an unrelated class. The user never
    // touches the Class field; every ordinary edit does it, repeatedly.
    //
    // That reassignment is not cosmetic. The save rewrites class_abilities
    // wholesale (saveCharacterAtomic below / the save_character_atomic RPC) and
    // character_perks.class_ability_id is ON DELETE CASCADE, so the character's
    // perks are deleted along with the old ability rows -- and they are not
    // necessarily rebuilt, because the rebuild is gated on `rulesVersion`,
    // which used to be derived from the submitted (wrong) class as well.
    // Characterized by e2e/specs/03b-class-reassignment.spec.js.
    //
    // Deliberate class changes have their own validated capability --
    // upgradeClass() below, behind POST /characters/:id/upgrade -- and never
    // come through here. The mismatch is IGNORED rather than rejected on
    // purpose: a player whose unlock has lapsed must still be able to edit
    // their character normally, not be locked out of every save until someone
    // restores the unlock.
    const storedClassId = existing.data.class_id ?? null;
    let prepared = cloneInput(input);
    const submittedClassId = prepared.class_id ?? null;
    if (submittedClassId !== null && submittedClassId !== storedClassId) {
      // Surfaced so this state is diagnosable rather than invisible: it only
      // happens when the editor's unlocked set no longer covers the class.
      console.warn(
        `[updateCharacter] Ignoring submitted class_id "${submittedClassId}" for character ${id}: ` +
        `class is immutable on update, keeping "${storedClassId}"`
      );
    }
    // Both keys, not just class_id: resolveClassReference re-derives class_id
    // from a submitted class NAME, so pinning the id alone would leave a
    // bypass -- and keeping the submitted name would desync the denormalized
    // `class` column from class_id. Dropping `class` lets resolveClassReference
    // fill it back in from the stored id.
    prepared.class_id = storedClassId;
    delete prepared.class;

    // Resolved from the stored class, never the submitted one: this gates both
    // the v2-only field strip below and the perk rebuild in saveCharacterAtomic.
    const rulesVersion = await this.adapter.getRulesVersion(storedClassId);
    if (rulesVersion !== 'v2') {
      for (const field of V2_ONLY_FIELDS) delete prepared[field];
    }
    prepared = await this.adapter.resolveClassReference(prepared);

    const normalized = normalizeCharacterInput(prepared, {
      rulesVersion,
      normalizeAutoCalculate: true
    });
    if (normalized.error) return { data: null, error: normalized.error };
    const { data: characterInput, childData } = normalized;

    if (characterInput.auto_calculate) {
      const { gearNameToClassId } = await this.adapter.getClassContentLookupMaps();
      const [missions, offscreenMissions] = await Promise.all([
        this.adapter.getRealMissions(id),
        this.adapter.listOffscreenMissions(id)
      ]);
      if (missions.error || offscreenMissions.error) {
        return { data: null, error: missions.error || offscreenMissions.error };
      }
      const derived = deriveCharacterTotals({
        character: {
          class_id: characterInput.class_id,
          gear: resolveSubmittedGear(childData.classGear, gearNameToClassId),
          common_items: characterInput.common_items
        },
        realMissions: missions.data || [],
        offscreenMissions: offscreenMissions.data || [],
        rulesVersion
      });
      characterInput.level = derived.level;
      characterInput.completed_missions = derived.completed_missions;
      characterInput.commissary_reward = derived.commissary_reward;
    }

    const previousAbilities = Array.isArray(existing.data.abilities) ? existing.data.abilities : [];
    if (typeof this.adapter.saveCharacterAtomic === 'function') {
      return this.saveCharacterAtomic({
        id, actor, characterInput, childData, rulesVersion, previousAbilities
      });
    }
    const updated = await this.adapter.updateCharacterRow(id, characterInput, actor);
    if (updated.error || !updated.data || updated.data.length === 0) {
      return updated.error ? updated : { data: null, error: 'Character update returned no rows' };
    }
    const character = updated.data[0];

    const traitsResult = await this.reconcileTraits(character.id, childData.traits);
    if (traitsResult.error) return { data: null, error: traitsResult.error };
    if (childData.classGear) {
      const gearResult = await this.reconcileGear(character.id, childData.classGear);
      if (gearResult.error) return { data: null, error: gearResult.error };
    }

    let abilityRows = null;
    if (childData.classAbilities) {
      const abilityResult = await this.reconcileAbilities(character.id, childData.classAbilities);
      if (abilityResult.error) return { data: null, error: abilityResult.error };
      abilityRows = abilityResult.data;
    }
    if (rulesVersion === 'v2') {
      const perks = abilityRows
        ? remapPerkAbilityIds(childData.abilityPerks, previousAbilities, abilityRows)
        : childData.abilityPerks;
      const perksResult = await this.reconcilePerks(character.id, perks);
      if (perksResult.error) return { data: null, error: perksResult.error };
    }
    return { data: character, error: updated.error };
  }

  async saveCharacterAtomic({ id, actor, characterInput, childData, rulesVersion, previousAbilities }) {
    const traits = (Array.isArray(childData.traits) ? childData.traits : [])
      .filter(name => name != null && name !== '')
      .map(name => ({ name }));
    const maps = await this.adapter.getClassContentLookupMaps();
    const gear = childData.classGear == null ? null : normalizeGearItems(childData.classGear).map(item => ({
      name: item.name,
      class_id: item.class_id ?? maps.gearNameToClassId.get(item.name),
      description: item.description ?? maps.gearNameToDescription.get(item.name) ?? null
    }));
    const abilities = childData.classAbilities == null ? null : normalizeAbilityItems(childData.classAbilities).map(item => ({
      name: item.name,
      class_id: item.class_id ?? maps.abilityNameToClassId.get(item.name),
      description: item.description ?? maps.abilityNameToDescription.get(item.name) ?? null
    }));
    if ((gear || []).some(item => !item.class_id)) {
      const item = gear.find(row => !row.class_id);
      return { data: null, error: `[setCharacterGear] Missing class_id for gear item "${item.name}"` };
    }
    if ((abilities || []).some(item => !item.class_id)) {
      const item = abilities.find(row => !row.class_id);
      return { data: null, error: `[setCharacterAbilities] Missing class_id for ability "${item.name}"` };
    }

    let perks = null;
    if (rulesVersion === 'v2') {
      const byOldId = new Map(previousAbilities.map(ability => [ability.id, ability]));
      const submitted = normalizeAbilityPerks(childData.abilityPerks);
      const names = new Set((abilities || previousAbilities).map(ability => ability.name));
      perks = submitted.map(perk => {
        const ability = byOldId.get(perk.class_ability_id);
        const abilityName = ability?.name || (typeof perk.class_ability_id === 'string' && !perk.class_ability_id.includes('-')
          ? perk.class_ability_id
          : null);
        return abilityName && names.has(abilityName)
          ? { ...perk, class_ability_id: abilities ? null : perk.class_ability_id, ability_name: abilityName }
          : abilities ? null : perk;
      }).filter(Boolean);
    }
    return this.adapter.saveCharacterAtomic({
      characterId: id,
      creatorId: actor.id,
      character: characterInput,
      traits,
      gear,
      abilities,
      perks
    });
  }

  async applyChildDiff(table, characterId, diff) {
    if (diff.toInsert.length > 0) {
      const result = await this.adapter.insertChildRows(table, characterId, diff.toInsert);
      if (result.error) return result;
    }
    for (const { id, ...changes } of diff.toUpdate) {
      const result = await this.adapter.updateChildRow(table, id, changes);
      if (result.error) return result;
    }
    if (diff.toDelete.length > 0) {
      const result = await this.adapter.deleteChildRows(table, characterId, diff.toDelete);
      if (result.error) return result;
    }
    return { data: true, error: null };
  }

  async reconcileTraits(characterId, traits) {
    const existing = await this.adapter.getChildRows('traits', characterId);
    if (existing.error) return existing;
    const desired = (Array.isArray(traits) ? traits : [])
      .filter(name => name != null && name !== '')
      .map(name => ({ name }));
    return this.applyChildDiff('traits', characterId, diffChildRows(existing.data, desired, {
      keyOf: row => row.name,
      rowFields: item => ({ name: item.name })
    }));
  }

  async reconcileGear(characterId, gear) {
    const existing = await this.adapter.getChildRows('class_gear', characterId);
    if (existing.error) return existing;
    const { gearNameToClassId, gearNameToDescription } = await this.adapter.getClassContentLookupMaps();
    const desired = [];
    for (const item of normalizeGearItems(gear)) {
      const classId = item.class_id ?? gearNameToClassId.get(item.name);
      if (!classId) return { data: null, error: `[setCharacterGear] Missing class_id for gear item "${item.name}"` };
      desired.push({ name: item.name, class_id: classId, description: item.description ?? gearNameToDescription.get(item.name) ?? null });
    }
    return this.applyChildDiff('class_gear', characterId, diffChildRows(existing.data, desired, {
      keyOf: row => `${row.class_id}:${row.name}`,
      rowFields: item => ({ name: item.name, class_id: item.class_id, description: item.description })
    }));
  }

  async reconcileAbilities(characterId, abilities) {
    const existing = await this.adapter.getChildRows('class_abilities', characterId);
    if (existing.error) return existing;
    const { abilityNameToClassId, abilityNameToDescription } = await this.adapter.getClassContentLookupMaps();
    const desired = [];
    for (const item of normalizeAbilityItems(abilities)) {
      const classId = item.class_id ?? abilityNameToClassId.get(item.name);
      if (!classId) return { data: null, error: `[setCharacterAbilities] Missing class_id for ability "${item.name}"` };
      desired.push({ name: item.name, class_id: classId, description: item.description ?? abilityNameToDescription.get(item.name) ?? null });
    }
    const applied = await this.applyChildDiff('class_abilities', characterId, diffChildRows(existing.data, desired, {
      keyOf: row => `${row.class_id}:${row.name}`,
      rowFields: item => ({ name: item.name, class_id: item.class_id, description: item.description })
    }));
    return applied.error ? applied : this.adapter.getChildRows('class_abilities', characterId);
  }

  async reconcilePerks(characterId, perks) {
    const existing = await this.adapter.getChildRows('character_perks', characterId);
    if (existing.error) return existing;
    const desired = normalizeAbilityPerks(perks);
    const applied = await this.applyChildDiff('character_perks', characterId, diffChildRows(existing.data, desired, {
      keyOf: row => `${row.class_ability_id}:${row.position}`,
      rowFields: perk => ({ class_ability_id: perk.class_ability_id, text: perk.text, position: perk.position })
    }));
    if (applied.error) return applied;
    const current = await this.adapter.getChildRows('character_perks', characterId);
    if (current.error) return current;
    for (const update of resolveCompoundLinks(desired, current.data)) {
      const result = await this.adapter.updateChildRow('character_perks', update.id, {
        compounds_with: update.compounds_with
      });
      if (result.error) return result;
    }
    return current;
  }

  // --- Policy-gated mutation capabilities (formerly inline route helpers
  // in routes/characters.js). Each loads ownership via the repository,
  // THROWS an AuthorizationError unless canMutateCharacter, then mutates.
  // Everything past the ownership gate keeps returning { data, error }
  // (string or { status, message } shaped) exactly as the routes did, so
  // callers keep using their existing error-rendering (sendError/
  // sendRouteError) for business-rule failures — only the authorization
  // gate itself is new-to-throw.

  async deleteCharacter(actor, id) {
    const character = await requireOwnedCharacter(this.adapter, actor, id);
    return this.adapter.deleteCharacter({ id, creatorId: character.creator_id });
  }

  async markDeceased(actor, id, confirmName) {
    const character = await requireOwnedCharacter(this.adapter, actor, id);
    if (!confirmName || String(confirmName).trim() !== character.name) {
      return {
        data: null,
        error: { status: 400, message: 'Character name does not match. Please type the exact name to confirm.' }
      };
    }
    if (character.is_deceased) return { data: null, error: 'Character is already deceased' };

    const { data, error } = await this.adapter.setDeceased({ id, creatorId: character.creator_id });
    if (error) return { data: null, error };
    if (!data || data.length === 0) return { data: null, error: 'Character update returned no rows' };
    return { data: data[0], error: null };
  }

  async upgradeClass(actor, id, targetClassId, client) {
    const character = await requireOwnedCharacterLean(this.adapter, actor, id);
    if (!targetClassId) return { data: null, error: 'Missing target class id' };

    const candidates = await this.adapter.findUpgradeTargets(character.class_id, client);
    const target = (candidates || []).find(c => c.id === targetClassId);
    if (!target) return { data: null, error: 'Target class is not a valid upgrade for this character' };

    const { data, error } = await this.adapter.updateClass({
      id, creatorId: character.creator_id, classId: target.id, className: target.name
    });
    if (error) return { data: null, error };
    if (!data || data.length === 0) return { data: null, error: 'Character upgrade returned no rows' };
    return { data: data[0], error: null };
  }

  async updateStats(actor, id, rawFields) {
    const character = await requireOwnedCharacter(this.adapter, actor, id);
    const stats = normalizeStatsPayload(rawFields || {});
    const { data, error } = await this.adapter.updateOwnedFields({
      id, creatorId: character.creator_id, fields: stats
    });
    if (error) return { data: null, error };
    if (!data) return { data: null, error: { status: 404, message: 'Character update returned no rows' } };
    return {
      data: {
        id: data.id,
        name: data.name || character.name,
        stats: Object.fromEntries(Object.keys(stats).map(stat => [stat, data[stat] ?? stats[stat]]))
      },
      error: null
    };
  }

  async levelUp(actor, id, body = {}) {
    const character = await requireOwnedCharacter(this.adapter, actor, id);

    const currentLevel = Math.max(1, parseInteger(character.level, 1));
    const requestedLevel = Math.max(currentLevel + 1, Math.min(20, parseInteger(body.level, currentLevel + 1)));
    const currentCompleted = Math.max(0, parseInteger(character.completed_missions, 0));
    const requestedCompleted = Math.max(currentCompleted, parseInteger(body.completed_missions, currentCompleted));
    const missionNames = Array.isArray(body.mission_names)
      ? body.mission_names.map(v => String(v || '').trim()).filter(Boolean)
      : [];
    const useConduitCredit = body.use_conduit_credit === true || body.use_conduit_credit === 'true' || body.use_conduit_credit === 'on';
    const creditCount = useConduitCredit ? Math.max(0, requestedCompleted - currentCompleted - missionNames.length) : 0;

    if (!useConduitCredit && requestedCompleted > currentCompleted + missionNames.length) {
      return {
        data: null,
        error: { status: 400, message: 'Provide mission names for each missing mission, or spend Conduit Credits.' }
      };
    }

    let creditSources = [];
    if (creditCount > 0) {
      const { data: availableHostedMissions, error: availableError } = await this.adapter.getAvailableHostedMissions(actor.profileId);
      if (availableError) return { data: null, error: availableError };
      creditSources = (availableHostedMissions || []).slice(0, creditCount);
      if (creditSources.length < creditCount) {
        return { data: null, error: { status: 400, message: 'Not enough Conduit Credits available.' } };
      }
    }

    for (const name of missionNames) {
      const { error } = await this.adapter.createBackfillMission({ characterId: id, name, profileId: actor.profileId });
      if (error) return { data: null, error };
    }

    for (let i = 0; i < creditSources.length; i++) {
      const src = creditSources[i];
      const sourceDate = typeof src.date === 'string'
        ? src.date.slice(0, 10)
        : new Date(src.date).toISOString().slice(0, 10);
      const { error } = await this.adapter.createOffscreenMissionRow({
        characterId: id,
        profileId: actor.profileId,
        payload: {
          name: `Conduit Credit: Level ${requestedLevel}`,
          summary: 'Spent through the level-up modal.',
          merx_gained: 0,
          source_mission_id: src.id,
          source_mission_name: src.name || `Hosted mission ${i + 1}`,
          source_mission_date: sourceDate
        }
      });
      if (error) return { data: null, error };
    }

    // Re-derive level / completed_missions / commissary_reward from the rows
    // we just created (real success missions and offscreen credits) so the
    // stored counters match what every derive-path computes — see
    // deriveCharacterTotals. Writing raw requested values here would leave
    // commissary_reward stale (each backfilled success mission is worth
    // MERX_PER_MISSION_SUCCESS that never landed in the column).
    const [missionsRes, offscreenRes] = await Promise.all([
      this.adapter.getRealMissions(id),
      this.adapter.listOffscreenMissions(id)
    ]);
    if (missionsRes.error || offscreenRes.error) {
      return { data: null, error: missionsRes.error || offscreenRes.error };
    }

    const rulesVersionResult = character.class_id
      ? await this.adapter.getClassRulesVersion(character.class_id)
      : { data: 'v1' };
    const rulesVersion = rulesVersionResult.data || 'v1';

    const derived = deriveCharacterTotals({
      character,
      realMissions: missionsRes.data || [],
      offscreenMissions: offscreenRes.data || [],
      rulesVersion
    });

    const stats = normalizeStatsPayload(body.stats || body);
    const fields = {
      ...stats,
      level: derived.level,
      completed_missions: derived.completed_missions,
      commissary_reward: derived.commissary_reward
    };
    const { data: perkRows, error: perkBuildError } = await this.buildPerkRows(id, Array.isArray(body.ability_perks) ? body.ability_perks : []);
    if (perkBuildError) return { data: null, error: perkBuildError };

    const { data, error } = await this.adapter.levelUpAtomic({
      characterId: id,
      creatorId: character.creator_id,
      fields,
      perks: perkRows
    });
    if (error) return { data: null, error };
    if (!data) return { data: null, error: { status: 404, message: 'Character update returned no rows' } };

    return {
      data: {
        id: data.id,
        name: data.name || character.name,
        level: data.level,
        completed_missions: data.completed_missions,
        commissary_reward: data.commissary_reward
      },
      error: null
    };
  }

  // Builds the ordered perk-row payload for a level-up (level-up modal),
  // WITHOUT writing — the terminal insert + link-resolution happens atomically
  // inside level_up_character_atomic (see repository.js#levelUpAtomic). Keeps
  // the original allowed-ability filter, per-ability position offsets, and
  // validation from the former perk-append path, but encodes each `compounds_with`
  // link the way the RPC's resolver expects: `position-<n>` for a target in
  // this same batch on the SAME ability, an existing-perk UUID (same ability)
  // to keep, or null. Returns { data: rows, error } where each row is
  // { class_ability_id, text, position, compounds_with }.
  async buildPerkRows(characterId, submittedPerks) {
    if (!Array.isArray(submittedPerks) || submittedPerks.length === 0) {
      return { data: [], error: null };
    }

    const { data: abilities, error: abilityError } = await this.adapter.fetchAllowedAbilityIds(characterId);
    if (abilityError) return { data: null, error: abilityError };
    const allowedAbilityIds = new Set((abilities || []).map(a => a.id));

    const { data: existing, error: existingError } = await this.adapter.fetchExistingPerks(characterId);
    if (existingError) return { data: null, error: existingError };

    const existingCounts = new Map();
    // id -> ability, so a new perk may only compound with an existing perk on
    // the SAME ability (mirrors resolveCompoundLinks in the full edit-form path).
    const abilityByExistingPerkId = new Map();
    const existingForValidation = (existing || []).map(p => {
      const pos = parseInteger(p.position, 0);
      existingCounts.set(p.class_ability_id, Math.max(existingCounts.get(p.class_ability_id) ?? -1, pos));
      abilityByExistingPerkId.set(p.id, p.class_ability_id);
      return { class_ability_id: p.class_ability_id, text: p.text, position: pos };
    });

    // Build the perk rows. `meta` runs parallel to `rows`, carrying each new
    // perk's client `ref` and its requested compound link so we can translate
    // links to the RPC's encoding once every batch position is assigned.
    const rows = [];
    const meta = [];
    for (const p of submittedPerks) {
      if (!p || typeof p !== 'object') continue;
      const classAbilityId = p.class_ability_id;
      const text = typeof p.text === 'string' ? p.text.trim() : '';
      if (!classAbilityId || !allowedAbilityIds.has(classAbilityId) || !text) continue;
      const nextPosition = (existingCounts.get(classAbilityId) ?? -1) + 1;
      existingCounts.set(classAbilityId, nextPosition);
      rows.push({
        class_ability_id: classAbilityId,
        text,
        position: nextPosition,
        compounds_with: null
      });
      meta.push({
        ref: typeof p.ref === 'string' ? p.ref : null,
        compoundsWith: p.compounds_with == null ? null : String(p.compounds_with)
      });
    }

    if (rows.length === 0) return { data: [], error: null };

    const validation = validateAbilityPerks(existingForValidation.concat(rows));
    if (!validation.ok) {
      return { data: null, error: { status: 400, message: validation.errors.join(' ') } };
    }

    // ref -> { position, class_ability_id } for perks in this batch, so a
    // `new:<ref>` link resolves to the target's assigned position.
    const rowByRef = new Map();
    for (let i = 0; i < rows.length; i++) {
      if (!meta[i].ref) continue;
      rowByRef.set(meta[i].ref, { position: rows[i].position, class_ability_id: rows[i].class_ability_id });
    }

    // Translate each new perk's compound link into the RPC's encoding: a
    // `new:<ref>` link → `position-<n>` of the target row (only when the target
    // is in this batch on the SAME ability); an existing-perk UUID on the same
    // ability → keep the UUID; anything else → null.
    for (let i = 0; i < rows.length; i++) {
      const link = meta[i].compoundsWith;
      if (!link) continue;

      if (link.startsWith('new:')) {
        const target = rowByRef.get(link.slice('new:'.length));
        if (target && target.class_ability_id === rows[i].class_ability_id && target.position !== rows[i].position) {
          rows[i].compounds_with = `position-${target.position}`;
        }
      } else if (abilityByExistingPerkId.get(link) === rows[i].class_ability_id) {
        rows[i].compounds_with = link;
      }
    }

    return { data: rows, error: null };
  }

  // --- Offscreen-mission capabilities ----------------------------------
  // Resolves the credit source for a create/update payload: either an
  // existing hosted mission (validated as actor-hosted) or a freeform
  // name/date pair. Pure over adapter reads; returns { error } on failure.
  async resolveOffscreenSource(actor, body) {
    if (body.source_mission_id && body.source_mission_id !== '__other__') {
      const { data: srcMission, error } = await this.adapter.getSourceMissionForCredit(body.source_mission_id);
      if (error || !srcMission) return { error: 'Source mission not found.' };
      if (srcMission.host_id !== actor.profileId) {
        return { error: 'Only the host of a mission can use it as a credit source.' };
      }
      return {
        source_mission_id: srcMission.id,
        source_mission_name: srcMission.name,
        source_mission_date: typeof srcMission.date === 'string'
          ? srcMission.date.slice(0, 10)
          : new Date(srcMission.date).toISOString().slice(0, 10)
      };
    }
    const name = (body.source_mission_name_other || '').trim();
    const date = (body.source_mission_date_other || '').trim();
    if (!name || !date) return { error: 'Source mission name and date are required.' };
    return { source_mission_id: null, source_mission_name: name, source_mission_date: date };
  }

  async createOffscreenMission(actor, characterId, body) {
    await requireOwnedCharacter(this.adapter, actor, characterId);

    const src = await this.resolveOffscreenSource(actor, body);
    if (src.error) return { data: null, error: { status: 400, message: src.error } };

    if (!body.name || !body.summary) {
      return { data: null, error: { status: 400, message: 'Name and summary are required.' } };
    }

    if (src.source_mission_id) {
      const { data: credits } = await this.adapter.getConduitCredits(actor.profileId);
      if (!credits || credits.balance <= 0) {
        return { data: null, error: { status: 400, message: 'No Conduit Credits available.' } };
      }
    }

    const { error } = await this.adapter.insertOffscreenMission({
      characterId,
      profileId: actor.profileId,
      payload: {
        name: body.name,
        summary: body.summary,
        merx_gained: body.merx_gained,
        source_mission_id: src.source_mission_id,
        source_mission_name: src.source_mission_name,
        source_mission_date: src.source_mission_date
      }
    });
    if (error) {
      if (error.code === '23505' || error.message === 'duplicate_source_mission') {
        return { data: null, error: { status: 400, message: 'That mission has already funded a credit.' } };
      }
      return { data: null, error };
    }
    return { data: { characterId }, error: null };
  }

  async updateOffscreenMission(actor, characterId, omId, body) {
    await requireOwnedCharacter(this.adapter, actor, characterId);

    const { data: existing, error: omError } = await this.adapter.getOffscreenMissionRow(omId);
    if (omError) return { data: null, error: omError };
    if (!existing || existing.character_id !== characterId) {
      return { data: null, error: { status: 404, message: 'Not found' } };
    }
    if (!body.name || !body.summary) {
      return { data: null, error: { status: 400, message: 'Name and summary are required.' } };
    }
    const src = await this.resolveOffscreenSource(actor, body);
    if (src.error) return { data: null, error: { status: 400, message: src.error } };

    const { error } = await this.adapter.updateOffscreenMissionRow({
      id: omId,
      payload: {
        name: body.name,
        summary: body.summary,
        merx_gained: body.merx_gained,
        source_mission_id: src.source_mission_id,
        source_mission_name: src.source_mission_name,
        source_mission_date: src.source_mission_date
      }
    });
    if (error) {
      if (error.code === '23505' || error.message === 'duplicate_source_mission') {
        return { data: null, error: { status: 400, message: 'That mission has already funded a credit.' } };
      }
      return { data: null, error };
    }
    return { data: { characterId }, error: null };
  }

  async deleteOffscreenMission(actor, characterId, omId) {
    await requireOwnedCharacter(this.adapter, actor, characterId);

    const { data: existing, error: omError } = await this.adapter.getOffscreenMissionRow(omId);
    if (omError) return { data: null, error: omError };
    if (!existing || existing.character_id !== characterId) {
      return { data: null, error: { status: 404, message: 'Not found' } };
    }
    const { error } = await this.adapter.deleteOffscreenMissionRow(omId);
    if (error) return { data: null, error };
    return { data: { characterId }, error: null };
  }
}

module.exports = { CharacterService, resolveSubmittedGear };
