// App.initTooltips / App.destroyTooltips are the public entry points that
// client-rendered markup (the character wizard, gear purchases) uses to wire
// up tooltips without an htmx swap. Loads app.js the way
// test/history-restore-auth-header.test.js does, with tippy stubbed.
const { test, expect, afterEach } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

afterEach(() => {
  delete globalThis.tippy;
});

function loadApp() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="root">
      <span class="stat" data-tooltip-markdown>Will</span>
      <div class="tooltip-markdown"><p>Baseline</p></div>
    </div>
    <span class="outside" data-tooltip-markdown>Spirit</span>
    <div class="tooltip-markdown"><p>Other</p></div>
  </body></html>`, { url: 'http://localhost/characters/new' });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.history = window.history;

  const calls = [];
  globalThis.tippy = (el, options) => {
    const instance = { options, destroyed: false, destroy() { this.destroyed = true; delete el._tippy; } };
    el._tippy = instance;
    calls.push({ el, options });
    return instance;
  };

  const loadModule = new Function('document', 'supabase', 'htmx', `${APP_SOURCE}\nreturn App;`);
  const App = loadModule(window.document, { createClient: () => ({}) }, { ajax: () => {} });
  return { App, document: window.document, calls };
}

test('App.initTooltips attaches tippy to tooltip triggers under the given root only', () => {
  const { App, document, calls } = loadApp();
  const root = document.getElementById('root');

  App.initTooltips(root);

  const stat = document.querySelector('.stat');
  expect(calls.length).toBe(1);
  expect(calls[0].el === stat).toBe(true);
  expect(calls[0].options.content).toContain('Baseline');
  expect(document.querySelector('.outside')._tippy).toBeUndefined();
});

test('App.destroyTooltips tears down the instances App.initTooltips created', () => {
  const { App, document } = loadApp();
  const root = document.getElementById('root');
  App.initTooltips(root);
  const instance = document.querySelector('.stat')._tippy;

  App.destroyTooltips(root);

  expect(instance.destroyed).toBe(true);
  expect(document.querySelector('.stat')._tippy).toBeUndefined();
});
