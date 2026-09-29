// Local-Supabase integration coverage for Convert to Aspirant: the character,
// and every row with an Aspirant version, move onto it through
// save_character_atomic; everything else stays as it was.
require('../util/require-local-supabase');

const { test, expect, beforeAll, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('./_base');
const { convertCharacterToAspirant, planCharacterAspirantConversion, updateCharacter } = require('./character');
const { statList } = require('../util/enclave-consts');
const { createAuthUserAndProfile } = require('../test/helpers/auth-user-fixture');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `convert-aspirant-${suffix}@example.test`;
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});

const STATS = Object.fromEntries(statList.map(stat => [stat, 1]));
const TRAITS = [{ name: 'Brave', stat: 'might' }, { name: 'Clever', stat: 'intelligence' }, { name: 'Lucky', stat: 'luck' }];
const TRAIT_FIELDS = {
  trait0: 'Brave', trait0_stat: 'might',
  trait1: 'Clever', trait1_stat: 'intelligence',
  trait2: 'Lucky', trait2_stat: 'luck'
};
const QUIRKS = [{ name: 'Night Owl', downside: 'Sleeps through mornings.', upside: 'Sees in the dark.' }];
const ACCESSORIES = [{ name: 'Pocket Watch' }];
const ENCHANTMENT = { source: 'custom', name: 'Quick Draw', description: 'Draws first.' };
const MODS = [{ name: 'Scope', description: 'Sees far.' }];
const EDITED_QUIRKS = [{ name: 'Night Owl', downside: 'Sleeps through noon.', upside: 'Sees in the dark.' }];
const EDITED_ACCESSORIES = [{ name: 'Pocket Watch' }, { name: 'Lucky Coin' }];
const EDITED_PERK = 'Off every wall.';

let authUserId;
let profile;
const classes = {};
const characters = {};

const insertClass = async (row) => {
  const { data, error } = await supabaseAdmin.from('classes')
    .insert({ is_public: true, advanced_abilities: [], ...row })
    .select()
    .single();
  if (error) throw error;
  return data;
};

const createAdventCharacter = async ({ cls, name, level, quirks = [], accessories = [], gear, abilities, perks }) => {
  const { data, error } = await supabaseAdmin.rpc('save_character_atomic', {
    p_character_id: null,
    p_creator_id: profile.id,
    p_character: {
      ...STATS,
      creator_id: profile.id, name,
      class: cls.name, class_id: cls.id, creator_mode: null,
      level, completed_missions: 0, commissary_reward: 0, quirks, accessories
    },
    p_traits: TRAITS,
    p_gear: gear,
    p_abilities: abilities,
    p_perks: perks
  });
  if (error) throw error;
  return data.id;
};

const characterRow = async (id) => (await db.query(
  'select class_id, class, creator_mode, level, quirks, accessories, perks, updated_at from characters where id = $1', [id]
)).rows[0];

const storedRows = async (id) => {
  const query = async (sql) => (await db.query(sql, [id])).rows;
  return {
    gear: await query('select id, class_id, name, description, enchantment, mods from class_gear where character_id = $1 order by id'),
    abilities: await query('select id, class_id, name, type, description from class_abilities where character_id = $1 order by id'),
    perks: await query('select id, class_ability_id, text, position, compounds_with from character_perks where character_id = $1 order by id'),
    traits: await query('select id, name, stat from traits where character_id = $1 order by id')
  };
};

const perksByPosition = async (id) => (await db.query(
  `select p.text, p.position, a.name as ability, target.text as compounds_with_text
   from character_perks p
   join class_abilities a on a.id = p.class_ability_id
   left join character_perks target on target.id = p.compounds_with
   where p.character_id = $1
   order by p.position`,
  [id]
)).rows;

const gearCount = async (id) => (await db.query(
  'select count(*)::int as count from class_gear where character_id = $1', [id]
)).rows[0].count;

beforeAll(async () => {
  await db.connect();
  ({ authUserId, profile } = await createAuthUserAndProfile(db, { email, profileName: `Convert ${suffix}` }));

  classes.gunslinger = await insertClass({
    name: `Conv Gunslinger ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v1',
    gear: [{ name: 'Revolver' }, { name: 'Duster' }],
    abilities: [{ name: 'Trickshot' }, { name: 'Standoff' }, { name: 'Shootout' }]
  });
  classes.gunslingerFork = await insertClass({
    name: `Conv Gunslinger ${suffix}`, rules_edition: 'aspirant', content_format: 'aspirant', rules_version: 'v2',
    base_class_id: classes.gunslinger.id,
    gear: [{ name: 'Revolver', description: 'Aspirant six-shooter.' }],
    abilities: [{ name: 'Trickshot', description: 'Aspirant trick.' }],
    advanced_abilities: [{ name: 'Standoff' }]
  });
  classes.wanderer = await insertClass({
    name: `Conv Wanderer ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v1',
    gear: [{ name: 'Satchel' }], abilities: [{ name: 'Familiar Face' }]
  });
  classes.wandererFork = await insertClass({
    name: `Conv Wanderer ${suffix}`, rules_edition: 'aspirant', content_format: 'aspirant', rules_version: 'v2',
    base_class_id: classes.wanderer.id, abilities: [{ name: 'Familiar Face' }]
  });
  classes.drifter = await insertClass({
    name: `Conv Drifter ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v2',
    gear: [{ name: 'Bedroll' }], abilities: [{ name: 'Wayfinding' }]
  });

  // An Advent Gunslinger at level 4: two Revolvers (one enchanted and
  // modded), a Duster and Wanderer's Satchel; three Gunslinger Abilities and
  // Wanderer's Familiar Face; five Ability Perks, one a compound.
  characters.caroline = await createAdventCharacter({
    cls: classes.gunslinger, name: `Convert ${suffix}`, level: 4, quirks: QUIRKS, accessories: ACCESSORIES,
    gear: [
      { name: 'Revolver', class_id: classes.gunslinger.id, enchantment: ENCHANTMENT, mods: MODS },
      { name: 'Revolver', class_id: classes.gunslinger.id },
      { name: 'Duster', class_id: classes.gunslinger.id },
      { name: 'Satchel', class_id: classes.wanderer.id }
    ],
    abilities: [
      { name: 'Trickshot', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Standoff', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Shootout', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Familiar Face', class_id: classes.wanderer.id, type: 'core' }
    ],
    perks: [
      { ability_name: 'Trickshot', text: 'Off the wall.', position: 0 },
      { ability_name: 'Standoff', text: 'Stare them down.', position: 1 },
      { ability_name: 'Standoff', text: 'Twice as long.', position: 2, compounds_with: 'position-1' },
      { ability_name: 'Familiar Face', text: 'Known in every town.', position: 3 },
      { ability_name: 'Shootout', text: 'Steady hands.', position: 4 }
    ]
  });

  // A class with no Aspirant version, carrying only its own items.
  characters.nomad = await createAdventCharacter({
    cls: classes.drifter, name: `Nomad ${suffix}`, level: 2,
    gear: [{ name: 'Bedroll', class_id: classes.drifter.id }],
    abilities: [{ name: 'Wayfinding', class_id: classes.drifter.id, type: 'core' }],
    perks: [{ ability_name: 'Wayfinding', text: 'Never lost.', position: 0 }]
  });

  // Perk positions are numbered per Ability: Drifter's Wayfinding and the
  // kept Shootout (whose second Perk compounds its first) both use 0 and 1,
  // and so does the moving Trickshot.
  characters.sharer = await createAdventCharacter({
    cls: classes.gunslinger, name: `Sharer ${suffix}`, level: 4,
    gear: [],
    abilities: [
      { name: 'Wayfinding', class_id: classes.drifter.id, type: 'core' },
      { name: 'Shootout', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Trickshot', class_id: classes.gunslinger.id, type: 'core' }
    ],
    perks: [
      { ability_name: 'Wayfinding', text: 'Never lost.', position: 0 },
      { ability_name: 'Wayfinding', text: 'Always found.', position: 1 },
      { ability_name: 'Shootout', text: 'Steady hands.', position: 0 },
      { ability_name: 'Shootout', text: 'Steadier still.', position: 1, compounds_with: 'position-0' },
      { ability_name: 'Trickshot', text: 'Off the wall.', position: 0 },
      { ability_name: 'Trickshot', text: 'Off the ceiling.', position: 1 }
    ]
  });

  // Thirteen Signatures: more than an Aspirant character may bring on a mission.
  characters.hoarder = await createAdventCharacter({
    cls: classes.gunslinger, name: `Hoarder ${suffix}`, level: 1,
    gear: Array.from({ length: 13 }, () => ({ name: 'Revolver', class_id: classes.gunslinger.id })),
    abilities: [
      { name: 'Trickshot', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Standoff', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Shootout', class_id: classes.gunslinger.id, type: 'core' }
    ],
    perks: []
  });
});

afterAll(async () => {
  if (profile?.id) await db.query('delete from characters where creator_id = $1', [profile.id]);
  if (profile?.id) await db.query('delete from profiles where id = $1', [profile.id]);
  for (const key of ['gunslingerFork', 'wandererFork', 'gunslinger', 'wanderer', 'drifter']) {
    if (classes[key]?.id) await db.query('delete from classes where id = $1', [classes[key].id]);
  }
  if (authUserId) await db.query('delete from auth.users where id = $1', [authUserId]);
  await db.end();
});

test('the preview names the Aspirant version and what moves to it', async () => {
  const { data, error } = await planCharacterAspirantConversion({ profileId: profile.id }, characters.caroline);
  expect(error).toBeNull();
  expect(data.blockers).toEqual([]);
  expect(data.upgrade.target.id).toBe(classes.gunslingerFork.id);
  expect(data.upgrade.moved.map(item => item.name).sort())
    .toEqual(['Familiar Face', 'Revolver', 'Revolver', 'Standoff', 'Trickshot']);
  expect(data.upgrade.kept.map(item => item.name).sort()).toEqual(['Duster', 'Satchel', 'Shootout']);
});

test('conversion moves the class and every row with an Aspirant version, and keeps the rest', async () => {
  const id = characters.caroline;
  const rowBefore = await characterRow(id);
  const before = await storedRows(id);

  const { data, error } = await convertCharacterToAspirant({ profileId: profile.id }, id);
  expect(error).toBeNull();
  expect(data.class_id).toBe(classes.gunslingerFork.id);

  const rowAfter = await characterRow(id);
  expect(rowAfter).toEqual({
    ...rowBefore,
    class_id: classes.gunslingerFork.id,
    class: classes.gunslingerFork.name,
    creator_mode: 'aspirant',
    updated_at: rowAfter.updated_at
  });

  const after = await storedRows(id);
  const named = (rows, names) => rows.filter(row => names.includes(row.name));
  expect(named(after.gear, ['Duster', 'Satchel'])).toEqual(named(before.gear, ['Duster', 'Satchel']));
  const revolvers = after.gear.filter(row => row.name === 'Revolver').map(({ id: _id, ...row }) => row);
  expect(revolvers).toHaveLength(2);
  expect(revolvers).toContainEqual({
    class_id: classes.gunslingerFork.id, name: 'Revolver', description: 'Aspirant six-shooter.', enchantment: ENCHANTMENT, mods: MODS
  });
  expect(revolvers).toContainEqual({
    class_id: classes.gunslingerFork.id, name: 'Revolver', description: 'Aspirant six-shooter.', enchantment: null, mods: []
  });

  const ability = (name) => after.abilities.find(row => row.name === name);
  expect(ability('Shootout')).toEqual(before.abilities.find(row => row.name === 'Shootout'));
  expect(ability('Trickshot')).toMatchObject({ class_id: classes.gunslingerFork.id, type: 'core', description: 'Aspirant trick.' });
  expect(ability('Standoff')).toMatchObject({ class_id: classes.gunslingerFork.id, type: 'advanced' });
  expect(ability('Familiar Face')).toMatchObject({ class_id: classes.wandererFork.id, type: 'core' });

  expect(await perksByPosition(id)).toEqual([
    { text: 'Off the wall.', position: 0, ability: 'Trickshot', compounds_with_text: null },
    { text: 'Stare them down.', position: 1, ability: 'Standoff', compounds_with_text: null },
    { text: 'Twice as long.', position: 2, ability: 'Standoff', compounds_with_text: 'Stare them down.' },
    { text: 'Known in every town.', position: 3, ability: 'Familiar Face', compounds_with_text: null },
    { text: 'Steady hands.', position: 4, ability: 'Shootout', compounds_with_text: null }
  ]);
  const shootoutPerk = (rows) => rows.perks.find(perk => perk.position === 4).id;
  expect(shootoutPerk(after)).toBe(shootoutPerk(before));
  expect(after.traits).toEqual(before.traits);
});

test('Perks of Abilities sharing positions keep their own Ability and compound through conversion', async () => {
  const id = characters.sharer;
  expect((await convertCharacterToAspirant({ profileId: profile.id }, id)).error).toBeNull();

  const { rows } = await db.query(
    `select a.name as ability, p.position, p.text, ta.name as target_ability, t.text as target
     from character_perks p
     join class_abilities a on a.id = p.class_ability_id
     left join character_perks t on t.id = p.compounds_with
     left join class_abilities ta on ta.id = t.class_ability_id
     where p.character_id = $1
     order by a.name, p.position`,
    [id]
  );
  expect(rows).toEqual([
    { ability: 'Shootout', position: 0, text: 'Steady hands.', target_ability: null, target: null },
    { ability: 'Shootout', position: 1, text: 'Steadier still.', target_ability: 'Shootout', target: 'Steady hands.' },
    { ability: 'Trickshot', position: 0, text: 'Off the wall.', target_ability: null, target: null },
    { ability: 'Trickshot', position: 1, text: 'Off the ceiling.', target_ability: null, target: null },
    { ability: 'Wayfinding', position: 0, text: 'Never lost.', target_ability: null, target: null },
    { ability: 'Wayfinding', position: 1, text: 'Always found.', target_ability: null, target: null }
  ]);
});

test('a class with no Aspirant version keeps its class and every row id', async () => {
  const id = characters.nomad;
  const rowBefore = await characterRow(id);
  const before = await storedRows(id);

  const { error } = await convertCharacterToAspirant({ profileId: profile.id }, id);
  expect(error).toBeNull();

  const rowAfter = await characterRow(id);
  expect(rowAfter).toEqual({ ...rowBefore, creator_mode: 'aspirant', updated_at: rowAfter.updated_at });
  expect(await storedRows(id)).toEqual(before);
});

test('a second conversion is refused and writes nothing', async () => {
  const id = characters.caroline;
  const before = { row: await characterRow(id), rows: await storedRows(id) };
  const result = await convertCharacterToAspirant({ profileId: profile.id }, id);
  expect(result).toEqual({
    data: null,
    error: { status: 400, message: `Convert ${suffix} is not on the Advent rules, so there is nothing to convert.` }
  });
  expect({ row: await characterRow(id), rows: await storedRows(id) }).toEqual(before);
});

test('an ordinary edit of the converted character saves the Quirk, Accessories and Ability Perks', async () => {
  const id = characters.caroline;
  const { rows: perks } = await db.query(
    `select p.class_ability_id, p.text, p.position, target.position as target_position
     from character_perks p left join character_perks target on target.id = p.compounds_with
     where p.character_id = $1 order by p.position`,
    [id]
  );
  const result = await updateCharacter(id, {
    ...STATS,
    ...TRAIT_FIELDS,
    name: `Converted ${suffix}`,
    level: 4,
    quirks: EDITED_QUIRKS,
    accessories: EDITED_ACCESSORIES,
    ability_perks: perks.map((perk, index) => ({
      class_ability_id: perk.class_ability_id,
      text: index === 0 ? EDITED_PERK : perk.text,
      position: perk.position,
      compounds_with: perk.target_position == null ? null : `position-${perk.target_position}`
    }))
  }, { id: profile.id });
  expect(result.error).toBeNull();

  const row = await characterRow(id);
  expect({ class_id: row.class_id, creator_mode: row.creator_mode, quirks: row.quirks, accessories: row.accessories })
    .toEqual({ class_id: classes.gunslingerFork.id, creator_mode: 'aspirant', quirks: EDITED_QUIRKS, accessories: EDITED_ACCESSORIES });
  expect((await perksByPosition(id)).map(perk => perk.text))
    .toEqual([EDITED_PERK, 'Stare them down.', 'Twice as long.', 'Known in every town.', 'Steady hands.']);
});

test('Signatures past what a mission allows convert and keep growing while Merx is not judged', async () => {
  const id = characters.hoarder;
  expect((await convertCharacterToAspirant({ profileId: profile.id }, id)).error).toBeNull();
  expect(await gearCount(id)).toBe(13);

  const result = await updateCharacter(id, {
    ...STATS,
    ...TRAIT_FIELDS,
    name: `Hoarder ${suffix}`,
    level: 1,
    gear: Array.from({ length: 14 }, () => ({ name: 'Revolver', class_id: classes.gunslinger.id }))
  }, { id: profile.id });
  expect(result.error).toBeNull();
  expect(await gearCount(id)).toBe(14);
});
