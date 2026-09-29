// Judges an Advent character as it would stand on the Aspirant rules: the
// same class and the same build, under the aspirant economy. Pure -- the
// caller loads everything, and conversion itself changes only the mode.
const { statList } = require('./enclave-consts');
const { deriveBuildBreaches, derivePerkBreakdown, deriveMerxBreakdown } = require('./character-derived');
const { validateTraits, validateStatLimits } = require('../services/character/input');

const ASPIRANT = 'aspirant';

const CONVERSION_RULES = {
  traits: 'traits',
  statCap: 'stat-cap'
};

// `classFamilyOf` maps every class in the character's own version family onto
// its class (CharacterService's familyResolver), so an Ability carried over
// from another version of that class is own-class, as it is on the sheet.
const planConversion = ({
  character, classFamilyOf, gear, abilities, abilityPerks, traits, realMissions, offscreenMissions
}) => {
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

  // The Ability cap and Perk deficit are grandfathered by the ratchet after
  // conversion, so they are reported, not blocking.
  const characterClassId = character.class_id ?? null;
  const perkArgs = {
    economy: ASPIRANT,
    level: character.level,
    abilities,
    abilityPerks,
    characterClassId,
    classFamilyOf
  };

  return {
    blockers,
    breaches: deriveBuildBreaches(perkArgs),
    perkBreakdown: derivePerkBreakdown(perkArgs),
    merxBreakdown: deriveMerxBreakdown({
      realMissions,
      offscreenMissions,
      gear,
      commonItems: character.common_items,
      characterClassId,
      economy: ASPIRANT
    })
  };
};

module.exports = { planConversion, CONVERSION_RULES };
