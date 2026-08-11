const { test, expect, beforeAll } = require('bun:test');
const { setupAlpine, render, tick } = require('../../test/helpers/alpine-dom');

beforeAll(async () => {
  await setupAlpine();
  require('../../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

// --- the shared rule ------------------------------------------------------
//
// resolveStatTarget is the single source of truth for "what does clicking
// this block do". It is exported on window rather than closed over because
// public/js/character-wizard.js drives its own imperative grid and must
// apply the identical rule; two copies of this arithmetic is exactly how
// the wizard and the editor would drift apart.

const resolve = (args) => window.StatBlocks.resolveStatTarget(args);

test('clicking the Nth block targets N', () => {
  expect(resolve({ slot: 3, current: 0, floor: 0, ceiling: 5 })).toBe(3);
});

test('clicking the block you are already on steps down by one', () => {
  expect(resolve({ slot: 3, current: 3, floor: 0, ceiling: 5 })).toBe(2);
});

test('clicking the first block at value 1 reaches zero', () => {
  expect(resolve({ slot: 1, current: 1, floor: 0, ceiling: 5 })).toBe(0);
});

test('the ceiling caps the target', () => {
  // The wizard's short-budget case: 1 class point, 2 points left in the
  // budget, user clicks the 5th block. The most it can reach is 3.
  expect(resolve({ slot: 5, current: 1, floor: 1, ceiling: 3 })).toBe(3);
});

test('the floor keeps class- and personality-assigned points untouchable', () => {
  expect(resolve({ slot: 1, current: 4, floor: 2, ceiling: 5 })).toBe(2);
});

test('a value above the block count can step down but the rule never invents one', () => {
  // 7 points, 5 blocks: clicking the 3rd block drops it to 3, not to 5.
  expect(resolve({ slot: 3, current: 7, floor: 0, ceiling: 7 })).toBe(3);
});

// --- the Alpine component -------------------------------------------------
//
// This fixture mirrors views/partials/stat-blocks.handlebars by hand so the
// component's behaviour is pinned independently of the template. The tests
// further down mount the REAL partial, which is what catches the two
// drifting apart.
//
// The blocks are written out one element each rather than looped by
// `<template x-for>` for the same reason the partial does not use x-for:
// hx-boost snapshots the live DOM, so x-for's generated children come back
// on a Back navigation and x-for appends a second set on top of them. See
// the history-restore tests at the bottom of this file.

const mount = (value, max) => render(`
  <div class="stat-blocks" role="radiogroup" aria-label="Might"
       x-data="statBlocks(${value}, ${max}, 'might')"
       @mouseleave="preview = null" @keydown="key($event)">
    <input type="hidden" name="might" :value="value" class="stat-blocks-value" data-stat="might">
    ${Array.from({ length: max }, (_, k) => k + 1).map((i) => `
    <span class="wizard-stat-box ${i <= value ? 'is-set' : 'is-empty'}" role="radio"
          :class="boxClass(${i})" :aria-checked="value === ${i}" :tabindex="tabIndex(${i})"
          @click="set(${i})" @mouseenter="preview = ${i}"></span>`).join('')}
    <span class="stat-blocks-over" x-show="value > max" x-text="value + ' points'"></span>
  </div>
`);

const blocks = () => Array.from(document.querySelectorAll('[role="radio"]'));
const classesOf = () => blocks().map((b) => b.className.replace('wizard-stat-box ', ''));
const hidden = () => document.querySelector('.stat-blocks-value');

test('renders max blocks, filled up to the seeded value', async () => {
  await mount(2, 5);
  await tick();
  expect(classesOf()).toEqual(['is-set', 'is-set', 'is-empty', 'is-empty', 'is-empty']);
});

test('clicking the Nth block sets the value and updates the hidden input', async () => {
  await mount(2, 5);
  await tick();
  blocks()[3].click();
  await tick();
  expect(classesOf()).toEqual(['is-set', 'is-set', 'is-set', 'is-set', 'is-empty']);
  expect(hidden().value).toBe('4');
});

test('clicking the active block drops to N-1', async () => {
  await mount(3, 5);
  await tick();
  blocks()[2].click();
  await tick();
  expect(hidden().value).toBe('2');
});

test('clicking the first block at value 1 reaches zero', async () => {
  await mount(1, 5);
  await tick();
  blocks()[0].click();
  await tick();
  expect(hidden().value).toBe('0');
  expect(classesOf().every((c) => c === 'is-empty')).toBe(true);
});

test('hovering above the value previews the blocks a click would fill', async () => {
  await mount(2, 5);
  await tick();
  blocks()[3].dispatchEvent(new window.Event('mouseenter', { bubbles: false }));
  await tick();
  expect(classesOf()).toEqual(['is-preview', 'is-preview', 'is-preview', 'is-preview', 'is-empty']);
  // The committed value is untouched until a click.
  expect(hidden().value).toBe('2');
});

test('hovering below the value previews the drop, not just a fill', async () => {
  await mount(5, 5);
  await tick();
  blocks()[1].dispatchEvent(new window.Event('mouseenter', { bubbles: false }));
  await tick();
  expect(classesOf()).toEqual(['is-preview', 'is-preview', 'is-empty', 'is-empty', 'is-empty']);
});

test('hovering the active block previews N-1, matching what the click does', async () => {
  await mount(3, 5);
  await tick();
  blocks()[2].dispatchEvent(new window.Event('mouseenter', { bubbles: false }));
  await tick();
  expect(classesOf()).toEqual(['is-preview', 'is-preview', 'is-empty', 'is-empty', 'is-empty']);
});

test('mouseleave restores the committed state', async () => {
  await mount(2, 5);
  await tick();
  blocks()[4].dispatchEvent(new window.Event('mouseenter', { bubbles: false }));
  await tick();
  document.querySelector('.stat-blocks').dispatchEvent(new window.Event('mouseleave'));
  await tick();
  expect(classesOf()).toEqual(['is-set', 'is-set', 'is-empty', 'is-empty', 'is-empty']);
});

const press = async (key) => {
  document.querySelector('.stat-blocks').dispatchEvent(
    new window.KeyboardEvent('keydown', { key, bubbles: true })
  );
  await tick();
};

test('arrow keys adjust by one and clamp at both ends', async () => {
  await mount(2, 5);
  await tick();
  await press('ArrowRight');
  expect(hidden().value).toBe('3');
  await press('ArrowLeft');
  await press('ArrowLeft');
  await press('ArrowLeft');
  await press('ArrowLeft');
  expect(hidden().value).toBe('0');
  await press('ArrowUp');
  expect(hidden().value).toBe('1');
});

test('Home and End jump to the ends', async () => {
  await mount(2, 5);
  await tick();
  await press('End');
  expect(hidden().value).toBe('5');
  await press('Home');
  expect(hidden().value).toBe('0');
});

test('exactly one block is tabbable and aria-checked tracks the value', async () => {
  await mount(3, 5);
  await tick();
  expect(blocks().filter((b) => b.getAttribute('tabindex') === '0').length).toBe(1);
  expect(blocks()[2].getAttribute('tabindex')).toBe('0');
  expect(blocks().map((b) => b.getAttribute('aria-checked')))
    .toEqual(['false', 'false', 'true', 'false', 'false']);
});

test('at value 0 the first block is the tabbable one', async () => {
  await mount(0, 5);
  await tick();
  expect(blocks()[0].getAttribute('tabindex')).toBe('0');
});

test('a value above max fills every block, shows the number, and does not clamp', async () => {
  await mount(7, 5);
  await tick();
  expect(classesOf().every((c) => c === 'is-set')).toBe(true);
  expect(hidden().value).toBe('7');
  // Carries the unit, not a bare numeral: for a stat above the block count
  // every block reads aria-checked="false", so this indicator is the only
  // place a screen-reader user can get the real value.
  expect(document.querySelector('.stat-blocks-over').textContent).toBe('7 points');
});

test('an over-max value drops to the clicked block, and cannot grow again', async () => {
  await mount(7, 5);
  await tick();
  await press('ArrowRight');
  expect(hidden().value).toBe('7');   // no-op: blocks cannot invent a 6th
  blocks()[2].click();
  await tick();
  expect(hidden().value).toBe('3');
});

test('committing dispatches a bubbling stat-change with the stat and value', async () => {
  await mount(2, 5);
  await tick();
  let seen = null;
  document.body.addEventListener('stat-change', (e) => { seen = e.detail; });
  blocks()[3].click();
  await tick();
  expect(seen).toEqual({ stat: 'might', value: 4 });
});

test('hovering alone never commits, so it dispatches nothing', async () => {
  await mount(2, 5);
  await tick();
  let count = 0;
  document.body.addEventListener('stat-change', () => { count += 1; });
  blocks()[4].dispatchEvent(new window.Event('mouseenter', { bubbles: false }));
  await tick();
  document.querySelector('.stat-blocks').dispatchEvent(new window.Event('mouseleave'));
  await tick();
  expect(count).toBe(0);
});

test('a keypress that changes nothing dispatches nothing', async () => {
  await mount(5, 5);
  await tick();
  let count = 0;
  document.body.addEventListener('stat-change', () => { count += 1; });
  await press('ArrowRight');   // already at max
  await press('End');          // already at max
  expect(count).toBe(0);
  expect(hidden().value).toBe('5');
});

// --- the real partial -----------------------------------------------------
//
// Everything above mounts a hand-written fixture. These compile the actual
// template with the app's real helper set and mount THAT, so the fixture
// and the shipped partial cannot quietly drift apart.

const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const rangeHelper = require('handlebars-helper-range');
const customHelpers = require('../../util/handlebars');

const PARTIAL_SRC = fs.readFileSync(path.join(__dirname, 'stat-blocks.handlebars'), 'utf8');

const renderPartial = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  return hb.compile(PARTIAL_SRC)(context);
};

test('the partial renders a labelled radiogroup with a POSTable hidden input', async () => {
  await render(renderPartial({ stat: 'might', name: 'might', value: 3, max: 5 }));
  await tick();
  const group = document.querySelector('.stat-blocks');
  expect(group.getAttribute('role')).toBe('radiogroup');
  expect(group.getAttribute('aria-label')).toBe('Might');
  expect(document.querySelector('input[type="hidden"]').name).toBe('might');
  expect(document.querySelectorAll('[role="radio"]').length).toBe(5);
});

test('the real partial mounts and clicks through to the right value', async () => {
  await render(renderPartial({ stat: 'might', name: 'might', value: 1, max: 5 }));
  await tick();
  document.querySelectorAll('[role="radio"]')[3].click();
  await tick();
  expect(document.querySelector('input[type="hidden"]').value).toBe('4');
});

test('a null value seeds zero rather than breaking the x-data expression', async () => {
  // {{json v}} emits `null` for a missing stat; a bare {{lookup}} would emit
  // nothing at all and produce `statBlocks(, 5, "luck")` -- a SyntaxError
  // that takes the whole component down, which is the exact defect
  // character-stats-editor.test.js documents for the #statsBox seed.
  await render(renderPartial({ stat: 'luck', name: 'luck', value: null, max: 5 }));
  await tick();
  expect(document.querySelector('input[type="hidden"]').value).toBe('0');
  expect(document.querySelectorAll('.is-empty').length).toBe(5);
});

test('max drives the block count, so a class spread renders three', async () => {
  await render(renderPartial({ stat: 'might', name: 'stat_spread[might]', value: 2, max: 3 }));
  await tick();
  expect(document.querySelectorAll('[role="radio"]').length).toBe(3);
  expect(document.querySelector('input[type="hidden"]').name).toBe('stat_spread[might]');
});

test('inputClass lands on the hidden input for surfaces that query it', async () => {
  await render(renderPartial({ stat: 'might', name: 'might', value: 0, max: 5, inputClass: 'level-up-stat' }));
  await tick();
  const input = document.querySelector('input[type="hidden"]');
  expect(input.classList.contains('level-up-stat')).toBe(true);
  expect(input.getAttribute('data-stat')).toBe('might');
});

test('model wires x-modelable so a parent x-data sees every change', async () => {
  const inner = renderPartial({ stat: 'might', name: 'might', value: 1, max: 5, model: 'stats.might' });
  await render(`<div x-data="{ stats: { might: 1 } }"><span id="mirror" x-text="stats.might"></span>${inner}</div>`);
  await tick();
  document.querySelectorAll('[role="radio"]')[3].click();
  await tick();
  expect(document.getElementById('mirror').textContent).toBe('4');
});

test('the partial omits the model bindings entirely when no model is passed', () => {
  // x-modelable is emitted only alongside x-model. On its own it has no
  // parent binding to attach to, and leaving it on every surface would be a
  // directive that silently does nothing on three of the four.
  const html = renderPartial({ stat: 'might', name: 'might', value: 1, max: 5 });
  expect(html).not.toMatch(/\sx-model="/);
  expect(html).not.toMatch(/\sx-modelable="/);
});

// --- the wizard's use of the shared rule ----------------------------------
//
// public/js/character-wizard.js is a 1698-line IIFE that returns immediately
// without a #wizard-data element and touches localStorage, Math.random, and
// rAF at init, so mounting it under jsdom is its own project. So the
// wizard's side of the rule -- INCLUDING the construction of its arguments,
// which is where an off-by-one can actually live -- is exported as
// StatBlocks.resolveWizardTarget and exercised directly here. The wizard
// only gathers state and calls it.
//
// These tests call the real exported function rather than a local rebuild
// of the wizard's call. A hand-rebuilt copy passes no matter what the
// wizard actually passes: flipping `slot + 1` to `slot` is invisible to a
// copy that already takes a 1-based slot, and that one character makes
// every wizard click assign a point too few.

// resolveWizardTarget takes the raw 0-based data-slot and returns the new
// TOTAL. The user portion -- what the wizard stores -- is that minus the
// class and personality points, which are not the user's to give back.
const wizardTotal = (args) => window.StatBlocks.resolveWizardTarget(args);
const wizardUserPoints = (args) => wizardTotal(args) - (args.cp || 0) - (args.pp || 0);

test('wizard: data-slot is 0-based, so the first block means one point, not zero', () => {
  // This is the conversion the old hand-rebuilt helper could not see.
  expect(wizardTotal({ slot: 0, cp: 0, pp: 0, up: 0, remaining: 6, cap: 5 })).toBe(1);
  expect(wizardTotal({ slot: 3, cp: 0, pp: 0, up: 0, remaining: 6, cap: 5 })).toBe(4);
});

test('wizard: clicking the 4th block assigns the whole jump when the budget covers it', () => {
  // Level 2+: cap 5. One class point, nothing user-assigned, 4 points left.
  // The 4th block is data-slot 3.
  const args = { slot: 3, cp: 1, pp: 0, up: 0, remaining: 4, cap: 5 };
  expect(wizardTotal(args)).toBe(4);
  expect(wizardUserPoints(args)).toBe(3);
});

test('wizard: a short budget assigns only what remains', () => {
  const args = { slot: 4, cp: 1, pp: 0, up: 0, remaining: 2, cap: 5 };
  expect(wizardTotal(args)).toBe(3);
  expect(wizardUserPoints(args)).toBe(2);
});

test('wizard: the per-stat cap binds before the budget at level 1', () => {
  // Level 1: cap 3. Clicking the 5th block (data-slot 4) reaches 3 total.
  const args = { slot: 4, cp: 1, pp: 0, up: 0, remaining: 5, cap: 3 };
  expect(wizardTotal(args)).toBe(3);
  expect(wizardUserPoints(args)).toBe(2);
});

test('wizard: clicking the topmost user-assigned block removes one point', () => {
  // 1 class + 2 user = 3. Clicking the 3rd block (data-slot 2) steps down.
  const args = { slot: 2, cp: 1, pp: 0, up: 2, remaining: 3, cap: 5 };
  expect(wizardTotal(args)).toBe(2);
  expect(wizardUserPoints(args)).toBe(1);
});

test('wizard: a click can never take a stat below its class and personality points', () => {
  // 1 class + 1 personality + 2 user. Clicking the 1st block (data-slot 0)
  // floors at 2.
  const args = { slot: 0, cp: 1, pp: 1, up: 2, remaining: 2, cap: 5 };
  expect(wizardTotal(args)).toBe(2);
  expect(wizardUserPoints(args)).toBe(0);
});

test('character-wizard.js applies the shared rule instead of its own arithmetic', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'character-wizard.js'), 'utf8'
  );
  expect(src).toContain('StatBlocks.resolveWizardTarget');
  // Rebuilding the arguments in the wizard is what put the slot conversion
  // and the floor/ceiling on the untested side of the line. It must not
  // come back.
  expect(src).not.toContain('slot: slot + 1');
  expect(src).not.toContain('floor: cp + pp');
  // The old one-point-at-a-time branches must be gone, not left beside it.
  expect(src).not.toContain('state.userStats[stat] = up + 1');
  expect(src).not.toContain('state.userStats[stat] = up - 1');
});

// --- surviving an hx-boost history restore --------------------------------
//
// views/layouts/main.handlebars puts hx-boost="true" on <body> and nothing
// configures htmx's history cache or hooks htmx:beforeHistorySave, so htmx
// snapshots the LIVE DOM -- Alpine's output included -- and restores that
// snapshot verbatim on Back. render() replaces document.body.innerHTML and
// lets Alpine's MutationObserver re-initialize it, which is exactly the
// shape of that swap (see the note on render() in test/helpers/alpine-dom).
//
// Under `<template x-for>` this was measured at 5 blocks -> 10: the restored
// snapshot already contains the five spans x-for generated, and x-for
// appends five more. The stale five throw "i is not defined" on every
// binding, because `i` exists only in the x-for scope, so clicking one
// throws instead of setting the stat.

const snapshotAndRestore = async () => {
  // What htmx caches is the live DOM, not the response body.
  const snapshot = document.body.innerHTML;
  await render(snapshot);
  await tick();
};

test('a history snapshot round trip does not duplicate the blocks', async () => {
  await render(renderPartial({ stat: 'might', name: 'might', value: 3, max: 5 }));
  await tick();
  expect(blocks().length).toBe(5);

  await snapshotAndRestore();

  expect(blocks().length).toBe(5);
  expect(classesOf()).toEqual(['is-set', 'is-set', 'is-set', 'is-empty', 'is-empty']);
  expect(blocks().filter((b) => b.getAttribute('tabindex') === '0').length).toBe(1);
  expect(blocks().map((b) => b.getAttribute('aria-checked')))
    .toEqual(['false', 'false', 'true', 'false', 'false']);
});

test('a restored block re-derives its class from the seed rather than keeping the snapshot state', async () => {
  // The string form of :class can only ADD: Alpine tracks the classes it
  // added itself and removes only those, so an `is-set` that arrived in the
  // served markup (which is what a restored snapshot is) could never come
  // off, and the block would be stuck filled. Raise the value, snapshot the
  // filled row, restore, and the seed of 3 must win.
  await render(renderPartial({ stat: 'might', name: 'might', value: 3, max: 5 }));
  await tick();
  blocks()[4].click();
  await tick();
  expect(classesOf().every((c) => c === 'is-set')).toBe(true);

  await snapshotAndRestore();

  expect(classesOf()).toEqual(['is-set', 'is-set', 'is-set', 'is-empty', 'is-empty']);
  expect(hidden().value).toBe('3');
});

test('a restored block is still live, not a stale copy that throws on click', async () => {
  await render(renderPartial({ stat: 'might', name: 'might', value: 2, max: 5 }));
  await tick();

  await snapshotAndRestore();

  blocks()[3].click();
  await tick();
  expect(hidden().value).toBe('4');
  expect(classesOf()).toEqual(['is-set', 'is-set', 'is-set', 'is-set', 'is-empty']);
});

test('the partial ships real elements, not an x-for template', () => {
  // Asserted against the RENDERED output, not the source: Handlebars strips
  // {{!-- --}} comments, and the partial's comment explains at length why
  // x-for is not used here, which a source-level substring check would trip
  // over.
  const html = renderPartial({ stat: 'might', name: 'might', value: 3, max: 5 });
  expect(html).not.toContain('<template');
  expect(html).not.toContain('x-for');
  expect((html.match(/role="radio"/g) || []).length).toBe(5);
  // And the class binding is the object form, which is the half of the fix
  // that is easy to lose in a later edit.
  expect(html).toContain(':class="boxClass(');
});

test('boxClass returns an object, not a class string', async () => {
  // Alpine's string form only removes classes it added itself; the object
  // form toggles by truthiness whoever added them. Asserted directly as
  // well as through the restore tests above, because "it returns a string
  // again" is a one-line regression with a non-obvious symptom.
  await render(renderPartial({ stat: 'might', name: 'might', value: 2, max: 5 }));
  await tick();
  const data = Alpine.$data(document.querySelector('.stat-blocks'));
  expect(data.boxClass(1)).toEqual({ 'is-preview': false, 'is-set': true, 'is-empty': false });
  expect(data.boxClass(4)).toEqual({ 'is-preview': false, 'is-set': false, 'is-empty': true });
});

test('character-wizard.js wires the hover preview', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'character-wizard.js'), 'utf8'
  );
  expect(src).toContain("addEventListener('mouseover', onStatBoxHover)");
  expect(src).toContain("addEventListener('mouseleave', clearStatPreview)");
});
