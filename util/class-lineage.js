// A lineage is an Advent version family plus the family of its Aspirant
// version (util/class-family.js#findAspirantFork); a class with no Aspirant
// version is its own lineage. Aspirant shops sell each item name once per
// lineage.
const { computeVersionFamily, findAspirantFork, ownClassIds } = require('./class-family');
const { latestClassVersions } = require('./class-list-grouping');
const { nameKey } = require('./item-name');

const ASPIRANT = 'aspirant';

const listOf = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

// The newest version in the family of a class's Aspirant fork: the one card
// the class list shows for that family.
const aspirantTargetOf = (classes, classId) => {
  const fork = findAspirantFork(classes, classId);
  if (!fork) return null;
  const family = computeVersionFamily(classes, fork.id);
  return latestClassVersions(classes.filter(row => family.has(row.id)))[0];
};

// An Advent family with two Aspirant versions joins neither: findAspirantFork
// does not choose between them.
const lineageMembers = (classes, classId) => {
  const row = classes.find(c => c.id === classId);
  if (!row) return new Set([classId]);
  if (row.content_format !== ASPIRANT) {
    const fork = findAspirantFork(classes, classId);
    return fork ? ownClassIds(classes, fork.id) : computeVersionFamily(classes, classId);
  }
  const lineage = ownClassIds(classes, classId);
  const origin = classes.find(c => lineage.has(c.id) && c.content_format !== ASPIRANT);
  const originFork = origin ? findAspirantFork(classes, origin.id) : null;
  return originFork && lineage.has(originFork.id) ? lineage : computeVersionFamily(classes, classId);
};

const lineageIdOf = (classes, classId) => [...lineageMembers(listOf(classes), classId)].sort()[0];

// Each Signature and Ability name once per lineage, taken from the first
// class that prints it: the character's own class (its stored version), then
// the newest Aspirant version, then the newest Advent version.
const lineageCatalogue = (classes, { ownClassId = null } = {}) => {
  const all = listOf(classes);
  const rows = latestClassVersions(all, { keep: [ownClassId] });
  const source = (row) => (row.id === ownClassId ? 0 : row.content_format === ASPIRANT ? 1 : 2);
  const ordered = rows.map((row, index) => ({ row, index }))
    .sort((a, b) => source(a.row) - source(b.row) || a.index - b.index);

  const printed = new Map();
  const pruned = new Map();
  for (const { row } of ordered) {
    const lineageId = lineageIdOf(all, row.id);
    if (!printed.has(lineageId)) printed.set(lineageId, { gear: new Set(), abilities: new Set() });
    const seen = printed.get(lineageId);
    const unseen = (names) => (item) => {
      if (!item.name) return false;
      const key = nameKey(item.name);
      if (names.has(key)) return false;
      names.add(key);
      return true;
    };
    pruned.set(row.id, {
      ...row,
      lineage_id: lineageId,
      gear: listOf(row.gear).filter(unseen(seen.gear)),
      abilities: listOf(row.abilities).filter(unseen(seen.abilities)),
      advanced_abilities: listOf(row.advanced_abilities).filter(unseen(seen.abilities))
    });
  }
  return rows.map(row => pruned.get(row.id));
};

// The classes an edit-page purchase island sells from. The own class is
// added when the roster lacks it (a lapsed unlock), so it still comes first.
const purchaseCatalogue = ({ economy, classes, characterClass }) => {
  const rows = listOf(classes);
  if (economy === 'aspiring') return latestClassVersions(rows);
  if (economy !== ASPIRANT) return [];
  const ownClassId = characterClass ? characterClass.id : null;
  const withOwn = characterClass && !rows.some(row => row.id === ownClassId) ? [...rows, characterClass] : rows;
  return lineageCatalogue(withOwn, { ownClassId });
};

module.exports = { aspirantTargetOf, lineageIdOf, lineageCatalogue, purchaseCatalogue };
