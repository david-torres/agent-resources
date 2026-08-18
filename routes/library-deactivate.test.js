// routes/library-deactivate.test.js
//
// The edit form in views/library-manage.handlebars renders "Visible in
// library" as a bare checkbox with no hidden companion input, so an
// unchecked box simply omits is_active from the POST body. HTML form
// semantics therefore make "field absent" the one and only way the form
// says "deactivate this book" -- the update handler must treat a missing
// is_active as false, or a rules PDF can never be deactivated from the UI.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');

const PDF_A = '11111111-1111-4111-8111-111111111111';

// Mutable per-test state.
let updateCall = null;

// Same isolation story as library-free-access-admin.test.js: bun test runs
// every *.test.js file in one shared process and other files mock.module
// the same model paths, so this file avoids mock.module entirely and loads
// routes/library.js through freshRequire with fakes keyed by absolute path.
const fakeRules = {
  getRulesPdfs: async () => ({ data: [], error: null }),
  getRulesPdf: async (id) => ({ data: { id, title: 'Core', edition: 'Advent v1', storage_path: 'p.pdf', is_active: true }, error: null }),
  createRulesPdf: async (payload) => ({ data: payload, error: null }),
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
    getProfile: async () => ({ id: 'admin-profile', user_id: 'u1', role: 'admin' }),
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

test('POST /library/:id without the checkbox writes is_active=false', async () => {
  updateCall = null;
  const res = await fetch(`${baseUrl}/library/${PDF_A}`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'title=Core&edition=Advent+v1&rules_edition=advent&book_type=core',
    redirect: 'manual'
  });
  expect(res.status).toBe(302);
  expect(updateCall.updates.is_active).toBe(false);
});
