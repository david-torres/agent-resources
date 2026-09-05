const { computeVersionFamily } = require('../../util/class-family');

const FIELDS = ['gear', 'abilities'];

const itemName = (item) => String(item?.name ?? '').trim();

// A candidate being created has no row of its own yet, so its family is
// reached through its base_class_id edge.
const candidateFamily = (candidate, classRows) => {
  const family = new Set();
  const collect = (id) => {
    for (const member of computeVersionFamily(classRows, id)) family.add(member);
  };
  if (candidate.id) collect(candidate.id);
  const parent = classRows.find(row => row.id === candidate.base_class_id);
  if (parent && parent.rules_edition === candidate.rules_edition) collect(parent.id);
  return family;
};

// A version family reuses item names freely across its v1 -> v2 forks; only a
// public class in a different family may not repeat them.
const findItemNameConflicts = ({ candidate, classRows, previous }) => {
  if (!candidate?.is_public) return [];
  const rows = Array.isArray(classRows) ? classRows : [];
  const family = candidateFamily(candidate, rows);

  const conflicts = [];
  for (const field of FIELDS) {
    // Names the class already stores are grandfathered, so a later squatter on
    // the same name cannot brick a row that was valid when it was written.
    const grandfathered = new Set((previous?.[field] || []).map(itemName));
    const owners = new Map();
    for (const row of rows) {
      if (!row.is_public || row.id === candidate.id || family.has(row.id)) continue;
      for (const item of row[field] || []) {
        const name = itemName(item);
        if (name && !owners.has(name)) owners.set(name, row);
      }
    }
    for (const item of candidate[field] || []) {
      if (grandfathered.has(itemName(item))) continue;
      const owner = owners.get(itemName(item));
      if (owner) {
        conflicts.push({ field, name: itemName(item), ownerClassId: owner.id, ownerClassName: owner.name });
      }
    }
  }
  return conflicts;
};

module.exports = { findItemNameConflicts };
