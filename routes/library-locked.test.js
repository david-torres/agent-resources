// GET /library/:id/view without access stays a 403, but names a lapsed trial
// and offers the edition's unlock. Scaffold from routes/library-view-onboarding.test.js.
const { test, expect, beforeAll, afterAll, beforeEach } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');
const realEditionAccess = require('../util/edition-access');

const ADVENT_ID = '33333333-3333-4333-8333-333333333333';
const SUPPLEMENT_ID = '44444444-4444-4444-8444-444444444444';
const RULES_BY_ID = {
  [ADVENT_ID]: { id: ADVENT_ID, title: 'Enclave: Advent', storage_path: 'advent.pdf', free_access: false, book_type: 'core', rules_edition: 'advent' },
  [SUPPLEMENT_ID]: { id: SUPPLEMENT_ID, title: 'GM Screen', storage_path: 'gm.pdf', free_access: false, book_type: 'supplement', rules_edition: 'advent' }
};

const state = {};
beforeEach(() => {
  state.editionAccess = { advent: { state: 'expired', endedAt: '2026-09-20T12:00:00Z' }, aspirant: { state: 'none' } };
});

const overrides = new Map([
  [require.resolve('../models/_base'), { supabase: {}, supabaseAdmin: {}, anonKey: 'test-anon-key', createUserClient: () => ({}) }],
  [require.resolve('../models/auth'), { getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false) }],
  [require.resolve('../models/profile'), {
    getProfile: async () => ({ id: 'p1', user_id: 'u1', role: 'user', timezone: 'UTC' }),
    patchOnboarding: async () => ({ data: {}, error: null })
  }],
  [require.resolve('../models/rules'), {
    getRulesPdf: async (id) => ({ data: RULES_BY_ID[id] || null, error: RULES_BY_ID[id] ? null : { message: 'not found' } }),
    canViewRulesPdf: async () => ({ data: false, error: null })
  }],
  [require.resolve('../models/pdf'), {
    storeRulesPdf: async () => ({ data: null, error: null }),
    deletePdfObject: async () => ({ error: null }),
    getSignedPdfUrl: async () => ({ data: 'https://signed.example/pdf', error: null }),
    RULES_PDF_BUCKET: 'rules-pdfs'
  }],
  [require.resolve('../util/edition-access'), {
    ...realEditionAccess,
    populateEditionAccess: async (req, res) => { res.locals.editionAccess = state.editionAccess; }
  }],
  [require.resolve('../util/system-message'), { getSystemMessage: () => null }],
  [require.resolve('../models/lfg'), { getPendingJoinRequestCount: async () => ({ count: 0 }) }],
  [require.resolve('../util/nav-loader'), { populateNavItems: async () => {}, loadNavItems: (req, res, next) => next() }]
]);

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
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

const open = (id, headers = { Authorization: 'Bearer valid-jwt' }) => fetch(`${baseUrl}/library/${id}/view`, { headers });

test('a lapsed trial gets a 403 page naming when it ended', async () => {
  const res = await open(ADVENT_ID);
  expect(res.status).toBe(403);
  const { view, ctx } = await res.json();
  expect(view).toBe('library-locked');
  expect(ctx.edition).toBe('advent');
  expect(ctx.trialEndedAt).toBe('2026-09-20T12:00:00Z');
});

test('never having had access gets the generic locked page with the edition CTA', async () => {
  state.editionAccess = { advent: { state: 'none' }, aspirant: { state: 'none' } };
  const res = await open(ADVENT_ID);
  expect(res.status).toBe(403);
  const { view, ctx } = await res.json();
  expect(view).toBe('library-locked');
  expect(ctx.edition).toBe('advent');
  expect(ctx.trialEndedAt).toBeNull();
});

test('a supplement names no edition, so its CTA is redeem-only', async () => {
  const { ctx } = await (await open(SUPPLEMENT_ID)).json();
  expect(ctx.edition).toBeNull();
  expect(ctx.trialEndedAt).toBeNull();
});

test('a signed-out visitor gets the locked page without a trial notice', async () => {
  const res = await open(ADVENT_ID, {});
  expect(res.status).toBe(403);
  const { view, ctx } = await res.json();
  expect(view).toBe('library-locked');
  expect(ctx.trialEndedAt).toBeNull();
});

test('a non-boosted htmx request keeps the inline 403', async () => {
  const res = await open(ADVENT_ID, { Authorization: 'Bearer valid-jwt', 'HX-Request': 'true', 'HX-Target': 'alerts' });
  expect(res.status).toBe(403);
  expect((await res.json()).view).toBe('error-inline');
});
