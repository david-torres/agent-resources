// Local-Supabase coverage for class_abilities_character_name_key and the
// save_character_atomic restatement that deletes a replaced Ability before
// inserting its successor.
require('../util/require-local-supabase');

const { test, expect, beforeAll, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('../models/_base');
const { statList } = require('../util/enclave-consts');
const characterRepository = require('../services/character/repository');
const { CharacterService } = require('../services/character/service');
const { createAuthUserAndProfile } = require('./helpers/auth-user-fixture');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});
const NAME = `Raven ${suffix}`;
const EMPTY_MAPS = {
  gearNameToClassId: new Map(), gearNameToDescription: new Map(),
  abilityNameToClassId: new Map(), abilityNameToDescription: new Map(),
  itemsByClassId: new Map(), classesByName: new Map(), classRows: []
};

let authUserId;
let profile;
let characterId;
const classes = {};

const insertClass = async (name) => {
  const { data, error } = await supabaseAdmin.from('classes')
    .insert({ name, rules_version: 'v1', is_public: true, gear: [], abilities: [], advanced_abilities: [] })
    .select()
    .single();
  if (error) throw error;
  return data;
};

const save = (abilities) => supabaseAdmin.rpc('save_character_atomic', {
  p_character_id: characterId, p_creator_id: profile.id, p_character: {},
  p_traits: [], p_gear: null, p_abilities: abilities, p_perks: null
});

const storedAbilities = async () => (await db.query(
  'select name, class_id from class_abilities where character_id = $1 order by name', [characterId]
)).rows;

beforeAll(async () => {
  await db.connect();
  ({ authUserId, profile } = await createAuthUserAndProfile(db, {
    email: `unique-ability-${suffix}@example.test`, profileName: `Unique ${suffix}`
  }));
  classes.illusionist = await insertClass(`Illusionist ${suffix}`);
  classes.mesmer = await insertClass(`Mesmer ${suffix}`);
  const { data, error } = await supabaseAdmin.rpc('save_character_atomic', {
    p_character_id: null,
    p_creator_id: profile.id,
    p_character: {
      ...Object.fromEntries(statList.map(stat => [stat, 1])),
      creator_id: profile.id, name: NAME, class: classes.illusionist.name, class_id: classes.illusionist.id,
      level: 1, completed_missions: 0, commissary_reward: 0
    },
    p_traits: [],
    p_gear: [],
    p_abilities: [{ name: 'Veneer', class_id: classes.illusionist.id, type: 'core' }],
    p_perks: []
  });
  if (error) throw error;
  characterId = data.id;
});

afterAll(async () => {
  if (profile?.id) await db.query('delete from characters where creator_id = $1', [profile.id]);
  if (profile?.id) await db.query('delete from profiles where id = $1', [profile.id]);
  for (const cls of Object.values(classes)) await db.query('delete from classes where id = $1', [cls.id]);
  if (authUserId) await db.query('delete from auth.users where id = $1', [authUserId]);
  await db.end();
});

test('two Abilities whose names differ only by case and spacing cannot be saved', async () => {
  const { error } = await save([
    { name: 'Veneer', class_id: classes.illusionist.id, type: 'core' },
    { name: ' veneer', class_id: classes.mesmer.id, type: 'core' }
  ]);
  expect(error?.code).toBe('23505');
  expect(error.message).toContain('class_abilities_character_name_key');
  expect(await storedAbilities()).toEqual([{ name: 'Veneer', class_id: classes.illusionist.id }]);
});

// Conversion and the upgrade script move an Ability to another class under the
// same name; the delete must land before the insert or the index trips.
test('an Ability moved to another class under the same name saves', async () => {
  const { error } = await save([{ name: 'Veneer', class_id: classes.mesmer.id, type: 'core' }]);
  expect(error).toBeNull();
  expect(await storedAbilities()).toEqual([{ name: 'Veneer', class_id: classes.mesmer.id }]);
});

test('an Ability respelled only by case saves', async () => {
  const { error } = await save([{ name: 'VENEER', class_id: classes.mesmer.id, type: 'core' }]);
  expect(error).toBeNull();
  expect(await storedAbilities()).toEqual([{ name: 'VENEER', class_id: classes.mesmer.id }]);
});

test('the service reports the violation as the character already holding the name', async () => {
  const service = new CharacterService({
    ...characterRepository,
    getRulesVersion: async () => 'v1',
    resolveClassReference: async (input) => input,
    getClassContentLookupMaps: async () => EMPTY_MAPS,
    findUpgradeTargets: async () => []
  });
  const result = await service.saveCharacterAtomic({
    id: characterId,
    actor: { id: profile.id },
    characterInput: {},
    characterName: NAME,
    childData: {
      traits: [],
      classGear: null,
      classAbilities: [
        { name: 'Phantasm', class_id: classes.illusionist.id, type: 'core' },
        { name: 'phantasm', class_id: classes.mesmer.id, type: 'core' }
      ]
    },
    rulesVersion: 'v1',
    previousAbilities: [],
    maps: EMPTY_MAPS
  });
  expect(result).toEqual({ data: null, error: { status: 400, message: `${NAME} already has Phantasm.` } });
});
