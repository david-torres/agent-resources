// Local-Supabase integration coverage for the transactional level-up RPC.
// Proves the level-up terminal writes (owned-field update + perk insert/link
// resolution) commit or roll back together via level_up_character_atomic.
require('../util/require-local-supabase');

const { test, expect, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('./_base');
const { createCharacter, levelUpCharacter } = require('./character');
const repository = require('../services/character/repository');
const { historySnapshot, buildSnapshot } = require('../services/character/level-up-snapshot');
const { randomUUID } = require('node:crypto');

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
  const initial = await levelUpCharacter(ACTOR, character.id, {
    level: 2, mission_names: ['Initial Alpha', 'Initial Bravo'], stats: {}
  });
  expect(initial.error).toBeNull();
  // Five completed missions is level 3 for a v1 character (v1LevelingSequence,
  // util/enclave-consts.js) and so two earned Perks -- what the two below
  // cost. levelUp runs the same ratchet updateCharacter does, so a level-up
  // that cannot pay for its Perks is refused before the RPC ever resolves a
  // compound link.
  const { error } = await levelUpCharacter(ACTOR, character.id, {
    level: 3,
    completed_missions: 5,
    mission_names: ['Op Charlie', 'Op Delta', 'Op Echo'],
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


const prepareAtomic = async (characterId, overrides = {}) => {
  const { data: character, error } = await repository.getCharacter(characterId);
  if (error) throw error;
  const [missions, offscreen, rules] = await Promise.all([
    repository.getRealMissions(characterId), repository.listOffscreenMissions(characterId),
    repository.getClassRulesVersion(character.class_id)
  ]);
  return {
    p_character_id: characterId, p_creator_id: profile.id, p_profile_id: profile.id,
    p_request_id: randomUUID(), p_request_hash: 'integration-request',
    p_snapshot: { updated_at: character.updated_at, level: character.level,
      class_id: character.class_id, creator_mode: character.creator_mode,
      class_rules: rules.classRules, build: buildSnapshot(character), ...historySnapshot(missions.data, offscreen.data) },
    p_mission_names: ['Atomic Alpha', 'Atomic Bravo'], p_credit_source_ids: [],
    p_fields: { level: 2, completed_missions: 2, commissary_reward: 4 }, p_perks: [],
    ...overrides
  };
};
const state = async id => {
  const { rows } = await db.query(`select
    (select to_jsonb(c) from characters c where id=$1) as character,
    (select count(*)::int from mission_characters where character_id=$1) as links,
    (select count(*)::int from offscreen_missions where character_id=$1) as credits,
    (select count(*)::int from character_perks where character_id=$1) as perks,
    (select count(*)::int from character_level_up_requests where character_id=$1) as requests,
    (select count(*)::int from missions where creator_id=$2) as missions`, [id, profile.id]);
  return rows[0];
};

test('failed atomic promotion rolls back new missions, credit spend, stats, and perks', async () => {
  await setup();
  const character = await createOwnedCharacter();
  const source = await db.query(`insert into missions(name,date,outcome,creator_id,host_id)
    values($1,now(),'success',$2,$2) returning id`, [`Hosted ${suffix}`, profile.id]);
  const args = await prepareAtomic(character.id, {
    p_mission_names: ['Rollback Alpha'], p_credit_source_ids: [source.rows[0].id],
    p_fields: { level: 2, completed_missions: 2, commissary_reward: 3, vitality: 4 },
    p_perks: [{ class_ability_id: randomUUID(), text: 'Invalid foreign key', position: 0 }]
  });
  const before = await state(character.id);
  const result = await supabaseAdmin.rpc('level_up_character_with_missions_atomic', args);
  expect(result.error).toBeTruthy();
  expect(await state(character.id)).toEqual(before);
});

test('atomic promotion and service retries do not duplicate missions or perks', async () => {
  await setup();
  const character = await createOwnedCharacter();
  const body = { level: 2, request_id: randomUUID(), mission_names: ['Retry Alpha', 'Retry Bravo'],
    ability_perks: [{ class_ability_id: character.abilityId, text: 'Retry perk', ref: 'r1' }] };
  const first = await levelUpCharacter(ACTOR, character.id, body);
  expect(first.error).toBeNull();
  const before = await state(character.id);
  const retry = await levelUpCharacter(ACTOR, character.id, body);
  expect(retry).toEqual(first);
  expect(await state(character.id)).toEqual(before);
  const changed = await levelUpCharacter(ACTOR, character.id, { ...body, stats: { vitality: 5 } });
  expect(changed.error.status).toBe(409);
  expect(await state(character.id)).toEqual(before);
});

test('stale mission history rejects atomic promotion before any new writes', async () => {
  await setup();
  const character = await createOwnedCharacter();
  const args = await prepareAtomic(character.id);
  const mission = await db.query(`insert into missions(name,date,outcome,creator_id)
    values($1,now(),'pending',$2) returning id`, [`Concurrent ${suffix}`, profile.id]);
  await db.query('insert into mission_characters(mission_id,character_id) values($1,$2)', [mission.rows[0].id, character.id]);
  const before = await state(character.id);
  const result = await supabaseAdmin.rpc('level_up_character_with_missions_atomic', args);
  expect(result.error.message).toContain('Mission history changed');
  expect(await state(character.id)).toEqual(before);
});

test('concurrent history transaction completes before promotion snapshot validation', async () => {
  await setup();
  const character = await createOwnedCharacter();
  const args = await prepareAtomic(character.id);
  const writer = new Client({ connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
  await writer.connect();
  try {
    await writer.query('begin');
    const mission = await writer.query(`insert into missions(name,date,outcome,creator_id)
      values($1,now(),'failure',$2) returning id`, [`Concurrent committed ${suffix}`, profile.id]);
    await writer.query('insert into mission_characters(mission_id,character_id) values($1,$2)', [mission.rows[0].id, character.id]);
    const promotion = supabaseAdmin.rpc('level_up_character_with_missions_atomic', args).then(result => result);
    await writer.query('commit');
    const result = await promotion;
    expect(result.error.message).toContain('Mission history changed');
    const after = await state(character.id);
    expect(after.character.level).toBe(1);
    expect(after.links).toBe(1);
    expect(after.requests).toBe(0);
  } finally { await writer.query('rollback'); await writer.end(); }
});

test('level-10 and insufficient-history requests create no backfill or credit rows', async () => {
  await setup();
  const character = await createOwnedCharacter();
  const before = await state(character.id);
  const insufficient = await levelUpCharacter(ACTOR, character.id, { level: 2, completed_missions: 999, mission_names: ['Just one'] });
  expect(insufficient.error.status).toBe(409);
  expect(await state(character.id)).toEqual(before);
  await db.query('update characters set level=10 where id=$1', [character.id]);
  const capped = await state(character.id);
  const ceiling = await levelUpCharacter(ACTOR, character.id, { level: 11, mission_names: ['No level 11'] });
  expect(ceiling.error.status).toBe(409);
  expect(await state(character.id)).toEqual(capped);
});

test('stale ability perks reject a promotion even when character timestamp is unchanged', async () => {
  await setup();
  const character = await createOwnedCharacter();
  const args = await prepareAtomic(character.id);
  await db.query('insert into character_perks(character_id,class_ability_id,text,position) values($1,$2,$3,0)',
    [character.id, character.abilityId, 'Concurrent perk']);
  const before = await state(character.id);
  const result = await supabaseAdmin.rpc('level_up_character_with_missions_atomic', args);
  expect(result.error.message).toContain('Character build changed');
  expect(await state(character.id)).toEqual(before);
});

test('concurrent duplicate atomic requests return the same promotion and create missions once', async () => {
  await setup();
  const character = await createOwnedCharacter();
  const args = await prepareAtomic(character.id);
  const [first, retry] = await Promise.all([
    supabaseAdmin.rpc('level_up_character_with_missions_atomic', args),
    supabaseAdmin.rpc('level_up_character_with_missions_atomic', args)
  ]);
  expect(first.error).toBeNull();
  expect(retry).toEqual(first);
  const after = await state(character.id);
  expect(after.character.level).toBe(2);
  expect(after.links).toBe(2);
  expect(after.requests).toBe(1);
});
