# Aspirant V1: stat caps and traits

Status: approved design, not yet planned.
Branch: `aspirant-v1-classes-and-characters`.

## Place in the stack

Slice 5 — the last — of the five-slice ENCLAVE: Aspirant V1 stack named in
`docs/superpowers/specs/2026-09-12-aspirant-class-content-contracts-design.md:6-20`:

1. Class-content contracts — landed
2. Aspiring persistence — landed
3. V1 ingestion — landed
4. Character economy — the Merx half landed (`2026-09-18-aspirant-v1-merx-equipment-economy-design.md`); its
   browser purchase surface is that slice's plan 2, and the Perk half is slice 4b
5. **Stat caps and traits** — this document

The roadmap names slice 5 "Stat caps and traits", and the two halves are one
subject rather than two. Under Aspirant a stat's Cap is not a constant: **each
Personality Trait grants +1 Cap to its affiliated Stat** (pg. 3, restated pg. 6).
So a Cap cannot be computed without knowing which Stat each of a character's
three Traits belongs to — and that affiliation is nowhere in the database today.
The trait work is not decoration beside the cap work; it is the cap
calculation's missing input.

Page references are PRINTED pages of ENCLAVE: Aspirant V1 unless marked
"Advent" (ENCLAVE: Advent V2). The PDF page is the printed page plus five.

## Problem

Three problems, in descending order of how badly they misinform a player.

### 1. The server has no stat enforcement at all

Not a weak cap — none.

- `services/character/input.js:477-479` runs bare `parseInteger` over every stat
  on the wizard and edit paths, with no clamp, and that is what
  `createCharacter` and `updateCharacter` persist.
- The `[0, 20]` clamp in `normalizeStatsPayload` (`input.js:426-432`) reaches
  only `PATCH /characters/:id/stats` (`services/character/service.js:630`) and
  `levelUp` (`:731`) — two of the four paths that write a stat.
- No stat column carries a CHECK. The baseline schema
  (`supabase/migrations/20240101000000_baseline_schema.sql:38-77`) declares
  twelve bare `INTEGER NOT NULL` columns, and no later migration adds one.

A direct POST can therefore write any integer into any stat. The real rules —
a 6-plus creation allotment, +2 per level, a +++ ceiling at creation and 5
thereafter — live only in browser JavaScript
(`public/js/character-wizard.js:775-822`). The client computes them correctly;
it is simply the only thing computing them.

This is the same shape as the Merx budget before slice 4: the rule existed, the
client enforced it, and the server had never heard of it.

### 2. Aspirant's Cap mechanics do not exist, and their input is discarded

Aspirant adds two ways to raise a Stat Cap past the base 5 (pg. 3):

- each Personality Trait grants **+1 Cap** to its affiliated Stat, and
- **2 pluses may be spent outright for +1 Cap** (a third plus is then needed to
  fill it).

Neither exists in the codebase. Worse, the input the first rule needs is
collected and thrown away:

- `traits` is `id, character_id, name TEXT NOT NULL` and nothing else.
- Both read paths collapse rows to bare strings — `services/character/repository.js:132`
  and `models/character.js:159` each do `traits.map(trait => trait.name)` — so a
  trait's row identity never surfaces above the repository.
- The wizard *does* know the affiliation. It resolves a Stat for a typed word
  through `personalityMap`, and for a self-made word it records the player's
  explicit choice in `state.traitStats` (`public/js/character-wizard.js:1267`).
  The submitted payload carries only `trait0`/`trait1`/`trait2` — the names
  (`:3187-3189`). The Stat is discarded at the boundary.

### 3. An aspiring character is offered six pluses where the book allots four

`getTotalPoints()` (`public/js/character-wizard.js:783`) returns
`6 + Math.max(0, (level - 1) * 2)` with no branch on `creator_mode`. Aspiring
creation is its own process (pg. 90): **four** pluses, **three of which must go
to the Stats of the chosen Traits**. Neither the total nor the placement rule is
modelled, and with no server enforcement the overgrant persists.

This is the same family as the Advanced-Ability overgrant slice 4's Task 1
fixed: a V1 rule the wizard never learned.

### What is NOT a problem, recorded so it is not re-opened

The client's plus arithmetic for Advent-style and Aspirant-style creation is
**correct**. `getTotalPoints()` is the TOTAL allotment, and every consumer
subtracts the automatic grants from it rather than adding to them:

- `capUserStats` (`:810`): `allowed = getTotalPoints() - sumPoints(classPts) - sumPoints(persPts)`
  — 6 − 3 − 1 = 2 freely-assignable pluses, exactly the book's partition.
- the step-2 display (`:1132`): `assigned = class + personality + user`, and the
  Next button stays disabled until `remaining` reaches 0, so the player must
  spend all six.
- the per-stat ceiling (`:804`): `cap = max - classPts - persPts`, so +++ counts
  every source, not just player-assigned pluses.

An earlier reading of this design took `getTotalPoints()` for the
player-assignable budget and concluded the wizard grants ten pluses at creation.
It does not. The figure is recorded here because the function's name invites
that error and a future reader will make it again.

## Rules this slice implements

Verbatim sources, with both pages where a rule is stated twice — this project
has twice cited one page for a rule the book states on two.

| Rule | Value | Source |
| --- | --- | --- |
| Base Stat Cap | 5 pluses | pg. 3, restated pg. 6 |
| Creation ceiling | +++ (3), counting class and Trait grants | Advent pg. 16 step 4c, carried unchanged by pg. 3 |
| Trait Cap grant | +1 Cap to each Trait's Stat | pg. 3, restated pg. 6 |
| Purchased Cap | 2 pluses for +1 Cap | pg. 3 |
| Creation allotment, aspirant | 6 pluses: 3 to Class Stats, 1 to the third Trait's Stat, 2 free | Advent pg. 16, carried by pg. 3 |
| Creation allotment, aspiring | 4 pluses, 3 of them on the chosen Traits' Stats | pg. 90 |
| Level growth | +2 pluses per level above 1 | Advent; confirmed live behaviour |
| Trait count | exactly 3, never more | pg. 110 |
| One Trait per Stat | two Traits may not share a Stat | pg. 6, pg. 110 |
| Trait name | a single word | pg. 6, pg. 121 |
| No absolute ceiling | Caps scale without a stated maximum | pg. 3, "Scaling Beyond" sidebar |
| Stat list | unchanged from Advent's twelve | pg. 6 table vs Advent pg. 10 |

Two mechanics that are easy to conflate and must not be: **the third Trait
grants +1 to its Stat's VALUE** (Advent pg. 16, already implemented as
`getPersonalityPoints`), while **every Trait grants +1 to its Stat's CAP**
(Aspirant pg. 3, new here). Both are real and they are different.

## Measurements

Taken against the local restored production copy before designing. They are what
makes the enforcement decisions below safe rather than hopeful.

- **327 characters**: 318 with `creator_mode` NULL, 9 `advent`, **0 aspirant,
  0 aspiring**. The populations this slice enforces against are empty, exactly
  as they were for slice 4.
- **981 trait rows — exactly 3 per character, for all 327.** The book's
  "exactly three, ever" is already true of the data.
- **48 distinct trait names, and all 48 are in `personalityMap`.** The map holds
  12 stats × 4 words = 48 unique words, which is the pg. 6 table. Zero
  multi-word names, zero unmappable names: **the affiliation backfill is total.**
- **26 of 327 characters have two Traits affiliated with the same Stat**,
  violating pg. 6 / pg. 110. All 26 have `creator_mode` NULL — none is in a V1
  economy.
- **Stat values run 0 to 6**, no negatives, and exactly **one** value exceeds the
  base cap of 5 — a 6, which is precisely what a Trait's +1 Cap permits.
- **Class `stat_spread` sums to 3** for all 12 aspirant classes and for 42 of the
  50 advent classes (6 sum to 0, one to 1, one to 2), in the book's "++X, +Y"
  shape — `Illusionist {"arcane": 1, "sensory": 2}`.

A deliberately-omitted measurement: a count of characters whose stat *sum*
exceeds `6 + 2 × (level - 1)`. That test is unsound, because a stored stat total
also contains the class spread and the third Trait's grant, so it conflates three
sources. Its unreliability is itself an argument for enforcing the allotment only
where the server knows all three terms.

## Design

### One definition module

`util/stat-caps.js`, modelled on `util/merx-economy.js` — pure, no `require` at
all, every figure named once:

```
BASE_STAT_CAP           5
CREATION_STAT_CAP       3
CAP_INCREASE_PLUS_COST  2
CREATION_PLUSES         { advent: 6, aspirant: 6, aspiring: 4 }
LEVEL_PLUSES_PER_LEVEL  2
TRAIT_COUNT             3
```

and pure functions over them:

- `statCapFor(stat, { traits, capPurchases })` — `BASE_STAT_CAP`, plus one per
  Trait affiliated with `stat`, plus `capPurchases[stat]`.
- `creationStatCeiling()` — `CREATION_STAT_CAP`, counting all sources.
- `plusAllotment({ economy, level })` — `CREATION_PLUSES[economy] +
  LEVEL_PLUSES_PER_LEVEL × (level - 1)`.
- `assignedPluses({ stats, classSpread, traitGrant })` — the decomposition that
  recovers what a player assigned from a stored total. This is the arithmetic
  `capUserStats` already performs correctly at `character-wizard.js:810`; the
  server needs the same answer, so it lives here once and the client is
  repointed at it in the follow-up plan rather than a second copy being written.

  **The decomposition is not the same for all three economies.** For `advent`
  and `aspirant`, a stored total is `classSpread + traitGrant + assigned`, where
  `traitGrant` is the +1 on the third Trait's Stat (Advent pg. 16). For
  `aspiring` there is no class spread and **no automatic Trait grant at all**:
  pg. 90's three Trait-Stat pluses are part of the four the player distributes,
  not a bonus on top, so a stored total is `assigned` alone. Passing an
  aspirant-shaped `traitGrant` for an aspiring character would understate what
  the player spent by one.

`CREATION_PLUSES.advent` records 6 because 6 is the true Advent figure and the
client uses it. It is unenforced, because the validator returns early for
`advent` — the same shape as `SIGNATURE_CAP.advent` being `null` in
`util/merx-economy.js`. Recording a true figure the validator skips is
deliberate; recording a false one to signal "unenforced" would be a lie in the
one module that exists to be authoritative.

`BASE_STAT_CAP` of 5 is Advent's cap as well as Aspirant's. The Trait grant and
the purchased Cap are Aspirant-only, so an advent character's Cap is flatly 5.

### Storage

**`traits.stat`** — a new `TEXT` column, backfilled from the 48-word vocabulary
in the same migration, then set `NOT NULL`, with a CHECK restricting it to the
twelve stat names. All 981 live rows map, so the backfill is total and the
migration fails loudly rather than partially if that ever stops being true.

**`characters.stat_cap_purchases`** — `jsonb NOT NULL DEFAULT '{}'`, a map of
stat name to a count of purchased +1 Caps. Two CHECKs: every key is one of the
twelve stat names, and every value is a non-negative integer.

Both must be written so that **no storable value can make them evaluate to SQL
NULL**, because a CHECK evaluating to NULL *passes*. That was one of slice 4's
two Criticals: `enchantment->>'source' IN (...)` is NULL when the key is absent,
so `{}` and `{"name":"Foo"}` were both storable and priced as a free
Enchantment. The fix there was `coalesce(enchantment->>'source', '')`; the
equivalent here depends on the predicate chosen for a key/value sweep, so the
binding requirement is the property, not a particular idiom — and it is verified
by attempting the writes, never by reading the DDL.

**The read shape changes.** `data.traits` becomes `[{ name, stat }]` rather than
`[name]`, and the duplicated collapse in `repository.js:132` and
`models/character.js:159` is deleted rather than left beside it. One
representation: a parallel `trait_stats` field would be a second copy of one
fact and would drift.

That costs four display sites — `util/character-export.js:89-90` and `:255`,
`views/character.handlebars:82`,
`views/partials/character-details.handlebars:36-39`, and
`views/character-form.handlebars:173`. Each gets a test asserting the rendered
Trait *name*, because a missed `{{#each}}` renders `[object Object]` silently
instead of failing, and no server-side shape assertion catches that.

**The RPC carries it.** `reconcileTraits` in `services/character/service.js`
runs only when `adapter.saveCharacterAtomic` is not a function, which never
happens with the real client (`services/character/repository.js:249-250`), so
`save_character_atomic` is what actually executes on every real save and its
trait diff must learn `stat`. Slice 4 lost a fix round to exactly this: the JS
fallback looked correct while production dropped every Enchantment.

### Why the affiliation is stored rather than derived

Because the vocabulary is closed and each of its 48 words maps to exactly one
Stat, `stat` is derivable today — so storing it is a denormalisation, and this
design rejects denormalisation elsewhere (see Alternatives). The distinction is
where truth sits at each moment: **the vocabulary decides the affiliation at
write time, and the row is authoritative at read time.** That makes a row whose
`stat` disagrees with the current vocabulary a legal state — a self-made word,
or a later edit to the map — rather than corruption, and it means a Cap can
never silently lose a +1 to a lookup that missed. Fail-closed, the rule
`priceOfMod` follows in `util/merx-economy.js`.

It also captures data the app already collects and discards: pg. 3 makes
Aspirant Traits "fully customizable", the wizard already lets a player type a
self-made word and pick its Stat, and that choice currently dies at the
payload boundary.

### Derivation and enforcement

`validateStatLimits` and `validateTraits`, both returning `{ ok: true }` or
`{ ok: false, errors }` — the convention `validateAbilityPerks`
(`util/validate.js:48-77`) and `validateEconomyLimits`
(`services/character/input.js:168-199`) already follow.
Both are called from `normalizeCharacterInput`, the single extension point both
`createCharacter` and `updateCharacter` already pass through, which turns a
failure into the `{ data: null, childData: null, error: <string> }` the routes
already render.

**Nothing throws.** The POST handlers in `routes/characters.js` are unwrapped
`async` functions, so a throw becomes an unhandled rejection and the request
**hangs** rather than erroring. That was slice 4's other Critical, caught only
because a reviewer traced the call tree.

**The enforcement split, and why it is not symmetric:**

- **The per-stat Cap runs on create AND update.** It needs only the character's
  Traits and its stored cap purchases — both of which any caller has — so
  there is no information that would make it wrong on an edit.
- **The creation allotment runs at creation ONLY**, behind an explicit
  `enforceCreationAllotment` flag. After creation a character's legitimate plus
  total also includes pluses bought with Merx through Stat Training (pg. 85,
  restated pg. 87), and since purchasing is out of this slice's scope nothing
  stores them. Enforcing the allotment on an edit would therefore refuse pluses
  a player legitimately bought — the false rejection slice 4 ruled worse than no
  check at all, because an absent check is obvious while a false rejection reads
  as a rules decision.

The flag carries the reasoning in a comment, including the instruction not to
"tidy it up" by passing a zero allotment: that is the same regression the
`enforceMerxBudget` comment forecloses by name in `validateEconomyLimits`, and a
reviewer confirmed the wording was what stopped it being reintroduced.

**Trait rules enforced** (V1 economies only): exactly three Traits, no two
sharing a Stat, and each name a single word (pg. 6, pg. 121 — no word *count*
limit exists, so none is invented). A Trait whose Stat can be resolved neither from the payload nor
from the vocabulary is **rejected by name**, not stored with `stat = null` —
a null would cost the character a Cap silently.

**Scope of enforcement: aspirant and aspiring only.** Advent keeps today's
behaviour exactly, including the 26 characters whose Traits collide on a Stat
and the single stat value of 6. This matches every prior slice — slice 4's
success criteria included "advent derivation unchanged to the digit" — and it is
what makes hard enforcement safe: the enforced populations hold zero characters.

### At the database

A `>= 0` CHECK on each of the twelve stat columns. Safe: the live minimum is 0.

Deliberately **no upper-bound CHECK**. pg. 3's "Scaling Beyond" sidebar states
there is no theoretical ceiling, and the real Cap is derived per stat from
Traits and purchases, which a per-column CHECK cannot see.

The existing `[0, 20]` clamp in `normalizeStatsPayload` is therefore a third,
unrelated cap definition. It becomes a named sanity bound in `util/stat-caps.js`
with a comment saying what it is and is not, and the derived Cap does the real
work.

### Data flow of a save

1. The payload gains `trait0_stat` / `trait1_stat` / `trait2_stat`, threading
   through what `state.traitStats` already holds at
   `public/js/character-wizard.js:1267`. Three fields, no new UI, and
   load-bearing: a self-made Trait word has no vocabulary entry to resolve
   against, and pg. 3 permits one.
2. `normalizeCharacterInput` resolves each Trait's Stat — the submitted value
   when present, else the vocabulary — and rejects when neither answers.
3. `childData.traits` becomes `[{ name, stat }]`; `validateTraits` checks count
   and Stat-distinctness.
4. `validateStatLimits` decomposes each stored total into class spread + third-
   Trait grant + player-assigned, then checks the per-stat Cap (always) and the
   creation allotment (creation only).
5. `save_character_atomic` writes `stat` on each trait row; `stat_cap_purchases`
   rides on the characters row like any other column.

## Alternatives considered

**Twelve more integer columns for cap purchases** instead of one jsonb map.
Explicit and CHECK-able per column with no key validation. Rejected: `statList`
exists precisely to paper over the twelve stat columns the schema already has,
and doubling them widens every read and write site for no gain.

**Storing the computed Cap per stat on the character row**, recomputed on save.
Cheap reads, but it denormalises data that lives in `traits` and
`stat_cap_purchases`, and keeping it in step is the drift that cost slice 4 a fix
round on `fieldEqual` — where a jsonb value read back from Postgres compared
unequal to the same value built in JS because Postgres does not preserve key
insertion order.

**Deriving the Trait affiliation at read time**, no new column. Smallest change
and no migration, but a self-made Trait word maps to no Stat and silently grants
no Cap. Fail-open, in the one calculation whose whole purpose is to be
authoritative.

## Testing

Weighted toward where this slice can actually go wrong rather than spread evenly.

- **Mutation pinning, one test per figure.** 5→6, 3→4, 2→3, 6→5, 4→3 must each
  break a named test. Slice 4's final review built a 21-figure matrix and found
  all 21 pinned; that is the bar, not four.
- **The four display sites**, each asserting a rendered Trait name.
- **Constraint behaviour tested by attempting the write**, never by reading the
  DDL — including the absent-key shape that made slice 4's CHECK pass by
  evaluating to NULL.
- **The backfill against all 981 rows**: every row maps, or the migration fails.
- **Both save paths**, since the JS reconciler is dead in production and only the
  RPC runs.
- **The enforcement asymmetry**, directly: a per-stat Cap breach refused on
  update, and an over-allotment accepted on update while refused on create.
- Integration tests registered in `scripts/run-tests.mjs`'s `integrationFiles`
  allowlist (lines 7-22), or they silently never run.
- Row counts unchanged after any DB-touching work: class_gear 1492,
  class_abilities 916, classes 62, characters 327, traits 981.

## Out of scope

- **Stat Training purchasing.** The price (3 Merx plus 1 per existing plus, pg.
  85, restated pg. 87) and the 2-pluses-for-+1-Cap purchase are *modelled and
  derived* here; no buy surface is built. A purchase surface needs a caller that
  knows a character's mission-earned Merx, which slice 4's plan 2 still owes.
- **Flavor**, and therefore Trait swapping (pg. 106) — out of scope for the whole
  stack by earlier decision, alongside Glance Grades, the Keyword glossary,
  Loadout, Companions and Scarring.
- **Any change to Advent behaviour**, including the 26 colliding-Trait characters.
- **The Perk economy** (slice 4b) and **slice 4's browser purchase surface**
  (its plan 2).

## Rulings made while designing, and the gaps they close

The book leaves seven things open. These were settled here rather than deferred.

1. **Does the +++ creation ceiling bind aspiring characters?** Moot by
   arithmetic, *given the reading in ruling 8*: 4 pluses with one on each of
   three distinct Trait Stats leaves at most 2 on any one stat, and an aspiring
   character has no class spread, so +++ is unreachable at creation. Implemented
   anyway, as it costs one shared function and removes a special case.
2. **Do advent characters get Aspirant's Cap-increase mechanics?** No. Their Cap
   is flatly 5. Consistent with `CREATION_GRANT.advent = 0` and with every prior
   slice leaving advent untouched.
3. **Can a Stat Training purchase be refunded?** Unanswerable and unneeded —
   purchasing is out of scope.
4. **Can Stat Training push a Stat past its current Cap?** No: pg. 87 says
   Training cannot increase Stat Caps, and a Cap that can be exceeded is not a
   cap. The per-stat Cap therefore binds the stored value regardless of how the
   pluses were obtained.
5. **No formal definition of "Personality Trait".** None is needed; the
   structural facts (a single word, affiliated with one Stat, exactly three) are
   what the code requires.
6. **No word limit for a self-made Trait name.** The book states no word *count*
   limit and none is invented — unlike Enchantments (40 words, pg. 86) and Mods
   (10 words, pg. 87). What the book does state is that a Trait is **a single
   word** (pg. 6, pg. 121), and that IS enforced for the V1 economies: a Trait
   name containing whitespace is refused. Safe to enforce and not merely
   theoretical, because this slice's own payload change makes a self-made word
   reachable — declaring the rule unpoliced while enabling the path that
   violates it would be incoherent. All 981 live trait names are already
   single words (measured), so nothing existing is affected.
7. **Is "2 Class-based + 1 free" a player rule or Conduit guidance?** Treated as
   a player rule for aspirant, since `stat_spread` implements exactly that shape
   and all 12 V1 classes conform. Aspiring's three Traits are all free (pg. 90).
8. **pg. 90's "three of which must go to the Stats of your chosen Traits" is
   ambiguous**: three pluses spread one per Trait Stat, or three pluses in any
   arrangement across those three Stats. Read as **one plus on each of the three
   Trait Stats**, with the fourth free. Why: it matches the aspirant partition
   the rule is a variation of (3 class + 1 Trait + 2 free is also positional),
   and it is the reading under which the +++ ceiling cannot be breached at
   creation, so it needs no second guard. Cost if wrong: an aspiring player who
   wanted two pluses on one Trait's Stat is refused, with a message naming the
   rule, and the reading is one constant away from the alternative.

## Success criteria

1. `util/stat-caps.js` is the only place on the server where any of its figures
   appears, verified by grep.
2. Every figure is pinned by a test that breaks when the figure changes.
3. `traits.stat` is `NOT NULL` and correct for all 981 existing rows.
4. A V1 save that breaches a per-stat Cap is refused on create and on update.
5. A V1 save that exceeds the creation allotment is refused on create and
   accepted on update, deliberately and legibly.
6. An aspiring character is allotted 4 pluses, with 3 constrained to its Traits'
   Stats.
7. A Trait whose Stat cannot be resolved is refused, never stored as null, and a
   multi-word Trait name is refused for a V1 economy.
8. No stat column accepts a negative value.
9. All 327 existing characters still load, render and save unchanged; row counts
   are unchanged.
10. `data.traits` — the shape the read paths in `services/character/repository.js`
    and `models/character.js#getCharacter` produce — has exactly one form, and all
    four display sites render the Trait name.

    This is narrower than "one shape everywhere", deliberately.
    `serializeCharacterForAgent` (`models/character.js:418`) emits its own
    `traits` field of bare names, from a separate `personality:traits(name)`
    select (`services/character/repository.js:225`) that does not fetch `stat`.
    That is an agent-facing payload — an external boundary, where a narrower
    projection is legitimate for the same reason the Markdown/JSON export keeps
    names. Enriching it with Stat affiliations would change a published payload
    and is a decision for whoever owns the agent API, not for this slice.
