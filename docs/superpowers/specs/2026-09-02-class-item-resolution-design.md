# Class Item Resolution — Design (follow-up)

**Date:** 2026-09-02
**Status:** Proposed — deliberately scoped out of the pre-release class import
(`2026-09-02-prerelease-class-import-design.md`), which remaps affected names
as a point fix. This removes the cause.

## Problem

A character's abilities and signature gear live in `class_abilities` and
`class_gear` as per-character copies. Three things combine to make any change
to a class's item names dangerous:

1. **`save_character_atomic` deletes and reinserts every child row on every
   save.** `supabase/migrations/20260815000002_character_created_at_editable.sql:108-120`:

   ```sql
   DELETE FROM public.class_abilities WHERE character_id = saved.id;
   INSERT INTO public.class_abilities (character_id, name, class_id, description) ...
   ```

   Rows get fresh UUIDs on every save. `character_perks.class_ability_id` is
   `ON DELETE CASCADE` (`20240101000000_baseline_schema.sql:188`), so perks are
   destroyed and rebuilt by name each time.

   This is exactly the delete-then-insert that
   `2026-06-07-child-table-reconciliation-design.md` was written to eliminate.
   That design was implemented as `util/reconcile.js` and then bypassed: the
   reconcile path is only reachable when `adapter.saveCharacterAtomic` is
   undefined (`services/character/repository.js:255`), which never happens with
   a real client (`models/_base.js:22`). **`util/reconcile.js` is dead in
   production.**

2. **Item names resolve through a global, name-only map.**
   `models/class.js:457-504` `buildClassContentLookupMaps()` flattens every
   public class into `abilityNameToClassId` / `gearNameToClassId`, keyed by the
   bare name string — not scoped to the character's class, edition, or version.
   Two classes sharing an item name means the later one silently wins, and a
   character can be written with a `class_id` for a class it does not belong
   to. `e2e/fixtures/character.js:16-25` documents this hazard and works around
   it by prefixing fixture names.

3. **An unresolvable name aborts the save.**
   `services/character/service.js:299-302` throws
   `Missing class_id for ability "X"`. The edit form re-offers stored names as
   synthetic options (`routes/characters.js:382-393`), so a user submits a name
   the catalogue no longer has and the save fails with no self-service fix.

The form already knows which class each item came from — it submits
`"ClassName::ItemName"` — but `normalizeClassItems`
(`services/character/input.js:47-49`) discards the class half before
resolution. The information needed to resolve correctly is thrown away and then
guessed at globally.

## Goals

- Resolve an item's `class_id` from the character's own class, not from a
  global name map.
- An item name the catalogue no longer contains must not break a save.
- Preserve child row identity across saves so `character_perks` survives
  without name-based remapping.
- No content decisions: this is a mechanism fix and must be correct for class
  edits nobody has made yet.

## Non-Goals

- Changing what the character sheet displays.
- Migrating existing rows. Whatever `class_id` a row already carries stays.
- Removing `character_perks`' name-based rebuild in the same change.

## Design

1. **Keep the class half of the form value.** `normalizeClassItems` retains the
   `ClassName::` prefix as a resolved `class_id`, so items arrive already
   attributed. `services/character/service.js:292` already prefers
   `item.class_id ?? map.get(...)`, so this alone removes most global lookups.

2. **Scope the fallback.** When an item arrives without a `class_id`, resolve
   it against the character's own class and its version family
   (`util/class-family.js`) rather than the whole catalogue.

3. **Tolerate an unknown name.** An item that resolves nowhere keeps the
   `class_id` already stored on its row (an update) or takes the character's
   `class_id` (an insert), instead of throwing. A save must never fail because
   a Conduit edited a class.

4. **Reconcile instead of delete-and-reinsert.** Change
   `save_character_atomic` to diff child rows the way
   `util/reconcile.js` already specifies — matched rows keep their UUID and
   `created_at`, only genuinely removed rows are deleted. This retires the perk
   cascade-and-rebuild entirely, and revives a module the codebase already owns
   and tests.

Step 4 is the largest and is independently valuable; steps 1-3 are small and
can land first.

## Risks

- `save_character_atomic` is on the critical path for all 542 characters.
  Changing it needs the existing integration coverage
  (`models/character-atomic.integration.test.js`,
  `models/character-level-up.integration.test.js`) plus new cases for the
  rename scenarios, which nothing currently pins.
- `e2e/specs/03b-class-reassignment.spec.js` is a deliberately failing spec
  documenting the cascade; it should go green as part of step 4.

## Test coverage this must add

- A character whose class item is renamed saves successfully and keeps its
  perks.
- Two classes sharing an item name resolve to the correct class per character.
- A save preserves `class_abilities.id` for unchanged items.
