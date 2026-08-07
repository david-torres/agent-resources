// party-summary is rendered by BOTH /party and the LFG post page. These tests
// are the contract between them: whatever changes here changes both pages.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const rangeHelper = require('handlebars-helper-range');
const customHelpers = require('../../util/handlebars');
const { summarizeParty } = require('../../util/party-stats');
const { statList } = require('../../util/enclave-consts');

const SUMMARY_SRC = fs.readFileSync(path.join(__dirname, 'party-summary.handlebars'), 'utf8');
const READONLY_SRC = fs.readFileSync(path.join(__dirname, 'stat-blocks-readonly.handlebars'), 'utf8');

const render = (summary) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  hb.registerPartial('stat-blocks-readonly', READONLY_SRC);
  return hb.compile(SUMMARY_SRC)({ summary });
};

const member = (name, stats = {}) => ({
  id: `id-${name}`,
  name,
  is_public: true,
  is_deceased: false,
  ...Object.fromEntries(statList.map(stat => [stat, 0])),
  ...stats
});

const count = (html, needle) => (html.match(new RegExp(needle, 'g')) || []).length;

test('every stat gets a numeral and a block row', () => {
  const html = render(summarizeParty([member('Ash', { might: 3 })]));
  expect(count(html, 'stat-blocks')).toBe(statList.length);
  statList.forEach(stat => expect(html.toLowerCase()).toContain(stat));
});

test('a total above five prints the real number beside a full block row', () => {
  // Party totals routinely exceed 5. stat-blocks-readonly caps the row at
  // max; the numeral is what keeps the real value visible.
  const html = render(summarizeParty([
    member('Ash', { might: 5 }), member('Bee', { might: 5 }), member('Cy', { might: 4 })
  ]));
  expect(html).toContain('14');
});

test('gaps are named so a zero does not have to be spotted by eye', () => {
  const html = render(summarizeParty([member('Ash', { might: 3 })]));
  expect(html).toMatch(/No coverage/i);
  // Assert against the callout paragraph alone, not the whole document: the
  // totals grid above prints all 12 stat names regardless, so a
  // document-wide toContain('Arcane') would pass with the gaps list empty.
  // Bounded at the closing </p> because "Strongest: Might" follows it.
  const start = html.search(/No coverage/i);
  const callout = html.slice(start, html.indexOf('</p>', start));
  expect(callout).toContain('Arcane');
  expect(callout).not.toContain('Might');
});

test('a party with full coverage shows no gaps callout', () => {
  const full = member('Ash', Object.fromEntries(statList.map(stat => [stat, 2])));
  const html = render(summarizeParty([full]));
  expect(html).not.toMatch(/No coverage/i);
});

test('the breakdown has one row per member plus a totals row', () => {
  const html = render(summarizeParty([member('Ash', { might: 3 }), member('Bee', { might: 2 })]));
  expect(html).toContain('Ash');
  expect(html).toContain('Bee');
  expect(html).toMatch(/Total/i);
});

test('the breakdown scrolls rather than breaking the layout on narrow screens', () => {
  // 13 columns will not fit a phone. Bulma's .table-container is the scroll
  // affordance; without it the page itself scrolls sideways.
  const html = render(summarizeParty([member('Ash')]));
  expect(html).toContain('table-container');
});

test('an empty party renders no coverage or breakdown sections', () => {
  const html = render(summarizeParty([]));
  expect(html).not.toMatch(/No coverage/i);
  expect(html).not.toContain('table-container');
});

test('private members are marked so a lossy share link is visible', () => {
  const html = render(summarizeParty([member('Ash', { might: 3 }), { ...member('Bee'), is_public: false }]));
  expect(html).toContain('fa-lock');
});
