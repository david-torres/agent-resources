const {
  listPublicCharacters,
  listPublicMissions,
  listPublicClasses,
  listPublicPages,
  listPublicProfiles
} = require('../../models/sitemap');

// sitemaps.org caps a single sitemap at 50,000 URLs; these sum to 40,000. If a
// section starts logging that it hit its cap, the fix is a sitemap index with a
// child document per section, not a bigger number here.
const LIMITS = {
  characters: 10000,
  missions: 10000,
  classes: 5000,
  pages: 5000,
  profiles: 10000
};

// Auth-gated indexes (/characters, /missions, /lfg, /profile) are absent on
// purpose: a crawler only gets a redirect to /auth/check from them.
const STATIC_PATHS = [
  '/',
  '/news',
  '/classes',
  '/library',
  '/party',
  '/privacy',
  '/terms',
  '/contact'
];

const defaultDeps = {
  listPublicCharacters,
  listPublicMissions,
  listPublicClasses,
  listPublicPages,
  listPublicProfiles
};

const escapeXml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

// An entry with no lastmod is valid; one with a malformed date invalidates the
// whole document, so anything unparseable is dropped.
const toLastmod = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const segment = (value) => encodeURIComponent(String(value));

// The name segment is optional in the routes, so a blank name still works.
const named = (prefix, id, name) => (name && String(name).trim()
  ? `${prefix}/${segment(id)}/${segment(name)}`
  : `${prefix}/${segment(id)}`);

const renderSitemap = (entries) => {
  const urls = entries.map(({ loc, lastmod }) => (lastmod
    ? `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${escapeXml(lastmod)}</lastmod>\n  </url>`
    : `  <url>\n    <loc>${escapeXml(loc)}</loc>\n  </url>`));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    ''
  ].join('\n');
};

// Sections are isolated like the homepage feeds (services/home/sections.js), so
// one sick table cannot blank the sitemap. Failures are reported back so the
// caller can decline to cache a degraded document.
const collect = async (label, run, toEntries, failures) => {
  try {
    const { data, error } = await run();
    if (error) {
      console.error(`sitemap section "${label}" failed:`, error);
      failures.push(label);
      return [];
    }
    const rows = data || [];
    if (rows.length >= LIMITS[label]) {
      console.warn(`sitemap section "${label}" hit its ${LIMITS[label]}-URL cap; some URLs are omitted`);
    }
    return toEntries(rows);
  } catch (err) {
    console.error(`sitemap section "${label}" threw:`, err);
    failures.push(label);
    return [];
  }
};

const buildSitemap = async ({ baseUrl }, deps = defaultDeps) => {
  const root = String(baseUrl).replace(/\/+$/, '');
  const url = (path) => `${root}${path}`;
  const failures = [];

  const [characters, missions, classes, pages, profiles] = await Promise.all([
    collect('characters', () => deps.listPublicCharacters({ limit: LIMITS.characters }),
      rows => rows.map(row => ({
        loc: url(named('/characters', row.id, row.name)),
        lastmod: toLastmod(row.updated_at)
      })), failures),
    collect('missions', () => deps.listPublicMissions({ limit: LIMITS.missions }),
      rows => rows.map(row => ({
        loc: url(`/missions/${segment(row.id)}`),
        lastmod: toLastmod(row.updated_at)
      })), failures),
    collect('classes', () => deps.listPublicClasses({ limit: LIMITS.classes }),
      rows => rows.map(row => ({
        loc: url(named('/classes', row.id, row.name)),
        lastmod: toLastmod(row.updated_at)
      })), failures),
    collect('pages', () => deps.listPublicPages({ limit: LIMITS.pages }),
      rows => rows.filter(row => row.slug).map(row => ({
        loc: url(`/pages/${segment(row.slug)}`),
        lastmod: toLastmod(row.updated_at)
      })), failures),
    collect('profiles', () => deps.listPublicProfiles({ limit: LIMITS.profiles }),
      // Looked up by name, so an unnamed profile has no reachable URL.
      // profiles carries no updated_at, hence no lastmod.
      rows => rows.filter(row => row.name).map(row => ({
        loc: url(`/profile/view/${segment(row.name)}`)
      })), failures)
  ]);

  const entries = [
    ...STATIC_PATHS.map(path => ({ loc: url(path) })),
    ...pages,
    ...classes,
    ...characters,
    ...missions,
    ...profiles
  ];

  return { xml: renderSitemap(entries), entries, failures };
};

// The document costs five paginated table scans and crawlers refetch it on
// their own schedule, so it is held briefly in memory. A degraded document is
// not cached -- a transient blip should not freeze an incomplete sitemap in
// front of crawlers for a quarter hour.
const CACHE_TTL_MS = 15 * 60 * 1000;

let cache = null;

const getSitemapXml = async ({ baseUrl }, deps = defaultDeps) => {
  const now = Date.now();
  if (cache && cache.baseUrl === baseUrl && cache.expiresAt > now) {
    return { xml: cache.xml, failures: [], cached: true };
  }

  const { xml, failures } = await buildSitemap({ baseUrl }, deps);
  cache = failures.length === 0 ? { baseUrl, xml, expiresAt: now + CACHE_TTL_MS } : null;

  return { xml, failures, cached: false };
};

// Exported for tests, and for eager invalidation if content writes ever need it.
const clearSitemapCache = () => { cache = null; };

module.exports = {
  buildSitemap,
  getSitemapXml,
  clearSitemapCache,
  renderSitemap,
  escapeXml,
  toLastmod,
  CACHE_TTL_MS,
  LIMITS,
  STATIC_PATHS
};
