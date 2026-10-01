// Moves an Advent character onto the Aspirant rules, as a plan: the build it
// takes onto whichever Aspirant versions its owner can access, what blocks the
// move, and what it shows afterwards. Pure -- the caller loads everything and saves the result.
const { statList } = require('./enclave-consts');
const { deriveBuildBreaches, derivePerkBreakdown, deriveMerxBreakdown } = require('./character-derived');
const { validateTraits, validateStatLimits } = require('../services/character/input');
const { familyResolver } = require('./class-family');
const { aspirantTargetOf } = require('./class-lineage');
const { nameKey, duplicateNames } = require('./item-name');

const ASPIRANT = 'aspirant';

const CONVERSION_RULES = {
  traits: 'traits',
  statCap: 'stat-cap',
  duplicateAbility: 'duplicate-ability'
};

const GEAR_LISTS = [['gear', null]];
const ABILITY_LISTS = [['abilities', 'core'], ['advanced_abilities', 'advanced']];

const listOf = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

const findInCatalogue = (cls, lists, name) => {
  const key = nameKey(name);
  for (const [listKey, type] of lists) {
    const match = listOf(cls[listKey]).find(item => nameKey(item.name) === key);
    if (match) return { entry: match, type };
  }
  return null;
};

// Each row moves to the Aspirant target of its OWN class, so a cross-class
// item follows its donor. A row already on an Aspirant version, or whose class
// has no Aspirant version the owner can access, stays exactly as stored. The lists are null when
// no row moves, so the save leaves every row and its id alone.
const upgradeBuild = ({ character, classes, gear, abilities, abilityPerks, accessibleClassIds }) => {
  const catalogue = listOf(classes);
  const classesById = new Map(catalogue.map(row => [row.id, row]));
  const accessible = accessibleClassIds instanceof Set ? accessibleClassIds : new Set();
  const targets = new Map();
  const targetOf = (classId) => {
    if (!targets.has(classId)) {
      const target = aspirantTargetOf(catalogue, classId);
      targets.set(classId, target && accessible.has(target.id) ? target : null);
    }
    return targets.get(classId);
  };
  const moved = [];
  const kept = [];
  const upgradeRow = (row, kind, lists) => {
    const home = classesById.get(row.class_id) || null;
    const fork = home ? targetOf(home.id) : null;
    const match = fork ? findInCatalogue(fork, lists, row.name) : null;
    if (!match) {
      kept.push({ kind, name: row.name, className: home ? home.name : null });
      return null;
    }
    const name = String(match.entry.name).trim();
    moved.push({ kind, name, className: fork.name });
    return { classId: fork.id, name, description: match.entry.description ?? null, type: match.type };
  };

  const gearRows = listOf(gear).map((row) => {
    const move = upgradeRow(row, 'Signature', GEAR_LISTS);
    return {
      name: move ? move.name : row.name,
      class_id: move ? move.classId : row.class_id ?? null,
      description: move ? move.description : row.description ?? null,
      enchantment: row.enchantment ?? null,
      mods: Array.isArray(row.mods) ? row.mods : []
    };
  });

  // save_character_atomic re-inserts an Ability whose class or name changes,
  // and one with no class_id (it cannot pair it with its stored row); either
  // cascades the Perks away, so those Perks re-attach by ability_name alone.
  // Every Perk names its Ability: positions are numbered per Ability, and the
  // RPC scopes a compound's position to one Ability only through ability_name.
  const abilityNames = new Map();
  const reinsertedIds = new Set();
  const abilityRows = listOf(abilities).map((row) => {
    const move = upgradeRow(row, 'Ability', ABILITY_LISTS);
    abilityNames.set(row.id, move ? move.name : row.name);
    if (move || row.class_id == null) reinsertedIds.add(row.id);
    return move
      ? { name: move.name, class_id: move.classId, description: move.description, type: move.type }
      : { name: row.name, class_id: row.class_id ?? null, description: row.description ?? null, type: row.type ?? null };
  });
  const perkRows = listOf(abilityPerks).map(perk => ({
    class_ability_id: reinsertedIds.has(perk.class_ability_id) ? null : perk.class_ability_id,
    ability_name: abilityNames.get(perk.class_ability_id) ?? null,
    text: perk.text,
    position: perk.position,
    compounds_with: perk.compounds_with ?? null
  }));

  const target = targetOf(character.class_id ?? null);
  if (moved.length === 0) {
    return { target, gear: null, abilities: null, abilityPerks: null, moved, kept };
  }
  return { target, gear: gearRows, abilities: abilityRows, abilityPerks: perkRows, moved, kept };
};

// p_character names only the class, so every other column keeps its stored
// value, and a null list leaves those rows as they are. Traits are always
// resubmitted: save_character_atomic reads an absent Trait list as "no Traits".
const upgradeSaveArgs = ({ character, upgrade }) => ({
  characterId: character.id,
  creatorId: character.creator_id,
  character: upgrade.target ? { class_id: upgrade.target.id, class: upgrade.target.name } : {},
  traits: listOf(character.traits).map(({ name, stat }) => ({ name, stat })),
  gear: upgrade.gear,
  abilities: upgrade.abilities,
  perks: upgrade.abilityPerks
});

// save_character_atomic cannot store a build holding one Ability name twice
// (class_abilities_character_name_key).
const duplicateAbilityBlockers = ({ character, abilities }) => duplicateNames(listOf(abilities).map(row => row.name))
  .map(name => ({
    rule: CONVERSION_RULES.duplicateAbility,
    detail: `${character.name} has two Abilities named ${name}. Remove one to convert.`
  }));

// Judged under the aspirant economy on the upgraded build, with own class
// taken from the class the character lands on.
const planConversion = ({
  character, classes, gear, abilities, abilityPerks, traits, realMissions, offscreenMissions, accessibleClassIds
}) => {
  const upgrade = upgradeBuild({ character, classes, gear, abilities, abilityPerks, accessibleClassIds });
  const characterClassId = upgrade.target ? upgrade.target.id : (character.class_id ?? null);
  const classFamilyOf = familyResolver(classes, characterClassId);

  // The rules Aspirant enforces on every save, judged by the validators that
  // enforce them. Stat Cap only: the creation allotment and +++ ceiling are
  // creation rules (validateStatLimits).
  const blockers = [];
  const addBlockers = (rule, result) => {
    if (!result.ok) for (const detail of result.errors) blockers.push({ rule, detail });
  };
  addBlockers(CONVERSION_RULES.traits, validateTraits(traits, { economy: ASPIRANT }));
  addBlockers(CONVERSION_RULES.statCap, validateStatLimits({
    economy: ASPIRANT,
    stats: Object.fromEntries(statList.map(stat => [stat, character[stat]])),
    traits,
    capPurchases: character.stat_cap_purchases,
    enforceCreationAllotment: false
  }));
  blockers.push(...duplicateAbilityBlockers({ character, abilities: upgrade.abilities ?? abilities }));

  // The Ability cap and Perk deficit are grandfathered by the ratchet after
  // conversion, so they are reported, not blocking.
  const perkArgs = {
    economy: ASPIRANT,
    level: character.level,
    abilities: upgrade.abilities ?? abilities,
    abilityPerks,
    characterClassId,
    classFamilyOf
  };

  return {
    upgrade,
    blockers,
    breaches: deriveBuildBreaches(perkArgs),
    perkBreakdown: derivePerkBreakdown(perkArgs),
    merxBreakdown: deriveMerxBreakdown({
      realMissions,
      offscreenMissions,
      gear: upgrade.gear ?? gear,
      commonItems: character.common_items,
      characterClassId,
      economy: ASPIRANT,
      classFamilyOf
    })
  };
};

module.exports = { upgradeBuild, upgradeSaveArgs, planConversion, duplicateAbilityBlockers, CONVERSION_RULES };
