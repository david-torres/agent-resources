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

  // jsdom performs no layout, so offsetWidth/offsetHeight are always 0 for
  // every element, with no exceptions. Alpine's @click.outside (and anything
  // else that consults element dimensions to infer visibility) treats a
  // zero-sized element as hidden and skips handling it — under jsdom that
  // would be true unconditionally, so outside-click would never fire for
  // any component. Stub non-zero values so elements report as laid out.
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 100 });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 40 });

  alpine = (await import('alpinejs')).default;
  globalThis.Alpine = alpine;
  alpine.start();
  await alpine.nextTick();
  return alpine;
};

// Alpine's scheduler is microtask-based; reading the DOM synchronously
// after a trigger returns stale values. Always await this.
const tick = async () => { await alpine.nextTick(); };

// x-show is NOT covered by tick() alone. Alpine's x-transition module
// installs `Element.prototype._x_toggleAndCascadeWithTransitions`
// unconditionally at import time — every element gets it, not just ones
// using x-transition. x-show's directive checks for that method and, when
// present (always, once Alpine has booted), routes every toggle after the
// initial synchronous mount-time paint through
// `document.visibilityState === 'visible' ? requestAnimationFrame : setTimeout`.
// jsdom reports visibilityState as "visible", so the very first toggle a
// test triggers — reveal or hide — is deferred to a real animation frame,
// not a microtask. tick() (Alpine.nextTick()) only flushes microtasks, so
// it never observes this write.
//
// This is a false-pass hazard, not just a false-fail one: a test that
// clicks and then asserts `style.display === 'none'` after only tick()
// will PASS for the wrong reason — the element is still hidden because
// the toggle hasn't run yet, not because the hide logic is correct. A
// reveal assertion has the same hazard in the other direction. Always use
// settle() (not tick()) after any interaction that flips an x-show-bound
// value, before asserting on style.display. tick() remains correct and
// sufficient for :class, x-text, :disabled, and any other binding that
// doesn't route through x-show's transition-cascade hook.
const settle = async () => {
  await tick();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await tick();
};

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

module.exports = { setupAlpine, tick, settle, render, renderPartial };
