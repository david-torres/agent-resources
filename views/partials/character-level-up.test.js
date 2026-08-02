const { test, expect, beforeAll, beforeEach } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { setupAlpine, render, tick } = require('../../test/helpers/alpine-dom');

beforeAll(async () => {
  await setupAlpine();
  require('../../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

// document.body is a shared, persistent object across every test in this
// file (render() only replaces body.innerHTML, never body's own class
// list). A modal-open left over from a previous test would make a later
// test pass or fail for the wrong reason, so start every test from a known
// state.
beforeEach(() => {
  document.body.classList.remove('modal-open');
});

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

test('character-level-up.js dispatches an event instead of calling App.openModal', () => {
  const src = read('../../public/js/character-level-up.js');
  expect(src).not.toContain('App.openModal');
  expect(src).toContain("new CustomEvent('open-modal'");
  expect(src).toContain("'levelUp'");
});

test('character-level-up.js comment documents the dispatch, not the old App.openModal call', () => {
  const src = read('../../public/js/character-level-up.js');
  expect(src).not.toContain("Open the modal with App.openModal");
  expect(src).toMatch(/Open the modal by dispatching:.*new CustomEvent\('open-modal', \{ detail: 'levelUp' \}\)/);
});

test('character-level-up.handlebars uses the modal Alpine component, not App.openModal/closeModal', () => {
  const src = read('character-level-up.handlebars');
  expect(src).toContain("x-data=\"modal('levelUp')\"");
  expect(src).toContain('@open-modal.window="open($event.detail)"');
  expect(src).toContain('@close-modal.window="close($event.detail)"');
  expect(src).toContain('@keydown.escape.window="close()"');
  expect(src).not.toContain('App.openModal');
  expect(src).not.toContain('App.closeModal');
  expect(src).not.toContain('data-clear-on-close');
});

test('app.js no longer defines or exports the modal helpers', () => {
  const src = read('../../public/js/app.js');
  expect(src).not.toContain('const openModal');
  expect(src).not.toContain('const closeModal');
  expect(src).not.toMatch(/^\s*openModal,?$/m);
  expect(src).not.toMatch(/^\s*closeModal,?$/m);
});

test('app.js no longer has the global modal Escape handler', () => {
  const src = read('../../public/js/app.js');
  expect(src).not.toContain("App.closeModal('#' + activeModal.id)");
  expect(src).not.toMatch(/document\.querySelector\('\.modal\.is-active'\)/);
});

test('the htmx:afterSwap re-init hub is untouched', () => {
  const src = read('../../public/js/app.js');
  // Asserts the hub still exists and is still wired to htmx:afterSwap -- the
  // original intent was to guard against this handler being deleted during
  // the modal-to-Alpine conversion. It deliberately does NOT pin which node
  // it's bound to (document vs document.body): that binding target is free
  // to change (e.g. ar-h6rt moved it to `document` so it survives the
  // redirectTo() body swap) without this test failing.
  expect(src).toMatch(/document(?:\.body)?\.addEventListener\('htmx:afterSwap'/);
  expect(src).toContain('_initTooltips(targetEl || document)');
  expect(src).toContain('_initSearchableSelects(targetEl || document)');
  expect(src).toContain('_initImageCroppers(targetEl || document)');
  expect(src).toContain('_initToastUIEditors(targetEl || document)');
});

test('no template calls App.openModal or App.closeModal', () => {
  const dir = path.join(__dirname, '..');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name))
      : e.name.endsWith('.handlebars') ? [path.join(d, e.name)] : []);
  const offenders = walk(dir).filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    return src.includes('App.openModal') || src.includes('App.closeModal');
  });
  expect(offenders).toEqual([]);
});

// End-to-end bridge test: this is the exact CustomEvent that
// character-level-up.js:238 dispatches. It proves the out-of-scope module's
// contract with the real, registered `modal` component -- not a
// hand-written copy of its logic.
test('a dispatched open-modal event for levelUp opens the level-up modal', async () => {
  await render(`
    <div id="levelUpModal" class="modal" x-data="modal('levelUp')"
         :class="show && 'is-active'"
         @open-modal.window="open($event.detail)"
         @close-modal.window="close($event.detail)"
         @keydown.escape.window="close()">
      <div class="modal-background" @click="close()"></div>
    </div>
  `);
  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'levelUp' }));
  await tick();
  expect(document.getElementById('levelUpModal').classList.contains('is-active')).toBe(true);
  expect(document.body.classList.contains('modal-open')).toBe(true);
});

test('an open-modal event for a different name does not open the level-up modal', async () => {
  await render(`
    <div id="levelUpModal" class="modal" x-data="modal('levelUp')"
         :class="show && 'is-active'"
         @open-modal.window="open($event.detail)"
         @close-modal.window="close($event.detail)"
         @keydown.escape.window="close()"></div>
  `);
  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'other' }));
  await tick();
  expect(document.getElementById('levelUpModal').classList.contains('is-active')).toBe(false);
});
