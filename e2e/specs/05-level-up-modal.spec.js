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

test('completing a level-up persists the new level', async ({ page }) => {
  const before = character.level;

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
  // below just proves stat changes ride along in the same save.
  await page.locator('#levelUpModal input[name="might"]').fill('2');
  const missionInputs = page.locator('#levelUpMissingMissions .level-up-mission');
  await expect(missionInputs).toHaveCount(2);
  await missionInputs.nth(0).fill(`${prefix}-mission-1`);
  await missionInputs.nth(1).fill(`${prefix}-mission-2`);

  await page.locator('#levelUpSaveBtn').click();

  await expect(page.locator('#levelUpError')).toBeHidden();
  await expect.poll(async () => {
    const { rows } = await db.query('select level from characters where id = $1', [character.id]);
    return rows[0].level;
  }, { timeout: 15_000 }).toBe(before + 1);
});
