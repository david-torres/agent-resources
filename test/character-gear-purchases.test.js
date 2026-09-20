// test/character-gear-purchases.test.js
//
// public/js/character-gear-purchases.js is the edit form's mount for the
// shared SignatureEntry component. It lives under test/ rather than
// public/js/ because scripts/run-tests.mjs only walks
// ['models', 'routes', 'services', 'test', 'util', 'views'].
//
// THE RULE THIS FILE EXISTS FOR, first and loudest: on this surface an
// absent `enchantment` key means "keep what is stored". The wizard's rule is
// the opposite -- it creates a character, so nothing is stored and it sends
// an explicit null. Here a row the player never opened must submit no key at
// all, because this form has always submitted gear as bare "Class::Item"
// strings and such a save must not wipe a purchase.
const { test, expect, describe } = require('bun:test');
const {
  mountPurchases, fixtureCharacter, OWN_CLASS_ID, OWN_CLASS_NAME
} = require('./helpers/gear-purchase-fixture');
const { economyFigures } = require('../util/merx-economy');

const FIGURES = economyFigures();

const enchanted = (name) => ({
  name,
  class_id: OWN_CLASS_ID,
  enchantment: { source: 'default' },
  mods: []
});

describe('absent means keep, null means remove', () => {
  test('an untouched row submits no enchantment key, so the save keeps it', () => {
    const form = mountPurchases(fixtureCharacter({ gear: [enchanted('Cowboy Hat')] }));
    const [item] = form.serialize().gear;
    expect('enchantment' in item).toBe(false);
  });

  test('an untouched row submits no mods key either', () => {
    const form = mountPurchases(fixtureCharacter({
      gear: [{ name: 'Cowboy Hat', class_id: OWN_CLASS_ID, mods: [{ name: 'Scope', description: 'Sees far' }] }]
    }));
    const [item] = form.serialize().gear;
    expect('mods' in item).toBe(false);
  });

  test('un-enchanting submits an explicit null', () => {
    const form = mountPurchases(fixtureCharacter({ gear: [enchanted('Cowboy Hat')] }));
    form.setEnchantment('Cowboy Hat', null);
    const [item] = form.serialize().gear;
    expect(item.enchantment).toBeNull();
  });

  test('a row whose Enchantment changed submits the new one', () => {
    const form = mountPurchases(fixtureCharacter({ gear: [enchanted('Cowboy Hat')] }));
    form.setEnchantment('Cowboy Hat', { source: 'custom', name: 'Hex', description: 'Shades the wearer.' });
    const [item] = form.serialize().gear;
    expect(item.enchantment).toEqual({ source: 'custom', name: 'Hex', description: 'Shades the wearer.' });
  });

  test('editing one row leaves its neighbour untouched', () => {
    const form = mountPurchases(fixtureCharacter({
      gear: [enchanted('Cowboy Hat'), enchanted('Duster')]
    }));
    form.setEnchantment('Cowboy Hat', null);
    const [hat, duster] = form.serialize().gear;
    expect(hat.enchantment).toBeNull();
    expect('enchantment' in duster).toBe(false);
  });

  test('a newly bought Signature states both keys, having nothing stored to keep', () => {
    const form = mountPurchases(fixtureCharacter({ gear: [] }));
    form.buySignature('Cowboy Hat');
    const [item] = form.serialize().gear;
    expect(item.enchantment).toBeNull();
    expect(item.mods).toEqual([]);
  });

  test('every row carries its name and owning class', () => {
    const form = mountPurchases(fixtureCharacter({ gear: [enchanted('Cowboy Hat')] }));
    const [item] = form.serialize().gear;
    expect(item.name).toBe('Cowboy Hat');
    expect(item.class_id).toBe(OWN_CLASS_ID);
  });

  test('the hidden field carries the serialised gear, so htmx submits it', () => {
    const form = mountPurchases(fixtureCharacter({ gear: [enchanted('Cowboy Hat')] }));
    form.setEnchantment('Cowboy Hat', null);
    const field = document.getElementById('purchaseGearJson');
    expect(JSON.parse(field.value)).toEqual(form.serialize().gear);
  });
});

describe('the budget', () => {
  test('the budget is the grant plus mission income', () => {
    const form = mountPurchases(fixtureCharacter({ successfulMissions: 2 }));
    expect(form.getBudget()).toBe(FIGURES.grants.aspirant + 2);
  });

  test('an aspiring character gets its own grant', () => {
    const form = mountPurchases(fixtureCharacter({ creatorMode: 'aspiring', successfulMissions: 0 }));
    expect(form.getBudget()).toBe(FIGURES.grants.aspiring);
  });

  test('a purchase that overruns the budget is refused', () => {
    const form = mountPurchases(fixtureCharacter({ gear: [], earnedMerx: 0 }));
    // The aspirant grant buys six own-class Signatures and no seventh.
    const names = ['Cowboy Hat', 'Sharps Rifle', 'Bandolier', 'Bowie Knife', 'Wild Rag', 'Duster'];
    names.forEach((name) => expect(form.buySignature(name)).toBe(true));
    expect(form.getSpent()).toBe(form.getBudget());
    expect(form.buySignature('Rollups')).toBe(false);
    expect(form.serialize().gear).toHaveLength(names.length);
  });

  test('mission income pays for a purchase the bare grant could not', () => {
    const form = mountPurchases(fixtureCharacter({ gear: [], successfulMissions: 2 }));
    const names = ['Cowboy Hat', 'Sharps Rifle', 'Bandolier', 'Bowie Knife', 'Wild Rag', 'Duster', 'Rollups'];
    names.forEach((name) => expect(form.buySignature(name)).toBe(true));
    expect(form.serialize().gear).toHaveLength(names.length);
  });
});

describe('the surface', () => {
  test('the grid renders a cell per printed Signature', () => {
    mountPurchases(fixtureCharacter({ gear: [] }));
    expect(document.querySelectorAll('[data-signature-name]').length).toBe(12);
  });

  test('opening a cell renders the entry through the shared component', () => {
    const form = mountPurchases(fixtureCharacter({ gear: [enchanted('Cowboy Hat')] }));
    form.openSignature('Cowboy Hat');
    const drawer = document.getElementById('purchaseDrawer');
    expect(drawer.hidden).toBe(false);
    expect(drawer.innerHTML).toContain('Cowboy Hat');
    expect(drawer.innerHTML).toContain('entry-mods');
  });

  test('a stored Signature the class no longer prints is still submitted', () => {
    const data = fixtureCharacter({ gear: [] });
    data.purchases = [{ name: 'Borrowed Blade', class_id: 'c-other', enchantment: null, mods: [] }];
    const form = mountPurchases(data);
    const [item] = form.serialize().gear;
    expect(item.name).toBe('Borrowed Blade');
    expect(item.class_id).toBe('c-other');
    expect('enchantment' in item).toBe(false);
  });
});

describe('replacing a purchase warns first', () => {
  test('replacing a purchased Signature warns here too', () => {
    const form = mountPurchases(fixtureCharacter({ gear: [enchanted('Cowboy Hat')] }));
    form.removeSignature('Cowboy Hat');
    expect(form.getPendingConfirmation().lines.length).toBeGreaterThan(0);
  });

  test('the warning holds the removal back until it is confirmed', () => {
    const form = mountPurchases(fixtureCharacter({ gear: [enchanted('Cowboy Hat')] }));
    form.removeSignature('Cowboy Hat');
    expect(form.serialize().gear).toHaveLength(1);
    form.confirmPending();
    expect(form.serialize().gear).toHaveLength(0);
  });

  test('cancelling keeps the Signature and everything paid for on it', () => {
    const form = mountPurchases(fixtureCharacter({
      gear: [{
        name: 'Cowboy Hat',
        class_id: OWN_CLASS_ID,
        enchantment: { source: 'custom', name: 'Hex', description: 'Shades the wearer.' },
        mods: [{ name: 'Scope', description: 'Sees far' }]
      }]
    }));
    form.removeSignature('Cowboy Hat');
    form.cancelPending();
    expect(form.getPendingConfirmation()).toBeNull();
    const [item] = form.serialize().gear;
    // Never opened, never edited: the row still submits nothing about its
    // equipment, so the save keeps what is stored.
    expect('enchantment' in item).toBe(false);
    expect(form.getState().purchases[0].enchantment.name).toBe('Hex');
    expect(form.getState().purchases[0].mods).toHaveLength(1);
  });

  test('a bare Signature is removed without a warning', () => {
    const form = mountPurchases(fixtureCharacter({
      gear: [{ name: 'Cowboy Hat', class_id: OWN_CLASS_ID, enchantment: null, mods: [] }]
    }));
    form.removeSignature('Cowboy Hat');
    expect(form.getPendingConfirmation()).toBeNull();
    expect(form.serialize().gear).toHaveLength(0);
  });

  test('the dialog prints the lines describePurchase priced, and no figure of its own', () => {
    const form = mountPurchases(fixtureCharacter({ gear: [enchanted('Cowboy Hat')] }));
    form.removeSignature('Cowboy Hat');
    const dialog = document.getElementById('purchasePending');
    expect(dialog.hidden).toBe(false);
    form.getPendingConfirmation().lines.forEach((line) => {
      expect(dialog.textContent).toContain(line);
    });
  });
});

describe('only the hidden field submits', () => {
  // SignatureEntry renders its Enchantment radios as a named group, and the
  // drawer sits inside the edit form. Without a fix that name rides along in
  // the PUT body as a stray `enchantment` field -- dropped by the atomic save
  // but corrupting on the non-atomic updateCharacterRow fallback.
  test('an open drawer adds no field of its own to the form', () => {
    const form = mountPurchases(fixtureCharacter({ gear: [enchanted('Cowboy Hat')] }));
    form.openSignature('Cowboy Hat');

    const drawer = document.getElementById('purchaseDrawer');
    // The radios are there and still grouped -- this is not a test that the
    // controls were removed.
    expect(drawer.querySelectorAll('input[name="enchantment"]').length).toBeGreaterThan(0);

    const submitted = [...document.querySelector('form').elements].map((el) => el.name);
    expect(submitted).not.toContain('enchantment');
    expect(submitted).toContain('gear_json');
  });

  test('a Custom Enchantment\'s own fields are not submitted either', () => {
    const form = mountPurchases(fixtureCharacter({ gear: [enchanted('Cowboy Hat')] }));
    form.openSignature('Cowboy Hat');
    form.setEnchantment('Cowboy Hat', { source: 'custom', name: 'Hex', description: 'Shades.' });

    const submitted = [...document.querySelector('form').elements]
      .map((el) => el.name).filter(Boolean);
    expect(submitted).toEqual(['gear_json']);
  });

  test('the island survives a Signature name that would close the script element', () => {
    const data = fixtureCharacter({ gear: [] });
    data.entries[0].name = 'x</script><img src=x onerror=alert(1)>';
    const form = mountPurchases(data);

    // The mount parsed the island at all, which it could not have done if the
    // element had been closed early.
    expect(form).not.toBeNull();
    expect(form.getState().entries[0].name).toBe('x</script><img src=x onerror=alert(1)>');
    expect(document.querySelectorAll('img').length).toBe(0);
  });
});

describe('an aspiring character prices against its Signature pool', () => {
  // pg. 90's three are own-class...
  test('an aspiring character pays own-class for a Signature in its pool', () => {
    const form = mountPurchases(fixtureCharacter({
      economy: 'aspiring',
      aspiringSignatures: [{ class_id: OWN_CLASS_ID, name: 'Cowboy Hat' }],
      gear: []
    }));
    form.buySignature('Cowboy Hat');
    expect(form.getSpent()).toBe(FIGURES.prices.signature.own);
  });

  // ...and everything else is not.
  test('an aspiring character pays cross-class for a Signature outside its pool', () => {
    const form = mountPurchases(fixtureCharacter({
      economy: 'aspiring',
      aspiringSignatures: [{ class_id: OWN_CLASS_ID, name: 'Cowboy Hat' }],
      gear: []
    }));
    form.buySignature('Lasso');
    expect(form.getSpent()).toBe(FIGURES.prices.signature.cross);
  });

  // An Enchantment on a cross-class Signature is dearer too (pg. 85).
  test('an Enchantment on a Signature outside the pool prices cross-class', () => {
    const form = mountPurchases(fixtureCharacter({
      economy: 'aspiring',
      aspiringSignatures: [{ class_id: OWN_CLASS_ID, name: 'Cowboy Hat' }],
      gear: []
    }));
    form.buySignature('Lasso');
    form.setEnchantment('Lasso', { source: 'default' });
    expect(form.getSpent()).toBe(
      FIGURES.prices.signature.cross + FIGURES.prices.defaultEnchantment.cross
    );
  });

  // The origin badge (renderCell) names the class a cross-class Signature
  // came from; a pooled Signature is not tagged, since it constitutes the
  // character's own invented class.
  test('the origin badge names the class of an acquired Signature but not a pooled one', () => {
    mountPurchases(fixtureCharacter({
      economy: 'aspiring',
      aspiringSignatures: [{ class_id: OWN_CLASS_ID, name: 'Cowboy Hat' }],
      gear: []
    }));
    const grid = document.getElementById('purchaseGrid');
    const cells = [...grid.querySelectorAll('[data-signature-name]')];
    const cowboyHat = cells.find((c) => c.getAttribute('data-signature-name') === 'Cowboy Hat');
    const lasso = cells.find((c) => c.getAttribute('data-signature-name') === 'Lasso');
    expect(cowboyHat.querySelector('.tag.is-info')).toBeNull();
    expect(lasso.querySelector('.tag.is-info')).not.toBeNull();
    expect(lasso.querySelector('.tag.is-info').textContent).toBe(OWN_CLASS_NAME);
  });
});

describe('the component stays a pure function of its arguments', () => {
  test('the mount reads the page; signature-entry.js reads no global', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'js', 'signature-entry.js'), 'utf8'
    );
    const body = source.slice(source.indexOf("'use strict';"));
    expect(body).not.toMatch(/\bdocument\./);
    expect(body).not.toMatch(/\bwindow\.(?!SignatureEntry)/);
  });

  test('no economy figure is written down in the mount', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'js', 'character-gear-purchases.js'), 'utf8'
    );
    const code = source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
    expect(code).not.toMatch(/grants\s*=\s*\{/);
    expect(code).toContain('FIGURES.grants');
    expect(code).toContain('FIGURES.signatureCap');
  });
});
