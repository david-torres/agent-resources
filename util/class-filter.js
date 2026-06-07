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

// Split a profile's public classes into the two sections shown on the profile
// view. A PCC that has been released (status='release') has been incorporated
// into the game, so it graduates into the official "released" section and drops
// out of the PCC section — no class appears in both.
const partitionProfileClasses = (classes) => {
  const list = Array.isArray(classes) ? classes : [];
  const released = [];
  const pcc = [];
  for (const cls of list) {
    if (cls.is_player_created && cls.status !== 'release') {
      pcc.push(cls);
    } else {
      released.push(cls);
    }
  }
  return { released, pcc };
};

module.exports = { filterClassListsByIds, partitionProfileClasses };
