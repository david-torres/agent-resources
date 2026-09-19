const { test, expect } = require('bun:test');
const {
  BASE_STAT_CAP, CREATION_STAT_CAP, CAP_INCREASE_PLUS_COST,
  CREATION_PLUSES, LEVEL_PLUSES_PER_LEVEL, TRAIT_COUNT,
  statCapFor, plusAllotment, traitGrantFor, assignedPluses,
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

test('the allotment grows by two per level and is unknown for an unknown economy', () => {
  expect(plusAllotment({ economy: 'aspirant', level: 1 })).toBe(6);
  expect(plusAllotment({ economy: 'aspirant', level: 5 })).toBe(14);
  expect(plusAllotment({ economy: 'aspiring', level: 1 })).toBe(4);
  expect(plusAllotment({ economy: 'aspiring', level: 3 })).toBe(8);
  expect(plusAllotment({ economy: 'nonsense', level: 1 })).toBeNull();
});

// The decomposition differs by economy: aspiring's three Trait-Stat pluses are
// PART of its four, not a grant on top (pg. 90), so it has no automatic grant.
test('only advent and aspirant get the third Trait value grant', () => {
  const traits = [
    { name: 'brave', stat: 'might' },
    { name: 'calm', stat: 'will' },
    { name: 'sharp', stat: 'sensory' }
  ];
  expect(traitGrantFor(traits, 'aspirant')).toEqual({ sensory: 1 });
  expect(traitGrantFor(traits, 'advent')).toEqual({ sensory: 1 });
  expect(traitGrantFor(traits, 'aspiring')).toEqual({});
});

test('assignedPluses recovers what the player spent', () => {
  const stats = { might: 2, sensory: 2, will: 1 };
  expect(assignedPluses({
    stats, classSpread: { might: 1, sensory: 2 }, traitGrant: { will: 1 }
  })).toBe(1);
  expect(assignedPluses({ stats })).toBe(5);
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
