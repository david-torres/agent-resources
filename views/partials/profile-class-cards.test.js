const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

function renderPartial(context) {
  const src = fs.readFileSync(
    path.join(__dirname, 'profile-class-cards.handlebars'),
    'utf8'
  );
  return Handlebars.compile(src)(context);
}

test('profile-class-cards renders a multiline column grid with a card per class', () => {
  const html = renderPartial({
    classes: [
      { id: 'abc', name: 'Vanguard', teaser: 'Frontline tank' },
      { id: 'def', name: 'Conduit' }
    ]
  });

  expect(html).toContain('columns is-multiline');

  const columnCount = (html.match(/column is-3/g) || []).length;
  expect(columnCount).toBe(2);

  // Links to the class page and shows the name in an h5 title.
  expect(html).toContain('href="/classes/abc/Vanguard"');
  expect(html).toContain('href="/classes/def/Conduit"');
  expect(html).toContain('<h5');
  expect(html).toContain('Vanguard');
  expect(html).toContain('Conduit');

  // Teaser present -> rendered in a paragraph; absent -> no teaser text.
  expect(html).toContain('Frontline tank');
});

test('profile-class-cards renders a cropped card-image only when image_url is present', () => {
  const html = renderPartial({
    classes: [
      {
        id: 'abc',
        name: 'Vanguard',
        image_url: 'https://cdn.example/v.png',
        image_crop: { x: 10, y: 20, width: 300, height: 400 }
      },
      { id: 'def', name: 'Conduit' }
    ]
  });

  // Cropped image render for the class that has an image_url.
  expect(html).toContain('image-crop-render');
  expect(html).toContain('data-cropped-image');
  expect(html).toContain('data-image-src="https://cdn.example/v.png"');
  expect(html).toContain('data-crop-x="10"');
  expect(html).toContain('data-crop-y="20"');
  expect(html).toContain('data-crop-width="300"');
  expect(html).toContain('data-crop-height="400"');
  expect(html).toContain('role="img"');
  expect(html).toContain('aria-label="Vanguard"');

  // The image is wrapped in a card-image link to the class page.
  expect(html).toContain('card-image');

  // Exactly one card-image block: the class without image_url has none.
  const imageBlocks = (html.match(/card-image/g) || []).length;
  expect(imageBlocks).toBe(1);
});

test('profile-class-cards renders no class columns for an empty list', () => {
  const html = renderPartial({ classes: [] });

  expect(html).not.toContain('column is-3');
});
