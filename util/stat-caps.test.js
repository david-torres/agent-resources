const { test, expect } = require('bun:test');
const {
  BASE_STAT_CAP, CREATION_STAT_CAP, CAP_INCREASE_PLUS_COST,
  CREATION_PLUSES, LEVEL_PLUSES_PER_LEVEL, TRAIT_COUNT, LEVEL_CEILING,
  statCapFor, normalizeLevel, plusAllotment, sumValues,
  capBreaches, creationCeilingBreaches
} = require('./stat-caps.js');

// Figures, each pinned so that changing it breaks a named test.
test('the book figures are what the book says', () => {
  expect(BASE_STAT_CAP).toBe(5);              // pg. 3, restated pg. 6
  expect(CREATION_STAT_CAP).toBe(3);          // Advent pg. 16 step 4c
  expect(CAP_INCREASE_PLUS_COST).toBe(2);     // pg. 3
  expect(LEVEL_PLUSES_PER_LEVEL).toBe(2);
  expect(TRAIT_COUNT).toBe(3);                // pg. 110
  expect(CREATION_PLUSES.aspirant).toBe(6);   // Advent pg. 16 via pg. 3
  expect(CREATION_PLUSES.aspiring).toBe(4);   // pg. 90
  expect(CREATION_PLUSES.advent).toBe(6);
});

test('a Trait raises its own Stat Cap and no other', () => {
  const traits = [{ name: 'brave', stat: 'might' }, { name: 'calm', stat: 'will' }];
  expect(statCapFor('might', { traits })).toBe(6);
  expect(statCapFor('will', { traits })).toBe(6);
  expect(statCapFor('luck', { traits })).toBe(5);
});

test('two Traits on one Stat stack, and purchases stack on top', () => {
  const traits = [{ name: 'brave', stat: 'might' }, { name: 'bold', stat: 'might' }];
  expect(statCapFor('might', { traits })).toBe(7);
  expect(statCapFor('might', { traits, capPurchases: { might: 2 } })).toBe(9);
});

test('a missing or junk purchase count never lowers a Cap', () => {
  expect(statCapFor('luck', {})).toBe(5);
  expect(statCapFor('luck', { capPurchases: { luck: -4 } })).toBe(5);
  expect(statCapFor('luck', { capPurchases: { luck: 'two' } })).toBe(5);
});

// The one clamp every level-gated rule reads from. Other callers (the +++
// creation ceiling gate in services/character/input.js) rely on this
// agreeing with plusAllotment's own idea of the level -- see the test below.
test('normalizeLevel clamps to a whole number in [1, LEVEL_CEILING]', () => {
  expect(normalizeLevel(1)).toBe(1);
  expect(normalizeLevel(2)).toBe(2);
  expect(normalizeLevel('3')).toBe(3);
  expect(normalizeLevel(1.9)).toBe(1);
  expect(normalizeLevel(2.9)).toBe(2);
  expect(normalizeLevel(0)).toBe(1);
  expect(normalizeLevel(-5)).toBe(1);
  expect(normalizeLevel(undefined)).toBe(1);
  expect(normalizeLevel(null)).toBe(1);
  expect(normalizeLevel('nonsense')).toBe(1);
  expect(normalizeLevel(LEVEL_CEILING)).toBe(LEVEL_CEILING);
});

// Without an upper bound, normalizeLevel(Infinity) is Infinity and
// normalizeLevel(1e9) is 1e9, so plusAllotment returns an unbounded figure
// and the allotment check (services/character/input.js's validateStatLimits)
// passes anything -- reachable via a hand-built request on the classic/expert
// path, since level is otherwise clamped only inside normalizeWizardPayload,
// which the wizard alone calls.
test('normalizeLevel has an upper bound, so it cannot be tricked into an unbounded allotment', () => {
  expect(normalizeLevel(Infinity)).toBe(LEVEL_CEILING);
  expect(normalizeLevel(1e9)).toBe(LEVEL_CEILING);
  expect(normalizeLevel(LEVEL_CEILING + 1)).toBe(LEVEL_CEILING);
  expect(plusAllotment({ economy: 'aspirant', level: Infinity }))
    .toBe(CREATION_PLUSES.aspirant + LEVEL_PLUSES_PER_LEVEL * (LEVEL_CEILING - 1));
});

// Ties plusAllotment's arithmetic to normalizeLevel's own output rather than
// to a level plusAllotment reads and clamps itself. If plusAllotment ever
// grew its own inline clamp again instead of calling normalizeLevel, this
// would fail for any input where the two clamps disagree (a fraction, a
// string, a sub-1 number) -- not just for the whole numbers a hand-picked
// example would happen to cover.
test('plusAllotment is computed from normalizeLevel, not a second clamp', () => {
  const rawLevels = [1, '1', 0, -3, 1.9, undefined, null, 'nonsense', 2, '5'];
  for (const level of rawLevels) {
    const expected = CREATION_PLUSES.aspirant + LEVEL_PLUSES_PER_LEVEL * (normalizeLevel(level) - 1);
    expect(plusAllotment({ economy: 'aspirant', level })).toBe(expected);
  }
});

test('the allotment grows by two per level and is unknown for an unknown economy', () => {
  expect(plusAllotment({ economy: 'aspirant', level: 1 })).toBe(6);
  expect(plusAllotment({ economy: 'aspirant', level: 5 })).toBe(14);
  expect(plusAllotment({ economy: 'aspiring', level: 1 })).toBe(4);
  expect(plusAllotment({ economy: 'aspiring', level: 3 })).toBe(8);
  expect(plusAllotment({ economy: 'nonsense', level: 1 })).toBeNull();
});

test('sumValues totals a stat map and drops non-numeric junk to zero', () => {
  expect(sumValues({ might: 2, sensory: 2, will: 1 })).toBe(5);
  expect(sumValues({})).toBe(0);
  expect(sumValues(undefined)).toBe(0);
  expect(sumValues({ luck: 3, skill: 'two' })).toBe(3);
});

test('capBreaches names every stat over its own Cap and nothing else', () => {
  const traits = [{ name: 'brave', stat: 'might' }];
  expect(capBreaches({ stats: { might: 6, luck: 5 }, traits })).toEqual([]);
  expect(capBreaches({ stats: { might: 7, luck: 6 }, traits }))
    .toEqual([{ stat: 'might', value: 7, cap: 6 }, { stat: 'luck', value: 6, cap: 5 }]);
});

test('creationCeilingBreaches uses the +++ ceiling, not the base Cap', () => {
  expect(creationCeilingBreaches({ might: 3 })).toEqual([]);
  expect(creationCeilingBreaches({ might: 4 })).toEqual([{ stat: 'might', value: 4, cap: 3 }]);
});
