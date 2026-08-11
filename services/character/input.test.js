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

const { normalizeWizardPayload } = require('./input');

test('normalizeWizardPayload rejects a missing name', () => {
  const { data, error } = normalizeWizardPayload({ name: '   ' });
  expect(data).toBeNull();
  expect(error).toBe('Character name is required.');
});

test('normalizeWizardPayload rejects an over-long name', () => {
  const { error } = normalizeWizardPayload({ name: 'x'.repeat(121) });
  expect(error).toBe('Character name is too long (max 120 characters).');
});

test('normalizeWizardPayload rejects an unknown creator_mode', () => {
  const { error } = normalizeWizardPayload({ name: 'Hero', creator_mode: 'bogus' });
  expect(error).toBe('Invalid mode: bogus');
});

test('normalizeWizardPayload coerces stats, clamps level/missions, defaults reward and booleans', () => {
  const { data, error } = normalizeWizardPayload({
    name: '  Hero  ',
    might: '7',
    level: '99',
    completed_missions: '-3',
    is_public: false,
    hide_from_search: true
  });
  expect(error).toBeNull();
  expect(data.name).toBe('Hero');
  expect(data.might).toBe(7);
  expect(data.level).toBe(20);
  expect(data.completed_missions).toBe(0);
  expect(data.commissary_reward).toBe(0);
  expect(data.is_public).toBe(false);
  expect(data.hide_from_search).toBe(true);
});

test('normalizeWizardPayload defaults is_public to true when unset', () => {
  const { data } = normalizeWizardPayload({ name: 'Hero' });
  expect(data.is_public).toBe(true);
  expect(data.hide_from_search).toBe(false);
});

const { collectCharacterFormArrays } = require('./input');

test('collectCharacterFormArrays assembles perks/quirks/accessories and strips raw keys', () => {
  const out = collectCharacterFormArrays({
    name: 'Hero',
    ability_perk_class_ability_id: ['a1', 'a2'],
    ability_perk_text: ['first', ''],          // blank text row is dropped
    ability_perk_position: ['0', '1'],
    ability_perk_compounds_with: ['', 'new:x'],
    quirk_name: ['Brave', '  '],               // blank name dropped
    quirk_description: ['bold', ''],
    accessory_name: ['Ring'],
    accessory_description: ['']
  });
  expect(out.name).toBe('Hero');
  expect(out.ability_perks).toEqual([{ class_ability_id: 'a1', text: 'first', position: 0, compounds_with: null }]);
  expect(out.quirks).toEqual([{ name: 'Brave', description: 'bold' }]);
  expect(out.accessories).toEqual([{ name: 'Ring' }]);
  expect(out.ability_perk_class_ability_id).toBeUndefined();
  expect(out.quirk_name).toBeUndefined();
  expect(out.accessory_description).toBeUndefined();
});

test('collectCharacterFormArrays tolerates single (non-array) form values', () => {
  const out = collectCharacterFormArrays({
    ability_perk_class_ability_id: 'a1',
    ability_perk_text: 'solo',
    ability_perk_position: '3',
    ability_perk_compounds_with: ''
  });
  expect(out.ability_perks).toEqual([{ class_ability_id: 'a1', text: 'solo', position: 3, compounds_with: null }]);
});
