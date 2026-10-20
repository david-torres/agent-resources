// The stat tooltip every per-character stat renders through. The trigger and
// its .tooltip-markdown sibling must stay adjacent: public/js/app.js's
// _initTooltips finds the content as the trigger's next element sibling,
// including after htmx swaps.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const rangeHelper = require('handlebars-helper-range');
const customHelpers = require('../../util/handlebars');

const partial = (name) => fs.readFileSync(path.join(__dirname, `${name}.handlebars`), 'utf8');

const render = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  for (const name of ['stat-blocks-readonly', 'stat-scaling-entry']) hb.registerPartial(name, partial(name));
  return hb.compile(partial('stat-value'))(context).replace(/\s+/g, ' ');
};

test('a stat is a focusable trigger followed by its Stat Scaling text', () => {
  const html = render({ stat: 'might', value: 1 });
  expect(html).toMatch(/<span class="stat-value" tabindex="0" data-tooltip-markdown="">\s?1\s?<\/span>\s?<div class="tooltip-markdown is-hidden">/);
  expect(html).toContain('<strong>+ Might</strong>');
  expect(html).toContain('Crush an apple one-handed.');
});

test('a mechanic line is labelled with its term', () => {
  const html = render({ stat: 'will', value: 0 });
  expect(html).toContain('<strong>Essence</strong>: Drop a Threshold after two Mid Costs.');
});

test('a value the table does not cover renders plain, with no tooltip', () => {
  for (const value of [9, null]) {
    const html = render({ stat: 'might', value });
    expect(html).not.toContain('data-tooltip-markdown');
    expect(html).not.toContain('tooltip-markdown');
    expect(html).not.toContain('undefined');
  }
});

test('block mode wraps the blocks and keeps the over-cap note', () => {
  const html = render({ stat: 'might', value: 6, blocks: true });
  expect(html).toContain('stat-blocks is-readonly');
  expect(html).toContain('6 points');
  expect(html).toContain('Stop a speeding car in its tracks.');
});
