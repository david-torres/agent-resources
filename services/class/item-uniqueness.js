const { computeVersionFamily } = require('../../util/class-family');

// Gear and Abilities are separate name spaces: a Signature and an Ability may
// share a name without ambiguity. Core and Advanced Abilities are ONE space,
// spanning two columns -- the Perk economy resolves a submitted ability's type
// from its name, and Core vs Advanced is the 1-vs-2 Perk difference
// (util/perk-economy.js), so a name that is Core for one class and Advanced for
// another has no single price.
const NAME_SPACES = [['gear'], ['abilities', 'advanced_abilities']];
const ITEM_FIELDS = NAME_SPACES.flat();

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
  // Deliberately narrower than util/class-family.js's sameFamilyEdge, which also
  // requires matching content_format: a format fork (e.g. a V1 class forked from
  // a pre-release Aspirant class) restates its parent's Signature and Ability
  // names verbatim by design, so it must inherit the parent's name space even
  // though it starts a new unlock/version family.
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
      if (!row.is_public || row.id === candidate.id || family.has(row.id)) continue;
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
