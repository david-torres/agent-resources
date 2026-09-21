# Aspirant V1: the Perk economy

Status: approved design, not yet planned.
Branch: `aspirant-v1-classes-and-characters`.

Page references are PRINTED pages of ENCLAVE: Aspirant V1 unless marked
"Advent" (ENCLAVE: Advent V2). The PDF page is the printed page plus five.

## Place in the stack

Slice 4b of the ENCLAVE: Aspirant V1 stack named in
`docs/superpowers/specs/2026-09-12-aspirant-class-content-contracts-design.md:6-20`:

1. Class-content contracts — landed
2. Aspiring persistence — landed
3. V1 ingestion — landed
4. Character economy — the Merx half landed in three plans
   (`2026-09-18-aspirant-v1-merx-equipment-economy-design.md`)
5. Stat caps and traits — landed
   (`2026-09-19-aspirant-v1-stat-caps-and-traits-design.md`)

**4b is the other half of slice 4.** The boundary is the book's own: Merx buys
Equipment (pg. 85), Perks buy Abilities (pg. 7). The Merx spec drew that line
itself at `2026-09-18-aspirant-v1-merx-equipment-economy-design.md:20-25` and
deferred everything below to this document, with a standing instruction that
4b "must not invent" the rates Aspirant defers to Advent
(`:156-163`). Those rates were supplied by the project owner during this
design and are recorded under "Rules supplied outside the book".

With 4b, every currency in Aspirant V1 has a home: Merx (slice 4), Pluses
(slice 5), Perks (this slice).

## Problem

Three problems, in descending order of how badly they misinform a player.

### 1. Perks are spent but never counted

The app has been recording Perk expenditures for months without knowing they
are expenditures. `character_perks` holds a character's Ability Perks — free
text bound to one of that character's own ability rows, capped at 25 words and
five per ability by `validateAbilityPerks` (`util/validate.js:48-78`). Printed
pg. 7 is explicit that this is the same currency as an unlock:

> New Abilities are unlocked by expending Perks, rather than using them to
> modify existing Abilities. Unlocked Abilities may also be modified with
> future Perks. Remember, Perks may be indefinitely saved, so players can take
> as much time as they wish to choose what to do with them.

One currency, two sinks. The app models the second sink's *storage* and
neither sink's *cost*. There is no numeric Perk balance anywhere: not a
column, not a derived figure, not a served figure.

### 2. The unlock path does not exist, and the door is nonetheless open

No code prices an Advanced Ability or a Cross-Class Ability, and no code caps
how many Abilities a character may hold. `ABILITY_CAP`
(`util/merx-economy.js:40`) has existed since slice 4 plan 1 carrying the
right numbers with a rulebook citation, and is consumed by nothing but its own
test — it is absent even from `economyFigures()`, so it never reaches a
browser.

Meanwhile the classic edit form's ability picker is populated from **every
class the player has unlocked**, not the character's own
(`routes/characters.js:110-137`, `Object.fromEntries(allClasses.map(...))`).
A player can already give any character an ability from any unlocked class,
at no cost, with no badge distinguishing it, and no validation on either save
path. Cross-Classing is not unbuilt; it is unpriced and unbounded.

The one guard that exists anywhere is `validateAspiringBuild`
(`services/character/input.js:688-708`), aspiring creation only, and it
enforces a fixed shape rather than a budget:

```js
if (abilities.length !== 3 || core !== 2 || advanced !== 1) {
  return 'An Aspiring character needs two core abilities and one advanced ability.';
}
```

That same form offers only `c.abilities` and never `c.advanced_abilities`, so
the one thing 4b exists to unlock is the one thing the edit form cannot reach.

### 3. Aspiring's Perk budget contradicts the book twice

`public/js/character-wizard.js:1640-1645` hardcodes:

```js
const ASPIRING_CORE_PERKS = 1;
const ASPIRING_ADVANCED_PERKS = 2;
// Perk budget = 2 cores (1 each) + 1 advanced (2) = 4.
const ASPIRING_PERKS_BUDGET = 4;
```

The per-slot costs are right and the budget is wrong. Printed pg. 90 step 5
grants **3 Perks**, not 4 — and the shortfall is deliberate, because step 3b
says the picks need not be bought at all:

> These Core Abilities are treated as belonging to your Class, but you do not
> start with them, instead paying 1 Perk each, though you do not need to
> acquire them immediately (or at all).

So the wizard both over-grants and force-spends. This is the identical defect
slice 4 plan 3 corrected for Signatures — selection names what counts as your
Class, purchase is a separate act — and pg. 90 states the Ability rule in the
same breath as the Signature rule it states at step 2a.

### What is NOT a problem, recorded so it is not re-opened

- **`class_abilities.type`** already tags core/advanced, CHECK-constrained,
  carried through both write paths and the atomic RPC. 4b reads it; it does
  not build it.
- **`character_perks.compounds_with`** already models a Compound as a separate
  row pointing at the perk it improves. Measured: all five existing compound
  rows point at a base perk on the *same* ability, none self-referential.
- **A character's ability rows already carry their own `class_id`**
  (baseline schema `:180`, `NOT NULL`), so cross-class provenance is already
  recorded on every row. 4b prices it; it does not store it.
- **The legacy `characters.perks` TEXT field** is v1-only freeform prose,
  already read-only on v2 (`views/partials/character-v1-perks-legacy.handlebars`).
  It stays out of the economy entirely.

## What the book says

### Unlocking Abilities (pg. 7)

> In addition to their three Core Abilities, characters may now unlock up to
> three additional Abilities, either from their own or other Classes. A
> character may never have more than six total Abilities, and this cap cannot
> be increased, even via Flavor (pg. 104).

> Unlocking an Advanced Ability from your own Class costs 2 Perks.

> Cross-Classing a Core Ability costs 3 Perks, and an Advanced Ability costs 4
> Perks.

> Cross-Class Ability acquisition counts as Self-Made Content (pg. 9), and a
> playgroup is fully allowed to request it be changed or tempered if it proves
> oppressive in practice.

### Creation and progression (pg. 3)

> Characters start with a Perk, which they may use immediately or save for
> later.

Listed under "Changes to Character Creation", beside the 12-Merx change — so
the starting Perk is Aspirant's addition, and Advent grants none. Progression
is "exactly as outlined in Advent with the following exceptions", one of which
is "Perks can now be spent to unlock additional Abilities, including
Cross-Class (pg. 7)".

### Aspiring (pp. 90, 92)

Step 3b and step 4b establish that an aspiring character's picks are own-class
for pricing and unbought at creation:

> **3b.** These Core Abilities are treated as belonging to your Class, but you
> do not start with them, instead paying 1 Perk each, though you do not need to
> acquire them immediately (or at all).

> **4b.** This is treated as belonging to your Class and costs 2 Perks to
> acquire, as normal.
> **4c.** Note that, unlike normal, an Aspiring Character can start with an
> Advanced Ability.

> **5.** Start with 10 Merx to spend as normal and 3 Perks to acquire or
> improve Abilities.

And pg. 92: "their Signature Cap is set at 8, and they may never have more
than four total Abilities."

### Rules supplied outside the book

Aspirant defers the Perk earn rate and the Compound mechanic to Advent
(pg. 7 cross-references "Ability Perks" in Advent, pg. 30), which is not in
this repository. Both were supplied by the project owner during this design
and are recorded here as the authority 4b implements:

- **One Perk per level.**
- **Applying a Perk to an Ability costs one Perk.** Aspirant's addition is
  that a Perk may now be spent in other ways as well.
- **Compounding**, verbatim: "Compounding an existing Perk, strengthening what
  that Perk already does and increasing its maximum length by +5 words (still
  counts towards Perk cap)."

## Measurements

Against the loaded local database on 2026-09-20 (327 characters, a restored
copy of production).

| Measurement | Value |
| --- | --- |
| Characters | 327 |
| Resolving to `advent` / `aspirant` / `aspiring` | 327 / 0 / 0 |
| `class_abilities` rows | 916 |
| ...typed `advanced` | **0** |
| Ability count per character | 0→19, 1→8, 3→294, 4→5, 6→1 |
| Characters over six abilities | **0** |
| `character_perks` rows | 45, across 13 characters |
| ...compounded | 5 (all on the same ability as their base; none self-referential) |
| ...dangling, or pointing at another character's ability | **0** |
| Longest perk text | 25 words — exactly the current limit |
| Ability rows whose `class_id` differs from the character's | 88 |
| ...same version family (benign drift) | 64 |
| ...genuinely another class family | 24, across **11 characters** |
| `characters.perks` legacy text, non-empty | 106 |

Every character resolves to `advent` because `economyFor`
(`util/merx-economy.js:196-199`) reads the class's `content_format`, and no
character has yet been created on a V1 class. Slice 4 measured the same.

**No character has ever bought an Advanced Ability, and none exceeds six
abilities.** The new rules therefore flag a small, nameable population.
Measured against the fixed rule — Advent has no unlock economy at all
(`unlockSpend` returns 0 for `economy === 'advent'`), so a cross-class or
extra own-class ability never appears in a hard breach; only the Ability Perk
count (`character_perks` rows) and the three-ability cap do:

| Character | Level | Abilities | Ability Perks | Perks earned | Hard breach |
| --- | --- | --- | --- | --- | --- |
| Aisuna Kor-Ragna | 1 | 6 | 0 | 0 | cap +3 |
| Zahak (Aspirant) | 8 | 4 | 8 | 7 | cap +1, deficit +1 |
| Caroline Denton | 10 | 4 | 7 | 9 | cap +1 |
| Annabelle Cyrington | 4 | 4 | 0 | 3 | cap +1 |
| Gertrude | 4 | 4 | 0 | 3 | cap +1 |
| Scarlet Ravenmore | 3 | 4 | 0 | 2 | cap +1 |
| Khan Zahak Barzikani | 7 | 3 | 7 | 6 | deficit +1 |
| Seamus McGlide | 3 | 3 | 4 | 2 | deficit +2 |

**Eight** characters breach a hard rule: six exceed the advent cap of three
abilities, and three have spent more Ability Perks than their level earned,
worst overspend **2**. Eleven hold a genuinely cross-family ability and carry
the soft edition notice; six of those eleven are also among the eight — so the
flagged population is **13 of 327**, not 19.

The deficit count is three, not ten, precisely because a cross-class ability
is *never* a Perk unlock in Advent — pg. 3 lists Cross-Classing itself among
Aspirant's additions, so Advent has no rate to charge for one. teset, Storm
(Ororo Monroe), Charliana "Charlie" Parnassus and Claire each hold a
cross-family ability and carry the soft edition notice, but none of them
spends a single Ability Perk beyond what their level earned, so none is
hard-flagged. Only Zahak, Khan Zahak Barzikani and Seamus McGlide have
genuinely spent more Ability Perks (`character_perks` rows) than
`PERK_GRANT.advent + PERKS_PER_LEVEL * (level - 1)` allows. No backfill is
required for any of them — see "Enforcement".

## Design

### One definition module

`util/perk-economy.js`, the third currency module beside
`util/merx-economy.js` (Merx) and `util/stat-caps.js` (Pluses), following
their established shape: a table per figure, pure pricing functions, and one
`perkFigures()` aggregator that hands plain data to browser surfaces which
cannot `require` it.

Both existing modules have **zero** `require`s. `perk-economy` takes exactly
one, and only because `stat-caps` asks for it in so many words
(`util/stat-caps.js:79-84`):

> Exported so every caller who needs to know whether a character is AT level 1
> — not just how many pluses that level grants — reads it from here rather
> than re-deriving it; two independent copies of this clamp is how a future
> change to one of them silently desyncs a level-gated rule.

So `perk-economy` imports `normalizeLevel` rather than writing a second level
clamp. It resolves no economy of its own: like its siblings, every consumer
passes what it knows.

**`ABILITY_CAP` moves here** from `util/merx-economy.js:40` and its old
definition and export are deleted in the same change. Nothing but a test reads
it today, so the move costs nothing, and it belongs with the slice that can
actually add an Ability — which is what slice 4 plan 1's own comment said when
it recorded the constant.

### The price table

```js
const ABILITY_PRICE = {
    own:   { core: 1, advanced: 2 },
    cross: { core: 3, advanced: 4 }
};
const FREE_CORE_ABILITIES = { advent: 3, aspirant: 3, aspiring: 0 };
const PERK_GRANT          = { advent: 0, aspirant: 1, aspiring: 3 };
const PERKS_PER_LEVEL     = 1;
const ABILITY_PERK_COST   = 1;
const PERK_WORD_LIMIT     = 25;
const COMPOUND_WORD_BONUS = 5;
const PERKS_PER_ABILITY   = 5;
const ABILITY_CAP         = { advent: 3, aspirant: 6, aspiring: 4 };
```

**Cross-Class is uniformly +2 over own at every tier** — the exact mirror of
`SIGNATURE_PRICE`'s "+1 at every tier" (`util/merx-economy.js:10-19`).

The book never prints an own-Core price because for advent and aspirant it can
never be charged: a character's three own Core Abilities are precisely the
free allowance. The `own/core = 1` cell exists for aspiring alone, whose
allowance is zero and whose pg. 90 step 3b price is 1 Perk each. One table
plus one allowance number, rather than a per-economy price fork.

"Own" means the same thing it means for Signatures: the character's class —
or, for an aspiring character, membership of its selected pool. The identical
rule, over a different pool.

**Advent has no unlock economy.** pg. 3's "Changes to Character Progression"
lists "Perks can now be spent to unlock additional Abilities, including
Cross-Class (pg. 7)" as one of Aspirant's ADDITIONS to Advent progression —
so in Advent, Perks cannot be spent to unlock an Ability at all, and
Cross-Classing does not exist there as a mechanic to have a rate. `unlockSpend`
returns 0 unconditionally for `economy === 'advent'`, before it ever reaches
the price table. A cross-class or Advanced ability held by an advent
character is therefore never priced; it is only ever an edition notice
(`CROSS_CLASS_EDITION_RULE`, soft) — never a hard breach, and never a Perk
charge. The three own-class Core abilities `FREE_CORE_ABILITIES.advent`
describes are the entire purchasable roster for an advent character (zero of
them), and what actually bounds that roster is `ABILITY_CAP.advent`, a cap,
not a price. Known non-case: zero advent characters currently hold an
Advanced ability, so today the edition notice is observed for cross-class
abilities only — an Advanced ability held by an advent character would carry
the same soft notice and the same non-price, untested against live data
because no live character exercises it.

**Word limits.** `PERK_WORD_LIMIT` and `PERKS_PER_ABILITY` move here from the
default parameters at `util/validate.js:48`, where they sit today as bare
numbers with no citation. A perk row whose `compounds_with` is set gets
`PERK_WORD_LIMIT + COMPOUND_WORD_BONUS` — 30 words. No existing row exceeds
25, so nothing is invalidated.

**One ordering trap for whoever implements this.** The perk-append path in
`services/character/service.js:905-924` builds its rows with
`compounds_with: null` hardcoded, carrying the submitted link in a parallel
`meta` array to be resolved *after* validation runs. So at the moment
`validateAbilityPerks` sees them, a compound is indistinguishable from a
baseline perk and would silently get 25 words instead of 30. Either the link
resolves before validation, or validation takes the compound set alongside the
rows. A plan that overlooks this produces a word limit that is correct in the
unit test and wrong on the save path.

### Storage

One new column: **`characters.aspiring_abilities`**, the direct sibling of
`aspiring_signatures`.

```
jsonb NOT NULL DEFAULT '[]'
[{ class_id, name, type }]   -- type in ('core','advanced')
```

Required by the rule itself. Selection is not purchase, so an aspiring
character's two Core and one Advanced picks must persist *without* being owned
abilities — and today the wizard writes all three straight into
`class_abilities` as though they had been bought
(`public/js/character-wizard.js:3886-3896`). Same defect, same fix, same shape
as the Signature pool.

Its CHECK constraint is built from what slice 4 plan 3 learned the hard way:

- `.type() == "string"` guards inside the jsonpath. Lax-mode `like_regex` on a
  non-string errors internally, the error is suppressed, and the element is
  silently dropped — which is how `class_id: 123` passed an earlier version of
  the Signature constraint.
- `NOT (creator_mode IS DISTINCT FROM 'aspiring')` rather than
  `creator_mode = 'aspiring' OR ...`. A CHECK is satisfied by NULL as well as
  TRUE, and 318 of 327 rows have a NULL `creator_mode`, so the naive form
  evaporates for almost the whole table.
- At most 3 entries; exactly 2 `core` and 1 `advanced` is a *validator* rule,
  not a constraint, because the column must tolerate an in-progress state the
  validator rejects with a message.

A separate column rather than an extension of `aspiring_signatures`: different
shape (`type`), different cap, different currency.

**No other new columns.** The Perk balance derives on read, like the Merx
breakdown — it is not persisted beside `commissary_reward` and `merx_deficit`.
The grandfathering decision below is specifically designed to avoid a stored
per-character allowance.

### Derivation

Mirrors `deriveMerxBreakdown` (`util/character-derived.js:91-110`):

```js
perkAllotment({ economy, level })
  = PERK_GRANT[economy] + PERKS_PER_LEVEL * (normalizeLevel(level) - 1)

perkSpend({ economy, abilities, abilityPerks, aspiringAbilities })
  = abilityPerks.length * ABILITY_PERK_COST
  + unlockSpend(abilities, economy, aspiringAbilities)

perkBreakdown({ economy, level, abilities, abilityPerks, aspiringAbilities })
  -> { earned, spend, remaining, deficit }
```

`perkAllotment` uses `grant + perLevel * (level - 1)`, identical to
`plusAllotment` (`util/stat-caps.js:88-92`), so a level-1 character holds only
its creation grant. A Perk table that counted levels differently from the
Pluses table would be a bug waiting for someone to notice.

`unlockSpend` partitions a character's abilities into own and cross by the
same rule Signatures use — class for advent and aspirant, pool membership for
aspiring — waives the first `FREE_CORE_ABILITIES[economy]` own-Core abilities,
and charges everything else at its `ABILITY_PRICE` cell.

**A Compound needs no term at all.** Because a Compound is a separate
`character_perks` row, `abilityPerks.length * 1` already charges 2 Perks for a
compounded perk. "Still counts towards Perk cap" is likewise already true: the
compound row is its own entry in the per-ability count at `util/validate.js:68`.
The only code the Compound rule touches is the word limit.

`deriveCharacterTotals` gains the breakdown for display. Nothing it returns
becomes a new persisted column.

### Enforcement: caps, the ratchet, and two severities

```js
buildBreaches({ economy, level, abilities, abilityPerks, aspiringAbilities, characterClassId })
  -> [{ severity, rule, detail }]
```

**Hard — "Illegal Build".** Over `ABILITY_CAP[economy]`, or `deficit > 0`. The
label is shown to the player with the reason, never a bare refusal: *"Illegal
Build — 6 Abilities, and the cap is 3."*

**Soft — "Not available in this edition".** An advent character holding an
ability from a different class **family**. Family is resolved through
`base_class_id`, not raw `class_id`, so the 64 version-drift rows stay silent
and only the 24 genuine ones speak. Advent has no Cross-Classing rule — pg. 3
lists it among the things Aspirant adds — so those 11 characters are outside
their edition, and the app says which. Outside the edition is never instead of
over a limit, but it is also never the SAME as one: Advent has no unlock
economy at all (see "The price table"), so the pick costs nothing and carries
only the notice — it is coincidence, not consequence, that 6 of the 11 also
happen to be hard-flagged, over the ability cap or a Perk deficit run up some
other way, and see both notices at once.

**The ratchet.** Enforcement is a comparison, not an absolute:

- **Creation is never grandfathered.** A new character must be legal outright.
- **Update compares stored against submitted.** `updateCharacter` already
  loads `existing.data`. Compute the breach vector for both; refuse any save
  in which a component *increases*.

So Aisuna Kor-Ragna stays saveable at six abilities forever — renameable, sent
on missions, edited freely — and can never reach seven. This is what makes
grandfathering free: the allowance is the stored row itself, so no column, no
migration of the eight, and nothing silently blessed that nobody reviewed.

Server-side this extends `validateEconomyLimits`
(`services/character/input.js:340-370`), which today carries the Signature cap
and the Merx spend and has no ability term whatsoever.

One known asymmetry inherited from slice 4 plan 3 and closed here: the
classic/expert `POST /characters` route bypasses `validateAspiringBuild`
entirely, so a hand-crafted aspiring payload reaches storage with no
count or distinct-class gate.

`validateAbilityPerks` itself already runs on both save paths
(`services/character/input.js:549`, `services/character/service.js:924`),
gated on `rulesVersion === 'v2'` — correct, not a gap, since a v1 character
uses the free-text field and writes no `character_perks` rows at all.

### Surfaces

**Character page.** The Perk breakdown beside the existing Merx breakdown, and
the Illegal Build / edition notices with their reasons.

**Classic edit form.** A Perk purchase surface for abilities, and the ability
picker extended to offer `advanced_abilities` — today it is built from
`c.abilities` alone (`routes/characters.js:110-137`), which is why the
Advanced Ability, the whole point of the slice, is currently unreachable from
the form that can otherwise add any ability in the game. Cross-class abilities
gain an origin badge naming their class, exactly as cross-class Signatures
already do (`public/js/character-gear-purchases.js:99,358`).

**Wizard.** Acquisition at creation, plus the aspiring rework: three Perks not
four, picks selected into `aspiring_abilities` rather than written as owned
abilities, and purchase as a separate act the player may decline entirely.

**Both catalogues gain class grouping and a search box.** The ability
catalogue this slice adds, and the Signature catalogue slice 4 plan 3 added to
the edit form, which shipped with no grouping, search or filter and was
recorded as an open question (that slice's Ruling 20). One control, designed
once, used by both. Grouping subsumes the wizard shop's separate class-filter
dropdown rather than adding a third control beside it.

**Figures reach the browser the way every other figure does**: `perkFigures()`
into the wizard's JSON island (`views/character-wizard.handlebars:2`) and into
a new island for the edit form's ability surface, which has no equivalent of
`gear-purchase-data` today. No price, grant or cap is written down in a
browser file.

### Wiring

| Consumer | Today | After |
| --- | --- | --- |
| `util/merx-economy.js` | defines `ABILITY_CAP`, unused | definition and export deleted |
| `util/validate.js:48` | `wordLimit = 25, perAbility = 5` literals | reads `perk-economy`; +5 words when `compounds_with` is set |
| `util/character-derived.js` | Merx breakdown only | adds the Perk breakdown |
| `services/character/input.js:340-370` | Signature cap, Merx spend | adds ability cap and Perk spend |
| `services/character/input.js:688-708` | aspiring shape check on `abilities` | moves to the `aspiring_abilities` pool, with a distinct-class check |
| `services/character/service.js` | no breach comparison | the ratchet, on the update path only |
| `routes/characters.js:110-137` | `c.abilities` only | adds `c.advanced_abilities` |
| `public/js/character-wizard.js:1640-1645` | `ASPIRING_PERKS_BUDGET = 4` | deleted; served figures instead |

## Plan split

**Plan 1 — the engine.** `util/perk-economy.js`; the `ABILITY_CAP` move and
`advent: null → 3`; the `aspiring_abilities` column and its RPC pass-through;
the derivation; validation, the ratchet and the compound word bonus; the
Illegal Build and edition notices on the character page and edit form. Ships
alone, and on the day it lands it starts telling those 13 characters the
truth.

**Plan 2 — the surfaces.** Wizard acquisition; the aspiring three-Perk fix and
the selection-is-not-purchase rework; the edit form's Perk purchase surface;
Advanced Abilities in the classic picker; cross-class badges; the new JSON
island; and grouping plus search on both catalogues.

The split puts a review gate between "the rules are right" and "the buying
works" — the shape slice 4 converged on after its single plan had to become
three.

## Testing

- **Unit.** `perk-economy` is pure, so every cell of the price table, the
  allowance waiver, the level clamp and the compound word bonus are covered
  directly. Client/server parity for any rule a browser file mirrors, the way
  `test/signature-entry.test.js` sweeps both V1 economies against
  `equipmentSpend`.
- **Service and input.** The ratchet's decisive case: a stored breach that
  must save unchanged and must refuse to grow. Both save paths, because they
  diverge.
- **HTTP tier.** The routes. Slice 4 plan 3's one escaped regression lived
  here and was hidden because the task's review ran only the unit tier.
- **Integration.** The RPC pass-through and the `aspiring_abilities` CHECK
  against the local database, probing a non-string `class_id` and a NULL
  `creator_mode` explicitly — both were real holes in the Signature
  constraint's first draft.
- **E2E.** Buying an Advanced Ability; an aspiring character selecting three
  picks and buying none; the Illegal Build banner on a grandfathered
  character, which must still save.

**Operational constraints, binding on both plans.** Migrations via
`supabase migration up` only, never `supabase db reset` — the local database
is a restored copy of production. The `.env` / `API_URL` local check before
any database-touching step. Row counts unchanged at characters 327, traits
981, class_gear 1492, class_abilities 916, classes 62, and
**character_perks 45** — added to the list because this is the first slice to
treat those rows as expenditures.

## Out of scope

- **Flavor** (pp. 104–110) — the book's only refund path for Merx and Perks,
  including "(Preflavor) Start a character with an Advanced Ability instead of
  a Core Ability". It needs a purchase history this design still does not
  keep.
- **Stat Training** (pg. 87) — priced in Merx, spends into stats; slice 5's
  subject, and slice 5 has landed without it.
- **The legacy `characters.perks` free text** — 106 characters carry it. It
  stays read-only and uncounted; it is prose, not a ledger.
- **Self-Made Content review** (pg. 9) — pg. 7 attaches it to Cross-Classing,
  but "a playgroup is fully allowed to request it be changed or tempered" is a
  table rule, not something an application can enforce.
- **Advent's Perk content rules** beyond the three supplied above. Advent is
  not in this repository and 4b still must not invent it.
- **Backfilling or repairing the 13 flagged characters.** The ratchet exists
  precisely so their owners decide.

## Decisions taken by the project owner

Recorded because the book does not answer them and a future reader will ask.

1. **One Perk per level; applying a Perk to an Ability costs one Perk.**
   Advent's rates, supplied directly.
2. **Compounding** costs a further Perk, grants +5 words, and still counts
   toward the per-ability Perk cap. Advent pg. 30's text, supplied directly.
3. **Advent grants no starting Perk** — pg. 3's "start with a Perk" is
   Aspirant's addition. Consequence: all three perk-deficit characters above
   stay flagged.
4. **The economy covers all three economies and is enforced in all three.**
5. **Existing breaches are grandfathered by ratchet**, labelled "Illegal
   Build" with the reason, and may never worsen.
6. **Advent cross-classers get a softer notice** than a cap breach — outside
   their edition, not over a limit.
7. **Both catalogues get class grouping and search**, closing slice 4's
   Ruling 20.
8. **Two plans**, engine then surfaces.

## Rulings made while designing

Each was a real choice; the reason matters more than the choice.

1. **A third currency module, not an extension of `merx-economy`.**
   `stat-caps` set the precedent for Pluses; Perks follow it. A second
   currency inside the Merx module would make "one place a price is written
   down" mean two different things.
2. **`perk-economy` may `require` `stat-caps` for `normalizeLevel`**, breaking
   the siblings' zero-require convention. `stat-caps` explicitly asks callers
   to import that clamp rather than re-derive it, and a second copy is the
   documented failure mode.
3. **`ABILITY_CAP` moves rather than being duplicated**, and `advent` becomes
   3. Consumed by nothing but a test today, so the move is free, and leaving a
   copy behind is how the two silently disagree.
4. **One price table plus a free-allowance number**, not a per-economy fork.
   The book's missing own-Core price is a consequence of the allowance, not a
   gap, and modelling it that way makes aspiring's pg. 90 prices fall out of
   the same table as aspirant's pg. 7 prices.
5. **The Compound needs no term in the spend calculation.** It is already a
   separate row, so it already costs a Perk and already consumes a per-ability
   slot. Adding an explicit compound term would double-charge it.
6. **`aspiring_abilities` is a new column, not a widening of
   `aspiring_signatures`.** Different shape, cap and currency; one column
   serving two rules is how a CHECK constraint stops meaning anything.
7. **The balance derives on read.** Persisting it would add a column that can
   disagree with the rows it summarises, and the Merx breakdown already
   established that a derived figure is enough.
8. **The ratchet compares stored against submitted**, which is what makes
   grandfathering need no stored allowance — the decisive reason to prefer it
   over an explicit per-character exemption.
9. **Family comparison, not `class_id`, for the cross-class notice.** Measured:
   64 of the 88 cross-class rows are the same class at another version. Naming
   those would be 73% false positives on the one notice players cannot act on.
10. **Grouping subsumes the wizard's class filter** rather than joining it.
    Two controls that partition the same axis is a worse surface than one.

## Success criteria

1. An aspirant character can spend Perks to unlock an Advanced Ability from
   its own class at 2, and a Cross-Class ability at 3 or 4, on both the wizard
   and the edit form — and cannot exceed six abilities.
2. An aspiring character selects two Core and one Advanced ability at
   creation, receives 3 Perks, and may buy none, some or all of them later, at
   1/1/2 — the Signature rule, over abilities.
3. Every existing character remains saveable. The 8 hard-flagged ones say
   exactly which rule they are outside and cannot worsen; the 11 cross-class
   ones carry the softer edition notice (6 of them carry a hard one as well);
   the remaining 314 show a Perk balance and no notice at all.
4. No Perk price, grant, cap or word limit is written down anywhere but
   `util/perk-economy.js`.
5. Row counts unchanged.
