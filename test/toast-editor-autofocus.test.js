// Issue #139: opening any form with a markdown editor scrolled the page to
// an editor in the middle of the form, taking the caret with it.
//
// ToastUI Editor's `autofocus` option defaults to TRUE
// (https://uicdn.toast.com/editor/latest/toastui-editor-all.min.js ships
// `autofocus:!0` in its default options), and the constructor ends with
// `this.moveCursorToStart(this.options.autofocus)`, which focuses the
// editor and scrolls it into view. Every `textarea[data-toast-editor]` on
// a page gets its own editor, so forms like class-form.handlebars (seven
// of them) yanked the viewport down to an editor the moment they loaded.
//
// Verified in Chromium against the real CDN bundle: two editors 1200px
// down a page leave window.scrollY at 1190 with the default options and at
// 0 with `autofocus: false`.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'app.js'),
  'utf8'
);

// app.js is a browser-global IIFE with no exports, and the editor setup is
// private, so drive it the way the other app.js tests do: evaluate the
// source with `new Function` and boot it through App.init().
async function bootWithEditorSpy(bodyHtml) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    url: 'http://localhost/classes/new'
  });
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.history = window.history;
  globalThis.MutationObserver = window.MutationObserver;

  const constructorOptions = [];
  // Stands in for the CDN's global `Editor`, which app.js looks up by bare
  // identifier -- inside `new Function` that resolves against globalThis.
  globalThis.Editor = class {
    constructor(options) {
      constructorOptions.push(options);
    }
    on() {}
    getMarkdown() { return ''; }
    getRootElement() { return null; }
    destroy() {}
  };

  const supabaseStub = {
    createClient: () => ({
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getUser: async () => ({ data: null, error: 'no-user' }),
        getSession: async () => ({ data: { session: null } })
      }
    })
  };

  const loadModule = new Function('document', 'supabase', 'htmx', `${APP_SOURCE}\nreturn App;`);
  const App = loadModule(window.document, supabaseStub, { ajax: () => {} });
  App.init('https://test.invalid', 'test-publishable-key');

  // initializeUIComponents() defers _initToastUIEditors by 100ms.
  await new Promise((resolve) => setTimeout(resolve, 250));

  delete globalThis.Editor;
  return constructorOptions;
}

test('editors on a form are created without stealing focus', async () => {
  const options = await bootWithEditorSpy(`
    <form>
      <input name="name">
      <textarea name="teaser" data-toast-editor></textarea>
      <textarea name="description" data-toast-editor></textarea>
    </form>
  `);

  expect(options.length).toBe(2);
  for (const opts of options) {
    expect(opts.autofocus).toBe(false);
  }
});
