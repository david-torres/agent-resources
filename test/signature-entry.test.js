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
const { economyFigures, equipmentSpend } = require('../util/merx-economy');

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
