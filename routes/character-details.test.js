// Tests for GET /characters/:id/details — the shared, description-gated
// character details fragment lazy-loaded by /party and the LFG post page.
//
// Harness mirrors routes/characters.test.js: mock the data layer, boot a
// real Express app with the full Handlebars engine (helpers + partials),
// hit the live server with fetch.
const { test, expect, mock, beforeAll, afterAll, beforeEach } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Capture real modules so afterAll can restore them — bun's mock.module is
// process-global and would otherwise leak into other test files.
const realBase = require('../models/_base');
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realCharacter = require('../models/character');
const realClass = require('../models/class');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');
const realOffscreen = require('../models/offscreen-mission');

const { statList } = require('../util/enclave-consts');

const CHAR_ID = '11111111-1111-4111-8111-111111111111';

// Mutable per-test state consulted by the module mocks, reset in beforeEach.
const state = {};

const makeCharacter = () => ({
  id: CHAR_ID,
  name: 'Ash',
  class: 'Mage',
  class_id: 'class-a',
  creator_id: 'profile-owner',
  is_public: true,
  ...Object.fromEntries(statList.map(stat => [stat, 2])),
  traits: ['brave'],
  abilities: [{ id: 'ab-1', name: 'Fireball', description: 'SECRET ABILITY TEXT', class_id: 'class-a' }],
  gear: [{ name: 'Staff', description: 'SECRET GEAR TEXT', class_id: 'class-a' }],
  ability_perks: [],
  quirks: [],
  accessories: [],
  common_items: [],
  perks: '',
  additional_gear: '',
});

const makeClient = () => ({
  from() {
    const chain = {
      select() { return chain; }, eq() { return chain; }, order() { return chain; },
      limit() { return chain; }, in() { return chain; },
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

// Route + description gate both consult these; state drives each test.
mock.module('../models/character', () => ({
  getCharacter: async () => state.character
    ? { data: state.character, error: null }
    : { data: null, error: { code: 'PGRST116', message: 'not found' } },
}));
mock.module('../models/class', () => ({
  getClass: async () => ({ data: { id: 'class-a', rules_version: state.rulesVersion }, error: null }),
  getUnlockedClassIdsForUser: async () => ({ data: state.unlockedIds, error: null }),
}));
mock.module('../models/lfg', () => ({
  getPendingJoinRequestCount: async () => ({ count: 0 }),
  getLfgPost: async () => ({ data: state.lfgPost, error: null }),
}));

// A bearer token routes authOptional down its signed-in branch; without one
// it short-circuits and never consults these.
mock.module('../models/auth', () => ({
  getUserFromToken: async (token) => (token ? { id: 'user-1' } : false),
}));
mock.module('../models/profile', () => ({
  getProfile: async () => state.profile,
}));
mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next(),
}));
mock.module('../models/offscreen-mission', () => ({
  listOffscreenMissions: async () => ({ data: [], error: null }),
  getAvailableHostedMissionsForPicker: async () => ({ data: [], error: null }),
  getOffscreenMissionById: async () => ({ data: null, error: null }),
}));

const express = require('express');
const exphbs = require('express-handlebars');
const hbsHelpers = require('handlebars-helpers')();
const range = require('handlebars-helper-range');
const path = require('path');
const {
  times, date_tz, calendar_link, getTotalV1MissionsNeeded, getTotalV2MissionsNeeded,
  setVariable, encodeURIComponentH, dump, videoEmbed, isSupportedVideoUrl,
  substring, concat, effectiveRulesVersion, wordCount, perksForAbility, nextPerkPosition, json
} = require('../util/handlebars');
const { renderMarkdown } = require('../util/markdown');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');

let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('./characters')];
  delete require.cache[require.resolve('../services/character/description-gate')];

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.engine('handlebars', exphbs.engine({
    layoutsDir: path.join(__dirname, '..', 'views', 'layouts'),
    partialsDir: path.join(__dirname, '..', 'views', 'partials'),
    defaultLayout: 'main',
    helpers: {
      ...hbsHelpers, times, range, date_tz, calendar_link, encodeURIComponentH,
      getTotalV1MissionsNeeded, getTotalV2MissionsNeeded, setVariable, dump,
      videoEmbed, isSupportedVideoUrl, substring, concat, effectiveRulesVersion,
      wordCount, perksForAbility, nextPerkPosition, json, markdown: renderMarkdown,
    },
  }));
  app.set('view engine', 'handlebars');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use((req, res, next) => {
    res.locals.supabaseUrl = process.env.SUPABASE_URL;
    res.locals.supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    next();
  });

  app.use('/characters', require('./characters'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/_base', () => realBase);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/character', () => realCharacter);
  mock.module('../models/class', () => realClass);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../models/offscreen-mission', () => realOffscreen);
  delete require.cache[require.resolve('./characters')];
  delete require.cache[require.resolve('../services/character/description-gate')];
});

beforeEach(() => {
  state.character = makeCharacter();
  state.profile = null;
  state.unlockedIds = new Set();
  state.lfgPost = null;
  state.rulesVersion = 'v1';
});

const get = (url, signedIn = false) => fetch(`${baseUrl}${url}`, {
  headers: { Accept: 'text/html', ...(signedIn ? { Authorization: 'Bearer test-token' } : {}) },
});

test('a visible character renders the fragment without the site layout', async () => {
  // No <nav also proves route ordering: if /:id/:name? swallowed this as
  // name="details", the full page would render with the layout.
  const res = await get(`/characters/${CHAR_ID}/details`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('Stats');
  expect(html).toContain('Fireball');
  expect(html).not.toContain('<nav');
});

test('a character RLS will not return is a 404', async () => {
  state.character = null;
  const res = await get(`/characters/${CHAR_ID}/details`);
  expect(res.status).toBe(404);
});

test('signed out, names show and descriptions do not', async () => {
  const res = await get(`/characters/${CHAR_ID}/details`);
  const html = await res.text();
  expect(html).toContain('Fireball');
  expect(html).toContain('Staff');
  expect(html).not.toContain('SECRET ABILITY TEXT');
  expect(html).not.toContain('SECRET GEAR TEXT');
});

test('signed in with the class unlocked, descriptions show in full', async () => {
  state.profile = { id: 'profile-1', user_id: 'user-1' };
  state.unlockedIds = new Set(['class-a']);
  const res = await get(`/characters/${CHAR_ID}/details`, true);
  const html = await res.text();
  expect(html).toContain('SECRET ABILITY TEXT');
  expect(html).toContain('SECRET GEAR TEXT');
});

test('signed in with the class locked, descriptions stay hidden', async () => {
  state.profile = { id: 'profile-1', user_id: 'user-1' };
  const res = await get(`/characters/${CHAR_ID}/details`, true);
  const html = await res.text();
  expect(html).toContain('Fireball');
  expect(html).not.toContain('SECRET ABILITY TEXT');
});

test('?lfg lets the hosting Conduit read an approved applicant in full', async () => {
  state.profile = { id: 'host-1', user_id: 'user-1' };
  state.lfgPost = {
    host_id: 'host-1',
    join_requests: [{ status: 'approved', character: { id: CHAR_ID } }],
  };
  const res = await get(`/characters/${CHAR_ID}/details?lfg=post-1`, true);
  const html = await res.text();
  expect(html).toContain('SECRET ABILITY TEXT');
  expect(html).toContain('SECRET GEAR TEXT');
});
