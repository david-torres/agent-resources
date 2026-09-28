const { CORE_CLASS_UNLOCKS, EDITION_LABELS } = require('../../util/starter-content');
const classRepository = require('../class/repository');
const { getEffectiveClassUnlocks } = require('../../models/class');
const { lockedRosterIds } = require('../../util/class-filter');
const { isLockedStatus } = require('./edition-status');

// The row each roster name is shown by: an Aspirant name lists its
// pre-release parent first and the edition's own printing last.
const showcaseIds = (edition) => Object.values(CORE_CLASS_UNLOCKS[edition]).map(ids => ids[ids.length - 1]);

const defaultDeps = {
  classRowsByIds: (ids) => classRepository.classRowsByIds(ids),
  effectiveUnlocks: getEffectiveClassUnlocks
};

// One panel per locked edition; its classes are the public rows, ordered by
// name, minus any the viewer can already play (as the catalog's locked
// sections do).
const getEditionUpsell = async (editionAccess, userId, deps = defaultDeps) => {
  if (!editionAccess) return [];
  const editions = Object.keys(CORE_CLASS_UNLOCKS).filter(edition => isLockedStatus(editionAccess[edition]));
  if (editions.length === 0) return [];
  try {
    const access = await deps.effectiveUnlocks(userId);
    if (access.error) throw access.error;
    const locked = lockedRosterIds(editionAccess, access.rosterIdsByEdition, access.ids);
    return await Promise.all(editions.map(async (edition) => {
      const ids = showcaseIds(edition).filter(id => locked[edition]?.has(id));
      const { data, error } = await deps.classRowsByIds(ids);
      if (error) throw error;
      const classes = (data || []).map(({ id, name, teaser }) => ({ id, name, teaser: teaser || null }));
      return { edition, label: EDITION_LABELS[edition], count: classes.length, classes };
    }));
  } catch (err) {
    console.error('edition upsell lookup failed:', err);
    return [];
  }
};

module.exports = { getEditionUpsell };
