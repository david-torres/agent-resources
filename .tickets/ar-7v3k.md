---
id: ar-7v3k
status: open
deps: []
links: []
created: 2026-08-01T18:42:51Z
type: epic
priority: 2
assignee: David Torres
tags: [frontend, htmx, alpine, tech-debt]
---
# Adopt Alpine.js for client-side view state

Local, ephemeral view state (dropdown open/closed, block visibility, live totals, button gating) is currently managed three inconsistent ways: inline `onclick`/`hx-on:` DOM manipulation in templates, global imperative handlers in `public/js/app.js`, and whole files of reactive glue such as `public/js/character-stats.js`. An inventory found ~90 line-level sites across 8 categories.

Adopt Alpine.js as a single declarative layer for this state, delete the imperative code it replaces, and add a jsdom test harness so the conversions are verifiable. htmx keeps every server round-trip unchanged — Alpine is additive, not a replacement.

Design: `docs/superpowers/specs/2026-08-01-alpine-adoption-design.md`
Plan: `docs/superpowers/plans/2026-08-01-alpine-adoption.md`

## Acceptance Criteria

Alpine 3.15.12 loads via pinned CDN + SRI with a test asserting the pin matches the installed devDependency; `defaultSettleDelay: 0` is set and guarded by a test proving a hidden `x-show` element survives a boosted body swap; no `Alpine.initTree`/`destroyTree` call exists in application code; `App.openModal`, `App.closeModal`, the Escape handler, both global dropdown handlers, and `public/js/character-stats.js` are deleted rather than deprecated; every converted component has a jsdom behavior test written before its conversion; `bun run check` and the full suite pass at the end of every phase; no `hx-*` server interaction changes behavior.

## Status: Phases 0-3 complete on branch `alpine-adoption-trial`

44 commits, `3be01a1..0b564e2`. Suite: 84 files / 715 pass / 0 fail; `bun run check` exit 0.

Deleted: `public/js/character-stats.js` (108 lines), `App.openModal`/`App.closeModal` and both exports, all of `app.js:869-891` (outside-click + Escape handlers), four inline `<script>` blocks, one dead modal.

Acceptance criterion #2 is **partially met**: the `defaultSettleDelay: 0` config is set and asserted, and body-swap re-initialisation is covered for `x-text` and `:class`, but no test combines `x-show` with a simulated boosted body swap. Worth closing in Phase 4.

## BLOCKING: manual browser verification before merge

**Nothing on this branch has executed in a browser.** Every task ran headless, and jsdom has no htmx — so the swap-then-settle race that `defaultSettleDelay: 0` exists to neutralise is structurally unreachable from the test suite. The top six below should gate the merge.

1. **Level-up modal, end to end.** Open from a character page, complete a level-up (stats + perk + missing-mission text + conduit-credit toggle), save, confirm the reload lands with the new level. Then all four close paths. `character-level-up.js` (317 lines) was otherwise untouched and hangs off a one-line event bridge; it is the only path writing character data through a converted modal.
2. **Boosted-navigation settle check.** Shrink the window, open the navbar menu, click a nav link, confirm the menu arrives **closed**. This is the entire justification for the `defaultSettleDelay: 0` change and cannot be tested here.
3. **Stats editor full cycle.** Edit reveals *and focuses the first input*; live total tracks; Cancel restores originals; Save persists and reloads; a character you do **not** own shows no Edit button. Confirm the box renders at all.
4. **Perk form save round-trip.** Count matches the server value on load, updates while typing, shows 0 for whitespace — and critically that **saving still persists perk text**. The field changed from `<input>` to `<textarea>` (a human-approved change); a disturbed `name="ability_perk_text[]"` would be silent data loss. Also eyeball the Bulma `.field.has-addons` layout, which gained a wrapping `<div>`.
5. **Deceased modal.** Opening now sets `body.modal-open` for the first time — confirm the page behind does not scroll. Type the exact name to enable the button and submit. Prefer a character whose name contains an apostrophe.
6. **Unlock-code modal.** Generate a code, close via **all four** paths (background / × / footer Close / Escape), reopen each time, confirm the prior code is gone.
7. Offscreen mission edit with a *linked* source mission — the human-approved behavior change. "Other" fields must start **hidden**, and the select must still show the linked mission as selected.
8. Page editor on an existing page: title and slug populated on load; saving without touching the slug does not change the URL.
9. My Classes with several classes: one row's Duplicate opens only that row's modal, and submits.
10. LFG: create-form checkbox (start on a post where you *are* host), join-form radios, calendar panel, per-participant Details expanding only its own row, and the untouched join-requests Show/Hide still lazy-loading.
11. Export dropdowns on a character and a class page: open, second-click close, outside-click close, Escape close, both export links download.
12. Back-button behavior: open a dropdown or the navbar menu, navigate via a boosted link, press Back. htmx restores a snapshot taken after Alpine stripped `x-cloak` and wrote `:class`.

## Deliberate behavior changes (human-approved during execution)

- **Perk text field is now a `<textarea>`**, was `<input type="text">`. Perk text can contain newlines, which flow into the markdown/JSON character export and the "Compounds with #N: {text}" select labels. Enter no longer submits from that field.
- **Offscreen-mission "other" fields now start hidden when a real source mission is linked.** Previously `style="display: ;"` — invalid CSS falling back to visible — showed them whenever an offscreen mission existed, contradicting which option the browser marked selected.
- **Slugify preserves underscores** (`foo_bar` stays `foo_bar`). The plan's draft folded them into dashes; preserving matches the deleted script and avoids flipping the auto/manual flag for existing pages with underscored titles.

## Parked minors (non-blocking)

- `views/partials/lfg-form.test.js:11-15` — comment describes `renderPartial` as existing-but-broken; it was deleted.
- The plan doc still documents `renderPartial` as shared harness API.
- `scripts/check.mjs` does not syntax-check `public/js`, so `alpine-components.js` is not covered by `bun run check`.
- Lost the sort-indicator's `0.35em` left margin (cosmetic; the template's literal space partly covers it).
- `views/character-list.test.js:21` fixture calls `sortBy('name','text')`; the template calls `'string'`. Harmless — only `'number'` branches.

## Phase 4 (not started)

Entangled conversions deliberately deferred, with their own spec/plan cycle: the `mission-form` unregistered-character repeater, conduit picker and editors; `character-form-version.js`; the `character-new-selector` restore-draft flow; and the clipboard / search-results timers in `app.js`. Handoff brief is in the plan document.
