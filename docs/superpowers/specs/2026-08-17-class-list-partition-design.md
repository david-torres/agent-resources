# Class List Page: Released / PCC Partition — Design

**Date:** 2026-08-17
**Status:** Approved

## Goal

Reorganize the public class list page (`GET /classes`) so official/released
classes appear first, with player-created classes (PCCs) in a second section
below. PCC cards do not show thumbnail art.

## Partition Rule

Reuse the semantics already established on the profile page
(`partitionProfileClasses` in `util/class-filter.js`):

- A class belongs to the **PCC section** when `is_player_created` is true AND
  `status !== 'release'`.
- Everything else — official classes and released PCCs — belongs to the
  **Released section**. A released PCC has been incorporated into the game, so
  it graduates: it shows with the officials (thumbnail included) and never
  appears in both sections.

## Changes

### `util/class-filter.js`

- Extract the released/PCC predicate shared by `partitionProfileClasses` so the
  rule lives in one place.
- Add `partitionClassGroups(groups)`: takes the version-grouped array of
  `{ primary, previous }` produced by `groupClassVersions` and returns
  `{ released, pcc }`, partitioning by each group's `primary`. Group order is
  preserved within each partition.
- `partitionProfileClasses` behavior is unchanged; the profile page is
  unaffected.

### `routes/classes.js` — `GET /`

- After version grouping (both the grouped and the version-filtered flat
  paths), call `partitionClassGroups` on the result.
- Render `classes` with `releasedGroups` and `pccGroups` instead of the single
  `classGroups` variable (replacing it — no dual support).
- Filters are applied before partitioning, so they keep working unchanged.
  E.g. Type = "Player Created" yields unreleased PCCs in the PCC section and
  any released PCCs in the Released section.

### `views/classes.handlebars`

- Extract the current ~55-line class card markup into a partial
  (`views/partials/class-group-card.handlebars`) accepting the group plus a
  `showImage` flag. The `card-image`
  block renders only when `showImage` is true and `primary.image_url` is set.
- Render two sections, matching the profile page's heading language:
  1. **"Released Classes"** — existing card grid, `showImage` true.
  2. **"Player-Created Classes (PCCs)"** — same card grid, `showImage` false
     (no `card-image` markup at all, even when the class has art).
- Each section (heading + grid) renders only when its partition is non-empty.
  When both are empty the page shows what it shows today for zero results.
- Admin-only "Private" tag, status tags, previous-version links, and teaser
  text behave exactly as today in both sections.

## Testing (TDD)

- Unit tests for `partitionClassGroups`: official → released; unreleased PCC →
  pcc; released PCC → released; order preserved; empty input.
- View test alongside the existing handlebars tests verifying: both sections
  render with their headings, PCC cards contain no image markup, released
  cards keep thumbnails, and an empty partition hides its section.

## Out of Scope

- No changes to filters, `my-classes`, the profile page, or the underlying
  queries.
- No literal HTML table — the PCC section stays a card grid (user decision).
