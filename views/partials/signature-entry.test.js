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

test('a signature is its name with everything else in a tooltip, badged with what is fitted', () => {
  const html = render({
    idPrefix: 'gear',
    className: 'is-size-5',
    item: {
      name: 'Cowboy Hat',
      class_id: 'gunslinger',
      description: 'A wide brim.',
      meters: [],
      notes: [],
      default_enchantment: { name: 'Hats Off to You', description: 'Portray a Turning Point.' },
      enchantment: { source: 'default' },
      mods: [{ name: 'Scope', description: 'Sees far' }, { name: 'Band', description: '' }],
    },
  });
  const trigger = html.match(/<span class="is-size-5" data-tooltip-markdown="#([^"]+)">Cowboy Hat<\/span>/);
  expect(trigger).not.toBeNull();
  const tooltip = html.slice(html.indexOf(`<div id="${trigger[1]}" class="is-hidden">`));
  expect(tooltip).toContain('A wide brim.');
  expect(tooltip).toContain('Hats Off to You');
  expect(tooltip).toContain('Scope');
  const badges = [...html.matchAll(/<span class="tag is-light">([^<]+)<\/span>/g)].map((m) => m[1]);
  expect(badges).toEqual(['Default Ench', 'Mod x2']);
});

test('a signature with nothing fitted carries no badges', () => {
  const html = render({
    idPrefix: 'gear',
    item: { name: 'Cowboy Hat', class_id: 'gunslinger', description: 'A wide brim.', enchantment: null, mods: [] },
  });
  expect(html).toContain('data-tooltip-markdown=');
  expect(html).not.toContain('tag is-light');
});
