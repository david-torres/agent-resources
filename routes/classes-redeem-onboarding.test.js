// routes/classes-redeem-onboarding.test.js
//
// RED-phase test for the onboarding "redeemed" step: POST /classes/redeem/bulk
// should mark profiles.onboarding.redeemed = true (via patchOnboarding) the
// first time a batch contains at least one successfully-redeemed code, and
// must NOT write anything when every code in the batch fails.
//
// Uses the freshRequire scaffold (see routes/library-unlocks.test.js for the
// full rationale): bun's mock.module is a process-global registry shared by
// every *.test.js file bun runs in the same process, so any other file that
// also mock.module's '../models/profile' etc. (there are many) can clobber
// what this file sees mid-request. freshRequire sidesteps that by evaluating
// routes/classes.js (and everything it pulls in via relative requires)
// through its own private loader with its own private module cache,
// substituting the overrides below by absolute path. Nothing routed through
// freshRequire is reachable from bun's require()/mock.module registry.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');

// Mutable per-test state, reset at the top of each test.
let patchCalls = [];

const overrides = new Map([
  // util/auth.js reads supabase/createUserClient directly from models/_base;
  // res.locals.supabase is never consulted by the redeem route, so an inert
  // stand-in is enough.
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
    // Consumed by the real isAuthenticated middleware.
    getProfile: async (user) => ({ id: 'p1', user_id: user.id, role: 'user' }),
    // Destructured by routes/classes.js but not exercised by /redeem/bulk.
    getProfileById: async () => ({ data: null, error: null }),
    // The behavior under test.
    patchOnboarding: async (userId, patch) => {
      patchCalls.push({ userId, patch });
      return { data: patch, error: null };
    },
  }],
  [require.resolve('../models/class'), {
    getClasses: async () => ({ data: [], error: null }),
    getClass: async () => ({ data: { name: 'Thane' }, error: null }),
    createClass: async () => ({ data: null, error: null }),
    updateClass: async () => ({ data: null, error: null }),
    duplicateClass: async () => ({ data: null, error: null }),
    getUnlockedClasses: async () => ({ data: [], error: null }),
    unlockClass: async () => ({ error: null }),
    isClassUnlocked: async () => ({ data: false, error: null }),
    getVersionHistory: async () => ({ data: [], error: null }),
    createUnlockCodes: async () => ({ data: [], error: null }),
    listUnlockCodes: async () => ({ data: [], error: null }),
    redeemUnlockCode: async () => ({ data: null, error: null }),
    deleteClass: async () => ({ error: null }),
    saveClassPdfMetadata: async () => ({ error: null }),
    canViewClassPdf: async () => ({ data: false, error: null }),
  }],
  [require.resolve('../models/rules'), {
    getRulesPdf: async () => ({ data: null, error: null }),
  }],
  [require.resolve('../models/pdf'), {
    storeClassPdf: async () => ({ data: null, error: null }),
    getSignedPdfUrl: async () => ({ data: null, error: null }),
    deletePdfObject: async () => ({ error: null }),
    CLASS_PDF_BUCKET: 'class-pdfs',
  }],
  [require.resolve('../util/system-message'), { getSystemMessage: () => null }],
  [require.resolve('../models/lfg'), { getPendingJoinRequestCount: async () => ({ count: 0 }) }],
  [require.resolve('../util/nav-loader'), {
    populateNavItems: async () => {},
    loadNavItems: (req, res, next) => next(),
  }],
  [require.resolve('../util/redeem-code'), {
    redeemAnyCode: async (code) => (code === 'good' ? { type: 'class', id: 'k1' } : { error: new Error('bad code') }),
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
  // Render capture: the route is exercised for its side effects, not its HTML.
  app.use((req, res, next) => {
    res.render = (view, ctx) => res.json({ view, ctx: ctx || {} });
    next();
  });
  app.use('/classes', freshRequire(require.resolve('./classes'), overrides));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
});

const authHeaders = { Authorization: 'Bearer valid-jwt' };

test('a batch with one good code marks redeemed once', async () => {
  patchCalls = [];
  const res = await fetch(`${baseUrl}/classes/redeem/bulk`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'codes=good%0Abad'
  });
  expect(res.status).toBe(200);
  await new Promise(r => setTimeout(r, 10));
  expect(patchCalls).toEqual([{ userId: 'u1', patch: { redeemed: true } }]);
});

test('an all-failure batch does not mark redeemed', async () => {
  patchCalls = [];
  const res = await fetch(`${baseUrl}/classes/redeem/bulk`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'codes=bad'
  });
  expect(res.status).toBe(200);
  await new Promise(r => setTimeout(r, 10));
  expect(patchCalls).toEqual([]);
});
