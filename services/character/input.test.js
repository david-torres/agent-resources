const { test, expect } = require('bun:test');
const { normalizeCharacterInput } = require('./input');

test('normalizes a v1 payload without mutating the submitted request', () => {
  const input = {
    name: '  Scout  ',
    trait0: 'Brave', trait1: '', trait2: 'Clever',
    gear: ['Ranger::Knife'], abilities: ['Ranger::Dodge'],
    common_items: [' rope ', '', 3], is_public: 'on', hide_from_search: 'off',
    quirks: [{ name: 'v2 only' }], ability_perks: [{ class_ability_id: 'a', text: 'ignored' }]
  };

  const result = normalizeCharacterInput(input, { rulesVersion: 'v1', creatorId: 'owner' });

  expect(result.error).toBeNull();
  expect(result.data).toMatchObject({ creator_id: 'owner', common_items: ['rope'], is_public: true, hide_from_search: false });
  expect(result.data).not.toHaveProperty('quirks');
  expect(result.data).not.toHaveProperty('ability_perks');
  expect(result.data).not.toHaveProperty('trait0');
  expect(result.childData.traits).toEqual(['Brave', '', 'Clever']);
  expect(result.childData.classGear).toEqual(['Ranger::Knife']);
  expect(input.quirks).toHaveLength(1);
  expect(input).toHaveProperty('trait0');
});

test('normalizes v2 fields and strips legacy free-text fields', () => {
  const result = normalizeCharacterInput({
    quirks: [' Synthetic ', { name: 'Veteran', description: '  Seen it all ' }, { name: ' ' }],
    accessories: [{ name: ' Monocle ' }], perks: 'legacy', additional_gear: 'legacy gear',
    ability_perks: [{ class_ability_id: 'ability-1', text: '  Deal more damage  ', position: '2' }],
    creator_mode: 'aspiring', image_url: 'https://example.test/image.png'
  }, { rulesVersion: 'v2' });

  expect(result.error).toBeNull();
  expect(result.data.quirks).toEqual([{ name: 'Synthetic' }, { name: 'Veteran', description: 'Seen it all' }]);
  expect(result.data.accessories).toEqual([{ name: 'Monocle' }]);
  expect(result.data).not.toHaveProperty('perks');
  expect(result.data).not.toHaveProperty('additional_gear');
  expect(result.data.image_url).toBe('https://example.test/image.png');
  expect(result.childData.abilityPerks[0].text).toBe('  Deal more damage  ');
});

test('returns established validation errors for invalid creator mode and perks', () => {
  expect(normalizeCharacterInput({ creator_mode: 'nope' }, { rulesVersion: 'v1' })).toMatchObject({
    data: null, error: 'Invalid creator_mode: nope'
  });
  const tooLong = Array.from({ length: 26 }, (_, index) => `word${index}`).join(' ');
  expect(normalizeCharacterInput({ ability_perks: [{ class_ability_id: 'a', text: tooLong }] }, { rulesVersion: 'v2' }).error)
    .toMatch(/25 words/);
});

test('normalizes update booleans and missing list fields deterministically', () => {
  const result = normalizeCharacterInput({ auto_calculate: true, image_url: 'javascript:bad' }, {
    rulesVersion: 'v1', normalizeAutoCalculate: true
  });
  expect(result.data).toMatchObject({ auto_calculate: true, common_items: [], is_public: false, hide_from_search: false, image_url: null });
});
