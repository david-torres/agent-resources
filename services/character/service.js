const {
  cloneInput,
  normalizeCharacterInput,
  normalizeGearItems,
  normalizeAbilityItems,
  normalizeAbilityPerks,
  parseInteger,
  normalizeStatsPayload
} = require('./input');
const { deriveCharacterTotals, deriveBuildBreaches } = require('../../util/character-derived');
const { economyFor, withPreservedEquipment } = require('../../util/merx-economy');
const { capBreaches, capBreachMessage, LEVEL_CEILING } = require('../../util/stat-caps');
const { worsenedBreaches } = require('../../util/perk-economy');
const { remapPerkAbilityIds, remapPerkAbilityIdsByName } = require('../../util/ability-perks');
const { diffChildRows, resolveCompoundLinks } = require('../../util/reconcile');
const { computeVersionFamily } = require('../../util/class-family');
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
  'getClassFamilyRows',
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

// Resolves the economy for a mutation path that only has the stored
// character in hand, not a fresh class-catalogue fetch. economyFor
// (util/merx-economy.js) only ever reads creator_mode to special-case
// 'aspiring' -- every other split is decided by the class's content_format,
// NOT by creator_mode, so creator_mode is not a safe field to short-circuit
// on. Nothing server-side requires creator_mode and the class's
// content_format to agree (routes/characters.js:189: creator_mode does not
// filter the class pool a character can hold), so a creator_mode of null or
// 'advent' paired with an aspirant-format class is a real, if latent,
// possibility -- 0 of 327 live characters hold one today, but a Cap that can
// be routed around by that mismatch is not trustworthy.
//
// So the only shortcuts that skip the query are the ones that genuinely
// don't need content_format: 'aspiring' (class-less, economyFor decides it
// before ever consulting content_format) and a character with no class_id
// at all (nothing to look up). Everything else reads content_format and
// passes both to economyFor, exactly as levelUp already does unconditionally.
const resolveMutationEconomy = async (adapter, character) => {
  if (character.creator_mode === 'aspiring' || !character.class_id) {
    return economyFor({ creatorMode: character.creator_mode });
  }
  const { contentFormat } = await adapter.getClassRulesVersion(character.class_id);
  return economyFor({ contentFormat, creatorMode: character.creator_mode });
};

// Judges a mutation-path Stat write against the per-stat Cap only -- never
// the creation allotment or the +++ ceiling, both creation-only rules that
// updateStats and levelUp sit on the wrong side of: updateStats edits an
// existing character, and levelUp legitimately RAISES the allotment, so
// enforcing the old one against it would refuse the very pluses a level-up
// grants. capBreaches (util/stat-caps.js) needs only Traits and stored Cap
// purchases, both already on the character object requireOwnedCharacter
// returns -- no catalogue fetch. Returns the { status, message } shape
// routes/characters.js's sendRouteError already renders for this file's
// other business-rule errors (see markDeceased and levelUp's mission-name/
// credit checks below), not normalizeCharacterInput's bare-string
// convention -- callers here return `{ data, error }`, never throw, since
// PATCH /:id/stats and POST /:id/level-up wrap only the ownership gate in a
// throw and render everything else through that shape.
const statCapError = (character, stats) => {
  const breaches = capBreaches({ stats, traits: character.traits, capPurchases: character.stat_cap_purchases });
  if (breaches.length === 0) return null;
  return {
    status: 400,
    message: breaches.map(capBreachMessage).join(' ')
  };
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

// A submit that says nothing about type must not retag anything: the edit form
// sends abilities as bare "Class::Ability" strings, so an absent tag means
// "keep whatever is stored", not "core". Callers resolve the null themselves --
// from the existing row, or from the 'core' default for a brand-new one.
const submittedAbilityType = (value) => (value === 'advanced' || value === 'core' ? value : null);

// An object item keeps every field it submitted (spread first, name/class_id
// pinned after) -- not just name/class_id -- so a resolved item still carries
// its enchantment/mods. Both deriveCharacterTotals (equipmentSpend) and
// validateEconomyLimits (signatureSlotsUsed) price an Enchantment as part of
// this same item, and dropping it here would silently zero that cost for any
// caller that resolves gear through this function.
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
      return { ...item, name: item.name, class_id: item.class_id || gearNameToClassId.get(item.name) || null };
    }
    return null;
  }).filter(Boolean);
};

// Maps every id in `classId`'s own version family onto `classId`, which is
// what tagAbilities (util/character-derived.js) consults to decide whether an
// ability is cross-class. util/class-family.js#computeVersionFamily is the
// single definition of "version family" -- see its own comment on why a query
// that drops a column must not be reimplemented here. An ability row carried
// over from an earlier version of the character's OWN class tags as own-class
// through this; measured on live data, 22 of 327 characters hold exactly such
// a row. Null for a character with no class_id: an aspiring character's branch
// of tagAbilities never consults it.
const familyResolver = (classRows, classId) => {
  if (!classId) return null;
  const family = computeVersionFamily(classRows || [], classId);
  return (candidateId) => (family.has(candidateId) ? classId : candidateId);
};

// Resolves a submitted gear item or ability to the class it belongs to, and to
// that class's text for it. An item that names its own class_id is taken at
// its word; otherwise the character's own class and the rest of its version
// family are tried first, then the submitted class NAME, and the global
// name map is the last resort.
const classItemResolver = ({ maps, ownClassId }) => {
  const itemsByClassId = maps.itemsByClassId ?? new Map();
  const classesByName = maps.classesByName ?? new Map();
  const familyClassIds = ownClassId
    ? computeVersionFamily(maps.classRows ?? [], ownClassId)
    : new Set();
  return (kind, item, nameToClassId, nameToDescription) => {
    if (item.class_id) {
      return {
        class_id: item.class_id,
        description: item.description ?? nameToDescription.get(item.name) ?? null
      };
    }
    for (const classId of [ownClassId, ...familyClassIds].filter(Boolean)) {
      const classItems = itemsByClassId.get(classId)?.[kind];
      // The description has to come from the class that resolved the id, or a
      // row gets one class's id paired with another class's text.
      if (classItems?.has(item.name)) {
        return {
          class_id: classId,
          description: item.description ?? classItems.get(item.name) ?? null
        };
      }
    }
    const namedCandidates = (classesByName.get(item.class_name?.trim().toLowerCase()) ?? [])
      .filter(classId => itemsByClassId.get(classId)?.[kind]?.has(item.name));
    const namedClassId = namedCandidates.find(classId => familyClassIds.has(classId)) ?? namedCandidates[0];
    if (namedClassId) {
      return {
        class_id: namedClassId,
        description: item.description ?? itemsByClassId.get(namedClassId)[kind].get(item.name) ?? null
      };
    }
    return {
      class_id: nameToClassId.get(item.name) ?? ownClassId ?? undefined,
      description: item.description ?? nameToDescription.get(item.name) ?? null
    };
  };
};

// The ability equivalent of resolveSubmittedGear, and for the same reason: the
// classic/expert form submits an ability as a bare "ClassName::AbilityName"
// string carrying neither class_id nor type (views/partials/character-class-
// abilities.handlebars), while tagAbilities (util/character-derived.js) reads
// exactly those two fields. Pricing the raw submission would charge every
// cross-class unlock at the own-class rate, and would leave the ratchet
// comparing stored rows that carry both fields against a submission that
// carries neither.
//
// Resolution runs through the same classItemResolver the write below uses, and
// an absent type falls back the way save_character_atomic does -- the stored
// row's tag, or Core for a genuinely new row -- so what the gate prices is
// what the save will store.
const resolveSubmittedAbilities = (abilities, { maps, ownClassId, storedAbilities }) => {
  const resolve = classItemResolver({ maps, ownClassId });
  const storedTypeByName = new Map(
    (Array.isArray(storedAbilities) ? storedAbilities : [])
      .filter(Boolean)
      .map(ability => [ability.name, ability.type])
  );
  return normalizeAbilityItems(abilities).map(item => ({
    name: item.name,
    class_id: resolve('abilities', item, maps.abilityNameToClassId, maps.abilityNameToDescription).class_id ?? null,
    type: submittedAbilityType(item.type) ?? storedTypeByName.get(item.name) ?? 'core'
  }));
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
    // One catalogue lookup covers three needs that would otherwise each cost
    // their own round of sub-queries: content_format (economyFor), resolving
    // bare "ClassName::Item" gear strings to a real class_id (below), and the
    // maps saveCharacterAtomic needs for its own class-item resolution --
    // handed straight through so it does not fetch the same four sub-queries
    // a second time on every creation.
    const maps = await this.adapter.getClassContentLookupMaps();
    const { gearNameToClassId, classRows } = maps;
    const classRow = (classRows || []).find(row => row.id === prepared.class_id);
    const contentFormat = classRow && classRow.content_format;
    // The classic/expert create form submits gear as bare "ClassName::Item"
    // strings with no class_id at all (views/partials/character-class-gear.
    // handlebars), and isCrossClass (util/merx-economy.js) reads a missing
    // class_id as "not cross-class" -- so pricing the unresolved list, as
    // both the economy check and the reward derivation below now avoid doing,
    // would price every cross-class Signature as if it were own-class.
    const resolvedGear = resolveSubmittedGear(prepared.gear, gearNameToClassId);
    // The ability half of the same problem -- see resolveSubmittedAbilities.
    // The character does not exist yet, so there are no stored types to
    // inherit from.
    const resolvedAbilities = resolveSubmittedAbilities(prepared.abilities, {
      maps, ownClassId: prepared.class_id ?? null
    });
    // Built from the family rows this catalogue lookup already returned, so
    // the gate agrees with the character's own page about which of its
    // abilities are cross-class rather than falling back to an identity
    // comparison that prices another version of its own class as cross.
    const classFamilyOf = familyResolver(classRows, prepared.class_id ?? null);
    const normalized = normalizeCharacterInput(prepared, {
      rulesVersion, creatorId: actor.id, contentFormat, economyGear: resolvedGear,
      economyAbilities: resolvedAbilities, classFamilyOf, isCreation: true,
      // A new character must be legal outright, so this pairs with
      // enforceMerxBudget's implicit default the same way updateCharacter
      // writes both out explicitly for its own edit-path decision.
      enforceAbilityLimits: true
    });
    if (normalized.error) return { data: null, error: normalized.error };

    const { data: characterInput, childData } = normalized;

    // The client sends its own agreeing commissary_reward figure, but the
    // server recomputes it here for the two V1 economies rather than
    // trusting it -- a disagreement between what the player was shown and
    // what gets stored is worse than a redundant computation.
    //
    // A character being created owns no missions to be paid for: its
    // completed_missions is a scalar count on the row, and creating one
    // writes no mission rows. So the leftover stored here is the creation
    // grant minus what the build spends -- the same figure
    // normalizeCharacterInput's budget check enforces, and the same figure
    // the character's own page derives from getRealMissions (routes/
    // characters.js), which finds nothing to credit.
    const economy = economyFor({ contentFormat, creatorMode: characterInput.creator_mode });
    if (economy !== 'advent') {
      const derived = deriveCharacterTotals({
        character: {
          class_id: characterInput.class_id,
          gear: resolvedGear,
          common_items: characterInput.common_items,
          aspiring_signatures: characterInput.aspiring_signatures,
          abilities: resolvedAbilities,
          ability_perks: childData.abilityPerks,
          // The pool comes from the submitted input, not a stored row -- the
          // character does not exist yet on create.
          aspiring_abilities: characterInput.aspiring_abilities
        },
        realMissions: [],
        offscreenMissions: [],
        rulesVersion,
        economy,
        classFamilyOf
      });
      characterInput.commissary_reward = derived.commissary_reward;
    }

    if (typeof this.adapter.saveCharacterAtomic === 'function') {
      return this.saveCharacterAtomic({
        id: null, actor, characterInput, childData, rulesVersion, previousAbilities: [], maps
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

    // creator_mode is immutable on update too, for the same reason class_id
    // is just above: the classic/expert edit form submits no creator_mode
    // field at all (it has none), so normalizeCharacterInput's own coercion
    // (an absent value becomes explicit null, services/character/input.js)
    // would otherwise overwrite it on every ordinary save. For an aspiring
    // character that column is the ONLY signal economyFor has once class_id
    // is null -- losing it silently reverts the character to the advent
    // economy: its Signature pricing, Merx breakdown and edit-form purchase
    // surface all disappear on the very next save. Preserved the same way
    // class_id is, not deleted: normalizeCharacterInput still needs a value
    // to validate.
    prepared.creator_mode = existing.data.creator_mode ?? null;

    // Resolved from the stored class, never the submitted one: this gates both
    // the v2-only field strip below and the perk rebuild in saveCharacterAtomic.
    // content_format rides alongside rulesVersion from the same one-row query
    // (services/character/repository.js#getClassRulesVersion, the method
    // levelUp already uses for the same reason) so the economy check just
    // below is not left resolving to 'advent' on every edit for want of it --
    // this is the one query updateCharacter already pays unconditionally, not
    // a new one, and it is not the auto_calculate-only catalogue lookup below.
    const rulesVersionResult = await this.adapter.getClassRulesVersion(storedClassId);
    const rulesVersion = rulesVersionResult.data || 'v1';
    const contentFormat = rulesVersionResult.contentFormat;
    if (rulesVersion !== 'v2') {
      for (const field of V2_ONLY_FIELDS) delete prepared[field];
    }
    prepared = await this.adapter.resolveClassReference(prepared);

    // See familyResolver. The query is skipped entirely for a class-less
    // (aspiring) character, whose branch of tagAbilities would not use it.
    let classFamilyOf = null;
    if (storedClassId) {
      const { data: classFamilyRows } = await this.adapter.getClassFamilyRows();
      classFamilyOf = familyResolver(classFamilyRows, storedClassId);
    }

    // The catalogue, fetched at most once per save and shared by everything
    // below that needs it: the ability resolution the economy gate and the
    // ratchet price, the auto_calculate derivation, and saveCharacterAtomic's
    // own class-item resolution. An edit that submits no abilities and is not
    // auto-calculated never pays for it here at all.
    let catalogueMaps = null;
    const loadCatalogueMaps = async () => {
      if (!catalogueMaps) catalogueMaps = await this.adapter.getClassContentLookupMaps();
      return catalogueMaps;
    };

    // See resolveSubmittedAbilities. The stored rows supply the type for an
    // ability the edit form resubmits as a bare string, which is the same
    // thing save_character_atomic does with an absent type.
    const submittedAbilityList = Array.isArray(prepared.abilities)
      ? prepared.abilities
      : (prepared.abilities ? [prepared.abilities] : []);
    const resolvedAbilities = submittedAbilityList.length > 0
      ? resolveSubmittedAbilities(submittedAbilityList, {
        maps: await loadCatalogueMaps(),
        ownClassId: storedClassId,
        storedAbilities: existing.data.abilities
      })
      : [];

    // The Signature Cap is enforced on every save, including an edit; the
    // Merx budget is NOT -- see validateEconomyLimits's own comment for why
    // (an edit's real budget needs mission-earned Merx this path does not
    // fetch outside auto_calculate, and checking the bare grant would refuse
    // a purchase the character can actually afford). The cap needs no
    // catalogue lookup: it counts Signatures and Enchantments
    // (signatureSlotsUsed), and it pairs a submission against the stored rows
    // getCharacter already returned using the class_id each side carries, so
    // it resolves no gear names. createCharacter does resolve gear, because
    // the Merx budget IT enforces prices cross-class items differently
    // (equipmentSpend reads class_id).
    //
    // storedGear is what makes the cap honest across two saves: an item that
    // omits `enchantment` and `mods` keeps its stored ones, so counting only
    // what the payload mentions would let 6 enchanted Signatures plus 12 bare
    // ones through at a submitted 12 slots and a real 18.
    // The Stat Cap is enforced on every edit too, the same way the Signature
    // Cap is just above; capPurchases comes from the row this call already
    // fetched (existing.data.stat_cap_purchases), not a second lookup. The
    // creation allotment and +++ ceiling are NOT enforced here -- see
    // validateStatLimits's own comment -- so this path fetches no class data
    // for the Stat Cap at all; a class's stat_spread plays no part in either
    // check validateStatLimits runs.
    const normalized = normalizeCharacterInput(prepared, {
      rulesVersion,
      normalizeAutoCalculate: true,
      contentFormat,
      enforceMerxBudget: false,
      storedGear: existing.data.gear,
      capPurchases: existing.data.stat_cap_purchases,
      enforceCreationAllotment: false,
      isCreation: false,
      // The ratchet below is what this path enforces instead; an absolute
      // check here would refuse every save by an already-breaching character.
      enforceAbilityLimits: false,
      economyAbilities: resolvedAbilities,
      // The submission never carries this key on update (Task 6) -- the
      // stored value is the only truth.
      aspiringAbilities: existing.data.aspiring_abilities,
      classFamilyOf
    });
    if (normalized.error) return { data: null, error: normalized.error };
    const { data: characterInput, childData } = normalized;

    // Same resolution createCharacter uses (economyFor, contentFormat from
    // the stored class, creator_mode pinned to the stored row) -- needed here
    // for the ratchet below, which runs whether or not auto_calculate is on.
    const economy = economyFor({ contentFormat, creatorMode: characterInput.creator_mode });

    if (characterInput.auto_calculate) {
      const { gearNameToClassId, classRows } = await loadCatalogueMaps();
      const classRow = (classRows || []).find(row => row.id === characterInput.class_id);
      const [missions, offscreenMissions] = await Promise.all([
        this.adapter.getRealMissions(id),
        this.adapter.listOffscreenMissions(id)
      ]);
      if (missions.error || offscreenMissions.error) {
        return { data: null, error: missions.error || offscreenMissions.error };
      }
      // Priced on the equipment the save LEAVES, not the equipment it
      // mentions: the edit form's purchase surface omits `enchantment` and
      // `mods` for every row the player did not touch, so pricing the bare
      // submission would refund Merx that is still spent and write the
      // difference back as reward the character could spend again.
      const derived = deriveCharacterTotals({
        character: {
          class_id: characterInput.class_id,
          gear: withPreservedEquipment(
            resolveSubmittedGear(childData.classGear, gearNameToClassId),
            existing.data.gear
          ),
          common_items: characterInput.common_items,
          aspiring_signatures: existing.data.aspiring_signatures,
          abilities: resolvedAbilities,
          ability_perks: childData.abilityPerks,
          // The submission never carries this key on update (Task 6) -- the
          // stored value is the only truth. Reading the submitted value here
          // would price every ability cross-class.
          aspiring_abilities: existing.data.aspiring_abilities
        },
        realMissions: missions.data || [],
        offscreenMissions: offscreenMissions.data || [],
        rulesVersion,
        economy: economyFor({
          contentFormat: classRow && classRow.content_format,
          creatorMode: characterInput.creator_mode
        }),
        classFamilyOf
      });
      characterInput.level = derived.level;
      characterInput.completed_missions = derived.completed_missions;
      characterInput.commissary_reward = derived.commissary_reward;
    }

    // The ratchet. An existing breach is grandfathered -- 12 of 327 live
    // characters are outside a HARD rule of this economy (13 are outside one of
    // either severity), and none of them becomes unsaveable. What is refused is a save that makes a hard breach
    // WORSE. The allowance is the stored row itself, which is why no
    // per-character exemption is stored anywhere.
    //
    // Each side is scored against the level it belongs to: the stored row's
    // level for what is on disk, and the level this save will write for what
    // is submitted. That is what makes `overage` comparable across a save
    // that raises the level -- scoring the submission against the old level
    // would refuse a character who levels up and spends the Perk the level
    // just earned, which is exactly the save the ratchet exists to allow.
    const ratchetArgs = {
      economy,
      abilityPerks: childData.abilityPerks,
      characterClassId: characterInput.class_id,
      aspiringAbilities: existing.data.aspiring_abilities,
      classFamilyOf
    };
    const worsened = worsenedBreaches(
      deriveBuildBreaches({
        ...ratchetArgs,
        level: existing.data.level,
        abilities: existing.data.abilities,
        abilityPerks: existing.data.ability_perks
      }),
      deriveBuildBreaches({
        ...ratchetArgs,
        level: characterInput.level ?? existing.data.level,
        abilities: resolvedAbilities
      })
    );
    if (worsened.length > 0) {
      return {
        data: null,
        error: {
          status: 400,
          message: `This change is not allowed while the build is illegal: ${worsened.map(b => b.detail).join(' ')}`
        }
      };
    }

    const previousAbilities = Array.isArray(existing.data.abilities) ? existing.data.abilities : [];
    if (typeof this.adapter.saveCharacterAtomic === 'function') {
      return this.saveCharacterAtomic({
        id, actor, characterInput, childData, rulesVersion, previousAbilities,
        maps: catalogueMaps ?? undefined
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

  async saveCharacterAtomic({ id, actor, characterInput, childData, rulesVersion, previousAbilities, maps: providedMaps }) {
    // A trait item arrives shaped {name, stat} from
    // services/character/input.js#normalizeCharacterInput.
    const traits = (Array.isArray(childData.traits) ? childData.traits : [])
      .filter(item => item && item.name != null && item.name !== '');
    // A caller that already fetched the catalogue (createCharacter, to
    // resolve content_format/gear before this ever runs) hands it in rather
    // than paying for the same four sub-queries again.
    const maps = providedMaps ?? await this.adapter.getClassContentLookupMaps();
    const resolveClassItem = classItemResolver({ maps, ownClassId: characterInput.class_id ?? null });
    // save_character_atomic reads an absent 'enchantment'/'mods' key on a
    // p_gear item as "keep what is stored" and an explicit JSON null as
    // "remove the Enchantment" (20260918000001_save_character_atomic_gear_
    // equipment.sql). normalizeGearItems has already normalized the item by
    // this point, leaving the key off entirely when the submission never
    // mentioned it, so passing through only what the item carries -- never
    // defaulting a missing key to null -- is what keeps an ordinary save from
    // the edit form (bare "Class::Item" strings, no equipment keys at all)
    // from spending a player's Merx for them.
    const gear = childData.classGear == null ? null : normalizeGearItems(childData.classGear).map(item => {
      const row = {
        name: item.name,
        ...resolveClassItem('gear', item, maps.gearNameToClassId, maps.gearNameToDescription)
      };
      if ('enchantment' in item) row.enchantment = item.enchantment;
      if ('mods' in item) row.mods = item.mods;
      return row;
    });
    const abilities = childData.classAbilities == null ? null : normalizeAbilityItems(childData.classAbilities).map(item => ({
      name: item.name,
      type: submittedAbilityType(item.type),
      ...resolveClassItem('abilities', item, maps.abilityNameToClassId, maps.abilityNameToDescription)
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
      .filter(item => item && item.name != null && item.name !== '');
    return this.applyChildDiff('traits', characterId, diffChildRows(existing.data, desired, {
      keyOf: row => row.name,
      rowFields: item => ({ name: item.name, stat: item.stat ?? null })
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
      const row = { name: item.name, class_id: classId, description: item.description ?? gearNameToDescription.get(item.name) ?? null };
      // normalizeGearItems (via normalizeGearEquipment) leaves 'enchantment'/
      // 'mods' off an item that never mentioned them, and diffChildRows only
      // ever compares the fields rowFields() returns -- so carrying that same
      // absence here, rather than defaulting to null/[], is what keeps a save
      // that says nothing about equipment from clearing a stored purchase. A
      // brand-new row that omits these keys on insert takes the column's own
      // default (enchantment NULL, mods '[]'), which is the same "no
      // equipment" state.
      if ('enchantment' in item) row.enchantment = item.enchantment;
      if ('mods' in item) row.mods = item.mods;
      desired.push(row);
    }
    // Each `desired` row above is already exactly the insert/update payload
    // shape -- name, class_id, description, and enchantment/mods only when the
    // submitted item carried them -- so rowFields hands it straight back. That
    // keeps "an absent key means keep what is stored" expressed once, where
    // the row is built, instead of in a second set of 'in' checks that could
    // drift from it.
    return this.applyChildDiff('class_gear', characterId, diffChildRows(existing.data, desired, {
      keyOf: row => `${row.class_id}:${row.name}`,
      rowFields: item => item
    }));
  }

  async reconcileAbilities(characterId, abilities) {
    const existing = await this.adapter.getChildRows('class_abilities', characterId);
    if (existing.error) return existing;
    const { abilityNameToClassId, abilityNameToDescription } = await this.adapter.getClassContentLookupMaps();
    // Keyed the way diffChildRows keys these rows, so an untagged submit inherits
    // the tag of the row it will match. First occurrence wins, matching the FIFO
    // pairing diffChildRows uses for duplicate keys.
    const storedTypes = new Map();
    for (const row of existing.data ?? []) {
      const key = `${row.class_id}:${row.name}`;
      if (!storedTypes.has(key)) storedTypes.set(key, row.type);
    }
    const desired = [];
    for (const item of normalizeAbilityItems(abilities)) {
      const classId = item.class_id ?? abilityNameToClassId.get(item.name);
      if (!classId) return { data: null, error: `[setCharacterAbilities] Missing class_id for ability "${item.name}"` };
      desired.push({
        name: item.name,
        class_id: classId,
        description: item.description ?? abilityNameToDescription.get(item.name) ?? null,
        type: submittedAbilityType(item.type) ?? storedTypes.get(`${classId}:${item.name}`) ?? 'core'
      });
    }
    const applied = await this.applyChildDiff('class_abilities', characterId, diffChildRows(existing.data, desired, {
      keyOf: row => `${row.class_id}:${row.name}`,
      rowFields: item => ({ name: item.name, class_id: item.class_id, description: item.description, type: item.type })
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

    const economy = await resolveMutationEconomy(this.adapter, character);
    if (economy !== 'advent') {
      const capError = statCapError(character, stats);
      if (capError) return { data: null, error: capError };
    }

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
    const requestedLevel = Math.max(currentLevel + 1, Math.min(LEVEL_CEILING, parseInteger(body.level, currentLevel + 1)));
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
      : { data: 'v1', contentFormat: null };
    const rulesVersion = rulesVersionResult.data || 'v1';
    const economy = economyFor({
      contentFormat: rulesVersionResult.contentFormat,
      creatorMode: character.creator_mode
    });

    const derived = deriveCharacterTotals({
      character,
      realMissions: missionsRes.data || [],
      offscreenMissions: offscreenRes.data || [],
      rulesVersion,
      economy
    });

    const stats = normalizeStatsPayload(body.stats || body);
    // The per-stat Cap only -- not the creation allotment, which a level-up
    // legitimately raises (LEVEL_PLUSES_PER_LEVEL, util/stat-caps.js); see
    // statCapError's own comment.
    if (economy !== 'advent') {
      const capError = statCapError(character, stats);
      if (capError) return { data: null, error: capError };
    }
    const fields = {
      ...stats,
      level: derived.level,
      completed_missions: derived.completed_missions,
      commissary_reward: derived.commissary_reward
    };
    const { data: perkRows, error: perkBuildError } = await this.buildPerkRows(id, Array.isArray(body.ability_perks) ? body.ability_perks : []);
    if (perkBuildError) return { data: null, error: perkBuildError };

    // The same ratchet updateCharacter runs, for the same reason: buildPerkRows
    // checks a Perk's word count and how many an Ability may carry, but nothing
    // there asks whether the character can afford the Perks it is attaching, so
    // a level-up is otherwise a way to spend Perks the character has not earned
    // and have the result grandfathered on its next ordinary save.
    //
    // A level-up raises the level, so the submitted side is scored against the
    // level being written while the stored side keeps the level being replaced
    // -- that is what lets a character spend the Perk the new level earns. The
    // roster is untouched by a level-up, so both sides hold the same Abilities
    // and only the Perk balance can worsen.
    const classFamilyOf = character.class_id
      ? familyResolver((await this.adapter.getClassFamilyRows()).data, character.class_id)
      : null;
    const storedPerks = Array.isArray(character.ability_perks) ? character.ability_perks : [];
    const ratchetArgs = {
      economy,
      abilities: character.abilities,
      characterClassId: character.class_id,
      aspiringAbilities: character.aspiring_abilities,
      classFamilyOf
    };
    const worsened = worsenedBreaches(
      deriveBuildBreaches({ ...ratchetArgs, level: character.level, abilityPerks: storedPerks }),
      deriveBuildBreaches({ ...ratchetArgs, level: derived.level, abilityPerks: [...storedPerks, ...perkRows] })
    );
    if (worsened.length > 0) {
      return {
        data: null,
        error: {
          status: 400,
          message: `This change is not allowed while the build is illegal: ${worsened.map(b => b.detail).join(' ')}`
        }
      };
    }

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

    // Validation must know which rows are compounds: a compound is allowed
    // five more words (util/perk-economy.js). The rows carry compounds_with:
    // null until the batch's refs are resolved below, so the flag is read from
    // the parallel meta array instead.
    const rowsForValidation = rows.map((row, index) => (
      meta[index] && meta[index].compoundsWith
        ? { ...row, compounds_with: meta[index].compoundsWith }
        : row
    ));
    const validation = validateAbilityPerks(existingForValidation.concat(rowsForValidation));
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
