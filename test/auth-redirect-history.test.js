// ar-h6rt: redirectTo() (public/js/app.js) performs an htmx body swap but
// never updates `history`, so after an auth-driven redirect the address bar
// stays on `/auth/check?r=...` while the body shows the real target. Because
// getRedirectUrl() re-reads that stale `?r=` on every later auth event
// (token refresh, tab focus), the user gets bounced back to the same page
// forever. See .tickets/ar-h6rt.md for the full trace.
//
// This is an EXECUTION test, not a source-text assertion. app.js is a
// classic <script> IIFE — `const App = (function (document, supabase,
// htmx) {...})(document, supabase, htmx);` — with no module.exports and no
// export of `App` (by design: it's wired up purely through browser
// globals, and adding a test-only export is explicitly out of bounds here).
// `vm.runInContext` was tried first and rejected: Bun's `vm` module cannot
// run scripts against jsdom's contextified window (`TypeError: Proxy is
// not allowed in the global prototype chain`), a Bun-specific limitation.
// Instead we load the real file contents with `new Function('document',
// 'supabase', 'htmx', source + '; return App;')`. This gives every free
// identifier in app.js the same resolution semantics a <script> tag would:
// `document`/`supabase`/`htmx` are the function's named parameters (so we
// can hand it stubs), everything else (`window`, `localStorage`, `history`,
// `setTimeout`, ...) resolves against real globals, which we point at a
// fresh jsdom window per test. This reaches the redirect logic only
// through the real auth-event path (App.init() -> start() -> a stubbed
// supabase.auth.getSession() -> _handleAuthStateChange('INITIAL_SESSION',
// session) -> redirectTo()), never by exporting redirectTo itself.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP_JS_PATH = path.join(__dirname, '..', 'public', 'js', 'app.js');
const APP_SOURCE = fs.readFileSync(APP_JS_PATH, 'utf8');

// Loads a fresh copy of app.js against a fresh jsdom window at `url`, with
// stub `supabase`/`htmx` globals, then drives it through
// App.init(...) -> INITIAL_SESSION with a fake already-authenticated
// session -- the same path `/auth/check?r=...` takes in production
// (util/auth.js's redirect there is what puts `?r=` on the URL in the
// first place). Resolves once `htmx.ajax` (the body-swap call inside
// redirectTo) has been invoked, which is the last observable effect of
// today's implementation.
async function loadAppAndTriggerInitialSession(url) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url });
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.history = window.history;

  if (window.document.readyState === 'loading') {
    await new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }

  const session = { access_token: 'tok-1', refresh_token: 'refresh-1' };
  const supabaseStub = {
    createClient: () => ({
      auth: {
        onAuthStateChange: () => {},
        // No Discord identity: _syncDiscordToProfile must bail on the
        // `error` branch before ever touching fetch().
        getUser: async () => ({ data: null, error: 'no-user' }),
        getSession: async () => ({ data: { session } })
      }
    })
  };

  const ajaxCalls = [];
  let resolveAjaxCalled;
  const ajaxCalled = new Promise((resolve) => { resolveAjaxCalled = resolve; });
  const htmxStub = { ajax: (...args) => { ajaxCalls.push(args); resolveAjaxCalled(); } };

  const historyCalls = { replaceState: [], pushState: [] };
  window.history.replaceState = (...args) => historyCalls.replaceState.push(args);
  window.history.pushState = (...args) => historyCalls.pushState.push(args);

  const loadModule = new Function('document', 'supabase', 'htmx', `${APP_SOURCE}\nreturn App;`);
  const App = loadModule(window.document, supabaseStub, htmxStub);

  App.init('https://test.invalid', 'test-publishable-key');
  await ajaxCalled;

  return { ajaxCalls, historyCalls };
}

test('an auth-driven redirect to a valid in-app path writes a matching, replaceState history entry', async () => {
  const { ajaxCalls, historyCalls } = await loadAppAndTriggerInitialSession(
    'http://localhost/auth/check?r=%2Fnav%2Fmanage'
  );

  // Sanity check on the pre-existing (already-correct) part of the
  // behavior: the body swap targets the redirect param.
  expect(ajaxCalls[0][1]).toBe('/nav/manage');

  // The missing behavior: the address bar must be updated to match what
  // was actually rendered, via replaceState (not pushState, so Back does
  // not land the user on /auth/check and re-trigger the bounce).
  expect(historyCalls.pushState.length).toBe(0);
  expect(historyCalls.replaceState.length).toBe(1);
  expect(historyCalls.replaceState[0][2]).toBe('/nav/manage');
});

test.each([
  ['//evil.com'],
  ['/\\evil.com'],
  ['https://evil.com'],
  ['not-a-path']
])('an unsafe ?r=%s is never written to history verbatim', async (unsafe) => {
  const url = `http://localhost/auth/check?r=${encodeURIComponent(unsafe)}`;
  const { ajaxCalls, historyCalls } = await loadAppAndTriggerInitialSession(url);

  // getRedirectUrl() already rejects all of these, so redirectTo falls back
  // to '/' -- that part already passes today. The point of this test is
  // that the history write must use that same sanitized fallback, not some
  // independent read of the raw query string.
  expect(ajaxCalls[0][1]).toBe('/');

  expect(historyCalls.replaceState.length).toBe(1);
  expect(historyCalls.replaceState[0][2]).toBe('/');
  for (const call of historyCalls.replaceState) {
    expect(call[2]).not.toBe(unsafe);
  }
});

// The four "unsafe ?r=" tests above only exercise getRedirectUrl()'s own
// filter: an unsafe `?r=` is rejected there, so redirectTo() only ever
// receives the already-sanitized fallback '/' -- the hostile string never
// reaches the guard inside redirectTo itself. Disabling that guard (e.g.
// `if (true) { history.replaceState(...) }`) leaves all five tests above
// green, because none of them route an unsafe value into redirectTo
// directly.
//
// There is a second, currently-reachable route that does: the no-`?r=`
// "refresh current page" branch (app.js's INITIAL_SESSION handling, ~line
// 996-1000) builds `current` from `window.location.pathname + search` and
// passes THAT straight to redirectTo(url), on a 100ms timer. A pathname can
// legitimately start with "//" -- e.g. `http://app.com//evil.com` parses to
// pathname "//evil.com" -- so this is a real, reachable path to a
// protocol-relative value reaching redirectTo, with no upstream filter.
// This is exactly the scenario `15ab2f6` hardened against, and exactly what
// redirectTo's own guard exists to stop even if every upstream filter were
// ever bypassed or a future call site added one that doesn't filter.
test('an unsafe window.location.pathname reaching redirectTo via the no-?r= timer branch is never written to history, but the swap still happens', async () => {
  const { ajaxCalls, historyCalls } = await loadAppAndTriggerInitialSession('http://localhost//evil.com');

  // Reached the timer branch, not a getRedirectUrl-filtered one: the swap
  // target is the raw unsafe pathname itself, confirming this test takes a
  // different route through the code than the four above.
  expect(ajaxCalls[0][1]).toBe('//evil.com');

  // Skipping the URL update must not silently break navigation -- the user
  // still gets the page, just without the address bar being rewritten to
  // something off-site.
  expect(historyCalls.replaceState.length).toBe(0);
});

// ar-h6rt (second defect): the no-?r= "refresh current page" branch (app.js
// ~995-1000) captures `current` from window.location at event time, then
// schedules `redirectTo(current)` on a 100ms setTimeout. Under hx-boost a
// user can navigate to a different in-app page inside that 100ms window --
// a boosted navigation is a client-side body swap that updates the URL
// without a page load, so both the JS realm and the pending timer survive
// it. The timer then fires and calls redirectTo() with the STALE url it
// captured before the navigation, bouncing the user back to the page they
// just left.
//
// Loads a fresh app.js/jsdom pair identically to
// loadAppAndTriggerInitialSession above, but additionally intercepts the
// global `setTimeout` app.js's timer branch calls (it is not passed in as a
// parameter the way document/supabase/htmx are, so it resolves against
// whatever `globalThis.setTimeout` is at call time). Capturing the
// scheduled callback -- instead of waiting out the real 100ms -- lets each
// test decide deterministically whether a simulated boosted navigation
// happens before or after the deferred refresh runs, with no dependency on
// wall-clock timing and no race between the navigation and the timer.
async function loadAppAndTriggerInitialSessionWithTimerControl(url) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url });
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.history = window.history;

  if (window.document.readyState === 'loading') {
    await new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }

  const session = { access_token: 'tok-1', refresh_token: 'refresh-1' };
  const supabaseStub = {
    createClient: () => ({
      auth: {
        onAuthStateChange: () => {},
        getUser: async () => ({ data: null, error: 'no-user' }),
        getSession: async () => ({ data: { session } })
      }
    })
  };

  const ajaxCalls = [];
  const htmxStub = { ajax: (...args) => { ajaxCalls.push(args); } };

  // Several unrelated things also schedule setTimeout during this path:
  // jsdom's own localStorage backing-store flush runs on a 0ms timer (fired
  // by _setTokens()'s two setItem() calls), and app.js's start() schedules a
  // 100ms ToastUI-editor-init timer (initializeUIComponents(), after
  // _handleAuthStateChange() returns). The no-?r= branch's deferred refresh
  // is the first 100ms timer scheduled, so filter to 100ms delays and take
  // the first of those.
  const realSetTimeout = globalThis.setTimeout;
  const capturedTimers = [];
  globalThis.setTimeout = (fn, ms) => {
    capturedTimers.push({ fn, ms });
    return 0;
  };

  const loadModule = new Function('document', 'supabase', 'htmx', `${APP_SOURCE}\nreturn App;`);
  const App = loadModule(window.document, supabaseStub, htmxStub);

  App.init('https://test.invalid', 'test-publishable-key');

  // Let the async chain leading up to the setTimeout call settle
  // (getSession(), _handleAuthStateChange's own awaits, _syncDiscordToProfile)
  // without waiting on real timers: queue behind the pending microtasks with
  // a real setTimeout(_, 0) macrotask.
  await new Promise((resolve) => realSetTimeout(resolve, 0));

  globalThis.setTimeout = realSetTimeout;

  const deferredRefreshTimer = capturedTimers.find((entry) => entry.ms === 100);
  const capturedTimerFn = deferredRefreshTimer && deferredRefreshTimer.fn;
  if (typeof capturedTimerFn !== 'function') {
    throw new Error('expected the no-?r= INITIAL_SESSION branch to schedule a deferred refresh via setTimeout');
  }

  return {
    ajaxCalls,
    window,
    fireDeferredRefresh: () => capturedTimerFn()
  };
}

test('a boosted navigation away from the page before the deferred refresh fires is not undone by a stale redirect', async () => {
  const { ajaxCalls, window, fireDeferredRefresh } = await loadAppAndTriggerInitialSessionWithTimerControl(
    'http://localhost/nav/manage'
  );

  // Simulate an hx-boost navigation completing inside the 100ms window: it
  // updates window.location without a page load, the same way
  // history.replaceState/pushState do under hx-boost.
  window.history.replaceState(null, '', '/characters');

  fireDeferredRefresh();

  // The deferred refresh must not act on the stale '/nav/manage' it
  // captured when the timer was scheduled -- the user already left that
  // page, and dragging them back to it is exactly the reported bug.
  const staleRedirects = ajaxCalls.filter((args) => args[1] === '/nav/manage');
  expect(staleRedirects.length).toBe(0);
});

test('staying on the same page through the deferred-refresh window still triggers the authed re-render', async () => {
  const { ajaxCalls, fireDeferredRefresh } = await loadAppAndTriggerInitialSessionWithTimerControl(
    'http://localhost/nav/manage'
  );

  // No navigation happens this time -- the mechanism's whole purpose is to
  // re-fetch the still-current page with auth headers so the server can
  // render the authed view, and that must keep working.
  fireDeferredRefresh();

  expect(ajaxCalls.length).toBe(1);
  expect(ajaxCalls[0][1]).toBe('/nav/manage');
});
