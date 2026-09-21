// test/character-ability-purchases.test.js
//
// public/js/character-ability-purchases.js is the edit form's mount for the
// V1 Perk purchase surface (util/ability-purchase-data.js builds the island
// it reads). It lives under test/ rather than public/js/ because
// scripts/run-tests.mjs only walks
// ['models', 'routes', 'services', 'test', 'util', 'views'] -- see
// test/character-gear-purchases.test.js, which states the same for the
// Signature mount and is this file's model.
const { test, expect, describe } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { perkFigures, priceOfAbility } = require('../util/perk-economy');
const { json: jsonHelper } = require('../util/handlebars');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'character-ability-purchases.js'), 'utf8'
);

const FIGURES = perkFigures();

const CLASS_ID = 'c-v1';
const CLASS_NAME = 'Test Class';
const OTHER_CLASS_ID = 'c-other';
const OTHER_CLASS_NAME = 'Other Class';

// The island's `entries`, as util/ability-purchase-data.js#priceRows serves
// them: already tagged with crossClass, type and a price. Two of the
// character's own class, two cross-class.
const baseEntries = () => ([
  {
    name: 'Standoff', class_id: CLASS_ID, class_name: CLASS_NAME,
    type: 'core', crossClass: false, price: FIGURES.prices.ability.own.core
  },
  {
    name: 'Last Word', class_id: CLASS_ID, class_name: CLASS_NAME,
    type: 'advanced', crossClass: false, price: FIGURES.prices.ability.own.advanced
  },
  {
    name: 'Viewpoint', class_id: OTHER_CLASS_ID, class_name: OTHER_CLASS_NAME,
    type: 'core', crossClass: true, price: FIGURES.prices.ability.cross.core
  },
  {
    name: 'Deep Cut', class_id: OTHER_CLASS_ID, class_name: OTHER_CLASS_NAME,
    type: 'advanced', crossClass: true, price: FIGURES.prices.ability.cross.advanced
  }
]);

// Level 10 gives an aspirant character an earned balance well past any
// single entry's price, so a test only hits the budget when it deliberately
// sets a lower level.
const fixtureIsland = (overrides = {}) => ({
  economy: overrides.economy || 'aspirant',
  figures: FIGURES,
  entries: overrides.entries || baseEntries(),
  owned: overrides.owned || [],
  aspiringAbilities: overrides.aspiringAbilities || [],
  level: overrides.level != null ? overrides.level : 10
});

const MOUNT_HTML = (islandJson) => `
  <form>
    <div id="abilityPurchases">
      <script type="application/json" id="ability-purchase-data">${islandJson}</script>
      <p id="abilityReadouts">
        <span data-perks-spent>0</span> <span data-perks-earned>0</span>
        <span data-abilities-used>0</span> <span data-abilities-cap>0</span>
      </p>
      <div id="abilityCatalogue"></div>
      <input type="hidden" name="abilities_json" id="abilityJson">
    </div>
  </form>
`;

// Boots a jsdom window around the mount markup, evaluates
// character-ability-purchases.js against it, and returns the mounted handle
// -- the same recipe test/helpers/gear-purchase-fixture.js uses for
// character-gear-purchases.js.
const mountAbilities = (data) => {
  const html = MOUNT_HTML(jsonHelper(data));
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'http://localhost/characters/abc/edit'
  });
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;

  new Function(SOURCE)();

  if (!window.CharacterAbilityPurchases.instance) {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }

  return window.CharacterAbilityPurchases.instance;
};

describe('buying and dropping', () => {
  test('buying an own-class Advanced ability spends two Perks', () => {
    const form = mountAbilities(fixtureIsland({ owned: [] }));
    expect(form.buyAbility('Last Word', CLASS_ID)).toBe(true);
    expect(form.getSpent()).toBe(2);
  });

  test('buying a cross-class Core ability spends three', () => {
    const form = mountAbilities(fixtureIsland({ owned: [] }));
    expect(form.buyAbility('Viewpoint', OTHER_CLASS_ID)).toBe(true);
    expect(form.getSpent()).toBe(3);
  });

  test('dropping an ability refunds its Perks', () => {
    const form = mountAbilities(fixtureIsland({
      owned: [{ name: 'Last Word', class_id: CLASS_ID, type: 'advanced' }]
    }));
    expect(form.getSpent()).toBe(2);
    form.dropAbility('Last Word', CLASS_ID);
    expect(form.getSpent()).toBe(0);
    expect(form.serialize().abilities).toHaveLength(0);
  });
});

describe('affordability consults both the balance and the cap', () => {
  test('an ability that would breach the cap cannot be bought', () => {
    const cap = FIGURES.abilityCap.aspirant;
    const owned = [];
    const entries = [];
    for (let i = 0; i < cap; i++) {
      const name = `Filler ${i}`;
      owned.push({ name, class_id: CLASS_ID, type: 'core' });
      entries.push({
        name, class_id: CLASS_ID, class_name: CLASS_NAME,
        type: 'core', crossClass: false, price: FIGURES.prices.ability.own.core
      });
    }
    entries.push({
      name: 'Seventh', class_id: CLASS_ID, class_name: CLASS_NAME,
      type: 'core', crossClass: false, price: FIGURES.prices.ability.own.core
    });
    // Plenty of Perks in hand: the cap, not the balance, must be what blocks
    // this purchase.
    const form = mountAbilities(fixtureIsland({ entries, owned, level: 20 }));
    expect(form.buyAbility('Seventh', CLASS_ID)).toBe(false);
    expect(form.serialize().abilities).toHaveLength(cap);
  });

  test('an ability that would overspend the balance cannot be bought', () => {
    // Level 1 gives an aspirant character only its creation grant -- too few
    // Perks for an own-class Advanced ability, which costs two.
    const form = mountAbilities(fixtureIsland({ owned: [], level: 1 }));
    expect(form.buyAbility('Last Word', CLASS_ID)).toBe(false);
    expect(form.serialize().abilities).toHaveLength(0);
  });
});

describe('rendering', () => {
  test('a cross-class ability carries an origin badge naming its class', () => {
    mountAbilities(fixtureIsland({ owned: [] }));
    const catalogue = document.getElementById('abilityCatalogue');

    const own = catalogue.querySelector('[data-ability-entry][data-ability-name="Standoff"]');
    expect(own.querySelector('.tag.is-info')).toBeNull();

    const cross = catalogue.querySelector('[data-ability-entry][data-ability-name="Viewpoint"]');
    expect(cross.querySelector('.tag.is-info')).not.toBeNull();
    expect(cross.querySelector('.tag.is-info').textContent).toBe(OTHER_CLASS_NAME);
  });
});

describe('serialization', () => {
  test('the serialized payload carries each ability class_id and type', () => {
    const form = mountAbilities(fixtureIsland({ owned: [] }));
    form.buyAbility('Viewpoint', OTHER_CLASS_ID);
    const [item] = form.serialize().abilities;
    expect(item.name).toBe('Viewpoint');
    expect(item.class_id).toBe(OTHER_CLASS_ID);
    expect(item.type).toBe('core');
  });
});

test('no Perk number is written down in this file', () => {
  const source = require('fs').readFileSync(
    require.resolve('../public/js/character-ability-purchases.js'), 'utf8'
  );
  // Every price must come from FIGURES. A bare 1/2/3/4 beside the word Perk
  // is the defect this whole slice exists to remove.
  expect(source).not.toMatch(/=\s*[1-6];\s*\/\/.*Perk/i);
});

// The one test that stops the client and the server drifting apart. The
// surface prices an ability by (crossClass, type); util/perk-economy.js
// prices the same pair; they must agree for every combination, in both V1
// economies -- test/signature-entry.test.js does exactly this for
// Signatures.
describe('the ability price agrees with the server it cannot require', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  new Function(SOURCE)();
  const CAP = dom.window.CharacterAbilityPurchases;

  for (const economy of ['aspirant', 'aspiring']) {
    test(`${economy}: every (crossClass, type) combination prices identically on both sides`, () => {
      for (const crossClass of [false, true]) {
        for (const type of ['core', 'advanced']) {
          expect(CAP.priceOf(FIGURES, crossClass, type))
            .toBe(priceOfAbility({ crossClass, type }));
        }
      }
    });
  }
});
