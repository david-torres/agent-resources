// e2e/specs/20-lfg-crud.spec.js
//
// LFG lifecycle: create -> view -> edit -> join -> leave -> delete.
//
// FOUR TRAPS THIS FILE IS BUILT AROUND, all measured and documented in
// 14-lfg-controls.spec.js:
//
//   1. #character-select is used by BOTH partials/lfg-form.handlebars:35 and
//      partials/lfg-join-form.handlebars:20, and both can be on screen at
//      once. Every locator here is scoped to its own form.
//   2. lfg_posts.host_id is NOT the source of truth -- models/lfg.js
//      #applyConduitMeta overwrites it on every read from the approved
//      conduit join request. Never raw-insert a post with host_id; go
//      through seedLfgPost, or create it via the UI as this spec does.
//   3. button:has-text("Join") also matches "Unjoin" and "Unjoin as Conduit"
//      (has-text is substring). Use :text-is("Join").
//   4. Both "Edit" and "View Join Requests" on the My Posts tab carry
//      hx-target="closest table" hx-swap="outerHTML" -- clicking either
//      DESTROYS the whole table, so any locator captured from another row
//      beforehand goes stale.
//
// NAVIGATION: PUT /lfg/:id answers HX-Location /lfg -- editing returns you to
// the list, not to the post (routes/lfg.js:150).
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass, unlockClassForProfile } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');

test.use({ storageState: PLAYER_STATE });

const prefix = newPrefix('lfg-crud');
let db;
let profile;
let classRow;
let character;

test.beforeAll(async () => {
  db = await connect();
  profile = await profileForEmail(db, PLAYER_EMAIL);
  classRow = await seedClass(prefix, { rulesVersion: 'v1' });
  await unlockClassForProfile(profile, classRow);
  character = await seedCharacter(prefix, profile, classRow);
});

test.afterAll(async () => {
  try {
    await cleanupByPrefix(db, prefix);
  } finally {
    await db.end();
  }
});

// The create form arrives via htmx: the button at lfg.handlebars:9-11 has no
// hx-target, so it replaces itself with partials/lfg-form.
async function openCreateForm(page) {
  await page.goto('/lfg');
  await page.waitForLoadState('networkidle');
  await page.locator('#create-post button:has-text("Create LFG Post")').click();
  const form = page.locator('form:has(input[name="host_id"])');
  await expect(form).toBeVisible();
  // Alpine liveness -- 'hosting' is the component's own key. Never
  // !!Alpine.$data(el), which is truthy for any element.
  await expect.poll(async () => page.evaluate(() => {
    const f = document.querySelector('form:has(input[name="host_id"])');
    return f && window.Alpine ? 'hosting' in window.Alpine.$data(f) : false;
  })).toBe(true);
  return form;
}

async function createPostViaUi(page, title) {
  const form = await openCreateForm(page);
  await form.locator('#lfg-title').fill(title);
  // #lfg-description is required AND data-toast-editor, so the real textarea
  // is display:none and fill() would throw. Write into the ProseMirror the
  // editor put in its place.
  //
  // ToastUI keeps TWO .ProseMirror nodes in the DOM at once -- a hidden
  // Markdown-source one (.toastui-editor-md-container) and the visible
  // WYSIWYG one (.toastui-editor-ww-container) -- and the hidden one comes
  // first in DOM order. A positional `.first()`/`.last()` is fragile against
  // ToastUI's internal ordering; scope by the WYSIWYG container class
  // instead, and assert visibility before filling so a future regression
  // that hides this editor fails loudly here, not inside .fill()'s retry loop.
  const wysiwygEditor = form.locator('.toastui-editor-ww-container .ProseMirror');
  await expect(wysiwygEditor).toBeVisible();
  await wysiwygEditor.fill(`${title} description`);
  await form.locator('#lfg-date').fill('2027-05-06T18:00');
  await form.locator('button[type="submit"]:has-text("Create LFG Post")').click();

  // POST /lfg answers HX-Location /lfg -- but openCreateForm() reached this
  // form via an htmx self-swap on that SAME /lfg URL, so the pathname never
  // actually changes and `page.waitForURL(pathname === '/lfg')` resolves
  // immediately (the predicate is already true before the click), not after
  // the request completes. Poll the actual source of truth instead of
  // relying on a URL transition that doesn't happen.
  await expect.poll(async () => {
    const { rows } = await db.query('select id from lfg_posts where title = $1', [title]);
    return rows.length;
  }, { timeout: 15_000 }).toBe(1);
  const { rows } = await db.query(
    'select id from lfg_posts where title = $1', [title]
  );
  expect(rows, 'the post must exist before any later stage asserts on it').toHaveLength(1);
  return rows[0].id;
}

test('an LFG post can be created through the form', async ({ page }) => {
  const title = `${prefix} Created`;
  const id = await createPostViaUi(page, title);

  const { rows } = await db.query(
    'select title, description from lfg_posts where id = $1', [id]
  );
  expect(rows[0].title).toBe(title);
  expect(rows[0].description).toContain('description');
});

test('the post detail page shows the post that was just created', async ({ page }) => {
  const title = `${prefix} Viewable`;
  const id = await createPostViaUi(page, title);

  await page.goto(`/lfg/${id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).toContainText(title);
});

test('editing an LFG post round-trips the change to the database', async ({ page }) => {
  const title = `${prefix} Editable`;
  const id = await createPostViaUi(page, title);
  const renamed = `${prefix} Edited`;

  // Direct URL rather than the My Posts Edit button: that button replaces the
  // whole table (trap 4) and this test is about the save, not the swap.
  await page.goto(`/lfg/${id}/edit`);
  await page.waitForLoadState('networkidle');

  const form = page.locator('form:has(input[name="host_id"])');
  await form.locator('#lfg-title').fill(renamed);
  await form.locator('button[type="submit"]:has-text("Update LFG Post")').click();

  // PUT /lfg/:id answers HX-Location /lfg, NOT /lfg/:id
  await page.waitForURL((url) => url.pathname === '/lfg');

  const { rows } = await db.query('select title from lfg_posts where id = $1', [id]);
  expect(rows[0].title).toBe(renamed);
});

test('a player can join a post with a character and then leave it', async ({ page }) => {
  const title = `${prefix} Joinable`;
  const id = await createPostViaUi(page, title);

  await page.goto(`/lfg/${id}`);
  await page.waitForLoadState('networkidle');

  // :text-is, not :has-text -- trap 3.
  await page.locator('button:text-is("Join")').click();

  const joinForm = page.locator('form:has(#join-player-opt)');
  await expect(joinForm).toBeVisible();
  // Scoped to the join form -- trap 1.
  await joinForm.locator('select[name="characterId"]').selectOption(character.id);
  await joinForm.locator('button[type="submit"]:has-text("Request to Join")').click();

  // POST /lfg/:id/join answers HX-Location /lfg/:id
  await page.waitForURL((url) => url.pathname === `/lfg/${id}`);

  await expect.poll(async () => {
    const { rows } = await db.query(
      'select count(*)::int as n from lfg_join_requests where lfg_post_id = $1 and character_id = $2',
      [id, character.id]
    );
    return rows[0].n;
  }, { timeout: 15_000 }).toBe(1);

  // Leave again.
  page.on('dialog', (d) => d.accept());
  await page.goto(`/lfg/${id}`);
  await page.waitForLoadState('networkidle');
  await page.locator('button:text-is("Unjoin")').click();
  await page.waitForURL((url) => url.pathname.startsWith('/lfg'));

  await expect.poll(async () => {
    const { rows } = await db.query(
      'select count(*)::int as n from lfg_join_requests where lfg_post_id = $1 and character_id = $2',
      [id, character.id]
    );
    return rows[0].n;
  }, { timeout: 15_000 }).toBe(0);
});

test('an LFG post can be deleted from the My Posts tab', async ({ page }) => {
  const title = `${prefix} Deletable`;
  const id = await createPostViaUi(page, title);

  page.on('dialog', (d) => d.accept());
  await page.goto('/lfg');
  await page.waitForLoadState('networkidle');

  // My Posts is pre-rendered server-side into #lfg-content
  // (lfg.handlebars:22-23) -- no tab click needed on first load.
  const row = page.locator('#lfg-posts tr', { hasText: title });
  await expect(row).toBeVisible();
  await row.locator('button:has-text("Delete")').click();

  // routes/lfg.js:160 answers HX-Location /lfg
  await expect.poll(async () => {
    const { rows } = await db.query('select id from lfg_posts where id = $1', [id]);
    return rows.length;
  }, { timeout: 15_000 }).toBe(0);
});
