// routes/character-offscreen.test.js
//
// HTTP regression test for the offscreen-mission POST routes after they were
// rewired to CharacterService's createOffscreenMission/updateOffscreenMission/
// deleteOffscreenMission capabilities via models/character.js. The service
// throws AuthorizationError for a non-owner; the route must be wrapped in
// asyncHandler so that throw reaches Express's error pipeline as a 403
// instead of hanging the request (Express 4 does not catch async throws on
// its own).
//
// Mocking recipe mirrors routes/character-level-up.test.js and
// routes/character-wizard.test.js: real isAuthenticated middleware + real
// route handler against a mocked data layer.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Capture real modules up front so afterAll can restore them — bun's
// mock.module is process-global and would otherwise leak into other files.
const realBase = require('../models/_base');
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');
const realOffscreen = require('../models/offscreen-mission');
const realCharacter = require('../models/character');
const { AuthorizationError } = require('../util/errors');

const CHAR_ID = '11111111-1111-4111-8111-111111111111';

mock.module('../models/_base', () => ({
  supabase: { from: () => { throw new Error('unexpected supabase call in offscreen test'); } },
  supabaseAdmin: { from: () => { throw new Error('unexpected supabaseAdmin call in offscreen test'); } },
  createUserClient: () => ({}),
  anonKey: 'test-anon-key',
}));

mock.module('../models/auth', () => ({
  // Consumed by the real isAuthenticated middleware:
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
}));
mock.module('../models/profile', () => ({
  // Non-'owner' profile id so actorFromLocals yields a stranger actor,
  // exercising the deny path.
  getProfile: async () => ({ id: 'p1', user_id: 'u1' }),
}));

mock.module('../models/character', () => ({
  createCharacterOffscreenMission: async (actor) => {
    if (actor.profileId !== 'owner') throw new AuthorizationError('nope', { reason: 'not_owner' });
    return { data: { characterId: CHAR_ID }, error: null };
  },
  updateCharacterOffscreenMission: async (actor) => {
    if (actor.profileId !== 'owner') throw new AuthorizationError('nope', { reason: 'not_owner' });
    return { data: { characterId: CHAR_ID }, error: null };
  },
  deleteCharacterOffscreenMission: async (actor) => {
    if (actor.profileId !== 'owner') throw new AuthorizationError('nope', { reason: 'not_owner' });
    return { data: { characterId: CHAR_ID }, error: null };
  },
}));

mock.module('../models/offscreen-mission', () => ({
  listOffscreenMissions: async () => ({ data: [], error: null }),
  getAvailableHostedMissionsForPicker: async () => ({ data: [], error: null }),
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
  delete require.cache[require.resolve('./characters')];
  delete require.cache[require.resolve('../models/character')];
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/characters', require('./characters'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/_base', () => realBase);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../models/offscreen-mission', () => realOffscreen);
  mock.module('../models/character', () => realCharacter);
  delete require.cache[require.resolve('./characters')];
  delete require.cache[require.resolve('../models/character')];
});

test('POST /:id/offscreen-missions returns 403 for a non-owner (and does not hang)', async () => {
  const res = await Promise.race([
    fetch(`${baseUrl}/characters/${CHAR_ID}/offscreen-missions`, {
      method: 'POST',
      headers: {
        'authorization': 'Bearer valid-jwt',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'n', summary: 's' }),
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('request hung')), 2000)),
  ]);
  expect(res.status).toBe(403);
});

test('POST /:id/offscreen-missions/:omId returns 403 for a non-owner (and does not hang)', async () => {
  const res = await Promise.race([
    fetch(`${baseUrl}/characters/${CHAR_ID}/offscreen-missions/om1`, {
      method: 'POST',
      headers: {
        'authorization': 'Bearer valid-jwt',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'n', summary: 's' }),
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('request hung')), 2000)),
  ]);
  expect(res.status).toBe(403);
});

test('POST /:id/offscreen-missions/:omId/delete returns 403 for a non-owner (and does not hang)', async () => {
  const res = await Promise.race([
    fetch(`${baseUrl}/characters/${CHAR_ID}/offscreen-missions/om1/delete`, {
      method: 'POST',
      headers: {
        'authorization': 'Bearer valid-jwt',
        'content-type': 'application/json',
      },
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('request hung')), 2000)),
  ]);
  expect(res.status).toBe(403);
});
