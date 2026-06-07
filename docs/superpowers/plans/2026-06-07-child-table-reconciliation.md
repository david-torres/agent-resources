# Child-Table Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace delete-then-insert child-table saves (`traits`, `class_gear`, `class_abilities`, `character_perks`) with diff-based reconciliation so surviving rows keep their UUIDs and `created_at`.

**Architecture:** A pure diff function (`diffChildRows`) computes `{toInsert, toUpdate, toDelete}` via greedy multiset matching on natural keys; a pure link resolver (`resolveCompoundLinks`) handles perk `compounds_with` in a second pass. The four DB-coupled `setCharacterX` helpers in `models/character.js` become thin fetch → diff → apply wrappers sharing one `applyChildDiff` applier (inserts → updates → deletes, deletes last).

**Tech Stack:** Bun (runtime + `bun test`), CommonJS, supabase-js (`supabaseAdmin` client). No schema changes.

**Spec:** `docs/superpowers/specs/2026-06-07-child-table-reconciliation-design.md`

**Important repo facts for workers with zero context:**
- Run tests from the repo root: `cd /home/dave/code/agent-resources && bun test <file>` (full suite: `bun test`, ~285 tests, ~25s).
- The repo is CommonJS throughout: `require(...)` / `module.exports = {...}`.
- `models/character.js` already imports `supabaseAdmin` and contains the four helpers being rewritten plus `normalizeGearItems`, `normalizeAbilityItems`, `normalizeAbilityPerks`, and `buildClassContentLookupMaps` (imported from `./class`) — reuse them, do not reimplement.
- `updateCharacter` consumes `setCharacterAbilities`'s returned rows for perk remapping (`remapPerkAbilityIds` from `util/ability-perks.js`) — the abilities helper MUST return the full post-reconcile row set.
- Callers of the other three helpers only check `.error`; their `.data` shape is free.

---

### Task 1: `diffChildRows` pure diff core

**Files:**
- Create: `util/reconcile.js`
- Test: `util/reconcile.test.js`

- [ ] **Step 1: Write the failing tests**

Create `util/reconcile.test.js`:

```js
const { test, expect, describe } = require('bun:test');
const { diffChildRows } = require('./reconcile');

// Options used by the gear/abilities helpers: key = class_id + name,
// updatable field = description.
const OPTS = {
  keyOf: (r) => `${r.class_id}:${r.name}`,
  rowFields: (item) => ({ name: item.name, class_id: item.class_id, description: item.description ?? null })
};

const row = (id, name, class_id, description = null) => ({ id, name, class_id, description });
const item = (name, class_id, description) => ({ name, class_id, description });

describe('diffChildRows', () => {
  test('identical existing and desired produces an empty diff', () => {
    const existing = [row('r1', 'Strike', 'c1', 'hits hard')];
    const desired = [item('Strike', 'c1', 'hits hard')];

    expect(diffChildRows(existing, desired, OPTS)).toEqual({ toInsert: [], toUpdate: [], toDelete: [] });
  });

  test('changed field on a matched row produces an update with only the changed fields', () => {
    const existing = [row('r1', 'Strike', 'c1', 'old text')];
    const desired = [item('Strike', 'c1', 'new text')];

    expect(diffChildRows(existing, desired, OPTS)).toEqual({
      toInsert: [],
      toUpdate: [{ id: 'r1', description: 'new text' }],
      toDelete: []
    });
  });

  test('undefined desired field equals null stored field (no update)', () => {
    const existing = [row('r1', 'Strike', 'c1', null)];
    const desired = [{ name: 'Strike', class_id: 'c1' }]; // description omitted

    expect(diffChildRows(existing, desired, OPTS)).toEqual({ toInsert: [], toUpdate: [], toDelete: [] });
  });

  test('unmatched desired item becomes an insert carrying its rowFields', () => {
    const existing = [];
    const desired = [item('Guard', 'c1', 'blocks')];

    expect(diffChildRows(existing, desired, OPTS)).toEqual({
      toInsert: [{ name: 'Guard', class_id: 'c1', description: 'blocks' }],
      toUpdate: [],
      toDelete: []
    });
  });

  test('leftover existing rows become deletes (ids only)', () => {
    const existing = [row('r1', 'Strike', 'c1'), row('r2', 'Guard', 'c1')];
    const desired = [item('Strike', 'c1')];

    expect(diffChildRows(existing, desired, OPTS)).toEqual({ toInsert: [], toUpdate: [], toDelete: ['r2'] });
  });

  test('duplicate keys: two desired, one existing -> one matched, one inserted', () => {
    const existing = [row('r1', 'Medkit', 'c1')];
    const desired = [item('Medkit', 'c1'), item('Medkit', 'c1')];

    expect(diffChildRows(existing, desired, OPTS)).toEqual({
      toInsert: [{ name: 'Medkit', class_id: 'c1', description: null }],
      toUpdate: [],
      toDelete: []
    });
  });

  test('duplicate keys: one desired, two existing -> first kept (FIFO), second deleted', () => {
    const existing = [row('r1', 'Medkit', 'c1'), row('r2', 'Medkit', 'c1')];
    const desired = [item('Medkit', 'c1')];

    expect(diffChildRows(existing, desired, OPTS)).toEqual({ toInsert: [], toUpdate: [], toDelete: ['r2'] });
  });

  test('empty existing (create path) -> pure insert', () => {
    const desired = [item('Strike', 'c1', 'd1'), item('Guard', 'c1', 'd2')];

    expect(diffChildRows([], desired, OPTS)).toEqual({
      toInsert: [
        { name: 'Strike', class_id: 'c1', description: 'd1' },
        { name: 'Guard', class_id: 'c1', description: 'd2' }
      ],
      toUpdate: [],
      toDelete: []
    });
  });

  test('empty desired -> full delete', () => {
    const existing = [row('r1', 'Strike', 'c1'), row('r2', 'Guard', 'c1')];

    expect(diffChildRows(existing, [], OPTS)).toEqual({ toInsert: [], toUpdate: [], toDelete: ['r1', 'r2'] });
  });

  test('non-array inputs are treated as empty', () => {
    expect(diffChildRows(null, undefined, OPTS)).toEqual({ toInsert: [], toUpdate: [], toDelete: [] });
  });

  test('does not mutate inputs', () => {
    const existing = [row('r1', 'Strike', 'c1', 'old')];
    const desired = [item('Strike', 'c1', 'new'), item('Guard', 'c1')];
    const existingSnap = JSON.parse(JSON.stringify(existing));
    const desiredSnap = JSON.parse(JSON.stringify(desired));

    diffChildRows(existing, desired, OPTS);

    expect(existing).toEqual(existingSnap);
    expect(desired).toEqual(desiredSnap);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/dave/code/agent-resources && bun test util/reconcile.test.js`
Expected: FAIL — `error: Cannot find module './reconcile'`

- [ ] **Step 3: Write the implementation**

Create `util/reconcile.js`:

```js
// Diff-based reconciliation for character child tables (traits, class_gear,
// class_abilities, character_perks). Replaces delete-then-insert so surviving
// rows keep their UUIDs (and anything referencing them stays valid).
// See docs/superpowers/specs/2026-06-07-child-table-reconciliation-design.md.

// Desired items omit optional fields (undefined); the persisted value for an
// omitted field is null — treat them as equal.
const fieldEqual = (a, b) => (a ?? null) === (b ?? null);

/**
 * Greedy multiset diff between existing child rows and desired items.
 *
 * keyOf(rowOrItem)  -> natural-key string used for matching.
 * rowFields(item)   -> column values to persist (insert payload minus
 *                      character_id; also the fields compared for updates).
 *
 * Returns { toInsert, toUpdate, toDelete }:
 *   toInsert — rowFields() objects for unmatched desired items
 *   toUpdate — { id, ...changedFields } for matched rows that differ
 *   toDelete — ids of existing rows with no desired counterpart
 *
 * Duplicates need no special casing: existing rows queue FIFO per key, so two
 * identical desired items consume two existing rows (or insert the shortfall).
 */
function diffChildRows(existingRows, desiredItems, { keyOf, rowFields }) {
  const existing = Array.isArray(existingRows) ? existingRows : [];
  const desired = Array.isArray(desiredItems) ? desiredItems : [];

  const byKey = new Map();
  for (const row of existing) {
    const key = keyOf(row);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }

  const toInsert = [];
  const toUpdate = [];

  for (const item of desired) {
    const fields = rowFields(item);
    const queue = byKey.get(keyOf(item));
    const match = queue && queue.length > 0 ? queue.shift() : null;
    if (!match) {
      toInsert.push(fields);
      continue;
    }
    const changes = {};
    for (const [k, v] of Object.entries(fields)) {
      if (!fieldEqual(v, match[k])) changes[k] = v ?? null;
    }
    if (Object.keys(changes).length > 0) {
      toUpdate.push({ id: match.id, ...changes });
    }
  }

  const toDelete = [];
  for (const queue of byKey.values()) {
    for (const row of queue) toDelete.push(row.id);
  }

  return { toInsert, toUpdate, toDelete };
}

module.exports = { diffChildRows };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/dave/code/agent-resources && bun test util/reconcile.test.js`
Expected: PASS — 11 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add util/reconcile.js util/reconcile.test.js
git commit -m "feat: diffChildRows pure reconciliation core"
```

---

### Task 2: `resolveCompoundLinks` pure link resolver

**Files:**
- Modify: `util/reconcile.js` (append function + export)
- Test: `util/reconcile.test.js` (append describe block)

- [ ] **Step 1: Write the failing tests**

Append to `util/reconcile.test.js` (and add `resolveCompoundLinks` to the require on line 2: `const { diffChildRows, resolveCompoundLinks } = require('./reconcile');`):

```js
// Current character_perks rows as persisted (compounds_with is a row id or null).
const perkRow = (id, class_ability_id, position, compounds_with = null) =>
  ({ id, class_ability_id, position, compounds_with });
// Desired perks as normalized from the form (compounds_with is a
// 'position-N' sentinel, a row UUID from the agent/API path, or null).
const desiredPerk = (class_ability_id, position, compounds_with = null) =>
  ({ class_ability_id, position, text: 'x', compounds_with });

describe('resolveCompoundLinks', () => {
  test('resolves a position-N sentinel to the peer row id on the same ability', () => {
    const rows = [perkRow('p0', 'a1', 0), perkRow('p1', 'a1', 1)];
    const desired = [desiredPerk('a1', 0), desiredPerk('a1', 1, 'position-0')];

    expect(resolveCompoundLinks(desired, rows)).toEqual([{ id: 'p1', compounds_with: 'p0' }]);
  });

  test('keeps a UUID link that references a current row on the same ability', () => {
    const rows = [perkRow('p0', 'a1', 0), perkRow('p1', 'a1', 1)];
    const desired = [desiredPerk('a1', 0), desiredPerk('a1', 1, 'p0')];

    expect(resolveCompoundLinks(desired, rows)).toEqual([{ id: 'p1', compounds_with: 'p0' }]);
  });

  test('rejects a UUID link to a row on a different ability (clears stored link)', () => {
    const rows = [perkRow('p0', 'a1', 0), perkRow('p1', 'a2', 0, 'p0')];
    const desired = [desiredPerk('a1', 0), desiredPerk('a2', 0, 'p0')];

    expect(resolveCompoundLinks(desired, rows)).toEqual([{ id: 'p1', compounds_with: null }]);
  });

  test('rejects a self-referencing link', () => {
    const rows = [perkRow('p0', 'a1', 0, 'pX')];
    const desired = [desiredPerk('a1', 0, 'position-0')];

    expect(resolveCompoundLinks(desired, rows)).toEqual([{ id: 'p0', compounds_with: null }]);
  });

  test('clears a stale stored link when the desired perk has none', () => {
    const rows = [perkRow('p0', 'a1', 0), perkRow('p1', 'a1', 1, 'p0')];
    const desired = [desiredPerk('a1', 0), desiredPerk('a1', 1, null)];

    expect(resolveCompoundLinks(desired, rows)).toEqual([{ id: 'p1', compounds_with: null }]);
  });

  test('emits nothing when the stored link already matches', () => {
    const rows = [perkRow('p0', 'a1', 0), perkRow('p1', 'a1', 1, 'p0')];
    const desired = [desiredPerk('a1', 0), desiredPerk('a1', 1, 'position-0')];

    expect(resolveCompoundLinks(desired, rows)).toEqual([]);
  });

  test('skips desired perks with no surviving row', () => {
    const rows = [perkRow('p0', 'a1', 0)];
    const desired = [desiredPerk('a1', 0), desiredPerk('a9', 5, 'position-0')];

    expect(resolveCompoundLinks(desired, rows)).toEqual([]);
  });

  test('unresolvable sentinel clears the stored link', () => {
    const rows = [perkRow('p0', 'a1', 0, 'pX')];
    const desired = [desiredPerk('a1', 0, 'position-7')];

    expect(resolveCompoundLinks(desired, rows)).toEqual([{ id: 'p0', compounds_with: null }]);
  });

  test('non-array inputs are treated as empty', () => {
    expect(resolveCompoundLinks(null, undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/dave/code/agent-resources && bun test util/reconcile.test.js`
Expected: FAIL — `resolveCompoundLinks is not a function` (the diffChildRows tests still pass)

- [ ] **Step 3: Write the implementation**

Append to `util/reconcile.js` before `module.exports` and change the export line to `module.exports = { diffChildRows, resolveCompoundLinks };`:

```js
/**
 * Resolve desired compounds_with links against the current perk rows
 * (pass 2 of the perk save). Desired links are 'position-N' sentinels from
 * the form or row UUIDs from the agent/API path. A UUID is honored only if it
 * references a current row on the same ability; unresolvable or
 * self-referencing links become null.
 *
 * Returns [{ id, compounds_with }] — only rows whose stored link must change.
 */
function resolveCompoundLinks(desiredPerks, currentRows) {
  const desired = Array.isArray(desiredPerks) ? desiredPerks : [];
  const rows = Array.isArray(currentRows) ? currentRows : [];

  const byId = new Map(rows.map(r => [r.id, r]));
  const byKey = new Map(rows.map(r => [`${r.class_ability_id}:${r.position}`, r]));

  const updates = [];
  for (const perk of desired) {
    const row = byKey.get(`${perk.class_ability_id}:${perk.position}`);
    if (!row) continue; // perk's row was dropped; nothing to link

    let target = null;
    const link = perk.compounds_with;
    if (typeof link === 'string' && link.startsWith('position-')) {
      const pos = Number(link.slice('position-'.length));
      const candidate = byKey.get(`${perk.class_ability_id}:${pos}`);
      if (candidate) target = candidate.id;
    } else if (link) {
      const candidate = byId.get(link);
      if (candidate && candidate.class_ability_id === perk.class_ability_id) {
        target = candidate.id;
      }
    }
    if (target === row.id) target = null;

    if ((row.compounds_with ?? null) !== target) {
      updates.push({ id: row.id, compounds_with: target });
    }
  }
  return updates;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/dave/code/agent-resources && bun test util/reconcile.test.js`
Expected: PASS — 20 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add util/reconcile.js util/reconcile.test.js
git commit -m "feat: resolveCompoundLinks pure perk-link resolver"
```

---

### Task 3: shared applier + `setCharacterTraits` reconciliation

**Files:**
- Modify: `models/character.js` — add import, add `applyChildDiff`, rewrite `setCharacterTraits`

The DB-coupled helpers have no unit tests (they are thin wrappers over the tested pure functions); the full suite is the regression gate for each task from here on.

- [ ] **Step 1: Add the import**

In `models/character.js`, after the line `const { remapPerkAbilityIds } = require('../util/ability-perks');` add:

```js
const { diffChildRows, resolveCompoundLinks } = require('../util/reconcile');
```

- [ ] **Step 2: Add `applyChildDiff`**

Insert directly above the existing `setCharacterTraits` definition (search for `const setCharacterTraits = async`):

```js
// Apply a diffChildRows result: inserts -> updates -> deletes. Deletes run
// last and target only truly-removed row ids, so a mid-flight failure leaves
// extra rows rather than missing ones (never a mass delete).
const applyChildDiff = async (table, characterId, { toInsert, toUpdate, toDelete }) => {
  if (toInsert.length > 0) {
    const rows = toInsert.map(fields => ({ character_id: characterId, ...fields }));
    const { error } = await supabaseAdmin.from(table).insert(rows);
    if (error) {
      console.error(error);
      return { data: null, error };
    }
  }
  for (const { id: rowId, ...changes } of toUpdate) {
    const { error } = await supabaseAdmin.from(table).update(changes).eq('id', rowId);
    if (error) {
      console.error(error);
      return { data: null, error };
    }
  }
  if (toDelete.length > 0) {
    const { error } = await supabaseAdmin.from(table).delete().in('id', toDelete).eq('character_id', characterId);
    if (error) {
      console.error(error);
      return { data: null, error };
    }
  }
  return { data: true, error: null };
};
```

- [ ] **Step 3: Rewrite `setCharacterTraits`**

Replace the entire existing `setCharacterTraits` function (currently delete-all then insert) with:

```js
const setCharacterTraits = async (id, traits) => {
  // Internal helper: authz is enforced by the calling function (createCharacter/updateCharacter).
  const { data: existing, error: fetchError } = await supabaseAdmin.from('traits').select('*').eq('character_id', id);
  if (fetchError) {
    console.error(fetchError);
    return { data: null, error: fetchError };
  }

  const desired = (Array.isArray(traits) ? traits : []).map(name => ({ name }));
  const diff = diffChildRows(existing, desired, {
    keyOf: r => `${r.name}`,
    rowFields: item => ({ name: item.name })
  });
  return applyChildDiff('traits', id, diff);
};
```

(Callers only check `.error`; the `{ data: true }` shape from `applyChildDiff` is fine.)

- [ ] **Step 4: Run the full suite**

Run: `cd /home/dave/code/agent-resources && bun test`
Expected: PASS — 305 pass (285 existing + 20 from Tasks 1–2), 0 fail

- [ ] **Step 5: Commit**

```bash
git add models/character.js
git commit -m "refactor: reconcile traits instead of delete-then-insert"
```

---

### Task 4: `setCharacterGear` reconciliation

**Files:**
- Modify: `models/character.js` — rewrite `setCharacterGear`

- [ ] **Step 1: Rewrite `setCharacterGear`**

Replace the entire existing `setCharacterGear` function with (preserves the existing normalization, class_id resolution, and missing-class_id error message exactly):

```js
const setCharacterGear = async (id, gear) => {
  const normalizedGear = normalizeGearItems(gear);

  // Internal helper: authz is enforced by the calling function (createCharacter/updateCharacter).
  const { data: existing, error: fetchError } = await supabaseAdmin.from('class_gear').select('*').eq('character_id', id);
  if (fetchError) {
    return { data: null, error: fetchError };
  }

  const desired = [];
  if (normalizedGear.length > 0) {
    const { gearNameToClassId, gearNameToDescription } = await buildClassContentLookupMaps();
    for (const item of normalizedGear) {
      const clsId = item.class_id ?? gearNameToClassId.get(item.name);
      if (!clsId) {
        const errorMessage = `[setCharacterGear] Missing class_id for gear item "${item.name}"`;
        console.error(errorMessage, { characterId: id, item });
        return { data: null, error: errorMessage };
      }
      const desc = item.description ?? gearNameToDescription.get(item.name);
      desired.push({ name: item.name, class_id: clsId, description: desc || null });
    }
  }

  const diff = diffChildRows(existing, desired, {
    keyOf: r => `${r.class_id}:${r.name}`,
    rowFields: item => ({ name: item.name, class_id: item.class_id, description: item.description })
  });
  return applyChildDiff('class_gear', id, diff);
};
```

Note: `desc || null` (not `?? null`) matches the old behavior where a falsy description was omitted from the insert and therefore stored as NULL.

- [ ] **Step 2: Run the full suite**

Run: `cd /home/dave/code/agent-resources && bun test`
Expected: PASS — 305 pass, 0 fail

- [ ] **Step 3: Commit**

```bash
git add models/character.js
git commit -m "refactor: reconcile class_gear instead of delete-then-insert"
```

---

### Task 5: `setCharacterAbilities` reconciliation

**Files:**
- Modify: `models/character.js` — rewrite `setCharacterAbilities`

This is the helper whose row ids `character_perks` references. After this task, kept abilities retain their UUIDs across saves, so the form's perk references stay valid and the `ON DELETE CASCADE` into `character_perks` fires only for abilities the user actually removed.

- [ ] **Step 1: Rewrite `setCharacterAbilities`**

Replace the entire existing `setCharacterAbilities` function with:

```js
const setCharacterAbilities = async (id, abilities) => {
  const normalizedAbilities = normalizeAbilityItems(abilities);

  // Internal helper: authz is enforced by the calling function (createCharacter/updateCharacter).
  const { data: existing, error: fetchError } = await supabaseAdmin.from('class_abilities').select('*').eq('character_id', id);
  if (fetchError) {
    return { data: null, error: fetchError };
  }

  const desired = [];
  if (normalizedAbilities.length > 0) {
    const { abilityNameToClassId, abilityNameToDescription } = await buildClassContentLookupMaps();
    for (const item of normalizedAbilities) {
      const clsId = item.class_id ?? abilityNameToClassId.get(item.name);
      if (!clsId) {
        const errorMessage = `[setCharacterAbilities] Missing class_id for ability "${item.name}"`;
        console.error(errorMessage, { characterId: id, item });
        return { data: null, error: errorMessage };
      }
      const desc = item.description ?? abilityNameToDescription.get(item.name);
      desired.push({ name: item.name, class_id: clsId, description: desc || null });
    }
  }

  const diff = diffChildRows(existing, desired, {
    keyOf: r => `${r.class_id}:${r.name}`,
    rowFields: item => ({ name: item.name, class_id: item.class_id, description: item.description })
  });
  const { error: applyError } = await applyChildDiff('class_abilities', id, diff);
  if (applyError) {
    return { data: null, error: applyError };
  }

  // Return the full post-reconcile set (kept + inserted): updateCharacter
  // remaps the form's perk references against these rows.
  const { data: current, error: selError } = await supabaseAdmin.from('class_abilities').select('*').eq('character_id', id);
  if (selError) {
    return { data: null, error: selError };
  }
  return { data: current, error: null };
};
```

This also removes the now-dead `.select()`-on-insert comment path from the old implementation (the whole function body is replaced). Kept rows additionally preserve `essence_cost`/`cooldown`/`duration` column values that the old delete-then-insert wiped.

- [ ] **Step 2: Run the full suite**

Run: `cd /home/dave/code/agent-resources && bun test`
Expected: PASS — 305 pass, 0 fail (in particular `util/ability-perks.test.js` — the remap layer is unchanged and its "already-current id" branch now handles kept rows)

- [ ] **Step 3: Commit**

```bash
git add models/character.js
git commit -m "refactor: reconcile class_abilities, preserving row ids perks reference"
```

---

### Task 6: `setCharacterPerks` reconciliation (two-pass)

**Files:**
- Modify: `models/character.js` — rewrite `setCharacterPerks`

- [ ] **Step 1: Rewrite `setCharacterPerks`**

Replace the entire existing `setCharacterPerks` function (delete-all, two-pass insert, sentinel map) with:

```js
const setCharacterPerks = async (characterId, perks) => {
  const normalized = normalizeAbilityPerks(perks);

  // Internal helper: authz is enforced by the calling function (createCharacter/updateCharacter).
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('character_perks')
    .select('*')
    .eq('character_id', characterId);
  if (fetchError) {
    return { data: null, error: fetchError };
  }

  // Pass 1: reconcile rows on ability+position. compounds_with is resolved in
  // pass 2 against the surviving row set, so it is not part of the row diff
  // (inserts store it as NULL).
  const diff = diffChildRows(existing, normalized, {
    keyOf: r => `${r.class_ability_id}:${r.position}`,
    rowFields: p => ({ class_ability_id: p.class_ability_id, text: p.text, position: p.position })
  });
  const { error: applyError } = await applyChildDiff('character_perks', characterId, diff);
  if (applyError) {
    return { data: null, error: applyError };
  }

  // Pass 2: resolve compound links ('position-N' sentinels from the form,
  // row UUIDs from the agent/API path) against the current rows. With stable
  // ids a UUID may legitimately reference a kept row, which the old
  // inserted-rows-only check could not honor.
  const { data: current, error: selError } = await supabaseAdmin
    .from('character_perks')
    .select('*')
    .eq('character_id', characterId);
  if (selError) {
    return { data: null, error: selError };
  }

  const linkUpdates = resolveCompoundLinks(normalized, current);
  for (const u of linkUpdates) {
    const { error: updError } = await supabaseAdmin
      .from('character_perks')
      .update({ compounds_with: u.compounds_with })
      .eq('id', u.id);
    if (updError) {
      return { data: null, error: updError };
    }
  }

  return { data: current, error: null };
};
```

Notes for the worker:
- Deleting a perk that a kept perk's stored `compounds_with` references is safe: the FK is `ON DELETE SET NULL`, and pass 2 then re-resolves the desired link.
- Duplicate `(ability, position)` keys cannot come from the form (positions are max+1 per ability); if the agent/API path ever sends them, pass 1 reconciles them as a multiset and pass 2's last-wins map resolution is harmless.

- [ ] **Step 2: Run the full suite**

Run: `cd /home/dave/code/agent-resources && bun test`
Expected: PASS — 305 pass, 0 fail

- [ ] **Step 3: Commit**

```bash
git add models/character.js
git commit -m "refactor: reconcile character_perks with two-pass link resolution"
```

---

### Task 7: final verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm no delete-then-insert remains in the four helpers**

Run: `cd /home/dave/code/agent-resources && grep -n "delete().eq('character_id'" models/character.js`
Expected: NO matches inside `setCharacterTraits`, `setCharacterGear`, `setCharacterAbilities`, `setCharacterPerks` (a match elsewhere, e.g. `deleteCharacter` deleting the `characters` row itself, is fine — verify any hit is outside the four helpers).

- [ ] **Step 2: Full suite + parse check**

Run: `cd /home/dave/code/agent-resources && bun test && bun build --target=bun --no-bundle models/character.js > /dev/null && echo OK`
Expected: 305 pass, 0 fail, then `OK`

- [ ] **Step 3: Verify spec coverage**

Re-read `docs/superpowers/specs/2026-06-07-child-table-reconciliation-design.md` sections 1–5 and confirm each maps to landed code:
1. Pure diff core → `util/reconcile.js: diffChildRows` (Task 1)
2. Four helpers fetch → diff → apply with the spec's key/field table → Tasks 3–6
3. Perks two-pass → Task 6
4. `updateCharacter`/remap unchanged → no diff to `updateCharacter` in `git log -p` for this branch beyond Task 5's return-contract note
5. Error handling (deletes last, targeted ids) → `applyChildDiff` (Task 3)

- [ ] **Step 4: Commit (only if anything was fixed during verification)**

```bash
git status --short  # expect clean; if fixes were needed, commit them with a descriptive message
```
