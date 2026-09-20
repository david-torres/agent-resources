// The full-sheet details fragment served by GET /characters/:id/details and
// lazy-loaded into the /party roster and the LFG post page. These tests are
// the contract for what an expanded member shows on both pages.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const rangeHelper = require('handlebars-helper-range');
const customHelpers = require('../../util/handlebars');
const { renderMarkdown } = require('../../util/markdown');
const { statList } = require('../../util/enclave-consts');

const DETAILS_SRC = fs.readFileSync(path.join(__dirname, 'character-details.handlebars'), 'utf8');
const TAG_SRC = fs.readFileSync(path.join(__dirname, 'character-detail-tag.handlebars'), 'utf8');
const READONLY_SRC = fs.readFileSync(path.join(__dirname, 'stat-blocks-readonly.handlebars'), 'utf8');
const SIGNATURE_ENTRY_SRC = fs.readFileSync(path.join(__dirname, 'signature-entry.handlebars'), 'utf8');
const CLASS_ENCHANTMENT_SRC = fs.readFileSync(path.join(__dirname, 'class-enchantment.handlebars'), 'utf8');
const { renderPowerRatings } = require('../../util/markdown');

const render = (character, effectiveVersion = 'v1', showGearPurchases = false) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  hb.registerHelper('markdown', renderMarkdown);
  hb.registerHelper('powerRatings', renderPowerRatings);
  hb.registerPartial('character-detail-tag', TAG_SRC);
  hb.registerPartial('stat-blocks-readonly', READONLY_SRC);
  hb.registerPartial('signature-entry', SIGNATURE_ENTRY_SRC);
  hb.registerPartial('class-enchantment', CLASS_ENCHANTMENT_SRC);
  return hb.compile(DETAILS_SRC)({ character, effectiveVersion, statList, showGearPurchases });
};

const makeCharacter = (overrides = {}) => ({
  id: 'char-1',
  name: 'Ash',
  ...Object.fromEntries(statList.map(stat => [stat, 2])),
  traits: [{ name: 'brave', stat: 'might' }],
  abilities: [{ id: 'ab-1', name: 'Fireball', description: 'Big boom', class_id: 'class-a' }],
  gear: [{ name: 'Staff', description: 'Pointy', class_id: 'class-a' }],
  ability_perks: [],
  quirks: [],
  accessories: [],
  common_items: [],
  perks: '',
  additional_gear: '',
  ...overrides,
});

const count = (html, needle) => (html.match(new RegExp(needle, 'g')) || []).length;

test('stats always render, one block row per stat', () => {
  const html = render(makeCharacter());
  expect(html).toContain('Stats');
  expect(count(html, 'stat-blocks')).toBe(statList.length);
});

test('tooltip ids carry the character id so same-class members cannot collide', () => {
  const html = render(makeCharacter());
  expect(html).toContain('detail-char-1-ability-class-a-fireball');
  expect(html).toContain('detail-char-1-gear-class-a-staff');
});

test('empty sections are omitted, not rendered blank', () => {
  const html = render(makeCharacter({ abilities: [], gear: [], traits: [], common_items: [] }));
  expect(html).not.toContain('Class Abilities');
  expect(html).not.toContain('Signature Gear');
  expect(html).not.toContain('Personality');
  expect(html).not.toContain('Common Items');
});

test('v1 shows the markdown perks and never the v2 sections', () => {
  const html = render(makeCharacter({
    perks: 'V1 PERK TEXT',
    quirks: [{ name: 'Jumpy', description: 'twitchy' }],
  }), 'v1');
  expect(html).toContain('V1 PERK TEXT');
  expect(html).not.toContain('Quirks');
  expect(html).not.toContain('Jumpy');
});

test('v2 shows quirks, accessories and per-ability perks and never the v1 perks', () => {
  const html = render(makeCharacter({
    perks: 'V1 PERK TEXT',
    additional_gear: 'OLD GEAR TEXT',
    quirks: [{ name: 'Jumpy', description: 'twitchy' }],
    accessories: [{ name: 'Charm' }],
    ability_perks: [{ class_ability_id: 'ab-1', text: 'Perk one', position: 0, compounds_with: null }],
  }), 'v2');
  expect(html).toContain('Jumpy');
  expect(html).toContain('twitchy');
  expect(html).toContain('Charm');
  expect(html).toContain('Perk one');
  expect(html).not.toContain('V1 PERK TEXT');
  expect(html).not.toContain('OLD GEAR TEXT');
});

test('v1 deprecated additional gear renders with its warning tag', () => {
  const html = render(makeCharacter({ additional_gear: 'OLD GEAR TEXT' }), 'v1');
  expect(html).toContain('OLD GEAR TEXT');
  expect(html).toContain('Deprecated');
});

test('a gated item shows its name but offers no tooltip', () => {
  const html = render(makeCharacter({
    abilities: [{ id: 'ab-1', name: 'Fireball', description: '', class_id: 'class-a' }],
    gear: [],
  }));
  expect(html).toContain('Fireball');
  expect(html).not.toContain('data-tooltip-markdown');
});

test('personality traits render each trait name, not [object Object]', () => {
  const html = render(makeCharacter({
    traits: [{ name: 'brave', stat: 'might' }, { name: 'curious', stat: 'intelligence' }],
  }));
  expect(html).toContain('Brave');
  expect(html).toContain('Curious');
  expect(html).not.toContain('[object Object]');
});

test('common items render as a markdown list', () => {
  const html = render(makeCharacter({ common_items: ['**Rope**, 50ft'] }));
  expect(html).toContain('Common Items');
  expect(html).toContain('<strong>Rope</strong>');
});

// --- a Stat above the blocks shown ----------------------------------------
//
// stat-blocks-readonly documents its own contract: a value above `max` "fills
// every block and stops there", and "callers that can exceed max (party totals)
// print the real number alongside". This fragment was the one caller that did
// not, so a Stat of 6 rendered identically to a Stat of 5 on the /party roster
// and the LFG post page -- a player reading their own character as weaker than
// it is, with nothing to indicate the rounding. A Trait raises a V1 Stat's Cap
// to 6 (pg. 3, restated pg. 6), which is what makes a 6 ordinary rather than
// exotic. The numeral matches views/character.handlebars' statsReadOnly grid and
// stat-blocks' own over-count indicator.

const statsSection = (html) => html.slice(
  html.indexOf('<h4 class="title is-5">Stats</h4>'),
  html.indexOf('</div>\n\n', html.indexOf('<h4 class="title is-5">Stats</h4>'))
);

test('a Stat above the blocks shown prints its real number', () => {
  const html = render(makeCharacter({ might: 6, luck: 9 }));

  expect(html).toContain('<span class="stat-blocks-over">6 points</span>');
  expect(html).toContain('<span class="stat-blocks-over">9 points</span>');
  // Only for the two that exceed -- the other ten sit at 2.
  expect(html.match(/stat-blocks-over/g)).toHaveLength(2);
});

test('a Stat at the blocks shown prints no number', () => {
  // 5 is the boundary: it fills every block and is not over it.
  const html = render(makeCharacter({ might: 5 }));
  expect(html).not.toContain('stat-blocks-over');
});

// This fragment is served to the /party roster and the LFG post page for any
// character a viewer can see, so a missing or null Stat has to render as
// quietly as it did before rather than as "null points".
test('a missing or null Stat prints no number', () => {
  const html = render(makeCharacter({ might: null, luck: undefined }));
  expect(html).not.toContain('stat-blocks-over');
  expect(html).not.toContain('points');
});

// This fragment is lazy-loaded into the /party roster and the LFG post page, so
// a stray character in the common output would be visible on both. Nothing may
// change for a character at or below the blocks shown.
test('a character no Stat of which exceeds the blocks renders unchanged', () => {
  const html = render(makeCharacter(
    Object.fromEntries(statList.map((stat, i) => [stat, i % 6]))
  ));

  expect(html).not.toContain('stat-blocks-over');
  expect(html).not.toContain('points');
  // The stats section is exactly one readonly row per Stat and nothing else.
  const section = statsSection(html);
  expect(section.match(/<span class="stat-blocks is-readonly">/g)).toHaveLength(statList.length);
  expect((section.match(/<span/g) || []).length)
    .toBe(statList.length + (section.match(/wizard-stat-box/g) || []).length);
});

// -- Signature Gear: Enchantments and Mods (Task 11) ------------------------
//
// This fragment and views/character.handlebars render Signature Gear through
// the same views/partials/signature-entry.handlebars partial so the two
// cannot drift -- slice 5 shipped a fix for exactly this kind of divergence
// (ad019e3). See views/character.test.js for the full page's half of this
// contract.

test('the details fragment shows a Signature\'s Enchantment and Mods when purchases are shown', () => {
  const html = render(makeCharacter({
    gear: [{
      name: 'Cowboy Hat',
      enchantment: { source: 'default' },
      default_enchantment: { name: 'Hats Off to You', description: 'Portray a Turning Point.' },
      mods: [{ name: 'Scope', description: 'Sees far' }]
    }]
  }), 'v1', true);
  expect(html).toContain('Hats Off to You');
  expect(html).toContain('Scope');
});

test('the details fragment escapes a player-authored Custom Enchantment', () => {
  const html = render(makeCharacter({
    gear: [{
      name: 'Cowboy Hat',
      enchantment: { source: 'custom', name: '<script>x</script>', description: 'd' },
      mods: []
    }]
  }), 'v1', true);
  expect(html).not.toContain('<script>x');
  expect(html).toContain('&lt;script&gt;');
});

test('an advent character (showGearPurchases false) keeps the plain gear tag', () => {
  const html = render(makeCharacter({
    gear: [{
      name: 'Cowboy Hat',
      class_id: 'class-a',
      enchantment: { source: 'default' },
      default_enchantment: { name: 'Hats Off to You', description: 'Portray a Turning Point.' },
      mods: [{ name: 'Scope', description: 'Sees far' }]
    }]
  }), 'v1', false);
  expect(html).not.toContain('Hats Off to You');
  expect(html).not.toContain('Scope');
  expect(html).toContain('Cowboy Hat');
});
