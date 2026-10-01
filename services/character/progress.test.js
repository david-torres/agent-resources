const { test, expect } = require('bun:test');
const { inspectCharacterProgress, recalculateCharacterProgress, calculateCharacterProgress } = require('./progress');
const { familyResolver } = require('../../util/class-family');
const { CREATION_GRANT, priceOfSignature } = require('../../util/merx-economy');

test('mission progress pays successes and accounts for gear already bought', async () => {
  const writes = [];
  const repository = {
    getCharacter: async () => ({ data: {
      auto_calculate: true,
      class_id: 'own-class',
      creator_mode: null,
      gear: [
        { name: 'Bandolier', class_id: 'own-class' },
        { name: 'Revolver', class_id: 'own-class' },
        { name: 'Duster', class_id: 'other-class' }
      ],
      common_items: []
    }, error: null }),
    getRealMissions: async () => ({ data: [
      { outcome: 'success' }, { outcome: 'success' }
    ], error: null }),
    listOffscreenMissions: async () => ({ data: [], error: null }),
    getClassRulesVersion: async () => ({ data: 'v2', contentFormat: 'advent', error: null }),
    getClassFamilyRows: async () => ({ data: [], error: null }),
    updateCharacterProgress: async (id, totals) => {
      writes.push({ id, totals });
      return { error: null };
    }
  };

  await recalculateCharacterProgress('shady', repository);
  expect(writes).toEqual([{ id: 'shady', totals: {
    completed_missions: 2,
    commissary_reward: 1,
    level: 2
  } }]);
});

test('pending missions earn nothing, and manual totals stay untouched', async () => {
  let writes = 0;
  const repository = {
    getCharacter: async id => ({ data: {
      auto_calculate: id === 'automatic', class_id: null, gear: [], common_items: []
    }, error: null }),
    getRealMissions: async () => ({ data: [{ outcome: 'pending' }], error: null }),
    listOffscreenMissions: async () => ({ data: [], error: null }),
    getClassRulesVersion: async () => ({ data: 'v1', contentFormat: null, error: null }),
    updateCharacterProgress: async (_id, totals) => {
      writes++;
      expect(totals.completed_missions).toBe(0);
      expect(totals.commissary_reward).toBe(2);
      return { error: null };
    }
  };

  await recalculateCharacterProgress('manual', repository);
  expect(writes).toBe(0);
  await recalculateCharacterProgress('automatic', repository);
  expect(writes).toBe(1);
});

test('inspection reports stale totals and a matching character needs no write', async () => {
  let writes = 0;
  const character = {
    auto_calculate: true, class_id: null, gear: [], common_items: [],
    completed_missions: 0, commissary_reward: 0, level: 1
  };
  const repository = {
    getCharacter: async () => ({ data: character, error: null }),
    getRealMissions: async () => ({ data: [], error: null }),
    listOffscreenMissions: async () => ({ data: [], error: null }),
    getClassRulesVersion: async () => ({ data: 'v1', contentFormat: null, error: null }),
    updateCharacterProgress: async () => { writes++; return { error: null }; }
  };

  const stale = await inspectCharacterProgress('character-1', repository);
  expect(stale).toEqual({
    current: { completed_missions: 0, commissary_reward: 0, level: 1 },
    totals: { completed_missions: 0, commissary_reward: 2, level: 1 },
    changed: true
  });
  character.commissary_reward = 2;
  const current = await recalculateCharacterProgress('character-1', repository);
  expect(current.changed).toBe(false);
  expect(writes).toBe(0);
});

test('an Aspirant character on an Advent v1 class levels on the v2 curve', () => {
  const levelFor = (creatorMode) => calculateCharacterProgress({
    character: { class_id: 'advent-v1', creator_mode: creatorMode, gear: [], common_items: [] },
    realMissions: [],
    offscreenMissions: Array.from({ length: 4 }, () => ({ merx_gained: 0 })),
    classRules: { data: 'v1', contentFormat: 'advent' }
  }).level;
  expect(levelFor('aspirant')).toBe(3);
  expect(levelFor(null)).toBe(2);
});

// A character on an Aspirant version, holding a Signature from the Advent
// class that version came from: own class, so the own rate.
const FORK_FAMILY = [
  { id: 'gs-advent', base_class_id: null, rules_edition: 'advent', content_format: 'advent' },
  { id: 'gs-fork', base_class_id: 'gs-advent', rules_edition: 'aspirant', content_format: 'aspirant' }
];
const forkCharacter = () => ({
  auto_calculate: true, class_id: 'gs-fork', creator_mode: 'aspirant',
  gear: [{ name: 'Duster', class_id: 'gs-advent', enchantment: null, mods: [] }], common_items: [],
  completed_missions: 0, commissary_reward: 0, level: 1
});
const OWN_RATE_REWARD = CREATION_GRANT.aspirant - priceOfSignature({ crossClass: false });

test('stored Merx prices a fork character\'s Advent-origin Signature at the own rate', async () => {
  const writes = [];
  const repository = {
    getCharacter: async () => ({ data: forkCharacter(), error: null }),
    getRealMissions: async () => ({ data: [], error: null }),
    listOffscreenMissions: async () => ({ data: [], error: null }),
    getClassRulesVersion: async () => ({ data: 'v2', contentFormat: 'aspirant', error: null }),
    getClassFamilyRows: async () => ({ data: FORK_FAMILY, error: null }),
    updateCharacterProgress: async (_id, totals) => { writes.push(totals); return { error: null }; }
  };
  await recalculateCharacterProgress('cora', repository);
  expect(writes[0].commissary_reward).toBe(OWN_RATE_REWARD);
});

test('calculateCharacterProgress prices with the classFamilyOf it is handed', () => {
  const reward = (classFamilyOf) => calculateCharacterProgress({
    character: forkCharacter(),
    realMissions: [],
    offscreenMissions: [],
    classRules: { data: 'v2', contentFormat: 'aspirant' },
    classFamilyOf
  }).commissary_reward;
  expect(reward(familyResolver(FORK_FAMILY, 'gs-fork'))).toBe(OWN_RATE_REWARD);
  expect(reward(null)).toBe(CREATION_GRANT.aspirant - priceOfSignature({ crossClass: true }));
});

test('high stakes reach stored progress in every economy with ordinary level credit', () => {
  for (const creator_mode of ['advent', 'aspirant', 'aspiring']) {
    const common = {
      character: { creator_mode, gear: [], common_items: [] },
      offscreenMissions: [],
      classRules: { data: 'v2', contentFormat: 'aspirant' }
    };
    const ordinary = calculateCharacterProgress({ ...common, realMissions: [{ outcome: 'success' }] });
    const high = calculateCharacterProgress({ ...common, realMissions: [{ outcome: 'success', difficulty: 'crisis', danger: 'crisis' }] });
    expect(high.commissary_reward).toBe(ordinary.commissary_reward + 6);
    expect(high.completed_missions).toBe(ordinary.completed_missions);
    expect(high.level).toBe(ordinary.level);
  }
});

test('corrected legacy Aspirant v1 retains level 5 at 11 missions and Advent economy', () => {
  const progress = calculateCharacterProgress({
    character: { class_id: 'legacy', creator_mode: null, gear: [], common_items: [] },
    realMissions: Array.from({ length: 11 }, () => ({ outcome: 'failure' })), offscreenMissions: [],
    classRules: { data: 'v1', classRules: { rules_edition: 'aspirant', rules_version: 'v1', content_format: 'advent' }, contentFormat: 'advent' }
  });
  expect(progress).toEqual({ completed_missions: 11, commissary_reward: CREATION_GRANT.advent, level: 5 });
});
test('rules lookup failure prevents automatic progress writes', async () => {
  let writes = 0;
  const repository = {
    getCharacter: async () => ({ data: { auto_calculate: true, class_id: 'missing' } }),
    getRealMissions: async () => ({ data: [] }), listOffscreenMissions: async () => ({ data: [] }),
    getClassRulesVersion: async () => ({ data: null, classRules: null, error: new Error('rules unavailable') }),
    getClassFamilyRows: async () => ({ data: [] }),
    updateCharacterProgress: async () => { writes++; return {}; }
  };
  await expect(recalculateCharacterProgress('character', repository)).rejects.toThrow('rules unavailable');
  expect(writes).toBe(0);
});

test('stale automatic calculation is re-read before writing after a concurrent edit', async () => {
  let reads = 0;
  const timestamps = [];
  const repository = {
    getCharacter: async () => ({ data: { auto_calculate: true, updated_at: `snapshot-${++reads}`, class_id: null, gear: [], common_items: [] } }),
    getRealMissions: async () => ({ data: [] }), listOffscreenMissions: async () => ({ data: [] }),
    getClassRulesVersion: async () => ({ classRules: null, contentFormat: null }),
    updateCharacterProgress: async (_id, _totals, expectedUpdatedAt) => {
      timestamps.push(expectedUpdatedAt); return { stale: timestamps.length === 1 };
    }
  };
  await recalculateCharacterProgress('character', repository);
  expect(timestamps).toEqual(['snapshot-1', 'snapshot-2']);
});
