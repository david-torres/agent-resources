// test/auth-initial-session-dispatch.test.js
//
// ar-h6rt (third defect): app.js dispatched INITIAL_SESSION twice per page
// load.
//
//   1. init() subscribes: supabaseClient.auth.onAuthStateChange(
//      _handleAuthStateChange). supabase-js emits INITIAL_SESSION to every
//      subscriber on its own -- onAuthStateChange() fires an async IIFE
//      that awaits initializePromise, takes the lock, then calls
//      _emitInitialSession(id), which invokes the callback with
//      ('INITIAL_SESSION', session). See
//      node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:1233-1253.
//   2. init() ALSO calls _handleAuthStateChange('INITIAL_SESSION', session)
//      directly, from its own await getSession().
//
// The INITIAL_SESSION branch is not idempotent -- its only guard protects
// token writing, not the redirect -- so both dispatches ran the full path:
// two _syncDiscordToProfile() round-trips and two redirectTo() body swaps
// of the whole page. A production HAR of one /auth/check bounce shows
// exactly that: two GET /auth/v1/user, two POST /profile/discord/sync, and
// two htmx GET /nav/manage ~200ms apart.
//
// test/auth-redirect-history.test.js could not catch this: its supabase
// stub uses `onAuthStateChange: () => {}`, which never emits, so only the
// manual dispatch ever ran. The stub below emits the way the real client
// does, which is the whole point of this file.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP_JS_PATH = path.join(__dirname, '..', 'public', 'js', 'app.js');
const APP_SOURCE = fs.readFileSync(APP_JS_PATH, 'utf8');

// Same loading strategy as auth-redirect-history.test.js (see the long note
// at the top of that file for why `new Function` rather than vm/require):
// app.js is a browser-global IIFE with no exports.
async function loadAppWithEmittingAuthStub(url) {
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
  const getUserCalls = [];

  const supabaseStub = {
    createClient: () => ({
      auth: {
        // Faithful to supabase-js: registering a listener schedules an
        // asynchronous INITIAL_SESSION emit to that listener.
        onAuthStateChange: (callback) => {
          (async () => { await callback('INITIAL_SESSION', session); })();
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        getUser: async () => {
          getUserCalls.push(Date.now());
          // No Discord identity: _syncDiscordToProfile bails on the `error`
          // branch before touching fetch().
          return { data: null, error: 'no-user' };
        },
        getSession: async () => ({ data: { session } })
      }
    })
  };

  const ajaxCalls = [];
  const htmxStub = { ajax: (...args) => { ajaxCalls.push(args); } };

  window.history.replaceState = () => {};
  window.history.pushState = () => {};

  const loadModule = new Function('document', 'supabase', 'htmx', `${APP_SOURCE}\nreturn App;`);
  const App = loadModule(window.document, supabaseStub, htmxStub);

  App.init('https://test.invalid', 'test-publishable-key');

  // Let BOTH dispatch paths finish. The subscription emit and the manual
  // getSession() dispatch are independent async chains, so this waits well
  // past either of them settling rather than racing the first one.
  await new Promise((resolve) => setTimeout(resolve, 100));

  return { ajaxCalls, getUserCalls };
}

test('INITIAL_SESSION triggers exactly one redirect body swap', async () => {
  const { ajaxCalls } = await loadAppWithEmittingAuthStub(
    'http://localhost/auth/check?r=%2Fnav%2Fmanage'
  );

  // Still redirects to the right place...
  expect(ajaxCalls.length).toBeGreaterThan(0);
  expect(ajaxCalls[0][1]).toBe('/nav/manage');

  // ...but only once. A second swap re-renders the whole page and destroys
  // any state the first swap established.
  expect(ajaxCalls.length).toBe(1);
});

test('INITIAL_SESSION runs the Discord profile sync exactly once', async () => {
  const { getUserCalls } = await loadAppWithEmittingAuthStub(
    'http://localhost/auth/check?r=%2Fnav%2Fmanage'
  );

  expect(getUserCalls.length).toBe(1);
});
