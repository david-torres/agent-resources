// models/mission-badges.test.js
//
// Mission mutations must trigger milestone-badge recalculation for every
// affected profile — host + character creators — including profiles captured
// BEFORE destructive changes (delete/merge).
const { mock, test, expect, afterAll, beforeEach } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || 'test-secret-key';

const realBase = require('./_base');
const realBadge = require('./badge');

// --- recording badge fake -------------------------------------------------
const recalcCalls = [];          // arrays of profile ids per invocation
let missionProfileIds = {};      // missionId -> ids returned by getMissionProfileIds

mock.module('./badge', () => ({
  recalcMilestoneBadgesSafely: async (ids) => { recalcCalls.push(ids); },
  getMissionProfileIds: async (missionId) => missionProfileIds[missionId] || []
}));

// --- minimal supabase fake -------------------------------------------------
const state = { tables: {} };

const applyFilters = (rows, filters) =>
  rows.filter(row => filters.every(f => !(f.column in row) || row[f.column] === f.value));

const makeChain = (table) => {
  const chain = {
    _filters: [],
    _op: 'select',
    select() { return chain; },
    order() { return chain; },
    insert(payload) { chain._op = 'insert'; chain._payload = payload; return chain; },
    update(payload) { chain._op = 'update'; chain._payload = payload; return chain; },
    upsert(payload) { chain._op = 'upsert'; chain._payload = payload; return chain; },
    delete() { chain._op = 'delete'; return chain; },
    eq(column, value) { chain._filters.push({ column, value }); return chain; },
    maybeSingle() {
      const rows = applyFilters(state.tables[table] ?? [], chain._filters);
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    single() {
      const rows = applyFilters(state.tables[table] ?? [], chain._filters);
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then(onFulfilled, onRejected) {
      if (chain._op === 'select') {
        const rows = applyFilters(state.tables[table] ?? [], chain._filters);
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      }
      const data = chain._op === 'delete' ? null : [chain._payload].flat();
      return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
    }
  };
  return chain;
};

const fakeClient = {
  from: (table) => makeChain(table),
  rpc: async () => ({ error: null })
};

mock.module('./_base', () => ({
  supabase: fakeClient,
  supabaseAdmin: fakeClient,
  anonKey: 'test-anon-key',
  createUserClient: () => fakeClient
}));

delete require.cache[require.resolve('./mission')];
const mission = require('./mission');

afterAll(() => {
  mock.module('./_base', () => realBase);
  mock.module('./badge', () => realBadge);
  delete require.cache[require.resolve('./mission')];
  delete require.cache[require.resolve('./badge')];
});

beforeEach(() => {
  recalcCalls.length = 0;
  missionProfileIds = {};
  state.tables = {};
});

const PROFILE = { id: 'p-creator' };

test('createMission recalcs the host', async () => {
  await mission.createMission({ name: 'M', date: '2026-06-06', host_id: 'p-host' }, PROFILE);
  expect(recalcCalls).toEqual([['p-host']]);
});

test('createMission without a host does not recalc', async () => {
  await mission.createMission({ name: 'M', date: '2026-06-06' }, PROFILE);
  expect(recalcCalls).toEqual([]);
});

test('updateMission recalcs old and new host', async () => {
  state.tables = {
    missions: [{ id: 'm1', creator_id: 'p-creator', host_id: 'p-old-host' }]
  };
  await mission.updateMission('m1', { host_id: 'p-new-host' }, PROFILE);
  expect(recalcCalls).toEqual([['p-old-host', 'p-new-host']]);
});

test('deleteMission recalcs profiles captured before the delete', async () => {
  missionProfileIds = { m1: ['p-host', 'p-a'] };
  state.tables = { missions: [{ id: 'm1', creator_id: 'p-creator' }] };
  await mission.deleteMission('m1', PROFILE);
  expect(recalcCalls).toEqual([['p-host', 'p-a']]);
});

test("addCharacterToMission recalcs the character's creator", async () => {
  state.tables = { characters: [{ id: 'c1', creator_id: 'p-owner' }] };
  await mission.addCharacterToMission('m1', 'c1');
  expect(recalcCalls).toEqual([['p-owner']]);
});

test("removeCharacterFromMission recalcs the character's creator", async () => {
  state.tables = { characters: [{ id: 'c1', creator_id: 'p-owner' }] };
  await mission.removeCharacterFromMission('m1', 'c1');
  expect(recalcCalls).toEqual([['p-owner']]);
});

test('mergeMissions recalcs profiles from both missions captured before the merge', async () => {
  missionProfileIds = { 'm-primary': ['p-a', 'p-b'], 'm-secondary': ['p-b', 'p-c'] };
  state.tables = {
    // Both missions must exist: canEditMission checks each before the merge.
    missions: [
      { id: 'm-primary', creator_id: 'p-creator', host_id: null, characters: [] },
      { id: 'm-secondary', creator_id: 'p-creator', host_id: null, characters: [] }
    ],
    mission_editors: []
  };
  await mission.mergeMissions('m-primary', 'm-secondary', PROFILE);
  expect(recalcCalls).toEqual([['p-a', 'p-b', 'p-b', 'p-c']]); // recalcSafely dedupes internally
});
