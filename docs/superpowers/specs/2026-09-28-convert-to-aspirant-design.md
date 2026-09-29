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
- **Conversion upgrades the class when it can.** If the character's Advent
  class has an Aspirant version, the character moves onto it, and every owned
  Signature and Ability with a same-named Aspirant version moves with it.
  Anything without an Aspirant version stays as it is and remains fully
  usable. Nothing about a missing Aspirant version blocks conversion.
- **An Aspirant version's own class includes the Advent class it came from.**
  A Gunslinger Signature bought under Advent is still own-class for a
  character on Aspirant Gunslinger.
- **Aspirant V1 builds on Advent v2.** A character on the Aspirant rules has
  everything an Advent v2 character has -- Defining Quirk, Accessories,
  Ability Perks, the v2 level curve, Conduit Credit offscreen missions -- plus
  Enchantments and Mods, whatever its class's `rules_version`.
- **The Signature Cap limits what a character brings on a mission, not what
  it owns.** Nothing in the app records a mission loadout, so nothing enforces
  it.

Decisions taken with the user:

- **Owner self-service**, one-way, no admin step.
- **Swap where possible.** Each owned Signature and Ability moves to the
  Aspirant version of its own class when that class has one and it carries
  the same name; everything else stays. Cross-class items follow their own
  class, not the character's.
- **Fix characters converted before the class upgrade** with a one-time
  script (dry-run by default, `--apply` run by the user against prod).
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
may use Advent classes, so a class with no Aspirant version never stops a
conversion.

### The Aspirant version of a class

`findAspirantFork(classes, classId)` (`util/class-family.js`): the
aspirant-format class outside `classId`'s version family whose
`base_class_id` is inside it, so every version of an Advent class reaches the
same fork. None → null. More than one → null with a warning naming them: the
schema does not enforce one fork per family and conversion does not guess.

### Own class across the fork

A fork starts a version family of its own (`sameFamilyEdge`), which keeps
Upgrade offers and unlocks from crossing formats and must stay that way. What
changes is **own class**: for a character whose class is a fork, its own
class is the fork's family **plus the Advent family the fork came from** (the
family of the fork's `base_class_id`). The link runs one way: an Advent class's
own class never includes its fork.

`ownClassIds(classes, classId)` (`util/class-family.js`) is the one definition.
Every site that asks "is this item the character's own class?" reads it:

- `familyResolver` (`services/character/service.js`), which feeds
  `tagAbilities`, `isCrossClass`, `equipmentSpend`, the Perk and Merx
  breakdowns and `planConversion`;
- `classItemResolver`'s own-family step (the character's own class is still
  tried first, so a name both catalogues carry resolves to the fork);
- the inline family mappers in `routes/characters.js` (edit GET and sheet),
  which are replaced by `familyResolver`;
- `ownClassIdsOf` in `util/gear-purchase-data.js` through the resolver it is
  handed, so the edit-page purchase islands price the same way.

Consequence (accepted): a character created directly on Aspirant Gunslinger
that buys an Advent Gunslinger item pays own-class prices too.

### What conversion does

`planConversion` builds the whole new build; the service saves it in one
`save_character_atomic` call.

- **Class.** If the character's class has a fork: `class_id` and `class`
  become the fork's. Otherwise both stay.
- **Signatures and Abilities.** Each row is checked against the fork of its
  **own** `class_id` (so Familiar Face on a Gunslinger is checked against
  Aspirant Wanderer). It moves when that fork exists and carries the name —
  gear in `gear`, abilities in `abilities` then `advanced_abilities` —
  compared trimmed and case-folded. A moved row takes the fork's `class_id`,
  spelling, description and, for an Ability, `type`; it keeps its
  Enchantment, Mods and position. Every other row, including rows already on
  an aspirant-format class, stays exactly as it is.
- **Ability Perks** follow their Ability: re-keyed by `ability_name` with
  `class_ability_id: null` for a moved Ability (the RPC re-inserts a moved
  row, which cascades its Perks, and re-attaches them by name), unchanged for
  one that stays. Compound links are kept.
- **Mode.** `creator_mode` becomes `'aspirant'`.
- Traits are resubmitted from the stored rows (the RPC reads an absent Trait
  list as "no Traits"). Every other column keeps its stored value.

When nothing moves (no fork, and no row's class has a fork) the save sends
`p_gear`, `p_abilities` and `p_perks` as null, so rows keep their ids.

One-way: a converted character is on the aspirant economy and is never
eligible again. The stored `level` is not recalculated by the conversion; an
auto-calculated character moves onto the v2 curve at its next
auto-calculated save, level-up or mission write.

### After conversion

- **Aspirant economy.** Cross-Classing is judged against `ownClassIds`, so the
  character's own class's items — Aspirant or left over from Advent — are
  own-class and another class's are cross-class.
- **v2 character rules** by mode (Part 1).

### Blocking checklist

Computed from the converted build under the aspirant economy. Each item is
fixable on the Advent edit form today.

| Rule | Source | Example message |
| --- | --- | --- |
| Traits | `validateTraits` (`services/character/input.js`) under `'aspirant'` | "Two Traits may not share a Stat (might)." |
| Stat Cap | `validateStatLimits` with `enforceCreationAllotment: false` (the per-Stat Cap with Traits and `stat_cap_purchases`) | `capBreachMessage` for the Stat |

The creation allotment and +++ ceiling are creation rules and are not judged.
A missing Aspirant version — of the class or of any item — is never a blocker.

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

### Fixing characters converted before the class upgrade

`scripts/upgrade-converted-aspirant-classes.js`, read-only by default,
`--apply` after review, in the style of `reconcile-character-progress.js`
(prints the target host first).

- **Selects** characters with `creator_mode = 'aspirant'` whose class is
  advent-format and has a fork, or that own a row whose class has a fork.
  Aspirant creation lists hide forked Advent classes
  (`withoutForkedAdventClasses`), so these are conversions; the dry-run lists
  every one (name, owner, class → fork, rows that move, rows that stay) for
  review before `--apply`.
- **Applies** the same class and item swap as conversion (the shared pure
  function, `upgradeBuild`), saved through `save_character_atomic` per
  character. Mode is already `'aspirant'`; Traits and Stats are not judged —
  the character is already on those rules and the swap does not touch them.
- Idempotent: a second run finds nothing.

### Units

1. **`util/class-family.js`**: `findAspirantFork(classes, classId)` and
   `ownClassIds(classes, classId)` as above.
2. **`util/aspirant-conversion.js`** (pure, no I/O)
   - `upgradeBuild({ character, classes, gear, abilities, abilityPerks })` →
     `{ target, gear, abilities, abilityPerks, moved, kept }`: `target` is the
     fork or null; the lists are the save-ready rows (or null when nothing
     moved); `moved`/`kept` name each item for the preview and the script.
   - `planConversion({ character, classes, gear, abilities, abilityPerks, traits, realMissions, offscreenMissions })`
     → `{ upgrade, blockers, breaches, perkBreakdown, merxBreakdown }`, the
     breakdowns judged on the upgraded build with `classFamilyOf` from
     `ownClassIds` of the target (or the current class).
3. **`CharacterService.convertToAspirant(actor, id)`** and
   **`planAspirantConversion(actor, id)`**: ownership gate, load the character,
   its rows, the classes the swap needs (`getConversionClasses`: the
   character's class and every class its rows name, their families and
   forks) and its missions; refuse with blockers; otherwise save
   `{ creator_mode, class_id, class }` plus the upgraded lists. Never trusts a
   client-sent plan.
4. **Wrappers** in `models/character.js`; **route**
   `POST /characters/:id/convert-aspirant` unchanged.
5. **Edit-page panel** (`views/character-form.handlebars`):
   - with a fork: "<name> can switch to the Aspirant rules and move to
     **<fork>**." then "Moves to its Aspirant version:" and "Stays as it is:"
     item lists (each omitted when empty);
   - without: "<name> can switch to the Aspirant rules. It keeps its class
     and its whole build." (plus the moved list if any cross-class item has
     a fork);
   - then the Perks/Merx breakdowns, hard breaches and blocker checklist as
     now, and the Convert button with `hx-confirm`.
6. **Script** as above.

### Error handling

- Not owner → `AuthorizationError` (existing handling).
- Not eligible → 400 "<name> is not on the Advent rules, so there is nothing
  to convert."
- Blockers → 400 whose message lists every blocker.
- Two forks for one family → treated as no fork (logged), never an error.
- A class or mission read failure → `{ data: null, error }`.
- RPC failure → propagated; the RPC is transactional, so a failed conversion
  or script save changes nothing for that character. The script reports it
  and continues.

### Testing

- `class-family` unit tests: `findAspirantFork` from every version of a
  family, none, two; `ownClassIds` for a fork includes its Advent origin
  family, for an Advent class excludes its fork.
- `upgradeBuild` unit tests: class moves; own-class item with a counterpart
  moves (Enchantment, Mods kept), without stays; cross-class item follows its
  donor's fork; a donor with no fork stays; a row already Aspirant stays;
  advanced ability takes type `advanced`; Perks follow a moved Ability; no
  fork anywhere → null lists.
- `planConversion`: a leftover Advent own-class item prices as own-class
  after the move; Traits/Stat Cap blockers; missing counterparts never block.
- Pricing: `isCrossClass`/`tagAbilities`/`equipmentSpend` via
  `familyResolver` on a fork character treat Advent-origin items as own.
- Service tests (adapter stubs): ownership; the upgraded save payload; the
  mode-only payload when nothing moves; ineligible economies; blockers.
- Integration (local stack): converting an Advent Gunslinger with a
  matching Signature, a non-matching one, a cross-class Ability with a donor
  fork and an attached Perk → `class_id` is the fork, the matched rows moved
  with Enchantment/Mods/Perk, the others unchanged; a class with no fork
  keeps `class_id` and every row id; a second conversion is refused; the
  script's dry-run writes nothing and `--apply` then a second run finds none.

## Rollout

1. Merge; no migration.
2. The user runs `bun scripts/upgrade-converted-aspirant-classes.js` against
   prod, reviews the list, then runs it with `--apply`.
