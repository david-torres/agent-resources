// ar-7v3k check 12 -- the back button after a boosted navigation.
//
// htmx caches a DOM snapshot for history restoration. The snapshot is
// `cleanInnerHtmlForHistory(document.body)` (htmx 2.0.8, dist line 3238) taken
// at the moment you navigate AWAY -- i.e. long after Alpine stripped x-cloak
// and wrote its `:class` output into the live DOM. Everything Alpine had
// computed is therefore frozen into the cached markup as literal attributes,
// and comes back on the next popstate as plain HTML with a freshly
// re-initialised (and therefore disagreeing) component behind it.
//
// This spec answers, and pins down, the question that decides whether that
// hazard is reachable at all in this app: does the back button run an htmx
// history restore, or a full page load? A full load re-renders from the server
// and re-initialises Alpine from scratch, which would make the hazard
// structurally impossible -- and would make a naive "the menu is closed after
// going back" assertion pass for entirely the wrong reason. Test 1 exists so
// that question is never silently answered by accident.
//
// Measured answer (see task-11-report.md): it is a genuine htmx history
// restore from the sessionStorage snapshot cache. Same document, no document
// request, popstate carrying htmx's own `{htmx: true}` state.
//
// Viewport 500x900 is load-bearing, not cosmetic: Bulma hides .navbar-burger
// and unconditionally shows .navbar-menu at >= 1024px, so `is-active` is
// visually meaningless above that width and the burger is unclickable.
// The boundary is Bulma's 1024px breakpoint and nothing else, so the defect
// test 3 characterises reaches ANY viewport under 1024px -- phones (390),
// tablets (768, confirmed) and any merely-narrowed desktop window alike. It is
// not a mobile-only defect; calling it one understates the blast radius.
const { test, expect } = require('@playwright/test');
const { ADMIN_STATE } = require('../global-setup');

test.use({
  storageState: ADMIN_STATE,
  viewport: { width: 500, height: 900 }
});

// Installed on /profile immediately before page.goBack(). Everything hangs off
// `document`/`window`, which an innerHTML restore of <body> does not replace,
// so the record survives the restore and dies only on a real page load -- which
// is itself the signal test 1 is looking for.
const armBackProbe = () => {
  const probe = { restoreObserved: false, cacheHitPath: null, popstateState: null, frames: [] };
  window.__backProbe = probe;

  window.addEventListener('popstate', (ev) => {
    // htmx assigns window.onpopstate, so its handler has already run by the
    // time this addEventListener listener fires; recording the state is still
    // the only way to tell "htmx owned this popstate" from "the browser did".
    probe.popstateState = JSON.stringify(ev.state);
  });
  document.addEventListener('htmx:historyCacheHit', (ev) => {
    probe.cacheHitPath = ev.detail && ev.detail.path;
  }, { once: true });
  document.addEventListener('htmx:historyRestore', () => {
    probe.restoreObserved = true;
  }, { once: true });

  // Sample what the browser actually PAINTS, frame by frame, rather than
  // taking one snapshot and hoping to land inside the interesting window
  // (the Task 10 lesson: a CDP round-trip in the critical path makes a
  // detector only as reliable as the round-trip is fast, and a *retrying*
  // assertion cannot see a transient state at all). Hooked on afterSwap
  // rather than historyRestore because afterSwap also fires on htmx's
  // cache-miss path (loadHistoryFromServer), so the recorder still runs --
  // and still produces frames to assert on -- if the restore mechanism ever
  // changes underneath this spec.
  document.addEventListener('htmx:afterSwap', () => {
    const tick = () => {
      if (probe.frames.length >= 12) return; // ~200ms of frames
      const menu = document.querySelector('#navbar-menu');
      const burger = document.querySelector('#navbar-burger');
      const nav = menu && menu.closest('[x-data]');
      let alpineInitialised = false;
      let alpineOpen = null;
      try {
        // NOT `!!Alpine.$data(el)`: $data falls back to mergeProxies([]) and
        // returns a truthy Proxy for ANY element, even one with no x-data
        // ancestor, so bare truthiness is vacuous. Presence of the key the
        // navbar's own x-data declares is the real initialisation test.
        const data = nav && window.Alpine ? window.Alpine.$data(nav) : null;
        alpineInitialised = !!data && 'open' in data;
        alpineOpen = alpineInitialised ? data.open : null;
      } catch (_) { /* Alpine absent -> stays false, which fails below */ }
      probe.frames.push({
        t: Math.round(performance.now()),
        // Recorded separately from the class/display readings so that "the
        // navbar is not there at all" cannot masquerade as "the navbar is
        // painted open" -- see summarise().
        menuPresent: !!menu,
        burgerPresent: !!burger,
        menuIsActive: !!menu && menu.classList.contains('is-active'),
        burgerIsActive: !!burger && burger.classList.contains('is-active'),
        display: menu ? getComputedStyle(menu).display : null,
        alpineInitialised,
        alpineOpen
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { once: true });
};

// Reduces the recorded frames to the five numbers the assertions care about.
const summarise = (probe) => ({
  restoreObserved: probe.restoreObserved,
  framesSampled: probe.frames.length,
  // The navbar has to BE there before "is it open" is even a question. Split
  // out as its own signal after a review caught the earlier version scoring a
  // MISSING #navbar-menu as "painted open": `display` reads null when the
  // element is absent, and `null !== 'none'`. That is a real scenario, not a
  // hypothetical -- it is exactly what the hx-history="false" mutation
  // produces (an empty <body>; see the note above test 3) -- and reporting a
  // blank page as a stuck-open menu is the wrong diagnosis, which is worse
  // than no diagnosis.
  framesNavbarMissing: probe.frames.filter((f) => !f.menuPresent || !f.burgerPresent).length,
  // The user-visible defect: a frame the browser rendered with the menu on
  // screen. Bulma gives .navbar-menu `display: none` until `is-active`, so
  // `display !== 'none'` is the paint-level statement of "the menu is visible"
  // and the class checks are the mechanism-level one. Each element's readings
  // are now gated on that element existing, so this counts only frames that
  // genuinely painted a navbar open.
  framesPaintedOpen: probe.frames.filter((f) => (
    (f.menuPresent && (f.menuIsActive || f.display !== 'none')) ||
    (f.burgerPresent && f.burgerIsActive)
  )).length,
  // Positive precondition, per frame. Without it a regression that stopped
  // Alpine adopting restored content would sail past the line above: a DEAD
  // navbar paints identically to a correctly-closed one, because Bulma hides
  // .navbar-menu without .is-active regardless of whether anything is alive.
  framesWithoutAlpine: probe.frames.filter((f) => !f.alpineInitialised).length,
  // Alpine's own state must agree the menu is closed. Disagreement in EITHER
  // direction is a bug: open state surviving a restore, or (test 3's actual
  // finding) markup surviving that Alpine believes it has already closed.
  framesAlpineOpen: probe.frames.filter((f) => f.alpineOpen === true).length
});

// The boosted hop every test starts with. Deliberately NOT
// `#navbar-menu a[href]:not([href^="http"])`.first(): the nav is data-driven
// (util/nav-loader.js fills navItems from the DB) and
// views/partials/nav-item.handlebars renders dropdown parents -- and any
// malformed nav row -- as href="#", which .first() would happily pick and which
// navigates nowhere. The Profile link is emitted unconditionally for any
// signed-in user (views/partials/nav.handlebars:25), so this does not depend on
// the local nav seed.
const openMenuAndVisitProfile = async (page) => {
  const burger = page.locator('#navbar-burger');
  const menu = page.locator('#navbar-menu');

  // Positive precondition: the burger really TOGGLES the menu. Both halves are
  // load-bearing. Asserting only the second would pass on a menu that was
  // already open and never moved -- which is not hypothetical: with the nav's
  // x-data removed, Alpine still evaluates `:class="open && 'is-active'"`,
  // resolves the bare `open` against the global scope, finds window.open (a
  // function, therefore truthy) and paints the menu open from page load
  // onwards. Measured, not imagined: `{cls: "navbar-menu is-active"}` before
  // any click, and `@click="open = !open"` then writes `false` to window.open
  // itself. The "closed to begin with" assertion is what catches that.
  await expect(menu).not.toHaveClass(/is-active/);
  await burger.click();
  await expect(menu).toHaveClass(/is-active/);

  const link = menu.locator('a[href="/profile"]');
  await expect(link).toBeVisible();

  await page.evaluate(() => { window.__preNav = true; });
  await link.click();
  await page.waitForURL((url) => url.pathname === '/profile');

  // A boosted click swaps <body> in place; a full page load would replace the
  // document, and htmx would never have cached a snapshot to restore. Checked
  // on its own so removing hx-boost reports as "full page load" rather than as
  // a confusing timeout on a probe that no longer exists.
  expect(
    await page.evaluate(() => window.__preNav === true),
    'expected a boosted body swap on the way out; a full page load caches no history snapshot and makes everything below vacuous'
  ).toBe(true);
};

test('the back button is an htmx history restore, not a full page load', async ({ page }) => {
  // This is the load-bearing precondition for the whole file, and the reason
  // check 12 cannot be evaluated by looking at the restored DOM alone: an
  // "everything is fine after going back" assertion means one thing if htmx
  // reinstated a cached snapshot and something completely different if the
  // browser re-fetched and re-rendered the page from the server.
  //
  // Recorded here rather than assumed, because the assumption is not obviously
  // safe. public/js/app.js:986 (`redirectTo`) does
  // `history.replaceState(null, '', url)` on every authed page load, which
  // wipes htmx's `{htmx: true}` marker off the current history entry -- and
  // htmx's window.onpopstate (dist line 5136) only handles a popstate whose
  // state carries that marker. It survives here only because htmx re-marks the
  // entry in saveCurrentPageToHistory (dist line 3270) on the way out of the
  // page, which happens after the auth swap. If that ordering ever changes,
  // this test is what notices.
  //
  // Main-frame document requests only. A full page load is by definition one
  // of those; the home page's YouTube embed also issues a `document` request,
  // and restoring the snapshot re-creates that iframe, so counting every
  // document request would make this assertion flaky for a reason that has
  // nothing to do with the back button.
  const documentRequests = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'document' && r.frame() === page.mainFrame()) {
      documentRequests.push(r.url());
    }
  });

  await page.goto('/');
  // public/js/app.js's redirectTo() replaces <body> via an outerHTML htmx swap
  // on EVERY authed page load (app.js:970-989, reached from :1021/:1023/:1037).
  // Alpine state written before that swap lands is silently discarded -- a
  // confirmed product defect recorded for Task 17, deliberately not fixed here.
  // Waiting for the network to go quiet pins the starting state to
  // "post-auth-swap" so the burger click below is not thrown away.
  await page.waitForLoadState('networkidle');

  await openMenuAndVisitProfile(page);

  const requestsBeforeBack = documentRequests.length;
  await page.evaluate(armBackProbe);
  await page.goBack();
  await page.waitForURL((url) => url.pathname === '/');
  await page.waitForFunction(
    () => window.__backProbe && window.__backProbe.frames.length >= 3,
    null,
    { timeout: 10_000 }
  );

  const observed = await page.evaluate(() => ({
    sentinelSurvived: window.__preNav === true,
    restoreObserved: window.__backProbe.restoreObserved,
    cacheHitPath: window.__backProbe.cacheHitPath,
    popstateState: window.__backProbe.popstateState,
    // Read straight out of htmx's own store: this is the snapshot that will be
    // reinstated, and whether Alpine's output is baked into it is the entire
    // subject of check 12.
    cachedRootSnapshotHasAlpineOutput: (JSON.parse(sessionStorage.getItem('htmx-history-cache') || '[]'))
      .some((item) => item.url === '/' && /<div class="navbar-menu is-active"/.test(item.content))
  }));

  expect(
    { ...observed, documentRequestsDuringBack: documentRequests.length - requestsBeforeBack },
    `back-navigation probe: ${JSON.stringify(observed)}`
  ).toMatchObject({
    // Same document: the window-scoped sentinel set before the outbound
    // boosted click is still there. This dies on any real page load.
    sentinelSurvived: true,
    // ...and no page load was even attempted.
    documentRequestsDuringBack: 0,
    // htmx, not the browser, owned the popstate.
    popstateState: '{"htmx":true}',
    // ...and it served the cached snapshot rather than re-fetching from the
    // server. Both assertions are needed: htmx's cache-miss path
    // (loadHistoryFromServer, dist line 3307) ALSO fires htmx:historyRestore,
    // with `cacheMiss: true` on the detail -- measured, not assumed, by
    // forcing a miss with historyCacheSize: 1. htmx:historyCacheHit is the
    // only event that separates the two paths, so cacheHitPath is the real
    // discriminator and restoreObserved alone would not be.
    restoreObserved: true,
    cacheHitPath: '/',
    // The hazard's mechanism, asserted rather than assumed: Alpine's computed
    // `is-active` is frozen into htmx's cached markup as a literal class.
    //
    // TRIPWIRE, deliberately: if someone fixes the defect test 3
    // characterises by taking the snapshot out of play (hx-history="false" on
    // the layout, historyCacheSize 0, or an hx-history-elt that excludes the
    // navbar), this expectation flips and test 3 goes green. That is the
    // correct signal to revisit this file on purpose -- not a regression.
    cachedRootSnapshotHasAlpineOutput: true
  });
});

test('a page navigated away from with the menu closed comes back closed and live', async ({ page }) => {
  // The positive control for test 3, and a genuine regression guard in its own
  // right: it proves htmx's history restore re-initialises Alpine correctly on
  // restored content. Without it, test 3's failure could be read as "history
  // restore breaks Alpine", which is NOT what is happening -- Alpine is fully
  // alive on a restored page, it just cannot remove a class it never added.
  //
  // Route: / -> (menu open, the only way to reach a nav link at this viewport)
  // -> /profile -> brand link back to / with the menu CLOSED, which is what
  // makes htmx's snapshot of /profile clean -> back restores that clean
  // snapshot. The snapshot's cleanliness is the whole difference between this
  // test and test 3.
  await page.goto('/');
  await page.waitForLoadState('networkidle'); // see the auth-swap note in test 1

  await openMenuAndVisitProfile(page);

  // .navbar-brand is outside .navbar-menu, so it is clickable with the menu
  // closed -- which /profile arrives as (Task 10, spec 09, proves that).
  const brand = page.locator('.navbar-brand a[href="/"]');
  await expect(brand).toBeVisible();
  await expect(page.locator('#navbar-menu')).not.toHaveClass(/is-active/);
  await brand.click();
  await page.waitForURL((url) => url.pathname === '/');
  expect(
    await page.evaluate(() => window.__preNav === true),
    'expected the brand link to be boosted too; a full page load would cache no snapshot of /profile'
  ).toBe(true);

  await page.evaluate(armBackProbe);
  await page.goBack();
  await page.waitForURL((url) => url.pathname === '/profile');
  await page.waitForFunction(
    () => window.__backProbe && window.__backProbe.frames.length >= 3,
    null,
    { timeout: 10_000 }
  );

  const probe = await page.evaluate(() => window.__backProbe);
  const summary = summarise(probe);
  // Zero-iteration guard: every count below is a filter over probe.frames and
  // would read 0 on an empty array.
  expect(summary.framesSampled).toBeGreaterThanOrEqual(3);
  expect(summary, `restored-page paint probe: ${JSON.stringify(probe)}`).toMatchObject({
    restoreObserved: true,
    framesNavbarMissing: 0,
    framesPaintedOpen: 0,
    framesWithoutAlpine: 0,
    framesAlpineOpen: 0
  });

  // ...and live, not merely correct-looking. If the restored snapshot had no
  // component behind it, every assertion above would still pass: Bulma hides
  // .navbar-menu without .is-active whether or not Alpine exists.
  const burger = page.locator('#navbar-burger');
  await burger.click();
  await expect(page.locator('#navbar-menu')).toHaveClass(/is-active/);
  await burger.click();
  await expect(page.locator('#navbar-menu')).not.toHaveClass(/is-active/);
});

// ---------------------------------------------------------------------------
// EXPECTED TO FAIL. This test characterizes a real, confirmed, reproducible
// product defect -- not a bug in the test. Do not "fix" it by changing
// production code under this task, and do not loosen the assertions. If it
// starts passing because someone actually fixed the underlying bug, that is
// the correct way for it to go green.
//
// Repro, by hand, on a phone-width window: open the burger menu, tap a nav
// link, then tap Back. The menu comes back on screen covering 632px of a 900px
// viewport, opaque and hit-testable, and NOTHING ON THAT PAGE closes it -- the
// burger toggles Alpine's `open` without moving the class, and Escape does
// nothing. (Precisely: clicking away does nothing either, but that is not a
// regression -- views/partials/nav.handlebars has no @click.outside handler,
// so clicking away never closed this menu. Do not read the list above as
// "handlers that stopped working".) It is escapable: any subsequent navigation
// re-renders the navbar closed. "Only a reload clears it" -- an earlier
// wording here -- is false.
//
// Mechanism, confirmed end to end:
//   1. Alpine writes `is-active` onto #navbar-menu / #navbar-burger when the
//      menu is opened (views/partials/nav.handlebars:6,14).
//   2. The boosted click runs htmx's saveCurrentPageToHistory (dist line 3251)
//      BEFORE the swap, snapshotting body.innerHTML into sessionStorage. The
//      snapshot therefore contains, verbatim:
//        <div class="navbar-menu is-active" id="navbar-menu" :class="open && 'is-active'">
//      (asserted in test 1, so this step is pinned rather than assumed).
//   3. Back -> popstate -> restoreHistory (dist line 3342) reinstates that
//      markup verbatim.
//   4. Alpine re-initialises the restored nodes with `open: false` and
//      evaluates `:class="open && 'is-active'"` -> false ->
//      setClassesFromString(el, '') -> adds nothing; the undo pass removes
//      nothing, because Alpine only ever removes classes IT added. An
//      `is-active` that arrived as literal markup is invisible to it.
//
// Observed on every run: all 12 sampled frames read
// `is-active` / `display: block` / alpineInitialised: true / alpineOpen: false.
// Alpine is alive (test 2 proves restore does not kill it) and insists the menu
// is closed while the browser paints it open -- and because Alpine never
// "added" the class, toggling `open` true/false/true afterwards changes the
// class not at all. The component is live and completely powerless. The
// sharpest single symptom of that: the restored #navbar-burger carries
// `aria-expanded="false"` while the menu is visibly expanded. Alpine drives the
// attribute binding correctly on exactly the element whose class binding it
// cannot touch -- which is also an accessibility defect in its own right.
//
// RECOMMENDED FIX (a production change, deliberately NOT applied here -- this
// branch reports defects, it does not fix them; see task-11-report.md):
//
//   views/partials/nav.handlebars:6,14
//   -  :class="open && 'is-active'"
//   +  :class="{ 'is-active': open }"
//
// Alpine's setClassesFromObject DOES remove a falsy class it did not add (its
// forRemove branch calls classList.remove on any falsy key already present),
// whereas setClassesFromString only ever removes what it added. Verified by an
// adversarial reviewer, applied and reverted: this spec goes 3/3 GREEN,
// test 1's cachedRootSnapshotHasAlpineOutput tripwire included -- the snapshot
// still carries the frozen class, Alpine simply strips it on restore now.
//
// DO NOT reach for hx-history="false" or historyCacheSize: 0 instead. Both make
// this test pass, and both are worse than the defect. With the snapshot cache
// out of play, Back falls through to htmx's loadHistoryFromServer, whose raw
// XHR sends `HX-Request: true` (htmx.config.historyRestoreAsHxRequest, default
// true) and no Authorization header. Two distinct symptoms follow, and they are
// worth keeping apart:
//   - PROTECTED routes (test 2's back-target, /profile): util/auth.js:41-44
//     answers that request with `200` + an `HX-Redirect` header and an EMPTY
//     body; loadHistoryFromServer never processes HX-Redirect, so htmx swaps
//     zero bytes into <body> and the user gets a permanently BLANK PAGE.
//   - AUTH-OPTIONAL routes (test 3's own back-target, /): the server answers
//     with a full page rendered SIGNED OUT -- wrong nav, no user content, no
//     error. Measured under the hx-history="false" mutation: bodyLen 5203,
//     signedOut true, menu closed, so test 3 passes for entirely the wrong
//     reason.
// See task-11-report.md; the blank page is already reachable in production with
// no code change at all, via ordinary cache eviction past 10 history entries.
// ---------------------------------------------------------------------------
test('going back after a boosted navigation restores a closed, live navbar', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle'); // see the auth-swap note in test 1

  await openMenuAndVisitProfile(page);

  await page.evaluate(armBackProbe);
  await page.goBack();
  await page.waitForURL((url) => url.pathname === '/');
  await page.waitForFunction(
    () => window.__backProbe && window.__backProbe.frames.length >= 3,
    null,
    { timeout: 10_000 }
  );

  // Precondition, asserted separately and before the defect assertions so a
  // change in the back-button mechanism reports as itself rather than as a
  // mysterious paint failure. See test 1 for the full argument.
  expect(
    await page.evaluate(() => window.__preNav === true && window.__backProbe.restoreObserved),
    'expected an in-document htmx history restore; without one this test proves nothing about the cached snapshot'
  ).toBe(true);

  const probe = await page.evaluate(() => window.__backProbe);
  const summary = summarise(probe);
  expect(summary.framesSampled).toBeGreaterThanOrEqual(3); // zero-iteration guard

  // THE defect. framesPaintedOpen is what the user sees; framesAlpineOpen: 0
  // holding at the same time is the signature that distinguishes this from
  // "Alpine restored open state" -- Alpine says closed, the screen says open.
  // framesNavbarMissing: 0 keeps that reading honest: a restore that produced
  // no navbar at all must report as its own failure, not as this one.
  expect(summary, `restored-navbar paint probe: ${JSON.stringify(probe)}`).toMatchObject({
    framesNavbarMissing: 0,
    framesPaintedOpen: 0,
    framesWithoutAlpine: 0,
    framesAlpineOpen: 0
  });

  // Steady state, after every settle and microtask has had its chance. Weaker
  // than the probe (a retrying assertion cannot see a transient) but it would
  // catch a LATE re-open the 12-frame window misses, so both are kept.
  const burger = page.locator('#navbar-burger');
  await expect(page.locator('#navbar-menu')).not.toHaveClass(/is-active/);
  await expect(burger).not.toHaveClass(/is-active/);

  // ...and closed because Alpine is driving it, not because Alpine is dead.
  await burger.click();
  await expect(page.locator('#navbar-menu')).toHaveClass(/is-active/);
});
