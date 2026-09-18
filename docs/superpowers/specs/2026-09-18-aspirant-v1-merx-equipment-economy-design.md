# Aspirant V1: the Merx equipment economy

Status: approved design, not yet planned.
Branch: `aspirant-v1-classes-and-characters`.

## Place in the stack

Slice 4 of the five-slice ENCLAVE: Aspirant V1 stack described in
`docs/superpowers/specs/2026-09-12-aspirant-class-content-contracts-design.md:6-20`:

1. Class-content contracts — landed
2. Aspiring persistence — landed
3. V1 ingestion — landed
4. **Character economy** — this document covers the Merx half
5. Stat caps and traits

The roadmap names slice 4 "Character economy (enchantments, mods, Merx)". That is
two currencies. This slice takes the Merx half: Enchantments, Mods, the Signature
Cap, and a Merx balance that means something. The Perk half — unlocking Advanced
Abilities and Cross-Classing, both priced in Perks rather than Merx — is slice 4b,
and the boundary is the book's own: Merx buys Equipment (pg. 85), Perks buy
Abilities (pg. 7).

Slice 3 loaded twelve V1 classes, each carrying twelve Signature Items with a
Default Enchantment apiece. Nothing can unlock one. This slice is how a character
spends Merx.

## Problem

Three problems, in descending order of how badly they misinform a player.

**A wizard-created V1 character gets three Advanced Abilities it never paid
for, and none of its Core ones.** `public/js/character-wizard.js:3250-3256`
selects `advanced_abilities` over `abilities` whenever the mode is `aspirant` and
the class's advanced list is non-empty, tagging every pick `advanced`. The book
is explicit: a character has three Core Abilities, and "unlocking an Advanced
Ability from your own Class costs 2 Perks" (pg. 7). The branch was unreachable
until slice 3 — no class had a non-empty `advanced_abilities` — and the twelve V1
forks are now the only classes that do. `routes/characters.js:188` does not
filter the class pool by mode ("mode does not filter the class pool per
requirements"), so `?mode=aspirant` with any V1 class reaches it.

**The wizard's Merx arithmetic is cosmetic.** `serializePayload` hardcodes
`commissary_reward: 0` (`public/js/character-wizard.js:3183`). Every budget,
price and "spent / budget" readout in the wizard is discarded at submit. The
payload's `gear` entries carry `{name, class_id}` and nothing else
(`:3216-3220`) — no cost, no free/paid marker.

**The server's own derivation is wrong for V1 content.** `deriveMerxBreakdown`
(`util/character-derived.js:44-76`) has no concept of a creation grant: `earned`
is mission income alone. Measured by calling it directly — a character on a V1
class holding its twelve own-class Signatures, with no missions, returns
`spend: 16, deficit: 16`, because eight Signatures past
`STARTING_ON_CLASS_GEAR_ALLOTMENT` (4) are charged at `GEAR_ON_CLASS_COST` (2).
Any player who ticks auto-calculate on such a character is shown a 16-Merx debt.

Underneath all three: the economy is defined twice. The wizard holds
`CLASS_GEAR_COST = 2` (`:17`), `CROSS_CLASS_GEAR_COST = 3` (`:23`),
`ADVENT_MERX_BUDGET = 2` (`:27`), `ASPIRANT_MERX_BUDGET = 12` (`:30`),
`ASPIRING_MERX_BUDGET = 10` (`:1520`), `ASPIRING_PERKS_BUDGET = 4` (`:1524`) and
`FREE_BASE_GEAR_COUNT = 3` (`:217`); the server holds `COMMON_ITEM_COST = 1`,
`GEAR_ON_CLASS_COST = 2`, `GEAR_OFF_CLASS_COST = 3`
(`util/character-derived.js:34-37`) and `STARTING_ON_CLASS_GEAR_ALLOTMENT = 4`
(`util/enclave-consts.js:323`). The prices agree; the free allotment does not
(3 against 4). `views/character-wizard.handlebars` holds a third copy as prose
and markup — "2 Merx" at `:59` and `:280`, "12 Merx" at `:282`, "2 Merx" at
`:284`, "(1 Merx)" at `:327`, and the budget itself as a mode ternary at `:301`.

One of those copies is already wrong in a way a player can read. `:282` tells an
Aspirant character they may spend on "signature items from any class (2 Merx)",
while `public/js/character-wizard.js:2423` charges `CROSS_CLASS_GEAR_COST` (3)
for any class but the selected one. The book agrees with the code (pg. 85:
"3 Merx — Acquire a Cross-Class Signature Item"), so the copy is simply false,
and it is false because the price is written down in three places.

`services/character/input.js:184-186` records the reason the server was left
out of it: *"Structural invariants only. The 10-Merx and 4-Perk budgets stay
client-side ... mirroring the rules engine here would give the economy two
sources of truth that can drift."* The objection is sound and the outcome
proves it — the drift is already there. This slice resolves it the other way:
one definition, in a module both sides consume, so there is nothing to mirror.

## What the book says

Every figure below is quoted or read from `ENCLAVE___Aspirant_V1.pdf` at the
printed page cited. PDF page = printed page + 5.

### Prices (pg. 85, "Spending Merx")

| Purchase | Own Class | Cross-Class |
| --- | --- | --- |
| Common Item | 1 | — |
| Signature Item | 2 | 3 |
| Unlock the Default Enchantment | 2 | 3 |
| Create a Custom Enchantment | 3 | 4 |
| Create a Mod — first, then second | 1, then 2 | 2, then 3 |

Cross-Class is uniformly +1 at every tier. Stat Training is also on this table
("3+ Merx ... costs +1 Merx for each plus already in that Stat") and is **not**
in this slice.

### Grants and caps

- "characters start with 12 Merx, which they may spend however they like or save
  for later" (pg. 3). Aspiring: "Start with 10 Merx to spend as normal and 3
  Perks" (pg. 90).
- "you can never bring more than 12 Signature Items on a mission" (pg. 85).
  Aspiring: "their Signature Cap is set at 8, and they may never have more than
  four total Abilities" (pg. 92).
- Enchantments "count towards the Signature Cap of 12. This means that a
  character with six Enchanted Signatures could not bring any other Signatures
  onto a given mission" (pg. 8). So an Enchantment consumes a slot of its own,
  and an enchanted Signature costs two of the twelve.
- Mods "do not count towards the Signature cap" (pg. 8). "A given Signature may
  hold up to two Mods" (pg. 87).
- "A Signature may only hold one Enchantment" (pg. 8).
- An Aspiring character's three chosen Signatures "are treated as belonging to
  your Class for the purposes of acquisition and improvement" (pg. 90), so they
  are priced own-class despite each coming from a different Class. This is what
  `public/js/character-wizard.js:2449` already does.

### Authored content

- Custom Enchantment: "This may be no more than 40 words long, minus Power
  Rating Superscripts (pg. 12), and it should be given a thematic name for easy
  reference during play" (pg. 86). Power ceiling: "a Custom Enchantment may never
  be stronger than the Default on the Signature in question" (pg. 86).
- Mod: "A Mod's description may be no more than 10 words long, and it should be
  named for easy reference during play" (pg. 87).

### Two things the book does not say

**Columns are not a purchase gate.** Printed page 11 describes the four columns
as "ordered by complexity and alignment with that Class's general game plan" and
then: "This functionally serves as a recommendation for anyone feeling
overwhelmed by all the choices available to them: when in doubt, pick up items
from the leftmost column first." A sweep of every occurrence of "column" in the
book finds no rule gating a column behind owning items from another, and the
price table does not vary by column. Slice 3's plan deferred "making this route
column-aware" to slices 4-5 on the assumption that a rule existed. It does not.
Column remains what `util/class-gear.js` already makes it: a layout and
compatibility fact, not an economy one.

**The base rates live in Advent, which is not in the PDF.** Aspirant states
deltas: "Aspirant characters improve their capacities exactly as outlined in
Advent with the following exceptions" (pg. 3). The per-mission Merx award is only
alluded to — "receiving the usual 1 Merx" (pg. 99) — and the repo's existing
`MERX_PER_MISSION_SUCCESS = 1` (`util/enclave-consts.js:319`) already matches
that. The Perk-per-level rate and the Compounded-perk mechanic are likewise
Advent's and are not restated; both belong to slice 4b, which must not invent
them.

## Design

### Who is under this economy

Two populations, and they are selected differently because one of them has no
class at all:

- A character whose class has `content_format = 'aspirant'` — the twelve V1
  forks. Grant 12, Signature Cap 12, cross-class surcharge applies.
- A character with `creator_mode = 'aspiring'`. It is class-less by construction
  (`pseudo_class` becomes `characters.class` text, `services/character/input.js:116-123`),
  so there is no `content_format` to read, and the book defines it inside this
  book with its own figures: grant 10, Signature Cap 8, and every chosen
  Signature priced own-class per pg. 90.

`content_format` is the correct axis for the first population and `rules_edition`
is not: the two are deliberately independent, and it is the *shape* of a class's
content — twelve Signatures with Default Enchantments — that this economy prices.
This is the same boundary `util/class-family.js` draws. The six pre-release
Aspirant classes are `rules_edition = 'aspirant'` with `content_format = 'advent'`
and stay on the current model.

Every other character keeps the current model untouched. Measured against the
loaded local database: of 327 characters, **318 carry `creator_mode` NULL**
(they predate modes) and **9 are `advent`** — there are zero `aspirant` and zero
`aspiring` characters. Both new populations are empty, which is what makes the
enforcement in this design safe to apply without a migration.

A consequence for the derivation: an Aspiring character has no `class_id`, so the
`onClass` test at `util/character-derived.js:62` is false for every item it owns
and would charge all three picks the cross-class 3. The pg. 90 rule is therefore
not a refinement but a fix — without it the aspiring branch overcharges by 3 Merx
against a 10-Merx grant.

The book's Advent-to-Aspirant conversion (pg. 2: "+4 Merx for free and delete
underused existing Equipment if applicable, recovering any Merx spent on them")
is not in this slice. It requires moving a character between version families,
which slices 1–3 deliberately did not build, and its refund half needs a
purchase history this design does not keep.

### Storage

Two columns on `class_gear` — the table holding a character's owned Signatures,
despite its name (`supabase/migrations/20240101000000_baseline_schema.sql:165-172`,
`id, character_id, name, description, class_id`):

- `enchantment jsonb NULL` — `null`, or `{"source":"default"}`, or
  `{"source":"custom","name":…,"description":…}`.
- `mods jsonb NOT NULL DEFAULT '[]'` — zero to two `{"name":…,"description":…}`.

**Columns rather than a child table.** The book states both cardinalities as hard
caps, so neither is an open-ended list. A child table keyed to `class_gear.id`
would be cascade-deleted whenever reconciliation drops a Signature row, and
reconciliation is name-keyed: `class_id + name` with an occurrence index
(`supabase/migrations/20260913000004_save_character_atomic_preserve_ability_type.sql`,
CTEs `desired`/`existing`/`matched`/`deleted`/`updated`). A rename is a delete
plus an insert, which would silently destroy a paid-for Enchantment.
`character_perks` pays exactly this cost for perks and is tolerable only because
a perk is re-enterable text; an Enchantment is a purchase.

**`{"source":"default"}` stores no text.** The Default Enchantment's name and
description are already on the class
(`classes.gear[].default_enchantment`, `util/class-gear.js:173-182`), and
`mergeClassItems` (`services/character/repository.js:31-36`) already merges class
text onto character rows at read time. Storing the source rather than a copy means
errata to a class's Default reaches every character who unlocked it, and it makes
"is this the Default or a Custom?" — a pricing input — a stored fact rather than a
text comparison.

**Preserve-on-absent.** `save_character_atomic` must carry both columns with the
`COALESCE(m.x, a.x)` semantics `class_abilities.type` established
(same migration), so a client that does not send them cannot wipe them. Absent
means "keep what is stored", never "reset to default".

### One economy module

`util/merx-economy.js`, CommonJS like the rest of `util/`, is the single
definition of every figure in "What the book says":

```
priceOfSignature({ crossClass })            -> 2 | 3
priceOfEnchantment({ source, crossClass })  -> 2 | 3 | 3 | 4
priceOfMod({ ordinal, crossClass })         -> 1 | 2 | 2 | 3
signatureCapUsage(gearRow)                  -> 1, plus 1 if enchanted; mods 0
CREATION_GRANT      { aspirant: 12, aspiring: 10 }
SIGNATURE_CAP       { aspirant: 12, aspiring: 8 }
ABILITY_CAP         { aspirant: 6,  aspiring: 4 }   -- recorded, enforced in 4b
ENCHANTMENT_WORD_LIMIT 40
MOD_WORD_LIMIT         10
MODS_PER_SIGNATURE     2
```

`util/character-derived.js` consumes it. `routes/characters.js` serialises it
into `wizardData` (`:283-298`) so the browser reads the same numbers. Every
constant it replaces is **deleted**, not shadowed: `CLASS_GEAR_COST`,
`CROSS_CLASS_GEAR_COST`, `ADVENT_MERX_BUDGET`, `ASPIRANT_MERX_BUDGET`,
`ASPIRING_MERX_BUDGET`, `FREE_BASE_GEAR_COUNT`, `effectiveFreeBaseCount`, and every
literal Merx figure in `views/character-wizard.handlebars`. The
`STARTING_ON_CLASS_GEAR_ALLOTMENT`/`FREE_BASE_GEAR_COUNT` disagreement disappears
because only one of the two survives.

`ASPIRING_PERKS_BUDGET`, `ASPIRING_CORE_PERKS` and `ASPIRING_ADVANCED_PERKS`
are Perk figures and stay where they are until 4b.

### Derivation

`deriveMerxBreakdown` gains one argument — the economy the character is under,
resolved from its class's `content_format` and its `creator_mode` by a single
named function so the three call sites cannot each decide it differently — and
branches three ways:

- **`advent`** — unchanged, to the digit: four free on-class items, then 2 for
  on-class and 3 for off-class, `earned` from missions alone. Pinned by a test,
  because all 327 existing characters are in this branch.
- **`aspirant`** — `earned = CREATION_GRANT + mission income`;
  `spend = common items + Σ priceOfSignature + Σ priceOfEnchantment + Σ priceOfMod`.
  No free allotment: the book replaced the four starting Signatures with the
  12-Merx grant ("Instead of four Signature Items (three Default and one
  Elective), characters start with 12 Merx", pg. 3).
- **`aspiring`** — the same spend formula with a grant of 10, and every Signature
  the character owns priced own-class, because pg. 90 treats its picks as its
  own Class's.

Cross-class stays derived rather than stored for the `aspirant` branch, exactly
as `onClass` already does it (`util/character-derived.js:62`): a Signature is
cross-class when its `class_id` differs from the character's. The `aspiring`
branch does not ask the question, which is the point — it has no `class_id` to
compare against.

`commissary_reward` stops being hardcoded `0` at creation and carries the derived
remainder, which makes it consistent with the level-up path
(`services/character/service.js:606-619`), which already recomputes it.

**A consequence worth stating: 12 Merx buys six own-class Signatures.** A V1
character cannot hold all twelve at creation, and the Signature Cap of 12 is a
carry limit reached over a campaign, not a creation target. The wizard's current
`c.gear.slice(0, 6)` coincides with what the grant affords, which is why the cap
has not looked wrong. What is wrong is that it always takes the *first* six
(`routes/characters.js:262`); the player must choose which.

### Surfaces

Both, because the book puts these purchases "including during character creation
(pg. 3)" — meaning creation is one occasion among others, and mission-earned Merx
has to be spendable afterwards.

- **Wizard step 4** offers all twelve Signatures as choices rather than the first
  six, each with its Default Enchantment as an unlock, a Custom Enchantment as an
  alternative, and up to two Mods. The spent/budget readout reads from the shared
  module.
- **The character edit form** offers the same purchases post-creation.

Both surfaces appear only for the two populations under this economy — a class
with `content_format = 'aspirant'`, or `creator_mode = 'aspiring'`. Every other
character sees exactly today's form. An Aspiring character reaches Enchantments
only on a Signature that has one to unlock, which in practice means a Signature
picked from a V1 class; an Advent-format Signature carries
`default_enchantment: null` and offers only the Custom option and its Mods.

### Enforcement

The server recomputes the economy on save and rejects a V1-class character that
breaks it: spend over budget, more than 12 Signature slots counting
Enchantments, more than one Enchantment on a Signature, more than two Mods, a
Custom Enchantment over 40 words, or a Mod over 10 words.

Hard rejection is safe here and only here. Zero characters are on V1 classes and
zero are `aspiring`, so no stored row can already be over budget — the same
emptiness measurement that dropped slice 3's Task 13. Advent characters are not
validated against any budget, today or after this slice; changing that would
retroactively invalidate real data and is not in scope.

The word count excludes Power Rating superscripts per pg. 86. In stored content a
rating is a `<sup>…</sup>` span — the form `util/aspirant-verify.js` matches with
`RAISED_NOTATION` and `renderPowerRatings` (`util/markdown.js:46-50`) is the only
tag permitted to survive — so the counter strips those spans before counting. "Never stronger than
the Default" is not enforced: it is a judgment the book gives the playgroup, and
the app has no approval machinery to hang it on.

### Wiring

| Path | File | Change |
| --- | --- | --- |
| Prices, caps, grants | `util/merx-economy.js` | New. Single definition. |
| Derivation | `util/character-derived.js` | Branch on `content_format`; consume the module; drop local cost constants. |
| Constants | `util/enclave-consts.js` | `STARTING_ON_CLASS_GEAR_ALLOTMENT` moves or is re-expressed; `MERX_PER_MISSION_SUCCESS` stays. |
| Storage | `supabase/migrations/` | `class_gear.enchantment`, `class_gear.mods`. |
| Atomic save | `supabase/migrations/` | `save_character_atomic` carries both columns, preserve-on-absent. |
| Reconciliation | `util/reconcile.js`, `services/character/service.js` | Gear rows compare and update the two new fields. |
| Input | `services/character/input.js` | Normalise and validate enchantment/mod payloads; enforce budget and caps for `aspirant` content. |
| Wizard route | `routes/characters.js` | Serve the economy in `wizardData`; offer twelve Signatures, not the first six; fix the Core/Advanced grant. |
| Wizard client | `public/js/character-wizard.js` | Read prices from `wizardData`; delete local constants; stop hardcoding `commissary_reward: 0`; grant Core abilities. |
| Edit form | `views/character-form.handlebars`, partials | Purchase surfaces for enchantments and mods. |
| Display | `views/character.handlebars` | Show a character's Enchantments and Mods. |

## Testing

- `util/merx-economy.test.js` — the pg. 85 price table as data, every value
  mutation-pinned: moving any price, grant or cap fails a named test.
- `util/character-derived.test.js` — extended. Two regressions matter: a V1
  character holding twelve own-class Signatures with no missions is **not** in
  deficit (today: 16), and the Advent four-free rule is unchanged to the digit.
- `models/character-atomic.integration.test.js` — the new columns survive a save
  that omits them, and a Signature renamed in place keeps its Enchantment.
- `services/character/input.test.js` — each rejection: over budget, 13th slot,
  second Enchantment, third Mod, 41-word Custom, 11-word Mod.
- A word-count test for the superscript-excluding rule, run against real V1
  enchantment text from `docs/data/aspirant-v1-classes-2026-09.json`, so the rule
  is measured against content that exists rather than a fixture.
- e2e — buy a Default Enchantment, replace it with a Custom, add two Mods, and
  watch the cap arithmetic; then assert an over-budget save is refused.
- The existing V1 class-page e2e (`e2e/specs/27-aspirant-v1-class-page.spec.js`)
  must keep passing untouched: this slice changes characters, not class pages.
- An aspiring-branch case: three picks from three different classes cost 6, not
  9, and the 10-Merx grant leaves 4. This is the regression guard for the
  missing-`class_id` overcharge described under "Who is under this economy".

## Deliberately not in this slice

- **The Perk economy** — Advanced Ability unlocks (2 Perks), Cross-Classing
  (3 and 4), the six-Ability cap, and the Compounded-perk mechanic Aspirant
  defers to Advent. Slice 4b. This slice stops the wizard granting Advanced
  abilities wrongly; it does not build the way to buy them, and a character
  starting with one Perk could not afford one anyway.
- **Stat Training** (pg. 87) — priced in Merx, so arguably this slice's, but it
  spends into stats and stat caps, which is slice 5's subject.
- **Flavor** (pp. 104–110) — a second economy that refunds Merx and Perks rather
  than earning them. It is the book's only refund path, and it needs a purchase
  history this design deliberately does not keep.
- **Loadout and encumbrance** (pg. 88), **Companions as a Signature subtype**
  (pp. 8, 89), **High-Stakes mission Merx bonuses** (pg. 97).
- **The pg. 2 Advent conversion**, for the reasons under "Who is under this
  economy".
- **Budget enforcement for Advent characters** — 327 existing characters were
  built with none, and no measurement says they would pass.
- **Column-gated purchasing** — not a rule; see "Two things the book does not
  say".
