const { test, expect, beforeAll, afterAll } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');

const PDF_A = '11111111-1111-4111-8111-111111111111';
const PDF_FREE = 'qs';

// Mutable per-test state.
let currentRole = 'admin';
let createCall = null;
let updateCall = null;

const RULES_ROWS = [
  { id: PDF_A, title: 'Core Rules', edition: 'Advent v2', is_active: true, free_access: false },
  { id: PDF_FREE, title: 'Quickstart', edition: 'Advent v1', is_active: true, free_access: true, storage_path: 'q.pdf' }
];

// bun test runs every *.test.js file in one shared process, and mock.module
// is a process-global, shared-object mutation -- around a dozen other test
// files also mock.module('../models/profile', ...) etc. for their own
// routes. Worse, bun test runs multiple *.test.js files' async work
// concurrently in that one process (verified empirically: two independent
// files' wall-clock time overlaps rather than summing), so another file's
// mock.module call can land in the middle of THIS file's in-flight request
// -- there's no lifecycle hook (beforeEach included) that closes that
// window, since the request is handled by our own in-process HTTP server
// while a `fetch()` in the test body is still pending.
//
// So this file doesn't use mock.module at all. Instead it loads
// routes/library.js with freshRequire, which evaluates the route file (and
// everything it pulls in via relative requires -- models/rules,
// models/profile, util/auth, models/_base, ...) through its own private
// loader and its own private module cache, substituting the fakes below by
// absolute path. Nothing routed through freshRequire is reachable from
// bun's require()/mock.module registry, so no other file's mocks -- however
// they're timed -- can reach in and change what this app sees.
const fakeRules = {
  getRulesPdfs: async () => ({ data: RULES_ROWS, error: null }),
  getRulesPdf: async (id) => ({ data: { id, title: 'Core', edition: 'Advent v1', storage_path: 'p.pdf' }, error: null }),
  createRulesPdf: async (payload) => { createCall = payload; return { data: payload, error: null }; },
  updateRulesPdf: async (id, updates) => { updateCall = { id, updates }; return { data: updates, error: null }; },
  listRulesPdfUnlocksForUser: async () => ({ data: [], error: null }),
  upsertRulesPdfUnlock: async () => ({ data: null, error: null }),
  deleteRulesPdfUnlock: async () => ({ error: null }),
  createRulesPdfUnlockCodes: async () => ({ data: [], error: null }),
  canViewRulesPdf: async () => ({ data: true, error: null }),
  listAllUnlockGrantsAdmin: async () => ({ data: [], error: null }),
  listAllUnlockCodesAdmin: async () => ({ data: [], error: null }),
};

const overrides = new Map([
  // util/auth.js reads supabase/createUserClient directly from
  // models/_base; res.locals.supabase is never consulted by the routes
  // under test, so an inert stand-in is enough.
  [require.resolve('../models/_base'), {
    supabase: {},
    supabaseAdmin: {},
    anonKey: 'test-anon-key',
    createUserClient: () => ({})
  }],
  [require.resolve('../models/auth'), {
    getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
  }],
  [require.resolve('../models/profile'), {
    getProfile: async () => ({ id: 'admin-profile', user_id: 'u1', role: currentRole }),
    getProfileByNameAdmin: async () => ({ data: null }),
    getProfileByIdAdmin: async () => ({ data: null }),
  }],
  [require.resolve('../models/rules'), fakeRules],
  [require.resolve('../models/pdf'), {
    storeRulesPdf: async () => ({ data: { path: 'stored.pdf' }, error: null }),
    deletePdfObject: async () => ({ error: null }),
    getSignedPdfUrl: async () => ({ data: null, error: null }),
    RULES_PDF_BUCKET: 'rules-pdfs',
  }],
  [require.resolve('../util/system-message'), { getSystemMessage: () => null }],
  [require.resolve('../models/lfg'), { getPendingJoinRequestCount: async () => ({ count: 0 }) }],
  [require.resolve('../util/nav-loader'), {
    populateNavItems: async () => {},
    loadNavItems: (req, res, next) => next(),
  }],
]);

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  // Render capture: routes are exercised for their context, not their HTML.
  app.use((req, res, next) => {
    res.render = (view, ctx) => res.json({ view, ctx: ctx || {} });
    next();
  });
  app.use('/library', freshRequire(require.resolve('./library'), overrides));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
});

const authHeaders = { Authorization: 'Bearer valid-jwt' };

test('POST /library/:id passes free_access=true through to updateRulesPdf', async () => {
  currentRole = 'admin';
  updateCall = null;
  // Note: routes/library.js registers 'id' via registerUuidParams, so the
  // path param must be a real UUID -- the brief's 'some-id' sketch would
  // 400 before reaching the handler.
  const res = await fetch(`${baseUrl}/library/${PDF_A}`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'title=Core&edition=Advent+v1&rules_edition=advent&book_type=core&is_active=on&free_access=on',
    redirect: 'manual'
  });
  expect(res.status).toBe(302);
  expect(updateCall.updates.free_access).toBe(true);
});

test('POST /library/:id without the checkbox writes free_access=false', async () => {
  currentRole = 'admin';
  updateCall = null;
  const res = await fetch(`${baseUrl}/library/${PDF_A}`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'title=Core&edition=Advent+v1&rules_edition=advent&book_type=core&is_active=on',
    redirect: 'manual'
  });
  expect(res.status).toBe(302);
  expect(updateCall.updates.free_access).toBe(false);
});

test('GET /library marks a free PDF viewable for a signed-out visitor', async () => {
  currentRole = 'user';
  const res = await fetch(`${baseUrl}/library`); // no auth header
  expect(res.status).toBe(200);
  const { ctx } = await res.json();
  const allRules = ctx.ruleGroups.flatMap(g => [g.primary, ...(g.previous || [])].filter(Boolean));
  const quickstart = allRules.find(r => r.id === PDF_FREE);
  expect(quickstart).toBeTruthy();
  expect(quickstart.canView).toBe(true);
});
