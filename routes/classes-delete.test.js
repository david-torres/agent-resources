// routes/classes-delete.test.js
//
// RED-phase tests for the class delete contract. DELETE /classes/:id currently
// returns a bare 204 — htmx 2 never swaps on 204 and there is no HX-Location,
// so nothing happens client-side even when the deletion succeeds. The intended
// contract mirrors missions (routes/missions.js) and characters
// (routes/characters.js): on success respond with an HX-Location header —
// '/classes/my' when the request's HX-Current-URL pathname is /classes/my,
// otherwise '/classes'.
//
// Mocking recipe mirrors routes/classes-stat-spread.test.js: real
// isAuthenticated middleware + real route handler against a mocked data layer.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Capture real modules up front so afterAll can restore them — bun's
// mock.module is process-global and would otherwise leak into other files.
const realBase = require('../models/_base');
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realClass = require('../models/class');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');

// :id is UUID-validated by registerUuidParams, so the test id must be a real
// UUID or the request 400s before ever reaching the delete handler.
const CLASS_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Minimal no-op PostgREST-shaped fake; the delete success path only touches
// getClass/deleteClass (mocked below), so an empty store is enough.
const makeClient = () => ({
  from() {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      update() { return chain; },
      insert() { return chain; },
      single() { return Promise.resolve({ data: null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      then(onF, onR) { return Promise.resolve({ data: [], error: null }).then(onF, onR); },
    };
    return chain;
  },
});

mock.module('../models/_base', () => ({
  supabase: makeClient(),
  supabaseAdmin: makeClient(),
  createUserClient: () => makeClient(),
  anonKey: 'test-anon-key',
}));

mock.module('../models/auth', () => ({
  // Consumed by the real isAuthenticated middleware:
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
}));
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: 'p1', user_id: 'u1', role: 'user' }),
}));

mock.module('../models/class', () => ({
  // The route under test — the class exists and is owned by the authed profile,
  // and deletion succeeds.
  getClass: async () => ({
    data: { id: CLASS_ID, name: 'Vanguard', created_by: 'p1' },
    error: null,
  }),
  deleteClass: async () => ({ error: null }),
}));

mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next(),
}));

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('./classes')];
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/classes', require('./classes'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/_base', () => realBase);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/class', () => realClass);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  delete require.cache[require.resolve('./classes')];
});

const deleteClassRequest = (extraHeaders = {}) =>
  fetch(`${baseUrl}/classes/${CLASS_ID}`, {
    method: 'DELETE',
    headers: {
      'Authorization': 'Bearer valid-jwt',
      ...extraHeaders,
    },
  });

// /classes/my is the real My PCCs path (routes/classes.js:118, router mounted
// at /classes). An earlier version of this test fed the handler
// http://localhost:3000/my-classes, a path that matches no route: the
// conditional could never fire against a real browser URL, so the test passed
// while every delete in the running app redirected to /classes.
test('DELETE /classes/:id from /classes/my responds with HX-Location /classes/my', async () => {
  const res = await deleteClassRequest({
    'HX-Current-URL': 'http://localhost:3000/classes/my',
  });

  expect(res.ok).toBe(true);
  expect(res.headers.get('HX-Location')).toBe('/classes/my');
});

test('DELETE /classes/:id from the class view responds with HX-Location /classes', async () => {
  const res = await deleteClassRequest({
    'HX-Current-URL': 'http://localhost:3000/classes/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/Vanguard',
  });

  expect(res.ok).toBe(true);
  expect(res.headers.get('HX-Location')).toBe('/classes');
});
