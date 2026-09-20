const { test, expect } = require('bun:test');
const {
  priceOfAbility,
  perkAllotment,
  perkFigures,
  ABILITY_CAP,
  FREE_CORE_ABILITIES,
  PERK_GRANT,
  PERKS_PER_LEVEL,
  ABILITY_PERK_COST,
  PERK_WORD_LIMIT,
  COMPOUND_WORD_BONUS,
  PERKS_PER_ABILITY
} = require('./perk-economy');

test('every cell of the ability price table matches the book', () => {
  // pg. 90 step 3b: an aspiring character's own-pool Core costs 1 Perk.
  expect(priceOfAbility({ crossClass: false, type: 'core' })).toBe(1);
  // pg. 7: "Unlocking an Advanced Ability from your own Class costs 2 Perks".
  expect(priceOfAbility({ crossClass: false, type: 'advanced' })).toBe(2);
  // pg. 7: "Cross-Classing a Core Ability costs 3 Perks, and an Advanced
  // Ability costs 4 Perks".
  expect(priceOfAbility({ crossClass: true, type: 'core' })).toBe(3);
  expect(priceOfAbility({ crossClass: true, type: 'advanced' })).toBe(4);
});

test('cross-class is uniformly +2 over own at every tier', () => {
  for (const type of ['core', 'advanced']) {
    expect(priceOfAbility({ crossClass: true, type })
      - priceOfAbility({ crossClass: false, type })).toBe(2);
  }
});

test('an unknown ability type is priced as core, never as undefined', () => {
  expect(priceOfAbility({ crossClass: false, type: undefined })).toBe(1);
  expect(priceOfAbility({ crossClass: false, type: 'nonsense' })).toBe(1);
  expect(priceOfAbility({})).toBe(1);
});

test('the figures match the book and the supplied Advent rates', () => {
  expect(PERK_GRANT).toEqual({ advent: 0, aspirant: 1, aspiring: 3 });
  expect(FREE_CORE_ABILITIES).toEqual({ advent: 3, aspirant: 3, aspiring: 0 });
  expect(ABILITY_CAP).toEqual({ advent: 3, aspirant: 6, aspiring: 4 });
  expect(PERKS_PER_LEVEL).toBe(1);
  expect(ABILITY_PERK_COST).toBe(1);
  expect(PERK_WORD_LIMIT).toBe(25);
  expect(COMPOUND_WORD_BONUS).toBe(5);
  expect(PERKS_PER_ABILITY).toBe(5);
});

test('a level-1 character holds only its creation grant', () => {
  expect(perkAllotment({ economy: 'advent', level: 1 })).toBe(0);
  expect(perkAllotment({ economy: 'aspirant', level: 1 })).toBe(1);
  expect(perkAllotment({ economy: 'aspiring', level: 1 })).toBe(3);
});

test('each level past the first grants one more Perk', () => {
  expect(perkAllotment({ economy: 'advent', level: 10 })).toBe(9);
  expect(perkAllotment({ economy: 'aspirant', level: 10 })).toBe(10);
  expect(perkAllotment({ economy: 'aspiring', level: 4 })).toBe(6);
});

test('perkAllotment counts levels exactly as plusAllotment does', () => {
  const { plusAllotment, CREATION_PLUSES, LEVEL_PLUSES_PER_LEVEL } = require('./stat-caps');
  // Same shape, different table: grant + perLevel * (level - 1). A Perk table
  // that counted levels differently from the Pluses table would be a bug
  // waiting for someone to notice.
  for (const level of [1, 2, 7, 20]) {
    expect(plusAllotment({ economy: 'aspirant', level })).toBe(
      CREATION_PLUSES.aspirant + LEVEL_PLUSES_PER_LEVEL * (level - 1)
    );
    expect(perkAllotment({ economy: 'aspirant', level })).toBe(
      PERK_GRANT.aspirant + PERKS_PER_LEVEL * (level - 1)
    );
  }
});

test('perkAllotment clamps a junk level rather than trusting it', () => {
  expect(perkAllotment({ economy: 'advent', level: 0 })).toBe(0);
  expect(perkAllotment({ economy: 'advent', level: -5 })).toBe(0);
  expect(perkAllotment({ economy: 'advent', level: Infinity })).toBe(19);
  expect(perkAllotment({ economy: 'advent', level: 'seven' })).toBe(0);
});

test('perkAllotment returns null for an economy it has no figure for', () => {
  expect(perkAllotment({ economy: 'nonsense', level: 3 })).toBeNull();
  expect(perkAllotment({})).toBeNull();
});

test('perkFigures is plain data and a fresh object each call', () => {
  const a = perkFigures();
  const b = perkFigures();
  expect(a).toEqual(b);
  expect(a).not.toBe(b);
  a.grants.advent = 99;
  expect(perkFigures().grants.advent).toBe(0);
  expect(a.prices.ability.cross.advanced).toBe(4);
  expect(a.abilityCap.aspiring).toBe(4);
});

test('perk-economy requires nothing but stat-caps', () => {
  const source = require('fs').readFileSync(require.resolve('./perk-economy'), 'utf8');
  const requires = [...source.matchAll(/require\((['"])(.*?)\1\)/g)].map(m => m[2]);
  expect(requires).toEqual(['./stat-caps']);
});
