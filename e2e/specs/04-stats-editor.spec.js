// ar-7v3k check 3. public/js/character-stats.js (108 lines) was deleted and
// replaced by the Alpine `characterStats` component; this is the whole of its
// replacement behaviour, plus the ownership gate that hides Edit entirely.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { ADMIN_EMAIL, ADMIN_STATE, PLAYER_STATE } = require('../global-setup');

const prefix = newPrefix('stats');
let db;
let character;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  const classRow = await seedClass(prefix);
  // is_public: true -- createCharacter defaults is_public to false
  // (services/character/input.js normalizeCharacterInput: `data.is_public =
  // data.is_public === 'on'`), so without this the non-owner test's character
  // 404s for the player rather than rendering with no Edit button. Fixture
  // correction, not a product change.
  character = await seedCharacter(prefix, profile, classRow, { is_public: true });
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test.describe('as the owner', () => {
  test.use({ storageState: ADMIN_STATE });

  // NOTE: `input[name="might"]` is scoped to `#statsEditor` everywhere below.
  // The character show page also renders the (separate, hidden-by-default)
  // level-up modal from views/partials/character-level-up.handlebars, whose
  // stat grid uses the same bare `name="{{this}}"` convention (id
  // `level-up-might`). An unscoped `input[name="might"]` locator matches both
  // and Playwright's strict mode throws. This is a test-selector scoping fix,
  // not a product defect -- the two inputs belong to unrelated features that
  // both happen to live on the same page.

  test('the stats box renders with the editor hidden', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await expect(page.locator('#statsBox')).toBeVisible();
    await expect(page.locator('#statsReadOnly')).toBeVisible();
    await expect(page.locator('#statsEditor')).toBeHidden();
    await expect(page.locator('#statsUnlockBtn')).toBeVisible();
  });

  test('Edit reveals the editor and focuses the first input', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await page.locator('#statsUnlockBtn').click();

    await expect(page.locator('#statsEditor')).toBeVisible();
    await expect(page.locator('#statsReadOnly')).toBeHidden();

    // The old imperative code focused the first input on reveal; the Alpine
    // edit() must still do it or keyboard users land nowhere.
    const focusedName = await page.evaluate(() => document.activeElement?.getAttribute('name'));
    expect(focusedName).toBeTruthy();
  });

  test('the live total tracks edits', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await page.locator('#statsUnlockBtn').click();

    const before = Number(await page.locator('#statsTotalSum').innerText());
    await page.locator('#statsEditor input[name="might"]').fill('7');
    await expect
      .poll(async () => Number(await page.locator('#statsTotalSum').innerText()))
      .toBe(before - 1 + 7); // seeded value is 1
  });

  test('Cancel restores the original values and hides the editor', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await page.locator('#statsUnlockBtn').click();
    await page.locator('#statsEditor input[name="might"]').fill('9');
    await page.locator('#statsCancelBtn').click();

    await expect(page.locator('#statsEditor')).toBeHidden();
    await page.locator('#statsUnlockBtn').click();
    await expect(page.locator('#statsEditor input[name="might"]')).toHaveValue('1');
  });

  test('Save persists to the database', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await page.locator('#statsUnlockBtn').click();
    await page.locator('#statsEditor input[name="might"]').fill('5');
    await page.locator('#statsSaveBtn').click();

    await expect(page.locator('#statsEditor')).toBeHidden();
    await expect.poll(async () => {
      const { rows } = await db.query('select might from characters where id = $1', [character.id]);
      return rows[0].might;
    }).toBe(5);
  });
});

test.describe('as a non-owner', () => {
  test.use({ storageState: PLAYER_STATE });

  test('sees no Edit button', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await expect(page.locator('#statsUnlockBtn')).toHaveCount(0);
  });
});
