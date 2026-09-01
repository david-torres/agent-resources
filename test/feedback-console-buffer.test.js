// The console ring buffer behind the "Recent browser console output" option
// of the in-app reporter (views/partials/feedback-widget.handlebars).
//
// This is an EXECUTION test in the style of test/auth-signin-error-loading.js:
// app.js is a classic <script> IIFE with no exports, so it is loaded via
// `new Function('document', 'supabase', 'htmx', source + '; return App;')`
// against a fresh jsdom window (see test/auth-redirect-history.test.js for why
// not vm.runInContext).
//
// Two properties matter enough to pin here. The recorder must patch
// WINDOW.console rather than the free `console` binding -- under jsdom those
// are different objects, and patching the runner's own console would capture
// every line this suite prints. And it must never swallow a call: a logger
// that eats output is worse than no buffer at all.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

// A fresh window per test: the recorder marks the console it patched, so a
// shared window would only ever be patched once.
const loadApp = () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="alerts"></div></body></html>', {
    url: 'http://localhost/characters'
  });
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.navigator = window.navigator;

  const forwarded = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    window.console[level] = (...args) => forwarded.push({ level, args });
  }

  const supabaseStub = { createClient: () => ({ auth: { onAuthStateChange: () => {} } }) };
  const htmxStub = { ajax: () => {}, swap: () => {} };
  const App = new Function('document', 'supabase', 'htmx', `${APP_SOURCE}\nreturn App;`)(
    window.document,
    supabaseStub,
    htmxStub
  );

  return { window, App, forwarded };
};

test('console output is recorded without App.init() ever being called', () => {
  const { window, App } = loadApp();
  // Deliberately no App.init(): an error thrown while the page is still
  // loading has to be in the buffer too, and init only runs on DOMContentLoaded.
  window.console.warn('something looks off');

  const entries = App.getConsoleLog();
  expect(entries.length).toBeGreaterThan(0);
  expect(entries[entries.length - 1].level).toBe('warn');
  expect(entries[entries.length - 1].message).toBe('something looks off');
  expect(entries[entries.length - 1].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test('recording never swallows the call: the underlying console still receives it', () => {
  const { window, App, forwarded } = loadApp();
  window.console.error('save failed', 500);

  expect(forwarded).toHaveLength(1);
  expect(forwarded[0].level).toBe('error');
  expect(forwarded[0].args).toEqual(['save failed', 500]);
  expect(App.getConsoleLog()[0].message).toBe('save failed 500');
});

test('an Error argument is recorded by name and message, not as "[object Object]"', () => {
  const { window, App } = loadApp();
  window.console.error(new TypeError('x is not a function'));

  expect(App.getConsoleLog()[0].message).toBe('TypeError: x is not a function');
});

test('a circular object is recorded rather than throwing out of the logger', () => {
  const { window, App } = loadApp();
  const circular = { name: 'loop' };
  circular.self = circular;

  expect(() => window.console.log(circular)).not.toThrow();
  expect(App.getConsoleLog()).toHaveLength(1);
});

test('the buffer keeps the most recent 50 entries and drops the oldest', () => {
  const { window, App } = loadApp();
  for (let i = 0; i < 60; i += 1) window.console.log(`entry ${i}`);

  const entries = App.getConsoleLog();
  expect(entries).toHaveLength(50);
  expect(entries[0].message).toBe('entry 10');
  expect(entries[entries.length - 1].message).toBe('entry 59');
});

// An uncaught error never reaches console.error on its own -- the browser
// reports it itself -- so it is captured separately, and it is exactly the
// thing a bug report needs.
test('an uncaught error is captured even though it never calls console.error', () => {
  const { window, App } = loadApp();
  window.dispatchEvent(new window.ErrorEvent('error', {
    message: 'Uncaught ReferenceError: App is not defined',
    filename: 'http://localhost/js/app.js',
    lineno: 42
  }));

  const entries = App.getConsoleLog();
  expect(entries).toHaveLength(1);
  expect(entries[0].level).toBe('error');
  expect(entries[0].message).toContain('Uncaught ReferenceError');
  expect(entries[0].message).toContain('app.js:42');
});

test('getConsoleLog returns a copy, so a caller cannot mutate the buffer', () => {
  const { window, App } = loadApp();
  window.console.log('first');

  App.getConsoleLog().push({ level: 'error', at: '', message: 'injected' });

  expect(App.getConsoleLog()).toHaveLength(1);
});

test('browser info reports the environment and no more than the fields the server keeps', () => {
  const { App } = loadApp();
  const info = App.getBrowserInfo();

  expect(info.userAgent).toContain('jsdom');
  expect(info.language).toBeTruthy();
  // Anything outside this set is dropped server-side (services/feedback/input.js);
  // collecting more in the browser than the server will keep is misleading.
  expect(Object.keys(info).sort()).toEqual([
    'cookiesEnabled', 'devicePixelRatio', 'language', 'online',
    'platform', 'screen', 'timezone', 'userAgent', 'viewport'
  ]);
});
