# Stat Block Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revert the square-plus stat icons back to blocks, and replace every stat number input with a star-rating block control — click the Nth block to set the stat to N.

**Architecture:** One pure function (`resolveStatTarget`) holds the click rule. One Alpine component (`statBlocks`) and one Handlebars partial (`stat-blocks`) wrap it for the four surfaces that currently render number inputs. The character wizard keeps its own imperative grid but calls the same pure function, so the two cannot drift.

**Tech Stack:** Express + express-handlebars, Alpine.js 3.15.12, Bulma, vanilla browser JS (IIFE modules on `window`), bun:test + jsdom for unit tests, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-08-05-stat-block-selector-design.md`

## Global Constraints

- **Branch:** `stat-block-selector`, already created, stacked on `fix-alpine-frozen-class-and-pages-rls`.
- **Unit tests run with:** `bun run test:unit`. A single file: `bun test <path>`.
- **The unit runner only scans `models`, `routes`, `services`, `test`, `util`, `views`** (`scripts/run-tests.mjs:31`). A test placed under `public/` will never execute. All new unit tests in this plan live under `views/`.
- **`public/js/alpine-components.js` loads from `<head>` with `defer` and must stay above the Alpine CDN tag** (`views/partials/head.handlebars:16-20`). Alpine calls `Alpine.start()` in a microtask right after its own tag, so anything calling `Alpine.data()` has to be registered before it. Do not move this script.
- **`:class` must use the object form**, never the string form. Alpine only removes classes it added itself, so a string-form binding can leave a class frozen into an htmx history snapshot. Every existing `:class` in these views follows this rule.
- **`{{json x}}`** emits `JSON.stringify(x ?? null)` — a `null` for a missing value, never an empty string. Always seed Alpine values through it; a bare `{{lookup ...}}` renders nothing for a null stat and produces invalid JS inside an `x-data` expression.
- **Handlebars helpers available:** `capitalize`, `add`, `subtract`, `gt`, `lt` (from `handlebars-helpers`), `range` (from `handlebars-helper-range`, iterating `[start, end)`), and `concat`, `json`, `times`, `lookup` from `util/handlebars.js`. **There is no `min` helper** — branch with `{{#if (gt ...)}}` instead.
- **Per-stat block counts:** 5 for character stats, 3 for a class stat spread.
- **Stat values above the block count are preserved, never silently clamped.** They only drop when the user clicks a block.
- **Commit after every task.** Co-author trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

## File Structure

| File | Responsibility |
|---|---|
| `public/js/alpine-components.js` | **Modify.** Adds `window.StatBlocks.resolveStatTarget` (the click rule) and `Alpine.data('statBlocks')`. Fixes `characterStats.edit()`'s focus target. |
| `views/partials/stat-blocks.handlebars` | **Create.** The interactive control. One per stat. |
| `views/partials/stat-blocks-readonly.handlebars` | **Create.** Display-only blocks for `lfg-post`. No JS. |
| `views/partials/stat-blocks.test.js` | **Create.** Unit tests for the rule, the component, and the real partial. |
| `public/css/styles.css` | **Modify.** `.is-set` / `.is-empty` / `.is-preview` / `.is-preview-off` states, `.stat-blocks` layout. |
| `views/partials/character-stats-editor.handlebars` | **Modify.** Number input → partial. |
| `views/partials/character-level-up.handlebars` | **Modify.** Number input → partial. |
| `views/character-form.handlebars` | **Modify.** Number inputs → partial (native POST via hidden input). |
| `views/class-form.handlebars` | **Modify.** Number inputs → partial, `max=3`. |
| `views/lfg-post.handlebars` | **Modify.** Literal `+` characters → read-only blocks. |
| `public/js/character-level-up.js` | **Modify.** Live total listens for `stat-change` instead of `input`. |
| `public/js/character-wizard.js` | **Modify.** `onStatBoxClick` → jump-to-N via the shared rule; hover preview. |

## Deviation from the spec

The spec calls for `public/js/character-wizard.test.js` covering the two changed wizard functions. Two things force a change:

1. The unit runner does not scan `public/`, so that path would never run.
2. `public/js/character-wizard.js` is a 1698-line IIFE that bails immediately without a `#wizard-data` element, makes 43 `getElementById` calls at init, and calls `Math.random()`, `localStorage`, `requestAnimationFrame`, and `setTimeout` during startup. Mounting it under jsdom is its own project.

**Instead:** the arithmetic both surfaces need is extracted into `resolveStatTarget`, which is exhaustively unit-tested in Task 2 — including every wizard case (class floor, per-stat cap, short budget). Task 9 wires the wizard to that function and asserts at the source level that it calls it rather than reimplementing it. The wizard's DOM behavior is covered by the manual browser check in Task 10.

---

### Task 1: Revert the square-plus icons

**Files:**
- Revert: commit `e13cbd3` (touches `public/css/styles.css`, `public/js/character-wizard.js`, `views/character.handlebars`)

**Interfaces:**
- Consumes: nothing.
- Produces: `.wizard-stat-box` is a bordered square again (`border: 2.5px solid var(--bulma-border, #1a1a1a); border-radius: 3px; background: var(--wizard-stat-empty)`), with states `.is-class` / `.is-user` / `.is-assignable` / `.is-locked`. The CSS custom property `--wizard-stat-locked` no longer exists. Later tasks build `.is-set` / `.is-empty` / `.is-preview` on top of this base rule.

- [ ] **Step 1: Revert the commit**

```bash
git revert --no-edit e13cbd3
```

This applies cleanly onto HEAD (verified). It restores the filled/bordered squares and the `--wizard-stat-class: #1a1a1a` ramp in `styles.css`, drops `--wizard-stat-locked`, and removes `<i class="fa-regular fa-square-plus">` from the box markup in both `public/js/character-wizard.js` and `views/character.handlebars`.

- [ ] **Step 2: Verify no plus icons survive**

Run:

```bash
grep -rn "square-plus" public/ views/ ; echo "exit: $?"
```

Expected: no matches, `exit: 1`.

- [ ] **Step 3: Run the unit suite**

Run: `bun run test:unit`
Expected: PASS. No existing test asserts on the icon markup, so this is a regression check, not a new signal.

- [ ] **Step 4: Amend the revert message**

```bash
git commit --amend -F - <<'EOF'
Revert "feat: render wizard stat boxes as square-plus icons"

This reverts commit e13cbd32032a148b6ee955f44fdac7fb22e52944.

The blocks read better than the plus glyphs, and the star-rating stat
control built on top of this needs a filled/empty square to express
"set" versus "unset" -- a plus icon has no natural empty state.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The click rule and the `statBlocks` component

**Files:**
- Modify: `public/js/alpine-components.js` (add `resolveStatTarget` + `window.StatBlocks` above the `alpine:init` listener; add `Alpine.data('statBlocks')` inside it)
- Test: `views/partials/stat-blocks.test.js` (create)

**Interfaces:**
- Consumes: Task 1's `.wizard-stat-box` base rule (for the classes it emits).
- Produces:
  - `window.StatBlocks.resolveStatTarget({ slot, current, floor, ceiling })` → `number`. `slot` is 1-based. Returns the new total a click on that block should produce.
  - `Alpine.data('statBlocks', (initial, max, stat) => ...)` with reactive `value` (number) and `preview` (number | null), the getters `ceiling` and `previewValue`, and the methods `set(i)`, `commit(next)`, `key(event)`, `boxClass(i)`, `tabIndex(i)`, `focusBlock(n)`. `value` is what a parent binds to when Task 3's partial is given a `model`.
  - A bubbling `stat-change` CustomEvent with `detail: { stat, value }`, dispatched on every committed change.

- [ ] **Step 1: Write the failing tests for the rule**

Create `views/partials/stat-blocks.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/partials/stat-blocks.test.js`
Expected: FAIL — `TypeError: undefined is not an object (evaluating 'window.StatBlocks.resolveStatTarget')`.

- [ ] **Step 3: Implement the rule**

In `public/js/alpine-components.js`, insert immediately **above** the `document.addEventListener('alpine:init', ...)` line (after the `slugify` helper):

```js
// The one rule every stat block control obeys: clicking the block at
// 1-based position `slot` sets the stat to `slot`, EXCEPT that clicking the
// block you are already on steps DOWN by one -- that is how a stat reaches
// zero, and it matches what the wizard's grid already did when you clicked
// a point you had assigned.
//
// `floor` is the number of points the click may not take the stat below
// (class + personality points in the wizard; 0 everywhere else). `ceiling`
// is the highest total the click may produce (the per-stat cap, or the
// remaining point budget, whichever binds first).
//
// Exported on `window` rather than closed over because
// public/js/character-wizard.js renders its own imperative grid and has to
// apply the identical rule. Two copies of this arithmetic is exactly how
// the wizard and the editor would drift apart. alpine-components.js is a
// deferred <head> script and character-wizard.js a deferred body script, so
// deferred-script document order guarantees this is defined first.
const resolveStatTarget = ({ slot, current, floor = 0, ceiling }) => {
  const target = slot === current ? slot - 1 : slot;
  return Math.max(floor, Math.min(target, ceiling));
};

window.StatBlocks = { resolveStatTarget };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test views/partials/stat-blocks.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing tests for the component**

Append to `views/partials/stat-blocks.test.js`:

```js
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
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `bun test views/partials/stat-blocks.test.js`
Expected: FAIL — Alpine logs `statBlocks is not defined` and no blocks render.

- [ ] **Step 7: Implement the component**

Inside the `document.addEventListener('alpine:init', ...)` callback in `public/js/alpine-components.js`, after the `characterStats` registration:

```js
  // Star-rating stat selector. Backs every stat-editing surface: the inline
  // stats editor, the level-up modal, the character form, and the class
  // form. Replaces the number inputs all four used to render.
  //
  // `value` is the committed points, `preview` the block the pointer is
  // currently over (or null). `previewValue` deliberately runs the hovered
  // block through the same resolveStatTarget the click uses, so the preview
  // shows what will HAPPEN, not merely what is under the cursor -- hovering
  // the block you are already on previews one lower, because that is what
  // clicking it does.
  //
  // Keyboard commits immediately rather than previewing: arrowing IS the
  // preview, and a focus-driven preview would fight the click preview for
  // the same `preview` slot every time focusBlock() moved focus after a
  // click.
  Alpine.data('statBlocks', (initial, max, stat) => ({
    value: parseInt(initial, 10) || 0,
    preview: null,
    max: max,
    stat: stat,

    // A stat already above `max` (the editor historically allowed 0-20) can
    // step DOWN through the blocks but must never be raised by them, so the
    // ceiling floats up to the current value and ratchets back down as the
    // value falls.
    get ceiling() {
      return Math.max(this.max, this.value);
    },

    get previewValue() {
      if (this.preview === null) return null;
      return resolveStatTarget({
        slot: this.preview, current: this.value, floor: 0, ceiling: this.ceiling
      });
    },

    boxClass(i) {
      const shown = this.previewValue;
      if (shown !== null) return i <= shown ? 'is-preview' : 'is-empty';
      return i <= this.value ? 'is-set' : 'is-empty';
    },

    tabIndex(i) {
      // Roving tabindex: the grid costs one tab stop per stat, exactly what
      // the 12 number inputs it replaces cost.
      return i === Math.max(1, Math.min(this.value, this.max)) ? 0 : -1;
    },

    set(i) {
      this.commit(resolveStatTarget({
        slot: i, current: this.value, floor: 0, ceiling: this.ceiling
      }));
      this.focusBlock(this.value);
    },

    commit(next) {
      const clamped = Math.max(0, Math.min(next, this.ceiling));
      this.preview = null;
      if (clamped === this.value) return;
      this.value = clamped;
      // Surfaces without Alpine state (the level-up modal) read the hidden
      // input, which fires no native `input` event when set programmatically.
      this.$dispatch('stat-change', { stat: this.stat, value: this.value });
    },

    focusBlock(n) {
      const idx = Math.max(1, Math.min(n, this.max));
      this.$nextTick(() => {
        const el = this.$root.querySelectorAll('[role="radio"]')[idx - 1];
        if (el) el.focus();
      });
    },

    key(e) {
      if (e.key === ' ' || e.key === 'Enter') {
        const all = Array.prototype.slice.call(this.$root.querySelectorAll('[role="radio"]'));
        const idx = all.indexOf(e.target);
        if (idx === -1) return;
        e.preventDefault();
        this.set(idx + 1);
        return;
      }
      let next;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = this.value - 1;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = this.value + 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = this.max;
      else return;
      // Otherwise arrows scroll the page out from under the control.
      e.preventDefault();
      this.commit(next);
      this.focusBlock(this.value);
    }
  }));
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test views/partials/stat-blocks.test.js`
Expected: PASS, all tests.

- [ ] **Step 9: Run the whole unit suite**

Run: `bun run test:unit`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add public/js/alpine-components.js views/partials/stat-blocks.test.js
git commit -F - <<'EOF'
feat: add the statBlocks star-rating stat control

resolveStatTarget holds the one click rule -- clicking the Nth block sets
the stat to N, clicking the block you are already on steps down by one --
and is exported on window so the character wizard's imperative grid can
apply the identical rule instead of growing a second copy.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: The partial and its styles

**Files:**
- Create: `views/partials/stat-blocks.handlebars`
- Modify: `public/css/styles.css`
- Test: `views/partials/stat-blocks.test.js` (append)

**Interfaces:**
- Consumes: `Alpine.data('statBlocks')` from Task 2.
- Produces: the partial `{{> stat-blocks stat=… name=… value=… max=… model=… inputClass=…}}`.
  - `stat` (required) — the stat key, e.g. `"might"`. Drives the accessible name and `data-stat`.
  - `name` (required) — the `name` on the hidden input, i.e. what POSTs.
  - `value` (required) — the seeded points. `null`/`undefined` becomes 0.
  - `max` (required) — how many blocks render.
  - `model` (optional) — an expression like `"stats.might"`; when present the control two-way binds into the surrounding `x-data` via `x-modelable`.
  - `inputClass` (optional) — an extra class on the hidden input, for surfaces that query it by class.

- [ ] **Step 1: Write the failing tests**

Append to `views/partials/stat-blocks.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/partials/stat-blocks.test.js`
Expected: FAIL — `ENOENT: no such file or directory, open '.../views/partials/stat-blocks.handlebars'`.

- [ ] **Step 3: Create the partial**

Create `views/partials/stat-blocks.handlebars`:

```hbs
{{!-- Star-rating stat selector. One control per stat. Replaces the number
      inputs the stats editor, level-up modal, character form, and class
      form used to render.

      Params:
        stat        the stat key ("might"). Accessible name + data-stat.
        name        the hidden input's name -- what actually POSTs.
        value       seeded points. null/undefined becomes 0.
        max         how many blocks render (5 for character stats, 3 for a
                    class stat spread).
        model       optional expression ("stats.might"); when present the
                    control two-way binds into the surrounding x-data.
        inputClass  optional extra class on the hidden input, for surfaces
                    that query it by class (the level-up modal).

      The hidden input is what makes this work on native form POSTs: it
      carries the same `name` the number input it replaced carried, so no
      route or payload changes. A value ABOVE max is preserved -- every
      block fills and the real number shows beside them -- and only drops
      when the user clicks a block. Nothing clamps silently.

      `value` goes through {{json}} rather than being interpolated bare: a
      null stat renders as nothing at all under {{lookup}}, producing
      `statBlocks(, 5, "luck")` -- a SyntaxError that takes the whole
      component down. --}}
<div class="stat-blocks" role="radiogroup" aria-label="{{capitalize stat}}"
     data-stat="{{stat}}"
     x-data="statBlocks({{json value}}, {{max}}, {{json stat}})"
     {{#if model}}x-modelable="value" x-model="{{model}}"{{/if}}
     @mouseleave="preview = null"
     @keydown="key($event)">
  <input type="hidden" name="{{name}}" :value="value"
         class="stat-blocks-value{{#if inputClass}} {{inputClass}}{{/if}}"
         data-stat="{{stat}}">
  <template x-for="i in max" :key="i">
    <span class="wizard-stat-box" role="radio"
          :class="boxClass(i)"
          :aria-checked="i === value"
          :aria-label="`{{capitalize stat}}: ${i}`"
          :tabindex="tabIndex(i)"
          @click="set(i)"
          @mouseenter="preview = i"></span>
  </template>
  <span class="stat-blocks-over" x-show="value > max" x-cloak x-text="value"></span>
</div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test views/partials/stat-blocks.test.js`
Expected: PASS.

- [ ] **Step 5: Add the styles**

In `public/css/styles.css`, add one custom property to the `:root` block, beside the other `--wizard-stat-*` entries:

```css
  --wizard-stat-preview: #a8a8a8;
```

Then, immediately after the `.wizard-stat-box.is-locked { ... }` rule the Task 1 revert restored, add:

```css
/* Interactive stat block control (views/partials/stat-blocks.handlebars).
   Shares .wizard-stat-box with the wizard's grid so the two read as one
   control. States:
     .is-set      a committed point
     .is-empty    an unfilled slot
     .is-preview  what a click on the hovered block would produce -- used in
                  BOTH directions, so hovering below the current value shows
                  the drop rather than pretending nothing would change */
.stat-blocks {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
}
.wizard-stat-box.is-set {
  background: var(--wizard-stat-user);
  border-color: var(--wizard-stat-user-edge);
  cursor: pointer;
}
.wizard-stat-box.is-empty {
  background: var(--wizard-stat-empty);
  border-color: var(--wizard-stat-user);
  cursor: pointer;
}
.wizard-stat-box.is-empty:hover {
  background: var(--wizard-stat-empty-hover);
}
.wizard-stat-box.is-preview {
  background: var(--wizard-stat-preview);
  border-color: var(--wizard-stat-user-edge);
  cursor: pointer;
}
/* Roving tabindex means only one block per stat is in the tab order; that
   block must show where focus is or keyboard users are navigating blind. */
.stat-blocks [role="radio"]:focus-visible {
  outline: 2px solid var(--bulma-link, #2e63b8);
  outline-offset: 2px;
}
/* The numeral shown beside a full row when a stat exceeds its block count. */
.stat-blocks-over {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--bulma-text, #4a4a4a);
  margin-left: 0.15rem;
}
.stat-blocks.is-readonly .wizard-stat-box { cursor: default; }
```

- [ ] **Step 6: Run the whole unit suite**

Run: `bun run test:unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add views/partials/stat-blocks.handlebars views/partials/stat-blocks.test.js public/css/styles.css
git commit -F - <<'EOF'
feat: add the stat-blocks partial and its styles

The hidden input carries the same name the number input it replaces
carried, so native form POSTs need no route changes, and x-modelable lets
Alpine surfaces bind the value straight into their own state.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: The inline stats editor

**Files:**
- Modify: `views/partials/character-stats-editor.handlebars:5-25`
- Modify: `public/js/alpine-components.js` (`characterStats.edit()`, around line 96)
- Test: `views/partials/character-stats-editor.test.js`

**Interfaces:**
- Consumes: the `stat-blocks` partial (Task 3).
- Produces: `#statsEditor` renders 12 `.stat-blocks` groups instead of 12 `.stats-input` number inputs. `characterStats.stats.<name>` remains the source of truth and the `total` getter is unchanged.

- [ ] **Step 1: Update the failing tests**

In `views/partials/character-stats-editor.test.js`, replace the three `<input class="stats-input">` lines in the `mount` fixture (lines 22-24) with mounted partials. Add at the top of the file, after the existing requires:

```js
const hbsHelpers = require('handlebars-helpers')();
const rangeHelper = require('handlebars-helper-range');

const STAT_BLOCKS_SRC = fs.readFileSync(
  path.join(__dirname, 'stat-blocks.handlebars'), 'utf8'
);

// Renders the REAL stat-blocks partial into the fixture rather than a
// hand-copied stand-in, so a regression in the shipped partial fails here
// too instead of only in stat-blocks.test.js.
const statBlocks = (stat, value) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  return hb.compile(STAT_BLOCKS_SRC)({
    stat, name: stat, value, max: 5, model: `stats.${stat}`
  });
};
```

Replace lines 22-24 with:

```js
      ${statBlocks('vitality', stats.vitality)}
      ${statBlocks('might', stats.might)}
      ${statBlocks('resilience', stats.resilience)}
```

Replace the focus test (lines 54-60):

```js
test('Edit moves focus to the first stat block', async () => {
  await mount(STATS);
  document.getElementById('edit').click();
  await settle();
  // Not a truthy-only assertion: statList starts with 'vitality', and both
  // #statsReadOnly and #statsEditor iterate it, so the first .stat-blocks in
  // DOM order is vitality's. Focus landing on the wrong stat's control must
  // fail here, which a bare "something is focused" check would not catch.
  const first = document.querySelector('.stat-blocks[data-stat="vitality"] [role="radio"][tabindex="0"]');
  expect(first).not.toBe(null);
  expect(document.activeElement).toBe(first);
});
```

Replace the "total recomputes" test (lines 67-76):

```js
test('total recomputes as blocks are clicked', async () => {
  await mount(STATS);
  document.getElementById('edit').click();
  await tick();
  // vitality 3 -> 5, so 3+2+1 = 6 becomes 5+2+1 = 8.
  document.querySelectorAll('.stat-blocks[data-stat="vitality"] [role="radio"]')[4].click();
  await tick();
  expect(document.getElementById('statsTotalSum').textContent).toBe('8');
});
```

Replace the Cancel test body (lines 78-91) so it drives a block instead of an input:

```js
test('Cancel restores the original values and exits edit mode', async () => {
  await mount(STATS);
  document.getElementById('edit').click();
  await tick();
  document.querySelectorAll('.stat-blocks[data-stat="vitality"] [role="radio"]')[4].click();
  await tick();
  expect(document.getElementById('statsTotalSum').textContent).toBe('8');

  document.getElementById('cancel').click();
  await settle();
  expect(document.getElementById('editor').style.display).toBe('none');
  expect(document.getElementById('statsTotalSum').textContent).toBe('6');
});
```

Replace the save test's edit (lines 122-125). The blocks cannot produce 99, so the clamp is no longer reachable from the UI; assert the value the blocks DO produce, and keep the clamp covered by the component's own logic:

```js
    document.querySelectorAll('.stat-blocks[data-stat="vitality"] [role="radio"]')[4].click();
    await tick();
```

and change the payload assertion (line 138):

```js
  expect(JSON.parse(captured.options.body).vitality).toBe(5);
```

Finally, update the template-source test (lines 183-201):

```js
test('character-stats-editor.handlebars carries the Alpine bindings', () => {
  const src = fs.readFileSync(
    path.join(__dirname, 'character-stats-editor.handlebars'),
    'utf8'
  );

  expect(src).toContain('x-text="total"');
  expect(src).toContain('{{> stat-blocks');
  expect(src).toContain('model=(concat "stats." this)');
  expect(src).toContain('@submit.prevent="save()"');
  expect(src).toContain('@click="cancel()"');
  expect(src).toContain(':disabled="saving"');
  // Object form, matching every other :class in these views: the string form
  // can only add a class, never remove one Alpine did not add itself.
  expect(src).toContain(":class=\"{ 'is-loading': saving }\"");
  expect(src).toContain('x-show="error" x-text="error"');

  // The number inputs this replaced must be gone, not merely hidden.
  expect(src).not.toContain('stats-input');
  expect(src).not.toContain('type="number"');
  expect(src).not.toContain('character-stats.js');
  expect(src).not.toContain('CharacterStats');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/partials/character-stats-editor.test.js`
Expected: FAIL — the focus test fails (`edit()` still queries `.stats-input`, so `activeElement` is the body), and the template-source test fails on `{{> stat-blocks`.

- [ ] **Step 3: Update the partial**

Replace lines 5-25 of `views/partials/character-stats-editor.handlebars`:

```hbs
  <div class="wizard-stat-grid">
    {{#each statList}}
    <div class="wizard-stat-row" data-stat="{{this}}">
      <div class="wizard-stat-name">{{capitalize this}}</div>
      {{> stat-blocks stat=this name=this value=(lookup ../character this) max=5 model=(concat "stats." this)}}
    </div>
    {{/each}}
  </div>
```

The `<label for="stat-input-…">` is gone with the input it pointed at — a `for` aimed at a missing id is worse than no label at all. The control names itself through the radiogroup's `aria-label`.

- [ ] **Step 4: Fix the focus target**

In `public/js/alpine-components.js`, in `characterStats.edit()`, replace the `querySelector` line:

```js
    edit() {
      this.error = '';
      this.editing = true;
      this.$nextTick(() => {
        // The blocks use a roving tabindex, so the one tabbable block per
        // stat is the right landing spot; the fallback covers the tick
        // before Alpine has evaluated :tabindex on a freshly-revealed
        // editor. Still scoped to this.root, not $el, for the reason in
        // init() above: $el inside edit() is the Edit button, which
        // contains no blocks at all.
        const first = this.root.querySelector('.stat-blocks [role="radio"][tabindex="0"]')
          || this.root.querySelector('.stat-blocks [role="radio"]');
        if (first) first.focus();
      });
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test views/partials/character-stats-editor.test.js`
Expected: PASS.

- [ ] **Step 6: Run the whole unit suite**

Run: `bun run test:unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add views/partials/character-stats-editor.handlebars views/partials/character-stats-editor.test.js public/js/alpine-components.js
git commit -F - <<'EOF'
feat: make the inline stats editor a block selector

edit() now focuses the tabbable block rather than a .stats-input that no
longer exists -- the e2e spec asserts focus lands on vitality's control,
so a silently-null query would be a real keyboard regression.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: The level-up modal

**Files:**
- Modify: `views/partials/character-level-up.handlebars:54-77`
- Modify: `public/js/character-level-up.js:214-218`
- Test: `views/partials/character-level-up.test.js`

**Interfaces:**
- Consumes: the `stat-blocks` partial (Task 3) and its `stat-change` event.
- Produces: `#levelUpStatGrid` renders `.stat-blocks` groups whose hidden inputs keep the `level-up-stat` class and `data-stat` attribute, so the save payload builder at `character-level-up.js:247` works unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `views/partials/character-level-up.test.js`:

```js
// --- stat blocks in the modal --------------------------------------------

const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const rangeHelper = require('handlebars-helper-range');
const customHelpers = require('../../util/handlebars');

const renderStatBlocks = (stat, value) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  return hb.compile(read('stat-blocks.handlebars'))({
    stat, name: stat, value, max: 5, inputClass: 'level-up-stat'
  });
};

test('character-level-up.handlebars renders stat blocks, not number inputs', () => {
  const src = read('character-level-up.handlebars');
  expect(src).toContain('{{> stat-blocks');
  expect(src).toContain('inputClass="level-up-stat"');
  expect(src).not.toContain('type="number"');
  expect(src).not.toContain('class="input is-small level-up-stat"');
});

test('the hidden inputs keep the class and data-stat the save payload reads', async () => {
  await render(`<div id="levelUpStatGrid">${renderStatBlocks('might', 2)}</div>`);
  await tick();
  const input = document.querySelector('.level-up-stat');
  expect(input.getAttribute('data-stat')).toBe('might');
  expect(input.value).toBe('2');
});

test('clicking a block updates the value the save payload would read', async () => {
  await render(`<div id="levelUpStatGrid">${renderStatBlocks('might', 2)}</div>`);
  await tick();
  document.querySelectorAll('[role="radio"]')[3].click();
  await tick();
  expect(document.querySelector('.level-up-stat').value).toBe('4');
});

test('character-level-up.js recomputes the total from stat-change, not input', () => {
  const src = read('../../public/js/character-level-up.js');
  // A hidden input set programmatically fires no native `input` event, so
  // the old per-field 'input' listener would leave #levelUpTotal frozen at
  // its seeded value for the whole session.
  expect(src).toContain("addEventListener('stat-change', updateStatTotal)");
  expect(src).not.toContain("el.addEventListener('input', updateStatTotal)");
});

test('a stat-change bubbling out of the grid drives the live total', async () => {
  await render(`
    <div id="levelUpStatGrid">
      ${renderStatBlocks('might', 2)}
      ${renderStatBlocks('vitality', 3)}
    </div>
    <strong id="levelUpTotal">0</strong>
  `);
  await tick();

  // Mirrors the wiring in character-level-up.js:215 exactly: one delegated
  // listener on the grid, summing every .level-up-stat.
  const updateStatTotal = () => {
    const sum = Array.from(document.querySelectorAll('.level-up-stat'))
      .reduce((s, el) => s + (parseInt(el.value, 10) || 0), 0);
    document.getElementById('levelUpTotal').textContent = sum;
  };
  document.getElementById('levelUpStatGrid')
    .addEventListener('stat-change', updateStatTotal);
  updateStatTotal();
  expect(document.getElementById('levelUpTotal').textContent).toBe('5');

  document.querySelectorAll('[data-stat="might"] [role="radio"]')[4].click();
  await tick();
  expect(document.getElementById('levelUpTotal').textContent).toBe('8');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/partials/character-level-up.test.js`
Expected: FAIL — `ENOENT` on `stat-blocks.handlebars` is not the failure (Task 3 created it); the source assertions fail on `{{> stat-blocks` and on `addEventListener('stat-change'`.

- [ ] **Step 3: Update the modal template**

Replace lines 54-77 of `views/partials/character-level-up.handlebars` (the `#levelUpStatGrid` block):

```hbs
      <div class="wizard-stat-grid" id="levelUpStatGrid">
        {{#each statList}}
        <div class="wizard-stat-row" data-stat="{{this}}">
          <div class="wizard-stat-name">{{capitalize this}}</div>
          {{> stat-blocks stat=this name=this value=(lookup ../character this) max=5 inputClass="level-up-stat"}}
        </div>
        {{/each}}
      </div>
```

- [ ] **Step 4: Rewire the live total**

In `public/js/character-level-up.js`, replace lines 214-218:

```js
    // Wire the live stat total. One delegated listener on the grid, not one
    // per field: the blocks write through a hidden input, and a hidden
    // input set programmatically fires no native `input` event, so the old
    // per-field 'input' listener would never fire again and #levelUpTotal
    // would sit frozen at its seeded value.
    const statGrid = document.getElementById('levelUpStatGrid');
    if (statGrid) statGrid.addEventListener('stat-change', updateStatTotal);
    updateStatTotal();
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test views/partials/character-level-up.test.js`
Expected: PASS.

- [ ] **Step 6: Run the whole unit suite**

Run: `bun run test:unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add views/partials/character-level-up.handlebars views/partials/character-level-up.test.js public/js/character-level-up.js
git commit -F - <<'EOF'
feat: make the level-up modal's stats a block selector

The live total moves to one delegated stat-change listener: the blocks
write through a hidden input, which fires no native input event when set
programmatically, so the old per-field listener would never fire again.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 6: The character form

**Files:**
- Modify: `views/character-form.handlebars:188-203`
- Test: `views/character-form.test.js`

**Interfaces:**
- Consumes: the `stat-blocks` partial (Task 3).
- Produces: the character form POSTs all 12 stats as before, from hidden inputs. No route or payload change.

- [ ] **Step 1: Write the failing tests**

Append to `views/character-form.test.js`:

```js
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
```

`views/character-form.test.js` already requires `fs` and `path` (lines 2-3) but has no Alpine bootstrap. Add to its requires and add a `beforeAll` after them:

```js
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => {
  await setupAlpine();
  require('../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});
```

and extend line 1's destructure to `const { test, expect, beforeAll } = require('bun:test');`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/character-form.test.js`
Expected: FAIL — `expect(FORM_SRC).toContain('{{> stat-blocks stat=this name=this')` fails.

- [ ] **Step 3: Update the template**

Replace lines 191-201 of `views/character-form.handlebars` (the `{{#each statList}}` body inside the Stats field):

```hbs
      {{#each statList}}
      <div class="column is-one-third">
        <div class="field">
          <label class="label">{{capitalize this}}</label>
          <div class="control">
            {{> stat-blocks stat=this name=this value=(lookup ../character this) max=5}}
          </div>
        </div>
      </div>
      {{/each}}
```

The `required` attribute is dropped along with the number input: a hidden input always carries a value, and 0 is a legitimate stat, so it could only ever be a gate that never fires. The `{{#if}}/{{else}}0` default is dropped too — `{{json value}}` emits `null` for a missing stat and the component's `parseInt(initial, 10) || 0` turns that into 0.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test views/character-form.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole unit suite**

Run: `bun run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add views/character-form.handlebars views/character-form.test.js
git commit -F - <<'EOF'
feat: make the character form's stats a block selector

The hidden input keeps the same name the number input posted, so the
route and payload are untouched -- and the new test asserts all 12 names
actually reach the form, since a native POST has nothing else carrying
them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 7: The class form stat spread

**Files:**
- Modify: `views/class-form.handlebars:100-110`
- Test: `views/class-form.test.js` (create)

**Interfaces:**
- Consumes: the `stat-blocks` partial (Task 3).
- Produces: the class form POSTs `stat_spread[<stat>]` for all 12 stats, unchanged in name and shape, so `parseStatSpread` in `routes/classes.js:56-70` needs no change.

- [ ] **Step 1: Write the failing tests**

Create `views/class-form.test.js`:

```js
// The class form's stat spread is a native POST using bracket notation
// (stat_spread[might]=2), parsed by parseStatSpread in routes/classes.js.
// Swapping the number inputs for blocks must not disturb those names --
// parseStatSpread reads body['stat_spread[<stat>]'] literally, so a renamed
// field silently yields an empty spread and the class ships with no stats.
const { test, expect, beforeAll } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const rangeHelper = require('handlebars-helper-range');
const customHelpers = require('../util/handlebars');
const { statList } = require('../util/enclave-consts');
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => {
  await setupAlpine();
  require('../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

const SRC = fs.readFileSync(path.join(__dirname, 'class-form.handlebars'), 'utf8');

const renderSpread = async (statSpread) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  hb.registerPartial('stat-blocks', fs.readFileSync(
    path.join(__dirname, 'partials', 'stat-blocks.handlebars'), 'utf8'
  ));
  const section = SRC.slice(
    SRC.indexOf('<label class="label">Class Stats</label>'),
    SRC.indexOf('<label class="label" for="class-image">')
  );
  await render(hb.compile(section)({ statList, class: { stat_spread: statSpread } }));
  await tick();
};

test('class-form renders stat blocks instead of number inputs', () => {
  expect(SRC).toContain('{{> stat-blocks');
  expect(SRC).not.toMatch(/name="stat_spread\[\{\{this\}\}\]"\s*value=/);
  expect(SRC).not.toContain('type="number"');
});

test('every stat posts under its bracket-notation name', async () => {
  await renderSpread({ might: 2, resilience: 1 });
  const posted = Array.from(document.querySelectorAll('input[type="hidden"]'))
    .map((el) => el.name);
  expect(posted.sort()).toEqual(statList.map((s) => `stat_spread[${s}]`).sort());
});

test('a class spread renders three blocks per stat, not five', async () => {
  await renderSpread({ might: 2 });
  const might = document.querySelector('.stat-blocks[data-stat="might"]');
  expect(might.querySelectorAll('[role="radio"]').length).toBe(3);
});

test('seeded points fill and unseeded stats start empty', async () => {
  await renderSpread({ might: 2 });
  expect(document.querySelector('input[name="stat_spread[might]"]').value).toBe('2');
  expect(document.querySelector('input[name="stat_spread[luck]"]').value).toBe('0');
});

test('clicking a block updates the value that would post', async () => {
  await renderSpread({ might: 2 });
  document.querySelectorAll('.stat-blocks[data-stat="might"] [role="radio"]')[2].click();
  await tick();
  expect(document.querySelector('input[name="stat_spread[might]"]').value).toBe('3');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/class-form.test.js`
Expected: FAIL — `expect(SRC).toContain('{{> stat-blocks')` fails.

- [ ] **Step 3: Update the template**

Replace lines 102-109 of `views/class-form.handlebars` (the `{{#each statList}}` body):

```hbs
      {{#each statList}}
      <div class="column is-2-tablet is-4-mobile">
        <label class="label is-small is-capitalized">{{this}}</label>
        <div class="control">
          {{> stat-blocks stat=this name=(concat "stat_spread[" this "]") value=(lookup ../class.stat_spread this) max=3}}
        </div>
      </div>
      {{/each}}
```

The `for="stat-{{this}}"` and matching `id` go with the input they linked; the radiogroup names itself through its `aria-label`. The existing help text ("Most classes total 3 points; leave a stat at 0 to omit it") stays accurate.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test views/class-form.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole unit suite, including the route contract**

Run: `bun run test:unit && bun run test:http`
Expected: PASS. `routes/classes-stat-spread.test.js` exercises `parseStatSpread` against the bracket names and must be unaffected.

- [ ] **Step 6: Commit**

```bash
git add views/class-form.handlebars views/class-form.test.js
git commit -F - <<'EOF'
feat: make the class stat spread a block selector

parseStatSpread reads body['stat_spread[<stat>]'] literally, so the new
test pins all 12 bracket names -- a renamed field would yield an empty
spread and ship a class with no stats, with no error anywhere.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Read-only blocks on the LFG post page

**Files:**
- Create: `views/partials/stat-blocks-readonly.handlebars`
- Modify: `views/lfg-post.handlebars:110-119` (per-character details) and `:177-189` (party stats)
- Test: `views/lfg-post.test.js` (create)

**Interfaces:**
- Consumes: the `.wizard-stat-box`, `.is-set`, `.is-empty`, and `.stat-blocks.is-readonly` styles from Tasks 1 and 3.
- Produces: `{{> stat-blocks-readonly value=… max=…}}` — server-rendered blocks with no JS, no ARIA group, and no interaction.

- [ ] **Step 1: Write the failing tests**

Create `views/lfg-post.test.js`:

```js
// The LFG post page showed stats as literal '+' characters. It predates the
// square-plus commit but is the same "stats as pluses" look, so it converts
// with the rest.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const rangeHelper = require('handlebars-helper-range');
const customHelpers = require('../util/handlebars');

const READONLY_SRC = fs.readFileSync(
  path.join(__dirname, 'partials', 'stat-blocks-readonly.handlebars'), 'utf8'
);
const LFG_SRC = fs.readFileSync(path.join(__dirname, 'lfg-post.handlebars'), 'utf8');

const renderReadonly = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  return hb.compile(READONLY_SRC)(context);
};

const count = (html, cls) => (html.match(new RegExp(cls, 'g')) || []).length;

test('renders one filled block per point and dims the rest to max', () => {
  const html = renderReadonly({ value: 2, max: 5 });
  expect(count(html, 'is-set')).toBe(2);
  expect(count(html, 'is-empty')).toBe(3);
});

test('a value at max fills every block and dims none', () => {
  const html = renderReadonly({ value: 5, max: 5 });
  expect(count(html, 'is-set')).toBe(5);
  expect(count(html, 'is-empty')).toBe(0);
});

test('a value above max fills every block without overflowing the row', () => {
  // Party totals routinely exceed 5; the row must cap rather than render 14
  // blocks. The caller shows the real number alongside.
  const html = renderReadonly({ value: 14, max: 5 });
  expect(count(html, 'is-set')).toBe(5);
  expect(count(html, 'is-empty')).toBe(0);
});

test('a zero or missing value renders an all-dim row', () => {
  expect(count(renderReadonly({ value: 0, max: 5 }), 'is-empty')).toBe(5);
  expect(count(renderReadonly({ max: 5 }), 'is-empty')).toBe(5);
});

test('the read-only control carries no interactive affordances', () => {
  const html = renderReadonly({ value: 3, max: 5 });
  expect(html).toContain('is-readonly');
  expect(html).not.toContain('role="radio"');
  expect(html).not.toContain('x-data');
  expect(html).not.toContain('@click');
  expect(html).not.toContain('tabindex');
});

test('lfg-post renders blocks and no longer prints plus characters', () => {
  expect(LFG_SRC).toContain('{{> stat-blocks-readonly');
  // Both {{#range}} loops that printed a bare '+' per point are gone.
  expect(LFG_SRC).not.toMatch(/\{\{#range 0 \(lookup [^)]*\)\}\}\+/);
  expect(LFG_SRC).not.toMatch(/\{\{#range 0 \(lookup [^)]*\)\}\}\s*\n\s*\+/);
});

test('party stats keep their numeral, since totals routinely exceed five', () => {
  const partySection = LFG_SRC.slice(LFG_SRC.indexOf('Party Stats'));
  expect(partySection).toContain('({{lookup ../partyStats this}})');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/lfg-post.test.js`
Expected: FAIL — `ENOENT: ... stat-blocks-readonly.handlebars`.

- [ ] **Step 3: Create the read-only partial**

Create `views/partials/stat-blocks-readonly.handlebars`:

```hbs
{{!-- Display-only stat blocks. No Alpine, no ARIA group, no interaction --
      this is the same visual vocabulary as views/partials/stat-blocks.handlebars
      for surfaces that only report a value.

      Params:
        value  the points to show (null/missing renders an empty row)
        max    how many blocks the row holds

      A value above max fills every block and stops there rather than
      spilling a 14-block row across the layout; callers that can exceed
      max (party totals) print the real number alongside. There is no `min`
      helper registered, hence the branch. --}}
<span class="stat-blocks is-readonly">
  {{#if (gt value max)}}
  {{#range 0 max}}<span class="wizard-stat-box is-set"></span>{{/range}}
  {{else}}
  {{#range 0 value}}<span class="wizard-stat-box is-set"></span>{{/range}}
  {{#range value max}}<span class="wizard-stat-box is-empty"></span>{{/range}}
  {{/if}}
</span>
```

- [ ] **Step 4: Update the per-character details block**

Replace lines 113-119 of `views/lfg-post.handlebars`:

```hbs
                      {{#each ../statList}}
                      <div class="column is-6">
                        <p class="mb-1"><strong>{{capitalize this}}</strong></p>
                        {{> stat-blocks-readonly value=(lookup ../this.character this) max=5}}
                      </div>
                      {{/each}}
```

- [ ] **Step 5: Update the party stats block**

Replace lines 179-187 of `views/lfg-post.handlebars`:

```hbs
      {{#each statList}}
      <div class="column is-3">
        <p class="mb-1"><strong>{{capitalize this}}</strong> ({{lookup ../partyStats this}})</p>
        {{> stat-blocks-readonly value=(lookup ../partyStats this) max=5}}
      </div>
      {{/each}}
```

The numeral stays: a party of four routinely totals well above 5, and the capped row alone would read as "5" for every stat.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test views/lfg-post.test.js`
Expected: PASS.

- [ ] **Step 7: Run the whole unit suite**

Run: `bun run test:unit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add views/partials/stat-blocks-readonly.handlebars views/lfg-post.handlebars views/lfg-post.test.js
git commit -F - <<'EOF'
feat: show LFG stats as blocks instead of plus characters

Party totals routinely exceed the five-block row, so the row caps and the
real number stays beside it rather than spilling a 14-block row across
the layout.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Jump-to-N and hover preview in the wizard

**Files:**
- Modify: `public/js/character-wizard.js` (`renderStatGrid` ~:818, `onStatBoxClick` ~:905, and the listener wiring)
- Modify: `public/css/styles.css` (add `.is-preview-off`)
- Test: `views/partials/stat-blocks.test.js` (append)

**Interfaces:**
- Consumes: `window.StatBlocks.resolveStatTarget` from Task 2. Load order is safe: `alpine-components.js` is a deferred `<head>` script (`head.handlebars:16`) and `character-wizard.js` a deferred body script (`character-wizard.handlebars:284`), and deferred scripts execute in document order.
- Produces: no new exports. The wizard's `state.userStats` shape is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `views/partials/stat-blocks.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/partials/stat-blocks.test.js`
Expected: FAIL — the five `wizardTarget` cases PASS already (they only exercise Task 2's function), and the two source assertions FAIL on `StatBlocks.resolveStatTarget`.

- [ ] **Step 3: Replace `onStatBoxClick`**

In `public/js/character-wizard.js`, replace the whole `onStatBoxClick` function (around line 905) with:

```js
  // Resolve what a click or hover on `slot` (0-based DOM index) should make
  // this stat's TOTAL. Shared by the click handler and the hover preview so
  // the preview cannot promise something the click won't deliver.
  const resolveWizardTotal = (stat, slot) => {
    const classPts = getClassPoints();
    const persPts = getPersonalityPoints();
    const cp = classPts[stat] || 0;
    const pp = persPts[stat] || 0;
    const up = state.userStats[stat] || 0;
    const remaining = Math.max(0, getTotalPoints()
      - sumPoints(classPts) - sumPoints(persPts) - getUserPointsTotal());
    return window.StatBlocks.resolveStatTarget({
      slot: slot + 1,
      current: cp + pp + up,
      // Class- and personality-assigned points are the floor: no click can
      // take the stat below them.
      floor: cp + pp,
      // Whichever binds first -- the per-stat cap for this level, or what
      // the remaining budget can actually pay for.
      ceiling: Math.min(getMaxAssignable(), cp + pp + up + remaining)
    });
  };

  // Click handler for stat boxes. Star-rating semantics, matching the
  // statBlocks component every other surface uses: clicking the Nth block
  // sets the stat to N, except that clicking the block you are already on
  // steps down by one.
  const onStatBoxClick = (e) => {
    const box = e.target.closest('.wizard-stat-box');
    if (!box || !box.hasAttribute('data-clickable')) return;
    const stat = box.getAttribute('data-stat');
    const slot = parseInt(box.getAttribute('data-slot'), 10);
    const classPts = getClassPoints();
    const persPts = getPersonalityPoints();
    const cp = classPts[stat] || 0;
    const pp = persPts[stat] || 0;

    const userTarget = Math.max(0, resolveWizardTotal(stat, slot) - cp - pp);
    if (userTarget === (state.userStats[stat] || 0)) return;

    if (userTarget <= 0) delete state.userStats[stat];
    else state.userStats[stat] = userTarget;

    renderStatGrid();
    updateStatsDisplay();
    renderSummary();
  };

  // Hover preview. Shows the total a click would produce -- in both
  // directions, so hovering below the current value previews the drop
  // rather than pretending nothing would change.
  const clearStatPreview = () => {
    if (!statGrid) return;
    Array.prototype.forEach.call(
      statGrid.querySelectorAll('.is-preview, .is-preview-off'),
      (el) => el.classList.remove('is-preview', 'is-preview-off')
    );
  };

  const onStatBoxHover = (e) => {
    const box = e.target.closest && e.target.closest('.wizard-stat-box');
    clearStatPreview();
    if (!box || !box.hasAttribute('data-clickable')) return;
    const stat = box.getAttribute('data-stat');
    const slot = parseInt(box.getAttribute('data-slot'), 10);
    const row = box.closest('.wizard-stat-row');
    if (!row) return;
    const classPts = getClassPoints();
    const persPts = getPersonalityPoints();
    const floor = (classPts[stat] || 0) + (persPts[stat] || 0);
    const total = resolveWizardTotal(stat, slot);

    Array.prototype.forEach.call(row.querySelectorAll('.wizard-stat-box'), (b, i) => {
      if (i < floor) return;                          // class/personality: never previewed
      if (i < total) b.classList.add('is-preview');    // would be filled
      else if (b.classList.contains('is-user')) b.classList.add('is-preview-off'); // would be given back
    });
  };
```

- [ ] **Step 4: Wire the hover listeners**

Replace line 994 — currently `if (statGrid) statGrid.addEventListener('click', onStatBoxClick);` — with:

```js
  if (statGrid) {
    statGrid.addEventListener('click', onStatBoxClick);
    // mouseover, not mouseenter: this is delegated to the grid and has to
    // fire as the pointer crosses between individual boxes, which mouseenter
    // on the container does not do. mouseleave on the container is still the
    // right clear signal -- it fires once, when the pointer leaves the grid.
    statGrid.addEventListener('mouseover', onStatBoxHover);
    statGrid.addEventListener('mouseleave', clearStatPreview);
  }
```

- [ ] **Step 5: Add the preview-off style**

In `public/css/styles.css`, immediately after the `.wizard-stat-box.is-preview` rule added in Task 3:

```css
/* A point the hovered click would give BACK. Dimming it (rather than
   emptying it) keeps the row's shape stable while the pointer moves. */
.wizard-stat-box.is-preview-off {
  opacity: 0.4;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test views/partials/stat-blocks.test.js`
Expected: PASS.

- [ ] **Step 7: Run the whole unit suite**

Run: `bun run test:unit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add public/js/character-wizard.js public/css/styles.css views/partials/stat-blocks.test.js
git commit -F - <<'EOF'
feat: give the wizard's stat grid jump-to-N and hover preview

The wizard calls the same resolveStatTarget the statBlocks component
does, so the two surfaces cannot drift; the per-stat cap and the budget
reconciliation are untouched and still bound every click through the
ceiling argument.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 10: End-to-end specs and the browser check

**Files:**
- Modify: `e2e/specs/04-stats-editor.spec.js:55-106`
- Modify: `e2e/specs/05-level-up-modal.spec.js` (the stat-editing steps)

**Interfaces:**
- Consumes: every prior task.
- Produces: nothing further depends on this.

- [ ] **Step 1: Update the stats-editor spec**

In `e2e/specs/04-stats-editor.spec.js`, replace the note at lines 38-45 and the four owner tests that drive number inputs. The scoping note still applies — the level-up modal renders its own grid with the same `data-stat` values on the same page — so keep every locator scoped to `#statsEditor`:

```js
  // NOTE: every stat locator below is scoped to `#statsEditor`. The character
  // show page also renders the (separate, hidden-by-default) level-up modal
  // from views/partials/character-level-up.handlebars, whose stat grid uses
  // the same `data-stat` convention. An unscoped locator matches both and
  // Playwright's strict mode throws. This is test-selector scoping, not a
  // product defect -- the two controls belong to unrelated features that both
  // happen to live on the same page.
  const blocks = (page, stat) =>
    page.locator(`#statsEditor .stat-blocks[data-stat="${stat}"] [role="radio"]`);
  const posted = (page, stat) =>
    page.locator(`#statsEditor input[name="${stat}"]`);

  test('the stats box renders with the editor hidden', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await expect(page.locator('#statsBox')).toBeVisible();
    await expect(page.locator('#statsReadOnly')).toBeVisible();
    await expect(page.locator('#statsEditor')).toBeHidden();
    await expect(page.locator('#statsUnlockBtn')).toBeVisible();
  });

  test('Edit reveals the editor and focuses the first stat block', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await page.locator('#statsUnlockBtn').click();

    await expect(page.locator('#statsEditor')).toBeVisible();
    await expect(page.locator('#statsReadOnly')).toBeHidden();

    // `vitality` by name, not just "something is focused": edit() takes the
    // first .stat-blocks in DOM order, and util/enclave-consts.js's statList
    // (the array both #statsReadOnly and #statsEditor iterate) starts with
    // 'vitality'. A truthy-only assertion would still pass with focus on the
    // wrong stat.
    await expect(
      page.locator('#statsEditor .stat-blocks[data-stat="vitality"] [role="radio"][tabindex="0"]')
    ).toBeFocused();
  });

  test('the live total tracks block clicks', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await page.locator('#statsUnlockBtn').click();

    const before = Number(await page.locator('#statsTotalSum').innerText());
    await blocks(page, 'might').nth(4).click();   // 5th block -> 5
    await expect
      .poll(async () => Number(await page.locator('#statsTotalSum').innerText()))
      .toBe(before - 1 + 5);                      // seeded value is 1
  });

  test('clicking the block a stat is already on steps it down', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await page.locator('#statsUnlockBtn').click();

    await blocks(page, 'might').nth(2).click();   // 3rd block -> 3
    await expect(posted(page, 'might')).toHaveValue('3');
    await blocks(page, 'might').nth(2).click();   // same block -> 2
    await expect(posted(page, 'might')).toHaveValue('2');
  });

  test('Cancel restores the original values and hides the editor', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await page.locator('#statsUnlockBtn').click();
    await blocks(page, 'might').nth(3).click();
    await page.locator('#statsCancelBtn').click();

    await expect(page.locator('#statsEditor')).toBeHidden();
    await page.locator('#statsUnlockBtn').click();
    await expect(posted(page, 'might')).toHaveValue('1');
  });

  test('Save persists to the database', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await page.locator('#statsUnlockBtn').click();
    await blocks(page, 'might').nth(4).click();   // 5th block -> 5
    await page.locator('#statsSaveBtn').click();

    await expect(page.locator('#statsEditor')).toBeHidden();
    await expect.poll(async () => {
      const { rows } = await db.query('select might from characters where id = $1', [character.id]);
      return rows[0].might;
    }).toBe(5);
  });
```

- [ ] **Step 2: Update the level-up spec**

In `e2e/specs/05-level-up-modal.spec.js`, replace lines 106-107 of the "completing a level-up persists the new level and the edited stat" test:

```js
  // The blocks write through a hidden input, so there is nothing to fill;
  // clicking the Nth block is how a stat reaches N. Capped at the 5-block
  // row rather than blindly incrementing, so a seeded 5 doesn't ask for a
  // sixth block that does not exist.
  const editedMight = before.might >= 5 ? 4 : before.might + 1;
  await page.locator('#levelUpModal .stat-blocks[data-stat="might"] [role="radio"]')
    .nth(editedMight - 1).click();
```

`editedMight` keeps its name and meaning, so the persistence assertion at line 134 (`toEqual({ level: before.level + 1, might: editedMight })`) needs no change. Leave every other assertion in the file alone — what the save persists has not changed.

- [ ] **Step 3: Run the unit suite one more time**

Run: `bun run test:unit && bun run test:http`
Expected: PASS.

- [ ] **Step 4: Run the e2e suite**

Run: `bun run test:e2e`
Expected: PASS. This tier needs a local Supabase and the app running — follow `docs/` for the e2e tier setup if it is not already up. If the tier cannot be started, say so explicitly rather than reporting the specs as passing.

- [ ] **Step 5: Manual browser check**

Hover preview and focus rings are not things jsdom or these specs confirm. Start the app (`bun run dev`) and check each surface:

| Surface | Check |
|---|---|
| `/characters/:id` → Edit | Blocks render; hover previews up and down; clicking the active block steps down; Tab reaches one block per stat; arrows adjust; the total tracks |
| `/characters/:id` → Level Up | Same, and `#levelUpTotal` tracks |
| `/characters/:id/edit` | Blocks render; save persists all 12 stats |
| `/classes/new` | Three blocks per stat; save persists the spread |
| `/characters/new` wizard step 2 | Clicking the 4th block jumps; a short budget assigns only what remains; class points stay unclickable; hover previews |
| `/lfg/:id` | Party stats and per-character stats show blocks, no `+` characters |

- [ ] **Step 6: Commit**

```bash
git add e2e/specs/04-stats-editor.spec.js e2e/specs/05-level-up-modal.spec.js
git commit -F - <<'EOF'
test: drive the stat blocks instead of number inputs in e2e

Adds coverage for the step-down click, which has no equivalent in a
number input and is the only way a stat reaches zero from the UI.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```
