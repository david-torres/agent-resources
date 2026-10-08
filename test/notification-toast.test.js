// Issue #188: messages render only in the #alerts block at the top of the
// page, so a user scrolled down to a form's submit button never sees a save
// error. Every client message goes through app.js's notification path; it is
// shown as a toast instead -- a dismissible `.notification.is-<type>` in the
// #alerts toast region. Errors stay until the user dismisses them; anything
// else clears itself after a few seconds. One toast at a time.
//
// EXECUTION test: app.js is loaded the way test/history-restore-auth-header
// .test.js loads it. `setTimeout`/`clearTimeout` are injected as free
// identifiers so the auto-dismiss timer can be driven by a manual clock once
// boot has settled on real timers.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP_JS_PATH = path.join(__dirname, '..', 'public', 'js', 'app.js');
const APP_SOURCE = fs.readFileSync(APP_JS_PATH, 'utf8');

function createManualClock() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  const clock = {
    manual: false,
    setTimeout(fn, ms = 0, ...args) {
      if (!clock.manual) return setTimeout(fn, ms, ...args);
      const id = nextId++;
      pending.set(id, { at: now + ms, fn, args });
      return id;
    },
    clearTimeout(id) {
      if (pending.has(id)) pending.delete(id);
      else clearTimeout(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now) continue;
        pending.delete(id);
        timer.fn(...timer.args);
      }
    }
  };
  return clock;
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for app.js to settle');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function bootApp() {
  const dom = new JSDOM(
    '<!doctype html><html><body data-auth-optional="true">' +
      '<div id="alerts" class="toast-region" aria-live="polite"></div>' +
    '</body></html>',
    { url: 'http://localhost/characters/1/edit' }
  );
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.history = window.history;
  window.localStorage.setItem('authToken', 'stale');

  const supabaseStub = {
    createClient: () => ({
      auth: {
        onAuthStateChange: () => {},
        getUser: async () => ({ data: null, error: 'no-user' }),
        getSession: async () => ({ data: { session: null } })
      }
    })
  };
  const htmxStub = { ajax: () => {}, swap: () => {} };
  const clock = createManualClock();

  const loadModule = new Function(
    'document', 'supabase', 'htmx', 'setTimeout', 'clearTimeout',
    `${APP_SOURCE}\nreturn App;`
  );
  const App = loadModule(window.document, supabaseStub, htmxStub, clock.setTimeout, clock.clearTimeout);
  App.init('https://test.invalid', 'test-publishable-key');
  // A null session clears tokens on INITIAL_SESSION: init has fully run.
  await waitFor(() => window.localStorage.getItem('authToken') === null);
  clock.manual = true;

  return { window, clock };
}

function fireResponseError(window, response) {
  window.document.dispatchEvent(
    new window.CustomEvent('htmx:responseError', { detail: { xhr: { response } } })
  );
}

const toasts = (window) => window.document.querySelectorAll('#alerts .notification');

function clickCopyLink(window) {
  window.document.body.insertAdjacentHTML(
    'beforeend',
    '<section id="perks"><a href="#perks" data-anchor-copy>Link</a></section>'
  );
  window.document.querySelector('[data-anchor-copy]').click();
}

test('a save error replaces the current toast and stays until the user dismisses it', async () => {
  const { window, clock } = await bootApp();

  clickCopyLink(window);
  await waitFor(() => toasts(window).length === 1);
  fireResponseError(window, 'Perks must be 50 words or fewer.');

  expect(toasts(window).length).toBe(1);
  const [toast] = toasts(window);
  expect(toast.classList.contains('is-danger')).toBe(true);
  expect(toast.textContent).toContain('Perks must be 50 words or fewer.');

  // Neither the error's own lifetime nor the replaced toast's auto-dismiss
  // timer may take the error off screen.
  clock.advance(60_000);
  expect(toasts(window).length).toBe(1);

  const dismiss = toast.querySelector('button.delete');
  expect(dismiss.getAttribute('aria-label')).toBe('Dismiss');
  dismiss.click();
  expect(toasts(window).length).toBe(0);
});

test('a non-error toast clears itself after a few seconds', async () => {
  const { window, clock } = await bootApp();

  clickCopyLink(window);
  await waitFor(() => toasts(window).length === 1);
  expect(toasts(window)[0].classList.contains('is-danger')).toBe(false);

  clock.advance(3_000);
  expect(toasts(window).length).toBe(1);

  clock.advance(5_000);
  expect(toasts(window).length).toBe(0);
});
