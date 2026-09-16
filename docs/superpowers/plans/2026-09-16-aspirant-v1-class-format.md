# Aspirant V1 Class Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the class catalog to represent Aspirant V1-format content — a
separate format axis, four-column Signatures, expanded tips and superscript
Power Ratings — so a V1 class can be authored, rendered, forked and exported
before any book content is ingested.

**Architecture:** `rules_edition` is split into two axes. It keeps meaning "which
book grants this class"; a new `content_format` column carries the content shape.
The version-family firewall gains `content_format` to its edge rule, so a format
fork starts a new family and moving to an Aspirant class becomes a deliberate
player decision rather than something that happens underneath an existing
character. The gear contract gains `column`/`position`, the class gains
`expanded_tips`, and Power Ratings are stored as `<sup>` and rendered through a
narrow sanitizer.

**Tech Stack:** Bun, Express 4, express-handlebars, Alpine.js (CDN), Bulma,
Supabase/Postgres, `bun:test`, Playwright, `sanitize-html`.

**Spec:** `docs/superpowers/specs/2026-09-16-aspirant-v1-ingestion-design.md`

**This is plan 1 of 2 for slice 3.** It covers every part of the spec that can be
built and fully tested without the book. Plan 2 covers extraction, verification,
loading the twelve V1 classes, the unlock roster (which needs ids that only exist
after the load) and the `class_abilities` re-tag (which must run *after* the load
or it repeats slice 2's no-op backfill). Plan 2 is written once this plan lands,
so its extractor tasks can be specified against real captured geometry fixtures
rather than guessed ones.

## Global Constraints

- **Never run `supabase db reset`.** The local database holds a restored
  production copy, not seed data. Apply schema changes with
  `supabase migration up`, which leaves data in place.
- **`.env` is hand-switched between the local stack and the LIVE PRODUCTION
  Supabase project.** Read `SUPABASE_URL` before anything that writes. Prefer
  deriving credentials from `eval "$(supabase status -o env)"` and asserting the
  API URL is `http://127.0.0.1:54321`.
- `bun run test:unit` is always safe — `scripts/run-tests.mjs` overrides
  `SUPABASE_URL` to `https://test.invalid`. `bun test <file>` directly does NOT
  get those overrides.
- Never read or restore anything under `backups/`.
- **Ten test failures predate this branch and must not be mistaken for new
  breakage:** 1 http (`routes/open-graph.test.js`), 3 integration
  (`character-content-integrity`, `image-crop-integrity`, and
  `class-form-round-trip` which reports 2 fail / 1 pass), 6 e2e
  (`22-classes-crud` ×5, `18-book-class-unlocks` ×1).
- `util/class-form-round-trip.integration.test.js` sweeps every live class and
  reports stored values that would change on their next save — trailing
  whitespace, CRLF line endings, blank strings converging to NULL — across some
  forty classes. That is drift in the restored production data, not a code
  defect, and no task in this plan fixes it. Judge that file by whether your
  change adds a NEW failure, never by whether it passes.

**Running a single integration test file.** `bun run test:integration <file>`
does NOT work — `scripts/run-tests.mjs:47` reads `argv[2]` as the *mode*, so a
file argument is silently ignored and the whole integration set runs, exiting at
the first pre-existing failure. Use this instead, which is safe because
`supabase status -o env` reports the local stack by construction and every
integration file also requires `util/require-local-supabase`:

```bash
eval "$(supabase status -o env)"
SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" \
SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test <file>
```

- `CREATE OR REPLACE FUNCTION` has no partial form. Every RPC revision restates
  the whole body.
- **No dead code.** When you replace something, delete the thing it replaced.
- Comments explain non-obvious *why* only. Never restate *what*, never narrate
  history.
- `content_format` values are exactly `'advent'` and `'aspirant'`. The column
  default is `'advent'`.
- `expanded_tips` default is exactly `'{"player": [], "conduit": []}'::jsonb`.
- Gear `column` is `1..4`, `position` is `1..3`.

---

### Task 1: Repair the pre-release verifier

`scripts/verify-prerelease-extract.mjs` has been unrunnable since `e55f998`.
`CHARLATAN` was appended to the artifact by hand with no `page_range` key, and
`sectionPages` computes `Math.max(...rows.map((row) => row.page_range[1]))`,
which throws on `undefined[1]` before anything is verified. Plan 2 builds a
second verifier on this one's design, so the first must be known-good.

**Files:**
- Modify: `scripts/verify-prerelease-extract.mjs:386-398`
- Create: `util/prerelease-pages.js`
- Test: `util/prerelease-pages.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `util/prerelease-pages.js` exporting
  `coveredPages(rows) -> Set<number>` and `maxCoveredPage(rows) -> number`.
  Rows without a `page_range` contribute nothing to either. Plan 2 reuses both.

- [ ] **Step 1: Write the failing test**

Create `util/prerelease-pages.test.js`:

```js
const { test, expect, describe } = require('bun:test');
const { coveredPages, maxCoveredPage } = require('./prerelease-pages');

describe('coveredPages', () => {
  test('covers every page in each inclusive range', () => {
    expect(coveredPages([{ page_range: [3, 5] }])).toEqual(new Set([3, 4, 5]));
  });

  test('a record with no page_range contributes nothing', () => {
    expect(coveredPages([{ page_range: [3, 4] }, { name: 'CHARLATAN' }]))
      .toEqual(new Set([3, 4]));
  });
});

describe('maxCoveredPage', () => {
  test('is the highest page of any range', () => {
    expect(maxCoveredPage([{ page_range: [3, 5] }, { page_range: [9, 12] }])).toBe(12);
  });

  test('a record with no page_range does not throw', () => {
    expect(maxCoveredPage([{ page_range: [3, 5] }, { name: 'CHARLATAN' }])).toBe(5);
  });

  test('no ranges at all yields 0 rather than -Infinity', () => {
    expect(maxCoveredPage([{ name: 'CHARLATAN' }])).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test:unit util/prerelease-pages.test.js`
Expected: FAIL — `Cannot find module './prerelease-pages'`.

- [ ] **Step 3: Write the minimal implementation**

Create `util/prerelease-pages.js`:

```js
// A record hand-added to the artifact after extraction carries no page_range,
// so it cannot be located in the PDF and cannot be verified against it. Both
// helpers skip such a record rather than letting it abort the whole run.
const ranges = (rows) => (Array.isArray(rows) ? rows : [])
  .map((row) => row && row.page_range)
  .filter((range) => Array.isArray(range) && range.length === 2);

const coveredPages = (rows) => {
  const covered = new Set();
  for (const [first, last] of ranges(rows)) {
    for (let page = first; page <= last; page += 1) covered.add(page);
  }
  return covered;
};

const maxCoveredPage = (rows) => ranges(rows)
  .reduce((highest, [, last]) => Math.max(highest, last), 0);

module.exports = { coveredPages, maxCoveredPage };
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run test:unit util/prerelease-pages.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Use the helpers in the verifier**

In `scripts/verify-prerelease-extract.mjs`, add to the imports at the top:

```js
import { coveredPages, maxCoveredPage } from '../util/prerelease-pages.js';
```

Replace the body of `sectionPages` (`:386-398`) so it reads:

```js
const sectionPages = (rows) => {
  const covered = coveredPages(rows);
  const found = [];
  for (let page = 1; page <= maxCoveredPage(rows); page += 1) {
    if (covered.has(page)) continue;
    const heading = (pageLines(page).find((line) => line.trim()) || '').trim();
    if (SECTION_HEADINGS.includes(heading)) found.push({ page, heading });
  }
  return found;
};
```

Delete the now-unused local `covered` construction loop — the helper replaces it.

- [ ] **Step 6: Skip the unverifiable record in the driver loop**

A record with no `page_range` cannot be located in the PDF. In the driver loop
(`:414-427`), before the per-class verification, add:

```js
  if (!Array.isArray(row.page_range)) {
    console.log(`skip ${row.name} — no page_range, not locatable in the PDF`);
    continue;
  }
```

- [ ] **Step 7: Run the verifier end to end**

Run:
```bash
bun scripts/verify-prerelease-extract.mjs ~/Downloads/Current_Pre-Release_Classes__Aug__2026_.pdf
```
Expected: it runs to completion instead of throwing. It prints one `ok`/`FAIL`
line per class plus one `skip CHARLATAN` line, and exits 0 if the 19 verifiable
classes pass.

**If any class FAILs:** do not "fix" the artifact. Record the failures verbatim
in the task report and stop — a genuine extraction defect in the committed
artifact is a finding for the user, not something to paper over.

- [ ] **Step 8: Run the full unit suite**

Run: `bun run test:unit`
Expected: 0 failures.

- [ ] **Step 9: Commit**

```bash
git add util/prerelease-pages.js util/prerelease-pages.test.js scripts/verify-prerelease-extract.mjs
git commit -m "fix: let the verifier run past a record with no page_range"
```

---

### Task 2: The `content_format` column

**Files:**
- Create: `supabase/migrations/20260916000000_class_content_format.sql`
- Create: `supabase/migrations/20260916000001_dup_class_content_format.sql`
- Test: `util/class-structured-columns.integration.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `classes.content_format`, `text NOT NULL DEFAULT 'advent'`,
  `CHECK (content_format IN ('advent','aspirant'))`. Every task after this one
  may assume the column exists on every row.

- [ ] **Step 1: Write the failing test**

Append to `util/class-structured-columns.integration.test.js`, following the
file's existing `describe`/`test` style:

```js
describe('classes.content_format', () => {
  test('defaults to advent and is never null', async () => {
    const { data, error } = await supabaseAdmin
      .from('classes')
      .select('id, content_format');
    expect(error).toBeNull();
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((row) => row.content_format === 'advent')).toBe(true);
  });

  test('rejects a value outside the enum', async () => {
    const { error } = await supabaseAdmin
      .from('classes')
      .update({ content_format: 'aspirant-v1' })
      .eq('name', 'Berserker');
    expect(error).not.toBeNull();
    expect(error.code).toBe('23514');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

First confirm you are on local:
```bash
eval "$(supabase status -o env)" && echo "$API_URL"
```
Expected: `http://127.0.0.1:54321`. **If it is anything else, stop.**

Run the single-file integration command from Global Constraints on `util/class-structured-columns.integration.test.js`
Expected: FAIL — `column classes.content_format does not exist`.

- [ ] **Step 3: Write the column migration**

Create `supabase/migrations/20260916000000_class_content_format.sql`:

```sql
-- rules_edition answers which book grants a class. It has been doing double
-- duty as the answer to what shape that class's content is, which held only
-- while the two coincided. The six pre-release Aspirant classes are where they
-- diverge: 20260818000000_retag_aspirant_classes.sql tagged them 'aspirant' so
-- the unlock resolver and the family firewall would reach them, but their
-- content is the Advent six-Signature shape.
--
-- 'advent' is six Signatures and three Abilities. 'aspirant' is twelve
-- Signatures, three Core and three Advanced Abilities, Enchantments and Sample
-- Perks. The default makes every existing row correct with no backfill.
ALTER TABLE public.classes
    ADD COLUMN content_format text NOT NULL DEFAULT 'advent'
        CHECK (content_format IN ('advent', 'aspirant'));
```

- [ ] **Step 4: Apply it and confirm the test passes**

Run: `supabase migration up`
Then run the single-file integration command from Global Constraints on `util/class-structured-columns.integration.test.js`
Expected: PASS.

- [ ] **Step 5: Restate `dup_class`**

`dup_class` names its columns explicitly and has silently dropped two columns
this way already — `advanced_abilities` and `free_play_access`, both repaired in
`20260912000001_dup_class_advanced_abilities.sql`, whose header comment records
the hazard. A new column added without touching it is dropped by every fork.

Copy `supabase/migrations/20260912000001_dup_class_advanced_abilities.sql`
verbatim to `supabase/migrations/20260916000001_dup_class_content_format.sql`,
then make exactly two edits:

1. Add `content_format` to the INSERT column list, immediately after
   `advanced_abilities`.
2. Add `content_format` to the SELECT list at the matching position.

`content_format` is copied from the source row unchanged — unlike
`rules_edition`, it takes no retarget parameter, because an admin forking a class
in the UI is making a version fork, not converting its content shape.

Replace the migration's header comment with one describing what this revision
adds. Do not narrate the previous revisions.

- [ ] **Step 6: Verify the restatement is exactly two hunks**

Run:
```bash
diff <(sed 1,10d supabase/migrations/20260912000001_dup_class_advanced_abilities.sql) \
     <(sed 1,10d supabase/migrations/20260916000001_dup_class_content_format.sql)
```
Expected: exactly two hunks, each adding one `content_format` line. Adjust the
`sed` line count so it skips each file's header comment. **If there are more than
two hunks, you have changed something you did not intend to.**

- [ ] **Step 7: Apply and confirm the fork carries the column**

Run: `supabase migration up`
Then run the single-file integration command from Global Constraints on `util/class-duplicate.integration.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260916000000_class_content_format.sql \
        supabase/migrations/20260916000001_dup_class_content_format.sql \
        util/class-structured-columns.integration.test.js
git commit -m "feat: add classes.content_format and carry it through dup_class"
```

---

### Task 3: A format fork starts a new family

**Files:**
- Modify: `util/class-family.js:1-7`
- Modify: `services/class/repository.js:47,62`
- Test: `util/class-family.test.js`

**Interfaces:**
- Consumes: `classes.content_format` from Task 2.
- Produces: `sameEditionEdge` requires matching `rules_edition` AND matching
  `content_format`. `computeVersionFamily` and `expandIdsToFamilies` keep their
  existing signatures; callers must supply rows carrying `content_format`.

**Critical:** `services/class/repository.js:47` and `:62` select explicit column
lists. Without adding `content_format` to both, this change is a **silent
no-op** — the same defect shape that bit `save_character_atomic` in slice 2.

- [ ] **Step 1: Write the failing test**

In `util/class-family.test.js`, extend the `cls` helper at the top of the file to
take a format, and add a describe block:

```js
const cls = (id, base = null, edition = 'advent', format = 'advent') => ({
  id,
  base_class_id: base,
  rules_edition: edition,
  content_format: format
});
```

```js
describe('format forks', () => {
  test('a format fork starts a new family', () => {
    const classes = [
      cls('prerelease', null, 'aspirant', 'advent'),
      cls('v1', 'prerelease', 'aspirant', 'aspirant')
    ];
    expect(computeVersionFamily(classes, 'prerelease')).toEqual(new Set(['prerelease']));
    expect(computeVersionFamily(classes, 'v1')).toEqual(new Set(['v1']));
  });

  test('a same-format fork stays one family', () => {
    const classes = [
      cls('v1', null, 'aspirant', 'aspirant'),
      cls('v2', 'v1', 'aspirant', 'aspirant')
    ];
    expect(computeVersionFamily(classes, 'v1')).toEqual(new Set(['v1', 'v2']));
  });

  test('a fork differing on both edition and format starts a new family', () => {
    const classes = [
      cls('advent', null, 'advent', 'advent'),
      cls('aspirant', 'advent', 'aspirant', 'aspirant')
    ];
    expect(computeVersionFamily(classes, 'advent')).toEqual(new Set(['advent']));
  });

  test('a row whose query omitted content_format fails closed against a tagged row', () => {
    const classes = [
      { id: 'untagged', base_class_id: null, rules_edition: 'aspirant' },
      cls('v1', 'untagged', 'aspirant', 'aspirant')
    ];
    expect(computeVersionFamily(classes, 'v1')).toEqual(new Set(['v1']));
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test:unit util/class-family.test.js`
Expected: **exactly two failures** — `a format fork starts a new family` and
`a row whose query omitted content_format fails closed against a tagged row`.
Both return two ids because the current edge rule compares only `rules_edition`
and both rows in each case are `'aspirant'`, so the edge forms.

The other two pass before the change and are regression guards, not red tests:
the same-format fork must keep working, and the edition fork is already excluded
by the existing rule. If either of those fails, stop — the existing behavior is
not what this task assumes.

- [ ] **Step 3: Change the edge rule**

In `util/class-family.js`, replace the header comment and `sameEditionEdge`:

```js
// Version families: classes linked via base_class_id form an upgrade chain
// (v1 -> v2 forks). A family is the connected component over those links,
// restricted to edges where parent and child share BOTH rules_edition and
// content_format. An edition fork (advent -> aspirant) and a format fork
// (six Signatures -> twelve) each start a new family.
//
// Unlocks apply to a whole family, so this must never cross either boundary.
// Moving a character to a differently shaped class is a deliberate player
// decision, and a family that bridged the two would make it happen silently.
//
// The comparison is strict, so a row from a query that forgot to select
// content_format compares unequal to a tagged one and the edge is dropped.
// That fails closed: a missed column splits a family rather than bridging two.
const sameFamilyEdge = (parent, child) => parent.rules_edition === child.rules_edition
  && parent.content_format === child.content_format;
```

Rename every use of `sameEditionEdge` in the file to `sameFamilyEdge`. There are
two, at the down-edge index and the up-edge walk. Delete the old name entirely.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run test:unit util/class-family.test.js`
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 5: Add the column to both lean projections**

In `services/class/repository.js`, add `content_format` to both explicit selects:

- `:47` becomes
  `.select('id, base_class_id, rules_edition, content_format, free_play_access');`
- `:62` becomes
  `.select('id, name, is_public, base_class_id, rules_edition, content_format, gear, abilities');`

- [ ] **Step 6: Prove the projections carry it**

Add to `util/class-structured-columns.integration.test.js`:

```js
test('the family projection carries content_format', async () => {
  const rows = await require('../services/class/repository').fetchClassFamilyRows();
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => typeof row.content_format === 'string')).toBe(true);
});
```

Run the single-file integration command from Global Constraints on `util/class-structured-columns.integration.test.js`
Expected: PASS.

- [ ] **Step 7: Run the four consumers' suites**

Run:
```bash
bun run test:unit util/class-list-grouping.test.js services/class/item-uniqueness.test.js
bun run test:unit
```
Expected: 0 failures. Every existing row is `'advent'`, so no existing family
changes shape.

- [ ] **Step 8: Commit**

```bash
git add util/class-family.js util/class-family.test.js \
        services/class/repository.js util/class-structured-columns.integration.test.js
git commit -m "feat: a format fork starts a new version family"
```

---

### Task 4: Gear `column` and `position`

**Files:**
- Modify: `util/class-gear.js:82-120,168-196`
- Test: `util/class-gear.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeGear` emits eight keys per item — `name`, `description`,
  `category`, `meters`, `notes`, `default_enchantment`, `column`, `position`.
  `gearCategory(category, index)` keeps its signature. New exports
  `gearColumn(index) -> 1..4`, `gearPosition(index) -> 1..3`, and — because Task
  5 needs them and they are module-private today — `indexedRows(value)` and
  `normalizeNote(row) -> { text, children: [] } | null`.

- [ ] **Step 1: Write the failing test**

Add to `util/class-gear.test.js`:

```js
const { normalizeGear, gearColumn, gearPosition } = require('./class-gear');

describe('gearColumn and gearPosition', () => {
  test('three items fill a column before the next one starts', () => {
    expect([0, 1, 2, 3, 4, 5].map(gearColumn)).toEqual([1, 1, 1, 2, 2, 2]);
    expect([0, 1, 2, 3, 4, 5].map(gearPosition)).toEqual([1, 2, 3, 1, 2, 3]);
  });

  test('a twelve-item roster fills four columns', () => {
    expect([6, 7, 8, 9, 10, 11].map(gearColumn)).toEqual([3, 3, 3, 4, 4, 4]);
    expect([6, 7, 8, 9, 10, 11].map(gearPosition)).toEqual([1, 2, 3, 1, 2, 3]);
  });
});

describe('normalizeGear column contract', () => {
  test('every item carries column and position', () => {
    const items = normalizeGear([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }]);
    expect(items.map((item) => [item.column, item.position]))
      .toEqual([[1, 1], [1, 2], [1, 3], [2, 1]]);
  });

  test('category still derives from the column: 1 is default, 2-4 are elective', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
    const items = normalizeGear(names.map((name) => ({ name })));
    expect(items.map((item) => item.category)).toEqual([
      'default', 'default', 'default',
      'elective', 'elective', 'elective',
      'elective', 'elective', 'elective',
      'elective', 'elective', 'elective'
    ]);
  });

  test('a stored category still wins over the positional default', () => {
    const items = normalizeGear([{ name: 'A', category: 'elective' }]);
    expect(items[0].category).toBe('elective');
    expect(items[0].column).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test:unit util/class-gear.test.js`
Expected: FAIL — `gearColumn is not a function`, and the normalizeGear tests fail
on the missing `column`/`position` keys.

- [ ] **Step 3: Implement**

In `util/class-gear.js`, add above `gearCategory`:

```js
// The book prints a class's Signatures in four columns of three across a
// two-page spread and gives the column meaning: "Each of a Class's four columns
// of Signature Items are ordered by complexity and alignment with that Class's
// general game plan" (ENCLAVE: Aspirant, pg. 11). Neither index is printed, so
// both are derived from the item's position in the saved list.
const ITEMS_PER_COLUMN = 3;
const gearColumn = (index) => Math.floor(index / ITEMS_PER_COLUMN) + 1;
const gearPosition = (index) => (index % ITEMS_PER_COLUMN) + 1;
```

Replace `gearCategory`'s fallback expression so the rule reads in column terms.
Change the `BASE_GEAR_COUNT` constant and its comment to:

```js
// Under V1 Signatures are no longer split into Default and Elective rosters.
// The book's backwards-compatibility rule (ENCLAVE: Aspirant, pg. 2) reads the
// first column as the Default Roster and the second as the Elective, so
// `category` survives as the compatibility view of a four-column roster rather
// than as a fact about it: column 1 is Default, every other column Elective.
//
// With three items to a column that is arithmetically identical to the old
// `index < 3` test, so all fifty live six-item classes keep the category they
// have, and twelve items need no second branch.
const DEFAULT_ROSTER_COLUMN = 1;
```

and the fallback to:

```js
        : (gearColumn(index) === DEFAULT_ROSTER_COLUMN ? 'default' : 'elective');
```

Delete `BASE_GEAR_COUNT` and the comment paragraph that explained the
`index < BASE_GEAR_COUNT` split. Keep the R76 reversal paragraph — it is still
the reason `index` is the saved position.

Add the two keys to `normalizeGear`'s emitted object:

```js
        column: gearColumn(index),
        position: gearPosition(index),
```

Update the contract paragraph above `normalizeGear` to name all eight keys and
restate the census: the pre-Aspirant census over the 300 live gear items answered
`{category, description, name}` and `{category, description, meters, name,
notes}`; a stored item picks up `default_enchantment`, `column` and `position` on
its next save.

Export the new helpers, plus the two note helpers Task 5 needs. `indexedRows`
(`util/class-gear.js:53`) and `normalizeNote` (`:137`) are module-private today:

```js
module.exports = {
    normalizeGear, gearCategory, gearColumn, gearPosition, indexedRows, normalizeNote
};
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run test:unit util/class-gear.test.js`
Expected: PASS.

- [ ] **Step 5: Fix the second copy of the census**

`routes/classes-structured-fields.test.js:985-1011` states the census a second
time and asserts a two-field gear item comes back as the full shape. Update both
the comment and the expected object to include `column: 1` and `position: 1`.

- [ ] **Step 6: Run the full unit suite**

Run: `bun run test:unit`
Expected: 0 failures. Fix any test that asserted an exact gear key set.

- [ ] **Step 7: Commit**

```bash
git add util/class-gear.js util/class-gear.test.js routes/classes-structured-fields.test.js
git commit -m "feat: give every Signature a column and position"
```

---

### Task 5: `expanded_tips`

**Files:**
- Create: `supabase/migrations/20260916000002_class_expanded_tips.sql`
- Create: `supabase/migrations/20260916000003_dup_class_expanded_tips.sql`
- Create: `util/class-expanded-tips.js`
- Test: `util/class-expanded-tips.test.js`

**Interfaces:**
- Consumes: `normalizeNote`'s two-level note shape, `{ text, children: [] }`.
- Produces: `normalizeExpandedTips(value) -> { player: [note], conduit: [note] }`,
  always both keys, always arrays. Task 7 calls it from both write handlers and
  Task 8 renders it.

- [ ] **Step 1: Write the failing test**

Create `util/class-expanded-tips.test.js`:

```js
const { test, expect, describe } = require('bun:test');
const { normalizeExpandedTips } = require('./class-expanded-tips');

describe('normalizeExpandedTips', () => {
  test('always returns both keys as arrays', () => {
    expect(normalizeExpandedTips(undefined)).toEqual({ player: [], conduit: [] });
    expect(normalizeExpandedTips(null)).toEqual({ player: [], conduit: [] });
    expect(normalizeExpandedTips('nonsense')).toEqual({ player: [], conduit: [] });
  });

  test('keeps text and nests children', () => {
    const value = {
      player: [{ text: 'Look for angles', children: [{ text: 'around cover' }] }],
      conduit: [{ text: 'Force repositioning' }]
    };
    expect(normalizeExpandedTips(value)).toEqual({
      player: [{ text: 'Look for angles', children: [{ text: 'around cover', children: [] }] }],
      conduit: [{ text: 'Force repositioning', children: [] }]
    });
  });

  test('drops blank rows and blank children', () => {
    const value = {
      player: [{ text: '  ' }, { text: 'Real', children: [{ text: '' }] }],
      conduit: []
    };
    expect(normalizeExpandedTips(value)).toEqual({
      player: [{ text: 'Real', children: [] }],
      conduit: []
    });
  });

  test('an extra key is not carried through', () => {
    expect(normalizeExpandedTips({ player: [], conduit: [], designer: [{ text: 'x' }] }))
      .toEqual({ player: [], conduit: [] });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test:unit util/class-expanded-tips.test.js`
Expected: FAIL — `Cannot find module './class-expanded-tips'`.

- [ ] **Step 3: Implement**

Create `util/class-expanded-tips.js`. Reuse the note normalization already in
`util/class-gear.js` rather than writing a third copy; Task 4 exported
`indexedRows` and `normalizeNote` for exactly this.

```js
const { normalizeNote, indexedRows } = require('./class-gear');

// The Expanded Tips page is a per-class section separate from the cover's Quick
// Tips, with one list addressed to the player and one to the Conduit
// (ENCLAVE: Aspirant, pg. 11). Both keys are always present so the column has
// one shape, the way advanced_abilities is always an array.
const TIP_AUDIENCES = ['player', 'conduit'];

const normalizeExpandedTips = (value) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(TIP_AUDIENCES.map((audience) => [
    audience,
    indexedRows(source[audience]).map(normalizeNote).filter(Boolean)
  ]));
};

module.exports = { normalizeExpandedTips, TIP_AUDIENCES };
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run test:unit util/class-expanded-tips.test.js`
Expected: PASS.

- [ ] **Step 5: Write the column migration**

Create `supabase/migrations/20260916000002_class_expanded_tips.sql`:

```sql
-- The Expanded Tips page is a per-class section separate from the cover's Quick
-- Tips, which continues to fill classes.tips. One list is addressed to the
-- player and one to the Conduit, so folding them together would lose the
-- distinction that gives the section its purpose.
--
-- NOT NULL with a shaped default, matching advanced_abilities: no class-content
-- column is nullable, and a reader should never have to decide what a null list
-- means.
ALTER TABLE public.classes
    ADD COLUMN expanded_tips jsonb NOT NULL
        DEFAULT '{"player": [], "conduit": []}'::jsonb;
```

- [ ] **Step 6: Restate `dup_class` again**

Copy `supabase/migrations/20260916000001_dup_class_content_format.sql` to
`supabase/migrations/20260916000003_dup_class_expanded_tips.sql` and add
`expanded_tips` to the INSERT column list and the SELECT list, immediately after
`content_format`. Replace the header comment.

Verify with the same two-hunk diff check used in Task 2 Step 6.

- [ ] **Step 7: Apply and test**

Run: `supabase migration up`

Add to `util/class-structured-columns.integration.test.js`:

```js
test('expanded_tips is never null and rejects an explicit null', async () => {
  const { data } = await supabaseAdmin.from('classes').select('id, expanded_tips');
  expect(data.every((row) => row.expanded_tips !== null)).toBe(true);

  const { error } = await supabaseAdmin
    .from('classes')
    .update({ expanded_tips: null })
    .eq('name', 'Berserker');
  expect(error).not.toBeNull();
  expect(error.code).toBe('23502');
});
```

Run the single-file integration command from Global Constraints on `util/class-structured-columns.integration.test.js util/class-duplicate.integration.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260916000002_class_expanded_tips.sql \
        supabase/migrations/20260916000003_dup_class_expanded_tips.sql \
        util/class-expanded-tips.js util/class-expanded-tips.test.js \
        util/class-gear.js util/class-structured-columns.integration.test.js
git commit -m "feat: add classes.expanded_tips"
```

---

### Task 6: Render Power Ratings as superscripts

The book prints Power Ratings as superscripts attached to a word mid-sentence —
`are Boosted <sup>L–H</sup>`, `substantially <sup>H</sup> healed`. Stored flat
the rating is indistinguishable from a word, so it is stored as `<sup>`.

Only `description` currently renders through a sanitizer
(`views/class-view.handlebars:147,255,275,298,322`). Ratings also appear in
`paired_action`, notes, `sample_perks[].text`, `compound_text` and enchantment
descriptions, all of which escape and would show a literal tag.

**Files:**
- Modify: `util/markdown.js`
- Modify: `views/partials/class-sample-perks.handlebars`
- Modify: `views/partials/class-enchantment.handlebars`
- Modify: `views/partials/class-notes.handlebars`
- Modify: `views/class-view.handlebars` (the two `paired_action` lines)
- Test: `util/markdown.test.js`, `views/class-view.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `renderPowerRatings(input) -> string` exported from
  `util/markdown.js`, registered as the handlebars helper `powerRatings`.

**Design note — this deviates from the spec, in the same direction.** The spec
said these fields "move to `{{{markdown …}}}`". Full markdown would *newly
interpret* `*`, `_` and `#` in content that has been inert until now, which risks
mangling stored text for no benefit. A narrow sanitizer that permits only `<sup>`
achieves what the spec asked for — ratings render, the sanitizer makes it safe —
without that side effect. Record this in the task report.

- [ ] **Step 1: Write the failing test**

Add to `util/markdown.test.js`:

```js
const { renderPowerRatings } = require('./markdown');

describe('renderPowerRatings', () => {
  test('keeps a superscript power rating', () => {
    expect(renderPowerRatings('are Boosted <sup>L–H</sup>'))
      .toBe('are Boosted <sup>L–H</sup>');
  });

  test('strips a script tag and its contents', () => {
    expect(renderPowerRatings('<script>alert(1)</script>tail')).toBe('tail');
  });

  test('strips an image with an event handler', () => {
    expect(renderPowerRatings('<img src=x onerror=alert(1)>')).toBe('');
  });

  test('strips a javascript: link but keeps its text', () => {
    expect(renderPowerRatings('<a href="javascript:alert(1)">x</a>')).toBe('x');
  });

  test('strips an event handler from the sup tag itself', () => {
    expect(renderPowerRatings('<sup onclick="x">L</sup>')).toBe('<sup>L</sup>');
  });

  test('escapes stray angle brackets', () => {
    expect(renderPowerRatings('5 < 6')).toBe('5 &lt; 6');
  });

  test('does not interpret markdown syntax', () => {
    expect(renderPowerRatings('*not* _em_ # nor')).toBe('*not* _em_ # nor');
  });

  test('empty input yields an empty string', () => {
    expect(renderPowerRatings(null)).toBe('');
    expect(renderPowerRatings(undefined)).toBe('');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test:unit util/markdown.test.js`
Expected: FAIL — `renderPowerRatings is not a function`.

- [ ] **Step 3: Implement**

Add to `util/markdown.js`, above `module.exports`:

```js
// Power Ratings are printed as superscripts throughout Aspirant
// (ENCLAVE: Aspirant, pg. 12) and are stored that way, because "Boosted L–H"
// flattened into prose reads as an ordinary word.
//
// Deliberately not renderMarkdown: these fields hold content any signed-in user
// can write through the class import endpoint, and running them through a full
// markdown parser would start interpreting asterisks and underscores that have
// been literal text until now. Permitting exactly one tag keeps the change to
// the one thing it is for.
const renderPowerRatings = (input) => sanitizeHtml(String(input ?? ''), {
  allowedTags: ['sup'],
  allowedAttributes: {}
});
```

Add it to the exports:

```js
module.exports = { renderMarkdown, renderPowerRatings };
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run test:unit util/markdown.test.js`
Expected: PASS.

- [ ] **Step 5: Register the helper**

Helpers are registered in the express-handlebars config in `app.js`. `markdown:
renderMarkdown` is at `app.js:37`; the import is at `app.js:5`. Add
`powerRatings` beside it:

```js
const { renderMarkdown, renderPowerRatings } = require('./util/markdown');
```

```js
  markdown: renderMarkdown,
  powerRatings: renderPowerRatings
```

The existing `markdown` helper returns a bare string and every call site uses a
triple-stash, so `powerRatings` does the same. Do not wrap it in `SafeString` —
that would diverge from the established pattern for no reason.

- [ ] **Step 6: Use it in the four render sites**

`views/partials/class-sample-perks.handlebars` — the perk text and the compounded
line:

```handlebars
    <p class="mb-1">{{{powerRatings this.text}}}</p>
    {{#if this.compound_text}}
    <p class="pl-4 has-text-grey"><em>Compounded:</em> {{{powerRatings this.compound_text}}}</p>
    {{/if}}
```

`views/partials/class-enchantment.handlebars` — the description:

```handlebars
  <p>{{{powerRatings enchantment.description}}}</p>
```

`views/partials/class-notes.handlebars` — both levels:

```handlebars
    {{{powerRatings this.text}}}
```
```handlebars
      {{#each this.children}}<li>{{{powerRatings this.text}}}</li>{{/each}}
```

`views/class-view.handlebars` — both `paired_action` lines (`:301` and `:325`
before this task's edits shift them):

```handlebars
                <p><strong>Paired Action:</strong> {{{powerRatings this.paired_action}}}</p>
```

- [ ] **Step 7: Prove the rendered page is safe**

`views/class-view.test.js` reads the template as a *string* and asserts on its
source; it has no server-render harness, so these assertions cannot go there.
Build one following the pattern in `views/partials/feedback-widget.test.js:4-20`
— `Handlebars.create()`, register the partials the template needs, compile,
render.

Create `views/partials/class-content-render.test.js`:

```js
const { test, expect, describe } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const { renderPowerRatings } = require('../../util/markdown');

const partial = (name) => fs.readFileSync(
  path.join(__dirname, `${name}.handlebars`), 'utf8'
);

const renderPartial = (name, context) => {
  const handlebars = Handlebars.create();
  handlebars.registerHelper('powerRatings', renderPowerRatings);
  for (const dependency of ['class-notes', 'class-sample-perks', 'class-enchantment']) {
    handlebars.registerPartial(dependency, partial(dependency));
  }
  return handlebars.compile(partial(name))(context);
};

describe('power ratings in class content partials', () => {
  test('a rating renders as a superscript in perk text', () => {
    const html = renderPartial('class-sample-perks', {
      perks: [{ name: 'P', text: 'Boosted <sup>L–H</sup>', dedication: null, compound_text: null }]
    });
    expect(html).toContain('<sup>L–H</sup>');
  });

  test('a hostile string in perk text is neutralized', () => {
    const html = renderPartial('class-sample-perks', {
      perks: [{
        name: 'P',
        text: '<img src=x onerror=alert(1)>',
        dedication: null,
        compound_text: '<a href="javascript:alert(2)">c</a>'
      }]
    });
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
  });

  test('a hostile string in a note is neutralized at both levels', () => {
    const html = renderPartial('class-notes', {
      notes: [{
        text: '<script>alert(1)</script>parent',
        children: [{ text: '<img src=x onerror=alert(2)>child' }]
      }]
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror');
    expect(html).toContain('parent');
    expect(html).toContain('child');
  });

  test('a hostile string in an enchantment description is neutralized', () => {
    const html = renderPartial('class-enchantment', {
      enchantment: { name: 'E', dedication: null, description: '<script>alert(1)</script>safe' }
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('safe');
  });
});
```

Then add a source-level assertion to `views/class-view.test.js`, which is where
that file's existing string assertions live:

```js
test('paired_action renders through the power-ratings helper', () => {
  expect(SRC).toContain('{{{powerRatings this.paired_action}}}');
  expect(SRC).not.toContain('{{this.paired_action}}');
});
```

```js
test('a hostile string in a newly rendered field is neutralized', async () => {
  const html = await renderClassView({
    ...baseClass,
    abilities: [{
      name: 'Probe',
      description: '',
      paired_action: '<img src=x onerror=alert(1)>',
      meters: [],
      notes: [{ text: '<script>alert(2)</script>note', children: [] }],
      sample_perks: [{
        name: 'P',
        text: 'Boosted <sup>L–H</sup>',
        dedication: null,
        compound_text: '<a href="javascript:alert(3)">c</a>'
      }]
    }]
  });

  expect(html).not.toContain('onerror');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('javascript:');
  expect(html).toContain('<sup>L–H</sup>');
});
```

Adapt `renderClassView` and `baseClass` to whatever the file already uses to
render a class; do not invent a new harness.

- [ ] **Step 8: Run the suites**

Run: `bun run test:unit`
Expected: 0 failures.

- [ ] **Step 9: Commit**

```bash
git add util/markdown.js util/markdown.test.js app.js \
        views/partials/class-sample-perks.handlebars \
        views/partials/class-enchantment.handlebars views/partials/class-notes.handlebars \
        views/partials/class-content-render.test.js \
        views/class-view.handlebars views/class-view.test.js
git commit -m "feat: render Power Ratings as superscripts"
```

---

### Task 7: Format-aware write paths

**Files:**
- Modify: `util/class-import.js:87,222-232`
- Modify: `routes/classes.js:662-710,729-760`
- Modify: `views/class-form.handlebars:10-13,735`
- Modify: `util/class-fields.js:11-14`
- Test: `util/class-import.test.js`, `routes/classes-structured-fields.test.js`

**Interfaces:**
- Consumes: `normalizeExpandedTips` from Task 5, `content_format` from Task 2.
- Produces: both write handlers persist `content_format` and `expanded_tips`.
  `util/class-import.js` caps gear on `content_format`, not `rules_edition`.

- [ ] **Step 1: Write the failing test**

Add to `util/class-import.test.js`:

```js
test('the gear cap follows content_format, not rules_edition', async () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ name: `Item ${i + 1}` }));

  const aspirantFormat = await importWith({
    rules_edition: 'advent',
    content_format: 'aspirant',
    gear: twelve
  });
  expect(aspirantFormat.gear).toHaveLength(12);

  const adventFormat = await importWith({
    rules_edition: 'aspirant',
    content_format: 'advent',
    gear: twelve
  });
  expect(adventFormat.gear).toHaveLength(6);
});

test('content_format defaults to advent', async () => {
  const result = await importWith({ gear: [{ name: 'One' }] });
  expect(result.content_format).toBe('advent');
});
```

Use the file's existing stubbed-model helper rather than calling the real LLM;
copy the pattern from the tests already in the file and name the helper
`importWith` only if that matches what is there.

Add to `routes/classes-structured-fields.test.js`:

```js
test('create persists content_format and expanded_tips', async () => {
  const body = {
    name: 'Format Probe',
    content_format: 'aspirant',
    expanded_tips: { player: [{ text: 'P tip' }], conduit: [{ text: 'C tip' }] },
    gear: [{ name: 'G' }],
    abilities: [{ name: 'A' }]
  };
  const saved = await postClass(body);
  expect(saved.content_format).toBe('aspirant');
  expect(saved.expanded_tips).toEqual({
    player: [{ text: 'P tip', children: [] }],
    conduit: [{ text: 'C tip', children: [] }]
  });
});

test('an unknown content_format falls back to advent', async () => {
  const saved = await postClass({ name: 'Bad Format', content_format: 'aspirant-v1' });
  expect(saved.content_format).toBe('advent');
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun run test:unit util/class-import.test.js`
Run: `bun run test:http routes/classes-structured-fields.test.js`
Expected: FAIL on each new test.

- [ ] **Step 3: Implement the import change**

In `util/class-import.js`:

- Add `content_format: z.enum(["advent", "aspirant"]).optional()` to the schema
  beside `rules_edition` at `:87`.
- Add `expanded_tips` to the schema as an optional object with `player` and
  `conduit` arrays of the note shape already declared for `notes`.
- Replace the `edition` local used for the cap with a `format` local:
  `const format = parsed.content_format || "advent";`
  `edition` (`util/class-import.js:208`) has exactly one use, the cap at `:226`,
  so **delete it** rather than leaving it beside `format`. The `rules_edition`
  key emitted at `:229` reads `parsed.rules_edition` directly and does not use
  the local.
- Change the gear cap at `:226` to
  `format === "aspirant" ? ASPIRANT_GEAR_LIMIT : ADVENT_GEAR_LIMIT`.
- Emit `content_format: format` and
  `expanded_tips: normalizeExpandedTips(parsed.expanded_tips)` in the returned
  object.
- Update the `ADVENT_GEAR_LIMIT` comment: the cap is per-format because format,
  not edition, is what says how many Signatures a class prints.

Keep `rules_edition` exactly as it is. It still defaults to `"advent"` and is
still emitted.

- [ ] **Step 4: Implement the handler change**

`util/class-fields.js:11-14` — add `content_format: ['advent', 'aspirant']` to
`CONSTRAINED_SELECTS`, so an unrecognised value falls back rather than relying on
the DB CHECK to reject the whole save. Note that `rules_edition` and
`rules_version` are deliberately absent from this map today; adding
`content_format` is not a reason to add them, and doing so is out of scope.

`routes/classes.js` — in both the create handler (`:662`) and the update handler
(`:729`), beside the existing `advanced_abilities` normalization, add:

```js
    req.body.expanded_tips = normalizeExpandedTips(req.body.expanded_tips);
```

with the `require` added to the file's imports. `content_format` needs no
handler line: it is a plain column and `applyConstrainedSelects` now guards it.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `bun run test:unit util/class-import.test.js`
Run: `bun run test:http routes/classes-structured-fields.test.js`
Expected: PASS.

- [ ] **Step 6: Add the form controls**

`views/class-form.handlebars`:

- Add a Content Format select beside the existing edition select at `:10-13`,
  with options `advent` and `aspirant` and the same markup shape. Help text:
  "Advent classes print six Signatures and three Abilities; Aspirant classes
  print twelve Signatures, three Core and three Advanced."
- The gear repeater at `:735` renders `{{#times 6}}` blank rows regardless of
  format, so an Aspirant class needs six manual "Add gear" clicks. Change it to
  render twelve blank rows when `content_format` is `aspirant` and six otherwise.
  Use the existing `{{#times}}` helper with a value chosen by an `{{#if}}`; do
  not add a new helper.
- Add Expanded Tips repeaters for `player` and `conduit`, following the
  `advanced_abilities` section's partial family and its Alpine renumbering
  pattern in `public/js/alpine-components.js`. Section label "Expanded Tips",
  help text: "The Player and Conduit tip lists from the class's last page."

- [ ] **Step 7: Prove the form round-trips**

Run: `bun run test:unit views/class-form.test.js`
Run the single-file integration command from Global Constraints on `util/class-form-round-trip.integration.test.js`

**Expect this file to fail with 2 fail / 1 pass before and after your change** —
see Global Constraints. Capture its failure list before you touch anything, and
compare after. Your change is correct if the two lists are identical. It is a
regression only if a NEW class or field appears.

`util/class-form-round-trip.integration.test.js:174` pins
`STRUCTURED_FIELDS = ['abilities','advanced_abilities','gear','examples']`. Add
`expanded_tips`. Its coverage floors at `:633-635` assert a non-zero count of
`sample_perks`, `default_enchantments` and `advanced_abilities` across live
classes; do not add an `expanded_tips` floor in this plan — no live class has any
until plan 2 loads them, and a floor that cannot be met would fail the build.

Expected: `views/class-form.test.js` passes; the round-trip file's failure list is
unchanged from the baseline you captured.

- [ ] **Step 8: Run everything**

Run: `bun run test:unit && bun run test:http && bun run check`
Expected: unit 0 failures, http 1 failure (the pre-existing `open-graph`),
check exit 0.

- [ ] **Step 9: Commit**

```bash
git add util/class-import.js util/class-import.test.js util/class-fields.js \
        routes/classes.js routes/classes-structured-fields.test.js \
        views/class-form.handlebars public/js/alpine-components.js \
        util/class-form-round-trip.integration.test.js
git commit -m "feat: make the class write paths format-aware"
```

---

### Task 8: Render a V1 class page

**Files:**
- Modify: `views/class-view.handlebars:240-290,300-340`
- Create: `views/partials/class-signature-columns.handlebars`
- Create: `views/partials/class-expanded-tips.handlebars`
- Test: `views/class-view.test.js`

**Interfaces:**
- Consumes: `gear[i].column`/`position` from Task 4, `expanded_tips` from Task 5,
  `powerRatings` from Task 6.
- Produces: `signatureColumns(gear) -> [item[], item[], item[], item[]]` exported
  from `util/class-gear.js`. The class page renders four Signature columns for an
  Aspirant-format class and the existing two-column split for an Advent-format
  one, plus an Expanded Tips section when either list is non-empty.

- [ ] **Step 1: Write the failing test**

Extend the harness Task 6 created in `views/partials/class-content-render.test.js`
— it already compiles a partial with its dependencies registered. Add:

```js
describe('signature columns', () => {
  const item = (i) => ({
    name: `Item ${i + 1}`,
    description: '',
    category: i < 3 ? 'default' : 'elective',
    column: Math.floor(i / 3) + 1,
    position: (i % 3) + 1,
    meters: [],
    notes: [],
    default_enchantment: null
  });

  test('twelve items render as four columns', () => {
    const { signatureColumns } = require('../../util/class-gear');
    const gear = Array.from({ length: 12 }, (_, i) => item(i));
    const html = renderPartial('class-signature-columns', {
      columns: signatureColumns(gear)
    });
    expect(html.match(/class="signature-column"/g)).toHaveLength(4);
    for (let i = 1; i <= 12; i += 1) expect(html).toContain(`Item ${i}`);
  });
});

describe('expanded tips', () => {
  test('both audiences render', () => {
    const html = renderPartial('class-expanded-tips', {
      hasExpandedTips: true,
      tips: {
        player: [{ text: 'Player guidance', children: [] }],
        conduit: [{ text: 'Conduit guidance', children: [] }]
      }
    });
    expect(html).toContain('Player guidance');
    expect(html).toContain('Conduit guidance');
  });

  test('empty lists render no section', () => {
    const html = renderPartial('class-expanded-tips', {
      hasExpandedTips: false,
      tips: { player: [], conduit: [] }
    });
    expect(html.trim()).toBe('');
  });
});
```

Register the two new partials in `renderPartial`'s dependency list alongside the
three already there.

Add the format branch as a source assertion in `views/class-view.test.js`, beside
its existing string assertions:

```js
test('class-view branches the signature layout on content_format', () => {
  expect(SRC).toContain('class-signature-columns');
  expect(SRC).toContain('class-expanded-tips');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test:unit views/class-view.test.js`
Expected: FAIL — one signature column, no expanded tips.

- [ ] **Step 3: Build the signature columns partial**

Create `views/partials/class-signature-columns.handlebars`. Group `gear` by
`column` and render each group as a Bulma column carrying
`class="signature-column"`, each item rendering name, meters, description, notes
and `{{> class-enchantment enchantment=this.default_enchantment}}` exactly as the
existing gear blocks do.

Handlebars has no group-by. Rather than adding a helper, pass four pre-filtered
lists from the route. The class page is rendered at `routes/classes.js:534`; add
`signatureColumns: signatureColumns(classData.gear)` and
`hasExpandedTips: ...` to that view model beside the existing `class: classData`.
Keep the derivation in a small exported function in `util/class-gear.js` so it is
unit-testable:

```js
// The class page renders Signatures in the book's four columns. Grouping here
// rather than in the template keeps it testable and keeps the template free of
// a group-by helper that would exist for one caller.
const signatureColumns = (gear) => [1, 2, 3, 4]
  .map((column) => (Array.isArray(gear) ? gear : []).filter((item) => item.column === column));
```

Add a unit test for it in `util/class-gear.test.js` covering a six-item class
(two populated columns, two empty) and a twelve-item class (four populated).

- [ ] **Step 4: Wire the partial into the page**

In `views/class-view.handlebars`, replace the existing two-column gear block with
an `{{#if}}` on `content_format`: `aspirant` renders
`{{> class-signature-columns columns=signatureColumns}}`, `advent` keeps the
existing Default/Elective markup unchanged.

**Do not delete the Advent markup.** Fifty live classes render through it, and
the Default/Elective headings are the book's own backwards-compatibility reading.

- [ ] **Step 5: Build the expanded tips partial**

Create `views/partials/class-expanded-tips.handlebars`:

```handlebars
{{#if hasExpandedTips}}
<div class="card">
  <div class="card-content">
    <div class="content">
      <h3 class="title is-3">Expanded Tips</h3>
      <div class="columns">
        <div class="column">
          <h4 class="title is-5">Player</h4>
          {{> class-notes notes=tips.player}}
        </div>
        <div class="column">
          <h4 class="title is-5">Conduit</h4>
          {{> class-notes notes=tips.conduit}}
        </div>
      </div>
    </div>
  </div>
</div>
{{/if}}
```

Compute `hasExpandedTips` in the same view model at `routes/classes.js:534`, as
`player.length > 0 || conduit.length > 0` over `classData.expanded_tips`. Include
the partial in `views/class-view.handlebars` after the abilities sections, passing
`tips=class.expanded_tips hasExpandedTips=hasExpandedTips`.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `bun run test:unit views/class-view.test.js util/class-gear.test.js`
Expected: PASS.

- [ ] **Step 7: Run everything**

Run: `bun run test:unit && bun run check`
Expected: 0 failures, exit 0.

- [ ] **Step 8: Commit**

```bash
git add views/class-view.handlebars views/partials/class-signature-columns.handlebars \
        views/partials/class-expanded-tips.handlebars views/class-view.test.js \
        views/partials/class-content-render.test.js \
        util/class-gear.js util/class-gear.test.js routes/classes.js
git commit -m "feat: render four Signature columns and expanded tips"
```

---

### Task 9: Export and the agent serializer

**Files:**
- Modify: `util/class-export.js:255-290`
- Modify: `models/class.js:382-421`
- Modify: `docs/custom-gpt-openapi.json`
- Test: `util/class-export.test.js`, `models/class-agent.test.js`

**Interfaces:**
- Consumes: every column and contract key from Tasks 2, 4 and 5.
- Produces: JSON export and the agent serializer both emit `content_format`,
  `expanded_tips`, and `column`/`position` on every gear item.

- [ ] **Step 1: Write the failing test**

`util/class-export.test.js:100-131` pins the JSON export key set literally. Add
`content_format` and `expanded_tips` to that expected set, and add:

The fixture in that file is `BEASTMASTER` (`util/class-export.test.js:11`):

```js
test('json export carries column and position on every gear item', () => {
  const exported = JSON.parse(exportClass(BEASTMASTER, 'json'));
  expect(exported.gear.every((item) => typeof item.column === 'number')).toBe(true);
  expect(exported.gear.every((item) => typeof item.position === 'number')).toBe(true);
});

test('markdown export prints the expanded tips section', () => {
  const md = exportClass({
    ...BEASTMASTER,
    expanded_tips: {
      player: [{ text: 'Player guidance', children: [] }],
      conduit: [{ text: 'Conduit guidance', children: [] }]
    }
  }, 'markdown');
  expect(md).toContain('Expanded Tips');
  expect(md).toContain('Player guidance');
  expect(md).toContain('Conduit guidance');
});
```

`BEASTMASTER`'s gear items will need `column`/`position` added to the fixture for
the first test to be meaningful — add them, matching what `normalizeGear` would
produce for a six-item list.

Add to `models/class-agent.test.js`. The fixture there is `baseClass`
(`models/class-agent.test.js:7`); there is no `fullClass`:

```js
test('full access carries content_format and expanded_tips', () => {
  const serialized = serializeClassForAgent({
    ...baseClass,
    content_format: 'advent',
    expanded_tips: { player: [], conduit: [] }
  }, 'full');
  expect(serialized.content_format).toBe('advent');
  expect(serialized.expanded_tips).toEqual({ player: [], conduit: [] });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun run test:unit util/class-export.test.js models/class-agent.test.js`
Expected: FAIL on the new keys.

- [ ] **Step 3: Implement**

`util/class-export.js`:
- `exportGearItem` (`:255-265`) emits `column: item.column ?? null` and
  `position: item.position ?? null`.
- The JSON body emits `content_format` and
  `expanded_tips: classData.expanded_tips ?? { player: [], conduit: [] }`.
- The markdown body gains an `## 💡 Expanded Tips` section with `Player` and
  `Conduit` sub-headings, reusing the existing note-rendering helper. Omit the
  section entirely when both lists are empty, the way the Advanced Abilities
  section is already conditional.

`models/class.js` — `serializeClassForAgent` emits `content_format` and
`expanded_tips` in the `accessLevel === 'full'` branch beside
`advanced_abilities`. `serializeClassSummaryForAgent` gains `content_format`
only, beside `rules_edition`.

`docs/custom-gpt-openapi.json` — add `content_format` and `expanded_tips` to the
class schema. `models/class-agent.test.js:152` compares top-level key names, so
the summary serializer's new key must appear here or that test fails.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun run test:unit util/class-export.test.js models/class-agent.test.js`
Expected: PASS.

- [ ] **Step 5: Check the export/import key-set diff**

`util/class-export.test.js` diffs the export key set against `classImportSchema`
rather than a literal list. Task 7 added `content_format` and `expanded_tips` to
the import schema, so the two should now agree. If the diff test fails, the
mismatch is real — reconcile it rather than widening the expected set.

- [ ] **Step 6: Run everything**

Run: `bun run test:unit && bun run test:http && bun run check`
Expected: unit 0 failures, http 1 pre-existing failure, check exit 0.

- [ ] **Step 7: Run the e2e suite**

Run: `bunx playwright test`
Expected: the same six pre-existing failures and no others. If the e2e harness
will not start, run `bun run seed:admin --yes` first — `e2e/global-setup.js`
creates only the player identity.

- [ ] **Step 8: Commit**

```bash
git add util/class-export.js util/class-export.test.js models/class.js \
        models/class-agent.test.js docs/custom-gpt-openapi.json
git commit -m "feat: export and serialize the V1 class contract"
```

---

## Done when

- `classes.content_format` and `classes.expanded_tips` exist, are `NOT NULL`, and
  every pre-existing row carries `'advent'` and the empty tips object.
- `dup_class` carries both new columns.
- A format fork is in a different version family from its parent, and both lean
  projections in `services/class/repository.js` select `content_format`.
- Every Signature carries a `column` and a `position`; `category` derives from
  the column and all fifty live classes keep the category they had.
- Power Ratings render as superscripts in every field that can contain one, and a
  hostile string in each of those fields is neutralized.
- An Aspirant-format class can be authored in the admin form, rendered with four
  Signature columns and an Expanded Tips section, exported and forked.
- `bun run test:unit` 0 failures; `bun run test:http` only the pre-existing
  `open-graph` failure; `bunx playwright test` only the six pre-existing
  failures; `bun run check` exit 0.

## Not in this plan

Plan 2 covers the extractor, the V1 verifier, the loader's fork disposition, the
load itself, the unlock roster and the `class_abilities` re-tag.

The re-tag is deliberately held back. Slice 2's backfill matched zero rows
because it ran before any class had advanced abilities; running it again before
plan 2's load would repeat exactly that mistake.
