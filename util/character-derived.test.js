const { test, expect, describe } = require('bun:test');
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
  // earned = 2 (advent grant) + 2 successes + 5 offscreen (3+2+0) = 9
  expect(result).toBe(9);
});

test('deriveMerx subtracts 1 per common item', () => {
  const result = deriveMerx({
    realMissions: [{ outcome: 'success' }, { outcome: 'success' }, { outcome: 'success' }],
    offscreenMissions: [],
    gear: [],
    commonItems: ['x', 'y'],
    characterClassId: 'class-A'
  });
  // earned = 2 (advent grant) + 3 successes = 5; 2 common items cost 2; 5 - 2 = 3
  expect(result).toBe(3);
});

test('deriveMerx subtracts 2 for on-class gear beyond the allotment and 3 for off-class gear', () => {
  // 5 on-class gear: first 3 are free (ADVENT_DEFAULT_SIGNATURES); the 4th and
  // 5th cost 2 each. 1 off-class costs 3. Total gear spend = 4 + 3 = 7.
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
  // earned = 2 (advent grant) + 10 missions = 12; 12 - 7 spend = 5
  expect(result).toBe(5);
});

test('deriveMerx treats missing class_id on gear as off-class', () => {
  // 1 on-class (within the 3-item allotment, free) + 1 off-class (no class_id, costs 3).
  // earned = 2 (advent grant) + 5 missions = 7; 7 - 3 spend = 4.
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
  expect(result).toBe(4);
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
  // earned = 2 (advent grant) + 7 successes = 9; 2 off-class gear at 3 each = 6; 9 - 6 = 3.
  // Would be 9 (no spend) if treated as on-class (within the free allotment), so this discriminates.
  expect(result).toBe(3);
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

test('deriveMerx returns the bare advent grant for empty inputs', () => {
  expect(deriveMerx({
    realMissions: [],
    offscreenMissions: [],
    gear: [],
    commonItems: [],
    characterClassId: 'class-A'
  })).toBe(2);
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
  // earned = 2 (advent grant) + 4 (only numeric merx_gained counted) = 6
  expect(result).toBe(6);
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
  // merx earned: 2 (advent grant) + 2*1 + 3 = 7; spend: 2 items*1 + 1 on-class
  // (free, within the 3-item allotment) + 1 off-class*3 = 5; max(0, 7-5) = 2
  // level (v2, 4 missions): cumulative v2 is [2,4,7,...]; 4 >= 4 -> level 3
  expect(result).toEqual({
    completed_missions: 4,
    commissary_reward: 2,
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
  // merx: earned = 2 (advent grant) + 5 = 7, no spend = 7
  expect(result).toEqual({
    completed_missions: 5,
    commissary_reward: 7,
    merx_deficit: 0,
    level: 3
  });
});

test('deriveCharacterTotals reports merx_deficit when spend exceeds earned', () => {
  // 2 successes plus the 2-Merx advent grant earn 4 merx; 5 common items
  // cost 5; reward floors at 0, deficit = 1.
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
  expect(result.merx_deficit).toBe(1);
});

test('deriveCharacterTotals reports zero deficit when reward is positive', () => {
  const character = { class_id: null, gear: [], common_items: ['a'] };
  const result = deriveCharacterTotals({
    character,
    realMissions: [{ outcome: 'success' }, { outcome: 'success' }],
    offscreenMissions: [],
    rulesVersion: 'v1'
  });
  // earned = 2 (advent grant) + 2 successes = 4; 1 common item costs 1; reward = 3
  expect(result.commissary_reward).toBe(3);
  expect(result.merx_deficit).toBe(0);
});

test('deriveMerx grants three on-class signature gear for free, the 4th costs 2 (ADVENT_DEFAULT_SIGNATURES)', () => {
  // 4 on-class gear: 3 free, the 4th (the Elective) costs 2 -> 2 gear spend.
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
  // earned = 2 (advent grant) + 2 successes = 4; 4 - 2 spend = 2
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
  // earned = 2 (advent grant) + 15 missions = 17; 17 - 4*3 = 17 - 12 = 5
  expect(result).toBe(5);
});

const { deriveMerxBreakdown } = require('./character-derived');
const { CREATION_GRANT } = require('./merx-economy');

const twelveOwn = (classId) => Array.from({ length: 12 }, (_, i) => ({
  name: `Signature ${i}`, class_id: classId
}));

// The defect: before the aspirant branch existed, this returned
// { spend: 16, deficit: 16 } -- eight Signatures past the Advent four-item
// allotment at 2 Merx each -- and any player who ticked auto-calculate on a
// freshly created V1 character was shown a 16-Merx debt.
test('a V1 character owning twelve own-class Signatures is charged 24 against a grant of 12', () => {
  const parts = deriveMerxBreakdown({
    realMissions: [], offscreenMissions: [],
    gear: twelveOwn('v1-class'), commonItems: [],
    characterClassId: 'v1-class', economy: 'aspirant'
  });
  expect(parts.earned).toBe(12);
  expect(parts.spend).toBe(24);
  expect(parts.deficit).toBe(12);
});

// 12 Merx at 2 Merx each. The Signature Cap of 12 is a carry limit reached
// over a campaign, not a creation target.
test('the 12-Merx grant buys exactly six own-class Signatures', () => {
  const six = twelveOwn('v1-class').slice(0, 6);
  const parts = deriveMerxBreakdown({
    realMissions: [], offscreenMissions: [],
    gear: six, commonItems: [],
    characterClassId: 'v1-class', economy: 'aspirant'
  });
  expect(parts.spend).toBe(CREATION_GRANT.aspirant);
  expect(parts.deficit).toBe(0);
  expect(parts.reward).toBe(0);
});

test('an Enchantment and two Mods are charged on top of the Signature', () => {
  const parts = deriveMerxBreakdown({
    realMissions: [], offscreenMissions: [],
    gear: [{
      name: 'Wizarding Hat', class_id: 'v1-class',
      enchantment: { source: 'default' },
      mods: [{ name: 'Lined' }, { name: 'Weighted' }]
    }],
    commonItems: [], characterClassId: 'v1-class', economy: 'aspirant'
  });
  // 2 Signature + 2 Default Enchantment + 1 first Mod + 2 second Mod
  expect(parts.spend).toBe(7);
});

// pg. 90 treats an aspiring character's three picks as its own Class's, and it
// has no class_id at all -- without the rule every pick would read as
// cross-class and cost 3, overcharging a 10-Merx grant by 3.
test('an aspiring character pays own-class price for picks from three classes', () => {
  const parts = deriveMerxBreakdown({
    realMissions: [], offscreenMissions: [],
    gear: [
      { name: 'A', class_id: 'class-a' },
      { name: 'B', class_id: 'class-b' },
      { name: 'C', class_id: 'class-c' }
    ],
    commonItems: [], characterClassId: null, economy: 'aspiring'
  });
  expect(parts.earned).toBe(10);
  expect(parts.spend).toBe(6);
  expect(parts.reward).toBe(4);
});

// All 327 existing characters are in this branch. Three on-class Signatures
// are free; the fourth is the Elective, bought out of CREATION_GRANT.advent.
test('the advent branch: three on-class Signatures free, the fourth costs the Elective', () => {
  const parts = deriveMerxBreakdown({
    realMissions: [], offscreenMissions: [],
    gear: twelveOwn('advent-class').slice(0, 4), commonItems: [],
    characterClassId: 'advent-class'
  });
  expect(parts.earned).toBe(2);
  expect(parts.spend).toBe(2);
  expect(parts.deficit).toBe(0);
});

test('the advent branch charges the fifth on-class Signature 2 Merx on top of the Elective', () => {
  const parts = deriveMerxBreakdown({
    realMissions: [], offscreenMissions: [],
    gear: twelveOwn('advent-class').slice(0, 5), commonItems: [],
    characterClassId: 'advent-class'
  });
  expect(parts.spend).toBe(4);
});

test('an omitted economy is advent, so existing callers keep their answer', () => {
  const args = {
    realMissions: [], offscreenMissions: [],
    gear: twelveOwn('advent-class').slice(0, 4), commonItems: [],
    characterClassId: 'advent-class'
  };
  expect(deriveMerxBreakdown(args)).toEqual(
    deriveMerxBreakdown({ ...args, economy: 'advent' })
  );
});

test('a V1 character still earns Merx from missions on top of the grant', () => {
  const parts = deriveMerxBreakdown({
    realMissions: [{ outcome: 'success' }, { outcome: 'success' }],
    offscreenMissions: [{ merx_gained: 3 }],
    gear: [], commonItems: [],
    characterClassId: 'v1-class', economy: 'aspirant'
  });
  expect(parts.earned).toBe(12 + 2 + 3);
});

describe('advent: three Defaults and one Elective (pg. 3)', () => {
  const CLASS_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
  const own = (name) => ({ name, class_id: CLASS_ID });
  const threeDefaults = [own('Alpha'), own('Bravo'), own('Charlie')];
  const base = {
    realMissions: [], offscreenMissions: [],
    characterClassId: CLASS_ID, economy: 'advent'
  };

  test('the Elective spent on a fourth class item costs exactly 2', () => {
    const result = deriveMerxBreakdown({
      ...base, gear: [...threeDefaults, own('Delta')], commonItems: []
    });
    expect(result).toMatchObject({ earned: 2, spend: 2, reward: 0, deficit: 0 });
  });

  test('the Elective spent on two common items costs exactly 2', () => {
    const result = deriveMerxBreakdown({
      ...base, gear: threeDefaults, commonItems: ['Rope', 'Lantern']
    });
    expect(result).toMatchObject({ earned: 2, spend: 2, reward: 0, deficit: 0 });
  });

  test('the Elective doubling up on a Default costs exactly 2 (Advent V2 pg. 16)', () => {
    const result = deriveMerxBreakdown({
      ...base, gear: [...threeDefaults, own('Alpha')], commonItems: []
    });
    expect(result).toMatchObject({ earned: 2, spend: 2, reward: 0, deficit: 0 });
  });

  test('an unspent Elective is carried, not forfeited', () => {
    const result = deriveMerxBreakdown({ ...base, gear: threeDefaults, commonItems: [] });
    expect(result).toMatchObject({ earned: 2, spend: 0, reward: 2, deficit: 0 });
  });

  test('a fifth on-class Signature is charged on top of the Elective', () => {
    const result = deriveMerxBreakdown({
      ...base, gear: [...threeDefaults, own('Delta'), own('Echo')], commonItems: []
    });
    expect(result).toMatchObject({ earned: 2, spend: 4, deficit: 2 });
  });

  test('mission income still stacks on the grant', () => {
    const result = deriveMerxBreakdown({
      ...base,
      realMissions: [{ outcome: 'success' }, { outcome: 'success' }],
      gear: threeDefaults, commonItems: []
    });
    expect(result).toMatchObject({ earned: 4 });
  });
});
