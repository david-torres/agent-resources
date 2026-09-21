const { test, expect } = require('bun:test');
const {
  priceOfAbility,
  perkAllotment,
  perkFigures,
  ABILITY_CAP,
  FREE_CORE_ABILITIES,
  ASPIRING_ABILITY_PICKS,
  ASPIRING_CORE_PICKS,
  ASPIRING_ADVANCED_PICKS,
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
  expect(ASPIRING_ABILITY_PICKS).toBe(3);
  expect(ASPIRING_CORE_PICKS).toBe(2);
  expect(ASPIRING_ADVANCED_PICKS).toBe(1);
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
  expect(a.aspiringAbilityPicks).toBe(3);
  expect(a.aspiringCorePicks).toBe(2);
  expect(a.aspiringAdvancedPicks).toBe(1);
});

test('perk-economy requires nothing but stat-caps', () => {
  const source = require('fs').readFileSync(require.resolve('./perk-economy'), 'utf8');
  const requires = [...source.matchAll(/require\((['"])(.*?)\1\)/g)].map(m => m[2]);
  expect(requires).toEqual(['./stat-caps']);
});

const {
  unlockSpend,
  perkSpend,
  perkBreakdown,
  buildBreaches,
  worsenedBreaches,
  ABILITY_CAP_RULE,
  PERK_DEFICIT_RULE,
  CROSS_CLASS_EDITION_RULE
} = require('./perk-economy');

const own = (type) => ({ crossClass: false, type });
const cross = (type) => ({ crossClass: true, type });

test('an aspirant character pays nothing for its three own Core abilities', () => {
  expect(unlockSpend([own('core'), own('core'), own('core')], 'aspirant')).toBe(0);
});

test('an aspirant character pays 2 for its own Advanced ability', () => {
  expect(unlockSpend(
    [own('core'), own('core'), own('core'), own('advanced')], 'aspirant'
  )).toBe(2);
});

test('cross-class abilities are charged at 3 and 4 regardless of the allowance', () => {
  expect(unlockSpend(
    [own('core'), own('core'), own('core'), cross('core'), cross('advanced')], 'aspirant'
  )).toBe(7);
});

test('a fourth own Core ability is charged, because the allowance is three', () => {
  expect(unlockSpend(
    [own('core'), own('core'), own('core'), own('core')], 'aspirant'
  )).toBe(1);
});

test('the allowance is order-independent', () => {
  const list = [cross('advanced'), own('core'), own('core'), own('advanced'), own('core')];
  const reversed = [...list].reverse();
  expect(unlockSpend(list, 'aspirant')).toBe(unlockSpend(reversed, 'aspirant'));
});

test('an aspiring character has no allowance and pays 1/1/2 for its picks', () => {
  expect(unlockSpend([own('core'), own('core'), own('advanced')], 'aspiring')).toBe(4);
});

test('an aspiring character pays 3 or 4 for anything outside its pool', () => {
  expect(unlockSpend([cross('core')], 'aspiring')).toBe(3);
  expect(unlockSpend([cross('advanced')], 'aspiring')).toBe(4);
});

test('an advent character pays nothing for three own Core abilities', () => {
  expect(unlockSpend([own('core'), own('core'), own('core')], 'advent')).toBe(0);
});

test('advent has no unlock economy: a cross-class ability costs 0, not 3 or 4', () => {
  // pg. 3 lists "Perks can now be spent to unlock additional Abilities,
  // including Cross-Class" as an Aspirant ADDITION, so Advent has no rate to
  // charge. Fails if unlockSpend ever again returns ABILITY_PRICE.cross.core
  // (3) or .advanced (4) for economy 'advent'.
  expect(unlockSpend([cross('core')], 'advent')).toBe(0);
  expect(unlockSpend([cross('advanced')], 'advent')).toBe(0);
  expect(unlockSpend([own('core'), own('core'), own('core'), cross('core')], 'advent')).toBe(0);
});

test('advent has no unlock economy: a fourth own-class Core ability costs 0, not 1', () => {
  // Fails if unlockSpend ever again charges ABILITY_PRICE.own.core (1) for
  // the fourth own-class Core in economy 'advent' — the cap, not a price, is
  // what is supposed to flag this character.
  expect(unlockSpend([own('core'), own('core'), own('core'), own('core')], 'advent')).toBe(0);
});

test('an advent character\'s Perk spend is exactly its Ability Perk count', () => {
  // Fails if perkSpend ever again adds a nonzero unlockSpend term for advent,
  // e.g. from a cross-class or fourth-Core ability.
  const abilities = [own('core'), own('core'), own('core'), own('core'), cross('advanced')];
  const abilityPerks = [{ id: 1 }, { id: 2 }, { id: 3 }];
  expect(perkSpend({ economy: 'advent', abilities, abilityPerks })).toBe(3);
});

test('aspirant and aspiring unlock pricing is unchanged by the advent guard', () => {
  // Asserts the exact live cells so the advent early return cannot silently
  // widen and swallow aspirant or aspiring pricing too.
  expect(unlockSpend(
    [own('core'), own('core'), own('core'), cross('core'), cross('advanced')], 'aspirant'
  )).toBe(7);
  expect(unlockSpend(
    [own('core'), own('core'), own('core'), own('core')], 'aspirant'
  )).toBe(1);
  expect(unlockSpend([own('core'), own('core'), own('advanced')], 'aspiring')).toBe(4);
  expect(unlockSpend([cross('core')], 'aspiring')).toBe(3);
  expect(unlockSpend([cross('advanced')], 'aspiring')).toBe(4);
});

test('unlockSpend tolerates junk entries and a non-array', () => {
  expect(unlockSpend(null, 'aspirant')).toBe(0);
  expect(unlockSpend([null, undefined, false], 'aspirant')).toBe(0);
  expect(unlockSpend([own('core')], 'nonsense')).toBe(1);
});

test('every Ability Perk costs one, and a compound costs one more by being a row', () => {
  // A compound is a SEPARATE character_perks row pointing at the perk it
  // improves, so counting rows already charges 2 Perks for a compounded perk.
  const base = { id: 'p1', compounds_with: null };
  const compound = { id: 'p2', compounds_with: 'p1' };
  expect(perkSpend({ economy: 'aspirant', abilities: [], abilityPerks: [base] })).toBe(1);
  expect(perkSpend({ economy: 'aspirant', abilities: [], abilityPerks: [base, compound] })).toBe(2);
});

test('perkSpend adds unlocks to Ability Perks', () => {
  expect(perkSpend({
    economy: 'aspirant',
    abilities: [own('core'), own('core'), own('core'), own('advanced')],
    abilityPerks: [{ id: 'p1' }, { id: 'p2' }]
  })).toBe(4);
});

test('perkBreakdown reports earned, spend, remaining and deficit', () => {
  expect(perkBreakdown({
    economy: 'aspiring',
    level: 1,
    abilities: [own('core'), own('core')],
    abilityPerks: []
  })).toEqual({ earned: 3, spend: 2, remaining: 1, deficit: 0 });
});

test('perkBreakdown never reports a negative remaining', () => {
  const result = perkBreakdown({
    economy: 'aspiring',
    level: 1,
    abilities: [own('core'), own('core'), own('advanced')],
    abilityPerks: []
  });
  expect(result).toEqual({ earned: 3, spend: 4, remaining: 0, deficit: 1 });
});

test('an aspiring character cannot buy all three picks at creation, by design', () => {
  // pg. 90 grants 3 Perks for picks costing 1 + 1 + 2 = 4, and step 3b says
  // the picks need not be acquired "immediately (or at all)".
  const all = perkBreakdown({
    economy: 'aspiring', level: 1,
    abilities: [own('core'), own('core'), own('advanced')], abilityPerks: []
  });
  expect(all.deficit).toBe(1);
  const two = perkBreakdown({
    economy: 'aspiring', level: 1,
    abilities: [own('core'), own('advanced')], abilityPerks: []
  });
  expect(two.deficit).toBe(0);
  expect(two.remaining).toBe(0);
});

test('perkBreakdown returns null for an unknown economy', () => {
  expect(perkBreakdown({ economy: 'nonsense', level: 1, abilities: [], abilityPerks: [] })).toBeNull();
});

test('a clean build produces no breaches', () => {
  expect(buildBreaches({
    economy: 'aspirant', level: 5,
    abilities: [own('core'), own('core'), own('core')], abilityPerks: []
  })).toEqual([]);
});

test('over the ability cap is a hard breach carrying its overage', () => {
  const breaches = buildBreaches({
    economy: 'advent', level: 1,
    abilities: [own('core'), own('core'), own('core'), own('core'), own('core'), own('core')],
    abilityPerks: []
  });
  const cap = breaches.find(b => b.rule === ABILITY_CAP_RULE);
  expect(cap.severity).toBe('hard');
  expect(cap.count).toBe(6);
  expect(cap.limit).toBe(3);
  expect(cap.overage).toBe(3);
  expect(cap.detail).toBe('6 Abilities, and the cap is 3.');
});

test('spending more Perks than earned is a hard breach whose overage is the deficit', () => {
  const breaches = buildBreaches({
    economy: 'advent', level: 3,
    abilities: [own('core')],
    abilityPerks: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
  });
  const deficit = breaches.find(b => b.rule === PERK_DEFICIT_RULE);
  expect(deficit.severity).toBe('hard');
  expect(deficit.count).toBe(4);
  expect(deficit.limit).toBe(2);
  expect(deficit.overage).toBe(2);
});

test('an advent character holding a cross-class ability gets the softer notice', () => {
  const breaches = buildBreaches({
    economy: 'advent', level: 5,
    abilities: [own('core'), own('core'), cross('core')], abilityPerks: []
  });
  const edition = breaches.find(b => b.rule === CROSS_CLASS_EDITION_RULE);
  expect(edition.severity).toBe('soft');
  expect(edition.count).toBe(1);
  expect(edition.detail).toContain('Cross-Classing is an Aspirant rule');
});

test('an aspirant character holding a cross-class ability gets no edition notice', () => {
  // Cross-Classing is legal there and priced, not flagged.
  const breaches = buildBreaches({
    economy: 'aspirant', level: 10,
    abilities: [own('core'), own('core'), own('core'), cross('core')], abilityPerks: []
  });
  expect(breaches.find(b => b.rule === CROSS_CLASS_EDITION_RULE)).toBeUndefined();
});

test('the ratchet passes a stored breach through unchanged', () => {
  // Aisuna Kor-Ragna: 6 abilities at level 1, advent. Must stay saveable.
  const six = Array(6).fill(null).map(() => own('core'));
  const args = { economy: 'advent', level: 1, abilities: six, abilityPerks: [] };
  const stored = buildBreaches(args);
  const submitted = buildBreaches(args);
  expect(worsenedBreaches(stored, submitted)).toEqual([]);
});

test('the ratchet refuses a save that makes a stored breach worse', () => {
  // Advent has no unlock spend (util/perk-economy.js#unlockSpend), so a
  // seventh own-class Core ability worsens only the ability cap, not a Perk
  // deficit -- there is nothing to charge it against.
  const six = Array(6).fill(null).map(() => own('core'));
  const stored = buildBreaches({ economy: 'advent', level: 1, abilities: six, abilityPerks: [] });
  const submitted = buildBreaches({
    economy: 'advent', level: 1, abilities: [...six, own('core')], abilityPerks: []
  });
  const worsened = worsenedBreaches(stored, submitted);
  expect(worsened.map(b => b.rule)).toEqual([ABILITY_CAP_RULE]);
});

test('the ratchet lets a breached character improve toward legality', () => {
  const six = Array(6).fill(null).map(() => own('core'));
  const stored = buildBreaches({ economy: 'advent', level: 1, abilities: six, abilityPerks: [] });
  const submitted = buildBreaches({
    economy: 'advent', level: 1, abilities: six.slice(0, 4), abilityPerks: []
  });
  expect(worsenedBreaches(stored, submitted)).toEqual([]);
});

test('the ratchet refuses a brand-new breach on a previously clean character', () => {
  // Advent has no unlock spend, so the fourth own-class Core ability trips
  // only the ability cap -- the cap is the entire enforcement for this case.
  const stored = buildBreaches({
    economy: 'advent', level: 1,
    abilities: [own('core'), own('core'), own('core')], abilityPerks: []
  });
  expect(stored).toEqual([]);
  const submitted = buildBreaches({
    economy: 'advent', level: 1,
    abilities: [own('core'), own('core'), own('core'), own('core')], abilityPerks: []
  });
  expect(worsenedBreaches(stored, submitted).map(b => b.rule)).toEqual([ABILITY_CAP_RULE]);
});

test('the ratchet compares overage, so levelling up and spending the Perk is allowed', () => {
  // Khan Zahak Barzikani: 7 Ability Perks at level 7 (earned 6), deficit 1.
  // At level 8 he earns 7, and spending the new Perk keeps the deficit at 1.
  // Comparing raw spend would refuse that save; comparing overage allows it.
  const stored = buildBreaches({
    economy: 'advent', level: 7, abilities: [], abilityPerks: Array(7).fill({ id: 1 })
  });
  const submitted = buildBreaches({
    economy: 'advent', level: 8, abilities: [], abilityPerks: Array(8).fill({ id: 1 })
  });
  expect(stored.find(b => b.rule === PERK_DEFICIT_RULE).overage).toBe(1);
  expect(submitted.find(b => b.rule === PERK_DEFICIT_RULE).overage).toBe(1);
  expect(worsenedBreaches(stored, submitted)).toEqual([]);
});

test('the ratchet ignores soft breaches entirely', () => {
  // A soft notice is information, not a limit: an advent character swapping a
  // Core ability for a cross-class one stays saveable.
  const stored = buildBreaches({
    economy: 'advent', level: 5,
    abilities: [own('core'), own('core'), own('core')], abilityPerks: []
  });
  const submitted = buildBreaches({
    economy: 'advent', level: 5,
    abilities: [own('core'), own('core'), cross('core')], abilityPerks: []
  });
  expect(submitted.some(b => b.severity === 'soft')).toBe(true);
  expect(worsenedBreaches(stored, submitted)).toEqual([]);
});

test('worsenedBreaches tolerates a missing or non-array side', () => {
  expect(worsenedBreaches(null, null)).toEqual([]);
  expect(worsenedBreaches(undefined, [])).toEqual([]);
});

test('the cap and the balance are reported together, not one at a time', () => {
  // Independent rules: pg. 7 states the cap, the balance is separate
  // accounting. Suppressing one while the other holds lets a character over
  // the cap spend Perks with nothing to ratchet against.
  const breaches = buildBreaches({
    economy: 'advent', level: 1,
    abilities: Array(6).fill(null).map(() => own('core')),
    abilityPerks: [{ id: 1 }, { id: 2 }]
  });
  expect(breaches.filter(b => b.severity === 'hard').map(b => b.rule).sort())
    .toEqual([ABILITY_CAP_RULE, PERK_DEFICIT_RULE].sort());
});

test('a character over the cap cannot quietly add Ability Perks', () => {
  const six = Array(6).fill(null).map(() => own('core'));
  const stored = buildBreaches({ economy: 'advent', level: 1, abilities: six, abilityPerks: [] });
  const submitted = buildBreaches({
    economy: 'advent', level: 1, abilities: six, abilityPerks: Array(20).fill({ id: 1 })
  });
  expect(worsenedBreaches(stored, submitted).map(b => b.rule)).toEqual([PERK_DEFICIT_RULE]);
});
