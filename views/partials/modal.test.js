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
       @close-modal.window="close()"
       @keydown.escape.window="close()">
    <div class="modal-background" id="bg" @click="close()"></div>
    <button class="delete" id="x" @click="close()"></button>
  </div>
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
