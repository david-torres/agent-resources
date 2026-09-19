// routes/characters-wizard-data.test.js
//
// GET /characters/wizard embeds a JSON island (#wizard-data) the client reads
// instead of keeping its own copy of the Merx economy and stat-cap figures.
// This file pins that payload: it carries the two modules' own
// economyFigures()/statCapFigures() output verbatim, a per-class economy
// resolved server-side with the same economyFor every save path calls, and
// the mission-income figure from util/enclave-consts.js.
//
// Harness mirrors routes/character-wizard-classes.test.js: mocked data layer,
// real Express app with the full Handlebars engine, assertions against the
// wizard-data JSON the view embeds for the client.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realBase = require('../models/_base');
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realClass = require('../models/class');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');
const realOffscreen = require('../models/offscreen-mission');

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

// The pool of classes GET /wizard offers, set per-test via `setClasses`.
let classPool = [];

mock.module('../models/_base', () => ({
  supabase: makeClient(),
  supabaseAdmin: makeClient(),
  createUserClient: () => makeClient(),
  anonKey: 'test-anon-key',
}));

mock.module('../models/auth', () => ({
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
}));
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: 'p1', user_id: 'u1' }),
}));

mock.module('../models/class', () => ({
  ...realClass,
  getClasses: async (filters = {}) => {
    if (filters.is_player_created === true) return { data: [], error: null };
    return { data: classPool, error: null };
  },
  getUnlockedClassIdsForUser: async () => ({
    data: new Set(classPool.map((c) => c.id)),
    error: null,
  }),
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
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');

let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('./characters')];

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

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
  mock.module('../models/class', () => realClass);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../models/offscreen-mission', () => realOffscreen);
  delete require.cache[require.resolve('./characters')];
});

// Renders GET /wizard with the given classes on offer and returns the parsed
// wizard-data JSON island the view embeds for the client.
const renderWizardData = async ({ mode, classes = [] }) => {
  classPool = classes.map((c) => ({
    name: c.id, base_class_id: null, rules_edition: 'advent', rules_version: 'v1',
    is_player_created: false, gear: [], abilities: [], ...c,
  }));
  const res = await fetch(`${baseUrl}/characters/wizard?mode=${mode}`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer valid-jwt' },
  });
  expect(res.status).toBe(200);
  const body = await res.text();
  const match = body.match(/<script type="application\/json" id="wizard-data">([\s\S]*?)<\/script>/);
  expect(match).not.toBeNull();
  return JSON.parse(match[1]);
};

test('wizardData carries the economy figures, not a copy of them', async () => {
  const data = await renderWizardData({ mode: 'advent' });
  expect(data.economy).toEqual(require('../util/merx-economy').economyFigures());
  expect(data.statCaps).toEqual(require('../util/stat-caps').statCapFigures());
});

test('wizardData resolves each class to an economy on the server', async () => {
  const data = await renderWizardData({
    mode: 'advent',
    classes: [
      { id: 'c-advent', content_format: 'advent' },
      { id: 'c-v1', content_format: 'aspirant' }
    ]
  });
  expect(data.economyByClassId).toEqual({ 'c-advent': 'advent', 'c-v1': 'aspirant' });
});

test('aspiring mode is aspiring whatever class is picked', async () => {
  const data = await renderWizardData({
    mode: 'aspiring',
    classes: [{ id: 'c-v1', content_format: 'aspirant' }]
  });
  expect(data.economyByClassId['c-v1']).toBe('aspiring');
  expect(data.economyWhenClassless).toBe('aspiring');
});

test('mission income is served from enclave-consts, not retyped', async () => {
  const data = await renderWizardData({ mode: 'advent' });
  expect(data.merxPerMissionSuccess)
    .toBe(require('../util/enclave-consts').MERX_PER_MISSION_SUCCESS);
});

test('a class-less advent wizard falls back to advent', async () => {
  const data = await renderWizardData({ mode: 'advent', classes: [] });
  expect(data.economyWhenClassless).toBe('advent');
});

test('each served class carries its content_format', async () => {
  const data = await renderWizardData({
    mode: 'aspirant', classes: [{ id: 'c-v1', content_format: 'aspirant' }]
  });
  expect(data.classes[0].content_format).toBe('aspirant');
});
