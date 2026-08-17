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

const render = (character, effectiveVersion = 'v1') => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  hb.registerHelper('markdown', renderMarkdown);
  hb.registerPartial('character-detail-tag', TAG_SRC);
  hb.registerPartial('stat-blocks-readonly', READONLY_SRC);
  return hb.compile(DETAILS_SRC)({ character, effectiveVersion, statList });
};

const makeCharacter = (overrides = {}) => ({
  id: 'char-1',
  name: 'Ash',
  ...Object.fromEntries(statList.map(stat => [stat, 2])),
  traits: ['brave'],
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

test('common items render as a markdown list', () => {
  const html = render(makeCharacter({ common_items: ['**Rope**, 50ft'] }));
  expect(html).toContain('Common Items');
  expect(html).toContain('<strong>Rope</strong>');
});
