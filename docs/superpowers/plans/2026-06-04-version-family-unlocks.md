# Version-Family Unlocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A class unlock applies to the class's whole same-edition version family (v1↔v2 via `base_class_id`), but never across editions.

**Architecture:** Pure family-resolution functions in `util/class-family.js` (no DB), fed by a small classes query in `models/class.js`. `isClassUnlocked` and `getUnlockedClassIdsForUser` become family-aware, which transparently upgrades class-view gating, PDF access, and agent access. The character-form dropdown filter (`filterClassDataForUser`) switches from name-matching to the family-expanded id set, closing the cross-edition name leak.

**Tech Stack:** Bun (runtime + `bun test`), Express, Supabase JS client. Tests mock `models/_base` via `mock.module` (see `models/class.test.js` for the established pattern).

**Spec:** `docs/superpowers/specs/2026-06-04-version-family-unlocks-design.md`

**Conventions:**
- Run tests with `bun test <file>` (or `bun test` for the whole suite).
- Model reads that must not be RLS-filtered go through `supabaseAdmin` (see comment style in `models/class.js:93-112`).
- Pure derived-logic lives in `util/` with sibling `.test.js` (see `util/character-derived.js`).

---

### Task 1: Pure `computeVersionFamily`

**Files:**
- Create: `util/class-family.js`
- Test: `util/class-family.test.js`

- [ ] **Step 1: Write the failing tests**

Create `util/class-family.test.js`:

```js
const { test, expect, describe } = require('bun:test');
const { computeVersionFamily } = require('./class-family');

// Minimal class row shape used by the family resolver.
const cls = (id, base = null, edition = 'advent') => ({
    id,
    base_class_id: base,
    rules_edition: edition
});

describe('computeVersionFamily', () => {
    test('v1 and its same-edition v2 fork form one family (walk down)', () => {
        const classes = [cls('v1'), cls('v2', 'v1')];
        expect(computeVersionFamily(classes, 'v1')).toEqual(new Set(['v1', 'v2']));
    });

    test('v2 fork reaches its v1 base (walk up)', () => {
        const classes = [cls('v1'), cls('v2', 'v1')];
        expect(computeVersionFamily(classes, 'v2')).toEqual(new Set(['v1', 'v2']));
    });

    test('deep chains are fully connected: v1 -> v2 -> v3', () => {
        const classes = [cls('v1'), cls('v2', 'v1'), cls('v3', 'v2')];
        expect(computeVersionFamily(classes, 'v3')).toEqual(new Set(['v1', 'v2', 'v3']));
        expect(computeVersionFamily(classes, 'v1')).toEqual(new Set(['v1', 'v2', 'v3']));
    });

    test('edition forks are excluded: advent family does not include aspirant fork', () => {
        const classes = [
            cls('adv-v1'),
            cls('adv-v2', 'adv-v1'),
            cls('asp-v1', 'adv-v1', 'aspirant')
        ];
        expect(computeVersionFamily(classes, 'adv-v1')).toEqual(new Set(['adv-v1', 'adv-v2']));
    });

    test('aspirant sub-family is its own component (chain stops at the edition change)', () => {
        const classes = [
            cls('adv-v1'),
            cls('asp-v1', 'adv-v1', 'aspirant'),
            cls('asp-v2', 'asp-v1', 'aspirant')
        ];
        expect(computeVersionFamily(classes, 'asp-v1')).toEqual(new Set(['asp-v1', 'asp-v2']));
        expect(computeVersionFamily(classes, 'asp-v2')).toEqual(new Set(['asp-v1', 'asp-v2']));
        // And from the advent side, neither aspirant class joins.
        expect(computeVersionFamily(classes, 'adv-v1')).toEqual(new Set(['adv-v1']));
    });

    test('cycle in base_class_id links terminates', () => {
        const classes = [cls('a', 'b'), cls('b', 'a')];
        expect(computeVersionFamily(classes, 'a')).toEqual(new Set(['a', 'b']));
    });

    test('unknown class id yields a singleton family', () => {
        expect(computeVersionFamily([cls('v1')], 'nope')).toEqual(new Set(['nope']));
    });

    test('class with no links yields a singleton family', () => {
        const classes = [cls('solo'), cls('other')];
        expect(computeVersionFamily(classes, 'solo')).toEqual(new Set(['solo']));
    });

    test('base pointing at a missing class is ignored', () => {
        const classes = [cls('v2', 'deleted-id')];
        expect(computeVersionFamily(classes, 'v2')).toEqual(new Set(['v2']));
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test util/class-family.test.js`
Expected: FAIL — `Cannot find module './class-family'`

- [ ] **Step 3: Write the implementation**

Create `util/class-family.js`:

```js
// Version families: classes linked via base_class_id form an upgrade chain
// (v1 -> v2 forks). A family is the connected component over those links,
// restricted to edges where parent and child share rules_edition — edition
// forks (e.g. advent -> aspirant) start a new family. Unlocks apply to a
// whole family, so this must never cross an edition boundary.

const sameEditionEdge = (parent, child) => parent.rules_edition === child.rules_edition;

// classes: array of { id, base_class_id, rules_edition }
// Returns Set of class ids in classId's version family (always includes classId).
const computeVersionFamily = (classes, classId) => {
    const rows = Array.isArray(classes) ? classes.filter(c => c && c.id) : [];
    const byId = new Map(rows.map(c => [c.id, c]));

    // Pre-index same-edition children so the BFS can walk down chains.
    const childrenOf = new Map();
    for (const c of rows) {
        if (!c.base_class_id) continue;
        const parent = byId.get(c.base_class_id);
        if (!parent || !sameEditionEdge(parent, c)) continue;
        if (!childrenOf.has(parent.id)) childrenOf.set(parent.id, []);
        childrenOf.get(parent.id).push(c.id);
    }

    const family = new Set();
    const queue = [classId];
    while (queue.length > 0) {
        const id = queue.shift();
        if (family.has(id)) continue; // visited guard also terminates cycles
        family.add(id);
        const node = byId.get(id);
        if (!node) continue;
        if (node.base_class_id) {
            const parent = byId.get(node.base_class_id);
            if (parent && sameEditionEdge(parent, node)) queue.push(parent.id);
        }
        for (const childId of childrenOf.get(id) || []) queue.push(childId);
    }
    return family;
};

module.exports = { computeVersionFamily };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test util/class-family.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add util/class-family.js util/class-family.test.js
git commit -m "feat: pure version-family resolver for class unlock propagation"
```

---

### Task 2: Pure `expandIdsToFamilies`

**Files:**
- Modify: `util/class-family.js`
- Test: `util/class-family.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `util/class-family.test.js` (and add `expandIdsToFamilies` to the require at the top):

```js
const { computeVersionFamily, expandIdsToFamilies } = require('./class-family');
```

```js
describe('expandIdsToFamilies', () => {
    test('expands each unlocked id to its whole family', () => {
        const classes = [
            cls('lib-v1'), cls('lib-v2', 'lib-v1'),
            cls('gun-v1'), cls('gun-v2', 'gun-v1'),
            cls('thane-v1')
        ];
        const expanded = expandIdsToFamilies(classes, new Set(['lib-v1', 'thane-v1']));
        expect(expanded).toEqual(new Set(['lib-v1', 'lib-v2', 'thane-v1']));
    });

    test('does not cross editions when expanding', () => {
        const classes = [
            cls('adv-v1'),
            cls('adv-v2', 'adv-v1'),
            cls('asp-v1', 'adv-v1', 'aspirant')
        ];
        const expanded = expandIdsToFamilies(classes, new Set(['adv-v1']));
        expect(expanded).toEqual(new Set(['adv-v1', 'adv-v2']));
    });

    test('empty input set stays empty', () => {
        expect(expandIdsToFamilies([cls('a')], new Set())).toEqual(new Set());
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test util/class-family.test.js`
Expected: FAIL — `expandIdsToFamilies is not a function`

- [ ] **Step 3: Write the implementation**

Append to `util/class-family.js` (before `module.exports`) and export it:

```js
// Expand a set of unlocked class ids to include every member of each id's
// version family.
const expandIdsToFamilies = (classes, ids) => {
    const expanded = new Set();
    for (const id of ids) {
        for (const member of computeVersionFamily(classes, id)) {
            expanded.add(member);
        }
    }
    return expanded;
};

module.exports = { computeVersionFamily, expandIdsToFamilies };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test util/class-family.test.js`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add util/class-family.js util/class-family.test.js
git commit -m "feat: expand unlocked class id sets to version families"
```

---

### Task 3: Family-aware `isClassUnlocked`

**Files:**
- Modify: `models/class.js` (`isClassUnlocked`, currently lines 93-112; add helpers above it)
- Modify: `models/class.test.js` (add `in()` to the fake chain)
- Create: `models/class-unlock-family.test.js`

- [ ] **Step 1: Write the failing test**

Create `models/class-unlock-family.test.js`:

```js
const { mock, test, expect, afterAll } = require('bun:test');

// Capture real `_base` so we can restore it and not leak the mock into
// sibling test files (same pattern as class.test.js).
const realBase = require('./_base');

// Like class.test.js's makeClient, but records `.in()` calls so tests can
// assert which ids the unlock query was given.
const makeRecordingClient = (tableToRows, inCalls) => ({
    from(table) {
        const rows = tableToRows[table] ?? [];
        const result = { data: rows, error: null };
        const chain = {
            select() { return chain; },
            eq() { return chain; },
            or() { return chain; },
            limit() { return chain; },
            order() { return chain; },
            in(column, values) {
                inCalls.push({ table, column, values });
                return chain;
            },
            single() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
            then(onFulfilled, onRejected) {
                return Promise.resolve(result).then(onFulfilled, onRejected);
            }
        };
        return chain;
    }
});

// Advent Librarian v1 + v2 fork, plus an aspirant edition fork that must
// stay outside the family.
const classRows = [
    { id: 'lib-v1', base_class_id: null, rules_edition: 'advent' },
    { id: 'lib-v2', base_class_id: 'lib-v1', rules_edition: 'advent' },
    { id: 'lib-asp', base_class_id: 'lib-v1', rules_edition: 'aspirant' }
];

const inCalls = [];
const fakeClient = makeRecordingClient({
    classes: classRows,
    class_unlocks: [{ class_id: 'lib-v1', expires_at: null }]
}, inCalls);

mock.module('./_base', () => ({
    supabase: fakeClient,
    supabaseAdmin: fakeClient,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeClient
}));

// Bust the cache in case a sibling test file already loaded `./class`.
delete require.cache[require.resolve('./class')];
const { isClassUnlocked } = require('./class');

afterAll(() => {
    mock.module('./_base', () => realBase);
    delete require.cache[require.resolve('./class')];
});

test('isClassUnlocked checks the whole same-edition version family', async () => {
    inCalls.length = 0;
    // User unlocked lib-v1; checking the v2 fork must count as unlocked.
    const result = await isClassUnlocked('u1', 'lib-v2');
    expect(result).toEqual({ data: true, error: null });

    // The unlock query must cover exactly the same-edition family —
    // not the aspirant edition fork.
    const unlockCall = inCalls.find(c => c.table === 'class_unlocks' && c.column === 'class_id');
    expect(unlockCall).toBeTruthy();
    expect(new Set(unlockCall.values)).toEqual(new Set(['lib-v1', 'lib-v2']));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test models/class-unlock-family.test.js`
Expected: FAIL — `unlockCall` is undefined (current implementation uses `.eq('class_id', ...)`, never `.in()`)

- [ ] **Step 3: Implement family-aware lookup in `models/class.js`**

Add the require at the top of `models/class.js` (alongside the other requires):

```js
const { computeVersionFamily, expandIdsToFamilies } = require('../util/class-family');
```

Add these helpers directly above `isClassUnlocked`:

```js
// Lean projection of all classes for version-family resolution. Admin client
// so private forks don't break chain links. Returns null on any failure so
// callers can degrade to exact-id behavior.
const fetchClassFamilyRows = async () => {
    try {
        const { data, error } = await supabaseAdmin
            .from('classes')
            .select('id, base_class_id, rules_edition');
        if (error || !Array.isArray(data)) {
            if (error) console.error(error);
            return null;
        }
        return data;
    } catch (e) {
        console.error(e);
        return null;
    }
};

// Resolve the same-edition version family of a class (see util/class-family).
// Falls back to a singleton set on error: unlock checks degrade to exact-id.
const getVersionFamilyIds = async (classId) => {
    const rows = await fetchClassFamilyRows();
    if (!rows) return new Set([classId]);
    return computeVersionFamily(rows, classId);
};
```

Replace the body of `isClassUnlocked` (the `.eq('class_id', classId)` query) with a family query:

```js
const isClassUnlocked = async (userId, classId) => {
    if (!userId || !classId) {
        return { data: false, error: null };
    }

    // An unlock for any same-edition version of the class counts.
    const familyIds = await getVersionFamilyIds(classId);

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
        .from('class_unlocks')
        .select('class_id, expires_at')
        .eq('user_id', userId)
        .in('class_id', [...familyIds])
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .limit(1);

    if (error) {
        console.error(error);
        return { data: false, error };
    }
    return { data: Array.isArray(data) && data.length > 0, error: null };
};
```

- [ ] **Step 4: Add `in()` to the fake chain in `models/class.test.js`**

The existing fake client in `models/class.test.js` (`makeClient`, ~line 14) has no `in()` method, and `isClassUnlocked` now calls it. Add one line to the chain object:

```js
        const chain = {
            select() { return chain; },
            eq() { return chain; },
            in() { return chain; },
            or() { return chain; },
            limit() { return chain; },
            order() { return chain; },
```

(That file's `fakeAdmin` has no `classes` table, so `fetchClassFamilyRows` sees `[]`, the family degrades to a singleton, and the existing assertions still hold.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test models/class-unlock-family.test.js models/class.test.js util/class-family.test.js`
Expected: PASS (new test green, existing `class.test.js` tests still green)

- [ ] **Step 6: Commit**

```bash
git add models/class.js models/class.test.js models/class-unlock-family.test.js
git commit -m "feat: isClassUnlocked honors same-edition version families"
```

---

### Task 4: Family-expanded `getUnlockedClassIdsForUser`

**Files:**
- Modify: `models/class.js` (`getUnlockedClassIdsForUser`, currently lines 236-257)
- Test: `models/class-unlock-family.test.js`

- [ ] **Step 1: Write the failing test**

Append to `models/class-unlock-family.test.js` (add `getUnlockedClassIdsForUser` to the existing require of `./class`):

```js
const { isClassUnlocked, getUnlockedClassIdsForUser } = require('./class');
```

```js
test('getUnlockedClassIdsForUser expands direct unlocks to version families', async () => {
    const { data, error } = await getUnlockedClassIdsForUser('u1');
    expect(error).toBeNull();
    expect(data.has('lib-v1')).toBe(true);   // direct unlock
    expect(data.has('lib-v2')).toBe(true);   // same-edition fork included
    expect(data.has('lib-asp')).toBe(false); // edition fork excluded
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test models/class-unlock-family.test.js`
Expected: FAIL — `data.has('lib-v2')` is `false` (current implementation returns only direct ids)

- [ ] **Step 3: Implement the expansion in `models/class.js`**

Replace the return tail of `getUnlockedClassIdsForUser`:

```js
const getUnlockedClassIdsForUser = async (userId) => {
    if (!userId) {
        return { data: new Set(), error: null };
    }

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
        .from('class_unlocks')
        .select('class_id')
        .eq('user_id', userId)
        .or(`expires_at.is.null,expires_at.gt.${now}`);

    if (error) {
        console.error(error);
        return { data: null, error };
    }

    const directIds = new Set((data || []).map((entry) => entry.class_id));
    if (directIds.size === 0) {
        return { data: directIds, error: null };
    }

    // An unlock applies to the whole same-edition version family. Degrade to
    // direct ids if the classes projection can't be loaded.
    const classRows = await fetchClassFamilyRows();
    if (!classRows) {
        return { data: directIds, error: null };
    }
    return { data: expandIdsToFamilies(classRows, directIds), error: null };
};
```

(`getUnlockedClasses` directly above it stays untouched — the profile page keeps listing only directly-granted unlocks.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test models/class-unlock-family.test.js models/class.test.js models/class-agent.test.js`
Expected: PASS — including `class-agent.test.js`, which exercises the agent-access path that consumes this function

- [ ] **Step 5: Commit**

```bash
git add models/class.js models/class-unlock-family.test.js
git commit -m "feat: agent/class unlock id sets expand to version families"
```

---

### Task 5: Pure dropdown filter helper

**Files:**
- Create: `util/class-filter.js`
- Test: `util/class-filter.test.js`

- [ ] **Step 1: Write the failing tests**

Create `util/class-filter.test.js`:

```js
const { test, expect, describe } = require('bun:test');
const { filterClassListsByIds } = require('./class-filter');

const mk = (id, name, edition = 'advent') => ({ id, name, rules_edition: edition });

describe('filterClassListsByIds', () => {
    const lists = {
        advent: [mk('lib-v1', 'Librarian'), mk('lib-v2', 'Librarian'), mk('gun-v1', 'Gunslinger')],
        aspirant: [mk('lib-asp', 'Librarian', 'aspirant')],
        pcc: [mk('pcc-1', 'Homebrew')]
    };

    test('keeps only classes whose id is in the allowed set', () => {
        const out = filterClassListsByIds(lists, new Set(['lib-v1', 'lib-v2']));
        expect(out.advent.map(c => c.id)).toEqual(['lib-v1', 'lib-v2']);
        expect(out.pcc).toEqual([]);
    });

    test('same-name edition fork is NOT admitted by an advent unlock (the old name-leak)', () => {
        const out = filterClassListsByIds(lists, new Set(['lib-v1', 'lib-v2']));
        expect(out.aspirant).toEqual([]); // name-based filtering would have leaked lib-asp
    });

    test('exposes surviving class names for gear/ability map filtering', () => {
        const out = filterClassListsByIds(lists, new Set(['lib-v1', 'pcc-1']));
        expect(out.allowedNames).toEqual(new Set(['Librarian', 'Homebrew']));
    });

    test('empty allowed set filters everything', () => {
        const out = filterClassListsByIds(lists, new Set());
        expect(out.advent).toEqual([]);
        expect(out.aspirant).toEqual([]);
        expect(out.pcc).toEqual([]);
        expect(out.allowedNames).toEqual(new Set());
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test util/class-filter.test.js`
Expected: FAIL — `Cannot find module './class-filter'`

- [ ] **Step 3: Write the implementation**

Create `util/class-filter.js`:

```js
// Filter character-form class option lists down to the user's unlocked set,
// matching by class id (NOT name — edition forks share names, and a v1
// unlock must not leak into another edition's fork).

const filterClassListsByIds = (lists, allowedIds) => {
    const filterArr = arr => (Array.isArray(arr) ? arr.filter(c => allowedIds.has(c.id)) : []);
    const advent = filterArr(lists.advent);
    const aspirant = filterArr(lists.aspirant);
    const pcc = filterArr(lists.pcc);
    // Surviving names drive the gear/ability lookup-map filtering downstream.
    const allowedNames = new Set([...advent, ...aspirant, ...pcc].map(c => c.name));
    return { advent, aspirant, pcc, allowedNames };
};

module.exports = { filterClassListsByIds };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test util/class-filter.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add util/class-filter.js util/class-filter.test.js
git commit -m "feat: id-based class list filter for unlock gating"
```

---

### Task 6: Wire `filterClassDataForUser` to the family rule

**Files:**
- Modify: `routes/characters.js` (imports at line 9 and the unlock-filter block at lines 78-97)

- [ ] **Step 1: Update the imports**

In `routes/characters.js` line 9, drop `getUnlockedClasses` (this was its only use in the file — verify with `grep -n getUnlockedClasses routes/characters.js`) and add the new helper:

```js
const { getUnlockedClassIdsForUser } = require('../models/class');
const { filterClassListsByIds } = require('../util/class-filter');
```

(Keep any other names currently imported from `../models/class` on that line.)

- [ ] **Step 2: Replace the name-based filter block**

In `filterClassDataForUser`, replace the `if (user) { ... }` block (currently lines 78-97):

```js
  // If user provided, reduce to unlocked set. Unlocks match by class id and
  // extend to same-edition version families (a v1 unlock covers its v2 fork)
  // but never across editions — see util/class-family.js.
  if (user) {
    const { data: allowedIds } = await getUnlockedClassIdsForUser(user.id);
    if (allowedIds && allowedIds.size > 0) {
      const filtered = filterClassListsByIds(
        { advent: filteredAdvent, aspirant: filteredAspirant, pcc: filteredPCC },
        allowedIds
      );
      filteredAdvent = filtered.advent;
      filteredAspirant = filtered.aspirant;
      filteredPCC = filtered.pcc;
      const filterMap = m => Object.fromEntries(Object.entries(m).filter(([k]) => filtered.allowedNames.has(k)));
      filteredGear = filterMap(filteredGear);
      filteredAbilities = filterMap(filteredAbilities);
    } else {
      filteredAdvent = [];
      filteredAspirant = [];
      filteredPCC = [];
      filteredGear = {};
      filteredAbilities = {};
    }
  }
```

- [ ] **Step 3: Run the full test suite**

Run: `bun test`
Expected: PASS — no regressions anywhere

- [ ] **Step 4: Smoke-check the app boots**

Run: `timeout 5 bun run index.js; test $? -eq 124 && echo "BOOT OK"`
Expected: server starts and stays up for 5s (`BOOT OK`), no require/reference errors

- [ ] **Step 5: Commit**

```bash
git add routes/characters.js
git commit -m "feat: character-form class dropdown gates by version-family unlock ids

Replaces name-based unlock matching, which leaked cross-edition forks
(edition forks keep the same class name)."
```

---

### Task 7: Final verification

- [ ] **Step 1: Run the entire suite once more**

Run: `bun test`
Expected: all tests pass

- [ ] **Step 2: Verify spec coverage**

Confirm each spec requirement maps to shipped code:
- Pure core → `util/class-family.js` (Tasks 1-2)
- `isClassUnlocked` family-aware → Task 3 (covers class view, PDF via `canViewClassPdf`, self-unlock display)
- `getUnlockedClassIdsForUser` expanded → Task 4 (covers agent access)
- Dropdown id-based + edition leak closed → Tasks 5-6
- `getUnlockedClasses` untouched → confirm with `git diff main -- models/class.js` showing no changes to that function
- Error fallback to direct-id behavior → `fetchClassFamilyRows` null paths (Tasks 3-4)
