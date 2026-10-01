// GET /classes puts the Aspirant versions of the Exclusive classes in their own
// locked section until the viewer unlocks one; the Advent versions stay in
// Pre-release. freshRequire scaffold as in routes/classes-edition-access.test.js.
const { test, expect, beforeAll, afterAll, beforeEach } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');
const { CORE_CLASS_UNLOCKS } = require('../util/starter-content');
const realEditionAccess = require('../util/edition-access');

const GUN = CORE_CLASS_UNLOCKS.advent.Gunslinger[0];
const ARDENT_ADV = 'ardent-advent';
const ARDENT_ASP = '07b32465-be5d-46ec-84d2-4d5574b151bc';
const SQUIRE_ASP = '0730b2b5-8327-4bc1-8400-16edde552b1a';
const row = (id, name, rules_edition, extra = {}) => ({
  id, name, rules_edition, content_format: rules_edition, rules_version: 'v1', status: 'release', is_public: true,
  is_player_created: false, prerelease_section: null, free_play_access: false, challenge_level: 'Mid',
  created_by: 'someone-else', gear: [], abilities: [], created_at: '2026-01-01T00:00:00Z', ...extra
});
const ROWS = [
  row(GUN, 'Gunslinger', 'advent'),
  row(ARDENT_ADV, 'Ardent', 'advent', { prerelease_section: 'exclusive', free_play_access: true }),
  row(ARDENT_ASP, 'Ardent', 'aspirant', { prerelease_section: 'exclusive', base_class_id: ARDENT_ADV }),
  row(SQUIRE_ASP, 'Squire', 'aspirant', { prerelease_section: 'exclusive' })
];
const ROSTERS = { advent: new Set([GUN]), aspirant: new Set() };
const ADVENT_OWNER = { advent: { state: 'owned' }, aspirant: { state: 'none' } };

const state = {};
beforeEach(() => {
  state.editionAccess = ADVENT_OWNER;
  state.access = {
    ids: new Set([GUN, ARDENT_ADV]), bookIds: new Set([GUN]),
    sourceById: new Map([[GUN, { source: 'book' }]]), rosterIdsByEdition: ROSTERS, error: null
  };
});

const overrides = new Map([
  [require.resolve('../models/_base'), { supabase: {}, supabaseAdmin: {}, anonKey: 'test-anon-key', createUserClient: () => ({}) }],
  [require.resolve('../models/auth'), { getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false) }],
  [require.resolve('../models/profile'), {
    getProfile: async () => ({ id: 'p1', user_id: 'u1', role: 'user', timezone: 'UTC' }),
    getProfileById: async () => ({ data: null, error: null }),
    patchOnboarding: async () => ({ data: null, error: null })
  }],
  [require.resolve('../models/class'), {
    getClasses: async () => ({ data: ROWS, error: null }),
    getClass: async (id) => ({ data: ROWS.find(r => r.id === id) || null, error: null }),
    getEffectiveClassUnlocks: async () => state.access,
    getEffectiveClassAccess: async () => ({ data: { unlocked: false }, error: null }),
    canViewClassPdf: async () => ({ data: false, error: null })
  }],
  [require.resolve('../models/rules'), { getRulesPdf: async () => ({ data: null, error: null }) }],
  [require.resolve('../models/pdf'), {
    storeClassPdf: async () => ({ data: null, error: null }),
    getSignedPdfUrl: async () => ({ data: null, error: null }),
    deletePdfObject: async () => ({ error: null }),
    CLASS_PDF_BUCKET: 'class-pdfs'
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

const get = async (path) => {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: 'Bearer valid-jwt' } });
  expect(res.status).toBe(200);
  return res.json();
};
const idsIn = (buckets) => (buckets || []).flatMap(b => b.groups.map(g => g.primary.id));

test('Aspirant Exclusives the viewer has not unlocked are listed in the Exclusive section, not Pre-release', async () => {
  const { ctx } = await get('/classes');
  expect(idsIn(ctx.exclusiveGroups).sort()).toEqual([ARDENT_ASP, SQUIRE_ASP].sort());
  expect(idsIn(ctx.prereleaseGroups)).toEqual([ARDENT_ADV]);
  expect(idsIn(ctx.ownedReleaseGroups)).toEqual([GUN]);
});

test('an unlocked Aspirant Exclusive joins Your Released Classes under Aspirant, even without the Aspirant book', async () => {
  state.access = {
    ...state.access,
    ids: new Set([GUN, ARDENT_ADV, ARDENT_ASP]),
    sourceById: new Map([[GUN, { source: 'book' }], [ARDENT_ASP, { source: 'direct' }]])
  };
  const { ctx } = await get('/classes?yours=aspirant');
  expect(ctx.ownedEditions).toEqual(['advent', 'aspirant']);
  expect(ctx.ownedEdition).toBe('aspirant');
  expect(idsIn(ctx.ownedReleaseGroups)).toEqual([ARDENT_ASP]);
  expect(idsIn(ctx.exclusiveGroups)).toEqual([SQUIRE_ASP]);
  expect(idsIn(ctx.prereleaseGroups)).toEqual([ARDENT_ADV]);
});
