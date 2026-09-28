const { test, expect, beforeAll, afterAll } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');
const realEditionAccess = require('../util/edition-access');

const TRIAL = { advent: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false }, aspirant: { state: 'none' } };
const UPSELL = [{ edition: 'aspirant', label: 'Aspirant', blurb: 'Aspirant blurb.' }];
const upsellArgs = [];

const overrides = new Map([
  [require.resolve('../models/_base'), { supabase: {}, supabaseAdmin: {}, anonKey: 'test-anon-key', createUserClient: () => ({}) }],
  [require.resolve('../models/auth'), { getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false) }],
  [require.resolve('../models/profile'), {
    getProfile: async () => ({ id: 'p1', user_id: 'u1', name: 'Vex', role: 'user' }),
    updateUser: async () => ({ data: null, error: null }),
    getProfileByName: async () => ({ data: null, error: null }),
    setDiscordId: async () => ({ error: null }),
    searchProfiles: async () => ({ data: [], error: null }),
    getProfileConduitCredits: async () => ({ data: { earned: 0, spent_linked: 0, balance: 0 }, error: null }),
    patchOnboarding: async () => ({ data: {}, error: null })
  }],
  [require.resolve('../services/home/onboarding'), { loadOnboarding: async () => ({ show: false, askPath: false, path: null }) }],
  [require.resolve('../models/character'), { getPublicCharactersByCreator: async () => ({ data: [], error: null }) }],
  [require.resolve('../models/class'), {
    getClasses: async () => ({ data: [], error: null }),
    getUnlockedClasses: async () => ({ data: [], error: null })
  }],
  [require.resolve('../models/agent-token'), {
    createAgentToken: async () => ({ data: null, error: null }),
    listAgentTokens: async () => ({ data: [], error: null }),
    revokeAgentToken: async () => ({ data: null, error: null })
  }],
  [require.resolve('../models/badge'), { getProfileBadges: async () => ({ data: null, error: null }) }],
  [require.resolve('../services/access/upsell'), {
    getEditionUpsell: (...args) => { upsellArgs.push(args); return UPSELL; }
  }],
  [require.resolve('../util/edition-access'), {
    ...realEditionAccess,
    populateEditionAccess: async (req, res) => { res.locals.editionAccess = TRIAL; }
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
  app.use('/profile', freshRequire(require.resolve('./profile'), overrides));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
});

test('the profile carries the Advent trial for its badges and the upsell for locked editions', async () => {
  const res = await fetch(`${baseUrl}/profile`, { headers: { Authorization: 'Bearer valid-jwt' } });
  expect(res.status).toBe(200);
  const { view, ctx } = await res.json();
  expect(view).toBe('profile');
  expect(ctx.adventTrial).toEqual(TRIAL.advent);
  expect(ctx.editionUpsell).toEqual(UPSELL);
  expect(upsellArgs).toEqual([[TRIAL]]);
});
