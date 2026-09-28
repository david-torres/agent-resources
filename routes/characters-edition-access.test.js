// The character sheet, the wizard and the expert form read
// res.locals.editionAccess. freshRequire scaffold, render capture.
const { test, expect, beforeAll, afterAll, beforeEach } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');
const { CORE_CLASS_UNLOCKS, ASPIRANT_V1_CLASS_IDS } = require('../util/starter-content');
const realEditionAccess = require('../util/edition-access');

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';
const ADVENT_GUN = {
  id: CORE_CLASS_UNLOCKS.advent.Gunslinger[0], name: 'Gunslinger', base_class_id: null,
  rules_edition: 'advent', rules_version: 'v1', content_format: 'advent', status: 'release',
  is_public: true, is_player_created: false, prerelease_section: null, created_at: '2026-01-01T00:00:00Z',
  teaser: 'Quick on the draw.', overview: 'SECRET overview',
  abilities: [{ name: 'Deadeye', description: 'SECRET ability' }], gear: [{ name: 'Revolver', description: 'SECRET gear' }]
};
const ASPIRANT_GUN = {
  ...ADVENT_GUN, id: ASPIRANT_V1_CLASS_IDS.Gunslinger, base_class_id: ADVENT_GUN.id,
  rules_edition: 'aspirant', content_format: 'aspirant', teaser: 'Draws first, V1.', created_at: '2026-03-01T00:00:00Z'
};

const TRIAL = { advent: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false }, aspirant: { state: 'none' } };
const EXPIRED = { advent: { state: 'expired', endedAt: '2026-09-20T12:00:00Z' }, aspirant: { state: 'none' } };

const state = {};
beforeEach(() => {
  state.editionAccess = EXPIRED;
  state.allowedIds = new Set();
  state.gated = true;
  state.characterClass = ADVENT_GUN;
});

const overrides = new Map([
  [require.resolve('../models/_base'), { supabase: {}, supabaseAdmin: {}, anonKey: 'test-anon-key', createUserClient: () => ({}) }],
  [require.resolve('../models/auth'), { getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false) }],
  [require.resolve('../models/profile'), {
    getProfile: async () => ({ id: 'p1', user_id: 'u1', role: 'user', timezone: 'UTC' }),
    getProfileById: async () => ({ data: null, error: null }),
    getProfileConduitCredits: async () => ({ data: null, error: null })
  }],
  [require.resolve('../models/character'), {
    getCharacter: async () => ({
      data: {
        id: CHARACTER_ID, name: 'Vex', class_id: state.characterClass.id, creator_id: 'p1', is_public: true,
        level: 1, abilities: [], gear: [], traits: [], stat_cap_purchases: [], ability_perks: [], common_items: []
      },
      error: null
    }),
    getCharacterRecentMissions: async () => ({ data: [] })
  }],
  [require.resolve('../models/offscreen-mission'), { listOffscreenMissions: async () => ({ data: [] }) }],
  [require.resolve('../services/character/repository'), {
    getClassFamilyRows: async () => ({ data: [] }),
    getRealMissions: async () => ({ data: [] })
  }],
  [require.resolve('../services/character/description-gate'), {
    applyDescriptionGate: async ({ character }) => ({ character, gated: state.gated })
  }],
  [require.resolve('../models/class'), {
    getClass: async () => ({ data: state.characterClass, error: null }),
    getClasses: async (filters = {}) => {
      if (filters.is_player_created === true) return { data: [], error: null };
      if (filters.rules_edition === 'aspirant') return { data: [ASPIRANT_GUN], error: null };
      return { data: [ADVENT_GUN], error: null };
    },
    getUnlockedClassIdsForUser: async () => ({
      data: state.allowedIds,
      rosterIdsByEdition: { advent: new Set([ADVENT_GUN.id]), aspirant: new Set([ASPIRANT_GUN.id]) },
      error: null
    })
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
  app.use('/characters', freshRequire(require.resolve('./characters'), overrides));
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

test('a sheet whose Advent descriptions were hidden by a lapsed trial says so', async () => {
  const { view, ctx } = await get(`/characters/${CHARACTER_ID}/Vex`);
  expect(view).toBe('character');
  expect(ctx.adventTrialEndedAt).toBe('2026-09-20T12:00:00Z');
});

test('a sheet with nothing hidden carries no alert', async () => {
  state.gated = false;
  const { ctx } = await get(`/characters/${CHARACTER_ID}/Vex`);
  expect(ctx.adventTrialEndedAt).toBeNull();
});

test('an Aspirant character hidden from a lapsed Advent trialist does not blame the trial', async () => {
  state.characterClass = ASPIRANT_GUN;
  const { ctx } = await get(`/characters/${CHARACTER_ID}/Vex`);
  expect(ctx.adventTrialEndedAt).toBeNull();
});

test('a running trial carries no expiry alert', async () => {
  state.editionAccess = TRIAL;
  const { ctx } = await get(`/characters/${CHARACTER_ID}/Vex`);
  expect(ctx.adventTrialEndedAt).toBeNull();
});

const wizardIds = (ctx) => ctx.wizardData.classes.map(c => c.id);

test('a lapsed Advent trial keeps the Advent class in the wizard as a locked teaser only', async () => {
  const { view, ctx } = await get('/characters/wizard?mode=advent');
  expect(view).toBe('character-wizard');
  expect(ctx.lockedClassGroups).toEqual([{
    edition: 'advent',
    classes: [{
      id: ADVENT_GUN.id, name: 'Gunslinger', rules_edition: 'advent', content_format: 'advent',
      teaser_html: expect.stringContaining('Quick on the draw.'), locked: true
    }]
  }]);
  expect(JSON.stringify(ctx.lockedClassGroups)).not.toContain('SECRET');
  expect(wizardIds(ctx)).not.toContain(ADVENT_GUN.id);
  expect(ctx.adventTrialEndedAt).toBe('2026-09-20T12:00:00Z');
});

test('the Aspirant wizard teases the Aspirant fork under Aspirant and shows no Advent-trial alert', async () => {
  const { ctx } = await get('/characters/wizard?mode=aspirant');
  expect(ctx.lockedClassGroups.map(g => ({ edition: g.edition, ids: g.classes.map(c => c.id) })))
    .toEqual([{ edition: 'aspirant', ids: [ASPIRANT_GUN.id] }]);
  expect(ctx.adventTrialEndedAt).toBeNull();
});

test('an Advent trial user plays the Advent class and sees only Aspirant locked', async () => {
  state.editionAccess = TRIAL;
  state.allowedIds = new Set([ADVENT_GUN.id]);
  const advent = (await get('/characters/wizard?mode=advent')).ctx;
  expect(advent.lockedClassGroups).toEqual([]);
  expect(wizardIds(advent)).toContain(ADVENT_GUN.id);
  expect(advent.adventTrialEndedAt).toBeNull();
  const aspirant = (await get('/characters/wizard?mode=aspirant')).ctx;
  expect(aspirant.lockedClassGroups.map(g => g.edition)).toEqual(['aspirant']);
});

test('the aspiring builder gets no locked list and no Advent-trial alert', async () => {
  const { ctx } = await get('/characters/wizard?mode=aspiring');
  expect(ctx.lockedClassGroups).toEqual([]);
  expect(ctx.adventTrialEndedAt).toBeNull();
});

test('the expert form lists both locked editions and the lapsed-trial alert', async () => {
  const { view, ctx } = await get('/characters/new/expert');
  expect(view).toBe('character-form');
  expect(ctx.lockedClassGroups.map(g => g.edition)).toEqual(['advent', 'aspirant']);
  expect(ctx.adventTrialEndedAt).toBe('2026-09-20T12:00:00Z');
});

test('no edition status, no locked options', async () => {
  state.editionAccess = null;
  const { ctx } = await get('/characters/new/expert');
  expect(ctx.lockedClassGroups).toEqual([]);
  expect(ctx.adventTrialEndedAt).toBeNull();
});
