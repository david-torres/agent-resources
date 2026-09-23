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

const GEAR_NAME = `Atomic Enchant Gear ${suffix}`;
const OTHER_GEAR_NAME = `Atomic Enchant Gear Renamed ${suffix}`;

const gearRows = (characterId) => childRows('class_gear', characterId);

// Drives save_character_atomic directly (like the "raises rather than
// updating" test above) instead of through createCharacter/updateCharacter,
// to isolate the RPC's own preserve/replace/remove contract from the service
// layer's item resolution and normalization. The service's forwarding of
// enchantment/mods into p_gear is covered separately, through
// createCharacter/updateCharacter, further below. p_character: {} keeps
// every stored character field as-is; p_abilities/p_perks: null skip those
// blocks entirely, leaving abilities and perks untouched.
const rpcSaveGear = async (characterId, gear) => {
  const { data, error } = await supabaseAdmin.rpc('save_character_atomic', {
    p_character_id: characterId,
    p_creator_id: profile.id,
    p_character: {},
    p_traits: [],
    p_gear: gear,
    p_abilities: null,
    p_perks: null
  });
  if (error) throw error;
  return data;
};

// Drives save_character_atomic directly, the same way rpcSaveGear and the
// ownership-check test above do: the RPC is the unit under test here. The
// service-layer wiring that forwards aspiring_signatures into it
// (services/character/service.js's createCharacter and updateCharacter) is
// covered separately, by services/character/service.test.js.
const saveAtomic = async ({ characterId, character, gear = [], abilities = [], traits = [], perks = [] }) => {
  const { data, error } = await supabaseAdmin.rpc('save_character_atomic', {
    p_character_id: characterId,
    p_creator_id: profile.id,
    p_character: character,
    p_traits: traits,
    p_gear: gear,
    p_abilities: abilities,
    p_perks: perks
  });
  if (error) throw error;
  return data;
};

const CLASS_A_ID = '00000000-0000-4000-8000-0000000000a1';
const CLASS_B_ID = '00000000-0000-4000-8000-0000000000b1';
const CLASS_C_ID = '00000000-0000-4000-8000-0000000000c1';

// A minimal valid character row for a direct RPC insert -- the NOT NULL
// columns save_character_atomic's INSERT does not COALESCE (name, class, the
// twelve stats, level, completed_missions, commissary_reward) plus creator_id,
// which for the INSERT branch comes from p_character itself, not p_creator_id.
const baseCharacter = () => ({
  ...stats,
  creator_id: profile.id,
  name: `Atomic Aspiring ${suffix}`,
  class: 'Aspiring',
  creator_mode: 'aspiring',
  class_id: null
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
  // level: 2, not the fixture's 1: this class carries no content_format, so
  // it resolves to the advent economy, which grants 0 Perks at level 1 (pg.
  // 3: the starting Perk is Aspirant's addition). A single Ability Perk costs
  // 1 against the level-2 allotment of 1, which is what creation's ability
  // cap/Perk balance gate (creation must be legal outright) requires.
  const { data: created, error: createError } = await createCharacter({
    ...v2Input(`Atomic perk survival ${suffix}`), level: 2,
    ability_perks: [{ class_ability_id: v2AbilityName, text: 'Survives a resave', position: 0 }]
  }, profile);
  expect(createError).toBeNull();

  const before = await childRows('character_perks', created.id);
  expect(before).toHaveLength(1);
  const [ability] = await childRows('class_abilities', created.id);

  // level: 2 again, for the reason the creation above gives: v2Input carries
  // the fixture's level 1, and the ratchet scores the submission at the level
  // the save will STORE -- a save that demotes this character to level 1 puts
  // its one Perk beyond what level 1 earns, and is refused for it.
  const { error } = await updateCharacter(created.id, {
    ...v2Input(`Atomic perk survived ${suffix}`),
    id: created.id, level: 2,
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

// The atomic path is the one the wizard uses on create. If the RPC drops type,
// every aspiring character is born untagged no matter what the service layer
// sends (services/character/service.js:328-331).
test('save_character_atomic persists and updates the ability type', async () => {
  await setup();
  // level: 3, not the fixture's 1: this class carries no content_format, so
  // it resolves to the advent economy, which grants 0 Perks at level 1 (pg.
  // 3: the starting Perk is Aspirant's addition). An own-class Advanced
  // Ability costs 2 against the level-3 allotment of 2, which is what
  // creation's ability cap/Perk balance gate (creation must be legal
  // outright) requires.
  const { data: created } = await createCharacter({
    ...input(`Atomic Typed ${suffix}`), level: 3,
    abilities: [{ name: 'Atomic Ability', class_id: characterClass.id, type: 'advanced' }]
  }, profile);
  const first = await childRows('class_abilities', created.id);
  expect(first[0].type).toBe('advanced');

  await updateCharacter(created.id, {
    ...input(`Atomic Typed ${suffix}`),
    abilities: [{ name: 'Atomic Ability', class_id: characterClass.id, type: 'core' }]
  }, profile);
  const second = await childRows('class_abilities', created.id);

  // The id must survive the retag: character_perks.class_ability_id is
  // ON DELETE CASCADE, so a delete-and-reinsert would destroy the perks.
  expect(second[0].id).toBe(first[0].id);
  expect(second[0].type).toBe('core');
});

// The edit form submits abilities with no type at all, so an absent type is not
// an instruction to make the ability core -- it means "leave the tag alone".
// Only a brand-new ability with no submitted type may default to 'core'.
test('re-saving an ability without a type keeps its stored type and row id', async () => {
  await setup();
  // level: 3 -- see the same-shaped comment on the previous test.
  const { data: created } = await createCharacter({
    ...input(`Atomic Untyped ${suffix}`), level: 3,
    abilities: [{ name: 'Atomic Ability', class_id: characterClass.id, type: 'advanced' }]
  }, profile);
  const first = await childRows('class_abilities', created.id);
  expect(first[0].type).toBe('advanced');

  await updateCharacter(created.id, {
    ...input(`Atomic Untyped ${suffix}`),
    abilities: [{ name: 'Atomic Ability', class_id: characterClass.id }]
  }, profile);
  const second = await childRows('class_abilities', created.id);

  expect(second[0].type).toBe('advanced');
  expect(second[0].id).toBe(first[0].id);
});

// The edit form submits gear as bare "Class::Item" strings with no
// equipment fields at all -- an absent enchantment/mods key must mean "leave
// the stored value alone", never "reset to unenchanted", or a resave through
// that form silently spends the player's Merx for them.
test('a gear row keeps its Enchantment and Mods across a save that omits them', async () => {
  await setup();
  const { data: created, error: createError } = await createCharacter(
    input(`Atomic gear enchant keep ${suffix}`), profile
  );
  expect(createError).toBeNull();

  await rpcSaveGear(created.id, [{
    name: GEAR_NAME, class_id: characterClass.id,
    enchantment: { source: 'custom', name: 'Sorcerer’s Apprentice', description: 'Boosts an ally.' },
    mods: [{ name: 'Lined', description: 'Warm.' }]
  }]);
  const before = await gearRows(created.id);
  expect(before).toHaveLength(1);
  expect(before[0].enchantment.source).toBe('custom');
  expect(before[0].mods).toHaveLength(1);

  await rpcSaveGear(created.id, [{ name: GEAR_NAME, class_id: characterClass.id }]);
  const after = await gearRows(created.id);
  expect(after[0].id).toBe(before[0].id);
  expect(after[0].enchantment).toEqual(before[0].enchantment);
  expect(after[0].mods).toEqual(before[0].mods);
});

test('a submitted Enchantment replaces the stored one', async () => {
  await setup();
  const { data: created } = await createCharacter(
    input(`Atomic gear enchant replace ${suffix}`), profile
  );
  await rpcSaveGear(created.id, [{ name: GEAR_NAME, class_id: characterClass.id, enchantment: { source: 'default' } }]);
  await rpcSaveGear(created.id, [{
    name: GEAR_NAME, class_id: characterClass.id,
    enchantment: { source: 'custom', name: 'Ported', description: 'Retooled.' }
  }]);
  const rows = await gearRows(created.id);
  expect(rows[0].enchantment.source).toBe('custom');
  expect(rows[0].enchantment.name).toBe('Ported');
});

// Reconciliation keys on class_id + name, so a rename is a delete plus an
// insert. The new Signature is a different purchase and starts unenchanted.
test('a renamed Signature does not carry its Enchantment to the new name', async () => {
  await setup();
  const { data: created } = await createCharacter(
    input(`Atomic gear enchant rename ${suffix}`), profile
  );
  await rpcSaveGear(created.id, [{ name: GEAR_NAME, class_id: characterClass.id, enchantment: { source: 'default' } }]);
  await rpcSaveGear(created.id, [{ name: OTHER_GEAR_NAME, class_id: characterClass.id }]);
  const rows = await gearRows(created.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe(OTHER_GEAR_NAME);
  expect(rows[0].enchantment).toBeNull();
});

// The RPC's preserve/replace/remove contract, pinned directly above, only
// protects a player's Merx if CharacterService actually forwards a gear
// item's Enchantment and Mods into p_gear. It used to build that payload as
// { name, class_id, description } only, silently dropping both fields before
// the RPC ever saw them (services/character/service.js's saveCharacterAtomic).
test('createCharacter forwards a gear item\'s Enchantment and Mods to the stored row', async () => {
  await setup();
  const { data: created, error } = await createCharacter({
    ...input(`Atomic service enchant ${suffix}`),
    gear: [{
      name: GEAR_NAME, class_id: characterClass.id,
      enchantment: { source: 'custom', name: 'Service Ported', description: 'Through the service.' },
      mods: [{ name: 'Reinforced', description: 'Tougher.' }]
    }]
  }, profile);
  expect(error).toBeNull();

  const rows = await gearRows(created.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].enchantment).toEqual({ source: 'custom', name: 'Service Ported', description: 'Through the service.' });
  expect(rows[0].mods).toEqual([{ name: 'Reinforced', description: 'Tougher.' }]);
});

// The edit form submits gear as bare "Class::Item" strings with no equipment
// fields at all -- the case that would actually cost a player Merx if
// CharacterService defaulted an absent key to null instead of omitting it.
test('updateCharacter through the edit form\'s bare gear string preserves a stored Enchantment and Mods', async () => {
  await setup();
  const { data: created } = await createCharacter({
    ...input(`Atomic service enchant keep ${suffix}`),
    gear: [{
      name: GEAR_NAME, class_id: characterClass.id,
      enchantment: { source: 'custom', name: 'Kept Enchant', description: 'Should survive.' },
      mods: [{ name: 'Kept Mod', description: 'Also survives.' }]
    }]
  }, profile);
  const before = await gearRows(created.id);
  expect(before[0].enchantment.name).toBe('Kept Enchant');

  const { error } = await updateCharacter(created.id, {
    ...input(`Atomic service enchant kept ${suffix}`),
    id: created.id,
    gear: [`${characterClass.name}::${GEAR_NAME}`]
  }, profile);
  expect(error).toBeFalsy();

  const after = await gearRows(created.id);
  expect(after[0].id).toBe(before[0].id);
  expect(after[0].enchantment).toEqual(before[0].enchantment);
  expect(after[0].mods).toEqual(before[0].mods);
});

// The pool is written on create and survives an update that never mentions
// it -- the shape every edit-form save has, since that form does not submit
// the field. jsonb_populate_record(saved, p_character) is what makes an
// absent key mean "keep stored".
test('save_character_atomic writes the aspiring pool and preserves it on update', async () => {
  await setup();
  const pool = [
    { class_id: CLASS_A_ID, name: 'A' },
    { class_id: CLASS_B_ID, name: 'B' },
    { class_id: CLASS_C_ID, name: 'C' }
  ];
  const created = await saveAtomic({
    characterId: null,
    character: { ...baseCharacter(), aspiring_signatures: pool }
  });
  expect(created.aspiring_signatures).toEqual(pool);

  const updated = await saveAtomic({
    characterId: created.id,
    character: {}
  });
  expect(updated.aspiring_signatures).toEqual(pool);
});

// The CHECK constraint's creator_mode clause is what stops a class_id'd
// character from also carrying a pool, so a save attempting both must fail
// at the database, not merely be ignored by application code. Matching on
// the constraint's own name (rather than a bare .rejects.toThrow()) is what
// stops an unrelated NOT NULL regression from passing this test for the
// wrong reason.
test('a non-aspiring character cannot carry a pool', async () => {
  await setup();
  await expect(saveAtomic({
    characterId: null,
    character: {
      ...baseCharacter(),
      creator_mode: 'advent',
      aspiring_signatures: [{ class_id: CLASS_A_ID, name: 'A' }]
    }
  })).rejects.toThrow(/characters_aspiring_signatures_check/);
});

// creator_mode = 'aspiring' OR ... reads as NULL, not FALSE, when
// creator_mode IS NULL -- and Postgres satisfies a CHECK on NULL as well as
// on TRUE. IS NOT DISTINCT FROM is what closes that: a NULL creator_mode
// must be rejected exactly like any other non-'aspiring' value.
test('a NULL creator_mode character cannot carry a pool', async () => {
  await setup();
  await expect(saveAtomic({
    characterId: null,
    character: {
      ...baseCharacter(),
      creator_mode: null,
      aspiring_signatures: [{ class_id: CLASS_A_ID, name: 'A' }]
    }
  })).rejects.toThrow(/characters_aspiring_signatures_check/);
});

// aspiring_abilities guards the same way aspiring_signatures does: a
// non-string class_id must fail at the database via the type() guard in the
// CHECK's jsonpath predicate, not merely be filtered out by application code.
// Matching on the constraint's own name is what stops an unrelated NOT NULL
// regression from passing this test for the wrong reason.
//
// This goes through a direct table insert rather than saveAtomic: unlike
// aspiring_signatures, save_character_atomic does not forward aspiring_abilities
// yet, so an insert through the RPC would silently keep the column's default
// and never exercise the CHECK.
const insertWithAspiringAbilities = async (pool) => {
  const { data, error } = await supabaseAdmin.from('characters')
    .insert({ ...baseCharacter(), aspiring_abilities: pool })
    .select()
    .single();
  if (error) throw error;
  return data;
};

test('an aspiring_abilities entry with a non-string class_id is rejected', async () => {
  await setup();
  await expect(insertWithAspiringAbilities([{ class_id: 123, name: 'X', type: 'core' }]))
    .rejects.toThrow(/characters_aspiring_abilities_check/);
});

// A class that becomes v2 does not convert its characters: their v1-only text
// stays stored, and the only change a v2 save may make to it is clearing it
// (services/character/input.js). Through the whole path -- updateCharacter,
// saveCharacterAtomic, save_character_atomic -- an absent key must keep the
// stored value and a JSON null must write NULL, because the RPC's UPDATE reads
// jsonb_populate_record(saved, p_character) with no COALESCE on either column.
// v2Class carries rules_version 'v2', so the service strips both fields.
const storeDeprecatedFields = async (characterId) => {
  await db.query('update characters set perks = $1, additional_gear = $2 where id = $3',
    ['Old perk prose', 'Old gear prose', characterId]);
};

const deprecatedFields = async (characterId) => {
  const { rows } = await db.query(
    'select perks, additional_gear from characters where id = $1', [characterId]
  );
  return rows[0];
};

test('a v2 save clears a deprecated field only when its clear flag is submitted', async () => {
  await setup();
  const name = `Atomic deprecated clear ${suffix}`;
  const { data: created, error: createError } = await createCharacter(v2Input(name), profile);
  expect(createError).toBeNull();
  await storeDeprecatedFields(created.id);

  const { error } = await updateCharacter(created.id, {
    ...v2Input(name), id: created.id, clear_perks: 'on'
  }, profile);
  expect(error).toBeFalsy();

  expect(await deprecatedFields(created.id))
    .toEqual({ perks: null, additional_gear: 'Old gear prose' });
});

test('a v2 save never writes a submitted deprecated field', async () => {
  await setup();
  const name = `Atomic deprecated keep ${suffix}`;
  const { data: created, error: createError } = await createCharacter(v2Input(name), profile);
  expect(createError).toBeNull();
  await storeDeprecatedFields(created.id);

  const { error } = await updateCharacter(created.id, {
    ...v2Input(name), id: created.id,
    perks: 'Rewritten perk prose', additional_gear: 'Rewritten gear prose'
  }, profile);
  expect(error).toBeFalsy();

  expect(await deprecatedFields(created.id))
    .toEqual({ perks: 'Old perk prose', additional_gear: 'Old gear prose' });
});
