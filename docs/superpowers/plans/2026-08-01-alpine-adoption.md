# Alpine.js Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-rolled client-side view-state management (inline `onclick`, global handlers in `app.js`, whole files of reactive glue) with Alpine.js, and add a jsdom test harness so the conversions are verifiable.

**Architecture:** Alpine 3.15.12 loads from a pinned CDN alongside the existing htmx 2.0.8. Alpine's own MutationObserver auto-initializes htmx-swapped content, so there is **no** re-init wiring. The one real hazard — htmx's settle phase overwriting `class`/`style` that Alpine wrote — is neutralized by setting `defaultSettleDelay: 0` in the htmx-config meta tag. htmx keeps every server round-trip unchanged; Alpine only owns local, ephemeral view state.

**Tech Stack:** Bun 1.3.3, Express 4, express-handlebars 8, Bulma 1.0.4, htmx 2.0.8, Alpine.js 3.15.12, jsdom (test-only), `bun:test`.

**Spec:** `docs/superpowers/specs/2026-08-01-alpine-adoption-design.md`
**Ticket:** ar-7v3k

## Global Constraints

- Alpine version is **exactly `3.15.12`** everywhere — CDN URL, devDependency, and the version-sync test. Never a range (`@3.x.x` breaks SRI).
- Alpine CDN SRI hash: `sha384-pb6hrQvo4s23cEUFtj0CZkzGE3jyK3pj26RIupXXxhSrrcUA/Cn0lZgcCrGH0t6L`
- **Never** add an `htmx:afterSwap` → `Alpine.initTree()` / `Alpine.destroyTree()` handler. Alpine auto-initializes swapped nodes; adding one double-initializes components and resets their state.
- The Alpine `<script>` tag must be **last** among the deferred scripts in `views/partials/head.handlebars` — `Alpine.start()` fires in a microtask right after its own tag, before the next deferred script, so anything calling `Alpine.data()` must load earlier.
- No server route may change. No `hx-get`/`hx-post`/`hx-patch`/`hx-trigger` behavior may change. This is a client-only refactor.
- `public/js/app.js:843-867` (the `htmx:afterSwap` re-init hub for tooltips, TomSelect, croppers, ToastUI) **stays**. Every task must leave it working.
- Never convert the tippy tooltip source divs. They use `.is-hidden` and look like toggles but are tooltip **content**; converting them breaks tooltips.
- Out of scope entirely: `public/js/character-wizard.js`, `public/js/character-level-up.js` (except one `dispatchEvent` line), `public/js/pdf-viewer.js`, all 19 `hx-confirm` sites, the 11 `App.signIn`-family auth handlers, TomSelect, `hx-disabled-elt`.
- Every task ends green: `bun test` passes and `bun run check` passes.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File Structure

**Created:**
- `test/helpers/alpine-dom.js` — jsdom + Alpine bootstrap and mounting helpers. Sole responsibility: make Alpine drivable under `bun:test`.
- `test/helpers/alpine-dom.test.js` — self-test proving the harness works.
- `public/js/alpine-components.js` — all `Alpine.data()` registrations. Loaded before the Alpine tag.
- `views/partials/head.test.js` — asserts the CDN pin matches the installed package and that the settle config is present.

**Modified:**
- `views/partials/head.handlebars` — htmx-config meta (line 4) and script block (lines 12-20).
- `public/css/styles.css` — `[x-cloak]` rule.
- `scripts/run-tests.mjs` — add `test` to the scanned directory list.
- `package.json` — `jsdom` + `alpinejs` devDependencies.
- Templates and `public/js/app.js` per phase, listed in each task.

**Deleted:**
- `public/js/character-stats.js` (Task 12)
- `public/js/app.js:869-891` — both global handlers, removed in halves (Tasks 8 and 19)
- `App.openModal` / `App.closeModal` and their exports (Task 19)

---

## Phase 0 — Pre-existing bug fixes

These are real defects found while inventorying. They are independent of Alpine and land first so the branch starts from a correct baseline.

### Task 1: Delete the dead `#historyModal`

`#historyModal-{{this.id}}` has three close sites and **no open trigger anywhere in the codebase**. It is unreachable markup.

**Files:**
- Modify: `views/my-classes.handlebars:118-130`
- Test: `views/my-classes.test.js` (create)

**Interfaces:**
- Consumes: nothing
- Produces: nothing. Task 17 relies on `#duplicateModal-{{this.id}}` in the same file still existing.

- [ ] **Step 1: Confirm it really is unreachable**

```bash
grep -rn "historyModal" views/ public/js/ routes/
```

Expected: only the four lines in `views/my-classes.handlebars` (118, 119, 123, 127). If anything else appears — especially an `openModal('#historyModal…')` — **stop and report**; the premise is wrong.

- [ ] **Step 2: Write the failing test**

Create `views/my-classes.test.js`:

```js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

const source = () => fs.readFileSync(
  path.join(__dirname, 'my-classes.handlebars'), 'utf8'
);

test('my-classes has no unreachable historyModal markup', () => {
  expect(source()).not.toContain('historyModal');
});

test('my-classes still renders the duplicate modal', () => {
  expect(source()).toContain('duplicateModal-');
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `bun test views/my-classes.test.js`
Expected: FAIL — the first test finds `historyModal` in the source.

- [ ] **Step 4: Delete the modal block**

Remove lines 118-130 of `views/my-classes.handlebars` — the entire `<div id="historyModal-{{this.id}}" …>` element through its closing `</div>`. Leave the `#duplicateModal-{{this.id}}` block that follows completely untouched.

- [ ] **Step 5: Run the tests**

Run: `bun test views/my-classes.test.js && bun run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add views/my-classes.handlebars views/my-classes.test.js
git commit -m "$(cat <<'EOF'
fix: remove unreachable historyModal from my-classes (ar-7v3k)

#historyModal-{{id}} had a modal-background, a delete button and a footer
Close button, but no open trigger anywhere in views/, public/js/ or
routes/. It was dead markup rendered once per class row.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Normalize `#deceased-modal` opening

`#deceased-modal` opens with raw `classList.add('is-active')`, so it never sets `body.modal-open`. But Escape closes it via `App.closeModal` (`app.js:872-874`), which *removes* a `modal-open` class that was never added — leaving the body class out of sync with any other modal that happens to be open.

**Files:**
- Modify: `views/character-form.handlebars:389`
- Test: `views/character-form.test.js` (create)

**Interfaces:**
- Consumes: `App.openModal(selector)` from `public/js/app.js:1263`
- Produces: nothing. Task 15 replaces this call entirely with Alpine.

- [ ] **Step 1: Write the failing test**

Create `views/character-form.test.js`:

```js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

const source = () => fs.readFileSync(
  path.join(__dirname, 'character-form.handlebars'), 'utf8'
);

test('deceased modal opens through App.openModal, not raw classList', () => {
  const html = source();
  expect(html).toContain("App.openModal('#deceased-modal')");
  expect(html).not.toContain("getElementById('deceased-modal').classList.add");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test views/character-form.test.js`
Expected: FAIL — `App.openModal('#deceased-modal')` is not present.

- [ ] **Step 3: Change the open trigger**

In `views/character-form.handlebars`, replace line 389's attribute:

```handlebars
<button type="button" class="button is-dark" onclick="App.openModal('#deceased-modal')">
```

Leave the three close sites (409, 413, 438) as they are — Task 15 converts the whole modal.

- [ ] **Step 4: Run the tests**

Run: `bun test views/character-form.test.js && bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add views/character-form.handlebars views/character-form.test.js
git commit -m "$(cat <<'EOF'
fix: open deceased modal via App.openModal so body.modal-open stays in sync (ar-7v3k)

The button used raw classList.add('is-active'), which never set
body.modal-open. Escape closes the modal through App.closeModal, which
then removed a modal-open class that was never added.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 1 — Infrastructure

No component is converted in this phase. It ends with Alpine loaded, configured, and testable.

### Task 3: jsdom + Alpine test harness

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `scripts/run-tests.mjs` (scanned directory list)
- Create: `test/helpers/alpine-dom.js`
- Create: `test/helpers/alpine-dom.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `setupAlpine(): Promise<Alpine>`, `render(html: string): Promise<HTMLElement>`, `renderPartial(name: string, context: object): Promise<HTMLElement>`, `tick(): Promise<void>`. **Every later test task uses these exact names.**

Two non-obvious requirements, both verified empirically — do not "simplify" them away:
1. `ShadowRoot` must exist on `globalThis`. Alpine's `findClosest` runs `el.parentNode instanceof ShadowRoot` during `start()`; jsdom defines it on `dom.window` but not as a Node global, and its absence **hard-crashes** startup.
2. Alpine must be imported **after** the globals are installed, or `start()` throws.

- [ ] **Step 1: Install the dev dependencies**

```bash
bun add -d jsdom alpinejs@3.15.12
```

Verify the exact version landed (the plan's SRI hash and version-sync test both depend on it):

```bash
node -p "require('./node_modules/alpinejs/package.json').version"
```

Expected: `3.15.12`. If it differs, **stop** — the SRI hash in Task 4 will not match.

- [ ] **Step 2: Let the runner see `test/`**

`scripts/run-tests.mjs` currently walks `['models', 'routes', 'services', 'util', 'views']`, so nothing under `test/` ever runs. Add `test`:

```js
const allFiles = ['models', 'routes', 'services', 'test', 'util', 'views'].flatMap(testFiles).sort();
```

- [ ] **Step 3: Write the harness**

Create `test/helpers/alpine-dom.js`:

```js
// jsdom + Alpine bootstrap for component tests.
//
// Alpine needs a set of DOM constructors as *globals*, not just on
// dom.window. ShadowRoot in particular is load-bearing: Alpine's
// findClosest does `el.parentNode instanceof ShadowRoot` during start(),
// and its absence throws a ReferenceError that kills startup. Alpine must
// also be imported after those globals exist.
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const { JSDOM } = require('jsdom');

const GLOBAL_KEYS = [
  'window', 'document', 'navigator', 'MutationObserver', 'Element',
  'HTMLElement', 'Node', 'CustomEvent', 'Event', 'requestAnimationFrame',
  'cancelAnimationFrame', 'getComputedStyle', 'ShadowRoot', 'DocumentFragment'
];

let alpine = null;

// Boot jsdom + Alpine once per test process. Alpine is a module singleton
// and warns loudly if start() runs twice, so this is idempotent.
const setupAlpine = async () => {
  if (alpine) return alpine;

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true
  });
  for (const key of GLOBAL_KEYS) globalThis[key] = dom.window[key];

  alpine = (await import('alpinejs')).default;
  globalThis.Alpine = alpine;
  alpine.start();
  await alpine.nextTick();
  return alpine;
};

// Alpine's scheduler is microtask-based; reading the DOM synchronously
// after a trigger returns stale values. Always await this.
const tick = async () => { await alpine.nextTick(); };

// Replace the body and let Alpine's MutationObserver initialize it. This
// is also how we simulate an hx-boost body swap.
const render = async (html) => {
  document.body.innerHTML = html;
  await tick();
  return document.body;
};

// Compile a Handlebars partial from views/partials and mount it.
const renderPartial = async (name, context) => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'views', 'partials', `${name}.handlebars`),
    'utf8'
  );
  return render(Handlebars.compile(src)(context));
};

module.exports = { setupAlpine, tick, render, renderPartial };
```

- [ ] **Step 4: Write the harness self-test**

Create `test/helpers/alpine-dom.test.js`:

```js
const { test, expect, beforeAll } = require('bun:test');
const { setupAlpine, render, tick } = require('./alpine-dom');

beforeAll(async () => { await setupAlpine(); });

test('Alpine initializes markup and evaluates expressions', async () => {
  await render('<div x-data="{ msg: \'ok\' }"><p x-text="msg"></p></div>');
  expect(document.querySelector('p').textContent).toBe('ok');
});

test('Alpine reacts to events after a tick', async () => {
  await render(`
    <div x-data="{ n: 1 }">
      <button @click="n++"></button>
      <span x-text="n"></span>
    </div>
  `);
  document.querySelector('button').click();
  await tick();
  expect(document.querySelector('span').textContent).toBe('2');
});

test('Alpine auto-initializes content inserted after start (hx-boost swap)', async () => {
  await render('<div x-data="{ a: 1 }"><i x-text="a"></i></div>');
  // A second render() is a full body replacement — exactly what hx-boost does.
  await render('<div x-data="{ b: 2 }"><i x-text="b"></i></div>');
  expect(document.querySelector('i').textContent).toBe('2');
});

test('Alpine tears down components whose nodes are removed', async () => {
  await render('<div id="gone" x-data="{ a: 1 }"></div>');
  const el = document.getElementById('gone');
  expect(el._x_marker).toBeDefined();
  await render('<p>replaced</p>');
  expect(el._x_marker).toBeUndefined();
});
```

The third test is the load-bearing one: it proves swapped content self-initializes, which is why no `afterSwap` hook is needed. The fourth proves cleanup is automatic.

- [ ] **Step 5: Run the tests**

Run: `bun test test/helpers/alpine-dom.test.js`
Expected: 4 passing. A `ReferenceError: ShadowRoot is not defined` means `GLOBAL_KEYS` was trimmed — restore it.

- [ ] **Step 6: Confirm the runner picks up `test/`**

Run: `bun run test:unit`
Expected: the suite runs and includes `test/helpers/alpine-dom.test.js`. All green.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock scripts/run-tests.mjs test/helpers/alpine-dom.js test/helpers/alpine-dom.test.js
git commit -m "$(cat <<'EOF'
test: add jsdom + Alpine harness for component tests (ar-7v3k)

Adds jsdom and alpinejs@3.15.12 as devDependencies and a helper that
boots Alpine under bun:test. ShadowRoot and friends must be installed as
globals before Alpine is imported, or start() throws.

Also adds test/ to the directories run-tests.mjs walks — nothing under
test/ was being executed.

Self-tests cover init, reactivity, auto-initialization of content
inserted after start (the hx-boost case), and automatic teardown.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Load Alpine in the app

**Files:**
- Modify: `views/partials/head.handlebars:12-20`
- Modify: `public/css/styles.css`
- Create: `public/js/alpine-components.js`
- Create: `views/partials/head.test.js`

**Interfaces:**
- Consumes: `alpinejs` devDependency version from Task 3
- Produces: `public/js/alpine-components.js` with an `alpine:init` listener. **Every `Alpine.data()` registration in Tasks 12, 15-18 goes in this file.**

- [ ] **Step 1: Write the failing test**

Create `views/partials/head.test.js`:

```js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const alpinePkg = require('alpinejs/package.json');

const head = () => fs.readFileSync(
  path.join(__dirname, 'head.handlebars'), 'utf8'
);

test('the Alpine CDN pin matches the installed alpinejs package', () => {
  const match = head().match(/alpinejs@([\d.]+)\/dist\/cdn\.min\.js/);
  expect(match).not.toBeNull();
  expect(match[1]).toBe(alpinePkg.version);
});

test('the Alpine script carries an SRI hash', () => {
  const tag = head().split('\n').find(l => l.includes('alpinejs@'));
  expect(tag).toContain('integrity="sha384-');
  expect(tag).toContain('defer');
});

test('Alpine loads last so registrations run before Alpine.start()', () => {
  const src = head();
  expect(src.indexOf('/js/alpine-components.js')).toBeGreaterThan(-1);
  expect(src.indexOf('/js/alpine-components.js'))
    .toBeLessThan(src.indexOf('alpinejs@'));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test views/partials/head.test.js`
Expected: FAIL — no `alpinejs@` in the head partial.

- [ ] **Step 3: Create the registration file**

Create `public/js/alpine-components.js`:

```js
// Alpine.data() registrations.
//
// This file MUST load before the Alpine CDN tag in head.handlebars.
// Alpine's CDN build calls Alpine.start() inside a queueMicrotask that
// fires immediately after its own script tag — before the next deferred
// script — so an alpine:init listener registered later never runs.
//
// Unlike the character-* modules this is loaded from <head>, outside the
// hx-boost swap region, so it executes exactly once and can use const.
document.addEventListener('alpine:init', () => {
  // Components are registered here as they are converted.
});
```

- [ ] **Step 4: Add the script tags**

In `views/partials/head.handlebars`, replace the script block (lines 12-20) with:

```handlebars
  <!-- Core scripts needed on every page -->
  <script src="https://unpkg.com/htmx.org@2.0.8" integrity="sha384-/TgkGk7p307TH7EXJDuUlgG3Ce1UVolAOFopFekQkkXihi5u/6OCvVKyz1W+idaz" crossorigin="anonymous" defer></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" crossorigin="anonymous" defer></script>
  <script src="/js/app.js" defer></script>
  <script src="/js/alpine-components.js" defer></script>
  <!-- Alpine must load LAST: Alpine.start() fires in a microtask right
       after this tag, before any later deferred script, so anything
       calling Alpine.data() has to be registered above. -->
  <script src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.12/dist/cdn.min.js" integrity="sha384-pb6hrQvo4s23cEUFtj0CZkzGE3jyK3pj26RIupXXxhSrrcUA/Cn0lZgcCrGH0t6L" crossorigin="anonymous" defer></script>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      App.init("{{supabaseUrl}}", "{{supabaseKey}}");
    });
  </script>
```

- [ ] **Step 5: Add the `x-cloak` rule**

Append to `public/css/styles.css`:

```css
/* Alpine is deferred, so the browser can paint un-initialized markup
   before it runs. x-cloak hides those elements until Alpine strips the
   attribute during init. */
[x-cloak] { display: none !important; }
```

- [ ] **Step 6: Run the tests**

Run: `bun test views/partials/head.test.js && bun run check`
Expected: PASS.

- [ ] **Step 7: Verify in a browser**

```bash
bun run dev
```

Load any page and check the console:
- No 404 for `/js/alpine-components.js`.
- No SRI/integrity error for the Alpine script. An integrity failure means the hash and the pinned version disagree — **stop and re-derive**, do not delete the hash.
- `window.Alpine.version` in the console returns `3.15.12`.
- Navigate between two pages (boosted) — no console errors.

- [ ] **Step 8: Commit**

```bash
git add views/partials/head.handlebars views/partials/head.test.js public/js/alpine-components.js public/css/styles.css
git commit -m "$(cat <<'EOF'
feat: load Alpine.js 3.15.12 with SRI and an x-cloak guard (ar-7v3k)

Alpine loads last among the deferred scripts because its CDN build calls
Alpine.start() in a microtask that fires before the next deferred script
— any alpine:init registration has to be in place first, which is what
public/js/alpine-components.js is for.

Tests pin the CDN version to the installed devDependency so the jsdom
suite can never validate a different Alpine than production serves.

No components are converted yet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Neutralize the htmx settle clobber

htmx's settle phase copies the *old* node's `class`/`style` onto any incoming element that has an `id` and exists on both pages, then restores the response's values 20ms later. Alpine writes `style="display:none"` for `x-show` on a microtask in between, so settle **overwrites it** — and Alpine does not re-run, because `style` is not a directive and `x-show`'s effect only re-runs when its state changes. The element stays visibly wrong until state changes.

Setting `defaultSettleDelay: 0` makes `doSettle()` run synchronously in the same task as the swap, before Alpine's microtask, so Alpine initializes against final attributes.

**Files:**
- Modify: `views/partials/head.handlebars:4`
- Modify: `views/partials/head.test.js`

**Interfaces:**
- Consumes: the head partial from Task 4
- Produces: nothing

- [ ] **Step 1: Write the failing test**

Append to `views/partials/head.test.js`:

```js
test('htmx settle runs synchronously so it cannot clobber Alpine', () => {
  const meta = head().match(/<meta name="htmx-config" content='([^']+)'/);
  expect(meta).not.toBeNull();
  const config = JSON.parse(meta[1]);
  // Non-zero settle lets htmx overwrite class/style that x-show and
  // :class wrote on the intervening microtask. See the spec.
  expect(config.defaultSettleDelay).toBe(0);
  expect(config.includeIndicatorStyles).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test views/partials/head.test.js`
Expected: FAIL — `config.defaultSettleDelay` is `undefined`.

- [ ] **Step 3: Set the config**

Replace line 4 of `views/partials/head.handlebars`:

```handlebars
  <meta name="htmx-config" content='{"includeIndicatorStyles": false, "defaultSettleDelay": 0}'>
```

- [ ] **Step 4: Run the tests**

Run: `bun test views/partials/head.test.js && bun run check`
Expected: PASS.

- [ ] **Step 5: Verify the manual browser case**

This is the part jsdom cannot cover — there is no htmx in the harness, so the swap-then-settle sequence only exists in a real browser.

```bash
bun run dev
```

1. Load any page. Shrink the window until the navbar burger appears.
2. Click a nav link so htmx performs a **boosted** navigation.
3. Confirm the navbar menu is **closed** on the new page.

`#navbar-menu` is the canonical case: it carries an `id`, lives in the layout, and therefore persists across every boosted navigation. Before this change it would render **open**. If it still does, `defaultSettleDelay` is not being applied — check for a typo in the JSON, which htmx parses silently.

- [ ] **Step 6: Commit**

```bash
git add views/partials/head.handlebars views/partials/head.test.js
git commit -m "$(cat <<'EOF'
fix: set htmx defaultSettleDelay to 0 so settle cannot clobber Alpine (ar-7v3k)

htmx's settle phase copies the old node's class/style onto id-bearing
elements that exist on both pages, then restores the response values
20ms later — overwriting the style="display:none" that x-show wrote on
the intervening microtask. Alpine never re-runs, so the element stays
visibly wrong until its state changes.

At delay 0 doSettle() runs synchronously in the swap task, before
Alpine's mutation microtask, so Alpine initializes against final
attributes. Verified manually against #navbar-menu, which persists
across every boosted navigation.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Self-contained conversions

Pure local view state. No htmx request, `fetch`, or localStorage entanglement except where explicitly noted.

### Task 6: Convert the export dropdowns

Two identical inline toggles. Both must convert in this task, because Task 8 deletes the global handlers that currently serve them.

**Files:**
- Modify: `views/character.handlebars:161-166`
- Modify: `views/class-view.handlebars:34-40`
- Test: `views/character.test.js` (create)

**Interfaces:**
- Consumes: `render`, `tick`, `setupAlpine` from `test/helpers/alpine-dom.js`
- Produces: the dropdown markup pattern reused by Task 7

- [ ] **Step 1: Write the failing test**

Create `views/character.test.js`:

```js
const { test, expect, beforeAll } = require('bun:test');
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => { await setupAlpine(); });

const DROPDOWN = `
  <div class="dropdown is-right" id="export-dropdown"
       x-data="{ open: false }"
       :class="open && 'is-active'"
       @click.outside="open = false"
       @keydown.escape.window="open = false">
    <div class="dropdown-trigger">
      <button id="trigger" :aria-expanded="open" @click="open = !open"></button>
    </div>
  </div>
  <a href="#" id="outside">elsewhere</a>
`;

test('export dropdown starts closed', async () => {
  await render(DROPDOWN);
  const dd = document.getElementById('export-dropdown');
  expect(dd.classList.contains('is-active')).toBe(false);
  expect(document.getElementById('trigger').getAttribute('aria-expanded')).toBe('false');
});

test('clicking the trigger opens it and updates aria-expanded', async () => {
  await render(DROPDOWN);
  document.getElementById('trigger').click();
  await tick();
  expect(document.getElementById('export-dropdown').classList.contains('is-active')).toBe(true);
  expect(document.getElementById('trigger').getAttribute('aria-expanded')).toBe('true');
});

test('clicking the trigger again closes it', async () => {
  await render(DROPDOWN);
  const trigger = document.getElementById('trigger');
  trigger.click(); await tick();
  trigger.click(); await tick();
  expect(document.getElementById('export-dropdown').classList.contains('is-active')).toBe(false);
});

test('clicking outside closes it', async () => {
  await render(DROPDOWN);
  document.getElementById('trigger').click();
  await tick();
  document.getElementById('outside').click();
  await tick();
  expect(document.getElementById('export-dropdown').classList.contains('is-active')).toBe(false);
});

test('Escape closes it', async () => {
  await render(DROPDOWN);
  document.getElementById('trigger').click();
  await tick();
  window.dispatchEvent(new CustomEvent('keydown'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await tick();
  expect(document.getElementById('export-dropdown').classList.contains('is-active')).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test views/character.test.js`
Expected: FAIL. If the Escape test is the only failure, add `'KeyboardEvent'` to `GLOBAL_KEYS` in `test/helpers/alpine-dom.js` and re-run.

- [ ] **Step 3: Convert `views/character.handlebars`**

Replace lines 161-166:

```handlebars
        <div class="dropdown is-right" id="export-dropdown"
             x-data="{ open: false }"
             :class="open && 'is-active'"
             @click.outside="open = false"
             @keydown.escape.window="open = false">
          <div class="dropdown-trigger">
            <button class="button is-white" aria-haspopup="true" aria-controls="export-menu" :aria-expanded="open" @click="open = !open" title="Export">
              <span class="icon"><i class="fas fa-ellipsis-vertical"></i></span>
            </button>
          </div>
```

Leave lines 167-179 (the `dropdown-menu` and its export links) untouched.

- [ ] **Step 4: Convert `views/class-view.handlebars`**

Apply the identical pattern to the `#export-dropdown` at line 34-40: move `x-data`, `:class`, `@click.outside` and `@keydown.escape.window` onto the `.dropdown` element, and replace the button's `onclick` with `@click="open = !open"` plus `:aria-expanded="open"`.

- [ ] **Step 5: Verify no inline toggles remain**

```bash
grep -rn "export-dropdown').classList.toggle" views/
```

Expected: no output.

- [ ] **Step 6: Run the tests**

Run: `bun test && bun run check`
Expected: PASS.

- [ ] **Step 7: Verify in a browser**

On a character page and a class page: the export menu opens on click, closes on a second click, closes when clicking elsewhere, closes on Escape, and both export links still download.

- [ ] **Step 8: Commit**

```bash
git add views/character.handlebars views/class-view.handlebars views/character.test.js
git commit -m "$(cat <<'EOF'
refactor: convert export dropdowns to Alpine (ar-7v3k)

Both dropdowns carried the same inline onclick classList.toggle and
depended on two global document listeners in app.js for outside-click
and Escape. Open state is now local, and aria-expanded is bound rather
than left stale.

The global handlers still exist; they are removed in the task that
converts the navbar burger.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Convert the navbar burger

`#navbar-burger` and `#navbar-menu` are siblings' cousins — the burger is inside `.navbar-brand`, the menu is outside it — so the shared state has to live on `<nav>`.

**Files:**
- Modify: `views/partials/nav.handlebars:1-14`
- Test: `views/partials/nav.test.js` (create)

**Interfaces:**
- Consumes: `render`, `tick`, `setupAlpine`
- Produces: nothing

- [ ] **Step 1: Write the failing test**

Create `views/partials/nav.test.js`:

```js
const { test, expect, beforeAll } = require('bun:test');
const { setupAlpine, render, tick } = require('../../test/helpers/alpine-dom');

beforeAll(async () => { await setupAlpine(); });

const NAV = `
  <nav class="navbar is-dark" x-data="{ open: false }">
    <div class="navbar-brand">
      <button class="navbar-burger" id="navbar-burger"
              :class="open && 'is-active'" :aria-expanded="open"
              @click="open = !open"></button>
    </div>
    <div class="navbar-menu" id="navbar-menu" :class="open && 'is-active'"></div>
  </nav>
`;

test('burger and menu start closed', async () => {
  await render(NAV);
  expect(document.getElementById('navbar-burger').classList.contains('is-active')).toBe(false);
  expect(document.getElementById('navbar-menu').classList.contains('is-active')).toBe(false);
  expect(document.getElementById('navbar-burger').getAttribute('aria-expanded')).toBe('false');
});

test('clicking the burger opens both and sets aria-expanded', async () => {
  await render(NAV);
  document.getElementById('navbar-burger').click();
  await tick();
  expect(document.getElementById('navbar-burger').classList.contains('is-active')).toBe(true);
  expect(document.getElementById('navbar-menu').classList.contains('is-active')).toBe(true);
  expect(document.getElementById('navbar-burger').getAttribute('aria-expanded')).toBe('true');
});

test('clicking again closes both', async () => {
  await render(NAV);
  const burger = document.getElementById('navbar-burger');
  burger.click(); await tick();
  burger.click(); await tick();
  expect(burger.classList.contains('is-active')).toBe(false);
  expect(document.getElementById('navbar-menu').classList.contains('is-active')).toBe(false);
});

test('menu is closed again after a simulated boosted navigation', async () => {
  await render(NAV);
  document.getElementById('navbar-burger').click();
  await tick();
  // hx-boost replaces the body; a fresh nav must come back closed.
  await render(NAV);
  expect(document.getElementById('navbar-menu').classList.contains('is-active')).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test views/partials/nav.test.js`
Expected: FAIL.

- [ ] **Step 3: Convert the partial**

In `views/partials/nav.handlebars`, put the state on `<nav>` (line 1), rewrite the burger (line 6), and bind the menu (line 14):

```handlebars
<nav class="navbar is-dark" role="navigation" aria-label="main navigation" x-data="{ open: false }">
  <div class="navbar-brand">
    <a class="navbar-item" href="/">
      <strong>Agent Resources</strong>
    </a>
    <button class="navbar-burger" id="navbar-burger" role="button" aria-label="menu" :class="open && 'is-active'" :aria-expanded="open" @click="open = !open">
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
    </button>
  </div>

  <div class="navbar-menu" id="navbar-menu" :class="open && 'is-active'">
```

Leave the rest of the file unchanged.

- [ ] **Step 4: Run the tests**

Run: `bun test && bun run check`
Expected: PASS.

- [ ] **Step 5: Verify in a browser — this is the settle regression check**

Shrink the window until the burger shows. Open the menu, then click a nav link to trigger a **boosted** navigation. The menu must be **closed** on the new page. This is the exact scenario Task 5's config protects; if it renders open, `defaultSettleDelay` is not applying.

- [ ] **Step 6: Commit**

```bash
git add views/partials/nav.handlebars views/partials/nav.test.js
git commit -m "$(cat <<'EOF'
refactor: convert navbar burger to Alpine (ar-7v3k)

State moves to <nav> because the burger and the menu are in different
subtrees. Replaces a hx-on:click that hand-rolled htmx.toggleClass on
two elements plus an aria-expanded sync.

#navbar-menu is the canonical settle-clobber case — it carries an id and
persists across every boosted navigation — so this is also the manual
regression check for defaultSettleDelay: 0.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Delete the global dropdown handlers

Every `.dropdown` is now Alpine-driven, so the outside-click handler is dead and the Escape handler's dropdown half is dead. The Escape handler's **modal** half must survive until Task 19.

**Files:**
- Modify: `public/js/app.js:869-891`

**Interfaces:**
- Consumes: Tasks 6 and 7 having converted every dropdown
- Produces: `app.js` with only the modal half of the Escape handler remaining at ~869-876

- [ ] **Step 1: Prove no unconverted dropdown remains**

```bash
grep -rn "classList.toggle('is-active')\|toggleClass(.*'is-active')" views/
grep -rn "dropdown" views/ | grep -i "onclick\|hx-on"
```

Expected: no `.dropdown` toggles. `views/partials/nav-item.handlebars:5` uses Bulma's CSS-only `is-hoverable` and needs no JS — if it appears, that is fine. Anything else: **stop**, convert it first, or deleting the handler will break it.

- [ ] **Step 2: Replace the handler block**

In `public/js/app.js`, replace lines 869-891 with the modal-only Escape handler:

```js
      // Global keydown handler for closing modals on Escape.
      // Dropdowns handle their own Escape via @keydown.escape.window.
      document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
          const activeModal = document.querySelector('.modal.is-active');
          if (activeModal) {
            App.closeModal('#' + activeModal.id);
          }
        }
      });
```

This removes the `.dropdown.is-active` loop from the Escape handler and the entire outside-click listener.

- [ ] **Step 3: Run the tests**

Run: `bun test && bun run check`
Expected: PASS.

- [ ] **Step 4: Verify in a browser**

- Export dropdowns still close on outside-click and Escape (now via Alpine).
- The navbar burger still works.
- Open the deceased modal on a character edit page and press Escape — it still closes. This proves the modal half survived.

- [ ] **Step 5: Commit**

```bash
git add public/js/app.js
git commit -m "$(cat <<'EOF'
refactor: drop global dropdown handlers now that Alpine owns them (ar-7v3k)

Removes the document-level outside-click listener entirely and the
.dropdown.is-active loop from the Escape handler. Every dropdown now
declares @click.outside and @keydown.escape.window itself.

The modal half of the Escape handler stays until the modal conversion
replaces it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Convert the perk word counter

**Files:**
- Modify: `views/partials/character-ability-perk.handlebars:8-11`
- Test: `views/partials/character-ability-perk.test.js` (existing — extend)

**Interfaces:**
- Consumes: `renderPartial`, `tick`, `setupAlpine`
- Produces: nothing

The server seeds the count with `{{wordCount perk.text}}`; Alpine must produce the same number for the same text so the value does not jump on first input.

- [ ] **Step 1: Read the existing test and markup**

```bash
cat views/partials/character-ability-perk.test.js
sed -n '1,30p' views/partials/character-ability-perk.handlebars
```

Note the exact `wordCount` semantics used server-side (`util/handlebars`) so the client expression matches.

- [ ] **Step 2: Write the failing test**

Append to `views/partials/character-ability-perk.test.js`:

```js
const { setupAlpine, render, tick } = require('../../test/helpers/alpine-dom');

test('word count updates as the perk text changes', async () => {
  await setupAlpine();
  await render(`
    <div x-data="{ text: 'two words' }">
      <textarea x-model="text"></textarea>
      <span class="word-count"
            x-text="text.trim() ? text.trim().split(/\\s+/).length : 0"></span>
    </div>
  `);
  expect(document.querySelector('.word-count').textContent).toBe('2');

  const ta = document.querySelector('textarea');
  ta.value = 'now there are four words';
  ta.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.querySelector('.word-count').textContent).toBe('5');
});

test('word count is 0 for empty and whitespace-only text', async () => {
  await setupAlpine();
  await render(`
    <div x-data="{ text: '   ' }">
      <span class="word-count"
            x-text="text.trim() ? text.trim().split(/\\s+/).length : 0"></span>
    </div>
  `);
  expect(document.querySelector('.word-count').textContent).toBe('0');
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `bun test views/partials/character-ability-perk.test.js`
Expected: the two new tests FAIL; the existing ones still pass.

- [ ] **Step 4: Convert the markup**

Wrap the textarea and its count span in an `x-data` seeded from the server value, replacing the `oninput` at line 9:

```handlebars
<div x-data="{ text: {{{json perk.text}}} || '' }">
  <textarea class="textarea" name="perk_text[]" x-model="text"></textarea>
  <p class="help">
    <span class="word-count" x-text="text.trim() ? text.trim().split(/\s+/).length : 0">{{wordCount perk.text}}</span> words
  </p>
</div>
```

Keep every existing class, `name`, and attribute on the textarea — the form posts these arrays positionally. Keep the server-rendered `{{wordCount perk.text}}` as the element's inner text so the count is correct before Alpine initializes.

- [ ] **Step 5: Run the tests**

Run: `bun test && bun run check`
Expected: PASS.

- [ ] **Step 6: Verify in a browser**

On a character form with perks: the count matches the server value on load, updates while typing, and the form still saves perk text correctly.

- [ ] **Step 7: Commit**

```bash
git add views/partials/character-ability-perk.handlebars views/partials/character-ability-perk.test.js
git commit -m "$(cat <<'EOF'
refactor: convert perk word counter to Alpine (ar-7v3k)

Replaces an inline oninput that reached through nextElementSibling to
find its own count span. The server-rendered {{wordCount}} stays as the
pre-init value so the number does not jump on first keystroke.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Convert the type-to-confirm gate

**Files:**
- Modify: `views/character-form.handlebars:421-435, 439`
- Test: `views/character-form.test.js` (from Task 2 — extend)

**Interfaces:**
- Consumes: `render`, `tick`, `setupAlpine`
- Produces: a `confirmName` state variable that Task 15 keeps when it converts the surrounding modal

- [ ] **Step 1: Write the failing test**

Append to `views/character-form.test.js`:

```js
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test views/character-form.test.js`
Expected: the four new tests FAIL.

- [ ] **Step 3: Convert the markup**

Put the state on the `<form>` at line 415 so both the input and the footer button share it — **keep every `hx-*` attribute exactly as-is**:

```handlebars
    <form hx-post="/characters/{{character.id}}/deceased" hx-indicator="#deceased-submit"
          x-data="{ typed: '', required: {{{json character.name}}} }">
```

Replace the input (lines 424-433):

```handlebars
            <input
              class="input"
              type="text"
              name="confirmName"
              placeholder="Type character name to confirm"
              autocomplete="off"
              x-model="typed"
              required
            >
```

Replace the submit button (line 439):

```handlebars
        <button id="deceased-submit" type="submit" class="button is-dark" :disabled="typed !== required">
```

The `data-confirm-name` attribute and the `disabled` literal both go away — `:disabled` supplies the initial state.

- [ ] **Step 4: Run the tests**

Run: `bun test && bun run check`
Expected: PASS.

- [ ] **Step 5: Verify in a browser**

Open the deceased modal on a character with an apostrophe or accent in its name if one exists (this is why `{{{json ...}}}` is used rather than a quoted attribute). Typing the exact name enables the button; anything else disables it; submitting still posts.

- [ ] **Step 6: Commit**

```bash
git add views/character-form.handlebars views/character-form.test.js
git commit -m "$(cat <<'EOF'
refactor: convert deceased type-to-confirm gate to Alpine (ar-7v3k)

Replaces an inline oninput that reached across the DOM by id and read
its comparison value out of a data attribute. The required name is now
JSON-encoded into state, which also fixes names containing quotes.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Convert the show/hide field dependencies

Four small, independent toggles, grouped because each is a two-line change with the same shape.

**Files:**
- Modify: `views/partials/lfg-form.handlebars:29`
- Modify: `views/partials/lfg-join-form.handlebars:10,14`
- Modify: `views/partials/offscreen-mission-form.handlebars:32`
- Modify: `views/lfg-post.handlebars:31,36,92`
- Test: `views/partials/lfg-form.test.js` (create)

**Interfaces:**
- Consumes: `render`, `tick`, `setupAlpine`
- Produces: nothing

`views/lfg-post.handlebars:22` (the lazy `htmx.trigger(t,'revealed')` join-requests reveal) is **excluded** — it is entangled with a lazy htmx load and belongs to Phase 4.

- [ ] **Step 1: Read each current mechanism**

```bash
sed -n '25,35p' views/partials/lfg-form.handlebars
sed -n '5,20p'  views/partials/lfg-join-form.handlebars
sed -n '28,38p' views/partials/offscreen-mission-form.handlebars
sed -n '28,40p;88,102p' views/lfg-post.handlebars
```

Record which element each control shows/hides and whether it starts visible.

- [ ] **Step 2: Write the failing test**

Create `views/partials/lfg-form.test.js`:

```js
const { test, expect, beforeAll } = require('bun:test');
const { setupAlpine, render, tick } = require('../../test/helpers/alpine-dom');

beforeAll(async () => { await setupAlpine(); });

test('checkbox reveals the character select', async () => {
  await render(`
    <div x-data="{ bringing: false }">
      <input type="checkbox" id="toggle" x-model="bringing">
      <div id="character-select" x-show="bringing" x-cloak></div>
    </div>
  `);
  const panel = document.getElementById('character-select');
  expect(panel.style.display).toBe('none');

  document.getElementById('toggle').click();
  await tick();
  expect(panel.style.display).not.toBe('none');
});

test('radio selection switches which panel is visible', async () => {
  await render(`
    <div x-data="{ mode: 'existing' }">
      <input type="radio" id="r-existing" value="existing" x-model="mode">
      <input type="radio" id="r-new" value="new" x-model="mode">
      <div id="pick" x-show="mode === 'existing'"></div>
      <div id="create" x-show="mode === 'new'"></div>
    </div>
  `);
  expect(document.getElementById('pick').style.display).not.toBe('none');
  expect(document.getElementById('create').style.display).toBe('none');

  document.getElementById('r-new').click();
  await tick();
  expect(document.getElementById('pick').style.display).toBe('none');
  expect(document.getElementById('create').style.display).not.toBe('none');
});

test('select reveals the other-text field only for __other__', async () => {
  await render(`
    <div x-data="{ choice: 'a' }">
      <select id="choice" x-model="choice">
        <option value="a">A</option>
        <option value="__other__">Other</option>
      </select>
      <input id="other" x-show="choice === '__other__'">
    </div>
  `);
  expect(document.getElementById('other').style.display).toBe('none');

  const select = document.getElementById('choice');
  select.value = '__other__';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  expect(document.getElementById('other').style.display).not.toBe('none');
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `bun test views/partials/lfg-form.test.js`
Expected: FAIL.

- [ ] **Step 4: Convert each site**

For each, put `x-data` on the nearest element containing both the control and its target, bind the control with `x-model`, and replace the class/style toggling with `x-show`. Add `x-cloak` to anything that starts hidden so it cannot flash before Alpine initializes.

- `lfg-form.handlebars`: checkbox → `x-model`, `#character-select` → `x-show`, remove the `hx-on:click`.
- `lfg-join-form.handlebars`: both radios → `x-model` on a shared variable, `#character-select` → `x-show`, remove both `hx-on:` handlers.
- `offscreen-mission-form.handlebars`: select → `x-model`, "other" text field → `x-show="… === '__other__'"`, remove the `onchange`.
- `lfg-post.handlebars:31,36`: the mutually-exclusive `#calendar-buttons` / `#calendar-buttons-show` pair becomes one boolean with two `x-show`s.
- `lfg-post.handlebars:92`: per-participant `#character-details-{{character.id}}` becomes a local `x-data="{ open: false }"` on the row with `x-show` on the details block. Because it is inside a loop, keep the state on the row element rather than a shared variable.

**Do not touch `lfg-post.handlebars:22`.**

- [ ] **Step 5: Confirm nothing was missed and nothing extra was taken**

```bash
grep -n "is-hidden" views/lfg-post.handlebars
grep -rn "hx-on:click\|onchange" views/partials/lfg-form.handlebars views/partials/lfg-join-form.handlebars views/partials/offscreen-mission-form.handlebars
```

Expected: line 22 of `lfg-post.handlebars` still uses `is-hidden`; the three partials have no remaining inline visibility handlers.

- [ ] **Step 6: Run the tests**

Run: `bun test && bun run check`
Expected: PASS.

- [ ] **Step 7: Verify in a browser**

LFG post page and the LFG form: the character select appears/disappears, the join-form radios switch panels, the offscreen "other" field appears only for `__other__`, calendar buttons toggle, participant details expand. The join-requests "Show/Hide" button (line 22) still lazy-loads.

- [ ] **Step 8: Commit**

```bash
git add views/partials/lfg-form.handlebars views/partials/lfg-join-form.handlebars views/partials/offscreen-mission-form.handlebars views/lfg-post.handlebars views/partials/lfg-form.test.js
git commit -m "$(cat <<'EOF'
refactor: convert form field-dependency toggles to Alpine (ar-7v3k)

Replaces four inline visibility handlers (hx-on:click, onchange, and two
mutually-exclusive is-hidden pairs) with x-model + x-show. Elements that
start hidden gain x-cloak so they cannot flash before Alpine boots.

Leaves lfg-post.handlebars:22 alone — its toggle also drives a lazy htmx
load and belongs with the entangled conversions.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Convert the stats editor and delete `character-stats.js`

The largest Phase 2 item. All 108 lines of `public/js/character-stats.js` become one `Alpine.data()` component.

**The save stays a `fetch`.** `PATCH /characters/:id/stats` (`routes/characters.js:928-939`) responds `res.json({ character })`, not HTML, so `hx-patch` would try to swap a JSON body into the DOM. Converting it would require changing the route, which this plan forbids.

**Files:**
- Modify: `public/js/alpine-components.js`
- Modify: `views/character.handlebars:187-225`
- Modify: `views/partials/character-stats-editor.handlebars`
- Modify: `views/character.handlebars:407-409` (script tags)
- Delete: `public/js/character-stats.js`
- Test: `views/partials/character-stats-editor.test.js` (create)

**Interfaces:**
- Consumes: `CharacterCommon.getAuthHeader()` from `public/js/character-common.js:45`; `renderPartial`, `render`, `tick`, `setupAlpine`
- Produces: `Alpine.data('characterStats', (characterId, initialStats) => ({ … }))` with public members `editing`, `saving`, `error`, `stats`, `total`, `edit()`, `cancel()`, `save()`

- [ ] **Step 1: Write the failing test**

Create `views/partials/character-stats-editor.test.js`:

```js
const { test, expect, beforeAll } = require('bun:test');
const { setupAlpine, render, tick } = require('../../test/helpers/alpine-dom');

const STATS = { vitality: 3, might: 2, resilience: 1 };

const mount = (stats) => render(`
  <div x-data="characterStats('char-1', ${JSON.stringify(stats)})">
    <button id="edit" x-show="!editing" @click="edit()"></button>
    <div id="readonly" x-show="!editing"></div>
    <form id="editor" x-show="editing" @submit.prevent="save()">
      <input class="stats-input" type="number" x-model.number="stats.vitality">
      <input class="stats-input" type="number" x-model.number="stats.might">
      <input class="stats-input" type="number" x-model.number="stats.resilience">
      <strong id="statsTotalSum" x-text="total"></strong>
      <button id="cancel" type="button" @click="cancel()"></button>
      <button id="save" type="submit" :disabled="saving"></button>
    </form>
    <div id="err" x-show="error" x-text="error"></div>
  </div>
`);

beforeAll(async () => {
  await setupAlpine();
  globalThis.CharacterCommon = { getAuthHeader: () => ({}) };
  require('../../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

test('starts in read-only mode with the editor hidden', async () => {
  await mount(STATS);
  expect(document.getElementById('editor').style.display).toBe('none');
  expect(document.getElementById('readonly').style.display).not.toBe('none');
});

test('Edit reveals the editor and hides the read-only grid', async () => {
  await mount(STATS);
  document.getElementById('edit').click();
  await tick();
  expect(document.getElementById('editor').style.display).not.toBe('none');
  expect(document.getElementById('readonly').style.display).toBe('none');
});

test('total sums the seeded stats', async () => {
  await mount(STATS);
  expect(document.getElementById('statsTotalSum').textContent).toBe('6');
});

test('total recomputes as inputs change', async () => {
  await mount(STATS);
  document.getElementById('edit').click();
  await tick();
  const input = document.querySelector('.stats-input');
  input.value = '10';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('statsTotalSum').textContent).toBe('13');
});

test('Cancel restores the original values and exits edit mode', async () => {
  await mount(STATS);
  document.getElementById('edit').click();
  await tick();
  const input = document.querySelector('.stats-input');
  input.value = '19';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();

  document.getElementById('cancel').click();
  await tick();
  expect(document.getElementById('editor').style.display).toBe('none');
  expect(document.getElementById('statsTotalSum').textContent).toBe('6');
});

test('save PATCHes clamped integers to the stats endpoint', async () => {
  await mount(STATS);
  let captured = null;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, json: async () => ({ character: {} }) };
  };
  // window.location.reload is a no-op stub so the test can assert the request.
  let reloaded = false;
  globalThis.__reload = () => { reloaded = true; };

  document.getElementById('edit').click();
  await tick();
  const input = document.querySelector('.stats-input');
  input.value = '99';                       // above the 0-20 range
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();

  document.getElementById('editor').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true })
  );
  await tick();
  await tick();

  expect(captured.url).toBe('/characters/char-1/stats');
  expect(captured.options.method).toBe('PATCH');
  expect(JSON.parse(captured.options.body).vitality).toBe(20);
  expect(reloaded).toBe(true);
});

test('save surfaces a server error and re-enables the button', async () => {
  await mount(STATS);
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => 'Forbidden' });

  document.getElementById('edit').click();
  await tick();
  document.getElementById('editor').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true })
  );
  await tick();
  await tick();

  expect(document.getElementById('err').textContent).toContain('Forbidden');
  expect(document.getElementById('save').disabled).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test views/partials/character-stats-editor.test.js`
Expected: FAIL — `characterStats` is not a registered Alpine component.

- [ ] **Step 3: Register the component**

Add to `public/js/alpine-components.js` inside the `alpine:init` listener:

```js
  // Inline stats editor on the character show page. Replaces
  // public/js/character-stats.js.
  //
  // The save stays a fetch rather than becoming hx-patch: the endpoint
  // responds with JSON, so htmx would try to swap a JSON body into the
  // DOM. Changing the route is out of scope.
  Alpine.data('characterStats', (characterId, initialStats) => ({
    editing: false,
    saving: false,
    error: '',
    stats: Object.assign({}, initialStats),

    get total() {
      return Object.values(this.stats)
        .reduce((sum, value) => sum + (parseInt(value, 10) || 0), 0);
    },

    edit() {
      this.error = '';
      this.editing = true;
      this.$nextTick(() => {
        const first = this.$el.querySelector('.stats-input');
        if (first) first.focus();
      });
    },

    cancel() {
      this.error = '';
      this.editing = false;
      this.stats = Object.assign({}, initialStats);
    },

    save() {
      this.error = '';
      this.saving = true;

      // Coerce to integers and clamp to [0, 20], matching the range the
      // old module enforced before PATCHing.
      const payload = {};
      Object.keys(this.stats).forEach((stat) => {
        let n = parseInt(this.stats[stat], 10);
        if (isNaN(n) || n < 0) n = 0;
        if (n > 20) n = 20;
        payload[stat] = n;
      });

      return fetch('/characters/' + encodeURIComponent(characterId) + '/stats', {
        method: 'PATCH',
        headers: Object.assign(CharacterCommon.getAuthHeader(), {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify(payload)
      }).then((res) => {
        if (!res.ok) {
          return res.text().then((text) => {
            throw new Error(text || ('HTTP ' + res.status));
          });
        }
        (globalThis.__reload || (() => window.location.reload()))();
      }).catch((err) => {
        this.error = 'Save failed: ' + ((err && err.message) || 'Unknown error');
      }).finally(() => {
        this.saving = false;
      });
    }
  }));
```

- [ ] **Step 4: Convert the markup**

In `views/character.handlebars`, put the component on `#statsBox` (line 187), seeding state from the server-rendered values:

```handlebars
    <div class="box" id="statsBox" data-character-id="{{character.id}}" data-character-name="{{character.name}}" data-character-level="{{character.level}}"
         x-data="characterStats({{{json character.id}}}, { {{#each statList}}{{#unless @first}}, {{/unless}}{{this}}: {{lookup ../character this}}{{/each}} })">
```

Change the Edit button (line 195) to `x-show="!editing"` + `@click="edit()"`, the read-only grid (line 203) to `x-show="!editing"`, and the editor wrapper (line 222) from `hidden` to `x-show="editing" x-cloak`.

In `views/partials/character-stats-editor.handlebars`: bind the total span (line 3) with `x-text="total"`, give each of the 12 inputs `x-model.number="stats.{{this}}"`, wire `@submit.prevent="save()"` on the form, `@click="cancel()"` on the Cancel button, `:disabled="saving"` and `:class="saving && 'is-loading'"` on Save, and replace `#statsEditorError` with `x-show="error" x-text="error"`.

- [ ] **Step 5: Delete the old module and its script tag**

```bash
git rm public/js/character-stats.js
```

Remove line 408 (`<script src="/js/character-stats.js" defer></script>`) from `views/character.handlebars`. **Keep** lines 407 (`character-common.js`) and 409 (`character-level-up.js`) — the component calls `CharacterCommon.getAuthHeader()`, and level-up is out of scope.

- [ ] **Step 6: Confirm nothing still references it**

```bash
grep -rn "character-stats.js\|CharacterStats" views/ public/js/
```

Expected: no output.

- [ ] **Step 7: Run the tests**

Run: `bun test && bun run check`
Expected: PASS.

- [ ] **Step 8: Verify in a browser**

On your own character: Edit reveals the 12 inputs and focuses the first; the total updates live; Cancel restores the original values; Save persists and reloads. Then open a character you do **not** own and confirm the Edit button is absent (the `{{#if (eq character.creator_id profile.id)}}` guard at line 193 is unchanged).

- [ ] **Step 9: Commit**

```bash
git add public/js/alpine-components.js views/character.handlebars views/partials/character-stats-editor.handlebars views/partials/character-stats-editor.test.js
git rm --cached public/js/character-stats.js 2>/dev/null; git add -A public/js
git commit -m "$(cat <<'EOF'
refactor: convert stats editor to Alpine and delete character-stats.js (ar-7v3k)

All 108 lines become one Alpine.data component: visibility toggle, live
12-stat total, cancel-restores-original, and save with loading and error
states.

The save stays a fetch. PATCH /characters/:id/stats responds with JSON,
so hx-patch would swap a JSON body into the DOM; changing the route is
out of scope for this refactor.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Convert the mission-list filter

**Files:**
- Modify: `views/mission-list.handlebars:15, 43, 72, 150, 189-225`
- Test: `views/mission-list.test.js` (create)

**Interfaces:**
- Consumes: `render`, `tick`, `setupAlpine`
- Produces: nothing

Note there are **two** tables of `.mission-row` (around lines 72 and 150) driven by the same four filter inputs. Both must stay filtered.

- [ ] **Step 1: Read the current implementation**

```bash
sed -n '189,225p' views/mission-list.handlebars
```

Record the exact `data-*` attributes each row carries and which are substring vs exact matches: name/characters/conduit are lowercased substring matches; outcome is exact.

- [ ] **Step 2: Write the failing test**

Create `views/mission-list.test.js`:

```js
const { test, expect, beforeAll } = require('bun:test');
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => { await setupAlpine(); });

const LIST = `
  <div x-data="{ name: '', character: '', conduit: '', outcome: '',
                 match(row) {
                   const d = row.dataset;
                   return (!this.name || (d.name || '').toLowerCase().includes(this.name.toLowerCase()))
                     && (!this.character || (d.characters || '').toLowerCase().includes(this.character.toLowerCase()))
                     && (!this.conduit || (d.conduit || '').toLowerCase().includes(this.conduit.toLowerCase()))
                     && (!this.outcome || d.outcome === this.outcome);
                 } }">
    <input id="filterName" x-model="name">
    <select id="filterOutcome" x-model="outcome">
      <option value="">All</option>
      <option value="success">Success</option>
    </select>
    <tr class="mission-row" id="r1" data-name="Silent Harbor" data-characters="vex" data-conduit="mara" data-outcome="success"
        x-show="match($el)"></tr>
    <tr class="mission-row" id="r2" data-name="Ashfall" data-characters="juno" data-conduit="mara" data-outcome="failure"
        x-show="match($el)"></tr>
  </div>
`;

test('all rows visible with empty filters', async () => {
  await render(LIST);
  expect(document.getElementById('r1').style.display).not.toBe('none');
  expect(document.getElementById('r2').style.display).not.toBe('none');
});

test('name filter matches case-insensitively on a substring', async () => {
  await render(LIST);
  const input = document.getElementById('filterName');
  input.value = 'harb';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('r1').style.display).not.toBe('none');
  expect(document.getElementById('r2').style.display).toBe('none');
});

test('outcome filter matches exactly', async () => {
  await render(LIST);
  const select = document.getElementById('filterOutcome');
  select.value = 'success';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  expect(document.getElementById('r1').style.display).not.toBe('none');
  expect(document.getElementById('r2').style.display).toBe('none');
});

test('filters combine', async () => {
  await render(LIST);
  const input = document.getElementById('filterName');
  input.value = 'ashfall';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const select = document.getElementById('filterOutcome');
  select.value = 'success';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  expect(document.getElementById('r1').style.display).toBe('none');
  expect(document.getElementById('r2').style.display).toBe('none');
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `bun test views/mission-list.test.js`
Expected: FAIL.

- [ ] **Step 4: Convert**

Put `x-data` with the four filter variables and the `match(row)` method on the element wrapping both the inputs and both tables. Bind each input with `x-model` (use `x-model.debounce.150ms` on the three text inputs to preserve the current 150ms debounce; the select stays immediate). Give every `.mission-row` in **both** tables `x-show="match($el)"`. Delete the entire `<script>` block at 189-225.

Keep every `data-*` attribute on the rows — they are the filter's data source.

- [ ] **Step 5: Run the tests**

Run: `bun test && bun run check`
Expected: PASS.

- [ ] **Step 6: Verify in a browser**

On the mission list: each filter narrows both tables, typing feels debounced, clearing restores everything, and the outcome select filters exactly.

- [ ] **Step 7: Commit**

```bash
git add views/mission-list.handlebars views/mission-list.test.js
git commit -m "$(cat <<'EOF'
refactor: convert mission-list filtering to Alpine (ar-7v3k)

Replaces a 37-line inline script that hand-rolled a setTimeout debounce
and wrote row.style.display directly. x-model.debounce keeps the 150ms
behavior; both mission tables filter from the same state.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Convert the character-list sorter

**Files:**
- Modify: `views/character-list.handlebars:54-102`
- Test: `views/character-list.test.js` (create)

**Interfaces:**
- Consumes: `render`, `tick`, `setupAlpine`
- Produces: nothing

The current script is a generic sorter over `table[data-sortable]` reading `th[data-sort-key]` / `data-sort-type`, comparing `cell.dataset.sortValue ?? cell.textContent` with numeric coercion, re-appending rows, and injecting `⇅` / `▲` / `▼` indicators.

- [ ] **Step 1: Read the current implementation**

```bash
sed -n '54,102p' views/character-list.handlebars
```

Record the exact indicator glyphs and the numeric-coercion rule so behavior is preserved.

- [ ] **Step 2: Write the failing test**

Create `views/character-list.test.js`:

```js
const { test, expect, beforeAll } = require('bun:test');
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => { await setupAlpine(); });

const order = () => Array.from(document.querySelectorAll('tbody tr'))
  .map(tr => tr.id);

const TABLE = `
  <table x-data="sortableTable()">
    <thead>
      <tr>
        <th id="h-name" @click="sortBy('name', 'text')">
          Name <span class="sort-indicator" x-text="indicator('name')"></span>
        </th>
        <th id="h-level" @click="sortBy('level', 'number')">
          Level <span class="sort-indicator" x-text="indicator('level')"></span>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr id="r-b"><td data-sort-value="Brannigan">Brannigan</td><td data-sort-value="10">10</td></tr>
      <tr id="r-a"><td data-sort-value="Ashe">Ashe</td><td data-sort-value="2">2</td></tr>
      <tr id="r-c"><td data-sort-value="Caul">Caul</td><td data-sort-value="7">7</td></tr>
    </tbody>
  </table>
`;

test('rows keep their server order before any sort', async () => {
  await render(TABLE);
  expect(order()).toEqual(['r-b', 'r-a', 'r-c']);
});

test('clicking a text header sorts ascending', async () => {
  await render(TABLE);
  document.getElementById('h-name').click();
  await tick();
  expect(order()).toEqual(['r-a', 'r-b', 'r-c']);
});

test('clicking the same header again reverses the order', async () => {
  await render(TABLE);
  document.getElementById('h-name').click();
  await tick();
  document.getElementById('h-name').click();
  await tick();
  expect(order()).toEqual(['r-c', 'r-b', 'r-a']);
});

test('numeric columns sort numerically, not lexically', async () => {
  await render(TABLE);
  document.getElementById('h-level').click();
  await tick();
  expect(order()).toEqual(['r-a', 'r-c', 'r-b']);
});

test('indicators show direction on the active column only', async () => {
  await render(TABLE);
  document.getElementById('h-name').click();
  await tick();
  const [name, level] = document.querySelectorAll('.sort-indicator');
  expect(name.textContent).toBe('▲');
  expect(level.textContent).toBe('⇅');

  document.getElementById('h-name').click();
  await tick();
  expect(document.querySelectorAll('.sort-indicator')[0].textContent).toBe('▼');
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `bun test views/character-list.test.js`
Expected: FAIL — `sortableTable` is not registered.

- [ ] **Step 4: Register the component**

Add to `public/js/alpine-components.js` inside the `alpine:init` listener:

```js
  // Click-to-sort table. Replaces the inline script in
  // views/character-list.handlebars.
  Alpine.data('sortableTable', () => ({
    key: null,
    dir: 1,

    indicator(key) {
      if (this.key !== key) return '⇅';
      return this.dir === 1 ? '▲' : '▼';
    },

    sortBy(key, type) {
      this.dir = this.key === key ? -this.dir : 1;
      this.key = key;

      const index = Array.from(this.$el.querySelectorAll('thead th'))
        .findIndex((th) => th.textContent.trim().startsWith(
          th.textContent.trim().split(/\s+/)[0]
        ) && th === this.$el.querySelector(`thead th:nth-child(${
          Array.from(this.$el.querySelectorAll('thead th')).indexOf(th) + 1
        })`));

      const columns = Array.from(this.$el.querySelectorAll('thead th'));
      const col = columns.findIndex((th) => th.contains(
        th.querySelector('.sort-indicator')
      ) && th.getAttribute('data-sort-key') === key);
      const colIndex = col > -1 ? col : columns.indexOf(this.$event.currentTarget);

      const body = this.$el.querySelector('tbody');
      const rows = Array.from(body.querySelectorAll('tr'));

      const valueOf = (row) => {
        const cell = row.children[colIndex];
        if (!cell) return '';
        return cell.dataset.sortValue !== undefined
          ? cell.dataset.sortValue
          : cell.textContent.trim();
      };

      rows.sort((a, b) => {
        const av = valueOf(a);
        const bv = valueOf(b);
        if (type === 'number') {
          return ((parseFloat(av) || 0) - (parseFloat(bv) || 0)) * this.dir;
        }
        return av.localeCompare(bv) * this.dir;
      });

      rows.forEach((row) => body.appendChild(row));
    }
  }));
```

Simplify the column-index derivation to the straightforward form — add `data-sort-key` to each `<th>` in the markup and resolve the index with:

```js
      const columns = Array.from(this.$el.querySelectorAll('thead th'));
      const colIndex = columns.findIndex((th) => th.dataset.sortKey === key);
```

Use that version; it replaces the two tangled `findIndex` blocks above.

- [ ] **Step 5: Convert the markup**

Put `x-data="sortableTable()"` on the table, give each sortable `<th>` a `data-sort-key` and `@click="sortBy('<key>', '<type>')"`, add a `<span class="sort-indicator" x-text="indicator('<key>')"></span>` inside each, and delete the inline script at 54-102. Keep every `data-sort-value` on the cells.

- [ ] **Step 6: Run the tests**

Run: `bun test && bun run check`
Expected: PASS.

- [ ] **Step 7: Verify in a browser**

On the character list: each header sorts, clicking again reverses, indicators track the active column, and the level column sorts 2/7/10 rather than 10/2/7.

- [ ] **Step 8: Commit**

```bash
git add views/character-list.handlebars public/js/alpine-components.js views/character-list.test.js
git commit -m "$(cat <<'EOF'
refactor: convert character-list sorting to Alpine (ar-7v3k)

Replaces a 49-line inline script that injected indicator spans and
tracked active column/direction in closure variables. Numeric columns
still coerce with parseFloat so levels sort 2/7/10, not lexically.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Convert the slug autogenerator

**Files:**
- Modify: `views/page-form.handlebars:87-129`
- Test: `views/page-form.test.js` (create)

**Interfaces:**
- Consumes: `render`, `tick`, `setupAlpine`
- Produces: nothing

The behavior to preserve: typing a title fills the slug **only** while the slug is still auto-generated; typing directly in the slug marks it manual and stops the sync; on load, the flag is derived by re-slugifying the title and comparing.

- [ ] **Step 1: Read the current implementation**

```bash
sed -n '87,129p' views/page-form.handlebars
```

Record the exact slugify rule (lowercase, strip non-word, collapse spaces/dashes, trim dashes).

- [ ] **Step 2: Write the failing test**

Create `views/page-form.test.js`:

```js
const { test, expect, beforeAll } = require('bun:test');
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => { await setupAlpine(); });

const FORM = (title, slug) => `
  <div x-data="pageSlug(${JSON.stringify(title)}, ${JSON.stringify(slug)})">
    <input id="title" x-model="title" @input="onTitle()">
    <input id="slug" x-model="slug" @input="auto = false">
  </div>
`;

test('slug follows the title for a new page', async () => {
  await render(FORM('', ''));
  const title = document.getElementById('title');
  title.value = 'The Silent Harbor';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('slug').value).toBe('the-silent-harbor');
});

test('punctuation is stripped and spaces collapse to single dashes', async () => {
  await render(FORM('', ''));
  const title = document.getElementById('title');
  title.value = "  Vex's   Last!! Stand  ";
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('slug').value).toBe('vexs-last-stand');
});

test('editing the slug stops it following the title', async () => {
  await render(FORM('', ''));
  const slug = document.getElementById('slug');
  slug.value = 'custom-slug';
  slug.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();

  const title = document.getElementById('title');
  title.value = 'Some New Title';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('slug').value).toBe('custom-slug');
});

test('an existing page whose slug was hand-written is left alone', async () => {
  await render(FORM('Original Title', 'hand-written'));
  const title = document.getElementById('title');
  title.value = 'Changed Title';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('slug').value).toBe('hand-written');
});

test('an existing page whose slug still matches its title keeps syncing', async () => {
  await render(FORM('Original Title', 'original-title'));
  const title = document.getElementById('title');
  title.value = 'Changed Title';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('slug').value).toBe('changed-title');
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `bun test views/page-form.test.js`
Expected: FAIL — `pageSlug` is not registered.

- [ ] **Step 4: Register the component**

Add to `public/js/alpine-components.js` inside the `alpine:init` listener:

```js
  // Title -> slug sync for the page editor. Stops as soon as the slug is
  // edited by hand. On load, a slug that still matches its title is
  // treated as auto-generated so it keeps following.
  Alpine.data('pageSlug', (initialTitle, initialSlug) => ({
    title: initialTitle || '',
    slug: initialSlug || '',
    auto: !initialSlug || initialSlug === slugify(initialTitle || ''),

    onTitle() {
      if (this.auto) this.slug = slugify(this.title);
    }
  }));
```

and above the `alpine:init` listener, at file scope:

```js
// Matches the slug rule the page editor used inline: lowercase, strip
// anything that is not a word character or space, collapse runs of
// spaces and dashes, trim leading/trailing dashes.
const slugify = (value) => (value || '')
  .toLowerCase()
  .replace(/[^\w\s-]/g, '')
  .replace(/[\s_-]+/g, '-')
  .replace(/^-+|-+$/g, '');
```

- [ ] **Step 5: Convert the markup**

Put `x-data="pageSlug({{{json page.title}}}, {{{json page.slug}}})"` on the form, bind the title input with `x-model="title" @input="onTitle()"`, bind the slug input with `x-model="slug" @input="auto = false"`, and delete the script at 87-129. Keep both inputs' `name` attributes so the form still posts.

- [ ] **Step 6: Run the tests**

Run: `bun test && bun run check`
Expected: PASS.

- [ ] **Step 7: Verify in a browser**

New page: typing a title fills the slug. Edit the slug, then keep typing the title — the slug stays put. Reopen an existing page and confirm its slug does not get rewritten on load.

- [ ] **Step 8: Commit**

```bash
git add views/page-form.handlebars public/js/alpine-components.js views/page-form.test.js
git commit -m "$(cat <<'EOF'
refactor: convert page slug autogeneration to Alpine (ar-7v3k)

Replaces a 43-line inline script that tracked "was this auto-generated"
in a data attribute and re-derived it on load. Same slug rule, same
stop-on-manual-edit behavior, now unit-tested.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Modals

Five modal ids convert to a single shared component driven by window events. `#historyModal` was deleted in Task 1; `#restoreDraftModal` is deferred to Phase 4.

### Task 16: Build the modal component and convert `#deceased-modal`

**Files:**
- Modify: `public/js/alpine-components.js`
- Modify: `views/character-form.handlebars:389, 406-448`
- Test: `views/partials/modal.test.js` (create)

**Interfaces:**
- Consumes: `render`, `tick`, `setupAlpine`
- Produces: `Alpine.data('modal', (name) => ({ show, open(), close() }))`, and the window events `open-modal` / `close-modal` carrying `detail: '<name>'`. **Tasks 17-19 all depend on these exact event names and this signature.**

Bulma's modal needs `is-active` on the modal element and `modal-open` on `<body>`; the component owns both, replacing what `App.openModal`/`closeModal` did.

- [ ] **Step 1: Write the failing test**

Create `views/partials/modal.test.js`:

```js
const { test, expect, beforeAll } = require('bun:test');
const { setupAlpine, render, tick } = require('../../test/helpers/alpine-dom');

beforeAll(async () => {
  await setupAlpine();
  require('../../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
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
});

test('Escape closes it', async () => {
  await render(MODAL);
  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'demo' }));
  await tick();
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await tick();
  expect(document.getElementById('m').classList.contains('is-active')).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test views/partials/modal.test.js`
Expected: FAIL — `modal` is not registered.

- [ ] **Step 3: Register the component**

Add to `public/js/alpine-components.js` inside the `alpine:init` listener:

```js
  // Bulma modal shell. Replaces App.openModal / App.closeModal.
  //
  // Listens on the window so code outside Alpine can drive it:
  //   window.dispatchEvent(new CustomEvent('open-modal', { detail: 'levelUp' }))
  // That is how public/js/character-level-up.js opens its modal without
  // being rewritten.
  Alpine.data('modal', (name) => ({
    show: false,

    open(which) {
      if (which !== name) return;
      this.show = true;
      document.body.classList.add('modal-open');
    },

    close() {
      if (!this.show) return;
      this.show = false;
      document.body.classList.remove('modal-open');
    }
  }));
```

- [ ] **Step 4: Convert `#deceased-modal`**

Change the open trigger (line 389, currently `App.openModal` from Task 2):

```handlebars
    <button type="button" class="button is-dark" @click="$dispatch('open-modal', 'deceased')">
```

`$dispatch` bubbles, and the modal listens with `.window`, so no shared parent is needed.

Convert the modal element (line 408) and its three close sites (409, 413, 438):

```handlebars
<div id="deceased-modal" class="modal" x-data="modal('deceased')"
     :class="show && 'is-active'"
     @open-modal.window="open($event.detail)"
     @close-modal.window="close()"
     @keydown.escape.window="close()">
  <div class="modal-background" @click="close()"></div>
```

Replace each remaining `onclick="…classList.remove('is-active')"` with `@click="close()"`. Leave the `x-data` added in Task 10 on the inner `<form>` — nesting is fine, and the confirm gate stays independent.

- [ ] **Step 5: Run the tests**

Run: `bun test && bun run check`
Expected: PASS.

- [ ] **Step 6: Verify in a browser**

On a character edit page: "Mark as Deceased" opens the modal, background/×/Cancel/Escape all close it, the confirm gate still works, and the page does not scroll behind the modal (proving `modal-open` is applied).

- [ ] **Step 7: Commit**

```bash
git add public/js/alpine-components.js views/character-form.handlebars views/partials/modal.test.js
git commit -m "$(cat <<'EOF'
feat: add Alpine modal component, convert deceased modal (ar-7v3k)

The component listens for open-modal/close-modal on the window so code
outside Alpine can drive a modal by dispatching an event — which is how
character-level-up.js will open its modal without being rewritten.

It owns both is-active and body.modal-open, replacing what
App.openModal/closeModal did.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Convert the class-view modals

`#duplicateModal-{{class.id}}` and `#unlockCodeModal`. The latter carries `data-clear-on-close="true"` / `data-clear-target="#codeResult-{{class.id}}"`, behavior `App.closeModal` implemented and the component must now reproduce.

**Files:**
- Modify: `views/class-view.handlebars:26, 32, 213-251, 254-300`
- Test: `views/class-view.test.js` (create)

**Interfaces:**
- Consumes: `Alpine.data('modal', …)` from Task 16
- Produces: nothing

- [ ] **Step 1: Write the failing test**

Create `views/class-view.test.js`:

```js
const { test, expect, beforeAll } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => {
  await setupAlpine();
  require('../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

test('class-view no longer calls App.openModal or App.closeModal', () => {
  const src = fs.readFileSync(path.join(__dirname, 'class-view.handlebars'), 'utf8');
  expect(src).not.toContain('App.openModal');
  expect(src).not.toContain('App.closeModal');
});

test('closing the unlock-code modal clears its result target', async () => {
  await render(`
    <div id="unlockCodeModal" class="modal"
         x-data="modal('unlockCode')" :class="show && 'is-active'"
         @open-modal.window="open($event.detail)"
         @close-modal.window="close()">
      <div class="modal-background" id="bg"
           @click="close(); $refs.result && ($refs.result.innerHTML = '')"></div>
      <div id="codeResult" x-ref="result">GENERATED-CODE</div>
    </div>
  `);
  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'unlockCode' }));
  await tick();
  document.getElementById('bg').click();
  await tick();
  expect(document.getElementById('unlockCodeModal').classList.contains('is-active')).toBe(false);
  expect(document.getElementById('codeResult').innerHTML).toBe('');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test views/class-view.test.js`
Expected: FAIL — the source still contains `App.openModal`.

- [ ] **Step 3: Convert `#duplicateModal-{{class.id}}`**

Open trigger (line 26): `@click="$dispatch('open-modal', 'duplicate')"`.
Modal element (line 213): `x-data="modal('duplicate')"` plus the `:class`, `@open-modal.window`, `@close-modal.window` and `@keydown.escape.window` bindings from Task 16.
Close sites (214, 218, 247): `@click="close()"`.

Leave the inner form's `hx-post` and `hx-disabled-elt` untouched.

- [ ] **Step 4: Convert `#unlockCodeModal`**

Same pattern with `modal('unlockCode')`. Add `x-ref="result"` to the `#codeResult-{{class.id}}` element and make each close site clear it:

```handlebars
@click="close(); $refs.result && ($refs.result.innerHTML = '')"
```

Delete the now-unused `data-clear-on-close` and `data-clear-target` attributes from the modal element (line 254) — that contract only existed for `App.closeModal`.

Leave the inner form's `hx-post` and `hx-on::after-request` untouched.

- [ ] **Step 5: Run the tests**

Run: `bun test && bun run check`
Expected: PASS.

- [ ] **Step 6: Verify in a browser**

On a class you own: Duplicate opens and closes every way; Generate Unlock Code opens, generates a code via htmx, and on close the previous code is gone when reopened.

- [ ] **Step 7: Commit**

```bash
git add views/class-view.handlebars views/class-view.test.js
git commit -m "$(cat <<'EOF'
refactor: convert class-view modals to Alpine (ar-7v3k)

Duplicate and unlock-code modals now use the shared modal component. The
data-clear-on-close / data-clear-target contract that only App.closeModal
understood is replaced by an x-ref the close handlers blank directly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Convert the my-classes duplicate modal

Rendered inside `{{#each}}`, so each row needs a distinct modal name.

**Files:**
- Modify: `views/my-classes.handlebars:112, 132-170`
- Test: `views/my-classes.test.js` (from Task 1 — extend)

**Interfaces:**
- Consumes: `Alpine.data('modal', …)` from Task 16
- Produces: nothing

- [ ] **Step 1: Write the failing test**

Append to `views/my-classes.test.js`:

```js
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

test('my-classes no longer calls App.openModal or App.closeModal', () => {
  expect(source()).not.toContain('App.openModal');
  expect(source()).not.toContain('App.closeModal');
});

test('opening one row modal leaves the sibling row closed', async () => {
  await setupAlpine();
  require('../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));

  await render(`
    <div id="m-1" class="modal" x-data="modal('duplicate-1')"
         :class="show && 'is-active'" @open-modal.window="open($event.detail)"></div>
    <div id="m-2" class="modal" x-data="modal('duplicate-2')"
         :class="show && 'is-active'" @open-modal.window="open($event.detail)"></div>
  `);
  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'duplicate-2' }));
  await tick();
  expect(document.getElementById('m-1').classList.contains('is-active')).toBe(false);
  expect(document.getElementById('m-2').classList.contains('is-active')).toBe(true);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test views/my-classes.test.js`
Expected: the two new tests FAIL.

- [ ] **Step 3: Convert**

Open trigger (line 112): `@click="$dispatch('open-modal', 'duplicate-{{this.id}}')"`.
Modal element (line 132): `x-data="modal('duplicate-{{this.id}}')"` with the standard bindings.
Close sites (133, 137, 166): `@click="close()"`.

The per-row name is what keeps one row's modal from opening all of them.

- [ ] **Step 4: Run the tests**

Run: `bun test && bun run check`
Expected: PASS.

- [ ] **Step 5: Verify in a browser**

On My Classes with at least two classes: the Duplicate button on the second row opens **only** that row's modal. Confirm the duplicate still submits.

- [ ] **Step 6: Commit**

```bash
git add views/my-classes.handlebars views/my-classes.test.js
git commit -m "$(cat <<'EOF'
refactor: convert my-classes duplicate modal to Alpine (ar-7v3k)

Each row's modal is named with the class id so a row's trigger opens
only its own modal.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Convert `#levelUpModal` and retire the modal helpers

The payoff task: `character-level-up.js` keeps all its logic and changes by one line.

**Files:**
- Modify: `views/partials/character-level-up.handlebars:1, 2, 6, 106`
- Modify: `public/js/character-level-up.js:238`
- Modify: `public/js/app.js` — delete `openModal` (1263-1272), `closeModal` (1274-1290), their exports (~1373-1374), and the remaining Escape handler
- Test: `views/partials/character-level-up.test.js` (create)

**Interfaces:**
- Consumes: `Alpine.data('modal', …)` from Task 16
- Produces: an `app.js` with no modal API

- [ ] **Step 1: Write the failing test**

Create `views/partials/character-level-up.test.js`:

```js
const { test, expect, beforeAll } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { setupAlpine, render, tick } = require('../../test/helpers/alpine-dom');

beforeAll(async () => {
  await setupAlpine();
  require('../../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

test('character-level-up.js dispatches an event instead of calling App.openModal', () => {
  const src = read('../../public/js/character-level-up.js');
  expect(src).not.toContain('App.openModal');
  expect(src).toContain("new CustomEvent('open-modal'");
  expect(src).toContain("'levelUp'");
});

test('app.js no longer defines or exports the modal helpers', () => {
  const src = read('../../public/js/app.js');
  expect(src).not.toContain('const openModal');
  expect(src).not.toContain('const closeModal');
  expect(src).not.toMatch(/^\s*openModal,?$/m);
  expect(src).not.toMatch(/^\s*closeModal,?$/m);
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

test('a dispatched open-modal event opens the level-up modal', async () => {
  await render(`
    <div id="levelUpModal" class="modal" x-data="modal('levelUp')"
         :class="show && 'is-active'"
         @open-modal.window="open($event.detail)"
         @close-modal.window="close()"></div>
  `);
  window.dispatchEvent(new window.CustomEvent('open-modal', { detail: 'levelUp' }));
  await tick();
  expect(document.getElementById('levelUpModal').classList.contains('is-active')).toBe(true);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test views/partials/character-level-up.test.js`
Expected: FAIL.

- [ ] **Step 3: Convert the modal markup**

In `views/partials/character-level-up.handlebars`, add the component to line 1 and convert the three close sites (2, 6, 106) to `@click="close()"`:

```handlebars
<div id="levelUpModal" class="modal" x-data="modal('levelUp')"
     :class="show && 'is-active'"
     @open-modal.window="open($event.detail)"
     @close-modal.window="close()"
     @keydown.escape.window="close()">
  <div class="modal-background" @click="close()"></div>
```

Drop the now-meaningless `data-clear-on-close="false"` attribute.

- [ ] **Step 4: Change the one line in `character-level-up.js`**

Replace line 238:

```js
      window.dispatchEvent(new CustomEvent('open-modal', { detail: 'levelUp' }));
```

Update the comment at the top of the file (line 4) which documents the old call:

```js
//   - Open the modal by dispatching: new CustomEvent('open-modal', { detail: 'levelUp' }).
```

Change nothing else in this file.

- [ ] **Step 5: Delete the modal API from `app.js`**

Remove `openModal` (1263-1272) and `closeModal` (1274-1290) entirely, remove `openModal,` / `closeModal,` from the returned `App` object (~1373-1374), and delete the whole remaining Escape handler left over from Task 8 — each modal now declares `@keydown.escape.window` itself.

- [ ] **Step 6: Prove nothing references the removed API**

```bash
grep -rn "openModal\|closeModal" views/ public/js/ routes/
```

Expected: no output.

- [ ] **Step 7: Run the tests**

Run: `bun test && bun run check`
Expected: PASS.

- [ ] **Step 8: Verify in a browser**

This is the highest-risk manual check of the phase, because level-up is otherwise untouched:

1. On a character eligible to level up, click Level Up — the modal opens.
2. Complete a level-up and confirm it saves.
3. Cancel, ×, background click and Escape all close the modal.
4. Open the deceased modal and a class duplicate modal — all still work.
5. Confirm the page behind a modal does not scroll (`body.modal-open`).

- [ ] **Step 9: Commit**

```bash
git add views/partials/character-level-up.handlebars public/js/character-level-up.js public/js/app.js views/partials/character-level-up.test.js
git commit -m "$(cat <<'EOF'
refactor: convert level-up modal to Alpine, delete App modal helpers (ar-7v3k)

character-level-up.js keeps all of its logic and changes by one line: it
dispatches open-modal instead of calling App.openModal. That is the
whole point of the window-event bridge.

With every modal converted, App.openModal, App.closeModal, their exports
and the last global Escape handler are gone. Nothing under views/,
public/js/ or routes/ references the old API.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 exit — stopping point

After Task 19 the branch is coherent and complete on its own terms:

- Every dropdown, modal, counter, field toggle, gate, filter and sorter that was self-contained is declarative.
- `public/js/character-stats.js`, `App.openModal`, `App.closeModal` and all of `app.js:869-891` are deleted.
- One test suite covers all of it.

Before starting Phase 4, run the full manual checklist below and consider merging. Phase 4 is genuinely optional.

**Full manual regression checklist:**

1. Boosted navigation between five different pages — no console errors, navbar menu closed on arrival.
2. Export dropdowns on a character page and a class page.
3. Stats editor: edit, live total, cancel, save.
4. Deceased modal: type-to-confirm, all four close paths.
5. Level-up modal: open, complete, cancel.
6. Class duplicate + unlock code modals, including code clearing on reopen.
7. My Classes with 2+ rows: correct row's modal opens.
8. Mission list filters; character list sorting.
9. LFG post: character select, calendar toggle, participant details, and the join-requests lazy load.
10. Page editor slug autogeneration.
11. Tooltips, searchable selects, image cropper and the markdown editor still initialize after a boosted navigation (`app.js:843-867` intact).

---

## Phase 4 — Handoff brief (separate session)

Phase 4 is **not** planned as tasks here, deliberately. Its items are entangled with htmx request lifecycles, `fetch`, string-built HTML and localStorage shared with the excluded wizard; writing speculative step-by-step tasks for them would produce exactly the placeholder content this plan format forbids. It gets its own spec → plan cycle in a dedicated session.

**Start that session with:** this plan, the spec at `docs/superpowers/specs/2026-08-01-alpine-adoption-design.md`, and a branch stacked on this one.

### Items, in ascending risk order

| Item | Location | Why it is entangled |
|---|---|---|
| Clipboard "Copied!" | `public/js/app.js:1292-1310` | Timer-driven `innerHTML` swap + class juggling; three call sites in `views/partials/unlock-code-result.handlebars` (16, 36, 70). Needs `destroy()` cleanup for the timer. |
| Search-results auto-hide | `public/js/app.js:846-851` | Lives **inside** the `htmx:afterSwap` hub; 10s timer. Touching it risks the hub. |
| Join-requests reveal | `views/lfg-post.handlebars:22` | Toggles `is-hidden`, fires `htmx.trigger(t,'revealed')` once via a `dataset.loaded` latch, and rewrites its own label. |
| Conduit picker | `views/mission-form.handlebars:51-90` | Reads htmx-swapped `.profile-item` results, fills hidden inputs, swaps two panels. Server-rendered initial `style="display:none"` at lines 24, 35 must become `x-show` init. |
| Mission editors | `views/mission-form.handlebars:200-235` | `htmx.ajax` POST + a document-level `htmx:responseError` listener. |
| Version/perk-group sync | `public/js/character-form-version.js` (whole file) | `applyVersion()` toggles v1/v2 blocks; perk-group sync uses a **`MutationObserver`** plus `fetch` scaffolding and `htmx.process()`. The observer will interact with Alpine's own. |
| Restore-draft modal | `views/character-new-selector.handlebars:68-101` | Reads the `agentResources.characterWizard` localStorage key **owned by the excluded `character-wizard.js`**. Coupling to an out-of-scope module. |
| Unregistered-character repeater | `views/mission-form.handlebars:325-464` | The largest single item: builds rows from template strings, one delegated click handler doing four jobs, `htmx.ajax`, raw `fetch`, hand-built result HTML with inline styles. |

### Constraints that carry over

- Everything in this plan's **Global Constraints** still applies, especially: no route changes, no `afterSwap` → `initTree`, and `app.js:843-867` stays working.
- `character-wizard.js` remains out of scope. The restore-draft item must not change the localStorage schema it owns.
- Any `setTimeout`/`setInterval`/`window.addEventListener` a converted component creates **must** be released in `Alpine.data()`'s `destroy()` — Alpine only auto-cleans what it registered, and under `hx-boost` these otherwise accumulate on every navigation. Both timer items above hit this directly.

### Recommended first move

Convert the two `app.js` timer items first. They are the smallest, they establish the `destroy()` cleanup pattern the rest need, and they are the only Phase 4 items that reduce `app.js` rather than a template. Leave the unregistered-character repeater for last, and treat "leave it on its current mechanism" as an acceptable outcome — the spec explicitly allows it.

---

## Self-Review

**Spec coverage** — every spec section maps to a task:

| Spec section | Task(s) |
|---|---|
| Delivery: pinned CDN + devDependency | 3, 4 |
| Swap re-initialization: none required | 3 (test), Global Constraints |
| Settle-clobber fix | 5 |
| Script order | 4 |
| State across navigation | 7 (boosted-nav test) |
| FOUC / `x-cloak` | 4 |
| Component conventions | 4 (`alpine-components.js`), used throughout |
| Modals: CustomEvent bridge | 16-19 |
| Verification: jsdom harness | 3 |
| TDD | every task is red-green-commit |
| Phase 0 bugs | 1, 2 |
| Phase 1 infra | 3, 4, 5 |
| Phase 2 self-contained | 6-15 |
| Phase 3 modals | 16-19 |
| Phase 4 entangled | Handoff brief |
| Out-of-scope list | Global Constraints |

**Gap found and closed:** the spec lists the stats-editor save button's `is-loading`/`disabled` states as part of the conversion; Task 12's component covers them via `saving` and the test asserts the button re-enables after a failure.

**Placeholder scan:** no TBDs, no "add error handling", no "similar to Task N". Every code step carries real code. Task 14's registration originally contained a tangled column-index derivation; Step 4 now states plainly which version to use and why.

**Type consistency:** `setupAlpine` / `render` / `renderPartial` / `tick` are defined in Task 3 and used with those exact names in Tasks 6, 7, 9-19. `Alpine.data('modal', (name) => …)` with `show` / `open(which)` / `close()` is defined in Task 16 and consumed identically in 17, 18, 19. `Alpine.data('characterStats', (characterId, initialStats) => …)` matches its test mount in Task 12. The `open-modal` / `close-modal` event names and their `detail` string payload are consistent across Tasks 16-19.

**Known soft spot:** Task 14's `sortableTable` needs `data-sort-key` on each `<th>`, which Step 5 adds to the markup — the component and the markup must land together or the column index resolves to `-1`.
