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
