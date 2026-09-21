// test/catalogue-controls.test.js
//
// public/js/catalogue-controls.js is the one grouping-and-search control the
// Signature grid (character-gear-purchases.js) and the Ability catalogue
// (character-ability-purchases.js) both mount. It renders no entry itself --
// it delegates every group's body to the renderEntry its caller supplies, so
// these tests drive it with a bare stand-in that only proves which entries
// made it through.
const { test, expect, describe } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'catalogue-controls.js'), 'utf8'
);

// The real catalogues each render a full entry (a button, a box); this
// control never looks inside what comes back, so a bare name tag proves
// which entries a group was handed without needing either real renderer.
const renderNames = (entries) => entries.map((e) => `<span data-entry>${e.name}</span>`).join('');

const mountControls = (options) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  new Function(SOURCE)();
  const root = window.document.getElementById('root');
  const control = window.CatalogueControls.mount(root, options);
  return { root, control };
};

const entriesFixture = () => [
  { name: 'Cowboy Hat', class: 'Gunslinger' },
  { name: 'Sharps Rifle', class: 'Gunslinger' },
  { name: 'Lasso', class: 'Wrangler' },
  { name: 'Bowie Knife', class: 'Wrangler' }
];

const baseOptions = (entries) => ({
  entries,
  groupBy: (entry) => entry.class,
  searchOf: (entry) => entry.name,
  renderEntry: renderNames
});

describe('CatalogueControls', () => {
  test('entries are grouped by class, in stable order', () => {
    const { root } = mountControls(baseOptions(entriesFixture()));
    // The control owns the search input -- no view supplies one.
    expect(root.querySelector('[data-catalogue-search]')).not.toBeNull();

    const groups = [...root.querySelectorAll('[data-catalogue-group]')];
    expect(groups.length).toBe(2);
    expect(groups[0].textContent).toContain('Gunslinger');
    expect(groups[0].querySelectorAll('[data-entry]').length).toBe(2);
    expect(groups[1].textContent).toContain('Wrangler');
    expect(groups[1].querySelectorAll('[data-entry]').length).toBe(2);
  });

  test('a search term filters entries by name across every group', () => {
    const { root, control } = mountControls(baseOptions(entriesFixture()));
    control.setSearch('Lasso');
    const entries = [...root.querySelectorAll('[data-entry]')].map((el) => el.textContent);
    expect(entries).toEqual(['Lasso']);
  });

  test('a group with no matching entry is hidden entirely', () => {
    const { root, control } = mountControls(baseOptions(entriesFixture()));
    control.setSearch('Lasso');
    const groups = [...root.querySelectorAll('[data-catalogue-group]')];
    expect(groups.length).toBe(1);
    expect(groups[0].textContent).toContain('Wrangler');
    expect(root.textContent).not.toContain('Gunslinger');
  });

  test('clearing the search restores every group', () => {
    const { root, control } = mountControls(baseOptions(entriesFixture()));
    control.setSearch('Lasso');
    control.setSearch('');
    const groups = [...root.querySelectorAll('[data-catalogue-group]')];
    expect(groups.length).toBe(2);
    expect(root.querySelectorAll('[data-entry]').length).toBe(4);
  });

  test('search is case-insensitive and ignores surrounding whitespace', () => {
    const { root, control } = mountControls(baseOptions(entriesFixture()));
    control.setSearch('  rifle  ');
    const entries = [...root.querySelectorAll('[data-entry]')].map((el) => el.textContent);
    expect(entries).toEqual(['Sharps Rifle']);
  });

  test('an entry with no class falls into a single unnamed group rather than vanishing', () => {
    const entries = [
      { name: 'Cowboy Hat', class: 'Gunslinger' },
      { name: 'Borrowed Blade', class: null },
      { name: 'Stray Charm', class: '' }
    ];
    const { root } = mountControls(baseOptions(entries));
    const groups = [...root.querySelectorAll('[data-catalogue-group]')];
    expect(groups.length).toBe(2);

    const unnamed = groups.find((g) => !g.querySelector('[data-catalogue-group-heading]'));
    expect(unnamed).not.toBeUndefined();
    expect(unnamed.querySelectorAll('[data-entry]').length).toBe(2);
    expect(unnamed.textContent).toContain('Borrowed Blade');
    expect(unnamed.textContent).toContain('Stray Charm');
  });

  // Group keys are class names, and a class name is player-authored. On a
  // plain object `byKey['constructor']` is inherited and truthy, so the group
  // is never created and the push lands on Object's constructor -- the whole
  // catalogue blanks instead of rendering.
  test('a class named after an Object prototype key still gets its own group', () => {
    const entries = [
      { name: 'Inherited Blade', class: 'constructor' },
      { name: 'Stringly Charm', class: 'toString' },
      { name: 'Valued Hat', class: 'valueOf' },
      { name: 'Cowboy Hat', class: 'Gunslinger' }
    ];
    const { root } = mountControls(baseOptions(entries));
    const groups = [...root.querySelectorAll('[data-catalogue-group]')];
    expect(groups.length).toBe(4);
    expect(groups.map((g) => g.querySelector('[data-catalogue-group-heading]').textContent))
      .toEqual(['constructor', 'toString', 'valueOf', 'Gunslinger']);
    expect(root.querySelectorAll('[data-entry]').length).toBe(4);
  });

  // Both catalogues mount inside <form hx-put=...>, which carries a
  // type="submit" button (views/character-form.handlebars), so Enter in any
  // field it owns is an implicit submit -- Enter in a search box would save
  // the character.
  test('Enter in the search box never submits the form the catalogue sits in', () => {
    const { root } = mountControls(baseOptions(entriesFixture()));
    const input = root.querySelector('[data-catalogue-search]');
    const event = new root.ownerDocument.defaultView.KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  test('a keystroke that is not Enter is left alone', () => {
    const { root } = mountControls(baseOptions(entriesFixture()));
    const input = root.querySelector('[data-catalogue-search]');
    const event = new root.ownerDocument.defaultView.KeyboardEvent('keydown', {
      key: 'a', bubbles: true, cancelable: true
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
