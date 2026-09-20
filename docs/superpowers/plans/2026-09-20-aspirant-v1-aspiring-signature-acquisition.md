# Aspiring Signature Acquisition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Aspiring character acquire Signatures beyond the three it chose at creation, pricing those three own-class and everything else cross-class, per ENCLAVE: Aspirant V1 pg. 90.

**Architecture:** The three picks become a stored pool on `characters.aspiring_signatures`, submitted by the wizard from the `state.classBuild.classGear` structure it already keeps, and shaped in `normalizeCharacterInput` beside `pseudo_class` so it reaches the save-time budget check. `isCrossClass` in `util/merx-economy.js` stops exempting the whole economy and tests pool membership instead; `public/js/signature-entry.js` mirrors it. Both purchase surfaces gain the rest of the catalogue at the cross tier.

**Tech Stack:** Bun, `bun:test`, Express 4, express-handlebars, htmx, Alpine, Supabase/Postgres (plpgsql RPC), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-aspirant-v1-merx-equipment-economy-design.md` — read "Plan 3: Aspiring Signature acquisition" first, then "Storage", "Derivation" and "Surfaces".

## Global Constraints

- **`util/merx-economy.js` has zero `require` statements and must keep zero.** It is pure arithmetic over values its callers hand it.
- **No economy figure — price, grant, cap, word limit — may be written down anywhere but `util/merx-economy.js`.** Browser code reads them from the served JSON island. A new literal digit beside the word "Merx" in a view or a `public/js/` file is a defect.
- **`public/js/` files are browser IIFEs.** No `require`, no `import`, no `const`/arrow-only assumptions beyond what the existing files use (they are written in ES5-ish style: `var`, `function`). Match the file you are editing.
- **`util/` is CommonJS. `scripts/` is ESM.** Do not mix.
- **NEVER run `supabase db reset`.** The local database holds a restored copy of production data. Apply migrations with `supabase migration up` only. Never read or restore anything under `backups/`.
- **Before any database-touching step**, run `eval "$(supabase status -o env)"; echo "API_URL=$API_URL"; grep -E '^SUPABASE_URL=' .env` — `API_URL` must print `http://127.0.0.1:54321` and `.env` must name the same host, or stop and report.
- **Row counts must not change:** characters 327, traits 981, class_gear 1492, class_abilities 916, classes 62. Any exploratory insert happens inside a transaction you `ROLLBACK`.
- **`bun run test:unit` is always safe** (it overrides `SUPABASE_URL` to `https://test.invalid`). `bun test <file>` directly does **not** get that override.
- **Baseline:** `bun run test:unit` is green (169 files, 0 failures). `bun run test:http` has one pre-existing failure (`routes/open-graph.test.js`) and `bun run test:integration` has three pre-existing red files. Do not attempt to fix those; do not let them mask a new failure.
- **Delete what you replace.** No `_old` copies, no commented-out blocks, no fallback paths kept "just in case".
- **Comments describe the code as it is now**, never what it used to be. Explain *why* only when the reason is non-obvious.
- **The three-state `enchantment` contract is unchanged and must stay unchanged:** key absent = keep stored; explicit `null` = remove; object = set.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260920000000_characters_aspiring_signatures.sql` | New. The column and its CHECK. |
| `supabase/migrations/20260920000001_save_character_atomic_aspiring_signatures.sql` | New. Full RPC restatement carrying the column. |
| `util/merx-economy.js` | `isCrossClass` and `equipmentSpend` take the pool. |
| `util/character-derived.js` | `deriveMerxBreakdown` / `deriveCharacterTotals` thread the pool. |
| `services/character/input.js` | Shape and validate the pool; move the "exactly three" check onto it; hand it to `validateEconomyLimits`. |
| `services/character/service.js` | Tell `normalizeCharacterInput` whether this is a creation. |
| `public/js/signature-entry.js` | Client mirror of the pricing rule. |
| `public/js/character-wizard.js` | Submit the pool; price against it; open the shop to Aspiring. |
| `util/gear-purchase-data.js` | Carry the pool and the full catalogue into the edit form's island. |
| `routes/characters.js` | Supply the catalogue and the pool to the island and the breakdown. |
| `public/js/character-gear-purchases.js` | Price the edit form against the pool. |
| `e2e/specs/29-aspiring-signature-acquisition.spec.js` | New. The end-to-end divergence case. |

---

### Task 1: The pricing rule

**Files:**
- Modify: `util/merx-economy.js:66-91`
- Test: `util/merx-economy.test.js:119-130` (replace the existing blanket test)

**Interfaces:**
- Produces: `isCrossClass(item, { economy, characterClassId, aspiringSignatures })` and `equipmentSpend(gear, { economy, characterClassId, aspiringSignatures })`. `aspiringSignatures` is an array of `{ class_id, name }`. Every later task consumes these exact names.

- [ ] **Step 1: Read the existing test you are replacing**

Open `util/merx-economy.test.js` and find this test (around line 119):

```js
// pg. 90: an aspiring character's picks "are treated as belonging to your Class..."
test('aspiring prices every Signature own-class regardless of its class_id', () => {
  const gear = [
    { name: 'A', class_id: 'class-a' },
    { name: 'B', class_id: 'class-b' },
    { name: 'C', class_id: 'class-c' }
  ];
  expect(equipmentSpend(gear, { economy: 'aspiring', characterClassId: null })).toBe(6);
});
```

It encodes the rule this task replaces. Delete it and write the four tests below in its place.

- [ ] **Step 2: Write the failing tests**

```js
// pg. 90 names three specific Signatures and makes them a Class. The pool is
// those three; everything else is out-of-class, exactly as it is to anyone
// else. `characterClassId` is null for every aspiring character, so the pool
// is the only signal these cases have.
const POOL = [
  { class_id: 'class-a', name: 'A' },
  { class_id: 'class-b', name: 'B' },
  { class_id: 'class-c', name: 'C' }
];

test('an aspiring character pays own-class for each of its three chosen Signatures', () => {
  const gear = [
    { name: 'A', class_id: 'class-a' },
    { name: 'B', class_id: 'class-b' },
    { name: 'C', class_id: 'class-c' }
  ];
  expect(equipmentSpend(gear, {
    economy: 'aspiring', characterClassId: null, aspiringSignatures: POOL
  })).toBe(6);
});

test('an aspiring character pays cross-class for a Signature outside its three', () => {
  const gear = [{ name: 'D', class_id: 'class-d' }];
  expect(equipmentSpend(gear, {
    economy: 'aspiring', characterClassId: null, aspiringSignatures: POOL
  })).toBe(3);
});

// The pool is three items, not three classes: sharing a class with a pick
// buys nothing, because the character never had that class.
test('a Signature from a chosen class but not the chosen item is still cross-class', () => {
  const gear = [{ name: 'A2', class_id: 'class-a' }];
  expect(equipmentSpend(gear, {
    economy: 'aspiring', characterClassId: null, aspiringSignatures: POOL
  })).toBe(3);
});

// A row written before characters.aspiring_signatures existed has no pool.
// It derives exactly as it did before, rather than being repriced upward.
test('an absent or empty pool prices every aspiring Signature own-class', () => {
  const gear = [
    { name: 'A', class_id: 'class-a' },
    { name: 'D', class_id: 'class-d' }
  ];
  for (const pool of [undefined, [], null]) {
    expect(equipmentSpend(gear, {
      economy: 'aspiring', characterClassId: null, aspiringSignatures: pool
    })).toBe(4);
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun run test:unit 2>&1 | grep -A5 merx-economy`
Expected: exactly two FAIL — `'pays cross-class for a Signature outside its three'` and `'a Signature from a chosen class but not the chosen item is still cross-class'`, each returning the own-class price. The own-class and empty-pool tests PASS already, because today's blanket rule happens to agree with them.

- [ ] **Step 4: Replace `isCrossClass`**

In `util/merx-economy.js`, replace the whole `isCrossClass` block (lines 66-73, comment included) with:

```js
// pg. 90: an aspiring character's three chosen Signatures "are treated as
// belonging to your Class for the purposes of acquisition and improvement".
// That sentence names three items and makes them a Class; it does not exempt
// the character from the cross-class tier, so a fourth Signature -- including
// one that shares a class with a pick -- costs the surcharge like anyone
// else's. The three arrive as `aspiringSignatures`, the pool stored on
// characters.aspiring_signatures.
//
// An empty or absent pool prices everything own-class, which is what a row
// written before that column existed derives as. The permissive direction is
// deliberate: the strict one would refuse saves for characters that did
// nothing wrong. The wizard validates the pool, so this is a guard for the
// API path and for legacy rows.
const inAspiringPool = (item, pool) => pool.some(
    (pick) => pick.class_id === item.class_id && pick.name === item.name
);

const isCrossClass = (item, { economy, characterClassId, aspiringSignatures } = {}) => {
    if (economy === 'aspiring') {
        const pool = (Array.isArray(aspiringSignatures) ? aspiringSignatures : []).filter(Boolean);
        return pool.length > 0 && !inAspiringPool(item, pool);
    }
    return !!characterClassId && !!item.class_id && item.class_id !== characterClassId;
};
```

- [ ] **Step 5: Thread the pool through `equipmentSpend`**

Change its signature and its one `isCrossClass` call (lines 77-80):

```js
const equipmentSpend = (gear, { economy, characterClassId, aspiringSignatures } = {}) => {
    const items = Array.isArray(gear) ? gear.filter(Boolean) : [];
    return items.reduce((total, item) => {
        const crossClass = isCrossClass(item, { economy, characterClassId, aspiringSignatures });
```

Leave the rest of the reducer untouched.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run test:unit`
Expected: green across all 169 files, `util/character-derived.test.js` included. Nothing downstream breaks yet: every existing caller omits `aspiringSignatures`, which reads as an empty pool and prices own-class exactly as before. That is the point of the fallback, and it is why this task can land on its own.

- [ ] **Step 7: Confirm the module is still require-free**

Run: `grep -c "require" util/merx-economy.js`
Expected: `0`

- [ ] **Step 8: Commit**

```bash
git add util/merx-economy.js util/merx-economy.test.js
git commit -m "feat: price an aspiring Signature by pool membership, not by economy"
```

---

### Task 2: The derivation threads the pool

**Files:**
- Modify: `util/character-derived.js:74-76`, `:91-109`, `:112-121`
- Modify: `routes/characters.js:1069-1076`
- Test: `util/character-derived.test.js:378-393` (replace), plus two new cases

**Interfaces:**
- Consumes: Task 1's `equipmentSpend(gear, { economy, characterClassId, aspiringSignatures })`.
- Produces: `deriveMerxBreakdown({ ..., aspiringSignatures })` and `deriveCharacterTotals({ character, ... })`, where `deriveCharacterTotals` reads the pool off `character.aspiring_signatures` itself. Callers that already pass a whole `character` need no change.

- [ ] **Step 1: Write the failing tests**

In `util/character-derived.test.js`, replace the existing test at ~line 378 (`'an aspiring character pays own-class price for picks from three classes'`) with these three:

```js
const ASPIRING_POOL = [
  { class_id: 'class-a', name: 'A' },
  { class_id: 'class-b', name: 'B' },
  { class_id: 'class-c', name: 'C' }
];

test('an aspiring character pays own-class price for its three chosen Signatures', () => {
  const parts = deriveMerxBreakdown({
    realMissions: [],
    offscreenMissions: [],
    gear: [
      { name: 'A', class_id: 'class-a' },
      { name: 'B', class_id: 'class-b' },
      { name: 'C', class_id: 'class-c' }
    ],
    commonItems: [],
    characterClassId: null,
    economy: 'aspiring',
    aspiringSignatures: ASPIRING_POOL
  });
  expect(parts.earned).toBe(10);
  expect(parts.spend).toBe(6);
  expect(parts.reward).toBe(4);
});

test('an aspiring character pays the surcharge for a fourth Signature', () => {
  const parts = deriveMerxBreakdown({
    realMissions: [],
    offscreenMissions: [],
    gear: [
      { name: 'A', class_id: 'class-a' },
      { name: 'B', class_id: 'class-b' },
      { name: 'C', class_id: 'class-c' },
      { name: 'D', class_id: 'class-d' }
    ],
    commonItems: [],
    characterClassId: null,
    economy: 'aspiring',
    aspiringSignatures: ASPIRING_POOL
  });
  expect(parts.spend).toBe(9);
  expect(parts.reward).toBe(1);
});

// deriveCharacterTotals reads the pool off the character row, so every caller
// that already hands it a whole character keeps working untouched.
test('deriveCharacterTotals reads the pool from the character row', () => {
  const totals = deriveCharacterTotals({
    character: {
      class_id: null,
      common_items: [],
      aspiring_signatures: ASPIRING_POOL,
      gear: [
        { name: 'A', class_id: 'class-a' },
        { name: 'D', class_id: 'class-d' }
      ]
    },
    realMissions: [],
    offscreenMissions: [],
    rulesVersion: 'v1',
    economy: 'aspiring'
  });
  expect(totals.commissary_reward).toBe(5);
  expect(totals.merx_deficit).toBe(0);
});
```

Make sure `deriveCharacterTotals` is in the file's `require` destructuring at the top; add it if it is not.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test:unit 2>&1 | grep -A5 character-derived`
Expected: the fourth-Signature and `deriveCharacterTotals` tests FAIL (spend 8 and reward 6 respectively, because the pool is ignored).

- [ ] **Step 3: Thread the pool through `gearSpendFor`**

Replace `util/character-derived.js:74-76`:

```js
const gearSpendFor = (economy, gearList, characterClassId, aspiringSignatures) => (economy === 'advent'
  ? adventGearSpend(gearList, characterClassId)
  : equipmentSpend(gearList, { economy, characterClassId, aspiringSignatures }));
```

- [ ] **Step 4: Thread it through `deriveMerxBreakdown`**

Change its destructured parameter list and its `gearSpendFor` call:

```js
const deriveMerxBreakdown = ({
  realMissions, offscreenMissions, gear, commonItems, characterClassId,
  economy = 'advent', aspiringSignatures
}) => {
```

and

```js
  const spend = itemSpend + gearSpendFor(economy, gearList, characterClassId, aspiringSignatures);
```

- [ ] **Step 5: Have `deriveCharacterTotals` read the pool off the character**

In its `deriveMerxBreakdown` call (around line 115), add one line after `characterClassId`:

```js
    characterClassId: character && character.class_id,
    aspiringSignatures: character && character.aspiring_signatures,
    economy
```

- [ ] **Step 6: Update the one direct `deriveMerxBreakdown` caller**

`routes/characters.js:1069` calls it directly rather than through `deriveCharacterTotals`. Add the pool beside `characterClassId`:

```js
            gear: character.gear,
            commonItems: character.common_items,
            characterClassId: character.class_id,
            aspiringSignatures: character.aspiring_signatures,
            economy
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun run test:unit`
Expected: green across all 169 files.

- [ ] **Step 8: Commit**

```bash
git add util/character-derived.js util/character-derived.test.js routes/characters.js
git commit -m "feat: derive an aspiring character's Merx against its Signature pool"
```

---

### Task 3: The client mirror

**Files:**
- Modify: `public/js/signature-entry.js:53-59`
- Test: `test/signature-entry.test.js:91-155` (extend the parity sweep)

**Interfaces:**
- Consumes: Task 1's server rule, which this file mirrors and which the parity test pins it to.
- Produces: `SignatureEntry.isCrossClass(purchase, { economy, characterClassId, aspiringSignatures })` and `SignatureEntry.totalOf(purchases, opts)` where `opts` now carries `aspiringSignatures`. Tasks 7 and 10 pass it.

- [ ] **Step 1: Write the failing test**

Add to `test/signature-entry.test.js`, inside the `describe('the component agrees with the server it cannot require')` block:

```js
// The client cannot require util/merx-economy.js, so the rule lives twice.
// This is the only thing keeping the two copies honest about the pool.
test('client and server agree on aspiring pool membership', () => {
  const pool = [
    { class_id: 'class-a', name: 'A' },
    { class_id: 'class-b', name: 'B' }
  ];
  const gear = [
    { name: 'A', class_id: 'class-a', owned: true, enchantment: null, mods: [] },
    { name: 'Z', class_id: 'class-z', owned: true, enchantment: null, mods: [] }
  ];
  const opts = { economy: 'aspiring', characterClassId: null, aspiringSignatures: pool };

  expect(SE.totalOf(gear, { figures: FIGURES, ...opts }))
    .toBe(equipmentSpend(gear, opts));
  expect(SE.isCrossClass(gear[0], opts)).toBe(false);
  expect(SE.isCrossClass(gear[1], opts)).toBe(true);
});

test('client and server agree that an empty aspiring pool is all own-class', () => {
  const gear = [{ name: 'Z', class_id: 'class-z', owned: true, enchantment: null, mods: [] }];
  const opts = { economy: 'aspiring', characterClassId: null, aspiringSignatures: [] };
  expect(SE.totalOf(gear, { figures: FIGURES, ...opts }))
    .toBe(equipmentSpend(gear, opts));
  expect(SE.isCrossClass(gear[0], opts)).toBe(false);
});
```

Check the file's existing local names for the component and the figures (`SE`, `FIGURES`) and use whatever it already calls them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:unit 2>&1 | grep -A5 signature-entry`
Expected: FAIL — the client returns `false` for `class-z` while the server returns `true`.

- [ ] **Step 3: Mirror the rule**

Replace `public/js/signature-entry.js:53-59` with:

```js
  // pg. 90: an aspiring character's three chosen Signatures are its Class, so
  // those three price own-class and everything else pays the surcharge. Same
  // rule as util/merx-economy.js isCrossClass, pinned to it by
  // test/signature-entry.test.js. An empty or absent pool prices everything
  // own-class, matching a row written before the pool was stored.
  var inAspiringPool = function (purchase, pool) {
    for (var i = 0; i < pool.length; i++) {
      if (pool[i] && pool[i].class_id === purchase.class_id && pool[i].name === purchase.name) return true;
    }
    return false;
  };

  var isCrossClass = function (purchase, opts) {
    if (opts.economy === 'aspiring') {
      var pool = Array.isArray(opts.aspiringSignatures) ? opts.aspiringSignatures : [];
      return pool.length > 0 && !inAspiringPool(purchase, pool);
    }
    return !!opts.characterClassId && !!purchase.class_id
      && purchase.class_id !== opts.characterClassId;
  };
```

`totalOf` already forwards `opts` wholesale to `isCrossClass`, so it needs no change — verify that at `public/js/signature-entry.js:99-104` rather than assuming it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:unit`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add public/js/signature-entry.js test/signature-entry.test.js
git commit -m "feat: mirror the aspiring pool rule in the Signature component"
```

---

### Task 4: Storage

**Files:**
- Create: `supabase/migrations/20260920000000_characters_aspiring_signatures.sql`
- Create: `supabase/migrations/20260920000001_save_character_atomic_aspiring_signatures.sql`
- Test: `models/character-atomic.integration.test.js` (new cases)

**Interfaces:**
- Produces: `characters.aspiring_signatures jsonb NOT NULL DEFAULT '[]'`, and a `save_character_atomic` that writes it on insert and preserves it on an update that omits it.

- [ ] **Step 1: Verify you are pointed at the local database**

Run:
```bash
eval "$(supabase status -o env)"; echo "API_URL=$API_URL"; grep -E '^SUPABASE_URL=' .env
```
Expected: `API_URL=http://127.0.0.1:54321` and `SUPABASE_URL="http://127.0.0.1:54321"`. **If either names anything else, STOP and report — that is the production project.**

- [ ] **Step 2: Record the row counts you must not change**

Run:
```bash
eval "$(supabase status -o env)"; psql "$DB_URL" -t -c \
  "select 'characters', count(*) from characters union all select 'traits', count(*) from traits union all select 'class_gear', count(*) from class_gear union all select 'class_abilities', count(*) from class_abilities union all select 'classes', count(*) from classes;"
```
Expected: 327 / 981 / 1492 / 916 / 62. Keep the output; Step 9 compares against it.

- [ ] **Step 3: Write the column migration**

Create `supabase/migrations/20260920000000_characters_aspiring_signatures.sql`:

```sql
-- The three Signature Items an Aspiring character's invented Class is made of
-- (ENCLAVE: Aspirant V1, pg. 90: they "are treated as belonging to your Class
-- for the purposes of acquisition and improvement").
--
-- A pool on the character rather than a flag on class_gear. Reconciliation is
-- name-keyed, so a rename is a delete plus an insert and a per-row flag would
-- die with the row. More importantly the two facts differ: this is what the
-- character may buy at the own-class rate, not what it currently owns. Selling
-- a pick and buying it back must not reprice it from 2 Merx to 3.
--
-- Empty for every other character. The creator_mode clause is what stops this
-- becoming a second, contradictory answer to "is this Signature own-class?"
-- for a character that already has a class_id.
ALTER TABLE public.characters
  ADD COLUMN aspiring_signatures jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.characters
  ADD CONSTRAINT characters_aspiring_signatures_check
  CHECK (
    jsonb_typeof(aspiring_signatures) = 'array'
    AND jsonb_array_length(aspiring_signatures) <= 3
    AND (creator_mode = 'aspiring' OR jsonb_array_length(aspiring_signatures) = 0)
    AND NOT jsonb_path_exists(
      aspiring_signatures,
      '$[*] ? (!(@.class_id like_regex "\\S" && @.name like_regex "\\S"))'
    )
  );
```

- [ ] **Step 4: Apply it**

Run: `supabase migration up`
Expected: it reports applying `20260920000000`. **Never `supabase db reset`.**

- [ ] **Step 5: Prove the constraint does what the comment claims**

The `jsonb_path_exists` predicate is the part most likely to be subtly wrong — a missing key and an empty string must both be rejected. Run this and read every line:

```bash
eval "$(supabase status -o env)"; psql "$DB_URL" -c "
BEGIN;
SELECT
  '[]'::jsonb                                                        AS v, 'empty: expect t'  AS case,
  jsonb_typeof('[]'::jsonb) = 'array'
  AND NOT jsonb_path_exists('[]'::jsonb, '\$[*] ? (!(@.class_id like_regex \"\\\\S\" && @.name like_regex \"\\\\S\"))') AS ok
UNION ALL SELECT '[{\"class_id\":\"c\",\"name\":\"n\"}]'::jsonb, 'good: expect t',
  NOT jsonb_path_exists('[{\"class_id\":\"c\",\"name\":\"n\"}]'::jsonb, '\$[*] ? (!(@.class_id like_regex \"\\\\S\" && @.name like_regex \"\\\\S\"))')
UNION ALL SELECT '[{\"name\":\"n\"}]'::jsonb, 'missing class_id: expect f',
  NOT jsonb_path_exists('[{\"name\":\"n\"}]'::jsonb, '\$[*] ? (!(@.class_id like_regex \"\\\\S\" && @.name like_regex \"\\\\S\"))')
UNION ALL SELECT '[{\"class_id\":\"c\",\"name\":\"  \"}]'::jsonb, 'blank name: expect f',
  NOT jsonb_path_exists('[{\"class_id\":\"c\",\"name\":\"  \"}]'::jsonb, '\$[*] ? (!(@.class_id like_regex \"\\\\S\" && @.name like_regex \"\\\\S\"))')
UNION ALL SELECT '[{\"class_id\":123,\"name\":\"n\"}]'::jsonb, 'non-string class_id: expect f',
  NOT jsonb_path_exists('[{\"class_id\":123,\"name\":\"n\"}]'::jsonb, '\$[*] ? (!(@.class_id like_regex \"\\\\S\" && @.name like_regex \"\\\\S\"))');
ROLLBACK;"
```
Expected: `t`, `t`, `f`, `f`, `f` in that order.

**If any row disagrees, the predicate is wrong — fix it and re-run before continuing.** Report which form you settled on; a helper `IMMUTABLE` function is an acceptable alternative if jsonpath cannot express it cleanly, but a subquery is not (CHECK constraints cannot contain one).

- [ ] **Step 6: Write the RPC migration**

Copy `supabase/migrations/20260919000002_save_character_atomic_trait_stat.sql` in full to `supabase/migrations/20260920000001_save_character_atomic_aspiring_signatures.sql`, replace its header comment with one describing this change, and make exactly three edits to the function body:

1. In the INSERT column list, after `pseudo_class_tagline, pseudo_class_description`, add `, aspiring_signatures`.
2. In the INSERT `SELECT` list, after `record.pseudo_class_tagline, record.pseudo_class_description`, add `, COALESCE(record.aspiring_signatures, '[]'::jsonb)`.
3. In the `UPDATE ... SET` list, after `pseudo_class_description = record.pseudo_class_description`, add `,\n      aspiring_signatures = record.aspiring_signatures`.

Change nothing else. This project restates the whole function on every change rather than partially altering it; the file you copied says so in its own header.

The UPDATE needs no `COALESCE`: its source is `jsonb_populate_record(saved, p_character)`, whose base is the stored row, so a key absent from `p_character` already keeps the stored value. That is the same mechanism that preserves `pseudo_class_tagline` across an edit today.

- [ ] **Step 7: Apply it**

Run: `supabase migration up`
Expected: it reports applying `20260920000001`.

- [ ] **Step 8: Write the integration tests**

Add to `models/character-atomic.integration.test.js`, following the file's existing pattern for creating and updating a character:

```js
// The pool is written on create and survives an update that never mentions
// it -- the shape every edit-form save has, since that form does not submit
// the field. jsonb_populate_record(saved, p_character) is what makes an
// absent key mean "keep stored".
test('save_character_atomic writes the aspiring pool and preserves it on update', async () => {
  const pool = [
    { class_id: CLASS_A_ID, name: 'A' },
    { class_id: CLASS_B_ID, name: 'B' },
    { class_id: CLASS_C_ID, name: 'C' }
  ];
  const created = await saveAtomic({
    characterId: null,
    character: { ...baseCharacter(), creator_mode: 'aspiring', class_id: null, aspiring_signatures: pool },
    gear: [], abilities: [], traits: [], perks: []
  });
  expect(created.aspiring_signatures).toEqual(pool);

  const updated = await saveAtomic({
    characterId: created.id,
    character: { ...baseCharacter(), creator_mode: 'aspiring', class_id: null },
    gear: [], abilities: [], traits: [], perks: []
  });
  expect(updated.aspiring_signatures).toEqual(pool);
});

test('a non-aspiring character cannot carry a pool', async () => {
  await expect(saveAtomic({
    characterId: null,
    character: {
      ...baseCharacter(),
      creator_mode: 'advent',
      aspiring_signatures: [{ class_id: CLASS_A_ID, name: 'A' }]
    },
    gear: [], abilities: [], traits: [], perks: []
  })).rejects.toThrow();
});
```

Match the file's existing helper names (`saveAtomic`, `baseCharacter`, the class-id constants) rather than introducing new ones; read the top of the file first and adapt. Every character this test creates must be cleaned up in the file's existing teardown.

- [ ] **Step 9: Run the integration suite and re-check the row counts**

Run: `bun run test:integration 2>&1 | tail -30`
Expected: `models/character-atomic.integration.test.js` green. Three other files are red at baseline; confirm they are the same three and no more.

Then re-run Step 2's count query. Expected: 327 / 981 / 1492 / 916 / 62, unchanged.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20260920000000_characters_aspiring_signatures.sql \
        supabase/migrations/20260920000001_save_character_atomic_aspiring_signatures.sql \
        models/character-atomic.integration.test.js
git commit -m "feat: store an aspiring character's three Signature picks"
```

---

### Task 5: Input shaping and validation

**Files:**
- Modify: `services/character/input.js:412-432` area (add the shaper), `:507-522`, `:663-677`, `:575-582`
- Modify: `services/character/service.js:196-198`, `:356-365`
- Test: `services/character/input.test.js`

**Interfaces:**
- Consumes: Task 1's `equipmentSpend` signature.
- Produces: `data.aspiring_signatures` as `[{ class_id, name }]` on a creation, **absent** on an update. `normalizeCharacterInput` gains `context.isCreation`. `validateAspiringBuild` validates the pool rather than the gear count.

- [ ] **Step 1: Write the failing tests**

Add to `services/character/input.test.js`:

```js
// The pool is the Class an Aspiring character invents, so its three-ness
// binds the pool, not the gear array -- which now also holds anything the
// character bought with the rest of its grant.
test('an aspiring build needs exactly three Signature picks', () => {
  const { error } = normalizeWizardPayload(aspiringBody({
    aspiring_signatures: [{ class_id: 'a', name: 'A' }, { class_id: 'b', name: 'B' }]
  }));
  expect(error).toMatch(/three Signature picks/);
});

test('an aspiring build needs its three picks from three different classes', () => {
  const { error } = normalizeWizardPayload(aspiringBody({
    aspiring_signatures: [
      { class_id: 'a', name: 'A' },
      { class_id: 'a', name: 'A2' },
      { class_id: 'b', name: 'B' }
    ]
  }));
  expect(error).toMatch(/three different classes/);
});

// The fourth Signature the pool makes affordable must not be refused by a
// count check that used to live on the gear array.
test('an aspiring build may own a fourth Signature', () => {
  const { data, error } = normalizeWizardPayload(aspiringBody({
    gear: [
      { name: 'A', class_id: 'a' },
      { name: 'B', class_id: 'b' },
      { name: 'C', class_id: 'c' },
      { name: 'D', class_id: 'd' }
    ]
  }));
  expect(error).toBeNull();
  expect(data.gear).toHaveLength(4);
});

// 3 own-class picks (6) plus one cross-class fourth (3) is 9 of 10.
test('a creation is priced against the pool', () => {
  const { error } = normalizeCharacterInput(aspiringInput({
    gear: [
      { name: 'A', class_id: 'a' },
      { name: 'B', class_id: 'b' },
      { name: 'C', class_id: 'c' },
      { name: 'D', class_id: 'd' }
    ]
  }), { ...aspiringContext(), isCreation: true });
  expect(error).toBeNull();
});

// Two cross-class extras is 6 + 3 + 3 = 12, over the 10-Merx grant.
test('a creation over budget against the pool is refused', () => {
  const { error } = normalizeCharacterInput(aspiringInput({
    gear: [
      { name: 'A', class_id: 'a' },
      { name: 'B', class_id: 'b' },
      { name: 'C', class_id: 'c' },
      { name: 'D', class_id: 'd' },
      { name: 'E', class_id: 'e' }
    ]
  }), { ...aspiringContext(), isCreation: true });
  expect(error).toMatch(/spends 12 Merx of 10/);
});

// An update must not carry the key at all: a present key is authoritative to
// save_character_atomic, so sending [] would wipe the character's Class.
test('an update never carries the pool', () => {
  const { data } = normalizeCharacterInput(aspiringInput({}), { ...aspiringContext(), isCreation: false });
  expect('aspiring_signatures' in data).toBe(false);
});

// The column is the own-class answer for a class-less character; a crafted
// payload must not hand a classed one a second answer.
test('a non-aspiring creation never carries the pool', () => {
  const { data } = normalizeCharacterInput(
    { ...adventInput(), aspiring_signatures: [{ class_id: 'a', name: 'A' }] },
    { ...adventContext(), isCreation: true }
  );
  expect('aspiring_signatures' in data).toBe(false);
});
```

Build `aspiringBody`, `aspiringInput`, `aspiringContext`, `adventInput` and `adventContext` from the helpers the file already uses for its existing aspiring tests around `input.test.js:917-934` — read them first and reuse rather than inventing new fixtures. A valid `aspiringBody` carries a three-entry `aspiring_signatures` matching its first three gear rows.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test:unit 2>&1 | grep -A5 "services/character/input"`
Expected: all seven FAIL.

- [ ] **Step 3: Add the shaper**

In `services/character/input.js`, beside `normalizeClassItems` (around line 412), add:

```js
// The three Signatures an Aspiring character's Class is made of (pg. 90),
// shaped from the wizard's step-1 builder. Anything malformed is dropped
// rather than rejected here; validateAspiringBuild is what refuses a build
// that does not end up with three.
const normalizeAspiringSignatures = (value) => (Array.isArray(value) ? value : [])
  .map((pick) => (pick && typeof pick === 'object'
    ? { class_id: blankToNull(pick.class_id), name: blankToNull(pick.name) }
    : null))
  .filter((pick) => pick && pick.class_id && pick.name)
  .slice(0, 3);
```

- [ ] **Step 4: Shape it in `normalizeCharacterInput`**

Directly after the `pseudo_class` block (`input.js:515-522`, ending with `delete data.pseudo_class;`), add:

```js
// The pool is written once, by the creation that invents the Class. On an
// update the key must be ABSENT, not empty: save_character_atomic treats a
// present key as authoritative, so sending [] would delete the character's
// Class. Absence is also what makes the Class un-editable, without needing a
// server-side override to enforce it.
if (context.isCreation && data.creator_mode === 'aspiring') {
  data.aspiring_signatures = normalizeAspiringSignatures(data.aspiring_signatures);
} else {
  delete data.aspiring_signatures;
}
```

- [ ] **Step 5: Hand the pool to the budget check**

At the `validateEconomyLimits` call (`input.js:576-582`), add one line after `characterClassId`:

```js
    characterClassId: data.class_id ?? null,
    aspiringSignatures: data.aspiring_signatures,
```

- [ ] **Step 6: Thread the pool through `validateEconomyLimits`**

Change its destructured parameters and its `equipmentSpend` call:

```js
const validateEconomyLimits = ({
  economy, gear, storedGear, commonItems, characterClassId, aspiringSignatures,
  enforceMerxBudget = true
}) => {
```

```js
    const spend = equipmentSpend(items, { economy, characterClassId, aspiringSignatures })
      + itemCount * COMMON_ITEM_PRICE;
```

- [ ] **Step 7: Move the "exactly three" check onto the pool**

In `validateAspiringBuild` (`input.js:663-677`), replace the gear-count check:

```js
  const gear = Array.isArray(body.gear) ? body.gear : [];
  if (gear.length !== 3) return 'An Aspiring character needs exactly three gear picks.';
```

with:

```js
  // The three-ness is a property of the Class being invented, not of what the
  // character walked out with -- the grant's remainder may buy a fourth
  // Signature, which the budget check governs instead.
  const picks = normalizeAspiringSignatures(body.aspiring_signatures);
  if (picks.length !== 3) return 'An Aspiring character needs exactly three Signature picks.';
  if (new Set(picks.map((pick) => pick.class_id)).size !== 3) {
    return "An Aspiring character's three Signatures must come from three different classes.";
  }
```

This mirrors the client's `validateBuilder` (`public/js/character-wizard.js:1818-1839`), which already requires three filled slots from distinct classes.

- [ ] **Step 8: Set `isCreation` at both service call sites**

In `services/character/service.js`, the `createCharacter` call to `normalizeCharacterInput` (around `:196-198`) passes `isCreation: true`; the `updateCharacter` call (around `:356-365`) passes `isCreation: false`. Add the key explicitly at both — do not let either rely on a default.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `bun run test:unit`
Expected: green across all files.

- [ ] **Step 10: Commit**

```bash
git add services/character/input.js services/character/service.js services/character/input.test.js
git commit -m "feat: validate and price an aspiring creation against its Signature pool"
```

---

### Task 6: The wizard submits the pool

**Files:**
- Modify: `public/js/character-wizard.js:3752-3765` (`serializePayload`)
- Test: `test/character-wizard-client.test.js`

**Interfaces:**
- Consumes: Task 5's expectation that the payload carries `aspiring_signatures` as `[{ class_id, name }]`.
- Produces: the submitted field. Task 7 reads the same `state.classBuild.classGear` for pricing.

- [ ] **Step 1: Write the failing test**

Add to `test/character-wizard-client.test.js`:

```js
// The pool the server stores is the step-1 builder, not the gear array --
// the two stop being the same set as soon as the grant's remainder buys a
// fourth Signature.
test('an aspiring submit carries its three picks as the Signature pool', () => {
  const wizard = bootWizard(fixture({ mode: 'aspiring', classes: [v1Class()] }));
  seedAspiringPicks(wizard, ['Cowboy Hat', 'Sharps Rifle', 'Bandolier']);
  const payload = wizard.serializePayload();
  expect(payload.aspiring_signatures).toEqual([
    { class_id: 'c-v1', name: 'Cowboy Hat' },
    { class_id: 'c-v1', name: 'Sharps Rifle' },
    { class_id: 'c-v1', name: 'Bandolier' }
  ]);
});

test('a non-aspiring submit carries no Signature pool', () => {
  const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
  wizard.getState().classId = 'c-v1';
  expect(wizard.serializePayload().aspiring_signatures).toBeUndefined();
});
```

`seedAspiringPicks` is a local helper at `test/character-wizard-client.test.js:557-563` that writes `state.classBuild.classGear`; `v1Class()` and `fixture()` come from `test/helpers/wizard-fixture.js`. Check whether `serializePayload` is already exposed on `window.CharacterWizard`; if it is not, expose it in the same export block the other test-visible functions use rather than reaching into internals.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test:unit 2>&1 | grep -A5 character-wizard-client`
Expected: FAIL — `aspiring_signatures` is undefined on the aspiring payload.

- [ ] **Step 3: Submit the pool**

In `serializePayload`, directly after the `pseudo_class` key, add:

```js
      // The three Signatures this invented Class is made of (pg. 90). Sent
      // from the step-1 builder rather than derived from state.gear: the
      // grant's remainder may buy a fourth Signature, and the server prices
      // that one at the cross-class tier precisely because it is not here.
      aspiring_signatures: DATA.mode === 'aspiring' ? aspiringPool() : undefined,
```

and add the helper beside the other state readers:

```js
  // The step-1 builder's three filled slots, in the shape the server stores.
  const aspiringPool = () => ((state.classBuild && state.classBuild.classGear) || [])
    .filter((slot) => slot && slot.classId && slot.itemName)
    .map((slot) => ({ class_id: slot.classId, name: slot.itemName }));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:unit`
Expected: green. If `JSON.stringify` drops the `undefined` value for non-aspiring modes, that is the intended result — the second test asserts exactly that.

- [ ] **Step 5: Commit**

```bash
git add public/js/character-wizard.js test/character-wizard-client.test.js
git commit -m "feat: submit an aspiring character's Signature pool from the builder"
```

---

### Task 7: The wizard prices against the pool

**Files:**
- Modify: `public/js/character-wizard.js:2518-2523` (`signaturePriceFor`), `:2631-2633` (`crossClassFor`), `:2656-2660` (`getMerxSpent`)
- Test: `test/character-wizard-client.test.js:633-638` (keep, extend)

**Interfaces:**
- Consumes: Task 3's `SignatureEntry.isCrossClass(purchase, { economy, characterClassId, aspiringSignatures })` and Task 6's `aspiringPool()`.

- [ ] **Step 1: Write the failing test**

Add beside the existing `'an aspiring pick is own-class priced despite its origin (pg. 90)'` test:

```js
// The divergence the pool exists to express: a Signature the builder never
// chose costs the surcharge, even from a class one of the picks came from.
test('an aspiring Signature outside the three is cross-class priced', () => {
  const wizard = bootWizard(fixture({ mode: 'aspiring', classes: [v1Class()] }));
  seedAspiringPicks(wizard, ['Cowboy Hat', 'Sharps Rifle', 'Bandolier']);
  wizard.buySignature('Cowboy Hat', 'c-v1');
  const afterPick = wizard.getMerxSpent();
  expect(afterPick).toBe(FIGURES.prices.signature.own);

  wizard.pickShopItem('class:c-v1:Lasso');
  expect(wizard.getMerxSpent() - afterPick).toBe(FIGURES.prices.signature.cross);
});
```

`'Lasso'` must be a name in `twelveItems()` that is NOT among the three seeded picks — read `test/helpers/wizard-fixture.js`'s `TWELVE_SIGNATURE_NAMES` and choose a real one. This test also needs Task 8's shop to exist; if `pickShopItem` finds no such key yet, write the test now, watch it fail, and let Task 8 turn it green — note that in your report rather than weakening the assertion.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:unit 2>&1 | grep -A5 character-wizard-client`
Expected: FAIL.

- [ ] **Step 3: Pass the pool everywhere the client prices**

`signaturePriceFor` prices by class id alone, which cannot express "this item"; it must take the item's name too. Replace `public/js/character-wizard.js:2518-2523`:

```js
  const signaturePriceFor = (classId, name) => ECONOMY.prices.signature[
    SignatureEntry.isCrossClass({ class_id: classId, name: name }, {
      economy: economyForState(),
      characterClassId: state.classId,
      aspiringSignatures: aspiringPool()
    }) ? 'cross' : 'own'
  ];
```

It has three callers; fix all three:

```js
// :2581, inside getShopPool's pushClassItem
        cost: signaturePriceFor(cls.id, g.name),
```
```js
// :2937, the grid cell's price tag
      : '<span class="tag is-warning is-light ml-2">' + signaturePriceFor(cell.classId, cell.entry.name) + ' Merx</span>';
```
```js
// :2956
    const price = signaturePriceFor(cell.classId, cell.entry.name);
```

`crossClassFor` has the same problem. Replace `:2631-2633`:

```js
  const crossClassFor = (classId, name) => SignatureEntry.isCrossClass({ class_id: classId, name: name }, {
    economy: economyForState(),
    characterClassId: state.classId,
    aspiringSignatures: aspiringPool()
  });
```

and its three callers:

```js
// :2636, priceOfPurchase
    figures: ECONOMY, crossClass: crossClassFor(purchase.class_id, purchase.name)
```
```js
// :2643, describePurchaseFor
    figures: ECONOMY, crossClass: crossClassFor(purchase.class_id, purchase.name)
```
```js
// :2978, the drawer render
      crossClass: crossClassFor(cell.classId, cell.entry.name),
```

Finally `getMerxSpent` (`:2656-2660`) gains one option:

```js
  const getMerxSpent = () => SignatureEntry.totalOf(pricedGear(), {
    figures: ECONOMY,
    economy: economyForState(),
    characterClassId: state.classId,
    aspiringSignatures: aspiringPool()
  }) + (Array.isArray(state.commonItems) ? state.commonItems.length : 0) * ECONOMY.prices.commonItem;
```

After this, `grep -n "signaturePriceFor(\|crossClassFor(" public/js/character-wizard.js` must show no call still passing a single argument.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:unit`
Expected: the own-class test stays green; the cross-class test passes once Task 8 lands. If Task 8 has not landed, the first two assertions must pass and only the `pickShopItem` line may fail.

- [ ] **Step 5: Commit**

```bash
git add public/js/character-wizard.js test/character-wizard-client.test.js
git commit -m "feat: price the aspiring wizard against its Signature pool"
```

---

### Task 8: The wizard shop opens to Aspiring

**Files:**
- Modify: `public/js/character-wizard.js:2563-2601` (`getShopPool`)
- Test: `test/character-wizard-client.test.js`

**Interfaces:**
- Consumes: Task 7's `signaturePriceFor(classId, name)`.

- [ ] **Step 1: Write the failing tests**

```js
// Aspiring reaches the rest of the catalogue exactly as aspirant does; its
// own three live in the grid, so the shop excludes them rather than listing
// them twice at the wrong price.
test('the aspiring shop offers every class Signature outside the three', () => {
  const wizard = bootWizard(fixture({ mode: 'aspiring', classes: [v1Class()] }));
  seedAspiringPicks(wizard, ['Cowboy Hat', 'Sharps Rifle', 'Bandolier']);
  const keys = wizard.getShopPool().filter((p) => p.kind === 'class').map((p) => p.key);
  expect(keys).toContain('class:c-v1:Lasso');
  expect(keys).not.toContain('class:c-v1:Cowboy Hat');
});

test('every class Signature in the aspiring shop is cross-class priced', () => {
  const wizard = bootWizard(fixture({ mode: 'aspiring', classes: [v1Class()] }));
  seedAspiringPicks(wizard, ['Cowboy Hat', 'Sharps Rifle', 'Bandolier']);
  const classItems = wizard.getShopPool().filter((p) => p.kind === 'class');
  expect(classItems.length).toBeGreaterThan(0);
  for (const item of classItems) expect(item.cost).toBe(FIGURES.prices.signature.cross);
});

// Pre-existing gap this task closes: getShopPool branched on DATA.mode while
// usesSignatureGrid branched on the resolved economy, so ?mode=advent on an
// aspirant-content class produced a shop with no class items in it.
test('the shop follows the resolved economy, not the URL mode', () => {
  const wizard = bootWizard(fixture({ mode: 'advent', classes: [v1Class()] }));
  wizard.getState().classId = 'c-v1';
  const classItems = wizard.getShopPool().filter((p) => p.kind === 'class');
  expect(classItems.length).toBeGreaterThan(0);
});
```

Use the same real `twelveItems()` names as Task 7. Expose `getShopPool` on the test surface if it is not already.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test:unit 2>&1 | grep -A5 character-wizard-client`
Expected: all three FAIL — the aspiring shop has no class items and the advent-mode-on-V1-class shop has none either.

- [ ] **Step 3: Rewrite the branch**

Replace the `if (DATA.mode === 'aspirant') { ... } else if (!usesSignatureGrid()) { ... }` block (`:2588-2600`) with:

```js
    // The grid sells whatever counts as the character's own Class; the shop
    // sells everything else. For aspirant that is every class but the
    // selected one; for aspiring, whose Class is three named items, it is
    // every Signature outside the pool. Branching on the resolved economy
    // rather than DATA.mode is what keeps this agreeing with
    // usesSignatureGrid -- they disagreed before, and ?mode=advent on an
    // aspirant-content class produced a shop with no class items at all.
    if (usesSignatureGrid()) {
      const pool = aspiringPool();
      const inPool = (cls, g) => pool.some((pick) => pick.class_id === cls.id && pick.name === g.name);
      if (Array.isArray(DATA.classes)) {
        DATA.classes.forEach((cls) => {
          if (!cls || !cls.id || !Array.isArray(cls.class_gear)) return;
          if (economyForState() !== 'aspiring' && cls.id === state.classId) return;
          cls.class_gear.forEach((g) => {
            if (!g || !g.name) return;
            if (economyForState() === 'aspiring' && inPool(cls, g)) return;
            pushClassItem(cls, g);
          });
        });
      }
    } else {
      const c = selectedClass();
      if (c && Array.isArray(c.class_gear)) {
        c.class_gear.forEach((g) => { if (g && g.name) pushClassItem(c, g); });
      }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:unit`
Expected: green, including Task 7's `pickShopItem` assertion.

- [ ] **Step 5: Check the budget gate still holds**

`pickShopItem` (`:2841-2847`) refuses a purchase that would exceed the budget, and `addSignature` refuses one that would breach the Signature Cap. Confirm both still fire for an aspiring character by reading them — a cross-class item now costs 3, so the existing arithmetic must be reading the shop item's own `cost`, not a hardcoded figure.

- [ ] **Step 6: Commit**

```bash
git add public/js/character-wizard.js test/character-wizard-client.test.js
git commit -m "feat: open the wizard shop to aspiring and branch it on economy"
```

---

### Task 9: The edit form's island carries the pool and the catalogue

**Files:**
- Modify: `util/gear-purchase-data.js:40-63`, `:79-93`
- Modify: `routes/characters.js:409-419`, `:528-534`
- Test: `util/gear-purchase-data.test.js`

**Interfaces:**
- Produces: `buildGearPurchaseData({ economy, characterClass, allClasses, character, missionMerx })`, whose result gains `aspiringSignatures`. Task 10 reads `data.aspiringSignatures`.

- [ ] **Step 1: Write the failing tests**

```js
// A class-less character has no roster, so before this its grid held only
// what it already owned and there was nothing to acquire.
test('an aspiring island offers every class Signature outside the pool', () => {
  const data = buildGearPurchaseData({
    economy: 'aspiring',
    characterClass: null,
    allClasses: [v1ClassRow()],
    character: {
      class_id: null,
      aspiring_signatures: [{ class_id: 'c-v1', name: 'Cowboy Hat' }],
      gear: [{ name: 'Cowboy Hat', class_id: 'c-v1' }]
    },
    missionMerx: 0
  });
  const names = data.entries.map((e) => e.name);
  expect(names).toContain('Cowboy Hat');
  expect(names).toContain('Lasso');
  expect(data.entries.filter((e) => e.name === 'Cowboy Hat')).toHaveLength(1);
});

test('the island carries the stored pool', () => {
  const pool = [{ class_id: 'c-v1', name: 'Cowboy Hat' }];
  const data = buildGearPurchaseData({
    economy: 'aspiring',
    characterClass: null,
    allClasses: [v1ClassRow()],
    character: { class_id: null, aspiring_signatures: pool, gear: [] },
    missionMerx: 0
  });
  expect(data.aspiringSignatures).toEqual(pool);
});

// An aspirant character's own class comes from characterClass; the rest of
// the catalogue must not be duplicated into its grid.
test('an aspirant island is unchanged by the catalogue argument', () => {
  const data = buildGearPurchaseData({
    economy: 'aspirant',
    characterClass: v1ClassRow(),
    allClasses: [v1ClassRow(), otherClassRow()],
    character: { class_id: 'c-v1', gear: [] },
    missionMerx: 0
  });
  expect(data.entries.every((e) => e.class_id === 'c-v1')).toBe(true);
});
```

Build `v1ClassRow()` / `otherClassRow()` from the shapes the file's existing tests already use.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test:unit 2>&1 | grep -A5 gear-purchase-data`
Expected: FAIL on all three.

- [ ] **Step 3: Give `buildEntries` the catalogue**

Change its signature to `buildEntries(characterClass, allClasses, gear, economy)` and add the aspiring source. The existing roster-plus-carried logic stays; the catalogue is a third source that only the aspiring economy draws on, deduplicated by the same `seen` set so an owned Signature is not listed twice:

```js
const buildEntries = (characterClass, allClasses, gear, economy) => {
  const roster = Array.isArray(characterClass && characterClass.gear)
    ? characterClass.gear.map((item) => toEntry(item, characterClass.id, characterClass.name))
    : [];
  const seen = new Set(roster.map((entry) => entryKey(entry.class_id, entry.name)));
  const catalogue = [];
  // An aspiring character is class-less, so it has no roster of its own to
  // list. Its Class is three named Signatures (pg. 90) and the rest of the
  // catalogue is what it may acquire at the cross-class tier -- the same
  // reach an aspirant character gets through the wizard's shop.
  if (economy === 'aspiring') {
    for (const cls of (Array.isArray(allClasses) ? allClasses : [])) {
      if (!cls || !cls.id || !Array.isArray(cls.gear)) continue;
      for (const item of cls.gear) {
        if (!item || !item.name) continue;
        const key = entryKey(cls.id, item.name);
        if (seen.has(key)) continue;
        seen.add(key);
        catalogue.push(toEntry(item, cls.id, cls.name));
      }
    }
  }
  const carried = [];
  for (const row of gear) {
    if (!row || !row.name) continue;
    const key = entryKey(row.class_id, row.name);
    if (seen.has(key)) continue;
    seen.add(key);
    carried.push(toEntry(row, row.class_id, row.class_name));
  }
  return [...roster, ...catalogue, ...carried];
};
```

- [ ] **Step 4: Carry the pool on the island**

In `buildGearPurchaseData`, add `allClasses` to the destructured argument, pass it through, and add the pool to the returned object:

```js
const buildGearPurchaseData = ({ economy, characterClass, allClasses, character, missionMerx }) => {
  if (economy !== 'aspirant' && economy !== 'aspiring') return null;
  const gear = Array.isArray(character && character.gear) ? character.gear : [];
  return {
    economy,
    figures: economyFigures(),
    characterClassId: (character && character.class_id) || null,
    // The three Signatures this character's Class is made of (pg. 90). The
    // browser prices against the same pool the server will, or the surface
    // would offer a purchase the save then refuses.
    aspiringSignatures: (character && character.aspiring_signatures) || [],
    earnedMerx: Math.max(0, Number(missionMerx) || 0),
    entries: buildEntries(characterClass, allClasses, gear, economy),
    purchases: buildPurchases(gear)
  };
};
```

- [ ] **Step 5: Supply the catalogue from the route**

In `routes/characters.js`'s `GET /:id/edit`, the block at `:409-419` loads `characterClass` from `character.class_id`. An aspiring character has none, so add a catalogue fetch for that case only — do not fetch every class for every edit. Reuse the helper the wizard route already uses to build its `wizardClasses` list — find it by reading the `GET /wizard` handler, and keep whatever unlock filtering it applies, so the edit form cannot offer a class the player has not unlocked. Pass the result at the `buildGearPurchaseData` call (`:528-534`):

```js
        gearPurchaseData: buildGearPurchaseData({
          economy,
          characterClass,
          allClasses,
          character,
```

`allClasses` must be `[]` (not undefined) for any non-aspiring character, so the aspirant branch is provably untouched.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run test:unit && bun run test:http 2>&1 | tail -20`
Expected: unit green; http shows only the pre-existing `routes/open-graph.test.js` failure.

- [ ] **Step 7: Commit**

```bash
git add util/gear-purchase-data.js util/gear-purchase-data.test.js routes/characters.js
git commit -m "feat: offer the catalogue and carry the pool on the aspiring edit form"
```

---

### Task 10: The edit form prices against the pool

**Files:**
- Modify: `public/js/character-gear-purchases.js:50`, `:96-100`
- Test: `test/character-gear-purchases.test.js`

**Interfaces:**
- Consumes: Task 9's `data.aspiringSignatures` and Task 3's `SignatureEntry.isCrossClass`.

- [ ] **Step 1: Write the failing tests**

This surface is where the rule actually bites — a player spending mission Merx after creation — and it has no aspiring pricing test today in either direction.

```js
// pg. 90's three are own-class...
test('an aspiring character pays own-class for a Signature in its pool', () => {
  const form = mountForm(islandData({
    economy: 'aspiring',
    aspiringSignatures: [{ class_id: 'c-v1', name: 'Cowboy Hat' }],
    entries: [entry('c-v1', 'Cowboy Hat'), entry('c-v1', 'Lasso')],
    purchases: []
  }));
  form.buy('c-v1', 'Cowboy Hat');
  expect(form.getSpent()).toBe(FIGURES.prices.signature.own);
});

// ...and everything else is not.
test('an aspiring character pays cross-class for a Signature outside its pool', () => {
  const form = mountForm(islandData({
    economy: 'aspiring',
    aspiringSignatures: [{ class_id: 'c-v1', name: 'Cowboy Hat' }],
    entries: [entry('c-v1', 'Cowboy Hat'), entry('c-v1', 'Lasso')],
    purchases: []
  }));
  form.buy('c-v1', 'Lasso');
  expect(form.getSpent()).toBe(FIGURES.prices.signature.cross);
});

// An Enchantment on a cross-class Signature is dearer too (pg. 85).
test('an Enchantment on a Signature outside the pool prices cross-class', () => {
  const form = mountForm(islandData({
    economy: 'aspiring',
    aspiringSignatures: [{ class_id: 'c-v1', name: 'Cowboy Hat' }],
    entries: [entryWithDefault('c-v1', 'Lasso')],
    purchases: []
  }));
  form.buy('c-v1', 'Lasso');
  form.setEnchantment('c-v1', 'Lasso', 'default');
  expect(form.getSpent()).toBe(
    FIGURES.prices.signature.cross + FIGURES.prices.defaultEnchantment.cross
  );
});
```

Adapt `mountForm`, `islandData`, `entry` and the interaction helpers to whatever the file already uses — read it first; its existing test at `:95-98` shows the mounting pattern.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test:unit 2>&1 | grep -A5 character-gear-purchases`
Expected: the two cross-class tests FAIL (both price own-class).

- [ ] **Step 3: Read the pool off the island**

Beside the existing `CHARACTER_CLASS_ID` read (around `:50`), add:

```js
  var ASPIRING_SIGNATURES = Array.isArray(data.aspiringSignatures) ? data.aspiringSignatures : [];
```

- [ ] **Step 4: Price by item, not by class**

`crossClassFor` takes only a class id, which cannot express "this item". Replace `:96-100`:

```js
    var crossClassFor = function (classId, name) {
      return SignatureEntry.isCrossClass({ class_id: classId, name: name }, {
        economy: ECONOMY,
        characterClassId: CHARACTER_CLASS_ID,
        aspiringSignatures: ASPIRING_SIGNATURES
      });
    };
```

Then fix every caller to pass the name. `grep -n "crossClassFor" public/js/character-gear-purchases.js` lists them; each already has the item in hand, so the second argument is `purchase.name` or `entry.name` depending on the site:

- `priceOfPurchase` (`:102-105`) → `crossClassFor(purchase.class_id, purchase.name)`
- `describePurchaseFor` (`:109-112`) → `crossClassFor(purchase.class_id, purchase.name)`
- `priceOfEntry` (`:114-117`) → `crossClassFor(entry.class_id, entry.name)`
- `renderCell`'s origin badge (`:336-338`) → `crossClassFor(entry.class_id, entry.name)`

After this, `grep -n "crossClassFor(" public/js/character-gear-purchases.js` must show no call still passing a single argument.

Wherever this file calls `SignatureEntry.totalOf`, add `aspiringSignatures: ASPIRING_SIGNATURES` to the options it passes.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run test:unit`
Expected: green.

- [ ] **Step 6: Note the origin badge**

`renderCell` shows a class-name tag only when `crossClassFor` is true. An acquired Signature will now name the class it came from, and a pooled one will not. That is the intended reading — confirm it renders rather than assuming it, and say so in your report.

- [ ] **Step 7: Commit**

```bash
git add public/js/character-gear-purchases.js test/character-gear-purchases.test.js
git commit -m "feat: price the aspiring edit form against its Signature pool"
```

---

### Task 11: End-to-end

**Files:**
- Create: `e2e/specs/29-aspiring-signature-acquisition.spec.js`

**Interfaces:**
- Consumes: every task above.

- [ ] **Step 1: Write the spec**

Model it on `e2e/specs/26-aspiring-wizard.spec.js`, which seeds three donor classes with `seedClass`/`unlockClassForProfile` from `e2e/fixtures/class.js` and drives the step-1 builder. The new spec must prove the divergence end to end:

1. Create an aspiring character through the wizard, picking three Signatures from three donor classes and buying all three. Assert `#merxSpent` reads `6` — three own-class picks.
2. From the wizard's shop, buy one Signature the builder did not choose. Assert `#merxSpent` rises by **3**, not 2.
3. Submit, and assert the stored row's `aspiring_signatures` holds exactly the three picks — not the four owned Signatures.
4. Open the character's edit form, buy a fifth Signature from the catalogue, and assert the surface charges 3 for it.
5. Save and assert the character page's Merx breakdown agrees with what the surfaces charged.

Read `e2e/specs/28-aspirant-v1-merx-purchases.spec.js` for how that file drives the grid, the drawer and `#merxSpent`, and reuse its selectors rather than inventing new ones.

- [ ] **Step 2: Run it**

Run: `bunx playwright test e2e/specs/29-aspiring-signature-acquisition.spec.js`
Expected: pass.

- [ ] **Step 3: Run the whole e2e suite**

Run: `bun run test:e2e 2>&1 | tail -30`
Expected: the 8 pre-existing failures and no others. Name them in your report.

- [ ] **Step 4: Re-check the row counts**

Re-run Task 4 Step 2's count query. The e2e suite creates and tears down characters, so this proves it cleaned up: 327 / 981 / 1492 / 916 / 62.

- [ ] **Step 5: Commit**

```bash
git add e2e/specs/29-aspiring-signature-acquisition.spec.js
git commit -m "test: cover aspiring Signature acquisition end to end"
```

---

## Verification

After Task 11, confirm all of the following and report each with its actual output:

- [ ] `bun run test:unit` — exit 0
- [ ] `bun run test:http` — only `routes/open-graph.test.js` red
- [ ] `bun run test:integration` — only the three pre-existing files red
- [ ] `bun run test:e2e` — only the 8 pre-existing failures
- [ ] Row counts unchanged: 327 / 981 / 1492 / 916 / 62
- [ ] `grep -c require util/merx-economy.js` — `0`
- [ ] No new literal Merx figure in the browser or the views:
      `grep -rn "[0-9]\s*Merx" public/js/ views/ | grep -v "{{"` returns nothing new
- [ ] `git status` clean
