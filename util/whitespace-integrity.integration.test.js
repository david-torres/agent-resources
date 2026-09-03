// util/whitespace-integrity.integration.test.js
// There is no CHECK constraint enforcing this -- normalization happens in the
// application input layer only. That makes coverage the whole guard, and this
// test the thing that notices a write path which skipped it.
const { test, expect, afterAll } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');
const { createCharacter } = require('../models/character');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

test('no stored text value carries leading or trailing whitespace', async () => {
  const { data, error } = await sb.rpc('untrimmed_text_values');
  expect(error).toBeNull();
  expect(data).toEqual([]);
});

// Scanning data at rest only fires if something already wrote untrimmed text,
// and no other integration test does. Driving a padded payload through a real
// write path is what makes the scan a guard rather than a description of
// whatever the local database happens to hold.
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `whitespace-guard-${suffix}@example.test`;
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});

let authUserId;
let profile;
let characterClass;

const stats = {
  vitality: 1, might: 1, resilience: 1, spirit: 1, arcane: 1, will: 1,
  sensory: 1, reflex: 1, vigor: 1, skill: 1, intelligence: 1, luck: 1,
  level: 1, completed_missions: 0, commissary_reward: 0
};

const setup = async () => {
  await db.connect();
  const { rows } = await db.query(
    `insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
     values (gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
     returning id`,
    [email]
  );
  authUserId = rows[0].id;
  ({ data: profile } = await sb.from('profiles')
    .insert({ user_id: authUserId, name: `Whitespace Guard ${suffix}`, is_public: false, timezone: 'UTC' })
    .select()
    .single());
  ({ data: characterClass } = await sb.from('classes')
    .insert({ name: `Whitespace Guard Class ${suffix}`, rules_version: 'v1', is_public: true, gear: [], abilities: [] })
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

test('a padded payload driven through the character write path stores nothing untrimmed', async () => {
  await setup();

  const { data: character, error } = await createCharacter({
    ...stats,
    name: `  Padded Character ${suffix}  `,
    class: characterClass.name,
    class_id: characterClass.id,
    trait0: '  Brave  ',
    gear: [{ name: '  Padded Gear  ', class_id: characterClass.id }],
    abilities: [{ name: '  Padded Ability  ', class_id: characterClass.id }]
  }, profile);

  expect(error).toBeNull();
  expect(character.id).toBeTruthy();

  const { data: offenders, error: scanError } = await sb.rpc('untrimmed_text_values');
  expect(scanError).toBeNull();
  expect(offenders).toEqual([]);

  const [{ data: traits }, { data: gear }, { data: abilities }] = await Promise.all([
    sb.from('traits').select('name').eq('character_id', character.id),
    sb.from('class_gear').select('name').eq('character_id', character.id),
    sb.from('class_abilities').select('name').eq('character_id', character.id)
  ]);
  expect(character.name).toBe(`Padded Character ${suffix}`);
  expect(traits.map(row => row.name)).toEqual(['Brave']);
  expect(gear.map(row => row.name)).toEqual(['Padded Gear']);
  expect(abilities.map(row => row.name)).toEqual(['Padded Ability']);
});
