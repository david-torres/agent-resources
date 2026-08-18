// Book-derived class unlocks: holding a rules PDF grants the core class
// roster of that book's ruleset. Pure — the DB lookup that produces the
// ruleset list lives in services/rules/repository.js.

const { CORE_CLASS_UNLOCKS } = require('./starter-content');

// editions: iterable of ruleset strings ('advent' | 'aspirant').
// Returns Set of class ids granted by holding books in those rulesets.
// Unknown rulesets contribute nothing.
const coreClassIdsForEditions = (editions) => {
  const ids = new Set();
  for (const edition of editions || []) {
    const roster = CORE_CLASS_UNLOCKS[edition];
    if (!roster) continue;
    for (const id of Object.values(roster)) ids.add(id);
  }
  return ids;
};

module.exports = { coreClassIdsForEditions };
