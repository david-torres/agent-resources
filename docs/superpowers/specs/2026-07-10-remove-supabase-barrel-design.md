# Remove the `util/supabase` global model barrel

- **Ticket:** ar-5kph (blocks ar-g8y7 "Sustainability hardening program")
- **Depends on:** ar-g1z6 (createApp composition) — closed
- **Date:** 2026-07-10
- **Type:** architecture refactor of already-tested code

## Problem

`util/supabase.js` eagerly `require`s 12 model modules and spreads their exports
into a single flat namespace:

```js
module.exports = { ...auth, ...profile, ...character, ...lfgPost, ...mission,
  ...classModel, ...pdfModel, ...rulesModel, ...pagesModel, ...navModel,
  ...agentTokenModel, ...offscreenMission };
```

This creates three concrete problems the ticket calls out:

1. **Hidden domain dependencies.** A file that imports `getCharacter` from the
   barrel gives no signal that it depends on the character domain; consumers'
   real domain coupling is invisible.
2. **Fragile export coupling.** Every consumer is bound to the barrel's combined
   export surface (147 names) rather than to the specific model it uses. Loading
   any consumer eagerly loads all 12 models.
3. **Oversized test mocks.** Because a route destructures ~25 names from the
   barrel at module load, each test must stub the whole set via
   `mock.module('../util/supabase', …)` even though only 1–2 are exercised on the
   path under test (see the ~20 throwaway stubs in
   `routes/classes-stat-spread.test.js`).

## Decisions

**Full removal, not a compatibility shim.** Replace every barrel import with
explicit `require('../models/<domain>')` imports of only the names each file
uses, then delete `util/supabase.js`. The barrel is internal-only (no consumers
outside this repo), so removal is low-risk, and a lingering shim would violate
the project's No Dead Code rule. The ticket permits either a full removal or a
reduced shim with an elimination plan; we choose full removal.

**Direct module requires, not dependency injection.** Consumers `require` the
specific `models/*` (and existing `services/*`) modules they need, matching the
service-seam pattern established in the five most recent commits. Application
wiring is already centralized in `createApp` (`app.js`, from ar-g1z6), which
mounts every router; that satisfies the acceptance criterion's "wiring is
centralized" clause without converting routers to injected factories. DI was
considered and rejected: the classic testability benefit is already provided by
bun's `mock.module`, so DI's only real gain here (removing the process-global
mock footgun) does not justify rewriting every router and all 8 test files —
that belongs to the queued quality/coverage tickets, not this one.

## Scope

### Determinism

All 147 barrel names are collision-free across the 12 models (verified: zero
duplicate export names), so each name maps to exactly one source model. The
substitution is mechanical and unambiguous.

### Production consumers (11 files)

Each file's barrel destructure(s) are replaced with one grouped `require` per
source model. Authoritative model grouping per consumer:

| Consumer | Imports from |
| --- | --- |
| `routes/pages.js` | `models/pages` |
| `routes/profile.js` | `models/profile`, `models/character`, `models/class` |
| `routes/library.js` | `models/rules`, `models/profile`, `models/pdf` |
| `routes/nav.js` | `models/nav`, `models/pages` |
| `routes/classes.js` | `models/class`, `models/profile`, `models/pdf`, `models/rules` |
| `routes/lfg.js` | `models/lfg`, `models/character` (`getOwnCharacters`) |
| `routes/missions.js` | `models/mission`, `models/character`, `models/class`, `models/offscreen-mission`, `models/profile` (`searchProfiles`) |
| `routes/characters.js` | `models/character`, `models/profile`, `models/lfg`, `models/mission`, `models/class` |
| `util/auth.js` | `models/auth` (`getUserFromToken`), `models/profile` (`getProfile`) |
| `util/nav-loader.js` | `models/nav` (`getNavItems`) |
| `util/redeem-code.js` | `models/class` (`redeemUnlockCode`), `models/rules` (`redeemRulesPdfUnlockCode`) |

Additional production edits:

- **`routes/missions.js:36`** — `const supabase = require('../util/supabase')`
  is dead (every runtime use is the request-scoped `res.locals.supabase`, never
  this module-level binding). Delete the line.
- **Delete `util/supabase.js`.**

### Test consumers (8 files)

Each test currently mocks the whole barrel (`mock.module('../util/supabase', …)`
or `'./supabase'`) plus a `realSupabase = require(...)` capture restored in
`afterAll`. Migrate each to mock only the specific source model(s) the route
under test **and** the real `isAuthenticated` middleware actually touch, and
restore those real modules in `afterAll` instead of the barrel:

- `routes/badges.test.js`
- `routes/character-level-up.test.js`
- `routes/classes-stat-spread.test.js`
- `routes/character-wizard.test.js`
- `routes/missions.test.js`
- `routes/characters.test.js`
- `util/auth.test.js`
- `util/redeem-code.test.js`

The exact per-test mock set is determined empirically during implementation: run
the suite, and mock only the modules the failures actually require (typically
the route's domain model plus `models/auth` + `models/profile` for the auth
middleware). The throwaway stubs for names never called on the path are dropped
— this is the mock-shrinkage payoff the ticket targets.

Note: `isAuthenticated` (in `util/auth.js`) currently obtains
`getUserFromToken`/`getProfile` from the barrel. After the refactor it imports
them from `models/auth` and `models/profile`, so tests exercising the real
middleware mock those two modules instead of the barrel.

## Non-goals

- No dependency injection / router-factory conversion.
- No changes to model or service internals, or to `res.locals.supabase` (the
  request-scoped PostgREST client) — unrelated to the barrel.
- No new behavior; this is a structural refactor only.

## Verification

Because this is a refactor of already-tested code, the bar is that existing
behavior is preserved, not a new TDD cycle. Done when **both** hold:

1. The full test suite passes (`bun test`, per `scripts/run-tests.mjs`).
2. Searching for imports of the barrel path — `require('../util/supabase')` and
   the relative `require('./supabase')` (from `util/`) in any `.js` file —
   returns **zero** hits, and `util/supabase.js` no longer exists. (This does not
   match `models/_base`, whose require path contains no "supabase".)

## Risks

- **Missed cross-domain name.** Mitigated by the authoritative collision-free
  mapping above; any leftover barrel reference is caught by the grep gate.
- **Test mock leakage.** bun's `mock.module` is process-global; each migrated
  test must restore the real source modules in `afterAll` (mirroring the current
  `realSupabase` restore) to avoid cross-file leakage.
