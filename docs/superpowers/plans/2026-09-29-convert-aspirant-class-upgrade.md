# Convert to Aspirant: Class Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an Advent character converts to Aspirant, it moves onto its class's Aspirant version (if one exists), and every owned Signature and Ability with a same-named Aspirant version moves too. An Aspirant version's own class includes the Advent class it came from. A one-time script fixes characters that were converted before this change.

**Architecture:** `util/class-family.js` gains three pure functions:
- `findAspirantFork(classes, classId)`: the Aspirant version of a class.
- `ownClassIds(classes, classId)`: the fork family plus the Advent family it came from.
- `familyResolver(classes, classId)`: moved here from the service.

Every "own class" site reads these: pricing, the class-item resolver, and the edit and sheet routes. `util/aspirant-conversion.js` gains `upgradeBuild` and `upgradeSaveArgs`, which produce save-ready rows. `planConversion` judges the upgraded build. `CharacterService.convertToAspirant` saves the class, the rows and the mode in one `save_character_atomic` call. `scripts/upgrade-converted-aspirant-classes.js` reuses `upgradeBuild` and `upgradeSaveArgs`.

**Tech Stack:** Bun, `bun:test`, Express 4, express-handlebars, htmx, Supabase/Postgres (`save_character_atomic` RPC, `pg` in integration tests).

**Spec:** `docs/superpowers/specs/2026-09-28-convert-to-aspirant-design.md`, **Part 2 only**. Part 1 has already shipped. Read the spec's Part 2 before starting any task.

## Global Constraints

- **Branch:** `feat/convert-aspirant-class-upgrade`. Do not switch branches, push, or edit `.env`.
- **`.env` currently points at PRODUCTION** (checked 2026-09-29), and bun loads `.env` automatically.
  - **Never run plain `bun test <file>`.**
  - Never run the new script without the explicit local env shown in Task 7.
  - Before any step that writes to a database, get credentials from `supabase status -o env`, never from `.env`.
- **Unit tier:** `bun run test:unit` is always safe, because it scrubs the Supabase variables. For a single unit or HTTP file, run:
  ```bash
  env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test <file>
  ```
- **HTTP tier:** `bun run test:http`. `routes/characters.test.js` and `routes/character-level-up.test.js` are HTTP files. The single-file form above works for them too.
- **Integration tier:** use the local stack only, in a single shell invocation:
  ```bash
  eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test <file>
  eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun run test:integration
  ```
- **NEVER run `supabase db reset`.** The local database holds a restored production copy.
- **No migration.** `save_character_atomic` (latest: `supabase/migrations/20260921000001_save_character_atomic_aspiring_abilities.sql`) already supports everything this plan needs:
  - It writes `class_id` and `class` from `p_character`.
  - It pairs gear and ability rows by `(class_id, name, occurrence)`. A moved row is therefore deleted and re-inserted, and deleting an ability cascades its Perks.
  - It re-attaches a Perk by `ability_name` when `class_ability_id` is null.
  - It treats a null `p_gear`, `p_abilities` or `p_perks` as "leave these rows alone".
  - If you find you need a migration, stop and tell the user. Applying it to production is the user's job.
- **Known reds.** Compare by file and test name, never by count:
  - `test:unit`: 0 failures.
  - `test:http`: exactly `routes/open-graph.test.js`.
  - `test:integration`: exactly `util/character-content-integrity` (1), `util/class-form-round-trip` (2 of 3) and `util/image-crop-integrity` (2).
  - Anything else that fails is yours to fix. Record the baseline once before Task 1 (see Task 8, Step 1).
- **No dead code.** When you replace something, delete what it replaced in the same task: no commented-out blocks, no fallbacks, no `_old` copies. Before committing, run `grep -rn "<removed symbol>" models routes services util scripts test views` to confirm nothing still references a removed symbol.
- **Comments:** only where the code cannot carry the meaning. Describe the code as it is now. Never write history ("was", "no longer", "now", "used to").
- **Discovery:** use `semble search "<query>" .` (or `uvx --from "semble[mcp]" semble search "<query>" .`) rather than grep. Use grep only for exhaustive literal checks.
- **Match the surrounding idiom:**
  - Services return `{ data, error }`.
  - Business errors are `{ status, message }`.
  - Adapter stubs use `ok(...)` in `services/character/service.test.js`.
  - Indentation is 2 spaces, except 4 in `util/merx-economy.js` and `util/perk-economy.js`.
- **TDD per task:** write the failing test, run it and see the stated failure, write the minimum code, run it green, then commit.
- **Commits:**
  - One commit per task.
  - Stage only the files the task names (`git add <paths>`, never `-A` or `.`).
  - Use lower-case imperative with a `feat:`, `fix:`, `test:` or `docs:` prefix.
  - End every message with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or your harness's trailer).
- **Copy (from the spec, verbatim):**
  - Not eligible: `<name> is not on the Advent rules, so there is nothing to convert.`
  - Blocked: `<name> cannot convert to Aspirant yet. <every blocker detail>`
  - Panel with a fork: `<name> can switch to the Aspirant rules and move to <strong><fork name></strong>.`, followed by `Moves to its Aspirant version:` and `Stays as it is:`.
  - Panel without a fork: `<name> can switch to the Aspirant rules. It keeps its class and its whole build.`

## Review Focus

These are the five inputs the spec implies but never spells out, most likely first. Each one has a test in the task named.

1. **Two identical Signatures where only one carries an Enchantment and Mods.** Both move to the fork, and each keeps its own Enchantment and Mods. Neither is merged into the other or stripped. Tested in Task 3 (`upgradeBuild` save rows) and Task 6 (integration: the stored rows).
2. **A row whose name differs from the fork's catalogue only by case or surrounding whitespace.** The row moves and takes the fork's trimmed spelling. Tested in Task 3.
3. **A legacy Ability row with `class_id` null that carries a Perk, when something else in the build moves.** The RPC cannot pair a null-class row with its stored self, so it re-inserts the row. The Perk must be re-keyed by `ability_name` so it survives instead of pointing at a deleted id. Tested in Task 3.
4. **A fork character submits a bare item name that both its fork and its Advent origin carry, and another class carries it too.** The name resolves to the fork first, then to the Advent origin, and never to the unrelated class. Tested in Task 2 (`resolveSubmittedGear`).
5. **An Advent family with two Aspirant forks (bad catalogue data).** Treated as having no fork. A warning is logged, the character converts mode-only and nothing errors. Tested in Task 1 (`findAspirantFork`), Task 3 (`upgradeBuild`) and Task 4 (service save payload).

## Decisions the spec left open

- **`getConversionClasses` reads every class** with `id, name, base_class_id, rules_edition, content_format, gear, abilities, advanced_abilities`. The fork search must walk the whole family graph anyway, and there are 63 classes today. This is one query, the same one the earlier implementation (`aea3614`) used. The spec's wording ("the character's class and every class its rows name, their families and forks") names what is *used*, not a narrower read.
- **The lists are null whenever no row moves**, even if the class moves. That way row ids survive a class-only move. The spec's "when nothing moves" example is the special case where there is no fork at all.
- **Perks for a re-inserted Ability** are sent as `{ class_ability_id: null, ability_name, text, position, compounds_with }`. A re-inserted Ability is either one that moved or a kept row with `class_id` null. Perks for every other Ability keep `{ class_ability_id, text, position, compounds_with }`. All Perks are sent whenever the lists are sent, because a non-null `p_perks` deletes any Perk it does not name.
- **`moved` and `kept` entries** are `{ kind: 'Signature' | 'Ability', name, className }`:
  - For a moved item, `name` is the fork's spelling and `className` is the fork's name.
  - For a kept item, `className` is the name of its current class, or null if that class is not in the catalogue.
- **The script takes an optional `characterIds` filter** (used by its integration test) and exports `upgradeConvertedCharacters`. Without the filter, the CLI scans every character.

---

### Task 1: `findAspirantFork`, `ownClassIds` and `familyResolver` in `util/class-family.js`

**Files:**
- Modify: `util/class-family.js` (add three functions and extend exports)
- Modify: `services/character/service.js:16` (import) and `:200-215` (delete the local `familyResolver` and its comment)
- Test: `util/class-family.test.js`

**Interfaces:**
- Consumes: `buildFamilyIndex` and `familyFromIndex`, both internal to `util/class-family.js`.
- Produces:
  - `findAspirantFork(classes: ClassRow[], classId: string|null) => ClassRow|null`
  - `ownClassIds(classes: ClassRow[], classId: string) => Set<string>`
  - `familyResolver(classes: ClassRow[], classId: string|null) => ((id: string) => string) | null`
  - `ClassRow` is at least `{ id, base_class_id, rules_edition, content_format }`.

- [ ] **Step 1: Write the failing tests**

Change the import line at the top of `util/class-family.test.js` and add the pricing imports:

```js
const { test, expect, describe, spyOn } = require('bun:test');
const {
  computeVersionFamily, expandIdsToFamilies, findAspirantFork, ownClassIds, familyResolver
} = require('./class-family');
const { tagAbilities } = require('./character-derived');
const { isCrossClass, equipmentSpend, priceOfSignature } = require('./merx-economy');
```

Append to the end of the file:

```js
// Gunslinger: Advent v1 and v2 are one family; its Aspirant version forks from
// v1 and has a v2 of its own. Wanderer has no Aspirant version.
const GUNSLINGER = [
  cls('gs-v1'),
  cls('gs-v2', 'gs-v1'),
  cls('gs-asp', 'gs-v1', 'aspirant', 'aspirant'),
  cls('gs-asp-v2', 'gs-asp', 'aspirant', 'aspirant'),
  cls('wd-v1')
];

describe('findAspirantFork', () => {
  test('every version of an Advent class reaches the same Aspirant version', () => {
    expect(findAspirantFork(GUNSLINGER, 'gs-v1').id).toBe('gs-asp');
    expect(findAspirantFork(GUNSLINGER, 'gs-v2').id).toBe('gs-asp');
  });

  test('a class with no Aspirant version has none', () => {
    expect(findAspirantFork(GUNSLINGER, 'wd-v1')).toBeNull();
  });

  test('an Aspirant class, an unknown class and no class have none', () => {
    expect(findAspirantFork(GUNSLINGER, 'gs-asp')).toBeNull();
    expect(findAspirantFork(GUNSLINGER, 'nope')).toBeNull();
    expect(findAspirantFork(GUNSLINGER, null)).toBeNull();
  });

  // The schema does not enforce one fork per family, and conversion does not guess.
  test('two Aspirant versions of one family count as none, with a warning naming both', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const classes = [...GUNSLINGER, cls('gs-asp-b', 'gs-v2', 'aspirant', 'aspirant')];
    expect(findAspirantFork(classes, 'gs-v1')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('gs-asp');
    expect(warn.mock.calls[0][0]).toContain('gs-asp-b');
    warn.mockRestore();
  });
});

describe('ownClassIds', () => {
  test('an Aspirant version\'s own class includes the Advent family it came from', () => {
    const all = new Set(['gs-asp', 'gs-asp-v2', 'gs-v1', 'gs-v2']);
    expect(ownClassIds(GUNSLINGER, 'gs-asp')).toEqual(all);
    expect(ownClassIds(GUNSLINGER, 'gs-asp-v2')).toEqual(all);
  });

  test('an Advent class\'s own class never includes its Aspirant version', () => {
    expect(ownClassIds(GUNSLINGER, 'gs-v2')).toEqual(new Set(['gs-v1', 'gs-v2']));
  });

  test('a class with no links, and an unknown class, are their own class alone', () => {
    expect(ownClassIds(GUNSLINGER, 'wd-v1')).toEqual(new Set(['wd-v1']));
    expect(ownClassIds(GUNSLINGER, 'nope')).toEqual(new Set(['nope']));
  });

  test('an Aspirant class forked from another Aspirant class takes in nothing across formats', () => {
    const classes = [cls('asp-a', null, 'aspirant', 'aspirant'), cls('pre-b', 'asp-a', 'prerelease', 'aspirant')];
    expect(ownClassIds(classes, 'pre-b')).toEqual(new Set(['pre-b']));
  });
});

describe('familyResolver', () => {
  test('is null without a class', () => {
    expect(familyResolver(GUNSLINGER, null)).toBeNull();
  });

  test('maps every own-class id onto the character\'s class and leaves others alone', () => {
    const of = familyResolver(GUNSLINGER, 'gs-asp');
    expect(of('gs-v1')).toBe('gs-asp');
    expect(of('gs-asp-v2')).toBe('gs-asp');
    expect(of('wd-v1')).toBe('wd-v1');
  });

  test('on a fork character, Advent-origin Abilities and Signatures price own-class', () => {
    const pricing = { economy: 'aspirant', characterClassId: 'gs-asp', classFamilyOf: familyResolver(GUNSLINGER, 'gs-asp') };
    expect(tagAbilities([
      { name: 'Trickshot', class_id: 'gs-v1', type: 'core' },
      { name: 'Familiar Face', class_id: 'wd-v1', type: 'core' }
    ], pricing).map(tag => tag.crossClass)).toEqual([false, true]);
    expect(isCrossClass({ name: 'Revolver', class_id: 'gs-v2' }, pricing)).toBe(false);
    expect(equipmentSpend([
      { name: 'Revolver', class_id: 'gs-v1' },
      { name: 'Satchel', class_id: 'wd-v1' }
    ], pricing)).toBe(priceOfSignature({ crossClass: false }) + priceOfSignature({ crossClass: true }));
  });

  test('on an Advent character, its Aspirant version\'s items stay cross-class', () => {
    const pricing = { economy: 'advent', characterClassId: 'gs-v2', classFamilyOf: familyResolver(GUNSLINGER, 'gs-v2') };
    expect(isCrossClass({ name: 'Revolver', class_id: 'gs-asp' }, pricing)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/class-family.test.js`
Expected: FAIL with `TypeError: findAspirantFork is not a function` (and the same for `ownClassIds` and `familyResolver`). The existing `computeVersionFamily` tests still pass.

- [ ] **Step 3: Implement the functions in `util/class-family.js`**

Insert this directly above `module.exports`:

```js
const ASPIRANT = 'aspirant';

// The Aspirant version of a class: the aspirant-format class outside its
// version family whose base_class_id is inside it, so every version of an
// Advent class reaches the same one. The schema allows two, and conversion
// does not guess between them.
const findAspirantFork = (classes, classId) => {
  const index = buildFamilyIndex(classes);
  const origin = index.byId.get(classId);
  if (!origin || origin.content_format === ASPIRANT) return null;
  const family = familyFromIndex(index, classId);
  const forks = [...index.byId.values()].filter(row => row.content_format === ASPIRANT
    && !family.has(row.id) && family.has(row.base_class_id));
  if (forks.length > 1) {
    console.warn(`[findAspirantFork] class ${classId} has ${forks.length} Aspirant versions: `
      + forks.map(row => row.id).join(', '));
  }
  return forks.length === 1 ? forks[0] : null;
};

// A character's own class for Cross-Classing. An Aspirant version also owns
// the Advent family it was forked from; an Advent class never owns its fork.
const ownClassIds = (classes, classId) => {
  const index = buildFamilyIndex(classes);
  const own = familyFromIndex(index, classId);
  const node = index.byId.get(classId);
  if (!node || node.content_format !== ASPIRANT) return own;
  for (const memberId of [...own]) {
    const base = index.byId.get(index.byId.get(memberId)?.base_class_id);
    if (base && base.content_format !== ASPIRANT && !own.has(base.id)) {
      for (const originId of familyFromIndex(index, base.id)) own.add(originId);
    }
  }
  return own;
};

// The classFamilyOf that Merx and Perk pricing read: every own-class id maps
// onto classId.
const familyResolver = (classes, classId) => {
  if (!classId) return null;
  const own = ownClassIds(classes, classId);
  return (candidateId) => (own.has(candidateId) ? classId : candidateId);
};
```

Replace the export line:

```js
module.exports = {
  computeVersionFamily, expandIdsToFamilies, findAspirantFork, ownClassIds, familyResolver
};
```

- [ ] **Step 4: Move the service onto the shared `familyResolver`**

In `services/character/service.js`:
- Line 16 becomes `const { computeVersionFamily, familyResolver } = require('../../util/class-family');`.
- Delete the local `familyResolver` together with its whole preceding comment block (the one that begins "Maps every id in `classId`'s own version family onto `classId`"). It sits at about lines 200-215.
- The comment above `let classFamilyOf = null;` in `updateCharacter` (about line 516) says `// See familyResolver.` Change it to `// See util/class-family.js#familyResolver.`

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/class-family.test.js services/character/service.test.js`
Expected: PASS, both files.

- [ ] **Step 6: Commit**

```bash
git add util/class-family.js util/class-family.test.js services/character/service.js
git commit -m "feat: an Aspirant version's own class includes the Advent class it came from

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Route every own-class site through `ownClassIds`

**Files:**
- Modify: `services/character/service.js` (`classItemResolver`'s `familyClassIds`, about line 225; the import on line 16)
- Modify: `routes/characters.js:40` (import), `:566-584` (edit GET mapper), `:1203-1218` (sheet mapper)
- Test: `services/character/service.test.js`, `routes/characters.test.js`

**Interfaces:**
- Consumes: `ownClassIds` and `familyResolver` from Task 1.
- Produces: no new names. `resolveSubmittedGear` (already exported) and the edit page's purchase islands now treat the Advent origin as own class.

- [ ] **Step 1: Write the failing service test**

In `services/character/service.test.js`, change line 2 to:

```js
const { CharacterService, resolveSubmittedGear } = require('./service');
```

Append to the file:

```js
// --- Own class across an Aspirant version ---------------------------------

const forkResolutionMaps = () => ({
  gearNameToClassId: new Map([['Duster', 'tailor-v1'], ['Revolver', 'tailor-v1']]),
  gearNameToDescription: new Map(),
  abilityNameToClassId: new Map(),
  abilityNameToDescription: new Map(),
  itemsByClassId: new Map([
    ['gs-advent', { gear: new Map([['Duster', null], ['Revolver', null]]), abilities: new Map() }],
    ['gs-fork', { gear: new Map([['Revolver', 'Aspirant six-shooter.']]), abilities: new Map() }],
    ['tailor-v1', { gear: new Map([['Duster', null], ['Revolver', null]]), abilities: new Map() }]
  ]),
  classesByName: new Map(),
  classRows: [
    { id: 'gs-advent', base_class_id: null, rules_edition: 'advent', content_format: 'advent' },
    { id: 'gs-fork', base_class_id: 'gs-advent', rules_edition: 'aspirant', content_format: 'aspirant' },
    { id: 'tailor-v1', base_class_id: null, rules_edition: 'advent', content_format: 'advent' }
  ]
});

test('a fork character\'s bare item names resolve to the fork first, then its Advent origin, never another class', () => {
  expect(resolveSubmittedGear(['Revolver', 'Duster'], { maps: forkResolutionMaps(), ownClassId: 'gs-fork' })).toEqual([
    { name: 'Revolver', class_id: 'gs-fork' },
    { name: 'Duster', class_id: 'gs-advent' }
  ]);
});
```

- [ ] **Step 2: Write the failing route test**

In `routes/characters.test.js`, directly above `const CLASS_BY_ID = {` (about line 269), add:

```js
// An Advent class and its Aspirant version. A character on the fork owns
// items from the Advent class as its own class.
const GS_ADVENT = {
  id: 'class-gs-advent',
  name: 'Gunslinger',
  is_public: true,
  is_player_created: false,
  rules_edition: 'advent',
  rules_version: 'v2',
  content_format: 'advent',
  gear: [{ name: 'Duster', description: '' }],
  abilities: [{ name: 'Quickdraw', description: '' }],
  advanced_abilities: [],
  created_at: '2023-01-01T00:00:00Z',
};
const GS_FORK = {
  ...GS_ADVENT,
  id: 'class-gs-fork',
  base_class_id: GS_ADVENT.id,
  rules_edition: 'aspirant',
  content_format: 'aspirant',
  gear: [{ name: 'Revolver', description: '' }],
  abilities: [{ name: 'Trickshot', description: '' }],
  created_at: '2024-01-01T00:00:00Z',
};
```

Add `[GS_FORK.id]: GS_FORK` to `CLASS_BY_ID`. Then append this test right after the test `'the ability island prices a newer-version own-class ability at the own rate'`:

```js
test('the edit page prices a fork character\'s Advent-origin items at the own rate', async () => {
  pageState.character = {
    id: CHAR_ID,
    name: 'Cora',
    class: 'Gunslinger',
    class_id: GS_FORK.id,
    creator_id: 'profile-1',
    creator_mode: 'aspirant',
    is_public: true,
    level: 3,
    completed_missions: 0,
    ...Object.fromEntries(statList.map(stat => [stat, 2])),
    traits: [],
    abilities: [{ id: 'ab-q', name: 'Quickdraw', class_id: GS_ADVENT.id, type: 'core' }],
    gear: [{ name: 'Duster', class_id: GS_ADVENT.id, enchantment: null, mods: [] }],
    ability_perks: [],
    quirks: [],
    accessories: [],
    common_items: [],
    perks: '',
    additional_gear: '',
  };
  pageState.unlockedClassIds = new Set([GS_ADVENT.id, GS_FORK.id]);
  pageState.extraAdventClasses = [GS_ADVENT];
  pageState.extraAspirantClasses = [GS_FORK];
  pageState.classFamilyRows = [
    { id: GS_ADVENT.id, base_class_id: null, rules_edition: 'advent', content_format: 'advent' },
    { id: GS_FORK.id, base_class_id: GS_ADVENT.id, rules_edition: 'aspirant', content_format: 'aspirant' },
  ];

  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  const island = (id) => JSON.parse(body.match(new RegExp(`id="${id}">([^<]*)</script>`))[1]);
  const quickdraw = island('ability-purchase-data').entries
    .find((e) => e.name === 'Quickdraw' && e.class_id === GS_ADVENT.id);
  expect(quickdraw.crossClass).toBe(false);
  expect(island('gear-purchase-data').ownClassIds.sort()).toEqual([GS_ADVENT.id, GS_FORK.id].sort());
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/character/service.test.js routes/characters.test.js`

Expected: 2 failures.
- The service test fails with Duster's `class_id` `'tailor-v1'`, not `'gs-advent'`.
- The route test fails with `crossClass` `true`, not `false`.

- [ ] **Step 4: Implement**

In `services/character/service.js`:
- Line 16 becomes `const { ownClassIds, familyResolver } = require('../../util/class-family');`.
- In `classItemResolver`, replace:
  ```js
  const familyClassIds = ownClassId
    ? computeVersionFamily(maps.classRows ?? [], ownClassId)
    : new Set();
  ```
  with:
  ```js
  const familyClassIds = ownClassId
    ? ownClassIds(maps.classRows ?? [], ownClassId)
    : new Set();
  ```
- The resolver's header comment says "then the character's own class and the rest of its version family". Change that to "then the character's own class and the rest of its own class (util/class-family.js#ownClassIds)".

In `routes/characters.js`:
- Line 40 becomes `const { familyResolver } = require('../util/class-family');`.
- In the edit GET, replace the whole block from the comment `// Maps every id in the character's own version family onto` down to the closing `}` of `if (character.class_id) { try { ... } catch ... }` with:
  ```js
  // One own-class map for `derived` and both purchase islands, so they
  // never disagree about what is cross-class.
  const classFamilyOf = character.class_id
    ? familyResolver((await characterRepository.getClassFamilyRows()).data, character.class_id)
    : null;
  ```
- In the sheet route, replace the block from `// Maps every id in the character's own version family onto` through the closing `}` of its `if (character.class_id) { try ... }` with:
  ```js
  const classFamilyOf = character.class_id
    ? familyResolver((await characterRepository.getClassFamilyRows()).data, character.class_id)
    : null;
  ```
  `getClassFamilyRows` never throws: it resolves `{ data: [], error }` on failure. That is why the `try` goes.

- [ ] **Step 5: Check that nothing references the removed code**

Run: `grep -n "computeVersionFamily" services/character/service.js routes/characters.js`
Expected: no output.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/character/service.test.js routes/characters.test.js routes/character-details.test.js routes/characters-edition-access.test.js`
Expected: PASS, all four files.

- [ ] **Step 7: Commit**

```bash
git add services/character/service.js services/character/service.test.js routes/characters.js routes/characters.test.js
git commit -m "feat: price and resolve a fork character's Advent-origin items as own class

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `upgradeBuild` and `upgradeSaveArgs` in `util/aspirant-conversion.js`

**Files:**
- Modify: `util/aspirant-conversion.js` (header comment, new functions, exports)
- Test: `util/aspirant-conversion.test.js`

**Interfaces:**
- Consumes: `findAspirantFork` from Task 1.
- Produces:
  - `upgradeBuild({ character, classes, gear, abilities, abilityPerks })` returns `{ target: ClassRow|null, gear: GearSave[]|null, abilities: AbilitySave[]|null, abilityPerks: PerkSave[]|null, moved: Item[], kept: Item[] }`, where:
    - `GearSave = { name, class_id, description, enchantment, mods }`
    - `AbilitySave = { name, class_id, description, type }`
    - `PerkSave = { class_ability_id, ability_name?, text, position, compounds_with }`
    - `Item = { kind: 'Signature'|'Ability', name, className }`
  - `upgradeSaveArgs({ character, upgrade })` returns `{ characterId, creatorId, character: {} | { class_id, class }, traits: {name, stat}[], gear, abilities, perks }`, which is ready for `adapter.saveCharacterAtomic`.

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `util/aspirant-conversion.test.js`:

```js
const { spyOn } = require('bun:test');
const { upgradeBuild, upgradeSaveArgs } = require('./aspirant-conversion');
```

(Merge `spyOn` into the existing `bun:test` destructure, and `upgradeBuild, upgradeSaveArgs` into the existing `./aspirant-conversion` destructure. Do not add a second `require` of either module.)

Append:

```js
// --- upgradeBuild -----------------------------------------------------------

const entry = (name, description = null) => ({ name, description });
const klass = (id, name, format, base, lists = {}) => ({
  id, name, base_class_id: base, rules_edition: format, content_format: format,
  gear: lists.gear || [], abilities: lists.abilities || [], advanced_abilities: lists.advanced || []
});
const GUNSLINGER_ADVENT_LISTS = {
  gear: [entry('Revolver'), entry('Duster')],
  abilities: [entry('Trickshot'), entry('Standoff'), entry('Shootout')]
};
const UPGRADE_CLASSES = [
  klass('gs-v1', 'Gunslinger', 'advent', null, GUNSLINGER_ADVENT_LISTS),
  klass('gs-v2', 'Gunslinger', 'advent', 'gs-v1', GUNSLINGER_ADVENT_LISTS),
  klass('gs-asp', 'Gunslinger', 'aspirant', 'gs-v1', {
    gear: [entry(' Revolver ', 'Aspirant six-shooter.')],
    abilities: [entry('Trickshot', 'Aspirant trick.')],
    advanced: [entry('Standoff', 'Aspirant standoff.')]
  }),
  klass('wd-v1', 'Wanderer', 'advent', null, { gear: [entry('Satchel')], abilities: [entry('Familiar Face')] }),
  klass('wd-asp', 'Wanderer', 'aspirant', 'wd-v1', { abilities: [entry('Familiar Face', 'Aspirant face.')] }),
  klass('dr-v1', 'Drifter', 'advent', null, { gear: [entry('Bedroll')], abilities: [entry('Wayfinding')] }),
  klass('sc-asp', 'Scout', 'aspirant', null, { abilities: [entry('Quick Study')] })
];
const ENCHANTMENT = { source: 'default', name: 'Quick' };
const MODS = [{ name: 'Scope' }];
const gearRow = (id, name, classId, extra = {}) => ({ id, name, class_id: classId, description: null, enchantment: null, mods: [], ...extra });
const abilityRow = (id, name, classId, extra = {}) => ({ id, name, class_id: classId, description: null, type: 'core', ...extra });

const upgradeInput = (overrides = {}) => ({
  character: { id: 'char-1', creator_id: 'profile-1', name: 'Caroline', class: 'Gunslinger', class_id: 'gs-v2', traits: TRAITS, ...overrides.character },
  classes: overrides.classes || UPGRADE_CLASSES,
  gear: overrides.gear || [
    gearRow('g1', 'Revolver', 'gs-v1', { enchantment: ENCHANTMENT, mods: MODS }),
    gearRow('g2', 'Revolver', 'gs-v2'),
    gearRow('g3', 'Duster', 'gs-v1', { description: 'Long coat.' }),
    gearRow('g4', 'Satchel', 'wd-v1'),
    gearRow('g5', 'Bedroll', 'dr-v1')
  ],
  abilities: overrides.abilities || [
    abilityRow('a1', 'trickshot', 'gs-v1'),
    abilityRow('a2', 'Standoff', 'gs-v1'),
    abilityRow('a3', 'Shootout', 'gs-v1', { description: 'Guns out.' }),
    abilityRow('a4', 'Familiar Face', 'wd-v1'),
    abilityRow('a5', 'Wayfinding', 'dr-v1'),
    abilityRow('a6', 'Quick Study', 'sc-asp')
  ],
  abilityPerks: overrides.abilityPerks || [
    { id: 'p0', class_ability_id: 'a1', text: 'Off the wall.', position: 0, compounds_with: null },
    { id: 'p1', class_ability_id: 'a2', text: 'Stare them down.', position: 1, compounds_with: null },
    { id: 'p2', class_ability_id: 'a2', text: 'Twice as long.', position: 2, compounds_with: 'position-1' },
    { id: 'p3', class_ability_id: 'a3', text: 'Steady hands.', position: 3, compounds_with: null }
  ]
});

describe('upgradeBuild', () => {
  test('the class moves to its Aspirant version', () => {
    expect(upgradeBuild(upgradeInput()).target.id).toBe('gs-asp');
  });

  // Each Revolver keeps its own Enchantment and Mods; the name is matched
  // trimmed and case-folded and takes the fork's trimmed spelling.
  test('Signatures with an Aspirant version move with their equipment; the rest stay as stored', () => {
    expect(upgradeBuild(upgradeInput()).gear).toEqual([
      { name: 'Revolver', class_id: 'gs-asp', description: 'Aspirant six-shooter.', enchantment: ENCHANTMENT, mods: MODS },
      { name: 'Revolver', class_id: 'gs-asp', description: 'Aspirant six-shooter.', enchantment: null, mods: [] },
      { name: 'Duster', class_id: 'gs-v1', description: 'Long coat.', enchantment: null, mods: [] },
      { name: 'Satchel', class_id: 'wd-v1', description: null, enchantment: null, mods: [] },
      { name: 'Bedroll', class_id: 'dr-v1', description: null, enchantment: null, mods: [] }
    ]);
  });

  // Familiar Face follows its donor (Wanderer), not the character's class.
  test('Abilities move to the Aspirant version of their own class, taking its spelling, text and type', () => {
    expect(upgradeBuild(upgradeInput()).abilities).toEqual([
      { name: 'Trickshot', class_id: 'gs-asp', description: 'Aspirant trick.', type: 'core' },
      { name: 'Standoff', class_id: 'gs-asp', description: 'Aspirant standoff.', type: 'advanced' },
      { name: 'Shootout', class_id: 'gs-v1', description: 'Guns out.', type: 'core' },
      { name: 'Familiar Face', class_id: 'wd-asp', description: 'Aspirant face.', type: 'core' },
      { name: 'Wayfinding', class_id: 'dr-v1', description: null, type: 'core' },
      { name: 'Quick Study', class_id: 'sc-asp', description: null, type: 'core' }
    ]);
  });

  test('Perks follow a moved Ability by name, keep their compound, and stay keyed by id otherwise', () => {
    expect(upgradeBuild(upgradeInput()).abilityPerks).toEqual([
      { class_ability_id: null, ability_name: 'Trickshot', text: 'Off the wall.', position: 0, compounds_with: null },
      { class_ability_id: null, ability_name: 'Standoff', text: 'Stare them down.', position: 1, compounds_with: null },
      { class_ability_id: null, ability_name: 'Standoff', text: 'Twice as long.', position: 2, compounds_with: 'position-1' },
      { class_ability_id: 'a3', text: 'Steady hands.', position: 3, compounds_with: null }
    ]);
  });

  test('moved and kept name every item for the preview', () => {
    const { moved, kept } = upgradeBuild(upgradeInput());
    expect(moved).toEqual([
      { kind: 'Signature', name: 'Revolver', className: 'Gunslinger' },
      { kind: 'Signature', name: 'Revolver', className: 'Gunslinger' },
      { kind: 'Ability', name: 'Trickshot', className: 'Gunslinger' },
      { kind: 'Ability', name: 'Standoff', className: 'Gunslinger' },
      { kind: 'Ability', name: 'Familiar Face', className: 'Wanderer' }
    ]);
    expect(kept).toEqual([
      { kind: 'Signature', name: 'Duster', className: 'Gunslinger' },
      { kind: 'Signature', name: 'Satchel', className: 'Wanderer' },
      { kind: 'Signature', name: 'Bedroll', className: 'Drifter' },
      { kind: 'Ability', name: 'Shootout', className: 'Gunslinger' },
      { kind: 'Ability', name: 'Wayfinding', className: 'Drifter' },
      { kind: 'Ability', name: 'Quick Study', className: 'Scout' }
    ]);
  });

  test('with no Aspirant version anywhere, nothing moves and the lists are null', () => {
    const upgrade = upgradeBuild(upgradeInput({
      character: { class: 'Drifter', class_id: 'dr-v1' },
      gear: [gearRow('g5', 'Bedroll', 'dr-v1')],
      abilities: [abilityRow('a5', 'Wayfinding', 'dr-v1')],
      abilityPerks: []
    }));
    expect(upgrade).toEqual({
      target: null, gear: null, abilities: null, abilityPerks: null, moved: [],
      kept: [{ kind: 'Signature', name: 'Bedroll', className: 'Drifter' }, { kind: 'Ability', name: 'Wayfinding', className: 'Drifter' }]
    });
  });

  test('the class can move while no row does, and then the lists are null so rows keep their ids', () => {
    const upgrade = upgradeBuild(upgradeInput({ gear: [gearRow('g3', 'Duster', 'gs-v1')], abilities: [], abilityPerks: [] }));
    expect(upgrade.target.id).toBe('gs-asp');
    expect([upgrade.gear, upgrade.abilities, upgrade.abilityPerks]).toEqual([null, null, null]);
  });

  test('a cross-class item moves to its donor\'s Aspirant version while a class with none stays', () => {
    const upgrade = upgradeBuild(upgradeInput({
      character: { class: 'Drifter', class_id: 'dr-v1' },
      gear: [],
      abilities: [abilityRow('a4', 'Familiar Face', 'wd-v1')],
      abilityPerks: []
    }));
    expect(upgrade.target).toBeNull();
    expect(upgrade.abilities).toEqual([{ name: 'Familiar Face', class_id: 'wd-asp', description: 'Aspirant face.', type: 'core' }]);
  });

  // save_character_atomic cannot pair a null class_id with its stored row, so
  // it re-inserts it; the Perk must follow by name or it is lost.
  test('a legacy Ability with no class stays, and its Perks re-attach by name', () => {
    const upgrade = upgradeBuild(upgradeInput({
      gear: [],
      abilities: [abilityRow('a1', 'Trickshot', 'gs-v1'), abilityRow('a9', 'Old Trick', null)],
      abilityPerks: [{ id: 'p9', class_ability_id: 'a9', text: 'Still works.', position: 0, compounds_with: null }]
    }));
    expect(upgrade.abilities[1]).toEqual({ name: 'Old Trick', class_id: null, description: null, type: 'core' });
    expect(upgrade.abilityPerks).toEqual([
      { class_ability_id: null, ability_name: 'Old Trick', text: 'Still works.', position: 0, compounds_with: null }
    ]);
    expect(upgrade.kept).toEqual([{ kind: 'Ability', name: 'Old Trick', className: null }]);
  });

  test('a family with two Aspirant versions counts as having none', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const upgrade = upgradeBuild(upgradeInput({
      classes: [...UPGRADE_CLASSES, klass('gs-asp-b', 'Gunslinger', 'aspirant', 'gs-v2', { gear: [entry('Revolver')] })],
      gear: [gearRow('g2', 'Revolver', 'gs-v2')],
      abilities: [],
      abilityPerks: []
    }));
    expect(upgrade.target).toBeNull();
    expect(upgrade.gear).toBeNull();
    warn.mockRestore();
  });
});

describe('upgradeSaveArgs', () => {
  test('names the new class, resubmits the Traits and carries the upgraded lists', () => {
    const input = upgradeInput();
    const upgrade = upgradeBuild(input);
    expect(upgradeSaveArgs({ character: input.character, upgrade })).toEqual({
      characterId: 'char-1',
      creatorId: 'profile-1',
      character: { class_id: 'gs-asp', class: 'Gunslinger' },
      traits: TRAITS,
      gear: upgrade.gear,
      abilities: upgrade.abilities,
      perks: upgrade.abilityPerks
    });
  });

  test('names no column when the class stays', () => {
    const character = { id: 'char-1', creator_id: 'profile-1', traits: TRAITS };
    const upgrade = { target: null, gear: null, abilities: null, abilityPerks: null, moved: [], kept: [] };
    expect(upgradeSaveArgs({ character, upgrade })).toEqual({
      characterId: 'char-1', creatorId: 'profile-1', character: {}, traits: TRAITS, gear: null, abilities: null, perks: null
    });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/aspirant-conversion.test.js`
Expected: FAIL with `TypeError: upgradeBuild is not a function` and `upgradeSaveArgs is not a function`. The existing `planConversion` tests still pass.

- [ ] **Step 3: Implement**

In `util/aspirant-conversion.js`, replace the header comment (the first three lines) with:

```js
// Moves an Advent character onto the Aspirant rules, as a plan: the build it
// takes onto its class's Aspirant version, what blocks the move, and what it
// shows afterwards. Pure -- the caller loads everything and saves the result.
```

Add `const { findAspirantFork } = require('./class-family');` to the requires. Add the following above `planConversion`:

```js
const GEAR_LISTS = [['gear', null]];
const ABILITY_LISTS = [['abilities', 'core'], ['advanced_abilities', 'advanced']];

const listOf = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

// A character row and a class's catalogue are written by different paths.
const nameKey = (value) => String(value ?? '').trim().toLowerCase();

const findInCatalogue = (cls, lists, name) => {
  const key = nameKey(name);
  for (const [listKey, type] of lists) {
    const match = listOf(cls[listKey]).find(item => nameKey(item.name) === key);
    if (match) return { entry: match, type };
  }
  return null;
};

// Each row moves to the Aspirant version of its OWN class, so a cross-class
// item follows its donor. A row with no Aspirant version, or already on one,
// stays exactly as stored. The lists are null when no row moves, so the save
// leaves every row and its id alone.
const upgradeBuild = ({ character, classes, gear, abilities, abilityPerks }) => {
  const catalogue = listOf(classes);
  const classesById = new Map(catalogue.map(row => [row.id, row]));
  const forks = new Map();
  const forkOf = (classId) => {
    if (!forks.has(classId)) forks.set(classId, findAspirantFork(catalogue, classId));
    return forks.get(classId);
  };
  const moved = [];
  const kept = [];
  const upgradeRow = (row, kind, lists) => {
    const home = classesById.get(row.class_id) || null;
    const fork = home ? forkOf(home.id) : null;
    const match = fork ? findInCatalogue(fork, lists, row.name) : null;
    if (!match) {
      kept.push({ kind, name: row.name, className: home ? home.name : null });
      return null;
    }
    const name = String(match.entry.name).trim();
    moved.push({ kind, name, className: fork.name });
    return { classId: fork.id, name, description: match.entry.description ?? null, type: match.type };
  };

  const gearRows = listOf(gear).map((row) => {
    const move = upgradeRow(row, 'Signature', GEAR_LISTS);
    return {
      name: move ? move.name : row.name,
      class_id: move ? move.classId : row.class_id ?? null,
      description: move ? move.description : row.description ?? null,
      enchantment: row.enchantment ?? null,
      mods: Array.isArray(row.mods) ? row.mods : []
    };
  });

  // save_character_atomic re-inserts an Ability whose class or name changes,
  // and one with no class_id (it cannot pair it with its stored row); either
  // cascades the Perks away, so those Perks re-attach by ability_name.
  const reinsertedNames = new Map();
  const abilityRows = listOf(abilities).map((row) => {
    const move = upgradeRow(row, 'Ability', ABILITY_LISTS);
    if (move) {
      reinsertedNames.set(row.id, move.name);
      return { name: move.name, class_id: move.classId, description: move.description, type: move.type };
    }
    if (row.class_id == null) reinsertedNames.set(row.id, row.name);
    return { name: row.name, class_id: row.class_id ?? null, description: row.description ?? null, type: row.type ?? null };
  });
  const perkRows = listOf(abilityPerks).map((perk) => {
    const base = { text: perk.text, position: perk.position, compounds_with: perk.compounds_with ?? null };
    const abilityName = reinsertedNames.get(perk.class_ability_id);
    return abilityName
      ? { class_ability_id: null, ability_name: abilityName, ...base }
      : { class_ability_id: perk.class_ability_id, ...base };
  });

  const target = forkOf(character.class_id ?? null);
  if (moved.length === 0) {
    return { target, gear: null, abilities: null, abilityPerks: null, moved, kept };
  }
  return { target, gear: gearRows, abilities: abilityRows, abilityPerks: perkRows, moved, kept };
};

// p_character names only the class, so every other column keeps its stored
// value, and a null list leaves those rows as they are. Traits are always
// resubmitted: save_character_atomic reads an absent Trait list as "no Traits".
const upgradeSaveArgs = ({ character, upgrade }) => ({
  characterId: character.id,
  creatorId: character.creator_id,
  character: upgrade.target ? { class_id: upgrade.target.id, class: upgrade.target.name } : {},
  traits: listOf(character.traits).map(({ name, stat }) => ({ name, stat })),
  gear: upgrade.gear,
  abilities: upgrade.abilities,
  perks: upgrade.abilityPerks
});
```

The exports become:

```js
module.exports = { upgradeBuild, upgradeSaveArgs, planConversion, CONVERSION_RULES };
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/aspirant-conversion.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add util/aspirant-conversion.js util/aspirant-conversion.test.js
git commit -m "feat: build a character's rows onto their classes' Aspirant versions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Conversion plans and saves the upgraded build

**Files:**
- Modify: `util/aspirant-conversion.js` (`planConversion`)
- Modify: `services/character/repository.js` (add `getConversionClasses` after `getClassFamilyRows`, about line 208; export it)
- Modify: `services/character/service.js` (`REQUIRED_ADAPTER_METHODS`, `loadAspirantConversion` at about line 138, `convertToAspirant` at about line 939, imports)
- Test: `util/aspirant-conversion.test.js`, `services/character/service.test.js`
- Modify (adapter stubs): `routes/character-level-up.test.js:112`, `test/character-wizard-client.test.js:1103`

**Interfaces:**
- Consumes: `upgradeBuild` and `upgradeSaveArgs` (Task 3), `familyResolver` (Task 1).
- Produces:
  - `planConversion({ character, classes, gear, abilities, abilityPerks, traits, realMissions, offscreenMissions })` returns `{ upgrade, blockers, breaches, perkBreakdown, merxBreakdown }`.
  - Repository and adapter: `getConversionClasses() => Promise<{ data: ClassRow[]|null, error }>`, where each `ClassRow` has `id, name, base_class_id, rules_edition, content_format, gear, abilities, advanced_abilities`.
  - `planAspirantConversion(actor, id)` returns `{ data: plan|null, error }`, and `plan.upgrade` is the `upgradeBuild` result.

- [ ] **Step 1: Move the `planConversion` tests onto `classes`, and add the new ones**

In `util/aspirant-conversion.test.js`, delete the `GUNSLINGER_FAMILY` and `classFamilyOf` constants and their comment. Replace them with:

```js
// Gunslinger v1 and v2 are one version family; Wanderer v1 and v2 another.
// Neither has an Aspirant version, so nothing moves.
const CAROLINE_CLASSES = [
  { id: 'gunslinger-v1', name: 'Gunslinger', base_class_id: null, rules_edition: 'advent', content_format: 'advent' },
  { id: 'gunslinger-v2', name: 'Gunslinger', base_class_id: 'gunslinger-v1', rules_edition: 'advent', content_format: 'advent' },
  { id: 'wanderer-v1', name: 'Wanderer', base_class_id: null, rules_edition: 'advent', content_format: 'advent' },
  { id: 'wanderer-v2', name: 'Wanderer', base_class_id: 'wanderer-v1', rules_edition: 'advent', content_format: 'advent' }
];
```

In `carolineDenton`, replace the `classFamilyOf:` line with:

```js
  classes: 'classes' in overrides ? overrides.classes : CAROLINE_CLASSES,
```

Then make these edits:
- Replace the test `'the plan names no rows to write: conversion changes only the mode'` with:
  ```js
  test('with no Aspirant version anywhere, the plan moves nothing', () => {
    const { upgrade } = planConversion(carolineDenton());
    expect(upgrade.target).toBeNull();
    expect([upgrade.gear, upgrade.abilities, upgrade.abilityPerks]).toEqual([null, null, null]);
  });
  ```
- In the test `'the family comes from classFamilyOf'`, rename it to `'the family comes from the class catalogue'` and change its argument to `carolineDenton({ classes: [] })`.
- In the test `'a character with no class is judged with every Ability own-class'`, delete `, classFamilyOf: null` from its argument.

Append:

```js
describe('planConversion: judged on the upgraded build', () => {
  const forked = () => carolineDenton({
    classes: UPGRADE_CLASSES,
    character: { class_id: 'gs-v2' },
    gear: [gearRow('g1', 'Revolver', 'gs-v1'), gearRow('g3', 'Duster', 'gs-v1')],
    abilities: [abilityRow('a1', 'Trickshot', 'gs-v1'), abilityRow('a3', 'Shootout', 'gs-v1')],
    abilityPerks: []
  });

  test('the plan carries the upgrade', () => {
    expect(planConversion(forked()).upgrade.target.id).toBe('gs-asp');
  });

  // Duster and Shootout have no Aspirant version and stay on Advent
  // Gunslinger, which is still the character's own class on the fork.
  test('leftover Advent own-class items price as own-class after the move', () => {
    const plan = planConversion(forked());
    expect(plan.merxBreakdown.spend).toBe(2 * priceOfSignature({ crossClass: false }));
    expect(plan.perkBreakdown.spend).toBe(0);
  });

  test('items with no Aspirant version never block', () => {
    expect(planConversion(forked()).blockers).toEqual([]);
  });
});
```

`UPGRADE_CLASSES`, `gearRow` and `abilityRow` come from Task 3. Append this block after Task 3's `describe` blocks, so those constants are declared above it.

- [ ] **Step 2: Rewrite the service conversion tests**

In `services/character/service.test.js`:
- Add `getConversionClasses: async () => ok([]),` to `makeAdapter` directly after `getClassFamilyRows`.
- Replace `CONVERSION_FAMILY` with:
  ```js
  const CONVERSION_CLASSES = [
    { id: 'gunslinger-v1', name: 'Gunslinger', rules_edition: 'advent', content_format: 'advent', base_class_id: null,
      gear: [{ name: 'Revolver' }], abilities: [{ name: 'Trickshot' }], advanced_abilities: [] },
    { id: 'gunslinger-v2', name: 'Gunslinger', rules_edition: 'advent', content_format: 'advent', base_class_id: 'gunslinger-v1',
      gear: [{ name: 'Revolver' }], abilities: [{ name: 'Trickshot' }], advanced_abilities: [] },
    { id: 'gunslinger-aspirant', name: 'Gunslinger', rules_edition: 'aspirant', content_format: 'aspirant', base_class_id: 'gunslinger-v1',
      gear: [{ name: 'Revolver', description: 'Aspirant six-shooter.' }], abilities: [{ name: 'Trickshot', description: 'Aspirant trick.' }], advanced_abilities: [] },
    { id: 'wanderer-v1', name: 'Wanderer', rules_edition: 'advent', content_format: 'advent', base_class_id: null,
      gear: [], abilities: [{ name: 'Familiar Face' }], advanced_abilities: [] }
  ];
  ```
- In `conversionAdapter`:
  - Delete the `getClassFamilyRows` override.
  - Add `getConversionClasses: async () => ok(CONVERSION_CLASSES),`.
  - Change `CONVERSION_FAMILY.find` to `CONVERSION_CLASSES.find`.
- Replace the `MODE_ONLY_SAVE` comment with `// Nothing has an Aspirant version: only the mode changes, and every row keeps its id.`

Then replace these tests as follows. Keep every other conversion test unchanged.
- Replace `'convertToAspirant changes only the mode'` with:
  ```js
  test('convertToAspirant moves the class and its matching rows onto the Aspirant version in one save', async () => {
    const calls = [];
    const result = await new CharacterService(conversionAdapter(calls)).convertToAspirant(CREATOR, 'character-1');
    expect(result.error).toBeNull();
    expect(calls).toEqual([['saveCharacterAtomic', {
      characterId: 'character-1',
      creatorId: 'profile-1',
      character: { creator_mode: 'aspirant', class_id: 'gunslinger-aspirant', class: 'Gunslinger' },
      traits: CONVERSION_TRAITS,
      gear: [{ name: 'Revolver', class_id: 'gunslinger-aspirant', description: 'Aspirant six-shooter.', enchantment: null, mods: [] }],
      abilities: [{ name: 'Trickshot', class_id: 'gunslinger-aspirant', description: 'Aspirant trick.', type: 'core' }],
      perks: [{ class_ability_id: null, ability_name: 'Trickshot', text: 'Off the wall.', position: 0, compounds_with: null }]
    }]]);
  });
  ```
- Replace `'a class with no Aspirant version converts all the same'` with:
  ```js
  test('a class with no Aspirant version converts all the same, changing only the mode', async () => {
    const calls = [];
    const service = new CharacterService(conversionAdapter(calls, adventGunslinger({
      class: 'Wanderer', class_id: 'wanderer-v1', gear: [],
      abilities: [{ id: 'ab-2', name: 'Familiar Face', class_id: 'wanderer-v1', type: 'core' }],
      ability_perks: []
    })));
    expect((await service.convertToAspirant(CREATOR, 'character-1')).error).toBeNull();
    expect(calls).toEqual([['saveCharacterAtomic', MODE_ONLY_SAVE]]);
  });

  test('a cross-class item moves to its donor\'s Aspirant version while the class stays', async () => {
    const calls = [];
    const service = new CharacterService(conversionAdapter(calls, adventGunslinger({
      class: 'Wanderer', class_id: 'wanderer-v1', abilities: [], ability_perks: []
    })));
    expect((await service.convertToAspirant(CREATOR, 'character-1')).error).toBeNull();
    expect(calls[0][1].character).toEqual({ creator_mode: 'aspirant' });
    expect(calls[0][1].gear).toEqual([
      { name: 'Revolver', class_id: 'gunslinger-aspirant', description: 'Aspirant six-shooter.', enchantment: null, mods: [] }
    ]);
  });

  test('a family with two Aspirant versions converts as if it had none', async () => {
    const calls = [];
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const service = new CharacterService({
      ...conversionAdapter(calls),
      getConversionClasses: async () => ok([...CONVERSION_CLASSES, {
        ...CONVERSION_CLASSES[2], id: 'gunslinger-aspirant-b', base_class_id: 'gunslinger-v2'
      }])
    });
    expect((await service.convertToAspirant(CREATOR, 'character-1')).error).toBeNull();
    expect(calls).toEqual([['saveCharacterAtomic', MODE_ONLY_SAVE]]);
    warn.mockRestore();
  });
  ```
  Add `spyOn` to the `bun:test` import on line 1.
- Replace `'a character with no class converts without reading a version family'` with:
  ```js
  test('a character with no class and no rows converts, changing only the mode', async () => {
    const calls = [];
    const service = new CharacterService(conversionAdapter(calls, adventGunslinger({
      class: 'Drifter', class_id: null, gear: [], abilities: [], ability_perks: []
    })));
    expect((await service.convertToAspirant(CREATOR, 'character-1')).error).toBeNull();
    expect(calls).toEqual([['saveCharacterAtomic', MODE_ONLY_SAVE]]);
  });
  ```
- In `'planAspirantConversion returns the plan for an eligible character'`, change the keys expectation to:
  ```js
  expect(Object.keys(data).sort()).toEqual(['blockers', 'breaches', 'merxBreakdown', 'perkBreakdown', 'upgrade']);
  expect(data.upgrade.target.id).toBe('gunslinger-aspirant');
  ```
- Replace `'a version-family read failure is returned, not thrown'` with:
  ```js
  test('a class read failure is returned, not thrown, and saves nothing', async () => {
    const calls = [];
    const service = new CharacterService({
      ...conversionAdapter(calls),
      getConversionClasses: async () => ({ data: null, error: { message: 'boom' } })
    });
    expect(await service.convertToAspirant(CREATOR, 'character-1')).toEqual({ data: null, error: { message: 'boom' } });
    expect(calls).toEqual([]);
  });
  ```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/aspirant-conversion.test.js services/character/service.test.js`

Expected: FAIL.
- The planner fails with `plan.upgrade` undefined, and leftover items price cross-class.
- The service fails because the save payload is mode-only with null lists.

- [ ] **Step 4: Implement `planConversion`**

In `util/aspirant-conversion.js`, change the class-family require to `const { findAspirantFork, familyResolver } = require('./class-family');`. Then replace `planConversion` and the comment above it with:

```js
// Judged under the aspirant economy on the upgraded build, with own class
// taken from the class the character lands on.
const planConversion = ({
  character, classes, gear, abilities, abilityPerks, traits, realMissions, offscreenMissions
}) => {
  const upgrade = upgradeBuild({ character, classes, gear, abilities, abilityPerks });
  const characterClassId = upgrade.target ? upgrade.target.id : (character.class_id ?? null);
  const classFamilyOf = familyResolver(classes, characterClassId);

  // The rules Aspirant enforces on every save, judged by the validators that
  // enforce them. Stat Cap only: the creation allotment and +++ ceiling are
  // creation rules (validateStatLimits).
  const blockers = [];
  const addBlockers = (rule, result) => {
    if (!result.ok) for (const detail of result.errors) blockers.push({ rule, detail });
  };
  addBlockers(CONVERSION_RULES.traits, validateTraits(traits, { economy: ASPIRANT }));
  addBlockers(CONVERSION_RULES.statCap, validateStatLimits({
    economy: ASPIRANT,
    stats: Object.fromEntries(statList.map(stat => [stat, character[stat]])),
    traits,
    capPurchases: character.stat_cap_purchases,
    enforceCreationAllotment: false
  }));

  // The Ability cap and Perk deficit are grandfathered by the ratchet after
  // conversion, so they are reported, not blocking.
  const perkArgs = {
    economy: ASPIRANT,
    level: character.level,
    abilities: upgrade.abilities ?? abilities,
    abilityPerks,
    characterClassId,
    classFamilyOf
  };

  return {
    upgrade,
    blockers,
    breaches: deriveBuildBreaches(perkArgs),
    perkBreakdown: derivePerkBreakdown(perkArgs),
    merxBreakdown: deriveMerxBreakdown({
      realMissions,
      offscreenMissions,
      gear: upgrade.gear ?? gear,
      commonItems: character.common_items,
      characterClassId,
      economy: ASPIRANT,
      classFamilyOf
    })
  };
};
```

- [ ] **Step 5: Add `getConversionClasses` to the repository**

In `services/character/repository.js`, add this directly after `getClassFamilyRows`:

```js
// Every class with its catalogue lists: conversion walks version families
// across the whole catalogue to find each row's Aspirant version and matches
// names against that version's lists. util/class-family.js needs
// base_class_id, rules_edition and content_format together.
const getConversionClasses = async () => {
  const { data, error } = await supabaseAdmin
    .from('classes')
    .select('id, name, base_class_id, rules_edition, content_format, gear, abilities, advanced_abilities');
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data: data || [], error: null };
};
```

Add `getConversionClasses,` to `module.exports` directly after `getClassFamilyRows,`.

- [ ] **Step 6: Update the service**

In `services/character/service.js`:
- Change the import to `const { planConversion, upgradeSaveArgs } = require('../../util/aspirant-conversion');`.
- Add `'getConversionClasses',` to `REQUIRED_ADAPTER_METHODS` directly after `'getClassFamilyRows',`.
- Replace the body of `loadAspirantConversion` from `let classFamilyOf = null;` through `return { character, plan };` with:
  ```js
  const [classes, missions, offscreenMissions] = await Promise.all([
    adapter.getConversionClasses(),
    adapter.getRealMissions(id),
    adapter.listOffscreenMissions(id)
  ]);
  const readError = classes.error || missions.error || offscreenMissions.error;
  if (readError) return { error: readError };
  const plan = planConversion({
    character,
    classes: classes.data,
    gear: character.gear,
    abilities: character.abilities,
    abilityPerks: character.ability_perks,
    traits: character.traits,
    realMissions: missions.data || [],
    offscreenMissions: offscreenMissions.data || []
  });
  return { character, plan };
  ```
- In `convertToAspirant`, replace the comment that starts `// p_character names creator_mode alone` and the `return this.adapter.saveCharacterAtomic({ ... });` below it with:
  ```js
  // The class, its rows and the mode change in one transactional save.
  const save = upgradeSaveArgs({ character, upgrade: plan.upgrade });
  return this.adapter.saveCharacterAtomic({ ...save, character: { ...save.character, creator_mode: 'aspirant' } });
  ```

- [ ] **Step 7: Add the new adapter method to the other adapter stubs**

- `routes/character-level-up.test.js`: directly after its `getClassFamilyRows` stub (about line 112), add:
  ```js
  getConversionClasses: async () => ({ data: [], error: null }),
  ```
- `test/character-wizard-client.test.js`: add `'getConversionClasses'` to `UNREACHED_ADAPTER_METHODS` (about line 1103).
- Then find any other adapter that lists the required methods: `semble search "REQUIRED_ADAPTER_METHODS adapter stub getClassFamilyRows" .`. Add the method to each hit, the same way.

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/aspirant-conversion.test.js services/character/service.test.js routes/character-level-up.test.js test/character-wizard-client.test.js`
Expected: PASS, all four files.

Run: `bun run test:unit`
Expected: 0 failures.

- [ ] **Step 9: Commit**

```bash
git add util/aspirant-conversion.js util/aspirant-conversion.test.js services/character/repository.js services/character/service.js services/character/service.test.js routes/character-level-up.test.js test/character-wizard-client.test.js
git commit -m "feat: convert to Aspirant onto the class's Aspirant version, moving matching rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add any extra stub file from Step 7 to the `git add`.)

---

### Task 5: Edit-page panel names the Aspirant version and what moves

**Files:**
- Modify: `views/character-form.handlebars:121-124` (the panel's opening sentence)
- Test: `routes/characters.test.js` (the Convert to Aspirant section, about lines 834-915)

**Interfaces:**
- Consumes: `aspirantConversion.upgrade` = `{ target, moved, kept }` (Task 4).
- Produces: markup only.

- [ ] **Step 1: Write the failing tests**

In `routes/characters.test.js`, replace `conversionPlan` with:

```js
const NO_UPGRADE = { target: null, gear: null, abilities: null, abilityPerks: null, moved: [], kept: [] };
const conversionPlan = (blockers = [], upgrade = NO_UPGRADE) => ({
  upgrade,
  blockers,
  breaches: [{ severity: 'hard', rule: 'perk-deficit', detail: '6 Perks spent of 4 earned.' }],
  perkBreakdown: { earned: 4, spend: 6, remaining: 0, deficit: 2 },
  merxBreakdown: { earned: 12, spend: 20, reward: 0, deficit: 8 }
});
```

In `'the edit form offers conversion: same class and build, Aspirant totals, a live Convert button'`, replace the two copy lines:

```js
  expect(body).toContain('Ash can switch to the Aspirant rules. It keeps its class and its whole build');
  expect(body).not.toContain('Abilities after conversion');
```

with:

```js
  expect(body).toContain('Ash can switch to the Aspirant rules. It keeps its class and its whole build.</p>');
  expect(body).not.toContain('Moves to its Aspirant version:');
  expect(body).not.toContain('Stays as it is:');
```

Add after that test:

```js
test('the edit form names the Aspirant version and lists what moves and what stays', async () => {
  pageState.conversionPlan = conversionPlan([], {
    ...NO_UPGRADE,
    target: { id: 'class-gs-fork', name: 'Gunslinger' },
    moved: [{ kind: 'Signature', name: 'Revolver', className: 'Gunslinger' }],
    kept: [{ kind: 'Ability', name: 'Old Trick', className: null }, { kind: 'Signature', name: 'Duster', className: 'Gunslinger' }]
  });
  const body = await editPage();
  expect(body).toContain('Ash can switch to the Aspirant rules and move to <strong>Gunslinger</strong>.');
  expect(body).toContain('Moves to its Aspirant version:');
  expect(body).toContain('<li>Signature: Revolver (Gunslinger)</li>');
  expect(body).toContain('Stays as it is:');
  expect(body).toContain('<li>Ability: Old Trick</li>');
  expect(body).toContain('<li>Signature: Duster (Gunslinger)</li>');
  expect(body).not.toContain('It keeps its class');
});

test('without an Aspirant version the form lists a cross-class item that moves, and nothing that stays', async () => {
  pageState.conversionPlan = conversionPlan([], {
    ...NO_UPGRADE,
    moved: [{ kind: 'Ability', name: 'Familiar Face', className: 'Wanderer' }],
    kept: [{ kind: 'Signature', name: 'Bedroll', className: 'Drifter' }]
  });
  const body = await editPage();
  expect(body).toContain('It keeps its class and its whole build.');
  expect(body).toContain('<li>Ability: Familiar Face (Wanderer)</li>');
  expect(body).not.toContain('Stays as it is:');
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/characters.test.js`
Expected: 3 failures. The first test fails because the rendered copy still ends `...whole build: every Signature, Ability and Ability Perk stays as it is.` The two new tests fail because the target sentence and the lists are missing.

- [ ] **Step 3: Implement**

In `views/character-form.handlebars`, replace the line:

```hbs
    <p>{{character.name}} can switch to the Aspirant rules. It keeps its class and its whole build: every Signature, Ability and Ability Perk stays as it is.</p>
```

with:

```hbs
    {{#if aspirantConversion.upgrade.target}}
    <p>{{character.name}} can switch to the Aspirant rules and move to <strong>{{aspirantConversion.upgrade.target.name}}</strong>.</p>
    {{else}}
    <p>{{character.name}} can switch to the Aspirant rules. It keeps its class and its whole build.</p>
    {{/if}}
    {{#if aspirantConversion.upgrade.moved.length}}
    <p class="mt-2">Moves to its Aspirant version:</p>
    <ul>
      {{#each aspirantConversion.upgrade.moved}}
      <li>{{this.kind}}: {{this.name}} ({{this.className}})</li>
      {{/each}}
    </ul>
    {{/if}}
    {{#if aspirantConversion.upgrade.target}}
    {{#if aspirantConversion.upgrade.kept.length}}
    <p class="mt-2">Stays as it is:</p>
    <ul>
      {{#each aspirantConversion.upgrade.kept}}
      <li>{{this.kind}}: {{this.name}}{{#if this.className}} ({{this.className}}){{/if}}</li>
      {{/each}}
    </ul>
    {{/if}}
    {{/if}}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/characters.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add views/character-form.handlebars routes/characters.test.js
git commit -m "feat: show the Aspirant version and the moving items in the conversion panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Integration test — conversion moves class and rows through `save_character_atomic`

**Files:**
- Modify (rewrite): `models/character-convert-aspirant.integration.test.js`

**Interfaces:**
- Consumes: `convertCharacterToAspirant`, `planCharacterAspirantConversion` and `updateCharacter` from `models/character.js`, and the real repository (`getConversionClasses`, `saveCharacterAtomic`).
- Produces: nothing.

This task changes only a test, because Tasks 1-5 already produced the behaviour. "Red" here means proving the new assertions against the real RPC. If one fails, the code is wrong, not the test. Debug with superpowers:systematic-debugging.

- [ ] **Step 1: Confirm the target is local**

Run: `eval "$(supabase status -o env)" && echo "$API_URL"`
Expected: `http://127.0.0.1:54321`. If it is not, stop.

- [ ] **Step 2: Replace the file with**

```js
// Local-Supabase integration coverage for Convert to Aspirant: the character,
// and every row with an Aspirant version, move onto it through
// save_character_atomic; everything else stays as it was.
require('../util/require-local-supabase');

const { test, expect, beforeAll, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('./_base');
const { convertCharacterToAspirant, planCharacterAspirantConversion, updateCharacter } = require('./character');
const { statList } = require('../util/enclave-consts');
const { createAuthUserAndProfile } = require('../test/helpers/auth-user-fixture');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `convert-aspirant-${suffix}@example.test`;
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});

const STATS = Object.fromEntries(statList.map(stat => [stat, 1]));
const TRAITS = [{ name: 'Brave', stat: 'might' }, { name: 'Clever', stat: 'intelligence' }, { name: 'Lucky', stat: 'luck' }];
const TRAIT_FIELDS = {
  trait0: 'Brave', trait0_stat: 'might',
  trait1: 'Clever', trait1_stat: 'intelligence',
  trait2: 'Lucky', trait2_stat: 'luck'
};
const QUIRKS = [{ name: 'Night Owl', downside: 'Sleeps through mornings.', upside: 'Sees in the dark.' }];
const ACCESSORIES = [{ name: 'Pocket Watch' }];
const ENCHANTMENT = { source: 'custom', name: 'Quick Draw', description: 'Draws first.' };
const MODS = [{ name: 'Scope', description: 'Sees far.' }];
const EDITED_QUIRKS = [{ name: 'Night Owl', downside: 'Sleeps through noon.', upside: 'Sees in the dark.' }];
const EDITED_ACCESSORIES = [{ name: 'Pocket Watch' }, { name: 'Lucky Coin' }];
const EDITED_PERK = 'Off every wall.';

let authUserId;
let profile;
const classes = {};
const characters = {};

const insertClass = async (row) => {
  const { data, error } = await supabaseAdmin.from('classes')
    .insert({ is_public: true, advanced_abilities: [], ...row })
    .select()
    .single();
  if (error) throw error;
  return data;
};

const createAdventCharacter = async ({ cls, name, level, quirks = [], accessories = [], gear, abilities, perks }) => {
  const { data, error } = await supabaseAdmin.rpc('save_character_atomic', {
    p_character_id: null,
    p_creator_id: profile.id,
    p_character: {
      ...STATS,
      creator_id: profile.id, name,
      class: cls.name, class_id: cls.id, creator_mode: null,
      level, completed_missions: 0, commissary_reward: 0, quirks, accessories
    },
    p_traits: TRAITS,
    p_gear: gear,
    p_abilities: abilities,
    p_perks: perks
  });
  if (error) throw error;
  return data.id;
};

const characterRow = async (id) => (await db.query(
  'select class_id, class, creator_mode, level, quirks, accessories, perks, updated_at from characters where id = $1', [id]
)).rows[0];

const storedRows = async (id) => {
  const query = async (sql) => (await db.query(sql, [id])).rows;
  return {
    gear: await query('select id, class_id, name, description, enchantment, mods from class_gear where character_id = $1 order by id'),
    abilities: await query('select id, class_id, name, type, description from class_abilities where character_id = $1 order by id'),
    perks: await query('select id, class_ability_id, text, position, compounds_with from character_perks where character_id = $1 order by id'),
    traits: await query('select id, name, stat from traits where character_id = $1 order by id')
  };
};

const perksByPosition = async (id) => (await db.query(
  `select p.text, p.position, a.name as ability, target.text as compounds_with_text
   from character_perks p
   join class_abilities a on a.id = p.class_ability_id
   left join character_perks target on target.id = p.compounds_with
   where p.character_id = $1
   order by p.position`,
  [id]
)).rows;

const gearCount = async (id) => (await db.query(
  'select count(*)::int as count from class_gear where character_id = $1', [id]
)).rows[0].count;

beforeAll(async () => {
  await db.connect();
  ({ authUserId, profile } = await createAuthUserAndProfile(db, { email, profileName: `Convert ${suffix}` }));

  classes.gunslinger = await insertClass({
    name: `Conv Gunslinger ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v1',
    gear: [{ name: 'Revolver' }, { name: 'Duster' }],
    abilities: [{ name: 'Trickshot' }, { name: 'Standoff' }, { name: 'Shootout' }]
  });
  classes.gunslingerFork = await insertClass({
    name: `Conv Gunslinger ${suffix}`, rules_edition: 'aspirant', content_format: 'aspirant', rules_version: 'v2',
    base_class_id: classes.gunslinger.id,
    gear: [{ name: 'Revolver', description: 'Aspirant six-shooter.' }],
    abilities: [{ name: 'Trickshot', description: 'Aspirant trick.' }],
    advanced_abilities: [{ name: 'Standoff' }]
  });
  classes.wanderer = await insertClass({
    name: `Conv Wanderer ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v1',
    gear: [{ name: 'Satchel' }], abilities: [{ name: 'Familiar Face' }]
  });
  classes.wandererFork = await insertClass({
    name: `Conv Wanderer ${suffix}`, rules_edition: 'aspirant', content_format: 'aspirant', rules_version: 'v2',
    base_class_id: classes.wanderer.id, abilities: [{ name: 'Familiar Face' }]
  });
  classes.drifter = await insertClass({
    name: `Conv Drifter ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v2',
    gear: [{ name: 'Bedroll' }], abilities: [{ name: 'Wayfinding' }]
  });

  // An Advent Gunslinger at level 4: two Revolvers (one enchanted and
  // modded), a Duster and Wanderer's Satchel; three Gunslinger Abilities and
  // Wanderer's Familiar Face; five Ability Perks, one a compound.
  characters.caroline = await createAdventCharacter({
    cls: classes.gunslinger, name: `Convert ${suffix}`, level: 4, quirks: QUIRKS, accessories: ACCESSORIES,
    gear: [
      { name: 'Revolver', class_id: classes.gunslinger.id, enchantment: ENCHANTMENT, mods: MODS },
      { name: 'Revolver', class_id: classes.gunslinger.id },
      { name: 'Duster', class_id: classes.gunslinger.id },
      { name: 'Satchel', class_id: classes.wanderer.id }
    ],
    abilities: [
      { name: 'Trickshot', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Standoff', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Shootout', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Familiar Face', class_id: classes.wanderer.id, type: 'core' }
    ],
    perks: [
      { ability_name: 'Trickshot', text: 'Off the wall.', position: 0 },
      { ability_name: 'Standoff', text: 'Stare them down.', position: 1 },
      { ability_name: 'Standoff', text: 'Twice as long.', position: 2, compounds_with: 'position-1' },
      { ability_name: 'Familiar Face', text: 'Known in every town.', position: 3 },
      { ability_name: 'Shootout', text: 'Steady hands.', position: 4 }
    ]
  });

  // A class with no Aspirant version, carrying only its own items.
  characters.nomad = await createAdventCharacter({
    cls: classes.drifter, name: `Nomad ${suffix}`, level: 2,
    gear: [{ name: 'Bedroll', class_id: classes.drifter.id }],
    abilities: [{ name: 'Wayfinding', class_id: classes.drifter.id, type: 'core' }],
    perks: [{ ability_name: 'Wayfinding', text: 'Never lost.', position: 0 }]
  });

  // Thirteen Signatures: more than an Aspirant character may bring on a mission.
  characters.hoarder = await createAdventCharacter({
    cls: classes.gunslinger, name: `Hoarder ${suffix}`, level: 1,
    gear: Array.from({ length: 13 }, () => ({ name: 'Revolver', class_id: classes.gunslinger.id })),
    abilities: [
      { name: 'Trickshot', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Standoff', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Shootout', class_id: classes.gunslinger.id, type: 'core' }
    ],
    perks: []
  });
});

afterAll(async () => {
  if (profile?.id) await db.query('delete from characters where creator_id = $1', [profile.id]);
  if (profile?.id) await db.query('delete from profiles where id = $1', [profile.id]);
  for (const key of ['gunslingerFork', 'wandererFork', 'gunslinger', 'wanderer', 'drifter']) {
    if (classes[key]?.id) await db.query('delete from classes where id = $1', [classes[key].id]);
  }
  if (authUserId) await db.query('delete from auth.users where id = $1', [authUserId]);
  await db.end();
});

test('the preview names the Aspirant version and what moves to it', async () => {
  const { data, error } = await planCharacterAspirantConversion({ profileId: profile.id }, characters.caroline);
  expect(error).toBeNull();
  expect(data.blockers).toEqual([]);
  expect(data.upgrade.target.id).toBe(classes.gunslingerFork.id);
  expect(data.upgrade.moved.map(item => item.name).sort())
    .toEqual(['Familiar Face', 'Revolver', 'Revolver', 'Standoff', 'Trickshot']);
  expect(data.upgrade.kept.map(item => item.name).sort()).toEqual(['Duster', 'Satchel', 'Shootout']);
});

test('conversion moves the class and every row with an Aspirant version, and keeps the rest', async () => {
  const id = characters.caroline;
  const rowBefore = await characterRow(id);
  const before = await storedRows(id);

  const { data, error } = await convertCharacterToAspirant({ profileId: profile.id }, id);
  expect(error).toBeNull();
  expect(data.class_id).toBe(classes.gunslingerFork.id);

  const rowAfter = await characterRow(id);
  expect(rowAfter).toEqual({
    ...rowBefore,
    class_id: classes.gunslingerFork.id,
    class: classes.gunslingerFork.name,
    creator_mode: 'aspirant',
    updated_at: rowAfter.updated_at
  });

  const after = await storedRows(id);
  const named = (rows, names) => rows.filter(row => names.includes(row.name));
  expect(named(after.gear, ['Duster', 'Satchel'])).toEqual(named(before.gear, ['Duster', 'Satchel']));
  const revolvers = after.gear.filter(row => row.name === 'Revolver').map(({ id: _id, ...row }) => row);
  expect(revolvers).toHaveLength(2);
  expect(revolvers).toContainEqual({
    class_id: classes.gunslingerFork.id, name: 'Revolver', description: 'Aspirant six-shooter.', enchantment: ENCHANTMENT, mods: MODS
  });
  expect(revolvers).toContainEqual({
    class_id: classes.gunslingerFork.id, name: 'Revolver', description: 'Aspirant six-shooter.', enchantment: null, mods: []
  });

  const ability = (name) => after.abilities.find(row => row.name === name);
  expect(ability('Shootout')).toEqual(before.abilities.find(row => row.name === 'Shootout'));
  expect(ability('Trickshot')).toMatchObject({ class_id: classes.gunslingerFork.id, type: 'core', description: 'Aspirant trick.' });
  expect(ability('Standoff')).toMatchObject({ class_id: classes.gunslingerFork.id, type: 'advanced' });
  expect(ability('Familiar Face')).toMatchObject({ class_id: classes.wandererFork.id, type: 'core' });

  expect(await perksByPosition(id)).toEqual([
    { text: 'Off the wall.', position: 0, ability: 'Trickshot', compounds_with_text: null },
    { text: 'Stare them down.', position: 1, ability: 'Standoff', compounds_with_text: null },
    { text: 'Twice as long.', position: 2, ability: 'Standoff', compounds_with_text: 'Stare them down.' },
    { text: 'Known in every town.', position: 3, ability: 'Familiar Face', compounds_with_text: null },
    { text: 'Steady hands.', position: 4, ability: 'Shootout', compounds_with_text: null }
  ]);
  const shootoutPerk = (rows) => rows.perks.find(perk => perk.position === 4).id;
  expect(shootoutPerk(after)).toBe(shootoutPerk(before));
  expect(after.traits).toEqual(before.traits);
});

test('a class with no Aspirant version keeps its class and every row id', async () => {
  const id = characters.nomad;
  const rowBefore = await characterRow(id);
  const before = await storedRows(id);

  const { error } = await convertCharacterToAspirant({ profileId: profile.id }, id);
  expect(error).toBeNull();

  const rowAfter = await characterRow(id);
  expect(rowAfter).toEqual({ ...rowBefore, creator_mode: 'aspirant', updated_at: rowAfter.updated_at });
  expect(await storedRows(id)).toEqual(before);
});

test('a second conversion is refused and writes nothing', async () => {
  const id = characters.caroline;
  const before = { row: await characterRow(id), rows: await storedRows(id) };
  const result = await convertCharacterToAspirant({ profileId: profile.id }, id);
  expect(result).toEqual({
    data: null,
    error: { status: 400, message: `Convert ${suffix} is not on the Advent rules, so there is nothing to convert.` }
  });
  expect({ row: await characterRow(id), rows: await storedRows(id) }).toEqual(before);
});

test('an ordinary edit of the converted character saves the Quirk, Accessories and Ability Perks', async () => {
  const id = characters.caroline;
  const { rows: perks } = await db.query(
    `select p.class_ability_id, p.text, p.position, target.position as target_position
     from character_perks p left join character_perks target on target.id = p.compounds_with
     where p.character_id = $1 order by p.position`,
    [id]
  );
  const result = await updateCharacter(id, {
    ...STATS,
    ...TRAIT_FIELDS,
    name: `Converted ${suffix}`,
    level: 4,
    quirks: EDITED_QUIRKS,
    accessories: EDITED_ACCESSORIES,
    ability_perks: perks.map((perk, index) => ({
      class_ability_id: perk.class_ability_id,
      text: index === 0 ? EDITED_PERK : perk.text,
      position: perk.position,
      compounds_with: perk.target_position == null ? null : `position-${perk.target_position}`
    }))
  }, { id: profile.id });
  expect(result.error).toBeNull();

  const row = await characterRow(id);
  expect({ class_id: row.class_id, creator_mode: row.creator_mode, quirks: row.quirks, accessories: row.accessories })
    .toEqual({ class_id: classes.gunslingerFork.id, creator_mode: 'aspirant', quirks: EDITED_QUIRKS, accessories: EDITED_ACCESSORIES });
  expect((await perksByPosition(id)).map(perk => perk.text))
    .toEqual([EDITED_PERK, 'Stare them down.', 'Twice as long.', 'Known in every town.', 'Steady hands.']);
});

test('Signatures past what a mission allows convert and keep growing while Merx is not judged', async () => {
  const id = characters.hoarder;
  expect((await convertCharacterToAspirant({ profileId: profile.id }, id)).error).toBeNull();
  expect(await gearCount(id)).toBe(13);

  const result = await updateCharacter(id, {
    ...STATS,
    ...TRAIT_FIELDS,
    name: `Hoarder ${suffix}`,
    level: 1,
    gear: Array.from({ length: 14 }, () => ({ name: 'Revolver', class_id: classes.gunslinger.id }))
  }, { id: profile.id });
  expect(result.error).toBeNull();
  expect(await gearCount(id)).toBe(14);
});
```

- [ ] **Step 3: Run it against the local stack**

Run: `eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test models/character-convert-aspirant.integration.test.js`
Expected: 6 pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add models/character-convert-aspirant.integration.test.js
git commit -m "test: conversion moves the class and matching rows through save_character_atomic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `scripts/upgrade-converted-aspirant-classes.js`

**Files:**
- Create: `scripts/upgrade-converted-aspirant-classes.js`
- Create: `test/upgrade-converted-aspirant-classes.integration.test.js`
- Modify: `scripts/run-tests.mjs` (add the test to `integrationFiles`, in alphabetical order after `'routes/mcp-oauth.integration.test.js'`)

**Interfaces:**
- Consumes:
  - `characterRepository.getConversionClasses`, `getCharacter` and `saveCharacterAtomic` (Task 4).
  - `findAspirantFork` (Task 1).
  - `upgradeBuild` and `upgradeSaveArgs` (Task 3).
- Produces: `upgradeConvertedCharacters({ apply = false, characterIds = null, log = console.log })` returns `Promise<{ candidates: { id, name, owner, fromClass, toClass, moved, kept }[], applied: string[], failed: { id, error }[] }>`.

- [ ] **Step 1: Write the failing integration test**

Create `test/upgrade-converted-aspirant-classes.integration.test.js`:

```js
// Local-Supabase coverage for scripts/upgrade-converted-aspirant-classes.js:
// only Aspirant characters left on a forked Advent class are selected, a dry
// run writes nothing, and --apply is idempotent.
require('../util/require-local-supabase');

const { test, expect, beforeAll, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('../models/_base');
const { statList } = require('../util/enclave-consts');
const { createAuthUserAndProfile } = require('./helpers/auth-user-fixture');
const { upgradeConvertedCharacters } = require('../scripts/upgrade-converted-aspirant-classes');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});
const STATS = Object.fromEntries(statList.map(stat => [stat, 1]));
const TRAITS = [{ name: 'Brave', stat: 'might' }, { name: 'Clever', stat: 'intelligence' }, { name: 'Lucky', stat: 'luck' }];

let authUserId;
let profile;
const classes = {};
const characters = {};

const insertClass = async (row) => {
  const { data, error } = await supabaseAdmin.from('classes')
    .insert({ is_public: true, advanced_abilities: [], ...row })
    .select()
    .single();
  if (error) throw error;
  return data;
};

const createAspirantCharacter = async ({ cls, name, gear, abilities, perks }) => {
  const { data, error } = await supabaseAdmin.rpc('save_character_atomic', {
    p_character_id: null,
    p_creator_id: profile.id,
    p_character: {
      ...STATS, creator_id: profile.id, name, class: cls.name, class_id: cls.id,
      creator_mode: 'aspirant', level: 1, completed_missions: 0, commissary_reward: 0
    },
    p_traits: TRAITS,
    p_gear: gear,
    p_abilities: abilities,
    p_perks: perks
  });
  if (error) throw error;
  return data.id;
};

const snapshot = async () => {
  const ids = Object.values(characters);
  const query = async (sql) => (await db.query(sql, [ids])).rows;
  return {
    characters: await query('select id, class_id, class, creator_mode, updated_at from characters where id = any($1) order by id'),
    gear: await query('select id, class_id, name from class_gear where character_id = any($1) order by id'),
    abilities: await query('select id, class_id, name, type from class_abilities where character_id = any($1) order by id'),
    perks: await query('select id, class_ability_id, text from character_perks where character_id = any($1) order by id')
  };
};

const run = (apply) => upgradeConvertedCharacters({ apply, characterIds: Object.values(characters), log: () => {} });

beforeAll(async () => {
  await db.connect();
  ({ authUserId, profile } = await createAuthUserAndProfile(db, {
    email: `upgrade-converted-${suffix}@example.test`, profileName: `Upgrade ${suffix}`
  }));
  classes.legacy = await insertClass({
    name: `Up Gunslinger ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v2',
    gear: [{ name: 'Revolver' }, { name: 'Duster' }], abilities: [{ name: 'Trickshot' }]
  });
  classes.fork = await insertClass({
    name: `Up Gunslinger ${suffix}`, rules_edition: 'aspirant', content_format: 'aspirant', rules_version: 'v2',
    base_class_id: classes.legacy.id, gear: [{ name: 'Revolver' }], abilities: [{ name: 'Trickshot' }]
  });
  classes.loner = await insertClass({
    name: `Up Loner ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v2',
    gear: [{ name: 'Bedroll' }], abilities: []
  });

  // Converted before conversion upgraded the class.
  characters.converted = await createAspirantCharacter({
    cls: classes.legacy, name: `Converted ${suffix}`,
    gear: [{ name: 'Revolver', class_id: classes.legacy.id }, { name: 'Duster', class_id: classes.legacy.id }],
    abilities: [{ name: 'Trickshot', class_id: classes.legacy.id, type: 'core' }],
    perks: [{ ability_name: 'Trickshot', text: 'Off the wall.', position: 0 }]
  });
  // Created on the Aspirant version and bought an Advent Revolver: a choice.
  characters.chosen = await createAspirantCharacter({
    cls: classes.fork, name: `Chosen ${suffix}`,
    gear: [{ name: 'Revolver', class_id: classes.legacy.id }], abilities: [], perks: []
  });
  // An Aspirant character on an Advent class with no Aspirant version.
  characters.loner = await createAspirantCharacter({
    cls: classes.loner, name: `Loner ${suffix}`,
    gear: [{ name: 'Bedroll', class_id: classes.loner.id }], abilities: [], perks: []
  });
});

afterAll(async () => {
  if (profile?.id) await db.query('delete from characters where creator_id = $1', [profile.id]);
  if (profile?.id) await db.query('delete from profiles where id = $1', [profile.id]);
  for (const key of ['fork', 'legacy', 'loner']) {
    if (classes[key]?.id) await db.query('delete from classes where id = $1', [classes[key].id]);
  }
  if (authUserId) await db.query('delete from auth.users where id = $1', [authUserId]);
  await db.end();
});

test('the dry run lists only the converted character on a forked Advent class and writes nothing', async () => {
  const before = await snapshot();
  const report = await run(false);
  expect(report.candidates.map(candidate => candidate.id)).toEqual([characters.converted]);
  expect(report.candidates[0]).toMatchObject({
    name: `Converted ${suffix}`, owner: `Upgrade ${suffix}`, fromClass: classes.legacy.name, toClass: classes.fork.name
  });
  expect(report.candidates[0].moved.map(item => item.name).sort()).toEqual(['Revolver', 'Trickshot']);
  expect(report.candidates[0].kept.map(item => item.name)).toEqual(['Duster']);
  expect(report.applied).toEqual([]);
  expect(await snapshot()).toEqual(before);
});

test('--apply moves the class and matching rows, and a second run finds nothing', async () => {
  const report = await run(true);
  expect(report).toMatchObject({ applied: [characters.converted], failed: [] });

  const { rows: [row] } = await db.query('select class_id, creator_mode from characters where id = $1', [characters.converted]);
  expect(row).toEqual({ class_id: classes.fork.id, creator_mode: 'aspirant' });
  const { rows: gear } = await db.query(
    'select name, class_id from class_gear where character_id = $1 order by name', [characters.converted]
  );
  expect(gear).toEqual([
    { name: 'Duster', class_id: classes.legacy.id },
    { name: 'Revolver', class_id: classes.fork.id }
  ]);
  const { rows: perks } = await db.query(
    `select p.text, a.name, a.class_id from character_perks p join class_abilities a on a.id = p.class_ability_id
     where p.character_id = $1`, [characters.converted]
  );
  expect(perks).toEqual([{ text: 'Off the wall.', name: 'Trickshot', class_id: classes.fork.id }]);

  expect((await run(false)).candidates).toEqual([]);
});
```

Register it in `scripts/run-tests.mjs` `integrationFiles`: add `'test/upgrade-converted-aspirant-classes.integration.test.js',` right after `'routes/mcp-oauth.integration.test.js',`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test test/upgrade-converted-aspirant-classes.integration.test.js`
Expected: FAIL with `Cannot find module '../scripts/upgrade-converted-aspirant-classes'`.

- [ ] **Step 3: Write the script**

Create `scripts/upgrade-converted-aspirant-classes.js`:

```js
// One-time fix for characters converted to Aspirant before conversion moved
// them onto their class's Aspirant version. Default is read-only. Pass
// --apply only after reviewing the list.
const { supabaseAdmin } = require('../models/_base');
const characterRepository = require('../services/character/repository');
const { findAspirantFork } = require('../util/class-family');
const { upgradeBuild, upgradeSaveArgs } = require('../util/aspirant-conversion');

const PAGE_SIZE = 500;
const fetchAll = async (table, columns, query = q => q) => {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(supabaseAdmin.from(table).select(columns))
      .order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
};

const describeItems = (items) => items
  .map(item => `${item.kind} ${item.name}${item.className ? ` (${item.className})` : ''}`)
  .join(', ') || 'none';

const upgradeConvertedCharacters = async ({ apply = false, characterIds = null, log = console.log } = {}) => {
  const [characters, classesResult] = await Promise.all([
    fetchAll('characters', 'id, name, class_id, profile:creator_id(name)', (q) => {
      const converted = q.eq('creator_mode', 'aspirant');
      return characterIds ? converted.in('id', characterIds) : converted;
    }),
    characterRepository.getConversionClasses()
  ]);
  if (classesResult.error) throw new Error(`Failed to read classes: ${classesResult.error.message}`);
  const classes = classesResult.data;
  const classesById = new Map(classes.map(row => [row.id, row]));

  // Aspirant creation hides forked Advent classes (withoutForkedAdventClasses),
  // so an Aspirant character on one was converted, not created there.
  const selected = characters.filter((character) => {
    const own = classesById.get(character.class_id);
    return own && own.content_format === 'advent' && findAspirantFork(classes, own.id);
  });

  const report = { candidates: [], applied: [], failed: [] };
  for (const summary of selected) {
    const { data: character, error } = await characterRepository.getCharacter(summary.id);
    if (error || !character) {
      report.failed.push({ id: summary.id, error: error ? error.message : 'not found' });
      log(`${summary.id}: could not be read (${error ? error.message : 'not found'})`);
      continue;
    }
    const upgrade = upgradeBuild({
      character, classes, gear: character.gear, abilities: character.abilities, abilityPerks: character.ability_perks
    });
    const candidate = {
      id: character.id,
      name: character.name,
      owner: summary.profile ? summary.profile.name : null,
      fromClass: classesById.get(character.class_id).name,
      toClass: upgrade.target.name,
      moved: upgrade.moved,
      kept: upgrade.kept
    };
    report.candidates.push(candidate);
    log(`${candidate.id} ${candidate.name} (owner ${candidate.owner}): ${candidate.fromClass} -> ${candidate.toClass}`
      + ` [${upgrade.target.id}]; moves: ${describeItems(upgrade.moved)}; stays: ${describeItems(upgrade.kept)}`);
    if (!apply) continue;

    const { error: saveError } = await characterRepository.saveCharacterAtomic(upgradeSaveArgs({ character, upgrade }));
    if (saveError) {
      report.failed.push({ id: character.id, error: saveError.message });
      log(`  failed: ${saveError.message}`);
    } else {
      report.applied.push(character.id);
    }
  }

  log(`${selected.length} converted characters on a forked Advent class.`
    + (apply ? ` ${report.applied.length} upgraded, ${report.failed.length} failed.` : ' Read-only: nothing written.'));
  return report;
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) {
    throw new Error('Usage: bun scripts/upgrade-converted-aspirant-classes.js [--apply]');
  }
  const apply = args.includes('--apply');
  console.log(`Target: ${new URL(process.env.SUPABASE_URL).host} (${apply ? 'apply' : 'read-only'})`);
  const report = await upgradeConvertedCharacters({ apply });
  if (report.failed.length > 0) process.exitCode = 1;
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { upgradeConvertedCharacters };
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test test/upgrade-converted-aspirant-classes.integration.test.js`
Expected: 2 pass, 0 fail.

- [ ] **Step 5: Dry-run the CLI against the LOCAL stack only**

Run: `eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" bun scripts/upgrade-converted-aspirant-classes.js`

Expected:
- The first line is `Target: 127.0.0.1:54321 (read-only)`, followed by a summary line ending `Read-only: nothing written.`
- **If the host is anything else, stop at once.**
- **Never pass `--apply` from this plan.** Running it against production is the user's job (see Rollout).

- [ ] **Step 6: Commit**

```bash
git add scripts/upgrade-converted-aspirant-classes.js test/upgrade-converted-aspirant-classes.integration.test.js scripts/run-tests.mjs
git commit -m "feat: script to move previously converted characters onto their class's Aspirant version

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Whole-branch verification

**Files:** none (verification only).

- [ ] **Step 1: Baseline (run this once BEFORE Task 1, and record the result)**

Run: `git stash list` (it should be empty), then `bun run test:unit` and `bun run test:http`. Then run the integration tier using the command in Global Constraints. Write down every failing file and test name.

- [ ] **Step 2: Run every tier after Task 7**

Run: `bun run test:unit`
Expected: 0 failures.

Run: `bun run test:http`
Expected: only `routes/open-graph.test.js` fails.

Run: `eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun run test:integration`
Expected: only `util/character-content-integrity`, `util/class-form-round-trip` and `util/image-crop-integrity` fail, each with the same tests as in the baseline.

- [ ] **Step 3: Check that the replaced code is gone**

Run: `grep -rn "computeVersionFamily(classFamilyRows\|CONVERSION_FAMILY\|changes only the mode" models routes services util scripts test views`
Expected: no output.

Run: `grep -n "familyResolver = " services/character/service.js`
Expected: no output. The only definition is in `util/class-family.js`.

## Rollout (for the user, not an executor)

1. Merge. No migration.
2. With `.env` on production, run `bun scripts/upgrade-converted-aspirant-classes.js` and review the list. Each line shows the character, owner, class → Aspirant version, what moves and what stays.
3. Run `bun scripts/upgrade-converted-aspirant-classes.js --apply`. A second dry run should report 0.

## Self-review

- **Spec coverage (Part 2):**
  - Eligibility: unchanged `loadAspirantConversion` gate (Task 4 tests).
  - `findAspirantFork` and `ownClassIds`: Task 1.
  - Own-class sites:
    - `familyResolver`: Task 1.
    - `classItemResolver`: Task 2.
    - Route mappers: Task 2.
    - `ownClassIdsOf` via the resolver: Task 2 route test.
  - What conversion does (class, rows, Perks, mode, Traits, null lists): Tasks 3-4.
  - Blocking checklist and grandfathered breaches: Task 4 `planConversion`.
  - Signature Cap not enforced: Task 6 hoarder test.
  - Script: Task 7.
  - Panel copy: Task 5.
  - Error handling:
    - Not owner: Task 4 existing test.
    - Not eligible and blockers: existing tests.
    - Two forks: Tasks 1, 3 and 4.
    - Class read failure: Task 4.
    - Script continues after a failure: Task 7 code (`report.failed`, `continue`).
  - Testing list: every item maps to Tasks 1-7.
- **Type consistency:**
  - `upgradeBuild` returns `{ target, gear, abilities, abilityPerks, moved, kept }` in Tasks 3, 4, 5 and 7.
  - `upgradeSaveArgs({ character, upgrade })` is used the same way in Tasks 4 and 7.
  - `getConversionClasses()` returns `{ data, error }` in Tasks 4 and 7.
  - `Item.kind` is `'Signature' | 'Ability'` in Tasks 3 and 5.
