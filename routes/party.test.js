// routes/party.test.js
//
// The virtual party tool's membership parsing: what ?c= accepts, how add and
// remove mutate it, and what the cap and RLS-invisible ids do. The view
// rendering is covered by views/partials/party-summary.test.js; these tests
// assert on the route's behaviour, reading ids back out of the rendered
// #party-csv input.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realBase = require('../models/_base');
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realCharacter = require('../models/character');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');

const { statList } = require('../util/enclave-consts');

// Ten real-shaped UUIDs. The route drops anything that is not one, so the
// tests cannot use readable ids like 'a'.
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ID = Array.from({ length: 10 }, (_, i) => uuid(i + 1));

// Every id in ID is visible EXCEPT the one at index 9, which stands in for a
// character RLS will not return (someone else's private character).
const INVISIBLE = ID[9];

const characterRow = (id, overrides = {}) => ({
  id,
  name: `Character ${ID.indexOf(id) + 1}`,
  image_url: null,
  class: 'Tester',
  class_id: uuid(99),
  level: 3,
  is_deceased: false,
  is_public: true,
  ...Object.fromEntries(statList.map(stat => [stat, 1])),
  ...overrides
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

// The model seam is mocked rather than the client, so these tests pin the
// route's behaviour and not PostgREST's. getPartyCharacters returns rows in a
// DELIBERATELY SHUFFLED order (reversed) — .in() makes no ordering promise, so
// the route must reorder, and a mock that returns them already-sorted would
// let that bug through.
// ID[6] stands in for a party member whose owner keeps them private — it is
// otherwise unused across this file's tests.
const PRIVATE_MEMBER = ID[6];

mock.module('../models/character', () => ({
  getPartyCharacters: async (ids) => ({
    data: ids.filter(id => id !== INVISIBLE)
      .map(id => characterRow(id, id === PRIVATE_MEMBER ? { is_public: false } : {}))
      .reverse(),
    error: null
  }),
  getOwnCharacters: async () => ({
    data: [characterRow(ID[7], { name: 'Private Character', is_public: false })],
    error: null
  }),
  // Real search results only when given a query — lets the "renders result
  // rows" and "no query renders empty prompt" tests below tell each other apart.
  searchPublicCharacters: async (q) => ({
    data: q ? [characterRow(ID[0]), characterRow(ID[1])] : [],
    error: null
  }),
}));

// A bearer token routes authOptional down its signed-in branch; without one
// it short-circuits and never consults these.
mock.module('../models/auth', () => ({
  getUserFromToken: async (token) => (token ? { id: 'test-user' } : false)
}));
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: 'test-profile', timezone: 'UTC' })
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
  delete require.cache[require.resolve('./party')];

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

  app.use('/party', require('./party'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/_base', () => realBase);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/character', () => realCharacter);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  delete require.cache[require.resolve('./party')];
});

const get = (url) => fetch(`${baseUrl}${url}`, { headers: { Accept: 'text/html' } });

// The rendered #party-csv hidden input is the route's statement of what the
// party now holds — the same value the Add/Remove buttons hx-include.
const csvFrom = (html) => {
  const match = html.match(/id="party-csv"[^>]*value="([^"]*)"/);
  return match ? match[1] : null;
};

test('a bare /party renders an empty party without error', async () => {
  const res = await get('/party');
  expect(res.status).toBe(200);
  expect(csvFrom(await res.text())).toBe('');
});

test('duplicate ids dedupe, preserving first-seen order', async () => {
  const res = await get(`/party?c=${ID[0]},${ID[1]},${ID[0]}`);
  expect(csvFrom(await res.text())).toBe(`${ID[0]},${ID[1]}`);
});

test('non-UUID junk is dropped without a 500', async () => {
  const res = await get(`/party?c=not-a-uuid,${ID[0]},,%20,<script>`);
  expect(res.status).toBe(200);
  expect(csvFrom(await res.text())).toBe(ID[0]);
});

test('more than eight ids truncates to eight and reports the drop', async () => {
  const res = await get(`/party?c=${ID.slice(0, 9).join(',')}`);
  const html = await res.text();
  expect(csvFrom(html).split(',').length).toBe(8);
  expect(html).toContain('party is capped at 8');
});

test('ids that resolve to nothing are reported, not silently missing', async () => {
  const res = await get(`/party?c=${ID[0]},${INVISIBLE}`);
  const html = await res.text();
  // The invisible id leaves the party — it cannot be rendered — but the count
  // is surfaced so a link recipient knows why the totals look short.
  expect(csvFrom(html)).toBe(ID[0]);
  expect(html).toContain('could not be loaded');
});

test('members are ordered by URL position, not by what the database returned', async () => {
  // The mock reverses its rows on purpose; .in() promises no ordering.
  const res = await get(`/party?c=${ID[0]},${ID[1]},${ID[2]}`);
  const html = await res.text();
  // Read the ids off the rendered members specifically. A plain
  // html.indexOf(id) would pass even with a broken reorder, because
  // #party-csv already lists them in URL order further up the document.
  const rendered = [...html.matchAll(/data-member-id="([^"]+)"/g)].map(match => match[1]);
  expect(rendered).toEqual([ID[0], ID[1], ID[2]]);
});

test('each member row lazy-loads the shared details fragment', async () => {
  const res = await get(`/party?c=${ID[0]}`);
  const html = await res.text();
  // "click once": the fragment loads on first expand only; Alpine's x-show
  // handles every toggle after that. A panel swap re-renders the row
  // collapsed and re-arms the trigger, which is correct — membership
  // changed, the details re-fetch on next expand.
  expect(html).toContain(`hx-get="/characters/${ID[0]}/details"`);
  expect(html).toContain('hx-trigger="click once"');
  expect(html).toContain(`id="member-details-${ID[0]}"`);
  expect(html).toContain('Level 3');
});

test('the panel route adds an id to the party it was given', async () => {
  // The regression guard for the staleness trap: the Add buttons live in the
  // left column, which does not re-render on a panel swap, so they cannot
  // carry membership in their own URL. They send the id and hx-include the
  // current csv; the route combines them. If this returns only ID[1], adding
  // a second character silently discards the first.
  const res = await get(`/party/panel?c=${ID[0]}&add=${ID[1]}`);
  const html = await res.text();
  expect(csvFrom(html)).toBe(`${ID[0]},${ID[1]}`);
});

test('the panel route pushes the new party URL back to the browser', async () => {
  const res = await get(`/party/panel?c=${ID[0]}&add=${ID[1]}`);
  expect(res.headers.get('HX-Push-Url')).toBe(`/party?c=${ID[0]},${ID[1]}`);
});

test('adding an id already in the party is a no-op, not a duplicate', async () => {
  const res = await get(`/party/panel?c=${ID[0]},${ID[1]}&add=${ID[0]}`);
  expect(csvFrom(await res.text())).toBe(`${ID[0]},${ID[1]}`);
});

test('removing an id drops it and keeps the rest in order', async () => {
  const res = await get(`/party/panel?c=${ID[0]},${ID[1]},${ID[2]}&remove=${ID[1]}`);
  expect(csvFrom(await res.text())).toBe(`${ID[0]},${ID[2]}`);
});

test('removing an id that is not in the party leaves membership unchanged', async () => {
  const res = await get(`/party/panel?c=${ID[0]},${ID[1]}&remove=${ID[5]}`);
  expect(csvFrom(await res.text())).toBe(`${ID[0]},${ID[1]}`);
});

test('adding past the cap drops the addition rather than an existing member', async () => {
  const full = ID.slice(0, 8).join(',');
  const res = await get(`/party/panel?c=${full}&add=${ID[8]}`);
  const html = await res.text();
  expect(csvFrom(html)).toBe(full);
  expect(html).toContain('party is capped at 8');
});

test('signed out, the page offers no My Characters section', async () => {
  // getProfile is mocked to null, so res.locals.profile is absent and the
  // page shows the public search only.
  const res = await get('/party');
  expect(await res.text()).not.toContain('My Characters');
});

test('signed in, the page lists your own characters, private ones included', async () => {
  // The pair to the test above: without this one, the negative would pass
  // against a page that has no My Characters section under any condition.
  // getOwnCharacters is RLS-scoped, which is how a private character — one
  // the public search at /party/s can never surface — enters the page.
  const res = await fetch(`${baseUrl}/party`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' }
  });
  const html = await res.text();
  expect(html).toContain('My Characters');
  expect(html).toContain('Private Character');
  expect(html).toContain(`data-add-character="${ID[7]}"`);
});

test('a private member in the party surfaces the sharing-degrades notice', async () => {
  // party-panel.handlebars:26-32's privateCount branch — the other half of
  // the design's "sharing degrades visibly" decision (see the unresolved-id
  // notice above). Without a mocked row that is actually is_public: false,
  // privateCount is always 0 and this branch never renders.
  const res = await get(`/party?c=${ID[0]},${PRIVATE_MEMBER}`);
  const html = await res.text();
  expect(html).toContain('1 member is private');
  expect(html).toContain('will see a 1-member party');
});

// Finding 1 regression coverage: GET /party/s had zero test coverage. A
// repeated ?q makes Express's extended query parser hand the handler an
// array, not a string; the un-fixed handler called q.trim() directly and
// threw synchronously inside a bare async function with no try/catch and no
// asyncHandler wrapper — Express 4 does not catch that, so the request never
// got a response at all. These tests exercise /party/s directly.
test('a repeated q does not hang the request', async () => {
  const res = await get('/party/s?q=a&q=b');
  expect(res.status).toBe(200);
});

test('an object-shaped q does not hang the request', async () => {
  const res = await get('/party/s?q[x]=1');
  expect(res.status).toBe(200);
});

test('no query and no classId renders the empty search prompt', async () => {
  const res = await get('/party/s');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('Type a name to search.');
});

test('a query of 2+ characters renders result rows', async () => {
  const res = await get('/party/s?q=he');
  const html = await res.text();
  expect(html).toContain(`data-add-character="${ID[0]}"`);
});

test('a 1-character query is treated as no query', async () => {
  const res = await get('/party/s?q=h');
  const html = await res.text();
  // Below the >= 2 threshold, searchPublicCharacters is never called — the
  // mock returns rows for any truthy q, so their absence here proves the
  // threshold held rather than a real search coming back empty.
  expect(html).not.toContain('data-add-character');
});
