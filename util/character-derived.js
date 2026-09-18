const {
  v1LevelingSequence,
  v2LevelingSequence,
  MERX_PER_MISSION_SUCCESS
} = require('./enclave-consts');
const {
  equipmentSpend,
  priceOfSignature,
  COMMON_ITEM_PRICE,
  CREATION_GRANT
} = require('./merx-economy');

// Number of on-class Signatures Advent grants for free at creation (pg. 3's
// four Signature Items). The Aspirant editions replaced this gift with the
// CREATION_GRANT Merx grant, so only the advent branch still needs it.
const STARTING_ON_CLASS_GEAR_ALLOTMENT = 4;

const COUNTABLE_OUTCOMES = new Set(['success', 'failure']);

const deriveCompletedMissions = (realMissions, offscreenMissions) => {
  const real = Array.isArray(realMissions) ? realMissions : [];
  const offscreen = Array.isArray(offscreenMissions) ? offscreenMissions : [];
  const countedReal = real.filter(m => m && COUNTABLE_OUTCOMES.has(m.outcome)).length;
  return countedReal + offscreen.length;
};

const MAX_LEVEL = 10;

const deriveLevel = (completedMissions, rulesVersion) => {
  const seq = rulesVersion === 'v2' ? v2LevelingSequence : v1LevelingSequence;
  const total = Math.max(0, Number(completedMissions) || 0);
  let level = 1;
  let cumulative = 0;
  for (let i = 0; i < seq.length; i++) {
    cumulative += seq[i];
    if (total >= cumulative) {
      level = i + 2;
    } else {
      break;
    }
  }
  return Math.min(level, MAX_LEVEL);
};

const coerceMerx = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

// Advent grants four on-class Signatures at creation and charges for the rest;
// the Aspirant editions replaced that gift with a Merx grant (pg. 3), so every
// Signature is bought and the grant is income rather than a discount.
//
// It reads its two prices from the same table as the Aspirant branch because
// they are the same two numbers (2 on-class, 3 off-class) and always have been.
// If a future edition moves the Aspirant prices and Advent's must not follow,
// that is the moment to give Advent its own entries -- not now, when a second
// copy would only be a copy that can drift.
const adventGearSpend = (gearList, characterClassId) => {
  let onClassCount = 0;
  let offClassCount = 0;
  for (const g of gearList) {
    if (!g) continue;
    const onClass = !!characterClassId && !!g.class_id && g.class_id === characterClassId;
    if (onClass) onClassCount++;
    else offClassCount++;
  }
  const chargedOnClass = Math.max(0, onClassCount - STARTING_ON_CLASS_GEAR_ALLOTMENT);
  return chargedOnClass * priceOfSignature({ crossClass: false })
    + offClassCount * priceOfSignature({ crossClass: true });
};

const gearSpendFor = (economy, gearList, characterClassId) => (economy === 'advent'
  ? adventGearSpend(gearList, characterClassId)
  : equipmentSpend(gearList, { economy, characterClassId }));

const deriveMerxBreakdown = ({
  realMissions, offscreenMissions, gear, commonItems, characterClassId, economy = 'advent'
}) => {
  const real = Array.isArray(realMissions) ? realMissions : [];
  const offscreen = Array.isArray(offscreenMissions) ? offscreenMissions : [];
  const gearList = Array.isArray(gear) ? gear : [];
  const itemList = Array.isArray(commonItems) ? commonItems : [];

  const successes = real.filter(m => m && m.outcome === 'success').length;
  const earnedFromReal = successes * MERX_PER_MISSION_SUCCESS;
  const earnedFromOffscreen = offscreen.reduce((sum, om) => sum + coerceMerx(om && om.merx_gained), 0);
  const earned = CREATION_GRANT[economy] + earnedFromReal + earnedFromOffscreen;

  const itemSpend = itemList.length * COMMON_ITEM_PRICE;
  const spend = itemSpend + gearSpendFor(economy, gearList, characterClassId);

  return {
    earned,
    spend,
    reward: Math.max(0, earned - spend),
    deficit: Math.max(0, spend - earned)
  };
};

const deriveMerx = (args) => deriveMerxBreakdown(args).reward;

const deriveCharacterTotals = ({ character, realMissions, offscreenMissions, rulesVersion, economy }) => {
  const completed_missions = deriveCompletedMissions(realMissions, offscreenMissions);
  const merxParts = deriveMerxBreakdown({
    realMissions,
    offscreenMissions,
    gear: character && character.gear,
    commonItems: character && character.common_items,
    characterClassId: character && character.class_id,
    economy
  });
  const level = deriveLevel(completed_missions, rulesVersion);
  return {
    completed_missions,
    commissary_reward: merxParts.reward,
    merx_deficit: merxParts.deficit,
    level
  };
};

module.exports = {
  deriveCompletedMissions,
  deriveLevel,
  deriveMerx,
  deriveMerxBreakdown,
  deriveCharacterTotals
};
