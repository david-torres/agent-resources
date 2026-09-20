# Aspirant V1: the Merx equipment economy

Status: approved design. Plan 1 (the server foundation) and plan 2 (the purchase
surfaces) have landed. Plan 3 (Aspiring Signature acquisition) is planned; the
decisions taken when each was designed are recorded under "Plan 2 rulings" and
"Plan 3: Aspiring Signature acquisition".
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
  your Class for the purposes of acquisition and improvement" (pg. 90). The
  sentence names *three specific Signatures* and makes them a Class, rather than
  exempting the character from the cross-class tier. So those three are acquired
  and improved at the own-class rate despite each coming from a different Class,
  and every other Signature in the game is out-of-class to an Aspiring character
  exactly as it would be to anyone else. Plan 2 implemented only the first half.
- Advent, which the Aspirant grant replaces, is **three Default Signatures and
  one Elective** — pg. 3's "Instead of four Signature Items (three Default and
  one Elective)". The Elective is a choice rather than a fixed item: Advent V2
  pg. 16 lets it double up on a Default instead of taking a new one. Priced at
  the Signature rate it is worth 2 Merx, which buys either one class item or two
  common items.

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
  book with its own figures: grant 10, Signature Cap 8, and its three chosen
  Signatures priced own-class per pg. 90. Everything else in the game is
  out-of-class to it; see "Plan 3".

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
against a 10-Merx grant. The fix is a membership test against those three, not a
blanket exemption: an Aspiring character that acquires a fourth Signature pays
the cross-class 3 for it.

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
caps — one Enchantment, at most two Mods — so neither is an open-ended list, and
a table would buy flexibility the rules forbid.

What columns do *not* buy is rename safety, and the distinction matters enough to
state plainly. Reconciliation is name-keyed: `class_id + name` with an occurrence
index
(`supabase/migrations/20260913000004_save_character_atomic_preserve_ability_type.sql`,
CTEs `desired`/`existing`/`matched`/`deleted`/`updated`). A rename is a delete
plus an insert, so the row is destroyed either way — a column on it dies with it
exactly as a child row would. Renaming a Signature is therefore acquiring a
different Signature, and the new one arrives unenchanted. That is the correct
reading of the rules (a Signature's Enchantment belongs to that Signature) but it
is a behaviour to test for, not one to assume.

What columns buy is the *surviving* case, which is the common one: a save that
changes a Signature's description, or omits its equipment entirely, matches the
row in place and the two columns ride along under `COALESCE` — the same
preserve-on-absent rule `class_abilities.type` already uses. A child table would
need a second reconciliation pass keyed to a gear-row id that is only stable when
the name did not change. `character_perks` pays exactly that cost, and it is
tolerable there only because a perk is re-enterable text; an Enchantment is a
purchase.

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

**One column on `characters`**, added by plan 3:

- `aspiring_signatures jsonb NOT NULL DEFAULT '[]'` — the three
  `{"class_id": …, "name": …}` pairs an Aspiring character chose at creation.
  Empty for every other character, and a CHECK enforces that: at most three
  entries, each with a non-empty `class_id` and `name`, and non-empty only when
  `creator_mode = 'aspiring'`. Without that last clause the column would be a
  second, contradictory answer to "is this Signature own-class?" for a character
  that already has a `class_id`.

**Why a pool on the character rather than a flag on the gear row.** The obvious
alternative is `class_gear.is_origin_pick boolean`. It fails for the reason this
section already gives: reconciliation is name-keyed, so a rename is a delete plus
an insert, and the flag dies with the row. Worse, it conflates two different
facts — a Signature the character *may buy at the own-class rate* and a Signature
it *currently owns*. pg. 90 makes the three a Class, and a Class does not stop
being yours because you sold an item. Selling and re-buying a pick must not
reprice it from 2 to 3, and only a pool that outlives the gear rows gets that
right.

**Preserve-on-absent comes free here.** The RPC's update branch reads
`jsonb_populate_record(saved, p_character)`, whose base is the stored row, so a
key absent from `p_character` keeps its stored value
(`supabase/migrations/20260919000002_save_character_atomic_trait_stat.sql:100`).
The classic edit form never submits `pseudo_class` and its tagline survives
edits for exactly this reason; `aspiring_signatures` inherits the same
behaviour and the edit path needs no code at all to preserve it.

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

- **`advent`** — **three** free on-class items, then 2 for on-class and 3 for
  off-class, with `earned = 2 + mission income`: the three Defaults are free and
  the Elective arrives as its 2-Merx value. Modelling it as four free items and
  no grant, as this design first did, priced only the route where the Elective
  is spent on a class item; a character who took two common items instead was
  shown a 2-Merx deficit for a legal build. Both routes now cost exactly 2.
  Measured against all 327 existing characters: 258 are arithmetically unchanged
  (spend and `earned` both rise by 2), 69 gain 2 `earned` they were never
  credited, and of those only 3 have `auto_calculate` on and would see it.
  Pinned by a test per route.
- **`aspirant`** — `earned = CREATION_GRANT + mission income`;
  `spend = common items + Σ priceOfSignature + Σ priceOfEnchantment + Σ priceOfMod`.
  No free allotment: the book replaced the four starting Signatures with the
  12-Merx grant ("Instead of four Signature Items (three Default and one
  Elective), characters start with 12 Merx", pg. 3).
- **`aspiring`** — the same spend formula with a grant of 10. Its three chosen
  Signatures price own-class because pg. 90 makes them its Class; every other
  Signature prices cross-class, because that is what being someone else's Class
  item means. The three are read from `characters.aspiring_signatures` (see
  "Storage"), not inferred from what the character happens to own, because once
  it owns a fourth the two are no longer the same set.

Cross-class stays derived rather than stored for the `aspirant` branch, exactly
as `onClass` already does it (`util/character-derived.js:62`): a Signature is
cross-class when its `class_id` differs from the character's. The `aspiring`
branch asks the same question against a different reference: not one `class_id`
but the three `(class_id, name)` pairs in `characters.aspiring_signatures`. Both
branches are one function, `isCrossClass` (`util/merx-economy.js:70`), so the two
surfaces and the derivation cannot answer it three different ways.

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
  module. The twelve are listed in the book's printed order, and opening one
  reveals the printed entry — description, meters, the Default Enchantment
  divider and its text — with the purchase controls beneath it, so nobody buys an
  Enchantment without reading what it does. Cross-class Signatures stay reachable
  through the existing search and class filter at the +1 tier. An Aspiring
  character's grid is its three step-1 picks at the own-class rate, and the same
  search and filter reach every other class's roster at the +1 tier.
- **The character edit form** offers the same purchases post-creation, through
  the same component, against the real post-creation budget of grant plus mission
  income.
- **The character page** shows each Signature's Enchantment and Mods, and its
  single `Commissary Reward` line becomes the derived breakdown — earned, spent,
  remaining.

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
| Constants | `util/character-derived.js` | `STARTING_ON_CLASS_GEAR_ALLOTMENT` lives here, advent-only, and becomes **3**; `MERX_PER_MISSION_SUCCESS` stays in `util/enclave-consts.js`. |
| Storage | `supabase/migrations/` | `class_gear.enchantment`, `class_gear.mods`. |
| Atomic save | `supabase/migrations/` | `save_character_atomic` carries both columns, preserve-on-absent. |
| Reconciliation | `util/reconcile.js`, `services/character/service.js` | Gear rows compare and update the two new fields. |
| Input | `services/character/input.js` | Normalise and validate enchantment/mod payloads; enforce budget and caps for `aspirant` content. |
| Wizard route | `routes/characters.js` | Serve the economy in `wizardData`; offer twelve Signatures, not the first six; fix the Core/Advanced grant. |
| Wizard client | `public/js/character-wizard.js` | Read prices from `wizardData`; delete local constants; stop hardcoding `commissary_reward: 0`; grant Core abilities. |
| Edit form | `views/character-form.handlebars`, partials | Purchase surfaces for enchantments and mods. |
| Display | `views/character.handlebars` | Show a character's Enchantments and Mods. |
| Aspiring pool | `supabase/migrations/` | `characters.aspiring_signatures`, plus a full `save_character_atomic` restatement carrying it. |
| Aspiring pool | `services/character/service.js` | Tell `normalizeCharacterInput` whether this is a creation, and feed the pool to both `deriveCharacterTotals` calls — from `characterInput` on create, from the stored row on update, because an update deliberately omits the key. |
| Aspiring pricing | `util/merx-economy.js`, `public/js/signature-entry.js` | `isCrossClass` takes the pool and tests membership instead of exempting the economy. |
| Aspiring shop | `public/js/character-wizard.js`, `util/gear-purchase-data.js` | Open every class's roster to an Aspiring character at the cross tier, on both surfaces. |
| Aspiring pool | `services/character/input.js` | Shape and validate the submitted pool; move the "exactly three" check onto it. |
| Aspiring pool | `util/gear-purchase-data.js`, `routes/characters.js` | Carry the stored pool into the edit form's island, so the browser prices what the server will. |

## Testing

- `util/merx-economy.test.js` — the pg. 85 price table as data, every value
  mutation-pinned: moving any price, grant or cap fails a named test.
- `util/character-derived.test.js` — extended. Two regressions matter: a V1
  character holding twelve own-class Signatures with no missions is **not** in
  deficit (today: 16), and advent's Elective prices to exactly 2 whichever route
  it takes — one class item, two common items, or a doubled-up Default — so that
  none of the three reports a deficit for a fresh character.
- `models/character-atomic.integration.test.js` — the new columns survive a save
  that omits them, a submitted Enchantment replaces a stored one, and a renamed
  Signature arrives unenchanted rather than inheriting the old row's purchase.
- `services/character/input.test.js` — each rejection: over budget, 13th slot,
  second Enchantment, third Mod, 41-word Custom, 11-word Mod.
- A word-count test for the superscript-excluding rule, run against real V1
  enchantment text from `docs/data/aspirant-v1-classes-2026-09.json`, so the rule
  is measured against content that exists rather than a fixture. The book's
  40-word limit governs a *player's* Custom Enchantment, not the book's own
  Defaults, so the test's job is to prove the counter reads real rated prose —
  not to assert the printed Defaults come in under 40 words.
- e2e — buy a Default Enchantment, replace it with a Custom, add two Mods, and
  watch the cap arithmetic; then assert an over-budget save is refused.
- The existing V1 class-page e2e (`e2e/specs/27-aspirant-v1-class-page.spec.js`)
  must keep passing untouched: this slice changes characters, not class pages.
- An aspiring-branch case: three picks from three different classes cost 6, not
  9, and the 10-Merx grant leaves 4. This is the regression guard for the
  missing-`class_id` overcharge described under "Who is under this economy".
- Its companion, which guards the opposite error: a fourth Signature costs 3, not
  2, and a fourth taken from the same class as one of the three still costs 3 —
  the pool is three items, not three classes. A pool that is empty or absent
  prices every Signature own-class, which is exactly plan 2's behaviour, so a row
  written before the column existed derives as it always did.
- The same divergence on the edit form, which is where it actually bites: an
  Aspiring character spending mission Merx on a Signature it did not choose at
  creation. `test/character-gear-purchases.test.js` has no aspiring pricing case
  in either direction today, and that surface is the one a player reaches after
  creation.
- Client/server parity for the new signal. `test/signature-entry.test.js` already
  sweeps both V1 economies comparing `SignatureEntry.totalOf` against
  `equipmentSpend`; the sweep gains a pooled and an unpooled case, or it will go
  on proving the two sides agree about a rule neither applies any more.

## Plan 2 rulings

Taken when plan 2 was designed, after plan 1 had landed. Each was a real choice,
and the reason matters more than the choice.

1. **Advent is three Defaults plus a 2-Merx Elective**, not four free items. The
   correction and its measurement are under "Derivation". It changes advent's
   derived figures, which plan 1 called a defect — taken deliberately, because
   the old model reported a deficit for a legal build. It does **not** start
   validating advent against a budget; that stays out of scope.
2. **The wizard resolves its economy from the selected class, not the URL mode.**
   The class pool is deliberately unfiltered by mode (`routes/characters.js:194`),
   so `?mode=advent` reaches a V1 class; the client keyed prices off the mode
   while the server read `content_format`, and the two disagreed on budget, cap
   and prices for exactly that combination. The client now applies the server's
   rule, recomputing when the class changes.
3. **Figures are served, never mirrored.** The economy and stat-cap figures reach
   the browser through the existing `<script type="application/json">` island
   (`views/character-wizard.handlebars:2`). Every client constant they replace is
   deleted in the same change, including the stat-cap mirrors slice 5 had to
   leave behind.
4. **No spend-it-all gate, in any economy.** pg. 3 says Merx "may be spent
   however they like or save for later", while the wizard blocked its Next button
   until the budget was exhausted. The remainder now flows to
   `commissary_reward`. Over-budget is still prevented by refusing the add.
5. **Replacing a Signature that carries purchases confirms first**, naming the
   Enchantment and Mods it will destroy. The destruction is inherent — a rename
   is a delete plus an insert (see "Storage") — so the guard is a warning, not a
   repair.

## Plan 3: Aspiring Signature acquisition

Plan 2 shipped `isCrossClass` returning `false` for the whole `aspiring` economy.
That is not what pg. 90 says, but no shipped code is wrong today: an Aspiring
character cannot reach a fourth Signature on either surface. The wizard's
`getShopPool` (`public/js/character-wizard.js:2563`) opens the all-classes roster
only for `mode === 'aspirant'`, and the edit form's grid is built from
`characterClass.gear` (`util/gear-purchase-data.js:49`); a class-less character
has no roster, so its grid holds only the Signatures it already owns. The blanket exemption is therefore correct for every
character that can currently exist, and becomes a live mispricing the moment
acquisition opens. Plan 3 opens it and fixes it in the same change.

Measured against the loaded local database on 2026-09-20: 327 characters, 318
with `creator_mode` NULL and 9 `advent`; **zero `aspiring`, zero `aspirant`, and
zero with a NULL `class_id`**. No backfill, and no existing character's price
moves.

### Rulings

1. **The pool is three items, not three classes.** pg. 90 makes three named
   Signatures a Class. A fourth Signature drawn from the same class as one of the
   three is still cross-class, because the character never had that class — it had
   that item. The alternative reading is defensible and cheaper to implement, and
   it is rejected because it would silently hand an Aspiring character eleven more
   own-class items per pick.
2. **The pool is stored, not derived.** Once a character owns four Signatures,
   nothing in `class_gear` says which three were the originals. Any derivation
   would have to assume the first three rows, and row order is not a contract.
3. **The pool is submitted, not snapshotted from the gear array.** The wizard
   already holds it separately: `state.classBuild.classGear`
   (`public/js/character-wizard.js:86-91`) is three `{classId, itemName}` slots,
   filled on step 1 and validated as three items from three *distinct* classes
   (`validateBuilder`, `:1818-1839`). It becomes its own payload field. Deriving
   it from `data.gear` instead fails twice over: at creation the gear array is now
   picks *plus* purchases, which is the very confusion this column exists to end,
   and a gear item may still be a bare `"ClassName::ItemName"` string at
   normalisation time — `class_id` is not resolved until `resolveClassItem`
   (`services/character/service.js:455-486`), well after validation.
4. **Shaped in `normalizeCharacterInput`, beside `pseudo_class`**
   (`services/character/input.js:515-521`), under the same
   `creator_mode === 'aspiring'` gate and the same delete-the-raw-key discipline.
   This matters for more than symmetry: it puts the pool in front of
   `validateEconomyLimits` (`:362`), so the save-time budget check prices a
   character exactly as the client did. Shaping it later, in
   `saveCharacterAtomic`, would leave the server validating at plan 2's prices
   and accepting builds the wizard refused.
5. **On update the field is absent and the RPC preserves it.** The classic edit
   form never submits `pseudo_class` and its tagline survives edits for exactly
   this reason. The edit form must likewise never submit the pool — a character's
   Class is not editable, and an absent key is how that is enforced rather than a
   server-side override.
6. **Selecting the three is not buying them.** An Aspiring character chooses
   three Signatures to *constitute its Class*; it then spends its 10 Merx however
   it likes, exactly as an Aspirant character spends 12 — pg. 3's "may spend
   however they like or save for later" governs both. It may buy all three, some
   of them, none of them, or none of them and two cross-class Signatures instead.
   The pool is a price list, not an inventory.

   So `validateAspiringBuild`'s "exactly three" moves from the gear array to the
   pool. Today `services/character/input.js:668` reads
   `if (gear.length !== 3) return 'An Aspiring character needs exactly three gear
   picks.'`, which both refuses a fourth Signature and compels the first three.
   The three-ness is a property of the Class being invented, not of what the
   character walked out with, so the count check binds the pool and the gear
   array is left to the budget and cap checks that already govern every other
   economy. A creation that buys nothing submits no `gear` key at all — the
   wizard omits it when `state.gear` is empty — and that must be a legal save.

   This is also why the pool has to outlive ownership: a character that bought
   none of its three at creation must still get them at the own-class rate later,
   and one that sells a pick must not find it repriced from 2 Merx to 3.
7. **An empty or absent pool prices every Signature own-class** — plan 2's exact
   behaviour — so a row written before the column existed derives as it always
   did. The permissive direction is chosen deliberately: the strict one would
   refuse saves for characters that did nothing wrong. It is unreachable through
   the wizard, which validates the pool, so this is a guard for the API path and
   for legacy rows, of which there are none.
8. **The wizard's grid stays the pool; the shop becomes everything else.**
   `signatureEntries` (`public/js/character-wizard.js:2529-2545`) already renders
   the Aspiring grid from `state.classBuild.classGear`, so the printed grid is
   the character's own Class and needs no change. The acquisition surface is the
   shop, which is where cross-class purchases already live for `aspirant`. One
   welcome side effect: `character-gear-purchases.js:336` gates its origin-class
   badge on `crossClassFor`, so an acquired Signature starts naming the class it
   came from without new markup.
9. **The wizard's shop branches on economy, not `DATA.mode`.** `getShopPool`
   tests `DATA.mode === 'aspirant'` while `usesSignatureGrid` tests the resolved
   economy. That disagreement is a pre-existing gap — an `?mode=advent` wizard on
   aspirant-content classes gets no class items in its shop — and it sits directly
   in the way of opening the shop to `aspiring`. Plan 3 closes it rather than
   adding a third branch beside it.
10. **A fourth Signature is affordable at creation and that is intended.** Three
   picks cost 6 of the 10-Merx grant; the remaining 4 buys one cross-class
   Signature at 3, or common items. Nothing in the book reserves the remainder,
   and pg. 3's "spend however they like or save for later" is the governing
   sentence.

**The character page needs no change.**
`views/partials/signature-entry.handlebars` renders a Signature's name,
description, Enchantment and Mods, and shows no price or tier at all, so nothing
on it can disagree with the new pricing.

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
