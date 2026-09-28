const { test, expect, beforeAll, afterAll, beforeEach } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');
const realEditionAccess = require('../util/edition-access');

const EXPIRED = { advent: { state: 'expired', endedAt: '2026-09-20T12:00:00Z' }, aspirant: { state: 'none' } };
const UPSELL = [{ edition: 'advent', label: 'Advent', count: 1, classes: [{ id: 'g', name: 'Gunslinger', teaser: 'Quick.' }] }];

const state = {};
beforeEach(() => {
  state.sectionsArgs = null;
  state.upsellArgs = [];
});

const overrides = new Map([
  [require.resolve('../models/_base'), { supabase: {}, supabaseAdmin: {}, anonKey: 'test-anon-key', createUserClient: () => ({}) }],
  [require.resolve('../models/auth'), { getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false) }],
  [require.resolve('../models/profile'), {
    getProfile: async () => ({ id: 'p1', user_id: 'u1', role: 'user', name: 'Vex', onboarding: { dismissed: true } }),
    patchOnboarding: async () => ({ data: {}, error: null })
  }],
  [require.resolve('../services/home/sections'), {
    loadHomeSections: async (args) => {
      state.sectionsArgs = args;
      return { hasCharacters: false, recentMine: [], upcomingGames: [], news: [], community: [], onboarding: { show: false } };
    }
  }],
  [require.resolve('../models/pages'), { getAllNews: async () => ({ data: [], error: null }) }],
  [require.resolve('../services/access/upsell'), {
    getEditionUpsell: async (editionAccess, userId) => { state.upsellArgs.push([editionAccess, userId]); return UPSELL; }
  }],
  [require.resolve('../util/edition-access'), {
    ...realEditionAccess,
    populateEditionAccess: async (req, res) => { res.locals.editionAccess = EXPIRED; }
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
  app.use('/', freshRequire(require.resolve('./home'), overrides));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
});

test('a signed-in home hands its edition status to onboarding and renders the upsell', async () => {
  const res = await fetch(`${baseUrl}/`, { headers: { Authorization: 'Bearer valid-jwt' } });
  expect(res.status).toBe(200);
  const { view, ctx } = await res.json();
  expect(view).toBe('home');
  expect(state.sectionsArgs.editionAccess).toEqual(EXPIRED);
  expect(state.upsellArgs).toEqual([[EXPIRED, 'u1']]);
  expect(ctx.editionUpsell).toEqual(UPSELL);
});

test('a signed-out home has no upsell and looks nothing up', async () => {
  const res = await fetch(`${baseUrl}/`);
  const { ctx } = await res.json();
  expect(ctx.editionUpsell).toEqual([]);
  expect(state.upsellArgs).toEqual([]);
});
