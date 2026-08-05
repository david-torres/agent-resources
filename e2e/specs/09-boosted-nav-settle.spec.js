// ar-7v3k check 2 -- the whole reason `defaultSettleDelay: 0` exists in
// views/partials/head.handlebars:4.
//
// htmx's settle phase restores class/style attributes it captured BEFORE
// Alpine wrote to them. With a non-zero settle delay, a navbar that Alpine
// re-initialises closed after a boosted <body> swap can have its `is-active`
// class restored by the settle, and the menu arrives OPEN on the new page.
// jsdom has no htmx and no real navigation, so this race is structurally
// unreachable from the unit, http, and integration tiers.
//
// hx-boost="true" is on <body> (views/layouts/main.handlebars:5), so every
// same-origin anchor in the document is boosted. The navbar is
// `x-data="{ open: false }"` with `:class="open && 'is-active'"` on both
// #navbar-burger and #navbar-menu (views/partials/nav.handlebars:6,14).
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({
  storageState: ADMIN_STATE,
  // Bulma hides .navbar-burger (and unconditionally shows .navbar-menu) at
  // >= 1024px, so the burger is unclickable and `is-active` is visually
  // meaningless on a desktop viewport. 500x900 is load-bearing, not cosmetic.
  viewport: { width: 500, height: 900 }
});

const prefix = newPrefix('boostnav');
let db;
let character;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  const classRow = await seedClass(prefix);
  // Owned by the signed-in admin so it appears on GET /characters
  // (models/character.js getOwnCharacters filters `creator_id = profile.id`),
  // which is where the boosted link in the third test is clicked from.
  character = await seedCharacter(prefix, profile, classRow);
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test('htmx-config pins the settle delay to zero', async ({ page }) => {
  await page.goto('/');
  const config = await page.locator('meta[name="htmx-config"]').getAttribute('content');
  expect(JSON.parse(config).defaultSettleDelay).toBe(0);
});

test('the navbar menu arrives closed after a boosted navigation', async ({ page }) => {
  await page.goto('/');
  // public/js/app.js's start() -> redirectTo() replaces <body> via an
  // outerHTML htmx swap on EVERY authed page load (see the comment at
  // app.js:725-729). That swap discards the Alpine nav component and rebuilds
  // it with `open: false`, so a burger click issued before it lands is simply
  // thrown away. Waiting for the network to go quiet pins the starting state
  // to "post-auth-swap", which is the only way the assertions after the
  // boosted navigation below are about the NAVIGATION's settle rather than the
  // page-load one.
  await page.waitForLoadState('networkidle');

  const burger = page.locator('#navbar-burger');
  const menu = page.locator('#navbar-menu');

  await burger.click();
  await expect(menu).toHaveClass(/is-active/);
  await expect(burger).toHaveClass(/is-active/);

  // Deliberately NOT `#navbar-menu a[href]:not([href^="http"])`.first(): the
  // nav is data-driven (util/nav-loader.js fills navItems from the DB) and
  // views/partials/nav-item.handlebars renders dropdown parents -- and any
  // malformed nav row -- as `href="#"`, which .first() would happily pick and
  // which navigates nowhere. The Profile link is emitted unconditionally for
  // any signed-in user (views/partials/nav.handlebars:25), so this selector
  // does not depend on the local nav seed.
  const link = menu.locator('a[href="/profile"]');
  await expect(link).toBeVisible();

  // A boosted click swaps <body> in place; a full page load would replace the
  // whole document, tear Alpine down, and re-initialise the navbar closed for
  // trivial reasons -- passing the assertion below while proving nothing about
  // the settle race. A window-scoped sentinel survives a swap and dies on a
  // reload, so this is what makes the rest of the test load-bearing.
  await page.evaluate(() => { window.__preNav = true; });
  await link.click();
  await page.waitForURL((url) => url.pathname === '/profile');
  expect(await page.evaluate(() => window.__preNav)).toBe(true);

  // Positive precondition: the swapped-in body really rendered a navbar. A
  // blank or errored swap would also satisfy every `not.toHaveClass` below.
  const newBurger = page.locator('#navbar-burger');
  await expect(newBurger).toBeVisible();

  // The assertion the settle race would break.
  await expect(page.locator('#navbar-menu')).not.toHaveClass(/is-active/);
  await expect(newBurger).not.toHaveClass(/is-active/);

  // ...and closed because Alpine says so, not because Alpine is dead. If the
  // swapped body never got re-initialised, `:class` would never apply and the
  // two negative assertions above would pass for the wrong reason (lesson 5).
  await newBurger.click();
  await expect(page.locator('#navbar-menu')).toHaveClass(/is-active/);
});

test('a hidden x-show element stays hidden across a boosted body swap', async ({ page }) => {
  // ar-7v3k records this as the one part of acceptance criterion 2 with no
  // test: x-show combined with a real boosted swap.
  //
  // The destination must genuinely contain an x-show/x-cloak element. The home
  // page has none, so the plan's draft (`for i < await cloaked.count()` over
  // `[x-cloak]` on `/`) iterated zero elements and asserted nothing. A
  // character page has #statsEditor (`x-show="editing" x-cloak`,
  // views/character.handlebars:227), reached here by CLICKING a boosted link
  // from the character list -- page.goto would be a full load and would prove
  // nothing about the swap.
  await page.goto('/characters');
  await page.waitForLoadState('networkidle'); // see the auth-swap note above

  const link = page.locator(`a[href^="/characters/${character.id}/"]`).first();
  await expect(link).toBeVisible();

  await page.evaluate(() => { window.__preNav = true; });
  await link.click();
  await page.waitForURL((url) => url.pathname.startsWith(`/characters/${character.id}`));
  expect(await page.evaluate(() => window.__preNav)).toBe(true); // swapped, not reloaded

  const editor = page.locator('#statsEditor');

  // Positive precondition first (lesson 4): the element exists at all. Without
  // this, every "hidden" assertion below passes on an empty page.
  await expect(editor).toHaveCount(1);

  // Alpine strips the x-cloak attribute the moment it initialises the element,
  // and public/css/styles.css:1336 hides anything still carrying it. Asserting
  // the attribute is GONE before asserting hidden is what separates "x-show
  // kept it hidden" from "Alpine never ran and the cloak CSS hid it" -- the
  // latter would be a swap that silently killed Alpine.
  await expect(page.locator('#statsEditor:not([x-cloak])')).toHaveCount(1);
  await expect(editor).toBeHidden();

  // And the component behind x-show is live on the swapped-in body: Edit
  // toggles `editing`, which is the only thing that can reveal the editor.
  await page.locator('#statsUnlockBtn').click();
  await expect(editor).toBeVisible();
});
