// e2e/specs/21-classes-crud.spec.js
//
// Player-created class lifecycle through the real UI.
//
// D3 -- THE DELETE BUTTON IS INERT. routes/classes.js:759 answers 204 No
// Content, and htmx does not swap on 204. Both delete triggers
// (my-classes.handlebars:115 targeting #row-<id>, class-view.handlebars:29
// targeting "closest tr" on a page that HAS no <tr>) therefore leave the row
// on screen even when the delete succeeded. The delete test below asserts
// against Postgres, which is the only way to tell "it worked but did not
// repaint" from "it did nothing".
//
// The abilities/gear rows are FIXED-COUNT and server-rendered -- exactly 3
// and 6, via {{#times}} (class-form.handlebars:157, :185). There is no
// add-row UI. All 9 name fields are `required`, so a valid create must fill
// every one.
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
  // #class-description is required and data-toast-editor -- write into the
  // ProseMirror, not the hidden textarea.
  //
  // TWO ProseMirrors exist per editor: ToastUI mounts a markdown-mode one and a
  // WYSIWYG-mode one simultaneously, and the markdown one comes FIRST in the
  // DOM while being 0x0 and hidden. A positional selector (.first(), .last(),
  // nth) picks the wrong one and .fill() then times out -- this cost Task 6 a
  // fix round. Scope to the WYSIWYG container explicitly, and assert
  // visibility first so a regression fails here rather than inside .fill().
  const descEditor = page.locator('#class-description')
    .locator('xpath=following-sibling::div[contains(@class,"toastui-editor-container")][1]')
    .locator('.toastui-editor-ww-container .ProseMirror');
  await expect(descEditor).toBeVisible();
  await descEditor.fill(`${name} description`);

  const abilities = form.locator('input[name="ability_name[]"]');
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

  const { rows } = await db.query('select name from classes where id = $1', [id]);
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe(name);
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

  // And the list must actually repaint -- this is the half D3 breaks.
  await expect(page.locator(`#row-${id}`)).toHaveCount(0);
});
