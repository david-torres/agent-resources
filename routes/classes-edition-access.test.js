// GET /classes and GET /classes/:id read res.locals.editionAccess for the
// locked sections, the TRIAL badges and the lapsed-trial teaser header.
// freshRequire scaffold as in routes/classes-catalog-order.test.js.
const { test, expect, beforeAll, afterAll, beforeEach } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');
const { CORE_CLASS_UNLOCKS, ASPIRANT_V1_CLASS_IDS } = require('../util/starter-content');
const realEditionAccess = require('../util/edition-access');

const ADV = CORE_CLASS_UNLOCKS.advent.Gunslinger[0];
const ASP = ASPIRANT_V1_CLASS_IDS.Gunslinger;
const row = (id, rules_edition, extra = {}) => ({
  id, name: 'Gunslinger', rules_edition, rules_version: 'v1', status: 'release', is_public: true,
  is_player_created: false, prerelease_section: null, challenge_level: 'Mid', created_by: 'someone-else',
  gear: [], abilities: [], created_at: '2026-01-01T00:00:00Z', ...extra
});
const ROWS = [row(ADV, 'advent'), row(ASP, 'aspirant', { base_class_id: ADV })];
const ROSTERS = { advent: new Set([ADV]), aspirant: new Set([ASP]) };

const TRIAL = { advent: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false }, aspirant: { state: 'none' } };
const EXPIRED = { advent: { state: 'expired', endedAt: '2026-09-20T12:00:00Z' }, aspirant: { state: 'none' } };

const state = {};
beforeEach(() => {
  state.editionAccess = EXPIRED;
  state.access = { ids: new Set(), bookIds: new Set(), rosterIdsByEdition: ROSTERS, error: null };
  state.classAccess = { unlocked: false, productUnlocked: false, bookUnlocked: false, accessSource: null, expiresAt: null };
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
    getEffectiveClassAccess: async () => ({ data: state.classAccess, error: null }),
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
const idsIn = (buckets) => buckets.flatMap(b => b.groups.map(g => g.primary.id));

test('a lapsed Advent trial teases each Gunslinger under its own edition', async () => {
  const { ctx } = await get('/classes');
  expect(ctx.lockedSections.map(s => ({ edition: s.edition, count: s.count, trialEndedAt: s.trialEndedAt, ids: idsIn(s.buckets) })))
    .toEqual([
      { edition: 'advent', count: 1, trialEndedAt: '2026-09-20T12:00:00Z', ids: [ADV] },
      { edition: 'aspirant', count: 1, trialEndedAt: null, ids: [ASP] }
    ]);
  expect(ctx.otherReleaseGroups).toEqual([]);
  expect(ctx.showTrialBadges).toBe(false);
});

test('during an Advent trial the Advent class is owned with a badge and only the fork is locked', async () => {
  state.editionAccess = TRIAL;
  state.access = { ids: new Set([ADV]), bookIds: new Set([ADV]), rosterIdsByEdition: ROSTERS, error: null };
  const { ctx } = await get('/classes');
  expect(idsIn(ctx.ownedReleaseGroups)).toEqual([ADV]);
  expect(ctx.lockedSections.map(s => s.edition)).toEqual(['aspirant']);
  expect(ctx.showTrialBadges).toBe(true);
});

test('a failed status lookup leaves the catalog as it was: no locked sections', async () => {
  state.editionAccess = null;
  const { ctx } = await get('/classes');
  expect(ctx.lockedSections).toEqual([]);
  expect(idsIn(ctx.otherReleaseGroups).sort()).toEqual([ADV, ASP].sort());
});

test('a book-granted Advent class carries the trial status into the class view', async () => {
  state.editionAccess = TRIAL;
  state.classAccess = { unlocked: true, productUnlocked: true, bookUnlocked: true, accessSource: 'book', expiresAt: '2026-10-08T12:00:00Z' };
  const { view, ctx } = await get(`/classes/${ADV}/Gunslinger`);
  expect(view).toBe('class-view');
  expect(ctx.adventTrial).toEqual(TRIAL.advent);
});

test('a directly unlocked class shows no trial badge', async () => {
  state.editionAccess = TRIAL;
  state.classAccess = { unlocked: true, productUnlocked: true, bookUnlocked: false, accessSource: 'direct', expiresAt: null };
  const { ctx } = await get(`/classes/${ADV}/Gunslinger`);
  expect(ctx.adventTrial).toBeNull();
});

test("a locked Advent class's teaser names when the trial ended", async () => {
  const { view, ctx } = await get(`/classes/${ADV}/Gunslinger`);
  expect(view).toBe('class-view-teaser');
  expect(ctx.adventTrialEndedAt).toBe('2026-09-20T12:00:00Z');
});

test("the Aspirant fork's teaser does not blame the Advent trial", async () => {
  const { view, ctx } = await get(`/classes/${ASP}/Gunslinger`);
  expect(view).toBe('class-view-teaser');
  expect(ctx.adventTrialEndedAt).toBeNull();
});
