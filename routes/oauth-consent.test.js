// routes/oauth-consent.test.js
//
// GET /oauth/consent is the page Supabase's OAuth 2.1 server redirects a
// signed-in user to for approving/denying an authorization request. The
// route itself only gatekeeps on isAuthenticated and hands the
// authorization_id to the client-side Alpine component (oauthConsent,
// public/js/alpine-components.js) -- everything that talks to Supabase's
// oauth endpoints happens in the browser and is covered by Task 8's
// Playwright test, not here.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realAuth = require('../models/auth');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');
const realProfile = require('../models/profile');

mock.module('../models/auth', () => ({
  getUserFromToken: async (token) => (token === 'user-jwt' ? { id: 'u1' } : false)
}));
mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next()
}));
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: 'p1', role: 'player' })
}));

let app;
let server;
let baseUrl;
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');

beforeAll(async () => {
  delete require.cache[require.resolve('../app')];
  ({ createApp: app } = require('../app'));
  const built = app();
  ({ server, baseUrl } = await startHttpServer(built));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/auth', () => realAuth);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../models/profile', () => realProfile);
  delete require.cache[require.resolve('../app')];
});

test('a signed-out load is sent through the login check and back', async () => {
  const res = await fetch(`${baseUrl}/oauth/consent?authorization_id=abc123`, { redirect: 'manual' });
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe(`/auth/check?r=${encodeURIComponent('/oauth/consent?authorization_id=abc123')}`);
});

test('a signed-in load renders the consent component for that authorization', async () => {
  const res = await fetch(`${baseUrl}/oauth/consent?authorization_id=abc123`, { headers: { Authorization: 'Bearer user-jwt' } });
  const html = await res.text();
  expect(res.status).toBe(200);
  expect(html).toContain('x-data="oauthConsent(&quot;abc123&quot;)"');
});

test('a missing authorization_id still renders the component, which reports the problem', async () => {
  const res = await fetch(`${baseUrl}/oauth/consent`, { headers: { Authorization: 'Bearer user-jwt' } });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('x-data="oauthConsent(&quot;&quot;)"');
});

test('a repeated authorization_id is treated as missing, not as an array', async () => {
  const res = await fetch(`${baseUrl}/oauth/consent?authorization_id=a&authorization_id=b`, { headers: { Authorization: 'Bearer user-jwt' } });
  expect(await res.text()).toContain('x-data="oauthConsent(&quot;&quot;)"');
});
