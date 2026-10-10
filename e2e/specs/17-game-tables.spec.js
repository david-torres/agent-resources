// A draft table's one irreplaceable behaviour: membership survives across adds
// because Add/Remove read #table-csv at request time rather than carrying a
// URL baked at page load. routes/tables.test.js pins that at the route; this
// pins it through real htmx in a real browser, which is where a stale
// hx-include selector or a missing HX-Push-Url would actually show up. It
// also covers saving a draft and seating a guest at the saved table.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

const prefix = newPrefix('tables');
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
  await db.query('delete from game_tables where name like $1', [`${prefix}%`]);
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test('adding two characters keeps both, and removing one keeps the other', async ({ page }) => {
  await page.goto('/tables/new');

  // pressSequentially, not fill: the search input's hx-trigger is
  // "keyup changed delay:500ms", and fill() sets the value without emitting
  // keyup, so the search would never fire.
  await page.locator('input[name="q"]').pressSequentially(prefix);
  await expect(page.locator(`[data-add-character="${alpha.id}"]`)).toBeVisible();

  await page.click(`[data-add-character="${alpha.id}"]`);
  await expect(page.locator(`#table-panel [data-member-id="${alpha.id}"]`)).toBeVisible();

  // The whole point: the second add must not discard the first.
  await page.click(`[data-add-character="${beta.id}"]`);
  await expect(page.locator(`#table-panel [data-member-id="${beta.id}"]`)).toBeVisible();
  await expect(page.locator(`#table-panel [data-member-id="${alpha.id}"]`)).toBeVisible();

  // HX-Push-Url put both ids in the address bar, so the link is shareable.
  await expect(page).toHaveURL(new RegExp(`/tables/new\\?c=.*${alpha.id}.*${beta.id}`));

  // might: 3 + 2. The combined total is the reason the tool exists.
  await expect(page.locator('#table-panel')).toContainText('Might (5)');

  await page.click(`#table-panel [data-remove-character="${alpha.id}"]`);
  await expect(page.locator(`#table-panel [data-member-id="${alpha.id}"]`)).toHaveCount(0);
  await expect(page.locator(`#table-panel [data-member-id="${beta.id}"]`)).toBeVisible();
  await expect(page.locator('#table-panel')).toContainText('Might (2)');
});

test('a draft URL loads its members directly, so a shared link works', async ({ page }) => {
  await page.goto(`/tables/new?c=${alpha.id},${beta.id}`);
  await expect(page.locator(`#table-panel [data-member-id="${alpha.id}"]`)).toBeVisible();
  await expect(page.locator(`#table-panel [data-member-id="${beta.id}"]`)).toBeVisible();
  await expect(page.locator('#table-panel')).toContainText('Might (5)');
});

test('a member row expands to show the lazy details fragment', async ({ page }) => {
  await page.goto(`/tables/new?c=${alpha.id}`);

  const row = page.locator(`#table-panel [data-member-id="${alpha.id}"]`);
  await row.locator('button:has-text("Details")').click();

  // The fragment arrives over htmx after the click; toContainText retries
  // until it lands. alpha's might: 3 proves real stats rendered, not just
  // the section scaffold.
  const details = page.locator(`#member-details-${alpha.id}`);
  await expect(details).toContainText('Stats');
  await expect(details).toContainText('Might');

  // Expanding details is not navigation: the URL must not change.
  await expect(page).toHaveURL(new RegExp(`/tables/new\\?c=${alpha.id}`));
});

test.describe('signed in', () => {
  test.use({ storageState: ADMIN_STATE });

  test('a draft saves as a table, then seats an unregistered character', async ({ page }) => {
    await page.goto(`/tables/new?c=${alpha.id}`);
    await expect(page.locator(`#table-panel [data-member-id="${alpha.id}"]`)).toBeVisible();

    await page.fill('form[hx-post="/tables"] input[name="name"]', `${prefix} night`);
    await page.click('form[hx-post="/tables"] button[type="submit"]');
    await expect(page).toHaveURL(/\/tables\/[0-9a-f-]{36}$/);
    await expect(page.locator(`#table-panel [data-member-id]`)).toHaveCount(1);

    await page.fill('[data-guest-form] input[name="name"]', `Guest ${prefix}`);
    await page.click('[data-guest-form] .stat-blocks[data-stat="might"] [aria-label="Might: 3"]');
    await page.click('[data-guest-form] button[type="submit"]');

    await expect(page.locator('#table-panel')).toContainText(`Guest ${prefix}`);
    await expect(page.locator('#table-panel')).toContainText('Unregistered');
  });
  test('trackers spend and undo with a toast, keep sources open across a swap, and a signed-out viewer polls the change', async ({ page, browser }) => {
    await page.goto(`/tables/new?c=${alpha.id}`);
    await page.fill('form[hx-post="/tables"] input[name="name"]', `${prefix} trackers`);
    await page.click('form[hx-post="/tables"] button[type="submit"]');
    await expect(page).toHaveURL(/\/tables\/[0-9a-f-]{36}$/);

    await page.fill('[data-guest-form] input[name="name"]', `Tracked ${prefix}`);
    await page.click('[data-guest-form] button[type="submit"]');
    const guestRow = page.locator('#table-panel [data-member-id]').filter({ hasText: `Tracked ${prefix}` });
    await expect(guestRow).toBeVisible();
    const trackerId = await guestRow.locator('[data-tracker]').getAttribute('id');
    const tracker = page.locator(`#${trackerId}`);
    const essenceTag = tracker.locator('[data-pool="essence"] .tracker-threshold');
    await expect(essenceTag).toHaveText('Green');

    await tracker.getByRole('button', { name: 'Spend High Essence' }).click();
    await expect(essenceTag).toHaveText('Yellow');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(essenceTag).toHaveText('Green');

    const sources = tracker.locator('.tracker-sources');
    await sources.locator('summary').click();
    await expect(sources).toHaveJSProperty('open', true);
    await tracker.locator('[data-source="mechanic:pitch"]').getByRole('button', { name: 'Use', exact: true }).click();
    await expect(tracker.locator('[data-source="mechanic:pitch"]')).toContainText('Used ×1');
    await expect(tracker.locator('.tracker-sources')).toHaveJSProperty('open', true);

    const viewer = await browser.newContext();
    const viewerPage = await viewer.newPage();
    await viewerPage.goto(page.url());
    const viewerTag = viewerPage.locator(`#${trackerId}`).locator('[data-pool="essence"] .tracker-threshold');
    const before = await viewerTag.textContent();
    await tracker.getByRole('button', { name: 'Spend High Essence' }).click();
    await expect(essenceTag).not.toHaveText(before.trim());
    await expect(viewerTag).not.toHaveText(before.trim(), { timeout: 8000 });
    await viewer.close();
  });
});
