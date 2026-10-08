// The single tooltip-tag unit shared by the character page and the
// character-details fragment — one place for the "visible name + hidden
// markdown + data-tooltip-markdown hook" pattern that used to be duplicated.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const { renderMarkdown, renderPowerRatings } = require('../../util/markdown');

const TAG_SRC = fs.readFileSync(path.join(__dirname, 'character-detail-tag.handlebars'), 'utf8');
const CHARACTER_PAGE_SRC = fs.readFileSync(path.join(__dirname, '..', 'character.handlebars'), 'utf8');

const render = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper('markdown', renderMarkdown);
  hb.registerHelper('powerRatings', renderPowerRatings);
  for (const partial of ['class-meters', 'class-notes', 'class-sample-perks']) {
    hb.registerPartial(partial, fs.readFileSync(path.join(__dirname, `${partial}.handlebars`), 'utf8'));
  }
  return hb.compile(TAG_SRC)(context);
};

const tooltipContent = (html) => {
  const match = html.match(/<div id="[^"]+" class="is-hidden">([\s\S]*)<\/div>/);
  return match ? match[1] : '';
};

test('an item with a description renders a tooltip tag plus hidden markdown', () => {
  const html = render({
    item: { name: 'Fireball', description: 'Big **boom**', class_id: 'class-a' },
    idPrefix: 'detail-char-1-ability',
    className: 'tag is-primary is-medium',
  });
  expect(html).toContain('data-tooltip-markdown="#detail-char-1-ability-class-a-fireball"');
  expect(html).toContain('id="detail-char-1-ability-class-a-fireball"');
  expect(html).toContain('<strong>boom</strong>');
  expect(html).toContain('tag is-primary is-medium');
});

test('a structured ability tooltip shows its meters, paired action, notes and sample perks', () => {
  const tooltip = tooltipContent(render({
    item: {
      name: 'Quickdraw',
      class_id: 'gunslinger',
      description: 'Draw and fire in one motion.',
      meters: [{ label: 'Ammunition', value: 'Mid' }],
      paired_action: 'Holster as a free action',
      notes: [{ text: 'Only with a sidearm', children: [{ text: 'Not a rifle' }] }],
      sample_perks: [{ name: 'Fan the Hammer', dedication: null, text: 'Fire twice', compound_text: null }],
    },
    idPrefix: 'ability',
    className: 'tag',
  }));
  expect(tooltip).toContain('Draw and fire in one motion.');
  expect(tooltip).toContain('Ammunition');
  expect(tooltip).toContain('Mid');
  expect(tooltip).toContain('Paired Action');
  expect(tooltip).toContain('Holster as a free action');
  expect(tooltip).toContain('Only with a sidearm');
  expect(tooltip).toContain('Not a rifle');
  expect(tooltip).toContain('Fan the Hammer');
  expect(tooltip).toContain('Fire twice');
});

test('an item whose text lives only in notes still gets a tooltip', () => {
  const html = render({
    item: {
      name: 'Cowboy Hat',
      class_id: 'gunslinger',
      description: '',
      notes: [{ text: 'Provides Ward against sun and glare', children: [] }],
    },
    idPrefix: 'gear',
    className: 'tag',
  });
  expect(html).toContain('data-tooltip-markdown="#gear-gunslinger-cowboy-hat"');
  expect(tooltipContent(html)).toContain('Provides Ward against sun and glare');
});

test('a blanked description renders a plain tag with no tooltip hook', () => {
  // This is what a gated item looks like: the gate emptied description, the
  // name still shows, nothing invites a tooltip that would come up empty.
  const html = render({
    item: {
      name: 'Fireball', description: '', class_id: 'class-a',
      meters: [], paired_action: null, notes: [], sample_perks: [],
    },
    idPrefix: 'detail-char-1-ability',
    className: 'tag is-primary is-medium',
  });
  expect(html).toContain('Fireball');
  expect(html).not.toContain('data-tooltip-markdown');
});

test('the character page renders abilities and gear through this partial', () => {
  const uses = CHARACTER_PAGE_SRC.match(/\{\{>\s*character-detail-tag/g) || [];
  expect(uses.length).toBeGreaterThanOrEqual(2);
  // The inline copies it replaces must be gone, not lingering beside it.
  expect(CHARACTER_PAGE_SRC).not.toContain('data-tooltip-markdown="#ability-');
  expect(CHARACTER_PAGE_SRC).not.toContain('data-tooltip-markdown="#gear-');
});
