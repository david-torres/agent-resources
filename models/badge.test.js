// models/badge.test.js
//
// Unit tests for the badge model against a fake supabase client. The fake
// applies .eq() filters only for top-level columns present on the row
// (dotted embedded-resource filters like 'characters.creator_id' pass
// through — those tests provide pre-filtered rows, like rules-unlock-family).
const { mock, test, expect, afterAll, beforeEach } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-key';

const realBase = require('./_base');

// Mutable per-test state.
const state = {
  tables: {},   // table name -> rows
  upserts: [],  // { table, payload, opts }
  deletes: []   // { table, filters }
};

const applyFilters = (rows, filters) =>
  rows.filter(row => filters.every(f => !(f.column in row) || row[f.column] === f.value));

const makeFakeClient = () => ({
  from(table) {
    const chain = {
      _filters: [],
      _op: 'select',
      select() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      eq(column, value) { chain._filters.push({ column, value }); return chain; },
      upsert(payload, opts) {
        chain._op = 'upsert';
        chain._payload = payload;
        state.upserts.push({ table, payload, opts });
        return chain;
      },
      delete() { chain._op = 'delete'; return chain; },
      maybeSingle() {
        const rows = applyFilters(state.tables[table] ?? [], chain._filters);
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      single() {
        const rows = applyFilters(state.tables[table] ?? [], chain._filters);
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(onFulfilled, onRejected) {
        if (chain._op === 'delete') {
          state.deletes.push({ table, filters: chain._filters });
          return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
        }
        if (chain._op === 'upsert') {
          return Promise.resolve({ data: chain._payload, error: null }).then(onFulfilled, onRejected);
        }
        const rows = applyFilters(state.tables[table] ?? [], chain._filters);
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      }
    };
    return chain;
  },
  storage: {
    from: () => ({
      getPublicUrl: (p) => ({ data: { publicUrl: `https://cdn.test/badges/${p}` } })
    })
  }
});

const fakeClient = makeFakeClient();
mock.module('./_base', () => ({
  supabase: fakeClient,
  supabaseAdmin: fakeClient,
  anonKey: 'test-anon-key',
  createUserClient: () => fakeClient
}));

delete require.cache[require.resolve('./badge')];
const badge = require('./badge');

afterAll(() => {
  mock.module('./_base', () => realBase);
  delete require.cache[require.resolve('./badge')];
});

beforeEach(() => {
  state.tables = {};
  state.upserts.length = 0;
  state.deletes.length = 0;
});

// ---------------------------------------------------------------------------
// getMissionCounters
// ---------------------------------------------------------------------------

test('counters dedupe: two of your characters on one mission count it once', async () => {
  state.tables = {
    // Pre-filtered to this profile's characters (dotted filter passes through).
    mission_characters: [
      { mission_id: 'm1' },
      { mission_id: 'm1' },   // second character, same mission
      { mission_id: 'm2' }
    ],
    missions: []
  };
  const { data, error } = await badge.getMissionCounters('p1');
  expect(error).toBeNull();
  expect(data).toEqual({ newcomer: 2, player: 2, conduit: 0 });
});

test('counters: hosting a mission you also played counts once for newcomer', async () => {
  state.tables = {
    mission_characters: [{ mission_id: 'm1' }],
    missions: [{ id: 'm1', host_id: 'p1' }, { id: 'm2', host_id: 'p1' }]
  };
  const { data, error } = await badge.getMissionCounters('p1');
  expect(error).toBeNull();
  // played m1; hosted m1 and m2 => newcomer counts {m1, m2}
  expect(data).toEqual({ newcomer: 2, player: 1, conduit: 2 });
});

test('counters: zero everywhere for an unseen profile', async () => {
  state.tables = { mission_characters: [], missions: [] };
  const { data, error } = await badge.getMissionCounters('p-none');
  expect(error).toBeNull();
  expect(data).toEqual({ newcomer: 0, player: 0, conduit: 0 });
});
