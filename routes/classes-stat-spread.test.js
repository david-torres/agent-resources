// routes/classes-stat-spread.test.js
//
// RED-phase test for the new stat_spread parsing contract on the admin class
// create handler. The class form submits one field per stat via bracket
// notation (e.g. stat_spread[might]=2). The POST /classes handler must parse
// those per-stat point inputs into a { statName: points } object containing
// only the stats with a positive integer value, and pass it to createClass as
// payload.stat_spread.
//
// Currently the handler does NOT parse stat_spread at all, so createClass
// receives a payload whose stat_spread is the raw nested body (or undefined) —
// not the expected { might: 2, resilience: 1 } — and this test fails (RED).
//
// Mocking recipe mirrors routes/character-wizard.test.js: real isAuthenticated
// middleware + real route handler against a mocked data layer.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Capture real modules up front so afterAll can restore them — bun's
// mock.module is process-global and would otherwise leak into other files.
const realBase = require('../models/_base');
const realSupabase = require('../util/supabase');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');

// Records the payload createClass received so the assertion can inspect it.
let capturedCreate = null;

// Minimal no-op PostgREST-shaped fake; the class create success path only
// touches createClass (mocked below), so an empty store is enough.
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
  // Consumed by the real isAuthenticated middleware:
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
  getProfile: async () => ({ id: 'p1', user_id: 'u1', role: 'admin' }),
  // The route under test — capture the payload and return a created class.
  createClass: async (payload) => {
    capturedCreate = payload;
    return { data: { id: 'new-class-id', name: payload.name }, error: null };
  },
  // Other named exports routes/classes.js destructures at module load —
  // stubbed so the require doesn't throw. None are reached on this path.
  getClasses: async () => ({ data: null, error: null }),
  getClass: async () => ({ data: null, error: null }),
  getRulesPdf: async () => ({ data: null, error: null }),
  updateClass: async () => ({ data: null, error: null }),
  duplicateClass: async () => ({ data: null, error: null }),
  getUnlockedClasses: async () => ({ data: null, error: null }),
  unlockClass: async () => ({ data: null, error: null }),
  isClassUnlocked: async () => ({ data: null, error: null }),
  getVersionHistory: async () => ({ data: null, error: null }),
  createUnlockCodes: async () => ({ data: null, error: null }),
  listUnlockCodes: async () => ({ data: null, error: null }),
  redeemUnlockCode: async () => ({ data: null, error: null }),
  deleteClass: async () => ({ data: null, error: null }),
  getProfileById: async () => ({ data: null, error: null }),
  saveClassPdfMetadata: async () => ({ data: null, error: null }),
  storeClassPdf: async () => ({ data: null, error: null }),
  getSignedPdfUrl: async () => ({ data: null, error: null }),
  canViewClassPdf: async () => ({ data: null, error: null }),
  deletePdfObject: async () => ({ data: null, error: null }),
  CLASS_PDF_BUCKET: 'class-pdfs',
}));

mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next(),
}));

const express = require('express');
let server;
let baseUrl;

beforeAll(() => {
  delete require.cache[require.resolve('./classes')];
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/classes', require('./classes'));
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
  delete require.cache[require.resolve('./classes')];
});

test('POST /classes parses per-stat point inputs into stat_spread for createClass', async () => {
  const body = new URLSearchParams();
  body.append('name', 'Berserker');
  body.append('status', 'alpha');
  body.append('is_public', 'on');
  body.append('is_player_created', 'false');

  // Per-stat point inputs (bracket notation). Only might and resilience have a
  // positive integer value; every other stat is blank/zero and must be omitted.
  body.append('stat_spread[vitality]', '0');
  body.append('stat_spread[might]', '2');
  body.append('stat_spread[resilience]', '1');
  body.append('stat_spread[spirit]', '');
  body.append('stat_spread[arcane]', '0');
  body.append('stat_spread[will]', '');
  body.append('stat_spread[sensory]', '0');
  body.append('stat_spread[reflex]', '');
  body.append('stat_spread[vigor]', '0');
  body.append('stat_spread[skill]', '');
  body.append('stat_spread[intelligence]', '0');
  body.append('stat_spread[luck]', '');

  const res = await fetch(`${baseUrl}/classes`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer valid-jwt',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body,
  });

  expect(res.status).toBe(200);
  expect(capturedCreate).not.toBeNull();
  expect(capturedCreate.stat_spread).toEqual({ might: 2, resilience: 1 });
});
