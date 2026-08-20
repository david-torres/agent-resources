// routes/character-wizard-classes.test.js
//
// GET /characters/wizard builds the step-1 class kiosk. A class that has been
// forked to a newer version must appear once — as its latest version — the
// same collapsing /classes does (util/class-list-grouping.js). The exception
// is an explicitly preselected class (?class=<id> from a class page): that row
// stays in the kiosk even when it is an older version, so the link still lands
// on the class the user clicked.
//
// Harness mirrors routes/characters.test.js: mocked data layer, real Express
// app with the full Handlebars engine, assertions against the wizard-data JSON
// the view embeds for the client.
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

// Advent officials: Stalker forked v1 -> v2, Warden only exists at v1.
// Aspirant preview: a Stalker fork into another edition — a separate family.
const STALKER_V1 = {
  id: 'stalker-v1', name: 'Stalker', base_class_id: null,
  rules_edition: 'advent', rules_version: 'v1', is_player_created: false,
  created_at: '2026-01-01T00:00:00Z', gear: [], abilities: []
};
const STALKER_V2 = {
  id: 'stalker-v2', name: 'Stalker', base_class_id: 'stalker-v1',
  rules_edition: 'advent', rules_version: 'v2', is_player_created: false,
  created_at: '2026-02-01T00:00:00Z', gear: [], abilities: []
};
const WARDEN_V1 = {
  id: 'warden-v1', name: 'Warden', base_class_id: null,
  rules_edition: 'advent', rules_version: 'v1', is_player_created: false,
  created_at: '2026-01-01T00:00:00Z', gear: [], abilities: []
};
const STALKER_ASPIRANT = {
  id: 'stalker-aspirant', name: 'Stalker', base_class_id: 'stalker-v1',
  rules_edition: 'aspirant', rules_version: 'v1', is_player_created: false,
  created_at: '2026-03-01T00:00:00Z', gear: [], abilities: []
};

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
    if (filters.rules_edition === 'aspirant') return { data: [STALKER_ASPIRANT], error: null };
    return { data: [STALKER_V1, STALKER_V2, WARDEN_V1], error: null };
  },
  // Everything unlocked, so filterClassDataForUser passes the lists through.
  getUnlockedClassIdsForUser: async () => ({
    data: new Set(['stalker-v1', 'stalker-v2', 'warden-v1', 'stalker-aspirant']),
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

const fetchWizardClasses = async (query = '') => {
  const res = await fetch(`${baseUrl}/characters/wizard${query}`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer valid-jwt' },
  });
  expect(res.status).toBe(200);
  const body = await res.text();
  const match = body.match(/<script type="application\/json" id="wizard-data">([\s\S]*?)<\/script>/);
  expect(match).not.toBeNull();
  return JSON.parse(match[1]).classes;
};

test('the kiosk shows a forked class only at its latest version', async () => {
  const classes = await fetchWizardClasses();
  const ids = classes.map(c => c.id);
  expect(ids).toContain('stalker-v2');
  expect(ids).not.toContain('stalker-v1');
  // Unforked classes and the cross-edition fork are their own families.
  expect(ids).toContain('warden-v1');
  expect(ids).toContain('stalker-aspirant');
});

test('a preselected older version stays in the kiosk', async () => {
  const ids = (await fetchWizardClasses('?class=stalker-v1')).map(c => c.id);
  expect(ids).toContain('stalker-v1');
  expect(ids).toContain('stalker-v2');
  expect(ids).toContain('warden-v1');
});
