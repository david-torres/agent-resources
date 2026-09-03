# Input Whitespace Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop leading/trailing whitespace on user-entered text from reaching the database, clean up the 242 values already there, and repair the 43 character rows silently rendering without descriptions because of it.

**Architecture:** One recursive `trimStrings` helper applied at every application write path, rather than a per-field allowlist — an allowlist is what let `classes.name` slip through last time. Plus a whitespace-insensitive read-side merge, so a defect that ever slips through again is cosmetic rather than silently destructive. No database constraint or trigger, by the owner's decision.

**Tech Stack:** Bun, Express 4, Supabase/Postgres, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-09-02-input-whitespace-design.md`

## Global Constraints

- **Coverage is the entire guard.** There is no database backstop, so a write path left unnormalized reintroduces the bug in silence. Task 8's integration test is what catches the path nobody thought of; it is not optional.
- Only leading and trailing whitespace is in scope. Internal whitespace is never collapsed.
- Trimming prose is safe here and was verified against production data: of 230 untrimmed scalar values, only four have leading whitespace, and the single value starting with four spaces (`missions.statement`) is stray indentation before a blank line, not a Markdown code block.
- `services/feedback/input.js` already normalizes thoroughly (`:34-42`) and is not touched.
- Tests run with `bun run test:unit`; integration tests need the local stack and must be registered in `scripts/run-tests.mjs`.
- Exercising this against real data requires a production copy restored locally — see the recipe in `docs/superpowers/plans/2026-09-02-prerelease-class-import.md` Global Constraints. A seeded local database has none of the defects.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `util/trim-input.js` | `trimStrings(value, { exempt })` — pure, recursive, no I/O. |
| `util/trim-input.test.js` | Unit tests for it. |
| `supabase/migrations/20260903000000_trim_existing_whitespace.sql` | One-time cleanup of the 242 values. |
| `util/whitespace-integrity.integration.test.js` | The guard that notices an unnormalized write path. |

**Modified:**

| Path | Change |
|---|---|
| `services/class/input.js:5-9` | `trimStrings` in `normalizeClassInput` — the actual bug. |
| `services/mission/input.js:7-12` | `trimStrings` in `normalizeMissionInput`. |
| `services/lfg/input.js:10-25` | `trimStrings` in `normalizeLfgInput`. |
| `services/character/input.js:21-57` | `trimStrings` at the top; the now-redundant per-item `.trim()` calls removed. |
| `models/profile.js`, `models/pages.js`, `models/rules.js`, `models/nav.js`, `models/offscreen-mission.js` | Trim before write — these have no service input layer. |
| `services/character/repository.js:57-67,100-111` | Compare trimmed names on both sides of the merge. |
| `scripts/run-tests.mjs` | Register the integration test. |

---

### Task 1: The `trimStrings` helper

**Files:**
- Create: `util/trim-input.js`
- Test: `util/trim-input.test.js`

**Interfaces:**
- Produces: `trimStrings(value, { exempt = [] } = {}) => value` — returns a new structure with every string trimmed. Walks plain objects and arrays only; anything else (Date, moment, class instances, null, numbers) passes through by reference. `exempt` holds dotted paths (`'content'`, `'gear.description'`); array elements inherit their array's path. Never mutates the input.

- [ ] **Step 1: Write the failing test**

```js
// util/trim-input.test.js
const { test, expect } = require('bun:test');
const { trimStrings } = require('./trim-input');

test('trims a plain string', () => {
  expect(trimStrings('  Zoologist ')).toBe('Zoologist');
});

test('trims strings nested in objects and arrays', () => {
  expect(trimStrings({ name: 'Shonen ', gear: [{ name: ' Gi ', description: 'x ' }] }))
    .toEqual({ name: 'Shonen', gear: [{ name: 'Gi', description: 'x' }] });
});

test('leaves non-string scalars alone', () => {
  expect(trimStrings({ a: 1, b: true, c: null, d: undefined }))
    .toEqual({ a: 1, b: true, c: null, d: undefined });
});

// services/character/input.js passes moment objects through its pipeline; a
// naive object walk would shred them into plain objects.
test('passes non-plain objects through untouched', () => {
  const date = new Date('2026-09-03T00:00:00Z');
  const out = trimStrings({ when: date });
  expect(out.when).toBe(date);
});

test('does not mutate its input', () => {
  const input = { name: 'Zoologist ', gear: [{ name: 'Gi ' }] };
  trimStrings(input);
  expect(input.name).toBe('Zoologist ');
  expect(input.gear[0].name).toBe('Gi ');
});

test('respects an exempt path, including inside an array', () => {
  const input = { name: 'X ', gear: [{ name: 'Gi ', description: '  indented ' }] };
  expect(trimStrings(input, { exempt: ['gear.description'] }))
    .toEqual({ name: 'X', gear: [{ name: 'Gi', description: '  indented ' }] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test util/trim-input.test.js`
Expected: FAIL — `Cannot find module './trim-input'`

- [ ] **Step 3: Write minimal implementation**

```js
// util/trim-input.js
// Whitespace on user-entered text silently breaks every name-keyed lookup in
// the app. This walks the whole payload rather than a list of known fields: a
// field list is what let classes.name slip through, and it rots every time a
// column is added.
const isPlainObject = (value) => {
    if (value === null || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};

const trimStrings = (value, options = {}, path = '') => {
    const { exempt = [] } = options;
    if (typeof value === 'string') return exempt.includes(path) ? value : value.trim();
    // Array elements inherit their array's path, so `gear.description` exempts
    // that field on every element rather than needing an index.
    if (Array.isArray(value)) return value.map((item) => trimStrings(item, options, path));
    if (!isPlainObject(value)) return value;
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        result[key] = trimStrings(item, options, path ? `${path}.${key}` : key);
    }
    return result;
};

module.exports = { trimStrings };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test util/trim-input.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add util/trim-input.js util/trim-input.test.js
git commit -m "feat: add recursive input whitespace trimmer"
```

---

### Task 2: Normalize class writes

**Files:**
- Modify: `services/class/input.js:5-9`
- Test: `services/class/input.test.js`

This is the path that produced the live bug: `classes.name` holds `Zoologist ` and `Onmyōji `, and `classes.gear[].name` holds `Gi `, `Training Weights `, `Captain Obvious `, `Head in the Clouds `, `Papyrus Scroll `, `Kuji-kiri {…} `, `Sleeping Dragon: `.

**Interfaces:**
- Consumes: `trimStrings` from Task 1.
- Produces: `normalizeClassInput` returns a payload whose every string is trimmed, `image_url` still sanitized.

- [ ] **Step 1: Write the failing test**

```js
// services/class/input.test.js
const { test, expect } = require('bun:test');
const { normalizeClassInput } = require('./input');

test('trims the class name and every item name', () => {
  const out = normalizeClassInput({
    name: 'Zoologist ',
    gear: [{ name: 'Training Weights ', description: 'Heavy. ' }],
    abilities: [{ name: 'Captain Obvious ', description: 'd' }],
  });
  expect(out.name).toBe('Zoologist');
  expect(out.gear[0]).toEqual({ name: 'Training Weights', description: 'Heavy.' });
  expect(out.abilities[0].name).toBe('Captain Obvious');
});

test('still sanitizes image_url', () => {
  const out = normalizeClassInput({ name: 'X', image_url: 'javascript:alert(1)' });
  expect(out.image_url).toBeFalsy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test services/class/input.test.js`
Expected: FAIL — `name` is `'Zoologist '`

- [ ] **Step 3: Write minimal implementation**

```js
// services/class/input.js
const { sanitizeUrlFields } = require('../../util/url');
const { trimStrings } = require('../../util/trim-input');

const cloneInput = (input) => ({ ...(input || {}) });

const normalizeClassInput = (input) => {
  const data = trimStrings(cloneInput(input));
  sanitizeUrlFields(data, ['image_url']);
  return data;
};

module.exports = { cloneInput, normalizeClassInput };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test services/class/input.test.js && bun run test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/class/input.js services/class/input.test.js
git commit -m "fix: trim whitespace on class names and item names"
```

---

### Task 3: Normalize mission and LFG writes

**Files:**
- Modify: `services/mission/input.js:7-12`, `services/lfg/input.js:10-25`
- Test: `services/mission/input.test.js`, `services/lfg/input.test.js`

`missions` carries 98 untrimmed values today — `name` (25), `focus_words` (26), `statement` (22), `summary` (18), `host_name` (7).

**Interfaces:**
- Consumes: `trimStrings`.
- Produces: both normalizers trim; `sanitizeUrlFields(data, ['media_url'])` and the moment-based date handling are unchanged.

- [ ] **Step 1: Write the failing test**

```js
// services/mission/input.test.js
const { test, expect } = require('bun:test');
const { normalizeMissionInput } = require('./input');

test('trims mission name and host name', () => {
  const out = normalizeMissionInput({ name: 'Operation Abyssal Echo ', host_name: ' Dave ' },
    { creatorId: 'p1' });
  expect(out.name).toBe('Operation Abyssal Echo');
  expect(out.host_name).toBe('Dave');
});
```

Write the equivalent for `normalizeLfgInput`, asserting a trimmed title and that its `moment`-derived date fields survive the walk unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test services/mission/input.test.js services/lfg/input.test.js`
Expected: FAIL — names come back untrimmed

- [ ] **Step 3: Write minimal implementation**

Apply `trimStrings` to the cloned payload as the first step of each normalizer, before the existing URL sanitization and date handling.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/mission/input.js services/lfg/input.js services/mission/input.test.js services/lfg/input.test.js
git commit -m "fix: trim whitespace on mission and LFG input"
```

---

### Task 4: Consolidate character normalization

**Files:**
- Modify: `services/character/input.js:21-57`
- Test: `services/character/input.test.js`

This path is already correct — `normalizeClassItems` (`:40-57`) and `normalizeNamedJsonbList` (`:21-38`) call `.trim()`, which is why `class_abilities.name`/`class_gear.name` have zero defects. Applying `trimStrings` at the top makes those per-item calls redundant, and per the repo's no-dead-code rule they are removed rather than left as a second copy of the rule.

**Interfaces:**
- Produces: unchanged behaviour; the `"ClassName::ItemName"` split in `normalizeClassItems` still works on an already-trimmed value.

- [ ] **Step 1: Write the failing test**

```js
test('trims every string in a character payload, not just item names', () => {
  const out = normalizeCharacterInput({
    name: ' Ragnar ', background: 'A tale. ',
    gear: ['Shonen::Training Weights '],
  });
  expect(out.name).toBe('Ragnar');
  expect(out.background).toBe('A tale.');
  expect(out.gear[0].name).toBe('Training Weights');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test services/character/input.test.js`
Expected: FAIL — `background` is untrimmed (only item names are handled today)

- [ ] **Step 3: Write minimal implementation**

Apply `trimStrings` to the cloned payload first, then delete the now-duplicated `.trim()` calls at `:26`, `:30`, `:33`, `:45`, `:48`, `:52`. Keep the `.trim()` inside the `::` split at `:48` only if the separator can leave inner whitespace — verify with the test above and remove it if not.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:unit && bun run test:http`
Expected: PASS. `models/character.test.js` and `models/character-update.test.js` cover this path heavily; any failure there means the consolidation changed behaviour and must be reverted, not patched.

- [ ] **Step 5: Commit**

```bash
git add services/character/input.js services/character/input.test.js
git commit -m "refactor: trim character input once at the boundary"
```

---

### Task 5: Normalize the model-level write paths

**Files:**
- Modify: `models/profile.js`, `models/pages.js`, `models/rules.js`, `models/nav.js`, `models/offscreen-mission.js`
- Test: `models/profile.test.js`, `models/pages.test.js`

These write with `.insert()` / `.update()` / `.upsert()` directly and have no service input layer, so nothing normalizes them. `profiles.name` (3 untrimmed) is the one that matters most: profile URLs are built from it (`views/class-view.handlebars:114` uses `encodeURIComponentH ownerProfile.name`), so a trailing space becomes `%20` in a shared link.

**Interfaces:**
- Produces: each write applies `trimStrings` to its payload immediately before handing it to the client.

- [ ] **Step 1: Write the failing test**

```js
// models/profile.test.js
test('trims the profile name before writing', async () => {
  await updateProfile({ name: 'Dave ' }, fakeClient);
  expect(captured.name).toBe('Dave');
});
```

Write the equivalent for `models/pages.js` (title and slug).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test models/profile.test.js models/pages.test.js`
Expected: FAIL — the trailing space reaches the client

- [ ] **Step 3: Write minimal implementation**

Wrap each write payload in `trimStrings(...)`. Five files, one call each.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add models/profile.js models/pages.js models/rules.js models/nav.js models/offscreen-mission.js models/profile.test.js models/pages.test.js
git commit -m "fix: trim whitespace on model-level writes"
```

---

### Task 6: Make the read-side merge whitespace-insensitive

**Files:**
- Modify: `services/character/repository.js:57-67` (gear), `:100-111` (abilities)
- Test: `services/character/repository.test.js`

This is the task that repairs the 43 broken rows' failure *mode* — the cleanup in Task 7 repairs the current data, this stops the same shape of defect ever being silently destructive again. It matters more here than it would with a database guard, because there is no database guard.

**Interfaces:**
- Produces: the class-JSONB join compares `String(x ?? '').trim()` on both sides.

- [ ] **Step 1: Write the failing test**

```js
// services/character/repository.test.js
test('merges a class item description despite a whitespace mismatch', async () => {
  const classes = [{ id: 'c1', gear: [{ name: 'Training Weights ', description: 'Heavy.' }] }];
  const rows = [{ name: 'Training Weights', class_id: 'c1', character_id: 'ch1' }];
  const [merged] = mergeClassGear(rows, classes);
  expect(merged.description).toBe('Heavy.');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test services/character/repository.test.js`
Expected: FAIL — `description` is undefined, exactly as it is for 43 rows in production today

- [ ] **Step 3: Write minimal implementation**

```js
// The class JSONB and the character row are written by different paths, so a
// whitespace difference between them must not silently blank a description --
// it did, for 43 character rows, invisibly.
const nameKey = (value) => String(value ?? '').trim();
const classGear = cls?.gear.find(g => nameKey(g.name) === nameKey(item.name));
```

Apply the same at both call sites.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:unit && bun run test:http`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/character/repository.js services/character/repository.test.js
git commit -m "fix: match class items on trimmed names when merging descriptions"
```

---

### Task 7: Clean up the existing data

**Files:**
- Create: `supabase/migrations/20260903000000_trim_existing_whitespace.sql`

**Interfaces:**
- Produces: zero untrimmed values in `public`.

- [ ] **Step 1: Record the before state**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -tAc "
select count(*) from class_gear g join classes cl on cl.id=g.class_id
join lateral jsonb_array_elements(cl.gear) e on true
where btrim(e->>'name') = btrim(g.name) and e->>'name' <> g.name;"
```

Expected against a production copy: a non-zero count (24 for gear). This is what the cleanup must drive to zero.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/20260903000000_trim_existing_whitespace.sql
-- 242 values carry leading/trailing whitespace, and it is not cosmetic: the
-- character sheet joins its stored item names against classes.abilities/gear by
-- exact string, so `Training Weights ` in the class row and `Training Weights`
-- on the character row silently render 43 rows with no description at all.
-- Every affected value was inspected; none has meaningful leading whitespace.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.data_type IN ('text', 'character varying')
      AND c.is_updatable = 'YES'
  LOOP
    EXECUTE format(
      'UPDATE public.%I SET %I = btrim(%I) WHERE %I IS NOT NULL AND %I <> btrim(%I)',
      r.table_name, r.column_name, r.column_name,
      r.column_name, r.column_name, r.column_name);
  END LOOP;
END $$;

-- The JSONB item arrays are the ones that actually break rendering. Rebuilt
-- with ORDINALITY because gear order is load-bearing: positions 1-3 are Base
-- gear and 4-6 Elective.
UPDATE public.classes SET abilities = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN jsonb_typeof(e) = 'object'
      THEN e || jsonb_strip_nulls(jsonb_build_object(
             'name', btrim(e->>'name'), 'description', btrim(e->>'description')))
      ELSE e END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(abilities) WITH ORDINALITY AS t(e, ord))
WHERE abilities IS NOT NULL AND jsonb_typeof(abilities) = 'array';

UPDATE public.classes SET gear = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN jsonb_typeof(e) = 'object'
      THEN e || jsonb_strip_nulls(jsonb_build_object(
             'name', btrim(e->>'name'), 'description', btrim(e->>'description')))
      ELSE e END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(gear) WITH ORDINALITY AS t(e, ord))
WHERE gear IS NOT NULL AND jsonb_typeof(gear) = 'array';
```

- [ ] **Step 3: Apply it and verify the repair**

```bash
supabase migration up
```

Re-run Step 1's query. Expected: `0`. Then confirm gear order survived:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -tAc "
select name, jsonb_array_length(gear), gear->0->>'name' from classes where name='Beastmaster';"
```

Expected: `6` and `Fearsome Visage` — the first Base item, unchanged. **A reordered array would silently swap Base and Elective gear for every character.**

- [ ] **Step 4: Confirm the 43 rows now render**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -tAc "
select count(*) from class_gear g join classes cl on cl.id=g.class_id
join lateral jsonb_array_elements(cl.gear) e on true
where e->>'name' = g.name and e->>'description' is not null;"
```

Expected: a count that now includes the previously-orphaned Shonen and Oddball rows.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260903000000_trim_existing_whitespace.sql
git commit -m "fix: trim existing whitespace in stored text and class item names"
```

---

### Task 8: The guard

**Files:**
- Create: `util/whitespace-integrity.integration.test.js`
- Modify: `scripts/run-tests.mjs` (`integrationFiles`)

With no database constraint, this test is the only thing that will notice the seventh write path nobody thought of. It is the deliverable that makes the app-layer approach hold.

**Interfaces:**
- Consumes: the local database.

- [ ] **Step 1: Write the test**

```js
// util/whitespace-integrity.integration.test.js
// There is no CHECK constraint enforcing this -- normalization happens in the
// application input layer only. That makes coverage the whole guard, and this
// test the thing that notices a write path which skipped it.
const { test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

test('no stored text value carries leading or trailing whitespace', async () => {
  const { data, error } = await sb.rpc('untrimmed_text_values');
  expect(error).toBeNull();
  expect(data).toEqual([]);
});
```

Back it with a `SECURITY DEFINER` function in the same migration file as the test's fixture, returning `(table_name, column_name, offending_rows)` by walking `information_schema` exactly as Task 7's cleanup does, plus the two JSONB arrays.

- [ ] **Step 2: Run it to verify it passes on clean data**

Run: `bun run test:integration`
Expected: PASS

- [ ] **Step 3: Verify it actually catches a regression**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -c "update classes set name = name || ' ' where name = 'Beastmaster';"
bun run test:integration; echo "exit=$?"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -c "update classes set name = btrim(name) where name like 'Beastmaster%';"
```

Expected: the middle command FAILS, naming `classes.name`. **A test that cannot fail here is not a guard — fix it before continuing.**

- [ ] **Step 4: Register it**

```bash
sed -i "s#'util/core-roster.integration.test.js'#'util/core-roster.integration.test.js',\n  'util/whitespace-integrity.integration.test.js'#" scripts/run-tests.mjs
bun run test:integration && bun run test:unit && bun run test:http
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add util/whitespace-integrity.integration.test.js scripts/run-tests.mjs
git commit -m "test: fail when stored text carries untrimmed whitespace"
```

---

## Self-Review

**Spec coverage.** Recursive helper over a field list → Task 1. Every write path → Tasks 2 (class), 3 (mission, LFG), 4 (character), 5 (five models). Read side stops caring → Task 6. One-time cleanup of 242 values → Task 7. Verification → Task 8. `services/feedback/input.js` left alone, per the spec.

**Placeholders.** Task 3 and Task 5 describe the second and subsequent call sites rather than transcribing near-identical code; the first is written out in full and the contract is fixed by the tests. Task 8's `untrimmed_text_values` function is specified by signature and by the exact `information_schema` walk Task 7 already contains in full.

**Type consistency.** `trimStrings(value, options, path)` has the same signature in Tasks 1-5. `nameKey` in Task 6 matches the `.trim()` already applied to the write-side map keys at `models/class.js:480,491`, so both ends of the join now normalize identically.

**Interaction with the pre-release import.** Task 7 renames `Zoologist ` to `Zoologist` and `Onmyōji ` to `Onmyōji`. That removes the trailing-space case from the import loader's name resolution, but the loader must still trim when matching — production is not the only database it will run against, and this plan may land after it.
