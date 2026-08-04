// ar-7v3k check 4. The perk field became a <textarea> during the Alpine
// adoption; a disturbed name="ability_perk_text[]" would drop perk text with
// no error surfaced to the user. This asserts the value actually lands in the
// database, not merely that the form looks right.
//
// The perk textarea only renders on the edit form when the character's class
// is on rules v2 (routes/characters.js:353, views/character-form.handlebars:270),
// so the fixture class must be seeded with rulesVersion: 'v2' or the field
// never appears.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter, seedPerk, abilityIdFor } = require('../fixtures/character');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('perk');
let db;
let character;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  const classRow = await seedClass(prefix, { rulesVersion: 'v2' });
  character = await seedCharacter(prefix, profile, classRow);
  await seedPerk(character.id, await abilityIdFor(character.id), 'original perk text');
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test('the perk field is a textarea carrying the array field name', async ({ page }) => {
  await page.goto(`/characters/${character.id}/edit`);
  const field = page.locator('textarea[name="ability_perk_text[]"]').first();
  await expect(field).toBeVisible();
  await expect(field).toHaveValue('original perk text');
});

test('the live word count tracks typing and shows 0 for whitespace', async ({ page }) => {
  await page.goto(`/characters/${character.id}/edit`);
  const field = page.locator('textarea[name="ability_perk_text[]"]').first();
  const count = page.locator('.word-count').first();

  await field.fill('one two three');
  await expect(count).toHaveText('3');

  await field.fill('   ');
  await expect(count).toHaveText('0');
});

test('saving persists perk text, including newlines', async ({ page }) => {
  const multiline = 'first line\nsecond line';

  await page.goto(`/characters/${character.id}/edit`);
  await page.locator('textarea[name="ability_perk_text[]"]').first().fill(multiline);
  // The edit form has no id attribute; it is the one <form> on the page
  // carrying hx-put (views/character-form.handlebars:14). The deceased-modal
  // form on the same page uses hx-post, so this stays unambiguous.
  await page.locator('form[hx-put] button[type="submit"]').first().click();

  await page.waitForURL(/\/characters\//);

  const { rows } = await db.query(
    'select text from character_perks where character_id = $1', [character.id]
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].text).toBe(multiline);
});
