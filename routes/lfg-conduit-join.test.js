// routes/lfg-conduit-join.test.js
//
// The join funnel on a post whose Conduit slot is already filled: what the join
// form offers, and what a volunteer reads when the server turns them down.
// Rendered through the real Handlebars engine because both halves of this are
// what the page actually says.
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

const POST_ID = '44444444-4444-4444-4444-444444444444';
const CREATOR = '11111111-1111-1111-1111-111111111111';
const CONDUIT = '22222222-2222-2222-2222-222222222222';
const VOLUNTEER = '33333333-3333-3333-3333-333333333333';

const CONDUIT_TAKEN = { status: 409, code: 'conduit_taken', message: 'Conduit slot is already filled' };

let hostId = CONDUIT;
let joinError = CONDUIT_TAKEN;

// What a signed-in non-owner receives: the post row names the conduit, but the
// approved conduit's join request is invisible to them under RLS.
const lfgPost = () => ({
  id: POST_ID,
  title: 'The Sunken Vault',
  description: 'A drowned archive under the city.',
  date: '2999-05-17T20:00:00.000Z',
  is_public: true,
  creator_id: CREATOR,
  creator_name: 'Rell',
  creator_is_public: true,
  host_id: hostId,
  host_name: hostId ? 'Vega' : null,
  host_is_public: true,
  has_conduit: Boolean(hostId),
  join_requests: []
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
  getProfile: async () => ({ id: VOLUNTEER, timezone: 'UTC' })
}));
mock.module('../models/lfg', () => ({
  getPendingJoinRequestCount: async () => ({ count: 0 }),
  getLfgPost: async () => ({ data: lfgPost(), error: null }),
  joinLfgPost: async () => ({ data: null, error: joinError })
}));
mock.module('../models/mission', () => ({
  getMissionByLfgPostId: async () => ({ data: null, error: null })
}));
mock.module('../models/character', () => ({
  getOwnCharacters: async () => ({ data: [{ id: 'char-1', name: 'Ash', is_deceased: false }], error: null })
}));
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

const joinForm = async () => {
  const res = await fetch(`${baseUrl}/lfg/${POST_ID}/join`, {
    headers: { Authorization: 'Bearer valid-jwt' }
  });
  expect(res.status).toBe(200);
  return res.text();
};

const postJoin = async (joinType) => fetch(`${baseUrl}/lfg/${POST_ID}/join`, {
  method: 'POST',
  headers: {
    Authorization: 'Bearer valid-jwt',
    'Content-Type': 'application/x-www-form-urlencoded',
    'HX-Request': 'true'
  },
  body: new URLSearchParams({ joinType })
});

test('the join form withholds the Conduit slot on a post that already has one', async () => {
  hostId = CONDUIT;
  const html = await joinForm();
  // Positive precondition: the radio exists at all, so "disabled" is a state we
  // measured rather than an element we failed to find.
  expect(html).toContain('value="conduit"');
  expect(html).toMatch(/value="conduit"[^>]*disabled/);
  expect(html).toContain('(Already assigned)');
});

test('the join form still offers the Conduit slot when the post has none', async () => {
  hostId = null;
  const html = await joinForm();
  expect(html).toContain('value="conduit"');
  expect(html).not.toMatch(/value="conduit"[^>]*disabled/);
});

test('volunteering as Conduit on a filled post answers 409 and says why', async () => {
  hostId = CONDUIT;
  joinError = CONDUIT_TAKEN;
  const res = await postJoin('conduit');
  expect(res.status).toBe(409);
  const html = await res.text();
  expect(html).toContain('This game already has a Conduit.');
  expect(html).not.toContain('Join failed');
});

test('an unclassified join failure still reads as a generic join failure', async () => {
  hostId = CONDUIT;
  joinError = 'Character is required for player join';
  const res = await postJoin('player');
  expect(res.status).toBe(500);
  expect(await res.text()).toContain('Join failed');
  joinError = CONDUIT_TAKEN;
});
