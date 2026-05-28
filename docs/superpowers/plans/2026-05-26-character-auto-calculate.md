# Character Auto-Calculate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in "Auto-calculate from mission log" checkbox to the character edit form that derives `level`, `completed_missions`, and `commissary_reward` from the character's real + offscreen missions and item lists, with server-side authority.

**Architecture:** Pure derivation lives in `util/character-derived.js`. A new boolean column `characters.auto_calculate` persists the user's preference. `routes/characters.js` computes derived values at form-render time and exposes an HTMX partial endpoint for the checkbox toggle. `updateCharacter` recomputes from the submitted form payload when the flag is on and overwrites the three fields before the row write. No client-side math.

**Tech Stack:** Node.js + Express + Handlebars + HTMX, Supabase (Postgres), Bun test runner.

**Spec:** `docs/superpowers/specs/2026-05-26-character-auto-calculate-design.md`

---

## File Structure

**Create:**
- `util/character-derived.js` — pure derivation functions.
- `util/character-derived.test.js` — unit tests for derivation.
- `views/partials/character-auto-calc-fields.handlebars` — the three-field columns row + helper text. Rendered both during full form render and via the HTMX endpoint.
- `supabase/migrations/20260526120000_character_auto_calculate.sql` — column add.

**Modify:**
- `util/enclave-consts.js` — add `MERX_PER_MISSION_SUCCESS` constant.
- `schema.sql` — add `auto_calculate` column to the `characters` table definition (keeps reference schema in sync with the migration).
- `models/character.js` — add `getCharacterRealMissionsForDerivation`; modify `updateCharacter` to apply auto-calc when the flag is on; persist the flag.
- `models/character-update.test.js` — add tests for the new save behavior.
- `routes/characters.js` — wire `derived` into the edit GET; add `GET /:id/auto-calc-fields`.
- `views/character-form.handlebars` — add the checkbox; replace inline columns row with the new partial (edit form only).

---

## Task 1: Add the `auto_calculate` column

**Files:**
- Create: `supabase/migrations/20260526120000_character_auto_calculate.sql`
- Modify: `schema.sql:38-67` (the `CREATE TABLE characters` block — add column near the existing booleans)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260526120000_character_auto_calculate.sql`:

```sql
-- Persist the user's "auto-calculate from mission log" preference per character.
-- Default false: existing characters keep their manually-entered values until the user opts in.
ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS auto_calculate BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 2: Update `schema.sql` reference**

Open `schema.sql` and locate the `CREATE TABLE characters` block. Find the line with `hide_from_search BOOLEAN DEFAULT FALSE,` (or the nearest boolean column) and add a new line directly after it:

```sql
  auto_calculate BOOLEAN NOT NULL DEFAULT FALSE,
```

The exact line position is not critical — anywhere inside the `characters` table block before the closing `);` is fine. Just keep it next to the other booleans for readability.

- [ ] **Step 3: Apply the migration locally**

Run:

```bash
ls supabase/migrations/20260526120000_character_auto_calculate.sql
```

Expected: file is listed (the migration was created in Step 1).

(Actual application to a local Supabase happens via whatever the project uses to apply migrations — out of scope for this plan; this step just confirms the file exists.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260526120000_character_auto_calculate.sql schema.sql
git commit -m "feat: add characters.auto_calculate column"
```

---

## Task 2: Add the `MERX_PER_MISSION_SUCCESS` constant

**Files:**
- Modify: `util/enclave-consts.js:284-297`

- [ ] **Step 1: Add the constant**

In `util/enclave-consts.js`, just below the existing `v2LevelingSequence` line, add:

```js
// Merx awarded per successful real mission. Current editions are a flat 1
// across v1 and v2; future editions are expected to tier this by level or
// mission difficulty — when that lands, replace the constant with a function
// of (character, mission) and update util/character-derived.js accordingly.
const MERX_PER_MISSION_SUCCESS = 1;
```

Then update the `module.exports` block at the bottom of the file to include the new constant:

```js
module.exports = {
  statList,
  personalityMap,
  adventClassList,
  aspirantPreviewClassList,
  playerCreatedClassList,
  classGearList,
  classAbilityList,
  v1LevelingSequence,
  v2LevelingSequence,
  MERX_PER_MISSION_SUCCESS
};
```

- [ ] **Step 2: Verify exports**

Run:

```bash
node -e "console.log(require('./util/enclave-consts').MERX_PER_MISSION_SUCCESS)"
```

Expected output: `1`

- [ ] **Step 3: Commit**

```bash
git add util/enclave-consts.js
git commit -m "feat: add MERX_PER_MISSION_SUCCESS constant"
```

---

## Task 3: Write failing tests for `deriveCompletedMissions`

**Files:**
- Create: `util/character-derived.test.js`

- [ ] **Step 1: Write the failing test**

Create `util/character-derived.test.js`:

```js
const { test, expect } = require('bun:test');
const { deriveCompletedMissions } = require('./character-derived');

test('deriveCompletedMissions counts success and failure real missions plus all offscreen', () => {
  const realMissions = [
    { id: 'm1', outcome: 'success' },
    { id: 'm2', outcome: 'failure' },
    { id: 'm3', outcome: 'pending' },
    { id: 'm4', outcome: 'success' }
  ];
  const offscreenMissions = [
    { id: 'o1', merx_gained: 0 },
    { id: 'o2', merx_gained: 3 }
  ];
  expect(deriveCompletedMissions(realMissions, offscreenMissions)).toBe(5);
});

test('deriveCompletedMissions returns 0 for empty inputs', () => {
  expect(deriveCompletedMissions([], [])).toBe(0);
  expect(deriveCompletedMissions(undefined, undefined)).toBe(0);
  expect(deriveCompletedMissions(null, null)).toBe(0);
});

test('deriveCompletedMissions excludes pending and ignores unknown outcomes', () => {
  const realMissions = [
    { outcome: 'pending' },
    { outcome: 'success' },
    { outcome: 'cancelled' },
    { outcome: null }
  ];
  expect(deriveCompletedMissions(realMissions, [])).toBe(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test util/character-derived.test.js
```

Expected: FAIL — `Cannot find module './character-derived'`.

---

## Task 4: Implement `deriveCompletedMissions`

**Files:**
- Create: `util/character-derived.js`

- [ ] **Step 1: Write the minimal implementation**

Create `util/character-derived.js`:

```js
const COUNTABLE_OUTCOMES = new Set(['success', 'failure']);

const deriveCompletedMissions = (realMissions, offscreenMissions) => {
  const real = Array.isArray(realMissions) ? realMissions : [];
  const offscreen = Array.isArray(offscreenMissions) ? offscreenMissions : [];
  const countedReal = real.filter(m => m && COUNTABLE_OUTCOMES.has(m.outcome)).length;
  return countedReal + offscreen.length;
};

module.exports = {
  deriveCompletedMissions
};
```

- [ ] **Step 2: Run the tests to verify they pass**

Run:

```bash
bun test util/character-derived.test.js
```

Expected: PASS — 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add util/character-derived.js util/character-derived.test.js
git commit -m "feat: deriveCompletedMissions — count success/failure + offscreen"
```

---

## Task 5: Write failing tests for `deriveLevel`

**Files:**
- Modify: `util/character-derived.test.js`

- [ ] **Step 1: Append the failing tests**

Append to `util/character-derived.test.js`:

```js
const { deriveLevel } = require('./character-derived');

test('deriveLevel uses v1 sequence (cumulative 2,5,9,14,20,27,35,44,54)', () => {
  expect(deriveLevel(0, 'v1')).toBe(1);
  expect(deriveLevel(1, 'v1')).toBe(1);
  expect(deriveLevel(2, 'v1')).toBe(2);
  expect(deriveLevel(4, 'v1')).toBe(2);
  expect(deriveLevel(5, 'v1')).toBe(3);
  expect(deriveLevel(53, 'v1')).toBe(9);
  expect(deriveLevel(54, 'v1')).toBe(10);
  expect(deriveLevel(9999, 'v1')).toBe(10);
});

test('deriveLevel uses v2 sequence (cumulative 2,4,7,10,14,18,23,28,34)', () => {
  expect(deriveLevel(0, 'v2')).toBe(1);
  expect(deriveLevel(2, 'v2')).toBe(2);
  expect(deriveLevel(3, 'v2')).toBe(2);
  expect(deriveLevel(4, 'v2')).toBe(3);
  expect(deriveLevel(33, 'v2')).toBe(9);
  expect(deriveLevel(34, 'v2')).toBe(10);
  expect(deriveLevel(100, 'v2')).toBe(10);
});

test('deriveLevel defaults to v1 sequence when rulesVersion missing or unknown', () => {
  expect(deriveLevel(5)).toBe(3);
  expect(deriveLevel(5, null)).toBe(3);
  expect(deriveLevel(5, 'v3')).toBe(3);
});
```

- [ ] **Step 2: Run to verify they fail**

Run:

```bash
bun test util/character-derived.test.js
```

Expected: FAIL — `deriveLevel is not a function` (or similar).

---

## Task 6: Implement `deriveLevel`

**Files:**
- Modify: `util/character-derived.js`

- [ ] **Step 1: Add the implementation**

In `util/character-derived.js`, add the import at the top:

```js
const { v1LevelingSequence, v2LevelingSequence } = require('./enclave-consts');
```

Then add the function above the `module.exports`:

```js
const MAX_LEVEL = 10;

const deriveLevel = (completedMissions, rulesVersion) => {
  const seq = rulesVersion === 'v2' ? v2LevelingSequence : v1LevelingSequence;
  const total = Math.max(0, Number(completedMissions) || 0);
  let level = 1;
  let cumulative = 0;
  for (let i = 0; i < seq.length; i++) {
    cumulative += seq[i];
    if (total >= cumulative) {
      level = i + 2;
    } else {
      break;
    }
  }
  return Math.min(level, MAX_LEVEL);
};
```

Update the exports:

```js
module.exports = {
  deriveCompletedMissions,
  deriveLevel
};
```

- [ ] **Step 2: Run tests**

Run:

```bash
bun test util/character-derived.test.js
```

Expected: PASS — 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add util/character-derived.js util/character-derived.test.js
git commit -m "feat: deriveLevel — v1/v2 sequence, clamped to 10"
```

---

## Task 7: Write failing tests for `deriveMerx`

**Files:**
- Modify: `util/character-derived.test.js`

- [ ] **Step 1: Append the failing tests**

Append to `util/character-derived.test.js`:

```js
const { deriveMerx } = require('./character-derived');

test('deriveMerx awards 1 per successful real mission and sums offscreen merx_gained', () => {
  const result = deriveMerx({
    realMissions: [
      { outcome: 'success' },
      { outcome: 'success' },
      { outcome: 'failure' },
      { outcome: 'pending' }
    ],
    offscreenMissions: [
      { merx_gained: 3 },
      { merx_gained: 2 },
      { merx_gained: 0 }
    ],
    gear: [],
    commonItems: [],
    characterClassId: 'class-A'
  });
  expect(result).toBe(7);
});

test('deriveMerx subtracts 1 per common item', () => {
  const result = deriveMerx({
    realMissions: [{ outcome: 'success' }, { outcome: 'success' }, { outcome: 'success' }],
    offscreenMissions: [],
    gear: [],
    commonItems: ['x', 'y'],
    characterClassId: 'class-A'
  });
  expect(result).toBe(1);
});

test('deriveMerx subtracts 2 for on-class gear and 3 for off-class gear', () => {
  const result = deriveMerx({
    realMissions: [{ outcome: 'success' }, { outcome: 'success' }, { outcome: 'success' }, { outcome: 'success' }, { outcome: 'success' }, { outcome: 'success' }, { outcome: 'success' }, { outcome: 'success' }],
    offscreenMissions: [],
    gear: [
      { name: 'On1', class_id: 'class-A' },
      { name: 'On2', class_id: 'class-A' },
      { name: 'Off1', class_id: 'class-B' }
    ],
    commonItems: [],
    characterClassId: 'class-A'
  });
  expect(result).toBe(8 - (2 + 2 + 3));
});

test('deriveMerx treats missing class_id on gear or character as off-class', () => {
  const result = deriveMerx({
    realMissions: [{ outcome: 'success' }, { outcome: 'success' }, { outcome: 'success' }, { outcome: 'success' }, { outcome: 'success' }],
    offscreenMissions: [],
    gear: [
      { name: 'NoClass' },
      { name: 'OnClass', class_id: 'class-A' }
    ],
    commonItems: [],
    characterClassId: 'class-A'
  });
  expect(result).toBe(5 - (3 + 2));
});

test('deriveMerx with no character class makes all gear off-class', () => {
  const result = deriveMerx({
    realMissions: [{ outcome: 'success' }, { outcome: 'success' }, { outcome: 'success' }, { outcome: 'success' }],
    offscreenMissions: [],
    gear: [
      { name: 'G1', class_id: 'class-A' },
      { name: 'G2', class_id: 'class-A' }
    ],
    commonItems: [],
    characterClassId: null
  });
  expect(result).toBe(4 - (3 + 3));
});

test('deriveMerx floors at 0 when spend exceeds earned', () => {
  const result = deriveMerx({
    realMissions: [{ outcome: 'success' }],
    offscreenMissions: [],
    gear: [
      { name: 'A', class_id: 'class-A' },
      { name: 'B', class_id: 'class-A' }
    ],
    commonItems: ['c1', 'c2', 'c3'],
    characterClassId: 'class-A'
  });
  expect(result).toBe(0);
});

test('deriveMerx returns 0 for empty inputs', () => {
  expect(deriveMerx({
    realMissions: [],
    offscreenMissions: [],
    gear: [],
    commonItems: [],
    characterClassId: 'class-A'
  })).toBe(0);
});

test('deriveMerx coerces non-numeric offscreen merx_gained to 0', () => {
  const result = deriveMerx({
    realMissions: [],
    offscreenMissions: [
      { merx_gained: '4' },
      { merx_gained: null },
      { merx_gained: undefined },
      { merx_gained: 'abc' }
    ],
    gear: [],
    commonItems: [],
    characterClassId: 'class-A'
  });
  expect(result).toBe(4);
});
```

- [ ] **Step 2: Run to verify failure**

Run:

```bash
bun test util/character-derived.test.js
```

Expected: FAIL — `deriveMerx is not a function`.

---

## Task 8: Implement `deriveMerx`

**Files:**
- Modify: `util/character-derived.js`

- [ ] **Step 1: Update the imports**

At the top of `util/character-derived.js`, replace the existing `require('./enclave-consts')` line with:

```js
const { v1LevelingSequence, v2LevelingSequence, MERX_PER_MISSION_SUCCESS } = require('./enclave-consts');
```

- [ ] **Step 2: Add the function**

Above `module.exports`, add:

```js
const COMMON_ITEM_COST = 1;
const GEAR_ON_CLASS_COST = 2;
const GEAR_OFF_CLASS_COST = 3;

const coerceMerx = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

const deriveMerx = ({ realMissions, offscreenMissions, gear, commonItems, characterClassId }) => {
  const real = Array.isArray(realMissions) ? realMissions : [];
  const offscreen = Array.isArray(offscreenMissions) ? offscreenMissions : [];
  const gearList = Array.isArray(gear) ? gear : [];
  const itemList = Array.isArray(commonItems) ? commonItems : [];

  const successes = real.filter(m => m && m.outcome === 'success').length;
  const earnedFromReal = successes * MERX_PER_MISSION_SUCCESS;
  const earnedFromOffscreen = offscreen.reduce((sum, om) => sum + coerceMerx(om && om.merx_gained), 0);

  const itemSpend = itemList.length * COMMON_ITEM_COST;
  const gearSpend = gearList.reduce((sum, g) => {
    if (!g) return sum;
    const onClass = !!characterClassId && !!g.class_id && g.class_id === characterClassId;
    return sum + (onClass ? GEAR_ON_CLASS_COST : GEAR_OFF_CLASS_COST);
  }, 0);

  return Math.max(0, earnedFromReal + earnedFromOffscreen - itemSpend - gearSpend);
};
```

Update exports:

```js
module.exports = {
  deriveCompletedMissions,
  deriveLevel,
  deriveMerx
};
```

- [ ] **Step 3: Run tests**

Run:

```bash
bun test util/character-derived.test.js
```

Expected: PASS — all `deriveMerx` tests plus the earlier ones pass (14 total).

- [ ] **Step 4: Commit**

```bash
git add util/character-derived.js util/character-derived.test.js
git commit -m "feat: deriveMerx — success awards, offscreen sum, item/gear spend"
```

---

## Task 9: Write failing test for `deriveCharacterTotals`

**Files:**
- Modify: `util/character-derived.test.js`

- [ ] **Step 1: Append the test**

Append:

```js
const { deriveCharacterTotals } = require('./character-derived');

test('deriveCharacterTotals returns all three derived fields together', () => {
  const character = {
    class_id: 'class-A',
    gear: [
      { name: 'On', class_id: 'class-A' },
      { name: 'Off', class_id: 'class-B' }
    ],
    common_items: ['kit', 'rope']
  };
  const realMissions = [
    { outcome: 'success' },
    { outcome: 'success' },
    { outcome: 'failure' },
    { outcome: 'pending' }
  ];
  const offscreenMissions = [
    { merx_gained: 3 }
  ];

  const result = deriveCharacterTotals({
    character,
    realMissions,
    offscreenMissions,
    rulesVersion: 'v2'
  });

  // completed: 2 success + 1 failure + 1 offscreen = 4
  // merx earned: 2*1 + 3 = 5; spend: 2 items*1 + 1 on-class*2 + 1 off-class*3 = 7; max(0, 5-7) = 0
  // level (v2, 4 missions): cumulative v2 is [2,4,7,...]; 4 >= 4 -> level 3
  expect(result).toEqual({
    completed_missions: 4,
    commissary_reward: 0,
    level: 3
  });
});

test('deriveCharacterTotals defaults to v1 when rulesVersion missing', () => {
  const character = { class_id: null, gear: [], common_items: [] };
  const realMissions = Array.from({ length: 5 }, () => ({ outcome: 'success' }));
  const result = deriveCharacterTotals({
    character,
    realMissions,
    offscreenMissions: []
  });
  // completed 5, level v1: cumulative [2,5,...] -> 5 >= 5 -> level 3
  // merx: 5 earned, no spend = 5
  expect(result).toEqual({
    completed_missions: 5,
    commissary_reward: 5,
    level: 3
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run:

```bash
bun test util/character-derived.test.js
```

Expected: FAIL — `deriveCharacterTotals is not a function`.

---

## Task 10: Implement `deriveCharacterTotals`

**Files:**
- Modify: `util/character-derived.js`

- [ ] **Step 1: Add the orchestrator**

Above `module.exports`, add:

```js
const deriveCharacterTotals = ({ character, realMissions, offscreenMissions, rulesVersion }) => {
  const completed_missions = deriveCompletedMissions(realMissions, offscreenMissions);
  const commissary_reward = deriveMerx({
    realMissions,
    offscreenMissions,
    gear: character && character.gear,
    commonItems: character && character.common_items,
    characterClassId: character && character.class_id
  });
  const level = deriveLevel(completed_missions, rulesVersion);
  return { completed_missions, commissary_reward, level };
};
```

Update exports:

```js
module.exports = {
  deriveCompletedMissions,
  deriveLevel,
  deriveMerx,
  deriveCharacterTotals
};
```

- [ ] **Step 2: Run tests**

Run:

```bash
bun test util/character-derived.test.js
```

Expected: PASS — all 16 tests pass.

- [ ] **Step 3: Commit**

```bash
git add util/character-derived.js util/character-derived.test.js
git commit -m "feat: deriveCharacterTotals — orchestrate completed/merx/level"
```

---

## Task 11: Add `getCharacterRealMissionsForDerivation` to character model

**Files:**
- Modify: `models/character.js` (add near `getCharacterAllMissions` at line ~877; export at the bottom)

- [ ] **Step 1: Add the model function**

In `models/character.js`, locate `getCharacterAllMissions` (around line 877). Directly below the closing `};` of that function, add:

```js
// Lightweight read used by auto-calculate derivation: only the fields we need.
// Separate from getCharacterAllMissions because the latter selects display
// fields (name, date, summary, is_public, creator_id) we don't need here.
const getCharacterRealMissionsForDerivation = async (characterId, client = supabase) => {
  const { data, error } = await client
    .from('mission_characters')
    .select(`mission_id, missions ( id, outcome )`)
    .eq('character_id', characterId);

  if (error) {
    console.error(error);
    return { data: null, error };
  }

  return {
    data: (data || []).map(mc => mc.missions).filter(Boolean),
    error: null
  };
};
```

Then in the `module.exports` block at the bottom of the file (around line 1171), add `getCharacterRealMissionsForDerivation,` to the list.

- [ ] **Step 2: Sanity check the export**

Run:

```bash
node -e "console.log(typeof require('./models/character').getCharacterRealMissionsForDerivation)"
```

Expected output: `function`

- [ ] **Step 3: Commit**

```bash
git add models/character.js
git commit -m "feat: getCharacterRealMissionsForDerivation — outcome-only read"
```

---

## Task 12: Write failing tests for save-time auto-calc in `updateCharacter`

**Files:**
- Modify: `models/character-update.test.js`

- [ ] **Step 1: Extend the in-memory store and beforeEach**

Open `models/character-update.test.js`. In the `anonTables` and `adminTables` declarations near the top, add `offscreen_missions: []` to each:

```js
const anonTables = {
  characters: [],
  traits: [],
  class_gear: [],
  class_abilities: [],
  classes: [],
  offscreen_missions: []
};
const adminTables = {
  characters: [],
  traits: [],
  class_gear: [],
  class_abilities: [],
  classes: [],
  offscreen_missions: []
};
```

In the `beforeEach` block, reset the new arrays alongside the others (add these two lines at the end of the block):

```js
  anonTables.offscreen_missions = [];
  adminTables.offscreen_missions = [];
```

Add a `count` capability to the fake client. In the `chain` object inside `makeClient`, just below the existing `select() { return chain; },` line, replace it with this richer version that supports `select(_, { count, head })`:

```js
      select(_, opts) {
        if (opts && opts.head && opts.count) {
          const { data } = settleRead();
          return Promise.resolve({ data: null, count: data.length, error: null });
        }
        return chain;
      },
```

Also add `not` and `is` filter stubs immediately after the `eq` method (still inside `chain`):

```js
      not(col, op, val) { /* treated as no-op for these tests */ return chain; },
      is(col, val) { filters.push([col, val === null ? null : val]); return chain; },
```

- [ ] **Step 2: Append the failing tests**

At the end of `models/character-update.test.js`, append:

```js
test('updateCharacter with auto_calculate=true overwrites the three derived fields', async () => {
  // Setup: 2 successful real missions + 1 offscreen with 3 merx.
  adminTables.characters = [{
    ...PRIVATE_CHARACTER,
    level: 1,
    completed_missions: 0,
    commissary_reward: 0,
    auto_calculate: false
  }];
  adminTables.classes = [{ id: 'class-soldier', name: 'Soldier', rules_version: 'v1' }];
  adminTables.missions = [
    { id: 'mis-1', outcome: 'success' },
    { id: 'mis-2', outcome: 'success' }
  ];
  adminTables.mission_characters = [
    { character_id: 'char-private-1', mission_id: 'mis-1', missions: { id: 'mis-1', outcome: 'success' } },
    { character_id: 'char-private-1', mission_id: 'mis-2', missions: { id: 'mis-2', outcome: 'success' } }
  ];
  anonTables.mission_characters = adminTables.mission_characters;
  adminTables.offscreen_missions = [
    { id: 'om-1', character_id: 'char-private-1', merx_gained: 3 }
  ];
  anonTables.offscreen_missions = adminTables.offscreen_missions;

  const { data, error } = await updateCharacter(
    'char-private-1',
    {
      // User-submitted (wrong) values that should be overwritten:
      level: 1,
      completed_missions: 0,
      commissary_reward: 0,
      // The flag:
      auto_calculate: 'on',
      // No item spend in this case:
      common_items: [],
      gear: []
    },
    { id: 'profile-1' }
  );

  expect(error).toBeFalsy();
  expect(data).toBeTruthy();
  // 2 success + 1 offscreen = 3 completed; v1 sequence: 3 >= 2 -> level 2
  expect(data.completed_missions).toBe(3);
  expect(data.level).toBe(2);
  // 2*1 + 3 = 5 merx, no spend
  expect(data.commissary_reward).toBe(5);
  expect(data.auto_calculate).toBe(true);
});

test('updateCharacter with auto_calculate=false persists submitted values verbatim', async () => {
  adminTables.characters = [{ ...PRIVATE_CHARACTER, auto_calculate: false }];

  const { data, error } = await updateCharacter(
    'char-private-1',
    {
      level: 7,
      completed_missions: 42,
      commissary_reward: 99,
      auto_calculate: undefined,
      common_items: [],
      gear: []
    },
    { id: 'profile-1' }
  );

  expect(error).toBeFalsy();
  expect(data.level).toBe(7);
  expect(data.completed_missions).toBe(42);
  expect(data.commissary_reward).toBe(99);
  expect(data.auto_calculate).toBe(false);
});
```

- [ ] **Step 3: Run to verify failure**

Run:

```bash
bun test models/character-update.test.js
```

Expected: FAIL — the new tests fail because `updateCharacter` doesn't yet apply auto-calc or persist the flag.

---

## Task 13: Implement save-time auto-calc in `updateCharacter`

**Files:**
- Modify: `models/character.js` (top imports + `updateCharacter` body around line 262-413)

- [ ] **Step 1: Add imports**

At the top of `models/character.js`, just below the existing `require('../util/enclave-consts')` line, add:

```js
const { deriveCharacterTotals } = require('../util/character-derived');
const { listOffscreenMissions } = require('./offscreen-mission');
```

- [ ] **Step 2: Normalize the `auto_calculate` flag**

Inside `updateCharacter`, after the existing block that handles `hide_from_search` (around line 350-354), add:

```js
  // handle auto_calculate
  characterReq.auto_calculate = characterReq.auto_calculate === 'on' || characterReq.auto_calculate === true;
```

- [ ] **Step 3: Resolve submitted gear into `{name, class_id}` shape and apply auto-calc**

Find the block that prepares gear/abilities/common_items above the row UPDATE (the `// handle common items` block ends around line 340). Directly **before** the `// normalize v2 JSONB fields before update` line, insert:

```js
  // Auto-calculate: when enabled, recompute level/completed_missions/commissary_reward
  // from the submitted in-flight payload (gear, common_items, class_id) and the
  // character's mission history. Server is authoritative — submitted values for
  // these three fields are ignored when the flag is on.
  if (characterReq.auto_calculate) {
    // Resolve gear strings ("ClassName::GearName") to objects with class_id so
    // on-class/off-class classification matches the persisted shape.
    const submittedGear = Array.isArray(classGear) ? classGear : (classGear ? [classGear] : []);
    let resolvedGear = [];
    if (submittedGear.length > 0) {
      const { gearNameToClassId } = await buildClassContentLookupMaps();
      resolvedGear = submittedGear
        .map(item => {
          if (!item) return null;
          if (typeof item === 'string') {
            const trimmed = item.trim();
            if (!trimmed) return null;
            const name = trimmed.includes('::') ? trimmed.split('::')[1].trim() : trimmed;
            return name ? { name, class_id: gearNameToClassId.get(name) || null } : null;
          }
          if (typeof item === 'object' && item.name) {
            return { name: item.name, class_id: item.class_id || gearNameToClassId.get(item.name) || null };
          }
          return null;
        })
        .filter(Boolean);
    }

    const [{ data: realMissions }, { data: offscreenMissions }] = await Promise.all([
      getCharacterRealMissionsForDerivation(id, supabaseAdmin),
      listOffscreenMissions({ characterId: id, supabase: supabaseAdmin })
    ]);

    const rulesVersion = linkedVersion;
    const derived = deriveCharacterTotals({
      character: {
        class_id: characterReq.class_id,
        gear: resolvedGear,
        common_items: characterReq.common_items
      },
      realMissions: realMissions || [],
      offscreenMissions: offscreenMissions || [],
      rulesVersion
    });

    characterReq.level = derived.level;
    characterReq.completed_missions = derived.completed_missions;
    characterReq.commissary_reward = derived.commissary_reward;
  }
```

Note: `classGear` was already extracted from `characterReq` earlier in the function (line ~321) and assigned to a local. We reuse that local here. Make sure this block comes **after** the `const classGear = characterReq.gear; delete characterReq.gear;` line.

- [ ] **Step 4: Run the tests**

Run:

```bash
bun test models/character-update.test.js
```

Expected: PASS — all tests including the two new ones pass.

If the fake client's `select(_, { count, head })` isn't being triggered by this path, the tests still pass because `listOffscreenMissions` uses plain `.select('*')` (no count). Confirm by reading the output.

- [ ] **Step 5: Run the full test suite to catch regressions**

Run:

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add models/character.js models/character-update.test.js
git commit -m "feat: updateCharacter — apply auto-calc when flag is on"
```

---

## Task 14: Wire `derived` into the edit form GET route

**Files:**
- Modify: `routes/characters.js` (the `GET /:id/edit` handler around line 179-260; also imports at top)

- [ ] **Step 1: Add imports**

At the top of `routes/characters.js`, locate the existing imports from `../models/character` and `../util/enclave-consts`. Add to the import lines (or add a new line if needed):

```js
const { getCharacterRealMissionsForDerivation } = require('../models/character');
const { listOffscreenMissions } = require('../models/offscreen-mission');
const { deriveCharacterTotals } = require('../util/character-derived');
```

(If the existing destructure from `../models/character` already covers other names, append `getCharacterRealMissionsForDerivation` to that destructure instead of adding a duplicate require.)

- [ ] **Step 2: Compute `derived` in the edit GET handler**

Inside `router.get('/:id/edit', ...)`, after the `effectiveVersion` is determined (around line 226, after the `try { const { data: cls } = await getClass... }` block) and before the `let upgradeTargets = [];` line, add:

```js
    const [{ data: derivRealMissions }, { data: derivOffscreen }] = await Promise.all([
      getCharacterRealMissionsForDerivation(id, res.locals.supabase),
      listOffscreenMissions({ characterId: id, supabase: res.locals.supabase })
    ]);
    const derived = deriveCharacterTotals({
      character,
      realMissions: derivRealMissions || [],
      offscreenMissions: derivOffscreen || [],
      rulesVersion: effectiveVersion
    });
```

Then in the `res.render('character-form', { ... })` call, add `derived,` and `autoCalculate: character.auto_calculate,` to the context object (place them near the existing `effectiveVersion,` line).

- [ ] **Step 3: Smoke-test the route**

Bun doesn't ship a route harness in this codebase. Manual check: run the server and load the edit page for an existing character.

```bash
bun run dev
```

In a browser, open `/characters/<some-existing-id>/edit`. Expected: page renders without 500. (No new UI yet — Task 16 adds the checkbox; this task only ensures the route still works with the added compute.)

- [ ] **Step 4: Commit**

```bash
git add routes/characters.js
git commit -m "feat: edit route — compute derived totals for auto-calc"
```

---

## Task 15: Add the HTMX partial endpoint `GET /:id/auto-calc-fields`

**Files:**
- Modify: `routes/characters.js`

- [ ] **Step 1: Add the route handler**

In `routes/characters.js`, add a new handler directly after the existing `router.get('/:id/edit', ...)` handler (just below its closing `});`):

```js
router.get('/:id/auto-calc-fields', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const on = req.query.on === '1' || req.query.on === 1 || req.query.on === true || req.query.on === 'true';

  const { data: character, error } = await getCharacter(id, res.locals.supabase);
  if (error || !character) return res.status(400).send(error ? error.message : 'Character not found');
  if (character.creator_id !== profile.id) return res.status(403).send('Forbidden');

  let effectiveVersion = 'v1';
  if (character.class_id) {
    try {
      const { data: cls } = await getClass(character.class_id, res.locals.supabase);
      if (cls && cls.rules_version === 'v2') effectiveVersion = 'v2';
    } catch (_) {}
  }

  let derived = { completed_missions: 0, commissary_reward: 0, level: 1 };
  if (on) {
    const [{ data: realMissions }, { data: offscreenMissions }] = await Promise.all([
      getCharacterRealMissionsForDerivation(id, res.locals.supabase),
      listOffscreenMissions({ characterId: id, supabase: res.locals.supabase })
    ]);
    derived = deriveCharacterTotals({
      character,
      realMissions: realMissions || [],
      offscreenMissions: offscreenMissions || [],
      rulesVersion: effectiveVersion
    });
  }

  return res.render('partials/character-auto-calc-fields', {
    layout: false,
    character,
    derived,
    autoCalculate: on,
    effectiveVersion
  });
});
```

- [ ] **Step 2: Smoke-test the endpoint**

With `bun run dev` running, in a browser console or via curl with auth cookies:

```bash
curl -i http://localhost:3000/characters/<some-existing-id>/auto-calc-fields?on=1
```

Expected: returns HTML (no layout) containing an `id="auto-calc-fields"` wrapper and three input fields. (The partial doesn't exist yet — Task 16 creates it. So expect an error in this smoke test if you try; defer the smoke test until after Task 16.)

- [ ] **Step 3: Commit**

```bash
git add routes/characters.js
git commit -m "feat: GET /:id/auto-calc-fields HTMX partial route"
```

---

## Task 16: Create the `character-auto-calc-fields` partial

**Files:**
- Create: `views/partials/character-auto-calc-fields.handlebars`

- [ ] **Step 1: Write the partial**

Create `views/partials/character-auto-calc-fields.handlebars`:

```handlebars
<div id="auto-calc-fields">
  <div class="columns is-multiline">
    <div class="column is-one-third-tablet">
      <div class="field">
        <label class="label" for="char-level">Level</label>
        <div class="control">
          <input class="input" type="number" name="level" id="char-level" placeholder="Level"
            value="{{#if autoCalculate}}{{derived.level}}{{else}}{{#if character.level}}{{character.level}}{{else}}1{{/if}}{{/if}}"
            {{#if autoCalculate}}disabled{{/if}} required min="1" max="10">
        </div>
        {{#if autoCalculate}}
          {{#if (lt derived.level 10)}}
          <p class="help">
            {{#if (eq effectiveVersion 'v2')}}
            V2: Need {{subtract (getTotalV2MissionsNeeded (add derived.level 1)) derived.completed_missions}} more
            missions to reach level {{add derived.level 1}}
            {{else}}
            V1: Need {{subtract (getTotalV1MissionsNeeded (add derived.level 1)) derived.completed_missions}} more
            missions to reach level {{add derived.level 1}}
            {{/if}}
          </p>
          {{/if}}
        {{else}}
          {{#if (lt character.level 10)}}
          <p class="help">
            {{#if (eq effectiveVersion 'v2')}}
            V2: Need {{subtract (getTotalV2MissionsNeeded (add character.level 1)) character.completed_missions}} more
            missions to reach level {{add character.level 1}}
            {{else}}
            V1: Need {{subtract (getTotalV1MissionsNeeded (add character.level 1)) character.completed_missions}} more
            missions to reach level {{add character.level 1}}
            {{/if}}
          </p>
          {{/if}}
        {{/if}}
      </div>
    </div>

    <div class="column is-one-third-tablet">
      <div class="field">
        <label class="label" for="char-completed-missions">Completed Missions</label>
        <div class="control">
          <input class="input" type="number" name="completed_missions" id="char-completed-missions" placeholder="Completed Missions"
            value="{{#if autoCalculate}}{{derived.completed_missions}}{{else}}{{#if character.completed_missions}}{{character.completed_missions}}{{else}}0{{/if}}{{/if}}"
            {{#if autoCalculate}}disabled{{/if}} required>
        </div>
      </div>
    </div>

    <div class="column is-one-third-tablet">
      <div class="field">
        <label class="label" for="char-commissary-reward">Commissary Reward</label>
        <div class="control">
          <input class="input" type="number" name="commissary_reward" id="char-commissary-reward" placeholder="Commissary Reward"
            value="{{#if autoCalculate}}{{derived.commissary_reward}}{{else}}{{#if character.commissary_reward}}{{character.commissary_reward}}{{else}}0{{/if}}{{/if}}"
            {{#if autoCalculate}}disabled{{/if}} required>
        </div>
      </div>
    </div>
  </div>

  {{#if autoCalculate}}
  <p class="help has-text-grey">Values will be recomputed when you save.</p>
  {{/if}}
</div>
```

- [ ] **Step 2: Smoke-test via the HTMX route**

With `bun run dev` running, hit:

```bash
curl -s "http://localhost:3000/characters/<some-existing-id>/auto-calc-fields?on=1" --cookie "<auth cookies>"
```

(Or in a browser with a logged-in session.)

Expected: HTML containing `disabled` attributes on the three inputs and the derived numbers in the `value=` attrs.

Then without `?on=1`:

```bash
curl -s "http://localhost:3000/characters/<some-existing-id>/auto-calc-fields"
```

Expected: same shape, no `disabled` attrs, character's saved values in `value=`.

- [ ] **Step 3: Commit**

```bash
git add views/partials/character-auto-calc-fields.handlebars
git commit -m "feat: character-auto-calc-fields partial — locked/editable variants"
```

---

## Task 17: Wire the checkbox and partial into the character form

**Files:**
- Modify: `views/character-form.handlebars:111-152` (the existing Level/Completed/Merx columns block)

- [ ] **Step 1: Replace the inline columns block with the partial + checkbox**

In `views/character-form.handlebars`, locate the existing block that starts with `<div class="columns is-multiline">` containing `char-level`, `char-completed-missions`, and `char-commissary-reward` (lines 111-152).

Replace that entire `<div class="columns is-multiline">...</div>` block with:

```handlebars
{{#unless isNew}}
<div class="field">
  <div class="control">
    <label class="checkbox">
      <input type="checkbox" name="auto_calculate" {{#if character.auto_calculate}}checked{{/if}}
             hx-get="/characters/{{character.id}}/auto-calc-fields"
             hx-trigger="change"
             hx-target="#auto-calc-fields"
             hx-swap="outerHTML"
             hx-vals='js:{on: event.target.checked ? 1 : 0}'>
      Auto-calculate from mission log
    </label>
  </div>
  <p class="help">Recomputes Level, Completed Missions, and Commissary Reward from your mission log and item costs when you save.</p>
</div>
{{> character-auto-calc-fields character=character derived=derived autoCalculate=character.auto_calculate effectiveVersion=effectiveVersion}}
{{else}}
<div class="columns is-multiline">
  <div class="column is-one-third-tablet">
    <div class="field">
      <label class="label" for="char-level">Level</label>
      <div class="control">
        <input class="input" type="number" name="level" id="char-level" placeholder="Level"
          value="{{#if character.level}}{{character.level}}{{else}}1{{/if}}" required min="1" max="10">
      </div>
    </div>
  </div>

  <div class="column is-one-third-tablet">
    <div class="field">
      <label class="label" for="char-completed-missions">Completed Missions</label>
      <div class="control">
        <input class="input" type="number" name="completed_missions" id="char-completed-missions" placeholder="Completed Missions"
          value="{{#if character.completed_missions}}{{character.completed_missions}}{{else}}0{{/if}}" required>
      </div>
    </div>
  </div>

  <div class="column is-one-third-tablet">
    <div class="field">
      <label class="label" for="char-commissary-reward">Commissary Reward</label>
      <div class="control">
        <input class="input" type="number" name="commissary_reward" id="char-commissary-reward" placeholder="Commissary Reward"
          value="{{#if character.commissary_reward}}{{character.commissary_reward}}{{else}}0{{/if}}" required>
      </div>
    </div>
  </div>
</div>
{{/unless}}
```

(The `{{else}}` branch preserves the old behavior for the **create** form, which has no character and no missions.)

- [ ] **Step 2: Smoke-test the full edit form**

With `bun run dev` running, open `/characters/<some-existing-id>/edit` for a character that has at least one logged mission.

Expected:
- Checkbox visible above the three inputs, unchecked (unless this character was previously saved with the flag).
- Three inputs are editable, showing the character's saved values.
- Toggling the checkbox triggers an HTMX request, swaps the wrapper, and the three inputs become disabled with derived values filled in.
- Untoggling restores the original editable values.
- Submitting with the box checked saves the recomputed values to the row; the next edit page load shows the box still checked and the locked fields reflecting the latest computation.

- [ ] **Step 3: Smoke-test the new form**

Open `/characters/new`. Expected: three inputs render exactly as before, no checkbox.

- [ ] **Step 4: Commit**

```bash
git add views/character-form.handlebars
git commit -m "feat: character form — auto-calculate checkbox + partial wiring"
```

---

## Task 18: Full regression run

**Files:** none

- [ ] **Step 1: Run the full test suite**

Run:

```bash
bun test
```

Expected: All tests pass — old and new.

- [ ] **Step 2: Manual sanity checks**

With the dev server running:

1. Edit a character with at least one **successful** real mission and one offscreen mission. Toggle auto-calc. Verify the three locked values match the derivation rule (1 per success + offscreen merx, minus items × 1 + on-class gear × 2 + off-class gear × 3, clamped at 0; level from leveling sequence).
2. Edit a character with **failed** real missions only. Toggle auto-calc. Verify completed_missions counts the failures but merx is 0 (minus any item spend, floored at 0).
3. Edit a character with **pending** real missions. Toggle auto-calc. Verify those are excluded from both completed_missions and merx.
4. Edit a character with no class set. Toggle auto-calc. Verify all gear is treated as off-class (3 each).
5. With auto-calc on, save the form. Reload the edit page. Verify checkbox is still checked and locked values still match.

- [ ] **Step 3: Commit any drift**

If you made small fixes during smoke-testing, commit them with a message describing what was fixed. Otherwise no commit needed.

---

## Self-Review Checklist

(Run mentally after writing the plan — do not skip.)

- **Spec coverage:**
  - Derivation rules (completed_missions, merx, level) → Tasks 3-10.
  - `MERX_PER_MISSION_SUCCESS` constant → Task 2.
  - `auto_calculate` column + migration → Task 1.
  - `getCharacterRealMissionsForDerivation` model → Task 11.
  - `applyAutoCalculateIfEnabled` semantics (inlined into `updateCharacter`) → Tasks 12-13.
  - GET `/:id/edit` computes derived → Task 14.
  - GET `/:id/auto-calc-fields` HTMX partial route → Task 15.
  - `views/partials/character-auto-calc-fields.handlebars` → Task 16.
  - Checkbox wiring on edit form, create form untouched → Task 17.
  - Tests for derivation, save-time apply, and route → Tasks 3-13 (plus manual smoke for the route in Tasks 14-17).
  - Edge cases (missing class, deceased character, zero history, level clamp) → Tasks 7-10, 18.

- **Placeholders:** None remain. All code blocks are concrete.

- **Type consistency:**
  - `deriveCharacterTotals` signature: `{ character, realMissions, offscreen Missions, rulesVersion }` used identically in tests, route, and model. ✓
  - `derived` shape: `{ completed_missions, commissary_reward, level }` — same field names everywhere. ✓
  - `auto_calculate` column name matches the DB column, form field name, and JS property. ✓
  - `getCharacterRealMissionsForDerivation` is called with `(id, client)` everywhere and returns `{ data, error }`. ✓
