const { test, expect, describe, spyOn } = require('bun:test');
const { findAspirantFork, planConversion, CONVERSION_RULES } = require('./aspirant-conversion');
const { statList } = require('./enclave-consts');

// The catalogue shapes conversion meets: an Advent class at v1 and v2 (one
// version family) with its Aspirant fork of the v1 row, a second such class
// for cross-class items, a pre-release class with its fork, and a class with
// no fork at all.
const advent = (id, name, extra = {}) => ({
  id, name, rules_edition: 'advent', content_format: 'advent', base_class_id: null,
  gear: [], abilities: [], advanced_abilities: [], ...extra
});
const fork = (id, name, baseClassId, extra = {}) => ({
  id, name, rules_edition: 'aspirant', content_format: 'aspirant', base_class_id: baseClassId,
  gear: [], abilities: [], advanced_abilities: [], ...extra
});

const GUNSLINGER_V1 = advent('gunslinger-v1', 'Gunslinger');
const GUNSLINGER_V2 = advent('gunslinger-v2', 'Gunslinger', { base_class_id: 'gunslinger-v1' });
const GUNSLINGER_FORK = fork('gunslinger-aspirant', 'Gunslinger', 'gunslinger-v1', {
  gear: [{ name: 'Revolver', description: 'A six-shooter.' }, { name: 'Duster', description: 'Long coat.' }],
  abilities: [{ name: 'Trickshot' }, { name: 'Standoff' }, { name: 'Shootout' }],
  advanced_abilities: [{ name: 'Last Word' }, { name: 'Dead Eye' }, { name: 'High Noon' }]
});
const WANDERER_V1 = advent('wanderer-v1', 'Wanderer');
const WANDERER_V2 = advent('wanderer-v2', 'Wanderer', { base_class_id: 'wanderer-v1' });
const WANDERER_FORK = fork('wanderer-aspirant', 'Wanderer', 'wanderer-v1', {
  gear: [{ name: 'Satchel' }], abilities: [{ name: 'Familiar Face' }]
});
const BERSERKER_PRERELEASE = {
  id: 'berserker-pre', name: 'Berserker', rules_edition: 'aspirant', content_format: 'advent',
  base_class_id: null, gear: [], abilities: [], advanced_abilities: []
};
const BERSERKER_FORK = fork('berserker-aspirant', 'Berserker', 'berserker-pre');
const HOMEBREW = advent('homebrew', 'Homebrew Class', { gear: [{ name: 'Hand Cannon' }] });

const CATALOGUE = [
  GUNSLINGER_V1, GUNSLINGER_V2, GUNSLINGER_FORK, WANDERER_V1, WANDERER_V2, WANDERER_FORK,
  BERSERKER_PRERELEASE, BERSERKER_FORK, HOMEBREW
];

describe('findAspirantFork', () => {
  test('the v1 member of a family finds the fork of the v1 row', () => {
    expect(findAspirantFork(CATALOGUE, 'gunslinger-v1')).toBe(GUNSLINGER_FORK);
  });

  test('the v2 member of the same family finds the same fork', () => {
    expect(findAspirantFork(CATALOGUE, 'gunslinger-v2')).toBe(GUNSLINGER_FORK);
  });

  test('a pre-release class finds its fork', () => {
    expect(findAspirantFork(CATALOGUE, 'berserker-pre')).toBe(BERSERKER_FORK);
  });

  test('a class with no fork has none', () => {
    expect(findAspirantFork(CATALOGUE, 'homebrew')).toBeNull();
  });

  test('a fork has no fork of its own', () => {
    expect(findAspirantFork(CATALOGUE, 'gunslinger-aspirant')).toBeNull();
  });

  test('a character with no class has no fork, even beside a parentless Aspirant class', () => {
    const parentless = fork('orphan-aspirant', 'Orphan', null);
    expect(findAspirantFork([...CATALOGUE, parentless], null)).toBeNull();
  });

  test('two forks of one family are ambiguous: none is offered and it is logged', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const second = fork('gunslinger-aspirant-2', 'Gunslinger', 'gunslinger-v2');
      expect(findAspirantFork([...CATALOGUE, second], 'gunslinger-v2')).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('gunslinger-aspirant-2');
    } finally {
      warn.mockRestore();
    }
  });
});

const TRAITS = [
  { name: 'Brave', stat: 'might' }, { name: 'Clever', stat: 'intelligence' }, { name: 'Lucky', stat: 'luck' }
];
const signature = (name, classId, extra = {}) => ({ name, class_id: classId, enchantment: null, mods: [], ...extra });
const ability = (id, name, classId, type = 'core') => ({ id, name, class_id: classId, type });

// Shaped like Caroline Denton (465f52ce-ee0d-4b0f-99bc-4baa4f9c8b7d): a
// Gunslinger v2 whose Abilities are stored on the v1 row of her own family,
// carrying Wanderer's Familiar Face cross-class, two Revolvers, and
// Ability Perks including a compound. Level 4.
const carolineDenton = (overrides = {}) => ({
  character: {
    id: 'caroline', name: 'Caroline Denton', class: 'Gunslinger', class_id: 'gunslinger-v2',
    creator_mode: null, level: 4, common_items: [], stat_cap_purchases: {},
    ...Object.fromEntries(statList.map(stat => [stat, 1])),
    ...overrides.character
  },
  classes: overrides.classes || CATALOGUE,
  gear: overrides.gear || [
    signature('Revolver', 'gunslinger-v1'),
    signature('Revolver', 'gunslinger-v1'),
    signature('Satchel', 'wanderer-v2')
  ],
  abilities: overrides.abilities || [
    ability('ab-trick', 'Trickshot', 'gunslinger-v1'),
    ability('ab-stand', 'Standoff', 'gunslinger-v1'),
    ability('ab-shoot', 'Shootout', 'gunslinger-v1'),
    ability('ab-face', 'Familiar Face', 'wanderer-v1')
  ],
  abilityPerks: overrides.abilityPerks || [
    { id: 'p0', class_ability_id: 'ab-trick', text: 'Off the wall.', position: 0, compounds_with: null },
    { id: 'p1', class_ability_id: 'ab-stand', text: 'Stare them down.', position: 1, compounds_with: null },
    { id: 'p2', class_ability_id: 'ab-stand', text: 'Twice as long.', position: 2, compounds_with: 'position-1' }
  ],
  traits: overrides.traits || TRAITS,
  realMissions: [],
  offscreenMissions: []
});

describe('planConversion: where each row goes', () => {
  test('the target is the fork of the character\'s own class', () => {
    expect(planConversion(carolineDenton()).target).toBe(GUNSLINGER_FORK);
  });

  test('own-class Signatures move to the fork, both copies of a duplicated one included', () => {
    const plan = planConversion(carolineDenton());
    expect(plan.gear.slice(0, 2)).toEqual([
      { name: 'Revolver', class_id: 'gunslinger-aspirant', description: 'A six-shooter.', enchantment: null, mods: [] },
      { name: 'Revolver', class_id: 'gunslinger-aspirant', description: 'A six-shooter.', enchantment: null, mods: [] }
    ]);
  });

  test('a cross-class Signature on a v2 row moves to its own class\'s fork', () => {
    const plan = planConversion(carolineDenton());
    expect(plan.gear[2]).toMatchObject({ name: 'Satchel', class_id: 'wanderer-aspirant' });
  });

  test('a cross-class Ability on a v1 row moves to its own class\'s fork', () => {
    const plan = planConversion(carolineDenton());
    expect(plan.abilities.find(row => row.name === 'Familiar Face'))
      .toEqual({ name: 'Familiar Face', class_id: 'wanderer-aspirant', description: null, type: 'core' });
    expect(plan.abilities.filter(row => row.class_id === 'gunslinger-aspirant').map(row => row.name))
      .toEqual(['Trickshot', 'Standoff', 'Shootout']);
  });

  test('an Ability found in the fork\'s Advanced list is typed advanced', () => {
    const plan = planConversion(carolineDenton({
      abilities: [ability('ab-last', 'Last Word', 'gunslinger-v2', 'core')], abilityPerks: []
    }));
    expect(plan.abilities).toEqual([
      { name: 'Last Word', class_id: 'gunslinger-aspirant', description: null, type: 'advanced' }
    ]);
  });

  test('Ability Perks follow their Ability by name and keep a same-Ability compound', () => {
    const plan = planConversion(carolineDenton());
    expect(plan.abilityPerks).toEqual([
      { class_ability_id: null, ability_name: 'Trickshot', text: 'Off the wall.', position: 0, compounds_with: null },
      { class_ability_id: null, ability_name: 'Standoff', text: 'Stare them down.', position: 1, compounds_with: null },
      { class_ability_id: null, ability_name: 'Standoff', text: 'Twice as long.', position: 2, compounds_with: 'position-1' }
    ]);
  });

  test('an Enchantment and Mods ride along unchanged', () => {
    const enchantment = { source: 'custom', text: 'Never jams.' };
    const mods = [{ text: 'Lined.' }];
    const plan = planConversion(carolineDenton({
      gear: [signature('Duster', 'gunslinger-v1', { enchantment, mods })]
    }));
    expect(plan.gear).toEqual([
      { name: 'Duster', class_id: 'gunslinger-aspirant', description: 'Long coat.', enchantment, mods }
    ]);
  });

  test('an item already on an Aspirant-format class stays where it is', () => {
    const plan = planConversion(carolineDenton({
      gear: [signature('Satchel', 'wanderer-aspirant', { description: 'Worn.' })],
      abilities: [ability('ab-face', 'Familiar Face', 'wanderer-aspirant')],
      abilityPerks: [{ id: 'p0', class_ability_id: 'ab-face', text: 'Known here.', position: 0, compounds_with: null }]
    }));
    expect(plan.gear).toEqual([
      { name: 'Satchel', class_id: 'wanderer-aspirant', description: 'Worn.', enchantment: null, mods: [] }
    ]);
    expect(plan.abilities).toEqual([
      { name: 'Familiar Face', class_id: 'wanderer-aspirant', description: null, type: 'core' }
    ]);
    expect(plan.abilityPerks[0].ability_name).toBe('Familiar Face');
    expect(plan.blockers).toEqual([]);
  });

  test('a name differing only by whitespace or case matches, and the fork\'s spelling is written', () => {
    const plan = planConversion(carolineDenton({
      gear: [signature(' revolver ', 'gunslinger-v1')],
      abilities: [ability('ab-trick', 'trickshot ', 'gunslinger-v1')],
      abilityPerks: [{ id: 'p0', class_ability_id: 'ab-trick', text: 'Off the wall.', position: 0, compounds_with: null }]
    }));
    expect(plan.gear[0]).toMatchObject({ name: 'Revolver', class_id: 'gunslinger-aspirant' });
    expect(plan.abilities[0]).toMatchObject({ name: 'Trickshot', class_id: 'gunslinger-aspirant' });
    expect(plan.abilityPerks[0].ability_name).toBe('Trickshot');
    expect(plan.blockers).toEqual([]);
  });
});

describe('planConversion: what has no Aspirant counterpart', () => {
  test('an item its fork does not carry is a blocker naming the item and its class', () => {
    const plan = planConversion(carolineDenton({
      gear: [signature('Grapple Gun', 'wanderer-v2')]
    }));
    expect(plan.blockers).toEqual([{
      rule: CONVERSION_RULES.noCounterpart,
      detail: 'Grapple Gun (Wanderer) has no Aspirant version. Remove it to convert.'
    }]);
    expect(plan.gear).toEqual([]);
  });

  test('an item whose class has no fork is a blocker naming that class', () => {
    const plan = planConversion(carolineDenton({
      gear: [signature('Hand Cannon', 'homebrew')]
    }));
    expect(plan.blockers).toEqual([{
      rule: CONVERSION_RULES.noFork,
      detail: 'Hand Cannon comes from Homebrew Class, which has no Aspirant version. Remove it to convert.'
    }]);
  });

  test('an item whose class is gone from the catalogue is a blocker', () => {
    const plan = planConversion(carolineDenton({
      gear: [signature('Mystery Box', 'deleted-class')]
    }));
    expect(plan.blockers).toEqual([{
      rule: CONVERSION_RULES.noFork,
      detail: 'Mystery Box comes from a class no longer in the catalogue. Remove it to convert.'
    }]);
  });

  test('a character whose own class has no fork has no target', () => {
    const plan = planConversion(carolineDenton({
      character: { class: 'Homebrew Class', class_id: 'homebrew' }
    }));
    expect(plan.target).toBeNull();
    expect(plan.blockers).toEqual([{
      rule: CONVERSION_RULES.noFork,
      detail: 'Homebrew Class has no Aspirant version.'
    }]);
    expect(plan.gear).toEqual([]);
    expect(plan.abilities).toEqual([]);
    expect(plan.abilityPerks).toEqual([]);
  });
});
