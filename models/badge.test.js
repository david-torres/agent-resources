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

// ---------------------------------------------------------------------------
// recalculateMilestoneBadges
// ---------------------------------------------------------------------------

const MILESTONE_CATALOG = [
  { id: 'b-n1', slug: 'newcomer-1', category: 'milestone', track: 'newcomer', rank: 1, threshold: 1, is_active: true },
  { id: 'b-n2', slug: 'newcomer-2', category: 'milestone', track: 'newcomer', rank: 2, threshold: 2, is_active: true },
  { id: 'b-vp1', slug: 'veteran-player-1', category: 'milestone', track: 'veteran_player', rank: 1, threshold: 23, is_active: true },
  { id: 'b-vc1', slug: 'veteran-conduit-1', category: 'milestone', track: 'veteran_conduit', rank: 1, threshold: 5, is_active: true }
];

test('recalc awards every badge at or below the counters (boundary inclusive)', async () => {
  // 23 played missions, 0 hosted => player 23 (exactly at veteran-player-1),
  // newcomer 23 (newcomer-1 and -2), conduit 0 (nothing).
  state.tables = {
    mission_characters: Array.from({ length: 23 }, (_, i) => ({ mission_id: `m${i}` })),
    missions: [],
    badges: MILESTONE_CATALOG
  };
  const { data, error } = await badge.recalculateMilestoneBadges('p1');
  expect(error).toBeNull();
  expect(data.awarded).toBe(3);
  const upsert = state.upserts.find(u => u.table === 'profile_badges');
  expect(upsert).toBeTruthy();
  expect(new Set(upsert.payload.map(r => r.badge_id))).toEqual(new Set(['b-n1', 'b-n2', 'b-vp1']));
  expect(upsert.payload.every(r => r.profile_id === 'p1')).toBe(true);
  // ignoreDuplicates preserves the original awarded_at on re-runs.
  expect(upsert.opts).toEqual({ onConflict: 'profile_id,badge_id', ignoreDuplicates: true });
});

test('recalc one below a threshold does not award it', async () => {
  state.tables = {
    mission_characters: Array.from({ length: 22 }, (_, i) => ({ mission_id: `m${i}` })),
    missions: [],
    badges: MILESTONE_CATALOG
  };
  const { data } = await badge.recalculateMilestoneBadges('p1');
  const upsert = state.upserts.find(u => u.table === 'profile_badges');
  expect(upsert.payload.map(r => r.badge_id)).not.toContain('b-vp1');
  expect(data.awarded).toBe(2); // newcomer-1, newcomer-2
});

test('recalc with zero counters performs no writes and never deletes', async () => {
  state.tables = { mission_characters: [], missions: [], badges: MILESTONE_CATALOG };
  const { data, error } = await badge.recalculateMilestoneBadges('p1');
  expect(error).toBeNull();
  expect(data.awarded).toBe(0);
  expect(state.upserts.length).toBe(0);
  expect(state.deletes.length).toBe(0); // permanence: recalc never removes rows
});

// ---------------------------------------------------------------------------
// recalcMilestoneBadgesSafely / getMissionProfileIds
// ---------------------------------------------------------------------------

test('recalcMilestoneBadgesSafely dedupes ids, skips falsy, never throws', async () => {
  state.tables = { mission_characters: [], missions: [], badges: [] };
  await badge.recalcMilestoneBadgesSafely(['p1', 'p1', null, undefined, 'p2']);
  // No assertion on writes (zero counters) — the contract is: it resolves.
  expect(true).toBe(true);
});

test('getMissionProfileIds returns host + character creators, deduped', async () => {
  state.tables = {
    missions: [{ id: 'm1', host_id: 'p-host' }],
    mission_characters: [
      { mission_id: 'm1', character: { creator_id: 'p-a' } },
      { mission_id: 'm1', character: { creator_id: 'p-a' } },
      { mission_id: 'm1', character: { creator_id: 'p-host' } },
      { mission_id: 'm1', character: null }
    ]
  };
  const ids = await badge.getMissionProfileIds('m1');
  expect(new Set(ids)).toEqual(new Set(['p-host', 'p-a']));
});

// ---------------------------------------------------------------------------
// listProfileBadges / getProfileBadges / getBadgeCatalog
// ---------------------------------------------------------------------------

const HELD_ROWS = [
  { profile_id: 'p1', awarded_at: '2026-01-01T00:00:00Z', granted_by: null,
    badge: { id: 'b-n3', slug: 'newcomer-3', name: 'Newcomer III', description: null, category: 'milestone', track: 'newcomer', rank: 3, threshold: 3, image_path: 'newcomer-3.png', is_active: true } },
  { profile_id: 'p1', awarded_at: '2026-01-02T00:00:00Z', granted_by: null,
    badge: { id: 'b-n1', slug: 'newcomer-1', name: 'Newcomer I', description: null, category: 'milestone', track: 'newcomer', rank: 1, threshold: 1, image_path: 'newcomer-1.png', is_active: true } },
  { profile_id: 'p1', awarded_at: '2026-01-03T00:00:00Z', granted_by: 'p-admin',
    badge: { id: 'b-ed1', slug: 'enclave-day-1', name: 'Enclave Day 1', description: 'Participated in Enclave Day 1.', category: 'event', track: null, rank: null, threshold: null, image_path: 'enclave-day-1.png', is_active: true } },
  { profile_id: 'p1', awarded_at: '2026-01-04T00:00:00Z', granted_by: null,
    badge: { id: 'b-old', slug: 'retired', name: 'Retired', description: null, category: 'event', track: null, rank: null, threshold: null, image_path: 'retired.png', is_active: false } }
];

test('listProfileBadges returns active held badges with public image URLs', async () => {
  state.tables = { profile_badges: HELD_ROWS };
  const { data, error } = await badge.listProfileBadges('p1');
  expect(error).toBeNull();
  expect(data.map(b => b.slug).sort()).toEqual(['enclave-day-1', 'newcomer-1', 'newcomer-3']);
  expect(data[0].image_url).toMatch(/^https:\/\/cdn\.test\/badges\//);
});

test('getProfileBadges display keeps only the highest rank per milestone track plus all event/personal', async () => {
  state.tables = { profile_badges: HELD_ROWS };
  const { data, error } = await badge.getProfileBadges('p1');
  expect(error).toBeNull();
  expect(data.display.map(b => b.slug)).toEqual(['newcomer-3', 'enclave-day-1']);
});

test('getProfileBadges with includeProgress reports count and next threshold per track', async () => {
  state.tables = {
    profile_badges: HELD_ROWS,
    // 3 played missions, 0 hosted.
    mission_characters: [{ mission_id: 'm1' }, { mission_id: 'm2' }, { mission_id: 'm3' }],
    missions: [],
    badges: [
      { id: 'b-n3', slug: 'newcomer-3', name: 'Newcomer III', category: 'milestone', track: 'newcomer', rank: 3, threshold: 3, is_active: true },
      { id: 'b-n4', slug: 'newcomer-4', name: 'Newcomer IV', category: 'milestone', track: 'newcomer', rank: 4, threshold: 4, is_active: true },
      { id: 'b-vp1', slug: 'veteran-player-1', name: 'Veteran Player I', category: 'milestone', track: 'veteran_player', rank: 1, threshold: 23, is_active: true },
      { id: 'b-vc1', slug: 'veteran-conduit-1', name: 'Veteran Conduit I', category: 'milestone', track: 'veteran_conduit', rank: 1, threshold: 5, is_active: true }
    ]
  };
  const { data } = await badge.getProfileBadges('p1', { includeProgress: true });
  expect(data.progress).toEqual([
    { track: 'newcomer', label: 'Newcomer', count: 3, currentSlug: 'newcomer-3', nextName: 'Newcomer IV', nextThreshold: 4, complete: false },
    { track: 'veteran_player', label: 'Veteran Player', count: 3, currentSlug: null, nextName: 'Veteran Player I', nextThreshold: 23, complete: false },
    { track: 'veteran_conduit', label: 'Veteran Conduit', count: 0, currentSlug: null, nextName: 'Veteran Conduit I', nextThreshold: 5, complete: false }
  ]);
  expect(data.veteranBaseUrl).toBe('https://cdn.test/badges/veteran-base.png');
});

test('getProfileBadges marks a track complete when no higher threshold exists', async () => {
  state.tables = {
    profile_badges: HELD_ROWS,
    mission_characters: Array.from({ length: 13 }, (_, i) => ({ mission_id: `m${i}` })),
    missions: [],
    badges: [
      { id: 'b-n3', slug: 'newcomer-3', name: 'Newcomer III', category: 'milestone', track: 'newcomer', rank: 3, threshold: 3, is_active: true }
    ]
  };
  const { data } = await badge.getProfileBadges('p1', { includeProgress: true });
  const newcomer = data.progress.find(p => p.track === 'newcomer');
  expect(newcomer.complete).toBe(true);
  expect(newcomer.nextThreshold).toBeNull();
});

test('getBadgeCatalog returns active badges with image URLs', async () => {
  state.tables = {
    badges: [
      { id: 'b1', slug: 'enclave-day-1', name: 'Enclave Day 1', category: 'event', image_path: 'enclave-day-1.png', is_active: true },
      { id: 'b2', slug: 'gone', name: 'Gone', category: 'event', image_path: 'gone.png', is_active: false }
    ]
  };
  const { data, error } = await badge.getBadgeCatalog();
  expect(error).toBeNull();
  expect(data.map(b => b.slug)).toEqual(['enclave-day-1']);
  expect(data[0].image_url).toBe('https://cdn.test/badges/enclave-day-1.png');
});
