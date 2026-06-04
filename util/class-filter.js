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

module.exports = { filterClassListsByIds };
