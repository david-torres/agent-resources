// Filter character-form class option lists down to the user's unlocked set,
// matching by class id (NOT name — edition forks share names, and a v1
// unlock must not leak into another edition's fork).

const filterClassListsByIds = (lists, allowedIds) => {
  const filterArr = arr => (Array.isArray(arr) ? arr.filter(c => allowedIds.has(c.id)) : []);
  const advent = filterArr(lists.advent);
  const aspirant = filterArr(lists.aspirant);
  const pcc = filterArr(lists.pcc);
  // Surviving names drive the gear/ability lookup-map filtering downstream.
  const allowedNames = new Set([...advent, ...aspirant, ...pcc].map(c => c.name));
  return { advent, aspirant, pcc, allowedNames };
};

// The one released/PCC rule (spec: docs/superpowers/specs/
// 2026-08-17-class-list-partition-design.md): a PCC belongs in the PCC
// section only until it is released — on release it graduates into the
// official/released section.
const isUnreleasedPcc = (cls) => !!(cls && cls.is_player_created && cls.status !== 'release');

// Split a profile's public classes into the two sections shown on the profile
// view. A PCC that has been released (status='release') has been incorporated
// into the game, so it graduates into the official "released" section and drops
// out of the PCC section — no class appears in both.
const partitionProfileClasses = (classes) => {
  const list = Array.isArray(classes) ? classes : [];
  const released = [];
  const pcc = [];
  for (const cls of list) {
    (isUnreleasedPcc(cls) ? pcc : released).push(cls);
  }
  return { released, pcc };
};

// Same rule applied to the version-grouped shape from class-list-grouping.js:
// partitions an array of { primary, previous } groups by each group's primary.
const partitionClassGroups = (groups) => {
  const list = Array.isArray(groups) ? groups : [];
  const released = [];
  const pcc = [];
  for (const group of list) {
    (isUnreleasedPcc(group && group.primary) ? pcc : released).push(group);
  }
  return { released, pcc };
};

// The catalog keeps differently shaped cards out of the same grid. Artwork is
// release content and appears only for released classes covered by a book the
// viewer owns; official previews and PCCs remain deliberately art-free.
const partitionClassCatalog = (groups, bookClassIds = new Set()) => {
  const list = Array.isArray(groups) ? groups : [];
  const ownedReleases = [];
  const otherReleases = [];
  const prerelease = [];
  const pcc = [];
  for (const group of list) {
    const cls = group && group.primary;
    if (isUnreleasedPcc(cls)) pcc.push(group);
    else if (cls?.status !== 'release') prerelease.push(group);
    else if (bookClassIds.has(cls.id)) ownedReleases.push(group);
    else otherReleases.push(group);
  }
  return { ownedReleases, otherReleases, prerelease, pcc };
};

module.exports = { filterClassListsByIds, partitionProfileClasses, partitionClassGroups, partitionClassCatalog };
