const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const customHelpers = require('../util/handlebars');

const handlebarsHelpers = require('handlebars-helpers')();

const partialSource = (name) => fs.readFileSync(
  path.join(__dirname, 'partials', `${name}.handlebars`), 'utf8'
);

function renderClasses(context) {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('breadcrumbs', partialSource('breadcrumbs'));
  hb.registerPartial('section-heading', partialSource('section-heading'));
  hb.registerPartial('class-group-card', partialSource('class-group-card'));
  const src = fs.readFileSync(path.join(__dirname, 'classes.handlebars'), 'utf8');
  return hb.compile(src)(context);
}

const group = (id, name, { image = false, status = 'release', previous = [] } = {}) => ({
  primary: {
    id,
    name,
    status,
    is_public: true,
    rules_edition: 'advent',
    rules_version: 'v1',
    image_url: image ? `https://cdn.example/${id}.png` : null,
    image_crop: image ? { x: 0, y: 0, width: 100, height: 100 } : null,
    teaser: `${name} teaser`
  },
  previous
});

const baseContext = (overrides = {}) => ({
  filters: { rules_edition: '', rules_version: '', status: '' },
  isAdmin: false,
  ownedReleaseGroups: [],
  otherReleaseGroups: [],
  prereleaseGroups: [],
  pccGroups: [],
  ...overrides
});

test('owned release section renders its heading and thumbnail art', () => {
  const html = renderClasses(baseContext({
    ownedReleaseGroups: [group('rel-1', 'Gunslinger', { image: true })]
  }));
  expect(html).toContain('Your Released Classes');
  expect(html).toContain('image-crop-render');
  expect(html).toContain('/classes/rel-1/Gunslinger');
});

test('PCC cards render no image markup even when the class has art', () => {
  const html = renderClasses(baseContext({
    pccGroups: [group('pcc-1', 'Homebrew', { image: true, status: 'beta' })]
  }));
  expect(html).toContain('Player-Created Classes (PCCs)');
  expect(html).toContain('/classes/pcc-1/Homebrew');
  expect(html).not.toContain('image-crop-render');
  expect(html).not.toContain('card-image');
});

test('released section appears before the PCC section', () => {
  const html = renderClasses(baseContext({
    otherReleaseGroups: [group('rel-1', 'Gunslinger')],
    pccGroups: [group('pcc-1', 'Homebrew', { status: 'beta' })]
  }));
  const releasedAt = html.indexOf('Released Classes');
  const pccAt = html.indexOf('Player-Created Classes (PCCs)');
  expect(releasedAt).toBeGreaterThan(-1);
  expect(pccAt).toBeGreaterThan(releasedAt);
});

test('an empty partition hides its whole section', () => {
  const onlyReleased = renderClasses(baseContext({
    otherReleaseGroups: [group('rel-1', 'Gunslinger')]
  }));
  expect(onlyReleased).not.toContain('Player-Created Classes (PCCs)');

  const onlyPcc = renderClasses(baseContext({
    pccGroups: [group('pcc-1', 'Homebrew', { status: 'beta' })]
  }));
  expect(onlyPcc).not.toContain('Released Classes');

  const empty = renderClasses(baseContext());
  expect(empty).not.toContain('Released Classes');
  expect(empty).not.toContain('Player-Created Classes (PCCs)');
});

test('previous-version links still render inside a card', () => {
  const html = renderClasses(baseContext({
    otherReleaseGroups: [group('rel-2', 'Librarian', {
      previous: [{ id: 'rel-old', name: 'Librarian', rules_version: 'v1' }]
    })]
  }));
  expect(html).toContain('Previous:');
  expect(html).toContain('/classes/rel-old/Librarian');
});

test('admin-only Private tag renders only for admins on non-public classes', () => {
  const privateGroup = group('priv-1', 'Secret');
  privateGroup.primary.is_public = false;
  const asAdmin = renderClasses(baseContext({ isAdmin: true, otherReleaseGroups: [privateGroup] }));
  expect(asAdmin).toContain('Private');
  const asUser = renderClasses(baseContext({ isAdmin: false, otherReleaseGroups: [privateGroup] }));
  expect(asUser).not.toContain('Private');
});

test('card renders the teaser blurb', () => {
  const html = renderClasses(baseContext({
    otherReleaseGroups: [group('rel-1', 'Gunslinger')]
  }));
  expect(html).toContain('Gunslinger teaser');
});

test('card omits the blurb paragraph when teaser is blank', () => {
  const blankTeaser = group('rel-1', 'Gunslinger');
  blankTeaser.primary.teaser = null;
  const html = renderClasses(baseContext({ otherReleaseGroups: [blankTeaser] }));
  expect(html).not.toContain('teaser');
});

test('unowned releases and prerelease classes never render art', () => {
  const html = renderClasses(baseContext({
    otherReleaseGroups: [group('rel-1', 'Gunslinger', { image: true })],
    prereleaseGroups: [group('pre-1', 'Bogatyr', { image: true, status: 'beta' })]
  }));
  expect(html).toContain('Other Released Classes');
  expect(html).toContain('Pre-release Classes');
  expect(html).not.toContain('image-crop-render');
});
