// routes/tables.test.js
//
// Saved game table pages: rendering for link viewers and managers, and how
// member changes answer. Rules are tested in services/game-tables.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realBase = require('../models/_base');
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realCharacter = require('../models/character');
const realSystemMessage = require('../util/system-message');
const realGameTables = require('../models/game-tables');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');

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

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ID = Array.from({ length: 10 }, (_, i) => uuid(i + 1));
// Stands in for a character RLS will not return; ID[6] is a private member.
const INVISIBLE = ID[9];
const PRIVATE_MEMBER = ID[6];
const characterRow = (id, overrides = {}) => ({ id, name: `Character ${ID.indexOf(id) + 1}`, class: 'Tester', level: 3, is_public: true, might: 1, ...overrides });

let throwOnPartyLoad = false;

// Rows come back reversed: the draft must impose the URL's order itself.
mock.module('../models/character', () => ({
  getOwnCharacters: async () => ({ data: [characterRow(ID[7], { name: 'Private Character', is_public: false })], error: null }),
  searchPublicCharacters: async (q) => ({ data: q ? [characterRow(ID[0])] : [], error: null }),
  getPartyCharacters: async (ids) => {
    if (throwOnPartyLoad) throw new Error('boom');
    return {
      data: ids.filter((id) => id !== INVISIBLE)
        .map((id) => characterRow(id, id === PRIVATE_MEMBER ? { is_public: false } : {}))
        .reverse(),
      error: null,
    };
  },
}));

// Tests replace these methods; the router reaches them through the model seam.
const fake = { trackers: async () => ({ data: new Map() }) };
mock.module('../models/game-tables', () => ({ gameTables: fake }));

// A bearer token routes authOptional down its signed-in branch; without one
// it short-circuits and never consults these.
mock.module('../models/auth', () => ({
  getUserFromToken: async (token) => (token ? { id: 'test-user' } : false)
}));
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: 'test-profile', timezone: 'UTC', role: 'user' })
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
  substring, concat, wordCount, perksForAbility, nextPerkPosition, json, statScaling, statScalingRow
} = require('../util/handlebars');
const { renderMarkdown } = require('../util/markdown');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');

let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('./tables')];

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
      videoEmbed, isSupportedVideoUrl, substring, concat,
      wordCount, perksForAbility, nextPerkPosition, json, statScaling, statScalingRow, markdown: renderMarkdown,
    },
  }));
  app.set('view engine', 'handlebars');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use((req, res, next) => {
    res.locals.supabaseUrl = process.env.SUPABASE_URL;
    res.locals.supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    next();
  });

  const tableRoutes = require('./tables');
  app.get('/party', tableRoutes.partyRedirect);
  app.use('/tables', tableRoutes);
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/_base', () => realBase);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/character', () => realCharacter);
  mock.module('../models/game-tables', () => realGameTables);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  delete require.cache[require.resolve('./tables')];
});

const get = (url) => fetch(`${baseUrl}${url}`, { headers: { Accept: 'text/html' } });

const TABLE_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const view = (overrides = {}) => ({
  table: { id: TABLE_ID, name: 'Friday', creator_id: 'test-profile', conduit_id: 'test-profile', creator: { name: 'Dee' }, conduit: { name: 'Dee' } },
  members: [{ memberId: MEMBER_ID, id: MEMBER_ID, isGuest: true, name: 'Mira', class: 'Thane', is_public: true, canRemove: true, canEdit: true, canViewDetails: false, might: 1 }],
  summary: { totals: {}, gaps: [], strongest: [], weakest: [], breakdown: [], memberCount: 1 },
  capabilities: { signedIn: true, isCreator: true, canManage: true },
  isFull: false,
  ...overrides,
});
const authed = { Authorization: 'Bearer test-token', Accept: 'text/html' };
const hx = { ...authed, 'HX-Request': 'true' };

test('a table is viewable by link while signed out, with no edit controls', async () => {
  const [member] = view().members;
  fake.load = async () => ({ data: view({
    members: [{ ...member, canRemove: false, canEdit: false }],
    capabilities: { signedIn: false, isCreator: false, canManage: false },
  }) });
  const res = await get(`/tables/${TABLE_ID}`);
  const html = await res.text();
  expect(res.status).toBe(200);
  expect(html).toContain('Friday');
  expect(html).toContain('Mira');
  expect(html).not.toContain('data-guest-form');
  expect(html).not.toContain('hx-delete');
});

test('a malformed id and a missing table both render the friendly 404', async () => {
  fake.load = async () => ({ error: { status: 404, code: 'not_found', message: "We couldn't find that, or you don't have access to it." } });
  expect((await get('/tables/not-a-uuid')).status).toBe(404);
  expect((await get(`/tables/${TABLE_ID}`)).status).toBe(404);
});

test('a manager sees the guest form, and an unregistered member is marked as one', async () => {
  fake.load = async () => ({ data: view() });
  const html = await (await fetch(`${baseUrl}/tables/${TABLE_ID}`, { headers: authed })).text();
  expect(html).toContain('data-guest-form');
  expect(html).toContain('Unregistered');
});

test('adding a guest returns the new panel and a fresh guest form out of band', async () => {
  let received;
  fake.addGuest = async (actor, tableId, body) => { received = { actor, tableId, body }; return { data: view() }; };
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}/guests`, {
    method: 'POST', headers: { ...hx, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Mira&might=1',
  });
  const html = await res.text();
  expect(res.status).toBe(200);
  expect(received.tableId).toBe(TABLE_ID);
  expect(received.body.name).toBe('Mira');
  expect(received.actor.profileId).toBe('test-profile');
  expect(html).toContain('id="table-panel"');
  expect(html).toContain('hx-swap-oob');
});

test('a rejected guest shows its reason as a toast', async () => {
  fake.addGuest = async () => ({ error: { status: 400, code: 'invalid', title: 'Invalid submission', message: 'Give the character a name.' } });
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}/guests`, {
    method: 'POST', headers: { ...hx, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=',
  });
  expect(res.status).toBe(400);
  expect(res.headers.get('HX-Retarget')).toBe('#alerts');
  expect(await res.text()).toContain('Give the character a name.');
});

test('seating requires sign-in and passes the viewer\'s own client', async () => {
  let receivedClient;
  fake.seatCharacter = async (actor, tableId, characterId, client) => { receivedClient = client; return { data: view() }; };
  const signedOut = await fetch(`${baseUrl}/tables/${TABLE_ID}/members`, {
    method: 'POST', headers: { 'HX-Request': 'true', 'Content-Type': 'application/x-www-form-urlencoded' }, body: `character_id=${MEMBER_ID}`,
  });
  expect(signedOut.headers.get('HX-Redirect')).toContain('/auth/check');
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}/members`, {
    method: 'POST', headers: { ...hx, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `character_id=${MEMBER_ID}`,
  });
  expect(res.status).toBe(200);
  expect(receivedClient).toBeDefined();
});

test('creating a table sends the browser to it', async () => {
  fake.create = async (actor, input) => ({ data: { id: TABLE_ID } });
  const res = await fetch(`${baseUrl}/tables`, {
    method: 'POST', headers: { ...hx, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Friday&c=',
  });
  expect(res.headers.get('HX-Location')).toBe(`/tables/${TABLE_ID}`);
});

test('deleting a table returns to the list', async () => {
  fake.destroy = async () => ({ data: null });
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}`, { method: 'DELETE', headers: hx });
  expect(res.headers.get('HX-Location')).toBe('/tables');
});

test('the list shows the viewer\'s tables', async () => {
  fake.listFor = async () => ({ data: [{ id: TABLE_ID, name: 'Friday', lfg_post_id: null }] });
  const html = await (await fetch(`${baseUrl}/tables`, { headers: authed })).text();
  expect(html).toContain(`href="/tables/${TABLE_ID}"`);
});

test('signed out, the list page offers a new table and asks the visitor to sign in', async () => {
  let listed = false;
  fake.listFor = async () => { listed = true; return { data: [] }; };
  const res = await get('/tables');
  const html = await res.text();
  expect(res.status).toBe(200);
  expect(html).toContain('href="/tables/new"');
  expect(html).toContain('href="/auth"');
  expect(listed).toBe(false);
});

test('table pages ask search engines not to index them', async () => {
  fake.load = async () => ({ data: view() });
  expect(await (await get(`/tables/${TABLE_ID}`)).text()).toContain('<meta name="robots" content="noindex">');
});

test('a linked table says how many approved players are not seated yet', async () => {
  fake.load = async () => ({ data: view({ unseatedApproved: 2 }) });
  const html = await (await get(`/tables/${TABLE_ID}`)).text();
  expect(html).toContain("2 approved players aren't seated yet");
  expect(html).toContain('seat it themselves');
});

const csvFrom = (html) => {
  const match = html.match(/id="table-csv"[^>]*value="([^"]*)"/);
  return match ? match[1] : null;
};

test('a draft renders signed out, carrying its roster in #table-csv', async () => {
  const res = await get(`/tables/new?c=${ID[0]},${ID[1]},${ID[0]}`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(csvFrom(html)).toBe(`${ID[0]},${ID[1]}`);
  const rendered = [...html.matchAll(/data-member-id="([^"]+)"/g)].map((match) => match[1]);
  expect(rendered).toEqual([ID[0], ID[1]]);
});

test('the panel adds to the roster it was given and pushes the draft URL', async () => {
  const res = await get(`/tables/new/panel?c=${ID[0]}&add=${ID[1]}`);
  expect(csvFrom(await res.text())).toBe(`${ID[0]},${ID[1]}`);
  expect(res.headers.get('HX-Push-Url')).toBe(`/tables/new?c=${ID[0]},${ID[1]}`);
});

test('the panel removes one member and keeps the rest in order', async () => {
  const res = await get(`/tables/new/panel?c=${ID[0]},${ID[1]},${ID[2]}&remove=${ID[1]}`);
  expect(csvFrom(await res.text())).toBe(`${ID[0]},${ID[2]}`);
});

test('adding past the cap drops the addition and says so', async () => {
  const full = ID.slice(0, 8).join(',');
  const html = await (await get(`/tables/new/panel?c=${full}&add=${ID[8]}`)).text();
  expect(csvFrom(html)).toBe(full);
  expect(html).toContain('A table seats at most 8');
});

test('unresolved and private members surface their notices', async () => {
  const unresolved = await (await get(`/tables/new?c=${ID[0]},${INVISIBLE}`)).text();
  expect(csvFrom(unresolved)).toBe(ID[0]);
  expect(unresolved).toContain('could not be loaded');
  const priv = await (await get(`/tables/new?c=${ID[0]},${PRIVATE_MEMBER}`)).text();
  expect(priv).toContain('1 member is private');
});

test('a repeated or object-shaped q does not hang the search', async () => {
  expect((await get('/tables/s?q=a&q=b')).status).toBe(200);
  expect((await get('/tables/s?q[x]=1')).status).toBe(200);
});

test('a handler that throws answers instead of hanging', async () => {
  throwOnPartyLoad = true;
  try {
    expect((await get(`/tables/new?c=${ID[0]}`)).status).toBe(500);
  } finally {
    throwOnPartyLoad = false;
  }
});

test('/party sends old links to the draft, keeping the roster', async () => {
  const res = await fetch(`${baseUrl}/party?c=${uuid(1)},${uuid(2)}`, { redirect: 'manual' });
  expect(res.status).toBe(301);
  expect(res.headers.get('Location')).toBe(`/tables/new?c=${encodeURIComponent(`${uuid(1)},${uuid(2)}`)}`);
});

test('a signed-in draft offers to save, posting its roster', async () => {
  const html = await (await fetch(`${baseUrl}/tables/new?c=${uuid(1)}`, { headers: authed })).text();
  expect(html).toContain('hx-post="/tables"');
  expect(html).toContain('hx-include="#table-csv"');
});

test('a signed-out draft asks the visitor to sign in to save', async () => {
  const html = await (await get(`/tables/new?c=${uuid(1)}`)).text();
  expect(html).not.toContain('hx-post="/tables"');
  expect(html).toContain('Sign in');
});

test('a signed-in draft lists your own characters, private included', async () => {
  // getOwnCharacters is RLS-scoped, which is how a private character -- one
  // the public search can never surface -- reaches the page.
  const html = await (await fetch(`${baseUrl}/tables/new`, { headers: authed })).text();
  expect(html).toContain('Private Character');
  expect(html).toContain(`data-add-character="${ID[7]}"`);
});

const TRACKER = {
  version: 5, canTrack: true, isConduit: false, actionUrl: `/tables/${TABLE_ID}/members/${MEMBER_ID}/actions`,
  pools: [{ name: 'essence', label: 'Essence', threshold: 1, thresholdLabel: 'Yellow', spent: 2, budget: 6, approximate: false,
    segments: [true, true, false, false, false, false], thresholdOptions: [], actionUrl: `/tables/${TABLE_ID}/members/${MEMBER_ID}/actions`, canTrack: true }],
  sources: [],
};

test('an action renders the new tracker and announces it for the undo toast', async () => {
  let received;
  fake.act = async (actor, tableId, memberId, action, client) => {
    received = { actor, tableId, memberId, action, client };
    return { data: { tracker: TRACKER, member: { memberId: MEMBER_ID }, tableId, acted: { message: 'Mira spent Low Essence.', undoable: true, version: 5 } } };
  };
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}/members/${MEMBER_ID}/actions`, {
    method: 'POST', headers: { ...hx, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'type=spend&pool=essence&amount=Low',
  });
  expect(res.status).toBe(200);
  expect(received.action).toMatchObject({ type: 'spend', pool: 'essence', amount: 'Low' });
  expect(received.client).toBeDefined();
  expect(await res.text()).toContain(`id="tracker-${MEMBER_ID}"`);
  const trigger = JSON.parse(res.headers.get('HX-Trigger'));
  expect(trigger.trackerActed).toMatchObject({ memberId: MEMBER_ID, version: 5, undoable: true });
});

test('the toast header survives a curly apostrophe', async () => {
  fake.act = async (actor, tableId) => ({ data: { tracker: TRACKER, member: { memberId: MEMBER_ID }, tableId, acted: { message: 'Mira used Harrow\u2019s Mark.', undoable: true, version: 5 } } });
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}/members/${MEMBER_ID}/actions`, {
    method: 'POST', headers: { ...hx, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'type=use&source=mechanic%3Apitch',
  });
  expect(res.status).toBe(200);
  expect(JSON.parse(res.headers.get('HX-Trigger')).trackerActed.message).toBe('Mira used Harrow\u2019s Mark.');
});

test('a refused action is a toast', async () => {
  fake.act = async () => ({ error: { status: 409, code: 'conflict', title: 'Changed elsewhere', message: 'Changed by Ash since \u2014 undo unavailable.' } });
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}/members/${MEMBER_ID}/actions`, {
    method: 'POST', headers: { ...hx, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'type=undo&version=2',
  });
  expect(res.status).toBe(409);
  expect(res.headers.get('HX-Retarget')).toBe('#alerts');
});

test('polling an unchanged tracker is a 204; a changed one renders', async () => {
  const received = [];
  fake.tracker = async (actor, tableId, memberId, { sinceVersion } = {}) => {
    received.push(sinceVersion);
    if (sinceVersion === 5) return { data: { unchanged: true, version: 5 } };
    return { data: { tracker: TRACKER, member: { memberId: MEMBER_ID }, tableId: TABLE_ID } };
  };
  expect((await get(`/tables/${TABLE_ID}/members/${MEMBER_ID}/tracker?v=5`)).status).toBe(204);
  const res = await get(`/tables/${TABLE_ID}/members/${MEMBER_ID}/tracker?v=4`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('data-version="5"');
  expect(received).toEqual([5, 4]);
});

test('polling a removed member is a 404', async () => {
  fake.tracker = async () => ({ error: { status: 404, code: 'not_found', message: "We couldn't find that, or you don't have access to it." } });
  expect((await get(`/tables/${TABLE_ID}/members/${MEMBER_ID}/tracker?v=1`)).status).toBe(404);
});

test('an htmx poll of a removed member answers an empty 200 so the swap removes the tracker', async () => {
  fake.tracker = async () => ({ error: { status: 404, code: 'not_found', message: 'gone' } });
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}/members/${MEMBER_ID}/tracker?v=1`, { headers: hx });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe('');
});

const RICH = {
  ...TRACKER,
  pools: [{ ...TRACKER.pools[0], spendAmounts: ['Low', 'Mid'], restoreAmounts: ['Low'], thresholdOptions: [{ value: 0, label: 'Green', selected: false }, { value: 1, label: 'Yellow', selected: true }] }],
  sources: [{
    key: 'ability:abc', name: 'Fire Bolt', kind: 'Ability', actionUrl: TRACKER.actionUrl, needsLevel: true, levels: ['Low', 'High'],
    printed: [{ label: 'Cost', value: 'Low–High' }], imposed: [{ kind: 'Essence Cost', rating: 'Mid', index: 0 }],
  }],
};
const renderRich = async (flags) => {
  fake.load = async () => ({ data: view() });
  fake.trackers = async () => ({ data: new Map([[MEMBER_ID, {
    ...RICH, ...flags, pools: RICH.pools.map((p) => ({ ...p, canTrack: flags.canTrack })), sources: RICH.sources.map((s) => ({ ...s, ...flags })),
  }]]) });
  return (await get(`/tables/${TABLE_ID}`)).text();
};

test('a viewer who cannot track sees the tracker with no controls', async () => {
  const html = await renderRich({ canTrack: false, isConduit: false });
  expect(html).toContain('Fire Bolt');
  expect(html).toContain('Cost: Low–High');
  expect(html).toContain('Essence Cost: Mid');
  expect(html).not.toContain('Spend Low Essence');
  expect(html).not.toContain('Use (Low)');
  expect(html).not.toContain('Limiter kind');
  expect(html).not.toContain('Lift this Limiter');
});

test('a Conduit sees spend, per-level Use, Impose and Lift controls', async () => {
  const html = await renderRich({ canTrack: true, isConduit: true });
  expect(html).toContain('Spend Low Essence');
  expect(html).toContain('Restore Low Essence');
  expect(html).toContain('Use (Low)');
  expect(html).toContain('Use (High)');
  expect(html).toContain('Limiter kind');
  expect(html).toContain('Lift this Limiter');
});

test('starting a new session refreshes the page', async () => {
  fake.newSession = async () => ({ data: null });
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}/session`, { method: 'POST', headers: hx });
  expect(res.headers.get('HX-Refresh')).toBe('true');
});

test('the table page renders each member\'s tracker', async () => {
  fake.load = async () => ({ data: view() });
  fake.trackers = async () => ({ data: new Map([[MEMBER_ID, TRACKER]]) });
  const html = await (await get(`/tables/${TABLE_ID}`)).text();
  expect(html).toContain(`id="tracker-${MEMBER_ID}"`);
  expect(html).toContain('Yellow');
});
