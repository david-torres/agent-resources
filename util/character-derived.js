const {
  v1LevelingSequence,
  v2LevelingSequence,
  MERX_PER_MISSION_SUCCESS,
  STARTING_ON_CLASS_GEAR_ALLOTMENT
} = require('./enclave-consts');

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

const COMMON_ITEM_COST = 1;
const GEAR_ON_CLASS_COST = 2;
const GEAR_OFF_CLASS_COST = 3;

const coerceMerx = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

const deriveMerxBreakdown = ({ realMissions, offscreenMissions, gear, commonItems, characterClassId }) => {
  const real = Array.isArray(realMissions) ? realMissions : [];
  const offscreen = Array.isArray(offscreenMissions) ? offscreenMissions : [];
  const gearList = Array.isArray(gear) ? gear : [];
  const itemList = Array.isArray(commonItems) ? commonItems : [];

  const successes = real.filter(m => m && m.outcome === 'success').length;
  const earnedFromReal = successes * MERX_PER_MISSION_SUCCESS;
  const earnedFromOffscreen = offscreen.reduce((sum, om) => sum + coerceMerx(om && om.merx_gained), 0);
  const earned = earnedFromReal + earnedFromOffscreen;

  const itemSpend = itemList.length * COMMON_ITEM_COST;
  // Count on-class and off-class gear separately so we can grant the
  // STARTING_ON_CLASS_GEAR_ALLOTMENT (creation gift) before charging merx.
  let onClassCount = 0;
  let offClassCount = 0;
  for (const g of gearList) {
    if (!g) continue;
    const onClass = !!characterClassId && !!g.class_id && g.class_id === characterClassId;
    if (onClass) onClassCount++;
    else offClassCount++;
  }
  const chargedOnClass = Math.max(0, onClassCount - STARTING_ON_CLASS_GEAR_ALLOTMENT);
  const gearSpend = chargedOnClass * GEAR_ON_CLASS_COST + offClassCount * GEAR_OFF_CLASS_COST;
  const spend = itemSpend + gearSpend;

  return {
    earned,
    spend,
    reward: Math.max(0, earned - spend),
    deficit: Math.max(0, spend - earned)
  };
};

const deriveMerx = (args) => deriveMerxBreakdown(args).reward;

const deriveCharacterTotals = ({ character, realMissions, offscreenMissions, rulesVersion }) => {
  const completed_missions = deriveCompletedMissions(realMissions, offscreenMissions);
  const merxParts = deriveMerxBreakdown({
    realMissions,
    offscreenMissions,
    gear: character && character.gear,
    commonItems: character && character.common_items,
    characterClassId: character && character.class_id
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
