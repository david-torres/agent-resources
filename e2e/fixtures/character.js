require('../../util/env');
const { supabaseAdmin } = require('../../models/_base');
const { createCharacter } = require('../../models/character');

// The 15 numeric fields createCharacter requires, copied from
// models/character-atomic.integration.test.js:16-19.
const BASE_STATS = {
  vitality: 1, might: 1, resilience: 1, spirit: 1, arcane: 1, will: 1,
  sensory: 1, reflex: 1, vigor: 1, skill: 1, intelligence: 1, luck: 1,
  level: 1, completed_missions: 0, commissary_reward: 0
};

// Goes through the real model seam rather than raw inserts so fixtures cannot
// drift from what the app itself writes.
//
// The ability name is prefixed (matching fixtures/class.js's default
// abilities), not the bare literal "E2E Ability" fixtures used to share:
// server-side class_id resolution for a submitted ability
// (services/character/service.js reconcileAbilities ->
// getClassContentLookupMaps().abilityNameToClassId) is keyed by ability NAME
// ONLY, globally across every class in the catalog. Under fullyParallel
// execution multiple specs' fixture classes can exist at once; an unprefixed
// name collides across them and a save can silently resolve to a different
// worker's class_id. Keep this prefixed unless classRow.abilities was
// overridden with its own (also-prefixed) names.
const seedCharacter = async (prefix, profile, classRow, overrides = {}) => {
  const input = {
    ...BASE_STATS,
    name: `${prefix}-character`,
    class: classRow.name,
    class_id: classRow.id,
    trait0: 'Brave',
    gear: [],
    abilities: [{ name: `${prefix} E2E Ability`, class_id: classRow.id }],
    ...overrides
  };
  const { data, error } = await createCharacter(input, profile);
  if (error) throw error;
  return data;
};

// character_perks.class_ability_id references class_abilities.id — the row
// createCharacter wrote for this character, not the class's ability template.
const abilityIdFor = async (characterId) => {
  const { data, error } = await supabaseAdmin
    .from('class_abilities').select('id').eq('character_id', characterId).limit(1).single();
  if (error) throw error;
  return data.id;
};

const seedPerk = async (characterId, classAbilityId, text, position = 1) => {
  const { data, error } = await supabaseAdmin
    .from('character_perks')
    .insert({ character_id: characterId, class_ability_id: classAbilityId, text, position })
    .select()
    .single();
  if (error) throw error;
  return data;
};

const seedOffscreenMission = async (characterId, profileId, {
  sourceMissionId = null,
  name,
  summary = 'Fixture offscreen mission',
  sourceMissionName = 'Fixture Source',
  sourceMissionDate = '2026-01-01'
}) => {
  const { data, error } = await supabaseAdmin
    .from('offscreen_missions')
    .insert({
      character_id: characterId,
      name,
      summary,
      source_mission_id: sourceMissionId,
      source_mission_name: sourceMissionName,
      source_mission_date: sourceMissionDate,
      created_by: profileId
    })
    .select()
    .single();
  if (error) throw error;
  return data;
};

module.exports = { BASE_STATS, seedCharacter, seedPerk, seedOffscreenMission, abilityIdFor };
