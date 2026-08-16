const { test, expect, beforeAll } = require('bun:test');
const fs = require('fs');
const path = require('path');

const source = () => fs.readFileSync(
  path.join(__dirname, 'character-form.handlebars'), 'utf8'
);

test('deceased modal opens through the modal Alpine component, not App.openModal', () => {
  const html = source();
  expect(html).toContain("$dispatch('open-modal', 'deceased')");
  expect(html).toContain("x-data=\"modal('deceased')\"");
  expect(html).not.toContain('App.openModal');
  expect(html).not.toContain('App.closeModal');
  expect(html).not.toContain("getElementById('deceased-modal')");
});

// ar-7v3k fix wave, Fix 4: the test above only pinned x-data and the
// $dispatch call -- not the bindings that actually make the modal Alpine
// component work. Deleting `:class="{ 'is-active': show }"` from the
// template left every test in this file green (proven by deleting it and
// re-running before writing this test): the modal would open in JS state
// but never gain the `is-active` class, so it stays invisible. Brings
// this up to the standard set by
// views/partials/character-level-up.test.js:36-45, which pins all four
// bindings on the real template.
test('deceased-modal carries all four modal bindings on the real template', () => {
  const html = source();
  // Object form, deliberately -- the string form cannot remove a frozen
  // `is-active` (see public/js/alpine-components.js).
  expect(html).toContain(":class=\"{ 'is-active': show }\"");
  expect(html).toContain('@open-modal.window="open($event.detail)"');
  expect(html).toContain('@close-modal.window="close($event.detail)"');
  expect(html).toContain('@keydown.escape.window="close()"');
});

const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => {
  await setupAlpine();
  require('../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

const CONFIRM = `
  <div x-data="{ typed: '', required: 'Vex Kalloway' }">
    <input id="confirm-input" x-model="typed">
    <button id="deceased-submit" :disabled="typed !== required"></button>
  </div>
`;

test('confirm button starts disabled', async () => {
  await setupAlpine();
  await render(CONFIRM);
  expect(document.getElementById('deceased-submit').disabled).toBe(true);
});

test('confirm button stays disabled for a partial name', async () => {
  await setupAlpine();
  await render(CONFIRM);
  const input = document.getElementById('confirm-input');
  input.value = 'Vex';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('deceased-submit').disabled).toBe(true);
});

test('confirm button enables on an exact match', async () => {
  await setupAlpine();
  await render(CONFIRM);
  const input = document.getElementById('confirm-input');
  input.value = 'Vex Kalloway';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('deceased-submit').disabled).toBe(false);
});

test('confirm button re-disables when the name stops matching', async () => {
  await setupAlpine();
  await render(CONFIRM);
  const input = document.getElementById('confirm-input');
  input.value = 'Vex Kalloway';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  input.value = 'Vex Kallowa';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('deceased-submit').disabled).toBe(true);
});

test('deceased form no longer uses oninput', () => {
  const html = source();
  expect(html).not.toContain('oninput');
});

test('deceased form no longer uses data-confirm-name', () => {
  const html = source();
  expect(html).not.toContain('data-confirm-name');
});

test('deceased input uses x-model binding', () => {
  const html = source();
  expect(html).toContain('x-model="typed"');
});

test('deceased button uses :disabled binding', () => {
  const html = source();
  expect(html).toContain(':disabled="typed !== required"');
});

test('deceased submit button has no bare disabled attribute', () => {
  const html = source();
  const buttonMatch = html.match(/<button[^>]*id="deceased-submit"[^>]*>/);
  expect(buttonMatch).toBeTruthy();
  const buttonTag = buttonMatch[0];
  // Match ' disabled' not followed by '-' or '=' (avoids matching ':disabled=')
  expect(buttonTag).not.toMatch(/\sdisabled(?![-=])/);
});

// --- stat blocks ----------------------------------------------------------
//
// This form is a plain native POST -- no fetch, no Alpine state carrying the
// values -- so the hidden input inside each control is the ONLY thing that
// makes a stat reach the server. A test that only checked the blocks render
// would pass on a form that silently posts no stats at all.

const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const rangeHelper = require('handlebars-helper-range');
const customHelpers = require('../util/handlebars');
const { statList } = require('../util/enclave-consts');

const FORM_SRC = fs.readFileSync(path.join(__dirname, 'character-form.handlebars'), 'utf8');

test('character-form renders stat blocks instead of number inputs', () => {
  expect(FORM_SRC).toContain('{{> stat-blocks stat=this name=this');
  // The old field had `type="number" name="{{this}}" ... required`.
  expect(FORM_SRC).not.toMatch(/type="number"\s+name="\{\{this\}\}"/);
});

test('the stat fields are no longer `required`', () => {
  // A hidden input always has a value and 0 is a legitimate stat, so a
  // `required` here could only ever be a false gate.
  const statsSection = FORM_SRC.slice(
    FORM_SRC.indexOf('<label class="label">Stats</label>'),
    FORM_SRC.indexOf('Signature Gear')
  );
  expect(statsSection).not.toContain('required');
});

test('every stat POSTs its own name from a hidden input', async () => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  hb.registerPartial('stat-blocks', fs.readFileSync(
    path.join(__dirname, 'partials', 'stat-blocks.handlebars'), 'utf8'
  ));

  const statsSection = FORM_SRC.slice(
    FORM_SRC.indexOf('<label class="label">Stats</label>'),
    FORM_SRC.indexOf('Signature Gear')
  );
  const character = Object.fromEntries(statList.map((s, i) => [s, i % 6]));
  await render(hb.compile(statsSection)({ statList, character }));
  await tick();

  const posted = Array.from(document.querySelectorAll('input[type="hidden"]'))
    .map((el) => el.name);
  expect(posted.sort()).toEqual([...statList].sort());
  expect(document.querySelector('input[name="might"]').value)
    .toBe(String(character.might));
});

// --- created-at date bound --------------------------------------------------
//
// normalizeCharacterInput (services/character/input.js) already rejects a
// future created_at server-side, but that error renders as a generic 500
// page (util/http-error.js), not a field-level message. The `max` attribute
// is a client-side convenience that stops most players from ever submitting
// one; the route must supply today's date (UTC) as maxCreatedAt.

test('the Created date input carries a max attribute sourced from the render context', () => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);

  const inputMatch = FORM_SRC.match(/<input[^>]*id="char-created-at"[^>]*>/);
  expect(inputMatch).toBeTruthy();

  const html = hb.compile(inputMatch[0])({
    character: { created_at: '2026-01-05T00:00:00+00:00' },
    maxCreatedAt: '2026-08-15'
  });

  expect(html).toContain('max="2026-08-15"');
});
