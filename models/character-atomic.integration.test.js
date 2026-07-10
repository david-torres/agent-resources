// Local-Supabase integration coverage for the transactional character RPC.
const { test, expect, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('./_base');
const { createCharacter } = require('./character');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `character-atomic-${suffix}@example.test`;
let authUserId;
let profile;
let characterClass;
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
    .insert({ user_id: authUserId, name: `Atomic ${suffix}`, is_public: true, timezone: 'UTC' })
    .select()
    .single());
  ({ data: characterClass } = await supabaseAdmin.from('classes')
    .insert({ name: `Atomic Class ${suffix}`, rules_version: 'v1', is_public: true, gear: [], abilities: [] })
    .select()
    .single());
};

afterAll(async () => {
  if (profile?.id) await db.query('delete from characters where creator_id = $1', [profile.id]);
  if (profile?.id) await db.query('delete from profiles where id = $1', [profile.id]);
  if (characterClass?.id) await db.query('delete from classes where id = $1', [characterClass.id]);
  if (authUserId) await db.query('delete from auth.users where id = $1', [authUserId]);
  await db.end();
});

const input = (name, gearClassId = characterClass.id) => ({
  ...stats,
  name,
  class: characterClass.name,
  class_id: characterClass.id,
  trait0: 'Brave',
  gear: [{ name: 'Atomic Gear', class_id: gearClassId }],
  abilities: [{ name: 'Atomic Ability', class_id: characterClass.id }]
});

test('atomic character create writes parent and children together', async () => {
  await setup();
  const { data, error } = await createCharacter(input(`Atomic success ${suffix}`), profile);
  expect(error).toBeNull();
  expect(data.id).toBeTruthy();

  const [{ data: traits }, { data: gear }, { data: abilities }] = await Promise.all([
    supabaseAdmin.from('traits').select('*').eq('character_id', data.id),
    supabaseAdmin.from('class_gear').select('*').eq('character_id', data.id),
    supabaseAdmin.from('class_abilities').select('*').eq('character_id', data.id)
  ]);
  expect(traits).toHaveLength(1);
  expect(gear).toHaveLength(1);
  expect(abilities).toHaveLength(1);
});

test('atomic character create rolls back the parent when a child write fails', async () => {
  await setup();
  const name = `Atomic rollback ${suffix}`;
  const { error } = await createCharacter(input(name, '00000000-0000-4000-8000-000000000001'), profile);
  expect(error).toBeTruthy();
  const { data } = await supabaseAdmin.from('characters').select('id').eq('name', name);
  expect(data).toHaveLength(0);
});
