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
// component's behaviour is pinned independently of the template. Task 3
// adds tests that mount the REAL partial, which is what catches the two
// drifting apart.

const mount = (value, max) => render(`
  <div class="stat-blocks" role="radiogroup" aria-label="Might"
       x-data="statBlocks(${value}, ${max}, 'might')"
       @mouseleave="preview = null" @keydown="key($event)">
    <input type="hidden" name="might" :value="value" class="stat-blocks-value" data-stat="might">
    <template x-for="i in max" :key="i">
      <span class="wizard-stat-box" role="radio"
            :class="boxClass(i)" :aria-checked="i === value" :tabindex="tabIndex(i)"
            @click="set(i)" @mouseenter="preview = i"></span>
    </template>
    <span class="stat-blocks-over" x-show="value > max" x-text="value"></span>
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
  expect(document.querySelector('.stat-blocks-over').textContent).toBe('7');
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
// rAF at init, so mounting it under jsdom is its own project. Instead the
// arithmetic it needs lives in resolveStatTarget and is pinned here with the
// wizard's own numbers, and a source assertion proves the wizard calls it
// rather than growing a second copy.

// Mirrors the call the wizard makes: floor is the class + personality
// points the user may not remove, ceiling is whichever binds first -- the
// per-stat cap, or what the remaining budget can pay for.
const wizardTarget = ({ slot, cp, pp, up, remaining, cap }) =>
  window.StatBlocks.resolveStatTarget({
    slot,
    current: cp + pp + up,
    floor: cp + pp,
    ceiling: Math.min(cap, cp + pp + up + remaining)
  }) - cp - pp;

test('wizard: clicking the 4th block assigns the whole jump when the budget covers it', () => {
  // Level 2+: cap 5. One class point, nothing user-assigned, 4 points left.
  expect(wizardTarget({ slot: 4, cp: 1, pp: 0, up: 0, remaining: 4, cap: 5 })).toBe(3);
});

test('wizard: a short budget assigns only what remains', () => {
  expect(wizardTarget({ slot: 5, cp: 1, pp: 0, up: 0, remaining: 2, cap: 5 })).toBe(2);
});

test('wizard: the per-stat cap binds before the budget at level 1', () => {
  // Level 1: cap 3. Clicking the 5th block can only reach 3 total.
  expect(wizardTarget({ slot: 5, cp: 1, pp: 0, up: 0, remaining: 5, cap: 3 })).toBe(2);
});

test('wizard: clicking the topmost user-assigned block removes one point', () => {
  // 1 class + 2 user = 3. Clicking the 3rd block steps down to 2 total.
  expect(wizardTarget({ slot: 3, cp: 1, pp: 0, up: 2, remaining: 3, cap: 5 })).toBe(1);
});

test('wizard: a click can never take a stat below its class and personality points', () => {
  // 1 class + 1 personality + 2 user. Clicking the 1st block floors at 2.
  expect(wizardTarget({ slot: 1, cp: 1, pp: 1, up: 2, remaining: 2, cap: 5 })).toBe(0);
});

test('character-wizard.js applies the shared rule instead of its own arithmetic', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'character-wizard.js'), 'utf8'
  );
  expect(src).toContain('StatBlocks.resolveStatTarget');
  // The old one-point-at-a-time branches must be gone, not left beside it.
  expect(src).not.toContain('state.userStats[stat] = up + 1');
  expect(src).not.toContain('state.userStats[stat] = up - 1');
});

test('character-wizard.js wires the hover preview', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'character-wizard.js'), 'utf8'
  );
  expect(src).toContain("addEventListener('mouseover', onStatBoxHover)");
  expect(src).toContain("addEventListener('mouseleave', clearStatPreview)");
});
