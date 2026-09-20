const { test, expect, describe } = require('bun:test');
const { buildGearPurchaseData, applyGearPurchases } = require('./gear-purchase-data');
const { economyFigures } = require('./merx-economy');

const V1_CLASS = {
  id: 'c-v1',
  name: 'Gunslinger',
  content_format: 'aspirant',
  gear: [
    {
      name: 'Cowboy Hat',
      description: 'A hat.',
      meters: [{ label: 'Wear', value: '3' }],
      column: 1,
      position: 1,
      default_enchantment: { name: 'Shade', description: 'Keeps the sun off.' }
    },
    { name: 'Sharps Rifle', description: 'A rifle.', column: 1, position: 2 }
  ]
};

const ADVENT_CLASS = { id: 'c-advent', name: 'Ranger', content_format: 'advent', gear: [{ name: 'Bow' }] };

// Fixtures for the aspiring catalogue tests below: two distinct classes, each
// shaped like V1_CLASS above (id, name, content_format, gear[] of printed
// Signatures).
const v1ClassRow = () => ({
  id: 'c-v1',
  name: 'Gunslinger',
  content_format: 'aspirant',
  gear: [
    {
      name: 'Cowboy Hat',
      description: 'A hat.',
      meters: [{ label: 'Wear', value: '3' }],
      column: 1,
      position: 1,
      default_enchantment: { name: 'Shade', description: 'Keeps the sun off.' }
    },
    { name: 'Lasso', description: 'A rope.', column: 1, position: 2 }
  ]
});

const otherClassRow = () => ({
  id: 'c-other',
  name: 'Alchemist',
  content_format: 'aspirant',
  gear: [
    { name: 'Vial', description: 'A vial.', column: 1, position: 1 }
  ]
});

const build = (overrides = {}) => buildGearPurchaseData({
  economy: 'aspirant',
  characterClass: V1_CLASS,
  character: { class_id: V1_CLASS.id, gear: [] },
  missionMerx: 0,
  ...overrides
});

describe('which characters get a purchase surface', () => {
  test('the advent economy gets none, so the form it has today is unchanged', () => {
    expect(buildGearPurchaseData({
      economy: 'advent',
      characterClass: ADVENT_CLASS,
      character: { class_id: ADVENT_CLASS.id, gear: [] },
      missionMerx: 0
    })).toBeNull();
  });

  test('an aspirant class gets one', () => {
    expect(build().economy).toBe('aspirant');
  });

  test('an aspiring, class-less character gets one', () => {
    const data = buildGearPurchaseData({
      economy: 'aspiring',
      characterClass: null,
      character: { class_id: null, gear: [{ name: 'Borrowed Blade', class_id: 'c-other' }] },
      missionMerx: 0
    });
    expect(data.economy).toBe('aspiring');
    expect(data.characterClassId).toBeNull();
  });
});

describe('what the island carries', () => {
  test('the figures are the economy module\'s own, not a copy', () => {
    expect(build().figures).toEqual(economyFigures());
  });

  test('mission income rides alongside the grant rather than folded into it', () => {
    expect(build({ missionMerx: 4 }).earnedMerx).toBe(4);
  });

  test('every printed Signature is offered, with its description rendered', () => {
    const { entries } = build();
    expect(entries.map((e) => e.name)).toEqual(['Cowboy Hat', 'Sharps Rifle']);
    expect(entries[0].description_html).toContain('A hat.');
    expect(entries[0].default_enchantment.name).toBe('Shade');
    expect(entries[0].meters).toEqual([{ label: 'Wear', value: '3' }]);
    expect(entries[0].class_id).toBe('c-v1');
  });

  test('a stored Signature the class no longer prints is offered too', () => {
    const { entries } = build({
      character: {
        class_id: 'c-v1',
        gear: [{ name: 'Borrowed Blade', class_id: 'c-other', description: 'Not ours.' }]
      }
    });
    expect(entries.map((e) => e.name)).toContain('Borrowed Blade');
    expect(entries.find((e) => e.name === 'Borrowed Blade').class_id).toBe('c-other');
  });

  test('a stored Signature the class does print is offered once', () => {
    const { entries } = build({
      character: { class_id: 'c-v1', gear: [{ name: 'Cowboy Hat', class_id: 'c-v1' }] }
    });
    expect(entries.filter((e) => e.name === 'Cowboy Hat')).toHaveLength(1);
  });

  test('the purchases carry what each stored row already holds', () => {
    const { purchases } = build({
      character: {
        class_id: 'c-v1',
        gear: [{
          name: 'Cowboy Hat',
          class_id: 'c-v1',
          enchantment: { source: 'default' },
          mods: [{ name: 'Scope', description: 'Sees far' }]
        }]
      }
    });
    expect(purchases).toEqual([{
      name: 'Cowboy Hat',
      class_id: 'c-v1',
      enchantment: { source: 'default' },
      mods: [{ name: 'Scope', description: 'Sees far' }]
    }]);
  });

  test('a bare stored row reads as unenchanted with no Mods', () => {
    const { purchases } = build({
      character: { class_id: 'c-v1', gear: [{ name: 'Cowboy Hat', class_id: 'c-v1' }] }
    });
    expect(purchases[0].enchantment).toBeNull();
    expect(purchases[0].mods).toEqual([]);
  });

  test('a class with no roster still serves what the character owns', () => {
    const data = buildGearPurchaseData({
      economy: 'aspirant',
      characterClass: null,
      character: { class_id: 'c-v1', gear: [{ name: 'Borrowed Blade', class_id: 'c-other' }] },
      missionMerx: 1
    });
    expect(data.entries).toHaveLength(1);
    expect(data.purchases).toHaveLength(1);
  });
});

describe('the aspiring catalogue', () => {
  // A class-less character has no roster, so before this its grid held only
  // what it already owned and there was nothing to acquire.
  test('an aspiring island offers every class Signature outside the pool', () => {
    const data = buildGearPurchaseData({
      economy: 'aspiring',
      characterClass: null,
      allClasses: [v1ClassRow()],
      character: {
        class_id: null,
        aspiring_signatures: [{ class_id: 'c-v1', name: 'Cowboy Hat' }],
        gear: [{ name: 'Cowboy Hat', class_id: 'c-v1' }]
      },
      missionMerx: 0
    });
    const names = data.entries.map((e) => e.name);
    expect(names).toContain('Cowboy Hat');
    expect(names).toContain('Lasso');
    expect(data.entries.filter((e) => e.name === 'Cowboy Hat')).toHaveLength(1);
  });

  test('the island carries the stored pool', () => {
    const pool = [{ class_id: 'c-v1', name: 'Cowboy Hat' }];
    const data = buildGearPurchaseData({
      economy: 'aspiring',
      characterClass: null,
      allClasses: [v1ClassRow()],
      character: { class_id: null, aspiring_signatures: pool, gear: [] },
      missionMerx: 0
    });
    expect(data.aspiringSignatures).toEqual(pool);
  });

  // An aspirant character's own class comes from characterClass; the rest of
  // the catalogue must not be duplicated into its grid.
  test('an aspirant island is unchanged by the catalogue argument', () => {
    const data = buildGearPurchaseData({
      economy: 'aspirant',
      characterClass: v1ClassRow(),
      allClasses: [v1ClassRow(), otherClassRow()],
      character: { class_id: 'c-v1', gear: [] },
      missionMerx: 0
    });
    expect(data.entries.every((e) => e.class_id === 'c-v1')).toBe(true);
  });
});

// --- what comes back in ----------------------------------------------------

describe('the submitted gear field', () => {
  test('a body without the field is left alone', () => {
    const body = { name: 'Vex', gear: ['Gunslinger::Cowboy Hat'] };
    expect(applyGearPurchases(body)).toBe(true);
    expect(body.gear).toEqual(['Gunslinger::Cowboy Hat']);
  });

  test('the parsed list becomes the submission\'s gear', () => {
    const body = { gear_json: JSON.stringify([{ name: 'Cowboy Hat', class_id: 'c-v1', enchantment: null }]) };
    expect(applyGearPurchases(body)).toBe(true);
    expect(body.gear).toEqual([{ name: 'Cowboy Hat', class_id: 'c-v1', enchantment: null }]);
    expect('gear_json' in body).toBe(false);
  });

  test('an absent enchantment key survives the round trip, so the save keeps it', () => {
    const body = { gear_json: JSON.stringify([{ name: 'Cowboy Hat', class_id: 'c-v1' }]) };
    applyGearPurchases(body);
    expect('enchantment' in body.gear[0]).toBe(false);
  });

  // The field renders empty and is filled by the mount. A page whose script
  // never ran must still be able to save everything else, and must not read
  // as "this character now has no Signatures".
  test('an empty field is silence: gear is left for the save to keep', () => {
    const body = { gear_json: '', name: 'Vex' };
    expect(applyGearPurchases(body)).toBe(true);
    expect('gear' in body).toBe(false);
    expect('gear_json' in body).toBe(false);
  });

  test('an emptied list is a real instruction, not silence', () => {
    const body = { gear_json: '[]' };
    expect(applyGearPurchases(body)).toBe(true);
    expect(body.gear).toEqual([]);
  });

  test('malformed JSON is reported, never thrown', () => {
    const body = { gear_json: '{oops' };
    expect(applyGearPurchases(body)).toBe(false);
  });

  test('JSON that is not a list is reported too', () => {
    expect(applyGearPurchases({ gear_json: '{"name":"Cowboy Hat"}' })).toBe(false);
  });
});
