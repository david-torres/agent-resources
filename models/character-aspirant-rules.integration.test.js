// Local-Supabase integration coverage for an Aspirant-format character on the
// v2 character rules: an edit keeps its Defining Quirk, Accessories and
// Ability Perks, and an auto-calculated level follows the v2 curve.
require('../util/require-local-supabase');

const { test, expect, beforeAll, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('./_base');
const { updateCharacter } = require('./character');
const { statList } = require('../util/enclave-consts');
const { createAuthUserAndProfile, grantAspirantBook } = require('../test/helpers/auth-user-fixture');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `aspirant-rules-${suffix}@example.test`;
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});

const STATS = Object.fromEntries(statList.map(stat => [stat, 1]));
const QUIRKS = [{ name: 'Night Owl', downside: 'Sleeps through mornings.', upside: 'Sees in the dark.' }];
const ACCESSORIES = [{ name: 'Pocket Watch' }];
// The edit changes all three: a class off v2 has them stripped from the
// submission, so the stored values would survive unchanged and a test that
// resubmitted them could not tell the difference.
const EDITED_QUIRKS = [{ name: 'Night Owl', downside: 'Sleeps through noon.', upside: 'Sees in the dark.' }];
const EDITED_ACCESSORIES = [{ name: 'Pocket Watch' }, { name: 'Lucky Coin' }];
const EDITED_PERK = 'Steadier hands.';
const TRAIT_FIELDS = {
  trait0: 'Brave', trait0_stat: 'might',
  trait1: 'Clever', trait1_stat: 'intelligence',
  trait2: 'Lucky', trait2_stat: 'luck'
};
// Four missions: level 3 on the v2 curve (2 + 2), level 2 on v1 (2 + 3).
const OFFSCREEN_MISSIONS = 4;

let authUserId;
let profile;
let aspirantClass;
let characterId;
let updateResult;

beforeAll(async () => {
  await db.connect();
  ({ authUserId, profile } = await createAuthUserAndProfile(db, { email, profileName: `Aspirant Rules ${suffix}` }));
  await grantAspirantBook(db, profile);
  ({ data: aspirantClass } = await supabaseAdmin.from('classes')
    .insert({
      name: `Aspirant Rules Class ${suffix}`, is_public: true,
      rules_edition: 'aspirant', content_format: 'aspirant', rules_version: 'v1',
      gear: [{ name: 'Rifle' }], abilities: [{ name: 'Aim' }], advanced_abilities: []
    })
    .select()
    .single());

  const { data: created, error } = await supabaseAdmin.rpc('save_character_atomic', {
    p_character_id: null,
    p_creator_id: profile.id,
    p_character: {
      ...STATS,
      creator_id: profile.id, name: `Aspirant Rules ${suffix}`,
      class: aspirantClass.name, class_id: aspirantClass.id, creator_mode: 'aspirant',
      auto_calculate: true, level: 1, completed_missions: 0, commissary_reward: 0,
      quirks: QUIRKS, accessories: ACCESSORIES
    },
    p_traits: [{ name: 'Brave', stat: 'might' }, { name: 'Clever', stat: 'intelligence' }, { name: 'Lucky', stat: 'luck' }],
    p_gear: [{ name: 'Rifle', class_id: aspirantClass.id }],
    p_abilities: [{ name: 'Aim', class_id: aspirantClass.id, type: 'core' }],
    p_perks: [{ ability_name: 'Aim', text: 'Steady hands.', position: 0 }]
  });
  if (error) throw error;
  characterId = created.id;

  for (let i = 1; i <= OFFSCREEN_MISSIONS; i++) {
    await db.query(
      `insert into offscreen_missions (character_id, name, summary, merx_gained, source_mission_name, source_mission_date)
       values ($1, $2, 'Fixture', 0, 'Fixture source', $3)`,
      [characterId, `Offscreen ${i}`, `2026-01-0${i}`]
    );
  }

  const { rows: [aim] } = await db.query(
    'select id from class_abilities where character_id = $1 and name = $2', [characterId, 'Aim']
  );
  updateResult = await updateCharacter(characterId, {
    ...STATS,
    ...TRAIT_FIELDS,
    name: `Aspirant Rules Edited ${suffix}`,
    auto_calculate: 'on',
    quirks: EDITED_QUIRKS,
    accessories: EDITED_ACCESSORIES,
    ability_perks: [{ class_ability_id: aim.id, text: EDITED_PERK, position: 0 }]
  }, { id: profile.id });
});

afterAll(async () => {
  if (profile?.id) await db.query('delete from characters where creator_id = $1', [profile.id]);
  if (profile?.id) await db.query('delete from rules_pdfs where created_by = $1', [profile.id]);
  if (profile?.id) await db.query('delete from profiles where id = $1', [profile.id]);
  if (aspirantClass?.id) await db.query('delete from classes where id = $1', [aspirantClass.id]);
  if (authUserId) await db.query('delete from auth.users where id = $1', [authUserId]);
  await db.end();
});

test('an edit of an Aspirant v1 character with Advent v2 mechanics writes its Defining Quirk, Accessories and Ability Perks', async () => {
  expect(updateResult.error).toBeNull();
  const { rows: [row] } = await db.query('select name, quirks, accessories from characters where id = $1', [characterId]);
  expect(row.name).toBe(`Aspirant Rules Edited ${suffix}`);
  expect(row.quirks).toEqual(EDITED_QUIRKS);
  expect(row.accessories).toEqual(EDITED_ACCESSORIES);
  const { rows: perks } = await db.query(
    `select p.text, a.name as ability from character_perks p
     join class_abilities a on a.id = p.class_ability_id
     where p.character_id = $1`,
    [characterId]
  );
  expect(perks).toEqual([{ text: EDITED_PERK, ability: 'Aim' }]);
});

test('an auto-calculated Aspirant v1 character with Advent v2 mechanics levels on the v2 curve', async () => {
  const { rows: [row] } = await db.query('select level, completed_missions from characters where id = $1', [characterId]);
  expect(row.completed_missions).toBe(OFFSCREEN_MISSIONS);
  expect(row.level).toBe(3);
});
