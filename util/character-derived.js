const {
  MERX_PER_MISSION_SUCCESS
} = require('./enclave-consts');
const {
  equipmentSpend,
  sameFamily,
  priceOfSignature,
  COMMON_ITEM_PRICE,
  CREATION_GRANT
} = require('./merx-economy');
const {
  perkBreakdown,
  buildBreaches
} = require('./perk-economy');

// pg. 3's "three Default" Signatures, which an Advent character has without
// paying. The fourth item is the Elective, and it is paid for out of
// CREATION_GRANT.advent like anything else -- see util/merx-economy.js.
const ADVENT_DEFAULT_SIGNATURES = 3;

const COUNTABLE_OUTCOMES = new Set(['success', 'failure']);

const deriveCompletedMissions = (realMissions, offscreenMissions) => {
  const real = Array.isArray(realMissions) ? realMissions : [];
  const offscreen = Array.isArray(offscreenMissions) ? offscreenMissions : [];
  const countedReal = real.filter(m => m && COUNTABLE_OUTCOMES.has(m.outcome)).length;
  return countedReal + offscreen.length;
};

const { levelForCompletedMissions } = require('./character-leveling');
const deriveLevel = (completedMissions, mechanics) => levelForCompletedMissions(
  completedMissions, mechanics === 'v1' ? 'advent-v1' : mechanics === 'v2' ? 'advent-v2' : mechanics
);

const coerceMerx = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

// Advent grants three on-class Signatures free at creation (ADVENT_DEFAULT_
// SIGNATURES) and charges for the rest, including the fourth -- the Elective
// -- which is paid for out of CREATION_GRANT.advent rather than handed over
// free.
//
// It reads its two prices from the same table as the Aspirant branch because
// they are the same two numbers (2 on-class, 3 off-class) and always have been.
// If a future edition moves the Aspirant prices and Advent's must not follow,
// that is the moment to give Advent its own entries -- not now, when a second
// copy would only be a copy that can drift.
const adventGearSpend = (gearList, characterClassId, classFamilyOf) => {
  let onClassCount = 0;
  let offClassCount = 0;
  for (const g of gearList) {
    if (!g) continue;
    const onClass = !!characterClassId && sameFamily(g.class_id, characterClassId, classFamilyOf);
    if (onClass) onClassCount++;
    else offClassCount++;
  }
  const chargedOnClass = Math.max(0, onClassCount - ADVENT_DEFAULT_SIGNATURES);
  return chargedOnClass * priceOfSignature({ crossClass: false })
    + offClassCount * priceOfSignature({ crossClass: true });
};

const gearSpendFor = (economy, gearList, characterClassId, aspiringSignatures, classFamilyOf) => (economy === 'advent'
  ? adventGearSpend(gearList, characterClassId, classFamilyOf)
  : equipmentSpend(gearList, { economy, characterClassId, aspiringSignatures, classFamilyOf }));

// Merx a character has earned since creation: mission successes plus whatever
// each offscreen mission recorded. The creation grant is NOT part of it --
// that is an economy figure, added by whoever knows which economy applies, so
// a consumer that already holds the grants (the edit form's purchase surface,
// served util/merx-economy.js's figures) is not handed it twice.
const deriveMissionMerx = ({ realMissions, offscreenMissions } = {}) => {
  const real = Array.isArray(realMissions) ? realMissions : [];
  const offscreen = Array.isArray(offscreenMissions) ? offscreenMissions : [];
  // Aspirant p. 97: stakes apply to all characters, only on success,
  // and never multiply completed missions or level progress.
  const bonus = { conventional: 0, critical: 1, crisis: 3 };
  const earned = real.reduce((sum, mission) => {
    if (!mission || mission.outcome !== 'success') return sum;
    return sum + MERX_PER_MISSION_SUCCESS
      + (bonus[mission.difficulty] || 0) + (bonus[mission.danger] || 0);
  }, 0);
  return earned
    + offscreen.reduce((sum, om) => sum + coerceMerx(om && om.merx_gained), 0);
};

const deriveMerxBreakdown = ({
  realMissions, offscreenMissions, gear, commonItems, characterClassId,
  economy = 'advent', aspiringSignatures, classFamilyOf
}) => {
  const gearList = Array.isArray(gear) ? gear : [];
  const itemList = Array.isArray(commonItems) ? commonItems : [];

  const earned = CREATION_GRANT[economy]
    + deriveMissionMerx({ realMissions, offscreenMissions });

  const itemSpend = itemList.length * COMMON_ITEM_PRICE;
  const spend = itemSpend + gearSpendFor(economy, gearList, characterClassId, aspiringSignatures, classFamilyOf);

  return {
    earned,
    spend,
    reward: Math.max(0, earned - spend),
    deficit: Math.max(0, spend - earned)
  };
};

const deriveMerx = (args) => deriveMerxBreakdown(args).reward;

// An aspiring character's pool is matched on class_id AND name, the same pair
// util/merx-economy.js's inAspiringPool uses for Signatures.
const inAbilityPool = (ability, pool) => pool.some(
  (pick) => pick.class_id === ability.class_id && pick.name === ability.name
);

// Each ability reduced to what util/perk-economy.js prices: whether it is
// cross-class, and whether it is Core or Advanced. Resolving that is this
// module's job, not the economy module's -- the economy resolves no class and
// no pool.
//
// Cross-class is a VERSION FAMILY comparison, not a class_id one: an ability
// carried over from an earlier version of the character's own class is the
// same class, and 64 of the 88 differing-class_id rows in the live data are
// exactly that.
const tagAbilities = (abilities, { economy, characterClassId, aspiringAbilities, classFamilyOf } = {}) => {
  const list = (Array.isArray(abilities) ? abilities : []).filter(Boolean);
  if (economy === 'aspiring') {
    // An empty pool prices own-class rather than cross-class: a character
    // mid-creation has no pool yet and must not be told its first pick costs
    // the cross-class rate. Filter BEFORE measuring length -- checking an
    // unfiltered array is how the client and server disagreed about this rule
    // for Signatures.
    const pool = (Array.isArray(aspiringAbilities) ? aspiringAbilities : []).filter(Boolean);
    return list.map((ability) => ({
      crossClass: pool.length > 0 && !inAbilityPool(ability, pool),
      type: ability.type === 'advanced' ? 'advanced' : 'core'
    }));
  }
  return list.map((ability) => ({
    crossClass: !!characterClassId && !!ability.class_id
      && !sameFamily(ability.class_id, characterClassId, classFamilyOf),
    type: ability.type === 'advanced' ? 'advanced' : 'core'
  }));
};

const derivePerkBreakdown = ({
  economy, level, abilities, abilityPerks, characterClassId, aspiringAbilities, classFamilyOf
} = {}) => perkBreakdown({
  economy,
  level,
  abilities: tagAbilities(abilities, { economy, characterClassId, aspiringAbilities, classFamilyOf }),
  abilityPerks
});

const deriveBuildBreaches = ({
  economy, level, abilities, abilityPerks, characterClassId, aspiringAbilities, classFamilyOf
} = {}) => buildBreaches({
  economy,
  level,
  abilities: tagAbilities(abilities, { economy, characterClassId, aspiringAbilities, classFamilyOf }),
  abilityPerks
});

const deriveCharacterTotals = ({
  character, realMissions, offscreenMissions, mechanics, rulesVersion, economy, classFamilyOf
}) => {
  const completed_missions = deriveCompletedMissions(realMissions, offscreenMissions);
  const merxParts = deriveMerxBreakdown({
    realMissions,
    offscreenMissions,
    gear: character && character.gear,
    commonItems: character && character.common_items,
    characterClassId: character && character.class_id,
    aspiringSignatures: character && character.aspiring_signatures,
    economy,
    classFamilyOf
  });
  const level = deriveLevel(completed_missions, mechanics || rulesVersion);
  return {
    completed_missions,
    commissary_reward: merxParts.reward,
    merx_deficit: merxParts.deficit,
    level,
    // Derived for display, never persisted -- there is no perks column, by
    // design: a stored total can disagree with the rows it summarises.
    perks: derivePerkBreakdown({
      economy,
      level,
      abilities: character && character.abilities,
      abilityPerks: character && character.ability_perks,
      characterClassId: character && character.class_id,
      aspiringAbilities: character && character.aspiring_abilities,
      classFamilyOf
    })
  };
};

module.exports = {
  deriveCompletedMissions,
  deriveLevel,
  deriveMerx,
  deriveMissionMerx,
  deriveMerxBreakdown,
  deriveCharacterTotals,
  tagAbilities,
  derivePerkBreakdown,
  deriveBuildBreaches,
  ADVENT_DEFAULT_SIGNATURES
};
