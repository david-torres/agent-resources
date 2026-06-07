# Classes List: Collapse Version Families

## Problem

The Classes list page (`GET /classes`) renders every class as a flat card
grid. When a class has multiple versions (a `v1 → v2` upgrade chain linked via
`base_class_id`), each version gets its own card. This clutters the list with
near-duplicates and buries the current version among older ones.

We want to collapse each version family to a single card showing the latest
version, while still linking to previous versions.

## Background

- Classes form **version families** via `base_class_id`. A family is the
  connected component over those links, **restricted to edges where parent and
  child share `rules_edition`** (edition forks start a new family). This is
  already implemented in `util/class-family.js` (`computeVersionFamily`).
- In practice chains are linear `v1 → v2` forks (`rules_version` ∈ {`v1`,`v2`}).
- Each class has a `status` (`alpha`/`beta`/`release`) and may be private
  (`is_public = false`, admin-only visibility).
- The list route already filters by edition/version/status/type and limits
  non-admins to public classes.

## Decisions

- **Primary (shown) version = leaf of the chain**: the family member with no
  same-edition child *within the visible group*, tiebroken by most recent
  `created_at`. For a `v1 → v2` chain this is `v2`.
- **Scope = all families**: both official and player-created classes collapse.
- **Version filter = flat**: when the user selects a specific Rules Version
  (`v1` or `v2`), collapsing is disabled and each matching class is shown
  individually — they explicitly asked for a version.
- **Previous versions = inline links** under the card subtitle.

## Design

### 1. Grouping logic — `util/class-list-grouping.js` (new, pure)

Export `groupClassVersions(classes)`:

- Operates **only on the classes in the passed-in list** (not the full DB
  family). This guarantees we never surface a version the current viewer can't
  access — private or filtered-out versions simply don't appear, and a chain
  with a missing intermediate degrades into separate groups.
- Partition the list into families using the same-edition `base_class_id`
  adjacency from `class-family.js` (`computeVersionFamily`), seeded over the
  in-list rows only.
- For each family, pick `primary` = the member with no same-edition child
  present in the group; if several qualify (branching), pick the most recent
  `created_at`.
- `previous` = the family's remaining members, sorted newest-first
  (`created_at` descending).
- Return an ordered array of `{ primary, previous }`. Group order follows the
  first appearance of each family among the input rows — no reordering.

### 2. Route wiring — `routes/classes.js` (`GET /`)

After `getClasses(filters, …)`:

- If `filters.rules_version` is a specific value (`v1`/`v2`): build a flat list
  by mapping each class to `{ primary: class, previous: [] }` (no collapse).
- Otherwise: `classGroups = groupClassVersions(classes)`.
- Render with `classGroups` (replacing the raw `classes` local).

Applies to `GET /classes` only. `GET /classes/my` is unchanged.

### 3. View — `views/classes.handlebars`

- Loop over `classGroups`, rendering `this.primary` exactly as the card renders
  today (image, status tags, Private tag, `{{edition}} {{version}}` subtitle,
  teaser).
- When `this.previous` is non-empty, render a line under the subtitle:
  `Previous: ` followed by linked version tags, each
  `<a href="/classes/{id}/{name}">{rules_version}</a>`.

### 4. Testing (TDD)

Unit tests for `groupClassVersions`:

- Single class → one group, empty `previous`.
- `v1 → v2` chain → one group, primary is `v2`, `previous` = `[v1]`.
- Two editions of the same name → two separate groups (no cross-edition merge).
- Branching family (two leaves) → primary is the newest-created leaf.
- Chain with a missing intermediate version → degrades into separate groups.

## Out of Scope

- Schema changes (none — grouping is in-memory over the fetched list).
- New DB queries.
- The `/classes/my` page and other class views.
