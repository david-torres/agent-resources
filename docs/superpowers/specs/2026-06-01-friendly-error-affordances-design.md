# Friendly Error Affordances — Design

**Date:** 2026-06-01
**Status:** Approved (pending spec review)

## Problem

Users sometimes land on a blank page showing the raw string:

> JSON object requested, multiple (or no) rows returned

This is PostgREST's `PGRST116` error, thrown by Supabase `.single()` whenever a
query returns zero rows (or more than one). In this app the dominant cause is
Row Level Security: a user requests a character / class / mission they don't own
or that isn't public, RLS filters the result to zero rows, and `.single()`
throws. Routes then do `res.status(400).send(error.message)` (~30+ sites), which
dumps the raw PostgREST string onto an otherwise blank page with no navigation,
no explanation, and no way forward.

The same blank-page problem affects other failure paths that funnel through the
same `res.status(400).send(error.message)` pattern.

## Goals

- Replace the blank page + cryptic string with a **styled, full-page error**
  that keeps the app's layout (nav + branding) and gives the user a way back.
- Use **friendly, generic** copy that does not leak whether a given record
  exists (matching RLS's inherent not-found / no-permission ambiguity).
- **Centralize** error responses so all ~30 manual sites and the global error
  handler converge on a single, tested code path.

## Non-Goals

- Distinguishing "not found" from "no permission" with extra existence-probe
  queries. We intentionally collapse 404 and 403 to the same user-facing copy.
- Reworking unrelated error handling or refactoring routes beyond swapping the
  response call.
- Changing API/JSON (`/api/agent`) response shapes.

## Design

### Component 1 — Error classifier (`util/http-error.js`)

A pure function that maps a Supabase / Postgres error (or a plain error / null)
to a normalized descriptor. Pure and dependency-free so it is trivially unit
testable.

```
classifyError(error, fallback = {}) -> { status, title, message }
```

Mapping:

| Input (`error.code`)            | status | title          | message                                                    |
|---------------------------------|--------|----------------|------------------------------------------------------------|
| `PGRST116`                      | 404    | Not found      | We couldn't find that, or you don't have access to it.     |
| `42501` (RLS / permission)      | 403    | No access      | We couldn't find that, or you don't have access to it.     |
| `23505` (unique violation)      | 409    | Already exists | That already exists.                                       |
| anything else / unknown         | 500    | Something went wrong | An unexpected error occurred. Please try again.      |
| `error` is null/falsy           | uses `fallback` (default 404 Not found) |                                       |

Notes:
- 404 and 403 deliberately share the same `message` (friendly-generic;
  no existence leak). The `title` differs only to aid the styled page tone.
- `fallback` lets callers override `status` / `title` / `message` per-site
  (e.g. an explicit "Source mission not found.").
- In production the 500 branch must never surface a raw `error.message`. In
  non-production it MAY include the raw message for debugging, mirroring the
  existing `NODE_ENV` check in the global handler.

### Component 2 — Response helper (`util/http-error.js`)

A single helper every site calls instead of `res.status(...).send(...)`:

```
sendError(req, res, error, opts = {}) -> void
```

Behavior:
1. `descriptor = classifyError(error, opts)` (opts may override status/title/message).
2. If `res.headersSent`, return (guard, matches global handler).
3. Branch on request context:
   - **HTMX** (`req.get('HX-Request')`): respond with a `notification is-danger`
     inline fragment, setting `HX-Retarget: #alerts` and `HX-Reswap: innerHTML`
     so the message lands in the layout's alerts region.
   - **HTML navigation** (`req.accepts('html')`): `res.status(descriptor.status)`
     then `render('error', descriptor)` — full page inside the `main` layout.
   - **Otherwise** (API / non-HTML `Accept`, e.g. `/api/agent`): `res.status(...)
     .json({ error: descriptor.message })` — preserves current JSON behavior.

`opts` fields: `{ status?, title?, message? }`. Used by sites that currently
send a custom message (e.g. "Character not found", "Source mission not found.")
and by ownership checks (see Component 4).

### Component 3 — Error view (`views/error.handlebars`)

Full-page error rendered inside the existing `main` layout, so nav and branding
remain. Minimal content:
- `title` (from descriptor)
- `message` (the friendly line)
- A "Back to home" link/button (`/`).

Bulma classes consistent with the rest of the app (`notification`/`section`/
`container`, `button`). No logo/illustration or extra links in v1.

### Component 4 — Site conversion (convert-all)

Replace the ~30 `res.status(400).send(error.message)` (and related
`res.status(40x).send(...)`) sites across `routes/characters.js`,
`routes/classes.js`, `routes/missions.js`, `routes/pages.js`, `routes/lfg.js`,
`routes/profile.js`, etc. with `sendError(req, res, error, opts?)`.

- Sites with a custom not-found message pass it via `opts.message` / `opts.title`.
- Explicit ownership checks that currently do
  `if (x.creator_id !== profile.id) return res.status(403).send('Forbidden')`
  are folded into the helper:
  `return sendError(req, res, null, { status: 403, title: 'No access', message: "We couldn't find that, or you don't have access to it." })`
  so they get the styled page too (approved).
- Preserve existing intentional special-cases (e.g. `23505` duplicate-source
  handling) — these now route through `classifyError` / `sendError` rather than
  bespoke `res.send`, with `opts` carrying any custom copy.

### Component 5 — Global error handler (`index.js`)

Rewire the existing `app.use((err, req, res, next) => ...)` to delegate to the
same `classifyError` + `sendError` path, so thrown/bubbled errors get identical
treatment to the manual sites. Keep the `res.headersSent` guard and the
`NODE_ENV === 'production'` message suppression.

**Bonus fix:** the current handler sets `HX-Retarget: #alert`, but the layout's
region is `id="alerts"` (`views/layouts/main.handlebars`). This mismatch means
HTMX error swaps silently no-op today. Standardize on `#alerts`.

## Data Flow

```
route handler
  └─ const { data, error } = await model(...)
       └─ if (error || !data)
            └─ return sendError(req, res, error, { /* optional copy */ })
                 └─ classifyError(error, opts) -> descriptor
                      ├─ HTMX  -> 1 inline `notification is-danger`, HX-Retarget #alerts
                      ├─ HTML  -> res.status(status).render('error', descriptor)
                      └─ API   -> res.status(status).json({ error: message })
```

Thrown/uncaught errors reach the global handler, which calls the same
`sendError`.

## Error Handling / Edge Cases

- `res.headersSent` guarded in `sendError` and global handler.
- Null/empty error (`error || !data`) → classifier `fallback` (default 404).
- Production vs non-production message detail handled centrally in
  `classifyError` (500 branch), removing per-site `NODE_ENV` logic.
- API routes keep JSON responses via the `req.accepts('html')` branch.

## Testing

Test-first (red-green-refactor per global CLAUDE.md), using the existing
`bun test` setup and the style in `routes/bot-link.test.js`.

- **Classifier (`util/http-error.test.js`)** — pure-function unit tests:
  `PGRST116 → 404`, `42501 → 403`, `23505 → 409`, unknown → 500, null →
  fallback, `opts` override precedence, production vs non-production 500 message.
- **Helper (`sendError`)** — three-branch tests with mock `req`/`res`:
  - HTMX → `notification is-danger` body + `HX-Retarget: #alerts` +
    `HX-Reswap: innerHTML`, correct status.
  - HTML → `render('error', descriptor)` with correct status.
  - JSON → `{ error: message }` with correct status.
  - `res.headersSent` short-circuit.

## Rollout / Sequencing

1. Build + test the classifier (pure).
2. Build + test `sendError` helper.
3. Add `views/error.handlebars`.
4. Rewire the global error handler; fix `#alert` → `#alerts`.
5. Convert route sites file-by-file, running the suite between files.

## Open Questions

None outstanding. `error.handlebars` kept minimal (title + message + Back to
home); ownership 403 checks folded into the styled page — both confirmed.
