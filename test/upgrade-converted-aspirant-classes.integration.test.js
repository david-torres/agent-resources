// Local-Supabase coverage for scripts/upgrade-converted-aspirant-classes.js:
// only Aspirant characters left on a forked Advent class are selected, a dry
// run writes nothing, and --apply is idempotent.
require('../util/require-local-supabase');

const { test, expect, beforeAll, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('../models/_base');
const { statList } = require('../util/enclave-consts');
const { createAuthUserAndProfile } = require('./helpers/auth-user-fixture');
const characterRepository = require('../services/character/repository');
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
    gear: [{ name: 'Revolver' }, { name: 'Duster' }], abilities: [{ name: 'Trickshot' }, { name: 'Shootout' }]
  });
  classes.fork = await insertClass({
    name: `Up Gunslinger ${suffix}`, rules_edition: 'aspirant', content_format: 'aspirant', rules_version: 'v2',
    base_class_id: classes.legacy.id, gear: [{ name: 'Revolver' }], abilities: [{ name: 'Trickshot' }]
  });
  classes.loner = await insertClass({
    name: `Up Loner ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v2',
    gear: [{ name: 'Bedroll' }], abilities: [{ name: 'Campfire' }]
  });
  await db.query('insert into class_unlocks (user_id, class_id) values ($1, $2)', [authUserId, classes.fork.id]);

  // Converted before conversion upgraded the class. Perk positions are
  // numbered per Ability, so the kept Campfire and Shootout and the moving
  // Trickshot all use 0 and 1.
  characters.converted = await createAspirantCharacter({
    cls: classes.legacy, name: `Converted ${suffix}`,
    gear: [{ name: 'Revolver', class_id: classes.legacy.id }, { name: 'Duster', class_id: classes.legacy.id }],
    abilities: [
      { name: 'Campfire', class_id: classes.loner.id, type: 'core' },
      { name: 'Shootout', class_id: classes.legacy.id, type: 'core' },
      { name: 'Trickshot', class_id: classes.legacy.id, type: 'core' }
    ],
    perks: [
      { ability_name: 'Campfire', text: 'Warm hands.', position: 0 },
      { ability_name: 'Campfire', text: 'Warm hearts.', position: 1 },
      { ability_name: 'Shootout', text: 'Steady hands.', position: 0 },
      { ability_name: 'Shootout', text: 'Steadier still.', position: 1, compounds_with: 'position-0' },
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
  if (authUserId) await db.query('delete from class_unlocks where user_id = $1', [authUserId]);
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
  expect(report.candidates[0].kept.map(item => item.name).sort()).toEqual(['Campfire', 'Duster', 'Shootout']);
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
    `select a.name as ability, a.class_id, p.position, p.text, ta.name as target_ability, t.text as target
     from character_perks p
     join class_abilities a on a.id = p.class_ability_id
     left join character_perks t on t.id = p.compounds_with
     left join class_abilities ta on ta.id = t.class_ability_id
     where p.character_id = $1
     order by a.name, p.position`, [characters.converted]
  );
  expect(perks).toEqual([
    { ability: 'Campfire', class_id: classes.loner.id, position: 0, text: 'Warm hands.', target_ability: null, target: null },
    { ability: 'Campfire', class_id: classes.loner.id, position: 1, text: 'Warm hearts.', target_ability: null, target: null },
    { ability: 'Shootout', class_id: classes.legacy.id, position: 0, text: 'Steady hands.', target_ability: null, target: null },
    { ability: 'Shootout', class_id: classes.legacy.id, position: 1, text: 'Steadier still.', target_ability: 'Shootout', target: 'Steady hands.' },
    { ability: 'Trickshot', class_id: classes.fork.id, position: 0, text: 'Off the wall.', target_ability: null, target: null },
    { ability: 'Trickshot', class_id: classes.fork.id, position: 1, text: 'And again.', target_ability: 'Trickshot', target: 'Off the wall.' }
  ]);

  const after = await snapshot();
  const untouched = (rows) => rows.filter(row => [characters.chosen, characters.loner].includes(row.id));
  expect(untouched(after.characters)).toEqual(untouched(untouchedBefore.characters));
  expect(after.gear.filter(row => row.name === 'Revolver' && row.class_id === classes.legacy.id)).toHaveLength(1);

  expect((await run(false)).candidates).toEqual([]);
});

test('a character whose save throws is recorded as failed and the run continues', async () => {
  const legacyCharacter = (name) => createAspirantCharacter({
    cls: classes.legacy, name, gear: [{ name: 'Revolver', class_id: classes.legacy.id }], abilities: [], perks: []
  });
  const throwing = await legacyCharacter(`Throwing ${suffix}`);
  const saving = await legacyCharacter(`Saving ${suffix}`);
  const save = characterRepository.saveCharacterAtomic;
  characterRepository.saveCharacterAtomic = (args) => {
    if (args.characterId === throwing) throw new Error('connection reset');
    return save(args);
  };
  const lines = [];
  try {
    const report = await upgradeConvertedCharacters({ apply: true, characterIds: [throwing, saving], log: line => lines.push(line) });
    expect(report.failed).toEqual([{ id: throwing, error: 'connection reset' }]);
    expect(report.applied).toEqual([saving]);
  } finally {
    characterRepository.saveCharacterAtomic = save;
  }
  expect(lines.at(-1)).toBe('2 converted characters on a forked Advent class. 1 upgraded, 1 failed.');
});
