// Printed ability/Signature meters, read the way the trackers need them.
const { test, expect } = require('bun:test');
const { levelsIn, parseUses, parseMeters, sourcesFor, MECHANICS } = require('./source-meters');

test('a cost is one level, or every level in a range; a trailing + is ignored', () => {
  expect(levelsIn('Mid')).toEqual(['Mid']);
  expect(levelsIn('Low–High')).toEqual(['Low', 'Mid', 'High']);
  expect(levelsIn('Mid–High+')).toEqual(['Mid', 'High']);
  expect(levelsIn('High+')).toEqual(['High']);
  expect(levelsIn('Varies')).toEqual([]);
  expect(levelsIn(undefined)).toEqual([]);
});

test('uses are exact counts, ranges capped at the top, or rating approximations', () => {
  expect(parseUses('3x')).toEqual({ label: '3x', max: 3 });
  expect(parseUses('2–4x')).toEqual({ label: '2–4x', max: 4 });
  expect(parseUses('Low')).toEqual({ label: 'Low', approx: 10 });
  expect(parseUses('Mid')).toEqual({ label: 'Mid', approx: 25 });
  expect(parseUses('High')).toEqual({ label: 'High', approx: 50 });
  expect(parseUses('lots')).toBeNull();
});

test('meters become cost options, a cooldown flag, uses, and the printed limiters to show', () => {
  const parsed = parseMeters([
    { label: 'Essence Cost', value: 'Low–Mid' },
    { label: 'Cooldown', value: 'Mid' },
    { label: 'Uses', value: '3x' },
    { label: 'Range', value: 'High' },
  ]);
  expect(parsed.essenceOptions).toEqual(['Low', 'Mid']);
  expect(parsed.staminaOptions).toEqual([]);
  expect(parsed.hasCooldown).toBe(true);
  expect(parsed.uses).toEqual({ label: '3x', max: 3 });
  expect(parsed.printed).toEqual([
    { label: 'Essence Cost', value: 'Low–Mid' },
    { label: 'Cooldown', value: 'Mid' },
    { label: 'Uses', value: '3x' },
  ]);
});

test('sources list abilities, then Signatures, then the fixed mechanics', () => {
  const sources = sourcesFor({
    abilities: [{ id: 'a1', name: 'Lightning Bolt', meters: [{ label: 'Essence Cost', value: 'Mid' }] }],
    gear: [{ id: 'g1', name: 'Thunder Hammer', meters: [] }],
  });
  expect(sources.slice(0, 2).map((s) => [s.key, s.kind])).toEqual([['ability:a1', 'Ability'], ['gear:g1', 'Signature']]);
  expect(sources.slice(2).map((s) => s.key)).toEqual(MECHANICS.map(([slug]) => `mechanic:${slug}`));
  expect(sourcesFor(null).every((s) => s.kind === 'Mechanic')).toBe(true);
});
