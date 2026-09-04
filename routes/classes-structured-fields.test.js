// routes/classes-structured-fields.test.js
//
// The admin class form submits the thirteen class-level structured columns the
// pre-release import populates. Both write handlers must pass every scalar
// through untouched, split the `examples` textarea into a JSON array, and send
// a blank constrained select to the database as NULL -- classes_challenge_level_check
// and classes_prerelease_section_check both reject the empty string.
//
// Mocking recipe mirrors routes/classes-stat-spread.test.js: real
// isAuthenticated middleware + real route handler against a mocked data layer.
const { test, expect, mock, beforeAll, beforeEach, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Capture real modules up front so afterAll can restore them -- bun's
// mock.module is process-global and would otherwise leak into other files.
const realBase = require('../models/_base');
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realClass = require('../models/class');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');

// Payloads the mocked data layer received. Reset before every test.
let capturedCreate = null;
let capturedUpdate = null;

const EXISTING_CLASS_ID = '11111111-2222-4333-8444-555555555555';

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

mock.module('../models/auth', () => ({
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
}));
let profileRole = 'admin';
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: 'p1', user_id: 'u1', role: profileRole }),
}));

mock.module('../models/class', () => ({
  createClass: async (actor, payload) => {
    capturedCreate = payload;
    return { data: { id: 'new-class-id', name: payload.name }, error: null };
  },
  updateClass: async (actor, id, payload) => {
    capturedUpdate = payload;
    return { data: { id, name: payload.name }, error: null };
  },
  getClass: async (id) => ({ data: { id, name: 'Vanguard', created_by: 'p1' }, error: null }),
}));

mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next(),
}));

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

// Shared request helpers. Tasks 15-17 append tests to this file and call these:
// form-urlencode a flat object (bracket-notation keys such as
// `abilities[0][name]` are passed through verbatim as keys) and submit it as an
// authenticated admin.
const encodeBody = (bodyObject) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(bodyObject || {})) {
    params.append(key, value === undefined || value === null ? '' : String(value));
  }
  return params;
};

const send = (method, path, bodyObject) => fetch(`${baseUrl}${path}`, {
  method,
  headers: {
    'Authorization': 'Bearer valid-jwt',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
  },
  body: encodeBody(bodyObject),
});

const post = (path, bodyObject) => send('POST', path, bodyObject);
const put = (path, bodyObject) => send('PUT', path, bodyObject);

beforeAll(async () => {
  delete require.cache[require.resolve('./classes')];
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/classes', require('./classes'));
  ({ server, baseUrl } = await startHttpServer(app));
});

beforeEach(() => {
  capturedCreate = null;
  capturedUpdate = null;
  profileRole = 'admin';
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
  delete require.cache[require.resolve('./classes')];
});

// Interior double spaces, an en dash and curly quotes are content, not
// formatting: the assertions below compare against these exact strings so any
// normalization on the write path fails the test.
const structuredFields = {
  challenge_level: 'Mid',
  stat_line: 'Might 2  ·  Resilience 1',
  stat_note: 'Spend the third point where the table needs it.',
  quote: '“Hold the line — and mean it.”',
  quote_source: 'Sgt. Aldo Vance',
  overview: 'A frontline anchor who trades reach for footing.\n\nThey break a charge  so the rest of the squad never has to.',
  conduit_notes: 'Conduits should telegraph the shield wall a round early.',
  grounding: 'Grounded in the long siege of the Ninth Gate — mud, not glory.',
  examples_heading: 'Example Vanguards',
  tips_heading: 'Playing a Vanguard',
  designer: 'D. Torres',
  prerelease_section: 'pcc',
};

// Browsers submit textarea newlines as CRLF, and admins leave stray indentation
// and blank lines behind. Ends-only trimming per line, blank lines dropped.
//
// The first line carries an interior double space, an en dash (U+2013) and a
// curly apostrophe (U+2019) on purpose: parseExamples must change nothing about
// a line but its ends, so a collapse or a punctuation rewrite has to fail here.
const examplesTextarea = '  Watch-captain  of a wall town \u2013 she\u2019s held it twice  \r\n\r\nBodyguard turned drill sergeant\r\n   \r\nRetired duelist  ';
const expectedExamples = [
  'Watch-captain  of a wall town \u2013 she\u2019s held it twice',
  'Bodyguard turned drill sergeant',
  'Retired duelist',
];

const baseBody = {
  name: 'Vanguard',
  status: 'alpha',
  is_public: 'on',
  is_player_created: 'false',
};

test('POST /classes forwards every structured scalar and parses examples into an array', async () => {
  const res = await post('/classes', {
    ...baseBody,
    ...structuredFields,
    examples: examplesTextarea,
  });

  expect(res.status).toBe(200);
  expect(capturedCreate).not.toBeNull();
  for (const [field, value] of Object.entries(structuredFields)) {
    expect(capturedCreate[field]).toBe(value);
  }
  expect(capturedCreate.examples).toEqual(expectedExamples);
});

test('POST /classes sends blank challenge_level and prerelease_section as NULL', async () => {
  const res = await post('/classes', {
    ...baseBody,
    challenge_level: '',
    prerelease_section: '',
    overview: 'No challenge level assigned yet.',
    examples: '',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.challenge_level).toBeNull();
  expect(capturedCreate.prerelease_section).toBeNull();
  expect(capturedCreate.examples).toEqual([]);
});

test('PUT /classes/:id forwards every structured scalar and parses examples into an array', async () => {
  const res = await put(`/classes/${EXISTING_CLASS_ID}`, {
    ...baseBody,
    ...structuredFields,
    examples: examplesTextarea,
  });

  expect(res.status).toBe(200);
  expect(capturedUpdate).not.toBeNull();
  for (const [field, value] of Object.entries(structuredFields)) {
    expect(capturedUpdate[field]).toBe(value);
  }
  expect(capturedUpdate.examples).toEqual(expectedExamples);
});

test('PUT /classes/:id sends blank challenge_level and prerelease_section as NULL', async () => {
  const res = await put(`/classes/${EXISTING_CLASS_ID}`, {
    ...baseBody,
    challenge_level: '',
    prerelease_section: '',
    overview: 'No challenge level assigned yet.',
    examples: '',
  });

  expect(res.status).toBe(200);
  expect(capturedUpdate.challenge_level).toBeNull();
  expect(capturedUpdate.prerelease_section).toBeNull();
  expect(capturedUpdate.examples).toEqual([]);
});

// A non-browser client can post anything. Both columns carry a CHECK
// constraint, so an unrecognised value has to be neutralised here or Postgres
// answers with a raw constraint-violation 500.
test('POST /classes rejects out-of-allowlist select values without a 500', async () => {
  const res = await post('/classes', {
    ...baseBody,
    challenge_level: 'bogus',
    prerelease_section: 'ASPIRANT CLASSES',
    examples: '',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.challenge_level).toBeNull();
  expect(capturedCreate.prerelease_section).toBeNull();
});

test('PUT /classes/:id rejects out-of-allowlist select values without a 500', async () => {
  const res = await put(`/classes/${EXISTING_CLASS_ID}`, {
    ...baseBody,
    challenge_level: 'mid',
    prerelease_section: 'PCCs',
    examples: '',
  });

  expect(res.status).toBe(200);
  expect(capturedUpdate.challenge_level).toBeNull();
  expect(capturedUpdate.prerelease_section).toBeNull();
});

// prerelease_section is provenance: which section of the source document a
// class was printed under. Both inputs are admin-only in the form, so the
// server must not take them from a non-admin who posts them anyway.
test('POST /classes ignores the constrained selects from a non-admin', async () => {
  profileRole = 'player';
  const res = await post('/classes', {
    ...baseBody,
    challenge_level: 'High',
    prerelease_section: 'exclusive',
    examples: '',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate).not.toHaveProperty('challenge_level');
  expect(capturedCreate).not.toHaveProperty('prerelease_section');
});

test('PUT /classes/:id ignores the constrained selects from a non-admin', async () => {
  profileRole = 'player';
  const res = await put(`/classes/${EXISTING_CLASS_ID}`, {
    ...baseBody,
    challenge_level: 'High',
    prerelease_section: 'exclusive',
    examples: '',
  });

  expect(res.status).toBe(200);
  expect(capturedUpdate).not.toHaveProperty('challenge_level');
  expect(capturedUpdate).not.toHaveProperty('prerelease_section');
});
