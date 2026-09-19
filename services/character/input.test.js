const { test, expect } = require('bun:test');
const {
  normalizeCharacterInput, normalizeGearItems, normalizeAbilityItems, normalizeGearEquipment,
  validateGearEquipment, validateEconomyLimits, shapeTrait, validateTraits
} = require('./input');
const { countWordsExcludingRatings, ENCHANTMENT_WORD_LIMIT, MOD_WORD_LIMIT } = require('../../util/merx-economy');
const { personalityMap } = require('../../util/enclave-consts');

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
    trait0: 'Brave', trait1: '', trait2: 'Calm',
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
  expect(result.childData.traits).toEqual([{ name: 'Brave', stat: 'might' }, { name: 'Calm', stat: 'will' }]);
  expect(result.childData.classGear).toEqual(['Ranger::Knife']);
  expect(input.quirks).toHaveLength(1);
  expect(input).toHaveProperty('trait0');
});

test('normalizes v2 fields and strips legacy free-text fields', () => {
  const result = normalizeCharacterInput({
    quirks: [' Synthetic ', { name: 'Veteran', description: '  Seen it all ' }, { name: ' ' }],
    accessories: [{ name: ' Monocle ' }], perks: 'legacy', additional_gear: 'legacy gear',
    ability_perks: [{ class_ability_id: 'ability-1', text: '  Deal more damage  ', position: '2' }],
    creator_mode: 'aspiring', image_url: 'https://example.test/image.png',
    trait0: 'brave', trait1: 'calm', trait2: 'alert'
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

// normalizeAbilityItems is normalizeClassItems, which spreads the submitted
// object ({...item, name} at services/character/input.js:134). The tag
// survived this far all along and was lost further downstream, so this is the
// boundary worth pinning. Abilities never carry equipment, and this submitted
// item mentions none, so normalizeGearEquipment (which also runs here) adds
// no equipment keys at all; reconcileAbilities and the atomic path's ability
// mapping name their columns explicitly, so an ability item could not reach a
// write with equipment keys regardless.
test('normalizeAbilityItems keeps the submitted type', () => {
  expect(normalizeAbilityItems([{ name: ' Overdrive ', type: 'advanced' }])).toEqual([
    { name: 'Overdrive', type: 'advanced' }
  ]);
});

// pseudo_class used to ride through normalizeWizardPayload (no allowlist) into
// jsonb_populate_record, which silently ignores keys that are not columns
// (20260905000001:33-49). No error, no data -- the wizard comment at
// public/js/character-wizard.js:3148-3156 described a server that never existed.
test('maps an aspiring pseudo_class onto class and the pseudo-class columns', () => {
  const result = normalizeCharacterInput({
    name: 'Vesper',
    creator_mode: 'aspiring',
    pseudo_class: { name: '  Ashwalker  ', tagline: ' Walks the ash ', description: ' A long tale. ' },
    trait0: 'brave', trait1: 'calm', trait2: 'alert'
  }, { rulesVersion: 'v1' });

  expect(result.error).toBeNull();
  expect(result.data.class).toBe('Ashwalker');
  expect(result.data.pseudo_class_tagline).toBe('Walks the ash');
  expect(result.data.pseudo_class_description).toBe('A long tale.');
  expect(result.data).not.toHaveProperty('pseudo_class');
});

// characters.class is TEXT NOT NULL with no default
// (20240101000000_baseline_schema.sql:46) and resolveCharacterClassReference
// (models/character.js:24-45) only fills class FROM a class_id. Aspiring has no
// class_id, so without this mapping the insert fails outright.
test('an aspiring character keeps a null class_id', () => {
  const result = normalizeCharacterInput({
    name: 'Vesper', creator_mode: 'aspiring', class_id: null,
    pseudo_class: { name: 'Ashwalker', tagline: '', description: '' },
    trait0: 'brave', trait1: 'calm', trait2: 'alert'
  }, { rulesVersion: 'v1' });

  expect(result.data.class_id).toBeNull();
  expect(result.data.class).toBe('Ashwalker');
});

// Blank tagline and description are stored as null, not empty string, so the
// column's nullability keeps meaning "this character has none".
test('blank pseudo-class prose becomes null', () => {
  const result = normalizeCharacterInput({
    name: 'Vesper', creator_mode: 'aspiring',
    pseudo_class: { name: 'Ashwalker', tagline: '   ', description: '' },
    trait0: 'brave', trait1: 'calm', trait2: 'alert'
  }, { rulesVersion: 'v1' });

  expect(result.data.pseudo_class_tagline).toBeNull();
  expect(result.data.pseudo_class_description).toBeNull();
});

// Non-aspiring payloads must not grow the columns, or an advent character
// round-trips with keys it never had.
test('a non-aspiring payload is untouched by the pseudo-class mapping', () => {
  const result = normalizeCharacterInput({
    name: 'Kell', creator_mode: 'advent', class: 'Gunslinger'
  }, { rulesVersion: 'v1' });

  expect(result.data.class).toBe('Gunslinger');
  expect(result.data).not.toHaveProperty('pseudo_class_tagline');
  expect(result.data).not.toHaveProperty('pseudo_class_description');
});

const aspiringBody = (overrides = {}) => ({
  name: 'Vesper',
  creator_mode: 'aspiring',
  pseudo_class: { name: 'Ashwalker', tagline: '', description: '' },
  gear: [
    { name: 'Knife', class_id: 'class-a' },
    { name: 'Rope', class_id: 'class-b' },
    { name: 'Lamp', class_id: 'class-c' }
  ],
  abilities: [
    { name: 'Dodge', class_id: 'class-a', type: 'core' },
    { name: 'Parry', class_id: 'class-b', type: 'core' },
    { name: 'Overdrive', class_id: 'class-c', type: 'advanced' }
  ],
  ...overrides
});

// The builder fills exactly six slots (public/js/character-wizard.js:1489-1510).
// POST /characters/wizard is otherwise mode-agnostic, so this is the only place
// a malformed aspiring build is stopped before the insert.
test('accepts a well-formed aspiring submit', () => {
  const result = normalizeWizardPayload(aspiringBody());
  expect(result.error).toBeNull();
});

test('rejects an aspiring submit without three gear picks', () => {
  const result = normalizeWizardPayload(aspiringBody({
    gear: [{ name: 'Knife', class_id: 'class-a' }]
  }));
  expect(result.data).toBeNull();
  expect(result.error).toMatch(/three gear/i);
});

test('rejects an aspiring submit without two core and one advanced ability', () => {
  const result = normalizeWizardPayload(aspiringBody({
    abilities: [
      { name: 'Dodge', class_id: 'class-a', type: 'core' },
      { name: 'Parry', class_id: 'class-b', type: 'core' },
      { name: 'Guard', class_id: 'class-c', type: 'core' }
    ]
  }));
  expect(result.data).toBeNull();
  expect(result.error).toMatch(/two core/i);
});

// Without a name there is nothing to put in characters.class, which is NOT NULL.
test('rejects an aspiring submit with a blank pseudo-class name', () => {
  const result = normalizeWizardPayload(aspiringBody({
    pseudo_class: { name: '   ', tagline: '', description: '' }
  }));
  expect(result.data).toBeNull();
  expect(result.error).toMatch(/class name/i);
});

// Advent and aspirant submits must not be held to the aspiring build rules.
test('leaves a non-aspiring submit unvalidated by the aspiring rules', () => {
  const result = normalizeWizardPayload({
    name: 'Kell', creator_mode: 'advent', class_id: 'class-a'
  });
  expect(result.error).toBeNull();
});

// Nothing upstream allowlists the wizard payload (routes/characters.js parses a
// single client-supplied `payload` field), so a hand-crafted advent or aspirant
// body can carry a pseudo_class object. Only aspiring is class-less; mapping it
// in any other mode would overwrite the denormalized `class` display name while
// class_id still points at the catalog row it no longer matches.
test('an advent payload carrying a pseudo_class keeps its own class', () => {
  const result = normalizeCharacterInput({
    name: 'Kell', creator_mode: 'advent', class: 'Gunslinger', class_id: 'class-a',
    pseudo_class: { name: 'Ashwalker', tagline: 'Walks the ash', description: 'A long tale.' }
  }, { rulesVersion: 'v1' });

  expect(result.error).toBeNull();
  expect(result.data.class).toBe('Gunslinger');
  expect(result.data.class_id).toBe('class-a');
  expect(result.data).not.toHaveProperty('pseudo_class_tagline');
  expect(result.data).not.toHaveProperty('pseudo_class_description');
  expect(result.data).not.toHaveProperty('pseudo_class');
});

test('an aspirant payload carrying a pseudo_class keeps its own class', () => {
  const result = normalizeCharacterInput({
    name: 'Kell', creator_mode: 'aspirant', class: 'Gunslinger', class_id: 'class-a',
    pseudo_class: { name: 'Ashwalker', tagline: 'Walks the ash', description: 'A long tale.' }
  }, { rulesVersion: 'v1' });

  expect(result.error).toBeNull();
  expect(result.data.class).toBe('Gunslinger');
  expect(result.data.class_id).toBe('class-a');
  expect(result.data).not.toHaveProperty('pseudo_class_tagline');
  expect(result.data).not.toHaveProperty('pseudo_class_description');
  expect(result.data).not.toHaveProperty('pseudo_class');
});

// --- shapeTrait / validateTraits ----------------------------------------

test('a vocabulary word resolves to its Stat without a submitted stat', () => {
  const { value, error } = shapeTrait('brave', {});
  expect(error).toBeNull();
  expect(value.stat).toBe(personalityMap.might.includes('brave') ? 'might' : value.stat);
});

test('a submitted stat wins for a self-made word', () => {
  const { value, error } = shapeTrait('moonstruck', { submittedStat: 'arcane' });
  expect(error).toBeNull();
  expect(value).toEqual({ name: 'moonstruck', stat: 'arcane' });
});

test('an unresolvable Trait is refused, never stored with a null stat', () => {
  const { value, error } = shapeTrait('moonstruck', {});
  expect(value).toBeUndefined();
  expect(error).toMatch(/moonstruck/);
});

test('a submitted stat outside the twelve is refused', () => {
  expect(shapeTrait('moonstruck', { submittedStat: 'vibes' }).error).toMatch(/vibes/);
});

// A Trait is a single word (pg. 6, pg. 121). The book states no word COUNT
// limit, unlike Enchantments (40) and Mods (10), so none is invented.
// The test is for WHITESPACE, not for letters only: `fun-loving` is a real
// vocabulary word.
test('a hyphenated vocabulary word is accepted and a two-word name is not', () => {
  expect(shapeTrait('fun-loving', {}).error).toBeNull();
  expect(shapeTrait('very brave', { submittedStat: 'might' }).error).toMatch(/single word/);
});

test('V1 economies require exactly three Traits, each on its own Stat', () => {
  const three = [
    { name: 'brave', stat: 'might' }, { name: 'calm', stat: 'will' }, { name: 'sharp', stat: 'sensory' }
  ];
  expect(validateTraits(three, { economy: 'aspirant' })).toEqual({ ok: true });
  expect(validateTraits(three.slice(0, 2), { economy: 'aspirant' }).ok).toBe(false);
  const collide = [{ name: 'brave', stat: 'might' }, { name: 'bold', stat: 'might' }, { name: 'calm', stat: 'will' }];
  expect(validateTraits(collide, { economy: 'aspirant' }).ok).toBe(false);
});

// 26 of the 327 live characters have two Traits on one Stat and all 26 are
// advent. Enforcing there would make them unsaveable.
test('advent is not held to either Trait rule', () => {
  const collide = [{ name: 'brave', stat: 'might' }, { name: 'bold', stat: 'might' }];
  expect(validateTraits(collide, { economy: 'advent' })).toEqual({ ok: true });
});

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

test('a default enchantment normalizes to its source alone', () => {
  expect(normalizeGearEquipment({ name: 'Hat', enchantment: { source: 'default' } }).enchantment)
    .toEqual({ source: 'default' });
});

test('a default enchantment does not keep a submitted name or description', () => {
  // The text lives on the class; storing a copy would let it drift from the
  // class page and would make an errata invisible to the character.
  const { enchantment } = normalizeGearEquipment({
    name: 'Hat',
    enchantment: { source: 'default', name: 'Whatever', description: 'Made up.' }
  });
  expect(enchantment).toEqual({ source: 'default' });
});

test('a custom enchantment keeps its trimmed name and description', () => {
  const { enchantment } = normalizeGearEquipment({
    name: 'Hat',
    enchantment: { source: 'custom', name: '  Ported  ', description: '  Retooled.  ' }
  });
  expect(enchantment).toEqual({ source: 'custom', name: 'Ported', description: 'Retooled.' });
});

// Three submission states must stay distinguishable end to end: no key means
// "say nothing about equipment" (a resave must leave a stored purchase
// alone), an explicit null means "remove it", and an object means "set it".
// `?? null` cannot tell the first two apart, which is what let an ordinary
// object submission wipe a paid-for Enchantment before this normalizer used
// an `in` check.
test('an item that mentions no equipment produces no equipment keys', () => {
  expect(normalizeGearEquipment({ name: 'Hat' })).toEqual({});
});

test('an explicit null enchantment normalizes to null and stays present', () => {
  expect(normalizeGearEquipment({ name: 'Hat', enchantment: null })).toEqual({ enchantment: null });
});

test('a submitted enchantment object normalizes to the enchantment and stays present', () => {
  expect(normalizeGearEquipment({ name: 'Hat', enchantment: { source: 'default' } }))
    .toEqual({ enchantment: { source: 'default' } });
});

test('an explicit null mods normalizes to an empty array and stays present', () => {
  expect(normalizeGearEquipment({ name: 'Hat', mods: null })).toEqual({ mods: [] });
});

test('submitted mods normalize to the mods array and stay present', () => {
  expect(normalizeGearEquipment({ name: 'Hat', mods: [{ name: 'Lined' }] }))
    .toEqual({ mods: [{ name: 'Lined', description: '' }] });
});

// A thrown Error here would hang POST /characters/wizard and POST /characters
// (no asyncHandler wraps either) and would lose its message on PUT
// /characters/:id (a bare Error has no `.code`, so util/http-error.js
// classifyError falls to its generic "unexpected error" text in production).
// So every rejection below is asserted through validateGearEquipment's
// returned errors, never through a throw.

test('a custom enchantment at the 40-word limit is accepted', () => {
  const item = { name: 'Hat', enchantment: { source: 'custom', name: 'Long', description: words(ENCHANTMENT_WORD_LIMIT) } };
  expect(validateGearEquipment([item])).toEqual({ ok: true });
});

test('a custom enchantment over 40 words is rejected', () => {
  const item = { name: 'Hat', enchantment: { source: 'custom', name: 'Long', description: words(ENCHANTMENT_WORD_LIMIT + 1) } };
  const result = validateGearEquipment([item]);
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/40 words/);
});

test('Power Rating superscripts do not count against the 40 words', () => {
  const description = `${words(ENCHANTMENT_WORD_LIMIT)} <sup>L–H</sup> <sup>M</sup>`;
  const item = { name: 'Hat', enchantment: { source: 'custom', name: 'Rated', description } };
  expect(validateGearEquipment([item])).toEqual({ ok: true });
});

test('a custom enchantment with no name is rejected', () => {
  const item = { name: 'Hat', enchantment: { source: 'custom', name: '  ', description: 'x' } };
  const result = validateGearEquipment([item]);
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/name/i);
});

test('an unknown enchantment source is rejected', () => {
  const item = { name: 'Hat', enchantment: { source: 'legendary' } };
  const result = validateGearEquipment([item]);
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/default|custom/);
});

// A present-but-wrong-typed source (not a string, not null/absent) is a
// malformed payload, not a cleared field -- it must be reported the same way
// a wrong string is, not silently collapsed to "no enchantment submitted".
test('a non-string enchantment source is rejected rather than silently dropped', () => {
  const item = { name: 'Hat', enchantment: { source: 5 } };
  const result = validateGearEquipment([item]);
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/default|custom/);
});

// Shaping alone never throws or rejects -- it shapes an invalid submission to
// "no enchantment" and leaves judging it to validateGearEquipment, which
// normalizeCharacterInput always calls first.
test('normalizeGearEquipment shapes an invalid enchantment to null rather than throwing', () => {
  expect(() => normalizeGearEquipment({ name: 'Hat', enchantment: { source: 'legendary' } })).not.toThrow();
  expect(normalizeGearEquipment({ name: 'Hat', enchantment: { source: 'legendary' } }).enchantment).toBeNull();
});

test('a mod over 10 words is rejected', () => {
  const item = { name: 'Hat', mods: [{ name: 'Big', description: words(MOD_WORD_LIMIT + 1) }] };
  const result = validateGearEquipment([item]);
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/10 words/);
});

test('a third mod on one Signature is rejected', () => {
  const item = { name: 'Hat', mods: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] };
  const result = validateGearEquipment([item]);
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/two Mods/i);
});

test('an unnamed mod is dropped rather than stored nameless', () => {
  // A Mod "should be named for easy reference during play" (pg. 87), and a
  // blank row is a UI artifact, not a purchase -- the same treatment
  // util/class-gear.js gives a blank note.
  expect(normalizeGearEquipment({ name: 'Hat', mods: [{ name: '  ' }, { name: 'Lined' }] }).mods)
    .toEqual([{ name: 'Lined', description: '' }]);
});

// End to end through the one place both createCharacter and updateCharacter
// funnel gear/abilities before reconcileGear/reconcileAbilities or the atomic
// save ever see them, returning the established { data: null, error } shape
// rather than throwing or rejecting the promise.
test('normalizeCharacterInput rejects a submitted gear item with an over-limit Custom Enchantment', () => {
  const result = normalizeCharacterInput({
    name: 'Vex',
    gear: [{
      name: 'Hat', class_id: 'class-a',
      enchantment: { source: 'custom', name: 'Long', description: words(ENCHANTMENT_WORD_LIMIT + 1) }
    }]
  }, { rulesVersion: 'v1' });
  expect(result.data).toBeNull();
  expect(result.childData).toBeNull();
  expect(result.error).toMatch(/40 words/);
});

// Abilities never carry equipment in the shipped UI, but normalizeClassItems
// runs the same shaping/validation for both, so a crafted ability payload is
// held to the same rules rather than passing through unchecked.
test('normalizeCharacterInput rejects a submitted ability item with a third Mod', () => {
  const result = normalizeCharacterInput({
    name: 'Vex',
    abilities: [{ name: 'Dodge', class_id: 'class-a', mods: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }]
  }, { rulesVersion: 'v1' });
  expect(result.data).toBeNull();
  expect(result.error).toMatch(/two Mods/i);
});

const V1_ARTIFACT = require('../../docs/data/aspirant-v1-classes-2026-09.json');

const everyDefaultEnchantment = () => {
  const classes = Array.isArray(V1_ARTIFACT) ? V1_ARTIFACT : V1_ARTIFACT.classes;
  return classes.flatMap((cls) => (cls.gear || [])
    .map((item) => item.default_enchantment)
    .filter(Boolean));
};

// The 40-word limit governs a player's Custom Enchantment, not the book's
// printed Defaults -- but the Defaults are the only rated prose of this kind
// that exists, so they are what the counter can be measured against.
test('every printed Default Enchantment counts within 40 words once ratings are excluded', () => {
  const enchantments = everyDefaultEnchantment();
  expect(enchantments).toHaveLength(144);
  const over = enchantments.filter(
    (e) => countWordsExcludingRatings(e.description) > ENCHANTMENT_WORD_LIMIT
  );
  expect(over).toEqual([]);
});

// This is the case that makes the exclusion rule load-bearing rather than
// decorative. Counting a <sup>L-H</sup> as a word puts five of the book's own
// Enchantments over the book's own limit -- Thane's Billhook at 41 against 40.
test('counting Power Rating superscripts as words would breach the limit five times', () => {
  const naiveCount = (text) => String(text ?? '').trim().split(/\s+/).length;
  const breaches = everyDefaultEnchantment()
    .filter((e) => naiveCount(e.description) > ENCHANTMENT_WORD_LIMIT);
  expect(breaches).toHaveLength(5);
});

// --- validateEconomyLimits: the Merx budget and Signature Cap -----------
//
// Reports like validateGearEquipment -- `{ ok: true }` or `{ ok: false,
// errors }` -- never a throw. See the function's own comment in input.js for
// why: a throw here would hang POST /characters/wizard and POST /characters
// (neither route has an asyncHandler wrapper) and would lose its message on
// PUT /characters/:id (classifyError's generic "unexpected error" text).

const ASPIRANT = { economy: 'aspirant', characterClassId: 'v1', earnedMerx: 0 };
const own = (n) => Array.from({ length: n }, (_, i) => ({ name: `S${i}`, class_id: 'v1' }));

test('six own-class Signatures fit the 12-Merx grant', () => {
  expect(validateEconomyLimits({ ...ASPIRANT, gear: own(6), commonItems: [] })).toEqual({ ok: true });
});

test('a seventh own-class Signature is over budget', () => {
  const result = validateEconomyLimits({ ...ASPIRANT, gear: own(7), commonItems: [] });
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/Merx/);
});

test('mission earnings raise the budget', () => {
  expect(validateEconomyLimits({
    ...ASPIRANT, gear: own(7), commonItems: [], earnedMerx: 2
  })).toEqual({ ok: true });
});

test('an Enchantment is charged against the budget', () => {
  const gear = own(5);
  gear[0].enchantment = { source: 'default' };
  // 5 Signatures (10) + one Default Enchantment (2) = 12, exactly the grant.
  expect(validateEconomyLimits({ ...ASPIRANT, gear, commonItems: [] })).toEqual({ ok: true });
  gear[1].enchantment = { source: 'default' };
  const result = validateEconomyLimits({ ...ASPIRANT, gear, commonItems: [] });
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/Merx/);
});

test('common items are charged against the budget', () => {
  const result = validateEconomyLimits({ ...ASPIRANT, gear: own(6), commonItems: ['Bedroll'] });
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/Merx/);
});

// pg. 8: six enchanted Signatures fill the cap of twelve, so a seventh
// Signature cannot be carried at all -- independent of Merx.
test('the Signature Cap counts an Enchantment as a slot', () => {
  const gear = own(6).map((g) => ({ ...g, enchantment: { source: 'default' } }));
  expect(validateEconomyLimits({
    ...ASPIRANT, gear, commonItems: [], earnedMerx: 100
  })).toEqual({ ok: true });
  const result = validateEconomyLimits({
    ...ASPIRANT, gear: [...gear, { name: 'One More', class_id: 'v1' }],
    commonItems: [], earnedMerx: 100
  });
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/Signature Cap|12/);
});

test('aspiring is capped at eight slots and granted ten Merx', () => {
  const picks = [
    { name: 'A', class_id: 'class-a' },
    { name: 'B', class_id: 'class-b' },
    { name: 'C', class_id: 'class-c' }
  ];
  expect(validateEconomyLimits({
    economy: 'aspiring', characterClassId: null, earnedMerx: 0, gear: picks, commonItems: []
  })).toEqual({ ok: true });
  const nine = Array.from({ length: 9 }, (_, i) => ({ name: `S${i}`, class_id: 'class-a' }));
  const result = validateEconomyLimits({
    economy: 'aspiring', characterClassId: null, earnedMerx: 100, gear: nine, commonItems: []
  });
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/Signature Cap|8/);
});

// Review round 1, Finding 3: the aspiring cap's passing side (exactly at the
// boundary, not comfortably under it) was never asserted, so a `>` that
// regressed to `>=` would reject a legal 8-slot build and nothing would catch
// it. earnedMerx is generous enough that only the cap, not the budget, could
// be doing the rejecting.
test('exactly eight Signatures fit the aspiring cap', () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ name: `S${i}`, class_id: 'class-a' }));
  expect(validateEconomyLimits({
    economy: 'aspiring', characterClassId: null, earnedMerx: 100, gear: eight, commonItems: []
  })).toEqual({ ok: true });
});

// 327 characters were built with no budget and no measurement says they pass.
test('the advent economy enforces nothing', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, class_id: 'advent' }));
  expect(validateEconomyLimits({
    economy: 'advent', characterClassId: 'advent', earnedMerx: 0, gear: twenty, commonItems: []
  })).toEqual({ ok: true });
});

// --- normalizeCharacterInput wires validateEconomyLimits in -------------
//
// context.contentFormat is what the caller (CharacterService.createCharacter)
// threads in after resolving the class -- economyFor needs it to tell an
// aspirant-content class from an advent one, since creator_mode alone cannot.

test('normalizeCharacterInput rejects an aspirant character over its Merx budget', () => {
  const result = normalizeCharacterInput({
    name: 'Vex', creator_mode: 'aspirant', class_id: 'v1',
    gear: own(7)
  }, { rulesVersion: 'v1', contentFormat: 'aspirant' });
  expect(result.data).toBeNull();
  expect(result.childData).toBeNull();
  expect(result.error).toMatch(/Merx/);
});

test('normalizeCharacterInput accepts an aspirant character within its Merx budget', () => {
  const result = normalizeCharacterInput({
    name: 'Vex', creator_mode: 'aspirant', class_id: 'v1',
    gear: own(6), trait0: 'brave', trait1: 'calm', trait2: 'alert'
  }, { rulesVersion: 'v1', contentFormat: 'aspirant' });
  expect(result.error).toBeNull();
});

test('normalizeCharacterInput leaves an advent character unenforced', () => {
  const result = normalizeCharacterInput({
    name: 'Vex', creator_mode: 'advent', class_id: 'class-a',
    gear: Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, class_id: 'class-a' }))
  }, { rulesVersion: 'v1', contentFormat: 'advent' });
  expect(result.error).toBeNull();
});

// --- the gate judges what will be STORED, not what was submitted ---------
//
// Whole-plan review, Important 2: validateEconomyLimits was handed the raw
// submission, so it priced and counted equipment that normalization drops.
// A gate that refuses a save the rules permit is the exact failure mode
// validateEconomyLimits's own comment calls worse than not checking at all.

test('an Enchantment that normalizes to nothing costs no Signature Cap slot', () => {
  // `enchantment: {}` carries no source, so shapeEnchantment stores null --
  // nothing is stored, so nothing may be counted. Seven such items are 7 of
  // the 12 aspirant slots, not 14.
  const gear = own(7).map((g) => ({ ...g, enchantment: {} }));
  const result = normalizeCharacterInput({
    name: 'Vex', creator_mode: 'aspirant', class_id: 'v1', gear,
    trait0: 'brave', trait1: 'calm', trait2: 'alert'
  }, { rulesVersion: 'v1', contentFormat: 'aspirant', enforceMerxBudget: false });
  expect(result.error).toBeNull();
});

test('a real Enchantment still costs a Signature Cap slot', () => {
  const gear = own(7).map((g) => ({ ...g, enchantment: { source: 'default' } }));
  const result = normalizeCharacterInput({
    name: 'Vex', creator_mode: 'aspirant', class_id: 'v1', gear
  }, { rulesVersion: 'v1', contentFormat: 'aspirant', enforceMerxBudget: false });
  expect(result.error).toMatch(/Signature Cap|12/);
});

test('Mods that normalize away are not charged Merx', () => {
  // Two blank-named Mods shape to [] -- nothing is stored -- so the item
  // costs its bare 2 Merx and the six Signatures spend exactly the grant.
  const gear = own(6);
  gear[0] = { ...gear[0], mods: [{ name: '' }, { name: '  ' }] };
  const result = normalizeCharacterInput({
    name: 'Vex', creator_mode: 'aspirant', class_id: 'v1', gear,
    trait0: 'brave', trait1: 'calm', trait2: 'alert'
  }, { rulesVersion: 'v1', contentFormat: 'aspirant' });
  expect(result.error).toBeNull();
});

test('a real Mod is still charged Merx', () => {
  const gear = own(6);
  gear[0] = { ...gear[0], mods: [{ name: 'Serrated' }] };
  const result = normalizeCharacterInput({
    name: 'Vex', creator_mode: 'aspirant', class_id: 'v1', gear
  }, { rulesVersion: 'v1', contentFormat: 'aspirant' });
  expect(result.error).toMatch(/Merx/);
});

test('the gate counts a bare "Class::Item" submission as one slot each', () => {
  const gear = Array.from({ length: 13 }, (_, i) => `Aspira::S${i}`);
  const result = normalizeCharacterInput({
    name: 'Vex', creator_mode: 'aspirant', class_id: 'v1', gear
  }, { rulesVersion: 'v1', contentFormat: 'aspirant', enforceMerxBudget: false });
  expect(result.error).toMatch(/Signature Cap|12/);
});

// --- the Signature Cap counts preserved equipment too --------------------
//
// Whole-plan review, Important 1: the cap was taken against the submitted
// list, but an item that omits `enchantment` keeps its stored one, so the cap
// was breachable across two saves. context.storedGear is the character's
// current class_gear rows, which updateCharacter already has in hand.

const enchanted = (n, classId = 'v1') => Array.from({ length: n }, (_, i) => ({
  name: `S${i}`, class_id: classId, enchantment: { source: 'default' }
}));

test('six stored Enchantments plus twelve bare Signatures breaches the cap', () => {
  // The two-save route: save 6 enchanted Signatures (12 slots, legal), then
  // submit 12 items whose first 6 omit `enchantment` and so keep theirs. The
  // effective character carries 12 Signatures + 6 Enchantments = 18 slots.
  const submitted = Array.from({ length: 12 }, (_, i) => ({ name: `S${i}`, class_id: 'v1' }));
  const result = validateEconomyLimits({
    ...ASPIRANT, gear: submitted, storedGear: enchanted(6), commonItems: [],
    enforceMerxBudget: false
  });
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/Signature Cap|18/);
});

test('a legitimate twelve-slot update is still accepted', () => {
  // Re-saving the same six enchanted Signatures is exactly the cap, not over
  // it: each submitted item claims its own stored row, so no Enchantment is
  // counted twice.
  const submitted = Array.from({ length: 6 }, (_, i) => ({ name: `S${i}`, class_id: 'v1' }));
  expect(validateEconomyLimits({
    ...ASPIRANT, gear: submitted, storedGear: enchanted(6), commonItems: [],
    enforceMerxBudget: false
  })).toEqual({ ok: true });
});

test('removing a stored Enchantment frees its slot', () => {
  const submitted = Array.from({ length: 12 }, (_, i) => ({
    name: `S${i}`, class_id: 'v1', ...(i < 6 ? { enchantment: null } : {})
  }));
  expect(validateEconomyLimits({
    ...ASPIRANT, gear: submitted, storedGear: enchanted(6), commonItems: [],
    enforceMerxBudget: false
  })).toEqual({ ok: true });
});

test('an advent update pays nothing for stored equipment', () => {
  expect(validateEconomyLimits({
    economy: 'advent', characterClassId: 'advent', gear: own(20),
    storedGear: enchanted(20, 'advent'), commonItems: [], enforceMerxBudget: false
  })).toEqual({ ok: true });
});

test('normalizeCharacterInput threads context.storedGear into the cap', () => {
  const gear = Array.from({ length: 12 }, (_, i) => `Aspira::S${i}`);
  const result = normalizeCharacterInput({
    name: 'Vex', creator_mode: 'aspirant', class_id: 'v1', gear
  }, {
    rulesVersion: 'v1', contentFormat: 'aspirant', enforceMerxBudget: false,
    storedGear: enchanted(6)
  });
  expect(result.error).toMatch(/Signature Cap|18/);
});
