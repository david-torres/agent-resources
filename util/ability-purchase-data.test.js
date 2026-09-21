const { test, expect } = require('bun:test');
const { buildAbilityPurchaseData } = require('./ability-purchase-data');

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
