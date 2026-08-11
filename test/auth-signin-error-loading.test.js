// signIn() (public/js/app.js ~line 1170) calls _toggleFormLoading(form, true)
// before awaiting supabaseClient.auth.signInWithPassword(). When that call
// fails (e.g. wrong password), the catch block calls _reportAuthError but
// never calls _toggleFormLoading(form, false). The result: the #sign-in form
// is left permanently covered by the .form-loading-overlay, keeps the
// has-form-overlay class, the submit button keeps is-loading, and every
// control stays disabled -- the user cannot correct their password and retry.
// (The same defect exists in signUp, sendSignInLink and sendSignUpLink.)
//
// The intended contract: on auth failure, the error notification is shown AND
// the form loading state is fully cleared.
//
// This is an EXECUTION test modeled on test/auth-redirect-history.test.js
// (see the header comment there for why app.js -- a classic <script> IIFE
// with no exports -- is loaded via `new Function('document', 'supabase',
// 'htmx', source + '; return App;')` against a fresh jsdom window, rather
// than vm.runInContext, which Bun cannot run against jsdom globals).
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP_JS_PATH = path.join(__dirname, '..', 'public', 'js', 'app.js');
const APP_SOURCE = fs.readFileSync(APP_JS_PATH, 'utf8');

// Loads a fresh app.js against a fresh jsdom window whose body contains the
// #sign-in form (mirroring views/partials/signin-form.handlebars) and the
// #alerts container, drives App.init() through its INITIAL_SESSION path with
// a null session (data-auth-optional='true' so no redirect fires), then
// submits the form via App.signIn() against a supabase stub whose
// signInWithPassword always fails like a wrong password does in production.
async function loadAppAndFailSignIn() {
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
      '<div id="alerts"></div>' +
      '<form id="sign-in">' +
        '<div class="field"><div class="control">' +
          '<input class="input" type="email" name="email" value="user@example.com">' +
        '</div></div>' +
        '<div class="field"><div class="control">' +
          '<input class="input" type="password" name="password" value="wrong">' +
        '</div></div>' +
        '<button class="button" type="submit">Sign In</button>' +
      '</form>' +
    '</body></html>',
    { url: 'http://localhost/auth/signin' }
  );
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.history = window.history;
  // signIn() does `new FormData(form)` -- Bun's built-in FormData rejects a
  // jsdom HTMLFormElement, so resolve the free identifier to jsdom's own.
  globalThis.FormData = window.FormData;

  if (window.document.readyState === 'loading') {
    await new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }

  // A null session plus data-auth-optional='true' makes INITIAL_SESSION a
  // no-op (clear tokens, no redirect), so init settles without htmx.ajax
  // ever being called and the sign-in form stays on screen.
  window.document.body.setAttribute('data-auth-optional', 'true');

  const supabaseStub = {
    createClient: () => ({
      auth: {
        onAuthStateChange: () => {},
        getUser: async () => ({ data: null, error: 'no-user' }),
        getSession: async () => ({ data: { session: null } }),
        signInWithPassword: async () => ({ data: null, error: { message: 'Invalid login credentials' } })
      }
    })
  };

  // Neither the init path (no redirect, no calendar) nor the failing signIn
  // path reaches htmx; ajax/swap are stubbed so any unexpected call is inert.
  const htmxStub = { ajax: () => {}, swap: () => {} };

  const loadModule = new Function('document', 'supabase', 'htmx', `${APP_SOURCE}\nreturn App;`);
  const App = loadModule(window.document, supabaseStub, htmxStub);

  App.init('https://test.invalid', 'test-publishable-key');
  // start() is async (getSession -> _handleAuthStateChange) but schedules no
  // ajax on this path, so queue behind its microtasks with a 0ms macrotask.
  await new Promise((resolve) => setTimeout(resolve, 0));

  await App.signIn({ preventDefault() {}, stopPropagation() {} });

  return { window };
}

test('a failed password sign-in shows the error and clears the form loading state so the user can retry', async () => {
  const { window } = await loadAppAndFailSignIn();
  const form = window.document.getElementById('sign-in');

  // Already-correct behavior, pinned here so the fix cannot regress it: the
  // failure is surfaced to the user as a danger notification in #alerts.
  const notification = window.document.querySelector('#alerts .notification.is-danger');
  expect(notification).not.toBeNull();
  expect(notification.textContent).toBe('Invalid login credentials');

  // The missing behavior: the loading state applied before the auth call
  // must be fully torn down when the call fails. Today none of this happens
  // -- the catch block never calls _toggleFormLoading(form, false), so the
  // overlay, classes and disabled attributes all persist.
  expect(form.classList.contains('has-form-overlay')).toBe(false);
  expect(form.querySelector('.form-loading-overlay')).toBeNull();

  const submitButton = form.querySelector('button[type="submit"]');
  expect(submitButton.classList.contains('is-loading')).toBe(false);

  const emailInput = form.querySelector('input[name="email"]');
  expect(emailInput.disabled).toBe(false);
});
