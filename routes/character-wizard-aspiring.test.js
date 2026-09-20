// routes/character-wizard-aspiring.test.js
//
// Route-level coverage for the aspiring submit. `models/character` is mocked
// here, so the pseudo-class mapping itself is not exercised -- that lives in
// normalizeCharacterInput and is covered by services/character/input.test.js.
// What this file proves is that a well-formed aspiring submit reaches
// createCharacter with its pseudo-class and ability tags intact, and that a
// malformed one is refused before any write.
//
// Mocking recipe mirrors routes/character-wizard.test.js: real isAuthenticated
// middleware + real route handler against a mocked data layer.
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

mock.module('../models/auth', () => ({
  // Consumed by the real isAuthenticated middleware:
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
}));
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: PROFILE_ID, user_id: 'u1' }),
}));

let captured = null;
mock.module('../models/character', () => ({
  createCharacter: async (payload) => {
    captured = payload;
    return { data: { id: CHAR_ID, name: payload.name }, error: null };
  },
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
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('./characters')];
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
});

const CLASS_A = '22222222-2222-4222-8222-222222222222';
const CLASS_B = '33333333-3333-4333-8333-333333333333';
const CLASS_C = '44444444-4444-4444-8444-444444444444';

const aspiringPayload = (overrides = {}) => ({
  name: 'Vesper',
  creator_mode: 'aspiring',
  class_id: null,
  pseudo_class: { name: 'Ashwalker', tagline: 'Walks the ash', description: 'A long tale.' },
  gear: [
    { name: 'Knife', class_id: CLASS_A },
    { name: 'Rope', class_id: CLASS_B },
    { name: 'Lamp', class_id: CLASS_C }
  ],
  aspiring_signatures: [
    { class_id: CLASS_A, name: 'Knife' },
    { class_id: CLASS_B, name: 'Rope' },
    { class_id: CLASS_C, name: 'Lamp' }
  ],
  abilities: [
    { name: 'Dodge', class_id: CLASS_A, type: 'core' },
    { name: 'Parry', class_id: CLASS_B, type: 'core' },
    { name: 'Overdrive', class_id: CLASS_C, type: 'advanced' }
  ],
  aspiring_abilities: [
    { class_id: CLASS_A, name: 'Dodge', type: 'core' },
    { class_id: CLASS_B, name: 'Parry', type: 'core' },
    { class_id: CLASS_C, name: 'Overdrive', type: 'advanced' }
  ],
  trait0: null, trait1: null, trait2: null,
  ...overrides
});

const postWizard = (payload) => fetch(`${baseUrl}/characters/wizard`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer valid-jwt',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json'
  },
  body: new URLSearchParams({ payload: JSON.stringify(payload) })
});

// characters.class is TEXT NOT NULL (20240101000000_baseline_schema.sql:46) and
// aspiring sends class_id: null, so before this slice the submit could not
// produce a row at all. Nothing covered the path, which is why it went unnoticed.
test('an aspiring submit reaches createCharacter with its pseudo-class intact', async () => {
  captured = null;
  const res = await postWizard(aspiringPayload());

  expect(res.headers.get('HX-Location')).toBeTruthy();
  expect(await res.text()).toBe('');
  expect(captured.pseudo_class).toEqual({
    name: 'Ashwalker', tagline: 'Walks the ash', description: 'A long tale.'
  });
  expect(captured.class_id).toBeNull();
  expect(captured.creator_mode).toBe('aspiring');
});

// The Perk spend (core 1, advanced 2) is derived from the persisted picks
// rather than stored, so the tags have to survive the route.
test('an aspiring submit carries the core and advanced tags', async () => {
  captured = null;
  await postWizard(aspiringPayload());
  expect(captured.abilities.map(a => a.type).sort()).toEqual(['advanced', 'core', 'core']);
});

// normalizeWizardPayload is the only place a malformed aspiring build is
// stopped -- POST /characters/wizard is otherwise mode-agnostic
// (routes/characters.js:291-326).
test('a malformed aspiring submit is rejected before createCharacter runs', async () => {
  captured = null;
  const res = await postWizard(aspiringPayload({ aspiring_abilities: [] }));

  expect(res.status).toBe(400);
  expect(captured).toBeNull();
});

// The three picks are what makes the character a Class at all (pg. 90); a
// submit that never names them is refused the same way one with too few is.
test('an aspiring submit with no Signature picks is rejected before createCharacter runs', async () => {
  captured = null;
  const res = await postWizard(aspiringPayload({ aspiring_signatures: undefined }));

  expect(res.status).toBe(400);
  expect(captured).toBeNull();
});
