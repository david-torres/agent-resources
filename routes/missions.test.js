// routes/missions.test.js
//
// Regression test for the mission-character IDOR: the add/remove character
// routes must reject callers who cannot edit the mission (canEditMission ===
// false) and must NOT perform the supabaseAdmin-backed mutation in that case.
//
// We run the REAL isAuthenticated middleware against a mocked data layer
// (mirroring util/auth.test.js) rather than stubbing util/auth, so this file
// does not clobber the real util/auth that auth.test.js requires.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

// _base.js throws unless these exist; the real models pulled in transitively
// never make network calls on the paths we exercise.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-key';

// Capture real modules up front so afterAll can restore them — bun's
// mock.module is process-global and would otherwise leak into other files.
const realSupabase = require('../util/supabase');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');

// Mutable test state.
let canEditResult = false;
const calls = { add: 0, remove: 0 };

mock.module('../util/supabase', () => ({
  // Consumed by the real isAuthenticated middleware:
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
  getProfile: async () => ({ id: 'attacker-profile', user_id: 'u1' }),
  // Consumed by the routes under test:
  canEditMission: async () => canEditResult,
  addCharacterToMission: async () => { calls.add++; return { error: null }; },
  removeCharacterFromMission: async () => { calls.remove++; return { error: null }; },
  // Force the post-mutation render path to bail via sendError (JSON), so the
  // authorized-case assertions don't need a Handlebars view engine.
  getCharacter: async () => ({ data: null, error: { message: 'stop before render' } }),
}));
mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next(),
}));

const express = require('express');
let server;
let baseUrl;

beforeAll(() => {
  delete require.cache[require.resolve('./missions')];
  const app = express();
  app.use(express.json());
  app.use('/missions', require('./missions'));
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  mock.module('../util/supabase', () => realSupabase);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  delete require.cache[require.resolve('./missions')];
});

const MISSION = '11111111-1111-1111-1111-111111111111';
const CHARACTER = '22222222-2222-2222-2222-222222222222';
const headers = { Accept: 'application/json', Authorization: 'Bearer valid-jwt' };

test('POST add-character is rejected with 403 and does NOT mutate when caller cannot edit the mission', async () => {
  canEditResult = false;
  calls.add = 0;
  const res = await fetch(`${baseUrl}/missions/${MISSION}/characters/${CHARACTER}`, { method: 'POST', headers });
  expect(res.status).toBe(403);
  expect(calls.add).toBe(0);
});

test('DELETE remove-character is rejected with 403 and does NOT mutate when caller cannot edit the mission', async () => {
  canEditResult = false;
  calls.remove = 0;
  const res = await fetch(`${baseUrl}/missions/${MISSION}/characters/${CHARACTER}`, { method: 'DELETE', headers });
  expect(res.status).toBe(403);
  expect(calls.remove).toBe(0);
});

test('POST add-character proceeds to the mutation when caller CAN edit the mission', async () => {
  canEditResult = true;
  calls.add = 0;
  const res = await fetch(`${baseUrl}/missions/${MISSION}/characters/${CHARACTER}`, { method: 'POST', headers });
  expect(calls.add).toBe(1);
  expect(res.status).not.toBe(403);
});

test('DELETE remove-character proceeds to the mutation when caller CAN edit the mission', async () => {
  canEditResult = true;
  calls.remove = 0;
  const res = await fetch(`${baseUrl}/missions/${MISSION}/characters/${CHARACTER}`, { method: 'DELETE', headers });
  expect(calls.remove).toBe(1);
  expect(res.status).not.toBe(403);
});
