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
 * Callers must build keys from parts that cannot contain the chosen separator;
 * in this codebase keys combine UUID class_id + name, which are colon-free.
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
      if (!fieldEqual(v, match[k])) changes[k] = v ?? null; // coerce undefined -> null for the DB write
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

module.exports = { diffChildRows, resolveCompoundLinks };
