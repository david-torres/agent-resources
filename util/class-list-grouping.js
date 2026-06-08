// Collapse a flat list of classes into version-family groups for the list page.
// Operates ONLY on the rows passed in (the viewer's accessible/filtered set),
// so we never surface a version the viewer can't see and a chain with a missing
// intermediate naturally splits. Family membership reuses the same-edition
// base_class_id adjacency from class-family.js.

const { computeVersionFamily } = require('./class-family');

// Pick the family leaf: the member with no same-edition child present in the
// group. Ties (branches) and "no clear leaf" resolve to the newest created_at.
const pickPrimary = (members) => {
  const ids = new Set(members.map(c => c.id));
  const hasInGroupChild = new Set();
  for (const c of members) {
    if (c.base_class_id && ids.has(c.base_class_id)) {
      const parent = members.find(m => m.id === c.base_class_id);
      if (parent && parent.rules_edition === c.rules_edition) {
        hasInGroupChild.add(c.base_class_id);
      }
    }
  }
  const leaves = members.filter(c => !hasInGroupChild.has(c.id));
  const candidates = leaves.length > 0 ? leaves : members;
  return candidates.slice().sort(byCreatedAtDesc)[0];
};

const byCreatedAtDesc = (a, b) =>
  new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();

// classes: array of full class rows (need id, base_class_id, rules_edition,
// created_at). Returns ordered array of { primary, previous }, group order
// following first appearance of each family among the input rows.
const groupClassVersions = (classes) => {
  const rows = Array.isArray(classes) ? classes.filter(c => c && c.id) : [];
  const byId = new Map(rows.map(c => [c.id, c]));
  const seen = new Set();
  const groups = [];

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    // Family restricted to in-list rows.
    const familyIds = computeVersionFamily(rows, row.id);
    const members = [];
    for (const fid of familyIds) {
      if (byId.has(fid)) {
        members.push(byId.get(fid));
        seen.add(fid);
      }
    }
    const primary = pickPrimary(members);
    const previous = members
      .filter(c => c.id !== primary.id)
      .sort(byCreatedAtDesc);
    groups.push({ primary, previous });
  }

  return groups;
};

module.exports = { groupClassVersions };
