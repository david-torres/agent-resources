const {
  listPublicCharacters,
  listPublicMissions,
  listPublicClasses,
  listPublicPages,
  listPublicProfiles
} = require('../../models/sitemap');

// sitemaps.org caps a single sitemap at 50,000 URLs. These per-section caps sum
// to 40,000, which leaves headroom for the static list and for one section to
// grow without silently pushing another out of a valid document. A section that
// hits its cap is logged, never quietly truncated -- if one of these starts
// firing, the fix is a sitemap index with one child document per section, not a
// bigger number here.
const LIMITS = {
  characters: 10000,
  missions: 10000,
  classes: 5000,
  pages: 5000,
  profiles: 10000
};

// Routes that exist regardless of what is in the database. Auth-gated indexes
// (/characters, /missions, /lfg, /profile) are deliberately absent: a crawler
// only ever gets a redirect to /auth/check from them, which is also why
// robots.txt disallows them.
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

// <lastmod> takes a W3C datetime. Anything unparseable is dropped rather than
// emitted malformed: an entry with no lastmod is valid, one with a broken date
// invalidates the document.
const toLastmod = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const segment = (value) => encodeURIComponent(String(value));

// The routes accept /characters/:id and /classes/:id with the name segment
// omitted, so a row with a blank name still gets a working URL.
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

// One sick table should not blank the whole sitemap, so each section is
// isolated the way the homepage isolates its feeds (services/home/sections.js).
// The difference: a degraded sitemap is reported back to the caller in
// `failures` so the route can decline to cache it and retry on the next hit.
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
      // /profile/view/:name is looked up by name, so an unnamed profile has no
      // reachable URL. profiles carries no updated_at, hence no lastmod.
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

// Building the document is five paginated table scans, and crawlers refetch
// /sitemap.xml on their own schedule (sometimes several bots at once), so the
// rendered XML is held briefly in memory. Fifteen minutes is well inside how
// quickly any crawler acts on a lastmod change.
//
// A degraded document (one section's table was unreachable) is still worth
// serving -- the URLs in it are correct -- but it is deliberately not cached,
// or a transient blip freezes an incomplete sitemap in front of crawlers for
// the next quarter hour.
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

// Exported for tests; also the hook to reach for if content writes ever need
// to invalidate the sitemap eagerly.
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
