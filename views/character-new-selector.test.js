const { test, expect, beforeAll, beforeEach } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

// ar-7v3k fix wave, Fix 2 -----------------------------------------------
//
// #restoreDraftModal (views/character-new-selector.handlebars) is the one
// remaining unconverted `.modal`, deliberately left alone -- converting it
// would drag in the localStorage draft flow this branch left for Phase 4.
// The global Escape-closes-any-`.modal.is-active` handler that used to
// cover every plain modal lived in public/js/app.js and was deleted once
// every OTHER modal grew its own Alpine `@keydown.escape.window`. This
// modal was missed: it kept its click-based dismiss paths
// (`data-restore-action`) but lost Escape entirely.
//
// This test executes the ACTUAL inline <script> from the real template
// (extracted verbatim, not hand-copied), so a regression in the shipped
// code -- not a stand-in -- is what makes it fail.

const SRC = fs.readFileSync(
  path.join(__dirname, 'character-new-selector.handlebars'),
  'utf8'
);

const MODAL_HTML = SRC.slice(
  SRC.indexOf('<!-- Restore saved draft modal:'),
  SRC.indexOf('<script src="/js/character-common.js"')
);

// The plain, no-attribute `<script>` block is the draft-restore IIFE; the
// other two <script> tags on this page carry a `src=` attribute and an
// empty body, so this regex only ever matches the one we want.
const SCRIPT_SRC = SRC.match(/<script>([\s\S]*?)<\/script>/)[1];

const STORAGE_KEY = 'agentResources.characterWizard';

beforeAll(async () => { await setupAlpine(); });

beforeEach(async () => {
  window.localStorage.clear();
  globalThis.localStorage = window.localStorage;
});

const mountWithDraft = async (draft) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  await render(MODAL_HTML);
  // Run the real inline script now that the modal markup is in the DOM --
  // mirrors how a browser executes it on page load, after the HTML above
  // it has parsed.
  (0, eval)(SCRIPT_SRC);
  await tick();
};

test('a saved draft opens the modal on load', async () => {
  await mountWithDraft({ mode: 'advent', classId: 'c1' });
  expect(document.getElementById('restoreDraftModal').classList.contains('is-active')).toBe(true);
});

test('Escape closes the restore-draft modal', async () => {
  await mountWithDraft({ mode: 'advent', classId: 'c1' });
  expect(document.getElementById('restoreDraftModal').classList.contains('is-active')).toBe(true);

  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await tick();

  expect(document.getElementById('restoreDraftModal').classList.contains('is-active')).toBe(false);
});

test('the dismiss button still closes the modal (existing path is untouched)', async () => {
  await mountWithDraft({ mode: 'advent', classId: 'c1' });
  document.querySelector('[data-restore-action="dismiss"]').click();
  await tick();
  expect(document.getElementById('restoreDraftModal').classList.contains('is-active')).toBe(false);
});

test('the real template still wires Escape without adopting the Alpine modal component', () => {
  expect(SRC).toContain("window.addEventListener('keydown'");
  expect(SRC).toContain("if (e.key === 'Escape') modal.classList.remove('is-active');");
  // Phase 4 work, deliberately not done here.
  expect(SRC).not.toContain("x-data=\"modal(");
  expect(SRC).not.toContain('@keydown.escape.window');
});
