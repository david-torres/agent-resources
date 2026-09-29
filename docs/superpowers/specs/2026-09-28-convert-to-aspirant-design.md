# Convert to Aspirant — design

Date: 2026-09-28
Branch: `feat/convert-to-aspirant`

## Intent

A player can move their own Advent character onto the Aspirant rules without
rebuilding it. The trigger case is Caroline Denton
(`465f52ce-ee0d-4b0f-99bc-4baa4f9c8b7d`): an Advent v2 Gunslinger carrying a
fourth, cross-class Ability (Wanderer's Familiar Face), flagged
"Illegal Build: 4 Abilities, and the cap is 3." Under Aspirant the same build
is within the 6-Ability cap and Cross-Classing is a rule, not a breach.

The model:

- **Class format and character mode are independent.** A class is
  Advent-format or Aspirant-format (`content_format`); a character is on the
  Advent or the Aspirant rules (`creator_mode`).
- An Advent character may use only Advent classes. An Aspirant character may
  use Aspirant or Advent classes, and their Signatures and Abilities, freely.
- **Conversion changes the character's mode and nothing else.** Its class and
  every Signature, Ability and Ability Perk stay exactly as they are.
- **Aspirant V1 builds on Advent v2.** A character on the Aspirant rules has
  everything an Advent v2 character has -- Defining Quirk, Accessories,
  Ability Perks, the v2 level curve, Conduit Credit offscreen missions -- plus
  Enchantments and Mods, whatever its class's `rules_version`.
- **The Signature Cap limits what a character brings on a mission, not what
  it owns.** Nothing in the app records a mission loadout, so nothing enforces
  it.

Decisions taken with the user:

- **Owner self-service**, one-way, no admin step.
- **Keep the whole build.** An Ability-cap breach, Perk deficit or Merx
  overspend the Aspirant rules would find is grandfathered by the existing
  ratchet.
- **Block only on the rules Aspirant enforces on every save:** Traits and the
  Stat Cap.

The work is two parts. Part 1 puts Aspirant-format classes on the v2
character rules; Part 2 is the conversion, and it relies on every Aspirant
character getting the v2 rules by mode.

---

## Part 1 — Aspirant-format classes use the v2 character rules

### Problem

The twelve Aspirant V1 classes (`content_format = 'aspirant'`) were inserted
at `rules_version = 'v1'` on the reading that `rules_version` names Advent's
content edition (`2026-09-16-aspirant-v1-ingestion-design.md`, "calling V1
content 'v2' would invert the meaning"). But every consumer reads
`rules_version` as *which character rules apply*, so Aspirant characters are
treated as Advent v1: `updateCharacter` strips `quirks`, `accessories` and
`ability_perks` on every save (`services/character/service.js:467-471`), the
edit form shows the v1 fields, and levels follow the v1 curve while the
client level-up modal (`public/js/character-common.js:27`) already assumes v2.

### Definition change

`classes.rules_version` means **the character-rules generation a class's
characters are built under**. Aspirant V1 is built on Advent v2, so every
aspirant-format class is `'v2'`. The ingestion spec's paragraph is corrected
to say so.

That answers the question for an Advent character. A character on the
Aspirant rules -- `creator_mode` `'aspirant'`, and Aspiring characters, which
are Aspirant-book characters -- is built under v2 whatever its class's
`rules_version`, decided in one place (`util/character-rules.js`
`characterRulesVersion`) and read by every site that picks a character's
rules: create, update, level-up, progress recalculation, the edit form, the
sheet, the details fragment, and the agent API.

### Changes

1. **Migration** `supabase/migrations/20260928000003_aspirant_classes_v2_rules.sql`:
   `UPDATE classes SET rules_version = 'v2' WHERE content_format = 'aspirant'`,
   wrapped in disabling/enabling `update_classes_updated_at` exactly as
   `20260922000000_prerelease_classes_v2.sql` does, so the flip does not
   surface the classes in the homepage "recently updated" feeds. No unique
   index involves `rules_version`; the only constraint is the `v1`/`v2`
   CHECK. The `save_character_atomic` and `level_up_character_atomic` RPCs do
   not read it.
2. **Loader**: `scripts/lib/books.mjs:47` `rulesVersion: 'v2'`; its comment at
   :45-46 restated per the definition above.
3. **Class import**: `util/class-import.js:240` defaults `rules_version` to
   `'v2'` when `content_format` is `'aspirant'` (otherwise unchanged `'v1'`),
   so a re-imported Aspirant class cannot land on v1.
4. **Perk balance on the client** — both sites carry comments saying they
   must be reconciled before an aspirant class is v2:
   - `public/js/character-wizard.js` `perksSpent` (:1920-1935) counts the
     attached Ability Perk (`ABILITY_PERK_COST`), matching the server's
     `perkSpend`.
   - `util/ability-purchase-data.js` (:171-180): the purchase island's
     ability-perk spend must follow the live v2 perk editor rather than a
     page-load snapshot, so the balance shown on the edit form matches what
     the server will judge.
5. **Level reconciliation**: after the migration, run
   `scripts/reconcile-character-progress.js --apply` so auto-calculated
   Aspirant characters' stored `level` moves onto the v2 curve (Perk
   allotment follows level). Dry-run first; its output is the list of
   affected characters.
6. **Stale comments** restating "aspirant does not advance v1/v2"
   (`books.mjs:45`, `character-wizard.js:1930` and :4128,
   `ability-purchase-data.js:171`) are rewritten to the current rule, not
   annotated with history.

### Visible effects (accepted)

- Every label reading "Aspirant v1" becomes "Aspirant v2" (class pages,
  lists, wizard ribbon, character sheet badge, export). Catalogue
  `?rules_version=` filters move the forks to v2.
- Aspirant characters' edit form gains Defining Quirk, Accessories and
  per-Ability Perks; the sheet shows them. The v1 free-text `perks` field
  moves to the Deprecated section — existing text is left there, not
  migrated.
- The Spend Conduit Credit (Offscreen Mission) button appears for Aspirant
  characters. Intended.
- The creation wizard is unchanged: Quirk and Accessories are added after
  creation on the edit form.

### Not affected

Upgrade targets, class-list grouping, fork hiding and "latest version"
selection key on version families (`rules_edition` + `content_format`),
leaf/`created_at` and `content_format` — none read `rules_version`, so no
fork can be mistaken for the latest Advent class. Merx is unaffected (flat
per-mission reward; grants keyed by economy).

### Testing

- Unit: `class-import` default by `content_format`; wizard `perksSpent` with
  an attached perk; ability-purchase-data spend follows live perks.
- Integration (local stack): an aspirant-format v2 character's update keeps
  `quirks`, `accessories` and `ability_perks`; level derives on the v2 curve.
- The migration is applied locally with `supabase migration up` (never
  `db reset`).

---

## Part 2 — Convert to Aspirant

### Eligibility

Offered on the edit page when both hold:

- the actor may mutate the character (`requireOwnedCharacter`);
- the character is on the **advent** economy (`economyFor` → `'advent'`:
  `creator_mode` null or `'advent'` on an advent-format class, or no class).

Every such character is eligible, whatever its class: an Aspirant character
may use Advent classes.

### What conversion does

One atomic save through `save_character_atomic` with
`p_character = { creator_mode: 'aspirant' }`:

- `class`, `class_id`, and every Signature (`class_gear`), Ability
  (`class_abilities`) and Ability Perk (`character_perks`) row are left exactly
  as they are, ids and compound links included: `p_gear`, `p_abilities` and
  `p_perks` are null, which the RPC reads as "leave these rows alone".
- Traits are resubmitted from the stored rows, because the RPC reads an absent
  Trait list as "no Traits" (`COALESCE(p_traits, '[]')`). They pair by
  `(name, occurrence)`, so the rows are kept.
- Every other column keeps its stored value: the UPDATE merges `p_character`
  over the stored row (`jsonb_populate_record(saved, p_character)`).

One-way: a converted character is on the aspirant economy and is never
eligible again. The stored `level` is not recalculated by the conversion; an
auto-calculated character moves onto the v2 curve at its next auto-calculated
save, level-up or mission write.

### After conversion

- **Aspirant economy.** Cross-Classing is judged against the character's own
  class version family (`computeVersionFamily`, via `familyResolver`), so its
  own class's Abilities and Signatures are own-class and another class's are
  cross-class, exactly as for any Aspirant character.
- **v2 character rules** by mode (Part 1): Defining Quirk, Accessories and
  Ability Perks are kept on every save, the edit form shows the v2 fields, the
  level follows the v2 curve, and the sheet offers Spend Conduit Credit.

### Blocking checklist

Computed from the character's own build under the aspirant economy. Each item
is fixable on the Advent edit form today.

| Rule | Source | Example message |
| --- | --- | --- |
| Traits | `validateTraits` (`services/character/input.js`) under `'aspirant'` | "Two Traits may not share a Stat (might)." |
| Stat Cap | `validateStatLimits` with `enforceCreationAllotment: false` (the per-Stat Cap with Traits and `stat_cap_purchases`) | `capBreachMessage` for the Stat |

The creation allotment and +++ ceiling are creation rules and are not judged.

### Grandfathered, not blocking

The Ability cap and Perk deficit (`buildBreaches`) and Merx overspend are
shown in the preview and allowed. After conversion they behave like any
existing breach: `updateCharacter` and `levelUp` refuse only a save that makes
a hard breach worse (the ratchet, `worsenedBreaches`), and the sheet shows the
Illegal Build line. Merx overspend shows as the Deficit line and is not
enforced on an edit.

### The Signature Cap

The Signature Cap (pg. 85: 12 for an Aspirant character; pg. 92: 8 for an
Aspiring one; pg. 8: an Enchantment takes a slot) limits what a character
brings on a mission. Nothing in the app records a mission loadout -- mission
sign-up and LFG selection choose a character, never its gear -- so the cap is
enforced nowhere: not at creation, not on an edit, not at conversion, and no
purchase surface counts Signature slots. What limits owning Signatures is Merx:
the creation grant at creation, and on the edit form the grant plus mission
income. If a loadout feature is built, the cap belongs there.

### Units

1. **`util/aspirant-conversion.js`** (pure, no I/O)
   `planConversion({ character, classFamilyOf, gear, abilities, abilityPerks, traits, realMissions, offscreenMissions })`
   → `{ blockers, breaches, perkBreakdown, merxBreakdown }`
   - `classFamilyOf`: the character's own version-family resolver, handed in
     by the service.
   - `blockers`: `[{ rule, detail }]` with `rule` `'traits'` or `'stat-cap'`;
     empty means convertible.
   - `breaches`, `perkBreakdown`, `merxBreakdown`: the existing derivations
     under `'aspirant'`, so the preview shows what the sheet will show
     afterwards.
2. **`CharacterService.convertToAspirant(actor, id)`** and
   **`planAspirantConversion(actor, id)`** (`services/character/service.js`):
   ownership gate (throws `AuthorizationError`), loads the character, its
   class family (`getClassFamilyRows`, skipped for a class-less character) and
   its missions through the adapter, calls `planConversion`, returns
   `{ status: 400, message }` listing blockers if any, otherwise saves the mode
   as above. Never trusts a client-sent plan.
3. **Wrappers** in `models/character.js` (`convertCharacterToAspirant`,
   `planCharacterAspirantConversion`).
4. **Route** `POST /characters/:id/convert-aspirant` (`routes/characters.js`):
   `sendRouteError` on a business error, else `HX-Location` to the character
   sheet.
5. **Edit-page panel** in `views/character-form.handlebars`, next to the
   Upgrade block, rendered only when eligible. It says the character keeps its
   class and whole build and switches to the Aspirant rules, and shows the
   Perks earned/spent, Merx earned/spent (and any Deficit), the hard breaches
   worded as the sheet words them, and the blocker checklist. The Convert
   button is disabled while blockers exist, and otherwise `hx-post`s with
   `hx-confirm` ("Convert <name> to Aspirant? This cannot be undone.").

### Error handling

- Not owner → `AuthorizationError` (existing handling).
- Not eligible (already aspirant or aspiring, or an Advent-mode character on
  an aspirant-format class) → 400 "<name> is not on the Advent rules, so there
  is nothing to convert."
- Blockers → 400 whose message lists every blocker, so a stale page still
  explains why.
- A version-family or mission read failure → returned as `{ data: null, error }`.
- RPC failure → propagated as today's saves do; the RPC is transactional, so a
  failed conversion changes nothing.

### Testing

- `planConversion` unit tests: the plan names no rows; own/cross-class against
  the character's own family; grandfathered Ability cap and Perk deficit in
  `breaches`, not `blockers`; Signatures past the mission cap neither block nor
  breach; Traits and Stat Cap blockers; a class-less character.
- Service tests (adapter stubs): ownership; the mode-only save payload; a
  class with no Aspirant fork converts; ineligible economies; blocker refusal;
  a family read failure.
- Integration (local stack): conversion leaves `class_id` and every
  gear/ability/perk/trait row unchanged (ids and compound links included),
  sets `creator_mode = 'aspirant'`, keeps Quirk and Accessories; a second
  conversion is refused and writes nothing; a follow-up edit on an Advent v1
  class saves Quirk, Accessories and Ability Perks; a 13-Signature character
  converts and then saves a 14th.

## Rollout

1. Merge Part 1; the user runs `supabase db push --linked` for the migration,
   then the reconcile script dry-run, review, `--apply`.
2. Merge Part 2 (no migration).
3. Caroline Denton's owner can then convert her. The only possible blockers
   are her Traits and her Stats against their Caps; the preview lists them
   first.
