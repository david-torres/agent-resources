// routes/lfg-log-game.test.js
//
// The "Log this game" affordance on an LFG post page: who is offered it, when
// it appears, and what replaces it once the game has been logged. Rendered
// through the real Handlebars engine because the whole feature is a link the
// page either shows or withholds.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realBase = require('../models/_base');
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realMission = require('../models/mission');
const realCharacter = require('../models/character');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');

const { statList } = require('../util/enclave-consts');

const POST_ID = '44444444-4444-4444-4444-444444444444';
const CREATOR = '11111111-1111-1111-1111-111111111111';
const CONDUIT = '22222222-2222-2222-2222-222222222222';
const STRANGER = '33333333-3333-3333-3333-333333333333';
const PLAYER_CHARACTER = '55555555-5555-5555-5555-555555555555';
const MISSION_ID = '99999999-9999-9999-9999-999999999999';

const PLAYED_AT = '2020-05-17T20:00:00.000Z';
const NOT_YET = '2999-05-17T20:00:00.000Z';

let postDate = PLAYED_AT;
let hostId = CONDUIT;
let linkedMission = null;
let currentProfileId = CREATOR;

const stats = Object.fromEntries(statList.map(stat => [stat, 1]));

const lfgPost = () => ({
  id: POST_ID,
  title: 'The Sunken Vault',
  description: 'A drowned archive under the city.',
  date: postDate,
  is_public: true,
  creator_id: CREATOR,
  creator_name: 'Rell',
  creator_is_public: true,
  host_id: hostId,
  host_name: hostId ? 'Vega' : null,
  host_is_public: true,
  join_requests: [
    {
      status: 'approved', join_type: 'player', profile_id: 'p-a',
      profile: { id: 'p-a', name: 'Ari', is_public: true },
      character: { id: PLAYER_CHARACTER, name: 'Ash', class: 'Seeker', level: 3, is_public: true, is_deceased: false, ...stats }
    }
  ]
});

const makeClient = () => ({
  from() {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      in() { return chain; },
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
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'test-user' } : false)
}));
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: currentProfileId, timezone: 'UTC' })
}));
mock.module('../models/lfg', () => ({
  getPendingJoinRequestCount: async () => ({ count: 0 }),
  getLfgPost: async () => ({ data: lfgPost(), error: null })
}));
mock.module('../models/mission', () => ({
  getMissionByLfgPostId: async () => ({ data: linkedMission, error: null })
}));
mock.module('../models/character', () => ({ getOwnCharacters: async () => ({ data: [], error: null }) }));
mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
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
  delete require.cache[require.resolve('./lfg')];

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

  app.use('/lfg', require('./lfg'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/_base', () => realBase);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/mission', () => realMission);
  mock.module('../models/character', () => realCharacter);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  delete require.cache[require.resolve('./lfg')];
});

const reset = (profileId = CREATOR) => {
  postDate = PLAYED_AT;
  hostId = CONDUIT;
  linkedMission = null;
  currentProfileId = profileId;
};

const LOG_ACTION = `/missions/new?lfg=${POST_ID}`;

const viewPost = async (signedIn = true) => {
  const res = await fetch(`${baseUrl}/lfg/${POST_ID}`, {
    headers: signedIn ? { Authorization: 'Bearer valid-jwt' } : {}
  });
  expect(res.status).toBe(200);
  return res.text();
};

test('the approved conduit is offered the action on a game that has been played', async () => {
  reset(CONDUIT);
  const html = await viewPost();
  expect(html).toContain(LOG_ACTION);
  expect(html).toContain('Log this game');
});

test('the post creator is offered the action too', async () => {
  reset(CREATOR);
  expect(await viewPost()).toContain(LOG_ACTION);
});

test('a player who merely joined is not offered the action', async () => {
  reset(STRANGER);
  expect(await viewPost()).not.toContain(LOG_ACTION);
});

test('a signed-out visitor is not offered the action', async () => {
  reset(CREATOR);
  currentProfileId = null;
  expect(await viewPost(false)).not.toContain(LOG_ACTION);
});

test('a game still to be played is not offered for logging', async () => {
  reset(CONDUIT);
  postDate = NOT_YET;
  expect(await viewPost()).not.toContain(LOG_ACTION);
});

test('a post with no conduit yet is still loggable by its creator', async () => {
  reset(CREATOR);
  hostId = null;
  expect(await viewPost()).toContain(LOG_ACTION);
});

test('an already-logged post links to its mission instead of offering the action again', async () => {
  reset(CONDUIT);
  linkedMission = { id: MISSION_ID, name: 'The Sunken Vault', is_public: true };
  const html = await viewPost();
  expect(html).not.toContain(LOG_ACTION);
  expect(html).toContain(`/missions/${MISSION_ID}`);
});

test('the link to an existing log is shown to ordinary viewers as well', async () => {
  reset(STRANGER);
  linkedMission = { id: MISSION_ID, name: 'The Sunken Vault', is_public: true };
  expect(await viewPost()).toContain(`/missions/${MISSION_ID}`);
});
