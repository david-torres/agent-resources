// ar-7v3k check 4. The perk field became a <textarea> during the Alpine
// adoption; a disturbed name="ability_perk_text[]" would drop perk text with
// no error surfaced to the user. This asserts the value actually lands in the
// database, not merely that the form looks right.
//
// The perk textarea only renders on the edit form when the character's class
// is on rules v2 (routes/characters.js:353, views/character-form.handlebars:270),
// so the fixture class must be seeded with rulesVersion: 'v2' or the field
// never appears.
//
// This spec exists to test the perk round-trip ONLY, so it deliberately
// avoids two unrelated, separately-tracked defects rather than tripping over
// them here (see docs/.../task-4-report.md "Fix round 1" for the full
// writeup and e2e/specs/03b-class-reassignment.spec.js for the regression
// test on the second one):
//   1. A single-ability class's "Class Abilities" <select> option never
//      gets marked `selected` (a Handlebars context-depth quirk in
//      character-class-abilities.handlebars, only triggered by exactly one
//      ability in an optgroup) -- avoided by fixtures/class.js's default of
//      >= 2 abilities.
//   2. The edit form's Class <select> only offers classes the editing user
//      has unlocked, with no fallback injection for the character's own
//      current class -- avoided by unlocking the fixture class for the
//      admin before editing.
// Skipping either avoidance reproduces validation-blocked or
// class-reassignment failures that have nothing to do with the perk field.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass, unlockClassForProfile } = require('../fixtures/class');
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
  await unlockClassForProfile(profile, classRow);
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

  // Not /\/characters\// -- the edit page itself (/characters/{id}/edit)
  // already matches that pattern, so waitForURL could resolve immediately,
  // before the save's PUT/redirect actually happens, and race the assertion
  // below against a request still in flight. Wait specifically for
  // navigation AWAY from /edit (to the character detail page HX-Location
  // sends on success).
  await page.waitForURL((url) => !url.pathname.endsWith('/edit'));

  const { rows } = await db.query(
    'select text from character_perks where character_id = $1', [character.id]
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].text).toBe(multiline);
});
