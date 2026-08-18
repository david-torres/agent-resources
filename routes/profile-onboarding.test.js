const { test, expect, beforeAll, afterAll } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');

// Mutable per-test state.
let currentOnboarding = {};
let patchCalls = [];

// See routes/library-unlocks.test.js for why this file avoids
// bun's mock.module registry in favor of freshRequire: routes/profile.js
// (and everything it pulls in transitively via relative requires --
// util/auth, models/profile, models/lfg, util/nav-loader, ...) is evaluated
// through a private loader/module-cache substituting the fakes below by
// absolute path, so no other test file's mocks can interfere with this one.
const overrides = new Map([
  // util/auth.js reads supabase/createUserClient directly from
  // models/_base; res.locals.supabase is never consulted by the route
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
    // util/auth's isAuthenticated consults getProfile to populate
    // res.locals.profile; the route under test reads res.locals.profile.
    getProfile: async () => ({ id: 'p1', user_id: 'u1', name: 'Agent #u1', role: 'user', onboarding: currentOnboarding }),
    patchOnboarding: async (userId, patch) => {
      patchCalls.push({ userId, patch });
      currentOnboarding = { ...currentOnboarding, ...patch };
      return { data: currentOnboarding, error: null };
    },
  }],
  [require.resolve('../services/home/onboarding'), {
    loadOnboarding: async ({ profile }) => ({ show: true, askPath: false, path: profile.onboarding.path || null }),
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
  app.use('/profile', freshRequire(require.resolve('./profile'), overrides));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
});

const authHeaders = { Authorization: 'Bearer valid-jwt' };

const post = (body) => fetch(`${baseUrl}/profile/onboarding`, {
  method: 'POST',
  headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
  body
});

test('action=path stores the choice and re-renders the card partial', async () => {
  currentOnboarding = {}; patchCalls = [];
  const res = await post('action=path&path=new');
  expect(res.status).toBe(200);
  expect(patchCalls).toEqual([{ userId: 'u1', patch: { path: 'new' } }]);
  const { view, ctx } = await res.json();
  expect(view).toBe('partials/home-onboarding');
  expect(ctx.layout).toBe(false);
  expect(ctx.onboarding.path).toBe('new');
});

test('action=path rejects an unknown path', async () => {
  currentOnboarding = {}; patchCalls = [];
  const res = await post('action=path&path=wizard');
  expect(res.status).toBe(400);
  expect(patchCalls).toEqual([]);
});

test('action=switch flips the stored path', async () => {
  currentOnboarding = { path: 'new' }; patchCalls = [];
  const res = await post('action=switch');
  expect(res.status).toBe(200);
  expect(patchCalls).toEqual([{ userId: 'u1', patch: { path: 'veteran' } }]);
});

test('action=switch with no stored path is a 400', async () => {
  currentOnboarding = {}; patchCalls = [];
  const res = await post('action=switch');
  expect(res.status).toBe(400);
});

test('action=dismiss stores the dismissal', async () => {
  currentOnboarding = { path: 'new' }; patchCalls = [];
  const res = await post('action=dismiss');
  expect(res.status).toBe(200);
  expect(patchCalls).toEqual([{ userId: 'u1', patch: { dismissed: true } }]);
});

test('an unknown action is a 400', async () => {
  const res = await post('action=explode');
  expect(res.status).toBe(400);
});

test('the route requires authentication', async () => {
  // redirect: 'manual' -- isAuthenticated redirects unauthenticated
  // requests to /auth/check, which isn't mounted in this test app; fetch's
  // default redirect-following would land there and observe its 404
  // instead of the redirect this test actually verifies.
  const res = await fetch(`${baseUrl}/profile/onboarding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'action=dismiss',
    redirect: 'manual'
  });
  expect([302, 401, 403]).toContain(res.status);
});
