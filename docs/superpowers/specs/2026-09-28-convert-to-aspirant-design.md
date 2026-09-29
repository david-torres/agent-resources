# Convert to Aspirant — design

Date: 2026-09-28
Branch: `feat/convert-to-aspirant`

## Intent

A player can move their own Advent character onto Aspirant V1 without
rebuilding it. The trigger case is Caroline Denton
(`465f52ce-ee0d-4b0f-99bc-4baa4f9c8b7d`): an Advent v2 Gunslinger carrying a
fourth, cross-class Ability (Wanderer's Familiar Face), flagged
"Illegal Build: 4 Abilities, and the cap is 3." Under Aspirant the same build
is within the 6-Ability cap and Cross-Classing is a rule, not a breach.

Decisions taken with the user:

- **Owner self-service**, one-way, no admin step.
- **Keep the whole build.** Ability cap, Perk deficit and Merx overspend that
  the conversion produces are grandfathered by the existing ratchet.
- **Block on absolute rules.** Anything Aspirant enforces on every save
  (Traits, Stat Cap, Signature Cap), plus content with no Aspirant
  counterpart, is listed as a checklist and prevents conversion until fixed.
- **Switch to the Aspirant fork** of the class; not a mode flag alone.
- **Aspirant V1 builds on Advent v2.** An Aspirant character has everything
  an Advent v2 character has — Defining Quirk, Accessories, Ability Perks, the
  v2 level curve, Conduit Credit offscreen missions — plus Enchantments and
  Mods.

The work is two parts, in order. Part 1 is a standalone bug fix and ships
first; Part 2 depends on it (without it a converted character's Quirk and
Accessories would disappear on its next save).

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

Offered on the edit page when all hold:

- the actor may mutate the character (`requireOwnedCharacter`);
- the character is on the **advent** economy (`economyFor` →
  `'advent'`: `creator_mode` null/`'advent'` and class `content_format`
  `'advent'`);
- its class's version family has an **Aspirant fork**: exactly one class with
  `content_format = 'aspirant'` whose `base_class_id` is a member of the
  character's class family (`computeVersionFamily`). Zero → not offered;
  more than one → not offered and logged (ambiguous catalogue data).

This covers both the six Advent base classes (fork of the v1 row, reached
from a v2 character through the family) and the six pre-release Aspirant
classes (fork of the pre-release row).

### What conversion does

One atomic save through `save_character_atomic`:

- `class_id` → the fork; `class` → the fork's name;
  `creator_mode` → `'aspirant'`.
- Each **Signature** (`class_gear`) and **Ability** (`class_abilities`) row
  is remapped to the fork of *its own* class, matched by trimmed name
  against the fork's catalogue (`gear`, `abilities`, `advanced_abilities`).
  Own-class items go to the character's new class; cross-class items go to
  their class's fork (Familiar Face → Aspirant Wanderer). Ability `type` is
  taken from the fork's catalogue list the name was found in.
- **Ability Perks** follow their Ability: submitted by `ability_name` so the
  RPC re-attaches them to the re-inserted ability rows (changing `class_id`
  makes the RPC delete and re-insert rows, and `character_perks` cascades
  from the old row). Compound links are preserved the same way the v2
  perk remap in `CharacterService.saveCharacterAtomic` (:721-736) preserves
  them.
- Enchantments and Mods already on rows (none expected on Advent characters)
  ride along unchanged.
- Everything else is untouched: name, level, missions, stats, Traits,
  `stat_cap_purchases`, Quirk, Accessories, common items, story fields.

The class family check makes conversion one-way: an aspirant-economy
character is never eligible, and the fork is in a different family from its
Advent parent, so Upgrade never offers the way back.

### Blocking checklist

Computed from the character *as it would be after conversion*, under the
aspirant economy. Each item names what to change.

| Rule | Source | Example message |
| --- | --- | --- |
| Item with no Aspirant counterpart | remap above | "Grapple Gun (Wanderer) has no Aspirant version. Remove it to convert." |
| Item's class has no Aspirant fork | remap above | "Hand Cannon comes from Homebrew Class, which has no Aspirant version." |
| Traits | `validateTraits` (`services/character/input.js:213`) | "Two Traits may not share a Stat (Might)." |
| Stat Cap | `capBreaches` (`util/stat-caps.js`) with Traits and `stat_cap_purchases` | "Reflex is over its Cap." |
| Signature Cap (12; an Enchantment counts as a slot) | the same check `validateEconomyLimits` runs | "15 Signatures, and the cap is 12." |

All are reused from the existing validators; the conversion module never
restates a figure. Each is fixable on the Advent edit form today: remove
gear/abilities, re-pick a Trait (its Stat follows the Trait select), lower a
Stat.

### Grandfathered, not blocking

Ability cap, Perk deficit (both from `buildBreaches`) and Merx overspend are
shown in the preview and allowed. After conversion they behave like any
existing breach: `updateCharacter` and `levelUp` refuse only a save that
makes a hard breach worse (the ratchet at `service.js:603-644`, `:1033-1066`),
and the sheet shows the Illegal Build banner. Merx overspend shows as the
existing Deficit line and is not enforced on update.

### Units

1. **`util/aspirant-conversion.js`** (pure, no I/O)
   `planConversion({ character, classes, gear, abilities, abilityPerks, traits })`
   → `{ target, gear, abilities, abilityPerks, blockers, breaches, perkBreakdown, merxBreakdown }`
   - `classes`: the catalogue rows needed for family and fork lookup and the
     forks' content lists.
   - `target`: the fork, or `null` with a blocker.
   - `gear` / `abilities`: the remapped rows ready for the RPC payload.
   - `blockers`: `[{ rule, detail }]`; empty means convertible.
   - `breaches`: `buildBreaches` of the converted build under `'aspirant'`.
   - Totals come from the existing `perkBreakdown` and Merx breakdown
     derivations, so the preview shows what the sheet will show afterwards.
   Also exports `findAspirantFork(classes, classId)`.
2. **`CharacterService.convertToAspirant(actor, id)`**
   (`services/character/service.js`, beside `upgradeClass`): ownership gate
   (throws `AuthorizationError`), loads the character, children and catalogue
   through the adapter, calls `planConversion`, returns
   `{ status: 400, message }` listing blockers if any, otherwise saves via
   `adapter.saveCharacterAtomic` with the new `class_id`, `class`,
   `creator_mode`, remapped gear/abilities and perks by ability name. Never
   trusts a client-sent plan. Also `planAspirantConversion(actor, id)` for the
   preview, sharing the loading code.
3. **Wrappers** in `models/character.js` (`convertCharacterToAspirant`,
   `planCharacterAspirantConversion`), following `upgradeCharacterClass`.
4. **Route** `POST /characters/:id/convert-aspirant` in
   `routes/characters.js`, shaped like `POST /:id/upgrade` (:1375):
   `sendRouteError` on a business error, else `HX-Location` to the character
   sheet.
5. **Edit-page panel** in `views/character-form.handlebars`, next to the
   Upgrade block (:100-116), rendered only when eligible. Shows the target
   class; after-conversion Abilities, Perks earned/spent and Merx
   earned/spent; any grandfathered breaches (as the sheet would word them);
   the blocker checklist. The Convert button is disabled while blockers
   exist, and otherwise `hx-post`s with `hx-confirm`
   ("Convert <name> to Aspirant? This cannot be undone."). The edit route
   (:590-615) computes the plan with the character data it already loads.

### Error handling

- Not owner → `AuthorizationError` (existing handling).
- Not eligible (already aspirant/aspiring, no fork, ambiguous fork) → 400
  with the reason.
- Blockers → 400 whose message lists every blocker, so a stale page still
  explains why.
- RPC failure → propagated as today's saves do; the RPC is transactional, so
  a failed conversion changes nothing.

### Testing

TDD per unit.

- `planConversion` unit tests: own-class remap; cross-class remap to the
  other class's fork; Advanced abilities get `type: 'advanced'`; unmatched
  name blocker; class without fork blocker; Traits, Stat Cap and Signature
  Cap blockers; grandfathered Ability cap/Perk deficit appear in `breaches`
  not `blockers`; a fixture shaped like Caroline Denton (Gunslinger v2,
  Trickshot/Standoff/Shootout + Wanderer's Familiar Face, 3 Ability Perks with
  compounds) converts with no Ability-cap breach.
- `findAspirantFork`: v1 and v2 members both find the fork; pre-release
  class finds its fork; none and two → `null`.
- Service tests (adapter stubs): ownership; ineligible economy; blocker
  refusal; payload shape sent to `saveCharacterAtomic`.
- Integration (local stack): convert a character with Ability Perks and
  compounds; afterwards `creator_mode = 'aspirant'`, `class_id` is the fork,
  every perk is still attached to its ability, Quirk and Accessories survive,
  and a follow-up ordinary edit saves.
- E2E is not added; the panel is a server-rendered block with one htmx
  button, covered by the route and integration tests.

## Rollout

1. Merge Part 1; user runs `supabase db push --linked` for the migration,
   then the reconcile script dry-run, review, `--apply`.
2. Merge Part 2 (no migration).
3. Caroline Denton's owner can then convert her. Expected blockers to check
   in the preview first: her Signature count against the cap of 12, and
   whether each non-Gunslinger item (Grapple Gun, Earpiece, Hand Cannon,
   Knecht, Eye in the Sky, Catsuit) exists on its class's fork.
