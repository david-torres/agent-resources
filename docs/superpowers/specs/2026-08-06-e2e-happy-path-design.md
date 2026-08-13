# E2E Happy-Path Coverage — Design

**Date:** 2026-08-06
**Branch:** `e2e-happy-path` (stacked on `virtual-party-tool`)

## Problem

The existing browser tier (`e2e/specs/00-16`, 83 tests) is built entirely from
*regression* checks: each spec targets one previously-identified defect
mechanism — an Alpine settle race, an htmx swap, a back-button restore. Nothing
in it walks a feature end to end. The result is a suite that passes at 80/83
while basic operations are broken in the running app.

Manual testing found character delete completely non-functional. Mapping that
one report turned up two independent root causes, neither of which any existing
test could have caught, plus two more dead delete buttons elsewhere in the app.
That ratio — one reported symptom, four real defects — is the argument for
happy-path coverage as its own tier of specs.

## Goals

1. Cover the create → view → edit → delete lifecycle of every major feature as
   a signed-in user, driving the real UI.
2. Fix the defects that coverage exposes, red-green, on this branch.
3. Leave behind specs that fail loudly when a basic operation breaks, rather
   than requiring a human to notice.

## Non-goals

- Multi-user, permission, and negative-path testing. Happy path only; the
  access-control surface is the http tier's job.
- Fixing the two pre-existing deliberately-red specs
  (`03b-class-reassignment`, `13-page-slug:506`). Both are documented
  characterization tests. `13`'s cause is a systemic anon-client RLS problem in
  `models/pages.js`; if it also blocks spec 23, that gets reported, not
  refactored here.
- Badge grant/revoke (`26`). Two plain forms, no delete path, lowest risk.

## Defects this branch fixes

### D1 — the edit-page Delete button serialises the whole form into the URL

`views/character-form.handlebars:388` sits inside the `<form hx-put=…>` opened
at `:14`. htmx 2.0.8 defaults `methodsThatUseUrlParams` to `['get', 'delete']`,
and for non-GET verbs `getInputValues` includes the *related form*. Clicking
Delete therefore issues:

```
DELETE /characters/<uuid>?name=…&class_id=…&perks=<toast-editor markdown>&…
```

with 20 named fields plus 7 rich-text areas. Any non-trivial character exceeds
Node's 16 KB `maxHeaderSize` (the request line counts against it) and is
rejected with a 431 or a connection reset before Express sees it. A nearly-empty
character fits and succeeds — hence "works in dev, broken in real use".

**Fix:** set `methodsThatUseUrlParams` to `['get']` in the `htmx-config` meta at
`views/partials/head.handlebars:4`. No DELETE route in the app reads query
parameters — all are path-based — so the blast radius is limited to suppressing
the unwanted serialisation. Chosen over a local `hx-params="none"` because it
disarms the footgun for every future `hx-delete` placed inside a form.

Alongside it, remove the three inert `hx-redirect` attributes
(`character-form.handlebars:15`, `:389`, `views/mission.handlebars:84`).
`hx-redirect` is not an htmx attribute and is implemented nowhere in
`public/js/`; the redirect actually comes from the server's `HX-Location`
header. The attributes are misleading markup.

### D2 — `lfg_join_requests.character_id` has no `ON DELETE` action

`supabase/migrations/20240101000000_baseline_schema.sql:222` declares
`character_id UUID REFERENCES characters(id)` with no action. Verified against
the live local database: it is the only FK targeting `characters` with
`confdeltype = 'a'`; the other six all cascade.

Any character that has ever joined an LFG game therefore cannot be deleted from
*either* trigger. Postgres raises `23503`; `classifyError`
(`util/http-error.js:8-38`) has no branch for it, so it becomes a bare 500
reading "An unexpected error occurred." — no indication of cause. The repo
already works around this FK in fixture cleanup (`e2e/fixtures/db.js:37-49`).

**Fix:** a migration setting `ON DELETE SET NULL`. The column is already
nullable, and join requests carry their own `join_type`/`status`, so a host's
roster and history stay intact when a player deletes an old character —
preferred over `CASCADE`, which would silently remove players from a host's
post.

Separately, classify `23503` in `util/http-error.js` as a 409 with an
actionable message, so the next missing cascade surfaces as a diagnosis rather
than a blank 500.

### D3 — the class delete buttons are inert, for two different reasons

**D3a — the 204.** `DELETE /classes/:id` (`routes/classes.js:746`) and
`DELETE /pages/:id` (`routes/pages.js:138`) return `204 No Content`. htmx does
not swap on 204, so the delete buttons at `my-classes.handlebars:115` and
`pages-manage.handlebars:65` do nothing visible until a manual reload — the
delete succeeds, the row stays on screen.

**Fix:** return `HX-Location` as the character, mission, and LFG delete routes
already do.

**D3b — the unresolvable target.** `class-view.handlebars:29` carried
`hx-target="closest tr" hx-swap="outerHTML"` on a page that contains no `<tr>`
and no `<table>` at all. htmx aborts inside `issueAjaxRequest` with
`htmx:targetError` *before* it evaluates `hx-confirm`, so this button issued no
request, raised no confirm dialog, and surfaced no error (there is no
`htmx:targetError` listener in `public/js/app.js`). Verified with an isolated
htmx probe: 0 DELETE requests, 1 `targetError`, no dialog. `HX-Location` cannot
rescue a request that is never sent, so D3a does not fix this button.

**Fix:** drop `hx-target`/`hx-swap` from the button. With `HX-Location` the
target is irrelevant — it only has to resolve, and the default (the element
itself) does.

Found while mapping rather than reported; specs 21 and 23 cannot pass without
D3a, and spec 21's detail-page delete test cannot pass without D3b.

## Spec inventory

Numbering continues the existing 00–16 series.

### Player-facing (`PLAYER_STATE`)

| Spec | Feature | Lifecycle |
|---|---|---|
| `18-characters-crud` | Characters | expert-form create → view → edit → delete |
| `19-character-wizard-crud` | Characters | wizard create → view |
| `20-missions-crud` | Missions | create → view → edit → attach/detach character → delete |
| `21-lfg-crud` | LFG | create → view → edit → join → leave → delete |
| `22-classes-crud` | Player-created classes | create → view → edit → delete |
| `23-profile-crud` | Profile | view → edit → round-trip |

### Admin-facing (`ADMIN_STATE`)

| Spec | Feature |
|---|---|
| `23-pages-crud` | CMS pages create → view → edit → delete |
| `24-nav-crud` | Navbar items create → edit → delete |
| `25-library-crud` | Rules PDFs upload → view → unlock grant/revoke |

Sequencing: 17 first, so character delete is fixed early. Player-facing specs
before admin-facing.

## Test approach

**Create runs through the real UI.** Filling the actual form is the point of a
happy-path test; fixture-seeding the create step would skip the code most likely
to be broken. Fixtures cover *prerequisites* only — most importantly, a class
must exist and be unlocked via `unlockClassForProfile` before a character is
created or edited, or the spec hits the unrelated `03b` reassignment defect.

**Deletion is asserted in Postgres, not the DOM.** Every lifecycle ends by
deleting what it created and confirming the row is gone via `expect.poll`
against a direct `pg` query. Asserting the DOM alone is exactly what would miss
D3, where the row disappears from view only after a reload — or worse, appears
to.

**House conventions are followed as-is:** `NN-topic.spec.js`; per-file
`newPrefix()`; seed in `beforeAll`; a single `cleanupByPrefix` in `afterAll`
inside `try/finally`; real markup IDs as selectors (the repo has no
`data-testid` anywhere); `test.use({ storageState })` per file or per describe;
`test.describe.configure({ mode: 'serial' })` only where a test permanently
mutates shared fixture state, with the reason stated in the header.

**Each file opens with a header comment** naming the mechanism under test and
the vacuity traps the assertions are built to avoid — matching the standard set
by `14-lfg-controls.spec.js` and `00-smoke.spec.js`. The specific trap this
tier must close: *a lifecycle test passes vacuously if the create step silently
failed.* Every stage asserts its own effect landed in the database before the
next stage runs.

## Baseline

**Corrected 2026-08-07: the branch-point baseline is 83/83 passing — zero
failures.**

An initial measurement recorded 80 passed / 2 failed / 1 flake, attributing the
failures to `03b-class-reassignment.spec.js:81` and `13-page-slug.spec.js:506`.
That did not reproduce. Two consecutive serial full runs after Task 1, with no
production code changed, gave 86/86 (83 pre-existing + 3 new). The cause of the
original failures was not confirmed; the likeliest candidates are an
incompletely seeded local database at the time of measurement, or a concurrent
session mutating the same local Supabase, which is shared across worktrees.

Consequences:

- `03b`'s header still declares it expected-to-fail, but per its own text
  ("if it starts passing because someone actually fixed the underlying bug,
  that's the correct way for it to go green") the class-reassignment fix
  appears to have already landed on `virtual-party-tool`. The header is now
  stale; updating it is out of scope here.
- The "Non-goals" entry about leaving two red specs alone is therefore moot in
  practice — there are none to leave alone.
- Verification expects zero failures, not two. A tolerance of two would
  silently absorb two real regressions.
- `11-export-dropdowns.spec.js:186` has been seen to fail under parallel
  workers and pass serially; treat a recurrence as flake only after confirming
  it passes with `--workers=1`.

## Verification

- Each new spec passes against a local Supabase (`supabase start`,
  `bun run seed:local`).
- The full suite ends at 80 + new tests passing, with the same 2 deliberate
  failures and no new ones.
- Each defect fix is committed as a red spec first, then the fix, so the spec is
  demonstrated to fail without it.
- `bun run test:unit`, `test:http`, and `test:integration` stay green — D1's
  config change and D3's response-shape changes are reachable from the http
  tier.
