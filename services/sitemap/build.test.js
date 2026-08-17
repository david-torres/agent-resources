// Nobody reads the sitemap directly -- a mistake shows up weeks later as pages
// missing from search results. Covers the parts with no visible failure mode:
// URLs matching the routes the app serves, encoding/escaping of user-supplied
// names, and a failing section degrading rather than breaking the document.
const { test, expect, beforeEach } = require('bun:test');
const { JSDOM } = require('jsdom');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const {
  buildSitemap,
  getSitemapXml,
  clearSitemapCache,
  renderSitemap,
  toLastmod,
  LIMITS,
  STATIC_PATHS
} = require('./build');

const BASE = 'https://agent-resources.vip';

const ok = (rows) => async () => ({ data: rows, error: null });
const fails = (message) => async () => ({ data: null, error: new Error(message) });
const throws = (message) => async () => { throw new Error(message); };

const emptyDeps = () => ({
  listPublicCharacters: ok([]),
  listPublicMissions: ok([]),
  listPublicClasses: ok([]),
  listPublicPages: ok([]),
  listPublicProfiles: ok([])
});

const locs = (xml) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(match => match[1]);

// Parse as XML so escaping bugs surface as a parse error.
const { DOMParser } = new JSDOM('').window;
const parse = (xml) => new DOMParser().parseFromString(xml, 'text/xml');

beforeEach(() => clearSitemapCache());

test('emits a valid urlset containing the static routes', async () => {
  const { xml } = await buildSitemap({ baseUrl: BASE }, emptyDeps());

  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
  expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

  const doc = parse(xml);
  expect(doc.getElementsByTagName('parsererror').length).toBe(0);
  expect(doc.getElementsByTagName('url').length).toBe(STATIC_PATHS.length);

  for (const path of STATIC_PATHS) {
    expect(locs(xml)).toContain(`${BASE}${path}`);
  }
});

test('builds content URLs in the shapes the routes serve', async () => {
  const { xml } = await buildSitemap({ baseUrl: BASE }, {
    ...emptyDeps(),
    listPublicCharacters: ok([{ id: 'char-1', name: 'Nadia', updated_at: '2026-05-01T00:00:00.000Z' }]),
    listPublicMissions: ok([{ id: 'mission-1', updated_at: '2026-05-02T00:00:00.000Z' }]),
    listPublicClasses: ok([{ id: 'class-1', name: 'Vanguard', updated_at: '2026-05-03T00:00:00.000Z' }]),
    listPublicPages: ok([{ slug: 'changelog-advent-v1-v2', updated_at: '2026-05-04T00:00:00.000Z' }]),
    listPublicProfiles: ok([{ name: 'dtorres' }])
  });

  expect(locs(xml)).toEqual([
    ...STATIC_PATHS.map(path => `${BASE}${path}`),
    `${BASE}/pages/changelog-advent-v1-v2`,
    `${BASE}/classes/class-1/Vanguard`,
    `${BASE}/characters/char-1/Nadia`,
    `${BASE}/missions/mission-1`,
    `${BASE}/profile/view/dtorres`
  ]);
});

test('a trailing slash on the base URL does not double up', async () => {
  const { xml } = await buildSitemap({ baseUrl: `${BASE}/` }, emptyDeps());

  expect(locs(xml)).toContain(`${BASE}/`);
  expect(xml).not.toContain('//privacy');
});

test('names are URL-encoded and XML-escaped', async () => {
  const { xml } = await buildSitemap({ baseUrl: BASE }, {
    ...emptyDeps(),
    listPublicCharacters: ok([{ id: 'char-1', name: 'Nadia & "Rook" <the Kid>', updated_at: null }]),
    listPublicProfiles: ok([{ name: 'a b/c' }])
  });

  const doc = parse(xml);
  expect(doc.getElementsByTagName('parsererror').length).toBe(0);

  // encodeURIComponent turns & into %26, so no raw markup from user data
  // reaches the document at all.
  expect(xml).toContain(`${BASE}/characters/char-1/Nadia%20%26%20%22Rook%22%20%3Cthe%20Kid%3E`);
  expect(xml).toContain(`${BASE}/profile/view/a%20b%2Fc`);
});

test('rows with no usable URL segment are dropped', async () => {
  const { xml } = await buildSitemap({ baseUrl: BASE }, {
    ...emptyDeps(),
    // A blank name is fine for characters and classes (optional segment), but
    // a page needs its slug and a profile is looked up by name.
    listPublicCharacters: ok([{ id: 'char-1', name: '   ', updated_at: null }]),
    listPublicPages: ok([{ slug: null, updated_at: null }, { slug: 'real', updated_at: null }]),
    listPublicProfiles: ok([{ name: '' }])
  });

  const urls = locs(xml);
  expect(urls).toContain(`${BASE}/characters/char-1`);
  expect(urls).toContain(`${BASE}/pages/real`);
  expect(urls.some(url => url.includes('/profile/view/'))).toBe(false);
  expect(urls.length).toBe(STATIC_PATHS.length + 2);
});

test('lastmod is emitted as a W3C datetime, and omitted when unusable', async () => {
  const { xml } = await buildSitemap({ baseUrl: BASE }, {
    ...emptyDeps(),
    listPublicMissions: ok([
      { id: 'good', updated_at: '2026-05-02T03:04:05+00:00' },
      { id: 'bad', updated_at: 'not a date' },
      { id: 'missing', updated_at: null }
    ])
  });

  expect(xml).toContain('<loc>https://agent-resources.vip/missions/good</loc>\n    <lastmod>2026-05-02T03:04:05.000Z</lastmod>');
  expect(xml).toContain('<loc>https://agent-resources.vip/missions/bad</loc>\n  </url>');
  expect(xml).toContain('<loc>https://agent-resources.vip/missions/missing</loc>\n  </url>');
  expect([...xml.matchAll(/<lastmod>/g)].length).toBe(1);
});

test('toLastmod rejects unparseable input rather than emitting it', () => {
  expect(toLastmod('2026-05-02T03:04:05Z')).toBe('2026-05-02T03:04:05.000Z');
  expect(toLastmod('not a date')).toBe(null);
  expect(toLastmod(null)).toBe(null);
  expect(toLastmod('')).toBe(null);
});

test('a failing section degrades to empty and is reported', async () => {
  const { xml, failures } = await buildSitemap({ baseUrl: BASE }, {
    ...emptyDeps(),
    listPublicCharacters: fails('characters table exploded'),
    listPublicMissions: throws('connection reset'),
    listPublicPages: ok([{ slug: 'still-here', updated_at: null }])
  });

  expect(failures.sort()).toEqual(['characters', 'missions']);
  // The sections that worked still ship.
  expect(locs(xml)).toContain(`${BASE}/pages/still-here`);
  expect(parse(xml).getElementsByTagName('parsererror').length).toBe(0);
});

test('each section asks for its documented cap', async () => {
  const asked = {};
  const record = (label) => async ({ limit }) => {
    asked[label] = limit;
    return { data: [], error: null };
  };

  await buildSitemap({ baseUrl: BASE }, {
    listPublicCharacters: record('characters'),
    listPublicMissions: record('missions'),
    listPublicClasses: record('classes'),
    listPublicPages: record('pages'),
    listPublicProfiles: record('profiles')
  });

  expect(asked).toEqual(LIMITS);
  // Must leave room for a single valid sitemap (50,000 URLs).
  const total = Object.values(LIMITS).reduce((sum, value) => sum + value, 0);
  expect(total + STATIC_PATHS.length).toBeLessThanOrEqual(50000);
});

test('a complete document is cached; a degraded one is not', async () => {
  let calls = 0;
  const counting = () => ({
    ...emptyDeps(),
    listPublicMissions: async () => {
      calls += 1;
      return { data: [{ id: `mission-${calls}`, updated_at: null }], error: null };
    }
  });

  const first = await getSitemapXml({ baseUrl: BASE }, counting());
  const second = await getSitemapXml({ baseUrl: BASE }, counting());

  expect(calls).toBe(1);
  expect(second.cached).toBe(true);
  expect(second.xml).toBe(first.xml);

  // A different origin is a different document.
  const other = await getSitemapXml({ baseUrl: 'http://localhost:3000' }, counting());
  expect(calls).toBe(2);
  expect(other.cached).toBe(false);
  expect(other.xml).toContain('http://localhost:3000/');

  clearSitemapCache();

  let degradedCalls = 0;
  const degraded = () => ({
    ...emptyDeps(),
    listPublicClasses: async () => {
      degradedCalls += 1;
      return { data: null, error: new Error('down') };
    }
  });

  await getSitemapXml({ baseUrl: BASE }, degraded());
  const retry = await getSitemapXml({ baseUrl: BASE }, degraded());

  expect(degradedCalls).toBe(2);
  expect(retry.cached).toBe(false);
  expect(retry.failures).toEqual(['classes']);
});

test('renderSitemap produces one <url> per entry', () => {
  const xml = renderSitemap([
    { loc: 'https://example.test/a', lastmod: '2026-01-01T00:00:00.000Z' },
    { loc: 'https://example.test/b' }
  ]);

  const doc = parse(xml);
  expect(doc.getElementsByTagName('parsererror').length).toBe(0);
  expect(doc.getElementsByTagName('url').length).toBe(2);
  expect(doc.getElementsByTagName('lastmod').length).toBe(1);
});
