// The virtual party tool's one irreplaceable behaviour: membership survives
// across adds because Add/Remove read #party-csv at request time rather than
// carrying a URL baked at page load. routes/party.test.js pins that at the
// route; this pins it through real htmx in a real browser, which is where a
// stale hx-include selector or a missing HX-Push-Url would actually show up.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { ADMIN_EMAIL } = require('../global-setup');

const prefix = newPrefix('party');
let db;
let alpha;
let beta;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  const classRow = await seedClass(prefix);
  // is_public: 'on' — the literal string, not a boolean. createCharacter
  // defaults is_public to false and normalizeCharacterInput compares against
  // 'on' (see the note in e2e/specs/04-stats-editor.spec.js). Without it the
  // public search cannot find these characters.
  alpha = await seedCharacter(prefix, profile, classRow, { is_public: 'on', name: `${prefix}-alpha`, might: 3 });
  beta = await seedCharacter(prefix, profile, classRow, { is_public: 'on', name: `${prefix}-beta`, might: 2 });
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test('adding two characters keeps both, and removing one keeps the other', async ({ page }) => {
  await page.goto('/party');

  // pressSequentially, not fill: the search input's hx-trigger is
  // "keyup changed delay:500ms", and fill() sets the value without emitting
  // keyup, so the search would never fire.
  await page.locator('input[name="q"]').pressSequentially(prefix);
  await expect(page.locator(`[data-add-character="${alpha.id}"]`)).toBeVisible();

  await page.click(`[data-add-character="${alpha.id}"]`);
  await expect(page.locator(`#party-panel [data-member-id="${alpha.id}"]`)).toBeVisible();

  // The whole point: the second add must not discard the first.
  await page.click(`[data-add-character="${beta.id}"]`);
  await expect(page.locator(`#party-panel [data-member-id="${beta.id}"]`)).toBeVisible();
  await expect(page.locator(`#party-panel [data-member-id="${alpha.id}"]`)).toBeVisible();

  // HX-Push-Url put both ids in the address bar, so the link is shareable.
  await expect(page).toHaveURL(new RegExp(`${alpha.id}.*${beta.id}`));

  // might: 3 + 2. The combined total is the reason the tool exists.
  await expect(page.locator('#party-panel')).toContainText('Might (5)');

  await page.click(`#party-panel [data-remove-character="${alpha.id}"]`);
  await expect(page.locator(`#party-panel [data-member-id="${alpha.id}"]`)).toHaveCount(0);
  await expect(page.locator(`#party-panel [data-member-id="${beta.id}"]`)).toBeVisible();
  await expect(page.locator('#party-panel')).toContainText('Might (2)');
});

test('a party URL loads its members directly, so a shared link works', async ({ page }) => {
  await page.goto(`/party?c=${alpha.id},${beta.id}`);
  await expect(page.locator(`#party-panel [data-member-id="${alpha.id}"]`)).toBeVisible();
  await expect(page.locator(`#party-panel [data-member-id="${beta.id}"]`)).toBeVisible();
  await expect(page.locator('#party-panel')).toContainText('Might (5)');
});
