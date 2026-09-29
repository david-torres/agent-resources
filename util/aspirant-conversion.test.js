const { test, expect, describe } = require('bun:test');
const { planConversion, CONVERSION_RULES } = require('./aspirant-conversion');
const { statList } = require('./enclave-consts');
const { capBreachMessage, BASE_STAT_CAP } = require('./stat-caps');
const { CREATION_GRANT, priceOfSignature } = require('./merx-economy');
const {
  ABILITY_CAP_RULE, PERK_DEFICIT_RULE, CROSS_CLASS_EDITION_RULE, perkAllotment
} = require('./perk-economy');

// Gunslinger v1 and v2 are one version family; Wanderer is another class.
// This is what CharacterService's familyResolver hands the planner.
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
