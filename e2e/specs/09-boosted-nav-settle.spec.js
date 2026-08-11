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
  // THE instrument this whole spec exists for. It records, from inside the
  // page, what the browser actually PAINTED on every animation frame after the
  // swap -- it does not sample once and hope to land inside the bad window.
  //
  // Why a paint recorder and not a snapshot. Read htmx 2.0.8's swap() (line
  // 2016 of the unminified dist):
  //
  //     if (swapSpec.settleDelay > 0) { setTimeout(doSettle, settleDelay) }
  //     else                          { doSettle() }
  //
  // At the shipped `defaultSettleDelay: 0` doSettle runs SYNCHRONOUSLY, in the
  // same task as the swap, so the bad state cannot survive to a paint. At any
  // value above 0 it becomes a setTimeout macrotask and the browser is free to
  // render the intermediate state. "Did a frame ever render with the menu
  // open" is therefore the exact discriminator between the two configs -- and
  // it is also the precise definition of the user-visible defect.
  //
  // The bad state itself (htmx insertNodesBefore -> handleAttributes, line
  // 1558): for any id present in both documents -- #navbar-menu and
  // #navbar-burger qualify on every boosted nav -- htmx clones the OLD node's
  // attributes onto the new one and pushes restoring the new ones onto
  // settleInfo.tasks. Alpine cannot undo that: bindClasses is
  // additive-with-undo, so `open && 'is-active'` -> false ->
  // setClassesFromString(el, '') removes nothing, because Alpine only ever
  // removes classes it added itself. An is-active planted by htmx is invisible
  // to it, and the menu sits open on screen while Alpine insists open === false.
  //
  // A single non-retrying snapshot (what this used to be) races the CDP
  // round-trip against the settle window and is a coin flip at small delays --
  // measured at 50-95% detection at htmx's own default of 20ms. The first
  // animation frame after a swap lands within one frame interval (~16.7ms at
  // 60Hz), which is inside any settle window >= one frame, so this form is
  // deterministic where the flash is perceptible at all. See the report for
  // the honest sensitivity boundary.
  await page.evaluate(() => {
    window.__preNav = true; // sentinel: survives a body swap, dies on a reload
    const probe = { swapObserved: false, frames: [] };
    window.__navProbe = probe;

    const sampleFrame = () => {
      const menu = document.querySelector('#navbar-menu');
      const burger = document.querySelector('#navbar-burger');
      const nav = menu && menu.closest('[x-data]');
      let alpineInitialised = false;
      let alpineOpen = null;
      try {
        // NOT `!!Alpine.$data(nav)`: $data falls back to mergeProxies([]) and
        // hands back a truthy Proxy for ANY element, even one with no x-data
        // ancestor, so truthiness alone would be vacuous. Presence of the key
        // the navbar's own x-data declares is the real initialisation test.
        const data = nav && window.Alpine ? window.Alpine.$data(nav) : null;
        alpineInitialised = !!data && 'open' in data;
        alpineOpen = alpineInitialised ? data.open : null;
      } catch (_) { /* Alpine absent -> stays false, which fails below */ }
      return {
        t: Math.round(performance.now()),
        // Recorded separately from the class/display readings so that "the
        // navbar is not there at all" cannot masquerade as "the navbar is
        // painted open" -- see framesNavbarMissing below.
        menuPresent: !!menu,
        burgerPresent: !!burger,
        menuIsActive: !!menu && menu.classList.contains('is-active'),
        burgerIsActive: !!burger && burger.classList.contains('is-active'),
        display: menu ? getComputedStyle(menu).display : null,
        alpineInitialised,
        alpineOpen
      };
    };

    // Frames are only meaningful after the swap -- before it the menu is open
    // because this test just opened it. Both the listener and the probe hang
    // off objects a boosted swap does not replace (document, window).
    document.addEventListener('htmx:afterSwap', () => {
      probe.swapObserved = true;
      const tick = () => {
        if (probe.frames.length >= 12) return; // ~200ms of frames is plenty
        probe.frames.push(sampleFrame());
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { once: true });
  });

  await link.click();
  await page.waitForURL((url) => url.pathname === '/profile');

  // Checked first and on its own so the hx-boost-removal failure mode reports
  // as "full page load", not as a confusing timeout on the probe below (a real
  // navigation destroys window.__navProbe along with the document).
  expect(
    await page.evaluate(() => window.__preNav === true),
    'expected a boosted body swap; a full page load would tear down Alpine and make every assertion below trivial'
  ).toBe(true);

  await page.waitForFunction(
    () => window.__navProbe && window.__navProbe.frames.length >= 3,
    null,
    { timeout: 10_000 }
  );
  const probe = await page.evaluate(() => window.__navProbe);

  const summary = {
    swapObserved: probe.swapObserved,
    framesSampled: probe.frames.length,
    // The navbar has to BE there before "is it open" is even a question.
    // Split out as its own signal (Task 11 fix round 2) after the earlier
    // version of this filter was shown to score a MISSING #navbar-menu as
    // "painted open": getComputedStyle is never reached when the element is
    // absent, `display` records null, and `null !== 'none'`. A swap that
    // produced no navbar at all would therefore have been reported as the
    // settle race -- the wrong diagnosis, which is worse than none. Verified
    // on the sibling spec (10-back-button-snapshot) against a mutation that
    // really does empty <body>.
    framesNavbarMissing: probe.frames.filter((f) => !f.menuPresent || !f.burgerPresent).length,
    // The defect: a frame the browser rendered with the menu on screen. Each
    // element's readings are gated on that element existing, so this counts
    // only frames that genuinely painted a navbar open.
    framesPaintedOpen: probe.frames.filter((f) => (
      (f.menuPresent && (f.menuIsActive || f.display !== 'none')) ||
      (f.burgerPresent && f.burgerIsActive)
    )).length,
    // Positive precondition, per frame. Without it a regression that stopped
    // Alpine adopting the swapped-in nav would sail through the line above:
    // Bulma hides .navbar-menu without .is-active anyway, so a DEAD navbar
    // paints identically to a correctly-closed one. 149/149 observed runs had
    // this true, so it is signal, not noise.
    framesWithoutAlpine: probe.frames.filter((f) => !f.alpineInitialised).length,
    // Alpine's own state must agree it is closed. Disagreement here would be a
    // different bug (component state surviving a swap) worth failing on.
    framesAlpineOpen: probe.frames.filter((f) => f.alpineOpen === true).length
  };

  expect(summary.framesSampled).toBeGreaterThanOrEqual(3);
  expect(summary, `navbar paint probe: ${JSON.stringify(probe)}`).toMatchObject({
    swapObserved: true,
    framesNavbarMissing: 0,
    framesPaintedOpen: 0,
    framesWithoutAlpine: 0,
    framesAlpineOpen: 0
  });

  // Steady state, after the settle has had every chance to fire. Weaker than
  // the probe (it is a retrying assertion, so it cannot see a transient) but it
  // catches a LATE re-open the 12-frame window would miss, so both are kept.
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
  const href = await link.getAttribute('href');

  await page.evaluate(() => { window.__preNav = true; });

  // The boosted click's response body IS the server-rendered character page,
  // so capturing it costs one listener and closes a gap the DOM cannot: by the
  // time anything is queryable Alpine has already stripped x-cloak, so
  // deleting `x-cloak` from views/character.handlebars:227 leaves every
  // DOM-level assertion in this test passing while reintroducing a real FOUC
  // (the editor renders expanded until Alpine boots). Asserting the attribute
  // is present in the markup and absent from the live DOM pins both halves.
  // Matched on the exact pathname, not `.includes('/characters/<id>')`:
  // routes/characters.js also serves /:id/edit, /:id/export,
  // /:id/auto-calc-fields and /:id/offscreen-missions/... , all of which
  // contain that substring. None is requested during this flow today, so the
  // loose form was not a live flake -- this is insurance against a future
  // second request sharing the fragment. Decoded before comparing because the
  // request URL percent-encodes the name segment while the href attribute does
  // not (identical for the fixture's alphanumeric name, but not in general).
  const swapResponse = page.waitForResponse(
    (r) => decodeURIComponent(new URL(r.url()).pathname) === href && r.status() === 200
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
