// jsdom + Alpine bootstrap for component tests.
//
// Alpine needs a set of DOM constructors as *globals*, not just on
// dom.window. ShadowRoot in particular is load-bearing: Alpine's
// findClosest does `el.parentNode instanceof ShadowRoot` during start(),
// and its absence throws a ReferenceError that kills startup. Alpine must
// also be imported after those globals exist.
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const { JSDOM } = require('jsdom');

const GLOBAL_KEYS = [
  'window', 'document', 'navigator', 'MutationObserver', 'Element',
  'HTMLElement', 'Node', 'CustomEvent', 'Event', 'requestAnimationFrame',
  'cancelAnimationFrame', 'getComputedStyle', 'ShadowRoot', 'DocumentFragment'
];

let alpine = null;

// Boot jsdom + Alpine once per test process. Alpine is a module singleton
// and warns loudly if start() runs twice, so this is idempotent.
const setupAlpine = async () => {
  if (alpine) return alpine;

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true
  });
  for (const key of GLOBAL_KEYS) globalThis[key] = dom.window[key];

  alpine = (await import('alpinejs')).default;
  globalThis.Alpine = alpine;
  alpine.start();
  await alpine.nextTick();
  return alpine;
};

// Alpine's scheduler is microtask-based; reading the DOM synchronously
// after a trigger returns stale values. Always await this.
const tick = async () => { await alpine.nextTick(); };

// Replace the body and let Alpine's MutationObserver initialize it. This
// is also how we simulate an hx-boost body swap.
const render = async (html) => {
  document.body.innerHTML = html;
  await tick();
  return document.body;
};

// Compile a Handlebars partial from views/partials and mount it.
const renderPartial = async (name, context) => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'views', 'partials', `${name}.handlebars`),
    'utf8'
  );
  return render(Handlebars.compile(src)(context));
};

module.exports = { setupAlpine, tick, render, renderPartial };
