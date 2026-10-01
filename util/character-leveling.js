const MAX_LEVEL = 10;
const LEVEL_THRESHOLDS = Object.freeze({
  'advent-v1': Object.freeze([0, 2, 5, 9, 14, 20, 27, 35, 44, 54]),
  'advent-v2': Object.freeze([0, 2, 4, 7, 10, 14, 18, 23, 28, 34])
});
const thresholdsForMechanics = mechanics => {
  const thresholds = LEVEL_THRESHOLDS[mechanics];
  if (!thresholds) throw new Error(`Unsupported character mechanics: ${mechanics}`);
  return thresholds;
};
const missionCount = count => {
  const value = Number(count);
  if (!Number.isFinite(value) || value < 0) throw new Error('Completed missions must be nonnegative');
  return Math.floor(value);
};
const missionsRequiredForLevel = (level, mechanics) => {
  const thresholds = thresholdsForMechanics(mechanics);
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw new Error('Level must be between 1 and 10');
  return thresholds[level - 1];
};
const levelForCompletedMissions = (count, mechanics) => {
  const thresholds = thresholdsForMechanics(mechanics);
  const total = missionCount(count);
  let level = 1;
  while (level < MAX_LEVEL && total >= thresholds[level]) level++;
  return level;
};
const nextLevelProgress = ({ level, completedMissions, mechanics }) => {
  missionsRequiredForLevel(level, mechanics);
  const completed = missionCount(completedMissions);
  const targetLevel = level < MAX_LEVEL ? level + 1 : null;
  const requiredMissions = targetLevel === null ? null : missionsRequiredForLevel(targetLevel, mechanics);
  return { targetLevel, requiredMissions, completedMissions: completed,
    remainingMissions: requiredMissions === null ? 0 : Math.max(0, requiredMissions - completed),
    canLevelUp: targetLevel !== null && completed >= requiredMissions };
};
module.exports = { MAX_LEVEL, LEVEL_THRESHOLDS, thresholdsForMechanics, levelForCompletedMissions, missionsRequiredForLevel, nextLevelProgress };
