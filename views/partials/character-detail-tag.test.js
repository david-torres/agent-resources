// The single tooltip-tag unit shared by the character page and the
// character-details fragment — one place for the "visible name + hidden
// markdown + data-tooltip-markdown hook" pattern that used to be duplicated.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const { renderMarkdown } = require('../../util/markdown');

const TAG_SRC = fs.readFileSync(path.join(__dirname, 'character-detail-tag.handlebars'), 'utf8');
const CHARACTER_PAGE_SRC = fs.readFileSync(path.join(__dirname, '..', 'character.handlebars'), 'utf8');

const render = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper('markdown', renderMarkdown);
  return hb.compile(TAG_SRC)(context);
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

test('a blanked description renders a plain tag with no tooltip hook', () => {
  // This is what a gated item looks like: the gate emptied description, the
  // name still shows, nothing invites a tooltip that would come up empty.
  const html = render({
    item: { name: 'Fireball', description: '', class_id: 'class-a' },
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
