// The read-only Signature Gear entry shared by the character page and the
// character-details fragment.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const { renderMarkdown, renderPowerRatings } = require('../../util/markdown');

const ENTRY_SRC = fs.readFileSync(path.join(__dirname, 'signature-entry.handlebars'), 'utf8');

const render = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper('markdown', renderMarkdown);
  hb.registerHelper('powerRatings', renderPowerRatings);
  for (const partial of ['class-meters', 'class-notes', 'class-enchantment']) {
    hb.registerPartial(partial, fs.readFileSync(path.join(__dirname, `${partial}.handlebars`), 'utf8'));
  }
  return hb.compile(ENTRY_SRC)(context);
};

test('a signature shows the gear notes and meters under its description', () => {
  const html = render({
    item: {
      name: 'Cowboy Hat',
      description: '',
      meters: [{ label: 'Ammunition', value: 'Mid' }],
      notes: [{ text: 'Provides Ward against sun and glare', children: [{ text: 'Also rain' }] }],
      default_enchantment: null,
      enchantment: null,
      mods: [],
    },
  });
  expect(html).toContain('Ammunition');
  expect(html).toContain('Mid');
  expect(html).toContain('Provides Ward against sun and glare');
  expect(html).toContain('Also rain');
});
