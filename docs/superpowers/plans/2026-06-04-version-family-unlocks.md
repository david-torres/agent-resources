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

### Task 7: Family-aware rules PDF unlocks

Rules PDFs version-family by **title**: `rules_pdfs` is `UNIQUE(edition, title)` and the
`edition` column holds the version (v1/v2 of "Enclave: Advent"). An unlock for any
version of a title applies to every version of that title. The starter signup grant
(v1 only) stays unchanged — expansion is computed on read.

**Files:**
- Create: `util/rules-family.js`
- Test: `util/rules-family.test.js`
- Modify: `models/rules.js` (`canViewRulesPdf`, lines 146-180)
- Modify: `routes/library.js` (badge map, lines 66-74)
- Test: `models/rules-unlock-family.test.js`

- [ ] **Step 1: Write the failing tests for the pure helper**

Create `util/rules-family.test.js`:

```js
const { test, expect, describe } = require('bun:test');
const { expandRulesUnlocksByTitle } = require('./rules-family');

const pdf = (id, title, edition) => ({ id, title, edition });

describe('expandRulesUnlocksByTitle', () => {
    const rules = [
        pdf('adv-v1', 'Enclave: Advent', 'v1'),
        pdf('adv-v2', 'Enclave: Advent', 'v2'),
        pdf('other', 'Enclave: Aspirant', 'v1')
    ];

    test('an unlock for one version maps to every version of that title', () => {
        const unlocks = [{ rules_pdf_id: 'adv-v1', expires_at: null, unlocked_at: 't' }];
        const map = expandRulesUnlocksByTitle(rules, unlocks);
        expect(map.get('adv-v1')).toBeTruthy();
        expect(map.get('adv-v2')).toBeTruthy();
        expect(map.has('other')).toBe(false);
    });

    test('does not leak across titles', () => {
        const unlocks = [{ rules_pdf_id: 'other', expires_at: null }];
        const map = expandRulesUnlocksByTitle(rules, unlocks);
        expect(map.has('adv-v1')).toBe(false);
        expect(map.get('other')).toBeTruthy();
    });

    test('prefers a non-expiring unlock over an expiring one', () => {
        const unlocks = [
            { rules_pdf_id: 'adv-v1', expires_at: '2026-07-01T00:00:00Z' },
            { rules_pdf_id: 'adv-v2', expires_at: null }
        ];
        const map = expandRulesUnlocksByTitle(rules, unlocks);
        expect(map.get('adv-v1').expires_at).toBeNull();
    });

    test('otherwise prefers the latest expiry', () => {
        const unlocks = [
            { rules_pdf_id: 'adv-v1', expires_at: '2026-07-01T00:00:00Z' },
            { rules_pdf_id: 'adv-v2', expires_at: '2026-08-01T00:00:00Z' }
        ];
        const map = expandRulesUnlocksByTitle(rules, unlocks);
        expect(map.get('adv-v1').expires_at).toBe('2026-08-01T00:00:00Z');
    });

    test('unlock for a PDF not in the visible list is ignored', () => {
        const unlocks = [{ rules_pdf_id: 'inactive-id', expires_at: null }];
        const map = expandRulesUnlocksByTitle(rules, unlocks);
        expect(map.size).toBe(0);
    });

    test('empty unlocks produce an empty map', () => {
        expect(expandRulesUnlocksByTitle(rules, []).size).toBe(0);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test util/rules-family.test.js`
Expected: FAIL — `Cannot find module './rules-family'`

- [ ] **Step 3: Implement the pure helper**

Create `util/rules-family.js`:

```js
// Rules-PDF version families: versions of the same product share a title
// (rules_pdfs is UNIQUE(edition, title); the edition column holds the
// version). An unlock for any version applies to every version of that
// title — mirrors class version-family unlocks (util/class-family.js).

// rules: array of { id, title } (the rendered PDF list)
// unlocks: array of { rules_pdf_id, expires_at, ... }
// Returns Map of rules_pdf_id -> best unlock covering it (non-expiring
// preferred, else latest expiry).
const expandRulesUnlocksByTitle = (rules, unlocks) => {
    const titleById = new Map(rules.map(r => [r.id, r.title]));

    const better = (a, b) => {
        if (!a) return b;
        if (!a.expires_at) return a;
        if (!b.expires_at) return b;
        return new Date(a.expires_at) >= new Date(b.expires_at) ? a : b;
    };

    const bestByTitle = new Map();
    for (const unlock of unlocks) {
        const title = titleById.get(unlock.rules_pdf_id);
        if (!title) continue; // unlock for a PDF outside the visible list
        bestByTitle.set(title, better(bestByTitle.get(title), unlock));
    }

    const covered = new Map();
    for (const rule of rules) {
        const unlock = bestByTitle.get(rule.title);
        if (unlock) covered.set(rule.id, unlock);
    }
    return covered;
};

module.exports = { expandRulesUnlocksByTitle };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test util/rules-family.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the failing model test**

Create `models/rules-unlock-family.test.js` (same recording-client pattern as
`models/class-unlock-family.test.js`):

```js
const { mock, test, expect, afterAll } = require('bun:test');

const realBase = require('./_base');

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
            maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
            then(onFulfilled, onRejected) {
                return Promise.resolve(result).then(onFulfilled, onRejected);
            }
        };
        return chain;
    }
});

const inCalls = [];
const fakeClient = makeRecordingClient({
    rules_pdfs: [
        { id: 'adv-v1', title: 'Enclave: Advent', edition: 'v1' },
        { id: 'adv-v2', title: 'Enclave: Advent', edition: 'v2' }
    ],
    rules_pdf_unlocks: [{ rules_pdf_id: 'adv-v1', expires_at: null }]
}, inCalls);

mock.module('./_base', () => ({
    supabase: fakeClient,
    supabaseAdmin: fakeClient,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeClient
}));

delete require.cache[require.resolve('./rules')];
const { canViewRulesPdf } = require('./rules');

afterAll(() => {
    mock.module('./_base', () => realBase);
    delete require.cache[require.resolve('./rules')];
});

test('canViewRulesPdf honors unlocks across the title family', async () => {
    inCalls.length = 0;
    // User holds a v1 unlock; viewing the v2 PDF must be allowed.
    const result = await canViewRulesPdf(
        { userId: 'u1', role: null },
        { id: 'adv-v2', title: 'Enclave: Advent', storage_path: 'p.pdf' }
    );
    expect(result).toEqual({ data: true, error: null });

    const unlockCall = inCalls.find(c => c.table === 'rules_pdf_unlocks' && c.column === 'rules_pdf_id');
    expect(unlockCall).toBeTruthy();
    expect(new Set(unlockCall.values)).toEqual(new Set(['adv-v1', 'adv-v2']));
});
```

- [ ] **Step 6: Run the model test to verify it fails**

Run: `bun test models/rules-unlock-family.test.js`
Expected: FAIL — `unlockCall` is undefined (current implementation queries by exact id via `getRulesPdfUnlock`)

- [ ] **Step 7: Implement family-aware `canViewRulesPdf` in `models/rules.js`**

Add above `canViewRulesPdf`:

```js
// Resolve the title family of a rules PDF: every version of the same product
// shares a title (UNIQUE(edition, title); edition holds the version). Admin
// client so the lookup isn't RLS-filtered. Falls back to the exact id on
// failure so access checks degrade to current behavior.
const getRulesPdfFamilyIds = async (rulesPdf) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('rules_pdfs')
            .select('id')
            .eq('title', rulesPdf.title);
        if (error || !Array.isArray(data) || data.length === 0) {
            if (error) console.error(error);
            return [rulesPdf.id];
        }
        return data.map(r => r.id);
    } catch (e) {
        console.error(e);
        return [rulesPdf.id];
    }
};
```

Replace the unlock lookup in `canViewRulesPdf` (everything from the
`getRulesPdfUnlock` call to the end of the function):

```js
    // An unlock for any version of this title counts (see getRulesPdfFamilyIds).
    // Admin read mirrors isClassUnlocked: the shared anon client carries no
    // JWT, so RLS would hide the user's own unlock rows.
    const familyIds = await getRulesPdfFamilyIds(rulesPdf);
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
        .from('rules_pdf_unlocks')
        .select('rules_pdf_id, expires_at')
        .eq('user_id', userId)
        .in('rules_pdf_id', familyIds)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .limit(1);

    if (error) {
        console.error(error);
        return { data: false, error };
    }
    return { data: Array.isArray(data) && data.length > 0, error: null };
};
```

(`getRulesPdfUnlock` stays — the admin manage UI may still need exact-pair reads.)

- [ ] **Step 8: Wire the library badge map in `routes/library.js`**

Add the require near the other requires at the top:

```js
const { expandRulesUnlocksByTitle } = require('../util/rules-family');
```

Replace the `unlocksMap` construction (lines 66-74):

```js
    let unlocksMap = new Map();
    if (user) {
        const { data: unlocks } = await listRulesPdfUnlocksForUser(user.id);
        if (Array.isArray(unlocks)) {
            // Family expansion: an unlock for any version of a title badges
            // every version in the rendered list.
            unlocksMap = expandRulesUnlocksByTitle(rules || [], unlocks);
        }
    }
```

(The downstream `rulesWithAccess` mapping is unchanged — it already reads from `unlocksMap`.)

- [ ] **Step 9: Run the suite**

Run: `bun test`
Expected: PASS — new tests green, no regressions

- [ ] **Step 10: Commit**

```bash
git add util/rules-family.js util/rules-family.test.js models/rules.js models/rules-unlock-family.test.js routes/library.js
git commit -m "feat: rules PDF unlocks apply across title version families

A starter v1 unlock now opens the v2 rules PDF (and badges it in the
library). Family key is title: rules_pdfs is UNIQUE(edition, title) with
edition holding the version."
```

---

### Task 8: Final verification

- [ ] **Step 1: Run the entire suite once more**

Run: `bun test`
Expected: all tests pass

- [ ] **Step 2: Verify spec coverage**

Confirm each spec requirement maps to shipped code:
- Pure core → `util/class-family.js` (Tasks 1-2)
- `isClassUnlocked` family-aware → Task 3 (covers class view, PDF via `canViewClassPdf`, self-unlock display)
- `getUnlockedClassIdsForUser` expanded → Task 4 (covers agent access)
- Dropdown id-based + edition leak closed → Tasks 5-6
- Rules PDF title families (canViewRulesPdf + library badges) → Task 7
- `getUnlockedClasses` untouched → confirm with `git diff main -- models/class.js` showing no changes to that function
- Error fallback to direct-id behavior → `fetchClassFamilyRows` null paths (Tasks 3-4), `getRulesPdfFamilyIds` fallback (Task 7)
