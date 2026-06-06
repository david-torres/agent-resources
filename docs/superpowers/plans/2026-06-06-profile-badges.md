# Profile Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Milestone badges (Newcomer / Veteran Player / Veteran Conduit) awarded automatically from mission counters, plus admin-granted event/personal badges, displayed on profiles and retroactively backfilled.

**Architecture:** Two new tables (`badges` catalog + `profile_badges` awards). A new `models/badge.js` computes per-profile mission counters and upsert-ignores newly crossed milestone thresholds (insert-only ⇒ badges are permanent). `models/mission.js` mutation functions call the recalc hook non-blockingly. Idempotent seed + backfill scripts. Admin grant/revoke routes and a badge shelf partial on profile pages.

**Tech Stack:** Bun + Express + Handlebars (hx-boost) + Supabase (Postgres, Storage, RLS). Tests with `bun:test` + `mock.module` fakes of `models/_base.js`.

**Spec:** `docs/superpowers/specs/2026-06-06-profile-badges-design.md`

---

## Conventions used throughout

- Run all tests: `bun test` — run one file: `bun test models/badge.test.js`
- Model functions return `{ data, error }`, log via `console.error`, and never throw (match `models/rules.js`).
- All badge reads/writes use `supabaseAdmin`: private missions count toward badges and badge data is public display data; writes are gated by `requireAdmin` routes or internal hooks.
- Threshold ladders (fixed by spec — do not change):
  - newcomer: 1,2,3,4,5,6,7,8,9,10,11,12 then **Final at 13**
  - veteran_player: 23,25,28,32,37,43,50,58,67,77,88,100
  - veteran_conduit: 5,7,10,14,19,25,32,40,49,59,70,82
- Counter definitions (per profile, each mission counts at most once per counter):
  - **player** = distinct `mission_id` in `mission_characters` joined to characters with `creator_id` = profile
  - **conduit** = count of `missions` with `host_id` = profile
  - **newcomer** = size of the union of the player mission-id set and the conduit mission-id set

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260606_profile_badges.sql`
- Modify: `schema.sql` (append the same DDL at the end)

No TDD (schema change).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260606_profile_badges.sql`:

```sql
-- Profile badges: catalog + per-profile awards. Milestone badges are awarded
-- automatically from mission counters (insert-only => permanent); event and
-- personal badges are granted/revoked by admins.
-- Spec: docs/superpowers/specs/2026-06-06-profile-badges-design.md

CREATE TABLE IF NOT EXISTS badges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,            -- 'newcomer-3', 'veteran-player-12', 'enclave-day-7'
    name text NOT NULL,                   -- 'Newcomer III', 'Enclave Day 7'
    description text,
    category text NOT NULL CHECK (category IN ('milestone', 'event', 'personal')),
    track text CHECK (track IN ('newcomer', 'veteran_player', 'veteran_conduit')),
    rank int,                             -- 1..13 within a track (milestone only)
    threshold int,                        -- counter value that earns it (milestone only)
    image_path text NOT NULL,             -- path within the public 'badges' storage bucket
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profile_badges (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    badge_id uuid NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    awarded_at timestamptz NOT NULL DEFAULT now(),
    granted_by uuid REFERENCES profiles(id),   -- NULL = earned automatically
    PRIMARY KEY (profile_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_badges_profile ON profile_badges(profile_id);
CREATE INDEX IF NOT EXISTS idx_badges_category ON badges(category);

ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_badges ENABLE ROW LEVEL SECURITY;

-- Catalog and awards are public display data (badge shelves render on public
-- profiles). Writes go through the service-role client in the model layer;
-- the admin policies mirror rules_pdf_unlock_codes.
DROP POLICY IF EXISTS "badges_select_all" ON badges;
CREATE POLICY "badges_select_all" ON badges FOR SELECT USING (true);
DROP POLICY IF EXISTS "badges_admin_all" ON badges;
CREATE POLICY "badges_admin_all" ON badges FOR ALL USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "profile_badges_select_all" ON profile_badges;
CREATE POLICY "profile_badges_select_all" ON profile_badges FOR SELECT USING (true);
DROP POLICY IF EXISTS "profile_badges_admin_all" ON profile_badges;
CREATE POLICY "profile_badges_admin_all" ON profile_badges FOR ALL USING (is_admin()) WITH CHECK (is_admin());
```

- [ ] **Step 2: Append the same DDL to `schema.sql`**

Append the entire SQL block above (without the leading comment block, with a `-- Profile badges` header comment) to the end of `schema.sql`, matching how `rules_pdf_unlock_codes` was mirrored.

- [ ] **Step 3: Apply the migration to the database**

```bash
PGPASSWORD="$SUPABASE_DB_PASS" psql \
  -h aws-0-us-east-1.pooler.supabase.com -p 5432 \
  -U postgres.ndneltuukvijkvdfaqfu -d postgres \
  -f supabase/migrations/20260606_profile_badges.sql
```

(Same connection parameters as `scripts/db-backup.sh`. If `SUPABASE_DB_PASS` is unavailable in this environment, run the file in the Supabase SQL editor and note that in the commit message.)

Expected: `CREATE TABLE` ×2, `CREATE INDEX` ×2, `ALTER TABLE` ×2, `CREATE POLICY` ×4.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260606_profile_badges.sql schema.sql
git commit -m "feat: badges + profile_badges tables with RLS"
```

---

### Task 2: Badge model — mission counters

**Files:**
- Create: `models/badge.js`
- Create: `models/badge.test.js`

- [ ] **Step 1: Write the failing tests (including the shared fake client used by all badge tests)**

Create `models/badge.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test models/badge.test.js`
Expected: FAIL — `Cannot find module './badge'`

- [ ] **Step 3: Write the minimal implementation**

Create `models/badge.js`:

```js
const { supabase, supabaseAdmin } = require('./_base');

const BADGES_BUCKET = process.env.SUPABASE_BADGES_BUCKET || 'badges';

const MILESTONE_TRACKS = ['newcomer', 'veteran_player', 'veteran_conduit'];

// Counters deliberately use supabaseAdmin: private missions count toward
// badges, and the shared anon client (no JWT) would be RLS-filtered.
const getMissionCounters = async (profileId) => {
  const { data: playedRows, error: playedError } = await supabaseAdmin
    .from('mission_characters')
    .select('mission_id, characters!inner(creator_id)')
    .eq('characters.creator_id', profileId);
  if (playedError) {
    console.error(playedError);
    return { data: null, error: playedError };
  }

  const { data: hostedRows, error: hostedError } = await supabaseAdmin
    .from('missions')
    .select('id')
    .eq('host_id', profileId);
  if (hostedError) {
    console.error(hostedError);
    return { data: null, error: hostedError };
  }

  const playedIds = new Set((playedRows || []).map(r => r.mission_id));
  const hostedIds = new Set((hostedRows || []).map(r => r.id));
  const newcomerIds = new Set([...playedIds, ...hostedIds]);

  return {
    data: {
      newcomer: newcomerIds.size,
      player: playedIds.size,
      conduit: hostedIds.size
    },
    error: null
  };
};

const counterForTrack = (counters, track) => {
  if (track === 'newcomer') return counters.newcomer;
  if (track === 'veteran_player') return counters.player;
  if (track === 'veteran_conduit') return counters.conduit;
  return 0;
};

module.exports = {
  BADGES_BUCKET,
  MILESTONE_TRACKS,
  getMissionCounters
};
```

(`counterForTrack` is module-private; it is exercised through later tasks.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test models/badge.test.js`
Expected: 3 pass

- [ ] **Step 5: Commit**

```bash
git add models/badge.js models/badge.test.js
git commit -m "feat: badge model mission counters"
```

---

### Task 3: Badge model — milestone recalculation (insert-only)

**Files:**
- Modify: `models/badge.js`
- Modify: `models/badge.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `models/badge.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test models/badge.test.js`
Expected: FAIL — `badge.recalculateMilestoneBadges is not a function`

- [ ] **Step 3: Write the implementation**

Add to `models/badge.js` (above `module.exports`):

```js
// Insert-only: badges are permanent once earned. ignoreDuplicates keeps the
// original awarded_at (and any granted_by) on re-runs — backfill and live
// hooks share this single code path so retroactive and ongoing awards
// cannot drift.
const recalculateMilestoneBadges = async (profileId) => {
  const { data: counters, error: countersError } = await getMissionCounters(profileId);
  if (countersError) return { data: null, error: countersError };

  const { data: catalog, error: catalogError } = await supabaseAdmin
    .from('badges')
    .select('id, track, threshold')
    .eq('category', 'milestone')
    .eq('is_active', true);
  if (catalogError) {
    console.error(catalogError);
    return { data: null, error: catalogError };
  }

  const earned = (catalog || []).filter(b =>
    b.track && Number.isFinite(b.threshold) && b.threshold <= counterForTrack(counters, b.track)
  );
  if (earned.length === 0) {
    return { data: { awarded: 0, counters }, error: null };
  }

  const rows = earned.map(b => ({ profile_id: profileId, badge_id: b.id }));
  const { error: upsertError } = await supabaseAdmin
    .from('profile_badges')
    .upsert(rows, { onConflict: 'profile_id,badge_id', ignoreDuplicates: true });
  if (upsertError) {
    console.error(upsertError);
    return { data: null, error: upsertError };
  }
  return { data: { awarded: earned.length, counters }, error: null };
};

// Hook entry point for mission mutations: never throws and never fails the
// caller. A missed/failed recalc self-heals on the next recalc or backfill.
const recalcMilestoneBadgesSafely = async (profileIds) => {
  const unique = [...new Set((profileIds || []).filter(Boolean))];
  for (const profileId of unique) {
    try {
      const { error } = await recalculateMilestoneBadges(profileId);
      if (error) console.error(`Badge recalc failed for profile ${profileId}:`, error);
    } catch (e) {
      console.error(`Badge recalc failed for profile ${profileId}:`, e);
    }
  }
};

// All profiles affected by a mission: host + creators of attached characters.
// Used by delete/merge hooks, which must capture this BEFORE the mutation.
const getMissionProfileIds = async (missionId) => {
  if (!missionId) return [];
  try {
    const [{ data: mission }, { data: rows }] = await Promise.all([
      supabaseAdmin.from('missions').select('host_id').eq('id', missionId).maybeSingle(),
      supabaseAdmin.from('mission_characters').select('character:characters(creator_id)').eq('mission_id', missionId)
    ]);
    const ids = (rows || []).map(r => r.character?.creator_id);
    if (mission?.host_id) ids.push(mission.host_id);
    return [...new Set(ids.filter(Boolean))];
  } catch (e) {
    console.error(`Failed to collect profiles for mission ${missionId}:`, e);
    return [];
  }
};
```

Update `module.exports`:

```js
module.exports = {
  BADGES_BUCKET,
  MILESTONE_TRACKS,
  getMissionCounters,
  recalculateMilestoneBadges,
  recalcMilestoneBadgesSafely,
  getMissionProfileIds
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test models/badge.test.js`
Expected: 8 pass

- [ ] **Step 5: Commit**

```bash
git add models/badge.js models/badge.test.js
git commit -m "feat: insert-only milestone badge recalculation"
```

---

### Task 4: Badge model — catalog, held badges, display + progress

**Files:**
- Modify: `models/badge.js`
- Modify: `models/badge.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `models/badge.test.js`:

```js
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
```

Note: the fake's `eq('is_active', true)` filters `badges` rows because `is_active` is a top-level column; `profile_badges` rows embed `is_active` inside `badge`, so `listProfileBadges` must filter inactive embedded badges in JS.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test models/badge.test.js`
Expected: FAIL — `badge.listProfileBadges is not a function`

- [ ] **Step 3: Write the implementation**

Add to `models/badge.js`:

```js
const badgeImageUrl = (imagePath) =>
  supabaseAdmin.storage.from(BADGES_BUCKET).getPublicUrl(imagePath).data.publicUrl;

const TRACK_LABELS = {
  newcomer: 'Newcomer',
  veteran_player: 'Veteran Player',
  veteran_conduit: 'Veteran Conduit'
};

// Every active badge a profile holds, flat (admin manage page; also the
// basis for the public display shelf).
const listProfileBadges = async (profileId) => {
  const { data: rows, error } = await supabaseAdmin
    .from('profile_badges')
    .select('awarded_at, granted_by, badge:badges(id, slug, name, description, category, track, rank, threshold, image_path, is_active)')
    .eq('profile_id', profileId)
    .order('awarded_at', { ascending: true });
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  const held = (rows || [])
    .filter(r => r.badge && r.badge.is_active)
    .map(r => ({
      ...r.badge,
      awarded_at: r.awarded_at,
      granted_by: r.granted_by,
      image_url: badgeImageUrl(r.badge.image_path)
    }));
  return { data: held, error: null };
};

// Display shelf: highest earned rank per milestone track + all event/personal
// badges. With includeProgress, also returns per-track counters and the next
// unearned threshold (own-profile view).
const getProfileBadges = async (profileId, { includeProgress = false } = {}) => {
  const { data: held, error } = await listProfileBadges(profileId);
  if (error) return { data: null, error };

  const bestByTrack = {};
  const others = [];
  for (const b of held) {
    if (b.category === 'milestone' && b.track) {
      if (!bestByTrack[b.track] || b.rank > bestByTrack[b.track].rank) {
        bestByTrack[b.track] = b;
      }
    } else {
      others.push(b);
    }
  }
  const display = [
    ...MILESTONE_TRACKS.map(t => bestByTrack[t]).filter(Boolean),
    ...others
  ];

  if (!includeProgress) {
    return { data: { display }, error: null };
  }

  const { data: counters, error: countersError } = await getMissionCounters(profileId);
  if (countersError) {
    // Progress is decoration; degrade to display-only rather than failing.
    return { data: { display }, error: null };
  }

  const { data: catalog, error: catalogError } = await supabaseAdmin
    .from('badges')
    .select('track, threshold, name')
    .eq('category', 'milestone')
    .eq('is_active', true)
    .order('threshold', { ascending: true });
  if (catalogError) {
    console.error(catalogError);
    return { data: { display }, error: null };
  }

  const progress = MILESTONE_TRACKS.map(track => {
    const count = counterForTrack(counters, track);
    const next = (catalog || []).find(b => b.track === track && b.threshold > count) || null;
    return {
      track,
      label: TRACK_LABELS[track],
      count,
      currentSlug: bestByTrack[track]?.slug ?? null,
      nextName: next?.name ?? null,
      nextThreshold: next?.threshold ?? null,
      complete: !next
    };
  });

  return {
    data: { display, progress, veteranBaseUrl: badgeImageUrl('veteran-base.png') },
    error: null
  };
};

const getBadgeCatalog = async () => {
  const { data, error } = await supabaseAdmin
    .from('badges')
    .select('*')
    .eq('is_active', true)
    .order('category', { ascending: true })
    .order('track', { ascending: true })
    .order('rank', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data: (data || []).map(b => ({ ...b, image_url: badgeImageUrl(b.image_path) })), error: null };
};
```

Add `listProfileBadges`, `getProfileBadges`, `getBadgeCatalog` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test models/badge.test.js`
Expected: 13 pass

- [ ] **Step 5: Commit**

```bash
git add models/badge.js models/badge.test.js
git commit -m "feat: badge display, progress, and catalog queries"
```

---

### Task 5: Badge model — admin grant/revoke

**Files:**
- Modify: `models/badge.js`
- Modify: `models/badge.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `models/badge.test.js`:

```js
// ---------------------------------------------------------------------------
// grantBadge / revokeBadge
// ---------------------------------------------------------------------------

const GRANT_CATALOG = [
  { id: 'b-ed1', slug: 'enclave-day-1', category: 'event', is_active: true },
  { id: 'b-n1', slug: 'newcomer-1', category: 'milestone', is_active: true },
  { id: 'b-off', slug: 'retired', category: 'event', is_active: false }
];

test('grantBadge upserts an award with granted_by', async () => {
  state.tables = { badges: GRANT_CATALOG };
  const { error } = await badge.grantBadge({ profileId: 'p1', badgeSlug: 'enclave-day-1', grantedById: 'p-admin' });
  expect(error).toBeNull();
  const upsert = state.upserts.find(u => u.table === 'profile_badges');
  expect(upsert.payload).toEqual({ profile_id: 'p1', badge_id: 'b-ed1', granted_by: 'p-admin' });
  expect(upsert.opts).toEqual({ onConflict: 'profile_id,badge_id', ignoreDuplicates: true });
});

test('grantBadge rejects milestone badges', async () => {
  state.tables = { badges: GRANT_CATALOG };
  const { error } = await badge.grantBadge({ profileId: 'p1', badgeSlug: 'newcomer-1', grantedById: 'p-admin' });
  expect(error?.message).toMatch(/milestone/i);
  expect(state.upserts.length).toBe(0);
});

test('grantBadge rejects unknown and inactive badges', async () => {
  state.tables = { badges: GRANT_CATALOG };
  const missing = await badge.grantBadge({ profileId: 'p1', badgeSlug: 'nope', grantedById: 'p-admin' });
  expect(missing.error?.message).toMatch(/not found/i);
  const inactive = await badge.grantBadge({ profileId: 'p1', badgeSlug: 'retired', grantedById: 'p-admin' });
  expect(inactive.error?.message).toMatch(/not found/i);
  expect(state.upserts.length).toBe(0);
});

test('revokeBadge deletes the award row and rejects milestones', async () => {
  state.tables = { badges: GRANT_CATALOG };
  const ok = await badge.revokeBadge({ profileId: 'p1', badgeSlug: 'enclave-day-1' });
  expect(ok.error).toBeNull();
  expect(state.deletes.length).toBe(1);
  expect(state.deletes[0].table).toBe('profile_badges');

  const milestone = await badge.revokeBadge({ profileId: 'p1', badgeSlug: 'newcomer-1' });
  expect(milestone.error?.message).toMatch(/milestone/i);
  expect(state.deletes.length).toBe(1); // unchanged
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test models/badge.test.js`
Expected: FAIL — `badge.grantBadge is not a function`

- [ ] **Step 3: Write the implementation**

Add to `models/badge.js`:

```js
// Admin operations. Milestone badges are automatic-only: enforced here (the
// authoritative gate), not just in the routes.
const findGrantableBadge = async (badgeSlug) => {
  const { data: badgeRow, error } = await supabaseAdmin
    .from('badges')
    .select('id, slug, category, is_active')
    .eq('slug', badgeSlug)
    .maybeSingle();
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  if (!badgeRow || !badgeRow.is_active) {
    return { data: null, error: new Error('Badge not found') };
  }
  if (badgeRow.category === 'milestone') {
    return { data: null, error: new Error('Milestone badges are awarded automatically and cannot be granted or revoked') };
  }
  return { data: badgeRow, error: null };
};

const grantBadge = async ({ profileId, badgeSlug, grantedById }) => {
  const { data: badgeRow, error } = await findGrantableBadge(badgeSlug);
  if (error) return { data: null, error };

  const { error: upsertError } = await supabaseAdmin
    .from('profile_badges')
    .upsert(
      { profile_id: profileId, badge_id: badgeRow.id, granted_by: grantedById || null },
      { onConflict: 'profile_id,badge_id', ignoreDuplicates: true }
    );
  if (upsertError) {
    console.error(upsertError);
    return { data: null, error: upsertError };
  }
  return { data: { slug: badgeRow.slug }, error: null };
};

// Revoking a badge the profile doesn't hold deletes 0 rows — no-op success.
const revokeBadge = async ({ profileId, badgeSlug }) => {
  const { data: badgeRow, error } = await findGrantableBadge(badgeSlug);
  if (error) return { data: null, error };

  const { error: deleteError } = await supabaseAdmin
    .from('profile_badges')
    .delete()
    .eq('profile_id', profileId)
    .eq('badge_id', badgeRow.id);
  if (deleteError) {
    console.error(deleteError);
    return { data: null, error: deleteError };
  }
  return { data: { slug: badgeRow.slug }, error: null };
};
```

Add `grantBadge`, `revokeBadge` to `module.exports`. Final export list for `models/badge.js`:

```js
module.exports = {
  BADGES_BUCKET,
  MILESTONE_TRACKS,
  getMissionCounters,
  recalculateMilestoneBadges,
  recalcMilestoneBadgesSafely,
  getMissionProfileIds,
  listProfileBadges,
  getProfileBadges,
  getBadgeCatalog,
  grantBadge,
  revokeBadge
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test models/badge.test.js`
Expected: 17 pass

- [ ] **Step 5: Commit**

```bash
git add models/badge.js models/badge.test.js
git commit -m "feat: admin badge grant/revoke with milestone guard"
```

---

### Task 6: Admin profile search

**Files:**
- Modify: `models/profile.js` (add `searchProfilesAdmin` next to `searchProfiles` at `models/profile.js:156`)
- Create: `models/profile-search-admin.test.js`

- [ ] **Step 1: Write the failing test**

Create `models/profile-search-admin.test.js`:

```js
// searchProfilesAdmin must use the service-role client (private profiles are
// findable in admin tooling) and keep searchProfiles' short-query guard.
const { mock, test, expect, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-key';

const realBase = require('./_base');

const calls = { admin: 0, anon: 0 };
const makeClient = (key) => ({
  from() {
    calls[key]++;
    const chain = {
      select() { return chain; },
      ilike() { return chain; },
      limit() { return Promise.resolve({ data: [{ id: 'p1', name: 'Hidden User', image_url: null }], error: null }); }
    };
    return chain;
  }
});

mock.module('./_base', () => ({
  supabase: makeClient('anon'),
  supabaseAdmin: makeClient('admin'),
  anonKey: 'test-anon-key',
  createUserClient: () => makeClient('anon')
}));

delete require.cache[require.resolve('./profile')];
const { searchProfilesAdmin } = require('./profile');

afterAll(() => {
  mock.module('./_base', () => realBase);
  delete require.cache[require.resolve('./profile')];
});

test('searchProfilesAdmin queries via the admin client', async () => {
  const { data, error } = await searchProfilesAdmin('hidden');
  expect(error).toBeNull();
  expect(data).toEqual([{ id: 'p1', name: 'Hidden User', image_url: null }]);
  expect(calls.admin).toBe(1);
  expect(calls.anon).toBe(0);
});

test('searchProfilesAdmin returns [] for short queries without querying', async () => {
  calls.admin = 0;
  const { data } = await searchProfilesAdmin('a');
  expect(data).toEqual([]);
  expect(calls.admin).toBe(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test models/profile-search-admin.test.js`
Expected: FAIL — `searchProfilesAdmin is not a function`

- [ ] **Step 3: Write the implementation**

In `models/profile.js`, directly below `searchProfiles`, add:

```js
/**
 * Admin variant of searchProfiles: bypasses RLS so non-public profiles are
 * findable in admin tooling. Only call from requireAdmin-gated routes.
 */
const searchProfilesAdmin = async (query, limit = 10) => {
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return { data: [], error: null };
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, name, image_url')
    .ilike('name', `%${escapeLikePattern(query.trim())}%`)
    .limit(limit);

  return { data, error };
}
```

Add `searchProfilesAdmin` to the `module.exports` list in `models/profile.js`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test models/profile-search-admin.test.js`
Expected: 2 pass

- [ ] **Step 5: Commit**

```bash
git add models/profile.js models/profile-search-admin.test.js
git commit -m "feat: admin profile search for badge management"
```

---

### Task 7: Mission mutation hooks

**Files:**
- Modify: `models/mission.js` (functions: `createMission`, `updateMission`, `deleteMission`, `addCharacterToMission`, `removeCharacterFromMission`, `mergeMissions`)
- Create: `models/mission-badges.test.js`

All web routes and the agent API mutate missions through these model functions, so these six call sites cover every path (verified: `routes/missions.js` is the only consumer of the mutation functions; `routes/agent.js` does not mutate missions).

- [ ] **Step 1: Write the failing tests**

Create `models/mission-badges.test.js`:

```js
// models/mission-badges.test.js
//
// Mission mutations must trigger milestone-badge recalculation for every
// affected profile — host + character creators — including profiles captured
// BEFORE destructive changes (delete/merge).
const { mock, test, expect, afterAll, beforeEach } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-key';

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test models/mission-badges.test.js`
Expected: FAIL — `recalcCalls` assertions (hooks not implemented yet; functions resolve without recording any calls)

- [ ] **Step 3: Implement the hooks in `models/mission.js`**

At the top of `models/mission.js`, after the existing requires:

```js
const { recalcMilestoneBadgesSafely, getMissionProfileIds } = require('./badge');
```

Replace `createMission`:

```js
const createMission = async (missionData, profile) => {
  missionData.creator_id = profile.id;
  sanitizeUrlFields(missionData, ['media_url']);
  const { data, error } = await supabaseAdmin.from('missions').insert(missionData).select();
  if (!error && missionData.host_id) {
    await recalcMilestoneBadgesSafely([missionData.host_id]);
  }
  return { data, error };
};
```

Replace `updateMission`:

```js
const updateMission = async (id, missionData, profile) => {
  // Check if profile can edit this mission (creator, host, or editor)
  const canEdit = await canEditMission(id, profile);
  if (!canEdit) {
    return { data: null, error: 'Unauthorized: You do not have permission to edit this mission' };
  }

  // Capture the current host before the write: a host swap must recalc the
  // outgoing host's badges too (counts only ever ADD badges; this just keeps
  // both profiles' award rows up to date).
  const { data: existing } = await supabaseAdmin
    .from('missions')
    .select('host_id')
    .eq('id', id)
    .maybeSingle();

  sanitizeUrlFields(missionData, ['media_url']);

  const { data, error } = await supabaseAdmin
    .from('missions')
    .update(missionData)
    .eq('id', id)
    .select();
  if (!error) {
    await recalcMilestoneBadgesSafely([existing?.host_id, missionData.host_id]);
  }
  return { data, error };
};
```

Replace `deleteMission`:

```js
const deleteMission = async (id, profile) => {
  // Affected profiles must be captured BEFORE the rows disappear.
  const affected = await getMissionProfileIds(id);
  const { data, error } = await supabaseAdmin
    .from('missions')
    .delete()
    .eq('id', id)
    .eq('creator_id', profile.id);
  if (!error) {
    await recalcMilestoneBadgesSafely(affected);
  }
  return { data, error };
};
```

Replace `addCharacterToMission` and `removeCharacterFromMission`:

```js
const recalcCharacterCreator = async (characterId) => {
  const { data: character } = await supabaseAdmin
    .from('characters')
    .select('creator_id')
    .eq('id', characterId)
    .maybeSingle();
  await recalcMilestoneBadgesSafely([character?.creator_id]);
};

const addCharacterToMission = async (missionId, characterId) => {
  const { data, error } = await supabaseAdmin
    .from('mission_characters')
    .upsert({ mission_id: missionId, character_id: characterId })
    .select();
  if (!error) {
    await recalcCharacterCreator(characterId);
  }
  return { data, error };
};

const removeCharacterFromMission = async (missionId, characterId) => {
  const { data, error } = await supabaseAdmin
    .from('mission_characters')
    .delete()
    .eq('mission_id', missionId)
    .eq('character_id', characterId);
  if (!error) {
    await recalcCharacterCreator(characterId);
  }
  return { data, error };
};
```

In `mergeMissions`, capture affected profiles before the RPC and recalc after success. Replace the body between the `canEdit` check and the return:

```js
const mergeMissions = async (primaryId, secondaryId, profile) => {
  const [canPrimary, canSecondary] = await Promise.all([
    canEditMission(primaryId, profile),
    canEditMission(secondaryId, profile)
  ]);
  if (!canPrimary || !canSecondary) {
    return { data: null, error: 'You must be able to edit both missions to merge them' };
  }

  // Capture BEFORE the merge: the secondary mission's rows are deleted by the RPC.
  const affected = [
    ...(await getMissionProfileIds(primaryId)),
    ...(await getMissionProfileIds(secondaryId))
  ];

  const { error } = await supabaseAdmin.rpc('merge_missions', {
    primary_id: primaryId,
    secondary_id: secondaryId,
    actor_profile_id: profile.id
  });
  if (error) {
    console.error('merge_missions RPC failed:', error);
    return { data: null, error };
  }

  await recalcMilestoneBadgesSafely(affected);

  return await getMission(primaryId);
};
```

- [ ] **Step 4: Run the new tests and the existing mission/route tests**

Run: `bun test models/mission-badges.test.js models/mission.test.js routes/missions.test.js`
Expected: all pass (the hooks must not break existing behavior)

- [ ] **Step 5: Commit**

```bash
git add models/mission.js models/mission-badges.test.js
git commit -m "feat: mission mutations trigger milestone badge recalc"
```

---

### Task 8: Seed script (storage upload + catalog rows)

**Files:**
- Create: `scripts/seed-badges.js`

No TDD (one-shot idempotent ops script, like `util/seed-classes.js`).

- [ ] **Step 1: Write the script**

Create `scripts/seed-badges.js`:

```js
// Seeds the badge system: uploads badge art from public/img/badges/ to the
// public 'badges' storage bucket and upserts catalog rows keyed on slug.
// Idempotent — safe to re-run (uploads use upsert, catalog upserts on slug).
//
// Usage: bun run scripts/seed-badges.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = process.env.SUPABASE_BADGES_BUCKET || 'badges';
const ART_DIR = path.join(__dirname, '..', 'public', 'img', 'badges');

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const PLAYER_THRESHOLDS = [23, 25, 28, 32, 37, 43, 50, 58, 67, 77, 88, 100];
const CONDUIT_THRESHOLDS = [5, 7, 10, 14, 19, 25, 32, 40, 49, 59, 70, 82];

const catalog = [];

// Newcomer 1..12 + Final (13). Counter: distinct missions appeared on,
// playing or conduiting.
for (let i = 1; i <= 12; i++) {
  catalog.push({
    slug: `newcomer-${i}`,
    name: `Newcomer ${ROMAN[i - 1]}`,
    description: `Appeared (playing or conduiting) on ${i} officially logged mission${i === 1 ? '' : 's'}.`,
    category: 'milestone',
    track: 'newcomer',
    rank: i,
    threshold: i,
    file: path.join('AR Newcomer Badges', `AR Badge Newcomer ${i}.png`)
  });
}
catalog.push({
  slug: 'newcomer-final',
  name: 'Newcomer Final',
  description: 'Appeared (playing or conduiting) on 13 officially logged missions. Newcomer track complete.',
  category: 'milestone',
  track: 'newcomer',
  rank: 13,
  threshold: 13,
  file: path.join('AR Newcomer Badges', 'AR Badge Newcomer Final.png')
});

for (let i = 1; i <= 12; i++) {
  catalog.push({
    slug: `veteran-player-${i}`,
    name: `Veteran Player ${ROMAN[i - 1]}`,
    description: `Appeared on ${PLAYER_THRESHOLDS[i - 1]} missions as a player.`,
    category: 'milestone',
    track: 'veteran_player',
    rank: i,
    threshold: PLAYER_THRESHOLDS[i - 1],
    file: path.join('AR Veteran Badges', `AR Badge Veteran Player ${i}.png`)
  });
  catalog.push({
    slug: `veteran-conduit-${i}`,
    name: `Veteran Conduit ${ROMAN[i - 1]}`,
    description: `Hosted ${CONDUIT_THRESHOLDS[i - 1]} missions as conduit.`,
    category: 'milestone',
    track: 'veteran_conduit',
    rank: i,
    threshold: CONDUIT_THRESHOLDS[i - 1],
    file: path.join('More AR Badges', `AR Badge Veteran Conduit ${i}.png`)
  });
}

// Enclave Day 1-14 live in their own folder; 15 shipped later in More AR Badges.
for (let i = 1; i <= 15; i++) {
  catalog.push({
    slug: `enclave-day-${i}`,
    name: `Enclave Day ${i}`,
    description: `Participated in Enclave Day ${i}.`,
    category: 'event',
    track: null,
    rank: null,
    threshold: null,
    file: i <= 14
      ? path.join('Enclave Day Badges', `Enclave Day Badge ${i}.png`)
      : path.join('More AR Badges', `Enclave Day Badge ${i}.png`)
  });
}

catalog.push({
  slug: 'big-12-1',
  name: 'Big 12',
  description: 'Participated in the Big 12.',
  category: 'event',
  track: null,
  rank: null,
  threshold: null,
  file: path.join('More AR Badges', 'Big 12 Badge 1.png')
});

for (const person of ['Dippy', 'Julian', 'Meeks', 'Robby', 'Tomas']) {
  catalog.push({
    slug: `personal-${person.toLowerCase()}`,
    name: person,
    description: `Personal badge for ${person}.`,
    category: 'personal',
    track: null,
    rank: null,
    threshold: null,
    file: path.join('More AR Badges', `AR Badge for ${person}.png`)
  });
}

// Not earnable: locked/placeholder art for unstarted veteran tracks. Uploaded
// to the bucket (the UI references it) but gets no catalog row.
const EXTRA_UPLOADS = [
  { storagePath: 'veteran-base.png', file: path.join('AR Veteran Badges', 'AR Badge Veteran Base.png') }
];

async function ensureBucket() {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message || '')) {
    throw new Error(`Failed to create bucket '${BUCKET}': ${error.message}`);
  }
}

async function uploadOne(storagePath, fileRelPath) {
  const buffer = fs.readFileSync(path.join(ART_DIR, fileRelPath));
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: 'image/png',
    cacheControl: '86400',
    upsert: true
  });
  if (error) throw new Error(`Upload failed for ${storagePath}: ${error.message}`);
}

async function main() {
  // Fail fast if any art file is missing before touching the network.
  const missing = [...catalog, ...EXTRA_UPLOADS].filter(
    e => !fs.existsSync(path.join(ART_DIR, e.file))
  );
  if (missing.length) {
    throw new Error(`Missing art files:\n${missing.map(e => `  ${e.file}`).join('\n')}`);
  }

  await ensureBucket();

  for (const entry of catalog) {
    const storagePath = `${entry.slug}.png`;
    await uploadOne(storagePath, entry.file);
    const { error } = await supabase.from('badges').upsert({
      slug: entry.slug,
      name: entry.name,
      description: entry.description,
      category: entry.category,
      track: entry.track,
      rank: entry.rank,
      threshold: entry.threshold,
      image_path: storagePath,
      is_active: true
    }, { onConflict: 'slug' });
    if (error) throw new Error(`Catalog upsert failed for ${entry.slug}: ${error.message}`);
    console.log(`seeded ${entry.slug}`);
  }

  for (const extra of EXTRA_UPLOADS) {
    await uploadOne(extra.storagePath, extra.file);
    console.log(`uploaded ${extra.storagePath}`);
  }

  console.log(`\nDone: ${catalog.length} catalog rows, ${EXTRA_UPLOADS.length} extra assets.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Expected catalog size: 13 newcomer + 12 player + 12 conduit + 15 enclave + 1 big-12 + 5 personal = **58 rows**, plus 1 extra upload.

- [ ] **Step 2: Syntax check**

Run: `node --check scripts/seed-badges.js`
Expected: no output (exit 0)

- [ ] **Step 3: Verify the file inventory matches reality**

Run:

```bash
ls "public/img/badges/AR Newcomer Badges" | wc -l        # expect 13
ls "public/img/badges/AR Veteran Badges" | wc -l         # expect 13 (12 + Base)
ls "public/img/badges/Enclave Day Badges" | wc -l        # expect 14
ls "public/img/badges/More AR Badges" | wc -l            # expect 19
```

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-badges.js
git commit -m "feat: badge seed script (bucket upload + catalog upsert)"
```

(Do NOT run the script against production yet — that happens in the Task 12 rollout.)

---

### Task 9: Backfill script (retroactive awards)

**Files:**
- Create: `scripts/backfill-badges.js`

No TDD — it is a thin loop over `recalculateMilestoneBadges`, which is fully tested in Task 3.

- [ ] **Step 1: Write the script**

Create `scripts/backfill-badges.js`:

```js
// Retroactively awards milestone badges to every profile by running the same
// recalculateMilestoneBadges used by the live mission hooks. Idempotent —
// safe to re-run any time. Per-profile failures are collected and reported
// at the end instead of aborting the run.
//
// Usage: bun run scripts/backfill-badges.js
require('dotenv').config();
const { supabaseAdmin } = require('../models/_base');
const { recalculateMilestoneBadges } = require('../models/badge');

async function main() {
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id, name')
    .order('name', { ascending: true });
  if (error) throw new Error(`Failed to list profiles: ${error.message}`);

  const failures = [];
  let ensured = 0;

  for (const profile of profiles) {
    const { data, error: recalcError } = await recalculateMilestoneBadges(profile.id);
    if (recalcError) {
      failures.push({ profile: profile.name, error: recalcError.message || String(recalcError) });
      continue;
    }
    ensured += data.awarded;
    console.log(
      `${profile.name}: ${data.awarded} milestone badges ` +
      `(newcomer=${data.counters.newcomer} player=${data.counters.player} conduit=${data.counters.conduit})`
    );
  }

  console.log(`\nProcessed ${profiles.length} profiles; ${ensured} award rows ensured.`);
  if (failures.length) {
    console.error(`\n${failures.length} failures:`);
    for (const f of failures) console.error(`  ${f.profile}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Syntax check**

Run: `node --check scripts/backfill-badges.js`
Expected: no output (exit 0)

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-badges.js
git commit -m "feat: retroactive badge backfill script"
```

---

### Task 10: Admin routes + manage UI

**Files:**
- Create: `routes/badges.js`
- Create: `routes/badges.test.js`
- Create: `views/badges-manage.handlebars`
- Create: `views/partials/badge-grant-table.handlebars`
- Modify: `index.js` (mount at `/badges`, next to the other `app.use` route mounts at `index.js:74-85`)

- [ ] **Step 1: Write the failing route tests**

Create `routes/badges.test.js`:

```js
// routes/badges.test.js
//
// Authorization tests for the badge admin routes: the real isAuthenticated +
// requireAdmin middleware run against mocked data layers (same recipe as
// routes/missions.test.js). Render-path happy cases are exercised manually —
// these tests pin the security gates and the grant/revoke wiring.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-key';

const realSupabase = require('../util/supabase');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');
const realBadge = require('../models/badge');
const realProfile = require('../models/profile');

let profileRole = 'user';
const calls = { grant: [], revoke: [] };
let grantResult = { data: { slug: 'enclave-day-1' }, error: null };
let revokeResult = { data: { slug: 'enclave-day-1' }, error: null };

mock.module('../util/supabase', () => ({
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
  getProfile: async () => ({ id: 'p-admin', user_id: 'u1', role: profileRole })
}));
mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next(),
}));
mock.module('../models/badge', () => ({
  // Error forces the manage route down the sendError JSON path so the test
  // doesn't need a Handlebars view engine.
  getBadgeCatalog: async () => ({ data: null, error: new Error('catalog unavailable') }),
  listProfileBadges: async () => ({ data: [], error: null }),
  grantBadge: async (args) => { calls.grant.push(args); return grantResult; },
  revokeBadge: async (args) => { calls.revoke.push(args); return revokeResult; }
}));
mock.module('../models/profile', () => ({
  getProfileByIdAdmin: async (id) => ({ data: { id, name: 'Someone', user_id: 'u2' }, error: null }),
  searchProfilesAdmin: async () => ({ data: [], error: null })
}));

const express = require('express');
let server;
let baseUrl;

beforeAll(() => {
  delete require.cache[require.resolve('./badges')];
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/badges', require('./badges'));
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  mock.module('../util/supabase', () => realSupabase);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../models/badge', () => realBadge);
  mock.module('../models/profile', () => realProfile);
  delete require.cache[require.resolve('./badges')];
});

const adminHeaders = {
  Accept: 'application/json',
  Authorization: 'Bearer valid-jwt',
  'Content-Type': 'application/json'
};

test('GET /badges/manage redirects unauthenticated users to auth', async () => {
  const res = await fetch(`${baseUrl}/badges/manage`, { redirect: 'manual' });
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toContain('/auth/check');
});

test('GET /badges/manage rejects non-admins with 403', async () => {
  profileRole = 'user';
  const res = await fetch(`${baseUrl}/badges/manage`, { headers: adminHeaders });
  expect(res.status).toBe(403);
});

test('GET /badges/manage admits admins past the gate', async () => {
  profileRole = 'admin';
  const res = await fetch(`${baseUrl}/badges/manage`, { headers: adminHeaders });
  // Mocked catalog error -> sendError, NOT 401/403: the admin got through.
  expect(res.status).not.toBe(401);
  expect(res.status).not.toBe(403);
});

test('POST /badges/grant rejects non-admins and does not call the model', async () => {
  profileRole = 'user';
  calls.grant.length = 0;
  const res = await fetch(`${baseUrl}/badges/grant`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ profile_id: 'p2', badge_slug: 'enclave-day-1' })
  });
  expect(res.status).toBe(403);
  expect(calls.grant.length).toBe(0);
});

test('POST /badges/grant calls grantBadge with the admin as granter and redirects', async () => {
  profileRole = 'admin';
  calls.grant.length = 0;
  grantResult = { data: { slug: 'enclave-day-1' }, error: null };
  const res = await fetch(`${baseUrl}/badges/grant`, {
    method: 'POST',
    headers: adminHeaders,
    redirect: 'manual',
    body: JSON.stringify({ profile_id: 'p2', badge_slug: 'enclave-day-1' })
  });
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('/badges/manage?profile_id=p2');
  expect(calls.grant).toEqual([{ profileId: 'p2', badgeSlug: 'enclave-day-1', grantedById: 'p-admin' }]);
});

test('POST /badges/grant surfaces milestone rejection as 400', async () => {
  profileRole = 'admin';
  grantResult = { data: null, error: new Error('Milestone badges are awarded automatically and cannot be granted or revoked') };
  const res = await fetch(`${baseUrl}/badges/grant`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ profile_id: 'p2', badge_slug: 'newcomer-1' })
  });
  expect(res.status).toBe(400);
});

test('POST /badges/grant requires profile_id and badge_slug', async () => {
  profileRole = 'admin';
  calls.grant.length = 0;
  const res = await fetch(`${baseUrl}/badges/grant`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ profile_id: 'p2' })
  });
  expect(res.status).toBe(400);
  expect(calls.grant.length).toBe(0);
});

test('POST /badges/revoke calls revokeBadge and redirects', async () => {
  profileRole = 'admin';
  calls.revoke.length = 0;
  revokeResult = { data: { slug: 'enclave-day-1' }, error: null };
  const res = await fetch(`${baseUrl}/badges/revoke`, {
    method: 'POST',
    headers: adminHeaders,
    redirect: 'manual',
    body: JSON.stringify({ profile_id: 'p2', badge_slug: 'enclave-day-1' })
  });
  expect(res.status).toBe(302);
  expect(calls.revoke).toEqual([{ profileId: 'p2', badgeSlug: 'enclave-day-1' }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test routes/badges.test.js`
Expected: FAIL — `Cannot find module './badges'`

- [ ] **Step 3: Write the route file**

Create `routes/badges.js`:

```js
const express = require('express');
const router = express.Router();
const { isAuthenticated, requireAdmin } = require('../util/auth');
const { sendError } = require('../util/http-error');
const { getBadgeCatalog, listProfileBadges, grantBadge, revokeBadge } = require('../models/badge');
const { getProfileByIdAdmin, searchProfilesAdmin } = require('../models/profile');

router.get('/manage', isAuthenticated, requireAdmin, async (req, res) => {
  const { data: catalog, error } = await getBadgeCatalog();
  if (error) {
    return sendError(req, res, error, { message: 'Failed to load badge catalog' });
  }

  const q = (req.query.q || '').toString().trim();
  let matches = [];
  if (q) {
    const { data } = await searchProfilesAdmin(q);
    matches = data || [];
  }

  let selectedProfile = null;
  let heldSlugs = new Set();
  if (req.query.profile_id) {
    const { data: profileData } = await getProfileByIdAdmin(req.query.profile_id.toString());
    if (profileData) {
      selectedProfile = profileData;
      const { data: held } = await listProfileBadges(profileData.id);
      heldSlugs = new Set((held || []).map(b => b.slug));
    }
  }

  const decorate = (b) => ({ ...b, held: heldSlugs.has(b.slug) });
  const byCategory = (category) => (catalog || []).filter(b => b.category === category).map(decorate);

  return res.render('badges-manage', {
    profile: res.locals.profile,
    title: 'Manage Badges',
    q,
    matches,
    selectedProfile,
    milestoneBadges: byCategory('milestone'),
    eventBadges: byCategory('event'),
    personalBadges: byCategory('personal'),
    breadcrumbs: [
      { label: 'Badges', href: '/badges/manage' },
      { label: 'Manage', href: '/badges/manage' }
    ]
  });
});

const grantRevokeParams = (req, res) => {
  const profileId = (req.body.profile_id || '').toString().trim();
  const badgeSlug = (req.body.badge_slug || '').toString().trim();
  if (!profileId || !badgeSlug) {
    sendError(req, res, null, { status: 400, message: 'profile_id and badge_slug are required' });
    return null;
  }
  return { profileId, badgeSlug };
};

// Model-level errors (milestone guard, unknown badge) are client errors.
const grantRevokeErrorStatus = (error) =>
  /milestone|not found/i.test(error?.message || '') ? 400 : 500;

router.post('/grant', isAuthenticated, requireAdmin, async (req, res) => {
  const params = grantRevokeParams(req, res);
  if (!params) return;

  const { error } = await grantBadge({
    profileId: params.profileId,
    badgeSlug: params.badgeSlug,
    grantedById: res.locals.profile.id
  });
  if (error) {
    return sendError(req, res, error, {
      status: grantRevokeErrorStatus(error),
      message: error.message || 'Failed to grant badge'
    });
  }
  return res.redirect(`/badges/manage?profile_id=${encodeURIComponent(params.profileId)}`);
});

router.post('/revoke', isAuthenticated, requireAdmin, async (req, res) => {
  const params = grantRevokeParams(req, res);
  if (!params) return;

  const { error } = await revokeBadge({
    profileId: params.profileId,
    badgeSlug: params.badgeSlug
  });
  if (error) {
    return sendError(req, res, error, {
      status: grantRevokeErrorStatus(error),
      message: error.message || 'Failed to revoke badge'
    });
  }
  return res.redirect(`/badges/manage?profile_id=${encodeURIComponent(params.profileId)}`);
});

module.exports = router;
```

- [ ] **Step 4: Mount the router in `index.js`**

After the line `app.use('/library', libraryRoutes);` add (with the matching require alongside the other route requires at the top):

```js
const badgesRoutes = require('./routes/badges');
// ...
app.use('/badges', badgesRoutes);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test routes/badges.test.js`
Expected: 8 pass

- [ ] **Step 6: Create the views**

Create `views/partials/badge-grant-table.handlebars`:

```handlebars
<table class="table is-fullwidth is-striped">
  <tbody>
    {{#each badges}}
    <tr>
      <td style="width: 56px;"><img src="{{this.image_url}}" alt="{{this.name}}" width="48" height="48" loading="lazy"></td>
      <td>
        {{this.name}}
        {{#if this.held}}<span class="tag is-success is-light ml-2">held</span>{{/if}}
        <br><span class="is-size-7 has-text-grey">{{this.description}}</span>
      </td>
      <td class="has-text-right" style="vertical-align: middle;">
        {{#if this.held}}
        <form method="post" action="/badges/revoke">
          <input type="hidden" name="profile_id" value="{{../profileId}}">
          <input type="hidden" name="badge_slug" value="{{this.slug}}">
          <button class="button is-danger is-light is-small" type="submit">Revoke</button>
        </form>
        {{else}}
        <form method="post" action="/badges/grant">
          <input type="hidden" name="profile_id" value="{{../profileId}}">
          <input type="hidden" name="badge_slug" value="{{this.slug}}">
          <button class="button is-success is-small" type="submit">Grant</button>
        </form>
        {{/if}}
      </td>
    </tr>
    {{/each}}
  </tbody>
</table>
```

(Plain `method="post"` forms work because the body has `hx-boost="true"` — htmx attaches the Authorization header via `htmx:configRequest` in `public/js/app.js`.)

Create `views/badges-manage.handlebars`:

```handlebars
{{> breadcrumbs}}
<h1 class="title is-2">Manage Badges</h1>

<div class="box">
  <h3 class="title is-4">Find a user</h3>
  <form method="get" action="/badges/manage">
    <div class="field has-addons">
      <div class="control is-expanded">
        <input class="input" type="text" name="q" value="{{q}}" placeholder="Search profiles by name" autofocus>
      </div>
      <div class="control">
        <button class="button is-link" type="submit">Search</button>
      </div>
    </div>
  </form>
  {{#if matches.length}}
  <div class="buttons mt-3">
    {{#each matches}}
    <a class="button is-light" href="/badges/manage?profile_id={{this.id}}">{{this.name}}</a>
    {{/each}}
  </div>
  {{else}}
  {{#if q}}
  <p class="has-text-grey mt-3">No profiles matched "{{q}}".</p>
  {{/if}}
  {{/if}}
</div>

{{#if selectedProfile}}
<div class="box">
  <h3 class="title is-4">Badges for {{selectedProfile.name}}</h3>

  <h4 class="title is-5">Event Badges</h4>
  {{> badge-grant-table badges=eventBadges profileId=selectedProfile.id}}

  <h4 class="title is-5 mt-5">Personal Badges</h4>
  {{> badge-grant-table badges=personalBadges profileId=selectedProfile.id}}

  <h4 class="title is-5 mt-5">Milestone Badges <span class="tag is-info is-light">automatic</span></h4>
  <p class="is-size-7 has-text-grey mb-3">Earned from mission counters; cannot be granted or revoked manually.</p>
  <div class="is-flex is-flex-wrap-wrap" style="gap: 0.75rem;">
    {{#each milestoneBadges}}
    <figure class="has-text-centered" style="width: 80px; {{#unless this.held}}filter: grayscale(1); opacity: 0.35;{{/unless}}">
      <img src="{{this.image_url}}" alt="{{this.name}}" title="{{this.name}}" width="64" height="64" loading="lazy">
      <figcaption class="is-size-7">{{this.name}}</figcaption>
    </figure>
    {{/each}}
  </div>
</div>
{{else}}
<div class="notification is-light">Search for a user above, then select them to grant or revoke badges.</div>
{{/if}}
```

- [ ] **Step 7: Run the full test suite**

Run: `bun test`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add routes/badges.js routes/badges.test.js views/badges-manage.handlebars views/partials/badge-grant-table.handlebars index.js
git commit -m "feat: admin badge management page with grant/revoke"
```

---

### Task 11: Profile badge shelf

**Files:**
- Create: `views/partials/badge-shelf.handlebars`
- Modify: `routes/profile.js` (GET `/` at `routes/profile.js:12` and GET `/view/:name` at `routes/profile.js:46`)
- Modify: `views/profile.handlebars`
- Modify: `views/profile-view.handlebars`

No new unit tests: the data shaping is covered by `getProfileBadges` tests (Task 4); the wiring follows the existing `conduitCredits` tolerance pattern and is verified by rendering.

- [ ] **Step 1: Create the shelf partial**

Create `views/partials/badge-shelf.handlebars`:

```handlebars
{{#if (or badges.display.length badges.progress)}}
<div class="box">
  {{> section-heading tag="h3" id="badges" title="Badges"}}
  {{#if badges.display.length}}
  <div class="is-flex is-flex-wrap-wrap" style="gap: 1rem;">
    {{#each badges.display}}
    <figure class="has-text-centered" style="width: 96px;">
      <img src="{{this.image_url}}" alt="{{this.name}}" title="{{this.name}}{{#if this.description}} — {{this.description}}{{/if}}" width="96" height="96" loading="lazy">
      <figcaption class="is-size-7">{{this.name}}</figcaption>
    </figure>
    {{/each}}
  </div>
  {{/if}}
  {{#if badges.progress}}
  <div class="content mt-4">
    {{#each badges.progress}}
    <p class="mb-1">
      {{#unless this.currentSlug}}
      {{#unless (eq this.track 'newcomer')}}
      <img src="{{../badges.veteranBaseUrl}}" alt="" width="28" height="28" style="filter: grayscale(1); opacity: 0.5; vertical-align: middle;" loading="lazy">
      {{/unless}}
      {{/unless}}
      <strong>{{this.label}}:</strong>
      {{#if this.complete}}
      Track complete!
      {{else}}
      {{this.count}} / {{this.nextThreshold}} missions to {{this.nextName}}
      {{/if}}
    </p>
    {{/each}}
  </div>
  {{/if}}
</div>
{{/if}}
```

(`or`, `eq`, and `section-heading` are existing helpers/partials — see `views/profile.handlebars:24` and `views/profile-view.handlebars:30`.)

- [ ] **Step 2: Load badges in `routes/profile.js`**

Add to the requires at the top:

```js
const { getProfileBadges } = require('../models/badge');
```

In `router.get('/', ...)` after the `conduitCredits` block, add (and pass `badges` in the render call):

```js
  // Badge shelf is decoration: render the page without it on failure.
  let badges = null;
  try {
    const { data } = await getProfileBadges(profile.id, { includeProgress: true });
    if (data) badges = data;
  } catch (_) {}
```

Add `badges,` to the `res.render('profile', { ... })` object.

In `router.get('/view/:name', ...)` after `publicCharacters` is loaded, add (and pass `badges` in the render call):

```js
  let badges = null;
  try {
    const { data } = await getProfileBadges(viewProfile.id);
    if (data) badges = data;
  } catch (_) {}
```

Add `badges,` to the `res.render('profile-view', { ... })` object.

- [ ] **Step 3: Render the shelf in both views**

In `views/profile.handlebars`, insert after the closing `</div>` of the `#profile-info` box (line 22):

```handlebars
{{> badge-shelf badges=badges}}
```

In `views/profile-view.handlebars`, insert after the bio `columns` block (line 26), before the conduit-briefing box:

```handlebars
{{> badge-shelf badges=badges}}
```

- [ ] **Step 4: Run the full test suite**

Run: `bun test`
Expected: all pass

- [ ] **Step 5: Manual smoke test**

Run: `bun run dev` and check:
- `/profile` renders (with progress lines once seed+backfill have run locally; before that, the shelf box shows progress with "0 / 1" style lines — acceptable, or absent if `badges` failed to load)
- `/profile/view/<name>` renders for a public profile (no badges ⇒ no badge box)
- `/badges/manage` as an admin: search, select a user, grant an event badge, revoke it

- [ ] **Step 6: Commit**

```bash
git add views/partials/badge-shelf.handlebars views/profile.handlebars views/profile-view.handlebars routes/profile.js
git commit -m "feat: badge shelf on profile pages"
```

---

### Task 12: Rollout

Operational sequence (production), per the spec:

- [ ] **Step 1:** Apply `supabase/migrations/20260606_profile_badges.sql` (done in Task 1 if the same DB; otherwise apply to prod now).
- [ ] **Step 2:** Run `bun run scripts/seed-badges.js` with production env vars. Expected: 58 `seeded <slug>` lines + `uploaded veteran-base.png`.
- [ ] **Step 3:** Deploy the application code.
- [ ] **Step 4:** Run `bun run scripts/backfill-badges.js` with production env vars. Expected: one line per profile, `0 failures`, exit 0.
- [ ] **Step 5:** Spot-check: a long-tenured player's public profile shows the right Newcomer/Veteran badges; an admin can grant an Enclave Day badge from `/badges/manage`.
- [ ] **Step 6:** Remove the local art (now served from the bucket) and commit:

```bash
git rm -r "public/img/badges"
git commit -m "chore: badge art now served from storage bucket"
```

- [ ] **Step 7 (optional, no code):** Add a "Manage Badges" admin nav item via the existing `/nav/manage` UI pointing at `/badges/manage`.

---

## Self-review notes

- **Spec coverage:** counters/dedupe (Tasks 2), thresholds + permanence (3), display + progress + veteran-base placeholder (4, 11), grant/revoke with milestone guard (5, 10), retroactivity (9, 12), seed/bucket (8), hooks incl. before-capture on delete/merge (7), RLS (1), error tolerance on profile pages (11). ✓
- **Type consistency:** `recalcMilestoneBadgesSafely(profileIds)`, `getMissionProfileIds(missionId)`, `getProfileBadges(profileId, { includeProgress })` → `{ display, progress, veteranBaseUrl }`, `grantBadge({ profileId, badgeSlug, grantedById })`, `revokeBadge({ profileId, badgeSlug })` used identically across tasks 3–11. ✓
- **Known accepted trade-offs (from spec):** backfilled `awarded_at` is the backfill date; offscreen missions excluded; admin UI cannot touch milestone badges.
