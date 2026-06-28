// routes/characters.test.js
//
// Tests for GET /characters/ability-perk-group, which renders the per-ability
// perk-group scaffold partial when the create form selects a Class Ability.
//
// The harness mirrors routes/character-wizard.test.js: mock the data layer,
// boot a real Express app with the full Handlebars engine (helpers + partials),
// and hit the live server with fetch.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Capture real modules so afterAll can restore them — bun's mock.module is
// process-global and would otherwise leak into other test files.
const realBase = require('../models/_base');
const realSupabase = require('../util/supabase');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');
const realOffscreen = require('../models/offscreen-mission');

// Minimal no-op PostgREST-shaped fake — the ability-perk-group handler only
// checks query params and calls res.render, so an empty store is sufficient.
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
  // Consumed by the real authOptional middleware:
  getUserFromToken: async () => false,
  getProfile: async () => null,
  // Named exports routes/characters.js destructures at module load — stubbed
  // so the require doesn't throw. None are reached on this endpoint.
  getOwnCharacters: async () => ({ data: null, error: null }),
  getCharacter: async () => ({ data: null, error: null }),
  createCharacter: async () => ({ data: null, error: null }),
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

let server;
let baseUrl;

beforeAll(() => {
  delete require.cache[require.resolve('./characters')];

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Full Handlebars engine — same config as index.js so partials and helpers
  // that the character-perk-group partial relies on are available.
  app.engine('handlebars', exphbs.engine({
    layoutsDir: path.join(__dirname, '..', 'views', 'layouts'),
    partialsDir: path.join(__dirname, '..', 'views', 'partials'),
    defaultLayout: 'main',
    helpers: {
      ...hbsHelpers,
      times,
      range,
      date_tz,
      calendar_link,
      encodeURIComponentH,
      getTotalV1MissionsNeeded,
      getTotalV2MissionsNeeded,
      setVariable,
      dump,
      videoEmbed,
      isSupportedVideoUrl,
      substring,
      concat,
      effectiveRulesVersion,
      wordCount,
      perksForAbility,
      nextPerkPosition,
      json,
      markdown: renderMarkdown,
    },
  }));
  app.set('view engine', 'handlebars');
  app.set('views', path.join(__dirname, '..', 'views'));

  // Minimal res.locals the route middleware and sendError expect.
  app.use((req, res, next) => {
    res.locals.supabaseUrl = process.env.SUPABASE_URL;
    res.locals.supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    next();
  });

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

test('GET /characters/ability-perk-group renders scaffold with ability name and dom key', async () => {
  const res = await fetch(
    `${baseUrl}/characters/ability-perk-group?ability=Quick%20Strike&key=g0`,
    { headers: { Accept: 'text/html' } }
  );

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('data-ability-id="Quick Strike"');
  expect(body).toContain('id="perks-list-g0"');
  expect(body).toContain('Quick Strike</h4>');
});

test('GET /characters/ability-perk-group without ability param returns 400', async () => {
  const res = await fetch(
    `${baseUrl}/characters/ability-perk-group?key=g0`,
    { headers: { Accept: 'application/json' } }
  );

  expect(res.status).toBe(400);
});

test('GET /characters/ability-perk-group without key param falls back domKey to ability name', async () => {
  const res = await fetch(
    `${baseUrl}/characters/ability-perk-group?ability=Strike`,
    { headers: { Accept: 'text/html' } }
  );

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('id="perks-list-Strike"');
  expect(body).toContain('data-ability-id="Strike"');
});
