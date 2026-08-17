// test/robots-txt.test.js
//
// public/robots.txt is a plain file served by the express.static mount in
// app.js, so there is no route handler to test -- but the file itself is easy
// to get subtly wrong in a way nobody notices until pages quietly drop out of
// (or into) search results. Two things are worth pinning down:
//
//   1. It is actually reachable at /robots.txt. Crawlers only look there;
//      a file that stops being served is indistinguishable from no rules.
//   2. The rules classify paths the way we mean them to. The anchored and
//      wildcard patterns are the fiddly part: "Disallow: /characters$" must
//      keep the gated index out while leaving /characters/:id crawlable, and
//      "Allow: /profile/view/" must win over "Disallow: /profile/".
//
// The matcher below implements the subset of the robots.txt spec our file
// uses -- '*' wildcards, '$' end-anchors, and longest-match-wins between
// Allow and Disallow -- which is what Googlebot and Bingbot both do.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const express = require('express');
const path = require('path');
const { startHttpServer, stopHttpServer } = require('./helpers/http-server');

let server;
let baseUrl;
let body;

beforeAll(async () => {
  const app = express();
  // Mounted exactly as app.js:35 mounts it.
  app.use(express.static(path.join(__dirname, '..', 'public')));
  ({ server, baseUrl } = await startHttpServer(app));

  const res = await fetch(`${baseUrl}/robots.txt`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/plain');
  body = await res.text();
});

afterAll(async () => {
  await stopHttpServer(server);
});

// Rules for the wildcard user-agent, in file order.
const parseRules = (text) => {
  const rules = [];
  let inWildcardGroup = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const [field, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    const name = field.trim().toLowerCase();

    if (name === 'user-agent') {
      inWildcardGroup = value === '*';
    } else if (inWildcardGroup && (name === 'allow' || name === 'disallow')) {
      rules.push({ allow: name === 'allow', pattern: value });
    }
  }

  return rules;
};

const toRegExp = (pattern) => {
  const anchored = pattern.endsWith('$');
  const source = (anchored ? pattern.slice(0, -1) : pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`);
};

// Longest matching pattern wins; Allow wins ties. An empty Disallow value
// means "allow everything" and never matches.
const isAllowed = (rules, url) => {
  let winner = null;

  for (const rule of rules) {
    if (!rule.pattern) continue;
    if (!toRegExp(rule.pattern).test(url)) continue;
    if (!winner
      || rule.pattern.length > winner.pattern.length
      || (rule.pattern.length === winner.pattern.length && rule.allow)) {
      winner = rule;
    }
  }

  return winner ? winner.allow : true;
};

test('serves a wildcard group that does not blanket-block the site', () => {
  const rules = parseRules(body);

  expect(rules.length).toBeGreaterThan(0);
  // "Disallow: /" would deindex everything -- the one catastrophic typo here.
  expect(rules.some(rule => !rule.allow && rule.pattern === '/')).toBe(false);
  expect(isAllowed(rules, '/')).toBe(true);
});

// A Sitemap line is host-global, not part of any user-agent group, and the
// spec requires it to be absolute -- a relative path is silently ignored,
// which looks exactly like having no sitemap at all.
test('points crawlers at an absolute sitemap URL', () => {
  const sitemaps = body
    .split('\n')
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(line => /^sitemap:/i.test(line))
    .map(line => line.slice(line.indexOf(':') + 1).trim());

  expect(sitemaps.length).toBe(1);
  expect(() => new URL(sitemaps[0])).not.toThrow();
  expect(new URL(sitemaps[0]).pathname).toBe('/sitemap.xml');
});

test.each([
  // Public content stays crawlable.
  ['/', true],
  ['/news', true],
  ['/privacy', true],
  ['/terms', true],
  ['/contact', true],
  ['/classes', true],
  ['/classes/abc-123/pyrokinetic', true],
  ['/characters/abc-123/nadia', true],
  ['/missions/abc-123', true],
  ['/lfg/abc-123', true],
  ['/library', true],
  ['/pages/some-slug', true],
  ['/profile/view/nadia', true],
  ['/party', true],

  // Sign-in gated indexes: blocked, without taking their detail pages with
  // them (covered by the crawlable cases above).
  ['/characters', false],
  ['/missions', false],
  ['/lfg', false],
  ['/profile', false],
  ['/classes/my', false],

  // Per-user, admin, and machine endpoints.
  ['/auth/check', false],
  ['/api/agent/me', false],
  ['/link/bot', false],
  ['/profile/edit', false],
  ['/profile/agent-tokens', false],
  ['/lfg/tab/my-posts', false],
  ['/badges/manage', false],
  ['/nav/manage', false],
  ['/pages/manage', false],
  ['/library/unlocks', false],

  // Forms, exports, search endpoints, and HTMX fragments.
  ['/characters/new', false],
  ['/characters/wizard', false],
  ['/characters/abc-123/edit', false],
  ['/characters/abc-123/export', false],
  ['/characters/class-gear', false],
  ['/characters/s', false],
  ['/missions/search', false],
  ['/missions/s', false],
  ['/party/s', false],
  ['/party/panel', false],
  ['/lfg/abc-123/join', false]
])('%s is %s to crawlers', (url, allowed) => {
  expect(isAllowed(parseRules(body), url)).toBe(allowed);
});
