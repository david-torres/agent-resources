// ar-7v3k check 1. character-level-up.js was NOT converted -- it now opens the
// Alpine modal through a single dispatchEvent bridge. This is the only path
// writing character data through a converted modal, so both the bridge and all
// four close paths are covered.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass, unlockClassForProfile } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('levelup');
let db;
let character;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  const classRow = await seedClass(prefix);
  // See fixtures/class.js#unlockClassForProfile: a save routed through a
  // non-unlocked class has a confirmed defect where it silently reassigns
  // the class and cascade-deletes perks. The level-up POST doesn't touch
  // class_id at all (services/character/service.js#levelUp only ever writes
  // stats/level/completed_missions/commissary_reward), so it isn't required
  // for this flow to work -- but unlocking costs nothing and keeps that
  // defect from ever being able to confound these results.
  await unlockClassForProfile(profile, classRow);
  // Left at the fixture default (completed_missions: 0, see BASE_STATS in
  // fixtures/character.js) -- see the save test below for why.
  character = await seedCharacter(prefix, profile, classRow);
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test('the dispatchEvent bridge opens the Alpine modal and locks the body', async ({ page }) => {
  await page.goto(`/characters/${character.id}`);
  await page.locator('#levelUpBtn').click();

  await expect(page.locator('#levelUpModal')).toHaveClass(/is-active/);
  await expect(page.locator('body')).toHaveClass(/modal-open/);
});

for (const [name, close] of [
  // Bulma centers the modal-card over the full-viewport .modal-background, so
  // a default (bounding-box-center) click lands on the card itself and
  // Playwright reports the card intercepting the pointer event. Click a
  // corner instead -- still within .modal-background, outside the centered
  // card -- to hit the background the way a real user clicking beside the
  // card would. Test-driving fix, not a product defect.
  ['background click', async (page) => page.locator('#levelUpModal .modal-background').click({ position: { x: 5, y: 5 } })],
  ['header delete button', async (page) => page.locator('#levelUpModal .delete').first().click()],
  ['footer cancel', async (page) => page.locator('#levelUpModal .modal-card-foot .button', { hasText: /cancel/i }).click()],
  ['escape key', async (page) => page.keyboard.press('Escape')]
]) {
  test(`closes via ${name} and releases the body lock`, async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await page.locator('#levelUpBtn').click();
    await expect(page.locator('#levelUpModal')).toHaveClass(/is-active/);

    await close(page);

    await expect(page.locator('#levelUpModal')).not.toHaveClass(/is-active/);
    await expect(page.locator('body')).not.toHaveClass(/modal-open/);
  });
}

test('completing a level-up persists the new level and the edited stat', async ({ page }) => {
  // Read from the DB, not the seeded JS object: safe today since this is
  // the only test in the file that mutates the row, but reading the source
  // of truth instead of a stale in-memory snapshot means it stays correct
  // if that ever stops being true (e.g. under CI's multi-worker config).
  const { rows: beforeRows } = await db.query(
    'select level, might from characters where id = $1', [character.id]
  );
  const before = beforeRows[0];

  await page.goto(`/characters/${character.id}`);
  await page.locator('#levelUpBtn').click();
  await expect(page.locator('#levelUpModal')).toHaveClass(/is-active/);

  // There is NO client- or server-side gate tying Save to the stat total.
  // #levelUpTotal (character-level-up.js:25-33) is purely a live readout --
  // nothing reads it before the POST fires -- and normalizeStatsPayload
  // (services/character/input.js:129-136) just clamps each submitted stat to
  // 0-20 independently, with no sum check. The real gate the modal enforces
  // is on MISSIONS: the server rejects the save unless enough backfill
  // mission names (or a Conduit Credit) cover the gap between the
  // character's completed_missions and the next level's requirement
  // (services/character/service.js:443-448, "Provide mission names for each
  // missing mission, or spend Conduit Credits").
  //
  // The fixture leaves completed_missions at its default 0 (BASE_STATS), so
  // for level 1 -> 2 the modal pre-renders exactly
  // missionsForLevel(2) = 2 empty "missing mission" rows
  // (character-level-up.js:203-211 / character-common.js's
  // v2LevelingSequence). Filling both clears the real gate; the stat edit
  // below is asserted directly below, not just assumed to "ride along" --
  // level alone would pass even if stats were dropped entirely, since level
  // is derived server-side from mission rows
  // (services/character/service.js:491-514), not from the modal's stat
  // inputs.
  // The blocks write through a hidden input, so there is nothing to fill;
  // clicking the Nth block is how a stat reaches N. Capped at the 5-block
  // row rather than blindly incrementing, so a seeded 5 doesn't ask for a
  // sixth block that does not exist.
  const editedMight = before.might >= 5 ? 4 : before.might + 1;
  await page.locator('#levelUpModal .stat-blocks[data-stat="might"] [role="radio"]')
    .nth(editedMight - 1).click();
  const missionInputs = page.locator('#levelUpMissingMissions .level-up-mission');
  await expect(missionInputs).toHaveCount(2);
  await missionInputs.nth(0).fill(`${prefix}-mission-1`);
  await missionInputs.nth(1).fill(`${prefix}-mission-2`);

  // Wait for the save's window.location.reload() (character-level-up.js:301)
  // to actually land before moving on. Without this the test can finish (and
  // afterAll's delete can run) while the reload's GET /characters/:id is
  // still in flight, logging a harmless but noisy PGRST116 "0 rows" error
  // server-side.
  await Promise.all([
    page.waitForEvent('load'),
    page.locator('#levelUpSaveBtn').click()
  ]);

  // NOTE: no assertion on #levelUpError here. It ships with the `is-hidden`
  // class, so checking it immediately resolves true at t=0 regardless of
  // whether the save actually succeeds -- confirmed by mutation testing: a
  // forced 400 response still left this assertion green. The DB poll below
  // is the only assertion in this test that can actually fail on a broken
  // save.
  await expect.poll(async () => {
    const { rows } = await db.query(
      'select level, might from characters where id = $1', [character.id]
    );
    return rows[0];
  }, { timeout: 15_000 }).toEqual({ level: before.level + 1, might: editedMight });
});
