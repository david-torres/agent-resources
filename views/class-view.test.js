const { test, expect, beforeAll, beforeEach } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => {
  await setupAlpine();
  require('../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

// document.body is shared across every test in this process; a leaked
// modal-open from a previous test would make a later test pass or fail for
// the wrong reason.
beforeEach(() => {
  document.body.classList.remove('modal-open');
});

const SRC = fs.readFileSync(path.join(__dirname, 'class-view.handlebars'), 'utf8');

test('class-view no longer calls App.openModal or App.closeModal', () => {
  expect(SRC).not.toContain('App.openModal');
  expect(SRC).not.toContain('App.closeModal');
});

test('class-view no longer carries the data-clear-on-close contract', () => {
  expect(SRC).not.toContain('data-clear-on-close');
  expect(SRC).not.toContain('data-clear-target');
});

test('class-view wires up both modals through the shared modal components', () => {
  expect(SRC).toContain("modal('duplicate')");
  expect(SRC).toContain("clearingModal('unlockCode')");
  expect(SRC).toContain("$dispatch('open-modal', 'duplicate')");
  expect(SRC).toContain("$dispatch('open-modal', 'unlockCode')");
  expect(SRC).toContain('x-ref="result"');
});

// ar-7v3k fix wave, Fix 4: the test above (and the DUPLICATE_MODAL /
// UNLOCK_MODAL fixtures used by the behavioral tests below) only pinned
// component names, dispatches, and x-ref -- never the real template's
// `:class`/`@open-modal.window`/`@close-modal.window`/
// `@keydown.escape.window` bindings themselves. Deleting
// `:class="{ 'is-active': show }"` from either real modal in
// class-view.handlebars left every test in this file green (proven by
// deleting each and re-running before writing this test): the modal would
// open in JS state but never actually become visible. Brings this up to
// the standard set by views/partials/character-level-up.test.js:36-45.
test('the real duplicate modal carries all four modal bindings', () => {
  const duplicateChunk = SRC.slice(SRC.indexOf('id="duplicateModal-'), SRC.indexOf('id="unlockCodeModal"'));
  expect(duplicateChunk).toContain("x-data=\"modal('duplicate')\"");
  // Object form, deliberately -- the string form cannot remove a frozen
  // `is-active` (see public/js/alpine-components.js).
  expect(duplicateChunk).toContain(":class=\"{ 'is-active': show }\"");
  expect(duplicateChunk).toContain('@open-modal.window="open($event.detail)"');
  expect(duplicateChunk).toContain('@close-modal.window="close($event.detail)"');
  expect(duplicateChunk).toContain('@keydown.escape.window="close()"');
});

test('the real unlock-code modal carries all four modal bindings', () => {
  const unlockChunk = SRC.slice(SRC.indexOf('id="unlockCodeModal"'));
  expect(unlockChunk).toContain(":class=\"{ 'is-active': show }\"");
  expect(unlockChunk).toContain('@open-modal.window="open($event.detail)"');
  expect(unlockChunk).toContain('@close-modal.window="closeAndClear($event.detail)"');
  expect(unlockChunk).toContain('@keydown.escape.window="closeAndClear()"');
});

// Pins the template to the registered component: the clearing logic must
// live in public/js/alpine-components.js, not be re-implemented inline in
// the handlebars attribute. A template that inlines its own closeAndClear
// body would pass every behavioral test below against ITS OWN copy of the
// logic while the real component silently diverges or breaks -- see the
// class-view.test.js history for exactly this failure mode.
test('class-view does not inline the clearing logic itself', () => {
  expect(SRC).not.toContain('wasOpen');
  expect(SRC).not.toContain('$refs.result.innerHTML');
});

// The class-view page has no <table>, so `hx-target="closest tr"` has no
// ancestor to resolve against: htmx 2 throws htmx:targetError and never even
// sends the DELETE. The button must keep its hx-delete + hx-confirm but carry
// no hx-target at all (the route answers with HX-Location, mirroring
// missions/characters delete).
test('the delete button keeps hx-delete and hx-confirm but has no closest-tr hx-target', () => {
  expect(SRC).toContain('hx-delete="/classes/{{class.id}}"');
  expect(SRC).toContain('hx-confirm="Are you sure you want to delete this class?"');
  expect(SRC).not.toContain('hx-target="closest tr"');
});

// Mirrors the real duplicate-modal markup closely enough to exercise the
// shared shell: name-scoped open/close, Escape, and the body scroll lock.
const DUPLICATE_MODAL = `
  <div id="duplicateModal-c1" class="modal" x-data="modal('duplicate')"
       :class="{ 'is-active': show }"
       @open-modal.window="open($event.detail)"
       @close-modal.window="close($event.detail)"
       @keydown.escape.window="close()">
    <div class="modal-background" id="dup-bg" @click="close()"></div>
    <button type="button" class="delete" id="dup-delete" @click="close()"></button>
    <button type="button" class="button" id="dup-cancel" @click="close()">Cancel</button>
  </div>
`;

// Mirrors the real unlock-code-modal markup exactly: x-data references the
// REGISTERED clearingModal('unlockCode') component (see
// public/js/alpine-components.js), not an inline re-implementation of its
// body. This is deliberate -- an earlier version of this fixture inlined
// the whole closeAndClear() object via `{ ...modal('unlockCode'),
// closeAndClear(which) {...} }`, which meant every test below verified the
// FIXTURE's private copy of the clearing logic, not the component the
// template actually ships. Mutating (or deleting) the real component had
// zero effect on these tests. Referencing the registered component by name
// is what makes mutating public/js/alpine-components.js actually break
// this suite.
const UNLOCK_MODAL = `
  <div id="unlockCodeModal" class="modal" x-data="clearingModal('unlockCode')"
       :class="{ 'is-active': show }"
       @open-modal.window="open($event.detail)"
       @close-modal.window="closeAndClear($event.detail)"
       @keydown.escape.window="closeAndClear()">
    <div class="modal-background" id="unlock-bg" @click="closeAndClear()"></div>
    <button type="button" class="delete" id="unlock-delete" @click="closeAndClear()"></button>
    <div id="codeResult-c1" class="mt-4" x-ref="result">GENERATED-CODE</div>
    <button type="button" class="button" id="unlock-close" @click="closeAndClear()">Close</button>
  </div>
`;

const openUnlock = async () => {
  await render(UNLOCK_MODAL);
  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'unlockCode' }));
  await tick();
};

test('closing the unlock-code modal via the background clears its result target', async () => {
  await openUnlock();
  document.getElementById('unlock-bg').click();
  await tick();
  expect(document.getElementById('unlockCodeModal').classList.contains('is-active')).toBe(false);
  expect(document.body.classList.contains('modal-open')).toBe(false);
  expect(document.getElementById('codeResult-c1').innerHTML).toBe('');
});

test('closing the unlock-code modal via the delete button clears its result target', async () => {
  await openUnlock();
  document.getElementById('unlock-delete').click();
  await tick();
  expect(document.getElementById('unlockCodeModal').classList.contains('is-active')).toBe(false);
  expect(document.getElementById('codeResult-c1').innerHTML).toBe('');
});

test('closing the unlock-code modal via the footer Close button clears its result target', async () => {
  await openUnlock();
  document.getElementById('unlock-close').click();
  await tick();
  expect(document.getElementById('unlockCodeModal').classList.contains('is-active')).toBe(false);
  expect(document.getElementById('codeResult-c1').innerHTML).toBe('');
});

test('closing the unlock-code modal via Escape clears its result target', async () => {
  await openUnlock();
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await tick();
  expect(document.getElementById('unlockCodeModal').classList.contains('is-active')).toBe(false);
  expect(document.body.classList.contains('modal-open')).toBe(false);
  expect(document.getElementById('codeResult-c1').innerHTML).toBe('');
});

// Discrimination drill: a close-modal broadcast for the OTHER modal's name
// must not close this one, and -- specific to the clearing wrapper -- must
// not blank its result target either.
test('a close-modal event scoped to the other modal does not close or clear the unlock-code modal', async () => {
  document.body.innerHTML = DUPLICATE_MODAL + UNLOCK_MODAL;
  await tick();
  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'unlockCode' }));
  await tick();

  window.dispatchEvent(new window.CustomEvent('close-modal', { detail: 'duplicate' }));
  await tick();

  expect(document.getElementById('unlockCodeModal').classList.contains('is-active')).toBe(true);
  expect(document.body.classList.contains('modal-open')).toBe(true);
  expect(document.getElementById('codeResult-c1').innerHTML).toBe('GENERATED-CODE');
});

test('the duplicate modal opens and closes independently of the unlock-code modal', async () => {
  document.body.innerHTML = DUPLICATE_MODAL + UNLOCK_MODAL;
  await tick();
  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'duplicate' }));
  await tick();
  expect(document.getElementById('duplicateModal-c1').classList.contains('is-active')).toBe(true);
  expect(document.getElementById('unlockCodeModal').classList.contains('is-active')).toBe(false);

  document.getElementById('dup-cancel').click();
  await tick();
  expect(document.getElementById('duplicateModal-c1').classList.contains('is-active')).toBe(false);
  expect(document.body.classList.contains('modal-open')).toBe(false);
});

const Handlebars = require('handlebars');
const customHelpers = require('../util/handlebars');
const { renderMarkdown } = require('../util/markdown');
const handlebarsHelpers = require('handlebars-helpers')();

// class-view.handlebars calls `markdown`, which app.js registers separately
// from the util/handlebars bundle (app.js:62) -- without it Handlebars
// throws "Missing helper: markdown" and every test here fails for the wrong
// reason.
function renderClassView(context) {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('markdown', renderMarkdown);
  hb.registerPartial('breadcrumbs', '');
  hb.registerPartial('private-badge', '');
  return hb.compile(SRC)(context);
}

const pdfContext = (overrides) => ({
  profile: { name: 'Alice' },
  class: {
    id: 'lib-v1',
    name: 'Librarian',
    description: 'A class.',
    status: 'release',
    is_public: true,
    rules_edition: 'advent',
    rules_version: 'v1',
    pdf_storage_path: 'classes/lib-v1.pdf'
  },
  unlocked: true,
  classPdfAccessible: true,
  ...overrides
});

test('an expiring unlock renders an Access expires tag by the PDF button', () => {
  const html = renderClassView(pdfContext({ unlockExpiresAt: '2026-09-16T00:00:00Z' }));
  expect(html).toContain('Access expires');
  expect(html).toMatch(/Access expires\s+Sep 1[56], 2026/);
});

test('a permanent unlock renders no expiry tag', () => {
  const html = renderClassView(pdfContext({ unlockExpiresAt: null }));
  expect(html).toContain('Open Class PDF');
  expect(html).not.toContain('Access expires');
});

test('an inaccessible PDF renders no expiry tag', () => {
  const html = renderClassView(pdfContext({
    classPdfAccessible: false,
    unlockExpiresAt: '2026-09-16T00:00:00Z'
  }));
  expect(html).not.toContain('Access expires');
  expect(html).toContain('Unlock this class to gain access to the PDF.');
});
