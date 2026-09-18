// Every figure here is quoted from ENCLAVE: Aspirant V1 at the printed page
// named. The book is the authority; this file is the fixture that holds the
// implementation to it. util/merx-economy.js must never be the only place a
// number appears -- if these two disagree, the book decides.
const { test, expect } = require('bun:test');
const {
  economyFor,
  priceOfSignature,
  priceOfEnchantment,
  priceOfMod,
  equipmentSpend,
  signatureSlotsUsed,
  countWordsExcludingRatings,
  COMMON_ITEM_PRICE,
  CREATION_GRANT,
  SIGNATURE_CAP,
  ABILITY_CAP,
  MODS_PER_SIGNATURE,
  ENCHANTMENT_WORD_LIMIT,
  MOD_WORD_LIMIT
} = require('./merx-economy');

// pg. 85, "Spending Merx". Cross-Class is uniformly +1 at every tier.
const PRICES = [
  ['own Signature',              () => priceOfSignature({ crossClass: false }),                        2],
  ['cross-class Signature',      () => priceOfSignature({ crossClass: true }),                         3],
  ['own Default Enchantment',    () => priceOfEnchantment({ source: 'default', crossClass: false }),   2],
  ['cross Default Enchantment',  () => priceOfEnchantment({ source: 'default', crossClass: true }),    3],
  ['own Custom Enchantment',     () => priceOfEnchantment({ source: 'custom', crossClass: false }),    3],
  ['cross Custom Enchantment',   () => priceOfEnchantment({ source: 'custom', crossClass: true }),     4],
  ['own first Mod',              () => priceOfMod({ index: 0, crossClass: false }),                    1],
  ['own second Mod',             () => priceOfMod({ index: 1, crossClass: false }),                    2],
  ['cross first Mod',            () => priceOfMod({ index: 0, crossClass: true }),                     2],
  ['cross second Mod',           () => priceOfMod({ index: 1, crossClass: true }),                     3]
];

for (const [label, priced, expected] of PRICES) {
  test(`pg. 85 prices a ${label} at ${expected} Merx`, () => {
    expect(priced()).toBe(expected);
  });
}

test('a Common Item costs 1 Merx (pg. 85)', () => {
  expect(COMMON_ITEM_PRICE).toBe(1);
});

test('an unenchanted Signature is priced with no enchantment component', () => {
  expect(priceOfEnchantment({ source: null, crossClass: false })).toBe(0);
});

test('grants are 12 Merx for a V1 class and 10 for aspiring (pp. 3, 90)', () => {
  expect(CREATION_GRANT.aspirant).toBe(12);
  expect(CREATION_GRANT.aspiring).toBe(10);
  expect(CREATION_GRANT.advent).toBe(0);
});

test('caps are 12/8 Signatures and 6/4 Abilities (pp. 85, 92)', () => {
  expect(SIGNATURE_CAP.aspirant).toBe(12);
  expect(SIGNATURE_CAP.aspiring).toBe(8);
  expect(ABILITY_CAP.aspirant).toBe(6);
  expect(ABILITY_CAP.aspiring).toBe(4);
});

test('a Signature holds at most two Mods (pg. 87)', () => {
  expect(MODS_PER_SIGNATURE).toBe(2);
});

test('a Mod beyond the two-Mod cap is priced at the dearest tier, never free', () => {
  expect(priceOfMod({ index: 2, crossClass: false })).toBe(2);
  expect(priceOfMod({ index: 2, crossClass: true })).toBe(3);
});

test('word limits are 40 for a Custom Enchantment and 10 for a Mod (pp. 86, 87)', () => {
  expect(ENCHANTMENT_WORD_LIMIT).toBe(40);
  expect(MOD_WORD_LIMIT).toBe(10);
});

// pg. 8: "they count towards the Signature Cap of 12. This means that a
// character with six Enchanted Signatures could not bring any other
// Signatures onto a given mission." Mods "do not count towards the
// Signature cap."
test('an enchanted Signature uses two cap slots and an unenchanted one uses one', () => {
  expect(signatureSlotsUsed([{ name: 'A' }])).toBe(1);
  expect(signatureSlotsUsed([{ name: 'A', enchantment: { source: 'default' } }])).toBe(2);
});

test('six enchanted Signatures fill the cap of twelve exactly', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({
    name: `S${i}`, enchantment: { source: 'default' }
  }));
  expect(signatureSlotsUsed(six)).toBe(SIGNATURE_CAP.aspirant);
});

test('Mods never consume a cap slot', () => {
  expect(signatureSlotsUsed([{ name: 'A', mods: [{ name: 'm1' }, { name: 'm2' }] }])).toBe(1);
});

// pg. 86: "no more than 40 words long, minus Power Rating Superscripts".
test('a Power Rating superscript is not a word', () => {
  expect(countWordsExcludingRatings('Boosted <sup>L–H</sup> against magic')).toBe(3);
});

test('an empty or absent description counts zero words', () => {
  expect(countWordsExcludingRatings('')).toBe(0);
  expect(countWordsExcludingRatings(null)).toBe(0);
});

test('a Power Rating immediately followed by punctuation leaves no bare-punctuation word', () => {
  expect(countWordsExcludingRatings('Deals damage<sup>M</sup>.')).toBe(2);
});

test('a Power Rating inside parentheses or before a comma behaves the same', () => {
  expect(countWordsExcludingRatings('Deals damage (<sup>M</sup>), then burns')).toBe(4);
});

// pg. 90: an aspiring character's picks "are treated as belonging to your
// Class for the purposes of acquisition and improvement", so no surcharge.
test('aspiring prices every Signature own-class regardless of its class_id', () => {
  const gear = [
    { name: 'A', class_id: 'class-a' },
    { name: 'B', class_id: 'class-b' },
    { name: 'C', class_id: 'class-c' }
  ];
  expect(equipmentSpend(gear, { economy: 'aspiring', characterClassId: null })).toBe(6);
});

test('aspirant charges the cross-class surcharge on another class Signature', () => {
  const gear = [
    { name: 'A', class_id: 'mine' },
    { name: 'B', class_id: 'theirs' }
  ];
  expect(equipmentSpend(gear, { economy: 'aspirant', characterClassId: 'mine' })).toBe(5);
});

test('equipmentSpend adds a Signature, its Enchantment and both its Mods', () => {
  const gear = [{
    name: 'Wizarding Hat',
    class_id: 'mine',
    enchantment: { source: 'custom' },
    mods: [{ name: 'Lined' }, { name: 'Weighted' }]
  }];
  // 2 Signature + 3 Custom Enchantment + 1 first Mod + 2 second Mod
  expect(equipmentSpend(gear, { economy: 'aspirant', characterClassId: 'mine' })).toBe(8);
});

// The axis is content_format, not rules_edition: the six pre-release Aspirant
// classes are rules_edition 'aspirant' with content_format 'advent'.
test('economyFor reads content_format, and creator_mode only for aspiring', () => {
  expect(economyFor({ contentFormat: 'aspirant', creatorMode: 'aspirant' })).toBe('aspirant');
  expect(economyFor({ contentFormat: 'aspirant', creatorMode: null })).toBe('aspirant');
  expect(economyFor({ contentFormat: 'advent', creatorMode: 'aspirant' })).toBe('advent');
  expect(economyFor({ contentFormat: 'advent', creatorMode: 'advent' })).toBe('advent');
  expect(economyFor({})).toBe('advent');
});

test('an aspiring character has no class to read, so creator_mode decides', () => {
  expect(economyFor({ contentFormat: null, creatorMode: 'aspiring' })).toBe('aspiring');
  expect(economyFor({ contentFormat: undefined, creatorMode: 'aspiring' })).toBe('aspiring');
});
