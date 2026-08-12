// ar-h6rt -- the auth redirect that trapped the user, and the open-redirect
// guard that protects the address bar it now writes to.
//
// redirectTo() (public/js/app.js:970-990) swaps <body> via htmx.ajax. Before
// af2b098 it never touched window.location, so a direct load of any protected
// route left the address bar on /auth/check?r=%2Fnav%2Fmanage while the body
// showed /nav/manage. getRedirectUrl() re-read that same stale ?r= on every
// later auth event and swapped the body back -- an unescapable loop. Four
// commits on this branch fix it: af2b098 (sync the address bar), 43c6120
// (stop the deferred timer undoing a boosted navigation), a324968 (bind the
// htmx listeners to `document` so the outerHTML body swap cannot destroy the
// Authorization-header handler -- the root cause of "every click does an auth
// check"), b072d4a (dispatch INITIAL_SESSION once, not twice).
//
// TWO OF THOSE FOUR COMMITS DESCRIBE A MECHANISM THIS TIER CANNOT REPRODUCE,
// and both corrections are recorded at the tests concerned:
//   - a324968's premise (an outerHTML swap of <body> replaces the body element
//     and kills listeners bound to it) is false for htmx 2.0.8, which converts
//     that swap to innerHTML. See the auth-header test.
//   - 43c6120's guard cannot see a boosted navigation that is still in flight,
//     because window.location only moves when the swap completes. See the
//     deliberately-red test.
// af2b098 and b072d4a both hold, and both are pinned by mutation below.
//
// THE PLAN'S SIGN-IN SELECTORS WERE WRONG and are corrected here: the real
// ones are #sign-in-email / #sign-in-password / #sign-in button[type=submit]
// (views/partials/signin-form.handlebars). The helper below is the same shape
// as e2e/global-setup.js's, which is the only place the credentials live.
//
// THE PLAN'S FLOW WAS ALSO WRONG, and measurably so. Its tests do
// `goto('/nav/manage')` unauthenticated, wait for /auth, then fill the sign-in
// form. Measured: an unauthenticated direct load lands on
// /auth/check?r=%2Fnav%2Fmanage, and views/auth-check.handlebars renders NO
// sign-in form at all (0 matches for #sign-in-email) -- just "Checking login
// status" and a manual Login link that drops the ?r=. Every one of those tests
// would have timed out on the fill. The bug's real precondition is a *signed-in*
// direct load, since the tokens live in localStorage and reach the server only
// through htmx:configRequest; so these tests sign in through the form first
// (starting from a genuinely empty storageState) and then do the direct load.
//
// ** THE VACUITY TRAP: FOUR OF THE PLAN'S FIVE TESTS WERE "WAIT, THEN ASSERT
//    THE URL DID NOT CHANGE" ** -- every one of which passes on an app whose
// redirect machinery is entirely dead. Closed two ways:
//
//   1. The hostile-?r= tests assert a POSITIVE landing, not a non-change. A
//      rejected ?r= makes _handleAuthStateChange fall through to
//      `redirectTo(redirectParam || '/')`, so the browser must MOVE from
//      /auth?r=<hostile> to the authed home page. A dead redirect leaves you
//      on /auth and fails. The paired positive control is
//      "a legitimate ?r= through the sign-in form lands on that page"
//      (/auth?r=%2Fprofile -> /profile), which proves the same code path
//      genuinely navigates when the value is acceptable.
//   2. The address-bar tests assert BOTH halves -- the URL *and* the rendered
//      heading -- because the defect being fixed is precisely a divergence
//      between them, and either half alone is satisfiable by the bug.
//
// SECURITY FINDING (Low), REPORTED NOT FIXED (see the control-character test
// at the bottom): _isSafeInAppPath is `url[0] === '/' && url[1] !== '/' &&
// url[1] !== '\\'`, but the URL parser strips ASCII tab/LF/CR *before*
// parsing. So ?r=/%09/evil.com decodes to "/\t/evil.com", passes the guard,
// and reaches history.replaceState(), where the browser resolves it to
// http://evil.com/. Measured: guard says safe = TRUE for /%09/, /%0A/, /%0D/
// and /%09\.
//
// TWO INDEPENDENT DEFENSES catch it, neither of them the app's, and this file
// is pinned by both of them rather than by app code:
//   - Chromium refuses the cross-origin replaceState (SecurityError, swallowed
//     by signIn's catch and shown in #alerts);
//   - htmx 2.0.8 ships `selfRequestsOnly: true` (the htmx-config meta at
//     head.handlebars:4 does not override it), so htmx.ajax answers every one
//     of these shapes -- and every guard-REJECTED shape -- with
//     htmx:invalidPath and issues no request at all. Measured directly, with
//     an Authorization canary attached: events ["htmx:invalidPath:…"],
//     off-origin requests [].
// So the statement order inside redirectTo is NOT the only thing standing
// between this and an open redirect. Consequence today: a broken sign-in.
// The user is left signed in but stranded on /auth, with an attacker-chosen
// hostname rendered as plain text (app.js:101 uses textContent, so no HTML
// injection). No navigation, no request, no token exposure.
//
// SEPARATE LATENT FINDING, same function: redirectTo gates only the
// replaceState (app.js:985-987). A guard-REJECTED url still falls through to
// htmx.ajax at :989 with Authorization: Bearer and Refresh-Token attached,
// and htmx.config.allowScriptTags/allowEval are both true. That -- not the
// control-character path -- is the token-exfiltration primitive, and it is
// blocked today solely by selfRequestsOnly. One-line fix:
// `if (!_isSafeInAppPath(url)) return;`. Not fixed here.
//
// Inherited and load-bearing here:
//   - A retrying assertion cannot test a non-change that is already true.
//     expect.poll is used only for "did it get there"; every "and it stayed"
//     read is a single non-retrying snapshot taken after a fixed settle.
//   - redirectTo() replaces the whole <body> on every authed page load, so
//     every reading below is taken after networkidle.
//   - Absent != present-but-wrong: content assertions name the page's own
//     heading rather than merely counting elements.
const { test, expect } = require('@playwright/test');
const { ADMIN_EMAIL, ADMIN_PASSWORD } = require('../global-setup');

// Genuinely unauthenticated: the trap only appears on a direct load of a
// protected route, which carries no Authorization header and so bounces
// through /auth/check?r=. Signing in mutates no fixture data, so this file
// seeds nothing and cleans nothing up.
test.use({ storageState: { cookies: [], origins: [] } });

const signInThroughForm = async (page) => {
  await page.fill('#sign-in-email', ADMIN_EMAIL);
  await page.fill('#sign-in-password', ADMIN_PASSWORD);
  await page.click('#sign-in button[type="submit"]');
  // Same signal global-setup.js waits on: App.signIn writes both keys on
  // success, and waiting on them rather than on a URL avoids racing the
  // post-sign-in redirect this file is about.
  await page.waitForFunction(
    () => !!localStorage.getItem('authToken') && !!localStorage.getItem('refreshToken'),
    null,
    { timeout: 15_000 }
  );
};

// Records every MAIN-FRAME navigation. A subresource on a CDN is not a
// navigation, so this answers exactly one question: did the browser ever take
// the user to another origin?
const recordMainFrameNavigations = (page) => {
  const urls = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url());
  });
  return urls;
};

const originsOf = (urls) => [...new Set(urls.map((u) => new URL(u).origin))];

test.describe('the address bar after an auth-driven redirect', () => {
  test('a signed-in direct load of a protected route ends with the URL and the page agreeing', async ({ page }) => {
    const documents = [];
    const xhrs = [];
    page.on('request', (r) => {
      if (r.url().includes('54321')) return;
      const { pathname, search } = new URL(r.url());
      if (r.resourceType() === 'document') documents.push(pathname + search);
      if (r.resourceType() === 'xhr') xhrs.push(pathname + search);
    });

    await page.goto('/auth');
    await signInThroughForm(page);
    await page.waitForLoadState('networkidle');

    documents.length = 0;
    xhrs.length = 0;
    await page.goto('/nav/manage');

    // POSITIVE CONTROL for this whole file: the redirect machinery is alive and
    // the bounce genuinely happened. Without this the two assertions below are
    // satisfiable by an app that never redirects at all.
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/nav/manage');
    expect(documents).toContain('/auth/check?r=%2Fnav%2Fmanage');

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Both halves. The defect was a divergence between them, so asserting
    // either one alone is satisfiable by the bug.
    const landed = new URL(page.url());
    expect(landed.pathname).toBe('/nav/manage');
    expect(landed.search).toBe('');
    await expect(page.getByRole('heading', { name: 'Manage Navigation' })).toBeVisible();

    // b072d4a: INITIAL_SESSION was dispatched twice per page load, so the
    // bounce ran redirectTo() twice and the second swap destroyed whatever the
    // first established. Exactly one authed re-fetch, not two.
    expect(xhrs.filter((u) => u === '/nav/manage')).toHaveLength(1);
  });

  test('reloading the landed page does not bounce back to /auth/check', async ({ page }) => {
    await page.goto('/auth');
    await signInThroughForm(page);
    await page.goto('/nav/manage');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/nav/manage');
    await page.waitForLoadState('networkidle');

    // Under the bug the address bar still read /auth/check?r=%2Fnav%2Fmanage,
    // so this reload re-entered the bounce forever. It is the user's only
    // escape attempt and it has to end somewhere other than /auth.
    await page.reload();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/nav/manage');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const landed = new URL(page.url());
    expect(landed.pathname).toBe('/nav/manage');
    expect(landed.search).toBe('');
    await expect(page.getByRole('heading', { name: 'Manage Navigation' })).toBeVisible();
  });

  // THIS is the test that pins af2b098, and finding out why is the most
  // interesting thing in this file. Deleting the history.replaceState() from
  // redirectTo() does NOT move the address bar off /nav/manage, because the
  // server has been sending HX-Push-Url on the redirect-to header since
  // 89c8d05 (2024-10-12) -- htmx pushes the URL for it. So every "the address
  // bar caught up" assertion above survives that mutation.
  //
  // What the replaceState actually buys is the HISTORY SHAPE, exactly as its
  // comment claims. Measured side by side on the same flow:
  //   shipped: no HX-Push-Url response header is sent at all (the Referer of
  //            the htmx request is already /nav/manage, so util/auth.js's
  //            `referer !== redirectTo` guard suppresses it), history.length
  //            2 -> 3, and Back goes to '/'.
  //   without: two HX-Push-Url headers, history.length 3 -> 5, and Back lands
  //            on /auth/check?r=%2Fnav%2Fmanage -- the trap, one keypress away.
  test('going Back after the bounce does not land on /auth/check', async ({ page }) => {
    await page.goto('/auth');
    await signInThroughForm(page);
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/');
    await page.waitForLoadState('networkidle');

    await page.goto('/nav/manage');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/nav/manage');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/');
    await expect(page.locator('.title', { hasText: 'Welcome, Agent' })).toBeVisible();

    await page.waitForTimeout(1500);
    const back = new URL(page.url());
    expect(back.pathname).toBe('/');
    expect(back.search).toBe('');
  });

  test('a boosted link clicked after the bounce navigates and carries the auth header', async ({ page }) => {
    await page.goto('/auth');
    await signInThroughForm(page);
    await page.goto('/nav/manage');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/nav/manage');
    await page.waitForLoadState('networkidle');

    // The symptom a324968 was written for -- "every click does an auth check",
    // i.e. a later request going out unauthenticated, being bounced to
    // /auth/check and dragging the user back. Asserting the header on the wire
    // pins the mechanism; asserting the landing pins the symptom.
    //
    // Isolating mutation: suppress the Authorization/Refresh-Token assignment
    // in the htmx:configRequest listener (app.js:732-735). That fails this
    // test and only this test.
    //
    // NOT ISOLATED BY a324968's OWN MUTATION, and the reason is a finding.
    // That commit's premise is that redirectTo()'s `swap: 'outerHTML'` on body
    // replaces the <body> ELEMENT and so destroys listeners bound to it. Real
    // htmx 2.0.8 (head.handlebars:13) does not: swapOuterHTML() opens with
    // `if (target.tagName === 'BODY') return swapInnerHTML(...)`. Measured on
    // this exact flow -- after the bounce and again after this click,
    // window.__origBody === document.body, a data- attribute set before the
    // swap survives it, and a listener bound to document.body still fires
    // (1 hit, then 2). Reverting the listeners to document.body fails nothing
    // here (verified for this one and, by the reviewer, for all seven),
    // because the header is still attached.
    //
    // a324968 IS pinned, at the unit tier -- but by a test that manufactures
    // the refuted premise. test/auth-redirect-history.test.js's htmx stub does
    // `document.body.replaceWith(freshBody)` under a comment calling that "the
    // real DOM consequence of swap: 'outerHTML' on target: 'body'", and :345
    // then asserts `expect(document.body).not.toBe(bodyBeforeSwap)` as its
    // anti-vacuity guard -- an assertion that is FALSE in the shipped app.
    const [request] = await Promise.all([
      page.waitForRequest((r) => new URL(r.url()).pathname === '/profile' && r.resourceType() === 'xhr'),
      page.locator('a[href="/profile"]').first().click()
    ]);
    expect(request.headers()['authorization']).toMatch(/^Bearer .+/);

    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/profile');
    await expect(page.getByRole('heading', { name: /User Profile/ })).toBeVisible();

    // Non-retrying, after a settle: "did it get there" is not "did it stay".
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname).toBe('/profile');
    await expect(page.getByRole('heading', { name: /User Profile/ })).toBeVisible();
  });
});

test.describe('the deferred post-load refresh', () => {
  // 43c6120 kept this timer deliberately: a plain page load carries no
  // Authorization header, so the server renders the GUEST view and only
  // redirectTo(current) upgrades it. This is the positive control for the
  // red test below -- it proves the timer fires and does real work, so
  // "the boosted navigation survived" cannot be green merely because the
  // timer is dead.
  test('a signed-in direct load upgrades the guest render to the authed render', async ({ page, baseURL }) => {
    await page.goto('/auth');
    await signInThroughForm(page);

    // What the server actually sends for a plain navigation. page.request
    // shares only the cookie jar and never the Authorization header (which is
    // written by JS), so this is byte-for-byte what the browser's own document
    // request gets: the guest page.
    const asDelivered = await (await page.request.get(`${baseURL}/`)).text();
    expect(asDelivered).toContain('Login/Signup');
    expect(asDelivered).not.toContain('Welcome, Agent');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.title', { hasText: 'Welcome, Agent' })).toBeVisible();
    await expect(page.locator('a[href="/profile"]').first()).toBeVisible();
  });

  // GREEN, and load-bearing: this now guards the fix rather than characterising
  // the defect. (It was committed DELIBERATELY RED and this block described the
  // defect as unfixed; the fix landed in the same squash as the test, so the
  // wording was never brought up to date.)
  //
  // The defect: 43c6120's guard re-reads window.location when the timer fires
  // and bails if it moved. In a real browser that is not enough -- a boosted
  // navigation updates window.location only when its swap COMPLETES, so a click
  // inside the 100 ms window that has not come back yet is invisible to the
  // guard. redirectTo(current) then fires, its response lands after the boosted
  // swap and overwrites it, leaving the address bar on the new page and the body
  // on the old one: the exact divergence af2b098 set out to end.
  //
  // The fix is the second half of the condition at public/js/app.js:1095,
  //
  //   if (now !== current || _boostedNavigationInFlight()) return;
  //
  // added by "fix: don't let the deferred auth refresh stomp an in-flight
  // boosted nav (ar-h6rt)". The location read covers a boosted navigation that
  // already COMPLETED; _boostedNavigationInFlight() covers one still on the
  // wire, which is the half this test exercises. Delete that call and this test
  // goes red again -- which is the point of keeping it.
  //
  // Measured with no network shaping at all (natural click straight after
  // commit): it collides on its own, at a rate that swings with machine load
  // -- 2/6, 3/10 and 2/20 in three of my batches, 5/10 in the reviewer's, i.e.
  // 12/46 pooled, every collision with boosted=true. So the defect is NOT an
  // artifact of the two route delays below; the delays only make it
  // deterministic, by putting the boosted request outside the 100 ms window
  // and the refresh's own request last -- an ordinary slow connection, which
  // is the condition that makes this reachable in production rather than a
  // localhost curiosity.
  //
  // The precondition asserted is that the click was BOOSTED (no document
  // request for /privacy), which every valid fix preserves. It deliberately
  // does not gate on the timer's own marker.
  //
  // Which guard this test actually pins, stated plainly: deleting 43c6120's
  // location read changes nothing THIS FILE can see -- the shaping deliberately
  // puts the boosted request outside the 100 ms window, exactly the regime that
  // read cannot help in. It is _boostedNavigationInFlight() that this test
  // holds. 43c6120 is not uncovered either: the unit tier pins it
  // (test/auth-redirect-history.test.js:259, "a boosted navigation away from the
  // page before the deferred refresh fires is not undone by a stale redirect",
  // fails with the guard deleted).
  //
  // Making the timer bail unconditionally would also turn this test green -- and
  // fail the positive control above, which is why that control is there.
  //
  // Being a race, this occasionally fails for reasons that are not this defect:
  // under parallel workers the local Supabase stack intermittently answers "An
  // invalid response was received from the upstream server" (Kong reporting a
  // failed upstream), which lands on a random spec, this one included. A failure
  // here is only meaningful if the assertions below are what failed.
  test('a boosted navigation started inside the deferred-refresh window is not overwritten', async ({ page, baseURL }) => {
    const origin = new URL(baseURL).origin;
    const documents = [];
    page.on('request', (r) => {
      if (r.resourceType() === 'document') documents.push(new URL(r.url()).pathname);
    });

    await page.goto('/auth');
    await signInThroughForm(page);
    await page.waitForLoadState('networkidle');

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await page.route('**/privacy', async (route) => { await sleep(400); await route.continue(); });
    await page.route(
      (url) => url.origin === origin && url.pathname === '/' && url.search === '',
      async (route) => {
        if (route.request().resourceType() === 'xhr') await sleep(1500);
        await route.continue();
      }
    );

    documents.length = 0;
    await page.goto('/', { waitUntil: 'commit' });
    await page.locator('a[href="/privacy"]').first().click();
    await page.waitForTimeout(4000);

    expect(documents).not.toContain('/privacy'); // the click was boosted
    expect(new URL(page.url()).pathname).toBe('/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.locator('.title', { hasText: 'Welcome, Agent' })).toHaveCount(0);
  });

  // The green control for the red test above: identical page, identical route
  // delays, identical boosted click -- only the timing differs. It is what
  // stops the red one being read as "slow responses break boosted navigation".
  test('a boosted navigation started after the window has closed is not overwritten', async ({ page, baseURL }) => {
    const origin = new URL(baseURL).origin;
    const documents = [];
    page.on('request', (r) => {
      if (r.resourceType() === 'document') documents.push(new URL(r.url()).pathname);
    });

    await page.goto('/auth');
    await signInThroughForm(page);
    await page.waitForLoadState('networkidle');

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await page.route('**/privacy', async (route) => { await sleep(400); await route.continue(); });
    await page.route(
      (url) => url.origin === origin && url.pathname === '/' && url.search === '',
      async (route) => {
        if (route.request().resourceType() === 'xhr') await sleep(1500);
        await route.continue();
      }
    );

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    documents.length = 0;
    await page.locator('a[href="/privacy"]').first().click();
    await page.waitForTimeout(4000);

    expect(documents).not.toContain('/privacy');
    expect(new URL(page.url()).pathname).toBe('/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.locator('.title', { hasText: 'Welcome, Agent' })).toHaveCount(0);
  });
});

test.describe('the open-redirect guard on ?r=', () => {
  // THE POSITIVE CONTROL for every hostile case below. Same page, same form,
  // same code path (_handleAuthStateChange's SIGNED_IN branch ->
  // redirectTo(getRedirectUrl() || '/')); only the ?r= value differs. It
  // proves the machinery navigates when the value is acceptable, so "the
  // hostile value did not take you anywhere" means the guard rejected it
  // rather than that nothing was ever going to happen.
  test('a legitimate ?r= through the sign-in form lands on that page', async ({ page }) => {
    await page.goto(`/auth?r=${encodeURIComponent('/profile')}`);
    await signInThroughForm(page);

    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/profile');
    await expect(page.getByRole('heading', { name: /User Profile/ })).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
  });

  // The four shapes the client must reject. The client is STRICTER than the
  // server's isSameOriginPath (util/auth.js:9-14), which only tests
  // startsWith('//') and therefore accepts "/\evil.com" -- a value the URL
  // parser resolves to http://evil.com/ because backslash and forward slash
  // are interchangeable in a special-scheme URL. The stricter client rule is
  // the one that must hold.
  for (const hostile of ['//evil.com', '/\\evil.com', 'https://evil.com', '///evil.com']) {
    test(`a hostile ?r= is rejected and sign-in falls back to the home page: ${hostile}`, async ({ page, baseURL }) => {
      const origin = new URL(baseURL).origin;
      const navigations = recordMainFrameNavigations(page);

      await page.goto(`/auth?r=${encodeURIComponent(hostile)}`);
      await signInThroughForm(page);

      // POSITIVE: the redirect ran and chose the '/' fallback. Not "the URL
      // did not change" -- the browser has to MOVE off /auth for this to pass.
      await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/');
      await expect(page.locator('.title', { hasText: 'Welcome, Agent' })).toBeVisible();

      // Then a single non-retrying read after a settle, for a late writer.
      await page.waitForTimeout(1500);
      const final = new URL(page.url());
      expect(final.origin).toBe(origin);
      expect(final.pathname).toBe('/');
      // The hostile value must never end up IN the address bar: a hostile URL
      // that persists and can be copied or reloaded is strictly worse than the
      // body swap it replaced.
      expect(final.href).not.toContain('evil.com');
      expect(originsOf(navigations)).toEqual([origin]);
    });
  }

  // SECURITY FINDING -- these four shapes BYPASS _isSafeInAppPath. The URL
  // parser removes ASCII tab, LF and CR before parsing, so "/\t/evil.com"
  // is parsed as "//evil.com" and resolves to http://evil.com/ -- but the
  // guard inspects the UNPARSED string, sees '/' then '\t', and says safe.
  // getRedirectUrl returns the value and redirectTo passes it to
  // history.replaceState.
  //
  // ** THESE FOUR ARE FORWARD TRIPWIRES, NOT LOAD-BEARING TESTS, AND THAT IS
  //    THE HONEST DESCRIPTION. ** They pass under every application mutation
  // tried (M1, M2, M3, M6, M7, M8): what stops these shapes is Chromium's
  // same-origin check on replaceState and htmx's selfRequestsOnly, i.e. the
  // browser and a third-party library, not app code. They cannot detect a
  // regression in _isSafeInAppPath -- the four tests above do that -- but they
  // will fail loudly the day either external defense is removed (a
  // selfRequestsOnly:false in the htmx-config meta, an htmx major bump, or a
  // switch to `location.href = url`), which is exactly when this stops being
  // a Low-severity finding.
  //
  // The assertions are limited to the two invariants every valid fix
  // preserves. The current symptom -- signed in, stranded on /auth, browser
  // error text containing the attacker's host in #alerts -- is deliberately
  // NOT asserted: pinning it would freeze the defect.
  // Reported in .superpowers/sdd/.../task-16-report.md, not fixed.
  for (const bypass of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/\t\\evil.com']) {
    test(`a control-character ?r= never reaches another origin: ${JSON.stringify(bypass)}`, async ({ page, baseURL }) => {
      const origin = new URL(baseURL).origin;
      const navigations = recordMainFrameNavigations(page);

      await page.goto(`/auth?r=${encodeURIComponent(bypass)}`);

      // DIAGNOSTIC ONLY, never asserted. This is the app's own guard
      // expression evaluated against the app's own location; today it answers
      // SAFE, which is the finding. Asserting it would turn a correct fix into
      // a red test, so it only ever appears in a failure message.
      const guardSaysSafe = await page.evaluate(() => {
        const r = new URL(window.location.href).searchParams.get('r');
        return !!r && r[0] === '/' && r[1] !== '/' && r[1] !== '\\';
      });

      await signInThroughForm(page);
      // Deliberate fixed wait: the redirect here may or may not fire, so there
      // is no signal to wait on. It is paired with the positive control above
      // (a legitimate ?r= at this exact point navigates within 15 s) and with
      // the token assertion below, so it is not a bare "nothing happened".
      await page.waitForTimeout(2500);

      // The sign-in itself genuinely completed -- otherwise "never reached
      // another origin" would be true of a page that did nothing at all.
      expect(await page.evaluate(() => !!localStorage.getItem('authToken'))).toBe(true);

      const diagnosis = `_isSafeInAppPath said safe=${guardSaysSafe} for ${JSON.stringify(bypass)}; ` +
        `main-frame navigations: ${JSON.stringify(navigations)}`;
      const final = new URL(page.url());
      expect(final.origin, diagnosis).toBe(origin);
      expect(final.pathname, diagnosis).not.toContain('evil.com');
      expect(originsOf(navigations), diagnosis).toEqual([origin]);
    });
  }
});
