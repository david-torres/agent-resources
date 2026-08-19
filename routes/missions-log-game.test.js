// routes/missions-log-game.test.js
//
// "Log this game": GET /missions/new?lfg=<post> opens the mission form as a
// DRAFT pre-filled from a played LFG post, and POST /missions only honours an
// lfg_post_id the caller is actually entitled to link.
//
// The draft half is asserted against the real Handlebars render (helpers and
// partials included, as routes/party.test.js does) because the pre-fill only
// exists as rendered form values -- nothing is written until the user saves.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';
// util/mission-import builds an LLM client at import time; routes/missions
// requires it at the top, so the key must be non-empty even though nothing
// under test calls a model.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';

const realBase = require('../models/_base');
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realMission = require('../models/mission');
const realCharacter = require('../models/character');
const realClass = require('../models/class');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');

const POST_ID = '44444444-4444-4444-4444-444444444444';
const CREATOR = '11111111-1111-1111-1111-111111111111';
const CONDUIT = '22222222-2222-2222-2222-222222222222';
const STRANGER = '33333333-3333-3333-3333-333333333333';
const APPROVED_A = '55555555-5555-5555-5555-555555555555';
const APPROVED_B = '66666666-6666-6666-6666-666666666666';
const PENDING = '77777777-7777-7777-7777-777777777777';
const REJECTED = '88888888-8888-8888-8888-888888888888';
const EXISTING_MISSION = '99999999-9999-9999-9999-999999999999';

// The game happened yesterday relative to nothing in particular -- a date far
// enough in the past that these tests stay green as the clock moves.
const PLAYED_AT = '2020-05-17T20:00:00.000Z';
const NOT_YET = '2999-05-17T20:00:00.000Z';

// Mutable test state, reset per test.
let postDate = PLAYED_AT;
let linkedMission = null;
let createdMissions = [];
let addedCharacters = [];
let currentProfileId = CREATOR;

const character = (id, name) => ({ id, name, class: 'Seeker', level: 3 });

const lfgPost = () => ({
  id: POST_ID,
  title: 'The Sunken Vault',
  description: 'A drowned archive under the city.',
  date: postDate,
  creator_id: CREATOR,
  creator_name: 'Rell',
  // getLfgPost re-derives host_id from the approved conduit join request.
  host_id: CONDUIT,
  host_name: 'Vega',
  host_is_public: true,
  join_requests: [
    { status: 'approved', join_type: 'conduit', profile: { id: CONDUIT, name: 'Vega' }, character: null },
    { status: 'approved', join_type: 'player', profile: { id: 'p-a' }, character: character(APPROVED_A, 'Ash') },
    { status: 'approved', join_type: 'player', profile: { id: 'p-b' }, character: character(APPROVED_B, 'Dex') },
    { status: 'pending', join_type: 'player', profile: { id: 'p-c' }, character: character(PENDING, 'Bly') },
    { status: 'rejected', join_type: 'player', profile: { id: 'p-d' }, character: character(REJECTED, 'Cass') }
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
  getProfile: async () => ({ id: currentProfileId, timezone: 'UTC' }),
  searchProfiles: async () => ({ data: [], error: null })
}));
mock.module('../models/lfg', () => ({
  getPendingJoinRequestCount: async () => ({ count: 0 }),
  getLfgPost: async (id) => (id === POST_ID
    ? { data: lfgPost(), error: null }
    : { data: null, error: { message: 'Not found' } })
}));
mock.module('../models/mission', () => ({
  getMissionByLfgPostId: async () => ({ data: linkedMission, error: null }),
  createMission: async (actor, data) => {
    createdMissions.push(data);
    return { data: [{ id: EXISTING_MISSION }], error: null };
  },
  addCharacterToMission: async (actor, missionId, characterId) => {
    addedCharacters.push(characterId);
    return { error: null };
  }
}));
mock.module('../models/character', () => ({}));
mock.module('../models/class', () => ({ getClasses: async () => ({ data: [], error: null }) }));
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
  delete require.cache[require.resolve('./missions')];

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

  app.use('/missions', require('./missions'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/_base', () => realBase);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/mission', () => realMission);
  mock.module('../models/character', () => realCharacter);
  mock.module('../models/class', () => realClass);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  delete require.cache[require.resolve('./missions')];
});

const reset = (profileId = CREATOR) => {
  postDate = PLAYED_AT;
  linkedMission = null;
  createdMissions = [];
  addedCharacters = [];
  currentProfileId = profileId;
};

const headers = { Authorization: 'Bearer valid-jwt' };
const openDraft = (query = `?lfg=${POST_ID}`) =>
  fetch(`${baseUrl}/missions/new${query}`, { headers, redirect: 'manual' });

// --- the pre-fill -----------------------------------------------------------

test('the draft carries the post title, date, and conduit into the form', async () => {
  reset(CONDUIT);
  const res = await openDraft();
  expect(res.status).toBe(200);
  const html = await res.text();

  expect(html).toContain('value="The Sunken Vault"');
  // The post's date, in the viewer's timezone, in the datetime-local format
  // the input requires -- minutes, not the month the format string used to
  // repeat there.
  expect(html).toContain('value="2020-05-17T20:00"');
  expect(html).toContain(`name="host_id" id="conduitHostId" value="${CONDUIT}"`);
  expect(html).toContain('value="Vega"');
});

test('the draft attaches exactly the approved players, not everyone who asked', async () => {
  reset(CONDUIT);
  const html = await (await openDraft()).text();

  expect(html).toContain(`name="characters[]" value="${APPROVED_A}"`);
  expect(html).toContain(`name="characters[]" value="${APPROVED_B}"`);
  expect(html).not.toContain(PENDING);
  expect(html).not.toContain(REJECTED);
  // ...and names the party so the Conduit can see what is about to be logged.
  expect(html).toContain('Ash');
  expect(html).toContain('Dex');
});

test('the draft records which post it came from', async () => {
  reset(CONDUIT);
  const html = await (await openDraft()).text();
  expect(html).toContain(`name="lfg_post_id" value="${POST_ID}"`);
});

test('opening the draft writes nothing', async () => {
  reset(CONDUIT);
  await openDraft();
  expect(createdMissions).toEqual([]);
  expect(addedCharacters).toEqual([]);
});

test('the plain new-mission form still renders with no post attached', async () => {
  reset(CREATOR);
  const res = await openDraft('');
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).not.toContain('name="lfg_post_id"');
  expect(html).not.toContain('name="characters[]"');
});

// --- the authorization gate -------------------------------------------------

test('the post creator may open the draft', async () => {
  reset(CREATOR);
  expect((await openDraft()).status).toBe(200);
});

test('nobody but the creator or the conduit may open the draft', async () => {
  reset(STRANGER);
  const res = await openDraft();
  expect(res.status).toBe(403);
  expect(createdMissions).toEqual([]);
});

test('a game that has not been played yet has no draft to open', async () => {
  reset(CONDUIT);
  postDate = NOT_YET;
  expect((await openDraft()).status).toBe(403);
});

test('an unknown post is refused rather than drafted from nothing', async () => {
  reset(CREATOR);
  const res = await openDraft('?lfg=00000000-0000-4000-8000-000000000000');
  expect(res.status).toBe(403);
});

test('a post already logged sends the user to its mission instead of a second draft', async () => {
  reset(CONDUIT);
  linkedMission = { id: EXISTING_MISSION, name: 'The Sunken Vault', is_public: true };
  const res = await openDraft();
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe(`/missions/${EXISTING_MISSION}`);
});

// --- saving the draft -------------------------------------------------------

const save = (body) => fetch(`${baseUrl}/missions`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body)
});

test('saving the draft links the mission to the post and attaches the party', async () => {
  reset(CONDUIT);
  const body = new URLSearchParams();
  body.append('name', 'The Sunken Vault');
  body.append('date', '2020-05-17T20:00');
  body.append('outcome', 'success');
  body.append('lfg_post_id', POST_ID);
  body.append('characters[]', APPROVED_A);
  body.append('characters[]', APPROVED_B);

  const res = await fetch(`${baseUrl}/missions`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  expect(res.status).toBe(200);
  expect(createdMissions).toHaveLength(1);
  expect(createdMissions[0].lfg_post_id).toBe(POST_ID);
  expect(addedCharacters).toEqual([APPROVED_A, APPROVED_B]);
});

test('a caller who could not open the draft cannot forge the link, but still gets their log', async () => {
  reset(STRANGER);
  const res = await save({
    name: 'Someone Else\'s Game',
    date: '2020-05-17T20:00',
    outcome: 'success',
    lfg_post_id: POST_ID
  });

  expect(res.status).toBe(200);
  expect(createdMissions).toHaveLength(1);
  expect(createdMissions[0].lfg_post_id).toBe(null);
});

test('a post logged while the draft was open still saves the log, minus the link', async () => {
  // The unique index would reject a second link, and rejecting the insert
  // would take the statement and summary the Conduit just wrote down with it.
  reset(CONDUIT);
  linkedMission = { id: EXISTING_MISSION, name: 'Logged First', is_public: true };
  const res = await save({
    name: 'The Sunken Vault',
    date: '2020-05-17T20:00',
    outcome: 'success',
    lfg_post_id: POST_ID
  });

  expect(res.status).toBe(200);
  expect(createdMissions).toHaveLength(1);
  expect(createdMissions[0].lfg_post_id).toBe(null);
});

test('an ordinary mission save is unaffected by the link check', async () => {
  reset(CREATOR);
  const res = await save({ name: 'Ad-hoc Log', date: '2020-05-17T20:00', outcome: 'pending' });
  expect(res.status).toBe(200);
  expect(createdMissions).toHaveLength(1);
  expect(createdMissions[0].lfg_post_id).toBe(null);
});
