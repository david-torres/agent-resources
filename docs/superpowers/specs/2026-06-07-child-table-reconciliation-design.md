# Child-Table Reconciliation (Stable Row Identity on Character Save)

**Date:** 2026-06-07
**Status:** Approved

## Problem

Every character save replaces all child-table rows (`traits`, `class_gear`,
`class_abilities`, `character_perks`) via delete-then-insert. Consequences:

- **Identity churn.** Every save assigns new UUIDs to every child row. This
  caused the v2 perk-save bug: the edit form bakes `class_abilities` row ids
  into hidden perk inputs, the save deleted those rows (new ids), and the perk
  insert hit a foreign-key violation — after `ON DELETE CASCADE` had already
  destroyed the previously saved perks.
- **Destructive failure modes.** The save flow is not transactional. A failed
  step after the mass delete loses data (the character row commits first).
- **Metadata loss.** `created_at` (and any future per-row metadata) resets on
  every save.

The interim fix (`util/ability-perks.js: remapPerkAbilityIds`) remaps perk
references from old ability rows to new ones by `name + class_id`. It treats
the symptom at the integration layer; this design removes the cause.

## Goals

- Stable row identity: a child row that survives a save keeps its UUID and
  `created_at`.
- No mass deletes: only rows the user actually removed are deleted.
- Apply uniformly to all four child tables.
- No schema changes, no new constraints (duplicates are legitimate — e.g. two
  copies of the same gear item each cost merx in auto-calculate).
- Core logic as pure, unit-testable functions.

## Non-Goals

- Atomicity. The save flow remains a sequence of independent statements; a
  Postgres RPC wrapping the whole save in one transaction is a possible
  follow-up, not part of this design. Reconciliation alone removes the
  *destructive* failure modes (worst case becomes "some rows didn't update,"
  not "everything was deleted").
- Form-carried row ids. The form keeps submitting items by name/position; the
  server matches them to existing rows.
- Changing `createCharacter` semantics — reconciling against an empty table is
  a pure insert, so create paths are untouched by construction.

## Design

### 1. Pure diff core — `util/reconcile.js`

```js
diffChildRows(existingRows, desiredItems, { keyOf, rowFields })
// → { toInsert: [...], toUpdate: [{ id, ...changedFields }], toDelete: [ids] }
```

- `keyOf(rowOrItem)` returns the natural-key string for matching.
- `rowFields(item)` returns the column values to persist for a desired item
  (the insert payload minus `character_id`; also the fields compared for
  update detection).
- **Greedy multiset matching:** group existing rows by key into FIFO queues;
  walk `desiredItems` in array order, pairing each with an available existing
  row of the same key.
  - Paired, `rowFields` all equal → no-op.
  - Paired, any field differs → entry in `toUpdate` carrying only the changed
    fields (plus `id`).
  - Unpaired desired item → `toInsert`.
  - Leftover existing rows → `toDelete`.
- Field comparison treats `undefined` and `null` as equal to `NULL`-in-DB
  (desired items omit fields like `description` when absent; the persisted
  value for an omitted field is `null`).
- Duplicates need no special casing: two desired items with the same key match
  two existing rows (or insert the shortfall); surplus existing rows delete.
- Pure function: no I/O, inputs never mutated.

### 2. The four `setCharacterX` helpers become fetch → diff → apply

Each helper: select current rows for the character → build desired items
(existing normalization code is unchanged) → `diffChildRows` → apply.

| Table | `keyOf` | Updatable fields |
|---|---|---|
| `traits` | `name` | none (match = no-op) |
| `class_gear` | `class_id + ':' + name` | `description` |
| `class_abilities` | `class_id + ':' + name` | `description` |
| `character_perks` | `class_ability_id + ':' + position` | `text` (`compounds_with` resolved in pass 2) |

- **Apply order: inserts → updates → deletes.** A mid-flight failure leaves
  extra rows rather than missing ones.
- Deletes use `.in('id', toDelete)` scoped to the character; never
  `.eq('character_id', …)` mass deletes.
- `setCharacterAbilities` re-selects all ability rows for the character after
  applying and returns the full post-reconcile set (kept + inserted) — the
  same contract `updateCharacter` already consumes for perk remapping.
- Authorization is unchanged: helpers remain internal, callers enforce
  ownership.

### 3. Perks: two-pass shape, reconcile-based

`setCharacterPerks`:

1. **Pass 1 — rows.** Reconcile on `class_ability_id + position` with `text`
   as the updatable field. `compounds_with` is excluded from pass 1 (inserts
   write it as `NULL`).
2. **Pass 2 — links.** Re-select all perk rows for the character. A pure
   helper resolves desired links against the current set:

   ```js
   resolveCompoundLinks(desiredPerks, currentRows)
   // → [{ id, compounds_with }] — only rows whose stored link must change
   ```

   - `position-N` sentinels (form path) resolve to the current row at
     position `N` on the same ability.
   - Raw UUIDs (agent/API path) are kept only if they reference a current row
     on the same ability — with stable ids this can now legitimately be a
     *kept* row, which the old code (checking only freshly inserted rows)
     could not honor.
   - Unresolvable or self-referencing links become `NULL`.
   - Emits an update for a row only when the resolved value differs from the
     stored one (including clearing a stale link to `NULL`).

### 4. `updateCharacter` and the remap layer

- Call sites and ordering are unchanged: abilities reconcile before perks.
- Kept abilities keep their UUIDs, so the form's perk references stay valid
  and `remapPerkAbilityIds` passes them through untouched (its
  "already-current id" branch).
- The remap layer **stays** as graceful handling for the one case
  reconciliation cannot save: the user swaps ability A → B in the dropdown
  while perks under A are still in the form. A's row is genuinely removed, the
  cascade correctly drops its persisted perks, and remap drops the submitted
  ones instead of FK-erroring the save.
- `previousAbilities` snapshot in `updateCharacter` remains as-is.

### 5. Error handling

- Helpers keep the existing `{ data, error }` contract; first failing
  statement aborts the helper and propagates.
- Because deletes run last and target only truly-removed rows, no failure path
  can mass-delete data. The cascade from `class_abilities` to
  `character_perks` fires only for abilities the user removed.

## Testing

- **TDD `diffChildRows`** (`util/reconcile.test.js`): core match, update
  detection (changed vs. identical fields, null/undefined equivalence),
  duplicate keys (multiset pairing in both directions), pure insert against
  empty existing (create path), full delete against empty desired, no-op
  round-trip, input non-mutation, apply-order-agnostic output shape.
- **TDD `resolveCompoundLinks`** (`util/reconcile.test.js` or alongside):
  sentinel resolution, UUID kept-row resolution, cross-ability rejection,
  self-reference rejection, stale-link clearing, only-changed emission.
- Existing `util/ability-perks.test.js` (remap) is unchanged and must keep
  passing.
- Full suite (`bun test`) as the regression gate. The DB-coupled helpers stay
  thin (fetch/diff/apply) so the pure functions carry the logic.

## Files

- **New:** `util/reconcile.js`, `util/reconcile.test.js`
- **Modified:** `models/character.js` — `setCharacterTraits`,
  `setCharacterGear`, `setCharacterAbilities`, `setCharacterPerks` rewritten
  as fetch → diff → apply; no call-site changes.
- **Unchanged:** schema, migrations, views/partials, routes,
  `util/ability-perks.js`.
