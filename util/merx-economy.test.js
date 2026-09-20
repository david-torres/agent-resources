// Every figure here is quoted from ENCLAVE: Aspirant V1 at the printed page
// named. The book is the authority; this file is the fixture that holds the
// implementation to it. util/merx-economy.js must never be the only place a
// number appears -- if these two disagree, the book decides.
const { test, expect, describe } = require('bun:test');
const {
  economyFor,
  economyFigures,
  priceOfSignature,
  priceOfEnchantment,
  priceOfMod,
  equipmentSpend,
  signatureSlotsUsed,
  withPreservedEquipment,
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
});

test('advent grants the Elective, aspirant and aspiring their book figures', () => {
  expect(CREATION_GRANT).toEqual({ advent: 2, aspirant: 12, aspiring: 10 });
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

// --- withPreservedEquipment: limits judge what a save LEAVES --------------
//
// pg. 8 charges an Enchantment a cap slot, and every Enchantment and Mod
// costs Merx, so both the slot count and the spend have to be taken against
// the equipment a save leaves on the character, not the equipment the
// submission happens to mention. A submitted item that omits `enchantment`
// and `mods` keeps whatever is stored (services/character/input.js
// normalizeGearEquipment and the save_character_atomic RPC), so reading the
// submission alone lets two saves walk a character past the cap and lets an
// auto-calculated edit refund Merx that is still spent.

const stored = (name, classId, enchantment, mods = []) => ({ name, class_id: classId, enchantment, mods });

test('an item that omits enchantment inherits the stored one', () => {
  const effective = withPreservedEquipment(
    [{ name: 'Blade', class_id: 'c1' }],
    [stored('Blade', 'c1', { source: 'default' })]
  );
  expect(effective[0].enchantment).toEqual({ source: 'default' });
  expect(signatureSlotsUsed(effective)).toBe(2);
});

test('an explicit null removes the stored Enchantment, so it costs no slot', () => {
  const effective = withPreservedEquipment(
    [{ name: 'Blade', class_id: 'c1', enchantment: null }],
    [stored('Blade', 'c1', { source: 'default' })]
  );
  expect(signatureSlotsUsed(effective)).toBe(1);
});

test('an item with its own Enchantment replaces the stored one, costing one slot', () => {
  const effective = withPreservedEquipment(
    [{ name: 'Blade', class_id: 'c1', enchantment: { source: 'custom', name: 'Hex' } }],
    [stored('Blade', 'c1', { source: 'default' })]
  );
  expect(effective[0].enchantment).toEqual({ source: 'custom', name: 'Hex' });
  expect(signatureSlotsUsed(effective)).toBe(2);
});

test('an unenchanted stored row leaves an omitting item unenchanted', () => {
  const effective = withPreservedEquipment(
    [{ name: 'Blade', class_id: 'c1' }],
    [stored('Blade', 'c1', null)]
  );
  expect(signatureSlotsUsed(effective)).toBe(1);
});

// A bare "ClassName::ItemName" submission carries a class NAME, not an id, so
// pairing falls back to the name alone -- but an item that DOES carry a
// class_id must not inherit another class's Enchantment.
test('a class_id on the submitted item discriminates between same-named rows', () => {
  const effective = withPreservedEquipment(
    [{ name: 'Blade', class_id: 'c2' }],
    [stored('Blade', 'c1', { source: 'default' })]
  );
  expect(signatureSlotsUsed(effective)).toBe(1);
});

test('a name-only item pairs with a same-named row of any class', () => {
  const effective = withPreservedEquipment(
    [{ name: 'Blade' }],
    [stored('Blade', 'c1', { source: 'default' })]
  );
  expect(signatureSlotsUsed(effective)).toBe(2);
});

// N identical items consume N stored rows, so a second copy of a name with
// only one enchanted row inherits nothing.
test('each stored row is claimed once', () => {
  const effective = withPreservedEquipment(
    [{ name: 'Blade', class_id: 'c1' }, { name: 'Blade', class_id: 'c1' }],
    [stored('Blade', 'c1', { source: 'default' }), stored('Blade', 'c1', null)]
  );
  expect(signatureSlotsUsed(effective)).toBe(3);
});

// The create path has no stored rows at all: every existing caller must see
// exactly the list it passed in.
test('no stored rows leaves the submitted list alone', () => {
  const submitted = [{ name: 'Blade', class_id: 'c1' }, { name: 'Shield' }];
  expect(withPreservedEquipment(submitted, undefined)).toEqual(submitted);
  expect(withPreservedEquipment(submitted, [])).toEqual(submitted);
  expect(signatureSlotsUsed(withPreservedEquipment(submitted, []))).toBe(2);
});

test('an unmatched submitted item inherits nothing', () => {
  const effective = withPreservedEquipment(
    [{ name: 'Shield', class_id: 'c1' }],
    [stored('Blade', 'c1', { source: 'default' })]
  );
  expect(signatureSlotsUsed(effective)).toBe(1);
});

// The Merx half of the same contract: Mods are priced, and an untouched row
// submits neither key, so an omitted `mods` must be carried too or every
// auto-calculated edit hands its Mods back as unspent Merx.
test('an item that omits mods inherits the stored ones', () => {
  const effective = withPreservedEquipment(
    [{ name: 'Blade', class_id: 'c1' }],
    [stored('Blade', 'c1', null, [{ name: 'Scope' }, { name: 'Sling' }])]
  );
  expect(effective[0].mods).toEqual([{ name: 'Scope' }, { name: 'Sling' }]);
  expect(equipmentSpend(effective, { economy: 'aspirant', characterClassId: 'c1' }))
    .toBe(equipmentSpend(
      [stored('Blade', 'c1', null, [{ name: 'Scope' }, { name: 'Sling' }])],
      { economy: 'aspirant', characterClassId: 'c1' }
    ));
});

test('an explicit empty mods list strips the stored Mods', () => {
  const effective = withPreservedEquipment(
    [{ name: 'Blade', class_id: 'c1', enchantment: null, mods: [] }],
    [stored('Blade', 'c1', null, [{ name: 'Scope' }])]
  );
  expect(effective[0].mods).toEqual([]);
});

// Same-named stored rows are ambiguous, so the claim is biased to the dearest
// one: this can over-report a limit, never under-report it.
test('the dearest same-named row is claimed first', () => {
  const effective = withPreservedEquipment(
    [{ name: 'Blade', class_id: 'c1' }],
    [stored('Blade', 'c1', null, []), stored('Blade', 'c1', null, [{ name: 'Scope' }])]
  );
  expect(effective[0].mods).toEqual([{ name: 'Scope' }]);
});

describe('economyFigures', () => {
  test('carries every figure a surface needs, and no function', () => {
    const figures = economyFigures();
    expect(figures).toEqual({
      grants: CREATION_GRANT,
      signatureCap: SIGNATURE_CAP,
      modsPerSignature: MODS_PER_SIGNATURE,
      enchantmentWordLimit: ENCHANTMENT_WORD_LIMIT,
      modWordLimit: MOD_WORD_LIMIT,
      prices: {
        commonItem: COMMON_ITEM_PRICE,
        signature: { own: 2, cross: 3 },
        defaultEnchantment: { own: 2, cross: 3 },
        customEnchantment: { own: 3, cross: 4 },
        mod: { own: [1, 2], cross: [2, 3] }
      }
    });
  });

  test('survives JSON, because that is how it reaches a browser', () => {
    expect(JSON.parse(JSON.stringify(economyFigures()))).toEqual(economyFigures());
  });

  test('is built from the pricing functions, not retyped', () => {
    const { prices } = economyFigures();
    expect(prices.signature.cross).toBe(priceOfSignature({ crossClass: true }));
    expect(prices.customEnchantment.own).toBe(priceOfEnchantment({ source: 'custom' }));
    expect(prices.mod.cross[1]).toBe(priceOfMod({ index: 1, crossClass: true }));
  });

  test('hands back a fresh object, so a caller cannot mutate the module', () => {
    economyFigures().grants.advent = 99;
    expect(CREATION_GRANT.advent).toBe(2);
  });
});
