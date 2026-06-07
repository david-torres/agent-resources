// routes/badges.test.js
//
// Authorization tests for the badge admin routes: the real isAuthenticated +
// requireAdmin middleware run against mocked data layers (same recipe as
// routes/missions.test.js). Render-path happy cases are exercised manually —
// these tests pin the security gates and the grant/revoke wiring.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-key';

const realSupabase = require('../util/supabase');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');
const realBadge = require('../models/badge');
const realProfile = require('../models/profile');

let profileRole = 'user';
const calls = { grant: [], revoke: [] };
let grantResult = { data: { slug: 'enclave-day-1' }, error: null };
let revokeResult = { data: { slug: 'enclave-day-1' }, error: null };

mock.module('../util/supabase', () => ({
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
  getProfile: async () => ({ id: 'p-admin', user_id: 'u1', role: profileRole })
}));
mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next(),
}));
mock.module('../models/badge', () => ({
  // Error forces the manage route down the sendError JSON path so the test
  // doesn't need a Handlebars view engine.
  getBadgeCatalog: async () => ({ data: null, error: new Error('catalog unavailable') }),
  listProfileBadges: async () => ({ data: [], error: null }),
  grantBadge: async (args) => { calls.grant.push(args); return grantResult; },
  revokeBadge: async (args) => { calls.revoke.push(args); return revokeResult; }
}));
mock.module('../models/profile', () => ({
  getProfileByIdAdmin: async (id) => ({ data: { id, name: 'Someone', user_id: 'u2' }, error: null }),
  searchProfilesAdmin: async () => ({ data: [], error: null })
}));

const express = require('express');
let server;
let baseUrl;

beforeAll(() => {
  delete require.cache[require.resolve('./badges')];
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/badges', require('./badges'));
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  mock.module('../util/supabase', () => realSupabase);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../models/badge', () => realBadge);
  mock.module('../models/profile', () => realProfile);
  delete require.cache[require.resolve('./badges')];
});

const adminHeaders = {
  Accept: 'application/json',
  Authorization: 'Bearer valid-jwt',
  'Content-Type': 'application/json'
};

test('GET /badges/manage redirects unauthenticated users to auth', async () => {
  const res = await fetch(`${baseUrl}/badges/manage`, { redirect: 'manual' });
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toContain('/auth/check');
});

test('GET /badges/manage rejects non-admins with 403', async () => {
  profileRole = 'user';
  const res = await fetch(`${baseUrl}/badges/manage`, { headers: adminHeaders });
  expect(res.status).toBe(403);
});

test('GET /badges/manage admits admins past the gate', async () => {
  profileRole = 'admin';
  const res = await fetch(`${baseUrl}/badges/manage`, { headers: adminHeaders });
  // Mocked catalog error -> sendError, NOT 401/403: the admin got through.
  expect(res.status).not.toBe(401);
  expect(res.status).not.toBe(403);
});

test('POST /badges/grant rejects non-admins and does not call the model', async () => {
  profileRole = 'user';
  calls.grant.length = 0;
  const res = await fetch(`${baseUrl}/badges/grant`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ profile_id: 'p2', badge_slug: 'enclave-day-1' })
  });
  expect(res.status).toBe(403);
  expect(calls.grant.length).toBe(0);
});

test('POST /badges/grant calls grantBadge with the admin as granter and redirects', async () => {
  profileRole = 'admin';
  calls.grant.length = 0;
  grantResult = { data: { slug: 'enclave-day-1' }, error: null };
  const res = await fetch(`${baseUrl}/badges/grant`, {
    method: 'POST',
    headers: adminHeaders,
    redirect: 'manual',
    body: JSON.stringify({ profile_id: 'p2', badge_slug: 'enclave-day-1' })
  });
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('/badges/manage?profile_id=p2');
  expect(calls.grant).toEqual([{ profileId: 'p2', badgeSlug: 'enclave-day-1', grantedById: 'p-admin' }]);
});

test('POST /badges/grant surfaces milestone rejection as 400', async () => {
  profileRole = 'admin';
  grantResult = { data: null, error: new Error('Milestone badges are awarded automatically and cannot be granted or revoked') };
  const res = await fetch(`${baseUrl}/badges/grant`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ profile_id: 'p2', badge_slug: 'newcomer-1' })
  });
  expect(res.status).toBe(400);
});

test('POST /badges/grant requires profile_id and badge_slug', async () => {
  profileRole = 'admin';
  calls.grant.length = 0;
  const res = await fetch(`${baseUrl}/badges/grant`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ profile_id: 'p2' })
  });
  expect(res.status).toBe(400);
  expect(calls.grant.length).toBe(0);
});

test('POST /badges/revoke calls revokeBadge and redirects', async () => {
  profileRole = 'admin';
  calls.revoke.length = 0;
  revokeResult = { data: { slug: 'enclave-day-1' }, error: null };
  const res = await fetch(`${baseUrl}/badges/revoke`, {
    method: 'POST',
    headers: adminHeaders,
    redirect: 'manual',
    body: JSON.stringify({ profile_id: 'p2', badge_slug: 'enclave-day-1' })
  });
  expect(res.status).toBe(302);
  expect(calls.revoke).toEqual([{ profileId: 'p2', badgeSlug: 'enclave-day-1' }]);
});
