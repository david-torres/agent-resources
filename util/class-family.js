// Version families: classes linked via base_class_id form an upgrade chain
// (v1 -> v2 forks). A family is the connected component over those links,
// restricted to edges where parent and child share rules_edition — edition
// forks (e.g. advent -> aspirant) start a new family. Unlocks apply to a
// whole family, so this must never cross an edition boundary.

const sameEditionEdge = (parent, child) => parent.rules_edition === child.rules_edition;

// classes: array of { id, base_class_id, rules_edition }
// Returns Set of class ids in classId's version family (always includes classId).
const computeVersionFamily = (classes, classId) => {
  const rows = Array.isArray(classes) ? classes.filter(c => c && c.id) : [];
  const byId = new Map(rows.map(c => [c.id, c]));

  // Pre-index same-edition children so the BFS can walk down chains.
  const childrenOf = new Map();
  for (const c of rows) {
    if (!c.base_class_id) continue;
    const parent = byId.get(c.base_class_id);
    if (!parent || !sameEditionEdge(parent, c)) continue;
    if (!childrenOf.has(parent.id)) childrenOf.set(parent.id, []);
    childrenOf.get(parent.id).push(c.id);
  }

  const family = new Set();
  const queue = [classId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (family.has(id)) continue; // visited guard also terminates cycles
    family.add(id);
    const node = byId.get(id);
    if (!node) continue;
    if (node.base_class_id) {
      const parent = byId.get(node.base_class_id);
      if (parent && sameEditionEdge(parent, node)) queue.push(parent.id);
    }
    for (const childId of childrenOf.get(id) || []) queue.push(childId);
  }
  return family;
};

module.exports = { computeVersionFamily };
