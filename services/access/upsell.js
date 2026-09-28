const { CORE_CLASS_UNLOCKS, EDITION_LABELS, EDITION_UPSELL_BLURBS } = require('../../util/starter-content');
const { isLockedStatus } = require('./edition-status');

// One panel per locked edition, each a fixed pitch for that edition.
const getEditionUpsell = (editionAccess) => {
  if (!editionAccess) return [];
  return Object.keys(CORE_CLASS_UNLOCKS)
    .filter(edition => isLockedStatus(editionAccess[edition]))
    .map(edition => ({ edition, label: EDITION_LABELS[edition], blurb: EDITION_UPSELL_BLURBS[edition] }));
};

module.exports = { getEditionUpsell };
