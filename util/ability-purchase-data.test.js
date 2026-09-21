const { test, expect, describe } = require('bun:test');
const { buildAbilityPurchaseData, applyAbilityPurchases } = require('./ability-purchase-data');
const { normalizeLevel, LEVEL_CEILING } = require('./stat-caps');
const { abilityPerkSpend } = require('./perk-economy');

const CLASS_A = { id: 'a', name: 'Gunslinger', abilities: [{ name: 'Standoff' }], advanced_abilities: [{ name: 'Last Word' }] };
const CLASS_B = { id: 'b', name: 'Illusionist', abilities: [{ name: 'Viewpoint' }], advanced_abilities: [] };

test('an own-class Advanced ability is offered at 2 Perks', () => {
  const data = buildAbilityPurchaseData({
    character: { class_id: 'a', abilities: [], ability_perks: [], level: 5 },
    characterClass: CLASS_A, allClasses: [CLASS_A, CLASS_B], economy: 'aspirant'
  });
  const entry = data.entries.find(e => e.name === 'Last Word');
  expect(entry.type).toBe('advanced');
  expect(entry.crossClass).toBe(false);
  expect(entry.price).toBe(2);
});

test('a cross-class Core ability is offered at 3 and an Advanced at 4', () => {
  const data = buildAbilityPurchaseData({
    character: { class_id: 'a', abilities: [], ability_perks: [], level: 5 },
    characterClass: CLASS_A, allClasses: [CLASS_A, CLASS_B], economy: 'aspirant'
  });
  expect(data.entries.find(e => e.name === 'Viewpoint').price).toBe(3);
});

test('the catalogue carries every unlocked class, not only the character own', () => {
  const data = buildAbilityPurchaseData({
    character: { class_id: 'a', abilities: [], ability_perks: [], level: 5 },
    characterClass: CLASS_A, allClasses: [CLASS_A, CLASS_B], economy: 'aspirant'
  });
  expect(new Set(data.entries.map(e => e.class_name))).toEqual(new Set(['Gunslinger', 'Illusionist']));
});

test('an aspiring character pool ability is own-class and its price is 1 or 2', () => {
  const data = buildAbilityPurchaseData({
    character: {
      class_id: null, abilities: [], ability_perks: [], level: 1,
      aspiring_abilities: [{ class_id: 'a', name: 'Standoff', type: 'core' }]
    },
    characterClass: null, allClasses: [CLASS_A, CLASS_B], economy: 'aspiring'
  });
  const pooled = data.entries.find(e => e.name === 'Standoff');
  expect(pooled.crossClass).toBe(false);
  expect(pooled.price).toBe(1);
});

test('an aspiring character unbought pick is still in the catalogue', () => {
  // The defect this mirrors: a pick that was selected but never bought fell
  // out of the Signature catalogue and became unbuyable.
  const data = buildAbilityPurchaseData({
    character: {
      class_id: null, abilities: [], ability_perks: [], level: 1,
      aspiring_abilities: [{ class_id: 'a', name: 'Standoff', type: 'core' }]
    },
    characterClass: null, allClasses: [CLASS_A, CLASS_B], economy: 'aspiring'
  });
  expect(data.entries.some(e => e.name === 'Standoff')).toBe(true);
});

test('the island carries the served figures, not its own numbers', () => {
  const data = buildAbilityPurchaseData({
    character: { class_id: 'a', abilities: [], ability_perks: [], level: 1 },
    characterClass: CLASS_A, allClasses: [CLASS_A], economy: 'aspirant'
  });
  expect(data.figures.prices.ability.cross.advanced).toBe(4);
  expect(data.figures.abilityCap.aspirant).toBe(6);
});

test('an ability from a newer version of the character own class family is priced at the own rate', () => {
  // allClasses has already been collapsed to the newest version per family
  // (util/class-list-grouping.js#latestClassVersions), so the character's
  // OLDER own class and the catalogue's version of that same family arrive
  // under two different class_ids. Without classFamilyOf resolving them to
  // the same family, this ability prices as cross-class instead of own.
  const OLD_GUNSLINGER = { id: 'a-v1', name: 'Gunslinger', abilities: [{ name: 'Standoff' }], advanced_abilities: [] };
  const NEW_GUNSLINGER = { id: 'a-v2', name: 'Gunslinger', abilities: [{ name: 'Standoff' }, { name: 'Quick Draw' }], advanced_abilities: [] };
  const classFamilyOf = (id) => (id === 'a-v1' || id === 'a-v2' ? 'fam-gunslinger' : id);
  const data = buildAbilityPurchaseData({
    character: { class_id: 'a-v1', abilities: [], ability_perks: [], level: 5 },
    characterClass: OLD_GUNSLINGER, allClasses: [NEW_GUNSLINGER], economy: 'aspirant', classFamilyOf
  });
  const entry = data.entries.find(e => e.name === 'Quick Draw');
  expect(entry.crossClass).toBe(false);
  expect(entry.price).toBe(1);
});

// The browser must not re-derive this clamp itself (it only guards against a
// non-numeric value) -- services/character/service.js's ratchet, and
// util/perk-economy.js#perkAllotment underneath it, both score a level
// through normalizeLevel, so a served level past the ceiling would let the
// purchase surface show an earned balance the server does not agree with.
test('a character stored above the level ceiling is served the ceiling, not the raw value', () => {
  const data = buildAbilityPurchaseData({
    character: { class_id: 'a', abilities: [], ability_perks: [], level: 999 },
    characterClass: CLASS_A, allClasses: [CLASS_A], economy: 'aspirant'
  });
  expect(data.level).toBe(LEVEL_CEILING);
  expect(data.level).toBe(normalizeLevel(999));
  const earnedFromServed = data.figures.grants.aspirant + data.figures.perksPerLevel * (data.level - 1);
  const earnedAtCeiling = data.figures.grants.aspirant + data.figures.perksPerLevel * (LEVEL_CEILING - 1);
  expect(earnedFromServed).toBe(earnedAtCeiling);
});

// util/perk-economy.js#perkSpend charges unlockSpend PLUS abilityPerkSpend;
// the island must serve the second term too, or the surface only ever shows
// the first half of what the server ratchets a save against.
test('the served abilityPerkSpend is the character\'s existing Ability-Perk spend, not recomputed by a caller', () => {
  const perks = [{ id: 'p1' }, { id: 'p2' }];
  const data = buildAbilityPurchaseData({
    character: { class_id: 'a', abilities: [], ability_perks: perks, level: 5 },
    characterClass: CLASS_A, allClasses: [CLASS_A], economy: 'aspirant'
  });
  expect(data.abilityPerkSpend).toBe(abilityPerkSpend(perks));
  expect(data.abilityPerkSpend).toBe(2);
});

// --- what comes back in -----------------------------------------------------
// Mirrors util/gear-purchase-data.test.js's "the submitted gear field" block:
// applyAbilityPurchases is applyGearPurchases's shape, naming and failure
// signalling, for abilities_json -> body.abilities instead of
// gear_json -> body.gear.

describe('the submitted abilities field', () => {
  test('a body without the field is left alone', () => {
    const body = { name: 'Vex', abilities: [{ name: 'Standoff', class_id: 'a', type: 'core' }] };
    expect(applyAbilityPurchases(body)).toBe(true);
    expect(body.abilities).toEqual([{ name: 'Standoff', class_id: 'a', type: 'core' }]);
  });

  test('the parsed list becomes the submission\'s abilities', () => {
    const body = { abilities_json: JSON.stringify([{ name: 'Standoff', class_id: 'a', type: 'core' }]) };
    expect(applyAbilityPurchases(body)).toBe(true);
    expect(body.abilities).toEqual([{ name: 'Standoff', class_id: 'a', type: 'core' }]);
    expect('abilities_json' in body).toBe(false);
  });

  // The browser always sends `type` explicit (public/js/character-ability-
  // purchases.js#serialize), but a caller that omits it must not be silently
  // upgraded to 'core' by this function -- services/character/service.js's
  // resolveSubmittedAbilities is what falls back, and it falls back to the
  // stored type, not to Core.
  test('an absent type key survives the round trip, so the resolver falls back to the stored type', () => {
    const body = { abilities_json: JSON.stringify([{ name: 'Standoff', class_id: 'a' }]) };
    applyAbilityPurchases(body);
    expect('type' in body.abilities[0]).toBe(false);
  });

  // The field renders empty and is filled by the mount. A page whose script
  // never ran must still be able to save everything else, and must not read
  // as "this character now has no Abilities".
  test('an empty field is silence: abilities is left for the save to keep', () => {
    const body = { abilities_json: '', name: 'Vex' };
    expect(applyAbilityPurchases(body)).toBe(true);
    expect('abilities' in body).toBe(false);
    expect('abilities_json' in body).toBe(false);
  });

  test('an emptied list is a real instruction, not silence', () => {
    const body = { abilities_json: '[]' };
    expect(applyAbilityPurchases(body)).toBe(true);
    expect(body.abilities).toEqual([]);
  });

  test('malformed JSON is reported, never thrown', () => {
    const body = { abilities_json: '{oops' };
    expect(applyAbilityPurchases(body)).toBe(false);
  });

  test('JSON that is not a list is reported too', () => {
    expect(applyAbilityPurchases({ abilities_json: '{"name":"Standoff"}' })).toBe(false);
  });
});
