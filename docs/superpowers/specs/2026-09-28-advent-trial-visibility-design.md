# Advent Trial Visibility — Design

Date: 2026-09-28
Status: Approved

## Goal

A user on the 30-day Advent free trial can never miss that they are on a
trial or when it ends. Once it expires, every surface where content silently
disappears or blanks says so explicitly. Locked Advent and Aspirant content is
teased — shown as "available if unlocked" — instead of hidden.

Success: a trial, expired, or no-access user is never confused about why
content is missing or when access ends.

This supersedes the deferral in
`2026-08-18-temporary-unlock-status-design.md`, which chose inline expiry
status only and postponed a site-wide banner.

## Background (current behavior)

- The trial is a `rules_pdf_unlocks` row for the Advent v1 core book
  (`STARTER_RULES_PDF_ID`) with `expires_at` = grant + 30 days
  (`models/profile.js` `grantStarterUnlocks`). An owner holds the same kind of
  row with `expires_at IS NULL`. No explicit trial flag exists.
- All access reads filter `expires_at IS NULL OR expires_at > now`, so an
  expired grant simply vanishes: catalog moves classes to "Other Released",
  wizard pickers drop them (possibly to empty), `applyDescriptionGate` blanks
  sheet descriptions, `/library/:id/view` returns a bare 403.
- "Days left" is computed only in `services/home/onboarding.js`
  (`adventDaysLeft`) and disappears once onboarding is dismissed.
- Aspirant has no trial; it is owned or not.

## Design

### 1. Edition access status (single source of truth)

**Repository** — `services/rules/repository.js` gains
`fetchCoreBookGrantsForUser({ userId })`: the user's `rules_pdf_unlocks` rows
joined to `rules_pdfs!inner` filtered to `book_type = 'core'`, returning
`{ rules_edition, expires_at }` for **every** row, expired included. Same
`{ data, error }` envelope as `fetchActiveBooksForUser`.

**Pure resolver** — new `services/access/edition-status.js`:

```js
resolveEditionStatus(grants, now) -> {
  advent:   EditionStatus,
  aspirant: EditionStatus,
}
EditionStatus =
  | { state: 'owned' }
  | { state: 'trial',   endsAt, daysLeft, urgent }   // urgent: daysLeft <= 7
  | { state: 'expired', endedAt }
  | { state: 'none' }
```

Rules, per edition:
- Any grant with `expires_at` null → `owned` (a redeemed code or purchase wins
  over a trial).
- Else any grant with `expires_at > now` → `trial`; `endsAt` is the latest
  active expiry; `daysLeft = ceil((endsAt - now) / day)`.
- Else any grant at all → `expired`; `endedAt` is the latest expiry.
- Else → `none`.

Editions are the keys of `CORE_CLASS_UNLOCKS`; unknown `rules_edition` values
are ignored.

**Service** — `getEditionAccess(userId, now)` composes the two. On a
repository error it returns `null` (fail quiet: no banner, no teasers) and
logs; it never blocks page rendering.

**Middleware** — for authenticated requests with a profile, set
`res.locals.editionAccess`. Registered next to where `util/auth.js` sets
`systemMessage`. Skipped for htmx partial requests that don't render the
layout (`HX-Request` without `HX-Boosted`) to avoid a query per fragment.

**Onboarding** — `computeOnboarding` takes `editionAccess.advent` instead of
`starterUnlock` and reads `daysLeft` from it; the inline `adventDaysLeft`
computation is deleted.

### 2. Purchase config

`util/starter-content.js` exports `EDITION_PURCHASE_URLS = { advent, aspirant }`
(advent: `https://enclave-aspirant.backerkit.com/hosted_preorders/822768`, aspirant: `https://enclave-aspirant.backerkit.com/hosted_preorders/822771`) and `EDITION_LABELS = { advent: 'Advent',
aspirant: 'Aspirant' }`. When a URL is falsy, CTAs render redeem-only.

CTA partial `views/partials/access/unlock-cta.handlebars` (params: `edition`)
renders "Buy {Label}" (external link, if configured) and "Redeem a code"
(links to the existing redeem flow).

### 3. Site-wide banner (non-dismissible)

`views/partials/access/access-banner.handlebars`, rendered in
`views/layouts/main.handlebars` directly under the nav, above the system
banner, whenever `editionAccess.advent` is `trial` or `expired`. No dismiss
control.

- `trial`, not urgent: Bulma `is-warning`, large text —
  **"ADVENT FREE TRIAL — {daysLeft} days left"** · "Ends {endsAt date}" · CTA.
- `trial`, urgent (≤ 7 days): `is-danger` — same copy, "day" singular at 1,
  "ends today" when `daysLeft` is 1 and end is today.
- `expired`: `is-danger` — **"Your Advent free trial ended {endedAt date}."**
  "Advent classes, character abilities and the rulebook are locked." · CTA.

Aspirant never produces a banner (no Aspirant trial exists).

### 4. TRIAL badges

While `advent` is `trial`, a `TRIAL · ends {date}` tag (warning, or danger
when urgent) appears on:
- Advent class cards in the catalog (`class-group-card`).
- The class view header, beside the existing "Access expires" tag.
- The Advent book card in the library.
- Profile "Available Classes" entries sourced from the book.

### 5. Inline errors when expired

When `advent` is `expired`, each surface that currently degrades silently
renders `alert/error` with the reason and CTA:
- **Character sheet** — top-of-sheet alert when `applyDescriptionGate` blanked
  any content: "Ability and gear descriptions are hidden because your Advent
  free trial ended {date}." (`applyDescriptionGate` reports whether it gated.)
- **Character wizard / form** — alert above the class pickers.
- **Library PDF** — `/library/:id/view` for an expired grant renders an error
  page (still HTTP 403) naming the end date with CTA, instead of the bare
  "No access". Non-expired no-access keeps a generic locked message with CTA.
- **Class view teaser** — `class-view-teaser` gains a header "Your Advent
  free trial ended {date}" above the teaser for Advent classes.
- **Catalog** — the Locked — Advent section (below) carries the ended notice.

### 6. Teasers for locked content

For every edition whose status is not `owned` (`trial` users are shown only
Aspirant as locked; Advent teasers apply once expired or none):

- **Catalog locked sections** — `partitionClassCatalog` in
  `util/class-filter.js` splits released core classes the user cannot access
  out of "Other Released" into "Locked — Advent" and "Locked — Aspirant".
  Section header: edition label, class count, CTA. Cards render dimmed with a
  lock icon and the first-sentence `teaser`, linking to the class teaser view.
- **Wizard pickers** — `filterClassDataForUser` keeps locked core classes,
  marked `locked: true` with `teaser_html`; the picker renders them as
  disabled options labelled "Unlock to play" under an edition group. Pickers
  are never empty solely because of missing unlocks. Selection of a locked
  class is still rejected server-side (existing validation unchanged).
- **Home and profile upsell panel** — `views/partials/access/edition-upsell.handlebars`
  per non-owned edition: "{Label}: {n} classes" with each class name and
  teaser, plus CTA. On home it renders independently of onboarding state.

Teaser data comes from the existing `classes.teaser` column; no new content.

## Error handling

- Status lookup failure → `editionAccess` null → no banner/badges/teasers;
  existing access checks still enforce gating. Logged.
- Missing purchase URL → redeem-only CTA.
- Dates rendered with the existing date helper in the user's display format.

## Testing (TDD, red → green → refactor agents)

- `services/access/edition-status.test.js` — owned/trial/expired/none,
  permanent-beats-trial, latest-expiry-wins, urgent boundary at 7 and 8 days,
  unknown editions ignored.
- Middleware test — sets `res.locals.editionAccess`; skips htmx fragments;
  null on repository error.
- `services/home/onboarding` tests updated to read days-left from status.
- View render tests — access banner (trial, urgent, expired, owned → none),
  TRIAL badges, catalog locked sections, wizard disabled options, sheet
  expired alert, library expired error page, class teaser header, upsell
  panel, CTA with and without purchase URL.
- `util/class-filter` tests for the locked-section partition.
- Run `bun run test:unit` (scrubs `SUPABASE_URL`); baseline 2591 pass / 0 fail.

## Out of scope

- Email or push reminders before expiry.
- Changing the trial length or grant mechanics.
- Sheet per-field teaser placeholders (declined; the sheet gets one alert).
