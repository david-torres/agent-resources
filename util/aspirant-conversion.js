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

const CONVERSION_RULES = {
  noFork: 'no-fork',
  noCounterpart: 'no-counterpart',
  traits: 'traits',
  statCap: 'stat-cap',
  signatureCap: 'signature-cap'
};

// A character row and a class's JSONB are written by different paths, so
// names are compared trimmed and case-folded; the fork's own spelling is what
// gets written, so the next save resolves it against the same catalogue.
const nameKey = (value) => String(value ?? '').trim().toLowerCase();

const GEAR_LISTS = [['gear', null]];
const ABILITY_LISTS = [['abilities', 'core'], ['advanced_abilities', 'advanced']];

const findInCatalogue = (cls, lists, name) => {
  const key = nameKey(name);
  for (const [listKey, type] of lists) {
    const entry = (Array.isArray(cls[listKey]) ? cls[listKey] : [])
      .find(item => item && nameKey(item.name) === key);
    if (entry) return { entry, type };
  }
  return null;
};

// Each row moves to the fork of ITS OWN class, so a cross-class item follows
// its donor class rather than the character. A row already on an
// aspirant-format class is Aspirant content and stays where it is.
const remapRows = (rows, { lists, classesById, forkOf, blockers }) => (Array.isArray(rows) ? rows : [])
  .filter(row => row && row.name)
  .map((row) => {
    const home = classesById.get(row.class_id) || null;
    if (home && home.content_format === ASPIRANT) {
      return { row, classId: row.class_id, name: row.name, description: row.description ?? null, type: row.type };
    }
    const itemName = String(row.name).trim();
    const fork = forkOf(row.class_id);
    if (!fork) {
      blockers.push({
        rule: CONVERSION_RULES.noFork,
        detail: home
          ? `${itemName} comes from ${home.name}, which has no Aspirant version. Remove it to convert.`
          : `${itemName} comes from a class no longer in the catalogue. Remove it to convert.`
      });
      return null;
    }
    const match = findInCatalogue(fork, lists, row.name);
    if (!match) {
      blockers.push({
        rule: CONVERSION_RULES.noCounterpart,
        detail: `${itemName} (${home.name}) has no Aspirant version. Remove it to convert.`
      });
      return null;
    }
    return {
      row,
      classId: fork.id,
      name: String(match.entry.name).trim(),
      description: match.entry.description ?? null,
      type: match.type
    };
  })
  .filter(Boolean);

const planConversion = ({ character, classes, gear, abilities, abilityPerks }) => {
  const rows = (Array.isArray(classes) ? classes : []).filter(Boolean);
  const classesById = new Map(rows.map(row => [row.id, row]));
  const target = findAspirantFork(rows, character.class_id);
  if (!target) {
    const own = classesById.get(character.class_id);
    return {
      target: null,
      gear: [],
      abilities: [],
      abilityPerks: [],
      blockers: [{
        rule: CONVERSION_RULES.noFork,
        detail: `${own ? own.name : character.class || 'This class'} has no Aspirant version.`
      }]
    };
  }

  const forks = new Map();
  const forkOf = (classId) => {
    if (!forks.has(classId)) forks.set(classId, findAspirantFork(rows, classId));
    return forks.get(classId);
  };
  const blockers = [];

  const convertedGear = remapRows(gear, { lists: GEAR_LISTS, classesById, forkOf, blockers })
    .map(({ row, classId, name, description }) => ({
      name,
      class_id: classId,
      description,
      enchantment: row.enchantment ?? null,
      mods: Array.isArray(row.mods) ? row.mods : []
    }));

  const abilityMoves = remapRows(abilities, { lists: ABILITY_LISTS, classesById, forkOf, blockers });
  const convertedAbilities = abilityMoves.map(({ classId, name, description, type }) => ({
    name, class_id: classId, description, type: type === 'advanced' ? 'advanced' : 'core'
  }));

  // Moving an Ability to a fork deletes and re-inserts its row, which
  // cascades its Perks away; save_character_atomic re-attaches a Perk
  // submitted by `ability_name` to the re-inserted row, and resolves its
  // `position-<n>` compound link on that same Ability afterwards -- the same
  // payload CharacterService#saveCharacterAtomic builds for a v2 edit.
  const abilityNameById = new Map(abilityMoves.map(({ row, name }) => [row.id, name]));
  const convertedPerks = (Array.isArray(abilityPerks) ? abilityPerks : [])
    .filter(perk => perk && abilityNameById.has(perk.class_ability_id))
    .map(perk => ({
      class_ability_id: null,
      ability_name: abilityNameById.get(perk.class_ability_id),
      text: perk.text,
      position: perk.position,
      compounds_with: perk.compounds_with ?? null
    }));

  return {
    target,
    gear: convertedGear,
    abilities: convertedAbilities,
    abilityPerks: convertedPerks,
    blockers
  };
};

module.exports = { findAspirantFork, planConversion, CONVERSION_RULES };
