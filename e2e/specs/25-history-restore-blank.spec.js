// Issue #163 -- the back button blanks the page on a protected route.
//
// htmx serves Back from a sessionStorage snapshot cache and, when the snapshot
// is gone, re-fetches the URL through loadHistoryFromServer (htmx 2.0.8 dist
// 3310-3337). That fallback builds its own bare XMLHttpRequest and sends it
// itself, so it never fires htmx:configRequest -- the one hook where
// public/js/app.js writes the Authorization header this app authenticates
// with. util/auth.js used to answer the resulting signed-out request for a
// protected route with `200`, an `HX-Redirect` header and an EMPTY BODY;
// loadHistoryFromServer does not read HX-Redirect, so htmx swapped zero bytes
// into <body> and left a permanently white page at a correct-looking URL,
// recoverable only by a manual reload.
//
// Both halves of the fix are exercised here, because they cover different
// users:
//   - the header on the restore fetch (app.js), which gets a signed-in user
//     the page they actually asked for -- tests 1 and 2;
//   - a renderable body from util/auth.js when the restore genuinely arrives
//     unauthenticated, which gets everyone else a sign-in page instead of a
//     white screen -- test 3.
//
// This is a fourth-tier concern by construction: the mechanism is htmx's
// popstate handling plus a real Express response, and neither the jsdom nor
// the mocked-Express tier has a history stack to press Back on.
const { test, expect } = require('@playwright/test');
const { ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

// Twelve distinct paths off ONE protected route. htmx's history cache is
// keyed by `location.pathname + location.search` and holds
// htmx.config.historyCacheSize (10) entries, so the query string is what makes
// these separate cache entries -- and twelve of them is what pushes the oldest
// out. Using a single route keeps the test independent of which nav items the
// database happens to hold; /profile ignores unknown query parameters.
const hop = (n) => `/profile?p=${n}`;

// A real boosted navigation to an arbitrary URL. hx-boost="true" lives on
// <body> (views/layouts/main.handlebars:5), so any same-origin anchor inside
// it is boosted once htmx has processed it; the anchor is re-created for each
// hop because a boosted swap replaces body's children, taking the previous one
// with it. Clicking is the point -- htmx only pushes a history entry for a
// navigation it handled itself.
const boostedGoto = async (page, href) => {
  await page.evaluate((target) => {
    const link = document.createElement('a');
    link.id = 'boosted-probe';
    link.href = target;
    link.textContent = 'probe';
    document.body.appendChild(link);
    window.htmx.process(link);
    // Dies on a real page load, which is what test 1 asserts did not happen.
    window.__sameDocument = true;
  }, href);
  await page.click('#boosted-probe');
  await page.waitForURL((url) => `${url.pathname}${url.search}` === href);
};

// Armed immediately before goBack(). htmx fires htmx:historyRestore AFTER the
// swap on both paths -- the cache hit (dist 3355) and the cache miss (dist
// 3329) -- so it is the one point where "what did the user end up looking at"
// can be read without racing the swap. `cacheMiss` on the detail is the only
// thing that separates the two paths, and without at least one true reading
// this spec would be measuring the snapshot cache rather than the defect.
const armRestoreProbe = () => {
  window.__restore = null;
  document.addEventListener('htmx:historyRestore', (event) => {
    const body = document.body;
    window.__restore = {
      cacheMiss: !!(event.detail && event.detail.cacheMiss),
      bodyLen: body.innerHTML.trim().length,
      // Split from bodyLen so "the page came back" cannot be scored by byte
      // count alone: an error page has bytes too.
      hasMainContent: !!body.querySelector('#main-content'),
      // views/partials/nav.handlebars:37 renders Sign Out only under
      // `{{#if profile}}`, and :41 renders Login/Signup otherwise. A restore
      // that silently re-rendered the page signed out is a distinct defect
      // from a blank one and must not be scored as a pass.
      signedIn: !!body.querySelector('button[hx-on\\:click="App.signOut(event)"]'),
      hasSignInForm: !!body.querySelector('#sign-in')
    };
  }, { once: true });
};

const goBackAndRead = async (page, expectedHref) => {
  await page.evaluate(armRestoreProbe);
  await page.goBack();
  if (expectedHref) {
    await page.waitForURL((url) => `${url.pathname}${url.search}` === expectedHref);
  }
  await page.waitForFunction(() => window.__restore !== null, null, { timeout: 10_000 });
  return page.evaluate(() => window.__restore);
};

// Starts on '/', an auth-optional route, deliberately. Entering through a
// protected route is its own trigger for this bug (redirectTo's raw
// history.replaceState caches the snapshot under the pre-redirect URL), and
// mixing the two would leave a failure ambiguous.
const openSignedIn = async (page) => {
  await page.goto('/');
  await expect(page.locator('button[hx-on\\:click="App.signOut(event)"]')).toBeVisible();
  // The deferred post-load refresh (app.js's INITIAL_SESSION branch, 100ms)
  // swaps <body> wholesale. Let it land before anything is appended to it.
  await page.waitForLoadState('networkidle');
};

test('twelve boosted navigations and eleven Backs never blank the page', async ({ page }) => {
  await openSignedIn(page);

  for (let n = 1; n <= 12; n++) {
    await boostedGoto(page, hop(n));
  }
  expect(
    await page.evaluate(() => window.__sameDocument === true),
    'expected twelve in-document boosted navigations; a real page load pushes no htmx history entry'
  ).toBe(true);

  const restores = [];
  for (let n = 11; n >= 1; n--) {
    restores.push({ back: 12 - n, ...(await goBackAndRead(page, hop(n))) });
  }

  // Precondition, asserted before the defect assertions so that a change in
  // htmx's cache size reports as itself rather than as a mysteriously green
  // test: eviction past ten entries has to actually have happened, or nothing
  // below ever reached the server.
  expect(
    restores.filter((r) => r.cacheMiss).length,
    `expected at least one history cache miss across eleven Backs: ${JSON.stringify(restores)}`
  ).toBeGreaterThan(0);

  for (const restore of restores) {
    expect(restore, `Back #${restore.back} restored: ${JSON.stringify(restore)}`).toMatchObject({
      hasMainContent: true,
      signedIn: true
    });
    expect(restore.bodyLen).toBeGreaterThan(0);
  }
});

test('a Back with no usable snapshot storage restores the real page, not a blank one', async ({ page }) => {
  // Trigger 3 from the issue. htmx's own probe is
  // `sessionStorage.setItem('htmx:sessionStorageTest', ...)` inside a
  // try/catch (dist 831-838, named canAccessLocalStorage but reading
  // sessionStorage), so a throwing accessor is exactly what a browser with
  // storage blocked presents. htmx then caches nothing and EVERY Back to a
  // protected route takes the re-fetch path -- permanently, for those users.
  //
  // localStorage is left alone on purpose: the auth token lives there, and
  // taking it away would test a signed-out user rather than this one.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() { throw new DOMException('storage blocked', 'SecurityError'); }
    });
  });

  await openSignedIn(page);
  // Two hops, so the Back lands on the PROTECTED route rather than on '/',
  // which is auth-optional and would render (signed out, but rendered)
  // whatever isAuthenticated does.
  await boostedGoto(page, hop(1));
  await boostedGoto(page, hop(2));

  const restore = await goBackAndRead(page, hop(1));

  expect(restore, `restore with storage blocked: ${JSON.stringify(restore)}`).toMatchObject({
    // The whole point of the setup: nothing was cached, so this went to the
    // server. A cache hit here means the storage block did not take.
    cacheMiss: true,
    hasMainContent: true,
    signedIn: true
  });
  expect(restore.bodyLen).toBeGreaterThan(0);
});

test('a history restore that reaches the server signed out renders the sign-in page', async ({ page }) => {
  // The server half, on its own. Stripping the header from the restore fetch
  // reproduces exactly what htmx sent before app.js started adding it, and is
  // also what a user with a genuinely expired session gets today. The response
  // has to be renderable on its own: htmx swaps this body verbatim and never
  // reads HX-Redirect on this path, so a redirect header with an empty body is
  // a white screen.
  await page.route('**/*', async (route, request) => {
    const headers = request.headers();
    if (headers['hx-history-restore-request'] !== 'true') return route.continue();
    delete headers.authorization;
    delete headers['refresh-token'];
    return route.continue({ headers });
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() { throw new DOMException('storage blocked', 'SecurityError'); }
    });
  });

  await openSignedIn(page);
  await boostedGoto(page, hop(1));
  await boostedGoto(page, hop(2));

  const protectedRestore = await goBackAndRead(page, hop(1));

  expect(
    protectedRestore,
    `signed-out restore of a protected route: ${JSON.stringify(protectedRestore)}`
  ).toMatchObject({
    cacheMiss: true,
    // THE regression: zero bytes swapped into <body>.
    hasMainContent: true,
    hasSignInForm: true
  });
  expect(protectedRestore.bodyLen).toBeGreaterThan(0);

  // ...and a live page, not a screenshot of one. The sign-in form has to be
  // usable, or "not blank" is a distinction without a difference.
  await expect(page.locator('#sign-in-email')).toBeVisible();
  await expect(page.locator('#sign-in button[type="submit"]')).toBeEnabled();
});
