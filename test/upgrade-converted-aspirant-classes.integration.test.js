// Local-Supabase coverage for scripts/upgrade-converted-aspirant-classes.js:
// only Aspirant characters left on a forked Advent class are selected, a dry
// run writes nothing, and --apply is idempotent.
require('../util/require-local-supabase');

const { test, expect, beforeAll, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('../models/_base');
const { statList } = require('../util/enclave-consts');
const { createAuthUserAndProfile } = require('./helpers/auth-user-fixture');
const { upgradeConvertedCharacters } = require('../scripts/upgrade-converted-aspirant-classes');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});
const STATS = Object.fromEntries(statList.map(stat => [stat, 1]));
const TRAITS = [{ name: 'Brave', stat: 'might' }, { name: 'Clever', stat: 'intelligence' }, { name: 'Lucky', stat: 'luck' }];

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

const createAspirantCharacter = async ({ cls, name, gear, abilities, perks }) => {
  const { data, error } = await supabaseAdmin.rpc('save_character_atomic', {
    p_character_id: null,
    p_creator_id: profile.id,
    p_character: {
      ...STATS, creator_id: profile.id, name, class: cls.name, class_id: cls.id,
      creator_mode: 'aspirant', level: 1, completed_missions: 0, commissary_reward: 0
    },
    p_traits: TRAITS,
    p_gear: gear,
    p_abilities: abilities,
    p_perks: perks
  });
  if (error) throw error;
  return data.id;
};

const snapshot = async () => {
  const ids = Object.values(characters);
  const query = async (sql) => (await db.query(sql, [ids])).rows;
  return {
    characters: await query('select id, class_id, class, creator_mode, updated_at from characters where id = any($1) order by id'),
    gear: await query('select id, class_id, name from class_gear where character_id = any($1) order by id'),
    abilities: await query('select id, class_id, name, type from class_abilities where character_id = any($1) order by id'),
    perks: await query('select id, class_ability_id, text from character_perks where character_id = any($1) order by id')
  };
};

const run = (apply) => upgradeConvertedCharacters({ apply, characterIds: Object.values(characters), log: () => {} });

beforeAll(async () => {
  await db.connect();
  ({ authUserId, profile } = await createAuthUserAndProfile(db, {
    email: `upgrade-converted-${suffix}@example.test`, profileName: `Upgrade ${suffix}`
  }));
  classes.legacy = await insertClass({
    name: `Up Gunslinger ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v2',
    gear: [{ name: 'Revolver' }, { name: 'Duster' }], abilities: [{ name: 'Trickshot' }]
  });
  classes.fork = await insertClass({
    name: `Up Gunslinger ${suffix}`, rules_edition: 'aspirant', content_format: 'aspirant', rules_version: 'v2',
    base_class_id: classes.legacy.id, gear: [{ name: 'Revolver' }], abilities: [{ name: 'Trickshot' }]
  });
  classes.loner = await insertClass({
    name: `Up Loner ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v2',
    gear: [{ name: 'Bedroll' }], abilities: []
  });

  // Converted before conversion upgraded the class.
  characters.converted = await createAspirantCharacter({
    cls: classes.legacy, name: `Converted ${suffix}`,
    gear: [{ name: 'Revolver', class_id: classes.legacy.id }, { name: 'Duster', class_id: classes.legacy.id }],
    abilities: [{ name: 'Trickshot', class_id: classes.legacy.id, type: 'core' }],
    perks: [
      { ability_name: 'Trickshot', text: 'Off the wall.', position: 0 },
      { ability_name: 'Trickshot', text: 'And again.', position: 1, compounds_with: 'position-0' }
    ]
  });
  // Created on the Aspirant version and bought an Advent Revolver: a choice.
  characters.chosen = await createAspirantCharacter({
    cls: classes.fork, name: `Chosen ${suffix}`,
    gear: [{ name: 'Revolver', class_id: classes.legacy.id }], abilities: [], perks: []
  });
  // An Aspirant character on an Advent class with no Aspirant version.
  characters.loner = await createAspirantCharacter({
    cls: classes.loner, name: `Loner ${suffix}`,
    gear: [{ name: 'Bedroll', class_id: classes.loner.id }], abilities: [], perks: []
  });
});

afterAll(async () => {
  if (profile?.id) await db.query('delete from characters where creator_id = $1', [profile.id]);
  if (profile?.id) await db.query('delete from profiles where id = $1', [profile.id]);
  for (const key of ['fork', 'legacy', 'loner']) {
    if (classes[key]?.id) await db.query('delete from classes where id = $1', [classes[key].id]);
  }
  if (authUserId) await db.query('delete from auth.users where id = $1', [authUserId]);
  await db.end();
});

test('the dry run lists only the converted character on a forked Advent class and writes nothing', async () => {
  const before = await snapshot();
  const report = await run(false);
  expect(report.candidates.map(candidate => candidate.id)).toEqual([characters.converted]);
  expect(report.candidates[0]).toMatchObject({
    name: `Converted ${suffix}`, owner: `Upgrade ${suffix}`, fromClass: classes.legacy.name, toClass: classes.fork.name
  });
  expect(report.candidates[0].moved.map(item => item.name).sort()).toEqual(['Revolver', 'Trickshot']);
  expect(report.candidates[0].kept.map(item => item.name)).toEqual(['Duster']);
  expect(report.applied).toEqual([]);
  expect(await snapshot()).toEqual(before);
});

let untouchedBefore;

test('--apply moves the class and matching rows, and a second run finds nothing', async () => {
  untouchedBefore = await snapshot();
  const report = await run(true);
  expect(report).toMatchObject({ applied: [characters.converted], failed: [] });

  const { rows: [row] } = await db.query('select class_id, creator_mode from characters where id = $1', [characters.converted]);
  expect(row).toEqual({ class_id: classes.fork.id, creator_mode: 'aspirant' });
  const { rows: gear } = await db.query(
    'select name, class_id from class_gear where character_id = $1 order by name', [characters.converted]
  );
  expect(gear).toEqual([
    { name: 'Duster', class_id: classes.legacy.id },
    { name: 'Revolver', class_id: classes.fork.id }
  ]);
  const { rows: perks } = await db.query(
    `select p.text, a.name, a.class_id from character_perks p join class_abilities a on a.id = p.class_ability_id
     where p.character_id = $1`, [characters.converted]
  );
  expect(perks.sort((a, b) => a.text.localeCompare(b.text))).toEqual([
    { text: 'And again.', name: 'Trickshot', class_id: classes.fork.id },
    { text: 'Off the wall.', name: 'Trickshot', class_id: classes.fork.id }
  ]);
  const { rows: links } = await db.query(
    `select p.text, t.text as target from character_perks p join character_perks t on t.id = p.compounds_with
     where p.character_id = $1`, [characters.converted]
  );
  expect(links).toEqual([{ text: 'And again.', target: 'Off the wall.' }]);

  const after = await snapshot();
  const untouched = (rows) => rows.filter(row => [characters.chosen, characters.loner].includes(row.id));
  expect(untouched(after.characters)).toEqual(untouched(untouchedBefore.characters));
  expect(after.gear.filter(row => row.name === 'Revolver' && row.class_id === classes.legacy.id)).toHaveLength(1);

  expect((await run(false)).candidates).toEqual([]);
});
