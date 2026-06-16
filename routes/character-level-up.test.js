// routes/character-level-up.test.js
//
// Regression test for the level-up commissary_reward bug: POST
// /characters/:id/level-up backfills real success missions (each worth
// MERX_PER_MISSION_SUCCESS), but the route wrote level/completed_missions as
// raw columns and never updated commissary_reward. Because the character detail
// page renders the *stored* commissary_reward, the reward was understated until
// some other auto_calculate save re-derived it. The route must re-derive all of
// level/completed_missions/commissary_reward from the resulting rows.
//
// We run the REAL isAuthenticated middleware and the REAL route handler against
// a mocked data layer (mirroring routes/missions.test.js), with an in-memory
// `_base` fake (mirroring models/character-update.test.js) so the route's
// supabaseAdmin-backed character update writes to an inspectable store.
const { test, expect, mock, beforeAll, afterAll, beforeEach } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Capture real modules up front so afterAll can restore them — bun's
// mock.module is process-global and would otherwise leak into other files.
const realBase = require('../models/_base');
const realSupabase = require('../util/supabase');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');
const realOffscreen = require('../models/offscreen-mission');

const CHAR_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = 'p1';

// Monotonic id source for the in-memory fake's inserts (models gen_random_uuid).
let insertSeq = 0;

// In-memory admin store holding the character row the route updates. Kept as a
// stable reference (the _base mock closes over it at require time); beforeEach
// mutates `.characters` rather than reassigning so the closure stays valid.
const adminTables = { characters: [] };

// Minimal chainable PostgREST-shaped fake (subset of character-update.test.js's
// makeClient) — enough for update().eq().eq().select().single() and reads.
const makeClient = (tables) => ({
  from(table) {
    const filters = [];
    let writeKind = null;
    let writePayload = null;
    const applyFilters = (rows) => rows.filter(r => filters.every(([col, val]) => r[col] === val));
    const settleRead = () => ({ data: applyFilters(tables[table] ?? []), error: null });
    const settleWrite = () => {
      const all = tables[table] ?? [];
      if (writeKind === 'update') {
        const updated = [];
        tables[table] = all.map(r => {
          if (filters.every(([c, v]) => r[c] === v)) {
            const next = { ...r, ...writePayload };
            updated.push(next);
            return next;
          }
          return r;
        });
        return { data: updated, error: null };
      }
      if (writeKind === 'insert') {
        const raw = Array.isArray(writePayload) ? writePayload : [writePayload];
        // Model gen_random_uuid(): rows without an id get a generated one.
        const rows = raw.map(r => (r && r.id == null ? { ...r, id: `gen-${++insertSeq}` } : r));
        tables[table] = [...all, ...rows];
        return { data: rows, error: null };
      }
      return settleRead();
    };
    const settle = () => (writeKind ? settleWrite() : settleRead());
    const chain = {
      select() { return chain; },
      eq(col, val) { filters.push([col, val]); return chain; },
      order() { return chain; },
      limit() { return chain; },
      update(payload) { writeKind = 'update'; writePayload = payload; return chain; },
      insert(payload) { writeKind = 'insert'; writePayload = payload; return chain; },
      single() {
        const { data } = settle();
        const rows = Array.isArray(data) ? data : (data == null ? [] : [data]);
        if (rows.length !== 1) {
          return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'no/multiple rows' } });
        }
        return Promise.resolve({ data: rows[0], error: null });
      },
      maybeSingle() {
        const { data } = settle();
        const row = Array.isArray(data) ? (data[0] ?? null) : data;
        return Promise.resolve({ data: row, error: null });
      },
      then(onF, onR) { return Promise.resolve(settle()).then(onF, onR); }
    };
    return chain;
  }
});

mock.module('../models/_base', () => ({
  supabase: makeClient({}),
  supabaseAdmin: makeClient(adminTables),
  createUserClient: () => makeClient({}),
  anonKey: 'test-anon-key',
}));

mock.module('../util/supabase', () => ({
  // Consumed by the real isAuthenticated middleware:
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
  getProfile: async () => ({ id: PROFILE_ID, user_id: 'u1' }),
  // Consumed by the route under test:
  getCharacter: async () => ({
    data: {
      id: CHAR_ID,
      creator_id: PROFILE_ID,
      name: 'Tango',
      level: 1,
      completed_missions: 0,
      commissary_reward: 0,
      class_id: 'c1',
      gear: [],
      common_items: [],
    },
    error: null,
  }),
  createMission: async () => ({ data: [{ id: 'mission-1' }], error: null }),
  addCharacterToMission: async () => ({ data: [{}], error: null }),
  getClass: async () => ({ data: { id: 'c1', rules_version: 'v1' }, error: null }),
  // After backfilling 2 success missions, derivation reads them back:
  getCharacterRealMissionsForDerivation: async () => ({
    data: [{ outcome: 'success' }, { outcome: 'success' }],
    error: null,
  }),
}));

mock.module('../models/offscreen-mission', () => ({
  listOffscreenMissions: async () => ({ data: [], error: null }),
  getAvailableHostedMissionsForPicker: async () => ({ data: [], error: null }),
  createOffscreenMission: async () => ({ data: {}, error: null }),
  getOffscreenMissionById: async () => ({ data: null, error: null }),
  updateOffscreenMission: async () => ({ data: {}, error: null }),
  removeOffscreenMission: async () => ({ error: null }),
}));

mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next(),
}));

const express = require('express');
let server;
let baseUrl;

beforeAll(() => {
  delete require.cache[require.resolve('./characters')];
  const app = express();
  app.use(express.json());
  app.use('/characters', require('./characters'));
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

afterAll(() => {
  if (server) server.close();
  mock.module('../models/_base', () => realBase);
  mock.module('../util/supabase', () => realSupabase);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../models/offscreen-mission', () => realOffscreen);
});

beforeEach(() => {
  insertSeq = 0;
  adminTables.characters = [{
    id: CHAR_ID,
    creator_id: PROFILE_ID,
    name: 'Tango',
    level: 1,
    completed_missions: 0,
    commissary_reward: 0,
    class_id: 'c1',
  }];
  adminTables.class_abilities = [{ id: 'ab1', character_id: CHAR_ID, class_id: 'c1', name: 'Blink' }];
  adminTables.character_perks = [];
});

test('level-up backfilling real missions updates stored commissary_reward', async () => {
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/level-up`, {
    method: 'POST',
    headers: {
      'authorization': 'Bearer valid-jwt',
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      level: 2,
      completed_missions: 2,
      mission_names: ['Op Alpha', 'Op Bravo'],
      use_conduit_credit: false,
      stats: {},
    }),
  });

  expect(res.status).toBe(200);

  const stored = adminTables.characters.find(c => c.id === CHAR_ID);
  // Two success missions at MERX_PER_MISSION_SUCCESS (1) each, no spend → 2.
  expect(stored.commissary_reward).toBe(2);
  expect(stored.completed_missions).toBe(2);
});

test('level-up resolves compounds_with links for newly-added perks', async () => {
  // An existing perk the new perks can compound with.
  adminTables.character_perks = [
    { id: 'perk-existing', character_id: CHAR_ID, class_ability_id: 'ab1', text: 'Base perk', position: 0, compounds_with: null },
  ];

  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/level-up`, {
    method: 'POST',
    headers: {
      'authorization': 'Bearer valid-jwt',
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      level: 2,
      use_conduit_credit: false,
      stats: {},
      ability_perks: [
        // Compounds with an existing perk (by UUID).
        { class_ability_id: 'ab1', text: 'Compounds with base', ref: 'pA', compounds_with: 'perk-existing' },
        // Compounds with another perk added in the same batch (by ref).
        { class_ability_id: 'ab1', text: 'Chains off A', ref: 'pB', compounds_with: 'new:pA' },
      ],
    }),
  });

  expect(res.status).toBe(200);

  const perks = adminTables.character_perks.filter(p => p.character_id === CHAR_ID);
  const base = perks.find(p => p.text === 'Base perk');
  const a = perks.find(p => p.text === 'Compounds with base');
  const b = perks.find(p => p.text === 'Chains off A');

  expect(a).toBeTruthy();
  expect(b).toBeTruthy();
  // New perks are appended after the existing one.
  expect(a.position).toBe(1);
  expect(b.position).toBe(2);
  // A compounds with the existing perk; B compounds with the just-inserted A.
  expect(a.compounds_with).toBe('perk-existing');
  expect(b.compounds_with).toBe(a.id);
  // The existing perk is left untouched.
  expect(base.compounds_with).toBeNull();
});
