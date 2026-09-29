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
const CATALOGUE_CONTROLS_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'catalogue-controls.js'), 'utf8'
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

const perkRowHtml = (text) =>
  `<div class="column is-full perk-row"><textarea class="textarea perk-text" name="ability_perk_text[]">${text}</textarea></div>`;
const PERK_ROW = perkRowHtml('A filled Perk');

// `perkRows` stands in for the v2 Ability-Perk editor on the same form
// (views/partials/character-v2-fields.handlebars), one .perk-row per Perk.
const MOUNT_HTML = (islandJson, perkRows = 0) => `
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
    <div id="v2-fields-container"><div id="perk-groups">${PERK_ROW.repeat(perkRows)}</div></div>
  </form>
`;

// Boots a jsdom window around the mount markup, evaluates
// character-ability-purchases.js against it, and returns the mounted handle
// -- the same recipe test/helpers/gear-purchase-fixture.js uses for
// character-gear-purchases.js.
const mountAbilities = (data, { perkRows = 0 } = {}) => {
  const html = MOUNT_HTML(jsonHelper(data), perkRows);
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'http://localhost/characters/abc/edit'
  });
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;

  new Function(CATALOGUE_CONTROLS_SOURCE)();
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

  // util/perk-economy.js#perkSpend charges unlockSpend PLUS abilityPerkSpend,
  // and services/character/service.js ratchets a save against that combined
  // figure. A surface that only tallied unlockSpend would show a purchase
  // the server then refuses at save.
  test('a character with existing Ability-Perk spend cannot afford a purchase its unlock spend alone would allow', () => {
    // Level 3 earns three Perks -- enough for Last Word's own-Advanced price
    // of two by unlock spend alone, but not once two Perks are already spent
    // on Ability Perks.
    const form = mountAbilities(fixtureIsland({ owned: [], level: 3 }), { perkRows: 2 });
    expect(form.getEarned()).toBe(3);
    expect(form.getSpent()).toBe(2 * FIGURES.abilityPerkCost);
    expect(form.buyAbility('Last Word', CLASS_ID)).toBe(false);
    expect(form.serialize().abilities).toHaveLength(0);
  });

  const spentReadout = () => document.querySelector('[data-perks-spent]').textContent;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  // The Perk editor adds and removes rows after the page loads; the balance
  // follows it rather than the Perks the character had when the page loaded.
  test('an Ability Perk added on the same form is charged at once', async () => {
    const form = mountAbilities(fixtureIsland({ owned: [], level: 3 }), { perkRows: 1 });
    document.getElementById('perk-groups').insertAdjacentHTML('beforeend', PERK_ROW);
    await settle();
    expect(form.getSpent()).toBe(2 * FIGURES.abilityPerkCost);
    expect(spentReadout()).toBe(String(2 * FIGURES.abilityPerkCost));
  });

  // The server drops a Perk row with blank text (services/character/input.js),
  // so only filled rows are charged.
  test('a freshly added Ability Perk row with blank text is not charged', async () => {
    const form = mountAbilities(fixtureIsland({ owned: [], level: 3 }), { perkRows: 1 });
    document.getElementById('perk-groups').insertAdjacentHTML('beforeend', perkRowHtml('   '));
    await settle();
    expect(form.getSpent()).toBe(FIGURES.abilityPerkCost);
    expect(spentReadout()).toBe(String(FIGURES.abilityPerkCost));
  });

  test('typing text into a blank Ability Perk row charges it', async () => {
    const form = mountAbilities(fixtureIsland({ owned: [], level: 3 }), { perkRows: 0 });
    document.getElementById('perk-groups').insertAdjacentHTML('beforeend', perkRowHtml(''));
    await settle();
    expect(form.getSpent()).toBe(0);
    const textarea = document.querySelector('#perk-groups .perk-text');
    textarea.value = 'Now it has text';
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(form.getSpent()).toBe(FIGURES.abilityPerkCost);
    expect(spentReadout()).toBe(String(FIGURES.abilityPerkCost));
  });

  test('clearing the text of an Ability Perk row stops charging it', async () => {
    const form = mountAbilities(fixtureIsland({ owned: [], level: 3 }), { perkRows: 1 });
    expect(form.getSpent()).toBe(FIGURES.abilityPerkCost);
    const textarea = document.querySelector('#perk-groups .perk-text');
    textarea.value = '  ';
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(form.getSpent()).toBe(0);
    expect(spentReadout()).toBe('0');
  });

  test('removing an Ability Perk on the same form refunds it', async () => {
    const form = mountAbilities(fixtureIsland({ owned: [], level: 3 }), { perkRows: 2 });
    document.querySelector('#perk-groups .perk-row').remove();
    await settle();
    expect(form.getSpent()).toBe(FIGURES.abilityPerkCost);
    expect(spentReadout()).toBe(String(FIGURES.abilityPerkCost));
  });

  // The class dropdown replaces #v2-fields-container wholesale (htmx
  // outerHTML), taking #perk-groups with it.
  test('the balance counts the Perks of a v2 container swapped in after mount', async () => {
    const form = mountAbilities(fixtureIsland({ owned: [], level: 3 }), { perkRows: 0 });
    const fresh = document.createElement('div');
    fresh.id = 'v2-fields-container';
    fresh.innerHTML = `<div id="perk-groups">${PERK_ROW.repeat(2)}</div>`;
    document.getElementById('v2-fields-container').replaceWith(fresh);
    await settle();
    expect(form.getSpent()).toBe(2 * FIGURES.abilityPerkCost);
    expect(spentReadout()).toBe(String(2 * FIGURES.abilityPerkCost));
  });

  // util/ability-purchase-data.js serves the level already run through
  // normalizeLevel, so a character stored above the ceiling arrives at this
  // mount already capped -- this pins that the earned balance follows the
  // served (capped) level, not a runaway total the raw stored value would
  // give.
  test('a character stored above the level ceiling earns no more than the ceiling grants', () => {
    const atCeiling = mountAbilities(fixtureIsland({ owned: [], level: 20 }));
    expect(atCeiling.getEarned()).toBe(FIGURES.grants.aspirant + FIGURES.perksPerLevel * 19);
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

// Proves the real catalogue is actually wired to CatalogueControls's own
// grouping and search -- not just that entries still render (the test
// above), which would stay green even if groupBy or searchOf were mis-wired
// or swapped for the wrong field.
describe('grouping and search, through the real catalogue', () => {
  test('the group headings are the class names entries are grouped by', () => {
    mountAbilities(fixtureIsland({ owned: [] }));
    const catalogue = document.getElementById('abilityCatalogue');
    const headings = [...catalogue.querySelectorAll('[data-catalogue-group-heading]')]
      .map((h) => h.textContent);
    expect(headings).toEqual([CLASS_NAME, OTHER_CLASS_NAME]);
  });

  test('typing into the real search input filters by name across every group, and hides an empty group', () => {
    mountAbilities(fixtureIsland({ owned: [] }));
    const catalogue = document.getElementById('abilityCatalogue');
    const searchInput = catalogue.querySelector('[data-catalogue-search]');
    expect(searchInput).not.toBeNull();

    // 'n' is in Standoff (own) and Viewpoint (cross) but not Last Word (own)
    // or Deep Cut (cross) -- a term that survives in both groups at once,
    // proving search reaches every group rather than only the first.
    const Event = document.defaultView.Event;
    searchInput.value = 'n';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    const visible = [...catalogue.querySelectorAll('[data-ability-entry]')]
      .map((el) => el.getAttribute('data-ability-name'));
    expect(visible.sort()).toEqual(['Standoff', 'Viewpoint']);

    // A term that only one class's entries match hides the other group
    // entirely, not just its entries.
    searchInput.value = 'Standoff';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    const headingsNarrowed = [...catalogue.querySelectorAll('[data-catalogue-group-heading]')]
      .map((h) => h.textContent);
    expect(headingsNarrowed).toEqual([CLASS_NAME]);
    expect(catalogue.textContent).not.toContain('Viewpoint');
    expect(catalogue.textContent).not.toContain('Deep Cut');

    // Clearing the search restores both groups and every entry.
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    const restored = [...catalogue.querySelectorAll('[data-ability-entry]')]
      .map((el) => el.getAttribute('data-ability-name')).sort();
    expect(restored).toEqual(['Deep Cut', 'Last Word', 'Standoff', 'Viewpoint']);
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
