const { test, expect } = require('bun:test');
const { deriveCompletedMissions } = require('./character-derived');

test('deriveCompletedMissions counts success and failure real missions plus all offscreen', () => {
  const realMissions = [
    { id: 'm1', outcome: 'success' },
    { id: 'm2', outcome: 'failure' },
    { id: 'm3', outcome: 'pending' },
    { id: 'm4', outcome: 'success' }
  ];
  const offscreenMissions = [
    { id: 'o1', merx_gained: 0 },
    { id: 'o2', merx_gained: 3 }
  ];
  expect(deriveCompletedMissions(realMissions, offscreenMissions)).toBe(5);
});

test('deriveCompletedMissions returns 0 for empty inputs', () => {
  expect(deriveCompletedMissions([], [])).toBe(0);
  expect(deriveCompletedMissions(undefined, undefined)).toBe(0);
  expect(deriveCompletedMissions(null, null)).toBe(0);
});

test('deriveCompletedMissions excludes pending and ignores unknown outcomes', () => {
  const realMissions = [
    { outcome: 'pending' },
    { outcome: 'success' },
    { outcome: 'cancelled' },
    { outcome: null }
  ];
  expect(deriveCompletedMissions(realMissions, [])).toBe(1);
});

const { deriveLevel } = require('./character-derived');

test('deriveLevel uses v1 sequence (cumulative 2,5,9,14,20,27,35,44,54)', () => {
  expect(deriveLevel(0, 'v1')).toBe(1);
  expect(deriveLevel(1, 'v1')).toBe(1);
  expect(deriveLevel(2, 'v1')).toBe(2);
  expect(deriveLevel(4, 'v1')).toBe(2);
  expect(deriveLevel(5, 'v1')).toBe(3);
  expect(deriveLevel(53, 'v1')).toBe(9);
  expect(deriveLevel(54, 'v1')).toBe(10);
  expect(deriveLevel(9999, 'v1')).toBe(10);
});

test('deriveLevel uses v2 sequence (cumulative 2,4,7,10,14,18,23,28,34)', () => {
  expect(deriveLevel(0, 'v2')).toBe(1);
  expect(deriveLevel(2, 'v2')).toBe(2);
  expect(deriveLevel(3, 'v2')).toBe(2);
  expect(deriveLevel(4, 'v2')).toBe(3);
  expect(deriveLevel(33, 'v2')).toBe(9);
  expect(deriveLevel(34, 'v2')).toBe(10);
  expect(deriveLevel(100, 'v2')).toBe(10);
});

test('deriveLevel defaults to v1 sequence when rulesVersion missing or unknown', () => {
  expect(deriveLevel(5)).toBe(3);
  expect(deriveLevel(5, null)).toBe(3);
  expect(deriveLevel(5, 'v3')).toBe(3);
});

const { deriveMerx } = require('./character-derived');

test('deriveMerx awards 1 per successful real mission and sums offscreen merx_gained', () => {
  const result = deriveMerx({
    realMissions: [
      { outcome: 'success' },
      { outcome: 'success' },
      { outcome: 'failure' },
      { outcome: 'pending' }
    ],
    offscreenMissions: [
      { merx_gained: 3 },
      { merx_gained: 2 },
      { merx_gained: 0 }
    ],
    gear: [],
    commonItems: [],
    characterClassId: 'class-A'
  });
  expect(result).toBe(7);
});

test('deriveMerx subtracts 1 per common item', () => {
  const result = deriveMerx({
    realMissions: [{ outcome: 'success' }, { outcome: 'success' }, { outcome: 'success' }],
    offscreenMissions: [],
    gear: [],
    commonItems: ['x', 'y'],
    characterClassId: 'class-A'
  });
  expect(result).toBe(1);
});

test('deriveMerx subtracts 2 for on-class gear beyond the allotment and 3 for off-class gear', () => {
  // 5 on-class gear: first 4 are free (creation allotment); 5th costs 2.
  // 1 off-class costs 3. Total spend = 2 + 3 = 5.
  const result = deriveMerx({
    realMissions: Array.from({ length: 10 }, () => ({ outcome: 'success' })),
    offscreenMissions: [],
    gear: [
      { name: 'On1', class_id: 'class-A' },
      { name: 'On2', class_id: 'class-A' },
      { name: 'On3', class_id: 'class-A' },
      { name: 'On4', class_id: 'class-A' },
      { name: 'On5', class_id: 'class-A' },
      { name: 'Off1', class_id: 'class-B' }
    ],
    commonItems: [],
    characterClassId: 'class-A'
  });
  // 10 earned - (1 charged on-class * 2 + 1 off-class * 3) = 10 - 5 = 5
  expect(result).toBe(5);
});

test('deriveMerx treats missing class_id on gear as off-class', () => {
  // 1 on-class (within allotment, free) + 1 off-class (no class_id, costs 3).
  // 5 earned - 3 spend = 2.
  const result = deriveMerx({
    realMissions: Array.from({ length: 5 }, () => ({ outcome: 'success' })),
    offscreenMissions: [],
    gear: [
      { name: 'NoClass' },
      { name: 'OnClass', class_id: 'class-A' }
    ],
    commonItems: [],
    characterClassId: 'class-A'
  });
  expect(result).toBe(2);
});

test('deriveMerx with no character class makes all gear off-class', () => {
  const result = deriveMerx({
    realMissions: [
      { outcome: 'success' },
      { outcome: 'success' },
      { outcome: 'success' },
      { outcome: 'success' },
      { outcome: 'success' },
      { outcome: 'success' },
      { outcome: 'success' }
    ],
    offscreenMissions: [],
    gear: [
      { name: 'G1', class_id: 'class-A' },
      { name: 'G2', class_id: 'class-A' }
    ],
    commonItems: [],
    characterClassId: null
  });
  // 7 successes - 2 off-class gear at 3 each = 7 - 6 = 1
  // Would be 7 - 4 = 3 if treated as on-class, so this discriminates.
  expect(result).toBe(1);
});

test('deriveMerx floors at 0 when spend exceeds earned', () => {
  const result = deriveMerx({
    realMissions: [{ outcome: 'success' }],
    offscreenMissions: [],
    gear: [
      { name: 'A', class_id: 'class-A' },
      { name: 'B', class_id: 'class-A' }
    ],
    commonItems: ['c1', 'c2', 'c3'],
    characterClassId: 'class-A'
  });
  expect(result).toBe(0);
});

test('deriveMerx returns 0 for empty inputs', () => {
  expect(deriveMerx({
    realMissions: [],
    offscreenMissions: [],
    gear: [],
    commonItems: [],
    characterClassId: 'class-A'
  })).toBe(0);
});

test('deriveMerx coerces non-numeric offscreen merx_gained to 0', () => {
  const result = deriveMerx({
    realMissions: [],
    offscreenMissions: [
      { merx_gained: '4' },
      { merx_gained: null },
      { merx_gained: undefined },
      { merx_gained: 'abc' }
    ],
    gear: [],
    commonItems: [],
    characterClassId: 'class-A'
  });
  expect(result).toBe(4);
});

const { deriveCharacterTotals } = require('./character-derived');

test('deriveCharacterTotals returns all three derived fields together', () => {
  const character = {
    class_id: 'class-A',
    gear: [
      { name: 'On', class_id: 'class-A' },
      { name: 'Off', class_id: 'class-B' }
    ],
    common_items: ['kit', 'rope']
  };
  const realMissions = [
    { outcome: 'success' },
    { outcome: 'success' },
    { outcome: 'failure' },
    { outcome: 'pending' }
  ];
  const offscreenMissions = [
    { merx_gained: 3 }
  ];

  const result = deriveCharacterTotals({
    character,
    realMissions,
    offscreenMissions,
    rulesVersion: 'v2'
  });

  // completed: 2 success + 1 failure + 1 offscreen = 4
  // merx earned: 2*1 + 3 = 5; spend: 2 items*1 + 1 on-class*2 + 1 off-class*3 = 7; max(0, 5-7) = 0
  // level (v2, 4 missions): cumulative v2 is [2,4,7,...]; 4 >= 4 -> level 3
  expect(result).toEqual({
    completed_missions: 4,
    commissary_reward: 0,
    merx_deficit: 0,
    level: 3
  });
});

test('deriveCharacterTotals defaults to v1 when rulesVersion missing', () => {
  const character = { class_id: null, gear: [], common_items: [] };
  const realMissions = Array.from({ length: 5 }, () => ({ outcome: 'success' }));
  const result = deriveCharacterTotals({
    character,
    realMissions,
    offscreenMissions: []
  });
  // completed 5, level v1: cumulative [2,5,...] -> 5 >= 5 -> level 3
  // merx: 5 earned, no spend = 5
  expect(result).toEqual({
    completed_missions: 5,
    commissary_reward: 5,
    merx_deficit: 0,
    level: 3
  });
});

test('deriveCharacterTotals reports merx_deficit when spend exceeds earned', () => {
  // 2 successes earn 2 merx; 5 common items cost 5; reward floors at 0, deficit = 3.
  const character = {
    class_id: 'class-A',
    gear: [],
    common_items: ['a', 'b', 'c', 'd', 'e']
  };
  const result = deriveCharacterTotals({
    character,
    realMissions: [{ outcome: 'success' }, { outcome: 'success' }],
    offscreenMissions: [],
    rulesVersion: 'v1'
  });
  expect(result.commissary_reward).toBe(0);
  expect(result.merx_deficit).toBe(3);
});

test('deriveCharacterTotals reports zero deficit when reward is positive', () => {
  const character = { class_id: null, gear: [], common_items: ['a'] };
  const result = deriveCharacterTotals({
    character,
    realMissions: [{ outcome: 'success' }, { outcome: 'success' }],
    offscreenMissions: [],
    rulesVersion: 'v1'
  });
  expect(result.commissary_reward).toBe(1);
  expect(result.merx_deficit).toBe(0);
});

test('deriveMerx grants the first 4 on-class signature gear for free (creation allotment)', () => {
  // 4 on-class gear (entirely within the allotment) → 0 gear spend.
  const result = deriveMerx({
    realMissions: [{ outcome: 'success' }, { outcome: 'success' }],
    offscreenMissions: [],
    gear: [
      { name: 'G1', class_id: 'class-A' },
      { name: 'G2', class_id: 'class-A' },
      { name: 'G3', class_id: 'class-A' },
      { name: 'G4', class_id: 'class-A' }
    ],
    commonItems: [],
    characterClassId: 'class-A'
  });
  expect(result).toBe(2);
});

test('deriveMerx allotment does not apply to off-class gear', () => {
  // 4 off-class gear → all cost 3 each (no allotment for off-class).
  const result = deriveMerx({
    realMissions: Array.from({ length: 15 }, () => ({ outcome: 'success' })),
    offscreenMissions: [],
    gear: [
      { name: 'O1', class_id: 'class-B' },
      { name: 'O2', class_id: 'class-B' },
      { name: 'O3', class_id: 'class-B' },
      { name: 'O4', class_id: 'class-B' }
    ],
    commonItems: [],
    characterClassId: 'class-A'
  });
  // 15 earned - 4*3 = 15 - 12 = 3
  expect(result).toBe(3);
});
