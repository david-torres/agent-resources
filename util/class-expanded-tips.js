const { normalizeNote, indexedRows } = require('./class-gear');

// The Expanded Tips page is a per-class section separate from the cover's Quick
// Tips, with one list addressed to the player and one to the Conduit
// (ENCLAVE: Aspirant, pg. 11). Both keys are always present so the column has
// one shape, the way advanced_abilities is always an array.
const TIP_AUDIENCES = ['player', 'conduit'];

const normalizeExpandedTips = (value) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(TIP_AUDIENCES.map((audience) => [
    audience,
    indexedRows(source[audience]).map(normalizeNote).filter(Boolean)
  ]));
};

module.exports = { normalizeExpandedTips, TIP_AUDIENCES };
