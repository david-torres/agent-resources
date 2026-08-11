// The LFG post page showed stats as literal '+' characters. It predates the
// square-plus commit but is the same "stats as pluses" look, so it converts
// with the rest.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const rangeHelper = require('handlebars-helper-range');
const customHelpers = require('../util/handlebars');

const READONLY_SRC = fs.readFileSync(
  path.join(__dirname, 'partials', 'stat-blocks-readonly.handlebars'), 'utf8'
);
const LFG_SRC = fs.readFileSync(path.join(__dirname, 'lfg-post.handlebars'), 'utf8');

const renderReadonly = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  return hb.compile(READONLY_SRC)(context);
};

const count = (html, cls) => (html.match(new RegExp(cls, 'g')) || []).length;

test('renders one filled block per point and dims the rest to max', () => {
  const html = renderReadonly({ value: 2, max: 5 });
  expect(count(html, 'is-set')).toBe(2);
  expect(count(html, 'is-empty')).toBe(3);
});

test('a value at max fills every block and dims none', () => {
  const html = renderReadonly({ value: 5, max: 5 });
  expect(count(html, 'is-set')).toBe(5);
  expect(count(html, 'is-empty')).toBe(0);
});

test('a value above max fills every block without overflowing the row', () => {
  // Party totals routinely exceed 5; the row must cap rather than render 14
  // blocks. The caller shows the real number alongside.
  const html = renderReadonly({ value: 14, max: 5 });
  expect(count(html, 'is-set')).toBe(5);
  expect(count(html, 'is-empty')).toBe(0);
});

test('a zero or missing value renders an all-dim row', () => {
  expect(count(renderReadonly({ value: 0, max: 5 }), 'is-empty')).toBe(5);
  expect(count(renderReadonly({ max: 5 }), 'is-empty')).toBe(5);
});

test('the read-only control carries no interactive affordances', () => {
  const html = renderReadonly({ value: 3, max: 5 });
  expect(html).toContain('is-readonly');
  expect(html).not.toContain('role="radio"');
  expect(html).not.toContain('x-data');
  expect(html).not.toContain('@click');
  expect(html).not.toContain('tabindex');
});

test('lfg-post renders blocks and no longer prints plus characters', () => {
  expect(LFG_SRC).toContain('{{> stat-blocks-readonly');
  // Both {{#range}} loops that printed a bare '+' per point are gone.
  expect(LFG_SRC).not.toMatch(/\{\{#range 0 \(lookup [^)]*\)\}\}\+/);
  expect(LFG_SRC).not.toMatch(/\{\{#range 0 \(lookup [^)]*\)\}\}\s*\n\s*\+/);
});

test('the party stats box renders the shared summary partial', () => {
  // The numeral-beside-blocks assertion moved to
  // views/partials/party-summary.test.js, which now owns that contract for
  // both this page and /party. Keeping a copy here would let the two drift.
  const partySection = LFG_SRC.slice(LFG_SRC.indexOf('Party Stats'));
  expect(partySection).toContain('{{> party-summary');
  expect(LFG_SRC).not.toContain('lookup ../partyStats');
});

test('the post links out to the party tool with its approved members', () => {
  expect(LFG_SRC).toContain('/party?c=');
});
