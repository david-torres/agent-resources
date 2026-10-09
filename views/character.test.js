const { test, expect, beforeAll } = require('bun:test');
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => { await setupAlpine(); });

const DROPDOWN = `
  <div class="dropdown is-right" id="export-dropdown"
       x-data="{ open: false }"
       :class="{ 'is-active': open }"
       @click.outside="open = false"
       @keydown.escape.window="open = false">
    <div class="dropdown-trigger">
      <button id="trigger" :aria-expanded="open" @click="open = !open"></button>
    </div>
  </div>
  <a href="#" id="outside">elsewhere</a>
`;

test('export dropdown starts closed', async () => {
  await render(DROPDOWN);
  const dd = document.getElementById('export-dropdown');
  expect(dd.classList.contains('is-active')).toBe(false);
  expect(document.getElementById('trigger').getAttribute('aria-expanded')).toBe('false');
});

test('clicking the trigger opens it and updates aria-expanded', async () => {
  await render(DROPDOWN);
  document.getElementById('trigger').click();
  await tick();
  expect(document.getElementById('export-dropdown').classList.contains('is-active')).toBe(true);
  expect(document.getElementById('trigger').getAttribute('aria-expanded')).toBe('true');
});

test('clicking the trigger again closes it', async () => {
  await render(DROPDOWN);
  const trigger = document.getElementById('trigger');
  trigger.click(); await tick();
  trigger.click(); await tick();
  expect(document.getElementById('export-dropdown').classList.contains('is-active')).toBe(false);
});

test('clicking outside closes it', async () => {
  await render(DROPDOWN);
  document.getElementById('trigger').click();
  await tick();
  document.getElementById('outside').click();
  await tick();
  expect(document.getElementById('export-dropdown').classList.contains('is-active')).toBe(false);
});

test('Escape closes it', async () => {
  await render(DROPDOWN);
  document.getElementById('trigger').click();
  await tick();
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await tick();
  expect(document.getElementById('export-dropdown').classList.contains('is-active')).toBe(false);
});

// character.traits is `[{name, stat}]` (Task 5) -- a missed `.name` here
// would silently render `[object Object]` instead of erroring.
test('the Personality box renders each trait name, not [object Object]', () => {
  const fs = require('fs');
  const path = require('path');
  const Handlebars = require('handlebars');
  const hbsHelpers = require('handlebars-helpers')();
  const customHelpers = require('../util/handlebars');

  const src = fs.readFileSync(path.join(__dirname, 'character.handlebars'), 'utf8');
  const personalitySection = src.slice(
    src.indexOf('<h3 class="title is-4">Personality</h3>'),
    src.indexOf('<h3 class="title is-4">Recent Missions</h3>')
  );

  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);

  const html = hb.compile(personalitySection)({
    character: { traits: [{ name: 'brave', stat: 'might' }, { name: 'curious', stat: 'intelligence' }] },
  });

  expect(html).toContain('Brave');
  expect(html).toContain('Curious');
  expect(html).not.toContain('[object Object]');
});

// -- Signature Gear: Enchantments, Mods and the Merx breakdown (Task 11) ---
//
// views/character.handlebars is the full page; views/partials/character-
// details.handlebars is the htmx fragment rendered for the same character on
// /party and the LFG post page. Both render Signature Gear through the same
// views/partials/signature-entry.handlebars partial so they cannot drift --
// see views/partials/character-details.test.js for the fragment's half of
// this contract.
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const customHelpers = require('../util/handlebars');
const { renderMarkdown, renderPowerRatings } = require('../util/markdown');

const CHARACTER_SRC = fs.readFileSync(path.join(__dirname, 'character.handlebars'), 'utf8');

const registerSignatureEntryPartials = (hb) => {
  hb.registerPartial('signature-entry',
    fs.readFileSync(path.join(__dirname, 'partials/signature-entry.handlebars'), 'utf8'));
  hb.registerPartial('character-detail-tag',
    fs.readFileSync(path.join(__dirname, 'partials/character-detail-tag.handlebars'), 'utf8'));
  hb.registerPartial('class-enchantment',
    fs.readFileSync(path.join(__dirname, 'partials/class-enchantment.handlebars'), 'utf8'));
  for (const partial of ['class-meters', 'class-notes']) {
    hb.registerPartial(partial,
      fs.readFileSync(path.join(__dirname, `partials/${partial}.handlebars`), 'utf8'));
  }
};

const renderGearSection = (locals) => {
  const section = CHARACTER_SRC.slice(
    CHARACTER_SRC.indexOf('<h3 class="title is-4">Signature Gear</h3>'),
    CHARACTER_SRC.indexOf('{{#if character.common_items}}')
  );
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('markdown', renderMarkdown);
  hb.registerHelper('powerRatings', renderPowerRatings);
  registerSignatureEntryPartials(hb);
  return hb.compile(section)(locals);
};

const renderCommissarySection = (locals) => {
  const section = CHARACTER_SRC.slice(
    CHARACTER_SRC.indexOf('<p><strong>Completed Missions:'),
    CHARACTER_SRC.indexOf('<div class="box">\n      <h3 class="title is-4">Personality</h3>')
  );
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  return hb.compile(section)(locals);
};

test('a Signature shows its Enchantment and Mods when purchases are shown', () => {
  const html = renderGearSection({
    showGearPurchases: true,
    character: {
      gear: [{
        name: 'Cowboy Hat',
        enchantment: { source: 'default' },
        default_enchantment: { name: 'Hats Off to You', description: 'Portray a Turning Point.' },
        mods: [{ name: 'Scope', description: 'Sees far' }]
      }]
    }
  });
  expect(html).toContain('Hats Off to You');
  expect(html).toContain('Scope');
});

test('a player-authored Custom Enchantment and its Mods are escaped', () => {
  const html = renderGearSection({
    showGearPurchases: true,
    character: {
      gear: [{
        name: 'Cowboy Hat',
        enchantment: { source: 'custom', name: '<script>x</script>', description: 'd' },
        mods: [{ name: '<img src=x onerror=alert(1)>', description: 'z' }]
      }]
    }
  });
  expect(html).not.toContain('<script>x');
  expect(html).not.toContain('<img src=x');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('&lt;img');
});

test('an advent character (showGearPurchases false) keeps today\'s plain gear tag', () => {
  const html = renderGearSection({
    showGearPurchases: false,
    character: {
      gear: [{
        name: 'Cowboy Hat',
        class_id: 'class-a',
        enchantment: { source: 'default' },
        default_enchantment: { name: 'Hats Off to You', description: 'Portray a Turning Point.' },
        mods: [{ name: 'Scope', description: 'Sees far' }]
      }]
    }
  });
  expect(html).not.toContain('Hats Off to You');
  expect(html).not.toContain('Scope');
  expect(html).toContain('Cowboy Hat');
});

test('a V1 character shows the Merx breakdown, not one bare number', () => {
  const html = renderCommissarySection({
    character: { completed_missions: 2, commissary_reward: 99 },
    merxBreakdown: { earned: 12, spend: 5, reward: 7, deficit: 0 }
  });
  expect(html).toContain('Earned');
  expect(html).toContain('Spent');
  expect(html).toContain('Remaining');
  expect(html).not.toContain('Commissary Reward');
});

test('an advent character keeps its single Commissary Reward line', () => {
  const html = renderCommissarySection({
    character: { completed_missions: 2, commissary_reward: 4 },
    merxBreakdown: null
  });
  expect(html).toContain('Commissary Reward');
  expect(html).not.toContain('Earned');
});

test('both export dropdowns really carry the directives', () => {
  const fs = require('fs');
  const path = require('path');
  for (const file of ['character.handlebars', 'class-view.handlebars']) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    expect(src).toContain('@click="open = !open"');
    expect(src).toContain("@click.outside=\"open = false\"");
    expect(src).toContain(':aria-expanded="open"');
    expect(src).not.toContain("export-dropdown').classList.toggle");
  }
});

// -- v1-only fields on a v2 character ---------------------------------------
//
// A character whose class became v2 keeps its v1-only text stored. The sheet
// shows none of it; views/partials/character-details.test.js pins the same for
// the /details fragment.
const renderFromPerksToAppearance = (locals) => {
  const section = CHARACTER_SRC.slice(
    CHARACTER_SRC.indexOf("{{#if (eq effectiveVersion 'v1')}}"),
    CHARACTER_SRC.indexOf('{{#if character.appearance}}')
  );
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('markdown', renderMarkdown);
  hb.registerHelper('powerRatings', renderPowerRatings);
  registerSignatureEntryPartials(hb);
  return hb.compile(section)(locals);
};

test('a v2 character sheet shows none of its stored v1-only text', () => {
  const character = {
    perks: 'Old perk prose', additional_gear: 'Old gear prose',
    gear: [], common_items: [], quirks: [], accessories: [], ability_perks: [], abilities: []
  };

  const v2 = renderFromPerksToAppearance({ character, effectiveVersion: 'v2' });
  expect(v2).not.toContain('Old perk prose');
  expect(v2).not.toContain('Old gear prose');

  // The same slice at v1 shows both, so the v2 assertions above are not
  // passing on a slice that simply misses the fields.
  const v1 = renderFromPerksToAppearance({ character, effectiveVersion: 'v1' });
  expect(v1).toContain('Old perk prose');
  expect(v1).toContain('Old gear prose');
});

test('a v2 character sheet shows its Defining Quirk with the downside', () => {
  const character = {
    gear: [], common_items: [], accessories: [], ability_perks: [], abilities: [],
    quirks: [{ name: 'Monochromia', downside: 'Sees only red', upside: 'Spots blood instantly' }]
  };

  const html = renderFromPerksToAppearance({ character, effectiveVersion: 'v2' });
  expect(html).toContain('Defining Quirk');
  expect(html).toContain('Monochromia');
  expect(html).toContain('Sees only red');
  expect(html).toContain('Spots blood instantly');
});

test('a v2 character sheet shows a named perk with its name in bold before the text', () => {
  const character = {
    gear: [], common_items: [], accessories: [], quirks: [],
    abilities: [{ id: 'ab-1', name: 'Fireball' }],
    ability_perks: [
      { class_ability_id: 'ab-1', name: 'Searing Brand', text: 'Deal extra damage', position: 0, compounds_with: null },
      { class_ability_id: 'ab-1', name: null, text: 'Unnamed perk', position: 1, compounds_with: null }
    ]
  };

  const html = renderFromPerksToAppearance({ character, effectiveVersion: 'v2' });
  expect(html).toMatch(/<strong>Searing Brand<\/strong>\s*Deal extra damage/);
  expect(html).toMatch(/<li>\s*Unnamed perk/);
});

const { registerAccessPartials } = require('../test/helpers/access-partials');

const renderSheetHeader = (locals) => {
  const header = CHARACTER_SRC.slice(0, CHARACTER_SRC.indexOf('<h1'));
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('breadcrumbs', '');
  registerAccessPartials(hb);
  return hb.compile(header)(locals);
};

test('the sheet opens with the lapsed-trial alert when descriptions were hidden', () => {
  const html = renderSheetHeader({ adventTrialEndedAt: '2026-09-20T12:00:00Z', profile: { timezone: 'UTC' } });
  expect(html).toContain('Ability and gear descriptions are hidden because your Advent free trial ended Sep 20, 2026.');
  expect(html).toContain('data-trial-ended');
});

test('the sheet has no lapsed-trial alert without an end date', () => {
  const html = renderSheetHeader({ adventTrialEndedAt: null, profile: { timezone: 'UTC' } });
  expect(html).not.toContain('data-trial-ended');
});
