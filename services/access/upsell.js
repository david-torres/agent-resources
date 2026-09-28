const { CORE_CLASS_UNLOCKS, EDITION_LABELS, EDITION_UPSELL_BLURBS } = require('../../util/starter-content');
const { isLockedStatus } = require('./edition-status');

// One panel per locked edition, each a fixed pitch for that edition. Aspirant
// builds on Advent, so it is not pitched until Advent is unlocked.
const getEditionUpsell = (editionAccess) => {
  if (!editionAccess) return [];
  const adventLocked = isLockedStatus(editionAccess.advent);
  return Object.keys(CORE_CLASS_UNLOCKS)
    .filter(edition => isLockedStatus(editionAccess[edition]))
    .filter(edition => !(edition === 'aspirant' && adventLocked))
    .map(edition => ({ edition, label: EDITION_LABELS[edition], blurb: EDITION_UPSELL_BLURBS[edition] }));
};

module.exports = { getEditionUpsell };
