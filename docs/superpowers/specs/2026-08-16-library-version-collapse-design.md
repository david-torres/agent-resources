# Library Page: Collapse Document Versions Into a Single Card

**Date:** 2026-08-16
**Status:** Approved

## Goal

On the library page (`GET /library`), show one card per document title instead
of one card per version, mirroring the version collapse on the classes list
(`docs/superpowers/specs/2026-06-07-classes-list-version-collapse-design.md`).

## Background

Library documents live in `rules_pdfs`. Versions of a document are rows that
share a `title` and differ by `edition` — there is no parent link like the
classes' `base_class_id` graph. Unlocks already apply to the whole title family
via `expandRulesUnlocksByTitle` (`util/rules-family.js`), so every version of a
title shares one access state. Today `views/library.handlebars` renders a flat
card per row.

## Decisions

- **Grouping key:** exact `title` match.
- **Primary version (the card shown):** highest `edition` within the family,
  using the same ordering the list query uses (`edition` descending, then
  `created_at` descending as tie-break). This is plain string comparison, not
  semantic-version parsing — the same ordering the list has always used.
- **Previous versions:** rendered as an inline row of small tag links on the
  primary's card (`Previous: v1 v2 …`, labeled by `edition`, linking to
  `/library/:id/view`) — the same affordance classes use. No expand/collapse,
  no counts.
- **Locked/expired cards:** the previous-version row is hidden unless
  `primary.canView` is true. Locked and expired cards look exactly as they do
  today.
- **Scope:** only `GET /library` collapses. `/library/manage` stays flat
  (mirroring `/classes/my`).
- **Visibility principle:** the grouping util operates only on the rows passed
  in. Admins (who see inactive rows) may get a different primary than regular
  users; users never see rows they couldn't otherwise access.

## Design

### Grouping util — `util/library-list-grouping.js`

New pure function, mirroring `util/class-list-grouping.js`:

```
groupRulesVersions(rules) -> [{ primary, previous }]
```

- Groups rows by `title`.
- Sorts each family by `edition` desc, then `created_at` desc (the util sorts
  itself; it does not trust input order).
- `primary` = first of that sort; `previous` = the rest, in that order.
- Group order = first appearance of each title in the input array.

We deliberately do not generalize `class-list-grouping.js` into a shared util:
classes pick a primary by walking a version graph, the library picks by a sort
key — the rules share almost no logic.

### Route — `routes/library.js`

In the `GET /library` handler, after the existing per-row decoration
(`isUnlocked` / `isExpired` / `canView` / `expires_at`), map the decorated rows
through `groupRulesVersions` and pass `ruleGroups` to the view. Decoration is
unchanged and stays per-row, so every version carries its own `canView`.

### View — `views/library.handlebars`

The card grid iterates `ruleGroups`. Each card renders `primary` exactly as
cards render today (title, edition, access states, admin Active/Inactive tag).
When `primary.canView` is true and `previous` is non-empty, add:

```hbs
<p class="is-size-7 mb-2">
  Previous:
  {{#each this.previous}}
  <a class="tag is-light ml-1" href="/library/{{this.id}}/view">{{this.edition}}</a>
  {{/each}}
</p>
```

The flat `{{#each rules}}` loop is replaced — the old iteration is removed in
the same change.

## Testing

TDD. `util/library-list-grouping.test.js` (bun:test, runs in the `unit` group)
covering:

1. Single document → one group, empty `previous`.
2. Two editions of one title → one group, higher edition primary, lower in
   `previous`.
3. Distinct titles → separate groups.
4. Edition ordering picks the correct primary regardless of input order.
5. Group order follows first appearance of each title in the input.

Route/view level follows the classes precedent (pure-util tests only); no new
e2e coverage.
