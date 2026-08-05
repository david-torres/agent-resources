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
  //
  // NOTE for anyone mutation-testing defaultSettleDelay: this wait (and its
  // twin in the third test) pushes every click >= 500 ms past the preceding
  // swap, which hides the SECOND hazard a non-zero delay causes -- htmx does
  // not install hx-boost's click handlers on swapped-in anchors until the
  // settle tasks run, so for `settleDelay` ms after any swap the links inside
  // it fall back to full page loads. Delete both waits to observe that one.
  // The `is-active` race asserted below reproduces with the waits in place.
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

  // THE assertion this whole spec exists for, and it MUST be a single
  // non-retrying snapshot taken before any web-first assertion runs.
  //
  // The settle race is transient: it lasts exactly `defaultSettleDelay` ms and
  // then htmx itself clears it. `await expect(menu).not.toHaveClass(...)` is a
  // retrying assertion with a 10 s budget (playwright.config.js:32), so it
  // polls straight past a 300 ms flash and reports "closed" -- it can only
  // prove the navbar ENDS UP closed, never that it ARRIVES closed, which is
  // the claim in this test's name. Verified: at defaultSettleDelay 300 the
  // retrying form passes while the menu is demonstrably `display: block` on
  // arrival; the snapshot below fails.
  //
  // The mechanism it catches (htmx 2.0.8 insertNodesBefore -> handleAttributes):
  // for any id present in both documents -- #navbar-menu and #navbar-burger
  // qualify on every boosted nav -- htmx clones the OLD node's attributes onto
  // the new one and queues restoring the new ones as a settle task. Alpine
  // cannot undo that: `bindClasses` is additive-with-undo, so `open &&
  // 'is-active'` -> false -> setClassesFromString(el, '') removes nothing,
  // because Alpine only ever removes classes it added itself. An is-active
  // planted by htmx is invisible to it, and the menu is open on screen with
  // Alpine sitting there insisting `open === false`.
  const arrival = await page.evaluate(() => {
    const menu = document.querySelector('#navbar-menu');
    const burger = document.querySelector('#navbar-burger');
    const root = menu && menu.closest('[x-data]');
    return {
      swapped: window.__preNav === true, // survived => body swap, not a reload
      menuPresent: !!menu,
      menuHasIsActive: !!menu && menu.classList.contains('is-active'),
      burgerHasIsActive: !!burger && burger.classList.contains('is-active'),
      menuDisplay: menu ? getComputedStyle(menu).display : null,
      // Diagnostics only, deliberately NOT asserted: Alpine initialises via a
      // MutationObserver, so at this exact instant it may not have adopted the
      // swapped-in nav yet and either value would be legitimately racy. They
      // ride along so a failure prints "open: false but display: block" --
      // the signature that distinguishes the settle race from Alpine simply
      // being open. The retrying liveness check below is what proves the
      // component is alive.
      alpineInitialised: !!(root && root._x_dataStack),
      alpineOpen: root && root._x_dataStack ? root._x_dataStack[0].open : null
    };
  });

  // toMatchObject, not five separate expects, so one failure reports every
  // field at once. Its diff prints only the compared keys, so the diagnostics
  // ride in via the custom message instead.
  expect(arrival, `navbar on arrival: ${JSON.stringify(arrival)}`).toMatchObject({
    swapped: true,
    menuPresent: true, // positive precondition -- a blank swap must not pass
    menuHasIsActive: false,
    burgerHasIsActive: false,
    menuDisplay: 'none' // Bulma shows .navbar-menu only when .is-active here
  });

  // Steady state, after the settle has had every chance to fire. Weaker than
  // the snapshot (see above) but it catches a LATE re-open the snapshot would
  // miss, so both are kept.
  const newBurger = page.locator('#navbar-burger');
  await expect(newBurger).toBeVisible();
  await expect(page.locator('#navbar-menu')).not.toHaveClass(/is-active/);
  await expect(newBurger).not.toHaveClass(/is-active/);

  // ...and closed because Alpine says so, not because Alpine is dead. If the
  // swapped body never got re-initialised, `:class` would never apply and every
  // negative assertion above would pass for the wrong reason (lesson 5).
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

  // The boosted click's response body IS the server-rendered character page,
  // so capturing it costs one listener and closes a gap the DOM cannot: by the
  // time anything is queryable Alpine has already stripped x-cloak, so
  // deleting `x-cloak` from views/character.handlebars:227 leaves every
  // DOM-level assertion in this test passing while reintroducing a real FOUC
  // (the editor renders expanded until Alpine boots). Asserting the attribute
  // is present in the markup and absent from the live DOM pins both halves.
  const swapResponse = page.waitForResponse(
    (r) => r.url().includes(`/characters/${character.id}`) && r.status() === 200
  );
  await link.click();
  const html = await (await swapResponse).text();
  expect(html).toMatch(/<div id="statsEditor"[^>]*\sx-cloak[\s>]/);

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
