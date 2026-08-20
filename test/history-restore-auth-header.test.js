// Issue #163: the back button blanks the page on a protected route.
//
// htmx restores history from a sessionStorage snapshot, and falls back to
// re-fetching the URL when that snapshot is missing (cache eviction past 10
// entries, a snapshot cached under the wrong key, blocked storage, quota
// eviction -- four ordinary triggers). That fallback, loadHistoryFromServer
// (htmx 2.0.8 dist 3310-3337), builds its own bare XMLHttpRequest:
//
//     request.open('GET', path, true)
//     request.setRequestHeader('HX-Request', 'true')
//     request.setRequestHeader('HX-History-Restore-Request', 'true')
//     ...
//     if (triggerEvent(body, 'htmx:historyCacheMiss', details)) request.send()
//
// It is not an htmx-managed request, so it never fires htmx:configRequest --
// the hook where this app writes its Authorization header. The restore
// therefore arrives at the server signed out, however signed in the user is.
//
// htmx puts the OPENED, UNSENT xhr on the event detail specifically so a
// listener can reach it, and fires the event before send(). Attaching the
// header there is the whole fix, and this file pins it.
//
// This is an EXECUTION test, not a source-text assertion, and loads app.js
// exactly the way test/auth-redirect-history.test.js does -- see that file's
// header for why `new Function(...)` rather than `vm.runInContext`.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP_JS_PATH = path.join(__dirname, '..', 'public', 'js', 'app.js');
const APP_SOURCE = fs.readFileSync(APP_JS_PATH, 'utf8');

// Boots app.js against a fresh jsdom window on a protected route, driven
// through the real auth path (App.init -> start -> stubbed getSession ->
// INITIAL_SESSION), and resolves once the tokens are actually in hand. The
// non-auth-page INITIAL_SESSION branch defers its redirectTo by 100ms, so
// waiting on htmx.ajax (what the sibling spec waits on) would not work here;
// _setTokens having run is the precondition this file actually needs.
async function bootSignedIn({ session = { access_token: 'tok-1', refresh_token: 'refresh-1' } } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/profile' });
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.history = window.history;

  const supabaseStub = {
    createClient: () => ({
      auth: {
        onAuthStateChange: () => {},
        // No Discord identity: _syncDiscordToProfile bails on `error`
        // before it can reach fetch().
        getUser: async () => ({ data: null, error: 'no-user' }),
        getSession: async () => ({ data: { session } })
      }
    })
  };
  const htmxStub = { ajax: () => {} };

  const loadModule = new Function('document', 'supabase', 'htmx', `${APP_SOURCE}\nreturn App;`);
  const App = loadModule(window.document, supabaseStub, htmxStub);

  App.init('https://test.invalid', 'test-publishable-key');
  if (session) {
    await waitFor(() => window.localStorage.getItem('authToken') === session.access_token);
  } else {
    // No session -> the INITIAL_SESSION else-branch clears tokens. Let that
    // settle so "no header" cannot pass merely because init had not run yet.
    await waitFor(() => window.localStorage.getItem('authToken') === null);
  }

  return window;
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for app.js to settle');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// Stands in for htmx's own request: opened, headers half-written, not yet
// sent. Records what a listener adds to it.
function fireHistoryCacheMiss(window, path = '/profile') {
  const headers = {};
  const xhr = { setRequestHeader: (name, value) => { headers[name] = value; } };
  const event = new window.CustomEvent('htmx:historyCacheMiss', {
    detail: { path, xhr, historyElt: window.document.body },
    bubbles: true,
    cancelable: true
  });
  window.document.body.dispatchEvent(event);
  return { headers, event };
}

test('the history-restore fetch carries the signed-in user\'s Authorization header', async () => {
  const window = await bootSignedIn();
  const { headers, event } = fireHistoryCacheMiss(window);

  expect(headers.Authorization).toBe('Bearer tok-1');
  expect(headers['Refresh-Token']).toBe('refresh-1');
  // htmx only sends the request if the event was NOT prevented. Cancelling it
  // here would replace a blank page with no page at all.
  expect(event.defaultPrevented).toBe(false);
});

test('a signed-out history-restore fetch is left alone rather than sent a bogus header', async () => {
  const window = await bootSignedIn({ session: null });
  const { headers, event } = fireHistoryCacheMiss(window);

  expect(Object.keys(headers)).toEqual([]);
  expect(event.defaultPrevented).toBe(false);
});
