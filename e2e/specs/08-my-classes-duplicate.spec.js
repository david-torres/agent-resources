// ar-7v3k check 9. modalBase.open(which) (public/js/alpine-components.js:158-159)
// returns early unless `which` matches the instance's name; with several rows
// on the page, an unscoped implementation would open every row's modal at
// once. Needs at least two seeded classes to detect that at all -- one row
// proves nothing.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

// Serial: the second test's submission mutates the shared `first`/`second`
// fixture rows' visibility on /classes/my (a third, duplicated row appears),
// and both tests re-navigate to the same page -- keeping them serial avoids
// any cross-test ordering surprise even though nothing here mutates state the
// first test reads.
test.describe.configure({ mode: 'serial' });

const prefix = newPrefix('myclasses');
let db;
let profile;
let first;
let second;

test.beforeAll(async () => {
  db = await connect();
  profile = await profileForEmail(db, ADMIN_EMAIL);
  // routes/classes.js's GET /my filters getClasses({ created_by: profile.id })
  // with a strict .eq (util/class-filters.js) -- a class seeded without an
  // owner never appears on My Classes for anyone, including the seeding
  // admin. Both rows must be owned by the signed-in admin or the page renders
  // empty and every assertion below (all "not active" / "not visible" shaped)
  // would pass vacuously.
  first = await seedClass(prefix, { name: `${prefix}-alpha`, createdBy: profile.id });
  second = await seedClass(prefix, { name: `${prefix}-beta`, createdBy: profile.id });
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test("one row's Duplicate opens only that row's modal", async ({ page }) => {
  await page.goto('/classes/my');

  const firstRow = page.locator(`#row-${first.id}`);
  const secondRow = page.locator(`#row-${second.id}`);
  const firstModal = page.locator(`#duplicateModal-${first.id}`);
  const secondModal = page.locator(`#duplicateModal-${second.id}`);

  // Positive precondition (task brief lesson 4): prove the page actually
  // rendered both fixture rows before trusting any "modal stayed closed"
  // assertion below. Without this, a filtering regression (e.g. the
  // created_by gap above) would leave the table empty and every negative
  // assertion would pass for the wrong reason.
  await expect(firstRow).toBeVisible();
  await expect(secondRow).toBeVisible();

  // Scoped to the row's action bar (`.buttons.are-small`, my-classes.handlebars:109),
  // not just `#row-{id} button` -- the modal markup for EVERY row lives
  // nested inside that same row's <td>, and its own submit button's text
  // ("Duplicate") also matches /duplicate/i, so an unscoped locator resolves
  // to two elements (the trigger and the modal's submit button) and Playwright
  // refuses to click ambiguously.
  await firstRow.locator('.buttons.are-small button', { hasText: /duplicate/i }).click();

  // The real assertion: first's modal opened (the state the "second stayed
  // closed" check needs to be meaningful -- see lesson 5) AND second's did
  // not, proving modalBase's name-scoping guard actually scopes per row
  // rather than broadcasting to every modal instance on the page.
  await expect(firstModal).toHaveClass(/is-active/);
  await expect(secondModal).not.toHaveClass(/is-active/);
});

test('the duplicate modal submits and creates a linked copy', async ({ page }) => {
  await page.goto('/classes/my');
  await page.locator(`#row-${first.id}`).locator('.buttons.are-small button', { hasText: /duplicate/i }).click();

  const modal = page.locator(`#duplicateModal-${first.id}`);
  await expect(modal).toHaveClass(/is-active/);

  // dup-version is `required` (my-classes.handlebars:147); its v2 <option>
  // already carries `selected` in the markup, but select explicitly so the
  // submission doesn't depend on that default staying put.
  await modal.locator(`#dup-version-${first.id}`).selectOption('v2');
  await modal.locator('button[type="submit"]').click();

  // routes/classes.js's POST /:id/duplicate (confirmed by reading the route)
  // responds 204 with an HX-Location header pointing at the new class's own
  // page (`/classes/{newId}/{slug}`); the form's hx-swap="none" means htmx's
  // only visible effect is following that header. /classes/my itself already
  // matches a loose /\/classes\// pattern, so wait for a UUID-shaped segment
  // specifically -- that only appears once htmx has actually navigated to the
  // new class, not merely repainted the current page.
  await page.waitForURL((url) => /^\/classes\/[0-9a-f-]{36}(\/|$)/i.test(url.pathname));

  // dup_class (20260525000003_dup_class_with_edition.sql) sets the new row's
  // base_class_id to the source's id and copies its name verbatim -- assert
  // on the FK link specifically, which is stronger than a bare row-count
  // check and still catches the duplicate via cleanupByPrefix's name LIKE
  // scan (the copy's name equals `first`'s, which starts with the prefix).
  await expect.poll(async () => {
    const { rows } = await db.query(
      'select id, rules_version from classes where base_class_id = $1', [first.id]
    );
    return rows.length;
  }, { timeout: 15_000 }).toBe(1);

  const { rows } = await db.query(
    'select rules_version from classes where base_class_id = $1', [first.id]
  );
  expect(rows[0].rules_version).toBe('v2');
});
