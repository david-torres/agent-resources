const { test, expect } = require('bun:test');
const {
  normalizeCharacterInput, normalizeGearItems, normalizeAbilityItems, normalizeGearEquipment,
  validateGearEquipment, validateEconomyLimits, shapeTrait, validateTraits, validateStatLimits,
  normalizeAspiringAbilities, validateAspiringBuild
} = require('./input');
const { countWordsExcludingRatings, ENCHANTMENT_WORD_LIMIT, MOD_WORD_LIMIT } = require('../../util/merx-economy');
const { personalityMap, statList } = require('../../util/enclave-consts');
const { normalizeLevel, capBreachMessage } = require('../../util/stat-caps');

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

// normalizeWizardPayload only trims/coerces the top-level fields it names
// (name, level, stats, ...); it never touches body.gear, so a Signature's
// Enchantment and Mods -- the shape the wizard's serializePayload now sends --
// ride through untouched, for validateGearEquipment/normalizeGearEquipment
// further down normalizeCharacterInput's pipeline to judge and shape.
test('normalizeWizardPayload leaves a Signature\'s Enchantment and Mods untouched', () => {
  const { data, error } = normalizeWizardPayload({
    name: 'Hero',
    creator_mode: 'aspirant',
    gear: [{
      name: 'Cowboy Hat',
      class_id: 'v1',
      enchantment: { source: 'default' },
      mods: [{ name: 'Scope', description: 'Sees far' }]
    }]
  });
  expect(error).toBeNull();
  expect(data.gear).toEqual([{
    name: 'Cowboy Hat',
    class_id: 'v1',
    enchantment: { source: 'default' },
    mods: [{ name: 'Scope', description: 'Sees far' }]
  }]);
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
  aspiring_signatures: [
    { class_id: 'class-a', name: 'Knife' },
    { class_id: 'class-b', name: 'Rope' },
    { class_id: 'class-c', name: 'Lamp' }
  ],
  aspiring_abilities: [
    { class_id: 'class-a', name: 'Dodge', type: 'core' },
    { class_id: 'class-b', name: 'Parry', type: 'core' },
    { class_id: 'class-c', name: 'Overdrive', type: 'advanced' }
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

test('rejects an aspiring submit without three Signature picks', () => {
  const result = normalizeWizardPayload(aspiringBody({
    aspiring_signatures: [{ class_id: 'class-a', name: 'Knife' }]
  }));
  expect(result.data).toBeNull();
  expect(result.error).toMatch(/three Signature picks/i);
});

test('rejects an aspiring submit without two Core and one Advanced ability pick', () => {
  const result = normalizeWizardPayload(aspiringBody({
    aspiring_abilities: [
      { class_id: 'class-a', name: 'Dodge', type: 'core' },
      { class_id: 'class-b', name: 'Parry', type: 'core' },
      { class_id: 'class-c', name: 'Guard', type: 'core' }
    ]
  }));
  expect(result.data).toBeNull();
  expect(result.error).toMatch(/two Core Ability picks/i);
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

const aspiringInput = (overrides = {}) => ({
  name: 'Vesper',
  creator_mode: 'aspiring',
  class_id: null,
  aspiring_signatures: [
    { class_id: 'a', name: 'A' },
    { class_id: 'b', name: 'B' },
    { class_id: 'c', name: 'C' }
  ],
  gear: [
    { name: 'A', class_id: 'a' },
    { name: 'B', class_id: 'b' },
    { name: 'C', class_id: 'c' }
  ],
  trait0: 'brave', trait1: 'calm', trait2: 'alert',
  ...overrides
});

const aspiringContext = (overrides = {}) => ({
  rulesVersion: 'v1',
  ...overrides
});

const adventInput = (overrides = {}) => ({
  name: 'Kell',
  creator_mode: 'advent',
  class_id: 'class-a',
  ...overrides
});

const adventContext = (overrides = {}) => ({
  rulesVersion: 'v1',
  contentFormat: 'advent',
  ...overrides
});

// The pool is the Class an Aspiring character invents, so its three-ness
// binds the pool, not the gear array -- which now also holds anything the
// character bought with the rest of its grant.
test('an aspiring build needs exactly three Signature picks', () => {
  const { error } = normalizeWizardPayload(aspiringBody({
    aspiring_signatures: [{ class_id: 'a', name: 'A' }, { class_id: 'b', name: 'B' }]
  }));
  expect(error).toMatch(/three Signature picks/);
});

test('an aspiring build needs its three picks from three different classes', () => {
  const { error } = normalizeWizardPayload(aspiringBody({
    aspiring_signatures: [
      { class_id: 'a', name: 'A' },
      { class_id: 'a', name: 'A2' },
      { class_id: 'b', name: 'B' }
    ]
  }));
  expect(error).toMatch(/three different classes/);
});

// The fourth Signature the pool makes affordable must not be refused by a
// count check that used to live on the gear array.
test('an aspiring build may own a fourth Signature', () => {
  const { data, error } = normalizeWizardPayload(aspiringBody({
    gear: [
      { name: 'A', class_id: 'a' },
      { name: 'B', class_id: 'b' },
      { name: 'C', class_id: 'c' },
      { name: 'D', class_id: 'd' }
    ]
  }));
  expect(error).toBeNull();
  expect(data.gear).toHaveLength(4);
});

// Choosing the three defines the Class; it does not compel buying them.
// Creation spends the 10-Merx grant however it likes, exactly as aspirant
// spends 12 (pg. 3). All three, some, or none are each a legal build.
test('an aspiring build may own none of its three picks', () => {
  const { data, error } = normalizeWizardPayload(aspiringBody({ gear: [] }));
  expect(error).toBeNull();
  expect(data.aspiring_signatures).toHaveLength(3);
});

// The wizard omits payload.gear entirely when nothing was bought
// (public/js/character-wizard.js:3818 only sets it for a non-empty list),
// so the absent key -- not just an empty array -- has to be a legal save.
test('an aspiring build with no gear key at all is legal', () => {
  const body = aspiringBody();
  delete body.gear;
  const { error } = normalizeWizardPayload(body);
  expect(error).toBeNull();
});

// Buying none of the three and two cross-class Signatures instead is 6 of
// 10 -- legal, and priced at the cross tier because neither is in the pool.
test('an aspiring build may spend its grant entirely outside the pool', () => {
  const { error } = normalizeCharacterInput(aspiringInput({
    gear: [
      { name: 'Y', class_id: 'y' },
      { name: 'Z', class_id: 'z' }
    ]
  }), { ...aspiringContext(), isCreation: true });
  expect(error).toBeNull();
});

// 3 own-class picks (6) plus one cross-class fourth (3) is 9 of 10.
test('a creation is priced against the pool', () => {
  const { error } = normalizeCharacterInput(aspiringInput({
    gear: [
      { name: 'A', class_id: 'a' },
      { name: 'B', class_id: 'b' },
      { name: 'C', class_id: 'c' },
      { name: 'D', class_id: 'd' }
    ]
  }), { ...aspiringContext(), isCreation: true });
  expect(error).toBeNull();
});

// Two cross-class extras is 6 + 3 + 3 = 12, over the 10-Merx grant.
test('a creation over budget against the pool is refused', () => {
  const { error } = normalizeCharacterInput(aspiringInput({
    gear: [
      { name: 'A', class_id: 'a' },
      { name: 'B', class_id: 'b' },
      { name: 'C', class_id: 'c' },
      { name: 'D', class_id: 'd' },
      { name: 'E', class_id: 'e' }
    ]
  }), { ...aspiringContext(), isCreation: true });
  expect(error).toMatch(/spends 12 Merx of 10/);
});

// An update must not carry the key at all: a present key is authoritative to
// save_character_atomic, so sending [] would wipe the character's Class.
test('an update never carries the pool', () => {
  const { data } = normalizeCharacterInput(aspiringInput({}), { ...aspiringContext(), isCreation: false });
  expect('aspiring_signatures' in data).toBe(false);
});

// The column is the own-class answer for a class-less character; a crafted
// payload must not hand a classed one a second answer.
test('a non-aspiring creation never carries the pool', () => {
  const { data } = normalizeCharacterInput(
    { ...adventInput(), aspiring_signatures: [{ class_id: 'a', name: 'A' }] },
    { ...adventContext(), isCreation: true }
  );
  expect('aspiring_signatures' in data).toBe(false);
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
  expect(personalityMap.might.includes('brave')).toBe(true);
  expect(value.stat).toBe('might');
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

// --- validateStatLimits: the per-stat Cap and the creation allotment ----
//
// Reports like validateEconomyLimits -- `{ ok: true }` or `{ ok: false,
// errors }` -- never a throw. See validateStatLimits's own comment in
// input.js for why: a throw here would hang POST /characters/wizard and
// POST /characters (neither route has an asyncHandler wrapper) and would
// lose its message on PUT /characters/:id (classifyError's generic
// "unexpected error" text).

// Distributes `total` pluses across as many stats as it needs, never more
// than 3 to a stat, so a large total can be asserted against the plus
// allotment without also tripping the +++ creation ceiling -- the two rules
// are independent and a test for one should not accidentally exercise the
// other.
const spreadStats = (total) => {
  const stats = {};
  let remaining = total;
  for (const stat of statList) {
    if (remaining <= 0) break;
    const amount = Math.min(3, remaining);
    stats[stat] = amount;
    remaining -= amount;
  }
  return stats;
};

test('advent returns ok:true whatever it is given', () => {
  expect(validateStatLimits({
    economy: 'advent', stats: { might: 999 }, traits: [], capPurchases: { might: 999 }
  })).toEqual({ ok: true });
});

test('a stat at its Cap passes and one over it fails, naming the stat, its value and its Cap', () => {
  const atCap = validateStatLimits({
    economy: 'aspirant', stats: { might: 5 }, traits: [], capPurchases: {}, enforceCreationAllotment: false
  });
  expect(atCap).toEqual({ ok: true });

  const overCap = validateStatLimits({
    economy: 'aspirant', stats: { might: 6 }, traits: [], capPurchases: {}, enforceCreationAllotment: false
  });
  expect(overCap.ok).toBe(false);
  // Compared against capBreachMessage rather than a re-typed sentence: the
  // wording has one home (util/stat-caps.js) shared with statCapError on the
  // mutation path, and a literal here would be a third copy of it.
  expect(overCap.errors).toEqual([capBreachMessage({ stat: 'might', value: 6, cap: 5 })]);
});

test('a Trait raises the Cap so the same value passes with the Trait and fails without it', () => {
  const stats = { might: 6 };
  const traits = [{ name: 'brave', stat: 'might' }];
  expect(validateStatLimits({
    economy: 'aspirant', stats, traits, capPurchases: {}, enforceCreationAllotment: false
  })).toEqual({ ok: true });
  expect(validateStatLimits({
    economy: 'aspirant', stats, traits: [], capPurchases: {}, enforceCreationAllotment: false
  }).ok).toBe(false);
});

test('a purchased Cap does the same', () => {
  const stats = { might: 6 };
  expect(validateStatLimits({
    economy: 'aspirant', stats, traits: [], capPurchases: { might: 1 }, enforceCreationAllotment: false
  })).toEqual({ ok: true });
  expect(validateStatLimits({
    economy: 'aspirant', stats, traits: [], capPurchases: {}, enforceCreationAllotment: false
  }).ok).toBe(false);
});

test('the +++ ceiling refuses a 4 at creation and permits it on update', () => {
  const stats = { might: 4 };
  const atCreation = validateStatLimits({
    economy: 'aspirant', stats, traits: [], capPurchases: {}, level: 1
  });
  expect(atCreation.ok).toBe(false);
  expect(atCreation.errors.join(' ')).toMatch(/\+\+\+/);

  const onUpdate = validateStatLimits({
    economy: 'aspirant', stats, traits: [], capPurchases: {}, enforceCreationAllotment: false
  });
  expect(onUpdate).toEqual({ ok: true });
});

// Round 1 finding: creationCeilingBreaches was running at every level, so a
// level-10 character (a normal flow -- normalizeWizardPayload accepts and
// clamps a submitted level, and plusAllotment grants 24 pluses at level 10)
// could never legally use most of its allotment. The book's "no Stat above
// +++" (Advent pg. 16 step 4c) governs the six CREATION pluses' distribution,
// not a permanent ceiling, which is why the base Cap of 5 exists above it.
test('the +++ ceiling applies only at level 1: a 4 is refused at level 1 and accepted at level 2', () => {
  const at = (level) => validateStatLimits({
    economy: 'aspirant', stats: { might: 4 }, traits: [], capPurchases: {}, level
  });
  const atLevel1 = at(1);
  expect(atLevel1.ok).toBe(false);
  expect(atLevel1.errors.join(' ')).toMatch(/\+\+\+/);

  expect(at(2)).toEqual({ ok: true });
});

// The ceiling's replacement above level 1 is the per-stat Cap, which already
// runs unconditionally -- this pins that the fix above did not also remove
// enforcement for a high-level character who genuinely over-built a Stat.
test('above level 1, a stat over its derived Cap is still refused', () => {
  const traits = [{ name: 'brave', stat: 'might' }];
  const result = validateStatLimits({
    economy: 'aspirant', stats: { might: 7 }, traits, capPurchases: {}, level: 10
  });
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/might/);
  expect(result.errors.join(' ')).toMatch(/7/);
  expect(result.errors.join(' ')).toMatch(/6/);
});

// Round 2 finding: the ceiling gate re-derived plusAllotment's level clamp
// inline instead of calling util/stat-caps.js's normalizeLevel, so a future
// change to either clamp could make the ceiling and the allotment silently
// disagree about what level a character is. This test drives the ceiling
// gate from normalizeLevel's own output across the edge cases that clamp
// actually has to handle (a string, absent, 0, a fraction) -- not just the
// whole numbers a hand-picked pair of levels would happen to agree on -- so
// it fails the moment the two stop reading the same clamp.
test('the +++ ceiling gate agrees with normalizeLevel for every level shape, not just whole numbers', () => {
  const rawLevels = [1, '1', 0, -3, 1.9, undefined, null, 'nonsense', 2, '5'];
  for (const level of rawLevels) {
    const isLevelOne = normalizeLevel(level) === 1;
    const result = validateStatLimits({
      economy: 'aspirant', stats: { might: 4 }, traits: [], capPurchases: {}, level
    });
    expect(result.ok).toBe(!isLevelOne);
  }
});

// Book figures pinned as the TOTAL of every source together -- Class Stats,
// the third Trait's value grant, and the player's own pluses (Advent pg. 16,
// carried by Aspirant pg. 3; pg. 90 for aspiring) -- not a figure to net
// those automatic grants back out of first. spreadStats builds an arbitrary
// total with no single stat over 3, so this exercises the total check alone,
// independent of the per-stat Cap and the +++ ceiling.
test('aspiring\'s allotment is 4 and aspirant\'s is 6 at level 1, and both grow by 2 per level', () => {
  const at = (economy, level, total) => validateStatLimits({
    economy, stats: spreadStats(total), traits: [], capPurchases: {}, level
  });

  expect(at('aspirant', 1, 6)).toEqual({ ok: true });
  expect(at('aspirant', 1, 7).ok).toBe(false);
  expect(at('aspiring', 1, 4)).toEqual({ ok: true });
  expect(at('aspiring', 1, 5).ok).toBe(false);

  expect(at('aspirant', 2, 8)).toEqual({ ok: true });
  expect(at('aspirant', 2, 9).ok).toBe(false);
  expect(at('aspiring', 2, 6)).toEqual({ ok: true });
  expect(at('aspiring', 2, 7).ok).toBe(false);
});

// Fix round 1: the allotment check used to recover "what the player assigned"
// by subtracting a class spread and a third-Trait grant from the stored
// total, and compared THAT to plusAllotment. That is not what the book
// grants -- the six (or four) is the total, not a post-deduction figure --
// and the bug it produced was silent and one-directional: a real class
// spread of {arcane:1, sensory:2} let a stored total of 10 pass at level 1,
// four pluses over the book's maximum of 6. Comparing the stored total
// directly against plusAllotment, as the wizard's own step-2 display already
// does (public/js/character-wizard.js:810), makes a class's spread
// irrelevant to this check -- it has no parameter to read it from.
test('the allotment checks the stored TOTAL, so a class spread cannot buy extra room', () => {
  // A real class spread (arcane 1, sensory 2) is baked into these totals
  // exactly as it would be on a saved character -- this test does not pass
  // a spread anywhere, because the fixed check has nowhere to put one.
  const atTheBookMaximum = validateStatLimits({
    economy: 'aspirant',
    stats: { arcane: 1, sensory: 2, will: 1, vitality: 1, resilience: 1 }, // totals 6
    traits: [{ name: 'sharp', stat: 'sensory' }],
    capPurchases: {},
    level: 1
  });
  expect(atTheBookMaximum).toEqual({ ok: true });

  const fourOverTheBookMaximum = validateStatLimits({
    economy: 'aspirant',
    stats: { arcane: 1, sensory: 2, will: 1, vitality: 2, resilience: 2, spirit: 2 }, // totals 10
    traits: [{ name: 'sharp', stat: 'sensory' }],
    capPurchases: {},
    level: 1
  });
  expect(fourOverTheBookMaximum.ok).toBe(false);
  expect(fourOverTheBookMaximum.errors.join(' ')).toMatch(/allotment/);
});

// This is the design's most surprising property, pinned directly: the two
// calls below submit the IDENTICAL payload -- same stats, same Traits, same
// level -- a total that a player could only reach by training Stats with
// Merx after creation. The only thing that differs is
// enforceCreationAllotment. If a future edit let the allotment default apply
// on an update path, or passed it 0, this test would start failing every
// character who has ever trained a Stat, silently, since the payload here is
// exactly like theirs.
test('enforceCreationAllotment is the only difference between a passing and failing over-total payload', () => {
  const payload = {
    economy: 'aspirant',
    stats: { vitality: 2, resilience: 2, spirit: 2, luck: 1 }, // totals 7, one over the level-1 allotment of 6
    traits: [],
    capPurchases: {},
    level: 1
  };

  const atCreation = validateStatLimits(payload);
  expect(atCreation.ok).toBe(false);
  expect(atCreation.errors.join(' ')).toMatch(/allotment/);

  const onUpdate = validateStatLimits({ ...payload, enforceCreationAllotment: false });
  expect(onUpdate).toEqual({ ok: true });
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

const ASPIRANT = { economy: 'aspirant', characterClassId: 'v1' };
const own = (n) => Array.from({ length: n }, (_, i) => ({ name: `S${i}`, class_id: 'v1' }));

test('six own-class Signatures fit the 12-Merx grant', () => {
  expect(validateEconomyLimits({ ...ASPIRANT, gear: own(6), commonItems: [] })).toEqual({ ok: true });
});

test('a seventh own-class Signature is over budget', () => {
  const result = validateEconomyLimits({ ...ASPIRANT, gear: own(7), commonItems: [] });
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/Merx/);
});

// The wizard's own gear-payload shape (name, class_id, enchantment, mods)
// run through the real check, naming both figures rather than only "Merx" --
// a player refused a save needs to see what they spent against what they
// were given, not just which currency broke.
test('an over-budget wizard-shaped payload names the spend and the budget', () => {
  const gear = own(7).map((g) => ({ ...g, enchantment: null, mods: [] }));
  const result = validateEconomyLimits({ ...ASPIRANT, gear, commonItems: [] });
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/spends 14 Merx of 12/);
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
    ...ASPIRANT, gear, commonItems: [], enforceMerxBudget: false
  })).toEqual({ ok: true });
  const result = validateEconomyLimits({
    ...ASPIRANT, gear: [...gear, { name: 'One More', class_id: 'v1' }],
    commonItems: [], enforceMerxBudget: false
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
    economy: 'aspiring', characterClassId: null, gear: picks, commonItems: []
  })).toEqual({ ok: true });
  const nine = Array.from({ length: 9 }, (_, i) => ({ name: `S${i}`, class_id: 'class-a' }));
  const result = validateEconomyLimits({
    economy: 'aspiring', characterClassId: null, gear: nine, commonItems: [],
    enforceMerxBudget: false
  });
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toMatch(/Signature Cap|8/);
});

// Review round 1, Finding 3: the aspiring cap's passing side (exactly at the
// boundary, not comfortably under it) was never asserted, so a `>` that
// regressed to `>=` would reject a legal 8-slot build and nothing would catch
// it. The budget is switched off so only the cap, not the spend, could be
// doing the rejecting.
test('exactly eight Signatures fit the aspiring cap', () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ name: `S${i}`, class_id: 'class-a' }));
  expect(validateEconomyLimits({
    economy: 'aspiring', characterClassId: null, gear: eight, commonItems: [],
    enforceMerxBudget: false
  })).toEqual({ ok: true });
});

// 327 characters were built with no budget and no measurement says they pass.
test('the advent economy enforces nothing', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, class_id: 'advent' }));
  expect(validateEconomyLimits({
    economy: 'advent', characterClassId: 'advent', gear: twenty, commonItems: []
  })).toEqual({ ok: true });
});

// --- validateEconomyLimits: the ability cap and Perk balance -------------

const ownAbility = (type) => ({ crossClass: false, type });

test('the ability cap is enforced for an advent character', () => {
  const res = validateEconomyLimits({
    economy: 'advent', gear: [], commonItems: [], level: 1,
    abilities: Array(4).fill(null).map(() => ownAbility('core')), abilityPerks: []
  });
  expect(res.ok).toBe(false);
  expect(res.errors.join(' ')).toContain('4 Abilities, and the cap is 3.');
});

test('an advent character within the cap still passes', () => {
  const res = validateEconomyLimits({
    economy: 'advent', gear: [], commonItems: [], level: 1,
    abilities: [ownAbility('core'), ownAbility('core'), ownAbility('core')], abilityPerks: []
  });
  expect(res.ok).toBe(true);
});

test('the Merx budget is still not enforced for an advent character', () => {
  // 327 existing characters were built with no Merx budget; slice 4 decided
  // deliberately not to start enforcing one, and this task does not change it.
  const res = validateEconomyLimits({
    economy: 'advent', level: 1, abilities: [], abilityPerks: [],
    gear: Array(20).fill({ name: 'X', class_id: 'c1' }), commonItems: []
  });
  expect(res.ok).toBe(true);
});

test('a Perk deficit is an error a player can read', () => {
  const res = validateEconomyLimits({
    economy: 'aspirant', gear: [], commonItems: [], level: 1,
    abilities: [ownAbility('core'), ownAbility('core'), ownAbility('core'), ownAbility('advanced')],
    abilityPerks: []
  });
  expect(res.ok).toBe(false);
  expect(res.errors.join(' ')).toContain('2 Perks spent of 1 earned.');
});

test('a soft breach is never an error', () => {
  const res = validateEconomyLimits({
    economy: 'advent', gear: [], commonItems: [], level: 5, abilityPerks: [],
    abilities: [ownAbility('core'), { crossClass: true, type: 'core' }]
  });
  expect(res.ok).toBe(true);
});

test('enforceAbilityLimits false drops BOTH the cap and the balance', () => {
  // The update path passes false and delegates to the ratchet. If the cap
  // still fired here, every grandfathered character would be unsaveable.
  const overBalance = validateEconomyLimits({
    economy: 'aspirant', gear: [], commonItems: [], level: 1, enforceAbilityLimits: false,
    abilities: [ownAbility('core'), ownAbility('core'), ownAbility('core'), ownAbility('advanced')],
    abilityPerks: []
  });
  expect(overBalance.ok).toBe(true);

  const overCap = validateEconomyLimits({
    economy: 'advent', gear: [], commonItems: [], level: 1, enforceAbilityLimits: false,
    abilities: Array(6).fill(null).map(() => ownAbility('core')), abilityPerks: []
  });
  expect(overCap.ok).toBe(true);
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

test('the aspiring ability shaper keeps only well-formed picks', () => {
  expect(normalizeAspiringAbilities([
    { class_id: 'c1', name: 'Standoff', type: 'core' },
    null,
    { class_id: '', name: 'Blank', type: 'core' },
    { class_id: 'c2', name: '   ', type: 'core' },
    { class_id: 'c3', name: 'Viewpoint', type: 'advanced' },
    'not an object'
  ])).toEqual([
    { class_id: 'c1', name: 'Standoff', type: 'core' },
    { class_id: 'c3', name: 'Viewpoint', type: 'advanced' }
  ]);
});

test('an unknown ability type is shaped to core rather than passed through', () => {
  expect(normalizeAspiringAbilities([{ class_id: 'c1', name: 'X', type: 'elite' }]))
    .toEqual([{ class_id: 'c1', name: 'X', type: 'core' }]);
});

test('the aspiring ability shaper truncates a payload over three', () => {
  const four = Array(4).fill(null).map((_, i) => ({ class_id: `c${i}`, name: `N${i}`, type: 'core' }));
  expect(normalizeAspiringAbilities(four)).toHaveLength(3);
});

test('the aspiring ability shaper tolerates a non-array', () => {
  expect(normalizeAspiringAbilities(null)).toEqual([]);
  expect(normalizeAspiringAbilities('nope')).toEqual([]);
});

test('an aspiring creation carries the ability pool', () => {
  const result = normalizeCharacterInput(aspiringInput({
    aspiring_abilities: [
      { class_id: 'a', name: 'Dodge', type: 'core' },
      { class_id: 'b', name: 'Parry', type: 'core' },
      { class_id: 'c', name: 'Overdrive', type: 'advanced' }
    ]
  }), { ...aspiringContext(), isCreation: true });
  expect(result.data.aspiring_abilities).toHaveLength(3);
});

// A present empty key would delete the character's Class.
test('an update never sends the ability pool key at all', () => {
  const result = normalizeCharacterInput(aspiringInput({}), { ...aspiringContext(), isCreation: false });
  expect('aspiring_abilities' in result.data).toBe(false);
});

// validateAspiringBuild checks the name and the Signature pool before the
// ability pool, so a body exercising the ability rule needs both already
// satisfied -- otherwise these tests would pass for the wrong reason.
const aspiringBodyWithPools = (overrides = {}) => ({
  pseudo_class: { name: 'Ashwalker', tagline: '', description: '' },
  aspiring_signatures: [
    { class_id: 'class-a', name: 'Knife' },
    { class_id: 'class-b', name: 'Rope' },
    { class_id: 'class-c', name: 'Lamp' }
  ],
  ...overrides
});

test('an aspiring character may be created owning none of its picks', () => {
  // pg. 90 step 3b: "you do not need to acquire them immediately (or at all)".
  const body = aspiringBodyWithPools({
    aspiring_abilities: [
      { class_id: 'c1', name: 'A', type: 'core' },
      { class_id: 'c2', name: 'B', type: 'core' },
      { class_id: 'c3', name: 'C', type: 'advanced' }
    ],
    abilities: []
  });
  expect(validateAspiringBuild(body)).toBeNull();
});

test('an aspiring character needs exactly three Ability picks', () => {
  const body = aspiringBodyWithPools({
    aspiring_abilities: [{ class_id: 'c1', name: 'A', type: 'core' }],
    abilities: []
  });
  expect(validateAspiringBuild(body)).toBe('An Aspiring character needs exactly three Ability picks.');
});

test('the three picks must be two Core and one Advanced', () => {
  const body = aspiringBodyWithPools({
    aspiring_abilities: [
      { class_id: 'c1', name: 'A', type: 'core' },
      { class_id: 'c2', name: 'B', type: 'core' },
      { class_id: 'c3', name: 'C', type: 'core' }
    ],
    abilities: []
  });
  expect(validateAspiringBuild(body))
    .toBe('An Aspiring character needs two Core Ability picks and one Advanced.');
});

test('the two Core picks must come from two different classes', () => {
  // pg. 90 step 3: "two Core Abilities from two different Classes".
  const body = aspiringBodyWithPools({
    aspiring_abilities: [
      { class_id: 'c1', name: 'A', type: 'core' },
      { class_id: 'c1', name: 'B', type: 'core' },
      { class_id: 'c3', name: 'C', type: 'advanced' }
    ],
    abilities: []
  });
  expect(validateAspiringBuild(body))
    .toBe("An Aspiring character's two Core Abilities must come from two different classes.");
});

test('the Advanced pick may repeat a class the Core picks used', () => {
  // pg. 90 step 4a: "You may repeat Classes from those your Signature Items
  // and/or Core Abilities were sourced from."
  const body = aspiringBodyWithPools({
    aspiring_abilities: [
      { class_id: 'c1', name: 'A', type: 'core' },
      { class_id: 'c2', name: 'B', type: 'core' },
      { class_id: 'c1', name: 'C', type: 'advanced' }
    ],
    abilities: []
  });
  expect(validateAspiringBuild(body)).toBeNull();
});
