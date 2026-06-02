const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

function renderPartial(context) {
  const src = fs.readFileSync(
    path.join(__dirname, 'section-heading.handlebars'),
    'utf8'
  );
  return Handlebars.compile(src)(context);
}

test('section-heading renders an anchor-linked heading with the given tag', () => {
  const html = renderPartial({
    tag: 'h2',
    class: 'title is-4',
    id: 'public-characters',
    title: 'Public Characters'
  });

  expect(html).toContain('id="public-characters"');
  expect(html).toContain('href="#public-characters"');
  expect(html).toContain('data-anchor-copy');
  expect(html).toContain('Public Characters');
  expect(html).toContain('<h2');
  expect(html).toContain('</h2>');
});

test('section-heading honors a different tag and id', () => {
  const html = renderPartial({
    tag: 'h3',
    class: 'title is-4',
    id: 'conduit-briefing',
    title: 'Conduit Briefing'
  });

  expect(html).toContain('<h3');
  expect(html).toContain('id="conduit-briefing"');
  expect(html).toContain('href="#conduit-briefing"');
});
