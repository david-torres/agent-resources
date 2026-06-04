# Version-Family Unlocks — Design

**Date:** 2026-06-04
**Status:** Approved

## Problem

Class unlocks (`class_unlocks`, keyed `(user_id, class_id)`) apply to exactly one
class row. With the v2 upgrade system, classes now exist as version forks linked
via `classes.base_class_id` (e.g., advent Librarian v1 → advent Librarian v2).
A user who unlocked Librarian v1 should not have to unlock Librarian v2
separately.

Current behavior is also inconsistent:

- **Too strict (id-based checks):** class view teaser gating (`isClassUnlocked`),
  PDF access (`canViewClassPdf`), and agent access
  (`getUnlockedClassIdsForUser` → `resolveClassAgentAccess`) match the exact
  class id, so a v1 unlock does not open the v2 class page/PDF.
- **Too permissive (name-based check):** the character-form class dropdown
  (`filterClassDataForUser` in `routes/characters.js`) matches unlocks by class
  **name**. Edition forks keep the same name, so an advent Librarian unlock
  currently leaks access to an aspirant Librarian fork.

## Decision

An unlock applies to the whole **version family** of a class, in both
directions, but never across editions.

**Version family:** the connected component of classes linked by
`base_class_id`, following only edges where parent and child share
`rules_edition`.

- Advent Librarian v1 + advent Librarian v2 (fork of v1) → one family.
- Aspirant Librarian (edition fork of advent v1) → separate family; an aspirant
  v2 forked from aspirant v1 joins the *aspirant* family.
- Unlocking any member unlocks the family (bidirectional: a v2 unlock also
  grants v1).

## Architecture

### Pure core (`models/class.js`, unit-testable, no DB)

- `computeVersionFamily(allClasses, classId)` → `Set<id>`
  BFS over same-edition `base_class_id` edges. Visited set guards against
  cycles. Unknown/orphan ids yield a singleton set.
- `expandIdsToFamilies(allClasses, idSet)` → `Set<id>`
  Union of `computeVersionFamily` over each id.

`allClasses` is an array of `{ id, base_class_id, rules_edition }`.

### Integration (`models/class.js`)

A single lightweight query feeds the pure core:
`select id, base_class_id, rules_edition from classes` via `supabaseAdmin`
(~45 rows; admin client so private forks don't break chain links).

- `isClassUnlocked(userId, classId)` — resolve the family, then check
  `class_unlocks` with `.in('class_id', familyIds)` plus the existing expiry
  filter. Upgrades class-view gating, PDF access, and self-unlock display with
  no caller changes.
- `getUnlockedClassIdsForUser(userId)` — fetch direct unlock ids, return the
  family-expanded set. Upgrades agent access with no caller changes.
- `getUnlockedClasses(userId)` — **unchanged**; the profile page keeps showing
  only directly-granted unlocks.

### Dropdown fix (`routes/characters.js`, `filterClassDataForUser`)

Replace the name-based `allowed` set with the family-expanded id set from
`getUnlockedClassIdsForUser`; filter class lists by `c.id`. Derive the
gear/abilities lookup-map keys from the surviving (id-filtered) classes.
This adds v1→v2 propagation and removes the cross-edition name leak in one
change.

## Semantics

- **Expiry:** a family is unlocked iff some member has a currently-valid unlock
  row (`expires_at` null or in the future). Derived access expires with its
  source row. A direct unlock on another member keeps working independently.
- **Future forks:** computed on read, so a fork created tomorrow is covered by
  yesterday's unlock automatically. No backfill, no triggers.
- **Direct unlocks remain insertable** for any family member (e.g., redeeming a
  v2 code when v1 is already unlocked); rows are independent.

## Error handling

If the classes fetch fails, fall back to current direct-id semantics (log the
error, degrade gracefully). Never throw into the request path — matches the
codebase's log-and-degrade idiom.

## Testing (TDD)

Unit tests for the pure core:

- v1 → v2 chain membership (and deeper chains)
- bidirectional: v2 unlock grants v1
- edition fork excluded (advent unlock ≠ aspirant fork)
- aspirant sub-family isolated (aspirant v1 + aspirant v2 need aspirant unlock)
- cycle guard terminates
- orphan/unknown class id → singleton family

Integration-level tests for `filterClassDataForUser` filtering logic: family
members admitted, cross-edition same-name forks rejected.

## Out of scope

- Upgrade-target eligibility (`findUpgradeTargetsFor` stays visibility-gated,
  not unlock-gated)
- RLS changes
- Profile page display changes
- Caching the classes lookup (table is tiny; YAGNI)
