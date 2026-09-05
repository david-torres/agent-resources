// Local-Supabase integration coverage for the transactional level-up RPC.
// Proves the level-up terminal writes (owned-field update + perk insert/link
// resolution) commit or roll back together via level_up_character_atomic.
require('../util/require-local-supabase');

const { test, expect, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('./_base');
const { createCharacter, levelUpCharacter } = require('./character');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `character-level-up-${suffix}@example.test`;
let authUserId;
let profile;
let characterClass;
let ACTOR;
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});

const stats = {
  vitality: 1, might: 1, resilience: 1, spirit: 1, arcane: 1, will: 1,
  sensory: 1, reflex: 1, vigor: 1, skill: 1, intelligence: 1, luck: 1,
  level: 1, completed_missions: 0, commissary_reward: 0
};

const setup = async () => {
  if (profile) return;
  await db.connect();
  const { rows } = await db.query(
    `insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
     values (gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
     returning id`,
    [email]
  );
  authUserId = rows[0].id;
  ({ data: profile } = await supabaseAdmin.from('profiles')
    .insert({ user_id: authUserId, name: `LevelUp ${suffix}`, is_public: true, timezone: 'UTC' })
    .select()
    .single());
  ({ data: characterClass } = await supabaseAdmin.from('classes')
    .insert({ name: `LevelUp Class ${suffix}`, rules_version: 'v1', is_public: true, gear: [], abilities: [] })
    .select()
    .single());
  ACTOR = { userId: authUserId, profileId: profile.id, role: null };
};

afterAll(async () => {
  if (profile?.id) await db.query('delete from characters where creator_id = $1', [profile.id]);
  if (profile?.id) await db.query('delete from missions where creator_id = $1', [profile.id]);
  if (profile?.id) await db.query('delete from profiles where id = $1', [profile.id]);
  if (characterClass?.id) await db.query('delete from classes where id = $1', [characterClass.id]);
  if (authUserId) await db.query('delete from auth.users where id = $1', [authUserId]);
  await db.end();
});

const input = (name) => ({
  ...stats,
  name,
  class: characterClass.name,
  class_id: characterClass.id,
  trait0: 'Brave',
  gear: [{ name: 'LevelUp Gear', class_id: characterClass.id }],
  abilities: [{ name: 'LevelUp Ability', class_id: characterClass.id }]
});

// Creates an owned character and reads back its inserted class_abilities id so
// perks can reference a valid (FK-satisfying, allowed) class_ability_id.
const createOwnedCharacter = async () => {
  const name = `LevelUp Character ${suffix}-${Math.random().toString(16).slice(2)}`;
  const { data, error } = await createCharacter(input(name), profile);
  if (error) throw error;
  const { data: abilities } = await supabaseAdmin
    .from('class_abilities').select('id').eq('character_id', data.id);
  return { id: data.id, abilityId: abilities[0].id };
};

test('level-up terminal writes commit together', async () => {
  await setup();
  const character = await createOwnedCharacter();
  // level is re-derived from completed missions, so backfill two named
  // missions (v1 reaches level 2 at 2 completed missions) to actually bump it.
  const { data, error } = await levelUpCharacter(ACTOR, character.id, {
    level: 2,
    completed_missions: 2,
    mission_names: ['Op Alpha', 'Op Bravo'],
    ability_perks: [{ class_ability_id: character.abilityId, text: 'Perk A', ref: 'r1' }]
  });
  expect(error).toBeNull();
  expect(data.level).toBe(2);
  const { data: perks } = await supabaseAdmin.from('character_perks').select('*').eq('character_id', character.id);
  expect(perks.length).toBe(1);
  expect(perks[0].class_ability_id).toBe(character.abilityId);
});

test('level-up compound links resolve to same-batch positions inside the RPC', async () => {
  await setup();
  const character = await createOwnedCharacter();
  const { error } = await levelUpCharacter(ACTOR, character.id, {
    level: 2,
    ability_perks: [
      { class_ability_id: character.abilityId, text: 'Base perk', ref: 'r1' },
      { class_ability_id: character.abilityId, text: 'Compounding perk', ref: 'r2', compounds_with: 'new:r1' }
    ]
  });
  expect(error).toBeNull();
  const { data: perks } = await supabaseAdmin
    .from('character_perks').select('*').eq('character_id', character.id)
    .order('position', { ascending: true });
  expect(perks.length).toBe(2);
  // The position-1 perk's link was resolved by the RPC to the position-0 row's id.
  expect(perks[1].compounds_with).toBe(perks[0].id);
});

test('level-up rolls back the counter when a perk write fails (atomic terminal writes)', async () => {
  await setup();
  const character = await createOwnedCharacter();

  // buildPerkRows filters submitted perks to ALLOWED ability ids, so a bogus
  // class_ability_id never reaches the RPC — that path leaves a clean state
  // (level bumped, 0 perks). To exercise a TRUE in-RPC rollback we drive the
  // RPC directly with a perk row whose class_ability_id violates the
  // character_perks -> class_abilities FK; the perk INSERT must abort the whole
  // transaction, leaving the character's level unchanged.
  const badPerk = [{ class_ability_id: '00000000-0000-4000-8000-000000000000', text: 'Bad perk', position: 0, compounds_with: null }];
  const { error } = await supabaseAdmin.rpc('level_up_character_atomic', {
    p_character_id: character.id,
    p_creator_id: profile.id,
    p_fields: { level: 5 },
    p_perks: badPerk
  });
  expect(error).toBeTruthy();

  const { data: char } = await supabaseAdmin.from('characters').select('level').eq('id', character.id).single();
  const { data: perks } = await supabaseAdmin.from('character_perks').select('id').eq('character_id', character.id);
  // No half-applied terminal write: the level bump rolled back with the failed
  // perk insert, so level is still 1 and no perk row exists.
  expect(char.level).toBe(1);
  expect(perks.length).toBe(0);
});
