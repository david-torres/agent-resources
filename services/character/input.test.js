const { test, expect } = require('bun:test');
const { normalizeCharacterInput, normalizeGearItems } = require('./input');

test('trims every string in a character payload, not just item names', () => {
  const { data, childData } = normalizeCharacterInput({
    name: ' Ragnar ',
    background: 'A tale. ',
    gear: ['Shonen::Training Weights '],
  });
  expect(data.name).toBe('Ragnar');
  expect(data.background).toBe('A tale.');
  expect(normalizeGearItems(childData.classGear)[0].name).toBe('Training Weights');
});

test('normalizeGearItems keeps the class half of a "ClassName::ItemName" value as class_name', () => {
  const [qualified, bare, padded] = normalizeGearItems([
    'Gunslinger::Revolver',
    'Revolver',
    '  Gunslinger  ::  Revolver  '
  ]);

  expect(qualified).toEqual({ name: 'Revolver', class_name: 'Gunslinger' });
  expect(bare).toEqual({ name: 'Revolver' });
  expect(bare).not.toHaveProperty('class_name');
  expect(padded).toEqual({ name: 'Revolver', class_name: 'Gunslinger' });
});

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
  expect(result.childData.abilityPerks[0].text).toBe('Deal more damage');
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

test('normalizeCharacterInput accepts a YYYY-MM-DD created_at and normalizes it to ISO', () => {
  const { data, error } = normalizeCharacterInput({ name: 'Vex', created_at: '2026-03-04' }, {});
  expect(error).toBeNull();
  expect(data.created_at).toBe('2026-03-04T00:00:00.000Z');
});

test('normalizeCharacterInput accepts a full ISO created_at', () => {
  const { data, error } = normalizeCharacterInput({ name: 'Vex', created_at: '2026-03-04T09:30:00.000Z' }, {});
  expect(error).toBeNull();
  expect(data.created_at).toBe('2026-03-04T09:30:00.000Z');
});

test('normalizeCharacterInput rejects an unparseable created_at', () => {
  const { data, error } = normalizeCharacterInput({ name: 'Vex', created_at: 'last tuesday' }, {});
  expect(data).toBeNull();
  expect(error).toBe('Invalid created date.');
});

test('normalizeCharacterInput rejects a future created_at', () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const { data, error } = normalizeCharacterInput({ name: 'Vex', created_at: tomorrow }, {});
  expect(data).toBeNull();
  expect(error).toBe('Created date cannot be in the future.');
});

test('normalizeCharacterInput drops an empty created_at rather than sending null', () => {
  const { data, error } = normalizeCharacterInput({ name: 'Vex', created_at: '' }, {});
  expect(error).toBeNull();
  expect('created_at' in data).toBe(false);
});

test('normalizeCharacterInput leaves created_at absent when it was never submitted', () => {
  const { data, error } = normalizeCharacterInput({ name: 'Vex' }, {});
  expect(error).toBeNull();
  expect('created_at' in data).toBe(false);
});
