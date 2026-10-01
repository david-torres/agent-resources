const { test, expect } = require('bun:test');
const { LEVEL_THRESHOLDS, levelForCompletedMissions, missionsRequiredForLevel, nextLevelProgress } = require('./character-leveling');
for (const [mechanics, thresholds] of Object.entries(LEVEL_THRESHOLDS)) {
  test(`${mechanics}: every cumulative threshold and its neighbors`, () => {
    thresholds.forEach((threshold, index) => {
      expect(missionsRequiredForLevel(index + 1, mechanics)).toBe(threshold);
      expect(levelForCompletedMissions(threshold, mechanics)).toBe(index + 1);
      expect(levelForCompletedMissions(threshold + 1, mechanics)).toBe(index + 1);
      if (index > 0) expect(levelForCompletedMissions(threshold - 1, mechanics)).toBe(index);
    });
    expect(levelForCompletedMissions(100000, mechanics)).toBe(10);
    expect(nextLevelProgress({ level: 10, completedMissions: 100000, mechanics })).toEqual({ targetLevel: null, requiredMissions: null, completedMissions: 100000, remainingMissions: 0, canLevelUp: false });
  });
}
test('next-level requirements use the chosen curve', () => {
  expect(nextLevelProgress({ level: 4, completedMissions: 11, mechanics: 'advent-v1' }).remainingMissions).toBe(3);
  expect(nextLevelProgress({ level: 4, completedMissions: 11, mechanics: 'advent-v2' }).canLevelUp).toBe(true);
});
test('invalid mechanics, counts and levels cannot silently select a curve', () => {
  for (const level of [0, 11, 2.5, undefined]) expect(() => missionsRequiredForLevel(level, 'advent-v1')).toThrow();
  for (const count of [-1, NaN, Infinity, 'invalid']) expect(() => levelForCompletedMissions(count, 'advent-v1')).toThrow();
  expect(() => levelForCompletedMissions(4, 'unknown')).toThrow();
});
