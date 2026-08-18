# Temporary Unlock Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a class unlock's expiry date inline on the profile's Unlocked Classes table and the class view page, so time-limited access stops lapsing silently.

**Architecture:** A new `getEffectiveClassUnlock(userId, classId)` in `models/class.js` becomes the single place that resolves a user's unlock for a class across its version family and reduces the matching rows to one *effective* expiry (any permanent unlock in the family wins; otherwise the latest date). The existing `isClassUnlocked` is rewritten to delegate to it, and `getUnlockedClasses` attaches the same effective expiry to each class it returns. Two templates then render a tag when that expiry is non-null.

**Tech Stack:** Bun (test runner and server), Express 4, Handlebars (`express-handlebars`), Supabase/Postgres, Bulma CSS classes.

**Spec:** `docs/superpowers/specs/2026-08-18-temporary-unlock-status-design.md`

## Global Constraints

- **Display-only.** No task may change how access is granted, checked, or revoked. `canViewClassPdf`, the teaser redirect, and every access decision must behave exactly as before.
- **Effective expiry rule**, applied identically everywhere: given the user's *active* unlock rows in a class's version family — any row with `expires_at` null → **permanent**, represented as `null`; otherwise the **latest** `expires_at`; no rows → not unlocked.
- **Version families never cross an edition boundary.** Always resolve families through the existing `computeVersionFamily` / `getVersionFamilyIds`; never hand-roll family logic.
- **Degrade, don't fail.** `fetchClassFamilyRows()` returns `null` when the classes projection can't be loaded. Every consumer must fall back to exact-id / own-row behavior, matching the existing pattern at `models/class.js:176-180`.
- **No permanent-unlock badge.** A permanent unlock renders nothing — no "Permanent" tag, no empty-string date.
- Dates render through the existing `date_tz` helper in its **bare** form (`{{date_tz value}}`), which defaults to the `lll` format and the viewer's local timezone (`util/handlebars.js:18-26`). This matches `views/library.handlebars:71`.
- Tag markup is `<span class="tag is-warning is-light">`, matching the expiry tags already used elsewhere in the app.
- Unit tests run with `bun run test:unit`. A single file runs with `bun test <path>`.
- No dead code: when a change makes an import or a code path unused, delete it in the same task.

---

### Task 1: Effective unlock expiry in the class model

Introduces the effective-expiry reducer and `getEffectiveClassUnlock`, and rewires `isClassUnlocked` to use it so the family-and-expiry logic exists in exactly one place.

**Files:**
- Modify: `services/class/repository.js:58-71` (`activeUnlockRows`)
- Modify: `models/class.js:77-96` (`isClassUnlocked`), plus new functions above it and a new export in the `module.exports` block at `models/class.js:420-440`
- Test: `models/class-unlock-expiry.test.js` (create)

**Interfaces:**
- Consumes: `classRepository.activeUnlockRows({ userId, classIds, nowIso })` → `{ data: Array<{ class_id, expires_at }>, error }`; `getVersionFamilyIds(classId)` → `Promise<Set<string>>` (already in `models/class.js:71-75`).
- Produces:
  - `leastRestrictiveExpiry(rows)` → `string | null` — module-local, not exported. `rows` is any array of objects with an `expires_at` property.
  - `getEffectiveClassUnlock(userId, classId)` → `Promise<{ data: { unlocked: boolean, expiresAt: string | null }, error: Error | null }>` — exported from `models/class.js`. Task 4 consumes this.
  - `isClassUnlocked(userId, classId)` → `Promise<{ data: boolean, error }>` — signature unchanged.

**Note on the test file:** the spec named `models/class.test.js`, but that file installs one process-wide `mock.module('./_base', ...)` with fixed anon/admin fixtures at import time, so per-test row fixtures can't be varied there. A dedicated file matches the existing convention — `models/class-unlock-family.test.js` exists for exactly this reason.

- [ ] **Step 1: Write the failing tests**

Create `models/class-unlock-expiry.test.js`:

```js
const { mock, test, expect, afterAll, beforeEach } = require('bun:test');

// Capture real `_base` so the mock doesn't leak into sibling test files
// (same pattern as models/class-unlock-family.test.js).
const realBase = require('./_base');

// Rows the fake client serves, swapped per test. The fake ignores filter
// args, so each test supplies exactly the rows the real query would return
// after its `.eq()` / `.or()` filters ran.
let tableRows = { classes: [], class_unlocks: [] };

const fakeClient = {
    from(table) {
        // `table in tableRows` rather than `??` on purpose: a test sets a
        // table to null to simulate a projection that failed to load, and
        // `??` would silently rewrite that null into an empty array.
        const rows = table in tableRows ? tableRows[table] : [];
        const result = { data: rows, error: null };
        const chain = {
            select() { return chain; },
            eq() { return chain; },
            or() { return chain; },
            limit() { return chain; },
            order() { return chain; },
            in() { return chain; },
            single() {
                const first = Array.isArray(rows) ? (rows[0] ?? null) : null;
                return Promise.resolve({ data: first, error: null });
            },
            then(onFulfilled, onRejected) {
                return Promise.resolve(result).then(onFulfilled, onRejected);
            }
        };
        return chain;
    }
};

mock.module('./_base', () => ({
    supabase: fakeClient,
    supabaseAdmin: fakeClient,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeClient
}));

// Bust the cache in case a sibling test file already loaded `./class`.
delete require.cache[require.resolve('./class')];
const { getEffectiveClassUnlock, isClassUnlocked } = require('./class');

afterAll(() => {
    mock.module('./_base', () => realBase);
});

// Advent Librarian v1 -> v2 fork, plus an aspirant fork that must stay
// outside the family.
const CLASS_ROWS = [
    { id: 'lib-v1', base_class_id: null, rules_edition: 'advent' },
    { id: 'lib-v2', base_class_id: 'lib-v1', rules_edition: 'advent' },
    { id: 'lib-asp', base_class_id: 'lib-v1', rules_edition: 'aspirant' }
];

beforeEach(() => {
    tableRows = { classes: CLASS_ROWS, class_unlocks: [] };
});

test('reports not unlocked when the user holds no active unlock', async () => {
    const { data, error } = await getEffectiveClassUnlock('user-1', 'lib-v1');
    expect(error).toBeNull();
    expect(data).toEqual({ unlocked: false, expiresAt: null });
});

test('reports not unlocked without a userId, without querying', async () => {
    const { data, error } = await getEffectiveClassUnlock(null, 'lib-v1');
    expect(error).toBeNull();
    expect(data).toEqual({ unlocked: false, expiresAt: null });
});

test('a single temporary unlock reports that row\'s expiry', async () => {
    tableRows.class_unlocks = [
        { class_id: 'lib-v1', expires_at: '2026-09-16T00:00:00Z' }
    ];
    const { data } = await getEffectiveClassUnlock('user-1', 'lib-v1');
    expect(data).toEqual({ unlocked: true, expiresAt: '2026-09-16T00:00:00Z' });
});

test('a permanent unlock in the family beats a temporary one', async () => {
    tableRows.class_unlocks = [
        { class_id: 'lib-v2', expires_at: '2026-09-16T00:00:00Z' },
        { class_id: 'lib-v1', expires_at: null }
    ];
    const { data } = await getEffectiveClassUnlock('user-1', 'lib-v2');
    expect(data).toEqual({ unlocked: true, expiresAt: null });
});

test('two temporary unlocks in one family resolve to the later expiry', async () => {
    tableRows.class_unlocks = [
        { class_id: 'lib-v1', expires_at: '2026-09-16T00:00:00Z' },
        { class_id: 'lib-v2', expires_at: '2026-12-01T00:00:00Z' }
    ];
    const { data } = await getEffectiveClassUnlock('user-1', 'lib-v1');
    expect(data).toEqual({ unlocked: true, expiresAt: '2026-12-01T00:00:00Z' });
});

test('the later expiry wins regardless of row order', async () => {
    tableRows.class_unlocks = [
        { class_id: 'lib-v2', expires_at: '2026-12-01T00:00:00Z' },
        { class_id: 'lib-v1', expires_at: '2026-09-16T00:00:00Z' }
    ];
    const { data } = await getEffectiveClassUnlock('user-1', 'lib-v1');
    expect(data.expiresAt).toBe('2026-12-01T00:00:00Z');
});

test('isClassUnlocked still returns a plain boolean', async () => {
    tableRows.class_unlocks = [
        { class_id: 'lib-v1', expires_at: '2026-09-16T00:00:00Z' }
    ];
    const unlocked = await isClassUnlocked('user-1', 'lib-v1');
    expect(unlocked).toEqual({ data: true, error: null });

    tableRows.class_unlocks = [];
    const locked = await isClassUnlocked('user-1', 'lib-v1');
    expect(locked).toEqual({ data: false, error: null });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test models/class-unlock-expiry.test.js`

Expected: FAIL — `getEffectiveClassUnlock is not a function` (it isn't exported yet).

- [ ] **Step 3: Let the repository return every matching row**

In `services/class/repository.js`, `activeUnlockRows` currently ends its chain with `.limit(1)` because its only caller needed a boolean. An effective expiry needs every matching row, and a version family is a handful of rows.

Replace the `activeUnlockRows` body's query (`services/class/repository.js:59-64`):

```js
  activeUnlockRows: async ({ userId, classIds, nowIso }) => {
    const { data, error } = await supabaseAdmin
      .from('class_unlocks')
      .select('class_id, expires_at')
      .eq('user_id', userId)
      .in('class_id', classIds)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
    if (error) {
      console.error(error);
      return { data: null, error };
    }
    return { data, error: null };
  },
```

(The only change is the removed `.limit(1)` line.)

- [ ] **Step 4: Add the reducer and `getEffectiveClassUnlock`, and rewrite `isClassUnlocked`**

In `models/class.js`, replace the whole `isClassUnlocked` function (`models/class.js:77-96`) with the following three definitions:

```js
// An unlock covers a class's whole version family, and the least restrictive
// grant wins: one permanent row makes access permanent, otherwise the latest
// expiry applies. `null` means permanent OR no rows at all -- callers pair
// this with an `unlocked` flag to tell those apart. Dates are compared as
// instants, not strings, because Postgres can hand back either a `Z` or a
// `+00:00` offset and those don't sort lexicographically.
const leastRestrictiveExpiry = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    if (rows.some(row => !row.expires_at)) return null;
    let latest = null;
    for (const row of rows) {
        if (latest === null || Date.parse(row.expires_at) > Date.parse(latest)) {
            latest = row.expires_at;
        }
    }
    return latest;
};

const getEffectiveClassUnlock = async (userId, classId) => {
    const none = { unlocked: false, expiresAt: null };
    if (!userId || !classId) {
        return { data: none, error: null };
    }

    // An unlock for any same-edition version of the class counts.
    const familyIds = await getVersionFamilyIds(classId);

    const now = new Date().toISOString();
    const { data, error } = await classRepository.activeUnlockRows({
        userId,
        classIds: [...familyIds],
        nowIso: now
    });

    // Fail closed: an unreadable unlocks table must not read as access.
    if (error) {
        return { data: none, error };
    }

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
        return { data: none, error: null };
    }
    return {
        data: { unlocked: true, expiresAt: leastRestrictiveExpiry(rows) },
        error: null
    };
};

const isClassUnlocked = async (userId, classId) => {
    const { data, error } = await getEffectiveClassUnlock(userId, classId);
    if (error) {
        return { data: false, error };
    }
    return { data: data.unlocked, error: null };
};
```

Then add `getEffectiveClassUnlock` to `module.exports` in `models/class.js`, on the line directly after `isClassUnlocked,`:

```js
    isClassUnlocked,
    getEffectiveClassUnlock,
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `bun test models/class-unlock-expiry.test.js`

Expected: PASS — 7 tests.

- [ ] **Step 6: Run the unlock regression tests**

`activeUnlockRows` and `isClassUnlocked` both changed, so the existing family tests must stay green.

Run: `bun test models/class-unlock-family.test.js models/class.test.js`

Expected: PASS, no failures. If `class-unlock-family.test.js` fails, the `.limit(1)` removal or the `isClassUnlocked` delegation broke family resolution — fix before continuing, do not adjust the existing tests to match.

- [ ] **Step 7: Run the full unit suite**

Run: `bun run test:unit`

Expected: PASS. `canViewClassPdf` calls `isClassUnlocked`, so any access-check regression surfaces here.

- [ ] **Step 8: Commit**

```bash
git add models/class.js models/class-unlock-expiry.test.js services/class/repository.js
git commit -m "feat: resolve effective class unlock expiry across version families"
```

---

### Task 2: Attach effective expiry to the unlocked-classes list

Makes the profile page's data source carry the expiry it currently discards.

**Files:**
- Modify: `models/class.js:143-153` (`getUnlockedClasses`)
- Test: `models/class-unlock-expiry.test.js` (extend the file created in Task 1)

**Interfaces:**
- Consumes: `leastRestrictiveExpiry(rows)` and the family helpers from Task 1; `classRepository.unlockedClassRows({ userId, nowIso })` → `{ data: Array<{ class: object, expires_at: string | null }>, error }`; `fetchClassFamilyRows()` → `Promise<Array<{ id, base_class_id, rules_edition }> | null>` (`models/class.js:67`); `computeVersionFamily(classes, classId)` → `Set<string>` (already imported at `models/class.js:3`).
- Produces: `getUnlockedClasses(userId)` → `{ data: Array<ClassRow & { unlock_expires_at: string | null }>, error }`. Task 3's template consumes `unlock_expires_at`.

**Note on callers:** `routes/profile.js:22` is the only caller. `routes/classes.js:12` imports `getUnlockedClasses` but never calls it — that dead import is removed in Task 4. The returned objects are supersets of today's, so nothing else can break.

- [ ] **Step 1: Write the failing tests**

Append to `models/class-unlock-expiry.test.js`. Add `getUnlockedClasses` to the existing `require('./class')` destructuring at the top of the file:

```js
const { getEffectiveClassUnlock, isClassUnlocked, getUnlockedClasses } = require('./class');
```

Then append these tests to the end of the file:

```js
// `unlockedClassRows` selects `class:classes(*), expires_at`, so its rows
// carry a nested class object. The fake ignores `.select()`, so a fixture
// row can carry both that nested object and the flat `class_id` the
// family-resolution path reads.
const unlockRow = (classId, name, expiresAt) => ({
    class_id: classId,
    expires_at: expiresAt,
    class: { id: classId, name, status: 'release', rules_edition: 'advent', rules_version: 'v1' }
});

test('a temporary unlock surfaces its expiry on the listed class', async () => {
    tableRows.class_unlocks = [unlockRow('lib-v1', 'Librarian', '2026-09-16T00:00:00Z')];
    const { data } = await getUnlockedClasses('user-1');
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('lib-v1');
    expect(data[0].name).toBe('Librarian');
    expect(data[0].unlock_expires_at).toBe('2026-09-16T00:00:00Z');
});

test('a permanent unlock surfaces a null expiry', async () => {
    tableRows.class_unlocks = [unlockRow('lib-v1', 'Librarian', null)];
    const { data } = await getUnlockedClasses('user-1');
    expect(data[0].unlock_expires_at).toBeNull();
});

test('a permanent unlock elsewhere in the family clears its relatives\' expiry', async () => {
    tableRows.class_unlocks = [
        unlockRow('lib-v1', 'Librarian', null),
        unlockRow('lib-v2', 'Librarian II', '2026-09-16T00:00:00Z')
    ];
    const { data } = await getUnlockedClasses('user-1');
    const v2 = data.find(c => c.id === 'lib-v2');
    expect(v2.unlock_expires_at).toBeNull();
});

test('an unlock in a different edition does not affect the family', async () => {
    // lib-asp is an aspirant fork of lib-v1, so it is a separate family.
    tableRows.class_unlocks = [
        unlockRow('lib-asp', 'Librarian (Aspirant)', null),
        unlockRow('lib-v1', 'Librarian', '2026-09-16T00:00:00Z')
    ];
    const { data } = await getUnlockedClasses('user-1');
    const v1 = data.find(c => c.id === 'lib-v1');
    expect(v1.unlock_expires_at).toBe('2026-09-16T00:00:00Z');
});

test('the later expiry wins across a family', async () => {
    tableRows.class_unlocks = [
        unlockRow('lib-v1', 'Librarian', '2026-09-16T00:00:00Z'),
        unlockRow('lib-v2', 'Librarian II', '2026-12-01T00:00:00Z')
    ];
    const { data } = await getUnlockedClasses('user-1');
    expect(data.find(c => c.id === 'lib-v1').unlock_expires_at).toBe('2026-12-01T00:00:00Z');
    expect(data.find(c => c.id === 'lib-v2').unlock_expires_at).toBe('2026-12-01T00:00:00Z');
});

test('degrades to the row\'s own expiry when the class projection is unavailable', async () => {
    // `fetchClassFamilyRows` returns null when the classes projection can't
    // be read (`services/class/repository.js:43-57` bails on a non-array),
    // so a null `classes` table is what that failure looks like here. Each
    // row must fall back to its own expiry rather than losing it.
    tableRows.classes = null;
    tableRows.class_unlocks = [
        unlockRow('lib-v1', 'Librarian', '2026-09-16T00:00:00Z'),
        unlockRow('lib-v2', 'Librarian II', null)
    ];
    const { data } = await getUnlockedClasses('user-1');
    // Without the projection there is no family, so v2's permanent unlock
    // must NOT clear v1's expiry.
    expect(data.find(c => c.id === 'lib-v1').unlock_expires_at).toBe('2026-09-16T00:00:00Z');
    expect(data.find(c => c.id === 'lib-v2').unlock_expires_at).toBeNull();
});

test('returns an empty list when the user has no active unlocks', async () => {
    tableRows.class_unlocks = [];
    const { data } = await getUnlockedClasses('user-1');
    expect(data).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test models/class-unlock-expiry.test.js`

Expected: FAIL — the new tests report `undefined` for `unlock_expires_at`, because `getUnlockedClasses` still drops `expires_at`. The 7 tests from Task 1 still pass.

- [ ] **Step 3: Implement the expiry attachment**

In `models/class.js`, replace the whole `getUnlockedClasses` function (`models/class.js:143-153`) with:

```js
const getUnlockedClasses = async (userId) => {
    const now = new Date().toISOString();
    const { data, error } = await classRepository.unlockedClassRows({ userId, nowIso: now });

    if (error) {
        return { data: null, error };
    }

    const rows = (data || []).filter(entry => entry && entry.class && entry.class.id);

    // Expiry is a family-wide property: a permanent v1 unlock must stop v2
    // from advertising an expiry it doesn't really have. One projection load
    // serves every row; degrade to each row's own expiry if it can't load.
    const familyRows = await fetchClassFamilyRows();

    return {
        data: rows.map((entry) => {
            if (!familyRows) {
                return { ...entry.class, unlock_expires_at: entry.expires_at ?? null };
            }
            const family = computeVersionFamily(familyRows, entry.class.id);
            const familyUnlocks = rows.filter(other => family.has(other.class.id));
            return { ...entry.class, unlock_expires_at: leastRestrictiveExpiry(familyUnlocks) };
        }),
        error: null
    };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test models/class-unlock-expiry.test.js`

Expected: PASS — 14 tests.

- [ ] **Step 5: Run the full unit suite**

Run: `bun run test:unit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add models/class.js models/class-unlock-expiry.test.js
git commit -m "feat: attach effective unlock expiry to unlocked class list"
```

---

### Task 3: Access column on the profile's Unlocked Classes table

**Files:**
- Modify: `views/profile.handlebars:41-68` (the Unlocked Classes table head and body)
- Test: `views/profile.test.js` (create)

**Interfaces:**
- Consumes: `unlockedClasses[].unlock_expires_at` from Task 2, already supplied by `routes/profile.js:20-24` with no route change needed.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Create `views/profile.test.js`:

```js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const customHelpers = require('../util/handlebars');

const handlebarsHelpers = require('handlebars-helpers')();

// `badge-shelf` pulls in further partials and is irrelevant to the unlocked
// classes table, so it is stubbed out rather than registered for real.
function renderProfile(context) {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('breadcrumbs', fs.readFileSync(
    path.join(__dirname, 'partials', 'breadcrumbs.handlebars'), 'utf8'
  ));
  hb.registerPartial('private-badge', fs.readFileSync(
    path.join(__dirname, 'partials', 'private-badge.handlebars'), 'utf8'
  ));
  hb.registerPartial('badge-shelf', '');
  const src = fs.readFileSync(path.join(__dirname, 'profile.handlebars'), 'utf8');
  return hb.compile(src)(context);
}

const baseContext = {
  profile: { name: 'Alice', is_public: true },
  badges: {}
};

const CLASS_TEMPORARY = {
  id: 'lib-v1',
  name: 'Librarian',
  status: 'release',
  rules_edition: 'advent',
  rules_version: 'v1',
  unlock_expires_at: '2026-09-16T00:00:00Z'
};

const CLASS_PERMANENT = {
  id: 'sen-v1',
  name: 'Sentinel',
  status: 'release',
  rules_edition: 'advent',
  rules_version: 'v1',
  unlock_expires_at: null
};

test('the unlocked classes table has an Access column', () => {
  const html = renderProfile({ ...baseContext, unlockedClasses: [CLASS_PERMANENT] });
  expect(html).toContain('<th>Access</th>');
});

test('a temporary unlock renders an Expires tag', () => {
  const html = renderProfile({ ...baseContext, unlockedClasses: [CLASS_TEMPORARY] });
  expect(html).toContain('Expires');
  expect(html).toContain('tag is-warning is-light');
  // date_tz defaults to the `lll` format in the viewer's local timezone.
  expect(html).toMatch(/Expires\s+Sep 1[56], 2026/);
});

test('a permanent unlock renders no expiry tag', () => {
  const html = renderProfile({ ...baseContext, unlockedClasses: [CLASS_PERMANENT] });
  expect(html).toContain('Sentinel');
  expect(html).not.toContain('Expires');
});

test('a permanent unlock still renders its own row cells', () => {
  const html = renderProfile({ ...baseContext, unlockedClasses: [CLASS_PERMANENT] });
  // Guards against the Access cell being added to <thead> only, which would
  // silently misalign every column after Status.
  const headCells = (html.match(/<th>/g) || []).length;
  const bodyCells = (html.match(/<td>/g) || []).length;
  expect(bodyCells).toBe(headCells);
});
```

Note on the date assertion: `date_tz` renders in the *runner's* local timezone, so a UTC-midnight timestamp can land on Sep 15 or Sep 16 depending on the machine. The regex accepts both rather than pinning `TZ`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/profile.test.js`

Expected: FAIL — no `<th>Access</th>` in the template, and the head/body cell counts differ.

- [ ] **Step 3: Add the Access column to the template**

In `views/profile.handlebars`, add the header cell. Find:

```handlebars
        <tr>
          <th>Name</th>
          <th>Status</th>
          <th>Rules</th>
        </tr>
```

Replace with:

```handlebars
        <tr>
          <th>Name</th>
          <th>Status</th>
          <th>Access</th>
          <th>Rules</th>
        </tr>
```

Then add the matching body cell. Find the closing of the Status cell followed by the Rules cell:

```handlebars
            {{#if (eq this.status 'alpha')}}
              <span class="tag is-danger is-light">alpha</span>
            {{/if}}
          </td>
          <td>{{capitalize this.rules_edition}} {{this.rules_version}}</td>
```

Replace with:

```handlebars
            {{#if (eq this.status 'alpha')}}
              <span class="tag is-danger is-light">alpha</span>
            {{/if}}
          </td>
          <td>
            {{#if this.unlock_expires_at}}
            <span class="tag is-warning is-light">Expires {{date_tz this.unlock_expires_at}}</span>
            {{/if}}
          </td>
          <td>{{capitalize this.rules_edition}} {{this.rules_version}}</td>
```

A permanent unlock leaves the cell empty on purpose: a class appearing in this list already implies access, so a "Permanent" tag would be noise on the common case and would bury the rows that need attention.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test views/profile.test.js`

Expected: PASS — 4 tests.

- [ ] **Step 5: Run the full unit suite**

Run: `bun run test:unit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add views/profile.handlebars views/profile.test.js
git commit -m "feat: show class unlock expiry on the profile page"
```

---

### Task 4: Expiry tag on the class view page

**Files:**
- Modify: `routes/classes.js:7-22` (import list), `routes/classes.js:403-407` (unlock lookup), `routes/classes.js:461-464` (render context)
- Modify: `views/class-view.handlebars:121-135` (the Class PDF block)
- Test: `views/class-view.test.js` (extend)

**Interfaces:**
- Consumes: `getEffectiveClassUnlock(userId, classId)` → `Promise<{ data: { unlocked, expiresAt }, error }>` from Task 1.
- Produces: nothing consumed by later tasks.

**Note on placement:** the tag goes inside the existing `{{#if classPdfAccessible}}` branch, which only renders when `class.pdf_storage_path` is set. A class with no PDF therefore shows no tag on its view page — accepted in the spec, since without a PDF there is no gated artifact for the expiry to qualify, and Task 3's profile list still reports the expiry for every unlocked class.

- [ ] **Step 1: Write the failing tests**

Append to `views/class-view.test.js`. That file already reads the template into `SRC` and asserts against it; these tests compile it instead, so add the compile helper and the tests at the end of the file:

```js
const Handlebars = require('handlebars');
const customHelpers = require('../util/handlebars');
const { renderMarkdown } = require('../util/markdown');
const handlebarsHelpers = require('handlebars-helpers')();

// class-view.handlebars calls `markdown`, which app.js registers separately
// from the util/handlebars bundle (app.js:62) -- without it Handlebars
// throws "Missing helper: markdown" and every test here fails for the wrong
// reason.
function renderClassView(context) {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('markdown', renderMarkdown);
  hb.registerPartial('breadcrumbs', '');
  hb.registerPartial('private-badge', '');
  return hb.compile(SRC)(context);
}

const pdfContext = (overrides) => ({
  profile: { name: 'Alice' },
  class: {
    id: 'lib-v1',
    name: 'Librarian',
    description: 'A class.',
    status: 'release',
    is_public: true,
    rules_edition: 'advent',
    rules_version: 'v1',
    pdf_storage_path: 'classes/lib-v1.pdf'
  },
  unlocked: true,
  classPdfAccessible: true,
  ...overrides
});

test('an expiring unlock renders an Access expires tag by the PDF button', () => {
  const html = renderClassView(pdfContext({ unlockExpiresAt: '2026-09-16T00:00:00Z' }));
  expect(html).toContain('Access expires');
  expect(html).toMatch(/Access expires\s+Sep 1[56], 2026/);
});

test('a permanent unlock renders no expiry tag', () => {
  const html = renderClassView(pdfContext({ unlockExpiresAt: null }));
  expect(html).toContain('Open Class PDF');
  expect(html).not.toContain('Access expires');
});

test('an inaccessible PDF renders no expiry tag', () => {
  const html = renderClassView(pdfContext({
    classPdfAccessible: false,
    unlockExpiresAt: '2026-09-16T00:00:00Z'
  }));
  expect(html).not.toContain('Access expires');
  expect(html).toContain('Unlock this class to gain access to the PDF.');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/class-view.test.js`

Expected: FAIL — "Access expires" appears nowhere in the template. The file's existing tests still pass.

- [ ] **Step 3: Add the tag to the template**

In `views/class-view.handlebars`, find the accessible branch of the Class PDF block:

```handlebars
          {{#if classPdfAccessible}}
          <a class="button is-link is-fullwidth" href="/classes/{{class.id}}/pdf">
            <span class="icon">
              <i class="fas fa-file-pdf"></i>
            </span>
            <span>Open Class PDF</span>
          </a>
          {{else}}
```

Replace with:

```handlebars
          {{#if classPdfAccessible}}
          <a class="button is-link is-fullwidth" href="/classes/{{class.id}}/pdf">
            <span class="icon">
              <i class="fas fa-file-pdf"></i>
            </span>
            <span>Open Class PDF</span>
          </a>
          {{#if unlockExpiresAt}}
          <p class="mt-2 has-text-centered">
            <span class="tag is-warning is-light">Access expires {{date_tz unlockExpiresAt}}</span>
          </p>
          {{/if}}
          {{else}}
```

- [ ] **Step 4: Run the view tests to verify they pass**

Run: `bun test views/class-view.test.js`

Expected: PASS — the three new tests plus every pre-existing test in the file.

- [ ] **Step 5: Supply `unlockExpiresAt` from the route**

In `routes/classes.js`, replace the unlock lookup (`routes/classes.js:403-407`):

```js
    let unlocked = false;
    if (profile) {
        const result = await isClassUnlocked(profile.user_id, id);
        unlocked = result?.data || false;
    }
```

with:

```js
    let unlocked = false;
    let unlockExpiresAt = null;
    if (profile) {
        const { data: access } = await getEffectiveClassUnlock(profile.user_id, id);
        unlocked = access?.unlocked || false;
        unlockExpiresAt = access?.expiresAt || null;
    }
```

Then add `unlockExpiresAt` to the render context. Find (`routes/classes.js:461-464`):

```js
        unlocked,
        ownerProfile,
        classPdfAccessible,
        classPdfError,
```

Replace with:

```js
        unlocked,
        unlockExpiresAt,
        ownerProfile,
        classPdfAccessible,
        classPdfError,
```

- [ ] **Step 6: Remove the now-dead imports**

That was the only `isClassUnlocked` call in `routes/classes.js`, and `getUnlockedClasses` was already imported without ever being called. Delete both lines from the `require('../models/class')` destructuring at `routes/classes.js:7-22`, and add the new import.

Delete these two lines:

```js
    getUnlockedClasses,
```

```js
    isClassUnlocked,
```

And add, directly after `duplicateClass,`:

```js
    getEffectiveClassUnlock,
```

Verify no stragglers remain — this must print nothing:

```bash
grep -n "isClassUnlocked\|getUnlockedClasses" routes/classes.js
```

- [ ] **Step 7: Run the full unit suite**

Run: `bun run test:unit`

Expected: PASS.

- [ ] **Step 8: Run the project check**

Run: `bun run check`

Expected: PASS — catches lint/syntax problems the unit tests miss.

- [ ] **Step 9: Commit**

```bash
git add routes/classes.js views/class-view.handlebars views/class-view.test.js
git commit -m "feat: show unlock expiry on the class view page"
```

---

### Task 5: End-to-end verification

Confirms the feature works in the running app, not just in unit tests — the model, route, and template changes have never been exercised together.

**Files:**
- No production files. This task only runs and observes.

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: nothing.

- [ ] **Step 1: Run the existing e2e suite**

Run: `bun run test:e2e`

Expected: PASS. `e2e/specs/07-unlock-code-modal.spec.js` and `e2e/specs/24-onboarding.spec.js` both exercise unlock paths.

If the suite cannot run in this environment (no local Supabase, missing browsers), record that plainly in the task report rather than claiming it passed, and continue to Step 2.

- [ ] **Step 2: Verify in the running app**

Use the `run` skill to launch the app. Sign in as a user holding a starter (30-day) unlock and confirm:

1. `/profile` — the Unlocked Classes table shows an **Access** column, with an amber `Expires <date>` tag on starter-granted classes and an empty cell on permanently unlocked ones. Columns line up with their headers.
2. `/classes/<id>/<name>` for a starter-unlocked class that has a PDF — an `Access expires <date>` tag sits directly under the Open Class PDF button.
3. A class whose unlock is permanent shows the PDF button with no tag.

If no seeded user has a temporary unlock, grant one directly against the local database rather than changing application code:

```sql
update class_unlocks set expires_at = now() + interval '12 days'
where user_id = '<user-uuid>' and class_id = '<class-uuid>';
```

- [ ] **Step 3: Report**

Report what was observed at each surface, including anything that did not match. Do not commit — this task changes no files.

---

## Verification Summary

The feature is complete when all of the following hold:

- `bun run test:unit` passes.
- `bun run check` passes.
- `grep -n "isClassUnlocked\|getUnlockedClasses" routes/classes.js` prints nothing.
- The profile page shows an expiry tag for temporary class unlocks and nothing for permanent ones.
- The class view page shows an expiry tag under the Open Class PDF button for temporary unlocks.
- No access decision changed: a user who could open a PDF before can still open it, and a user who could not still cannot.
