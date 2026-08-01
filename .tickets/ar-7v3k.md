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

## Acceptance Criteria

Alpine 3.15.12 loads via pinned CDN + SRI with a test asserting the pin matches the installed devDependency; `defaultSettleDelay: 0` is set and guarded by a test proving a hidden `x-show` element survives a boosted body swap; no `Alpine.initTree`/`destroyTree` call exists in application code; `App.openModal`, `App.closeModal`, the Escape handler, both global dropdown handlers, and `public/js/character-stats.js` are deleted rather than deprecated; every converted component has a jsdom behavior test written before its conversion; `bun run check` and the full suite pass at the end of every phase; no `hx-*` server interaction changes behavior.
