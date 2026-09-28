const { CORE_CLASS_UNLOCKS, EDITION_LABELS } = require('../../util/starter-content');
const classRepository = require('../class/repository');
const { isLockedStatus } = require('./edition-status');

// The row each roster name is shown by: an Aspirant name lists its
// pre-release parent first and the edition's own printing last.
const showcaseIds = (edition) => Object.values(CORE_CLASS_UNLOCKS[edition]).map(ids => ids[ids.length - 1]);

const defaultDeps = { classRowsByIds: (ids) => classRepository.classRowsByIds(ids) };

// One panel per locked edition; its classes are the public rows, ordered by name.
const getEditionUpsell = async (editionAccess, deps = defaultDeps) => {
  if (!editionAccess) return [];
  const editions = Object.keys(CORE_CLASS_UNLOCKS).filter(edition => isLockedStatus(editionAccess[edition]));
  try {
    return await Promise.all(editions.map(async (edition) => {
      const { data, error } = await deps.classRowsByIds(showcaseIds(edition));
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
