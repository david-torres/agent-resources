# Alpine.js adoption

- **Ticket:** ar-7v3k
- **Branch:** `alpine-adoption-trial` (stacked on `complete-character-service`)
- **Date:** 2026-08-01
- **Type:** frontend architecture — replace hand-rolled DOM state management with a declarative reactivity layer

## Problem

The app is server-rendered Express + Handlebars with htmx 2.0.8 as the
network/interactivity backbone (`hx-boost="true"` on `<body>`,
`views/layouts/main.handlebars:5`). htmx covers every server round-trip well.

What it does not cover is *local, ephemeral view state* — is this dropdown open,
which block is visible, does the sum of these inputs still equal 12, is the
confirm button enabled yet. That state is currently managed three different
ways, none of them consistent:

1. **Inline `onclick` / `hx-on:` DOM manipulation** —
   `views/character.handlebars:163` and `views/class-view.handlebars:36` both
   carry `onclick="document.getElementById('export-dropdown').classList.toggle('is-active')"`.
2. **Global imperative handlers in `public/js/app.js`** — outside-click dropdown
   close (883-891), Escape-key close (869-881), modal open/close helpers
   (1263-1290), clipboard transient state (1292-1310).
3. **Whole files of reactive glue** — `public/js/character-stats.js` is 108
   lines that only toggle two blocks' visibility, live-sum 12 inputs, and
   submit. `public/js/character-form-version.js` is 116 lines of the same kind
   of work.

An inventory of `views/**` and `public/js/*.js` found **~90 line-level sites**
across eight categories: 5 dropdown toggles, 31 modal sites across 7 modal ids,
17 show/hide field dependencies, 9 live-computed text targets, 13 validation /
disabled-gating sites, 2 client-side filter/sort implementations, 6 transient
UI states, and 10 inline `<script>` blocks.

There is no DOM-level test infrastructure today. Partial tests
(e.g. `views/partials/section-heading.test.js`) compile Handlebars and assert on
the rendered HTML string; nothing exercises behavior.

## Goal

Replace the three ad-hoc mechanisms with one declarative layer (Alpine.js),
delete the imperative code they replace, and establish a DOM-level test harness
so the conversions are verifiable rather than eyeballed.

Non-goal: changing any server interaction. Every `hx-get`/`hx-post`/`hx-trigger`
stays exactly as it is. Alpine is additive to htmx, not a replacement for it.

## Decisions

### Delivery: pinned CDN + matching devDependency

Alpine `3.15.12` (current stable; v3 is still the current major) from jsDelivr
with an SRI hash and `defer`, matching how htmx and supabase-js are already
loaded in `views/partials/head.handlebars:13-14`.

```html
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.12/dist/cdn.min.js"
        integrity="sha384-pb6hrQvo4s23cEUFtj0CZkzGE3jyK3pj26RIupXXxhSrrcUA/Cn0lZgcCrGH0t6L"
        crossorigin="anonymous"></script>
```

The version must be pinned exactly — the `@3.x.x` range in Alpine's own docs is
incompatible with SRI, because the resolved file (and therefore the hash)
changes. `alpinejs@3.15.12` is also added as a **devDependency** at the identical
version so jsdom tests exercise the same code the browser runs, and a
version-sync test asserts the two can never drift.

The app sets no Content-Security-Policy, so the standard Alpine build is fine.
The CSP build (`@alpinejs/csp`) is not needed and is not used — it would forbid
inline expressions entirely and force every component through `Alpine.data()`.

### Swap re-initialization: none required

Alpine 3's `start()` installs a single document-wide MutationObserver
(`subtree: true`) wired to `initTree` on node add and `destroyTree` on node
remove. htmx-swapped content is therefore **initialized automatically with no
manual wiring**, and components whose nodes are removed are torn down
automatically.

**No `htmx:afterSwap` → `Alpine.initTree()` handler will be added.** Doing so
would re-run `init()` on components Alpine has already initialized, double-firing
side effects and resetting state. Manual `initTree` is only needed inside
`Alpine.mutateDom()` (which detaches the observer) or when synchronous init is
required — neither applies here.

Alpine's automatic cleanup only covers what Alpine itself registered. A raw
`window.addEventListener` or `setInterval` created inside `x-init` is **not**
cleaned up, and under `hx-boost` those accumulate on every navigation. Any
component needing one must release it in `Alpine.data()`'s `destroy()`.

### The settle-clobber fix: `defaultSettleDelay: 0`

This is the single highest-value configuration change and the one real hazard of
combining Alpine with `hx-boost`.

htmx's settle phase (`handleAttributes()`) copies the *old* node's attributes
onto any incoming element that has an `id` and exists on both pages, then
restores the response's values after `defaultSettleDelay` (20ms). The settled
attribute list is `['class', 'style', 'width', 'height']`. The resulting
sequence:

1. htmx swaps content in, temporarily wearing the old `class`/`style`.
2. Alpine's observer fires on a microtask; `x-show` writes `style="display:none"`,
   `:class` writes classes.
3. 20ms later `doSettle()` overwrites `style`/`class` with the server response's
   values, **wiping what Alpine wrote**.
4. Alpine does not re-run — `style` is not a directive, and `x-show`'s effect
   only re-runs when its state changes. The element stays visually wrong until
   state changes.

Reproduced in jsdom: an `x-data="{open:false}"` / `x-show="open"` menu ends up
with `style=""` and renders **open** when it should be closed. Because
`hx-boost` swaps the whole `<body>`, this affects every id-bearing element that
persists across navigation — nav, header, breadcrumbs.

The fix is to make settle synchronous, so it completes before Alpine's mutation
microtask and Alpine initializes against final attributes:

```js
if (swapSpec.settleDelay > 0) { setTimeout(doSettle, swapSpec.settleDelay) }
else { doSettle() }   // delay 0 → runs in the same task as the swap
```

This is set declaratively by extending the htmx-config meta tag already present
at `views/partials/head.handlebars:4`:

```html
<meta name="htmx-config" content='{"includeIndicatorStyles": false, "defaultSettleDelay": 0}'>
```

The alternative — stripping `class`/`style` from `attributesToSettle` — also
works but silently disables htmx's settle-based CSS transitions. `settle:0` is
preferred as the narrower change. This is a genuine fix, not a narrowed race.

The `hx-alpine-compat` extension, which handles this properly at the framework
level, is **htmx 4 only** and unavailable on htmx 2.x.

### Script order in `head.handlebars`

Alpine's CDN build ends with `queueMicrotask(() => Alpine.start())`, which fires
on the microtask checkpoint immediately after its own script tag — i.e. **before
the next deferred script runs**. Anything registering `Alpine.data()`,
`Alpine.plugin()`, or listening for `alpine:init` must therefore appear *before*
the Alpine tag:

```html
<script defer src="https://unpkg.com/htmx.org@2.0.8" ...></script>
<script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" ...></script>
<script defer src="/js/app.js"></script>
<script defer src="/js/alpine-components.js"></script>   <!-- registrations -->
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.12/..." ...></script>
```

htmx's own position is irrelevant — it defers its initial
`htmx.process(document.body)` to `DOMContentLoaded`. htmx does not re-run head
scripts on a boosted swap, so `Alpine.start()` correctly runs exactly once.

### State across navigation

`hx-boost` swaps `<body>`'s children, so every `x-data` inside body is destroyed
and recreated: **component state resets on every navigation.** That is the
correct and desired default for this app.

Two consequences to respect:
- `x-data` placed *on* `<body>` itself would survive navigation, since that
  element is never removed. Do not put component state there.
- Anything that genuinely must persist across navigation belongs in
  `Alpine.store()`, which is JS-level and survives.

The `alpine-morph` plugin (which preserves state across swaps) is **not** used —
it solves a problem this app does not have, and carries a known bug where state
changes fail to propagate into descendants' data stacks.

### FOUC: `x-cloak`

Because Alpine is deferred, the browser can paint uninitialized DOM before
Alpine runs, flashing elements that `x-show` will immediately hide. The standard
guard goes in `public/css/styles.css`:

```css
[x-cloak] { display: none !important; }
```

Needed for initial page load. Not strictly needed for htmx-swapped content
(Alpine initializes on a microtask, before the next paint), but harmless there
and applied uniformly for consistency.

### Component conventions

- **Trivial local state** → inline `x-data="{ open: false }"`.
- **Anything non-trivial** → `Alpine.data('name', …)` registered inside an
  `alpine:init` listener in a new `public/js/alpine-components.js`. This keeps
  logic out of markup and makes it directly unit-testable.
- Expressions in markup stay declarative. Once an expression needs branching or
  more than one statement, it moves into `Alpine.data()`.

### Modals: window CustomEvent bridge

All modal shells become Alpine components listening on the window:

```html
<div x-data="{ show: false }"
     @open-modal.window="show = ($event.detail === 'levelUp')"
     @close-modal.window="show = false"
     :class="show && 'is-active'">
```

Non-Alpine code opens one by dispatching:

```js
window.dispatchEvent(new CustomEvent('open-modal', { detail: 'levelUp' }))
```

This lets the excluded `public/js/character-level-up.js` keep driving its modal
with a **one-line change** at line 238 (no rewrite of its level-up logic), while
`App.openModal` / `App.closeModal` (`app.js:1263-1290`) are **deleted outright**
— no shim, no dual mechanism, no dead API. Escape-to-close moves onto each modal
component as `@keydown.escape.window`, retiring the last of the global handler
at `app.js:869-881` (see the Phase 2/3 split below, which removes its dropdown
and modal halves separately).

The `data-clear-on-close` / `data-clear-target` behavior that `closeModal`
implements (blanking a target's `innerHTML`) is reproduced with an explicit
close action on `#unlockCodeModal` — the only surviving modal that uses it.
(`#historyModal` also carries the attributes but is deleted in Phase 0;
`#levelUpModal` sets `data-clear-on-close="false"`, so it needs nothing.)

### Verification: jsdom behavior tests

`jsdom` and `alpinejs` are added as devDependencies. Alpine runs correctly under
`bun:test` + jsdom; this was verified end-to-end before committing to the
approach. Two non-obvious requirements:

1. **`ShadowRoot` must be copied onto `globalThis`.** Alpine's `findClosest`
   does `el.parentNode instanceof ShadowRoot` during `start()`; jsdom defines it
   on `dom.window` but not as a Node global, and its absence hard-crashes
   startup. The same applies to `MutationObserver`, `CustomEvent`, `Element`,
   `Node`, and friends.
2. **Alpine must be imported *after* the globals are installed**, or `start()`
   throws.

Alpine's scheduler uses `queueMicrotask` exclusively — no `requestAnimationFrame`
— so timing is well-behaved under test. `requestAnimationFrame` appears only in
`x-transition`, which degrades to `setTimeout` when `visibilityState !== 'visible'`;
transitions won't animate under jsdom but won't crash.

The harness lives at `test/helpers/alpine-dom.js`. The binding rule for every
test: **`await Alpine.nextTick()` after triggering anything.** Reading state
synchronously after `.click()` returns stale values.

A version-sync test asserts the pinned version in `head.handlebars` equals the
installed `alpinejs` package version, so the suite can never silently validate a
different Alpine than production serves.

Component tests are colocated with their partials (matching the existing
`views/partials/*.test.js` convention); `views` is already in the directory list
`scripts/run-tests.mjs` walks.

### TDD

Per the project default, each conversion runs red-green-refactor: a jsdom test
capturing the *existing* behavior first, then the conversion, then green. This
is what makes a sweep of this size safe without a browser E2E suite.

## Scope

### Phase 0 — pre-existing bug fixes

Two defects surfaced by the inventory, independent of Alpine:

1. **Dead modal.** `#historyModal-{{this.id}}`
   (`views/my-classes.handlebars:118-130`) has three close sites and **no open
   trigger anywhere in the codebase**. Delete it.
2. **`#deceased-modal` state mismatch.** It opens via raw
   `classList.add('is-active')` (`views/character-form.handlebars:389`) rather
   than `App.openModal`, so it never sets `body.modal-open` — but Escape closes
   it through `App.closeModal` (`app.js:872-874`), which *removes* a
   `modal-open` class that was never added. Normalize before converting.

### Phase 1 — infrastructure only, zero conversions

Alpine CDN tag + SRI; `defaultSettleDelay: 0` in the htmx-config meta;
`[x-cloak]` CSS; `jsdom` + `alpinejs` devDeps; `test/helpers/alpine-dom.js`;
version-sync test; empty `public/js/alpine-components.js` with the `alpine:init`
listener scaffold.

Exit criterion: full suite green, app renders and navigates identically, with a
smoke test proving a boosted navigation leaves a hidden `x-show` element hidden
(the settle-clobber regression guard).

### Phase 2 — self-contained conversions

Pure local view state, no htmx/fetch/localStorage entanglement:

- Dropdowns: `character.handlebars:163`, `class-view.handlebars:36`, navbar
  burger `partials/nav.handlebars:6`. Once all three are converted this
  **deletes the outside-click handler (`app.js:883-891`) entirely** and the
  **dropdown half of the Escape handler (`876-879`)**. The modal half of the
  Escape handler (`872-875`) must survive this phase — it is still the only
  Escape-to-close for modals until Phase 3 replaces it, which is why the
  handler is split across two phases rather than deleted here.
- Counters: perk word count (`partials/character-ability-perk.handlebars:9-10`),
  keeping the server-rendered `{{wordCount}}` seed at `:10` in sync with the
  live value.
- Show/hide toggles: `partials/lfg-form.handlebars:29`,
  `partials/lfg-join-form.handlebars:10,14`,
  `partials/offscreen-mission-form.handlebars:32`,
  `lfg-post.handlebars:31,36,92`.
- Type-to-confirm gating: `character-form.handlebars:430-431,444`.
- Stats editor (`public/js/character-stats.js`, **file is deleted**): the
  read-only/editor visibility toggle (43-56), the 12-input live total (19-26 →
  `partials/character-stats-editor.handlebars:3`), and the save button's
  `is-loading`/`disabled` states (65-66, 90-91, 99-100) all become `x-data`.

  **The save stays a `fetch`.** `PATCH /characters/:id/stats`
  (`routes/characters.js:928-939`) responds `res.json({ character })`, not HTML,
  so `hx-patch` would try to swap a JSON body into the DOM. Converting it would
  mean changing the route — which this design explicitly rules out as a
  non-goal. The `fetch` call, its `CharacterCommon.getAuthHeader()` usage, and
  the `window.location.reload()` on success move into the `Alpine.data()`
  component unchanged. Only the view state becomes declarative.
- Client-side list operations: `mission-list.handlebars:189-225` (4-field
  debounced filter), `character-list.handlebars:54-102` (sortable table).
- Slug autogeneration: `page-form.handlebars:87-129`.

### Phase 3 — modals

Five modal ids converted to the CustomEvent bridge — `#deceased-modal`,
`#duplicateModal-{{class.id}}` (`class-view`), `#unlockCodeModal`,
`#duplicateModal-{{this.id}}` (`my-classes`), and `#levelUpModal`. Of the 7 ids
inventoried, `#historyModal` is deleted in Phase 0 and `#restoreDraftModal` is
deferred to Phase 4 with the rest of the `character-new-selector` localStorage
flow.

`App.openModal`, `App.closeModal`, their `App`-namespace exports
(`app.js:1373-1374`), and the **remaining modal half of the Escape handler**
(872-875, whose dropdown half Phase 2 already removed) are deleted in this
phase — leaving no part of `app.js:869-891` behind. Escape-to-close becomes
`@keydown.escape.window` on each modal component.
`character-level-up.js:238` gets its one-line `dispatchEvent` change.

Note the ordering constraint: `#restoreDraftModal` still opens via raw
`classList.add` (`character-new-selector.handlebars:84`), not `App.openModal`,
so deleting the helpers here does not break it. It keeps working on its own
mechanism until Phase 4 converts it.

### Phase 4 — entangled conversions

Highest effort, lowest certainty; sequenced last so the branch is coherent if it
stops early:

- `mission-form.handlebars:325-464` — unregistered-character repeater
  (string-built HTML, `htmx.ajax`, `fetch`). The largest single item.
- `mission-form.handlebars:51-90` conduit picker; `:200-235` editors.
- `character-form-version.js` — v1/v2 block switching and perk-group sync
  (currently driven by a `MutationObserver`).
- `character-new-selector.handlebars:68-101` — restore-draft modal reading a
  localStorage key shared with the excluded wizard.
- Transient states: clipboard "Copied!" (`app.js:1292-1310`),
  `#characterSearchResults` 10s auto-hide (`app.js:846-851`).

### Explicitly out of scope

Not converted, and the reasons:

| Item | Reason |
|---|---|
| `public/js/character-wizard.js` (1,698 lines) | Real derivation logic (stat spreads, perk groups), not view state. Forcing it into `x-data` makes it worse. |
| `public/js/character-level-up.js` (317 lines) | Same; only its `App.openModal` call changes. |
| `public/js/pdf-viewer.js` | Third-party pdf.js integration, no view state. |
| 19 `hx-confirm` sites | htmx-native and correct as-is. |
| 11 auth handlers (`App.signIn` etc.) | Auth surface; out of scope. |
| TomSelect (`app.js:778-803`), tippy (`737-775`), croppers, ToastUI | Third-party widget init. |
| `hx-disabled-elt` sites | htmx-native in-flight disabling. |
| tippy tooltip source divs | They use `.is-hidden` and *look* like toggles, but are tooltip **content**. Converting them breaks tooltips. |

`public/js/app.js:843-867` — the `htmx:afterSwap` re-initialization hub — **stays**.
Alpine does not replace it; tooltips, searchable selects, croppers and ToastUI
editors still require re-init on swap. Every phase must leave it working.

## Risks

- **Settle clobber** is the main technical risk. Mitigated by
  `defaultSettleDelay: 0` and guarded by an explicit Phase 1 regression test.
- **jsdom is not a browser.** It won't catch paint timing, transitions, or real
  settle behavior. Each phase therefore carries a short manual browser
  checklist, which must include: navigate via a boosted link and confirm no
  element renders in the wrong visibility state.
- **Phase 4 may not be worth finishing.** The entangled items mix htmx, `fetch`,
  string-built HTML and localStorage. The phasing exists so the branch can stop
  after Phase 3 with a coherent, fully-converted codebase and Phase 4 items left
  on their current mechanism.
- **Partial dropdown/modal conversion creates dual mechanisms.** The global
  handlers in `app.js` cannot be deleted until *all* dropdowns are converted;
  until then both mechanisms run and could double-close. Phases 2 and 3 must
  each convert their category completely, not partially.

## Acceptance criteria

1. Alpine 3.15.12 loads via pinned CDN + SRI; a test asserts the pin matches the
   installed devDependency.
2. `defaultSettleDelay: 0` is set, and a jsdom test proves a hidden `x-show`
   element stays hidden across a simulated boosted body swap.
3. No `Alpine.initTree` / `destroyTree` call exists in application code.
4. `App.openModal`, `App.closeModal`, their `App`-namespace exports, the whole
   of `app.js:869-891` (Escape + outside-click handlers), and
   `public/js/character-stats.js` are **deleted**, not deprecated. `grep` for
   `openModal|closeModal` returns nothing outside git history.
5. Every converted component has a jsdom behavior test written before its
   conversion.
6. `bun run check` and the full test suite pass at the end of every phase.
7. No `hx-*` server interaction changes behavior.
