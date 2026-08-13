// Local-Supabase integration coverage for the transactional character RPC.
const { test, expect, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('./_base');
const { createCharacter, updateCharacter } = require('./character');

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

// The UPDATE branch of save_character_atomic had no coverage here, which is how
// `FROM jsonb_populate_record(current, p_character)` shipped: it references the
// UPDATE's own target alias, Postgres raises "invalid reference to FROM-clause
// entry for table \"current\"", and every character edit 500'd. Both tests above
// take the INSERT branch, so this suite stayed green against a database built
// from migrations alone. Fixed by 20260811000000_fix_save_character_atomic_update.
//
// Asserted against the row itself, not just the returned error: a function that
// silently matched nothing would report no error while changing nothing.
test('atomic character update persists the change to the parent row', async () => {
  await setup();
  const { data: created, error: createError } = await createCharacter(
    input(`Atomic update ${suffix}`), profile
  );
  expect(createError).toBeNull();

  const renamed = `Atomic updated ${suffix}`;
  const { error } = await updateCharacter(
    created.id, { ...input(renamed), id: created.id }, profile
  );
  expect(error).toBeFalsy();

  const { rows } = await db.query('select name from characters where id = $1', [created.id]);
  expect(rows[0]?.name).toBe(renamed);
});

// Driven straight at the RPC, not through updateCharacter: CharacterService
// throws a 403 on ownership long before the function runs, so the service-level
// path cannot reach this guard. The pre-read the fix introduces IS the guard --
// a mismatched creator must raise, not quietly match zero rows and report
// success.
test('save_character_atomic raises rather than updating a row the creator does not own', async () => {
  await setup();
  const { data: created } = await createCharacter(input(`Atomic foreign ${suffix}`), profile);

  const { error } = await supabaseAdmin.rpc('save_character_atomic', {
    p_character_id: created.id,
    p_creator_id: '00000000-0000-4000-8000-000000000002',
    p_character: { name: `Atomic hijacked ${suffix}` },
    p_traits: [], p_gear: [], p_abilities: [], p_perks: []
  });
  expect(error).toBeTruthy();

  const { rows } = await db.query('select name from characters where id = $1', [created.id]);
  expect(rows[0]?.name).toBe(`Atomic foreign ${suffix}`);
});
