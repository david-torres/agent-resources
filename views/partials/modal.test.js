const { test, expect, beforeAll, beforeEach } = require('bun:test');
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

const MODAL = `
  <div id="m" class="modal" x-data="modal('demo')" :class="show && 'is-active'"
       @open-modal.window="open($event.detail)"
       @close-modal.window="close($event.detail)"
       @keydown.escape.window="close()">
    <div class="modal-background" id="bg" @click="close()"></div>
    <button class="delete" id="x" @click="close()"></button>
  </div>
`;

// A trigger with NO x-data ancestor, exactly like the real "Mark as
// Deceased" button in character-form.handlebars. $dispatch is available
// even on elements outside any x-data scope (Alpine falls back to an
// implicit root scope), which is what every Task 17-19 trigger button
// relies on. Rendered as a sibling of the modal, not a parent, so the
// event has to bubble to `window` to be picked up -- there's no shared
// x-data ancestor doing the routing.
const TRIGGER_AND_MODAL = `
  <button id="trigger" @click="$dispatch('open-modal', 'demo')">Open</button>
  ${MODAL}
`;

// Two independently-named instances mounted together, both listening on
// window -- this is the exact shape of Task 18's per-row modals inside an
// {{#each}}.
const TWO_MODALS = `
  <div id="a" class="modal" x-data="modal('alpha')" :class="show && 'is-active'"
       @open-modal.window="open($event.detail)"
       @close-modal.window="close($event.detail)"
       @keydown.escape.window="close()"></div>
  <div id="b" class="modal" x-data="modal('beta')" :class="show && 'is-active'"
       @open-modal.window="open($event.detail)"
       @close-modal.window="close($event.detail)"
       @keydown.escape.window="close()"></div>
`;

test('modal starts closed and body has no modal-open', async () => {
  await render(MODAL);
  expect(document.getElementById('m').classList.contains('is-active')).toBe(false);
  expect(document.body.classList.contains('modal-open')).toBe(false);
});

test('a matching open-modal event opens it and locks the body', async () => {
  await render(MODAL);
  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'demo' }));
  await tick();
  expect(document.getElementById('m').classList.contains('is-active')).toBe(true);
  expect(document.body.classList.contains('modal-open')).toBe(true);
});

test('an open-modal event for a different name is ignored', async () => {
  await render(MODAL);
  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'other' }));
  await tick();
  expect(document.getElementById('m').classList.contains('is-active')).toBe(false);
  expect(document.body.classList.contains('modal-open')).toBe(false);
});

test('clicking the background closes it and unlocks the body', async () => {
  await render(MODAL);
  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'demo' }));
  await tick();
  document.getElementById('bg').click();
  await tick();
  expect(document.getElementById('m').classList.contains('is-active')).toBe(false);
  expect(document.body.classList.contains('modal-open')).toBe(false);
});

test('the delete button closes it', async () => {
  await render(MODAL);
  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'demo' }));
  await tick();
  document.getElementById('x').click();
  await tick();
  expect(document.getElementById('m').classList.contains('is-active')).toBe(false);
  expect(document.body.classList.contains('modal-open')).toBe(false);
});

test('Escape closes it', async () => {
  await render(MODAL);
  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'demo' }));
  await tick();
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await tick();
  expect(document.getElementById('m').classList.contains('is-active')).toBe(false);
  expect(document.body.classList.contains('modal-open')).toBe(false);
});

// Guards the exact scenario the brief calls out: a stray close-modal event
// must not strip body.modal-open while a DIFFERENT modal is still open.
// This modal is closed from the start; body.modal-open here stands in for
// that other modal's lock, and the guard (`if (!this.show) return`) must
// leave it alone.
test('close() on an already-closed modal does not strip a different modal\'s body lock', async () => {
  await render(MODAL);
  document.body.classList.add('modal-open');
  window.dispatchEvent(new window.CustomEvent('close-modal'));
  await tick();
  expect(document.getElementById('m').classList.contains('is-active')).toBe(false);
  expect(document.body.classList.contains('modal-open')).toBe(true);
});

// Exercises the real mechanism every Task 17-19 trigger button uses:
// $dispatch fired from a plain @click with no x-data ancestor, bubbling to
// a window listener. Every other test in this file opens the modal by
// dispatching the window CustomEvent directly from test code, which
// proves the component reacts correctly but never proves the trigger
// pattern itself works.
test('clicking a trigger button with no x-data ancestor opens the modal via $dispatch', async () => {
  await render(TRIGGER_AND_MODAL);
  document.getElementById('trigger').click();
  await tick();
  expect(document.getElementById('m').classList.contains('is-active')).toBe(true);
  expect(document.body.classList.contains('modal-open')).toBe(true);
});

// Task 18 mounts many per-row modal instances at once, all listening on
// the same window events. Every other name-matching test here uses only
// one instance, which proves it ignores a foreign name but not that a
// second, differently-named instance stays independent when both are
// mounted together.
test('two co-rendered instances open independently by name', async () => {
  await render(TWO_MODALS);

  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'alpha' }));
  await tick();
  expect(document.getElementById('a').classList.contains('is-active')).toBe(true);
  expect(document.getElementById('b').classList.contains('is-active')).toBe(false);

  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'beta' }));
  await tick();
  expect(document.getElementById('a').classList.contains('is-active')).toBe(true);
  expect(document.getElementById('b').classList.contains('is-active')).toBe(true);
});

// close(which) mirrors open(which): a close-modal event scoped to a
// different name must leave THIS modal open. Without the name filter, any
// close-modal broadcast -- e.g. the level-up bridge closing its own modal
// -- would also close whatever other modal happens to be open, and strip
// body.modal-open out from under it.
test('a close-modal event scoped to a different name does not close the open modal', async () => {
  await render(TWO_MODALS);
  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'alpha' }));
  await tick();

  window.dispatchEvent(new window.CustomEvent('close-modal', { detail: 'beta' }));
  await tick();

  expect(document.getElementById('a').classList.contains('is-active')).toBe(true);
  expect(document.body.classList.contains('modal-open')).toBe(true);
});
