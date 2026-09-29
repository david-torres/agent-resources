// Local-Supabase integration coverage for Convert to Aspirant: the payload
// CharacterService builds survives save_character_atomic -- rows move to the
// forks, Perks re-attach to their Abilities, and everything conversion does
// not name stays as it was.
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
const QUIRKS = [{ name: 'Night Owl', downside: 'Sleeps through mornings.', upside: 'Sees in the dark.' }];
const ACCESSORIES = [{ name: 'Pocket Watch' }];

let authUserId;
let profile;
let characterId;
const classes = {};

const insertClass = async (row) => {
  const { data, error } = await supabaseAdmin.from('classes')
    .insert({ is_public: true, advanced_abilities: [], ...row })
    .select()
    .single();
  if (error) throw error;
  return data;
};

const perkRows = () => db.query(
  `select p.text, p.position, a.name as ability, a.class_id, target.text as compounds_with_text
   from character_perks p
   join class_abilities a on a.id = p.class_ability_id
   left join character_perks target on target.id = p.compounds_with
   where p.character_id = $1
   order by p.position`,
  [characterId]
);

beforeAll(async () => {
  await db.connect();
  ({ authUserId, profile } = await createAuthUserAndProfile(db, { email, profileName: `Convert ${suffix}` }));

  const gunslingerContent = {
    gear: [{ name: 'Revolver' }, { name: 'Duster' }],
    abilities: [{ name: 'Trickshot' }, { name: 'Standoff' }, { name: 'Shootout' }]
  };
  classes.gunslingerV1 = await insertClass({
    name: `Conv Gunslinger ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v1',
    ...gunslingerContent
  });
  classes.gunslingerV2 = await insertClass({
    name: `Conv Gunslinger ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v2',
    base_class_id: classes.gunslingerV1.id, ...gunslingerContent
  });
  classes.gunslingerFork = await insertClass({
    name: `Conv Gunslinger ${suffix}`, rules_edition: 'aspirant', content_format: 'aspirant', rules_version: 'v2',
    base_class_id: classes.gunslingerV1.id,
    gear: [{ name: 'Revolver', description: 'Aspirant six-shooter.' }, { name: 'Duster' }],
    abilities: [{ name: 'Trickshot' }, { name: 'Standoff' }, { name: 'Shootout' }],
    advanced_abilities: [{ name: 'Last Word' }]
  });
  classes.wandererV1 = await insertClass({
    name: `Conv Wanderer ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v1',
    gear: [{ name: 'Satchel' }], abilities: [{ name: 'Familiar Face' }]
  });
  classes.wandererFork = await insertClass({
    name: `Conv Wanderer ${suffix}`, rules_edition: 'aspirant', content_format: 'aspirant', rules_version: 'v2',
    base_class_id: classes.wandererV1.id,
    gear: [{ name: 'Satchel' }], abilities: [{ name: 'Familiar Face' }]
  });

  // An Advent Gunslinger v2 whose rows sit on the v1 row of its family,
  // carrying two Revolvers and Wanderer's Familiar Face, at level 4.
  const { data: created, error } = await supabaseAdmin.rpc('save_character_atomic', {
    p_character_id: null,
    p_creator_id: profile.id,
    p_character: {
      ...STATS,
      creator_id: profile.id, name: `Convert ${suffix}`,
      class: classes.gunslingerV2.name, class_id: classes.gunslingerV2.id, creator_mode: null,
      level: 4, completed_missions: 0, commissary_reward: 0,
      quirks: QUIRKS, accessories: ACCESSORIES
    },
    p_traits: TRAITS,
    p_gear: [
      { name: 'Revolver', class_id: classes.gunslingerV1.id },
      { name: 'Revolver', class_id: classes.gunslingerV1.id },
      { name: 'Satchel', class_id: classes.wandererV1.id }
    ],
    p_abilities: [
      { name: 'Trickshot', class_id: classes.gunslingerV1.id, type: 'core' },
      { name: 'Standoff', class_id: classes.gunslingerV1.id, type: 'core' },
      { name: 'Shootout', class_id: classes.gunslingerV1.id, type: 'core' },
      { name: 'Familiar Face', class_id: classes.wandererV1.id, type: 'core' }
    ],
    p_perks: [
      { ability_name: 'Trickshot', text: 'Off the wall.', position: 0 },
      { ability_name: 'Standoff', text: 'Stare them down.', position: 1 },
      { ability_name: 'Standoff', text: 'Twice as long.', position: 2, compounds_with: 'position-1' },
      { ability_name: 'Familiar Face', text: 'Known in every town.', position: 3 }
    ]
  });
  if (error) throw error;
  characterId = created.id;

  // A compound whose parent is on a DIFFERENT Ability. Nothing in the app
  // writes one, but nothing in the schema forbids it either.
  await db.query(
    `update character_perks set compounds_with =
       (select id from character_perks where character_id = $1 and position = 0)
     where character_id = $1 and position = 3`,
    [characterId]
  );
});

afterAll(async () => {
  if (profile?.id) await db.query('delete from characters where creator_id = $1', [profile.id]);
  if (profile?.id) await db.query('delete from profiles where id = $1', [profile.id]);
  for (const key of ['gunslingerFork', 'wandererFork', 'gunslingerV2', 'gunslingerV1', 'wandererV1']) {
    if (classes[key]?.id) await db.query('delete from classes where id = $1', [classes[key].id]);
  }
  if (authUserId) await db.query('delete from auth.users where id = $1', [authUserId]);
  await db.end();
});

test('conversion moves the character, its rows and its Perks onto the Aspirant forks', async () => {
  const { data, error } = await convertCharacterToAspirant({ profileId: profile.id }, characterId);
  expect(error).toBeNull();
  expect(data.class_id).toBe(classes.gunslingerFork.id);

  const { rows: [row] } = await db.query(
    'select class_id, class, creator_mode, level, quirks, accessories from characters where id = $1', [characterId]
  );
  expect(row).toEqual({
    class_id: classes.gunslingerFork.id,
    class: classes.gunslingerFork.name,
    creator_mode: 'aspirant',
    level: 4,
    quirks: QUIRKS,
    accessories: ACCESSORIES
  });

  const { rows: gear } = await db.query(
    'select name, class_id, description from class_gear where character_id = $1 order by name, id', [characterId]
  );
  expect(gear).toEqual([
    { name: 'Revolver', class_id: classes.gunslingerFork.id, description: 'Aspirant six-shooter.' },
    { name: 'Revolver', class_id: classes.gunslingerFork.id, description: 'Aspirant six-shooter.' },
    { name: 'Satchel', class_id: classes.wandererFork.id, description: null }
  ]);

  const { rows: abilities } = await db.query(
    'select name, class_id, type from class_abilities where character_id = $1 order by name', [characterId]
  );
  expect(abilities).toEqual([
    { name: 'Familiar Face', class_id: classes.wandererFork.id, type: 'core' },
    { name: 'Shootout', class_id: classes.gunslingerFork.id, type: 'core' },
    { name: 'Standoff', class_id: classes.gunslingerFork.id, type: 'core' },
    { name: 'Trickshot', class_id: classes.gunslingerFork.id, type: 'core' }
  ]);

  const { rows: traits } = await db.query(
    'select name, stat from traits where character_id = $1 order by name', [characterId]
  );
  expect(traits).toEqual(TRAITS);
});

test('every Perk stays on its Ability; a same-Ability compound keeps its link, a cross-Ability one becomes a plain Perk', async () => {
  const { rows } = await perkRows();
  expect(rows.map(({ text, position, ability, compounds_with_text }) => ({ text, position, ability, compounds_with_text }))).toEqual([
    { text: 'Off the wall.', position: 0, ability: 'Trickshot', compounds_with_text: null },
    { text: 'Stare them down.', position: 1, ability: 'Standoff', compounds_with_text: null },
    { text: 'Twice as long.', position: 2, ability: 'Standoff', compounds_with_text: 'Stare them down.' },
    { text: 'Known in every town.', position: 3, ability: 'Familiar Face', compounds_with_text: null }
  ]);
});

test('a second conversion is refused and changes nothing', async () => {
  const result = await convertCharacterToAspirant({ profileId: profile.id }, characterId);
  expect(result.data).toBeNull();
  expect(result.error).toEqual({
    status: 400,
    message: `Convert ${suffix} is not on the Advent rules, so there is nothing to convert.`
  });
  const { rows } = await perkRows();
  expect(rows).toHaveLength(4);
});

test('an ordinary edit of the converted character saves and keeps its v2 fields', async () => {
  const { rows: perks } = await db.query(
    `select p.class_ability_id, p.text, p.position, target.position as target_position
     from character_perks p left join character_perks target on target.id = p.compounds_with
     where p.character_id = $1 order by p.position`,
    [characterId]
  );
  const result = await updateCharacter(characterId, {
    ...STATS,
    name: `Converted ${suffix}`,
    level: 4,
    trait0: 'Brave', trait0_stat: 'might',
    trait1: 'Clever', trait1_stat: 'intelligence',
    trait2: 'Lucky', trait2_stat: 'luck',
    quirks: QUIRKS,
    accessories: ACCESSORIES,
    ability_perks: perks.map(perk => ({
      class_ability_id: perk.class_ability_id,
      text: perk.text,
      position: perk.position,
      compounds_with: perk.target_position == null ? null : `position-${perk.target_position}`
    }))
  }, { id: profile.id });
  expect(result.error).toBeNull();

  const { rows: [row] } = await db.query(
    'select name, creator_mode, class_id, quirks, accessories from characters where id = $1', [characterId]
  );
  expect(row).toEqual({
    name: `Converted ${suffix}`,
    creator_mode: 'aspirant',
    class_id: classes.gunslingerFork.id,
    quirks: QUIRKS,
    accessories: ACCESSORIES
  });
  const { rows } = await perkRows();
  expect(rows).toHaveLength(4);
});
