# Class List Page: Catalog Sections — Design

**Date:** 2026-08-17
**Status:** Approved

## Goal

The public class list page (`GET /classes`) sorts every class into one of four
sections, so the released classes a viewer owns come first and teasers and
unfinished player-created classes (PCCs) are kept apart from released content.
Only the viewer's own released classes show thumbnail art.

## Partition Rule

Classes are grouped into version families first (`groupClassVersions`), and each
group is placed by its primary (latest) member. The rules are checked in this
order, and a group lands in the first section whose rule it meets:

1. **Pre-release Classes** — `prerelease_section` is set (`pcc`, `exclusive` or
   `aspirant`), whatever the class's `status` and whether or not a book the
   viewer owns grants it. A pre-release class is the Enclave creator's teaser of
   an upcoming product: released Advent-format content at `rules_version 'v2'`.
   This rule comes first because the Aspirant book's roster
   (`CORE_CLASS_UNLOCKS.aspirant` in `util/starter-content.js`) grants the six
   pre-release aspirant-section classes.
2. **Player-Created Classes (PCCs)** — `is_player_created` is true and
   `status !== 'release'`. Only an unfinished PCC carries `alpha` or `beta`; a
   released PCC has been incorporated into the game and is a released class.
3. **Your Released Classes** — the primary's id is one a book the viewer owns
   grants (`getEffectiveClassUnlocks(...).bookIds`).
4. **Other Released Classes** — everything else.

For a viewer who owns only the Advent book: the six Advent classes (each at its
latest version) are under Your Released, the twelve ENCLAVE: Aspirant V1 classes
under Other Released, the twenty pre-release classes under Pre-release, and the
alpha and beta PCCs under PCCs. A signed-out visitor owns no book, so Your
Released is absent and the Advent six are under Other Released.

The profile page keeps its own two-way split (`partitionProfileClasses`,
`partitionClassGroups`): unreleased PCCs in one section, everything else in the
other.

## Where it lives

- `util/class-filter.js` — `partitionClassCatalog(groups, bookClassIds)` returns
  `{ ownedReleases, otherReleases, prerelease, pcc }`, preserving group order
  within each section. `isUnreleasedPcc` is the shared PCC predicate.
- `routes/classes.js` — `GET /` applies the filters, groups by version family
  (or, when a `rules_version` filter is set, shows each match flat), and
  partitions with the viewer's `bookIds`. Filters apply before partitioning.
- `views/classes.handlebars` — renders the four sections in the order Your
  Released, Other Released, Pre-release, PCCs, each (heading and card grid) only
  when non-empty, through `views/partials/class-group-card.handlebars`.
  `showImage` is true only for Your Released Classes.

## Testing

- `util/class-filter.test.js` pins the rule order, pre-release winning over book
  ownership and over status, and the Advent-book owner's sections.
- `views/classes.test.js` pins that only owned released cards render art.
