// Not a product test: it guards the fixture layer every later spec depends on.
// A silent cleanup failure would slowly fill the developer's local database
// with e2e- rows, so the deletion half is asserted explicitly for every table
// the fixture layer can write to — including the mission and LFG rows, which
// live outside the character/class chain `cleanupByPrefix` walks first.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedMission } = require('../fixtures/mission');
const { seedCharacter, seedPerk, seedOffscreenMission, abilityIdFor } = require('../fixtures/character');
const { supabaseAdmin } = require('../../models/_base');
const { ADMIN_EMAIL } = require('../global-setup');

test('fixtures seed under a prefix and clean up completely', async () => {
  const db = await connect();
  const prefix = newPrefix('fixtures');
  try {
    const profile = await profileForEmail(db, ADMIN_EMAIL);
    const classRow = await seedClass(prefix);
    const character = await seedCharacter(prefix, profile, classRow);
    const mission = await seedMission(prefix, profile.id);

    const abilityId = await abilityIdFor(character.id);
    const perk = await seedPerk(character.id, abilityId, `${prefix}-perk`);
    const offscreen = await seedOffscreenMission(character.id, profile.id, {
      sourceMissionId: mission.id,
      name: `${prefix}-offscreen`
    });

    // No seedLfgPost fixture exists yet, so this exercises the LFG cleanup
    // path with a direct insert that still carries the shared prefix.
    const { data: lfgPost, error: lfgError } = await supabaseAdmin
      .from('lfg_posts')
      .insert({
        title: `${prefix}-lfg-post`,
        description: 'Fixture LFG post',
        date: '2026-01-15T18:00:00Z',
        creator_id: profile.id,
        max_characters: 4,
        is_public: true
      })
      .select()
      .single();
    if (lfgError) throw lfgError;

    expect(character.id).toBeTruthy();
    expect(character.name).toBe(`${prefix}-character`);
    expect(mission.id).toBeTruthy();
    expect(perk.id).toBeTruthy();
    expect(offscreen.id).toBeTruthy();
    expect(lfgPost.id).toBeTruthy();

    await cleanupByPrefix(db, prefix);

    // Sequential, not Promise.all: a single pg.Client (unlike a Pool) can't
    // run concurrent queries on one connection.
    const { rows: leftoverCharacters } = await db.query(
      'select id from characters where name like $1', [`${prefix}%`]
    );
    const { rows: leftoverClasses } = await db.query(
      'select id from classes where name like $1', [`${prefix}%`]
    );
    const { rows: leftoverMissions } = await db.query(
      'select id from missions where name like $1', [`${prefix}%`]
    );
    const { rows: leftoverOffscreen } = await db.query(
      'select id from offscreen_missions where character_id = $1', [character.id]
    );
    const { rows: leftoverPerks } = await db.query(
      'select id from character_perks where character_id = $1', [character.id]
    );
    const { rows: leftoverLfgPosts } = await db.query(
      'select id from lfg_posts where title like $1', [`${prefix}%`]
    );
    expect(leftoverCharacters).toHaveLength(0);
    expect(leftoverClasses).toHaveLength(0);
    expect(leftoverMissions).toHaveLength(0);
    expect(leftoverOffscreen).toHaveLength(0);
    expect(leftoverPerks).toHaveLength(0);
    expect(leftoverLfgPosts).toHaveLength(0);
  } finally {
    await cleanupByPrefix(db, prefix);
    await db.end();
  }
});
