# Rules-PDF Class Unlocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A valid rules-PDF unlock grants the core class roster of that book's ruleset, computed on read.

**Architecture:** A new `rules_edition` column on `rules_pdfs` names each book's ruleset. A pure helper maps rulesets to a hardcoded core roster. `models/class.js` gains one resolver, `getEffectiveClassUnlocks`, that unions direct class unlocks with book-derived ones and family-expands the result; the three existing unlock reads become thin consumers of it, so every downstream caller inherits the behaviour unchanged.

**Tech Stack:** Bun (test runner and runtime), Express 4, Handlebars, Supabase (Postgres + JS client), htmx/Alpine front end.

**Spec:** `docs/superpowers/specs/2026-08-07-rules-pdf-class-unlocks-design.md`

## Global Constraints

- Branch is `rules-pdf-class-unlocks`, stacked on `virtual-party-tool`. Do not rebase or merge onto `main`.
- Run all commands from the worktree root: `/home/dave/code/agent-resources/.claude/worktrees/rules-pdf-class-unlocks`.
- Unit tests: `bun run test:unit`. Single file: `bun test <path>`. Syntax check: `bun run check`.
- Test files live beside their subject as `<name>.test.js` and use `require('bun:test')` — no separate `tests/` tree.
- Repository modules (`services/*/repository.js`) are the ONLY consumers of `supabaseAdmin` for their domain. Never add a `supabaseAdmin` call to a model or route.
- Unlock reads must use the admin client: the shared anon client carries no JWT, so RLS hides the user's own unlock rows.
- Every DB read degrades rather than throws — log the error and return a safe fallback. Never throw into the request path.
- Ruleset values are exactly `'advent'` and `'aspirant'`. Version values are exactly `'v1'` and `'v2'`.
- `rules_pdfs.edition` holds the **version** (e.g. `'v1'`), not the ruleset. The new `rules_pdfs.rules_edition` holds the ruleset. Do not conflate them.
- No dead code: when this plan says delete something, delete it — no commented-out blocks, no fallbacks kept "just in case".
- Commit at the end of every task, using the message given in that task's final step.

---

### Task 1: Add `rules_edition` to `rules_pdfs`

**Files:**
- Create: `supabase/migrations/20260807000000_rules_pdfs_rules_edition.sql`
- Modify: `util/seed-rules-pdfs.js:49-58` (the `buildHardcodedRulesPdfs` row)
- Test: `util/seed-rules-pdfs.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `rules_pdfs.rules_edition` column, values `'advent' | 'aspirant'`, NOT NULL, DEFAULT `'advent'`. The seeded "Enclave: Advent" row carries `rules_edition: 'advent'` explicitly.

- [ ] **Step 1: Write the failing test**

Add to the end of `util/seed-rules-pdfs.test.js`:

```js
// rules_pdfs.rules_edition is the ruleset ('advent'|'aspirant'); the older
// `edition` column holds the VERSION ('v1'). Book-derived class unlocks read
// rules_edition, so a seeded book with the wrong value silently grants the
// wrong roster.
test('the seeded starter rules PDF declares its ruleset explicitly', () => {
  const row = buildHardcodedRulesPdfs().find(r => r.id === STARTER_RULES_PDF_ID);

  expect(row.rules_edition).toBe('advent');
  expect(row.edition).toBe('v1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test util/seed-rules-pdfs.test.js`
Expected: FAIL — `expect(received).toBe(expected)` with `received: undefined` for `rules_edition`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260807000000_rules_pdfs_rules_edition.sql`:

```sql
-- rules_pdfs.edition holds the VERSION ('v1', 'v2'); the ruleset a book
-- covers lived only inside its title string. Book-derived class unlocks need
-- the ruleset as data, so name it in its own column.
ALTER TABLE rules_pdfs
    ADD COLUMN IF NOT EXISTS rules_edition text NOT NULL
        CHECK (rules_edition IN ('advent', 'aspirant'))
        DEFAULT 'advent';

-- Backfill from the title for rows created before the column existed. The
-- DEFAULT already covers them as 'advent'; this only corrects Aspirant books.
UPDATE rules_pdfs
SET rules_edition = 'aspirant'
WHERE title ILIKE '%aspirant%';
```

- [ ] **Step 4: Add the column to the seeded row**

In `util/seed-rules-pdfs.js`, in `buildHardcodedRulesPdfs`, add `rules_edition` to the single row:

```js
const buildHardcodedRulesPdfs = () => [
    {
        id: STARTER_RULES_PDF_ID,
        title: 'Enclave: Advent',
        edition: 'v1',
        rules_edition: 'advent',
        storage_path: `${STARTER_RULES_PDF_ID}/local-seed-placeholder.pdf`,
        is_active: true
    }
];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test util/seed-rules-pdfs.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Apply the migration locally**

Run: `supabase db reset`
Expected: completes without error, applying every migration including the new one.

If local Supabase is not running (`supabase start` first), and you cannot start it, skip this step and note in the commit body that the migration is unapplied locally. Do NOT edit the migration to work around a missing local database.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260807000000_rules_pdfs_rules_edition.sql util/seed-rules-pdfs.js util/seed-rules-pdfs.test.js
git commit -m "feat: add rules_edition to rules_pdfs"
```

---

### Task 2: Core class roster constant and pure resolver

**Files:**
- Modify: `util/starter-content.js` (whole file)
- Create: `util/book-classes.js`
- Create: `util/book-classes.test.js`
- Modify: `models/profile.js:1-12` (imports and constants), `:85-124` (`grantStarterUnlocks`)
- Create: `models/profile-starter-unlocks.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `util/starter-content.js` exports `STARTER_RULES_PDF_ID` (unchanged string) and `CORE_CLASS_UNLOCKS` — an object keyed by ruleset (`advent`, `aspirant`), each value a `{ [className]: uuid }` map. `STARTER_CLASS_UNLOCKS` is **removed**.
  - `util/book-classes.js` exports `coreClassIdsForEditions(editions)` → `Set<string>`, where `editions` is any iterable of ruleset strings.
  - `models/profile.js` exports `grantStarterUnlocks(userId, profileId)`, which now calls only `grant_starter_rules_unlock`. `STARTER_CLASS_IDS` is **removed**.

**Why the starter grant changes here:** `models/profile.js:10` evaluates
`Object.values(STARTER_CLASS_UNLOCKS)` at module scope, and `util/auth.js`
imports `models/profile.js`, so nearly every route test loads it. Removing the
constant without updating its consumer in the same commit makes the module
throw on import and turns the suite red for several tasks. The constant and
its only consumer move together.

Between this task and Task 5, a new signup receives the starter book but no
derived classes. That gap is intentional and closes in Task 5; no test asserts
against it.

- [ ] **Step 1: Write the failing test**

Create `util/book-classes.test.js`:

```js
const { test, expect, describe } = require('bun:test');
const { coreClassIdsForEditions } = require('./book-classes');
const { CORE_CLASS_UNLOCKS } = require('./starter-content');

const adventIds = Object.values(CORE_CLASS_UNLOCKS.advent);
const aspirantIds = Object.values(CORE_CLASS_UNLOCKS.aspirant);

describe('coreClassIdsForEditions', () => {
  test('no editions yields no ids', () => {
    expect(coreClassIdsForEditions([])).toEqual(new Set());
  });

  test('advent yields exactly the advent core roster', () => {
    expect(coreClassIdsForEditions(['advent'])).toEqual(new Set(adventIds));
  });

  test('aspirant yields exactly the aspirant core roster', () => {
    expect(coreClassIdsForEditions(['aspirant'])).toEqual(new Set(aspirantIds));
  });

  test('both editions union their rosters', () => {
    expect(coreClassIdsForEditions(['advent', 'aspirant']))
      .toEqual(new Set([...adventIds, ...aspirantIds]));
  });

  test('an unknown ruleset contributes nothing rather than throwing', () => {
    expect(coreClassIdsForEditions(['zeitgeist'])).toEqual(new Set());
    expect(coreClassIdsForEditions(['advent', 'zeitgeist'])).toEqual(new Set(adventIds));
  });

  test('a repeated ruleset does not duplicate ids', () => {
    expect(coreClassIdsForEditions(['advent', 'advent'])).toEqual(new Set(adventIds));
  });

  test('a Set is accepted as well as an array', () => {
    expect(coreClassIdsForEditions(new Set(['advent']))).toEqual(new Set(adventIds));
  });

  test('null or undefined input yields no ids', () => {
    expect(coreClassIdsForEditions(null)).toEqual(new Set());
    expect(coreClassIdsForEditions(undefined)).toEqual(new Set());
  });
});

describe('CORE_CLASS_UNLOCKS', () => {
  test('each ruleset has six classes and no id is shared across rulesets', () => {
    expect(adventIds.length).toBe(6);
    expect(aspirantIds.length).toBe(6);
    expect(new Set([...adventIds, ...aspirantIds]).size).toBe(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test util/book-classes.test.js`
Expected: FAIL — `Cannot find module './book-classes'`.

- [ ] **Step 3: Rewrite the roster constant**

Replace the whole of `util/starter-content.js` with:

```js
// Core class rosters and starter content (see models/profile.js and
// models/class.js).
//
// This module is the single source of truth for these ids: the id assigned
// to a class row in util/seed-classes.js must be exactly the id the core
// roster references, or a book grant resolves to classes that do not exist.

const STARTER_RULES_PDF_ID = 'a10948ac-5f78-481f-9e53-c582b59926cd'; // Enclave: Advent v1

// ruleset -> class name -> id. Holding a rules PDF for a ruleset grants that
// ruleset's roster (util/book-classes.js). New profiles receive the Advent
// book, so the advent roster is also what a new account starts with.
const CORE_CLASS_UNLOCKS = {
  advent: {
    Gunslinger:  'b6ce893b-8207-4f89-abfc-a02ae0e9b65d',
    Illusionist: '018fcdba-39cf-4cc8-8f4d-92e2023719cf',
    Librarian:   'f0de4397-5e71-4ed6-a16a-26dc72c46801',
    Thane:       'aa0f9690-37a6-4784-9119-1b2117f798a7',
    Thunderbird: 'a605940b-f27f-45d8-af76-abda848b3e12',
    Wanderer:    'ebd55f52-9768-400a-94d6-392cd07e2b24',
  },
  aspirant: {
    Berserker:   '3c8f036f-06f0-4f72-9336-aa9c3fdd5541',
    Freerunner:  '42d39b55-7db1-49a1-a53b-b1cd5fc9bc47',
    Infiltrator: 'c687840c-a781-4d46-9570-b344e1b9be04',
    Samaritan:   'f0726c9b-bfaf-4c22-9318-75c50c8e3cbf',
    Vessel:      '3a863d9c-8454-4326-87ad-ed105fccbbd4',
    Witchhunter: '79721ac8-378e-4b3e-b1e3-8266689da89e',
  },
};

module.exports = { STARTER_RULES_PDF_ID, CORE_CLASS_UNLOCKS };
```

- [ ] **Step 4: Write the pure resolver**

Create `util/book-classes.js`:

```js
// Book-derived class unlocks: holding a rules PDF grants the core class
// roster of that book's ruleset. Pure — the DB lookup that produces the
// ruleset list lives in services/rules/repository.js.

const { CORE_CLASS_UNLOCKS } = require('./starter-content');

// editions: iterable of ruleset strings ('advent' | 'aspirant').
// Returns Set of class ids granted by holding books in those rulesets.
// Unknown rulesets contribute nothing.
const coreClassIdsForEditions = (editions) => {
  const ids = new Set();
  for (const edition of editions || []) {
    const roster = CORE_CLASS_UNLOCKS[edition];
    if (!roster) continue;
    for (const id of Object.values(roster)) ids.add(id);
  }
  return ids;
};

module.exports = { coreClassIdsForEditions };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test util/book-classes.test.js`
Expected: PASS (9 tests)

- [ ] **Step 6: Write the failing starter-grant test**

Create `models/profile-starter-unlocks.test.js`:

```js
const { mock, test, expect, afterAll } = require('bun:test');

const realBase = require('./_base');

const rpcCalls = [];

const makeClient = () => ({
  from() {
    const chain = {
      select() { return chain; },
      insert() { return chain; },
      update() { return chain; },
      eq() { return chain; },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(onFulfilled, onRejected) {
        return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
      }
    };
    return chain;
  },
  rpc(name, args) {
    rpcCalls.push({ name, args });
    return Promise.resolve({ data: null, error: null });
  }
});

mock.module('./_base', () => ({
  supabase: makeClient(),
  supabaseAdmin: makeClient(),
  anonKey: 'test-anon-key',
  createUserClient: () => makeClient()
}));

delete require.cache[require.resolve('./profile')];
const { grantStarterUnlocks } = require('./profile');

afterAll(() => {
  mock.module('./_base', () => realBase);
  delete require.cache[require.resolve('./profile')];
});

// The starter class rows were the same six the Advent book grants on read
// (util/book-classes.js, wired up in the effective-unlocks resolver). Writing
// them too would leave orphan unlocks when the trial book lapses.
test('the starter grant writes only the rules PDF unlock', async () => {
  rpcCalls.length = 0;
  await grantStarterUnlocks('user-1', 'profile-1');

  const names = rpcCalls.map(call => call.name);
  expect(names).toContain('grant_starter_rules_unlock');
  expect(names).not.toContain('grant_starter_class_unlocks');
});

test('the starter rules grant carries a future expiry', async () => {
  rpcCalls.length = 0;
  await grantStarterUnlocks('user-1', 'profile-1');

  const call = rpcCalls.find(c => c.name === 'grant_starter_rules_unlock');
  expect(new Date(call.args.p_expires_at).getTime()).toBeGreaterThan(Date.now());
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `bun test models/profile-starter-unlocks.test.js`
Expected: FAIL — `models/profile.js` throws on import (`Object.values(undefined)`), because Step 3 removed `STARTER_CLASS_UNLOCKS`.

- [ ] **Step 8: Simplify the starter grant**

In `models/profile.js`, change the import on line 6 and delete the `STARTER_CLASS_IDS` constant:

```js
const { STARTER_RULES_PDF_ID } = require('../util/starter-content');
```

Delete the line `const STARTER_CLASS_IDS = Object.values(STARTER_CLASS_UNLOCKS);` and update the comment above `STARTER_UNLOCK_DAYS` to read:

```js
// Starter content - the Advent v1 rulebook. Its core class roster follows on
// read (util/book-classes.js), so no class rows are written here.
const STARTER_UNLOCK_DAYS = 30;
```

Replace `grantStarterUnlocks` with:

```js
const grantStarterUnlocks = async (userId, profileId) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + STARTER_UNLOCK_DAYS);
  const expiresAtISO = expiresAt.toISOString();

  // Grant rules PDF unlock using SECURITY DEFINER function (bypasses RLS).
  // The six Advent core classes derive from this grant and expire with it.
  const rulesResult = await supabase.rpc('grant_starter_rules_unlock', {
    p_user_id: userId,
    p_profile_id: profileId,
    p_rules_pdf_id: STARTER_RULES_PDF_ID,
    p_expires_at: expiresAtISO
  });

  if (rulesResult.error) {
    console.error('Failed to grant starter rules unlock:', rulesResult.error);
  }
}
```

Add `grantStarterUnlocks` to the `module.exports` object in `models/profile.js` so the test can call it.

- [ ] **Step 9: Run test to verify it passes**

Run: `bun test models/profile-starter-unlocks.test.js`
Expected: PASS (2 tests)

- [ ] **Step 10: Confirm the removed export has one caller left**

Run: `grep -rn "STARTER_CLASS_UNLOCKS\|STARTER_CLASS_IDS" --include="*.js" --exclude-dir=node_modules .`
Expected: hits in `util/seed-classes.js` only — it is fixed in Task 3. `util/seed-classes.js` is a seed script that nothing imports at request time, so it does not break the suite.

- [ ] **Step 11: Run the full unit suite**

Run: `bun run test:unit`
Expected: PASS. If anything else still references the removed constant, fix it here rather than deferring.

- [ ] **Step 12: Commit**

```bash
git add util/starter-content.js util/book-classes.js util/book-classes.test.js models/profile.js models/profile-starter-unlocks.test.js
git commit -m "feat: add per-ruleset core class rosters"
```

---

### Task 3: Seed Aspirant classes as Aspirant rows with fixed ids

**Files:**
- Modify: `util/seed-classes.js:55-72` (`buildRow`), `:74-78` (`buildHardcodedClasses`)
- Modify: `util/seed-classes.test.js` (append new tests; amend one existing assertion)

**Interfaces:**
- Consumes: `CORE_CLASS_UNLOCKS` from `util/starter-content.js` (Task 2).
- Produces: `buildHardcodedClasses()` returns rows where the six `aspirantPreviewClassList` classes have `rules_edition: 'aspirant'` and the ids from `CORE_CLASS_UNLOCKS.aspirant`, and the six `adventClassList` classes have `rules_edition: 'advent'` and the ids from `CORE_CLASS_UNLOCKS.advent`.

**State left by Task 2:** `util/seed-classes.js` already imports
`CORE_CLASS_UNLOCKS` and already reads `CORE_CLASS_UNLOCKS.advent` in
`buildRow` — Task 2 did that rename to keep the suite green. Do not redo it.
`util/seed-classes.test.js` already exists with two tests; append to it rather
than replacing it.

**Existing assertion that must change:** `util/seed-classes.test.js` currently
asserts that `Berserker` — one of the six Aspirant classes — carries no fixed
id ("Non-starter classes are unaffected — Postgres is free to generate their
ids"). Once the Aspirant roster has fixed ids that is false. Replace that
assertion with one that names a class in neither roster, and update the
surrounding comment. `Beastmaster` (from `playerCreatedClassList`) is a
correct choice.

- [ ] **Step 1: Write the failing test**

Append to `util/seed-classes.test.js`:

```js
const byName = () => {
  const map = new Map();
  for (const row of buildHardcodedClasses()) map.set(row.name, row);
  return map;
};

// A book grants CORE_CLASS_UNLOCKS[ruleset] by id. If the seeded row carries a
// different id — or the wrong ruleset — the grant resolves to nothing.
test('seeded advent core classes use the advent roster ids and ruleset', () => {
  const rows = byName();
  for (const [name, id] of Object.entries(CORE_CLASS_UNLOCKS.advent)) {
    expect(rows.get(name)).toBeDefined();
    expect(rows.get(name).id).toBe(id);
    expect(rows.get(name).rules_edition).toBe('advent');
  }
});

test('seeded aspirant core classes use the aspirant roster ids and ruleset', () => {
  const rows = byName();
  for (const [name, id] of Object.entries(CORE_CLASS_UNLOCKS.aspirant)) {
    expect(rows.get(name)).toBeDefined();
    expect(rows.get(name).id).toBe(id);
    expect(rows.get(name).rules_edition).toBe('aspirant');
  }
});

test('player-created seed classes stay advent and carry no fixed id', () => {
  const pcc = buildHardcodedClasses().filter(row => row.is_player_created);
  expect(pcc.length).toBeGreaterThan(0);
  for (const row of pcc) {
    expect(row.rules_edition).toBe('advent');
    expect(row.id).toBeUndefined();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OPENAI_API_KEY=test-key bun test util/seed-classes.test.js`
Expected: FAIL — the aspirant test reports `expected 'aspirant', received 'advent'`, because `buildRow` hardcodes `rules_edition: 'advent'` for every row. The advent test passes already; that is fine, it is a regression guard.

- [ ] **Step 3: Make the row builder ruleset-aware**

The import is already `const { CORE_CLASS_UNLOCKS } = require('./starter-content');` (Task 2 renamed it). Leave it alone.

Replace `buildRow` and `buildHardcodedClasses` with:

```js
// Building the row list must be import-safe (no network, no side effects) so
// it can be unit tested.
const buildRow = (cls, is_player_created, rules_edition = 'advent') => {
    const row = {
        name: cls,
        description: '',
        is_public: true,
        status: 'release',
        is_player_created,
        rules_edition,
        rules_version: 'v1',
        stat_spread: classStatSpread[cls] || {},
        gear: (classGearList[cls] || []).map(name => ({ name, description: '' })),
        abilities: (classAbilityList[cls] || []).map(name => ({ name, description: '' })),
        created_by: null
    };
    // Core roster rows must land on the exact id the book grant references.
    const roster = CORE_CLASS_UNLOCKS[rules_edition] || {};
    if (Object.prototype.hasOwnProperty.call(roster, cls)) {
        row.id = roster[cls];
    }
    return row;
};

const buildHardcodedClasses = () => [
    ...adventClassList.map(cls => buildRow(cls, false, 'advent')),
    ...aspirantPreviewClassList.map(cls => buildRow(cls, false, 'aspirant')),
    ...playerCreatedClassList.map(cls => buildRow(cls, true, 'advent')),
];
```

- [ ] **Step 4: Fix the stale Berserker assertion**

The pre-existing first test ends with an assertion that `Berserker` carries no
fixed id. Berserker is now an Aspirant core class with a fixed id, so replace
that block with a class in neither roster:

```js
  // Classes in neither core roster are unaffected — Postgres is free to
  // generate their ids.
  const nonRosterRow = rows.find(row => row.name === 'Beastmaster');
  expect(nonRosterRow).toBeDefined();
  expect(nonRosterRow.id).toBeUndefined();
```

- [ ] **Step 5: Run the file to verify everything passes**

Run: `OPENAI_API_KEY=test-key bun test util/seed-classes.test.js`
Expected: PASS (5 tests — two pre-existing, three new)

- [ ] **Step 6: Run the full unit suite**

Run: `OPENAI_API_KEY=test-key bun run test:unit`
Expected: PASS.

- [ ] **Step 7: Reseed locally**

Run: `bun run seed:classes`
Expected: logs `Successfully seeded class: <name>` per class. Rows seeded before this change keep their old ids, so if the aspirant six already exist under generated ids, `supabase db reset` followed by `bun run seed:local` gives a clean database. Skip if local Supabase is unavailable.

- [ ] **Step 8: Commit**

```bash
git add util/seed-classes.js util/seed-classes.test.js
git commit -m "fix: seed aspirant classes as aspirant rows with fixed ids"
```

---

### Task 4: Repository read for a user's books

**Files:**
- Modify: `services/rules/repository.js` (add one export)
- Create: `services/rules/repository-books.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `rulesRepository.fetchActiveBooksForUser({ userId, nowIso })` → `Promise<Array<{ rules_edition: string, title: string }> | null>`. Returns `null` on any failure (mirrors `fetchClassFamilyRows`), never throws.

- [ ] **Step 1: Write the failing test**

Create `services/rules/repository-books.test.js`:

```js
const { mock, test, expect, afterAll } = require('bun:test');

const realBase = require('../../models/_base');

// Records the query the repository builds, and resolves it to `result`.
const makeClient = (result, calls) => ({
  from(table) {
    calls.push({ table });
    const chain = {
      select(cols) { calls.push({ select: cols }); return chain; },
      eq(col, val) { calls.push({ eq: [col, val] }); return chain; },
      or(expr) { calls.push({ or: expr }); return chain; },
      then(onFulfilled, onRejected) {
        return Promise.resolve(result).then(onFulfilled, onRejected);
      }
    };
    return chain;
  }
});

const calls = [];
const rows = [{ rules_pdf: { rules_edition: 'advent', title: 'Enclave: Advent' } }];

mock.module('../../models/_base', () => ({
  supabase: makeClient({ data: [], error: null }, []),
  supabaseAdmin: makeClient({ data: rows, error: null }, calls),
  anonKey: 'test-anon-key',
  createUserClient: () => makeClient({ data: [], error: null }, [])
}));

delete require.cache[require.resolve('./repository')];
const rulesRepository = require('./repository');

afterAll(() => {
  mock.module('../../models/_base', () => realBase);
  delete require.cache[require.resolve('./repository')];
});

test('flattens the joined rules_pdfs rows to { rules_edition, title }', async () => {
  const data = await rulesRepository.fetchActiveBooksForUser({
    userId: 'u1',
    nowIso: '2026-08-07T00:00:00.000Z'
  });

  expect(data).toEqual([{ rules_edition: 'advent', title: 'Enclave: Advent' }]);
});

test('queries rules_pdf_unlocks for the user, filtering expired grants', async () => {
  calls.length = 0;
  await rulesRepository.fetchActiveBooksForUser({
    userId: 'u1',
    nowIso: '2026-08-07T00:00:00.000Z'
  });

  expect(calls.some(c => c.table === 'rules_pdf_unlocks')).toBe(true);
  expect(calls.some(c => Array.isArray(c.eq) && c.eq[0] === 'user_id' && c.eq[1] === 'u1')).toBe(true);
  expect(calls.some(c => typeof c.or === 'string' && c.or.includes('expires_at.is.null'))).toBe(true);
  // is_active is deliberately NOT filtered: a retired edition still names the
  // ruleset the user owns.
  expect(calls.some(c => Array.isArray(c.eq) && c.eq[0] === 'is_active')).toBe(false);
});

test('returns null when the query errors so callers can degrade', async () => {
  mock.module('../../models/_base', () => ({
    supabase: makeClient({ data: null, error: { message: 'boom' } }, []),
    supabaseAdmin: makeClient({ data: null, error: { message: 'boom' } }, []),
    anonKey: 'test-anon-key',
    createUserClient: () => makeClient({ data: null, error: null }, [])
  }));
  delete require.cache[require.resolve('./repository')];
  const failing = require('./repository');

  const data = await failing.fetchActiveBooksForUser({
    userId: 'u1',
    nowIso: '2026-08-07T00:00:00.000Z'
  });

  expect(data).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test services/rules/repository-books.test.js`
Expected: FAIL — `rulesRepository.fetchActiveBooksForUser is not a function`.

- [ ] **Step 3: Add the repository read**

In `services/rules/repository.js`, add this export after `fetchActiveUnlockForUser` (keep the trailing comma placement valid):

```js
  // Which rulesets does this user hold a book for? Admin client so RLS does
  // not hide the user's own unlock rows. is_active is deliberately not
  // filtered: a retired edition of a book still names the ruleset owned.
  // Returns null on any failure so callers degrade to direct unlocks.
  fetchActiveBooksForUser: async ({ userId, nowIso }) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('rules_pdf_unlocks')
        .select('rules_pdf:rules_pdfs(rules_edition, title)')
        .eq('user_id', userId)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
      if (error || !Array.isArray(data)) {
        if (error) console.error(error);
        return null;
      }
      return data
        .map(row => row.rules_pdf)
        .filter(pdf => pdf && pdf.rules_edition);
    } catch (e) {
      console.error(e);
      return null;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test services/rules/repository-books.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add services/rules/repository.js services/rules/repository-books.test.js
git commit -m "feat: read a user's owned book rulesets"
```

---

### Task 5: Effective class unlocks resolver

**Files:**
- Modify: `models/class.js:1-6` (imports), `:77-96` (`isClassUnlocked`), `:144-180` (`getUnlockedClasses`, `getUnlockedClassIdsForUser`), `:406+` (exports)
- Create: `models/class-book-unlocks.test.js`

**Interfaces:**
- Consumes: `coreClassIdsForEditions` (Task 2), `rulesRepository.fetchActiveBooksForUser` (Task 4), the existing `expandIdsToFamilies` and `computeVersionFamily` from `util/class-family.js`.
- Produces:
  - `getEffectiveClassUnlocks(userId)` → `Promise<{ ids: Set<string>, sourceById: Map<string, { source: 'direct' } | { source: 'book', title: string }> }>`. Exported from `models/class.js`.
  - `isClassUnlocked(userId, classId)` → `{ data: boolean, error: null }` (signature unchanged).
  - `getUnlockedClassIdsForUser(userId)` → `{ data: Set<string>, error: null }` (signature unchanged).
  - `getUnlockedClasses(userId)` → `{ data: Array<classRow & { unlock_source: 'direct' | 'book', unlock_book_title: string | null }>, error: null }`.

- [ ] **Step 1: Write the failing test**

Create `models/class-book-unlocks.test.js`:

```js
const { mock, test, expect, describe, afterAll } = require('bun:test');

const realBase = require('./_base');
const realRulesRepo = require('../services/rules/repository');
const realClassRepo = require('../services/class/repository');
const { CORE_CLASS_UNLOCKS } = require('../util/starter-content');

const ADVENT_LIBRARIAN = CORE_CLASS_UNLOCKS.advent.Librarian;
const ASPIRANT_VESSEL = CORE_CLASS_UNLOCKS.aspirant.Vessel;
const LIBRARIAN_V2 = 'librarian-v2-fork';
const PRIVATE_CLASS = 'some-other-class';

// Every class row the family resolver needs to see.
const classFamilyRows = [
  { id: ADVENT_LIBRARIAN, base_class_id: null, rules_edition: 'advent' },
  { id: LIBRARIAN_V2, base_class_id: ADVENT_LIBRARIAN, rules_edition: 'advent' },
  { id: ASPIRANT_VESSEL, base_class_id: null, rules_edition: 'aspirant' },
  { id: PRIVATE_CLASS, base_class_id: null, rules_edition: 'advent' }
];

// Rewire the two repositories the resolver reads through. `state` is mutated
// per test to describe what the user owns.
const state = { books: [], directIds: [], familyRows: classFamilyRows };

mock.module('./_base', () => realBase);
mock.module('../services/rules/repository', () => ({
  ...realRulesRepo,
  fetchActiveBooksForUser: async () => state.books
}));
mock.module('../services/class/repository', () => ({
  ...realClassRepo,
  fetchClassFamilyRows: async () => state.familyRows,
  unlockedClassIdRows: async () => ({
    data: state.directIds.map(id => ({ class_id: id })),
    error: null
  }),
  unlockedClassRows: async () => ({
    data: state.directIds.map(id => ({ class: { id, name: id }, expires_at: null })),
    error: null
  }),
  fetchClassByIdAdmin: async (id) => ({
    data: classFamilyRows.find(r => r.id === id) || null,
    error: null
  })
}));

delete require.cache[require.resolve('./class')];
const {
  getEffectiveClassUnlocks,
  isClassUnlocked,
  getUnlockedClassIdsForUser
} = require('./class');

afterAll(() => {
  mock.module('../services/rules/repository', () => realRulesRepo);
  mock.module('../services/class/repository', () => realClassRepo);
  delete require.cache[require.resolve('./class')];
});

const reset = () => {
  state.books = [];
  state.directIds = [];
  state.familyRows = classFamilyRows;
};

describe('book-derived class unlocks', () => {
  test('an Advent book unlocks an Advent core class with no direct unlock', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];

    expect(await isClassUnlocked('u1', ADVENT_LIBRARIAN)).toEqual({ data: true, error: null });
  });

  test('an Advent book covers the v2 fork of a core class', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];

    expect(await isClassUnlocked('u1', LIBRARIAN_V2)).toEqual({ data: true, error: null });
  });

  test('an Advent book does not unlock an Aspirant core class', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];

    expect(await isClassUnlocked('u1', ASPIRANT_VESSEL)).toEqual({ data: false, error: null });
  });

  test('no book and no direct unlock leaves the class locked', async () => {
    reset();

    expect(await isClassUnlocked('u1', ADVENT_LIBRARIAN)).toEqual({ data: false, error: null });
  });

  test('a direct unlock still resolves when the user holds no book', async () => {
    reset();
    state.directIds = [PRIVATE_CLASS];

    expect(await isClassUnlocked('u1', PRIVATE_CLASS)).toEqual({ data: true, error: null });
  });

  test('getUnlockedClassIdsForUser unions direct and book-derived ids', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];
    state.directIds = [PRIVATE_CLASS];

    const { data } = await getUnlockedClassIdsForUser('u1');

    expect(data.has(PRIVATE_CLASS)).toBe(true);
    expect(data.has(ADVENT_LIBRARIAN)).toBe(true);
    expect(data.has(LIBRARIAN_V2)).toBe(true);
    expect(data.has(ASPIRANT_VESSEL)).toBe(false);
  });

  test('sources tag direct unlocks as direct and book grants with the title', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];
    state.directIds = [PRIVATE_CLASS];

    const { sourceById } = await getEffectiveClassUnlocks('u1');

    expect(sourceById.get(PRIVATE_CLASS)).toEqual({ source: 'direct' });
    expect(sourceById.get(ADVENT_LIBRARIAN)).toEqual({ source: 'book', title: 'Enclave: Advent' });
  });

  test('a class held both directly and via a book tags as direct', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];
    state.directIds = [ADVENT_LIBRARIAN];

    const { sourceById } = await getEffectiveClassUnlocks('u1');

    expect(sourceById.get(ADVENT_LIBRARIAN)).toEqual({ source: 'direct' });
  });

  test('a failed book lookup degrades to direct unlocks rather than erroring', async () => {
    reset();
    state.books = null; // repository signals failure with null
    state.directIds = [PRIVATE_CLASS];

    const { data } = await getUnlockedClassIdsForUser('u1');

    expect(data.has(PRIVATE_CLASS)).toBe(true);
    expect(data.has(ADVENT_LIBRARIAN)).toBe(false);
  });

  test('a failed class projection still returns unexpanded ids', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];
    state.familyRows = null;

    const { data } = await getUnlockedClassIdsForUser('u1');

    expect(data.has(ADVENT_LIBRARIAN)).toBe(true);
    expect(data.has(LIBRARIAN_V2)).toBe(false);
  });

  test('no user id yields no unlocks', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];

    const { data } = await getUnlockedClassIdsForUser(null);

    expect(data).toEqual(new Set());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test models/class-book-unlocks.test.js`
Expected: FAIL — `getEffectiveClassUnlocks is not a function`.

- [ ] **Step 3: Add the resolver**

In `models/class.js`, extend the imports at the top:

```js
const { computeVersionFamily, expandIdsToFamilies } = require('../util/class-family');
const { coreClassIdsForEditions } = require('../util/book-classes');
const rulesRepository = require('../services/rules/repository');
```

Add the resolver directly above `isClassUnlocked`:

```js
// The user's effective class access: direct class_unlocks unioned with the
// core roster of every ruleset they hold a book for, then expanded across
// same-edition version families. Computed on read — a lapsed book revokes its
// classes with no cleanup step. Both fetches degrade rather than throw.
const getEffectiveClassUnlocks = async (userId) => {
    const empty = { ids: new Set(), sourceById: new Map() };
    if (!userId) return empty;

    const nowIso = new Date().toISOString();
    const [directResult, books] = await Promise.all([
        classRepository.unlockedClassIdRows({ userId, nowIso }),
        rulesRepository.fetchActiveBooksForUser({ userId, nowIso })
    ]);

    const directIds = new Set(
        (directResult?.error ? [] : (directResult?.data || [])).map(row => row.class_id)
    );

    // Book -> the roster it grants. Later books do not overwrite an earlier
    // title for the same id; any owning book is a truthful badge.
    const bookTitleById = new Map();
    for (const book of books || []) {
        for (const id of coreClassIdsForEditions([book.rules_edition])) {
            if (!bookTitleById.has(id)) bookTitleById.set(id, book.title);
        }
    }

    const union = new Set([...directIds, ...bookTitleById.keys()]);
    if (union.size === 0) return empty;

    const classRows = await fetchClassFamilyRows();
    const ids = classRows ? expandIdsToFamilies(classRows, union) : union;

    const sourceById = new Map();
    for (const id of ids) {
        if (directIds.has(id)) {
            sourceById.set(id, { source: 'direct' });
            continue;
        }
        const title = bookTitleById.get(id);
        sourceById.set(id, title ? { source: 'book', title } : { source: 'direct' });
    }

    return { ids, sourceById };
};
```

Note on the fallback in that last loop: an id reached only by family expansion (a v2 fork) has no entry in either map. Tagging it `direct` is deliberate — it is derived from whatever granted its sibling, and the profile badge should not claim a book the user may not hold.

- [ ] **Step 4: Route the three reads through it**

Replace `isClassUnlocked` with:

```js
const isClassUnlocked = async (userId, classId) => {
    if (!userId || !classId) {
        return { data: false, error: null };
    }

    // An unlock for any same-edition version of the class counts, and a book
    // for the class's ruleset counts if the class is in its core roster.
    const [{ ids }, familyIds] = await Promise.all([
        getEffectiveClassUnlocks(userId),
        getVersionFamilyIds(classId)
    ]);

    for (const id of familyIds) {
        if (ids.has(id)) return { data: true, error: null };
    }
    return { data: false, error: null };
};
```

Replace `getUnlockedClassIdsForUser` with:

```js
const getUnlockedClassIdsForUser = async (userId) => {
    const { ids } = await getEffectiveClassUnlocks(userId);
    return { data: ids, error: null };
};
```

Replace `getUnlockedClasses` with:

```js
// Profile display: every class the user can play, tagged with where the
// access came from so the view can badge book-derived rows.
const getUnlockedClasses = async (userId) => {
    const { ids, sourceById } = await getEffectiveClassUnlocks(userId);
    if (ids.size === 0) {
        return { data: [], error: null };
    }

    const { data, error } = await classRepository.classRowsByIds([...ids]);
    if (error) {
        return { data: null, error };
    }

    return {
        data: (data || []).map(cls => ({
            ...cls,
            unlock_source: sourceById.get(cls.id)?.source || 'direct',
            unlock_book_title: sourceById.get(cls.id)?.title || null
        })),
        error: null
    };
};
```

Add `getEffectiveClassUnlocks` to the `module.exports` object in `models/class.js`.

- [ ] **Step 5: Add the repository read `getUnlockedClasses` now needs**

`getUnlockedClasses` no longer joins through `class_unlocks`, so it needs to hydrate rows by id. In `services/class/repository.js`, add after `unlockedClassIdRows`:

```js
  // Hydrate class rows for an already-resolved id set (see
  // getEffectiveClassUnlocks). Admin client so private forks resolve.
  classRowsByIds: async (classIds) => {
    if (!Array.isArray(classIds) || classIds.length === 0) {
      return { data: [], error: null };
    }
    const { data, error } = await supabaseAdmin
      .from('classes')
      .select('*')
      .in('id', classIds);
    if (error) {
      console.error(error);
      return { data: null, error };
    }
    return { data, error: null };
  },
```

Delete `unlockedClassRows` from `services/class/repository.js` — `getUnlockedClasses` was its only caller and it is now unused.

- [ ] **Step 6: Update the stub in the existing model test**

`models/class.test.js` asserts `getUnlockedClasses` returns `[{ id: 'class-1', name: 'Illusionist' }]` from a `class_unlocks` join that no longer happens. Update that test's expectation to the new shape and source tag:

```js
test('unlock reads route through supabaseAdmin so anon RLS does not hide rows', async () => {
    const listResult = await getUnlockedClasses('u1');
    expect(listResult.error).toBeFalsy();
    expect(Array.isArray(listResult.data)).toBe(true);
    expect(listResult.data.length).toBe(1);
    expect(listResult.data[0]).toMatchObject({
        id: 'class-1',
        name: 'Illusionist',
        unlock_source: 'direct'
    });

    const unlockedResult = await isClassUnlocked('u1', 'class-1');
    expect(unlockedResult).toEqual({ data: true, error: null });
});
```

The fake client in that file returns its `tableToRows` for any table, so add `classes` and `rules_pdf_unlocks` entries to `fakeAdmin` so the new reads resolve:

```js
const fakeAdmin = makeClient({
    class_unlocks: [unlockRow],
    classes: [{ id: 'class-1', name: 'Illusionist' }],
    rules_pdf_unlocks: []
});
```

Note: `unlockRow` in that file is the joined shape (`{ class: {...} }`) used by `class_unlocks`; the new `unlockedClassIdRows` read needs `class_id`, so change it to:

```js
const unlockRow = { class_id: 'class-1', expires_at: null };
```

- [ ] **Step 7: Run the full unit suite**

Run: `bun run test:unit`
Expected: PASS, with no failures. If a suite fails, fix it in this task — nothing later in the plan is expected to repair it.

- [ ] **Step 8: Commit**

```bash
git add models/class.js models/class.test.js models/class-book-unlocks.test.js services/class/repository.js
git commit -m "feat: grant core classes from owned rules PDFs"
```

---

### Task 6: Drop the `grant_starter_class_unlocks` SQL function

**Files:**
- Create: `supabase/migrations/20260807000001_drop_grant_starter_class_unlocks.sql`
- Modify: `supabase/migrations/20240101000000_baseline_schema.sql:760-776`
- Modify: `models/profile-starter-unlocks.test.js` (append one test)

**Interfaces:**
- Consumes: `grantStarterUnlocks` already stopped calling this function in Task 2; the Advent book confers the advent core roster as of Task 5.
- Produces: no `grant_starter_class_unlocks` function in any migration. No JS interface changes.

- [ ] **Step 1: Write the failing test**

Append to `models/profile-starter-unlocks.test.js`:

```js
const fs = require('fs');
const path = require('path');

// The JS caller is gone (Task 2). The function itself is dead weight in the
// schema — and a live SECURITY DEFINER function that writes class_unlocks is
// a grant path nothing audits.
test('no migration still defines grant_starter_class_unlocks', () => {
  const dir = path.join(__dirname, '..', 'supabase', 'migrations');
  const defining = fs.readdirSync(dir).filter(file => {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    return /CREATE OR REPLACE FUNCTION grant_starter_class_unlocks/i.test(sql);
  });

  expect(defining).toEqual([]);
});
```

Move the two `require` lines to the top of the file with the other imports rather than leaving them mid-file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test models/profile-starter-unlocks.test.js`
Expected: FAIL — `expect([...]).toEqual([])` listing `20240101000000_baseline_schema.sql`.

- [ ] **Step 3: Drop the function**

Create `supabase/migrations/20260807000001_drop_grant_starter_class_unlocks.sql`:

```sql
-- Starter class unlocks are no longer written: the starter Advent rulebook
-- grant confers its core roster on read (util/book-classes.js).
DROP FUNCTION IF EXISTS grant_starter_class_unlocks(uuid, uuid[], timestamptz);
```

- [ ] **Step 4: Remove it from the baseline schema**

In `supabase/migrations/20240101000000_baseline_schema.sql`, delete the
`grant_starter_class_unlocks` definition — the comment line
`-- Function to grant starter class unlocks (server-side, bypasses RLS)`
through its closing `$$;`. The baseline is the from-scratch schema; leaving a
function there that the very next migration drops is dead code.

Keep `grant_starter_rules_unlock` untouched — the starter grant still calls it.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test models/profile-starter-unlocks.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full unit suite**

Run: `bun run test:unit`
Expected: PASS.

- [ ] **Step 7: Verify a fresh database still provisions a usable account**

Run: `supabase db reset && bun run seed:local`
Expected: completes without error, proving the baseline edit left valid SQL and the drop applies cleanly. Skip if local Supabase is unavailable.

- [ ] **Step 8: Commit**

```bash
git add models/profile-starter-unlocks.test.js supabase/migrations/
git commit -m "refactor: drop the unused starter class unlock function"
```

---


### Task 7: Ruleset select on the admin rules-PDF forms

**Files:**
- Modify: `views/library-manage.handlebars:26-33` (create form) and `:86-94` (edit form)
- Modify: `routes/library.js:134-169` (POST `/`) and `:171-207` (POST `/:id`)
- Create: `views/library-manage.test.js`

**Interfaces:**
- Consumes: `rules_pdfs.rules_edition` (Task 1).
- Produces: both admin forms post `rules_edition`; both handlers persist it, rejecting anything other than `advent` or `aspirant`.

- [ ] **Step 1: Write the failing test**

Create `views/library-manage.test.js`:

```js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

const view = () => fs.readFileSync(
  path.join(__dirname, 'library-manage.handlebars'), 'utf8'
);

// rules_edition drives which core class roster the book grants
// (util/book-classes.js), so admins must set it deliberately rather than
// inherit the column default.
test('both forms expose a rules_edition select with both rulesets', () => {
  const src = view();
  const selects = src.match(/<select[^>]*name="rules_edition"/g) || [];

  expect(selects.length).toBe(2); // create form + per-row edit form
  expect(src).toContain('value="advent"');
  expect(src).toContain('value="aspirant"');
});

test('the edit form preselects the row\'s current ruleset', () => {
  expect(view()).toContain(`eq this.rules_edition 'aspirant'`);
});

test('the version field is still labelled distinctly from the ruleset', () => {
  const src = view();
  // `edition` (version, e.g. v1) and `rules_edition` (ruleset) are different
  // columns; identical labels would guarantee admin error.
  expect(src).toContain('Ruleset');
  expect(src).toContain('Version');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test views/library-manage.test.js`
Expected: FAIL — `expect(0).toBe(2)` for the select count.

- [ ] **Step 3: Add the select to the create form**

In `views/library-manage.handlebars`, replace the create form's Edition column (the `new-rules-edition` field) with two columns:

```handlebars
      <div class="column is-one-quarter">
        <div class="field">
          <label class="label" for="new-rules-edition">Version</label>
          <div class="control">
            <input class="input" type="text" name="edition" id="new-rules-edition" placeholder="e.g. v2" required>
          </div>
        </div>
      </div>
      <div class="column is-one-quarter">
        <div class="field">
          <label class="label" for="new-rules-ruleset">Ruleset</label>
          <div class="control">
            <div class="select is-fullwidth">
              <select name="rules_edition" id="new-rules-ruleset" required>
                <option value="advent">Advent</option>
                <option value="aspirant">Aspirant</option>
              </select>
            </div>
          </div>
        </div>
      </div>
```

Change the create form's opening `<div class="columns">` block so the title column is `is-one-quarter` rather than `is-half`, keeping the row at four quarters.

- [ ] **Step 4: Add the select to the edit form**

In the per-row edit form, replace the Edition column with:

```handlebars
        <div class="column is-one-quarter">
          <div class="field">
            <label class="label">Version</label>
            <div class="control">
              <input class="input" type="text" name="edition" value="{{this.edition}}" required>
            </div>
          </div>
        </div>
        <div class="column is-one-quarter">
          <div class="field">
            <label class="label">Ruleset</label>
            <div class="control">
              <div class="select is-fullwidth">
                <select name="rules_edition" required>
                  <option value="advent" {{#if (eq this.rules_edition 'advent')}}selected{{/if}}>Advent</option>
                  <option value="aspirant" {{#if (eq this.rules_edition 'aspirant')}}selected{{/if}}>Aspirant</option>
                </select>
              </div>
            </div>
          </div>
        </div>
```

Change that row's other two columns from `is-one-third` to `is-one-quarter`.

Also update the row heading `<p class="subtitle is-6">Edition: {{this.edition}}</p>` to:

```handlebars
          <p class="subtitle is-6">{{capitalize this.rules_edition}} · {{this.edition}}</p>
```

- [ ] **Step 5: Persist it in both handlers**

At the top of `routes/library.js`, add the validator next to the other helpers:

```js
const RULESETS = new Set(['advent', 'aspirant']);
const normalizeRuleset = (value) => (RULESETS.has(value) ? value : null);
```

In POST `/`, read and validate it, then add it to the payload:

```js
    const { title, edition } = req.body;
    const rulesEdition = normalizeRuleset(req.body.rules_edition);
    const isActive = normalizeBoolean(req.body.is_active, true);

    if (!title || !edition) {
        return sendError(req, res, null, { status: 400, message: 'Title and edition are required' });
    }

    if (!rulesEdition) {
        return sendError(req, res, null, { status: 400, message: 'Ruleset must be advent or aspirant' });
    }
```

```js
    const payload = {
        id: rulesPdfId,
        title: title.trim(),
        edition: edition.trim(),
        rules_edition: rulesEdition,
        storage_path: storageInfo.path,
        is_active: isActive,
        created_by: profile?.id || null
    };
```

In POST `/:id`, apply the same validation and include `rules_edition: rulesEdition` in the update object it builds.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test views/library-manage.test.js && bun run check`
Expected: PASS (3 tests), and `check` exits silently.

- [ ] **Step 7: Commit**

```bash
git add views/library-manage.handlebars views/library-manage.test.js routes/library.js
git commit -m "feat: set a book's ruleset from the admin library form"
```

---

### Task 8: Badge book-derived classes on the profile page

**Files:**
- Modify: `views/profile.handlebars:50-67` (the unlocked-classes table)
- Create: `views/profile-unlock-source.test.js`

**Interfaces:**
- Consumes: `unlock_source` and `unlock_book_title` on each row returned by `getUnlockedClasses` (Task 5). `routes/profile.js` already passes those rows through `partitionProfileClasses`, which copies rows by reference, so no route change is needed.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Create `views/profile-unlock-source.test.js`:

```js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

const view = () => fs.readFileSync(
  path.join(__dirname, 'profile.handlebars'), 'utf8'
);

// Book-derived access lapses with the book. A user needs to see which classes
// are theirs outright and which ride on a rulebook grant.
test('book-derived classes render a badge naming the book', () => {
  const src = view();

  expect(src).toContain(`eq this.unlock_source 'book'`);
  expect(src).toContain('{{this.unlock_book_title}}');
});

test('the badge copy says the class is included with the book', () => {
  expect(view()).toContain('Included with');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test views/profile-unlock-source.test.js`
Expected: FAIL — `expect(received).toContain(expected)` for `eq this.unlock_source 'book'`.

- [ ] **Step 3: Render the badge**

In `views/profile.handlebars`, in the unlocked-classes table body, replace the name cell:

```handlebars
          <td>
            <a href="/classes/{{this.id}}/{{this.name}}">{{this.name}}</a>
            {{#if (eq this.unlock_source 'book')}}
              <span class="tag is-info is-light ml-2"
                    title="Access comes from your rulebook and ends when it does">
                Included with {{this.unlock_book_title}}
              </span>
            {{/if}}
          </td>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test views/profile-unlock-source.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Verify the page renders against real data**

Run: `bun run dev`, sign in as a seeded user, and open `/profile`.
Expected: the six Advent core classes are listed, each badged "Included with Enclave: Advent". Stop the server afterwards. Skip if local Supabase is unavailable.

- [ ] **Step 6: Run the full unit suite and syntax check**

Run: `bun run test:unit && bun run check`
Expected: PASS, `check` silent.

- [ ] **Step 7: Commit**

```bash
git add views/profile.handlebars views/profile-unlock-source.test.js
git commit -m "feat: badge classes included with a rulebook"
```

---

### Task 9: Full-stack verification

**Files:**
- Create: `e2e/specs/18-book-class-unlocks.spec.js`
- Modify: none (fix whatever this surfaces in the task that owns it)

**Interfaces:**
- Consumes: every prior task.
- Produces: a durable browser-tier spec proving the feature end to end, plus a green run of all four test tiers.

**Why a spec instead of manual browsing:** this codebase has a real
browser tier (`playwright.config.js`, `e2e/global-setup.js`, `e2e/fixtures/`)
with signed-in admin and player storage states and a `pg` fixture. The
behaviours this task must confirm — a book granting classes, cross-ruleset
isolation, expiry revoking access — are exactly what that tier exists for, and
a spec keeps proving them after today. Hand-browsing proves them once.

**The player account is a blank slate.** `e2e/global-setup.js` inserts the
E2E Player's profile directly through `supabaseAdmin`, bypassing
`provisionProfile`, so that account receives no starter grant: no rules-PDF
unlock and no class unlocks. The spec grants the book itself and tears it
down, which makes it self-contained and independent of signup behaviour.

- [ ] **Step 1: Confirm the environment**

Run: `supabase status`
Expected: local Supabase is running. `SUPABASE_URL` must be
`http://127.0.0.1:54321` — `playwright.config.js` throws otherwise, on purpose,
so the suite can never seed or delete rows in a cloud project. Confirm this
before going further.

Then: `bun run seed:local`
Expected: completes. The spec depends on the seeded classes and the seeded
"Enclave: Advent" rules PDF row.

- [ ] **Step 2: Run every non-browser tier**

Run: `OPENAI_API_KEY=test-key bun run test:unit && OPENAI_API_KEY=test-key bun run test:http && bun run check`
Expected: all PASS, `check` silent.

Run: `bun run test:integration`
Expected: PASS.

Record the actual counts. If any tier fails, stop and report — do not write the
new spec on top of a red suite.

- [ ] **Step 3: Write the spec**

Create `e2e/specs/18-book-class-unlocks.spec.js`, using the player storage
state. Read `e2e/specs/07-unlock-code-modal.spec.js` and
`e2e/fixtures/db.js` first and follow their shape: connect through the `pg`
fixture, do your own setup and teardown, and never leave rows behind.

The spec covers four behaviours, in this order:

1. **A book grants its roster.** Insert a `rules_pdf_unlocks` row for the E2E
   Player and `STARTER_RULES_PDF_ID` (from `util/starter-content.js`) with
   `expires_at` null. Load `/profile`. Assert all six names in
   `CORE_CLASS_UNLOCKS.advent` are listed, and that each carries the
   "Included with Enclave: Advent" badge.
2. **The wizard sees them.** Load the character-creation class step and assert
   the Advent class list offers Librarian. This proves the derivation reaches
   `filterClassDataForUser`, not just the profile page. Read the wizard view
   first to find the right route and selector; it is an htmx/Alpine flow, so
   prefer a user-visible assertion over a brittle DOM path.
3. **Cross-ruleset isolation.** With only the Advent book held, open an
   Aspirant core class page — use an id from `CORE_CLASS_UNLOCKS.aspirant`.
   Assert the locked/teaser state renders, not full class content.
4. **Expiry revokes derived access.** Update that unlock row to
   `expires_at = now() - interval '1 day'`. Reload `/profile`. Assert the six
   classes are gone.

Teardown deletes the unlock row for that user and PDF id, whatever the test
outcome.

Derive every id and name from `util/starter-content.js` — never paste a UUID
into the spec.

- [ ] **Step 4: Run the spec**

Run: `bun run test:e2e -- 18-book-class-unlocks`
Expected: PASS. If a step fails, the failure is real: this is the first time
the feature runs against a browser and a live database. Diagnose it before
weakening the assertion — a failing expiry check in particular means derived
access is not actually revoked, which is a defect in Task 5's resolver, not in
your spec.

- [ ] **Step 5: Run the whole browser tier**

Run: `bun run test:e2e`
Expected: PASS, including the 17 pre-existing specs. A regression in one of
those is this branch's doing and must be reported, not skipped.

- [ ] **Step 6: Confirm no rows were left behind**

Run:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c \
  "select u.email, count(*) from rules_pdf_unlocks r join auth.users u on u.id = r.user_id group by u.email;"
```

Expected: no row for `e2e-player@testing.com`. If one survives, the spec's
teardown is incomplete — fix it.

- [ ] **Step 7: Commit**

```bash
git add e2e/specs/18-book-class-unlocks.spec.js
git commit -m "test: cover book-derived class unlocks in the browser tier"
```

If steps 2-6 surfaced defects outside the new spec, fix them in a separate
commit with a `fix:` message describing the defect, and say so in your report.

---


## Pre-deploy checklist

Not part of the branch; do this before this change reaches production.

- [ ] Query production for classes named in `aspirantPreviewClassList` (Berserker, Freerunner, Infiltrator, Samaritan, Vessel, Witchhunter). If rows exist, replace the minted ids in `CORE_CLASS_UNLOCKS.aspirant` with the production ids and correct their `rules_edition` to `'aspirant'`; if they do not exist, seed them with the minted ids.
- [ ] Confirm every production `rules_pdfs` row has the intended `rules_edition` after the backfill — the migration defaults everything not matching `%aspirant%` to `advent`.
