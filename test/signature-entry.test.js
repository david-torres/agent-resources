// test/signature-entry.test.js
//
// Exercises public/js/signature-entry.js under jsdom the way
// test/character-wizard-client.test.js exercises character-wizard.js: read
// the source with fs, evaluate it with `new Function` against a jsdom
// window, then drive the exposed window.SignatureEntry handle.
//
// scripts/run-tests.mjs's file scan only walks
// ['models', 'routes', 'services', 'test', 'util', 'views'] -- `public` is
// absent, so a test placed under public/js/ would never run under
// `bun run test:unit`. This file lives under test/ instead.
const { test, expect, describe } = require('bun:test');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { economyFigures, equipmentSpend, countWordsExcludingRatings } = require('../util/merx-economy');

const SOURCE = fs.readFileSync('public/js/signature-entry.js', 'utf8');
const boot = () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  new Function(SOURCE)();
  return dom.window.SignatureEntry;
};

const FIGURES = economyFigures();
const entry = {
  name: 'Cowboy Hat',
  description_html: '<p>Provides Ward against sun and glare <sup>M</sup></p>',
  meters: [{ label: 'Ammunition', value: 'Mid' }],
  column: 1,
  position: 1,
  default_enchantment: { name: 'Hats Off to You', description: 'Portray a Turning Point.' }
};

describe('priceOf', () => {
  const SE = boot();
  test('a bare Signature costs its own-class price', () => {
    expect(SE.priceOf({ owned: true, enchantment: null, mods: [] }, { figures: FIGURES }))
      .toBe(FIGURES.prices.signature.own);
  });
  test('cross-class is the +1 tier throughout', () => {
    const purchase = {
      owned: true,
      enchantment: { source: 'custom', name: 'X', description: 'y' },
      mods: [{ name: 'Scope', description: 'z' }, { name: 'Sling', description: 'w' }]
    };
    expect(SE.priceOf(purchase, { figures: FIGURES, crossClass: true }))
      .toBe(FIGURES.prices.signature.cross
          + FIGURES.prices.customEnchantment.cross
          + FIGURES.prices.mod.cross[0] + FIGURES.prices.mod.cross[1]);
  });
  test('an unowned Signature costs nothing', () => {
    expect(SE.priceOf({ owned: false, enchantment: { source: 'default' }, mods: [] },
                      { figures: FIGURES })).toBe(0);
  });
  test('the second Mod costs more than the first', () => {
    expect(FIGURES.prices.mod.own[1]).toBeGreaterThan(FIGURES.prices.mod.own[0]);
  });
});

describe('slotsOf (pg. 8)', () => {
  const SE = boot();
  test('a bare Signature is one slot', () => {
    expect(SE.slotsOf({ owned: true, enchantment: null, mods: [] })).toBe(1);
  });
  test('an Enchantment costs a slot of its own', () => {
    expect(SE.slotsOf({ owned: true, enchantment: { source: 'default' }, mods: [] })).toBe(2);
  });
  test('Mods cost no slots', () => {
    expect(SE.slotsOf({ owned: true, enchantment: null, mods: [{ name: 'a' }, { name: 'b' }] }))
      .toBe(1);
  });
});

// The one test that stops the client and the server drifting apart. The
// component prices a list; util/merx-economy.js prices the same list; they
// must agree for every shape the UI can produce.
describe('the component agrees with the server it cannot require', () => {
  const SE = boot();
  const CLASS_ID = 'own-class';
  const shapes = [
    { name: 'A', class_id: CLASS_ID, enchantment: null, mods: [] },
    { name: 'B', class_id: CLASS_ID, enchantment: { source: 'default' }, mods: [] },
    { name: 'C', class_id: CLASS_ID, enchantment: { source: 'custom', name: 'n', description: 'd' }, mods: [] },
    { name: 'D', class_id: CLASS_ID, enchantment: null, mods: [{ name: 'm1' }] },
    { name: 'E', class_id: CLASS_ID, enchantment: { source: 'default' }, mods: [{ name: 'm1' }, { name: 'm2' }] },
    { name: 'F', class_id: 'other-class', enchantment: { source: 'custom', name: 'n', description: 'd' }, mods: [{ name: 'm1' }, { name: 'm2' }] }
  ];

  for (const economy of ['aspirant', 'aspiring']) {
    test(`${economy}: every subset prices identically on both sides`, () => {
      for (let mask = 1; mask < (1 << shapes.length); mask++) {
        const list = shapes.filter((_, i) => mask & (1 << i));
        const purchases = list.map((g) => ({ ...g, owned: true }));
        expect(SE.totalOf(purchases, { figures: FIGURES, economy, characterClassId: CLASS_ID }))
          .toBe(equipmentSpend(list, { economy, characterClassId: CLASS_ID }));
      }
    });
  }

  test('the served Mod price table is as long as the served Mod limit', () => {
    expect(FIGURES.prices.mod.own).toHaveLength(FIGURES.modsPerSignature);
    expect(FIGURES.prices.mod.cross).toHaveLength(FIGURES.modsPerSignature);
  });

  // Unreachable through the UI today -- the DB CHECK caps mods at 2 and
  // modRows only ever renders figures.modsPerSignature slots -- but the
  // component exists to make the duplicated arithmetic PROVABLY the
  // server's, so it must agree on every input, not only the reachable ones.
  // A separate direct test rather than a 7th shape in the subset sweep
  // above, which would double that sweep's size for one extra case.
  test('a third Mod (past the priced table) still prices the same on both sides', () => {
    const threeMods = { name: 'G', class_id: CLASS_ID, enchantment: null,
      mods: [{ name: 'm1' }, { name: 'm2' }, { name: 'm3' }] };
    for (const economy of ['aspirant', 'aspiring']) {
      const purchases = [{ ...threeMods, owned: true }];
      expect(SE.totalOf(purchases, { figures: FIGURES, economy, characterClassId: CLASS_ID }))
        .toBe(equipmentSpend([threeMods], { economy, characterClassId: CLASS_ID }));
    }
    const crossItem = { ...threeMods, class_id: 'other-class' };
    expect(SE.totalOf([{ ...crossItem, owned: true }],
                      { figures: FIGURES, economy: 'aspirant', characterClassId: CLASS_ID }))
      .toBe(equipmentSpend([crossItem], { economy: 'aspirant', characterClassId: CLASS_ID }));
  });

  // The word count is the other arithmetic the two sides duplicate. A Latin-
  // only test passes either way; a Custom written in another script is what
  // told them apart -- the client counted 0 and let the player type past the
  // limit, and the save refused what the counter had called empty.
  test('the word counter agrees with the server, in any script', () => {
    const texts = [
      '',
      '   ',
      'Ward against sun and glare',
      'damage<sup>M</sup>.',
      'A <sup>H</sup> B <sup>L</sup> C',
      '-- ... !',
      '\u65e5\u672c\u8a9e \u306e \u546a\u3044',
      '\u0417\u0430\u0449\u0438\u0442\u0430 \u043e\u0442 \u043e\u0433\u043d\u044f',
      '\u0645\u0642\u0627\u0648\u0645\u0629 \u0627\u0644\u0646\u0627\u0631<sup>M</sup>',
      'caf\u00e9 na\u00efve \u00fcber'
    ];
    for (const text of texts) {
      expect(SE.countWords(text)).toBe(countWordsExcludingRatings(text));
    }
  });

  // Of the six shapes above, only F is cross-class, and F carries a Custom
  // Enchantment -- so figures.prices.defaultEnchantment.cross is never
  // compared against equipmentSpend by the sweep. A direct comparison here
  // closes that hole without doubling the sweep to a 7th shape.
  test('a cross-class Default Enchantment prices the same on both sides', () => {
    const crossDefault = { name: 'H', class_id: 'other-class', enchantment: { source: 'default' }, mods: [] };
    for (const economy of ['aspirant', 'aspiring']) {
      const purchases = [{ ...crossDefault, owned: true }];
      expect(SE.totalOf(purchases, { figures: FIGURES, economy, characterClassId: CLASS_ID }))
        .toBe(equipmentSpend([crossDefault], { economy, characterClassId: CLASS_ID }));
    }
  });

  test('client and server agree on aspiring pool membership', () => {
    const pool = [
      { class_id: 'class-a', name: 'A' },
      { class_id: 'class-b', name: 'B' }
    ];
    const gear = [
      { name: 'A', class_id: 'class-a', owned: true, enchantment: null, mods: [] },
      { name: 'Z', class_id: 'class-z', owned: true, enchantment: null, mods: [] }
    ];
    const opts = { economy: 'aspiring', characterClassId: null, aspiringSignatures: pool };

    expect(SE.totalOf(gear, { figures: FIGURES, ...opts }))
      .toBe(equipmentSpend(gear, opts));
    expect(SE.isCrossClass(gear[0], opts)).toBe(false);
    expect(SE.isCrossClass(gear[1], opts)).toBe(true);
  });

  test('client and server agree that an empty aspiring pool is all own-class', () => {
    const gear = [{ name: 'Z', class_id: 'class-z', owned: true, enchantment: null, mods: [] }];
    const opts = { economy: 'aspiring', characterClassId: null, aspiringSignatures: [] };
    expect(SE.totalOf(gear, { figures: FIGURES, ...opts }))
      .toBe(equipmentSpend(gear, opts));
    expect(SE.isCrossClass(gear[0], opts)).toBe(false);
  });

  test('client and server agree that an all-null aspiring pool is all own-class', () => {
    const gear = [{ name: 'Z', class_id: 'class-z', owned: true, enchantment: null, mods: [] }];
    const opts = { economy: 'aspiring', characterClassId: null, aspiringSignatures: [null, null] };
    expect(SE.totalOf(gear, { figures: FIGURES, ...opts })).toBe(equipmentSpend(gear, opts));
    expect(SE.isCrossClass(gear[0], opts)).toBe(false);
  });
});

describe('describePurchase (Ruling 5: a replacement destroys what it carries)', () => {
  const SE = boot();
  test('describePurchase names what a replacement would destroy', () => {
    const described = SE.describePurchase({
      owned: true,
      enchantment: { source: 'default' },
      mods: [{ name: 'Scope', description: 'Sees far' }]
    }, { figures: FIGURES });
    expect(described.total)
      .toBe(FIGURES.prices.defaultEnchantment.own + FIGURES.prices.mod.own[0]);
    expect(described.lines).toEqual([
      'Default Enchantment  ' + FIGURES.prices.defaultEnchantment.own + 'm',
      'Mod: Scope  ' + FIGURES.prices.mod.own[0] + 'm'
    ]);
  });

  test('a bare Signature has nothing to lose', () => {
    expect(SE.describePurchase({ owned: true, enchantment: null, mods: [] }, { figures: FIGURES }))
      .toEqual({ total: 0, lines: [] });
  });

  test('a Custom Enchantment is named by its source, not its typed name', () => {
    const described = SE.describePurchase({
      owned: true,
      enchantment: { source: 'custom', name: 'Ricochet', description: 'Bounces once' },
      mods: []
    }, { figures: FIGURES });
    expect(described.total).toBe(FIGURES.prices.customEnchantment.own);
    expect(described.lines).toEqual([
      'Custom Enchantment  ' + FIGURES.prices.customEnchantment.own + 'm'
    ]);
  });

  test('cross-class prices the loss at the +1 tier, agreeing with priceOf', () => {
    const purchase = {
      owned: true,
      enchantment: { source: 'default' },
      mods: [{ name: 'Scope' }, { name: 'Sling' }]
    };
    const described = SE.describePurchase(purchase, { figures: FIGURES, crossClass: true });
    const bareSignature = SE.priceOf({ owned: true, enchantment: null, mods: [] },
      { figures: FIGURES, crossClass: true });
    expect(described.total + bareSignature)
      .toBe(SE.priceOf(purchase, { figures: FIGURES, crossClass: true }));
  });
});

describe('render', () => {
  const SE = boot();
  test('shows the printed entry: name, description, meters, Default and its text', () => {
    const html = SE.render(entry, { owned: false, enchantment: null, mods: [] },
                           { figures: FIGURES, economy: 'aspirant' });
    expect(html).toContain('Cowboy Hat');
    expect(html).toContain('Provides Ward');
    expect(html).toContain('Ammunition');
    expect(html).toContain('Default Enchantment');
    expect(html).toContain('Hats Off to You');
    expect(html).toContain('Portray a Turning Point.');
  });

  test('an unowned Signature shows the Default Enchantment text but no controls to buy it', () => {
    const html = SE.render(entry, { owned: false, enchantment: null, mods: [] },
                           { figures: FIGURES, economy: 'aspirant' });
    expect(html).toContain('Hats Off to You');
    expect(html).toContain('Portray a Turning Point.');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<input type="radio"');
    expect(html).not.toContain('entry-controls');
  });

  test('a Signature with no Default offers only Custom', () => {
    const html = SE.render({ ...entry, default_enchantment: null },
                           { owned: true, enchantment: null, mods: [] },
                           { figures: FIGURES, economy: 'aspirant' });
    expect(html).not.toContain('Default Enchantment');
    expect(html).toContain('Custom');
  });

  test('prices come from the figures, never from the markup', () => {
    const html = SE.render(entry, { owned: false, enchantment: null, mods: [] },
                           { figures: { ...FIGURES, prices: { ...FIGURES.prices, signature: { own: 99, cross: 100 } } },
                             economy: 'aspirant' });
    expect(html).toContain('99');
  });

  test('readOnly renders what was bought and no controls', () => {
    const html = SE.render(entry, { owned: true, enchantment: { source: 'default' }, mods: [{ name: 'Scope' }] },
                           { figures: FIGURES, economy: 'aspirant', readOnly: true });
    expect(html).toContain('Hats Off to You');
    expect(html).toContain('Scope');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<button');
  });

  test('player-authored text is escaped, class-authored HTML is not', () => {
    const html = SE.render(entry,
      { owned: true, enchantment: { source: 'custom', name: '<img src=x onerror=alert(1)>', description: 'd' }, mods: [] },
      { figures: FIGURES, economy: 'aspirant' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
    expect(html).toContain('<p>Provides Ward');
  });
});
