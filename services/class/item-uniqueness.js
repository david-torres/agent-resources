// Gear and Abilities are separate name spaces: a Signature and an Ability may
// share a name without ambiguity. Core and Advanced Abilities are ONE space,
// spanning two columns -- the Perk economy resolves a submitted ability's type
// from its name, and Core vs Advanced is the 1-vs-2 Perk difference
// (util/perk-economy.js), so a name that is Core for one class and Advanced for
// another has no single price.
const NAME_SPACES = [['gear'], ['abilities', 'advanced_abilities']];
const ITEM_FIELDS = NAME_SPACES.flat();

const itemName = (item) => String(item?.name ?? '').trim();

// The whole base_class_id lineage, regardless of edition or format, shares one
// name space: an Aspirant or format fork deliberately restates its original's
// Signature and Ability names. A candidate being created has no row of its own
// yet, so its lineage is reached through its base_class_id.
const candidateLineage = (candidate, classRows) => {
  const lineage = new Set();
  const pending = [candidate.id, candidate.base_class_id].filter(Boolean);
  while (pending.length) {
    const id = pending.pop();
    if (lineage.has(id)) continue;
    lineage.add(id);
    for (const row of classRows) {
      if (row.base_class_id === id) pending.push(row.id);
      if (row.id === id && row.base_class_id) pending.push(row.base_class_id);
    }
  }
  return lineage;
};

// Only a public class outside the candidate's lineage may not repeat its names.
const findItemNameConflicts = ({ candidate, classRows, previous }) => {
  if (!candidate?.is_public) return [];
  const rows = Array.isArray(classRows) ? classRows : [];
  const lineage = candidateLineage(candidate, rows);

  const conflicts = [];
  for (const fields of NAME_SPACES) {
    // Names the class already stores are grandfathered, so a later squatter on
    // the same name cannot brick a row that was valid when it was written. The
    // set spans the whole space, so a class may promote a Core Ability to
    // Advanced between versions without tripping over its own name.
    const grandfathered = new Set(
      fields.flatMap(field => (previous?.[field] || []).map(itemName))
    );
    const owners = new Map();
    for (const row of rows) {
      if (!row.is_public || row.id === candidate.id || lineage.has(row.id)) continue;
      for (const field of fields) {
        for (const item of row[field] || []) {
          const name = itemName(item);
          if (name && !owners.has(name)) owners.set(name, row);
        }
      }
    }
    for (const field of fields) {
      for (const item of candidate[field] || []) {
        if (grandfathered.has(itemName(item))) continue;
        const owner = owners.get(itemName(item));
        if (owner) {
          conflicts.push({ field, name: itemName(item), ownerClassId: owner.id, ownerClassName: owner.name });
        }
      }
    }
  }
  return conflicts;
};

module.exports = { findItemNameConflicts, ITEM_FIELDS };
