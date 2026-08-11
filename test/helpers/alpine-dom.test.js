const { test, expect, beforeAll } = require('bun:test');
const { setupAlpine, render, tick, settle } = require('./alpine-dom');

beforeAll(async () => { await setupAlpine(); });

test('Alpine initializes markup and evaluates expressions', async () => {
  await render('<div x-data="{ msg: \'ok\' }"><p x-text="msg"></p></div>');
  expect(document.querySelector('p').textContent).toBe('ok');
});

test('Alpine reacts to events after a tick', async () => {
  await render(`
    <div x-data="{ n: 1 }">
      <button @click="n++"></button>
      <span x-text="n"></span>
    </div>
  `);
  document.querySelector('button').click();
  await tick();
  expect(document.querySelector('span').textContent).toBe('2');
});

test('Alpine auto-initializes content inserted after start (hx-boost swap)', async () => {
  await render('<div x-data="{ a: 1 }"><i x-text="a"></i></div>');
  // A second render() is a full body replacement — exactly what hx-boost does.
  await render('<div x-data="{ b: 2 }"><i x-text="b"></i></div>');
  expect(document.querySelector('i').textContent).toBe('2');
});

test('Alpine tears down components whose nodes are removed', async () => {
  await render('<div id="gone" x-data="{ a: 1 }"></div>');
  const el = document.getElementById('gone');
  expect(el._x_marker).toBeDefined();
  await render('<p>replaced</p>');
  expect(el._x_marker).toBeUndefined();
});

// jsdom performs no layout, so offsetWidth/offsetHeight are 0 for every
// element unless setupAlpine() stubs them. Without that stub, Alpine's
// @click.outside sees a zero-sized element and treats it as hidden,
// skipping the handler entirely — so this regression guard would fail
// if the shim were ever removed from the shared harness.
test('offsetWidth/offsetHeight shim lets @click.outside actually fire', async () => {
  await render(`
    <div id="box" x-data="{ open: true }" :class="open && 'is-open'" @click.outside="open = false"></div>
    <a href="#" id="sibling">elsewhere</a>
  `);
  expect(document.getElementById('box').classList.contains('is-open')).toBe(true);
  document.getElementById('sibling').click();
  await tick();
  expect(document.getElementById('box').classList.contains('is-open')).toBe(false);
});

// x-transition installs Element.prototype._x_toggleAndCascadeWithTransitions
// unconditionally, so x-show routes every post-mount toggle through
// requestAnimationFrame (jsdom reports visibilityState "visible") even
// with no x-transition in use. tick() only flushes microtasks and never
// observes that write. This pins the actual behavior — not just that
// settle() "works", but that tick() alone is genuinely insufficient — so a
// regression (e.g. settle() silently degrading to a tick()-only wait)
// would fail this test rather than pass for the wrong reason.
test('x-show toggle is not visible after tick() alone, but is after settle()', async () => {
  await render(`
    <div x-data="{ open: false }">
      <button id="btn" @click="open = !open"></button>
      <div id="panel" x-show="open"></div>
    </div>
  `);
  const panel = document.getElementById('panel');
  expect(panel.style.display).toBe('none');

  document.getElementById('btn').click();
  await tick();
  // The toggle has not run yet: still hidden. Asserting "not.toBe('none')"
  // here would currently fail — that's the point of this guard.
  expect(panel.style.display).toBe('none');

  await settle();
  expect(panel.style.display).not.toBe('none');
});
