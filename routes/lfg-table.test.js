// routes/lfg-table.test.js
//
// Opening a game table from an LFG post: who may, where they land, and which
// table affordance each viewer of the post page is offered.
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
const realGameTables = require('../models/game-tables');
const realNavLoader = require('../util/nav-loader');

const { statList } = require('../util/enclave-consts');

const POST_ID = '44444444-4444-4444-4444-444444444444';
const CREATOR = '11111111-1111-1111-1111-111111111111';
const CONDUIT = '22222222-2222-2222-2222-222222222222';
const STRANGER = '33333333-3333-3333-3333-333333333333';
const PLAYER_CHARACTER = '55555555-5555-5555-5555-555555555555';
const TABLE_ID = '66666666-6666-6666-6666-666666666666';

const PLAYED_AT = '2020-05-17T20:00:00.000Z';
const NOT_YET = '2999-05-17T20:00:00.000Z';

let postDate = PLAYED_AT;
let hostId = CONDUIT;
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
  getMissionByLfgPostId: async () => ({ data: null, error: null })
}));
const gameTablesFake = {
  openForPost: async () => ({ data: { id: TABLE_ID } }),
  findTableIdForPost: async () => ({ data: null }),
};
mock.module('../models/game-tables', () => ({ gameTables: gameTablesFake }));
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
const customHelpers = require('../util/handlebars');
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
      ...hbsHelpers, ...customHelpers, range,
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
  mock.module('../models/game-tables', () => realGameTables);
  mock.module('../util/nav-loader', () => realNavLoader);
  delete require.cache[require.resolve('./lfg')];
});

const authed = { Authorization: 'Bearer valid-jwt', Accept: 'text/html' };
const hxAuthed = { Authorization: 'Bearer valid-jwt', 'HX-Request': 'true' };

const viewPost = async (headers) => {
  const res = await fetch(`${baseUrl}/lfg/${POST_ID}`, { headers });
  expect(res.status).toBe(200);
  return res.text();
};

test('the post\'s creator opens its table and is sent there', async () => {
  currentProfileId = CREATOR;
  gameTablesFake.openForPost = async () => ({ data: { id: TABLE_ID } });
  const res = await fetch(`${baseUrl}/lfg/${POST_ID}/table`, { method: 'POST', headers: hxAuthed });
  expect(res.headers.get('HX-Location')).toBe(`/tables/${TABLE_ID}`);
});

test('anyone else gets the service\'s refusal as a toast', async () => {
  currentProfileId = STRANGER;
  gameTablesFake.openForPost = async () => ({ error: { status: 403, code: 'forbidden', title: 'No access', message: 'Only the post\'s creator or Conduit can open its table.' } });
  const res = await fetch(`${baseUrl}/lfg/${POST_ID}/table`, { method: 'POST', headers: hxAuthed });
  expect(res.status).toBe(403);
  expect(res.headers.get('HX-Retarget')).toBe('#alerts');
});

test('a post with a table links to it for every viewer', async () => {
  currentProfileId = STRANGER;
  gameTablesFake.findTableIdForPost = async () => ({ data: TABLE_ID });
  const html = await viewPost({ Accept: 'text/html' });
  expect(html).toContain(`href="/tables/${TABLE_ID}"`);
});

test('without a table, the creator sees Open table and others see the draft link', async () => {
  gameTablesFake.findTableIdForPost = async () => ({ data: null });
  currentProfileId = CREATOR;
  const asCreator = await viewPost(authed);
  expect(asCreator).toContain(`hx-post="/lfg/${POST_ID}/table"`);
  currentProfileId = null;
  const asVisitor = await viewPost({ Accept: 'text/html' });
  expect(asVisitor).not.toContain(`hx-post="/lfg/${POST_ID}/table"`);
  expect(asVisitor).toContain('/tables/new?c=');
});
