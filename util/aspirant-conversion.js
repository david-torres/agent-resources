// Moves an Advent character onto its class's Aspirant fork, as a plan: what
// the build becomes, what must change before it may, and what it will show
// afterwards. Pure -- the caller loads everything and saves the result.
const { computeVersionFamily } = require('./class-family');

const ASPIRANT = 'aspirant';

// A class's fork is the aspirant-format class whose parent sits in that
// class's version family, so every version of an Advent class reaches the
// same fork. The fork starts a family of its own (util/class-family.js),
// which is what keeps conversion one-way. Two forks of one family is
// catalogue data this cannot choose between: neither is offered.
const findAspirantFork = (classes, classId) => {
  if (!classId) return null;
  const rows = (Array.isArray(classes) ? classes : []).filter(Boolean);
  const family = computeVersionFamily(rows, classId);
  const forks = rows.filter(row => row.content_format === ASPIRANT
    && !family.has(row.id) && family.has(row.base_class_id));
  if (forks.length > 1) {
    console.warn(`[findAspirantFork] class ${classId} has ${forks.length} Aspirant forks: `
      + forks.map(row => row.id).join(', '));
  }
  return forks.length === 1 ? forks[0] : null;
};

module.exports = { findAspirantFork };
