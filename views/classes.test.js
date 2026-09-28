const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const { JSDOM } = require('jsdom');
const customHelpers = require('../util/handlebars');
const { registerAccessPartials } = require('../test/helpers/access-partials');

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
  registerAccessPartials(hb);
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

const bucket = (level, label, groups) => ({ level, label, groups });
const unrated = (groups) => [bucket('unrated', 'Unrated', groups)];

const baseContext = (overrides = {}) => ({
  filters: { rules_edition: '', rules_version: '', status: '' },
  isAdmin: false,
  ownedReleaseGroups: [],
  otherReleaseGroups: [],
  prereleaseGroups: [],
  pccGroups: [],
  lockedSections: [],
  ...overrides
});

test('owned release section renders its heading and thumbnail art', () => {
  const html = renderClasses(baseContext({
    ownedReleaseGroups: unrated([group('rel-1', 'Gunslinger', { image: true })])
  }));
  expect(html).toContain('Your Released Classes');
  expect(html).toContain('image-crop-render');
  expect(html).toContain('/classes/rel-1/Gunslinger');
});

test('PCC cards render no image markup even when the class has art', () => {
  const html = renderClasses(baseContext({
    pccGroups: unrated([group('pcc-1', 'Homebrew', { image: true, status: 'beta' })])
  }));
  expect(html).toContain('Player-Created Classes (PCCs)');
  expect(html).toContain('/classes/pcc-1/Homebrew');
  expect(html).not.toContain('image-crop-render');
  expect(html).not.toContain('card-image');
});

test('released section appears before the PCC section', () => {
  const html = renderClasses(baseContext({
    otherReleaseGroups: unrated([group('rel-1', 'Gunslinger')]),
    pccGroups: unrated([group('pcc-1', 'Homebrew', { status: 'beta' })])
  }));
  const releasedAt = html.indexOf('Released Classes');
  const pccAt = html.indexOf('Player-Created Classes (PCCs)');
  expect(releasedAt).toBeGreaterThan(-1);
  expect(pccAt).toBeGreaterThan(releasedAt);
});

test('an empty partition hides its whole section', () => {
  const onlyReleased = renderClasses(baseContext({
    otherReleaseGroups: unrated([group('rel-1', 'Gunslinger')])
  }));
  expect(onlyReleased).not.toContain('Player-Created Classes (PCCs)');

  const onlyPcc = renderClasses(baseContext({
    pccGroups: unrated([group('pcc-1', 'Homebrew', { status: 'beta' })])
  }));
  expect(onlyPcc).not.toContain('Released Classes');

  const empty = renderClasses(baseContext());
  expect(empty).not.toContain('Released Classes');
  expect(empty).not.toContain('Player-Created Classes (PCCs)');
});

test('previous-version links still render inside a card', () => {
  const html = renderClasses(baseContext({
    otherReleaseGroups: unrated([group('rel-2', 'Librarian', {
      previous: [{ id: 'rel-old', name: 'Librarian', rules_version: 'v1' }]
    })])
  }));
  expect(html).toContain('Previous:');
  expect(html).toContain('/classes/rel-old/Librarian');
});

test('admin-only Private tag renders only for admins on non-public classes', () => {
  const privateGroup = group('priv-1', 'Secret');
  privateGroup.primary.is_public = false;
  const asAdmin = renderClasses(baseContext({ isAdmin: true, otherReleaseGroups: unrated([privateGroup]) }));
  expect(asAdmin).toContain('Private');
  const asUser = renderClasses(baseContext({ isAdmin: false, otherReleaseGroups: unrated([privateGroup]) }));
  expect(asUser).not.toContain('Private');
});

test('card renders the teaser blurb', () => {
  const html = renderClasses(baseContext({
    otherReleaseGroups: unrated([group('rel-1', 'Gunslinger')])
  }));
  expect(html).toContain('Gunslinger teaser');
});

test('card omits the blurb paragraph when teaser is blank', () => {
  const blankTeaser = group('rel-1', 'Gunslinger');
  blankTeaser.primary.teaser = null;
  const html = renderClasses(baseContext({ otherReleaseGroups: unrated([blankTeaser]) }));
  expect(html).not.toContain('teaser');
});

test('unowned releases and prerelease classes never render art', () => {
  const html = renderClasses(baseContext({
    otherReleaseGroups: unrated([group('rel-1', 'Gunslinger', { image: true })]),
    prereleaseGroups: unrated([group('pre-1', 'Bogatyr', { image: true, status: 'beta' })])
  }));
  expect(html).toContain('Other Released Classes');
  expect(html).toContain('Pre-release Classes');
  expect(html).not.toContain('image-crop-render');
});

const aspirantFilterOption = (html) => html.match(/<option value="aspirant"[^>]*>/)[0];

test('the Aspirant rules-edition filter option is selectable', () => {
  const html = renderClasses(baseContext());
  expect(aspirantFilterOption(html)).not.toContain('disabled');
});

test('the Aspirant rules-edition filter option is selected when filtering by Aspirant', () => {
  const html = renderClasses(baseContext({
    filters: { rules_edition: 'aspirant', rules_version: '', status: '' }
  }));
  expect(aspirantFilterOption(html)).toContain('selected');
});

const editionGroup = (id, name, edition) => {
  const g = group(id, name);
  g.primary.rules_edition = edition;
  return g;
};

const decodeEntities = (html) => html.replace(/&amp;/g, '&').replace(/&#x3D;/g, '=');

const ownedToggle = (html) => {
  const m = html.match(/<div[^>]*id="ownedEditionToggle"[\s\S]*?<\/div>/);
  return m ? decodeEntities(m[0]) : null;
};

const toggleLink = (toggleHtml, label) => {
  const m = toggleHtml.match(new RegExp(`<a[^>]*>\\s*${label}\\s*</a>`));
  return m ? m[0] : null;
};

const bothEditionsContext = (ownedEdition) => baseContext({
  ownedReleaseGroups: unrated([editionGroup('asp-1', 'Aeronaut', 'aspirant')]),
  ownedEdition,
  ownedEditions: ['advent', 'aspirant'],
  ownedToggleLinks: {
    advent: '/classes?status=release&yours=advent',
    aspirant: '/classes?status=release&yours=aspirant'
  }
});

test('owning both editions renders an Advent | Aspirant toggle under Your Released Classes', () => {
  const html = renderClasses(bothEditionsContext('aspirant'));
  const toggle = ownedToggle(html);
  expect(toggle).not.toBeNull();
  expect(toggle).toContain('role="group"');
  expect(html.indexOf('id="ownedEditionToggle"')).toBeGreaterThan(html.indexOf('Your Released Classes'));
  expect(toggleLink(toggle, 'Advent')).toContain('href="/classes?status=release&yours=advent"');
  expect(toggleLink(toggle, 'Aspirant')).toContain('href="/classes?status=release&yours=aspirant"');
});

test('the owned edition toggle marks only the shown edition as active', () => {
  const aspirantToggle = ownedToggle(renderClasses(bothEditionsContext('aspirant')));
  expect(toggleLink(aspirantToggle, 'Aspirant')).toContain('is-selected');
  expect(toggleLink(aspirantToggle, 'Aspirant')).toContain('aria-current="true"');
  expect(toggleLink(aspirantToggle, 'Advent')).not.toContain('is-selected');
  expect(toggleLink(aspirantToggle, 'Advent')).not.toContain('aria-current');

  const adventToggle = ownedToggle(renderClasses(bothEditionsContext('advent')));
  expect(toggleLink(adventToggle, 'Advent')).toContain('is-selected');
  expect(toggleLink(adventToggle, 'Advent')).toContain('aria-current="true"');
  expect(toggleLink(adventToggle, 'Aspirant')).not.toContain('is-selected');
});

test('owning a single edition renders no owned edition toggle', () => {
  const html = renderClasses(baseContext({
    ownedReleaseGroups: unrated([editionGroup('gun', 'Gunslinger', 'advent')]),
    ownedEdition: 'advent',
    ownedEditions: ['advent'],
    ownedToggleLinks: { advent: '/classes?yours=advent', aspirant: '/classes?yours=aspirant' }
  }));
  expect(html).toContain('Your Released Classes');
  expect(html).not.toContain('ownedEditionToggle');
});

const parse = (html) => new JSDOM(html).window.document;

const sectionSequence = (doc, sectionHeadingId) => {
  const nodes = [...doc.querySelectorAll('h2, h3, .card h5 a')];
  const start = nodes.findIndex((n) => n.id === sectionHeadingId);
  const rest = nodes.slice(start + 1);
  const end = rest.findIndex((n) => n.tagName === 'H2');
  return (end === -1 ? rest : rest.slice(0, end))
    .map((n) => (n.tagName === 'H3' ? `## ${n.textContent.trim()}` : n.textContent.trim()));
};

test('a section with several challenge buckets renders an h3 per bucket followed by its cards', () => {
  const doc = parse(renderClasses(baseContext({
    otherReleaseGroups: [
      bucket('Low', 'Low Challenge', [group('low-1', 'Aeronaut'), group('low-2', 'Bard')]),
      bucket('High', 'High Challenge', [group('high-1', 'Gunslinger')]),
      bucket('unrated', 'Unrated', [group('un-1', 'Librarian')])
    ]
  })));
  expect(sectionSequence(doc, 'released-classes')).toEqual([
    '## Low Challenge', 'Aeronaut', 'Bard',
    '## High Challenge', 'Gunslinger',
    '## Unrated', 'Librarian'
  ]);
});

test('a section whose only bucket is unrated renders its cards with no challenge subheading', () => {
  const doc = parse(renderClasses(baseContext({
    pccGroups: unrated([group('pcc-1', 'Homebrew', { status: 'beta' }), group('pcc-2', 'Tinker', { status: 'beta' })])
  })));
  expect(sectionSequence(doc, 'player-created-classes')).toEqual(['Homebrew', 'Tinker']);
  expect(doc.querySelectorAll('h3')).toHaveLength(0);
});

test('each bucketed section keeps its grid wrapper id around its cards', () => {
  const doc = parse(renderClasses(baseContext({
    ownedReleaseGroups: [
      bucket('Low', 'Low Challenge', [group('own-1', 'Aeronaut')]),
      bucket('Mid', 'Mid Challenge', [group('own-2', 'Bard')])
    ],
    otherReleaseGroups: [bucket('High', 'High Challenge', [group('rel-1', 'Gunslinger')])],
    prereleaseGroups: [bucket('Mid', 'Mid Challenge', [group('pre-1', 'Bogatyr', { status: 'beta' })])],
    pccGroups: [
      bucket('Low', 'Low Challenge', [group('pcc-1', 'Homebrew', { status: 'beta' })]),
      bucket('unrated', 'Unrated', [group('pcc-2', 'Tinker', { status: 'beta' })])
    ]
  })));
  const cardNames = (id) => [...doc.querySelectorAll(`#${id} .card h5 a`)].map((a) => a.textContent.trim());
  expect(cardNames('classList')).toEqual(['Aeronaut', 'Bard']);
  expect(cardNames('otherClassList')).toEqual(['Gunslinger']);
  expect(cardNames('prereleaseClassList')).toEqual(['Bogatyr']);
  expect(cardNames('pccClassList')).toEqual(['Homebrew', 'Tinker']);
});

const aspirantSection = (over = {}) => ({
  edition: 'aspirant', count: 1, trialEndedAt: null,
  buckets: unrated([{ ...group('asp-1', 'Berserker'), primary: { ...group('asp-1', 'Berserker').primary, rules_edition: 'aspirant' } }]),
  ...over
});

test('a locked edition section names the edition, counts its classes and offers its CTA', () => {
  const html = renderClasses(baseContext({ profile: { timezone: 'UTC' }, lockedSections: [aspirantSection()] }));
  expect(html).toContain('Locked — Aspirant');
  expect(html).toContain('1 class');
  expect(html).toContain('https://enclave-aspirant.backerkit.com/hosted_preorders/822771');
  expect(html).toContain('Redeem a code');
  expect(html).toContain('Berserker teaser');
  expect(html).toContain('href="/classes/asp-1/Berserker"');
});

test("a lapsed trial's Advent section carries the ended notice", () => {
  const html = renderClasses(baseContext({
    profile: { timezone: 'UTC' },
    lockedSections: [aspirantSection({ edition: 'advent', trialEndedAt: '2026-09-20T12:00:00Z' })]
  }));
  expect(html).toContain('Locked — Advent');
  expect(html).toContain('Your Advent free trial ended Sep 20, 2026.');
});

test('locked cards are dimmed, carry a lock and render no art', () => {
  const html = renderClasses(baseContext({
    lockedSections: [aspirantSection({ buckets: unrated([group('asp-2', 'Vessel', { image: true })]) })]
  }));
  expect(html).toContain('data-locked-card');
  expect(html).toContain('fa-lock');
  expect(html).not.toContain('image-crop-render');
});

test('locked sections sit between the owned and the other released sections', () => {
  const html = renderClasses(baseContext({
    ownedReleaseGroups: unrated([group('own-1', 'Gunslinger')]),
    otherReleaseGroups: unrated([group('oth-1', 'Homebrew')]),
    lockedSections: [aspirantSection()]
  }));
  const ownedAt = html.indexOf('Your Released Classes');
  const lockedAt = html.indexOf('Locked — Aspirant');
  const otherAt = html.indexOf('Other Released Classes');
  expect(ownedAt).toBeLessThan(lockedAt);
  expect(lockedAt).toBeLessThan(otherAt);
});

test('owned Advent cards carry a TRIAL badge while the trial runs', () => {
  const html = renderClasses(baseContext({
    profile: { timezone: 'UTC' },
    showTrialBadges: true,
    editionAccess: { advent: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false } },
    ownedReleaseGroups: unrated([group('own-1', 'Gunslinger')])
  }));
  expect(html).toContain('TRIAL · ends Oct 8, 2026');
});

test('no TRIAL badge without an Advent trial', () => {
  const html = renderClasses(baseContext({ ownedReleaseGroups: unrated([group('own-1', 'Gunslinger')]) }));
  expect(html).not.toContain('TRIAL ·');
});
