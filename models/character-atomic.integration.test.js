// Local-Supabase integration coverage for the transactional character RPC.
require('../util/require-local-supabase');

const { test, expect, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('./_base');
const { createCharacter, updateCharacter } = require('./character');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `character-atomic-${suffix}@example.test`;
let authUserId;
let profile;
let characterClass;
let v2Class;
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
  // Ability perks are written only for v2 classes (CharacterService gates the
  // perk payload on rulesVersion), so perk coverage needs its own fixture.
  ({ data: v2Class } = await supabaseAdmin.from('classes')
    .insert({ name: `Atomic V2 Class ${suffix}`, rules_version: 'v2', is_public: true, gear: [], abilities: [] })
    .select()
    .single());
};

afterAll(async () => {
  if (profile?.id) await db.query('delete from characters where creator_id = $1', [profile.id]);
  if (profile?.id) await db.query('delete from profiles where id = $1', [profile.id]);
  if (characterClass?.id) await db.query('delete from classes where id = $1', [characterClass.id]);
  if (v2Class?.id) await db.query('delete from classes where id = $1', [v2Class.id]);
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

const v2AbilityName = 'Atomic V2 Ability';

const v2Input = (name) => ({
  ...stats,
  name,
  class: v2Class.name,
  class_id: v2Class.id,
  trait0: 'Brave',
  gear: [{ name: 'Atomic V2 Gear', class_id: v2Class.id }],
  abilities: [{ name: v2AbilityName, class_id: v2Class.id }]
});

const CHILD_TABLES = ['traits', 'class_gear', 'class_abilities', 'character_perks'];

const childRows = async (table, characterId) => {
  if (!CHILD_TABLES.includes(table)) throw new Error(`Unexpected child table: ${table}`);
  const { rows } = await db.query(
    `select * from ${table} where character_id = $1 order by id`, [characterId]
  );
  return rows;
};

const idsOf = (rows) => rows.map(row => row.id).sort();

const gearItem = (name, extra = {}) => ({ name, class_id: characterClass.id, ...extra });

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

test('a supplied created_at is persisted on create', async () => {
  await setup();
  const backdated = '2025-01-15T00:00:00.000Z';
  const { data: created, error } = await createCharacter(
    { ...input(`Atomic backdated ${suffix}`), created_at: backdated }, profile
  );
  expect(error).toBeNull();

  const { rows } = await db.query('select created_at from characters where id = $1', [created.id]);
  expect(new Date(rows[0].created_at).toISOString()).toBe(backdated);
});

test('created_at survives an update whose payload omits it', async () => {
  await setup();
  const backdated = '2025-01-15T00:00:00.000Z';
  const { data: created } = await createCharacter(
    { ...input(`Atomic preserve ${suffix}`), created_at: backdated }, profile
  );

  const renamed = `Atomic preserved ${suffix}`;
  const { error } = await updateCharacter(
    created.id, { ...input(renamed), id: created.id }, profile
  );
  expect(error).toBeFalsy();

  const { rows } = await db.query('select name, created_at from characters where id = $1', [created.id]);
  expect(rows[0].name).toBe(renamed);
  expect(new Date(rows[0].created_at).toISOString()).toBe(backdated);
});

test('updating a character bumps updated_at via the trigger', async () => {
  await setup();
  const { data: created } = await createCharacter(input(`Atomic bump ${suffix}`), profile);
  const { rows: before } = await db.query('select updated_at from characters where id = $1', [created.id]);

  await updateCharacter(
    created.id, { ...input(`Atomic bumped ${suffix}`), id: created.id }, profile
  );

  const { rows: after } = await db.query(
    'select created_at, updated_at from characters where id = $1', [created.id]
  );
  // node-pg parses timestamptz into a Date object, not a string. Date.parse()
  // on a Date argument coerces it via the default Date#toString(), which has
  // only whole-second resolution -- that silently dropped the sub-second part
  // of these fast (tens-of-ms) round trips and made "before" and "after"
  // collide on the same second almost every run. new Date(...).getTime()
  // preserves full precision for both Date and string inputs.
  expect(new Date(after[0].updated_at).getTime()).toBeGreaterThan(new Date(before[0].updated_at).getTime());
  expect(new Date(after[0].updated_at).getTime()).toBeGreaterThanOrEqual(new Date(after[0].created_at).getTime());
});

// save_character_atomic deletes every child row and reinserts it on every save,
// so an untouched item gets a fresh UUID each time. Nothing referencing that id
// can survive -- character_perks.class_ability_id is ON DELETE CASCADE. These
// pin the reconciliation contract specified in util/reconcile.js#diffChildRows:
// matched rows keep their identity, only genuine removals are deleted.

test('re-saving an unchanged ability keeps its class_abilities row id', async () => {
  await setup();
  const { data: created, error: createError } = await createCharacter(
    input(`Atomic ability identity ${suffix}`), profile
  );
  expect(createError).toBeNull();
  const before = await childRows('class_abilities', created.id);
  expect(before).toHaveLength(1);

  const { error } = await updateCharacter(
    created.id, { ...input(`Atomic ability identity kept ${suffix}`), id: created.id }, profile
  );
  expect(error).toBeFalsy();

  const after = await childRows('class_abilities', created.id);
  expect(idsOf(after)).toEqual(idsOf(before));
});

test('re-saving unchanged gear keeps its class_gear row id', async () => {
  await setup();
  const { data: created, error: createError } = await createCharacter(
    input(`Atomic gear identity ${suffix}`), profile
  );
  expect(createError).toBeNull();
  const before = await childRows('class_gear', created.id);
  expect(before).toHaveLength(1);

  const { error } = await updateCharacter(
    created.id, { ...input(`Atomic gear identity kept ${suffix}`), id: created.id }, profile
  );
  expect(error).toBeFalsy();

  const after = await childRows('class_gear', created.id);
  expect(idsOf(after)).toEqual(idsOf(before));
});

test('re-saving a v2 character preserves its ability perk row and created_at', async () => {
  await setup();
  const { data: created, error: createError } = await createCharacter({
    ...v2Input(`Atomic perk survival ${suffix}`),
    ability_perks: [{ class_ability_id: v2AbilityName, text: 'Survives a resave', position: 0 }]
  }, profile);
  expect(createError).toBeNull();

  const before = await childRows('character_perks', created.id);
  expect(before).toHaveLength(1);
  const [ability] = await childRows('class_abilities', created.id);

  const { error } = await updateCharacter(created.id, {
    ...v2Input(`Atomic perk survived ${suffix}`),
    id: created.id,
    ability_perks: [{ class_ability_id: ability.id, text: 'Survives a resave', position: 0 }]
  }, profile);
  expect(error).toBeFalsy();

  const after = await childRows('character_perks', created.id);
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(before[0].id);
  expect(new Date(after[0].created_at).getTime()).toBe(new Date(before[0].created_at).getTime());
});

test('changing only a gear description updates the existing row in place', async () => {
  await setup();
  const { data: created, error: createError } = await createCharacter(
    input(`Atomic gear description ${suffix}`), profile
  );
  expect(createError).toBeNull();
  const [before] = await childRows('class_gear', created.id);

  const { error } = await updateCharacter(created.id, {
    ...input(`Atomic gear described ${suffix}`),
    id: created.id,
    gear: [gearItem('Atomic Gear', { description: 'Now described' })]
  }, profile);
  expect(error).toBeFalsy();

  const after = await childRows('class_gear', created.id);
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(before.id);
  expect(after[0].description).toBe('Now described');
});

test('adding a gear item inserts one row and leaves the existing row id untouched', async () => {
  await setup();
  const { data: created, error: createError } = await createCharacter(
    input(`Atomic gear insert ${suffix}`), profile
  );
  expect(createError).toBeNull();
  const before = await childRows('class_gear', created.id);
  expect(before).toHaveLength(1);

  const { error } = await updateCharacter(created.id, {
    ...input(`Atomic gear inserted ${suffix}`),
    id: created.id,
    gear: [gearItem('Atomic Gear'), gearItem('Atomic Extra Gear')]
  }, profile);
  expect(error).toBeFalsy();

  const after = await childRows('class_gear', created.id);
  expect(after).toHaveLength(2);
  expect(idsOf(after)).toContain(before[0].id);
});

test('removing one gear item deletes only that row and leaves the others untouched', async () => {
  await setup();
  const { data: created, error: createError } = await createCharacter({
    ...input(`Atomic gear delete ${suffix}`),
    gear: [gearItem('Atomic Gear'), gearItem('Atomic Doomed Gear')]
  }, profile);
  expect(createError).toBeNull();
  const before = await childRows('class_gear', created.id);
  expect(before).toHaveLength(2);
  const kept = before.find(row => row.name === 'Atomic Gear');

  const { error } = await updateCharacter(created.id, {
    ...input(`Atomic gear deleted ${suffix}`),
    id: created.id,
    gear: [gearItem('Atomic Gear')]
  }, profile);
  expect(error).toBeFalsy();

  const after = await childRows('class_gear', created.id);
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(kept.id);
});

// Duplicates are the case a set-based diff gets wrong: two identically-named
// same-class items must consume two existing rows FIFO, not collapse into one.
test('duplicate gear items keep two stable rows and drop to one when one is removed', async () => {
  await setup();
  const { data: created, error: createError } = await createCharacter({
    ...input(`Atomic gear duplicates ${suffix}`),
    gear: [gearItem('Atomic Twin Gear'), gearItem('Atomic Twin Gear')]
  }, profile);
  expect(createError).toBeNull();
  const before = await childRows('class_gear', created.id);
  expect(before).toHaveLength(2);

  const { error: resaveError } = await updateCharacter(created.id, {
    ...input(`Atomic gear duplicates resaved ${suffix}`),
    id: created.id,
    gear: [gearItem('Atomic Twin Gear'), gearItem('Atomic Twin Gear')]
  }, profile);
  expect(resaveError).toBeFalsy();

  const resaved = await childRows('class_gear', created.id);
  expect(idsOf(resaved)).toEqual(idsOf(before));

  const { error: trimError } = await updateCharacter(created.id, {
    ...input(`Atomic gear duplicates trimmed ${suffix}`),
    id: created.id,
    gear: [gearItem('Atomic Twin Gear')]
  }, profile);
  expect(trimError).toBeFalsy();

  const trimmed = await childRows('class_gear', created.id);
  expect(trimmed).toHaveLength(1);
  expect(idsOf(before)).toContain(trimmed[0].id);
});
