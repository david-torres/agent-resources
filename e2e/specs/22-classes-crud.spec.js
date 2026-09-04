// e2e/specs/22-classes-crud.spec.js
//
// Player-created class lifecycle through the real UI.
//
// D3 -- BOTH DELETE BUTTONS WERE INERT, FOR TWO DIFFERENT REASONS.
//
//   * my-classes.handlebars:115 (targets #row-<id>): the route answered 204
//     No Content, and htmx does not swap on 204, so the row stayed on screen
//     even when the delete succeeded. Fixed in routes/classes.js by answering
//     HX-Location.
//   * class-view.handlebars:29: it carried hx-target="closest tr" on a page
//     that has no <tr> and no <table> at all. htmx aborts at issueAjaxRequest
//     with htmx:targetError BEFORE the hx-confirm check, so the button issued
//     no request, raised no dialog, and reported nothing (there is no
//     htmx:targetError listener in public/js/app.js). HX-Location cannot help
//     a request that is never sent; fixed by dropping the bad target.
//
// The delete tests below assert against Postgres as well as the DOM, which is
// the only way to tell "it worked but did not repaint" from "it did nothing".
//
// The abilities/gear rows are FIXED-COUNT and server-rendered -- exactly 3
// and 6, via {{#times}} (class-form.handlebars:157, :185). There is no
// add-row UI. All 9 name fields are `required`, as is the Overview textarea,
// so a valid create must fill every one.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');

test.use({ storageState: PLAYER_STATE });

const prefix = newPrefix('class-crud');
let db;

test.beforeAll(async () => {
  db = await connect();
  await profileForEmail(db, PLAYER_EMAIL); // fails loudly if seed:local was not run
});

test.afterAll(async () => {
  try {
    await cleanupByPrefix(db, prefix);
  } finally {
    await db.end();
  }
});

async function createClassViaUi(page, name) {
  await page.goto('/classes/new');
  await page.waitForLoadState('networkidle');

  const form = page.locator('form[hx-post="/classes"]');
  await form.locator('#class-name').fill(name);
  await form.locator('#class-overview').fill(`${name} overview`);

  // The ability block is a repeater now: its rows are server-rendered with
  // bracket names carrying the row index (abilities[0][name]), and a new class
  // still opens on three blank ones. The inert <template data-prototype> rows
  // live in a DocumentFragment, so this locator never sees them.
  const abilities = form.locator('input[name^="abilities["][name$="[name]"]');
  await expect(abilities).toHaveCount(3);
  for (let i = 0; i < 3; i++) await abilities.nth(i).fill(`${prefix} Ability ${i + 1}`);

  const gear = form.locator('input[name="gear_name[]"]');
  await expect(gear).toHaveCount(6);
  for (let i = 0; i < 6; i++) await gear.nth(i).fill(`${prefix} Gear ${i + 1}`);

  await form.locator('button[type="submit"]').click();

  // routes/classes.js:650 answers HX-Location /classes/{id}/{encodedName}
  await page.waitForURL(/\/classes\/[0-9a-f-]{36}/);
  return page.url().match(/\/classes\/([0-9a-f-]{36})/)[1];
}

test('a class can be created through the form', async ({ page }) => {
  const name = `${prefix} Created`;
  const id = await createClassViaUi(page, name);

  const { rows } = await db.query(
    'select name, abilities, gear from classes where id = $1', [id]
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe(name);

  // The form fills 9 required name fields; asserting only on classes.name
  // would leave the whole abilities/gear half of the create path unverified.
  // Both are jsonb arrays on `classes` (NOT the class_abilities/class_gear
  // tables -- those are character-scoped and require a character_id).
  expect(rows[0].abilities.map((a) => a.name))
    .toEqual([1, 2, 3].map((n) => `${prefix} Ability ${n}`));
  expect(rows[0].gear.map((g) => g.name))
    .toEqual([1, 2, 3, 4, 5, 6].map((n) => `${prefix} Gear ${n}`));
});

test('the class page shows the class that was just created', async ({ page }) => {
  const name = `${prefix} Viewable`;
  const id = await createClassViaUi(page, name);

  await page.goto(`/classes/${id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).toContainText(name);
});

test('editing a class round-trips the change to the database', async ({ page }) => {
  const name = `${prefix} Editable`;
  const id = await createClassViaUi(page, name);
  const renamed = `${prefix} Edited`;

  await page.goto(`/classes/${id}/edit`);
  await page.waitForLoadState('networkidle');
  await page.locator('#class-name').fill(renamed);
  await page.locator(`form[hx-put="/classes/${id}"] button[type="submit"]`).click();

  // NOT page.waitForURL(/\/classes\/[0-9a-f-]{36}/) here: the page is
  // already sitting on /classes/{id}/edit, which also matches that regex,
  // so the predicate is trivially true before the PUT even lands and the
  // wait resolves instantly instead of synchronizing on the navigation.
  // Poll Postgres directly instead.
  await expect.poll(async () => {
    const { rows } = await db.query('select name from classes where id = $1', [id]);
    return rows[0]?.name;
  }, { timeout: 15_000 }).toBe(renamed);
});

test('a class can be deleted from the My PCCs list', async ({ page }) => {
  const name = `${prefix} Deletable`;
  const id = await createClassViaUi(page, name);

  page.on('dialog', (d) => d.accept());
  await page.goto('/classes/my');
  await page.waitForLoadState('networkidle');

  await page.locator(`#row-${id} button:has-text("Delete")`).click();

  // Asserted against Postgres, not the DOM: with the pre-fix 204 the row
  // stays on screen even on success, so a row-count assertion cannot tell
  // success from failure.
  await expect.poll(async () => {
    const { rows } = await db.query('select id from classes where id = $1', [id]);
    return rows.length;
  }, { timeout: 15_000 }).toBe(0);

  // And the list must actually repaint -- this is the half the 204 broke.
  await expect(page.locator(`#row-${id}`)).toHaveCount(0);
});

// Issue #139: every textarea[data-toast-editor] on this form got its own
// ToastUI Editor, and ToastUI's `autofocus` option defaults to true -- each
// editor focused itself and scrolled itself into view on creation, so the
// form opened partway down the page with the caret already in an editor.
// public/js/app.js passes autofocus:false; this is the guard.
test('the new-class form opens at the top, not inside an editor', async ({ page }) => {
  await page.goto('/classes/new');
  await page.waitForLoadState('networkidle');

  // Wait for the editors to actually mount -- asserting scroll position
  // before they initialise would pass no matter what they do afterwards.
  await expect(page.locator('.toastui-editor-ww-container .ProseMirror').first()).toBeVisible();

  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(
    () => !!document.activeElement.closest('.toastui-editor-container')
  )).toBe(false);
});

test('a class can be deleted from its own detail page', async ({ page }) => {
  const name = `${prefix} Detail Deletable`;
  const id = await createClassViaUi(page, name);

  page.on('dialog', (d) => d.accept());
  await page.goto(`/classes/${id}`);
  await page.waitForLoadState('networkidle');

  await page.locator('button:has-text("Delete")').click();

  await expect.poll(async () => {
    const { rows } = await db.query('select id from classes where id = $1', [id]);
    return rows.length;
  }, { timeout: 15_000 }).toBe(0);

  // The other half of this button's fix: with hx-target="closest tr" on a
  // page that has no <tr>, htmx aborted at issueAjaxRequest with
  // htmx:targetError before the request (and before the confirm dialog), so
  // nothing happened at all. Navigating away at all proves the DELETE was
  // actually issued and its HX-Location honoured. The destination is /classes
  // rather than /classes/my because the route sends you back to the list you
  // came from, and this delete came from the detail page (routes/classes.js).
  await page.waitForURL((url) => url.pathname === '/classes', { timeout: 15_000 });
});
