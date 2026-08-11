# Consolidate service-role access behind repositories

- **Ticket:** ar-ezes (blocks ar-m8ai "Complete character mutation service boundary" and ar-g8y7 "Sustainability hardening program")
- **Depends on:** ar-5kph (barrel removal) — closed
- **Date:** 2026-07-10
- **Type:** architecture / security refactor of already-tested code

## Problem

The service-role client `supabaseAdmin` (which bypasses row-level security) is
imported and used directly across 3 routes and 11 models — 159 call sites in
production code. Two concrete problems follow:

1. **Distributed authorization with RLS bypassed.** Because privileged
   persistence is scattered, every caller is individually responsible for
   authorizing the actor before touching data that RLS would otherwise protect.
   Authorization checks live in routes, ad hoc and easy to miss. A route that
   forgets the ownership check performs an unauthorized privileged mutation with
   no backstop.
2. **No reviewable privileged-access boundary.** There is no single layer a
   reviewer can read to answer "what privileged operations exist and who may
   perform them." `supabaseAdmin` usage is spread across route handlers, large
   read-heavy model files, and anonymous inline write adapters
   (e.g. `models/class.js:494`).

## Decisions

All five decisions below were made explicitly during brainstorming.

**Scope: foundation + all domains.** Fully satisfy every acceptance thread —
(a) no route imports the service-role client, (b) repositories encapsulate
privileged persistence, (c) services receive actor context and use
capability-oriented methods, (d) authorization tests cover each privileged
command — across all domains. The dependent ticket ar-m8ai is left near-empty.

**Read boundary: all privileged data access.** Repositories own *every*
`supabaseAdmin` read and write across all 11 models and 3 routes — privileged
writes, load-for-authz reads, and unrelated privileged reads (badge counters,
listings) alike. After this ticket, `supabaseAdmin` is imported in exactly two
places: `models/_base.js` (which constructs it) and `services/*/repository.js`.

**Actor context: explicit actor argument per call.** Services stay module
singletons. Every capability method takes the actor as its first parameter —
`characterService.deleteCharacter(actor, id)`. Actor is data, not a dependency,
so this stays consistent with ar-5kph's decision to use direct module requires
rather than dependency injection. The route builds the actor from `res.locals`
and passes it in.

**Repository layout: colocated per domain.** Each domain's privileged access
lives in `services/<domain>/repository.js`, beside its existing `input.js`,
`service.js`, and tests. A domain's full write/authz boundary lives in one
folder ("files that change together live together"), matching the established
`services/` structure.

**Authorization shape: dedicated per-domain policy module.**
`services/<domain>/policy.js` exposes pure predicates —
`canDeleteCharacter(actor, resource) → true | { reason }` — with no I/O. The
capability method loads the resource via the repository, calls the policy, and
refuses on denial. Policies unit-test in isolation, directly satisfying "authz
tests per privileged command."

**Denial signal: throw a typed `AuthorizationError`.** On policy denial the
capability method throws `AuthorizationError` (carrying `code: 'forbidden'`).
An unchecked authorization result cannot silently fall through to a mutation —
the exact footgun this ticket targets. This diverges from the codebase's
`{ data, error }` return convention, which is acceptable precisely because authz
denial must not be ignorable.

## Layered architecture

| Layer | File | Responsibility | Imports `supabaseAdmin`? |
| --- | --- | --- | --- |
| Base | `models/_base.js` | Sole constructor of `supabase` (anon/RLS) and `supabaseAdmin` (service-role) | — (defines it) |
| **Repository** | `services/<domain>/repository.js` | All privileged data access for the domain — reads and writes. Intention-named methods returning `{ data, error }`. No authorization. | **Yes — the only consumer** |
| **Policy** | `services/<domain>/policy.js` | Pure predicates `canX(actor, resource) → true \| { reason }`. No I/O. | No |
| **Service** | `services/<domain>/service.js` | Capability methods `(actor, …)`. Per privileged command: load via repo → consult policy → throw `AuthorizationError` on denial → mutate via repo. Returns `{ data, error }` for DB/domain errors; throws only for authz. | No |
| Route | `routes/*.js` | Builds actor from `res.locals`, calls `service.capability(actor, …)`. Never imports `supabaseAdmin`. | No |

### Data flow (privileged command)

```
route handler
  → actorFromLocals(res.locals)            // { userId, profileId, isAdmin }
  → service.deleteCharacter(actor, id)
      → repo.loadCharacter(id)             // privileged read behind repo
      → policy.canDeleteCharacter(actor, char)
          denied  → throw AuthorizationError → asyncHandler → central handler → sendError → 403
          allowed → repo.deleteCharacter(id) → { data, error }
```

## Cross-cutting foundation (one shared task, TDD)

- **`util/actor.js`** — `actorFromLocals(res.locals) → { userId, profileId, isAdmin }`.
  One definition of "who is acting," derived from the authenticated user/profile
  and the agent/admin flag set by `util/auth.js`.
- **`util/errors.js`** — `AuthorizationError` (typed, `code: 'forbidden'`).
- **`util/async-handler.js`** — wraps an async route handler so a rejected
  promise forwards to `next(err)`. Required because routes today are
  inconsistent (some `try/catch`, most not) and Express 4 does not catch async
  throws; without it a thrown `AuthorizationError` becomes an unhandled
  rejection and never reaches the central handler at `app.js:87`. Applied to
  every privileged route handler.
- **`util/http-error.js`** — `classifyError` gains an
  `AuthorizationError` / `code: 'forbidden'` → **403** case, so both the central
  error handler and direct `sendError` calls map denials consistently.

## Scope — domain inventory

Privileged call sites per production file (`supabaseAdmin`), and whether a
`services/<domain>/` already exists:

| Domain | Model sites | Route sites | Service today? |
| --- | --- | --- | --- |
| lfg | `models/lfg.js` (30) | — | yes |
| character | `models/character.js` (24) | `routes/characters.js` (17) | yes |
| mission | `models/mission.js` (17) | — | yes |
| badge | `models/badge.js` (15) | — | **no (create)** |
| class | `models/class.js` (13) | — | yes |
| profile | `models/profile.js` (10) | — | **no (create)** |
| bot-link | `models/bot-link.js` (7) | `routes/bot-link.js` (2) | **no (create)** |
| agent-token | `models/agent-token.js` (6) | — | **no (create)** |
| rules | `models/rules.js` (5) | — | **no (create)** |
| pdf | `models/pdf.js` (5) | — | **no (create)** |
| agent | — | `routes/agent.js` (4) | uses agent-token / bot-link repos |

Additional non-domain site: **`util/auth.js:149`** sets
`res.locals.supabase = supabaseAdmin` for agent-authenticated requests, so agent
reads currently bypass RLS through shared model read functions. Under this
design those agent read paths move to repository privileged reads and the
admin-on-`res.locals` assignment is removed; the agent actor carries `isAdmin`
so services authorize agent requests correctly.

## Decomposition (independently shippable slices)

1. **Foundation** — the four `util/*` pieces above, with tests. No behavior
   change to existing routes yet.
2. **Per domain** — extract `repository.js` (move the model's admin reads and
   writes, and any route-level admin queries, behind named methods), add
   `policy.js`, convert or create the actor-context capability service, rewire
   routes to build and pass `actor` and drop the `supabaseAdmin` import, and add
   an authorization test per privileged command.
3. **Order** — validate the whole pattern end-to-end on **class** (smallest at
   13 sites, already has a service) first; then the remaining domains, largest
   last (`character` incl. its route, then `lfg`).

Existing services already delegate writes to an inline adapter; that adapter's
body moves verbatim into `repository.js`, and the service gains the actor
parameter and policy consultation. Domains without a service get a fresh
`services/<domain>/` created in the same shape. Model files retain only their
non-privileged, RLS-scoped read functions (which take a client parameter);
models that are entirely privileged (bot-link, agent-token, pdf) may reduce to a
thin re-export or fold into the repository.

## Non-goals

- No change to RLS policies themselves.
- No change to the anon/RLS-scoped read paths that already work
  (`res.locals.supabase` for web routes remains the request-scoped client).
- No dependency injection / router-factory conversion (actor is passed as data).
- No new features; this is a structural/security refactor only.

## Verification

Done when all hold:

1. The full suite passes (`bun run test:unit` and `bun run test:http`, per
   `scripts/run-tests.mjs`; integration remains CI-gated).
2. `supabaseAdmin` appears **only** in `models/_base.js` (its definition) and
   `services/*/repository.js`. A grep across `routes/`, `util/`, and non-`_base`
   `models/` for `supabaseAdmin` returns **zero** hits in production `.js`.
3. Every privileged command has an authorization test asserting that a
   non-authorized actor is refused (via `AuthorizationError` → 403) and an
   authorized actor succeeds.

## Risks

- **Behavioral drift on the agent admin-read path.** Removing
  `res.locals.supabase = supabaseAdmin` changes how agent reads reach data.
  Mitigated by routing agent reads through repository privileged reads and
  covering agent flows with the existing `routes/agent.js` / bot-link tests plus
  new authz tests.
- **Async throw not reaching the handler.** Mitigated by `util/async-handler.js`
  on every privileged route handler and the `classifyError` 403 mapping;
  verified by an authz test per command that asserts the 403.
- **Large surface (159 sites).** Mitigated by the per-domain decomposition —
  each slice is independently testable and shippable, and the grep gate catches
  any leftover privileged reference.
