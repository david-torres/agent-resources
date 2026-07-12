// routes/character-wizard.test.js
//
// RED-phase test for the new wizard submit contract. The wizard client is
// moving to the app's HTMX convention: it POSTs a single form-encoded
// `payload` field holding a JSON string of the character payload, and the
// handler must JSON.parse it, call createCharacter, and on success respond
// like the EXPERT route does (routes/characters.js ~919) — an HX-Location
// header and an EMPTY body, NOT a JSON { redirect } body.
//
// Mocking recipe mirrors routes/character-level-up.test.js and
// routes/badges.test.js: real isAuthenticated middleware + real route handler
// against a mocked data layer.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Capture real modules up front so afterAll can restore them — bun's
// mock.module is process-global and would otherwise leak into other files.
const realBase = require('../models/_base');
const realSupabase = require('../util/supabase');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');
const realOffscreen = require('../models/offscreen-mission');

const CHAR_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = 'p1';

// Minimal no-op PostgREST-shaped fake; the wizard route's success path only
// touches createCharacter (mocked below), so an empty store is enough.
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

mock.module('../util/supabase', () => ({
  // Consumed by the real isAuthenticated middleware:
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
  getProfile: async () => ({ id: PROFILE_ID, user_id: 'u1' }),
  // The route under test:
  createCharacter: async (payload, profile) => ({
    data: { id: CHAR_ID, name: payload.name },
    error: null,
  }),
  // Other named exports the characters route imports at module load — stubbed
  // so the require doesn't fail. None are reached on the wizard success path.
  getOwnCharacters: async () => ({ data: null, error: null }),
  getCharacter: async () => ({ data: null, error: null }),
  updateCharacter: async () => ({ data: null, error: null }),
  deleteCharacter: async () => ({ data: null, error: null }),
  markCharacterDeceased: async () => ({ data: null, error: null }),
  getCharacterRecentMissions: async () => ({ data: null, error: null }),
  searchPublicCharacters: async () => ({ data: null, error: null }),
  getRandomPublicCharacters: async () => ({ data: null, error: null }),
  getMission: async () => ({ data: null, error: null }),
  getClasses: async () => ({ data: null, error: null }),
  getClass: async () => ({ data: null, error: null }),
  getLfgPost: async () => ({ data: null, error: null }),
  getProfileById: async () => ({ data: null, error: null }),
  getCharacterRealMissionsForDerivation: async () => ({ data: null, error: null }),
  createMission: async () => ({ data: null, error: null }),
  addCharacterToMission: async () => ({ data: null, error: null }),
}));

mock.module('../models/offscreen-mission', () => ({
  listOffscreenMissions: async () => ({ data: [], error: null }),
  getAvailableHostedMissionsForPicker: async () => ({ data: [], error: null }),
  createOffscreenMission: async () => ({ data: {}, error: null }),
  getOffscreenMissionById: async () => ({ data: null, error: null }),
  updateOffscreenMission: async () => ({ data: {}, error: null }),
  removeOffscreenMission: async () => ({ error: null }),
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
  delete require.cache[require.resolve('./characters')];
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/characters', require('./characters'));
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

afterAll(() => {
  if (server) server.close();
  mock.module('../models/_base', () => realBase);
  mock.module('../util/supabase', () => realSupabase);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../models/offscreen-mission', () => realOffscreen);
  delete require.cache[require.resolve('./characters')];
});

test('POST /characters/wizard responds with HX-Location and empty body', async () => {
  const payload = {
    name: 'Hero',
    class_id: 'c1',
    level: 1,
    completed_missions: 0,
    appearance: '',
    background: '',
    is_public: true,
    hide_from_search: false,
    creator_mode: 'advent',
    trait0: null,
    trait1: null,
    trait2: null,
  };

  const body = new URLSearchParams({ payload: JSON.stringify(payload) });

  const res = await fetch(`${baseUrl}/characters/wizard`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer valid-jwt',
      'Content-Type': 'application/x-www-form-urlencoded',
      // Force sendError's JSON branch (mirrors badges.test.js) so a current
      // failure surfaces as a status/assertion mismatch rather than a
      // view-engine crash on the old handler's req.body.name 400 path.
      'Accept': 'application/json',
    },
    body,
  });

  expect(res.status).toBe(200);
  expect(res.headers.get('HX-Location')).toBe(`/characters/${CHAR_ID}/Hero`);
  expect(await res.text()).toBe('');
});
