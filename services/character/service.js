const {
  cloneInput,
  normalizeCharacterInput,
  normalizeGearItems,
  normalizeAbilityItems,
  normalizeAbilityPerks
} = require('./input');
const { deriveCharacterTotals } = require('../../util/character-derived');
const { remapPerkAbilityIds, remapPerkAbilityIdsByName } = require('../../util/ability-perks');
const { diffChildRows, resolveCompoundLinks } = require('../../util/reconcile');

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
  'listOffscreenMissions'
];

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
    if (existing.data.creator_id != actor.id) return { data: null, error: 'Unauthorized' };

    let rulesVersion = await this.adapter.getRulesVersion(input.class_id);
    let prepared = cloneInput(input);
    if (rulesVersion !== 'v2') {
      for (const field of V2_ONLY_FIELDS) delete prepared[field];
    }
    prepared = await this.adapter.resolveClassReference(prepared);
    rulesVersion = await this.adapter.getRulesVersion(prepared.class_id);

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
}

module.exports = { CharacterService, resolveSubmittedGear };
