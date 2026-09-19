# ENCLAVE: Aspirant V1 — Stat Caps and Traits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the server its first stat enforcement, and make a Stat Cap derivable — base 5, plus one per Personality Trait affiliated with that Stat, plus one per two pluses spent — by persisting the Trait→Stat affiliation the app already collects and discards.

**Architecture:** One pure definition module (`util/stat-caps.js`) holds every figure and every piece of arithmetic, mirroring `util/merx-economy.js`. Storage grows two places: a `stat` column on `traits` and a `stat_cap_purchases` jsonb on `characters`. Two validators (`validateTraits`, `validateStatLimits`) plug into `normalizeCharacterInput`, the single extension point both save paths already pass through. Enforcement is asymmetric on purpose: the per-stat Cap runs on every save, the creation allotment only at creation.

**Tech Stack:** Bun, `bun:test`, Express 4, express-handlebars, Supabase/Postgres. `util/` is CommonJS, `scripts/` is ESM, `public/js/` is browser IIFEs.

**Spec:** `docs/superpowers/specs/2026-09-19-aspirant-v1-stat-caps-and-traits-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Figures, from the book. Each appears exactly once on the server, in `util/stat-caps.js`.** Base Stat Cap **5** (pg. 3, restated pg. 6). Creation ceiling **+++ = 3**, counting class and Trait grants (Advent pg. 16 step 4c, carried by pg. 3). Trait Cap grant **+1** per Trait to its Stat (pg. 3, restated pg. 6). Purchased Cap **2 pluses for +1** (pg. 3). Creation allotment **6** aspirant / **4** aspiring (Advent pg. 16 via pg. 3; pg. 90). Level growth **+2 per level above 1**. Trait count **exactly 3** (pg. 110). Page numbers are PRINTED pages of ENCLAVE: Aspirant V1; the PDF page is printed + 5.
- **`util/stat-caps.js` contains no `require` statement at all**, exactly like `util/merx-economy.js`. It is pure arithmetic over values handed to it.
- **Nothing throws.** Validators return `{ ok: true }` or `{ ok: false, errors }`, matching `validateAbilityPerks` (`util/validate.js:48-77`) and `validateEconomyLimits` (`services/character/input.js:168-199`). The POST handlers in `routes/characters.js` are unwrapped `async` functions, so a throw becomes an unhandled rejection and **the request hangs** rather than erroring.
- **Enforcement applies to the `aspirant` and `aspiring` economies only.** `advent` returns early, untouched. There are 0 aspirant and 0 aspiring characters and 327 advent/legacy ones; this is what makes hard enforcement safe.
- **A comment stating a fact must be TRUE.** Check every claim against the code before writing it. Nine of slice 4's ten tasks caught a false comment that originated in its plan text.
- **No dead code.** When you replace something, delete it in the same change.
- **Row counts must not change**: characters 327, traits 981, class_gear 1492, class_abilities 916, classes 62.

### Local stack safety — read before any task that touches the database

```bash
eval "$(supabase status -o env)"
echo "API_URL=$API_URL"
grep -E '^SUPABASE_URL=' .env
```

`API_URL` **must** print `http://127.0.0.1:54321`, and the `.env` line must name the same host. If either does not, stop.

`supabase status -o env` exports `API_URL`, `DB_URL` and `SERVICE_ROLE_KEY` — it does **not** export `SUPABASE_URL`, so checking `$SUPABASE_URL` after that eval confirms nothing. `.env` is the file the app reads and is hand-switched between this local stack and a **live production** project, which is why both halves matter.

**NEVER run `supabase db reset`** — the local database holds a restored copy of production data, not seed data. Apply migrations with `supabase migration up` only. Never read or restore anything under `backups/`.

`bun run test:unit` is always safe (it overrides `SUPABASE_URL` to `https://test.invalid`). `bun test <file>` directly does **not** get that override. An integration test file must be registered in the `integrationFiles` allowlist at `scripts/run-tests.mjs:7-22` or it silently never runs.

### Sequencing constraint that is easy to get wrong

`traits.stat` **must not be `NOT NULL` until every write path supplies it.** Task 2 adds it nullable and backfills; Task 4 teaches the RPC and the JS reconciler to carry it; only then does Task 9 add the `NOT NULL`. Adding the constraint in Task 2 would make every character save fail immediately, because `save_character_atomic` does not yet know the column exists.

### The trap that cost slice 4 a fix round

`reconcileTraits` and `reconcileGear` in `services/character/service.js` run **only** when `adapter.saveCharacterAtomic` is not a function. With the real client it always is (`services/character/repository.js:249-250`), so **`save_character_atomic` is what actually executes on every real save.** A change to the JS reconciler alone looks correct in unit tests and drops the data in production. Change both.

---

## File Structure

**Created**
- `util/stat-caps.js` — every figure and all cap/allotment arithmetic. Pure, no `require`.
- `util/stat-caps.test.js` — figure pinning plus function behaviour.
- `supabase/migrations/20260919000000_traits_stat_affiliation.sql` — `traits.stat` nullable, backfilled, CHECKed.
- `supabase/migrations/20260919000001_characters_stat_cap_purchases.sql` — the jsonb column and its two CHECKs.
- `supabase/migrations/20260919000002_save_character_atomic_trait_stat.sql` — the RPC carries `stat`.
- `supabase/migrations/20260919000003_stat_floor_and_trait_stat_notnull.sql` — `>= 0` on twelve stat columns; `traits.stat NOT NULL`.
- `util/stat-caps-integrity.integration.test.js` — the constraints and the RPC, against the local stack.

**Modified**
- `services/character/input.js` — trait shaping, `validateTraits`, `validateStatLimits`, wiring into `normalizeCharacterInput`.
- `services/character/service.js` — threading economy/level/class spread/stored purchases; `reconcileTraits` carries `stat`.
- `services/character/repository.js`, `models/character.js` — stop collapsing trait rows to names.
- `util/character-export.js`, `views/character.handlebars`, `views/partials/character-details.handlebars`, `views/character-form.handlebars` — read `{name, stat}`.
- `models/class.js` — expose `statSpreadByClassId` from data already fetched.
- `public/js/character-wizard.js` — submit each Trait's Stat; aspiring allotment.

---

## Task 1: The definition module

**Files:**
- Create: `util/stat-caps.js`
- Test: `util/stat-caps.test.js`

**Interfaces:**
- Consumes: nothing. This task has no dependencies and no `require`.
- Produces: `BASE_STAT_CAP`, `CREATION_STAT_CAP`, `CAP_INCREASE_PLUS_COST`, `CREATION_PLUSES`, `LEVEL_PLUSES_PER_LEVEL`, `TRAIT_COUNT`, `STAT_SANITY_BOUND`, `statCapFor(stat, {traits, capPurchases})`, `plusAllotment({economy, level})`, `traitGrantFor(traits, economy)`, `assignedPluses({stats, classSpread, traitGrant})`, `capBreaches({stats, traits, capPurchases})`, `creationCeilingBreaches(stats)`.

- [ ] **Step 1: Write the failing test**

```js
const { test, expect } = require('bun:test');
const {
  BASE_STAT_CAP, CREATION_STAT_CAP, CAP_INCREASE_PLUS_COST,
  CREATION_PLUSES, LEVEL_PLUSES_PER_LEVEL, TRAIT_COUNT,
  statCapFor, plusAllotment, traitGrantFor, assignedPluses,
  capBreaches, creationCeilingBreaches
} = require('./stat-caps.js');

// Figures, each pinned so that changing it breaks a named test.
test('the book figures are what the book says', () => {
  expect(BASE_STAT_CAP).toBe(5);              // pg. 3, restated pg. 6
  expect(CREATION_STAT_CAP).toBe(3);          // Advent pg. 16 step 4c
  expect(CAP_INCREASE_PLUS_COST).toBe(2);     // pg. 3
  expect(LEVEL_PLUSES_PER_LEVEL).toBe(2);
  expect(TRAIT_COUNT).toBe(3);                // pg. 110
  expect(CREATION_PLUSES.aspirant).toBe(6);   // Advent pg. 16 via pg. 3
  expect(CREATION_PLUSES.aspiring).toBe(4);   // pg. 90
  expect(CREATION_PLUSES.advent).toBe(6);
});

test('a Trait raises its own Stat Cap and no other', () => {
  const traits = [{ name: 'brave', stat: 'might' }, { name: 'calm', stat: 'will' }];
  expect(statCapFor('might', { traits })).toBe(6);
  expect(statCapFor('will', { traits })).toBe(6);
  expect(statCapFor('luck', { traits })).toBe(5);
});

test('two Traits on one Stat stack, and purchases stack on top', () => {
  const traits = [{ name: 'brave', stat: 'might' }, { name: 'bold', stat: 'might' }];
  expect(statCapFor('might', { traits })).toBe(7);
  expect(statCapFor('might', { traits, capPurchases: { might: 2 } })).toBe(9);
});

test('a missing or junk purchase count never lowers a Cap', () => {
  expect(statCapFor('luck', {})).toBe(5);
  expect(statCapFor('luck', { capPurchases: { luck: -4 } })).toBe(5);
  expect(statCapFor('luck', { capPurchases: { luck: 'two' } })).toBe(5);
});

test('the allotment grows by two per level and is unknown for an unknown economy', () => {
  expect(plusAllotment({ economy: 'aspirant', level: 1 })).toBe(6);
  expect(plusAllotment({ economy: 'aspirant', level: 5 })).toBe(14);
  expect(plusAllotment({ economy: 'aspiring', level: 1 })).toBe(4);
  expect(plusAllotment({ economy: 'aspiring', level: 3 })).toBe(8);
  expect(plusAllotment({ economy: 'nonsense', level: 1 })).toBeNull();
});

// The decomposition differs by economy: aspiring's three Trait-Stat pluses are
// PART of its four, not a grant on top (pg. 90), so it has no automatic grant.
test('only advent and aspirant get the third Trait value grant', () => {
  const traits = [
    { name: 'brave', stat: 'might' },
    { name: 'calm', stat: 'will' },
    { name: 'sharp', stat: 'sensory' }
  ];
  expect(traitGrantFor(traits, 'aspirant')).toEqual({ sensory: 1 });
  expect(traitGrantFor(traits, 'advent')).toEqual({ sensory: 1 });
  expect(traitGrantFor(traits, 'aspiring')).toEqual({});
});

test('assignedPluses recovers what the player spent', () => {
  const stats = { might: 2, sensory: 2, will: 1 };
  expect(assignedPluses({
    stats, classSpread: { might: 1, sensory: 2 }, traitGrant: { will: 1 }
  })).toBe(1);
  expect(assignedPluses({ stats })).toBe(5);
});

test('capBreaches names every stat over its own Cap and nothing else', () => {
  const traits = [{ name: 'brave', stat: 'might' }];
  expect(capBreaches({ stats: { might: 6, luck: 5 }, traits })).toEqual([]);
  expect(capBreaches({ stats: { might: 7, luck: 6 }, traits }))
    .toEqual([{ stat: 'might', value: 7, cap: 6 }, { stat: 'luck', value: 6, cap: 5 }]);
});

test('creationCeilingBreaches uses the +++ ceiling, not the base Cap', () => {
  expect(creationCeilingBreaches({ might: 3 })).toEqual([]);
  expect(creationCeilingBreaches({ might: 4 })).toEqual([{ stat: 'might', value: 4, cap: 3 }]);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test:unit`
Expected: FAIL — cannot find module `./stat-caps.js`.

- [ ] **Step 3: Write the module**

```js
// The single definition of every Stat Cap and plus-allotment figure ENCLAVE:
// Aspirant V1 states, and all the arithmetic over them.
//
// Deliberately require-free, exactly like util/merx-economy.js: this module is
// pure arithmetic over values its callers hand it, so it can be read in one
// sitting and tested without a database, a class row or a request.
//
// Page numbers are PRINTED pages of ENCLAVE: Aspirant V1 (the PDF page is the
// printed page plus five). Where a figure is stated on two pages, both are
// cited -- this project has twice cited one page for a rule the book states
// twice.

// A Stat's Cap is not a constant under Aspirant. It starts here (pg. 3,
// restated pg. 6) and rises with Traits and purchases; pg. 3's "Scaling
// Beyond" sidebar states there is no theoretical maximum, which is why no
// upper bound appears in this module or in a CHECK constraint.
const BASE_STAT_CAP = 5;

// During creation no Stat may exceed +++ counting EVERY source -- the class
// spread and the third Trait's grant included, not just what the player
// assigned (Advent pg. 16 step 4c, carried unchanged by Aspirant pg. 3).
const CREATION_STAT_CAP = 3;

// pg. 3: two pluses buy +1 Cap. A third is then needed to fill it, which is
// why buying a Cap is a poor deal unless the Stat is already at its ceiling.
const CAP_INCREASE_PLUS_COST = 2;

// Total pluses at creation, before level growth.
//
// `advent` records 6 because 6 is the true Advent figure and the wizard uses
// it. It is never enforced -- validateStatLimits returns early for advent --
// and recording a false value to signal "unenforced" would be a lie in the one
// module that exists to be authoritative. SIGNATURE_CAP.advent in
// util/merx-economy.js is null for the same kind of reason: Advent has no such
// cap, so null is the true answer there.
const CREATION_PLUSES = { advent: 6, aspirant: 6, aspiring: 4 };

const LEVEL_PLUSES_PER_LEVEL = 2;

// pg. 110: Flavor cannot grant "a fourth Personality Trait", so three is a
// hard ceiling rather than a starting number. All 981 live trait rows already
// sit at exactly three per character.
const TRAIT_COUNT = 3;

// NOT a rules figure. The pre-existing [0, 20] clamp in
// services/character/input.js normalizeStatsPayload needs a name rather than a
// literal, and it is a guard against a runaway request body, not the Cap. The
// Cap is statCapFor below, and it is what refuses an illegal build.
const STAT_SANITY_BOUND = 20;

// pg. 3, restated pg. 6: each Trait grants +1 Cap to the Stat it is affiliated
// with. Reads `trait.stat`, the column Task 2 adds -- never a name lookup, so
// a self-made Trait word cannot silently cost its Cap.
const statCapFor = (stat, { traits, capPurchases } = {}) => {
    const rows = Array.isArray(traits) ? traits.filter(Boolean) : [];
    const fromTraits = rows.reduce((n, trait) => n + (trait.stat === stat ? 1 : 0), 0);
    const purchased = Math.max(0, Math.floor(Number((capPurchases || {})[stat])) || 0);
    return BASE_STAT_CAP + fromTraits + purchased;
};

// null for an economy this module has no figure for, so a caller must decide
// what to do rather than silently enforcing zero.
const plusAllotment = ({ economy, level } = {}) => {
    const base = CREATION_PLUSES[economy];
    if (base == null) return null;
    const levels = Math.max(1, Math.floor(Number(level)) || 1);
    return base + LEVEL_PLUSES_PER_LEVEL * (levels - 1);
};

// The third Trait's Stat gets +1 to its VALUE at creation (Advent pg. 16) --
// a different mechanic from the +1 CAP every Trait grants, and the two are
// easy to conflate.
//
// Aspiring has no such grant: pg. 90's three Trait-Stat pluses are three of
// the four the player distributes, not a bonus on top. Handing an
// aspirant-shaped grant to an aspiring character would understate what the
// player spent by one.
const traitGrantFor = (traits, economy) => {
    if (economy === 'aspiring') return {};
    const rows = Array.isArray(traits) ? traits : [];
    const third = rows[2];
    return (third && third.stat) ? { [third.stat]: 1 } : {};
};

const sumValues = (map) => Object.values(map || {})
    .reduce((total, value) => total + (Math.floor(Number(value)) || 0), 0);

// What the PLAYER assigned, recovered from a stored total by removing the two
// automatic grants. This is the same arithmetic the wizard performs at
// public/js/character-wizard.js:810 when it decides how many boxes remain
// assignable.
const assignedPluses = ({ stats, classSpread, traitGrant } = {}) =>
    sumValues(stats) - sumValues(classSpread) - sumValues(traitGrant);

const breachesAgainst = (stats, capOf) => Object.keys(stats || {})
    .map((stat) => ({ stat, value: Math.floor(Number(stats[stat])) || 0, cap: capOf(stat) }))
    .filter((row) => row.value > row.cap);

const capBreaches = ({ stats, traits, capPurchases } = {}) =>
    breachesAgainst(stats, (stat) => statCapFor(stat, { traits, capPurchases }));

const creationCeilingBreaches = (stats) => breachesAgainst(stats, () => CREATION_STAT_CAP);

module.exports = {
    statCapFor,
    plusAllotment,
    traitGrantFor,
    assignedPluses,
    capBreaches,
    creationCeilingBreaches,
    BASE_STAT_CAP,
    CREATION_STAT_CAP,
    CAP_INCREASE_PLUS_COST,
    CREATION_PLUSES,
    LEVEL_PLUSES_PER_LEVEL,
    TRAIT_COUNT,
    STAT_SANITY_BOUND
};
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun run test:unit`
Expected: PASS.

- [ ] **Step 5: Note the one constant with no consumer**

`CAP_INCREASE_PLUS_COST` is defined and pinned but nothing in this slice calls
it, because the 2-pluses-for-+1-Cap **purchase** is out of scope — only its
stored result is. That is deliberate and spec-mandated, the same situation as
`ABILITY_CAP` in `util/merx-economy.js`, which the Merx slice's final review
examined and upheld because its spec said "recorded, enforced in 4b". Do not
invent a consumer to make it look used, and do not delete it. Say in your report
that it is a forward declaration so the reviewer does not have to rediscover it.

- [ ] **Step 6: Prove each figure is pinned**

For each of the eight figures, change it in the module, run `bun run test:unit`, and record which named test fails. Restore the figure. A figure no test catches is a figure that is not really defined here. Report the table.

- [ ] **Step 7: Commit**

```bash
git add util/stat-caps.js util/stat-caps.test.js
git commit -m "feat: add util/stat-caps.js as the single definition of V1 stat figures"
```

---

## Task 2: `traits.stat`, nullable and backfilled

**Files:**
- Create: `supabase/migrations/20260919000000_traits_stat_affiliation.sql`
- Test: `util/stat-caps-integrity.integration.test.js`
- Modify: `scripts/run-tests.mjs:7-22` (register the new integration file)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `traits.stat TEXT NULL`, backfilled for all 981 rows, CHECKed to the twelve stat names when non-null.

**The column is nullable in this migration and becomes `NOT NULL` in Task 9.** Adding the constraint now would break every character save, because `save_character_atomic` does not learn about the column until Task 4.

- [ ] **Step 1: Generate the backfill pairs — do not retype them**

The 48 word→Stat pairs are `personalityMap` in `util/enclave-consts.js`. Generate the SQL rather than transcribing it, so it cannot drift:

```bash
node -e "
const {personalityMap}=require('./util/enclave-consts.js');
const rows=[];
for (const [stat, words] of Object.entries(personalityMap)) {
  for (const w of words) rows.push(\"    ('\" + String(w).toLowerCase() + \"','\" + stat + \"')\");
}
console.error('pairs: ' + rows.length);
console.log(rows.join(',\n'));
"
```

Expected on stderr: `pairs: 48`. If it is not 48, stop and report — the vocabulary changed and this plan's measurements no longer hold.

- [ ] **Step 2: Write the migration**

```sql
-- A Personality Trait is affiliated with exactly one Stat, and under ENCLAVE:
-- Aspirant V1 that affiliation has mechanical weight: each Trait grants +1 Cap
-- to its Stat (ENCLAVE: Aspirant, pg. 3, restated pg. 6). A Cap therefore
-- cannot be computed from a character's row alone, and until now the
-- affiliation was nowhere in the database -- the wizard resolved it in the
-- browser and dropped it at the payload boundary.
--
-- Stored rather than derived on read. The vocabulary is closed today and every
-- one of its 48 words maps to exactly one Stat, so this column is derivable
-- right now; it is stored because pg. 3 makes Aspirant Traits "fully
-- customizable", and a self-made word has no vocabulary entry. Deriving would
-- return no Stat for a legal Trait and silently cost it a Cap. The vocabulary
-- decides the affiliation at write time; this column is authoritative at read
-- time.
--
-- Nullable here on purpose. public.save_character_atomic does not carry this
-- column until 20260919000002, so a NOT NULL now would fail every character
-- save. 20260919000003 adds it once every write path supplies a value.
ALTER TABLE public.traits ADD COLUMN stat TEXT;

-- One-time snapshot of util/enclave-consts.js personalityMap, generated by the
-- command in this task's Step 1 rather than retyped. A migration runs once, so
-- this is a historical record and not a second live definition of the
-- vocabulary -- the same reasoning as
-- 20260904000001_backfill_gear_category.sql, which froze the gear column split
-- the same way.
WITH vocabulary (word, stat) AS (
  VALUES
    -- The 48 rows printed by this task's Step 1 command, pasted verbatim.
    -- Do not retype them and do not abbreviate the list: the DO block below
    -- fails the migration if even one live trait name goes unmapped.
)
UPDATE public.traits t
SET stat = v.stat
FROM vocabulary v
WHERE lower(btrim(t.name)) = v.word
  AND t.stat IS NULL;

-- Every one of the 981 live rows is expected to match. Fail loudly rather than
-- leaving a partial backfill for a later constraint to trip over.
DO $$
DECLARE unmapped integer;
BEGIN
  SELECT count(*) INTO unmapped FROM public.traits WHERE stat IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION 'traits.stat backfill left % row(s) unmapped', unmapped;
  END IF;
END $$;

-- Twelve stats, the same list as util/enclave-consts.js statList and as the
-- twelve columns on public.characters. `stat IS NULL OR ...` is what makes the
-- constraint safe while the column is still nullable; 20260919000003 removes
-- the null half along with the nullability.
ALTER TABLE public.traits ADD CONSTRAINT traits_stat_known CHECK (
  stat IS NULL OR stat IN (
    'vitality','might','resilience','spirit','arcane','will',
    'sensory','reflex','vigor','skill','intelligence','luck'
  )
);
```

- [ ] **Step 3: Apply it and verify against live data**

```bash
supabase migration up
```

Then confirm, and report the numbers:

```bash
node -e "
require('dotenv').config();
const {createClient}=require('@supabase/supabase-js');
const s=createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SERVICE_ROLE_KEY);
(async()=>{
  const {data}=await s.from('traits').select('name,stat');
  console.log('rows', data.length, '| null stat', data.filter(t=>!t.stat).length);
  const byStat={}; for(const t of data) byStat[t.stat]=(byStat[t.stat]||0)+1;
  console.log(byStat);
})();"
```

Expected: `rows 981 | null stat 0`, and twelve stat keys.

- [ ] **Step 4: Write the rejected-write test**

Create `util/stat-caps-integrity.integration.test.js`, starting with `require('./require-local-supabase');` exactly as the sibling integration tests do, and register it in `scripts/run-tests.mjs`'s `integrationFiles` set — **a file in neither allowlist runs in unit mode and fails on a scrubbed `SUPABASE_URL` rather than being skipped.**

Test, by attempting the writes and asserting on the error rather than by reading the DDL:

1. inserting a trait with `stat: 'nonsense'` is rejected by `traits_stat_known`;
2. inserting a trait with `stat: null` is still accepted (the nullable half, which Task 9 removes);
3. every one of the twelve names from `statList` is accepted.

Clean up every row the test inserts, and assert the row count is 981 again at the end.

- [ ] **Step 5: Run it**

Run: `bun run test:integration`
Expected: PASS, and `bun run test:unit` still exit 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260919000000_traits_stat_affiliation.sql util/stat-caps-integrity.integration.test.js scripts/run-tests.mjs
git commit -m "feat: give traits a Stat affiliation, backfilled from the vocabulary"
```

---

## Task 3: `characters.stat_cap_purchases`

**Files:**
- Create: `supabase/migrations/20260919000001_characters_stat_cap_purchases.sql`
- Test: `util/stat-caps-integrity.integration.test.js` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `characters.stat_cap_purchases jsonb NOT NULL DEFAULT '{}'`, keys constrained to the twelve stat names, values to non-negative integers.

- [ ] **Step 1: Write the failing test first**

Extend the integration file with the four shapes that must be REJECTED and the three that must be accepted. Write these before the migration and watch them fail:

- rejected: `{"nonsense": 1}` (unknown key), `{"might": -1}` (negative), `{"might": 1.5}` (non-integer), `{"might": "two"}` (non-number)
- accepted: `{}`, `{"might": 1}`, `{"might": 2, "luck": 3}`

**The failure mode to test for explicitly:** a CHECK that evaluates to SQL NULL **passes**. Include `{"might": null}` and assert it is REJECTED. That exact shape was one of slice 4's two Criticals — `enchantment->>'source' IN (...)` is NULL when the key is absent, so `{}` and `{"name":"Foo"}` were both storable and priced as a free Enchantment.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun run test:integration`
Expected: FAIL — the column does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- ENCLAVE: Aspirant, pg. 3: two pluses may be spent outright for +1 Stat Cap.
-- A character's Cap for a Stat is therefore BASE_STAT_CAP, plus one per Trait
-- affiliated with that Stat, plus whatever was bought here
-- (util/stat-caps.js statCapFor).
--
-- One jsonb map rather than twelve more integer columns: util/enclave-consts.js
-- statList exists to paper over the twelve stat columns public.characters
-- already carries, and doubling them would widen every read and write site for
-- no gain.
--
-- The purchase SURFACE is not built in this slice -- spending needs a caller
-- that knows a character's mission-earned Merx, which the Merx slice's plan 2
-- still owes. This column is where that purchase will land, and it is what
-- makes the Cap derivation complete today.
ALTER TABLE public.characters
  ADD COLUMN stat_cap_purchases jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Both constraints must hold for EVERY storable value, including an empty
-- object and a key whose value is JSON null. A CHECK that evaluates to NULL
-- PASSES, so neither may be written as a bare comparison against
-- `value->>'key'`: that is exactly how a free Enchantment became storable in
-- 20260918000000, fixed in 20260918000002.
--
-- `NOT EXISTS (... WHERE <violation>)` is total by construction: an empty
-- object has no rows to violate it and the predicate is FALSE rather than
-- NULL, so the constraint is TRUE.
ALTER TABLE public.characters ADD CONSTRAINT characters_stat_cap_purchase_keys CHECK (
  jsonb_typeof(stat_cap_purchases) = 'object'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(stat_cap_purchases) AS k(key)
    WHERE k.key NOT IN (
      'vitality','might','resilience','spirit','arcane','will',
      'sensory','reflex','vigor','skill','intelligence','luck'
    )
  )
);

ALTER TABLE public.characters ADD CONSTRAINT characters_stat_cap_purchase_values CHECK (
  NOT EXISTS (
    SELECT 1 FROM jsonb_each(stat_cap_purchases) AS e(key, value)
    WHERE jsonb_typeof(e.value) <> 'number'
       OR (e.value)::numeric < 0
       OR (e.value)::numeric <> trunc((e.value)::numeric)
  )
);
```

- [ ] **Step 4: Apply and confirm the live rows are unaffected**

```bash
supabase migration up
```

`ADD COLUMN ... NOT NULL DEFAULT` takes Postgres's fast-default path and rewrites no rows. Confirm all 327 characters now read `{}` and the count is unchanged.

- [ ] **Step 5: Run the tests**

Run: `bun run test:integration` then `bun run test:unit`
Expected: both PASS, all seven shapes behaving as specified, `{"might": null}` **rejected**.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260919000001_characters_stat_cap_purchases.sql util/stat-caps-integrity.integration.test.js
git commit -m "feat: store purchased Stat Cap increases on the character row"
```

---

## Task 4: both save paths carry `traits.stat`

**Files:**
- Create: `supabase/migrations/20260919000002_save_character_atomic_trait_stat.sql`
- Modify: `services/character/service.js` (`reconcileTraits`)
- Test: `services/character/service.test.js`, `util/stat-caps-integrity.integration.test.js`

**Interfaces:**
- Consumes: `traits.stat` from Task 2.
- Produces: a trait row written with its `stat` by both the RPC and the JS reconciler. `childData.traits` may be `[{name, stat}]` from here on.

**Read `supabase/migrations/20260918000001_save_character_atomic_gear_equipment.sql` first.** It is the most recent revision of this RPC and the template for revising it: copy the whole function body forward and change only the trait portion. The trait diff pairs rows by `(name, occurrence)` with a FIFO index.

- [ ] **Step 1: Write the failing tests**

In `services/character/service.test.js`, assert that a save whose `childData.traits` is `[{name:'brave', stat:'might'}, ...]` reaches `saveCharacterAtomic` with `p_traits` carrying both fields — not names alone. Then a second test for the reconciler fallback (call it with an adapter whose `saveCharacterAtomic` is undefined) asserting the inserted row carries `stat`.

In the integration file, save a real character through the RPC and read `traits` back, asserting `stat` persisted.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun run test:unit`
Expected: FAIL — `stat` is dropped.

- [ ] **Step 3: Revise the RPC**

Carry `stat` through the trait CTEs exactly as `20260918000001` carries `enchantment` and `mods` through the gear ones. A trait's `stat` is always supplied by the caller from Task 6 onward, so it needs no preserve-on-absent behaviour — unlike gear's `enchantment`, where an absent key means "keep what is stored". Do not copy that conditional here; say so in the migration header, because the neighbouring gear code has it and a reader will wonder.

- [ ] **Step 4: Fix `reconcileTraits`**

`services/character/service.js:487-496` diffs traits by name only and inserts `{character_id, name}`. Carry `stat` into both the comparison and the inserted row. Keep the existing null/empty filtering.

- [ ] **Step 5: Run everything**

Run: `bun run test:unit`, `bun run check`, `bun run test:integration`
Expected: all exit 0; row counts unchanged.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260919000002_save_character_atomic_trait_stat.sql services/character/service.js services/character/service.test.js util/stat-caps-integrity.integration.test.js
git commit -m "feat: carry a trait's Stat through both save paths"
```

---

## Task 5: one read shape for a trait

**Files:**
- Modify: `services/character/repository.js:132`, `models/character.js:159`, `util/character-export.js:89-90` and `:255`, `views/character.handlebars:82`, `views/partials/character-details.handlebars:36-39`, `views/character-form.handlebars:173`
- Test: `util/character-export.test.js`, plus a rendering test per view

**Interfaces:**
- Consumes: `traits.stat` from Task 2.
- Produces: `character.traits` is `[{name, stat}]` everywhere. The two `traits.map(trait => trait.name)` collapses are **deleted**, not kept alongside.

- [ ] **Step 1: Write the failing tests**

One test per display site, asserting the rendered Trait **name** appears in the output. A missed `{{#each}}` renders `[object Object]` silently, and no server-side shape assertion catches that — these four tests are the only thing that will.

For the views, follow the harness recipe the slice-4 task used in `views/character-wizard.test.js` (a full Handlebars-engine app with a model mock); do not invent a new one.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun run test:unit`
Expected: FAIL — the sites render names because rows are still collapsed to strings.

- [ ] **Step 3: Delete both collapses and update the consumers**

In `services/character/repository.js` and `models/character.js`, keep the rows: `data.traits = traits.map(({ name, stat }) => ({ name, stat }));` — projecting explicitly rather than passing the raw row, so `id` and `character_id` do not leak into a serialized character.

Then update each of the four display sites to read `.name`. In `character-export.js:255` the exported `traits` field becomes the `{name, stat}` objects; state in the export's own test what the exported shape now is, because that file is a documented interchange format.

- [ ] **Step 4: Run the tests**

Run: `bun run test:unit`, `bun run check`
Expected: exit 0.

- [ ] **Step 5: Check for readers this plan did not list**

```bash
grep -rn "\.traits\b\|traits\[" routes util views services models public/js | grep -v "\.test\."
```

Any consumer that indexes a trait as a string and is not in this task's file list is a site this plan missed. Fix it and say so in your report.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: give a character's traits one shape, name and stat"
```

---

## Task 6: resolve and validate Traits

**Files:**
- Modify: `services/character/input.js`
- Test: `services/character/input.test.js`

**Interfaces:**
- Consumes: `TRAIT_COUNT` from Task 1; the `{name, stat}` shape from Task 5.
- Produces: `shapeTrait(value, { submittedStat })` → `{value, error}`; `validateTraits(traits, { economy })` → `{ok}` / `{ok:false, errors}`; `childData.traits` as `[{name, stat}]`.

Both this task and Task 7 modify `services/character/input.js`. They must run **sequentially, never in parallel**, and whichever runs second re-reads the file as it then stands.

- [ ] **Step 1: Write the failing tests**

```js
test('a vocabulary word resolves to its Stat without a submitted stat', () => {
  const { value, error } = shapeTrait('brave', {});
  expect(error).toBeNull();
  expect(value.stat).toBe(personalityMap.might.includes('brave') ? 'might' : value.stat);
});

test('a submitted stat wins for a self-made word', () => {
  const { value, error } = shapeTrait('moonstruck', { submittedStat: 'arcane' });
  expect(error).toBeNull();
  expect(value).toEqual({ name: 'moonstruck', stat: 'arcane' });
});

test('an unresolvable Trait is refused, never stored with a null stat', () => {
  const { value, error } = shapeTrait('moonstruck', {});
  expect(value).toBeUndefined();
  expect(error).toMatch(/moonstruck/);
});

test('a submitted stat outside the twelve is refused', () => {
  expect(shapeTrait('moonstruck', { submittedStat: 'vibes' }).error).toMatch(/vibes/);
});

// A Trait is a single word (pg. 6, pg. 121). The book states no word COUNT
// limit, unlike Enchantments (40) and Mods (10), so none is invented.
// The test is for WHITESPACE, not for letters only: `fun-loving` is a real
// vocabulary word and an alphabetic-only check would refuse it.
test('a hyphenated vocabulary word is accepted and a two-word name is not', () => {
  expect(shapeTrait('fun-loving', {}).error).toBeNull();
  expect(shapeTrait('very brave', { submittedStat: 'might' }).error).toMatch(/single word/);
});

test('V1 economies require exactly three Traits, each on its own Stat', () => {
  const three = [
    { name: 'brave', stat: 'might' }, { name: 'calm', stat: 'will' }, { name: 'sharp', stat: 'sensory' }
  ];
  expect(validateTraits(three, { economy: 'aspirant' })).toEqual({ ok: true });
  expect(validateTraits(three.slice(0, 2), { economy: 'aspirant' }).ok).toBe(false);
  const collide = [{ name: 'brave', stat: 'might' }, { name: 'bold', stat: 'might' }, { name: 'calm', stat: 'will' }];
  expect(validateTraits(collide, { economy: 'aspirant' }).ok).toBe(false);
});

// 26 of the 327 live characters have two Traits on one Stat and all 26 are
// advent. Enforcing there would make them unsaveable.
test('advent is not held to either Trait rule', () => {
  const collide = [{ name: 'brave', stat: 'might' }, { name: 'bold', stat: 'might' }];
  expect(validateTraits(collide, { economy: 'advent' })).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun run test:unit`
Expected: FAIL — neither function exists.

- [ ] **Step 3: Implement**

`shapeTrait` follows `shapeEnchantment`'s established contract in the same file: return `{value, error}`, never throw, `value: undefined` on rejection so a caller cannot mistake a refusal for an empty value. Resolution order is the submitted stat first, then the vocabulary — the submitted value is the player's explicit choice and pg. 3 makes Traits fully customizable, so it must not be overridden by a coincidental vocabulary match.

`validateTraits` returns `{ok: true}` immediately for `advent`.

Wire trait shaping into `normalizeCharacterInput` so `childData.traits` carries `{name, stat}`, reading the submitted `trait0_stat`/`trait1_stat`/`trait2_stat` fields Task 10 adds to the payload. **The server must work before the client changes**, so absent stat fields fall back to the vocabulary, which is what every existing request will do.

- [ ] **Step 4: Run the tests**

Run: `bun run test:unit`, `bun run check`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/character/input.js services/character/input.test.js
git commit -m "feat: resolve and validate a Trait's Stat on the way in"
```

---

## Task 7: `validateStatLimits`

**Files:**
- Modify: `services/character/input.js`
- Test: `services/character/input.test.js`

**Interfaces:**
- Consumes: `capBreaches`, `creationCeilingBreaches`, `plusAllotment`, `traitGrantFor`, `assignedPluses` from Task 1.
- Produces: `validateStatLimits({ economy, stats, traits, capPurchases, classSpread, level, enforceCreationAllotment = true })` → `{ok}` / `{ok:false, errors}`.

- [ ] **Step 1: Write the failing tests**

Cover, at minimum: advent returns `{ok:true}` whatever it is given; a stat at its Cap passes and one over it fails with a message naming the stat, its value and its Cap; a Trait raises the Cap so the same value passes with the Trait and fails without it; a purchased Cap does the same; the creation allotment refuses an over-spend at creation and **accepts the identical payload with `enforceCreationAllotment: false`**; the +++ ceiling refuses a 4 at creation and permits it on update; aspiring's allotment is 4 and aspirant's is 6 at level 1, and both grow by 2 per level.

Pin the asymmetry directly, since it is the design's most surprising property: one test whose only difference between pass and fail is the flag.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun run test:unit`
Expected: FAIL.

- [ ] **Step 3: Implement, and carry the reason for the asymmetry in the code**

```js
// `enforceCreationAllotment` (default true) exists because the per-stat Cap and
// the plus allotment need different information. The Cap needs only a
// character's Traits and its stored Cap purchases, which every caller has. The
// allotment needs to know how many pluses were bought with Merx through Stat
// Training (pg. 85, restated pg. 87), and nothing stores those -- the purchase
// surface is not built. Enforcing the allotment on an edit would therefore
// refuse pluses a player legitimately bought.
//
// Do NOT "tidy this up" by passing an allotment of 0 or by letting the default
// apply on the update path. That would not skip the check; it would enforce it
// against a budget that is wrong for every character who has ever trained a
// Stat, and a gate that refuses legal play is worse than an absent one --
// the absence is obvious, while the false rejection reads as a rules decision.
// validateEconomyLimits in this file splits enforceMerxBudget for the same
// reason, and a reviewer confirmed that comment is what stopped the tidy-up
// from being reintroduced.
```

- [ ] **Step 4: Run the tests**

Run: `bun run test:unit`, `bun run check`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/character/input.js services/character/input.test.js
git commit -m "feat: enforce Stat Caps always and the creation allotment at creation"
```

---

## Task 8: wire both save paths

**Files:**
- Modify: `services/character/service.js`, `models/class.js`
- Test: `services/character/service.test.js`

**Interfaces:**
- Consumes: `validateTraits` and `validateStatLimits` from Tasks 6 and 7.
- Produces: `buildClassContentLookupMaps` additionally returns `statSpreadByClassId`, a `Map` of class id to the class's `stat_spread` object.

- [ ] **Step 1: Expose the class spread without a new query**

`buildClassContentLookupMaps` (`models/class.js:547`) already fetches full class rows — `getClasses` selects `*` — and builds `allClasses` before discarding everything but a few maps. `classRows` comes from `fetchClassFamilyRows`, which selects only five columns (`services/class/repository.js:47`) and does **not** include `stat_spread`.

So build `statSpreadByClassId` from `allClasses`, which is already in memory. **Add no query and widen no select.** Assert this in a test that counts adapter calls, the way slice 4's `expectExactlyOneCatalogueFetch` does.

- [ ] **Step 2: Write the failing tests**

- `createCharacter` refuses a V1 payload whose stats breach a Cap, and refuses one that exceeds the creation allotment.
- `updateCharacter` refuses a Cap breach and **accepts** an over-allotment.
- An advent create and an advent update are byte-for-byte unaffected.
- Creating a character makes exactly the same number of catalogue fetches as before.

- [ ] **Step 3: Run them and confirm they fail**

Run: `bun run test:unit`
Expected: FAIL.

- [ ] **Step 4: Thread the context on the create path**

`createCharacter` already takes one catalogue lookup at `services/character/service.js:136` and reads `content_format` off it for `economyFor`. Take `statSpreadByClassId` from the same `maps` object — no second call — and pass `classSpread`, `level`, the shaped traits and `stat_cap_purchases` into `normalizeCharacterInput`.

- [ ] **Step 5: Thread the context on the update path, and add NOTHING it does not need**

`updateCharacter` already reads the stored character at `:210` (so `existing.data.stat_cap_purchases` and `existing.data.traits` are in hand) and its rules version at `:271`. It passes `enforceCreationAllotment: false`.

**It must not fetch the class spread.** The allotment is not enforced on update, and the Cap does not use the spread, so a lookup here would be dead code that costs a query on every V1 edit. Slice 4 spent three fix rounds adding, then justifying, then deleting exactly such a lookup on this exact function. If you believe the update path needs the spread, stop and say why rather than adding it.

- [ ] **Step 6: Run everything**

Run: `bun run test:unit`, `bun run check`, `bun run test:integration`
Expected: exit 0; row counts unchanged.

- [ ] **Step 7: Commit**

```bash
git add services/character/service.js models/class.js services/character/service.test.js
git commit -m "feat: enforce stat and trait rules on both character save paths"
```

---

## Task 9: the database floor, and `NOT NULL`

**Files:**
- Create: `supabase/migrations/20260919000003_stat_floor_and_trait_stat_notnull.sql`
- Modify: `services/character/input.js` (`normalizeStatsPayload`)
- Test: `util/stat-caps-integrity.integration.test.js`, `services/character/input.test.js`

**Interfaces:**
- Consumes: every write path supplying `traits.stat`, from Tasks 4, 6 and 8.
- Produces: `traits.stat NOT NULL`; `>= 0` on the twelve stat columns; `STAT_SANITY_BOUND` replacing the literal `20`.

- [ ] **Step 1: Write the failing tests**

The stat floor: writing `vitality: -1` is rejected. Do this by attempting the write. Also assert a stat of `9999` is still **accepted** by the database — deliberately, because pg. 3's "Scaling Beyond" sidebar states there is no theoretical maximum and the real Cap is derived per stat, which a per-column CHECK cannot see. The application refuses it; the column does not.

`traits.stat`: inserting a trait with a null stat is now rejected, where Task 2's test asserted it was accepted. **Update that earlier assertion rather than leaving two tests that contradict each other** — and say in your report that you changed it and why.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun run test:integration`
Expected: FAIL.

- [ ] **Step 3: Write the migration**

Drop `traits_stat_known` and re-add it without the `stat IS NULL OR` half, then set the column `NOT NULL`. Add twelve `CHECK (<stat> >= 0)` constraints. Verify first that no live row violates either — the measured minimum is 0 across all 327 characters and no trait row is null after Task 2 — and let the migration fail loudly if that is not true when it runs.

- [ ] **Step 4: Replace the magic number**

`normalizeStatsPayload` (`services/character/input.js:426-432`) clamps `[0, 20]` and serves only `PATCH /characters/:id/stats` and `levelUp`. Replace the literal with `STAT_SANITY_BOUND` and state in a comment what it is and is not: a guard against a runaway request body, not the Cap. The Cap is `validateStatLimits`, and these two paths do not call it — say that plainly rather than implying coverage they do not have.

- [ ] **Step 5: Apply and run everything**

Run: `supabase migration up`, then `bun run test:unit`, `bun run check`, `bun run test:integration`
Expected: exit 0; row counts unchanged; all 327 characters still load.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260919000003_stat_floor_and_trait_stat_notnull.sql services/character/input.js services/character/input.test.js util/stat-caps-integrity.integration.test.js
git commit -m "feat: floor stats at zero and require a Trait's Stat"
```

---

## Task 10: the wizard submits the Stat, and aspiring gets four pluses

**Files:**
- Modify: `public/js/character-wizard.js`
- Test: `public/js/character-wizard.test.js` (or the existing harness for this file — find it before writing a new one)

**Interfaces:**
- Consumes: the server-side fallback from Task 6, so this task cannot break a request that omits the new fields.
- Produces: `trait0_stat`/`trait1_stat`/`trait2_stat` in the submitted payload; a `creator_mode`-aware plus allotment.

- [ ] **Step 1: Write the failing tests**

- The payload built at `public/js/character-wizard.js:3187-3189` carries each Trait's Stat alongside its name, taken from `state.traitStats` when the player chose one and from `getStatForTrait` otherwise.
- `getTotalPoints()` returns **4** for `creator_mode === 'aspiring'` at level 1 and **6** for aspirant and advent, and both still grow by 2 per level.
- An aspiring build may not put two pluses on one Trait's Stat: pg. 90 allots four with **one on each of the three chosen Traits' Stats** and the fourth free. This reading is ruling 8 in the spec — the book's wording admits another, and the spec says why this one was chosen.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun run test:unit`
Expected: FAIL.

- [ ] **Step 3: Implement**

Read the numbers out of the module rather than retyping them if this file can reach it; if it cannot — it is a browser IIFE and `util/` is CommonJS — then take the figures from a `DATA` value the route already serves, and say in your report which route serves it. **Do not hardcode 4 and 6 in the client if there is any way to avoid it.** Serving the module to the browser is the Merx slice's plan 2 and is out of scope here; if no serving mechanism exists yet, hardcode with a comment naming `util/stat-caps.js` as the definition and this as a temporary second copy, and report it as a deferral rather than leaving it silent.

- [ ] **Step 4: Run the tests**

Run: `bun run test:unit`, `bun run test:http`
Expected: `test:unit` exit 0. `test:http` has ONE known pre-existing failure — `routes/open-graph.test.js` "a class page describes the edition, version and teaser" (`tags.image` undefined) — reproducible on clean `main`. Confirm you see that one and no others.

- [ ] **Step 5: Commit**

```bash
git add public/js/character-wizard.js public/js/character-wizard.test.js
git commit -m "fix: submit each Trait's Stat and allot an aspiring character four pluses"
```

---

## Success criteria

Check each against the code, not against a report.

1. `util/stat-caps.js` is the only place on the server where any of its figures appears — verified by grep for each number.
2. Every figure is pinned by a test that breaks when the figure changes.
3. `traits.stat` is `NOT NULL` and correct for all 981 existing rows.
4. A V1 save that breaches a per-stat Cap is refused on create and on update.
5. A V1 save that exceeds the creation allotment is refused on create and accepted on update, deliberately and legibly.
6. An aspiring character is allotted 4 pluses, with one on each of its three Traits' Stats.
7. A Trait whose Stat cannot be resolved is refused, never stored as null; a multi-word name is refused for a V1 economy; `fun-loving` is accepted.
8. No stat column accepts a negative value, and none imposes a maximum.
9. All 327 existing characters still load, render and save unchanged. Row counts: characters 327, traits 981, class_gear 1492, class_abilities 916, classes 62.
10. `character.traits` has exactly one shape, and all four display sites render the Trait name.
11. Creating a character makes no more catalogue fetches than it did before this plan.

## Out of scope

- **Stat Training purchasing** and the 2-pluses-for-+1-Cap purchase. Modelled and derived here; no buy surface.
- **Verifying that a purchased Cap was paid for.** `stat_cap_purchases` raises a
  Cap, and nothing checks that two pluses were actually surrendered for each
  point, because surrendering them is the purchase surface's job and no client
  can write the column yet. A hand-built request could therefore claim a Cap
  increase it never paid for. Recorded rather than guarded: the guard belongs
  with the purchase, and inventing one now would encode a payment rule before
  the thing that takes payment exists.
- **Flavor**, and therefore Trait swapping (pg. 106).
- **Any change to Advent behaviour**, including the 26 characters whose Traits collide on a Stat and the single stat value of 6.
- **The Perk economy** (slice 4b) and **the Merx slice's browser purchase surface** (its plan 2), which also owes the client/server reconciliation of `FREE_BASE_GEAR_COUNT` (client 3, server 4) and `ADVENT_MERX_BUDGET` (client 2, server `CREATION_GRANT.advent` 0).
