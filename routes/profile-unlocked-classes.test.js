// routes/profile-unlocked-classes.test.js
//
// I-1 route -> view seam: models/class-unlock-expiry.test.js proves
// getUnlockedClasses attaches the right `unlock_expires_at` to each class;
// this proves routes/profile.js actually threads getUnlockedClasses' output
// into the render context under the exact key views/profile.handlebars
// reads (`unlockedClasses`, profile.handlebars:67). Renaming either end
// would leave every other test green while the Access column silently
// stopped showing expiries.
//
// Uses the freshRequire scaffold (see routes/library-unlocks.test.js for the
// full rationale, and routes/profile-onboarding.test.js for the same
// pattern applied to this router): bun's mock.module is a process-global
// registry shared by every *.test.js file bun runs in the same process, so
// freshRequire evaluates routes/profile.js (and everything it pulls in via
// relative requires) through its own private loader/module cache,
// substituting the overrides below by absolute path.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');

const UNLOCKED_CLASSES = [
  {
    id: 'lib-v1',
    name: 'Librarian',
    status: 'release',
    rules_edition: 'advent',
    rules_version: 'v1',
    unlock_expires_at: '2026-09-16T00:00:00Z'
  }
];

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
    // Consumed by the real isAuthenticated middleware.
    getProfile: async () => ({ id: 'p1', user_id: 'u1', name: 'Agent #u1', role: 'user' }),
    updateUser: async () => ({ data: null, error: null }),
    getProfileByName: async () => ({ data: null, error: null }),
    setDiscordId: async () => ({ error: null }),
    searchProfiles: async () => ({ data: [], error: null }),
    getProfileConduitCredits: async () => ({ data: { earned: 0, spent_linked: 0, balance: 0 }, error: null }),
    patchOnboarding: async () => ({ data: {}, error: null }),
  }],
  [require.resolve('../services/home/onboarding'), {
    loadOnboarding: async () => ({ show: false, askPath: false, path: null }),
  }],
  [require.resolve('../models/character'), {
    getPublicCharactersByCreator: async () => ({ data: [], error: null }),
  }],
  [require.resolve('../models/class'), {
    getClasses: async () => ({ data: [], error: null }),
    // The behavior under test.
    getUnlockedClasses: async () => ({ data: UNLOCKED_CLASSES, error: null }),
  }],
  [require.resolve('../models/agent-token'), {
    createAgentToken: async () => ({ data: null, error: null }),
    listAgentTokens: async () => ({ data: [], error: null }),
    revokeAgentToken: async () => ({ data: null, error: null }),
  }],
  [require.resolve('../models/badge'), {
    getProfileBadges: async () => ({ data: null, error: null }),
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
  // Render capture: the route is exercised for its context, not its HTML.
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

test('the profile route supplies unlockedClasses entries carrying unlock_expires_at', async () => {
  const res = await fetch(`${baseUrl}/profile`, { headers: authHeaders });
  expect(res.status).toBe(200);
  const { view, ctx } = await res.json();
  expect(view).toBe('profile');
  expect(ctx.unlockedClasses).toHaveLength(1);
  expect(ctx.unlockedClasses[0].id).toBe('lib-v1');
  expect(ctx.unlockedClasses[0].unlock_expires_at).toBe('2026-09-16T00:00:00Z');
});
