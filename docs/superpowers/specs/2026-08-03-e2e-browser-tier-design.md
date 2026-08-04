# End-to-End Browser Test Tier — Design

**Date:** 2026-08-03
**Tickets:** ar-7v3k (Alpine adoption), ar-h6rt (auth redirect loop)
**Status:** Approved, awaiting implementation plan

## Problem

The Alpine.js adoption (`ar-7v3k`, 44 commits) rewrote roughly 90 line-level
sites of client-side view state. Its own ticket records the gap:

> **Nothing on this branch has executed in a browser.** Every task ran headless,
> and jsdom has no htmx — so the swap-then-settle race that
> `defaultSettleDelay: 0` exists to neutralise is structurally unreachable from
> the test suite.

The ticket then lists twelve manual checks that gate the merge. Two of them
guard silent data loss: the perk field changed from `<input>` to `<textarea>`,
and a disturbed `name="ability_perk_text[]"` would drop perk text with no error.

The repository has three test tiers — `test:unit` (jsdom, no DB), `test:http`
(bare Express with mocked models), `test:integration` (local Supabase) — and 715
passing tests across 84 files. None of them run a browser, so none of them can
observe htmx swaps, Alpine's settle behavior, boosted navigation, or the back
button.

The `ar-h6rt` auth-redirect defect has the same shape: `redirectTo()` swaps the
body without touching `window.location`, and only a real browser can confirm the
address bar now tracks the rendered page.

## Goal

Add a fourth test tier that drives a real browser against the running app, and
use it to convert the ar-7v3k manual checklist into automated coverage. The tier
outlives this verification pass: every future client-side refactor inherits it.

## Non-goals

- Fixing any defect the suite uncovers. This pass **reports**, it does not
  repair. See "Failure policy".
- Alpine Phase 4 conversions (mission-form repeater, conduit picker,
  `character-form-version.js`, `character-new-selector` restore-draft,
  `app.js` clipboard/search timers). Not started; own spec/plan cycle.
- The Discord bot, the `/api/agent` surface, cross-browser matrix, visual
  regression.
- Breadth-first per-route coverage. The http and integration tiers already
  cover most server-side paths; duplicating them in a browser buys little.

## Architecture

A fourth tier, peer to the existing three, with its own runner.

```
playwright.config.js        repo root
e2e/
  global-setup.js           sign-in + storageState provisioning
  fixtures/                 per-spec seeders over supabaseAdmin + pg
  specs/                    one file per ar-7v3k checklist item
  .auth/                    storageState JSON (gitignored)
  report/                   HTML report + traces (gitignored)
```

`bun run test:e2e` → `playwright test`. Existing tiers,
`scripts/run-tests.mjs`, and `bun run check` are untouched; Playwright does its
own file discovery, so the `httpFiles` / `integrationFiles` sets in
`scripts/run-tests.mjs` do not change.

**Runner: `@playwright/test`, not `bun:test` + `playwright-core`.** The tier's
output is a findings report, and Playwright's runner supplies trace-on-failure,
screenshots, video, retries, and the trace viewer. Driving `playwright-core`
from `bun:test` would keep one runner across all four tiers but discard exactly
the artifacts that make a browser failure diagnosable.

**Browser: Chromium only.** The refactor is behavioral, not
rendering-sensitive. Adding browsers multiplies runtime for no signal here.

**Server:** the config's `webServer` boots `bun run index.js` on **port 3100**,
so it never collides with a `bun run dev` on 3000. It refuses to start unless
`SUPABASE_URL` matches `http://127.0.0.1:54321`, mirroring the guard the
integration tier applies at `scripts/run-tests.mjs:44-48`.

**Prerequisite:** `supabase start` and `bun run seed:local` must have run. The
suite fails fast with that instruction rather than producing confusing empty-DB
failures.

## Authentication

Auth tokens live in `localStorage` as `authToken` / `refreshToken`
(`public/js/app.js:74-92`) and are attached to htmx requests via
`htmx:configRequest`. A plain browser navigation carries no `Authorization`
header, which is the whole reason protected routes bounce through
`/auth/check?r=`.

`e2e/global-setup.js` therefore:

1. Signs in **through the real `/auth` form** as the seeded admin
   (`dummy@testing.com` / `dummypassword`, from `util/seed-admin.js:43-44`) and
   saves `storageState` to `e2e/.auth/admin.json`.
2. Provisions a second, non-admin user at a fixed address
   (`e2e-player@testing.com`) via `supabaseAdmin.auth.admin.createUser`, signs
   it in the same way, and saves `e2e/.auth/player.json`.

The player account is **infrastructure, not fixture data**: it has a stable
email, is created idempotently (skipped if already present, exactly as
`util/seed-admin.js` treats the admin), and is never torn down. It needs the
admin API rather than the direct `insert into auth.users` the fixtures use,
because it must be able to sign in with a password — the fixtures' auth rows
only ever need to own records, never to authenticate.

Signing in through the form rather than injecting tokens is deliberate: the
localStorage contract in `app.js:74-92` is itself refactor-adjacent, so the
setup doubles as a check. If sign-in breaks, every spec fails loudly at setup.

The non-admin user exists for checklist item 3 — "a character you do **not** own
shows no Edit button" — which cannot be expressed with a single account.

The `ar-h6rt` specs deliberately ignore both storage states and start
**unauthenticated**, because the defect lives in the `/auth/check?r=` flow
itself.

## Fixtures

`e2e/fixtures/` exports per-spec seeders built on `supabaseAdmin` and a `pg`
`Client`, following the conventions already established in
`models/character-atomic.integration.test.js`: direct `insert into auth.users`
for auth rows, `supabaseAdmin` for application tables, connection string from
`process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'`.

Each spec seeds only the rows it needs in `beforeAll`, under a per-run unique
prefix (`e2e-<spec>-<timestamp>-<random>`, as
`character-atomic.integration.test.js:7` does), and deletes by that prefix in
`afterAll`.

**No `supabase db reset`.** The developer's local dev data is never touched, and
specs stay parallel-safe because no two runs share a prefix.

Fixture shapes required by the checklist: a character owned by the admin; a
character owned by the player (for the non-owner check); a character whose name
contains an apostrophe; a character with abilities and perk text; a class with
unlock codes; a class the admin owns several copies of (My Classes duplicate); a
mission plus an offscreen mission with a linked source mission; an LFG post
where the admin is host, and one where they are not; a CMS page with an existing
slug.

## Spec inventory

One spec file per ar-7v3k checklist item, so the ticket can be struck through
item by item.

| # | Spec | What only a browser proves |
| --- | --- | --- |
| 1 | Level-up modal, full cycle + all four close paths | The only path writing character data through a converted modal; `character-level-up.js` (317 lines) hangs off a one-line event bridge |
| 2 | Boosted navigation → navbar menu arrives closed | The entire justification for `defaultSettleDelay: 0` |
| 3 | Stats editor cycle; non-owner sees no Edit button | Reveal focuses the first input, live total tracks, Cancel restores, Save persists |
| 4 | Perk textarea round-trip | That `ability_perk_text[]` still persists — silent data loss otherwise |
| 5 | Deceased modal | `body.modal-open` prevents background scroll; exact-name gate with an apostrophe |
| 6 | Unlock-code modal | All four close paths; prior code gone on reopen |
| 7 | Offscreen mission edit with a linked source | "Other" fields start hidden while the select still shows the linked mission |
| 8 | Page editor on an existing page | Title and slug populate; saving without touching the slug does not change the URL |
| 9 | My Classes duplicate | One row's Duplicate opens only that row's modal, and submits |
| 10 | LFG controls | Create-form checkbox, join-form radios, calendar panel, per-participant Details, lazy-loaded join requests |
| 11 | Export dropdowns (character + class) | Second-click close, outside-click close, Escape close, both export links download |
| 12 | Back button after boosted navigation | htmx restores a snapshot taken after Alpine stripped `x-cloak` and wrote `:class` |
| 13 | **ar-h6rt** auth redirect | Address bar matches rendered page; navigating away does not bounce; `//evil.com` and `/\evil.com` still rejected; a boosted navigation is not undone by the 100 ms timer |

Spec 13 is not on the ar-7v3k list — it covers the acceptance criteria of the
`ar-h6rt` fixes on the current branch, which have the same
untestable-without-a-browser character.

## Failure policy

These are new tests against code that has never run in a browser. Some are
expected to fail, and a failure is the deliverable, not a problem to code
around.

When a spec fails: **stop, do not modify production code.** Record the failure,
its trace, and a diagnosis. This mirrors the convention already written into
`docs/superpowers/plans/2026-08-01-test-gap-remediation.md`:

> If a test fails, stop: you have likely found a real bug. Do not change
> production code to make it pass; report it.

The one legitimate exception is a spec whose *expectation* is wrong — a
misreading of intended behavior. That gets fixed in the spec, with a note in the
findings explaining why it was an expectation bug and not a product bug.

The pass ends with a findings table: check, verdict, trace path, diagnosis. The
user triages which failures are real before any fix is attempted.

## Artifacts and reporting

Trace, screenshot, and video retained on failure only (`retain-on-failure`), to
keep passing runs cheap. HTML report to `e2e/report/`. Both `e2e/.auth/` and
`e2e/report/` are added to `.gitignore`.

## CI

New `.github/workflows/e2e.yml`, mirroring the structure of
`.github/workflows/integration.yml`:

```
supabase start
supabase db reset
bun run seed:local
bunx playwright install --with-deps chromium
bun run test:e2e
```

Path filters match `integration.yml` plus `public/**`, `views/**`, and `e2e/**`,
since this tier is sensitive to client-side and template changes that the
integration tier ignores. The HTML report uploads as an artifact on failure.

## Documentation

`README.md` and `CONTRIBUTING.md` gain the fourth tier: what it covers, its
`supabase start` + `seed:local` prerequisites, and how to open a trace.

## Success criteria

- `bun run test:e2e` runs Chromium against a locally-booted app and executes all
  thirteen specs.
- Every item on the ar-7v3k "BLOCKING: manual browser verification" list has a
  corresponding automated spec, so the section can be replaced by a suite
  reference.
- A findings report enumerates every failure with a replayable trace.
- The existing three tiers and `bun run check` are unchanged and still green.
- A clean checkout with `supabase start` + `bun run seed:local` can run the tier
  with no further manual setup.
