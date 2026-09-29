const { test, expect, describe, spyOn } = require('bun:test');
const { upgradeBuild, upgradeSaveArgs, planConversion, CONVERSION_RULES } = require('./aspirant-conversion');
const { statList } = require('./enclave-consts');
const { capBreachMessage, BASE_STAT_CAP } = require('./stat-caps');
const { CREATION_GRANT, priceOfSignature } = require('./merx-economy');
const {
  ABILITY_CAP_RULE, PERK_DEFICIT_RULE, CROSS_CLASS_EDITION_RULE, perkAllotment
} = require('./perk-economy');

// Gunslinger v1 and v2 are one version family; Wanderer is another class.
// This is what familyResolver (util/class-family.js) hands the planner.
const GUNSLINGER_FAMILY = new Set(['gunslinger-v1', 'gunslinger-v2']);
const classFamilyOf = (classId) => (GUNSLINGER_FAMILY.has(classId) ? 'gunslinger-v2' : classId);

const TRAITS = [
  { name: 'Brave', stat: 'might' }, { name: 'Clever', stat: 'intelligence' }, { name: 'Lucky', stat: 'luck' }
];
const signature = (name, classId, extra = {}) => ({ name, class_id: classId, enchantment: null, mods: [], ...extra });
const ability = (id, name, classId, type = 'core') => ({ id, name, class_id: classId, type });

// Shaped like Caroline Denton (465f52ce-ee0d-4b0f-99bc-4baa4f9c8b7d): a
// Gunslinger v2 whose Abilities are stored on the v1 row of her own family,
// carrying Wanderer's Familiar Face cross-class, two Revolvers, Wanderer's
// Satchel, and three Ability Perks including a compound. Level 4.
const carolineDenton = (overrides = {}) => ({
  character: {
    id: 'caroline', name: 'Caroline Denton', class: 'Gunslinger', class_id: 'gunslinger-v2',
    creator_mode: null, level: 4, common_items: [], stat_cap_purchases: {},
    ...Object.fromEntries(statList.map(stat => [stat, 1])),
    ...overrides.character
  },
  classFamilyOf: 'classFamilyOf' in overrides ? overrides.classFamilyOf : classFamilyOf,
  gear: overrides.gear || [
    signature('Revolver', 'gunslinger-v2'),
    signature('Revolver', 'gunslinger-v2'),
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

describe('planConversion: the build stays as it is', () => {
  test('the plan names no rows to write: conversion changes only the mode', () => {
    expect(Object.keys(planConversion(carolineDenton())).sort())
      .toEqual(['blockers', 'breaches', 'merxBreakdown', 'perkBreakdown']);
  });

  test('Caroline Denton converts with nothing blocking and no Ability-cap breach', () => {
    const plan = planConversion(carolineDenton());
    expect(plan.blockers).toEqual([]);
    expect(plan.breaches.map(b => b.rule)).not.toContain(ABILITY_CAP_RULE);
    expect(plan.breaches.map(b => b.rule)).not.toContain(CROSS_CLASS_EDITION_RULE);
  });
});

describe('planConversion: judged as an Aspirant character on its own class', () => {
  // Level 4 earns 1 + 3 Perks. Trickshot, Standoff and Shootout sit on the v1
  // row of the character's own family, so they are its three free own-class
  // Cores; Familiar Face costs 3 cross-class and the three Ability Perks 1 each.
  test('own- and cross-class are judged against the character\'s own version family', () => {
    expect(planConversion(carolineDenton()).perkBreakdown).toEqual({
      earned: perkAllotment({ economy: 'aspirant', level: 4 }), spend: 6, remaining: 0, deficit: 2
    });
  });

  // Without the family, the three Cores on the v1 row would each be a
  // cross-class unlock at 3: 9 + 3 + 3 Perks.
  test('the family comes from classFamilyOf', () => {
    expect(planConversion(carolineDenton({ classFamilyOf: null })).perkBreakdown.spend).toBe(15);
  });

  test('a Perk deficit is grandfathered: a breach, not a blocker', () => {
    const plan = planConversion(carolineDenton());
    expect(plan.breaches.map(b => b.rule)).toEqual([PERK_DEFICIT_RULE]);
    expect(plan.blockers).toEqual([]);
  });

  test('an Ability count over the Aspirant cap is grandfathered: a breach, not a blocker', () => {
    const plan = planConversion(carolineDenton({
      abilities: [
        ability('a1', 'Trickshot', 'gunslinger-v1'), ability('a2', 'Standoff', 'gunslinger-v1'),
        ability('a3', 'Shootout', 'gunslinger-v1'), ability('a4', 'Last Word', 'gunslinger-v2', 'advanced'),
        ability('a5', 'Dead Eye', 'gunslinger-v2', 'advanced'), ability('a6', 'High Noon', 'gunslinger-v2', 'advanced'),
        ability('a7', 'Familiar Face', 'wanderer-v1')
      ],
      abilityPerks: []
    }));
    expect(plan.breaches.map(b => b.rule)).toContain(ABILITY_CAP_RULE);
    expect(plan.blockers).toEqual([]);
  });

  // pg. 85: the Signature Cap limits what a character brings on a mission, not
  // what it owns.
  test('Signatures past what a mission allows neither block nor breach', () => {
    const gear = Array.from({ length: 15 }, () => signature('Revolver', 'gunslinger-v2', { enchantment: { source: 'default' } }));
    const plan = planConversion(carolineDenton({ gear }));
    expect(plan.blockers).toEqual([]);
    expect(plan.breaches.map(b => b.rule)).toEqual([PERK_DEFICIT_RULE]);
  });

  // Two own-class Revolvers and one cross-class Satchel, against the Aspirant
  // creation grant with no missions.
  test('the Merx breakdown prices the build under Aspirant', () => {
    const spend = 2 * priceOfSignature({ crossClass: false }) + priceOfSignature({ crossClass: true });
    expect(planConversion(carolineDenton()).merxBreakdown).toEqual({
      earned: CREATION_GRANT.aspirant,
      spend,
      reward: Math.max(0, CREATION_GRANT.aspirant - spend),
      deficit: Math.max(0, spend - CREATION_GRANT.aspirant)
    });
  });

  // No class means no family: every Ability is own-class. Four own Cores are
  // three free and one at 1, plus three Ability Perks, against 4 earned.
  test('a character with no class is judged with every Ability own-class', () => {
    const plan = planConversion(carolineDenton({ character: { class: 'Drifter', class_id: null }, classFamilyOf: null }));
    expect(plan.blockers).toEqual([]);
    expect(plan.perkBreakdown.spend).toBe(4);
  });
});

describe('planConversion: what blocks conversion', () => {
  test('only Traits and the Stat Cap can block', () => {
    expect(Object.values(CONVERSION_RULES).sort()).toEqual(['stat-cap', 'traits']);
  });

  test('two Traits on one Stat block conversion with the validator\'s own message', () => {
    const plan = planConversion(carolineDenton({
      traits: [{ name: 'Brave', stat: 'might' }, { name: 'Bold', stat: 'might' }, { name: 'Lucky', stat: 'luck' }]
    }));
    expect(plan.blockers).toEqual([
      { rule: CONVERSION_RULES.traits, detail: 'Two Traits may not share a Stat (might).' }
    ]);
  });

  test('a Stat over its Cap blocks conversion', () => {
    const plan = planConversion(carolineDenton({ character: { reflex: BASE_STAT_CAP + 2 } }));
    expect(plan.blockers).toEqual([{
      rule: CONVERSION_RULES.statCap,
      detail: capBreachMessage({ stat: 'reflex', value: BASE_STAT_CAP + 2, cap: BASE_STAT_CAP })
    }]);
  });

  test('a Stat Cap purchase is honoured', () => {
    const plan = planConversion(carolineDenton({
      character: { reflex: BASE_STAT_CAP + 1, stat_cap_purchases: { reflex: 1 } }
    }));
    expect(plan.blockers).toEqual([]);
  });
});

// --- upgradeBuild -----------------------------------------------------------

const entry = (name, description = null) => ({ name, description });
const klass = (id, name, format, base, lists = {}) => ({
  id, name, base_class_id: base, rules_edition: format, content_format: format,
  gear: lists.gear || [], abilities: lists.abilities || [], advanced_abilities: lists.advanced || []
});
const GUNSLINGER_ADVENT_LISTS = {
  gear: [entry('Revolver'), entry('Duster')],
  abilities: [entry('Trickshot'), entry('Standoff'), entry('Shootout')]
};
const UPGRADE_CLASSES = [
  klass('gs-v1', 'Gunslinger', 'advent', null, GUNSLINGER_ADVENT_LISTS),
  klass('gs-v2', 'Gunslinger', 'advent', 'gs-v1', GUNSLINGER_ADVENT_LISTS),
  klass('gs-asp', 'Gunslinger', 'aspirant', 'gs-v1', {
    gear: [entry(' Revolver ', 'Aspirant six-shooter.')],
    abilities: [entry('Trickshot', 'Aspirant trick.')],
    advanced: [entry('Standoff', 'Aspirant standoff.')]
  }),
  klass('wd-v1', 'Wanderer', 'advent', null, { gear: [entry('Satchel')], abilities: [entry('Familiar Face')] }),
  klass('wd-asp', 'Wanderer', 'aspirant', 'wd-v1', { abilities: [entry('Familiar Face', 'Aspirant face.')] }),
  klass('dr-v1', 'Drifter', 'advent', null, { gear: [entry('Bedroll')], abilities: [entry('Wayfinding')] }),
  klass('sc-asp', 'Scout', 'aspirant', null, { abilities: [entry('Quick Study')] })
];
const ENCHANTMENT = { source: 'default', name: 'Quick' };
const MODS = [{ name: 'Scope' }];
const gearRow = (id, name, classId, extra = {}) => ({ id, name, class_id: classId, description: null, enchantment: null, mods: [], ...extra });
const abilityRow = (id, name, classId, extra = {}) => ({ id, name, class_id: classId, description: null, type: 'core', ...extra });

const upgradeInput = (overrides = {}) => ({
  character: { id: 'char-1', creator_id: 'profile-1', name: 'Caroline', class: 'Gunslinger', class_id: 'gs-v2', traits: TRAITS, ...overrides.character },
  classes: overrides.classes || UPGRADE_CLASSES,
  gear: overrides.gear || [
    gearRow('g1', 'Revolver', 'gs-v1', { enchantment: ENCHANTMENT, mods: MODS }),
    gearRow('g2', 'Revolver', 'gs-v2'),
    gearRow('g3', 'Duster', 'gs-v1', { description: 'Long coat.' }),
    gearRow('g4', 'Satchel', 'wd-v1'),
    gearRow('g5', 'Bedroll', 'dr-v1')
  ],
  abilities: overrides.abilities || [
    abilityRow('a1', 'trickshot', 'gs-v1'),
    abilityRow('a2', 'Standoff', 'gs-v1'),
    abilityRow('a3', 'Shootout', 'gs-v1', { description: 'Guns out.' }),
    abilityRow('a4', 'Familiar Face', 'wd-v1'),
    abilityRow('a5', 'Wayfinding', 'dr-v1'),
    abilityRow('a6', 'Quick Study', 'sc-asp')
  ],
  abilityPerks: overrides.abilityPerks || [
    { id: 'p0', class_ability_id: 'a1', text: 'Off the wall.', position: 0, compounds_with: null },
    { id: 'p1', class_ability_id: 'a2', text: 'Stare them down.', position: 1, compounds_with: null },
    { id: 'p2', class_ability_id: 'a2', text: 'Twice as long.', position: 2, compounds_with: 'position-1' },
    { id: 'p3', class_ability_id: 'a3', text: 'Steady hands.', position: 3, compounds_with: null }
  ]
});

describe('upgradeBuild', () => {
  test('the class moves to its Aspirant version', () => {
    expect(upgradeBuild(upgradeInput()).target.id).toBe('gs-asp');
  });

  // Each Revolver keeps its own Enchantment and Mods; the name is matched
  // trimmed and case-folded and takes the fork's trimmed spelling.
  test('Signatures with an Aspirant version move with their equipment; the rest stay as stored', () => {
    expect(upgradeBuild(upgradeInput()).gear).toEqual([
      { name: 'Revolver', class_id: 'gs-asp', description: 'Aspirant six-shooter.', enchantment: ENCHANTMENT, mods: MODS },
      { name: 'Revolver', class_id: 'gs-asp', description: 'Aspirant six-shooter.', enchantment: null, mods: [] },
      { name: 'Duster', class_id: 'gs-v1', description: 'Long coat.', enchantment: null, mods: [] },
      { name: 'Satchel', class_id: 'wd-v1', description: null, enchantment: null, mods: [] },
      { name: 'Bedroll', class_id: 'dr-v1', description: null, enchantment: null, mods: [] }
    ]);
  });

  // Familiar Face follows its donor (Wanderer), not the character's class.
  test('Abilities move to the Aspirant version of their own class, taking its spelling, text and type', () => {
    expect(upgradeBuild(upgradeInput()).abilities).toEqual([
      { name: 'Trickshot', class_id: 'gs-asp', description: 'Aspirant trick.', type: 'core' },
      { name: 'Standoff', class_id: 'gs-asp', description: 'Aspirant standoff.', type: 'advanced' },
      { name: 'Shootout', class_id: 'gs-v1', description: 'Guns out.', type: 'core' },
      { name: 'Familiar Face', class_id: 'wd-asp', description: 'Aspirant face.', type: 'core' },
      { name: 'Wayfinding', class_id: 'dr-v1', description: null, type: 'core' },
      { name: 'Quick Study', class_id: 'sc-asp', description: null, type: 'core' }
    ]);
  });

  test('Perks follow a moved Ability by name, keep their compound, and stay keyed by id otherwise', () => {
    expect(upgradeBuild(upgradeInput()).abilityPerks).toEqual([
      { class_ability_id: null, ability_name: 'Trickshot', text: 'Off the wall.', position: 0, compounds_with: null },
      { class_ability_id: null, ability_name: 'Standoff', text: 'Stare them down.', position: 1, compounds_with: null },
      { class_ability_id: null, ability_name: 'Standoff', text: 'Twice as long.', position: 2, compounds_with: 'position-1' },
      { class_ability_id: 'a3', text: 'Steady hands.', position: 3, compounds_with: null }
    ]);
  });

  test('moved and kept name every item for the preview', () => {
    const { moved, kept } = upgradeBuild(upgradeInput());
    expect(moved).toEqual([
      { kind: 'Signature', name: 'Revolver', className: 'Gunslinger' },
      { kind: 'Signature', name: 'Revolver', className: 'Gunslinger' },
      { kind: 'Ability', name: 'Trickshot', className: 'Gunslinger' },
      { kind: 'Ability', name: 'Standoff', className: 'Gunslinger' },
      { kind: 'Ability', name: 'Familiar Face', className: 'Wanderer' }
    ]);
    expect(kept).toEqual([
      { kind: 'Signature', name: 'Duster', className: 'Gunslinger' },
      { kind: 'Signature', name: 'Satchel', className: 'Wanderer' },
      { kind: 'Signature', name: 'Bedroll', className: 'Drifter' },
      { kind: 'Ability', name: 'Shootout', className: 'Gunslinger' },
      { kind: 'Ability', name: 'Wayfinding', className: 'Drifter' },
      { kind: 'Ability', name: 'Quick Study', className: 'Scout' }
    ]);
  });

  test('with no Aspirant version anywhere, nothing moves and the lists are null', () => {
    const upgrade = upgradeBuild(upgradeInput({
      character: { class: 'Drifter', class_id: 'dr-v1' },
      gear: [gearRow('g5', 'Bedroll', 'dr-v1')],
      abilities: [abilityRow('a5', 'Wayfinding', 'dr-v1')],
      abilityPerks: []
    }));
    expect(upgrade).toEqual({
      target: null, gear: null, abilities: null, abilityPerks: null, moved: [],
      kept: [{ kind: 'Signature', name: 'Bedroll', className: 'Drifter' }, { kind: 'Ability', name: 'Wayfinding', className: 'Drifter' }]
    });
  });

  test('the class can move while no row does, and then the lists are null so rows keep their ids', () => {
    const upgrade = upgradeBuild(upgradeInput({ gear: [gearRow('g3', 'Duster', 'gs-v1')], abilities: [], abilityPerks: [] }));
    expect(upgrade.target.id).toBe('gs-asp');
    expect([upgrade.gear, upgrade.abilities, upgrade.abilityPerks]).toEqual([null, null, null]);
  });

  test('a cross-class item moves to its donor\'s Aspirant version while a class with none stays', () => {
    const upgrade = upgradeBuild(upgradeInput({
      character: { class: 'Drifter', class_id: 'dr-v1' },
      gear: [],
      abilities: [abilityRow('a4', 'Familiar Face', 'wd-v1')],
      abilityPerks: []
    }));
    expect(upgrade.target).toBeNull();
    expect(upgrade.abilities).toEqual([{ name: 'Familiar Face', class_id: 'wd-asp', description: 'Aspirant face.', type: 'core' }]);
  });

  // save_character_atomic cannot pair a null class_id with its stored row, so
  // it re-inserts it; the Perk must follow by name or it is lost.
  test('a legacy Ability with no class stays, and its Perks re-attach by name', () => {
    const upgrade = upgradeBuild(upgradeInput({
      gear: [],
      abilities: [abilityRow('a1', 'Trickshot', 'gs-v1'), abilityRow('a9', 'Old Trick', null)],
      abilityPerks: [{ id: 'p9', class_ability_id: 'a9', text: 'Still works.', position: 0, compounds_with: null }]
    }));
    expect(upgrade.abilities[1]).toEqual({ name: 'Old Trick', class_id: null, description: null, type: 'core' });
    expect(upgrade.abilityPerks).toEqual([
      { class_ability_id: null, ability_name: 'Old Trick', text: 'Still works.', position: 0, compounds_with: null }
    ]);
    expect(upgrade.kept).toEqual([{ kind: 'Ability', name: 'Old Trick', className: null }]);
  });

  // Gunslinger's and Wanderer's Aspirant versions each have a newer version.
  // The character and every row land on the newest of their own class's fork
  // family, matched against that version's catalogue.
  test('the character and each row move to the newest version of their Aspirant family', () => {
    const upgrade = upgradeBuild(upgradeInput({
      classes: [
        ...UPGRADE_CLASSES,
        klass('gs-asp-v2', 'Gunslinger', 'aspirant', 'gs-asp', {
          gear: [entry('Revolver', 'Newer six-shooter.')], abilities: [entry('Standoff', 'Newer standoff.')]
        }),
        klass('wd-asp-v2', 'Wanderer', 'aspirant', 'wd-asp', { abilities: [entry('Familiar Face', 'Newer face.')] })
      ],
      gear: [gearRow('g2', 'Revolver', 'gs-v2')],
      abilities: [
        abilityRow('a1', 'Trickshot', 'gs-v1'),
        abilityRow('a2', 'Standoff', 'gs-v1'),
        abilityRow('a4', 'Familiar Face', 'wd-v1')
      ],
      abilityPerks: []
    }));
    expect(upgrade.target.id).toBe('gs-asp-v2');
    expect(upgrade.gear).toEqual([
      { name: 'Revolver', class_id: 'gs-asp-v2', description: 'Newer six-shooter.', enchantment: null, mods: [] }
    ]);
    // Trickshot is only in the older Aspirant version's catalogue, so it stays.
    expect(upgrade.abilities).toEqual([
      { name: 'Trickshot', class_id: 'gs-v1', description: null, type: 'core' },
      { name: 'Standoff', class_id: 'gs-asp-v2', description: 'Newer standoff.', type: 'core' },
      { name: 'Familiar Face', class_id: 'wd-asp-v2', description: 'Newer face.', type: 'core' }
    ]);
  });

  test('a family with two Aspirant versions counts as having none', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const upgrade = upgradeBuild(upgradeInput({
      classes: [...UPGRADE_CLASSES, klass('gs-asp-b', 'Gunslinger', 'aspirant', 'gs-v2', { gear: [entry('Revolver')] })],
      gear: [gearRow('g2', 'Revolver', 'gs-v2')],
      abilities: [],
      abilityPerks: []
    }));
    expect(upgrade.target).toBeNull();
    expect(upgrade.gear).toBeNull();
    warn.mockRestore();
  });
});

describe('upgradeSaveArgs', () => {
  test('names the new class, resubmits the Traits and carries the upgraded lists', () => {
    const input = upgradeInput();
    const upgrade = upgradeBuild(input);
    expect(upgradeSaveArgs({ character: input.character, upgrade })).toEqual({
      characterId: 'char-1',
      creatorId: 'profile-1',
      character: { class_id: 'gs-asp', class: 'Gunslinger' },
      traits: TRAITS,
      gear: upgrade.gear,
      abilities: upgrade.abilities,
      perks: upgrade.abilityPerks
    });
  });

  test('names no column when the class stays', () => {
    const character = { id: 'char-1', creator_id: 'profile-1', traits: TRAITS };
    const upgrade = { target: null, gear: null, abilities: null, abilityPerks: null, moved: [], kept: [] };
    expect(upgradeSaveArgs({ character, upgrade })).toEqual({
      characterId: 'char-1', creatorId: 'profile-1', character: {}, traits: TRAITS, gear: null, abilities: null, perks: null
    });
  });
});
