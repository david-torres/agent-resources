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
const { economyFigures, equipmentSpend } = require('../util/merx-economy');

const FIGURES = economyFigures();

const OTHER_CLASS_ID = 'c-other';
const OTHER_CLASS_NAME = 'Other Class';

// Two classes of two Signatures each, so a test can tell one group from another.
const twoClassEntries = () => ([
  { name: 'Cowboy Hat', class_id: OWN_CLASS_ID, class_name: OWN_CLASS_NAME, column: 1 },
  { name: 'Duster', class_id: OWN_CLASS_ID, class_name: OWN_CLASS_NAME, column: 2 },
  { name: 'Lasso', class_id: OTHER_CLASS_ID, class_name: OTHER_CLASS_NAME, column: 1 },
  { name: 'Spurs', class_id: OTHER_CLASS_ID, class_name: OTHER_CLASS_NAME, column: 2 }
]);

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

// Proves the real grid is actually wired to CatalogueControls's own grouping
// and search -- not just that cells still render (the tests above), which
// would stay green even if groupBy or searchOf were mis-wired or swapped for
// the wrong field.
describe('grouping and search, through the real grid', () => {
  test('the group headings are the class names entries are grouped by', () => {
    mountPurchases(fixtureCharacter({ gear: [], entries: twoClassEntries() }));
    const grid = document.getElementById('purchaseGrid');
    const headings = [...grid.querySelectorAll('[data-catalogue-group-heading]')]
      .map((h) => h.textContent);
    expect(headings).toEqual([OWN_CLASS_NAME, OTHER_CLASS_NAME]);
  });

  test('typing into the real search input filters by name across every group, and hides an empty group', () => {
    mountPurchases(fixtureCharacter({ gear: [], entries: twoClassEntries() }));
    const grid = document.getElementById('purchaseGrid');
    const searchInput = grid.querySelector('[data-catalogue-search]');
    expect(searchInput).not.toBeNull();

    // Search matches item names and class names, including every Other Class item.
    const Event = document.defaultView.Event;
    searchInput.value = 'o';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    const visible = [...grid.querySelectorAll('[data-signature-name]')]
      .map((el) => el.getAttribute('data-signature-name'));
    expect(visible.sort()).toEqual(['Cowboy Hat', 'Lasso', 'Spurs']);

    // A term only one class's entries match hides the other group entirely.
    searchInput.value = 'Cowboy';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    const headingsNarrowed = [...grid.querySelectorAll('[data-catalogue-group-heading]')]
      .map((h) => h.textContent);
    expect(headingsNarrowed).toEqual([OWN_CLASS_NAME]);
    expect(grid.textContent).not.toContain('Lasso');
    expect(grid.textContent).not.toContain('Spurs');

    // Clearing the search restores both groups and every cell.
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    const restored = [...grid.querySelectorAll('[data-signature-name]')]
      .map((el) => el.getAttribute('data-signature-name')).sort();
    expect(restored).toEqual(['Cowboy Hat', 'Duster', 'Lasso', 'Spurs']);
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
  const pool = ['Cowboy Hat', 'Sharps Rifle', 'Bandolier']
    .map((name) => ({ class_id: OWN_CLASS_ID, name }));
  const startingGear = [...pool, { class_id: OWN_CLASS_ID, name: 'Lasso' }];
  const atBoundary = (earnedMerx = 0) => mountPurchases(fixtureCharacter({
    economy: 'aspiring', aspiringSignatures: pool, gear: startingGear, earnedMerx
  }));
  const expectServerSpend = (form) => {
    expect(form.getSpent()).toBe(equipmentSpend(form.getState().purchases, {
      economy: 'aspiring', aspiringSignatures: pool
    }));
  };

  test('the last Merx buys a first Mod on a pooled Signature', () => {
    const form = atBoundary(); // three pooled Signatures cost 6; Lasso costs 3
    expect(form.getSpent()).toBe(9);
    expect(form.setMods('Cowboy Hat', [{ name: 'Scope' }], OWN_CLASS_ID)).toBe(true);
    expect(form.getSpent()).toBe(form.getBudget());
    expectServerSpend(form);
  });

  test('a cross-class first Mod needs two Merx and remains blocked with one', () => {
    const form = atBoundary();
    expect(form.setMods('Lasso', [{ name: 'Scope' }], OWN_CLASS_ID)).toBe(false);
    expect(form.getState().purchases[3].mods).toEqual([]);
    expect(form.getSpent()).toBe(9);
    expectServerSpend(form);

    const funded = atBoundary(1);
    expect(funded.setMods('Lasso', [{ name: 'Scope' }], OWN_CLASS_ID)).toBe(true);
    expect(funded.getSpent()).toBe(funded.getBudget());
    expectServerSpend(funded);
  });

  test('a pooled Default Enchantment uses the own-class price at the boundary', () => {
    const form = atBoundary(1); // two Merx remain
    expect(form.setEnchantment('Cowboy Hat', { source: 'default' }, OWN_CLASS_ID)).toBe(true);
    expect(form.getSpent()).toBe(form.getBudget());
    expectServerSpend(form);
  });

  test('a pooled Custom Enchantment uses the own-class price at the boundary', () => {
    const form = atBoundary(2); // three Merx remain
    expect(form.setEnchantment('Cowboy Hat', {
      source: 'custom', name: 'Hex', description: 'Shades the wearer.'
    }, OWN_CLASS_ID)).toBe(true);
    expect(form.getSpent()).toBe(form.getBudget());
    expectServerSpend(form);
  });

  test('a cross-class Enchantment retains its higher price', () => {
    const short = atBoundary(1); // two Merx remain; cross-class Default costs three
    expect(short.setEnchantment('Lasso', { source: 'default' }, OWN_CLASS_ID)).toBe(false);
    expect(short.getState().purchases[3].enchantment).toBeNull();
    expectServerSpend(short);

    const funded = atBoundary(2);
    expect(funded.setEnchantment('Lasso', { source: 'default' }, OWN_CLASS_ID)).toBe(true);
    expect(funded.getSpent()).toBe(funded.getBudget());
    expectServerSpend(funded);
  });

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
  });
});

// pg. 85: the Signature Cap limits what a character brings on a mission, not
// what it owns. Six enchanted Signatures are twelve mission slots; a seventh
// Signature is still a purchase the character may make.
describe('owning Signatures is limited by Merx alone', () => {
  test('a Signature past twelve mission slots is bought when Merx allows', () => {
    const stored = ['Cowboy Hat', 'Sharps Rifle', 'Bandolier', 'Bowie Knife', 'Wild Rag', 'Duster'].map(enchanted);
    const form = mountPurchases(fixtureCharacter({ gear: stored, earnedMerx: 100 }));
    expect(form.buySignature('Rollups')).toBe(true);
    expect(form.serialize().gear).toHaveLength(7);
  });
});

// With every class's Signatures listed the grid runs thousands of pixels
// tall, so a drawer parked after the whole grid opens far off-screen and a
// click on a cell looks like it did nothing. The drawer opens beside the
// group the clicked cell sits in, and is brought into view.
describe('the drawer opens where the clicked Signature is', () => {
  const mountTwoClasses = () => mountPurchases(fixtureCharacter({
    gear: [], entries: twoClassEntries(), earnedMerx: 100
  }));

  // The class-group copy of a cell; an owned Signature has a second copy in
  // Your Signatures.
  const cellFor = (name) => document.querySelector(
    `#purchaseGrid [data-signature-name="${name}"]:not([data-signature-yours])`
  );

  const expectDrawerAfterGroupOf = (name) => {
    const drawer = document.getElementById('purchaseDrawer');
    const group = cellFor(name).closest('[data-catalogue-group]');
    expect(drawer.hidden).toBe(false);
    // Compared by description rather than identity, so a failure names what
    // does follow the group instead of printing two whole elements.
    const follower = group.nextElementSibling;
    expect(follower ? (follower.id || follower.outerHTML.slice(0, 60)) : null).toBe('purchaseDrawer');
  };

  test('opening a Signature in the first group puts the drawer right after that group', () => {
    const form = mountTwoClasses();
    form.openSignature('Cowboy Hat', OWN_CLASS_ID);
    expectDrawerAfterGroupOf('Cowboy Hat');
  });

  test('opening a Signature in the last group puts the drawer right after that group', () => {
    const form = mountTwoClasses();
    form.openSignature('Lasso', OTHER_CLASS_ID);
    expectDrawerAfterGroupOf('Lasso');
  });

  test('clicking a Signature cell opens the drawer right after its group', () => {
    mountTwoClasses();
    cellFor('Cowboy Hat').click();
    expectDrawerAfterGroupOf('Cowboy Hat');
  });

  test('buying the open Signature through the drawer keeps the drawer after its group', () => {
    const form = mountTwoClasses();
    form.openSignature('Cowboy Hat', OWN_CLASS_ID);
    document.querySelector('#purchaseDrawer [data-signature-buy]').click();
    expect(form.serialize().gear.map((g) => g.name)).toEqual(['Cowboy Hat']);
    expectDrawerAfterGroupOf('Cowboy Hat');
  });

  test('buying the open Signature through the handle keeps the drawer after its group', () => {
    const form = mountTwoClasses();
    form.openSignature('Cowboy Hat', OWN_CLASS_ID);
    expect(form.buySignature('Cowboy Hat', OWN_CLASS_ID)).toBe(true);
    expectDrawerAfterGroupOf('Cowboy Hat');
  });

  test('opening a Signature scrolls the drawer into view', () => {
    const form = mountTwoClasses();
    // jsdom does not implement scrollIntoView, so the spy is installed on this
    // window's Element and removed again afterwards.
    const proto = document.defaultView.Element.prototype;
    const scrolled = [];
    proto.scrollIntoView = function () { scrolled.push(this); };
    try {
      form.openSignature('Cowboy Hat', OWN_CLASS_ID);
      const drawer = document.getElementById('purchaseDrawer');
      expect(scrolled.some((el) => el === drawer)).toBe(true);
    } finally {
      delete proto.scrollIntoView;
    }
  });

  const search = (term) => {
    const searchInput = document.querySelector('#purchaseGrid [data-catalogue-search]');
    searchInput.value = term;
    searchInput.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  };

  const expectDrawerInDocument = () => {
    expect(document.getElementById('purchaseDrawer')).not.toBeNull();
  };

  test('searching for a term the open Signature still matches keeps the drawer after its group', () => {
    const form = mountTwoClasses();
    form.openSignature('Cowboy Hat', OWN_CLASS_ID);
    search('Cow');
    expectDrawerInDocument();
    expectDrawerAfterGroupOf('Cowboy Hat');
  });

  test('clearing a search that filtered out the open Signature puts the drawer back after its group', () => {
    const form = mountTwoClasses();
    form.openSignature('Cowboy Hat', OWN_CLASS_ID);
    search('Lasso');
    search('');
    expectDrawerInDocument();
    expectDrawerAfterGroupOf('Cowboy Hat');
  });
});

// Owned Signatures are otherwise only an "Owned" tag scattered across every
// class's group, so the grid opens with a group of just the character's own.
describe('Your Signatures', () => {
  const YOURS = 'Your Signatures';

  const bare = (name, classId) => ({ name, class_id: classId, enchantment: null, mods: [] });

  const mountOwning = (gear) => mountPurchases(fixtureCharacter({
    gear, entries: twoClassEntries(), earnedMerx: 100
  }));

  const groups = () => [...document.querySelectorAll('#purchaseGrid [data-catalogue-group]')];
  const headingOf = (group) => {
    const heading = group.querySelector('[data-catalogue-group-heading]');
    return heading ? heading.textContent : null;
  };
  const headings = () => groups().map(headingOf);
  const namesIn = (group) => [...group.querySelectorAll('[data-signature-name]')]
    .map((cell) => cell.getAttribute('data-signature-name'));
  const yoursGroup = () => groups().find((group) => headingOf(group) === YOURS) || null;
  const namesInYours = () => (yoursGroup() ? namesIn(yoursGroup()) : []);

  const yoursCell = (name) => document.querySelector(
    `#purchaseGrid [data-signature-yours][data-signature-name="${name}"]`
  );
  const classCell = (name) => document.querySelector(
    `#purchaseGrid [data-signature-name="${name}"]:not([data-signature-yours])`
  );

  const followerOf = (group) => {
    const next = group.nextElementSibling;
    return next ? (next.id || next.outerHTML.slice(0, 60)) : null;
  };

  const search = (term) => {
    const searchInput = document.querySelector('#purchaseGrid [data-catalogue-search]');
    searchInput.value = term;
    searchInput.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  };

  test('the first group is Your Signatures, listing what the character owns in purchase order', () => {
    // Bought in the reverse of catalogue order, so purchase order is what shows.
    mountOwning([bare('Lasso', OTHER_CLASS_ID), bare('Cowboy Hat', OWN_CLASS_ID)]);
    expect(headings()).toEqual([YOURS, OWN_CLASS_NAME, OTHER_CLASS_NAME]);
    expect(namesIn(groups()[0])).toEqual(['Lasso', 'Cowboy Hat']);
  });

  test('an owned Signature still appears in its own class group, tagged Owned', () => {
    mountOwning([bare('Lasso', OTHER_CLASS_ID)]);
    const cell = classCell('Lasso');
    expect(cell).not.toBeNull();
    expect(headingOf(cell.closest('[data-catalogue-group]'))).toBe(OTHER_CLASS_NAME);
    expect(cell.textContent).toContain('Owned');
  });

  test('every cell in Your Signatures, and no other, is marked data-signature-yours', () => {
    mountOwning([bare('Lasso', OTHER_CLASS_ID), bare('Cowboy Hat', OWN_CLASS_ID)]);
    const marked = [...document.querySelectorAll('#purchaseGrid [data-signature-yours]')];
    expect(marked.map((cell) => cell.getAttribute('data-signature-name'))).toEqual(['Lasso', 'Cowboy Hat']);
    marked.forEach((cell) => {
      expect(headingOf(cell.closest('[data-catalogue-group]'))).toBe(YOURS);
    });
    expect(namesIn(yoursGroup())).toHaveLength(marked.length);
  });

  test('a character owning no Signature gets no Your Signatures group', () => {
    mountOwning([]);
    expect(headings()).toEqual([OWN_CLASS_NAME, OTHER_CLASS_NAME]);
  });

  test('buying a Signature through the handle adds it to Your Signatures', () => {
    const form = mountOwning([bare('Lasso', OTHER_CLASS_ID)]);
    expect(form.buySignature('Cowboy Hat', OWN_CLASS_ID)).toBe(true);
    expect(namesInYours()).toEqual(['Lasso', 'Cowboy Hat']);
  });

  test('buying a Signature through the drawer adds it to Your Signatures', () => {
    const form = mountOwning([]);
    form.openSignature('Spurs', OTHER_CLASS_ID);
    document.querySelector('#purchaseDrawer [data-signature-buy]').click();
    expect(headings()[0]).toBe(YOURS);
    expect(namesInYours()).toEqual(['Spurs']);
  });

  test('removing a Signature through the handle takes it out of Your Signatures', () => {
    const form = mountOwning([bare('Lasso', OTHER_CLASS_ID), bare('Cowboy Hat', OWN_CLASS_ID)]);
    form.removeSignature('Lasso', OTHER_CLASS_ID);
    expect(namesInYours()).toEqual(['Cowboy Hat']);
  });

  test('removing the last owned Signature takes the Your Signatures group away', () => {
    const form = mountOwning([bare('Lasso', OTHER_CLASS_ID)]);
    expect(yoursGroup()).not.toBeNull();
    form.removeSignature('Lasso', OTHER_CLASS_ID);
    expect(headings()).toEqual([OWN_CLASS_NAME, OTHER_CLASS_NAME]);
  });

  test('removing through the drawer, once its warning is confirmed, takes it out of Your Signatures', () => {
    const form = mountOwning([enchanted('Cowboy Hat'), bare('Lasso', OTHER_CLASS_ID)]);
    form.openSignature('Cowboy Hat', OWN_CLASS_ID);
    document.querySelector('#purchaseDrawer [data-signature-sell]').click();
    expect(namesInYours()).toEqual(['Cowboy Hat', 'Lasso']);
    document.querySelector('#purchasePending [data-confirm-removal]').click();
    expect(namesInYours()).toEqual(['Lasso']);
  });

  test('clicking a cell in Your Signatures opens the drawer right after Your Signatures', () => {
    mountOwning([bare('Lasso', OTHER_CLASS_ID)]);
    expect(yoursCell('Lasso')).not.toBeNull();
    yoursCell('Lasso').click();
    const drawer = document.getElementById('purchaseDrawer');
    expect(drawer.hidden).toBe(false);
    expect(drawer.innerHTML).toContain('Lasso');
    expect(followerOf(yoursGroup())).toBe('purchaseDrawer');
  });

  test('clicking the same Signature in its class group opens the drawer right after that class group', () => {
    mountOwning([bare('Lasso', OTHER_CLASS_ID)]);
    classCell('Lasso').click();
    expect(document.getElementById('purchaseDrawer').hidden).toBe(false);
    expect(followerOf(classCell('Lasso').closest('[data-catalogue-group]'))).toBe('purchaseDrawer');
  });

  test('buying from a class group keeps the drawer after that class group', () => {
    const form = mountOwning([]);
    classCell('Cowboy Hat').click();
    document.querySelector('#purchaseDrawer [data-signature-buy]').click();
    expect(form.serialize().gear.map((g) => g.name)).toEqual(['Cowboy Hat']);
    expect(yoursGroup()).not.toBeNull();
    expect(followerOf(classCell('Cowboy Hat').closest('[data-catalogue-group]'))).toBe('purchaseDrawer');
  });

  test('search keeps Your Signatures visible while browsing', () => {
    mountOwning([bare('Lasso', OTHER_CLASS_ID), bare('Cowboy Hat', OWN_CLASS_ID)]);
    search('Cow');
    expect(namesInYours()).toEqual(['Lasso', 'Cowboy Hat']);
    search('Spurs');
    expect(namesInYours()).toEqual(['Lasso', 'Cowboy Hat']);
    search('');
    expect(namesInYours()).toEqual(['Lasso', 'Cowboy Hat']);
  });

  // Each owned Signature shows at a glance what is fitted to it, and hovering
  // it shows the text. app.js's tooltip init takes the button's next sibling
  // when it carries .tooltip-markdown, so the hidden text sits right after
  // the button and the badges after that.
  describe('the loadout on each owned Signature', () => {
    const entriesWithDefaults = () => twoClassEntries().map((entry) => ({
      ...entry,
      description_html: `<p>${entry.name} description.</p>`,
      default_enchantment: {
        name: `${entry.name} Charm`,
        description: `${entry.name} plain text`,
        description_html: `<p>${entry.name} rides with the wind.</p>`
      }
    }));
    const mountLoadout = (gear) => mountPurchases(fixtureCharacter({
      gear, entries: entriesWithDefaults(), earnedMerx: 100
    }));
    const owned = (name, classId, enchantment, mods) => ({ name, class_id: classId, enchantment, mods });
    const mod = (name, description) => ({ name, description });

    const loadoutOf = (cell) => {
      for (let el = cell.nextElementSibling; el && !el.matches('[data-signature-name]'); el = el.nextElementSibling) {
        if (el.matches('[data-signature-loadout]')) return el;
      }
      return null;
    };
    const badgesOf = (cell) => {
      const row = loadoutOf(cell);
      return row ? [...row.querySelectorAll('.tag')].map((tag) => tag.textContent.trim()) : [];
    };
    const tooltipOf = (cell) => {
      const next = cell.nextElementSibling;
      return cell.hasAttribute('data-tooltip-markdown') && next && next.classList.contains('tooltip-markdown')
        ? next
        : null;
    };

    test('badges name the Enchantment first, then the Mods', () => {
      mountLoadout([
        owned('Cowboy Hat', OWN_CLASS_ID, { source: 'default' }, [mod('Scope', 'Sees far')]),
        owned('Lasso', OTHER_CLASS_ID, { source: 'custom', name: 'Hex', description: 'Shades.' },
          [mod('Scope', 'Sees far'), mod('Barb', 'Bites')]),
        owned('Duster', OWN_CLASS_ID, null, [mod('Lining', 'Warm'), mod('Pockets', 'Deep')])
      ]);
      const row = loadoutOf(yoursCell('Cowboy Hat'));
      expect(row).not.toBeNull();
      expect(row.classList.contains('tags')).toBe(true);
      expect(badgesOf(yoursCell('Cowboy Hat'))).toEqual(['Default Ench', 'Mod']);
      expect(badgesOf(yoursCell('Lasso'))).toEqual(['Custom Ench', 'Mod x2']);
      expect(badgesOf(yoursCell('Duster'))).toEqual(['Mod x2']);
    });

    test('a Signature with nothing fitted gets no badges and hovers its description but not the printed Default', () => {
      mountLoadout([owned('Cowboy Hat', OWN_CLASS_ID, null, [])]);
      expect(loadoutOf(yoursCell('Cowboy Hat'))).toBeNull();
      const tooltip = tooltipOf(yoursCell('Cowboy Hat'));
      expect(tooltip).not.toBeNull();
      expect(tooltip.textContent).toContain('Cowboy Hat description.');
      expect(tooltip.textContent).not.toContain('Cowboy Hat Charm');
    });

    test('class grid cells, owned or not, hover their description but no Enchantment, Mods or badges', () => {
      mountLoadout([owned('Cowboy Hat', OWN_CLASS_ID, { source: 'default' }, [mod('Scope', 'Sees far')])]);
      expect(badgesOf(yoursCell('Cowboy Hat'))).toEqual(['Default Ench', 'Mod']);
      expect(loadoutOf(classCell('Cowboy Hat'))).toBeNull();
      expect(document.querySelectorAll('#purchaseGrid [data-signature-loadout]')).toHaveLength(1);
      for (const name of ['Cowboy Hat', 'Spurs']) {
        const tooltip = tooltipOf(classCell(name));
        expect(tooltip).not.toBeNull();
        expect(tooltip.textContent).toContain(`${name} description.`);
        expect(tooltip.textContent).not.toContain(`${name} Charm`);
        expect(tooltip.textContent).not.toContain('Scope');
      }
    });

    test('hovering shows the Default Enchantment\'s book text and each Mod', () => {
      mountLoadout([owned('Cowboy Hat', OWN_CLASS_ID, { source: 'default' },
        [mod('Scope', 'Sees far'), mod('Band', 'Holds a feather')])]);
      const tooltip = tooltipOf(yoursCell('Cowboy Hat'));
      expect(tooltip).not.toBeNull();
      expect(tooltip.getAttribute('data-tooltip-markdown')).toBeNull();
      expect(yoursCell('Cowboy Hat').getAttribute('data-tooltip-markdown')).toBe('');
      expect(tooltip.classList.contains('is-hidden')).toBe(true);
      expect(tooltip.textContent).toContain('Cowboy Hat Charm');
      expect(tooltip.innerHTML).toContain('<p>Cowboy Hat rides with the wind.</p>');
      for (const text of ['Scope', 'Sees far', 'Band', 'Holds a feather']) {
        expect(tooltip.textContent).toContain(text);
      }
      expect(tooltip.nextElementSibling).toBe(loadoutOf(yoursCell('Cowboy Hat')));
    });

    test('hovering a Custom Enchantment shows the player\'s text, escaped', () => {
      mountLoadout([owned('Cowboy Hat', OWN_CLASS_ID,
        { source: 'custom', name: 'Hex <b>', description: '<script>alert(1)</script>' },
        [mod('<img src=x onerror=alert(2)>', 'Sees <i>far</i>')])]);
      const tooltip = tooltipOf(yoursCell('Cowboy Hat'));
      expect(tooltip).not.toBeNull();
      expect(tooltip.textContent).toContain('Hex <b>');
      expect(tooltip.textContent).toContain('<script>alert(1)</script>');
      expect(tooltip.textContent).toContain('<img src=x onerror=alert(2)>');
      expect(tooltip.textContent).toContain('Sees <i>far</i>');
      expect(tooltip.querySelector('script, img, b, i')).toBeNull();
      expect(tooltip.textContent).not.toContain('Cowboy Hat Charm');
    });

    test('naming a Mod in the drawer adds its badge to Your Signatures', () => {
      const form = mountLoadout([owned('Cowboy Hat', OWN_CLASS_ID, null, [])]);
      yoursCell('Cowboy Hat').click();
      const modName = document.querySelector('#purchaseDrawer [data-mod-name]');
      modName.value = 'Scope';
      modName.dispatchEvent(new window.Event('change', { bubbles: true }));
      expect(form.getState().purchases[0].mods).toEqual([{ name: 'Scope', description: '' }]);
      expect(badgesOf(yoursCell('Cowboy Hat'))).toEqual(['Mod']);
      expect(tooltipOf(yoursCell('Cowboy Hat')).textContent).toContain('Scope');
    });
  });
});

// Common Items spend the same Merx as Signatures. Their rows are added by htmx,
// filled in through the ToastUI editor (which writes the textarea and fires a
// bubbling `input`), and removed by htmx.remove -- the readout has to follow
// every one of those, not just the next Signature purchase.
describe('the spent readout follows the Common Items list', () => {
  const { MOUNT_HTML } = require('./helpers/gear-purchase-fixture');
  const { json: jsonHelper } = require('../util/handlebars');

  const COMMON_ITEM_ROW = (value) => `
    <div class="column is-full">
      <textarea name="common_items[]">${value}</textarea>
    </div>`;

  const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

  // jsdom fires its own DOMContentLoaded a macrotask after the fixture's,
  // booting the surface a second time and repainting the readout. Letting that
  // settle first means a later repaint can only come from the list changing.
  const mountWithCommonItems = async (rowsHtml) => {
    const data = fixtureCharacter({ gear: [] });
    const html = MOUNT_HTML(jsonHelper(data)).replace(
      '<div id="common-items-list"></div>',
      `<div id="common-items-list">${rowsHtml}</div>`
    );
    const form = mountPurchases(data, { html });
    await nextTick();
    return form;
  };

  const spentReadout = () => Number(document.querySelector('[data-merx-spent]').textContent);

  test('filling in a newly added Common Item raises the spent readout by its price', async () => {
    await mountWithCommonItems('');
    const before = spentReadout();

    const list = document.getElementById('common-items-list');
    list.insertAdjacentHTML('beforeend', COMMON_ITEM_ROW(''));
    const textarea = list.querySelector('textarea[name="common_items[]"]');
    textarea.value = 'Fifty feet of rope';
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    await nextTick();

    expect(spentReadout()).toBe(before + FIGURES.prices.commonItem);
  });

  test('removing a filled Common Item row lowers the spent readout by its price', async () => {
    await mountWithCommonItems(COMMON_ITEM_ROW('Fifty feet of rope'));
    const before = spentReadout();
    expect(before).toBe(FIGURES.prices.commonItem);

    document.querySelector('#common-items-list .is-full').remove();
    await nextTick();

    expect(spentReadout()).toBe(before - FIGURES.prices.commonItem);
  });
});
