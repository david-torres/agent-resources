# Admin Unlocks Dashboard — Design

**Date:** 2026-08-16
**Status:** Approved

## Problem

`/library/manage` does two jobs on one page. Each rules PDF renders a box
stacking the content edit form, a Grant Access form, the Current Unlocks
table, and a Generate Unlock Codes form. Every unlock row renders inline, so
a PDF with many unlocks makes its box — and the whole page — enormous.
Auditing access across PDFs means scrolling between per-PDF tables, and the
page must scale to hundreds of unlocks per PDF.

Class unlocks are explicitly **out of scope**: they keep their current
per-class code generation. This design covers rules PDF unlocks only.

## Decision

Split into two pages: `/library/manage` keeps content management only; a new
admin-only `/library/unlocks` dashboard owns all grant/unlock/code UI, built
around one filterable table per concern instead of per-PDF tables.

## Pages and Routes

### `/library/manage` (slimmed)

Keeps only:

- The Add New Rules PDF upload form.
- One edit box per PDF: title, edition, active toggle, replace/remove PDF.

All grant/unlocks/codes UI is removed. The route drops its per-rule
`listRulesPdfUnlocks` fan-out and just loads the PDFs. The page header gains
a button linking to `/library/unlocks`.

### `GET /library/unlocks` (new)

Admin-only (`isAuthenticated, requireAdmin`), renders
`views/library-unlocks.handlebars`. Loads:

1. `getRulesPdfs({ includeInactive: true })` — for the document
   selects/filters (inactive PDFs listed, marked as inactive).
2. `listAllUnlockGrantsAdmin()` — new model helper, all unlock grants.
3. `listAllUnlockCodesAdmin()` — new model helper, all unlock codes.

Breadcrumbs: Library → Manage → Unlocks. Nav: an "Unlock Dashboard" entry
under the Admin dropdown, added in `util/seed-nav.js` and
`supabase/seed.sql` (same pattern as Manage Pages).

### Existing endpoints

- `POST /library/:id/unlocks` (grant) — behavior unchanged, except the final
  redirect changes from `/library/manage` to `/library/unlocks`, where the
  form now lives.
- `DELETE /library/:id/unlocks/:userId` (revoke) — unchanged.
- `POST /library/:id/codes` (generate) — unchanged; still renders
  `partials/unlock-code-result`.
- `GET /library/:id/codes` (JSON list, never surfaced in any UI) —
  **deleted**. The dashboard renders codes server-side, so the endpoint is
  dead code.

No code-revoke endpoint. Deliberately out of scope for now.

### New model helpers

In `models/rules.js` backed by `services/rules/repository.js`:

- `listAllUnlockGrantsAdmin()` — same shape as the existing per-PDF
  `listUnlockGrantsAdmin(rulesPdfId)` (admin client, profile + granter
  joins, ordered by `unlocked_at` desc) but unfiltered, with the PDF's
  `title` and `edition` joined in so table rows can be labeled.
- `listAllUnlockCodesAdmin()` — all `rules_pdf_unlock_codes` rows via the
  admin client, PDF `title`/`edition` and the creator profile's name
  (`created_by` → `profiles`) joined in, ordered by `created_at` desc.

Hundreds of rows across a handful of PDFs load in one query each;
filtering happens client-side.

## Dashboard UI

Three blocks, top to bottom.

### Action panel

Two side-by-side forms (Bulma columns), compact versions of today's forms.
Each gains a **document select** (dropdown of all PDFs as
`Title — Edition`, inactive ones marked) since the forms no longer live
inside a PDF's box. A small script sets the form's action URL from the
selected document's id.

- **Grant Access**: document select, profile name *or* profile ID input,
  optional expires-at. Posts to `POST /library/:id/unlocks`.
- **Generate Codes**: document select, expires-at (code expiry), max uses,
  amount. Posts to `POST /library/:id/codes` via htmx with the existing
  form behavior (result into a `partials/unlock-code-result` target below
  the form, reset on success).

### Unlocks table

One table for all grants across all PDFs. Columns: Profile, Document
(`title — edition`), Granted, Granted by, Expires, revoke button (same
htmx delete-row pattern as today: `hx-delete`, `hx-confirm`,
`hx-target="closest tr"`).

Filter bar above it: document select, profile-name text filter, status
toggle (all / active / expired), defaulting to **active**. Expired rows get
a muted/danger tag so audits read at a glance.

### Codes table

All codes. Columns: Code, Document, Uses (`used_count/max_uses`), Expires,
Created, Created by. No actions column.

It shares the filter bar's document select with the unlocks table (one
document filter controls both tables) and has its own status toggle
(all / usable / not-usable), defaulting to **usable**. A code is not usable
when it is expired or `used_count >= max_uses`.

Empty states use the existing notification style ("No unlocks yet." /
"No codes yet.").

## Data Flow

The route computes display state server-side and stamps it onto each row as
data attributes:

- Grant rows: `data-document-id`, `data-profile-name`, `data-expired`
  (`expires_at` in the past).
- Code rows: `data-document-id`, `data-usable` (false when expired or
  `used_count >= max_uses`).

The filter bar is a small vanilla-JS script toggling row visibility off
those attributes — no server round-trips for filtering. Timestamps render
with the existing `date_tz` helper.

## Error Handling

- Any of the three dashboard loads failing → `sendError` with
  "Failed to load unlock dashboard".
- Grant/generate/revoke endpoints keep their existing error handling. A
  grant posted for a document deleted mid-session already 404s via the
  endpoint's `getRulesPdf` check.

## Testing

TDD, matching existing patterns:

- **View tests** `views/library-unlocks.test.js` (bun:test, rendering the
  real template like `views/my-classes.test.js`): unlock rows render with
  the filter data attributes; codes table renders uses/expiry; empty
  states render; document selects list inactive PDFs marked as such.
- **View tests** `views/library-manage.test.js`: the slimmed template no
  longer contains Grant Access / Current Unlocks / Generate Unlock Codes
  markup, and links to `/library/unlocks`.
- **Route tests** `routes/library-unlocks.test.js` (following
  `routes/pages.test.js` style): dashboard requires admin; renders with
  the three data sources; grant redirects to `/library/unlocks`;
  `GET /:id/codes` no longer exists.
- **Model tests** (extend the `models/rules-codes.test.js` pattern): the
  two new list-all helpers query the right tables with the joins and
  ordering above.
