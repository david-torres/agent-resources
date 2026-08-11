// routes/bot-link-confirm.test.js
//
// Regression test for a hang risk flagged when Task 7 switched
// createAgentToken to THROW on an authorization failure: POST
// /link/bot/confirm is an HTML render route, deliberately NOT wrapped in
// asyncHandler (asyncHandler forwards to the central error handler, which
// would answer with a JSON/generic 403 instead of this page's own error
// notification). An authenticated-but-unconfirmed user has
// res.locals.profile === false (see util/auth.js), so actorFromLocals
// yields { profileId: null }, and confirmLink's create-token step throws
// AuthorizationError. Without a local try/catch, that throw becomes an
// unhandled rejection under Express 4 and the request never responds. This
// test proves the route's own try/catch renders the graceful error page
// instead, within a bounded time, for exactly that actor shape.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realAuth = require('../models/auth');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');
const realProfile = require('../models/profile');
const realBotLink = require('../models/bot-link');
const realBotLinkService = require('../services/bot-link/service');
const { AuthorizationError } = require('../util/errors');

mock.module('../models/auth', () => ({
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false)
}));
mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next()
}));
// `false` is the exact shape isAuthenticated stores for an authenticated
// user who hasn't completed profile confirmation yet.
mock.module('../models/profile', () => ({
  getProfile: async () => false
}));
mock.module('../models/bot-link', () => ({
  normalizeLinkCode: (value) => {
    if (typeof value !== 'string') return null;
    const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return /^[A-Z0-9]{8}$/.test(cleaned) ? cleaned : null;
  },
  cleanupStaleLinks: async () => {}
}));
// Stand in for the real BotLinkService so this test needs no live Supabase:
// confirmLink reproduces exactly the failure mode this regression targets
// (an actor with no profileId is not authorized to mint a token).
mock.module('../services/bot-link/service', () => ({
  BotLinkService: class {
    async confirmLink(actor) {
      if (!actor?.profileId) {
        throw new AuthorizationError('Not authorized to manage this agent token', { reason: 'not_owner' });
      }
      return { data: { linked: true }, error: null };
    }
  }
}));

let app;
let server;
let baseUrl;
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');

beforeAll(async () => {
  delete require.cache[require.resolve('../app')];
  ({ createApp: app } = require('../app'));
  const built = app();
  ({ server, baseUrl } = await startHttpServer(built));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/auth', () => realAuth);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/bot-link', () => realBotLink);
  mock.module('../services/bot-link/service', () => realBotLinkService);
  delete require.cache[require.resolve('../app')];
});

test('POST /link/bot/confirm renders the graceful error page (not a hang) for an unconfirmed user', async () => {
  const started = Date.now();
  const res = await Promise.race([
    fetch(`${baseUrl}/link/bot/confirm`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-jwt',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'code=ABCD1234'
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('request hung')), 4000))
  ]);
  expect(Date.now() - started).toBeLessThan(4000);
  expect(res.status).toBe(200);
  const body = await res.text();
  // The view's own `{{error}}` binding is shadowed by a same-named
  // handlebars-helpers logging helper (a pre-existing, unrelated template
  // bug — see task report), so the notification text itself doesn't come
  // through; the important assertion here is the *shape* of the response:
  // a fast, complete render of the error notification (not the success
  // notification, and not a hang/timeout).
  expect(body).toContain('notification is-danger');
  expect(body).not.toContain("You're linked");
});
