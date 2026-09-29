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

// Index the class graph once so repeated family walks don't rebuild the
// maps per id — expandIdsToFamilies runs one walk per unlocked id.
const buildFamilyIndex = (classes) => {
  const rows = Array.isArray(classes) ? classes.filter(c => c && c.id) : [];
  const byId = new Map(rows.map(c => [c.id, c]));

  // Pre-index same-family children so the BFS can walk down chains.
  const childrenOf = new Map();
  for (const c of rows) {
    if (!c.base_class_id) continue;
    const parent = byId.get(c.base_class_id);
    if (!parent || !sameFamilyEdge(parent, c)) continue;
    if (!childrenOf.has(parent.id)) childrenOf.set(parent.id, []);
    childrenOf.get(parent.id).push(c.id);
  }
  return { byId, childrenOf };
};

const familyFromIndex = ({ byId, childrenOf }, classId) => {
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
      if (parent && sameFamilyEdge(parent, node)) queue.push(parent.id);
    }
    for (const childId of childrenOf.get(id) || []) queue.push(childId);
  }
  return family;
};

// classes: array of { id, base_class_id, rules_edition, content_format }
// Returns Set of class ids in classId's version family (always includes classId).
const computeVersionFamily = (classes, classId) =>
  familyFromIndex(buildFamilyIndex(classes), classId);

// Expand a set of unlocked class ids to include every member of each id's
// version family.
const expandIdsToFamilies = (classes, ids) => {
  const index = buildFamilyIndex(classes);
  const expanded = new Set();
  for (const id of ids) {
    for (const member of familyFromIndex(index, id)) {
      expanded.add(member);
    }
  }
  return expanded;
};

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

module.exports = {
  computeVersionFamily, expandIdsToFamilies, findAspirantFork, ownClassIds, familyResolver
};
