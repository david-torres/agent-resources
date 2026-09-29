# Aspirant Shops: One Entry per Item, No Duplicate Ability Names — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Aspirant-economy character sees each Signature and Ability name once per class lineage in every shop, and no character can ever hold two Abilities with the same name — enforced in the browser, on the server and by a unique index — after a one-time script removes the existing duplicates.

**Architecture:** A new pure module `util/class-lineage.js` defines a lineage (an Advent version family plus its Aspirant fork's family). `lineageCatalogue` prunes each class's item lists so a name appears once per lineage: own class first, then the newest Aspirant version, then the newest Advent version. `purchaseCatalogue` wraps it for the edit page. `aspirantTargetOf` moves here from `util/aspirant-conversion.js`. Every Aspirant shop reads this catalogue: the edit-page islands, the classic pickers and the wizard. The wizard route also serves each card's `own_class_ids` and `lineage_id`, so the browser prices and prunes the way the server does. `util/item-name.js` holds the shared name key (trimmed, case-folded) and `duplicateNames`. `services/character/input.js` refuses a save that holds one name twice, and the service maps the index's unique violation to the same message. Conversion treats a duplicate as a blocker, and the upgrade script skips such a character. `scripts/dedupe-character-abilities.js` cleans existing duplicates through a direct Postgres connection, one transaction per character. The migration then adds the unique index and restates `save_character_atomic` so that its Ability delete runs before its insert.

**Tech Stack:** Bun, `bun:test`, jsdom, Express 4, express-handlebars, htmx, Supabase/Postgres (`save_character_atomic` RPC, `pg`).

**Spec:** `docs/superpowers/specs/2026-09-28-convert-to-aspirant-design.md`, **Part 3 and Rollout**. Parts 1 and 2 are implemented on this branch. Read Part 2 ("The Aspirant version of a class", "Own class across the fork") for context, and read Part 3 and Rollout in full before starting any task.

## Global Constraints

- **Branch:** `feat/convert-aspirant-class-upgrade`. Do not switch branches, push, or edit `.env`.
- **`.env` may point at PRODUCTION.** The user switches it by hand, and bun loads `.env` automatically.
  - **Never run plain `bun test <file>`.**
  - Never run a script in this plan without the explicit local env shown in its task.
  - Before any step that writes to a database, get credentials from `supabase status -o env`, never from `.env`.
- **Unit tier:** `bun run test:unit` is always safe, because it scrubs the Supabase variables. For a single unit or HTTP file, run:
  ```bash
  env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test <file>
  ```
- **HTTP tier:** `bun run test:http`. `routes/characters.test.js` is an HTTP file. The single-file form above works for it too.
- **Integration tier:** use the local stack only, in a single shell invocation:
  ```bash
  eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test <file>
  eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun run test:integration
  ```
- **NEVER run `supabase db reset`.** The local database holds a restored production copy.
- **This plan adds one migration** (Task 10): `supabase/migrations/20260929000000_class_abilities_unique_name.sql`.
  - Apply it to the local stack only, with `supabase migration up --local`.
  - Never run `supabase db push`. Applying it to production is the user's job (see Rollout).
  - It cannot apply while any character holds an Ability name twice. The local copy has one such character, so Task 9 cleans the local copy first.
- **Known reds.** Compare by file and test name, never by count:
  - `test:unit`: 0 failures.
  - `test:http`: exactly `routes/open-graph.test.js`.
  - `test:integration`: exactly `util/character-content-integrity` (1), `util/class-form-round-trip` (2 of 3) and `util/image-crop-integrity` (2).
  - Anything else that fails is yours to fix. Record the baseline once before Task 1 (see Task 11, Step 1).
- **No dead code.** When you replace something, delete what it replaced in the same task: no commented-out blocks, no fallbacks, no `_old` copies. Before committing, run `grep -rn "<removed symbol>" models routes services util scripts test views public` to confirm nothing still references a removed symbol.
- **Comments:** only where the code cannot carry the meaning. Describe the code as it is now. Never write history ("was", "no longer", "now", "used to").
- **Discovery:** use `semble search "<query>" .` (or `uvx --from "semble[mcp]" semble search "<query>" .`) rather than grep. Use grep only for exhaustive literal checks.
- **Match the surrounding idiom:**
  - Services return `{ data, error }`.
  - Business errors are `{ status, message }`, and validation errors from `normalizeCharacterInput` are plain strings.
  - Adapter stubs use `ok(...)` and `makeAdapter` in `services/character/service.test.js`.
  - Indentation is 2 spaces, except 4 in `util/merx-economy.js` and `util/perk-economy.js`.
  - Browser files under `public/js/` are IIFEs that cannot `require`, so they restate the one-line name key.
- **TDD per task:** write the failing test, run it and see the stated failure, write the minimum code, run it green, then commit.
- **Commits:**
  - One commit per task.
  - Stage only the files the task names (`git add <paths>`, never `-A` or `.`).
  - Use lower-case imperative with a `feat:`, `fix:`, `test:` or `docs:` prefix.
  - End every message with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or your harness's trailer).
- **Copy (from the spec, verbatim):**
  - Duplicate on save: `<character name> already has <Ability name>.`
  - Conversion blocker (`rule: 'duplicate-ability'`): `<character name> has two Abilities named <Ability name>. Remove one to convert.`

## Review Focus

These are the five inputs the spec implies but never spells out, most likely first. Each one has a test in the task named.

1. **An Advent and an Aspirant version that spell one item differently only by case or spacing** (`Revolver` / ` revolver `, `Rapier` / `RAPIER`). The shops list it once, taken from the Aspirant version. Tested in Task 1 (`lineageCatalogue`) and Task 2 (edit-page route test).
2. **An Aspirant character whose own class is not in the served roster** (its unlock lapsed) **or is an older version.** Its own class's items still come first, and the newer version never re-offers a name it prints. Tested in Task 1 (`purchaseCatalogue` and `lineageCatalogue` with an older own version).
3. **Buying an Ability whose name the character already holds from a different class, spelled with different case or spacing.** Refused in the edit island (Task 6) and in the wizard (Task 5).
4. **A save that re-inserts an Ability under the same name after the index exists**: a class move, which is what conversion and the upgrade script do, or a case-only respelling. The save succeeds. Tested in Task 10 (integration against the real RPC).
5. **A duplicate row being deleted that carries Perks, one of them a Compound.** The Perks move onto the kept row after its own Perks, in order, and the Compound link survives. Tested in Task 9.

## Corrections to the spec, and decisions it left open

- **The RPC does NOT run its delete before its insert.** In `save_character_atomic` (`20260921000001_save_character_atomic_aspiring_abilities.sql:173-207`), the `deleted` CTE is a data-modifying CTE that the main `INSERT` never reads. Postgres runs such a CTE *after* the main statement. A unique index checks each row as it is inserted, so a moved or respelled Ability is inserted while the row it replaces still exists. Checked on the local stack:
  ```
  with d as (delete from t where id = 1) insert into t select 2, 1, 'Trickshot';
  ERROR:  duplicate key value violates unique constraint "t_key"
  DETAIL:  Key (c, lower(btrim(name)))=(1, trickshot) already exists.
  ```
  With the index alone, every conversion and every upgrade-script save that moves an Ability would fail. The migration therefore restates the function and splits the Ability block into a `DELETE` statement followed by the `UPDATE`/`INSERT` statement. The survivors of the delete are exactly the rows the old block matched (the lowest-id occurrences of each key), so the second statement's occurrence numbering is unchanged.
- **A single `INSERT ... SELECT` can insert two same-named rows** if the payload holds a duplicate. Server validation (Task 7) refuses that payload first. If the index still fires (for example, two concurrent saves), the service maps the 23505 to the same message.
- **`class_abilities` has no `created_at`** (columns: `id, character_id, name, description, class_id, type`). The dedupe script cannot keep "the oldest row". It keeps the row with the lowest `id`, which is also the row that the RPC's occurrence pairing and its Perk re-attach (`ORDER BY id LIMIT 1`) treat as first. Task 9 corrects the spec text.
- **One transaction per character needs a direct Postgres connection.** supabase-js has no transactions. The dedupe script connects with `pg` through `scripts/migration-connection.mjs`, using `SUPABASE_URL` + `SUPABASE_DB_PASS` (+ optional `SUPABASE_DB_REGION`), the same variables `scripts/apply-migrations.mjs` and `scripts/db-backup.sh` read.
- **Level-up never changes the Ability roster** (`levelUp` writes stats and Perks only), so "covers level-up" needs no code. Import goes through `createCharacter`, so it is covered.
- **Once the index exists, the conversion blocker and the upgrade-script skip cannot fire.** A moved row keeps its name key, and no stored duplicate can exist. They guard the window between merge and `db push`. The script's skip branch has no integration test, because its fixture (two same-named rows) cannot be created once the index exists. It is pinned by the shared `duplicateAbilityBlockers` unit tests in Task 8.
- **Lineage applies to the `aspirant` economy only.** The spec says "Aspirant-economy character". An aspiring character's edit island keeps `latestClassVersions`, and the aspiring wizard already hides forked Advent classes.
- **The edit-page Signature island stops hiding the character's own family's newer version** (`isOwnVersion` in `util/gear-purchase-data.js`). Under the spec's source order, a name only the newer Aspirant version prints is offered at the own-class price, and the lineage catalogue prunes the names both versions print. `isOwnVersion` is deleted. The test at `util/gear-purchase-data.test.js:236` is replaced.
- **The wizard cannot cheaply serve a pruned catalogue per card.** It serves `shopClasses` (the lineage catalogue built with no own class) and, on every card, `lineage_id` and `own_class_ids`. The browser drops the selected card from the shop and removes the card's own names from the classes of its lineage. Removing the own class's names from sources 2 and 3 is exactly what putting it first in the spec's order does, so the result equals the spec's for every card, including a preselected forked Advent class.
- **The wizard's Ability shop starts selling own-lineage Core Abilities** (for example the Advent origin's Core on an Aspirant card) at the own-Core price. The wizard's Perk spend applies the server's free-Core allowance to those picks (`unlockSpend` in `util/perk-economy.js`), so client and server agree.
- **Classic pickers** (`/class-gear`, `/class-abilities`) learn the selected class from `hx-include="#char-class-id"` and the stored mode from `hx-vals`. Without a class id, or when the economy is not Aspirant, they are unchanged.

---

### Task 1: `util/item-name.js` and `util/class-lineage.js`

**Files:**
- Create: `util/item-name.js`, `util/item-name.test.js`
- Create: `util/class-lineage.js`, `util/class-lineage.test.js`
- Modify: `util/aspirant-conversion.js:7-8` (imports), `:22-23` (delete local `nameKey`), `:34-41` (delete local `aspirantTargetOf`)

**Interfaces:**
- Consumes: `computeVersionFamily`, `findAspirantFork`, `ownClassIds` (`util/class-family.js`); `latestClassVersions` (`util/class-list-grouping.js`).
- Produces:
  - `nameKey(value: any) => string`: trimmed, lower-cased.
  - `duplicateNames(names: string[]) => string[]`: the first spelling of each name that appears more than once, in order of the second appearance.
  - `aspirantTargetOf(classes: ClassRow[], classId: string|null) => ClassRow|null`, moved unchanged.
  - `lineageIdOf(classes: ClassRow[], classId: string) => string`: the smallest id in the class's lineage.
  - `lineageCatalogue(classes: ClassRow[], { ownClassId?: string|null }) => ClassRow[]`: `latestClassVersions(classes, { keep: [ownClassId] })` in input order. Each row is a copy with `lineage_id` and pruned `gear`, `abilities` and `advanced_abilities`.
  - `purchaseCatalogue({ economy, classes, characterClass }) => ClassRow[]`: `[]` for advent, `latestClassVersions` for aspiring, and `lineageCatalogue` with the own class added if missing for aspirant.
  - `ClassRow` is at least `{ id, name, base_class_id, rules_edition, content_format, created_at, gear, abilities, advanced_abilities }`.

- [ ] **Step 1: Write the failing tests**

Create `util/item-name.test.js`:

```js
const { test, expect } = require('bun:test');
const { nameKey, duplicateNames } = require('./item-name');

test('a name key ignores surrounding space and case', () => {
  expect(nameKey('  Trick Shot ')).toBe('trick shot');
  expect(nameKey(null)).toBe('');
});

test('duplicateNames reports each repeated name once, in its first spelling', () => {
  expect(duplicateNames(['Veneer', 'Phantasm', 'veneer ', 'VENEER', 'Glamour', 'glamour'])).toEqual(['Veneer', 'Glamour']);
  expect(duplicateNames(['Veneer', 'Phantasm'])).toEqual([]);
});
```

Create `util/class-lineage.test.js`:

```js
const { test, expect, describe } = require('bun:test');
const {
  aspirantTargetOf, lineageIdOf, lineageCatalogue, purchaseCatalogue
} = require('./class-lineage');

const row = (id, format, base, lists, createdAt) => ({
  id,
  name: lists.name || id,
  base_class_id: base,
  rules_edition: format,
  content_format: format,
  created_at: createdAt,
  gear: (lists.gear || []).map(name => ({ name })),
  abilities: (lists.abilities || []).map(name => ({ name })),
  advanced_abilities: (lists.advanced || []).map(name => ({ name }))
});

const GS_V1 = row('gs-v1', 'advent', null, {
  gear: ['Revolver', 'Duster', 'Spurs'], abilities: ['Trickshot', 'Quickdraw']
}, '2024-01-01T00:00:00Z');
const GS_V2 = row('gs-v2', 'advent', 'gs-v1', {
  gear: ['Revolver', 'Duster', 'Lasso'], abilities: ['Trickshot', 'Quickdraw'], advanced: ['Standoff']
}, '2025-01-01T00:00:00Z');
const GS_ASP = row('gs-asp', 'aspirant', 'gs-v1', {
  gear: [' revolver ', 'Bolo'], abilities: ['TRICKSHOT'], advanced: ['Standoff', 'Deadeye']
}, '2026-01-01T00:00:00Z');
const GS_ASP_2 = row('gs-asp-2', 'aspirant', 'gs-asp', {
  gear: ['Revolver', 'Bolo', 'Sling'], abilities: ['Trickshot'], advanced: ['Standoff', 'Deadeye']
}, '2026-06-01T00:00:00Z');
const WD_V1 = row('wd-v1', 'advent', null, { gear: ['Satchel'], abilities: ['Familiar Face'] }, '2024-01-01T00:00:00Z');
// Another lineage that happens to print the same names.
const SC_ASP = row('sc-asp', 'aspirant', null, { gear: ['Revolver'], abilities: ['Trickshot'] }, '2026-01-01T00:00:00Z');

const CLASSES = [GS_V1, GS_V2, GS_ASP, GS_ASP_2, WD_V1, SC_ASP];

const lists = (rows) => Object.fromEntries(rows.map(r => [r.id, {
  gear: r.gear.map(i => i.name),
  abilities: r.abilities.map(i => i.name),
  advanced: r.advanced_abilities.map(i => i.name)
}]));

describe('aspirantTargetOf', () => {
  test('every Advent version reaches the newest version of the Aspirant family', () => {
    expect(aspirantTargetOf(CLASSES, 'gs-v1').id).toBe('gs-asp-2');
    expect(aspirantTargetOf(CLASSES, 'gs-v2').id).toBe('gs-asp-2');
  });

  test('a class with no Aspirant version, or already Aspirant, has none', () => {
    expect(aspirantTargetOf(CLASSES, 'wd-v1')).toBeNull();
    expect(aspirantTargetOf(CLASSES, 'gs-asp')).toBeNull();
  });
});

describe('lineageIdOf', () => {
  test('both families of a forked class share one lineage', () => {
    const ids = ['gs-v1', 'gs-v2', 'gs-asp', 'gs-asp-2'].map(id => lineageIdOf(CLASSES, id));
    expect(new Set(ids).size).toBe(1);
  });

  test('unrelated classes are lineages of their own', () => {
    const ids = ['gs-v2', 'wd-v1', 'sc-asp'].map(id => lineageIdOf(CLASSES, id));
    expect(new Set(ids).size).toBe(3);
  });

  test('an Advent family with two Aspirant versions is not merged with either', () => {
    const second = row('gs-asp-b', 'aspirant', 'gs-v1', { gear: ['Revolver'] }, '2026-02-01T00:00:00Z');
    const classes = [...CLASSES, second];
    expect(lineageIdOf(classes, 'gs-v2')).not.toBe(lineageIdOf(classes, 'gs-asp-2'));
    expect(lineageIdOf(classes, 'gs-v2')).not.toBe(lineageIdOf(classes, 'gs-asp-b'));
  });
});

describe('lineageCatalogue', () => {
  test('with no own class, the newest Aspirant version comes first and the Advent version keeps only what it alone prints', () => {
    const rows = lineageCatalogue(CLASSES);
    expect(rows.map(r => r.id)).toEqual(['gs-v2', 'gs-asp-2', 'wd-v1', 'sc-asp']);
    expect(lists(rows)).toEqual({
      'gs-v2': { gear: ['Duster', 'Lasso'], abilities: ['Quickdraw'], advanced: [] },
      'gs-asp-2': { gear: ['Revolver', 'Bolo', 'Sling'], abilities: ['Trickshot'], advanced: ['Standoff', 'Deadeye'] },
      'wd-v1': { gear: ['Satchel'], abilities: ['Familiar Face'], advanced: [] },
      'sc-asp': { gear: ['Revolver'], abilities: ['Trickshot'], advanced: [] }
    });
    expect(new Set(rows.slice(0, 2).map(r => r.lineage_id)).size).toBe(1);
  });

  test('names that differ only by case or spacing are one name', () => {
    const rows = lineageCatalogue([GS_V1, GS_ASP]);
    expect(lists(rows)['gs-v1'].gear).toEqual(['Duster', 'Spurs']);
    expect(lists(rows)['gs-v1'].abilities).toEqual(['Quickdraw']);
  });

  test('an older own Aspirant version is kept and comes first', () => {
    const rows = lineageCatalogue(CLASSES, { ownClassId: 'gs-asp' });
    expect(rows.map(r => r.id)).toEqual(['gs-v2', 'gs-asp', 'gs-asp-2', 'wd-v1', 'sc-asp']);
    const byId = lists(rows);
    expect(byId['gs-asp']).toEqual({ gear: [' revolver ', 'Bolo'], abilities: ['TRICKSHOT'], advanced: ['Standoff', 'Deadeye'] });
    expect(byId['gs-asp-2']).toEqual({ gear: ['Sling'], abilities: [], advanced: [] });
    expect(byId['gs-v2']).toEqual({ gear: ['Duster', 'Lasso'], abilities: ['Quickdraw'], advanced: [] });
  });

  test('an own Advent class comes first, ahead of its Aspirant version', () => {
    const byId = lists(lineageCatalogue(CLASSES, { ownClassId: 'gs-v1' }));
    expect(byId['gs-v1']).toEqual({ gear: ['Revolver', 'Duster', 'Spurs'], abilities: ['Trickshot', 'Quickdraw'], advanced: [] });
    expect(byId['gs-asp-2']).toEqual({ gear: ['Bolo', 'Sling'], abilities: [], advanced: ['Standoff', 'Deadeye'] });
    expect(byId['gs-v2']).toEqual({ gear: ['Lasso'], abilities: [], advanced: [] });
  });

  test('rows keep their other fields', () => {
    const [first] = lineageCatalogue([{ ...WD_V1, teaser: 'Wanders.' }]);
    expect(first).toMatchObject({ id: 'wd-v1', name: 'wd-v1', teaser: 'Wanders.', lineage_id: 'wd-v1' });
  });
});

describe('purchaseCatalogue', () => {
  test('an advent character buys from nothing', () => {
    expect(purchaseCatalogue({ economy: 'advent', classes: CLASSES, characterClass: GS_V2 })).toEqual([]);
  });

  test('an aspiring character sees the newest version of every class, unpruned', () => {
    const rows = purchaseCatalogue({ economy: 'aspiring', classes: CLASSES, characterClass: null });
    expect(rows.map(r => r.id)).toEqual(['gs-v2', 'gs-asp-2', 'wd-v1', 'sc-asp']);
    expect(rows[0].gear.map(i => i.name)).toContain('Revolver');
  });

  test('an aspirant character whose own class is no longer served still gets it first', () => {
    const served = CLASSES.filter(c => c.id !== 'gs-asp');
    const byId = lists(purchaseCatalogue({ economy: 'aspirant', classes: served, characterClass: GS_ASP }));
    expect(byId['gs-asp'].gear).toEqual([' revolver ', 'Bolo']);
    expect(byId['gs-asp-2'].gear).toEqual(['Sling']);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/item-name.test.js util/class-lineage.test.js`
Expected: FAIL with `Cannot find module './item-name'` and `Cannot find module './class-lineage'`.

- [ ] **Step 3: Write `util/item-name.js`**

```js
// Signature and Ability names are written by class authors and players, and
// compare trimmed and case-folded wherever two must be told apart.
const nameKey = (value) => String(value ?? '').trim().toLowerCase();

// The first spelling of every name that appears more than once.
const duplicateNames = (names) => {
  const firstSpelling = new Map();
  const repeated = new Set();
  for (const name of names) {
    const key = nameKey(name);
    if (firstSpelling.has(key)) repeated.add(key);
    else firstSpelling.set(key, name);
  }
  return [...repeated].map(key => firstSpelling.get(key));
};

module.exports = { nameKey, duplicateNames };
```

- [ ] **Step 4: Write `util/class-lineage.js`**

```js
// A lineage is an Advent version family plus the family of its Aspirant
// version (util/class-family.js#findAspirantFork); a class with no Aspirant
// version is its own lineage. Aspirant shops sell each item name once per
// lineage.
const { computeVersionFamily, findAspirantFork, ownClassIds } = require('./class-family');
const { latestClassVersions } = require('./class-list-grouping');
const { nameKey } = require('./item-name');

const ASPIRANT = 'aspirant';

const listOf = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

// The newest version in the family of a class's Aspirant fork: the one card
// the class list shows for that family.
const aspirantTargetOf = (classes, classId) => {
  const fork = findAspirantFork(classes, classId);
  if (!fork) return null;
  const family = computeVersionFamily(classes, fork.id);
  return latestClassVersions(classes.filter(row => family.has(row.id)))[0];
};

// An Advent family with two Aspirant versions joins neither: findAspirantFork
// does not choose between them.
const lineageMembers = (classes, classId) => {
  const row = classes.find(c => c.id === classId);
  if (!row) return new Set([classId]);
  if (row.content_format !== ASPIRANT) {
    const fork = findAspirantFork(classes, classId);
    return fork ? ownClassIds(classes, fork.id) : computeVersionFamily(classes, classId);
  }
  const lineage = ownClassIds(classes, classId);
  const origin = classes.find(c => lineage.has(c.id) && c.content_format !== ASPIRANT);
  const originFork = origin ? findAspirantFork(classes, origin.id) : null;
  return originFork && lineage.has(originFork.id) ? lineage : computeVersionFamily(classes, classId);
};

const lineageIdOf = (classes, classId) => [...lineageMembers(listOf(classes), classId)].sort()[0];

// Each Signature and Ability name once per lineage, taken from the first
// class that prints it: the character's own class (its stored version), then
// the newest Aspirant version, then the newest Advent version.
const lineageCatalogue = (classes, { ownClassId = null } = {}) => {
  const all = listOf(classes);
  const rows = latestClassVersions(all, { keep: [ownClassId] });
  const source = (row) => (row.id === ownClassId ? 0 : row.content_format === ASPIRANT ? 1 : 2);
  const ordered = rows.map((row, index) => ({ row, index }))
    .sort((a, b) => source(a.row) - source(b.row) || a.index - b.index);

  const printed = new Map();
  const pruned = new Map();
  for (const { row } of ordered) {
    const lineageId = lineageIdOf(all, row.id);
    if (!printed.has(lineageId)) printed.set(lineageId, { gear: new Set(), abilities: new Set() });
    const seen = printed.get(lineageId);
    const unseen = (names) => (item) => {
      if (!item.name) return false;
      const key = nameKey(item.name);
      if (names.has(key)) return false;
      names.add(key);
      return true;
    };
    pruned.set(row.id, {
      ...row,
      lineage_id: lineageId,
      gear: listOf(row.gear).filter(unseen(seen.gear)),
      abilities: listOf(row.abilities).filter(unseen(seen.abilities)),
      advanced_abilities: listOf(row.advanced_abilities).filter(unseen(seen.abilities))
    });
  }
  return rows.map(row => pruned.get(row.id));
};

// The classes an edit-page purchase island sells from. The own class is
// added when the roster lacks it (a lapsed unlock), so it still comes first.
const purchaseCatalogue = ({ economy, classes, characterClass }) => {
  const rows = listOf(classes);
  if (economy === 'aspiring') return latestClassVersions(rows);
  if (economy !== ASPIRANT) return [];
  const ownClassId = characterClass ? characterClass.id : null;
  const withOwn = characterClass && !rows.some(row => row.id === ownClassId) ? [...rows, characterClass] : rows;
  return lineageCatalogue(withOwn, { ownClassId });
};

module.exports = { aspirantTargetOf, lineageIdOf, lineageCatalogue, purchaseCatalogue };
```

- [ ] **Step 5: Point `util/aspirant-conversion.js` at the moved helpers**

Replace lines 7-8:

```js
const { computeVersionFamily, findAspirantFork, familyResolver } = require('./class-family');
const { latestClassVersions } = require('./class-list-grouping');
```

with:

```js
const { familyResolver } = require('./class-family');
const { aspirantTargetOf } = require('./class-lineage');
const { nameKey } = require('./item-name');
```

Delete lines 22-23 (the comment `// A character row and a class's catalogue are written by different paths.` and `const nameKey = ...`). Delete lines 34-41 (the `aspirantTargetOf` comment and function). `findInCatalogue` and `upgradeBuild` keep calling `nameKey` and `aspirantTargetOf` under the same names.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/item-name.test.js util/class-lineage.test.js util/aspirant-conversion.test.js`
Expected: every test passes, 0 fail.

Run: `grep -n "const nameKey\|const aspirantTargetOf\|latestClassVersions\|computeVersionFamily" util/aspirant-conversion.js`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add util/item-name.js util/item-name.test.js util/class-lineage.js util/class-lineage.test.js util/aspirant-conversion.js
git commit -m "feat: class lineage catalogue lists each item name once per lineage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Edit-page purchase islands read the lineage catalogue

**Files:**
- Modify: `routes/characters.js:41-47` (imports), `:553-561` (`allClasses`)
- Modify: `util/gear-purchase-data.js:39-77` (delete `isOwnVersion`, rewrite the `buildEntries` comment and loop), `:139-147` (the `buildEntries` call)
- Modify: `util/ability-purchase-data.js:42-52` (comment only)
- Test: `util/gear-purchase-data.test.js:233-250` (replace one test), `routes/characters.test.js` (fixtures near `:271-299` and one new test after `:762`)

**Interfaces:**
- Consumes: `purchaseCatalogue({ economy, classes, characterClass })` (Task 1).
- Produces: nothing new. `buildEntries` drops its `characterClassId` and `classFamilyOf` parameters.

- [ ] **Step 1: Write the failing tests**

In `util/gear-purchase-data.test.js`, replace the test `'a newer version of the character\'s own class is not offered as catalogue'` and its three-line comment above it (lines 233-250) with:

```js
  // util/class-lineage.js#purchaseCatalogue serves the newest version of the
  // character's own family beside its stored one, pruned of the names the
  // stored one prints. What only the newer version prints is own class.
  test('a Signature only a newer version of the character\'s own class prints is offered at the own rate', () => {
    const newerVersion = { ...v1ClassRow(), id: 'c-v1-next', gear: [{ name: 'Stetson' }] };
    const classFamilyOf = (id) => (id === 'c-v1-next' ? 'c-v1' : id);
    const data = buildGearPurchaseData({
      economy: 'aspirant',
      characterClass: v1ClassRow(),
      allClasses: [newerVersion, otherClassRow()],
      character: { class_id: 'c-v1', gear: [] },
      missionMerx: 0,
      classFamilyOf
    });
    expect(data.entries.filter((e) => e.name === 'Stetson').map((e) => e.class_id)).toEqual(['c-v1-next']);
    expect(data.ownClassIds).toContain('c-v1-next');
  });
```

In `routes/characters.test.js`, add these fixtures right after `GS_FORK` (before `const CLASS_BY_ID`):

```js
// An Advent class and its Aspirant version that print the same Signature and
// Ability under different case.
const LN_ADVENT = {
  id: 'class-ln-advent',
  name: 'Duelist',
  is_public: true,
  is_player_created: false,
  rules_edition: 'advent',
  rules_version: 'v2',
  content_format: 'advent',
  gear: [{ name: 'Rapier', description: '' }, { name: 'Cloak', description: '' }],
  abilities: [{ name: 'Riposte', description: '' }, { name: 'Feint', description: '' }],
  advanced_abilities: [],
  created_at: '2023-01-01T00:00:00Z',
};
const LN_FORK = {
  ...LN_ADVENT,
  id: 'class-ln-fork',
  base_class_id: LN_ADVENT.id,
  rules_edition: 'aspirant',
  content_format: 'aspirant',
  gear: [{ name: 'RAPIER', description: '' }],
  abilities: [{ name: 'RIPOSTE', description: '' }],
  created_at: '2024-01-01T00:00:00Z',
};
const LN_FAMILY_ROWS = [
  { id: LN_ADVENT.id, base_class_id: null, rules_edition: 'advent', content_format: 'advent' },
  { id: LN_FORK.id, base_class_id: LN_ADVENT.id, rules_edition: 'aspirant', content_format: 'aspirant' },
];
```

Add `[LN_FORK.id]: LN_FORK,` and `[LN_ADVENT.id]: LN_ADVENT,` to `CLASS_BY_ID`.

Add this test right after `'the edit page prices a fork character\'s Advent-origin items at the own rate'`:

```js
test('the edit page offers an Aspirant character each lineage\'s item once, from its Aspirant version', async () => {
  pageState.character = {
    id: CHAR_ID,
    name: 'Dara',
    class: 'Duelist',
    class_id: LN_FORK.id,
    creator_id: 'profile-1',
    creator_mode: 'aspirant',
    is_public: true,
    level: 3,
    completed_missions: 0,
    ...Object.fromEntries(statList.map(stat => [stat, 2])),
    traits: [],
    abilities: [],
    gear: [],
    ability_perks: [],
    quirks: [],
    accessories: [],
    common_items: [],
    perks: '',
    additional_gear: '',
  };
  pageState.unlockedClassIds = new Set([LN_ADVENT.id, LN_FORK.id]);
  pageState.extraAdventClasses = [LN_ADVENT];
  pageState.extraAspirantClasses = [LN_FORK];
  pageState.classFamilyRows = LN_FAMILY_ROWS;

  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  const island = (id) => JSON.parse(body.match(new RegExp(`id="${id}">([^<]*)</script>`))[1]);
  const named = (entries, name) => entries.filter((e) => e.name.trim().toLowerCase() === name);
  const gear = island('gear-purchase-data').entries;
  expect(named(gear, 'rapier').map((e) => e.class_id)).toEqual([LN_FORK.id]);
  expect(named(gear, 'cloak').map((e) => e.class_id)).toEqual([LN_ADVENT.id]);
  const abilities = island('ability-purchase-data').entries;
  expect(named(abilities, 'riposte').map((e) => e.class_id)).toEqual([LN_FORK.id]);
  expect(named(abilities, 'feint').map((e) => [e.class_id, e.crossClass])).toEqual([[LN_ADVENT.id, false]]);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/gear-purchase-data.test.js routes/characters.test.js`
Expected: FAIL, with these two failures:
- The `Stetson` test receives `[]`, because `isOwnVersion` skips the newer version.
- The route test's `rapier` expectation receives `['class-ln-fork', 'class-ln-advent']`.

- [ ] **Step 3: Remove `isOwnVersion` from `util/gear-purchase-data.js`**

Delete lines 39-43 (the `isOwnVersion` comment and function). Replace the `buildEntries` comment and signature, together with the loop's first two lines (lines 45-69), with:

```js
// What the grid offers: every Signature the character's class prints (its
// roster), then the catalogue of other classes' Signatures it may buy, then an
// entry for anything the character already owns that neither covers. Without
// the last part those owned rows would have no controls.
//
// allClasses is util/class-lineage.js#purchaseCatalogue: for an aspirant
// character each Signature name once per lineage, its own class first. An
// aspiring character is class-less, so it has no roster; its Class is three
// named Signatures (pg. 90) and its catalogue is every served class.
//
// A stored class_gear row arrives merged with its class's printed entry
// (services/character/repository.js#getCharacterGear), so it already carries
// the description, meters and Default Enchantment the entry needs.
const buildEntries = ({ characterClass, allClasses, gear, economy, aspiringSignatures }) => {
  const roster = Array.isArray(characterClass && characterClass.gear)
    ? characterClass.gear.map((item) => toEntry(item, characterClass.id, characterClass.name))
    : [];
  const seen = new Set(roster.map((entry) => entryKey(entry.class_id, entry.name)));
  const catalogue = [];
  for (const cls of (Array.isArray(allClasses) ? allClasses : [])) {
    if (!cls || !cls.id || !Array.isArray(cls.gear)) continue;
```

The rest of the loop (`for (const item of cls.gear) { ... }`) is unchanged. In `buildGearPurchaseData`, replace the `buildEntries({ ... })` call with:

```js
  const entries = buildEntries({
    characterClass,
    allClasses,
    gear,
    economy,
    aspiringSignatures: character && character.aspiring_signatures
  });
```

- [ ] **Step 4: Rewrite the catalogue comment in `util/ability-purchase-data.js`**

Replace lines 42-52 (the comment above `buildCatalogue`) with:

```js
// The full catalogue an aspirant or aspiring character may buy from: the
// character's own class first, then every class in `allClasses`
// (util/class-lineage.js#purchaseCatalogue, which gives an aspirant character
// each Ability name once per lineage). This module deduplicates only by
// class + name, so the own class, added first, wins against its own row in
// the catalogue.
```

- [ ] **Step 5: Serve the lineage catalogue from the edit GET**

In `routes/characters.js`, add after line 47 (`const { latestClassVersions, ... } = require('../util/class-list-grouping');`):

```js
const { purchaseCatalogue } = require('../util/class-lineage');
```

Replace lines 553-561 (the comment `// Only a V1 character needs the catalogue: ...` through the `allClasses` ternary) with:

```js
    // An aspirant character's Signatures and Abilities can Cross-Class
    // against every other unlocked class (pg. 3), and an aspiring character
    // has no class of its own at all. The roster is the one
    // filterClassDataForUser already fetched for the Class <select>.
    const allClasses = purchaseCatalogue({
      economy,
      classes: [...filteredAdvent, ...filteredAspirant, ...filteredPCC],
      characterClass
    });
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/gear-purchase-data.test.js util/ability-purchase-data.test.js routes/characters.test.js`
Expected: every test passes, 0 fail.

Run: `grep -rn "isOwnVersion" util routes test`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add routes/characters.js routes/characters.test.js util/gear-purchase-data.js util/gear-purchase-data.test.js util/ability-purchase-data.js
git commit -m "feat: edit-page shops list each lineage's item once for Aspirant characters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Classic pickers list each lineage's item once for an Aspirant form

**Files:**
- Modify: `routes/characters.js:128-146` (extract the picker maps from `filterClassDataForUser`), `:846-858` (both partial routes)
- Modify: `views/character-form.handlebars:347-349` and `:403-405` (the two Add buttons)
- Test: `routes/characters.test.js` (new tests after the classic picker tests near `:590`)

**Interfaces:**
- Consumes: `lineageCatalogue` (Task 1), `economyFor` (`util/merx-economy.js`).
- Produces:
  - `gearPickerMap(classes) => { [classId]: { name, items: string[] } }`, internal to `routes/characters.js`.
  - `abilityPickerMap(classes) => { [classId]: { name, items: { name, type }[] } }`, internal.
  - `classicPickerLists(user, query) => Promise<{ gear, abilities }>`, internal.
  - `GET /characters/class-gear` and `/class-abilities` accept `class_id` and `creator_mode` query parameters.

- [ ] **Step 1: Write the failing tests**

Add to `routes/characters.test.js`, after `'the classic ability picker prefixes each option with its class id, not the shared class name'`:

```js
// The classic pickers list each lineage's item once when the form's class puts
// the character on the Aspirant economy.
test('the classic pickers of an Aspirant form list each lineage\'s item once', async () => {
  pageState.extraAdventClasses = [LN_ADVENT];
  pageState.extraAspirantClasses = [LN_FORK];

  const gearRes = await fetch(`${baseUrl}/characters/class-gear?class_id=${LN_FORK.id}`, {
    headers: { Accept: 'text/html' },
  });
  expect(gearRes.status).toBe(200);
  const gear = await gearRes.text();
  expect(gear).toContain(`value="${LN_FORK.id}::RAPIER"`);
  expect(gear).not.toContain(`value="${LN_ADVENT.id}::Rapier"`);
  expect(gear).toContain(`value="${LN_ADVENT.id}::Cloak"`);

  const abilityRes = await fetch(`${baseUrl}/characters/class-abilities?class_id=${LN_FORK.id}`, {
    headers: { Accept: 'text/html' },
  });
  const abilities = await abilityRes.text();
  expect(abilities).toContain(`value="${LN_FORK.id}::RIPOSTE::core"`);
  expect(abilities).not.toContain(`value="${LN_ADVENT.id}::Riposte::core"`);
  expect(abilities).toContain(`value="${LN_ADVENT.id}::Feint::core"`);
});

test('the classic pickers of an Advent form list every class\'s items', async () => {
  pageState.extraAdventClasses = [LN_ADVENT];
  pageState.extraAspirantClasses = [LN_FORK];

  const res = await fetch(`${baseUrl}/characters/class-gear?class_id=${LN_ADVENT.id}&creator_mode=advent`, {
    headers: { Accept: 'text/html' },
  });
  const body = await res.text();
  expect(body).toContain(`value="${LN_FORK.id}::RAPIER"`);
  expect(body).toContain(`value="${LN_ADVENT.id}::Rapier"`);
});

test('the Add buttons send the form\'s class and the stored mode', async () => {
  pageState.character = {
    ...makePageCharacter(0),
    creator_id: 'profile-1',
    class_id: ADVENT_V1_CLASS.id,
    creator_mode: 'advent',
  };

  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toMatch(/hx-get="\/characters\/class-gear"[^>]*hx-include="#char-class-id"[^>]*hx-vals='\{"creator_mode": "advent"\}'/);
  expect(body).toMatch(/hx-get="\/characters\/class-abilities"[^>]*hx-include="#char-class-id"[^>]*hx-vals='\{"creator_mode": "advent"\}'/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/characters.test.js`
Expected: FAIL, with these failures:
- The Aspirant picker test fails on `not.toContain('value="class-ln-advent::Rapier"')`.
- The Add-buttons test fails its first `toMatch`.

- [ ] **Step 3: Extract the picker maps**

In `routes/characters.js`, add above `const filterClassDataForUser` (line 117):

```js
// The classic pickers' options, keyed by class id: versions of one class share
// a name, so only the id tells the server which one a pick came from.
const gearPickerMap = (classes) => Object.fromEntries(classes.map(c => [c.id, {
  name: c.name,
  items: Array.isArray(c.gear) ? c.gear.map(g => g.name) : []
}]));

// A V1 class carries three Core Abilities and three Advanced ones, and an
// Advanced Ability costs Perks to unlock (pg. 7). The type travels with the
// name because the option posts as a single string: without it an Advanced
// pick is stored as core and priced as though it were free.
const abilityPickerMap = (classes) => Object.fromEntries(classes.map(c => [c.id, {
  name: c.name,
  items: [
    ...(Array.isArray(c.abilities) ? c.abilities.map(a => ({ name: a.name, type: 'core' })) : []),
    ...(Array.isArray(c.advanced_abilities) ? c.advanced_abilities.map(a => ({ name: a.name, type: 'advanced' })) : [])
  ]
}]));
```

Inside `filterClassDataForUser`, replace lines 133-146 (from the comment `// Build lookup maps for gear and abilities keyed by class id: ...` through `let filteredAbilities = Object.fromEntries(...);`) with:

```js
  const allClasses = [...advent, ...aspirant, ...pcc];
  let filteredGear = gearPickerMap(allClasses);
  let filteredAbilities = abilityPickerMap(allClasses);
```

- [ ] **Step 4: Serve lineage-pruned pickers for an Aspirant form**

Add after `abilityPickerMap`, still above `filterClassDataForUser`, a function that is called only from the two routes below:

```js
// For a form whose class puts the character on the Aspirant economy, each
// lineage's item once (util/class-lineage.js#lineageCatalogue).
const classicPickerLists = async (user, query) => {
  const { filteredAdvent, filteredAspirant, filteredPCC, filteredGear, filteredAbilities } = await filterClassDataForUser(user);
  const classId = (query.class_id || '').toString() || null;
  const roster = [...filteredAdvent, ...filteredAspirant, ...filteredPCC];
  const selected = classId ? roster.find(c => c.id === classId) : null;
  const economy = selected
    ? economyFor({ contentFormat: selected.content_format, creatorMode: (query.creator_mode || '').toString() || null })
    : null;
  if (economy !== 'aspirant') return { gear: filteredGear, abilities: filteredAbilities };
  const catalogue = lineageCatalogue(roster, { ownClassId: classId });
  return { gear: gearPickerMap(catalogue), abilities: abilityPickerMap(catalogue) };
};
```

`classicPickerLists` calls `filterClassDataForUser` at request time, so declaring it above that `const` is safe.

Change the Task 2 import line to:

```js
const { lineageCatalogue, purchaseCatalogue } = require('../util/class-lineage');
```

Replace the two routes (lines 846-858) with:

```js
router.get('/class-gear', authOptional, async (req, res) => {
  const { gear } = await classicPickerLists(res.locals.user, req.query);
  res.render('partials/character-class-gear', {
    layout: false,
    classGearList: gear,
    adventDefaultSignatures: ADVENT_DEFAULT_SIGNATURES
  });
});

router.get('/class-abilities', authOptional, async (req, res) => {
  const { abilities } = await classicPickerLists(res.locals.user, req.query);
  res.render('partials/character-class-abilities', { layout: false, classAbilityList: abilities });
});
```

- [ ] **Step 5: Send the class and mode from the Add buttons**

In `views/character-form.handlebars`, replace:

```handlebars
    <button class="button is-primary" hx-get="/characters/class-gear" hx-target="#class-gear-list"
      hx-swap="beforeend">Add
      Signature Gear</button>
```

with:

```handlebars
    <button class="button is-primary" hx-get="/characters/class-gear" hx-target="#class-gear-list"
      hx-include="#char-class-id" hx-vals='{"creator_mode": "{{character.creator_mode}}"}'
      hx-swap="beforeend">Add
      Signature Gear</button>
```

and replace:

```handlebars
    <button class="button is-primary" hx-get="/characters/class-abilities" hx-target="#class-ability-list"
      hx-swap="beforeend">Add
      Class Abilities</button>
```

with:

```handlebars
    <button class="button is-primary" hx-get="/characters/class-abilities" hx-target="#class-ability-list"
      hx-include="#char-class-id" hx-vals='{"creator_mode": "{{character.creator_mode}}"}'
      hx-swap="beforeend">Add
      Class Abilities</button>
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/characters.test.js routes/characters-edition-access.test.js`
Expected: every test passes, 0 fail.

Run: `grep -n "abilityOptions" routes/characters.js`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add routes/characters.js routes/characters.test.js views/character-form.handlebars
git commit -m "feat: classic pickers list each lineage's item once for an Aspirant form

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Wizard route serves own-class ids, lineage ids and a lineage shop

**Files:**
- Modify: `routes/characters.js:40` (import), `:292-376` (`wizardClasses`), `:392-400` (`wizardData`)
- Test: `routes/characters-wizard-data.test.js:66-69` (mock honours `rules_edition`), plus new tests at the end

**Interfaces:**
- Consumes: `ownClassIds` (`util/class-family.js`); `lineageIdOf` and `lineageCatalogue` (Task 1).
- Produces:
  - Every `wizardData.classes[]` card gains `own_class_ids: string[]` and `lineage_id: string`.
  - `wizardData.shopClasses: { id, name, lineage_id, class_gear, abilities, advanced_abilities }[]`. In aspirant mode it is the lineage catalogue built with no own class; in the other modes it is the card list itself.
  - `wizardClassGear(c) => class_gear[]`, internal.

- [ ] **Step 1: Make the mock honour `rules_edition`, then write the failing tests**

In `routes/characters-wizard-data.test.js`, replace the `getClasses` mock (lines 66-69):

```js
  getClasses: async (filters = {}) => {
    if (filters.is_player_created === true) return { data: [], error: null };
    return { data: classPool, error: null };
  },
```

with:

```js
  getClasses: async (filters = {}) => {
    if (filters.is_player_created === true) return { data: [], error: null };
    return { data: classPool.filter((c) => (c.rules_edition || 'advent') === filters.rules_edition), error: null };
  },
```

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/characters-wizard-data.test.js`
Expected: every existing test passes. The mock no longer returns each class twice.

Append to the end of the file:

```js
const LINEAGE_CLASSES = [
  {
    id: 'gs-advent', name: 'Gunslinger', content_format: 'advent', created_at: '2025-01-01T00:00:00Z',
    gear: [{ name: 'Revolver' }, { name: 'Duster' }], abilities: [{ name: 'Trickshot' }, { name: 'Quickdraw' }]
  },
  {
    id: 'gs-fork', name: 'Gunslinger', base_class_id: 'gs-advent', rules_edition: 'aspirant',
    content_format: 'aspirant', created_at: '2026-01-01T00:00:00Z',
    gear: [{ name: 'REVOLVER' }], abilities: [{ name: 'Trickshot' }]
  }
];

test('an aspirant wizard sells each lineage\'s item once and serves each card its own-class ids', async () => {
  const data = await renderWizardData({ mode: 'aspirant', classes: LINEAGE_CLASSES });
  expect(data.classes.map((c) => c.id)).toEqual(['gs-fork']);
  expect([...data.classes[0].own_class_ids].sort()).toEqual(['gs-advent', 'gs-fork']);
  const shop = Object.fromEntries(data.shopClasses.map((c) => [c.id, c]));
  expect(shop['gs-fork'].class_gear.map((g) => g.name)).toEqual(['REVOLVER']);
  expect(shop['gs-advent'].class_gear.map((g) => g.name)).toEqual(['Duster']);
  expect(shop['gs-advent'].abilities.map((a) => a.name)).toEqual(['Quickdraw']);
  expect(shop['gs-advent'].lineage_id).toBe(data.classes[0].lineage_id);
});

test('a preselected forked Advent class keeps its card, and its own class stops at its Advent family', async () => {
  const data = await renderWizardData({ mode: 'aspirant', classes: LINEAGE_CLASSES, preselect: 'gs-advent' });
  const card = data.classes.find((c) => c.id === 'gs-advent');
  expect(card.own_class_ids).toEqual(['gs-advent']);
  expect(card.lineage_id).toBe(data.classes.find((c) => c.id === 'gs-fork').lineage_id);
});

test('outside aspirant mode the shop is the card list', async () => {
  const data = await renderWizardData({
    mode: 'advent', classes: [{ id: 'c-advent', content_format: 'advent', gear: [{ name: 'Bow' }] }]
  });
  expect(data.shopClasses.map((c) => c.id)).toEqual(data.classes.map((c) => c.id));
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/characters-wizard-data.test.js`
Expected: the three new tests FAIL. `own_class_ids` is undefined (`TypeError ... is not iterable`), and `data.shopClasses` is undefined.

- [ ] **Step 3: Extract `wizardClassGear`**

In `routes/characters.js`, add above `router.get('/wizard', ...)`:

```js
// Every Signature a class carries, in printed order. A V1 class has twelve
// across four columns; an Advent class has six. `column` and `position` come
// from the class contract (util/class-gear.js) and are layout facts, not
// economy ones -- nothing gates a purchase on a column (see the spec, "Two
// things the book does not say").
const wizardClassGear = (c) => (Array.isArray(c.gear)
  ? c.gear.map((g, idx) => ({
      name: g.name || '',
      description_html: renderMarkdown(g.description || ''),
      meters: Array.isArray(g.meters) ? g.meters : [],
      column: g.column || null,
      position: g.position || null,
      default_enchantment: g.default_enchantment || null,
      subtype: idx < ADVENT_DEFAULT_SIGNATURES ? 'base' : 'elective'
    }))
  : []);
```

Inside the `wizardClasses` map, replace the whole `class_gear` entry and its seven-line comment (from `// Every Signature the class carries, in printed order.` through the `: [],` that closes `class_gear`) with:

```js
      class_gear: wizardClassGear(c),
```

- [ ] **Step 4: Add own-class ids, lineage ids and the shop**

Change line 40 to:

```js
const { familyResolver, ownClassIds } = require('../util/class-family');
```

Change the Task 3 import line to:

```js
const { lineageCatalogue, lineageIdOf, purchaseCatalogue } = require('../util/class-lineage');
```

In the `wizardClasses` map, replace the end of the `base_gear` entry:

```js
      base_gear: Array.isArray(c.gear)
        ? c.gear.slice(0, ADVENT_DEFAULT_SIGNATURES).map((g) => ({
            name: g.name || '',
            description_html: renderMarkdown(g.description || '')
          }))
        : []
    }));
```

with:

```js
      base_gear: Array.isArray(c.gear)
        ? c.gear.slice(0, ADVENT_DEFAULT_SIGNATURES).map((g) => ({
            name: g.name || '',
            description_html: renderMarkdown(g.description || '')
          }))
        : [],
      // The client prices and prunes against these, never its own rule
      // (util/class-family.js#ownClassIds, util/class-lineage.js#lineageIdOf).
      own_class_ids: [...ownClassIds(roster, c.id)],
      lineage_id: lineageIdOf(roster, c.id)
    }));

  // What the shops sell. An aspirant character sees each item name once per
  // lineage; public/js/character-wizard.js#shopClassesFor drops the selected
  // card and the names it prints from the rest of its lineage.
  const shopClasses = mode === 'aspirant'
    ? lineageCatalogue(roster).map((c) => ({
        id: c.id,
        name: c.name,
        lineage_id: c.lineage_id,
        class_gear: wizardClassGear(c),
        abilities: c.abilities,
        advanced_abilities: c.advanced_abilities
      }))
    : wizardClasses;
```

In `wizardData`, add `shopClasses,` on the line after `classes: wizardClasses,`.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/characters-wizard-data.test.js routes/character-wizard-classes.test.js routes/character-wizard.test.js routes/character-wizard-aspiring.test.js`
Expected: every test passes, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add routes/characters.js routes/characters-wizard-data.test.js
git commit -m "feat: wizard serves own-class ids, lineage ids and a lineage shop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wizard client prices by own class, sells each lineage's item once, refuses a held name

**Files:**
- Modify: `public/js/character-wizard.js`, in these places:
  - after `:297` (new helpers);
  - `:1911-1930` (`ownCoreSpend` and `perksSpent`);
  - `:1952-1957` (`canAcquire`);
  - `:1970-2005` (`abilityShopEntries` and its comment);
  - `:2044-2046` (shop tag);
  - `:2786-2792` (`signaturePriceFor`);
  - `:2822-2884` (the `getShopPool` comment and its class-item loop);
  - `:2900-2909` (`purchaseFor`);
  - `:2912-2916` (`crossClassFor`);
  - `:4312-4340` (handle).
- Modify: `test/helpers/wizard-fixture.js:306-320` (`shopClasses` default)
- Test: `test/character-wizard-client.test.js` (new `describe` at the end)

**Interfaces:**
- Consumes: `DATA.shopClasses`, and each card's `own_class_ids` and `lineage_id` (Task 4).
- Produces:
  - The wizard handle gains `abilityShopEntries(state) => { classId, className, abilityName, type, crossClass }[]`.
  - `perksSpent(state)` applies the free-Core allowance to acquired own-class Core picks.
  - `canAcquire(state, pick)` is false for a name the state already holds.

- [ ] **Step 1: Default `shopClasses` in the fixture**

In `test/helpers/wizard-fixture.js` `fixture()`, add `shopClasses: classes,` on the line after `classes,` in the returned object. (`...overrides` still wins.)

- [ ] **Step 2: Write the failing tests**

Append to `test/character-wizard-client.test.js`:

```js
describe('the aspirant shops sell each name once per lineage', () => {
  const card = (id, name, format, lineage, own, lists) => ({
    id, name, content_format: format, lineage_id: lineage, own_class_ids: own,
    stat_spread: {}, gear: [], base_gear: [],
    class_gear: lists.gear.map((n) => ({ name: n, description_html: '' })),
    abilities: lists.core.map((n) => ({ name: n })), abilities_html: [],
    advanced_abilities: lists.advanced.map((n) => ({ name: n })), advanced_abilities_html: []
  });
  const GS_FORK = card('gs-fork', 'Gunslinger', 'aspirant', 'gs', ['gs-fork', 'gs-advent'],
    { gear: ['Revolver', 'Bolo'], core: ['Trickshot', 'Deadeye'], advanced: ['Standoff'] });
  const GS_ADVENT = card('gs-advent', 'Gunslinger', 'advent', 'gs', ['gs-advent'],
    { gear: ['Revolver', 'Duster'], core: ['Trickshot', 'Quickdraw'], advanced: ['Standoff'] });
  const WANDERER = card('wd', 'Wanderer', 'aspirant', 'wd', ['wd'],
    { gear: ['Satchel'], core: ['Familiar Face'], advanced: [] });
  const MESMER = card('ms', 'Mesmer', 'aspirant', 'ms', ['ms'],
    { gear: [], core: [' trickshot', 'Glamour'], advanced: [] });
  // DATA.shopClasses as the route serves it (util/class-lineage.js#lineageCatalogue
  // with no own class): the Advent class keeps only what its Aspirant version
  // does not print.
  const SHOP = [
    GS_FORK,
    { ...GS_ADVENT, class_gear: [{ name: 'Duster', description_html: '' }], abilities: [{ name: 'Quickdraw' }], advanced_abilities: [] },
    WANDERER,
    MESMER
  ];
  const boot = (classId, cards) => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: cards, shopClasses: SHOP, preselectedClassId: classId }));
    wizard.getState().classId = classId;
    wizard.getState().level = 10;
    return wizard;
  };

  test('the Signature shop sells the Advent-only items once, at the own-class price', () => {
    const wizard = boot('gs-fork', [GS_FORK, WANDERER, MESMER]);
    const items = wizard.getShopPool().filter((p) => p.kind === 'class');
    expect(items.map((p) => [p.key, p.cost])).toEqual([
      ['class:gs-advent:Duster', FIGURES.prices.signature.own],
      ['class:wd:Satchel', FIGURES.prices.signature.cross]
    ]);
  });

  test('a preselected forked Advent class buys its Aspirant version\'s other items cross-class', () => {
    const wizard = boot('gs-advent', [GS_FORK, WANDERER, MESMER, GS_ADVENT]);
    const items = wizard.getShopPool().filter((p) => p.kind === 'class');
    expect(items.map((p) => [p.key, p.cost])).toEqual([
      ['class:gs-fork:Bolo', FIGURES.prices.signature.cross],
      ['class:wd:Satchel', FIGURES.prices.signature.cross]
    ]);
  });

  test('the Ability shop sells the Advent-only Core as own class, and nothing of its lineage twice', () => {
    const wizard = boot('gs-fork', [GS_FORK, WANDERER, MESMER]);
    const entries = wizard.abilityShopEntries(wizard.getState());
    expect(entries.map((e) => [e.classId, e.abilityName, e.type, e.crossClass])).toEqual([
      ['gs-fork', 'Standoff', 'advanced', false],
      ['gs-advent', 'Quickdraw', 'core', false],
      ['wd', 'Familiar Face', 'core', true],
      ['ms', ' trickshot', 'core', true],
      ['ms', 'Glamour', 'core', true]
    ]);
  });

  test('an own-class Core bought inside the free allowance costs nothing, as on the server', () => {
    const wizard = boot('gs-fork', [GS_FORK, WANDERER, MESMER]);
    const state = wizard.getState();
    expect(wizard.acquireAbility(state, { classId: 'gs-advent', abilityName: 'Quickdraw', type: 'core', crossClass: false })).toBe(true);
    expect(wizard.perksSpent(state)).toBe(0);
  });

  test('a name the character already holds cannot be bought from another class', () => {
    const wizard = boot('gs-fork', [GS_FORK, WANDERER, MESMER]);
    const state = wizard.getState();
    expect(wizard.canAcquire(state, { classId: 'ms', abilityName: ' trickshot', type: 'core', crossClass: true })).toBe(false);
    expect(wizard.canAcquire(state, { classId: 'ms', abilityName: 'Glamour', type: 'core', crossClass: true })).toBe(true);
    expect(wizard.acquireAbility(state, { classId: 'wd', abilityName: 'Familiar Face', type: 'core', crossClass: true })).toBe(true);
    expect(wizard.canAcquire(state, { classId: 'ms', abilityName: 'FAMILIAR FACE', type: 'core', crossClass: true })).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test test/character-wizard-client.test.js`
Expected: the five new tests FAIL. Each fails for its own reason:
- The Signature shop yields only `class:wd:Satchel` and `class:ms:...`.
- `wizard.abilityShopEntries is not a function`.
- The perk spend is `1`, not `0`.
- `canAcquire` returns `true` for ` trickshot`.

- [ ] **Step 4: Add the name key, own-class ids and `shopClassesFor`**

In `public/js/character-wizard.js`, right after `selectedClass` (line 297), add:

```js
  // Names compare trimmed and case-folded (util/item-name.js#nameKey).
  const nameKey = (value) => String(value == null ? '' : value).trim().toLowerCase();

  // The route resolves each card's own class (util/class-family.js#ownClassIds).
  const ownClassIdsOf = (classId) => {
    const cls = classId ? classesById[classId] : null;
    return (cls && cls.own_class_ids) || [];
  };

  const shopClassNames = {};
  DATA.shopClasses.forEach((c) => { shopClassNames[c.id] = c.name; });

  // What the shops sell beside the selected class: every other served class.
  // DATA.shopClasses holds each name once per lineage already; the classes of
  // the selected class's own lineage also drop the names it prints, which
  // puts it first in util/class-lineage.js#lineageCatalogue's order.
  const shopClassesFor = (s) => {
    const own = s && s.classId ? classesById[s.classId] : null;
    const ownGear = new Set(((own && own.class_gear) || []).map((g) => nameKey(g && g.name)));
    const ownAbilities = new Set(((own && own.abilities) || []).concat((own && own.advanced_abilities) || [])
      .map((a) => nameKey(a && a.name)));
    const notOwn = (names) => (item) => !!(item && item.name) && !names.has(nameKey(item.name));
    return DATA.shopClasses
      .filter((cls) => cls && cls.id && !(own && cls.id === own.id))
      .map((cls) => (own && own.lineage_id && cls.lineage_id === own.lineage_id
        ? Object.assign({}, cls, {
          class_gear: (cls.class_gear || []).filter(notOwn(ownGear)),
          abilities: (cls.abilities || []).filter(notOwn(ownAbilities)),
          advanced_abilities: (cls.advanced_abilities || []).filter(notOwn(ownAbilities))
        })
        : cls));
  };
```

- [ ] **Step 5: Mirror the server's unlock spend and refuse a held name**

Replace the block from the comment `// pg. 7: a character's own Core roster is its free allowance, and only the` (line 1909) through the end of `perksSpent` (line 1930) with:

```js
  // Step 3's Perk, once attached to one of the class's Abilities, ships as an
  // Ability Perk row (buildSubmitPayload), and util/perk-economy.js#perkSpend
  // charges ABILITY_PERK_COST for it -- so one condition decides both.
  const attachesAbilityPerk = (s) => DATA.mode === 'aspirant'
    && !!(s && s.perkAbilityName) && !!((s && s.perk) || '').trim();

  // util/perk-economy.js#unlockSpend over what buildSubmitPayload sends: the
  // printed Core roster, then every acquired pick. The first
  // PERKS.freeCoreAbilities own-class Core rows are free, wherever they come
  // from.
  const unlockSpend = (s) => {
    const free = (PERKS.freeCoreAbilities && PERKS.freeCoreAbilities[economyOf(s)]) || 0;
    const rows = printedCoreRoster(s).map(() => ({ type: 'core', crossClass: false }))
      .concat(s.acquiredAbilities || []);
    let waived = 0;
    return rows.reduce((total, row) => {
      if (!row.crossClass && row.type !== 'advanced' && waived < free) {
        waived += 1;
        return total;
      }
      return total + priceOfPick(row);
    }, 0);
  };

  const perksSpent = (s) => unlockSpend(s) + (attachesAbilityPerk(s) ? PERKS.abilityPerkCost : 0);
```

(This replaces `ownCoreSpend`, its comment, the old `attachesAbilityPerk` block and the old `perksSpent`. `attachesAbilityPerk` is restated unchanged.)

Replace `canAcquire` (lines 1952-1957) with:

```js
  // services/character/input.js refuses a save that holds one Ability name
  // twice, whatever the class.
  const holdsAbilityName = (s, name) => {
    const key = nameKey(name);
    return printedCoreRoster(s).some((a) => nameKey(a.name) === key)
      || (s.acquiredAbilities || []).some((a) => nameKey(a.abilityName) === key);
  };

  const canAcquire = (s, pick) => {
    if (holdsAbilityName(s, pick.abilityName)) return false;
    const cap = PERKS.abilityCap[economyOf(s)];
    if (cap != null && abilitiesUsed(s) + 1 > cap) return false;
    return perksSpent(Object.assign({}, s, { acquiredAbilities: (s.acquiredAbilities || []).concat([pick]) })) <= perksGrant(s);
  };
```

- [ ] **Step 6: Build the Ability shop from the lineage shop**

Replace the comment above `abilityShopEntries` from `// Reuses DATA.classes as its roster exactly as the Signature shop's` down to the end of the function (lines 1978-2005) with:

```js
  // The selected class sells its own Advanced Abilities; every other class
  // sells from shopClassesFor. A class inside the selected class's own-class
  // set (its Advent origin, for an Aspirant version) prices as own class, so
  // its Core rows are own Core and may fall inside the free allowance.
  const abilityShopEntries = (s) => {
    const own = s && s.classId ? classesById[s.classId] : null;
    const ownIds = ownClassIdsOf(s && s.classId);
    const isOwnClass = (id) => !!own && (id === own.id || ownIds.indexOf(id) !== -1);
    const entries = [];
    const push = (cls, a, type) => {
      if (!a || !a.name) return;
      entries.push({ classId: cls.id, className: cls.name || '', abilityName: a.name, type: type, crossClass: !isOwnClass(cls.id) });
    };
    if (own) (own.advanced_abilities || []).forEach((a) => push(own, a, 'advanced'));
    shopClassesFor(s).forEach((cls) => {
      (cls.abilities || []).forEach((a) => push(cls, a, 'core'));
      (cls.advanced_abilities || []).forEach((a) => push(cls, a, 'advanced'));
    });
    return entries;
  };
```

In `renderAbilityShop`, replace:

```js
        +           (entry.crossClass
              ? ' <span class="tag is-info is-light ml-1">cross-class</span>'
              : ' <span class="tag is-info is-light ml-1">advanced</span>')
```

with:

```js
        +           ' <span class="tag is-info is-light ml-1">' + (entry.crossClass ? 'cross-class' : entry.type) + '</span>'
```

- [ ] **Step 7: Price Signatures by own-class ids and sell from `shopClassesFor`**

In `signaturePriceFor` and in `crossClassFor`, add `ownClassIds: ownClassIdsOf(state.classId),` after `characterClassId: state.classId,`.

In `purchaseFor`, replace `class_name: (classesById[classId] || {}).name || '',` with:

```js
    class_name: (classesById[classId] || {}).name || shopClassNames[classId] || '',
```

In `getShopPool`'s comment, replace the line `//   - aspirant mode: every unlocked Class's gear except the one the grid` and the line after it (`//     holds, priced by signaturePriceFor at the Cross-Class tier.`) with:

```js
  //   - aspirant mode: shopClassesFor's classes, priced by signaturePriceFor
  //     (own class for the selected class's own-class set).
```

Replace the comment beginning `// The grid sells whatever counts as the character's own Class; the shop` and the `if (usesSignatureGrid()) { ... }` branch up to (not including) its `} else {` with:

```js
    // The grid sells the selected Class; the shop sells shopClassesFor's
    // classes. For aspiring, whose Class is three named items, it is every
    // Signature outside the pool. Branching on the resolved economy rather
    // than DATA.mode is what keeps this agreeing with usesSignatureGrid, so
    // ?mode=advent on an aspirant-content class still produces a shop with
    // class items in it.
    if (usesSignatureGrid()) {
      shopClassesFor(state).forEach((cls) => {
        if (!Array.isArray(cls.class_gear)) return;
        cls.class_gear.forEach((g) => {
          if (!g || !g.name) return;
          if (economyForState() === 'aspiring' && !crossClassFor(cls.id, g.name)) return;
          pushClassItem(cls, g);
        });
      });
```

- [ ] **Step 8: Expose `abilityShopEntries`**

In the returned handle at the end of the file, add `abilityShopEntries,` after `renderAbilityShop`. Put a comma after `renderAbilityShop` first.

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test test/character-wizard-client.test.js test/character-wizard-kiosk-card.test.js test/character-wizard-kiosk-tabs.test.js test/signature-entry.test.js`
Expected: every test passes, 0 fail.

Run: `grep -n "ownCoreSpend" public/js/character-wizard.js test`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add public/js/character-wizard.js test/helpers/wizard-fixture.js test/character-wizard-client.test.js
git commit -m "feat: wizard shops sell each lineage's item once and refuse a held Ability name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Edit-page Ability island refuses a name the character already holds

**Files:**
- Modify: `public/js/character-ability-purchases.js:89-96` (add helpers), `:179-187` (`buyAbility`), `:212-218` (Buy button)
- Test: `test/character-ability-purchases.test.js` (new `describe` after `'buying and dropping'`)

**Interfaces:**
- Consumes: the island's `entries` and `owned` (unchanged).
- Produces: `buyAbility(name, classId)` returns `false` for a name already held from any class. The Buy button is disabled for it.

- [ ] **Step 1: Write the failing tests**

Add after the `describe('buying and dropping', ...)` block:

```js
describe('an Ability name is held once', () => {
  // Another class printing the name the character already holds, spelled
  // differently.
  const withEcho = () => fixtureIsland({
    entries: [...baseEntries(), {
      name: 'viewpoint ', class_id: 'c-third', class_name: 'Third Class',
      type: 'core', crossClass: true, price: FIGURES.prices.ability.cross.core
    }],
    owned: [{ name: 'Viewpoint', class_id: OTHER_CLASS_ID, type: 'core' }]
  });

  test('an Ability whose name the character holds from another class cannot be bought', () => {
    const form = mountAbilities(withEcho());
    expect(form.buyAbility('viewpoint ', 'c-third')).toBe(false);
    expect(form.serialize().abilities).toHaveLength(1);
  });

  test('its Buy button is disabled', () => {
    mountAbilities(withEcho());
    const button = document.querySelector('[data-ability-buy][data-ability-class="c-third"]');
    expect(button.disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test test/character-ability-purchases.test.js`
Expected: both new tests FAIL. `buyAbility` returns `true`, and `button.disabled` is `false`.

- [ ] **Step 3: Refuse a held name**

In `public/js/character-ability-purchases.js`, add after `findPurchase` (line 105):

```js
    // services/character/input.js refuses a save that holds one Ability name
    // twice, whatever the class; names compare trimmed and case-folded.
    var nameKey = function (value) { return String(value == null ? '' : value).trim().toLowerCase(); };
    var holdsName = function (name) {
      var key = nameKey(name);
      return purchases.some(function (p) { return nameKey(p.name) === key; });
    };
```

Add after `affordsPurchase`:

```js
    var canBuy = function (entry) { return !holdsName(entry.name) && affordsPurchase(entry); };
```

In `buyAbility`, replace:

```js
      if (findPurchase(entry.name, entry.class_id)) return false;
      if (!affordsPurchase(entry)) return false;
```

with:

```js
      if (!canBuy(entry)) return false;
```

In `renderEntry`, replace `+ (affordsPurchase(entry) ? '' : ' disabled')` with `+ (canBuy(entry) ? '' : ' disabled')`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test test/character-ability-purchases.test.js`
Expected: every test passes, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add public/js/character-ability-purchases.js test/character-ability-purchases.test.js
git commit -m "feat: edit-page Ability shop refuses a name the character already holds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The server refuses a duplicate Ability name, and maps the index's violation

**Files:**
- Modify: `services/character/input.js:1-25` (import), `:573-575` (check), `:905-922` (exports)
- Modify: `services/character/service.js` (imports; a helper above `class CharacterService`; `updateCharacter` context `:555-572`; both `this.saveCharacterAtomic(...)` calls `:382` and `:657`; `saveCharacterAtomic` `:691-757`)
- Test: `services/character/input.test.js`, `services/character/service.test.js`

**Interfaces:**
- Consumes: `duplicateNames` and `nameKey` (Task 1).
- Produces:
  - `duplicateAbilityMessage(characterName: string, abilityName: string) => string`, exported from `services/character/input.js`.
  - `normalizeCharacterInput` context accepts `characterName`, which is used when the submission carries no `name`.
  - `CharacterService#saveCharacterAtomic({ ..., characterName })` returns `{ data: null, error: { status: 400, message } }` for a `class_abilities_character_name_key` violation.

- [ ] **Step 1: Write the failing tests**

Append to `services/character/input.test.js`:

```js
test('a save holding one Ability name twice is refused, whatever the class or spelling', () => {
  const result = normalizeCharacterInput({
    name: 'Raven',
    abilities: [
      { name: 'Veneer', class_id: 'illusionist' },
      { name: 'Phantasm', class_id: 'illusionist' },
      { name: ' VENEER', class_id: 'mesmer' }
    ]
  });
  expect(result.error).toBe('Raven already has Veneer.');
});

test('classic picker strings are compared by name alone', () => {
  const result = normalizeCharacterInput({ name: 'Raven', abilities: ['c1::Veneer::core', 'c2::veneer::advanced'] });
  expect(result.error).toBe('Raven already has Veneer.');
});

test('an update with no name in the submission names the stored character', () => {
  const result = normalizeCharacterInput({ abilities: ['Veneer', 'Veneer'] }, { characterName: 'Raven' });
  expect(result.error).toBe('Raven already has Veneer.');
});

test('distinct Ability names pass', () => {
  const result = normalizeCharacterInput({ name: 'Raven', abilities: ['c1::Veneer::core', 'c1::Phantasm::core'] });
  expect(result.error).toBeNull();
});
```

Append to `services/character/service.test.js`:

```js
describe('one Ability name per character', () => {
  const RAVEN = { id: 'character-1', creator_id: 'profile-1', class_id: 'class-1', name: 'Raven', abilities: [] };
  const UNIQUE_VIOLATION = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "class_abilities_character_name_key"',
    details: 'Key (character_id, lower(btrim(name)))=(character-1, veneer) already exists.'
  };
  const saveAbilities = async (abilities, saveResult = ok({ id: 'character-1' })) => {
    let saved = null;
    const service = new CharacterService(makeAdapter([], {
      getCharacter: async () => ok(RAVEN),
      saveCharacterAtomic: async (args) => {
        saved = args;
        return saveResult;
      }
    }));
    const result = await service.updateCharacter('character-1', { abilities }, { id: 'profile-1' });
    return { result, saved };
  };

  test('an edit that holds one name twice is refused before the save', async () => {
    const { result, saved } = await saveAbilities([
      { name: 'Veneer', class_id: 'class-1' },
      { name: 'veneer', class_id: 'class-2' }
    ]);
    expect(result.error).toBe('Raven already has Veneer.');
    expect(saved).toBeNull();
  });

  test('the database\'s unique violation reads as the same refusal', async () => {
    const { result } = await saveAbilities([{ name: 'Veneer', class_id: 'class-1' }], { data: null, error: UNIQUE_VIOLATION });
    expect(result).toEqual({ data: null, error: { status: 400, message: 'Raven already has Veneer.' } });
  });

  test('any other unique violation passes through untouched', async () => {
    const error = { code: '23505', message: 'duplicate key value violates unique constraint "traits_pkey"', details: '' };
    const { result } = await saveAbilities([{ name: 'Veneer', class_id: 'class-1' }], { data: null, error });
    expect(result.error).toBe(error);
  });
});
```

If `describe` is not yet imported at the top of `service.test.js`, add it to the `require('bun:test')` destructuring.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/character/input.test.js services/character/service.test.js`
Expected: FAIL. The three duplicate tests in `input.test.js` get `error: null`. In `service.test.js`, the first test sees a save, and the second receives the raw `UNIQUE_VIOLATION`.

- [ ] **Step 3: Validate in `normalizeCharacterInput`**

In `services/character/input.js`, add after the existing requires:

```js
const { duplicateNames } = require('../../util/item-name');

// Ability names compare trimmed and case-folded: the key
// class_abilities_character_name_key enforces.
const duplicateAbilityMessage = (characterName, abilityName) => `${characterName} already has ${abilityName}.`;
```

Right after `if (!abilityValidation.ok) return { ... };` (line 575), add:

```js
  const [heldTwice] = duplicateNames(normalizeClassItems(childData.classAbilities).map(item => item.name));
  if (heldTwice) {
    return { data: null, childData: null, error: duplicateAbilityMessage(data.name || context.characterName, heldTwice) };
  }
```

Add `duplicateAbilityMessage,` to `module.exports`.

- [ ] **Step 4: Name the character on update, and map the violation**

In `services/character/service.js`:

1. Add `duplicateAbilityMessage` to the destructured `require('./input')` import. Also add:
   ```js
   const { nameKey } = require('../../util/item-name');
   ```
2. Above `class CharacterService`, add:
   ```js
   // The database's backstop for the check normalizeCharacterInput makes
   // first. Postgres names the colliding key in the violation's detail:
   // Key (character_id, lower(btrim(name)))=(<id>, <name>) already exists.
   const ABILITY_NAME_INDEX = 'class_abilities_character_name_key';
   const collidingAbilityName = (error, abilities) => {
     if (!error || error.code !== '23505' || !String(error.message).includes(ABILITY_NAME_INDEX)) return null;
     const key = /=\([^,]+, (.*)\) already exists/.exec(String(error.details))?.[1];
     if (!key) return null;
     const submitted = (abilities || []).find(ability => nameKey(ability.name) === key);
     return submitted ? submitted.name : key;
   };
   ```
3. In `updateCharacter`'s `normalizeCharacterInput(prepared, { ... })` context, add `characterName: existing.data.name,` after `classFamilyOf`.
4. In `createCharacter`'s call `this.saveCharacterAtomic({ id: null, actor, characterInput, childData, rulesVersion, previousAbilities: [], maps })`, add `characterName: characterInput.name`.
5. In `updateCharacter`'s call `this.saveCharacterAtomic({ id, actor, characterInput, childData, rulesVersion, previousAbilities, maps: ... })`, add `characterName: characterInput.name ?? existing.data.name`.
6. Change the `saveCharacterAtomic` method's signature to:
   ```js
   async saveCharacterAtomic({ id, actor, characterInput, characterName, childData, rulesVersion, previousAbilities, maps: providedMaps }) {
   ```
   and replace its final `return this.adapter.saveCharacterAtomic({ ... });` with:
   ```js
       const saved = await this.adapter.saveCharacterAtomic({
         characterId: id,
         creatorId: actor.id,
         character: characterInput,
         traits,
         gear,
         abilities,
         perks
       });
       const heldTwice = collidingAbilityName(saved.error, abilities);
       if (heldTwice) {
         return { data: null, error: { status: 400, message: duplicateAbilityMessage(characterName, heldTwice) } };
       }
       return saved;
   ```

Run: `grep -n "this.saveCharacterAtomic(" services/character/service.js`
Expected: exactly the two call sites edited above.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/character/input.test.js services/character/service.test.js`
Expected: every test passes, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add services/character/input.js services/character/input.test.js services/character/service.js services/character/service.test.js
git commit -m "feat: refuse a save that holds one Ability name twice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: A duplicate Ability name blocks conversion and skips the upgrade script

**Files:**
- Modify: `util/aspirant-conversion.js` (`CONVERSION_RULES`, new `duplicateAbilityBlockers`, `planConversion`, exports)
- Modify: `scripts/upgrade-converted-aspirant-classes.js` (import; the per-character loop after `upgradeBuild`)
- Test: `util/aspirant-conversion.test.js:139-142` (replace one test), plus new tests

**Interfaces:**
- Consumes: `duplicateNames` (Task 1).
- Produces:
  - `CONVERSION_RULES.duplicateAbility === 'duplicate-ability'`.
  - `duplicateAbilityBlockers({ character, abilities }) => { rule, detail }[]`.

- [ ] **Step 1: Write the failing tests**

In `util/aspirant-conversion.test.js`, replace the test `'only Traits and the Stat Cap can block'` with:

```js
  test('only Traits, the Stat Cap and a duplicate Ability name can block', () => {
    expect(Object.values(CONVERSION_RULES).sort()).toEqual(['duplicate-ability', 'stat-cap', 'traits']);
  });

  test('an Ability name held twice blocks conversion', () => {
    const plan = planConversion(carolineDenton({
      abilities: [ability('ab-trick', 'Trickshot', 'gunslinger-v1'), ability('ab-echo', ' trickshot', 'wanderer-v1')],
      abilityPerks: []
    }));
    expect(plan.blockers).toEqual([{
      rule: CONVERSION_RULES.duplicateAbility,
      detail: 'Caroline Denton has two Abilities named Trickshot. Remove one to convert.'
    }]);
  });
```

Add inside `describe('planConversion: judged on the upgraded build', ...)`:

```js
  test('an Advent row that moves onto a name the character already holds on the Aspirant version blocks', () => {
    const plan = planConversion(carolineDenton({
      classes: UPGRADE_CLASSES,
      character: { class_id: 'gs-v2' },
      gear: [],
      abilities: [abilityRow('a1', 'Trickshot', 'gs-v1'), abilityRow('a7', 'Trickshot', 'gs-asp')],
      abilityPerks: []
    }));
    expect(plan.blockers.map(blocker => blocker.rule)).toEqual([CONVERSION_RULES.duplicateAbility]);
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/aspirant-conversion.test.js`
Expected: FAIL. The rules list lacks `duplicate-ability`, and the blockers are `[]`.

- [ ] **Step 3: Add the blocker**

In `util/aspirant-conversion.js`:

- Add `const { duplicateNames } = require('./item-name');` next to the Task 1 `nameKey` import, merging them: `const { nameKey, duplicateNames } = require('./item-name');`.
- Add `duplicateAbility: 'duplicate-ability'` to `CONVERSION_RULES`.
- Add above `planConversion`:

```js
// save_character_atomic cannot store a build holding one Ability name twice
// (class_abilities_character_name_key).
const duplicateAbilityBlockers = ({ character, abilities }) => duplicateNames(listOf(abilities).map(row => row.name))
  .map(name => ({
    rule: CONVERSION_RULES.duplicateAbility,
    detail: `${character.name} has two Abilities named ${name}. Remove one to convert.`
  }));
```

- In `planConversion`, after the `addBlockers(CONVERSION_RULES.statCap, ...)` call, add:

```js
  blockers.push(...duplicateAbilityBlockers({ character, abilities: upgrade.abilities ?? abilities }));
```

- Export `duplicateAbilityBlockers`: `module.exports = { upgradeBuild, upgradeSaveArgs, planConversion, duplicateAbilityBlockers, CONVERSION_RULES };`

- [ ] **Step 4: Skip such a character in the upgrade script**

In `scripts/upgrade-converted-aspirant-classes.js`, change the import to:

```js
const { upgradeBuild, upgradeSaveArgs, duplicateAbilityBlockers } = require('../util/aspirant-conversion');
```

Right after `const upgrade = upgradeBuild({ ... });`, add:

```js
    const duplicates = duplicateAbilityBlockers({ character, abilities: upgrade.abilities ?? character.abilities });
    if (duplicates.length > 0) {
      const message = duplicates.map(blocker => blocker.detail).join(' ');
      report.failed.push({ id: character.id, error: message });
      log(`${character.id} ${character.name}: skipped. ${message}`);
      continue;
    }
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/aspirant-conversion.test.js services/character/service.test.js`
Expected: every test passes, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add util/aspirant-conversion.js util/aspirant-conversion.test.js scripts/upgrade-converted-aspirant-classes.js
git commit -m "feat: a duplicate Ability name blocks conversion and skips the upgrade script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `scripts/dedupe-character-abilities.js`, then clean the local copy

**Files:**
- Create: `scripts/dedupe-character-abilities.js`
- Create: `test/dedupe-character-abilities.integration.test.js`
- Modify: `scripts/run-tests.mjs` (add the test to `integrationFiles`, right before `'test/upgrade-converted-aspirant-classes.integration.test.js'`)
- Modify: `docs/superpowers/specs/2026-09-28-convert-to-aspirant-design.md:434-435` (the kept row)

**Interfaces:**
- Consumes: `scripts/migration-connection.mjs#migrationConnectionConfig(supabaseUrl, password, region)`.
- Produces: `dedupeCharacterAbilities({ client, apply = false, characterIds = null, log = console.log })` returns `Promise<{ characters: { id, name, names: { name, kept, deleted: string[] }[] }[], applied: string[], failed: { id, error }[] }>`. `client` is a connected `pg` client.

- [ ] **Step 1: Write the failing integration test**

Create `test/dedupe-character-abilities.integration.test.js`:

```js
// Covers scripts/dedupe-character-abilities.js against Postgres. The three
// tables are temporary copies that shadow the real ones for this connection
// only, so the fixture can hold duplicates whether or not
// class_abilities_character_name_key exists.
require('../util/require-local-supabase');

const { test, expect, beforeAll, afterAll } = require('bun:test');
const { Client } = require('pg');
const { dedupeCharacterAbilities } = require('../scripts/dedupe-character-abilities');

const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RAVEN = id(1);
const CLEAN = id(2);
const ILLUSIONIST = id(10);
const MESMER = id(11);
const [A1, A2, A3, A4, B1] = [id(101), id(102), id(103), id(104), id(201)];
const [P1, P2, P3, P4, P5] = [id(301), id(302), id(303), id(304), id(305)];

const run = (apply) => dedupeCharacterAbilities({ client: db, apply, log: () => {} });

beforeAll(async () => {
  await db.connect();
  await db.query(`
    create temp table characters (id uuid primary key, name text not null);
    create temp table class_abilities (
      id uuid primary key, character_id uuid not null, name text not null, class_id uuid not null
    );
    create temp table character_perks (
      id uuid primary key, character_id uuid not null, class_ability_id uuid not null,
      text text not null, compounds_with uuid, position integer not null default 0
    );
  `);
  await db.query('insert into characters values ($1, $2), ($3, $4)', [RAVEN, 'Raven', CLEAN, 'Clean']);
  await db.query(
    `insert into class_abilities values
      ($1, $6, 'Veneer', $8), ($2, $6, 'veneer ', $9), ($3, $6, 'VENEER', $8),
      ($4, $6, 'Phantasm', $8), ($5, $7, 'Veneer', $8)`,
    [A1, A2, A3, A4, B1, RAVEN, CLEAN, ILLUSIONIST, MESMER]
  );
  await db.query(
    `insert into character_perks (id, character_id, class_ability_id, text, compounds_with, position) values
      ($1, $6, $7, 'Kept perk.', null, 0),
      ($2, $6, $8, 'Moved first.', null, 0),
      ($3, $6, $8, 'Moved compound.', $2, 1),
      ($4, $6, $9, 'Moved last.', null, 0),
      ($5, $6, $10, 'Untouched.', null, 0)`,
    [P1, P2, P3, P4, P5, RAVEN, A1, A2, A3, A4]
  );
});

afterAll(() => db.end());

test('the dry run names each character, the kept row and the rows to delete, and writes nothing', async () => {
  const report = await run(false);
  expect(report.characters).toEqual([
    { id: RAVEN, name: 'Raven', names: [{ name: 'Veneer', kept: A1, deleted: [A2, A3] }] }
  ]);
  expect(report.applied).toEqual([]);
  const { rows: [{ n }] } = await db.query('select count(*)::int as n from class_abilities');
  expect(n).toBe(5);
});

test('--apply keeps the lowest id, moves every Perk after the kept row\'s own, and a second run finds nothing', async () => {
  expect(await run(true)).toMatchObject({ applied: [RAVEN], failed: [] });

  const { rows: abilities } = await db.query(
    'select id from class_abilities where character_id = $1 order by id', [RAVEN]
  );
  expect(abilities.map(row => row.id)).toEqual([A1, A4]);

  const { rows: perks } = await db.query(
    'select id, class_ability_id, position, compounds_with from character_perks order by id'
  );
  expect(perks).toEqual([
    { id: P1, class_ability_id: A1, position: 0, compounds_with: null },
    { id: P2, class_ability_id: A1, position: 1, compounds_with: null },
    { id: P3, class_ability_id: A1, position: 2, compounds_with: P2 },
    { id: P4, class_ability_id: A1, position: 3, compounds_with: null },
    { id: P5, class_ability_id: A4, position: 0, compounds_with: null }
  ]);

  expect((await run(false)).characters).toEqual([]);
});
```

Register it in `scripts/run-tests.mjs` `integrationFiles`: add `'test/dedupe-character-abilities.integration.test.js',` on the line before `'test/upgrade-converted-aspirant-classes.integration.test.js',`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test test/dedupe-character-abilities.integration.test.js`
Expected: FAIL with `Cannot find module '../scripts/dedupe-character-abilities'`.

- [ ] **Step 3: Write the script**

Create `scripts/dedupe-character-abilities.js`:

```js
// One-time cleanup before class_abilities_character_name_key: a character
// holding one Ability name (trimmed, case-folded) more than once keeps the
// row with the lowest id, which takes the other rows' Perks. Default is
// read-only. Pass --apply only after reviewing the list.
//
// Each character is cleaned in its own transaction, which needs a direct
// Postgres connection (SUPABASE_URL + SUPABASE_DB_PASS, as
// scripts/apply-migrations.mjs reads them). Table names are unqualified so the
// integration test can shadow them with temporary tables.
const { Client } = require('pg');

const DUPLICATE_ROWS = `
  select a.id, a.character_id, a.name, c.name as character_name, lower(btrim(a.name)) as name_key
  from class_abilities a
  join characters c on c.id = a.character_id
  where ($1::uuid[] is null or a.character_id = any($1::uuid[]))
    and (a.character_id, lower(btrim(a.name))) in (
      select character_id, lower(btrim(name)) from class_abilities
      group by character_id, lower(btrim(name)) having count(*) > 1
    )
  order by a.character_id, name_key, a.id`;

const planMerges = (rows) => {
  const characters = new Map();
  for (const row of rows) {
    if (!characters.has(row.character_id)) {
      characters.set(row.character_id, { id: row.character_id, name: row.character_name, groups: new Map() });
    }
    const { groups } = characters.get(row.character_id);
    if (!groups.has(row.name_key)) groups.set(row.name_key, []);
    groups.get(row.name_key).push(row);
  }
  return [...characters.values()].map(({ id, name, groups }) => ({
    id,
    name,
    names: [...groups.values()].map(([kept, ...extra]) => ({
      name: kept.name, kept: kept.id, deleted: extra.map(row => row.id)
    }))
  }));
};

// The kept row's Perks stay first; the deleted rows' Perks follow in the order
// of those rows, then their own position. A moved Perk keeps its id, so a
// Compound link inside the moved set still resolves.
const mergeRows = async (client, { kept, deleted }) => {
  const { rows: [{ last }] } = await client.query(
    'select coalesce(max(position), -1)::int as last from character_perks where class_ability_id = $1', [kept]
  );
  await client.query(`
    with moved as (
      select id, row_number() over (
        order by array_position($2::uuid[], class_ability_id), position, id
      )::int as n
      from character_perks where class_ability_id = any($2::uuid[])
    )
    update character_perks p set class_ability_id = $1, position = $3::int + moved.n
    from moved where p.id = moved.id`, [kept, deleted, last]);
  await client.query('delete from class_abilities where id = any($1::uuid[])', [deleted]);
};

const dedupeCharacterAbilities = async ({ client, apply = false, characterIds = null, log = console.log }) => {
  const { rows } = await client.query(DUPLICATE_ROWS, [characterIds]);
  const characters = planMerges(rows);
  const report = { characters, applied: [], failed: [] };
  for (const character of characters) {
    for (const group of character.names) {
      log(`${character.id} ${character.name}: ${group.name} keeps ${group.kept}, deletes ${group.deleted.join(', ')}`);
    }
    if (!apply) continue;
    try {
      await client.query('begin');
      for (const group of character.names) await mergeRows(client, group);
      await client.query('commit');
      report.applied.push(character.id);
    } catch (error) {
      await client.query('rollback');
      report.failed.push({ id: character.id, error: error.message });
      log(`  failed: ${error.message}`);
    }
  }
  log(`Characters holding an Ability name more than once: ${characters.length}.`
    + (apply ? ` ${report.applied.length} cleaned, ${report.failed.length} failed.` : ' Read-only: nothing written.'));
  return report;
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) {
    throw new Error('Usage: bun scripts/dedupe-character-abilities.js [--apply]');
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_DB_PASS) {
    throw new Error('Set SUPABASE_URL and SUPABASE_DB_PASS.');
  }
  const apply = args.includes('--apply');
  const { migrationConnectionConfig } = await import('./migration-connection.mjs');
  const config = migrationConnectionConfig(
    process.env.SUPABASE_URL, process.env.SUPABASE_DB_PASS, process.env.SUPABASE_DB_REGION || undefined
  );
  console.log(`Target: ${config.host}:${config.port} (${apply ? 'apply' : 'read-only'})`);
  const client = new Client(config);
  await client.connect();
  try {
    const report = await dedupeCharacterAbilities({ client, apply });
    if (report.failed.length > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { dedupeCharacterAbilities };
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test test/dedupe-character-abilities.integration.test.js`
Expected: 2 pass, 0 fail.

- [ ] **Step 5: Dry-run the CLI against the LOCAL stack only**

Run: `eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_PASS=postgres bun scripts/dedupe-character-abilities.js`

Expected:
```
Target: 127.0.0.1:54322 (read-only)
ff33451c-485f-4549-bf4c-bc521e075c80 Raven (Rachel Roth): Veneer keeps 315c981f-5386-4317-ab1c-9865ff5b4926, deletes 42710679-4a98-41ec-a1d6-770362afb07d
Characters holding an Ability name more than once: 1. Read-only: nothing written.
```
**If the host is anything but `127.0.0.1:54322`, stop at once.** If more characters are listed, the local copy has changed since the plan was written. List them in your report and continue.

- [ ] **Step 6: Apply to the LOCAL stack only, then confirm a second dry run is empty**

The local copy must be clean before Task 10's migration can apply. This is the one `--apply` this plan runs, and it runs against the local stack only.

Run: `eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_PASS=postgres bun scripts/dedupe-character-abilities.js --apply`
Expected: the first line is `Target: 127.0.0.1:54322 (apply)`, and the last line ends with `1 cleaned, 0 failed.`

Run: `eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_PASS=postgres bun scripts/dedupe-character-abilities.js`
Expected: the last line is `Characters holding an Ability name more than once: 0. Read-only: nothing written.`

- [ ] **Step 7: Correct the spec's kept row**

In `docs/superpowers/specs/2026-09-28-convert-to-aspirant-design.md`, replace `more than once it keeps the oldest row (lowest \`created_at\`, then \`id\`),` with `more than once it keeps the row with the lowest \`id\` (\`class_abilities\` has no \`created_at\`),`.

- [ ] **Step 8: Commit**

```bash
git add scripts/dedupe-character-abilities.js test/dedupe-character-abilities.integration.test.js scripts/run-tests.mjs docs/superpowers/specs/2026-09-28-convert-to-aspirant-design.md
git commit -m "feat: script to remove duplicate Ability names before the unique index

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Migration — unique Ability name index, and the RPC deletes before it inserts

**Files:**
- Create: `supabase/migrations/20260929000000_class_abilities_unique_name.sql`
- Create: `test/class-abilities-unique-name.integration.test.js`
- Modify: `scripts/run-tests.mjs` (add the test to `integrationFiles`, right before `'test/dedupe-character-abilities.integration.test.js'`)
- Modify: `docs/superpowers/specs/2026-09-28-convert-to-aspirant-design.md:427-429` (the Database bullet)

**Interfaces:**
- Consumes: `CharacterService#saveCharacterAtomic({ ..., characterName })` (Task 7); `characterRepository` (`services/character/repository.js`).
- Produces:
  - The unique index `class_abilities_character_name_key` on `public.class_abilities (character_id, lower(btrim(name)))`.
  - `save_character_atomic` with the same signature and behaviour, whose Ability delete is its own statement.

- [ ] **Step 1: Write the failing integration test**

Create `test/class-abilities-unique-name.integration.test.js`:

```js
// Local-Supabase coverage for class_abilities_character_name_key and the
// save_character_atomic restatement that deletes a replaced Ability before
// inserting its successor.
require('../util/require-local-supabase');

const { test, expect, beforeAll, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('../models/_base');
const { statList } = require('../util/enclave-consts');
const characterRepository = require('../services/character/repository');
const { CharacterService } = require('../services/character/service');
const { createAuthUserAndProfile } = require('./helpers/auth-user-fixture');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});
const NAME = `Raven ${suffix}`;
const EMPTY_MAPS = {
  gearNameToClassId: new Map(), gearNameToDescription: new Map(),
  abilityNameToClassId: new Map(), abilityNameToDescription: new Map(),
  itemsByClassId: new Map(), classesByName: new Map(), classRows: []
};

let authUserId;
let profile;
let characterId;
const classes = {};

const insertClass = async (name) => {
  const { data, error } = await supabaseAdmin.from('classes')
    .insert({ name, rules_version: 'v1', is_public: true, gear: [], abilities: [], advanced_abilities: [] })
    .select()
    .single();
  if (error) throw error;
  return data;
};

const save = (abilities) => supabaseAdmin.rpc('save_character_atomic', {
  p_character_id: characterId, p_creator_id: profile.id, p_character: {},
  p_traits: [], p_gear: null, p_abilities: abilities, p_perks: null
});

const storedAbilities = async () => (await db.query(
  'select name, class_id from class_abilities where character_id = $1 order by name', [characterId]
)).rows;

beforeAll(async () => {
  await db.connect();
  ({ authUserId, profile } = await createAuthUserAndProfile(db, {
    email: `unique-ability-${suffix}@example.test`, profileName: `Unique ${suffix}`
  }));
  classes.illusionist = await insertClass(`Illusionist ${suffix}`);
  classes.mesmer = await insertClass(`Mesmer ${suffix}`);
  const { data, error } = await supabaseAdmin.rpc('save_character_atomic', {
    p_character_id: null,
    p_creator_id: profile.id,
    p_character: {
      ...Object.fromEntries(statList.map(stat => [stat, 1])),
      creator_id: profile.id, name: NAME, class: classes.illusionist.name, class_id: classes.illusionist.id,
      level: 1, completed_missions: 0, commissary_reward: 0
    },
    p_traits: [],
    p_gear: [],
    p_abilities: [{ name: 'Veneer', class_id: classes.illusionist.id, type: 'core' }],
    p_perks: []
  });
  if (error) throw error;
  characterId = data.id;
});

afterAll(async () => {
  if (profile?.id) await db.query('delete from characters where creator_id = $1', [profile.id]);
  if (profile?.id) await db.query('delete from profiles where id = $1', [profile.id]);
  for (const cls of Object.values(classes)) await db.query('delete from classes where id = $1', [cls.id]);
  if (authUserId) await db.query('delete from auth.users where id = $1', [authUserId]);
  await db.end();
});

test('two Abilities whose names differ only by case and spacing cannot be saved', async () => {
  const { error } = await save([
    { name: 'Veneer', class_id: classes.illusionist.id, type: 'core' },
    { name: ' veneer', class_id: classes.mesmer.id, type: 'core' }
  ]);
  expect(error?.code).toBe('23505');
  expect(error.message).toContain('class_abilities_character_name_key');
  expect(await storedAbilities()).toEqual([{ name: 'Veneer', class_id: classes.illusionist.id }]);
});

// Conversion and the upgrade script move an Ability to another class under the
// same name; the delete must land before the insert or the index trips.
test('an Ability moved to another class under the same name saves', async () => {
  const { error } = await save([{ name: 'Veneer', class_id: classes.mesmer.id, type: 'core' }]);
  expect(error).toBeNull();
  expect(await storedAbilities()).toEqual([{ name: 'Veneer', class_id: classes.mesmer.id }]);
});

test('an Ability respelled only by case saves', async () => {
  const { error } = await save([{ name: 'VENEER', class_id: classes.mesmer.id, type: 'core' }]);
  expect(error).toBeNull();
  expect(await storedAbilities()).toEqual([{ name: 'VENEER', class_id: classes.mesmer.id }]);
});

test('the service reports the violation as the character already holding the name', async () => {
  const service = new CharacterService(characterRepository);
  const result = await service.saveCharacterAtomic({
    id: characterId,
    actor: { id: profile.id },
    characterInput: {},
    characterName: NAME,
    childData: {
      traits: [],
      classGear: null,
      classAbilities: [
        { name: 'Phantasm', class_id: classes.illusionist.id, type: 'core' },
        { name: 'phantasm', class_id: classes.mesmer.id, type: 'core' }
      ]
    },
    rulesVersion: 'v1',
    previousAbilities: [],
    maps: EMPTY_MAPS
  });
  expect(result).toEqual({ data: null, error: { status: 400, message: `${NAME} already has Phantasm.` } });
});
```

Register it in `scripts/run-tests.mjs` `integrationFiles`: add `'test/class-abilities-unique-name.integration.test.js',` on the line before `'test/dedupe-character-abilities.integration.test.js',`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test test/class-abilities-unique-name.integration.test.js`
Expected: 2 fail, 2 pass. The first test fails because `error` is null (no index), and the last fails because the save succeeds.

- [ ] **Step 3: Confirm the local copy has no duplicates**

Run: `eval "$(supabase status -o env)" && psql "$DB_URL" -Atc "select count(*) from (select 1 from class_abilities group by character_id, lower(btrim(name)) having count(*) > 1) d"`
Expected: `0`. If it is not 0, stop: rerun the Task 9 dry run to see who is listed. A leftover from Step 2's run is a test character whose `afterAll` did not run, and deleting that test profile's characters clears it.

- [ ] **Step 4: Write the migration**

The migration restates `save_character_atomic` from `20260921000001_save_character_atomic_aspiring_abilities.sql`, byte for byte except for the header and the Ability block, and then adds the index. First check the line anchors:

Run: `sed -n '17p;173p;207p;208p' supabase/migrations/20260921000001_save_character_atomic_aspiring_abilities.sql`
Expected, one per line:
```
CREATE OR REPLACE FUNCTION public.save_character_atomic(
  IF p_abilities IS NOT NULL THEN
  END IF;

```
(Line 208 is blank.) If any line differs, stop and report it.

Then build the file:

```bash
OLD=supabase/migrations/20260921000001_save_character_atomic_aspiring_abilities.sql
NEW=supabase/migrations/20260929000000_class_abilities_unique_name.sql
{
cat <<'SQL'
-- One Ability name per character, compared trimmed and case-folded -- the key
-- services/character/input.js checks before every save.
--
-- save_character_atomic is restated so its class_abilities delete is a
-- statement of its own, ahead of the insert. A data-modifying CTE that the
-- main statement does not read runs after it, and a unique index checks each
-- row as it is inserted, so an Ability re-inserted under a new class_id or a
-- new spelling would collide with the row it replaces. The rows the delete
-- leaves are the lowest-id occurrence of each (class_id, name), so the
-- insert's occurrence numbering is unchanged. Every other block is
-- byte-identical to 20260921000001_save_character_atomic_aspiring_abilities.sql.
--
-- The index cannot be built while a character holds a name twice: run
-- scripts/dedupe-character-abilities.js --apply first.
SQL
sed -n '16,172p' "$OLD"
cat <<'SQL'
  IF p_abilities IS NOT NULL THEN
    WITH desired AS (
      SELECT
        ability_item->>'name' AS name,
        (ability_item->>'class_id')::uuid AS class_id,
        row_number() OVER (PARTITION BY (ability_item->>'class_id')::uuid, ability_item->>'name' ORDER BY ord) AS occ
      FROM jsonb_array_elements(p_abilities) WITH ORDINALITY AS t(ability_item, ord)
    ),
    existing AS (
      SELECT id, name, class_id, row_number() OVER (PARTITION BY class_id, name ORDER BY id) AS occ
      FROM public.class_abilities WHERE character_id = saved.id
    )
    DELETE FROM public.class_abilities a
    WHERE a.character_id = saved.id
      AND NOT EXISTS (
        SELECT 1 FROM existing e JOIN desired d USING (class_id, name, occ) WHERE e.id = a.id
      );

    WITH desired AS (
      SELECT
        ability_item->>'name' AS name,
        (ability_item->>'class_id')::uuid AS class_id,
        ability_item->>'description' AS description,
        ability_item->>'type' AS type,
        row_number() OVER (PARTITION BY (ability_item->>'class_id')::uuid, ability_item->>'name' ORDER BY ord) AS occ
      FROM jsonb_array_elements(p_abilities) WITH ORDINALITY AS t(ability_item, ord)
    ),
    existing AS (
      SELECT id, name, class_id, row_number() OVER (PARTITION BY class_id, name ORDER BY id) AS occ
      FROM public.class_abilities WHERE character_id = saved.id
    ),
    matched AS (
      SELECT e.id, d.description, d.type FROM existing e JOIN desired d USING (class_id, name, occ)
    ),
    updated AS (
      UPDATE public.class_abilities a SET description = m.description, type = COALESCE(m.type, a.type)
      FROM matched m
      WHERE a.id = m.id
        AND (a.description IS DISTINCT FROM m.description
          OR (m.type IS NOT NULL AND a.type IS DISTINCT FROM m.type))
    )
    INSERT INTO public.class_abilities (character_id, name, class_id, description, type)
    SELECT saved.id, d.name, d.class_id, d.description, COALESCE(d.type, 'core') FROM desired d
    WHERE NOT EXISTS (
      SELECT 1 FROM existing e WHERE e.class_id = d.class_id AND e.name = d.name AND e.occ = d.occ
    );
  END IF;
SQL
sed -n '208,278p' "$OLD"
cat <<'SQL'

CREATE UNIQUE INDEX class_abilities_character_name_key
  ON public.class_abilities (character_id, lower(btrim(name)));
SQL
} > "$NEW"
```

Run: `diff supabase/migrations/20260921000001_save_character_atomic_aspiring_abilities.sql supabase/migrations/20260929000000_class_abilities_unique_name.sql | grep '^[0-9]'`
Expected (checked when this plan was written):
```
1,5c1,2
7,12c4,11
14,15c13,14
177a177,193
190,194d205
278a290,292
```
The first three hunks are the header (old lines 1-15), the next two fall inside the Ability block (old lines 173-207), and the last is the index. If any hunk touches other old lines, the function body was altered: stop and rebuild the file.

- [ ] **Step 5: Apply the migration to the LOCAL stack only**

Run: `supabase migration up --local`
Expected: `Applying migration 20260929000000_class_abilities_unique_name.sql...` and then `Local database is up to date.` **Never `supabase db reset`, never `supabase db push`.**

Run: `eval "$(supabase status -o env)" && psql "$DB_URL" -Atc "select indexdef from pg_indexes where indexname = 'class_abilities_character_name_key'"`
Expected: `CREATE UNIQUE INDEX class_abilities_character_name_key ON public.class_abilities USING btree (character_id, lower(btrim(name)))`

- [ ] **Step 6: Run the tests and confirm they pass, including the saves that move Abilities**

Run: `eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test test/class-abilities-unique-name.integration.test.js models/character-convert-aspirant.integration.test.js test/upgrade-converted-aspirant-classes.integration.test.js models/character-atomic.integration.test.js`
Expected: every test passes, 0 fail. The conversion and upgrade-script tests move Abilities to their Aspirant version under the same name, so they fail if the delete runs after the insert.

- [ ] **Step 7: Correct the spec's Database bullet**

In `docs/superpowers/specs/2026-09-28-convert-to-aspirant-design.md`, replace:

```
- **Database**: a migration adds a unique index on
  `class_abilities (character_id, lower(btrim(name)))`. The RPC's delete runs
  before its insert, so a moved row does not trip it.
```

with:

```
- **Database**: a migration adds a unique index on
  `class_abilities (character_id, lower(btrim(name)))` and restates
  `save_character_atomic` so its Ability delete is a statement of its own,
  ahead of the insert: a data-modifying CTE the main statement does not read
  runs after it, so a moved row would otherwise trip the index.
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260929000000_class_abilities_unique_name.sql test/class-abilities-unique-name.integration.test.js scripts/run-tests.mjs docs/superpowers/specs/2026-09-28-convert-to-aspirant-design.md
git commit -m "feat: unique Ability name per character, with the RPC deleting before it inserts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Whole-branch verification

**Files:** none (verification only).

- [ ] **Step 1: Baseline (run this once BEFORE Task 1, and record the result)**

Run: `git stash list` (it should be empty), then `bun run test:unit` and `bun run test:http`. Then run the integration tier using the command in Global Constraints. Write down every failing file and test name.

- [ ] **Step 2: Run every tier after Task 10**

Run: `bun run test:unit`
Expected: 0 failures.

Run: `bun run test:http`
Expected: only `routes/open-graph.test.js` fails.

Run: `eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun run test:integration`
Expected: only `util/character-content-integrity`, `util/class-form-round-trip` and `util/image-crop-integrity` fail, each with the same tests as in the baseline.

- [ ] **Step 3: Check that the replaced code is gone**

Run: `grep -rn "isOwnVersion\|ownCoreSpend\|abilityOptions" util routes public test`
Expected: no output.

Run: `grep -n "const aspirantTargetOf\|const nameKey" util/aspirant-conversion.js`
Expected: no output.

## Rollout (for the user, not an executor)

1. **Merge.** Railway deploys the code, but neither the index nor the restated RPC is applied yet. Until step 2, a character that already holds a name twice (Raven (Rachel Roth)) cannot save its edit form until one copy is removed. That is the new validation.
2. **Clean the duplicates.** With `.env` on production (`SUPABASE_URL` and `SUPABASE_DB_PASS`, plus `SUPABASE_DB_REGION` if not `aws-0-us-east-1`):
   - Run `bun scripts/dedupe-character-abilities.js`. The first line must name the production pooler host. Review the list.
   - Run it again with `--apply`.
   - A third run must report `0`.
3. **Apply the migration.** Run `supabase migration list --linked` and confirm that `20260929000000` is the only pending migration. Then run `supabase db push --linked`. This adds the index and replaces `save_character_atomic`.
4. **Upgrade converted characters.** Run `bun scripts/upgrade-converted-aspirant-classes.js`, review the list, then run it with `--apply`.
5. **Reconcile stored totals.** After that `--apply`, run `bun scripts/reconcile-character-progress.js`: dry run, review, then `--apply`.
6. **Run the scripts at a quiet time.** They read a character and then write it, so an edit saved in between is overwritten.

## Self-review

- **Spec coverage (Part 3):**
  - Lineage and source order: Task 1.
  - Items only an Advent version carries stay available: Task 1 (Duster and Lasso), Task 2 (Cloak), Task 5 (Duster).
  - Owned rows are always listed, whatever their class: unchanged `carried` in `buildEntries` and `addUncatalogued`.
  - Edit-page islands: Task 2.
  - Classic pickers: Task 3.
  - Wizard class data, shops and the preselected forked Advent class: Tasks 4-5.
  - Wizard pricing via `ownClassIds`: Task 4 (served), Task 5 (Signatures, Abilities and which classes the shop leaves out).
  - Server validation: Task 7. It covers create and edit. Import goes through `createCharacter`. Level-up adds no Abilities.
  - Ability shops refuse a held name: Task 5 (wizard), Task 6 (edit island).
  - Conversion blocker and script skip: Task 8.
  - Database index: Task 10.
  - Cleaning existing duplicates: Task 9.
  - Rollout: the section above.
- **Type consistency:**
  - `lineageCatalogue(classes, { ownClassId })` is used in Tasks 1, 3 and 4.
  - `purchaseCatalogue({ economy, classes, characterClass })` is used in Tasks 1 and 2.
  - `lineage_id` and `own_class_ids` are served in Task 4 and read in Task 5.
  - `duplicateNames(names)` is used in Tasks 1, 7 and 8.
  - `duplicateAbilityMessage(characterName, abilityName)` is used in Task 7.
  - `saveCharacterAtomic({ ..., characterName })` is used in Tasks 7 and 10.
  - `dedupeCharacterAbilities({ client, apply, characterIds, log })` is used in Task 9.
- **Review Focus:** each of the five lines has its test in the task it names.
