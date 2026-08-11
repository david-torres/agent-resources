// ar-7v3k check 5. Uses a character whose name contains an apostrophe, because
// the required-name comparison is injected as {{json character.name}} into an
// Alpine expression — a quoting bug there would break the confirm gate for
// exactly those characters and no others.
//
// Serial mode, not just declaration order: the second test permanently marks
// the character deceased (views/character-form.handlebars:407's
// {{#unless character.is_deceased}} then removes the whole modal from the
// page), and playwright.config.js sets fullyParallel: true with no worker cap
// outside CI -- without forcing this file's tests to run one at a time, in
// order, a full `bun run test:e2e` run could schedule them concurrently or
// reversed, and the first test would find no "Mark as Deceased" button at all.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass, unlockClassForProfile } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.describe.configure({ mode: 'serial' });

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('deceased');
const NAME = `${prefix}-O'Brien`;
let db;
let character;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  const classRow = await seedClass(prefix);
  // See fixtures/class.js#unlockClassForProfile: editing through a
  // non-unlocked class has a confirmed defect where a save silently
  // reassigns the class and cascade-deletes perks
  // (03b-class-reassignment.spec.js). The deceased POST
  // (services/character/service.js markDeceased) never touches class_id, so
  // it can't be the trigger here -- but this spec still loads the real edit
  // form, and unlocking costs nothing while ruling that confound out.
  await unlockClassForProfile(profile, classRow);
  character = await seedCharacter(prefix, profile, classRow, { name: NAME });
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test('opening locks background scroll; the confirm gate honours an apostrophe', async ({ page }) => {
  await page.goto(`/characters/${character.id}/edit`);
  // "Confirm Death" (the in-modal submit button's label) doesn't match
  // /deceased/i, so this is unambiguous even though the modal (containing
  // that button) is already present, if hidden, in the DOM at this point.
  await page.locator('button', { hasText: /deceased/i }).first().click();

  const modal = page.locator('#deceased-modal');
  await expect(modal).toHaveClass(/is-active/);
  await expect(page.locator('body')).toHaveClass(/modal-open/);
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

  const submit = page.locator('#deceased-submit');
  await expect(submit).toBeDisabled();

  await page.locator('#deceased-modal input[name="confirmName"]').fill('wrong name');
  await expect(submit).toBeDisabled();

  await page.locator('#deceased-modal input[name="confirmName"]').fill(NAME);
  await expect(submit).toBeEnabled();
});

test('confirming marks the character deceased', async ({ page }) => {
  await page.goto(`/characters/${character.id}/edit`);
  await page.locator('button', { hasText: /deceased/i }).first().click();
  await page.locator('#deceased-modal input[name="confirmName"]').fill(NAME);
  await page.locator('#deceased-submit').click();

  await expect.poll(async () => {
    const { rows } = await db.query('select is_deceased from characters where id = $1', [character.id]);
    return rows[0].is_deceased;
  }, { timeout: 15_000 }).toBe(true);
});
