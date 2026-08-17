// Covers what lives in the route rather than the builder: how the document
// learns its own origin, and what it tells caches. A sitemap whose URLs carry
// the wrong scheme or host is worse than no sitemap -- crawlers reject it.
const { test, expect, mock, beforeAll, afterAll, beforeEach } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realSitemapModel = require('../models/sitemap');

// Only the database layer is stubbed; the real route, service, and builder run.
let missionRows = [];
let missionError = null;

mock.module('../models/sitemap', () => ({
  listPublicCharacters: async () => ({ data: [], error: null }),
  listPublicMissions: async () => (missionError
    ? { data: null, error: missionError }
    : { data: missionRows, error: null }),
  listPublicClasses: async () => ({ data: [], error: null }),
  listPublicPages: async () => ({ data: [], error: null }),
  listPublicProfiles: async () => ({ data: [], error: null })
}));

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');

let server;
let baseUrl;
let clearSitemapCache;
const originalSiteUrl = process.env.SITE_URL;

beforeAll(async () => {
  delete require.cache[require.resolve('../services/sitemap/build')];
  delete require.cache[require.resolve('./sitemap')];
  ({ clearSitemapCache } = require('../services/sitemap/build'));

  const app = express();
  app.use('/', require('./sitemap'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/sitemap', () => realSitemapModel);
  delete require.cache[require.resolve('../services/sitemap/build')];
  delete require.cache[require.resolve('./sitemap')];
  if (originalSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = originalSiteUrl;
});

beforeEach(() => {
  clearSitemapCache();
  delete process.env.SITE_URL;
  missionRows = [{ id: 'mission-1', updated_at: '2026-05-02T00:00:00.000Z' }];
  missionError = null;
});

test('serves an XML sitemap', async () => {
  const res = await fetch(`${baseUrl}/sitemap.xml`);
  const body = await res.text();

  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');
  expect(res.headers.get('cache-control')).toBe('public, max-age=900');
  expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  expect(body).toContain('/missions/mission-1</loc>');
});

test('falls back to the request scheme and host when SITE_URL is unset', async () => {
  const res = await fetch(`${baseUrl}/sitemap.xml`);
  const body = await res.text();

  expect(body).toContain(`<loc>${baseUrl}/</loc>`);
  expect(body).toContain(`<loc>${baseUrl}/missions/mission-1</loc>`);
});

test('SITE_URL wins over the request, and its trailing slash is trimmed', async () => {
  process.env.SITE_URL = 'https://agent-resources.vip/';

  const res = await fetch(`${baseUrl}/sitemap.xml`);
  const body = await res.text();

  expect(body).toContain('<loc>https://agent-resources.vip/</loc>');
  expect(body).toContain('<loc>https://agent-resources.vip/missions/mission-1</loc>');
  expect(body).not.toContain(baseUrl);
});

// The app itself speaks http behind the proxy, so without this every <loc>
// would advertise http:// for an https-only site.
test('honors X-Forwarded-Proto when SITE_URL is unset', async () => {
  const res = await fetch(`${baseUrl}/sitemap.xml`, {
    headers: { 'X-Forwarded-Proto': 'https, http' }
  });
  const body = await res.text();

  expect(body).toContain(`<loc>https://${new URL(baseUrl).host}/</loc>`);
});

test('a degraded document is still served, but marked short-lived', async () => {
  missionError = new Error('missions table unreachable');

  const res = await fetch(`${baseUrl}/sitemap.xml`);
  const body = await res.text();

  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('public, max-age=60');
  // The sections that worked are still in the document...
  expect(body).toContain('<loc>');
  // ...and the failed one contributed nothing.
  expect(body).not.toContain('/missions/');

  // Nothing partial was cached, so recovery is immediate rather than waiting
  // out the 15-minute TTL.
  missionError = null;
  const recovered = await fetch(`${baseUrl}/sitemap.xml`);
  expect(recovered.headers.get('cache-control')).toBe('public, max-age=900');
  expect(await recovered.text()).toContain('/missions/mission-1</loc>');
});
