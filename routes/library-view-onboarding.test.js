const { test, expect, beforeAll, afterAll } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');
const { STARTER_RULES_PDF_ID } = require('../util/starter-content');

// registerUuidParams validates :id as a real UUID, so these fake doc ids
// (unlike the brief's 'qs'/'core') have to be UUID-shaped. QS_ID stands in
// for the free quickstart; CORE_ID for an ordinary gated PDF; the starter
// Advent PDF uses the real STARTER_RULES_PDF_ID.
const QS_ID = '11111111-1111-4111-8111-111111111111';
const CORE_ID = '22222222-2222-4222-8222-222222222222';

const RULES_BY_ID = {
  [QS_ID]: { id: QS_ID, title: 'Quickstart', edition: 'v1', storage_path: 'qs.pdf', free_access: true },
  [STARTER_RULES_PDF_ID]: { id: STARTER_RULES_PDF_ID, title: 'Advent Core', edition: 'v1', storage_path: 'advent.pdf', free_access: false },
  [CORE_ID]: { id: CORE_ID, title: 'Core Rules', edition: 'v2', storage_path: 'core.pdf', free_access: false }
};

// Mutable per-test state.
let patchCalls = [];
let patchFails = false;

const fakeRules = {
  getRulesPdf: async (id) =>
    (RULES_BY_ID[id]
      ? { data: RULES_BY_ID[id], error: null }
      : { data: null, error: { message: 'not found' } }),
  // Real-ish stand-in for the Task 3 free_access branch: free docs are
  // viewable by anyone, everything else requires a signed-in user.
  canViewRulesPdf: async (uc, pdf) => ({ data: !!pdf.free_access || !!uc.userId, error: null })
};

const overrides = new Map([
  [require.resolve('../models/_base'), {
    supabase: {},
    supabaseAdmin: {},
    anonKey: 'test-anon-key',
    createUserClient: () => ({})
  }],
  [require.resolve('../models/auth'), {
    getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1', confirmed_at: '2026-01-01T00:00:00Z' } : false)
  }],
  [require.resolve('../models/profile'), {
    getProfile: async () => ({ id: 'profile-1', user_id: 'u1', role: 'user' }),
    patchOnboarding: async (userId, patch) => {
      patchCalls.push({ userId, patch });
      await new Promise(r => setTimeout(r, 0));
      if (patchFails) throw new Error('patchOnboarding boom');
      return { data: patch, error: null };
    }
  }],
  [require.resolve('../models/rules'), fakeRules],
  [require.resolve('../models/pdf'), {
    storeRulesPdf: async () => ({ data: null, error: null }),
    deletePdfObject: async () => ({ error: null }),
    getSignedPdfUrl: async () => ({ data: 'https://signed.example/pdf', error: null }),
    RULES_PDF_BUCKET: 'rules-pdfs'
  }],
  [require.resolve('../util/system-message'), { getSystemMessage: () => null }],
  [require.resolve('../models/lfg'), { getPendingJoinRequestCount: async () => ({ count: 0 }) }],
  [require.resolve('../util/nav-loader'), {
    populateNavItems: async () => {},
    loadNavItems: (req, res, next) => next()
  }]
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

test('a signed-out visitor can open a free PDF and no onboarding write happens', async () => {
  patchCalls = [];
  const res = await fetch(`${baseUrl}/library/${QS_ID}/view`); // no auth
  expect(res.status).toBe(200);
  const { view, ctx } = await res.json();
  expect(view).toBe('pdf-viewer');
  expect(ctx.pdfUrl).toBe('https://signed.example/pdf');
  await new Promise(r => setTimeout(r, 10));
  expect(patchCalls).toEqual([]);
});

test('a signed-in player opening the free quickstart marks read_rules', async () => {
  patchCalls = [];
  const res = await fetch(`${baseUrl}/library/${QS_ID}/view`, { headers: authHeaders });
  expect(res.status).toBe(200);
  await new Promise(r => setTimeout(r, 10));
  expect(patchCalls).toEqual([{ userId: 'u1', patch: { read_rules: true } }]);
});

test('a signed-in player opening the starter Advent PDF marks read_rules', async () => {
  patchCalls = [];
  const res = await fetch(`${baseUrl}/library/${STARTER_RULES_PDF_ID}/view`, { headers: authHeaders });
  expect(res.status).toBe(200);
  await new Promise(r => setTimeout(r, 10));
  expect(patchCalls).toEqual([{ userId: 'u1', patch: { read_rules: true } }]);
});

test('an ordinary gated PDF does not mark read_rules', async () => {
  patchCalls = [];
  const res = await fetch(`${baseUrl}/library/${CORE_ID}/view`, { headers: authHeaders });
  expect(res.status).toBe(200);
  await new Promise(r => setTimeout(r, 10));
  expect(patchCalls).toEqual([]);
});

test('a patchOnboarding failure does not break the viewer', async () => {
  patchFails = true; // make the fake reject
  const res = await fetch(`${baseUrl}/library/${QS_ID}/view`, { headers: authHeaders });
  expect(res.status).toBe(200);
  patchFails = false;
});
