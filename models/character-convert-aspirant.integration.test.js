// Local-Supabase integration coverage for Convert to Aspirant: conversion
// switches only the character's mode through save_character_atomic, and the
// Aspirant rules then apply to the same class and the same build.
require('../util/require-local-supabase');

const { test, expect, beforeAll, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('./_base');
const { convertCharacterToAspirant, updateCharacter } = require('./character');
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
// The follow-up edit changes all three: a class on v1 would have them stripped
// from the submission, leaving the stored values in place, so resubmitting
// them unchanged could not tell the difference.
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

const createAdventCharacter = async ({ name, level, quirks, accessories, gear, abilities, perks }) => {
  const { data, error } = await supabaseAdmin.rpc('save_character_atomic', {
    p_character_id: null,
    p_creator_id: profile.id,
    p_character: {
      ...STATS,
      creator_id: profile.id, name,
      class: classes.gunslinger.name, class_id: classes.gunslinger.id, creator_mode: null,
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

const gearCount = async (id) => (await db.query(
  'select count(*)::int as count from class_gear where character_id = $1', [id]
)).rows[0].count;

beforeAll(async () => {
  await db.connect();
  ({ authUserId, profile } = await createAuthUserAndProfile(db, { email, profileName: `Convert ${suffix}` }));

  const gunslingerContent = {
    gear: [{ name: 'Revolver' }, { name: 'Duster' }],
    abilities: [{ name: 'Trickshot' }, { name: 'Standoff' }, { name: 'Shootout' }]
  };
  classes.gunslinger = await insertClass({
    name: `Conv Gunslinger ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v1',
    ...gunslingerContent
  });
  // The class's Aspirant fork exists, and conversion must leave the character
  // on its own class all the same.
  classes.gunslingerFork = await insertClass({
    name: `Conv Gunslinger ${suffix}`, rules_edition: 'aspirant', content_format: 'aspirant', rules_version: 'v2',
    base_class_id: classes.gunslinger.id, ...gunslingerContent
  });
  classes.wanderer = await insertClass({
    name: `Conv Wanderer ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v1',
    gear: [{ name: 'Satchel' }], abilities: [{ name: 'Familiar Face' }]
  });

  // An Advent Gunslinger on the v1 rules at level 4, carrying two Revolvers,
  // Wanderer's Satchel and Familiar Face, four Ability Perks (one a compound),
  // a Defining Quirk and Accessories.
  characters.caroline = await createAdventCharacter({
    name: `Convert ${suffix}`, level: 4, quirks: QUIRKS, accessories: ACCESSORIES,
    gear: [
      { name: 'Revolver', class_id: classes.gunslinger.id },
      { name: 'Revolver', class_id: classes.gunslinger.id },
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
      { ability_name: 'Familiar Face', text: 'Known in every town.', position: 3 }
    ]
  });

  // Thirteen Signatures: more than an Aspirant character may bring on a mission.
  characters.hoarder = await createAdventCharacter({
    name: `Hoarder ${suffix}`, level: 1, quirks: [], accessories: [],
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
  for (const key of ['gunslingerFork', 'gunslinger', 'wanderer']) {
    if (classes[key]?.id) await db.query('delete from classes where id = $1', [classes[key].id]);
  }
  if (authUserId) await db.query('delete from auth.users where id = $1', [authUserId]);
  await db.end();
});

test('conversion switches the mode and leaves the class and every row as they were', async () => {
  const id = characters.caroline;
  const rowsBefore = await storedRows(id);
  const before = await characterRow(id);
  expect(rowsBefore.perks.filter(perk => perk.compounds_with)).toHaveLength(1);

  const { data, error } = await convertCharacterToAspirant({ profileId: profile.id }, id);
  expect(error).toBeNull();
  expect(data.creator_mode).toBe('aspirant');

  const after = await characterRow(id);
  expect(after).toEqual({ ...before, creator_mode: 'aspirant', updated_at: after.updated_at });
  expect(after.class_id).toBe(classes.gunslinger.id);
  expect(await storedRows(id)).toEqual(rowsBefore);
  const byName = (a, b) => a.name.localeCompare(b.name);
  expect(rowsBefore.traits.map(({ name, stat }) => ({ name, stat })).sort(byName)).toEqual([...TRAITS].sort(byName));
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

test('an ordinary edit on the Advent v1 class saves the Quirk, Accessories and Ability Perks', async () => {
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
    .toEqual({ class_id: classes.gunslinger.id, creator_mode: 'aspirant', quirks: EDITED_QUIRKS, accessories: EDITED_ACCESSORIES });
  const { rows: texts } = await db.query(
    'select text from character_perks where character_id = $1 order by position', [id]
  );
  expect(texts.map(perk => perk.text)).toEqual([EDITED_PERK, 'Stare them down.', 'Twice as long.', 'Known in every town.']);
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
