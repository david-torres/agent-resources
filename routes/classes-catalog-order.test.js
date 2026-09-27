// routes/classes-catalog-order.test.js
//
// GET /classes buckets the classes within each catalog section by difficulty
// (Low, Mid, High, then Unrated), each bucket name-sorted.
//
// Uses the freshRequire scaffold (see routes/classes-redeem-onboarding.test.js)
// so bun's process-global mock.module registry cannot clobber the overrides.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');

const row = (id, name, challenge_level, extra = {}) => ({
  id,
  name,
  challenge_level,
  status: 'release',
  is_public: true,
  is_player_created: false,
  rules_edition: 'advent',
  rules_version: 'v1',
  prerelease_section: null,
  created_at: '2026-01-01T00:00:00Z',
  ...extra
});

// Each partition's names are alphabetical in one order and difficulty in
// another: Alpha=High, Bravo=Low, Charlie=Mid.
const trio = (prefix, extra) => [
  row(`${prefix}-a`, 'Alpha', 'High', extra),
  row(`${prefix}-b`, 'Bravo', 'Low', extra),
  row(`${prefix}-c`, 'Charlie', 'Mid', extra)
];

const catalogRows = [
  ...trio('owned'),
  ...trio('other'),
  ...trio('pre', { prerelease_section: 'aspirant' }),
  ...trio('pcc', { is_player_created: true, status: 'draft' })
];

const overrides = new Map([
  [require.resolve('../models/_base'), {
    supabase: {},
    supabaseAdmin: {},
    anonKey: 'test-anon-key',
    createUserClient: () => ({})
  }],
  [require.resolve('../models/auth'), {
    getUserFromToken: async () => false,
  }],
  [require.resolve('../models/profile'), {
    getProfile: async () => null,
    getProfileById: async () => ({ data: null, error: null }),
    patchOnboarding: async () => ({ data: null, error: null }),
  }],
  [require.resolve('../models/class'), {
    getClasses: async () => ({ data: catalogRows, error: null }),
    getEffectiveClassUnlocks: async () => ({
      ids: new Set(['owned-a', 'owned-b', 'owned-c']),
      bookIds: new Set(['owned-a', 'owned-b', 'owned-c']),
      error: null
    }),
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
]);

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(require('../util/open-graph').openGraphDefaults);
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

const bucketsOf = (buckets) => buckets.map(b => ({
  level: b.level,
  label: b.label,
  names: b.groups.map(g => g.primary.name)
}));

test('GET /classes buckets every catalog section under Low, Mid and High Challenge subheadings', async () => {
  const res = await fetch(`${baseUrl}/classes`);
  expect(res.status).toBe(200);
  const { view, ctx } = await res.json();
  expect(view).toBe('classes');
  const byDifficulty = [
    { level: 'Low', label: 'Low Challenge', names: ['Bravo'] },
    { level: 'Mid', label: 'Mid Challenge', names: ['Charlie'] },
    { level: 'High', label: 'High Challenge', names: ['Alpha'] }
  ];
  expect({
    owned: bucketsOf(ctx.ownedReleaseGroups),
    other: bucketsOf(ctx.otherReleaseGroups),
    prerelease: bucketsOf(ctx.prereleaseGroups),
    pcc: bucketsOf(ctx.pccGroups)
  }).toEqual({
    owned: byDifficulty,
    other: byDifficulty,
    prerelease: byDifficulty,
    pcc: byDifficulty
  });
});
