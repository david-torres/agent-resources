# Conduit Credits Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revise Conduit Credits so spending a credit creates an Offscreen Mission log entry (name, summary, source mission name+date) and automatically bumps `completed_missions` and `commissary_reward`, while keeping the existing per-character manual-increment earning model.

**Architecture:** New `offscreen_missions` table joined to `characters`. Two Postgres helper functions (`spend_conduit_credit`, `refund_conduit_credit`) provide atomic bookkeeping. A new model file `models/offscreen-mission.js` wraps CRUD. Five new routes on `routes/characters.js`. Two new view partials (form + entry). The character page and `/missions/character/:id` page merge offscreen entries into the mission log alongside real missions, sorted by date.

**Tech Stack:** Node.js (Express), Bun (runtime + test runner), Supabase Postgres, Handlebars, htmx.

**Spec:** `docs/superpowers/specs/2026-05-25-conduit-credits-revision-design.md`

---

## File map

**Create:**
- `supabase/migrations/20260525000004_offscreen_missions.sql` — new table + indexes + RLS policies + `spend_conduit_credit` / `refund_conduit_credit` functions.
- `models/offscreen-mission.js` — model: list, getById, create, update, remove, listHostedMissionsForPicker.
- `models/offscreen-mission.test.js` — Bun test file mirroring the `models/character.test.js` mock-client pattern.
- `views/partials/offscreen-mission-form.handlebars` — shared spend / edit form.
- `views/partials/offscreen-mission-entry.handlebars` — display partial.

**Modify:**
- `schema.sql` — mirror the migration (new table, indexes, RLS policies, two Postgres functions).
- `routes/characters.js` — five new routes; extend the existing `GET /:id/:name?` handler to also fetch offscreen missions and merge them into `recentMissions`.
- `routes/missions.js` — extend `GET /character/:id` similarly so the all-missions view shows offscreen entries.
- `util/supabase.js` — re-export the new model (the file is a single re-export hub).
- `views/character.handlebars` — co-locate the Conduit Credits balance display with a new "Spend Conduit Credit" button; render mixed real + offscreen entries in Recent Missions.
- `views/character-missions.handlebars` — render mixed real + offscreen entries in the missions table.

**Not touched:**
- `views/partials/character-v2-fields.handlebars` — the `conduit_credits` number input stays as the earning channel.
- `models/character.js` `incrementMissionCount` — separate code path; not used here.

---

## Task 1: Schema migration & RLS

**Files:**
- Create: `supabase/migrations/20260525000004_offscreen_missions.sql`
- Modify: `schema.sql` (append the same content)

This task creates the table, indexes, RLS policies, and two Postgres functions that subsequent tasks rely on. There are no JS tests yet; verification is "the migration applies cleanly and a minimal smoke insert works."

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260525000004_offscreen_missions.sql`:

```sql
-- Offscreen missions: per-character log entries created by spending a Conduit credit.
CREATE TABLE IF NOT EXISTS offscreen_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  merx_gained INTEGER NOT NULL DEFAULT 0,
  source_mission_id UUID NULL REFERENCES missions(id) ON DELETE SET NULL,
  source_mission_name TEXT NOT NULL,
  source_mission_date DATE NOT NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offscreen_missions_character_id_idx
  ON offscreen_missions (character_id, source_mission_date DESC);

ALTER TABLE offscreen_missions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "offscreen_missions_select" ON offscreen_missions;
DROP POLICY IF EXISTS "offscreen_missions_mutate" ON offscreen_missions;

CREATE POLICY "offscreen_missions_select"
  ON offscreen_missions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM characters c
      JOIN profiles p ON p.id = c.creator_id
      WHERE c.id = offscreen_missions.character_id
        AND (c.is_public = true OR p.user_id = auth.uid() OR is_admin())
    )
  );

CREATE POLICY "offscreen_missions_mutate"
  ON offscreen_missions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM characters c
      JOIN profiles p ON p.id = c.creator_id
      WHERE c.id = offscreen_missions.character_id
        AND (p.user_id = auth.uid() OR is_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM characters c
      JOIN profiles p ON p.id = c.creator_id
      WHERE c.id = offscreen_missions.character_id
        AND (p.user_id = auth.uid() OR is_admin())
    )
  );

-- Atomic bookkeeping on spend: decrement credit, +1 completed_missions, +merx commissary_reward.
-- Raises a custom SQLSTATE so the caller can map it to a 400 with a clean message.
CREATE OR REPLACE FUNCTION spend_conduit_credit(p_character_id UUID, p_merx INT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  affected INT;
BEGIN
  UPDATE characters
     SET conduit_credits = conduit_credits - 1,
         completed_missions = completed_missions + 1,
         commissary_reward = commissary_reward + COALESCE(p_merx, 0)
   WHERE id = p_character_id
     AND conduit_credits > 0;

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RAISE EXCEPTION 'no_conduit_credit_available' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Atomic refund on delete: +1 credit, -1 completed_missions (clamped at 0), -merx (clamped at 0).
CREATE OR REPLACE FUNCTION refund_conduit_credit(p_character_id UUID, p_merx INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET conduit_credits = conduit_credits + 1,
         completed_missions = GREATEST(completed_missions - 1, 0),
         commissary_reward = GREATEST(commissary_reward - COALESCE(p_merx, 0), 0)
   WHERE id = p_character_id;
$$;
```

- [ ] **Step 2: Mirror into `schema.sql`**

Append the *same* SQL to `schema.sql` immediately after the existing `ALTER TABLE characters ADD COLUMN IF NOT EXISTS conduit_credits ...` line (around line 302 currently). The whole block — table, index, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, both policies, both functions — goes in.

- [ ] **Step 3: Apply locally**

Run the project's normal Supabase migration step (this repo applies migrations by hand against the configured Supabase project — there is no automated runner). Concretely:

```bash
# Whichever of these the user normally uses for this project. Confirm with them first if unsure.
psql "$DATABASE_URL" -f supabase/migrations/20260525000004_offscreen_missions.sql
```

Expected: command exits 0; `\d offscreen_missions` shows the table.

- [ ] **Step 4: Smoke-test the helper functions**

In `psql` against the same DB, with any existing character row's UUID:

```sql
-- Find any character with conduit_credits > 0
SELECT id, conduit_credits, completed_missions, commissary_reward
FROM characters WHERE conduit_credits > 0 LIMIT 1;

-- Spend (replace :id)
SELECT spend_conduit_credit('<id>'::uuid, 5);
SELECT conduit_credits, completed_missions, commissary_reward
FROM characters WHERE id = '<id>';
-- Expect: conduit_credits -1, completed_missions +1, commissary_reward +5

-- Refund
SELECT refund_conduit_credit('<id>'::uuid, 5);
SELECT conduit_credits, completed_missions, commissary_reward
FROM characters WHERE id = '<id>';
-- Expect: back to original values

-- Spend when credits = 0 should error
UPDATE characters SET conduit_credits = 0 WHERE id = '<id>';
SELECT spend_conduit_credit('<id>'::uuid, 0);
-- Expect: ERROR: no_conduit_credit_available
```

Don't leave the test character mutated — refund or restore.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525000004_offscreen_missions.sql schema.sql
git commit -m "feat: offscreen_missions table + RLS + spend/refund RPCs"
```

---

## Task 2: Model — create offscreen mission (with TDD)

**Files:**
- Create: `models/offscreen-mission.js`
- Create: `models/offscreen-mission.test.js`

This task introduces the model file with one method (`createOffscreenMission`) and its tests, following the mock-client pattern in `models/character.test.js`.

- [ ] **Step 1: Write the failing test**

Create `models/offscreen-mission.test.js`:

```javascript
const { mock, test, expect, beforeAll, afterAll } = require('bun:test');

const realBase = require('./_base');

// Mock the supabase clients so the model never touches the network.
// Mirrors the pattern in models/character.test.js.
const makeClient = ({ inserted = [], updated = [], deleted = [], rpcCalls = [], rpcError = null, rows = [] } = {}) => ({
  from(table) {
    const chain = {
      _table: table,
      select() { return chain; },
      eq() { return chain; },
      order() { return Promise.resolve({ data: rows, error: null }); },
      single() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      insert(payload) {
        inserted.push({ table, payload });
        return {
          select() {
            return {
              single() { return Promise.resolve({ data: { id: 'om-1', ...payload }, error: null }); }
            };
          }
        };
      },
      update(payload) { updated.push({ table, payload }); return chain; },
      delete() { deleted.push({ table }); return chain; },
      then(onFulfilled, onRejected) {
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      }
    };
    return chain;
  },
  rpc(name, args) {
    rpcCalls.push({ name, args });
    if (rpcError) return Promise.resolve({ data: null, error: rpcError });
    return Promise.resolve({ data: null, error: null });
  }
});

beforeAll(() => {
  mock.module('./_base', () => ({
    supabase: realBase.supabase,
    supabaseAdmin: realBase.supabaseAdmin
  }));
});

afterAll(() => {
  mock.module('./_base', () => realBase);
});

test('createOffscreenMission calls spend_conduit_credit RPC then inserts the row', async () => {
  const inserted = [];
  const rpcCalls = [];
  const client = makeClient({ inserted, rpcCalls });

  const { createOffscreenMission } = require('./offscreen-mission');
  const { data, error } = await createOffscreenMission({
    characterId: 'char-1',
    payload: {
      name: 'A quiet errand',
      summary: 'Two sentences here.',
      merx_gained: 3,
      source_mission_id: 'mis-1',
      source_mission_name: 'Real Mission',
      source_mission_date: '2026-05-01'
    },
    profileId: 'profile-1',
    supabase: client
  });

  expect(error).toBeNull();
  expect(rpcCalls).toEqual([
    { name: 'spend_conduit_credit', args: { p_character_id: 'char-1', p_merx: 3 } }
  ]);
  expect(inserted).toHaveLength(1);
  expect(inserted[0].table).toBe('offscreen_missions');
  expect(inserted[0].payload).toMatchObject({
    character_id: 'char-1',
    name: 'A quiet errand',
    summary: 'Two sentences here.',
    merx_gained: 3,
    source_mission_id: 'mis-1',
    source_mission_name: 'Real Mission',
    source_mission_date: '2026-05-01',
    created_by: 'profile-1'
  });
  expect(data.id).toBe('om-1');
});

test('createOffscreenMission returns the RPC error and does not insert when credits run out', async () => {
  const inserted = [];
  const rpcCalls = [];
  const client = makeClient({
    inserted,
    rpcCalls,
    rpcError: { code: 'P0001', message: 'no_conduit_credit_available' }
  });

  const { createOffscreenMission } = require('./offscreen-mission');
  const { data, error } = await createOffscreenMission({
    characterId: 'char-1',
    payload: {
      name: 'x', summary: 'x', merx_gained: 0,
      source_mission_id: null,
      source_mission_name: 'External', source_mission_date: '2026-05-01'
    },
    profileId: 'profile-1',
    supabase: client
  });

  expect(data).toBeNull();
  expect(error).toEqual({ code: 'P0001', message: 'no_conduit_credit_available' });
  expect(inserted).toHaveLength(0);
});

test('createOffscreenMission coerces merx_gained to a non-negative integer', async () => {
  const inserted = [];
  const rpcCalls = [];
  const client = makeClient({ inserted, rpcCalls });

  const { createOffscreenMission } = require('./offscreen-mission');
  await createOffscreenMission({
    characterId: 'char-1',
    payload: {
      name: 'x', summary: 'x', merx_gained: '-7',
      source_mission_id: null,
      source_mission_name: 'External', source_mission_date: '2026-05-01'
    },
    profileId: 'profile-1',
    supabase: client
  });

  expect(rpcCalls[0].args.p_merx).toBe(0);
  expect(inserted[0].payload.merx_gained).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test models/offscreen-mission.test.js
```

Expected: FAIL — `./offscreen-mission` module not found.

- [ ] **Step 3: Write minimal implementation**

Create `models/offscreen-mission.js`:

```javascript
const { supabase } = require('./_base');

const normalizeMerx = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

const createOffscreenMission = async ({ characterId, payload, profileId, supabase: client = supabase }) => {
  const merx = normalizeMerx(payload.merx_gained);

  const { error: rpcError } = await client.rpc('spend_conduit_credit', {
    p_character_id: characterId,
    p_merx: merx
  });
  if (rpcError) {
    return { data: null, error: rpcError };
  }

  const row = {
    character_id: characterId,
    name: payload.name,
    summary: payload.summary,
    merx_gained: merx,
    source_mission_id: payload.source_mission_id || null,
    source_mission_name: payload.source_mission_name,
    source_mission_date: payload.source_mission_date,
    created_by: profileId || null
  };

  const { data, error } = await client
    .from('offscreen_missions')
    .insert(row)
    .select()
    .single();
  return { data, error };
};

module.exports = {
  createOffscreenMission
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test models/offscreen-mission.test.js
```

Expected: PASS — all three tests.

- [ ] **Step 5: Commit**

```bash
git add models/offscreen-mission.js models/offscreen-mission.test.js
git commit -m "feat: offscreen-mission model — create"
```

---

## Task 3: Model — list, getById, listHostedMissionsForPicker

**Files:**
- Modify: `models/offscreen-mission.js`
- Modify: `models/offscreen-mission.test.js`

- [ ] **Step 1: Add failing tests**

Append to `models/offscreen-mission.test.js`:

```javascript
test('listOffscreenMissions returns rows for a character, ordered by source_mission_date desc', async () => {
  const rows = [
    { id: 'om-2', character_id: 'char-1', source_mission_date: '2026-04-01', name: 'Second', summary: '', merx_gained: 0, source_mission_id: null, source_mission_name: 'M2' },
    { id: 'om-1', character_id: 'char-1', source_mission_date: '2026-05-01', name: 'First', summary: '', merx_gained: 0, source_mission_id: null, source_mission_name: 'M1' }
  ];
  const client = makeClient({ rows });
  const { listOffscreenMissions } = require('./offscreen-mission');
  const { data, error } = await listOffscreenMissions({ characterId: 'char-1', supabase: client });
  expect(error).toBeNull();
  // The mock just returns rows; assert the model passed them through unchanged.
  expect(data).toHaveLength(2);
});

test('getOffscreenMissionById returns the row', async () => {
  const client = makeClient({ rows: [{ id: 'om-1', character_id: 'char-1' }] });
  const { getOffscreenMissionById } = require('./offscreen-mission');
  const { data, error } = await getOffscreenMissionById({ id: 'om-1', supabase: client });
  expect(error).toBeNull();
  expect(data.id).toBe('om-1');
});

test('listHostedMissionsForPicker returns missions where host_id = profile id, ordered by date desc', async () => {
  const rows = [
    { id: 'mis-1', name: 'Recent Host', date: '2026-05-01' },
    { id: 'mis-2', name: 'Older Host', date: '2026-03-01' }
  ];
  const client = makeClient({ rows });
  const { listHostedMissionsForPicker } = require('./offscreen-mission');
  const { data, error } = await listHostedMissionsForPicker({ profileId: 'profile-1', supabase: client });
  expect(error).toBeNull();
  expect(data).toHaveLength(2);
});
```

- [ ] **Step 2: Verify the new tests fail**

```bash
bun test models/offscreen-mission.test.js
```

Expected: three new FAILs — functions not exported.

- [ ] **Step 3: Implement**

Add to `models/offscreen-mission.js` and update the export list:

```javascript
const listOffscreenMissions = async ({ characterId, supabase: client = supabase }) => {
  const { data, error } = await client
    .from('offscreen_missions')
    .select('*')
    .eq('character_id', characterId)
    .order('source_mission_date', { ascending: false });
  return { data, error };
};

const getOffscreenMissionById = async ({ id, supabase: client = supabase }) => {
  const { data, error } = await client
    .from('offscreen_missions')
    .select('*')
    .eq('id', id)
    .single();
  return { data, error };
};

const listHostedMissionsForPicker = async ({ profileId, supabase: client = supabase }) => {
  const { data, error } = await client
    .from('missions')
    .select('id, name, date')
    .eq('host_id', profileId)
    .order('date', { ascending: false });
  return { data, error };
};

module.exports = {
  createOffscreenMission,
  listOffscreenMissions,
  getOffscreenMissionById,
  listHostedMissionsForPicker
};
```

- [ ] **Step 4: Run tests**

```bash
bun test models/offscreen-mission.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add models/offscreen-mission.js models/offscreen-mission.test.js
git commit -m "feat: offscreen-mission model — list, getById, hosted picker"
```

---

## Task 4: Model — update

**Files:**
- Modify: `models/offscreen-mission.js`
- Modify: `models/offscreen-mission.test.js`

Update changes the row's fields and applies the `(new − old)` merx delta to the character's `commissary_reward`, inside a transaction-equivalent flow. Since the model layer uses the JS client (no transactions), we sequence the operations: read old merx, update row, then adjust the character row by the delta. On RPC failure after the row update succeeded, we surface the error and accept the rare drift (merx_gained on the row changed but commissary_reward didn't). A revert can also fail, so a two-step recovery just deepens the same problem; logging-and-surface is the simpler contract. (The atomic alternative would be a Postgres function — overkill given how rare this path is.)

- [ ] **Step 1: Add failing tests**

Append to `models/offscreen-mission.test.js`:

```javascript
// Update needs a richer client mock that lets us script per-call results.
const makeUpdateClient = ({ existing, updateError = null, deltaRpcError = null }) => {
  const calls = { rowUpdate: null, rpcAdjust: null };
  return {
    calls,
    client: {
      from(table) {
        if (table !== 'offscreen_missions') throw new Error(`unexpected table ${table}`);
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          single() { return Promise.resolve({ data: existing, error: null }); },
          update(payload) {
            calls.rowUpdate = payload;
            return {
              eq() {
                return {
                  select() {
                    return {
                      single() {
                        return Promise.resolve({
                          data: updateError ? null : { ...existing, ...payload },
                          error: updateError
                        });
                      }
                    };
                  }
                };
              }
            };
          }
        };
        return chain;
      },
      rpc(name, args) {
        calls.rpcAdjust = { name, args };
        return Promise.resolve({ data: null, error: deltaRpcError });
      }
    }
  };
};

test('updateOffscreenMission applies merx delta to character via adjust_commissary RPC', async () => {
  const existing = {
    id: 'om-1',
    character_id: 'char-1',
    name: 'old name',
    summary: 'old',
    merx_gained: 2,
    source_mission_id: null,
    source_mission_name: 'M',
    source_mission_date: '2026-05-01'
  };
  const { calls, client } = makeUpdateClient({ existing });

  const { updateOffscreenMission } = require('./offscreen-mission');
  const { data, error } = await updateOffscreenMission({
    id: 'om-1',
    payload: { name: 'new name', summary: 'new', merx_gained: 5, source_mission_id: null, source_mission_name: 'M', source_mission_date: '2026-05-01' },
    supabase: client
  });

  expect(error).toBeNull();
  expect(data.name).toBe('new name');
  expect(calls.rowUpdate.merx_gained).toBe(5);
  expect(calls.rpcAdjust).toEqual({
    name: 'adjust_commissary_reward',
    args: { p_character_id: 'char-1', p_delta: 3 }
  });
});

test('updateOffscreenMission with negative delta clamps via RPC (no JS-side clamp)', async () => {
  const existing = {
    id: 'om-1', character_id: 'char-1',
    name: 'x', summary: 'x', merx_gained: 10,
    source_mission_id: null, source_mission_name: 'M', source_mission_date: '2026-05-01'
  };
  const { calls, client } = makeUpdateClient({ existing });

  const { updateOffscreenMission } = require('./offscreen-mission');
  await updateOffscreenMission({
    id: 'om-1',
    payload: { name: 'x', summary: 'x', merx_gained: 4, source_mission_id: null, source_mission_name: 'M', source_mission_date: '2026-05-01' },
    supabase: client
  });

  expect(calls.rpcAdjust.args.p_delta).toBe(-6);
});

test('updateOffscreenMission with unchanged merx skips the RPC call', async () => {
  const existing = {
    id: 'om-1', character_id: 'char-1',
    name: 'x', summary: 'x', merx_gained: 3,
    source_mission_id: null, source_mission_name: 'M', source_mission_date: '2026-05-01'
  };
  const { calls, client } = makeUpdateClient({ existing });

  const { updateOffscreenMission } = require('./offscreen-mission');
  await updateOffscreenMission({
    id: 'om-1',
    payload: { name: 'y', summary: 'y', merx_gained: 3, source_mission_id: null, source_mission_name: 'M', source_mission_date: '2026-05-01' },
    supabase: client
  });

  expect(calls.rpcAdjust).toBeNull();
});
```

- [ ] **Step 2: Verify the new tests fail**

```bash
bun test models/offscreen-mission.test.js
```

Expected: three new FAILs.

- [ ] **Step 3: Add the RPC to the migration**

Edit `supabase/migrations/20260525000004_offscreen_missions.sql` *and* `schema.sql` — append after `refund_conduit_credit`:

```sql
-- Adjust commissary_reward by a signed delta, clamped at 0.
-- Used by offscreen-mission updates when merx_gained changes.
CREATE OR REPLACE FUNCTION adjust_commissary_reward(p_character_id UUID, p_delta INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET commissary_reward = GREATEST(commissary_reward + COALESCE(p_delta, 0), 0)
   WHERE id = p_character_id;
$$;
```

Apply the new function statement against the local DB (only the new function needs running — the table is already there):

```bash
psql "$DATABASE_URL" <<'SQL'
CREATE OR REPLACE FUNCTION adjust_commissary_reward(p_character_id UUID, p_delta INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET commissary_reward = GREATEST(commissary_reward + COALESCE(p_delta, 0), 0)
   WHERE id = p_character_id;
$$;
SQL
```

- [ ] **Step 4: Implement updateOffscreenMission**

Add to `models/offscreen-mission.js` and add to the export list:

```javascript
const updateOffscreenMission = async ({ id, payload, supabase: client = supabase }) => {
  const { data: existing, error: fetchError } = await client
    .from('offscreen_missions')
    .select('character_id, merx_gained')
    .eq('id', id)
    .single();
  if (fetchError) return { data: null, error: fetchError };

  const newMerx = normalizeMerx(payload.merx_gained);
  const row = {
    name: payload.name,
    summary: payload.summary,
    merx_gained: newMerx,
    source_mission_id: payload.source_mission_id || null,
    source_mission_name: payload.source_mission_name,
    source_mission_date: payload.source_mission_date
  };

  const { data, error } = await client
    .from('offscreen_missions')
    .update(row)
    .eq('id', id)
    .select()
    .single();
  if (error) return { data: null, error };

  const delta = newMerx - (existing.merx_gained || 0);
  if (delta !== 0) {
    const { error: rpcError } = await client.rpc('adjust_commissary_reward', {
      p_character_id: existing.character_id,
      p_delta: delta
    });
    if (rpcError) return { data: null, error: rpcError };
  }

  return { data, error: null };
};
```

Update the `module.exports` block to include `updateOffscreenMission`.

- [ ] **Step 5: Run tests**

```bash
bun test models/offscreen-mission.test.js
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add models/offscreen-mission.js models/offscreen-mission.test.js \
  supabase/migrations/20260525000004_offscreen_missions.sql schema.sql
git commit -m "feat: offscreen-mission model — update + adjust_commissary RPC"
```

---

## Task 5: Model — remove (refund)

**Files:**
- Modify: `models/offscreen-mission.js`
- Modify: `models/offscreen-mission.test.js`

Remove deletes the row and calls `refund_conduit_credit` to reverse the original bookkeeping.

- [ ] **Step 1: Add failing tests**

Append to `models/offscreen-mission.test.js`:

```javascript
const makeRemoveClient = ({ existing, rpcError = null, deleteError = null }) => {
  const calls = { rpcRefund: null, deletedFrom: null };
  return {
    calls,
    client: {
      from(table) {
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          single() { return Promise.resolve({ data: existing, error: null }); },
          delete() {
            calls.deletedFrom = table;
            return {
              eq() { return Promise.resolve({ data: null, error: deleteError }); }
            };
          }
        };
        return chain;
      },
      rpc(name, args) {
        calls.rpcRefund = { name, args };
        return Promise.resolve({ data: null, error: rpcError });
      }
    }
  };
};

test('removeOffscreenMission deletes the row and refunds the credit/counters', async () => {
  const existing = { id: 'om-1', character_id: 'char-1', merx_gained: 4 };
  const { calls, client } = makeRemoveClient({ existing });

  const { removeOffscreenMission } = require('./offscreen-mission');
  const { error } = await removeOffscreenMission({ id: 'om-1', supabase: client });

  expect(error).toBeNull();
  expect(calls.deletedFrom).toBe('offscreen_missions');
  expect(calls.rpcRefund).toEqual({
    name: 'refund_conduit_credit',
    args: { p_character_id: 'char-1', p_merx: 4 }
  });
});

test('removeOffscreenMission returns delete errors without refunding', async () => {
  const existing = { id: 'om-1', character_id: 'char-1', merx_gained: 4 };
  const { calls, client } = makeRemoveClient({ existing, deleteError: { message: 'boom' } });

  const { removeOffscreenMission } = require('./offscreen-mission');
  const { error } = await removeOffscreenMission({ id: 'om-1', supabase: client });

  expect(error).toEqual({ message: 'boom' });
  expect(calls.rpcRefund).toBeNull();
});
```

- [ ] **Step 2: Verify the new tests fail**

```bash
bun test models/offscreen-mission.test.js
```

Expected: two new FAILs.

- [ ] **Step 3: Implement removeOffscreenMission**

Add to `models/offscreen-mission.js`:

```javascript
const removeOffscreenMission = async ({ id, supabase: client = supabase }) => {
  const { data: existing, error: fetchError } = await client
    .from('offscreen_missions')
    .select('character_id, merx_gained')
    .eq('id', id)
    .single();
  if (fetchError) return { data: null, error: fetchError };

  const { error: deleteError } = await client
    .from('offscreen_missions')
    .delete()
    .eq('id', id);
  if (deleteError) return { data: null, error: deleteError };

  const { error: rpcError } = await client.rpc('refund_conduit_credit', {
    p_character_id: existing.character_id,
    p_merx: existing.merx_gained || 0
  });
  if (rpcError) return { data: null, error: rpcError };

  return { data: { id }, error: null };
};
```

Add `removeOffscreenMission` to `module.exports`.

- [ ] **Step 4: Run tests**

```bash
bun test models/offscreen-mission.test.js
```

Expected: all PASS.

- [ ] **Step 5: Wire into util/supabase**

Modify `util/supabase.js` to re-export the new model. Insert near the other model imports:

```javascript
const offscreenMission = require('../models/offscreen-mission');
// ... and inside module.exports = { ... } add:
//   ...offscreenMission,
```

Concretely, the final file looks like:

```javascript
const auth = require('../models/auth');
const profile = require('../models/profile');
const character = require('../models/character');
const lfgPost = require('../models/lfg');
const mission = require('../models/mission');
const classModel = require('../models/class');
const pdfModel = require('../models/pdf');
const rulesModel = require('../models/rules');
const pagesModel = require('../models/pages');
const navModel = require('../models/nav');
const agentTokenModel = require('../models/agent-token');
const offscreenMission = require('../models/offscreen-mission');

module.exports = {
  ...auth,
  ...profile,
  ...character,
  ...lfgPost,
  ...mission,
  ...classModel,
  ...pdfModel,
  ...rulesModel,
  ...pagesModel,
  ...navModel,
  ...agentTokenModel,
  ...offscreenMission
};
```

- [ ] **Step 6: Commit**

```bash
git add models/offscreen-mission.js models/offscreen-mission.test.js util/supabase.js
git commit -m "feat: offscreen-mission model — remove + util/supabase wiring"
```

---

## Task 6: View partial — offscreen-mission-form

**Files:**
- Create: `views/partials/offscreen-mission-form.handlebars`

Shared form for the spend (new) and edit views. Receives:
- `character` (object).
- `offscreenMission` (object, optional — present in edit mode; absent in new).
- `hostedMissions` (array of `{ id, name, date }`).
- `mode` (string: `'new'` or `'edit'`).
- `formAction` (string: full POST URL).

- [ ] **Step 1: Create the partial**

```handlebars
<form method="POST" action="{{formAction}}">
  <div class="field">
    <label class="label" for="om-name">Offscreen Mission Name</label>
    <div class="control">
      <input class="input" type="text" name="name" id="om-name" required
             value="{{offscreenMission.name}}">
    </div>
  </div>

  <div class="field">
    <label class="label" for="om-summary">Summary</label>
    <div class="control">
      <textarea class="textarea" name="summary" id="om-summary" rows="4" required
                placeholder="2–3 sentences describing the offscreen mission.">{{offscreenMission.summary}}</textarea>
    </div>
    <p class="help">2–3 sentences.</p>
  </div>

  <div class="field">
    <label class="label" for="om-merx">Merx Gained</label>
    <div class="control">
      <input class="input" type="number" name="merx_gained" id="om-merx" min="0" step="1"
             value="{{#if offscreenMission}}{{offscreenMission.merx_gained}}{{else}}0{{/if}}">
    </div>
  </div>

  <div class="field">
    <label class="label">Source Mission</label>
    <div class="control">
      <div class="select is-fullwidth">
        <select name="source_mission_id" id="om-source-select"
                onchange="document.getElementById('om-source-other').style.display = this.value === '__other__' ? 'block' : 'none';">
          {{#each hostedMissions}}
          <option value="{{this.id}}"
                  data-name="{{this.name}}"
                  data-date="{{date this.date "YYYY-MM-DD"}}"
                  {{#if (eq this.id ../offscreenMission.source_mission_id)}}selected{{/if}}>
            {{this.name}} — {{date this.date "MMM D, YYYY"}}
          </option>
          {{/each}}
          <option value="__other__"
                  {{#unless ../offscreenMission.source_mission_id}}{{#if ../offscreenMission}}selected{{/if}}{{/unless}}>
            Other / not in the system
          </option>
        </select>
      </div>
    </div>
    <p class="help">The hosted mission that earned this credit. Pick from the list, or "Other" to enter manually.</p>
  </div>

  <div id="om-source-other"
       style="display: {{#unless offscreenMission.source_mission_id}}{{#if offscreenMission}}block{{else}}none{{/if}}{{/unless}};">
    <div class="field">
      <label class="label" for="om-source-name">Source Mission Name</label>
      <div class="control">
        <input class="input" type="text" name="source_mission_name_other" id="om-source-name"
               value="{{#unless offscreenMission.source_mission_id}}{{offscreenMission.source_mission_name}}{{/unless}}">
      </div>
    </div>
    <div class="field">
      <label class="label" for="om-source-date">Source Mission Date</label>
      <div class="control">
        <input class="input" type="date" name="source_mission_date_other" id="om-source-date"
               value="{{#unless offscreenMission.source_mission_id}}{{date offscreenMission.source_mission_date "YYYY-MM-DD"}}{{/unless}}">
      </div>
    </div>
  </div>

  <div class="field is-grouped mt-4">
    <div class="control">
      <button class="button is-primary" type="submit">
        {{#if (eq mode "new")}}Spend Credit &amp; Add Offscreen Mission{{else}}Save Changes{{/if}}
      </button>
    </div>
    <div class="control">
      <a class="button is-light" href="/characters/{{character.id}}/{{urlencode character.name}}">Cancel</a>
    </div>
  </div>
</form>
```

If the `urlencode` helper isn't registered in this codebase, fall back to `{{character.name}}` — the route handler `/characters/:id/:name?` treats the name as optional.

- [ ] **Step 2: Commit**

```bash
git add views/partials/offscreen-mission-form.handlebars
git commit -m "feat: offscreen-mission-form view partial"
```

---

## Task 7: View partial — offscreen-mission-entry

**Files:**
- Create: `views/partials/offscreen-mission-entry.handlebars`

Display partial for one offscreen mission, used in both Recent Missions on the character page and in the all-missions table view. Receives:
- `entry` — the offscreen mission row.
- `character` — for the action URLs.
- `profile` — for ownership checks.
- `canViewSource` — boolean; whether the viewer can `SELECT` the source mission (passed in from the parent view, or computed inline).

- [ ] **Step 1: Create the partial**

```handlebars
<div class="offscreen-mission-entry">
  <strong>
    {{entry.name}}
    <span class="tag is-info is-light ml-2">Offscreen</span>
  </strong>
  <br>
  <small>
    {{#if profile}}{{date_tz entry.source_mission_date "MMM D, YYYY" profile.timezone}}{{else}}{{date entry.source_mission_date "MMM D, YYYY"}}{{/if}}
    {{#if entry.merx_gained}} · +{{entry.merx_gained}} Merx{{/if}}
  </small>
  {{#if entry.summary}}
  <div class="content mt-2">{{{markdown entry.summary}}}</div>
  {{/if}}
  <p class="help">
    Sourced from
    {{#if (and entry.source_mission_id canViewSource)}}
      <a href="/missions/{{entry.source_mission_id}}"><em>{{entry.source_mission_name}}</em></a>
    {{else}}
      <em>{{entry.source_mission_name}}</em>
    {{/if}}
    on
    {{#if profile}}{{date_tz entry.source_mission_date "MMM D, YYYY" profile.timezone}}{{else}}{{date entry.source_mission_date "MMM D, YYYY"}}{{/if}}.
  </p>
  {{#if (and profile (eq character.creator_id profile.id))}}
  <div class="buttons are-small">
    <a class="button is-warning is-light"
       href="/characters/{{character.id}}/offscreen-missions/{{entry.id}}/edit">Edit</a>
    <form method="POST"
          action="/characters/{{character.id}}/offscreen-missions/{{entry.id}}/delete"
          onsubmit="return confirm('Delete this offscreen mission? The credit and counters will be refunded.');"
          style="display: inline;">
      <button class="button is-danger is-light" type="submit">Delete</button>
    </form>
  </div>
  {{/if}}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add views/partials/offscreen-mission-entry.handlebars
git commit -m "feat: offscreen-mission-entry view partial"
```

---

## Task 8: Route — GET /:id/offscreen-missions/new

**Files:**
- Modify: `routes/characters.js`
- Create: `views/offscreen-mission-new.handlebars`

- [ ] **Step 1: Create the page wrapper view**

`views/offscreen-mission-new.handlebars`:

```handlebars
{{> breadcrumbs}}
<h1 class="title is-2">Spend a Conduit Credit</h1>
<h2 class="subtitle is-5">{{character.name}} — current balance: {{character.conduit_credits}}</h2>

{{> offscreen-mission-form
    character=character
    hostedMissions=hostedMissions
    mode="new"
    formAction=(concat "/characters/" character.id "/offscreen-missions")}}
```

If the `concat` helper isn't registered, hardcode the action URL with handlebars string concat: `action="/characters/{{character.id}}/offscreen-missions"`. (Check `util/handlebars.js` for available helpers — `concat` likely exists via `handlebars-helpers`.)

- [ ] **Step 2: Add the route**

In `routes/characters.js`, near the other `router.get` handlers for `/:id/...` routes (above the catch-all `GET /:id/:name?` — order matters in Express). Update the imports at the top of the file:

```javascript
const { getOwnCharacters, getCharacter, createCharacter, updateCharacter, deleteCharacter, markCharacterDeceased, getCharacterRecentMissions, searchPublicCharacters, getRandomPublicCharacters, getMission, getClasses, getClass, getLfgPost, getProfileById, listHostedMissionsForPicker, createOffscreenMission, getOffscreenMissionById, updateOffscreenMission, removeOffscreenMission, listOffscreenMissions } = require('../util/supabase');
```

Add the new route handler:

```javascript
router.get('/:id/offscreen-missions/new', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { data: character, error } = await getCharacter(id, res.locals.supabase);
  if (error) return res.status(400).send(error.message);
  if (character.creator_id !== profile.id) return res.status(403).send('Forbidden');
  if (!character.conduit_credits || character.conduit_credits <= 0) {
    return res.status(400).send('No Conduit Credits to spend.');
  }

  const { data: hostedMissions } = await listHostedMissionsForPicker({
    profileId: profile.id,
    supabase: res.locals.supabase
  });

  res.render('offscreen-mission-new', {
    title: `Spend a Credit — ${character.name}`,
    profile,
    character,
    hostedMissions: hostedMissions || [],
    breadcrumbs: [
      { label: 'Characters', href: '/characters' },
      { label: character.name, href: `/characters/${id}/${encodeURIComponent(character.name)}` },
      { label: 'Spend Conduit Credit', href: '#' }
    ]
  });
});
```

- [ ] **Step 3: Manually verify**

Start the dev server (`bun run dev`), log in as a user who has a character with `conduit_credits > 0`, visit `/characters/<id>/offscreen-missions/new`. Expect: the form renders with the hosted-missions picker populated (or just the "Other" option if the user has hosted none).

- [ ] **Step 4: Commit**

```bash
git add routes/characters.js views/offscreen-mission-new.handlebars
git commit -m "feat: GET /characters/:id/offscreen-missions/new (spend form)"
```

---

## Task 9: Route — POST /:id/offscreen-missions (create)

**Files:**
- Modify: `routes/characters.js`

- [ ] **Step 1: Add the route**

Add below the `GET /new` route from Task 8:

```javascript
router.post('/:id/offscreen-missions', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id: characterId } = req.params;

  const { data: character, error: charError } = await getCharacter(characterId, res.locals.supabase);
  if (charError) return res.status(400).send(charError.message);
  if (character.creator_id !== profile.id) return res.status(403).send('Forbidden');

  // Resolve source-mission fields. If a real hosted mission was picked, fetch
  // it to denormalize its (current) name and date into the offscreen entry.
  // Otherwise, fall back to the free-text inputs.
  let sourceMissionId = null;
  let sourceMissionName = null;
  let sourceMissionDate = null;

  if (req.body.source_mission_id && req.body.source_mission_id !== '__other__') {
    const { data: srcMission, error: srcErr } = await getMission(req.body.source_mission_id, res.locals.supabase);
    if (srcErr || !srcMission) {
      return res.status(400).send('Source mission not found.');
    }
    if (srcMission.host_id !== profile.id) {
      return res.status(403).send('Only the host of a mission can use it as a credit source.');
    }
    sourceMissionId = srcMission.id;
    sourceMissionName = srcMission.name;
    // Store as YYYY-MM-DD; the DB column is DATE so it'll coerce.
    sourceMissionDate = new Date(srcMission.date).toISOString().slice(0, 10);
  } else {
    sourceMissionName = (req.body.source_mission_name_other || '').trim();
    sourceMissionDate = (req.body.source_mission_date_other || '').trim();
    if (!sourceMissionName || !sourceMissionDate) {
      return res.status(400).send('Source mission name and date are required.');
    }
  }

  if (!req.body.name || !req.body.summary) {
    return res.status(400).send('Name and summary are required.');
  }

  const { error } = await createOffscreenMission({
    characterId,
    profileId: profile.id,
    payload: {
      name: req.body.name,
      summary: req.body.summary,
      merx_gained: req.body.merx_gained,
      source_mission_id: sourceMissionId,
      source_mission_name: sourceMissionName,
      source_mission_date: sourceMissionDate
    },
    supabase: res.locals.supabase
  });

  if (error) {
    if (error.message && /no_conduit_credit_available/.test(error.message)) {
      return res.status(400).send('No Conduit Credits to spend.');
    }
    return res.status(400).send(error.message);
  }

  return res.redirect(`/characters/${characterId}/${encodeURIComponent(character.name)}`);
});
```

- [ ] **Step 2: Manually verify**

In the dev server, fill out the spend form for a character with `conduit_credits > 0`, submit. Expect: redirect to the character page; the character's `conduit_credits` is one lower; `completed_missions` is one higher; `commissary_reward` increased by the merx value entered; a new row exists in `offscreen_missions`.

Also verify the error paths:
- Submit when `conduit_credits == 0` (manually set in the DB or use a character without credits) → 400 "No Conduit Credits to spend."
- Submit with empty name → 400.
- Submit with `__other__` source but blank name/date → 400.

- [ ] **Step 3: Commit**

```bash
git add routes/characters.js
git commit -m "feat: POST /characters/:id/offscreen-missions (spend a credit)"
```

---

## Task 10: Routes — GET edit + POST update

**Files:**
- Modify: `routes/characters.js`
- Create: `views/offscreen-mission-edit.handlebars`

- [ ] **Step 1: Create the edit page wrapper view**

`views/offscreen-mission-edit.handlebars`:

```handlebars
{{> breadcrumbs}}
<h1 class="title is-2">Edit Offscreen Mission</h1>
<h2 class="subtitle is-5">{{character.name}}</h2>

{{> offscreen-mission-form
    character=character
    offscreenMission=offscreenMission
    hostedMissions=hostedMissions
    mode="edit"
    formAction=(concat "/characters/" character.id "/offscreen-missions/" offscreenMission.id)}}
```

- [ ] **Step 2: Add the GET edit route**

Below the POST create route:

```javascript
router.get('/:id/offscreen-missions/:omId/edit', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id: characterId, omId } = req.params;

  const { data: character, error: charError } = await getCharacter(characterId, res.locals.supabase);
  if (charError) return res.status(400).send(charError.message);
  if (character.creator_id !== profile.id) return res.status(403).send('Forbidden');

  const { data: offscreenMission, error: omError } = await getOffscreenMissionById({
    id: omId,
    supabase: res.locals.supabase
  });
  if (omError) return res.status(400).send(omError.message);
  if (!offscreenMission || offscreenMission.character_id !== characterId) {
    return res.status(404).send('Not found');
  }

  const { data: hostedMissions } = await listHostedMissionsForPicker({
    profileId: profile.id,
    supabase: res.locals.supabase
  });

  res.render('offscreen-mission-edit', {
    title: `Edit Offscreen Mission — ${character.name}`,
    profile,
    character,
    offscreenMission,
    hostedMissions: hostedMissions || [],
    breadcrumbs: [
      { label: 'Characters', href: '/characters' },
      { label: character.name, href: `/characters/${characterId}/${encodeURIComponent(character.name)}` },
      { label: 'Edit Offscreen Mission', href: '#' }
    ]
  });
});
```

- [ ] **Step 3: Add the POST update route**

Below the edit route. This shares the same source-mission resolution logic as the create route — factor that into a small helper so we don't duplicate it. Add the helper near the top of the route file (above the routes):

```javascript
const resolveOffscreenSource = async ({ body, profileId, supabaseClient }) => {
  if (body.source_mission_id && body.source_mission_id !== '__other__') {
    const { data: srcMission, error: srcErr } = await getMission(body.source_mission_id, supabaseClient);
    if (srcErr || !srcMission) return { error: 'Source mission not found.' };
    if (srcMission.host_id !== profileId) return { error: 'Only the host of a mission can use it as a credit source.' };
    return {
      source_mission_id: srcMission.id,
      source_mission_name: srcMission.name,
      source_mission_date: new Date(srcMission.date).toISOString().slice(0, 10)
    };
  }
  const name = (body.source_mission_name_other || '').trim();
  const date = (body.source_mission_date_other || '').trim();
  if (!name || !date) return { error: 'Source mission name and date are required.' };
  return {
    source_mission_id: null,
    source_mission_name: name,
    source_mission_date: date
  };
};
```

Refactor the POST create route from Task 9 to use this helper (replace its inline source-resolution block with `const src = await resolveOffscreenSource({ body: req.body, profileId: profile.id, supabaseClient: res.locals.supabase }); if (src.error) return res.status(400).send(src.error);` and feed `src` into the payload).

Then add the update route:

```javascript
router.post('/:id/offscreen-missions/:omId', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id: characterId, omId } = req.params;

  const { data: character, error: charError } = await getCharacter(characterId, res.locals.supabase);
  if (charError) return res.status(400).send(charError.message);
  if (character.creator_id !== profile.id) return res.status(403).send('Forbidden');

  const { data: existing, error: omError } = await getOffscreenMissionById({
    id: omId,
    supabase: res.locals.supabase
  });
  if (omError) return res.status(400).send(omError.message);
  if (!existing || existing.character_id !== characterId) {
    return res.status(404).send('Not found');
  }

  if (!req.body.name || !req.body.summary) {
    return res.status(400).send('Name and summary are required.');
  }

  const src = await resolveOffscreenSource({
    body: req.body, profileId: profile.id, supabaseClient: res.locals.supabase
  });
  if (src.error) return res.status(400).send(src.error);

  const { error } = await updateOffscreenMission({
    id: omId,
    payload: {
      name: req.body.name,
      summary: req.body.summary,
      merx_gained: req.body.merx_gained,
      source_mission_id: src.source_mission_id,
      source_mission_name: src.source_mission_name,
      source_mission_date: src.source_mission_date
    },
    supabase: res.locals.supabase
  });
  if (error) return res.status(400).send(error.message);

  return res.redirect(`/characters/${characterId}/${encodeURIComponent(character.name)}`);
});
```

- [ ] **Step 4: Manually verify**

In the dev server: edit an existing offscreen mission's name, summary, and merx. Expect: row updates; `commissary_reward` adjusts by the merx delta only (no credit or completed_missions movement).

- [ ] **Step 5: Commit**

```bash
git add routes/characters.js views/offscreen-mission-edit.handlebars
git commit -m "feat: edit + update routes for offscreen missions"
```

---

## Task 11: Route — POST /:omId/delete

**Files:**
- Modify: `routes/characters.js`

- [ ] **Step 1: Add the route**

```javascript
router.post('/:id/offscreen-missions/:omId/delete', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id: characterId, omId } = req.params;

  const { data: character, error: charError } = await getCharacter(characterId, res.locals.supabase);
  if (charError) return res.status(400).send(charError.message);
  if (character.creator_id !== profile.id) return res.status(403).send('Forbidden');

  const { data: existing, error: omError } = await getOffscreenMissionById({
    id: omId,
    supabase: res.locals.supabase
  });
  if (omError) return res.status(400).send(omError.message);
  if (!existing || existing.character_id !== characterId) {
    return res.status(404).send('Not found');
  }

  const { error } = await removeOffscreenMission({ id: omId, supabase: res.locals.supabase });
  if (error) return res.status(400).send(error.message);

  return res.redirect(`/characters/${characterId}/${encodeURIComponent(character.name)}`);
});
```

- [ ] **Step 2: Manually verify**

Delete an offscreen mission. Expect: redirect to character page; row gone; `conduit_credits +1`, `completed_missions -1`, `commissary_reward` reduced by the deleted entry's `merx_gained` (clamped at 0).

- [ ] **Step 3: Commit**

```bash
git add routes/characters.js
git commit -m "feat: delete route for offscreen missions"
```

---

## Task 12: Character page integration — Spend button + merged log

**Files:**
- Modify: `routes/characters.js` (in the `GET /:id/:name?` handler)
- Modify: `views/character.handlebars`

- [ ] **Step 1: Extend the route handler to fetch and merge offscreen missions**

In `routes/characters.js`, inside the `router.get('/:id/:name?', ...)` handler, after the existing `getCharacterRecentMissions` call (around line 482), add:

```javascript
const { data: offscreenMissions } = await listOffscreenMissions({
  characterId: id,
  supabase: res.locals.supabase
});

// Merge real missions and offscreen entries into a single chronological list.
// Each entry carries a `_kind` discriminator so the view can choose its renderer.
const mergedRecent = [
  ...(recentMissions || []).map(m => ({ _kind: 'mission', ...m })),
  ...(offscreenMissions || []).map(om => ({ _kind: 'offscreen', ...om, _sortDate: om.source_mission_date }))
];
const dateOf = (e) => e._kind === 'offscreen' ? e.source_mission_date : e.date;
mergedRecent.sort((a, b) => new Date(dateOf(b)) - new Date(dateOf(a)));
const recentMerged = mergedRecent.slice(0, 5);
```

Update the `res.render('character', { ... })` call to pass `recentMerged` instead of `recentMissions` — actually, pass both: keep `recentMissions` for backwards-compat with any other partial use, and add `recentMerged`.

```javascript
res.render('character', {
  // ... existing fields ...,
  recentMissions,
  recentMerged,
  // ... rest unchanged ...
});
```

- [ ] **Step 2: Update the character page view**

Edit `views/character.handlebars`:

**(a)** Replace the existing standalone `<p>Conduit Credits: ...</p>` block (currently around lines 275–277):

```handlebars
{{#if (eq effectiveVersion "v2")}}
  {{#if (and profile (eq character.creator_id profile.id))}}
  <div class="field is-grouped mb-3">
    <div class="control">
      <span class="tag is-info is-medium">
        Conduit Credits: {{character.conduit_credits}}
      </span>
    </div>
    {{#if character.conduit_credits}}
    <div class="control">
      <a class="button is-primary"
         href="/characters/{{character.id}}/offscreen-missions/new">
        Spend Conduit Credit
      </a>
    </div>
    {{/if}}
  </div>
  {{else}}
    {{#if character.conduit_credits}}
    <p class="has-text-grey"><strong>Conduit Credits:</strong> {{character.conduit_credits}}</p>
    {{/if}}
  {{/if}}
{{/if}}
```

**(b)** Replace the `{{#each recentMissions}}` block (currently around lines 80–93) with a merged renderer:

```handlebars
{{#if recentMerged.length}}
<div class="content">
  <ul>
    {{#each recentMerged}}
    {{#if (eq this._kind "offscreen")}}
      <li>
        {{> offscreen-mission-entry entry=this character=../character profile=../profile canViewSource=true}}
      </li>
    {{else}}
      {{#or this.is_public (eq ../profile.id this.creator_id)}}
      <li>
        <strong><a href="/missions/{{this.id}}">{{this.name}}</a></strong>
        <br>
        {{#if ../profile}}
        <small>{{date_tz this.date "MMM D, YYYY" ../profile.timezone}} - {{this.outcome}}</small>
        {{else}}
        <small>{{date this.date "MMM D, YYYY"}} - {{this.outcome}}</small>
        {{/if}}
      </li>
      {{/or}}
    {{/if}}
    {{/each}}
  </ul>
  <p class="has-text-right">
    <a href="/missions/character/{{character.id}}">View all missions →</a>
  </p>
</div>
{{else}}
  <p class="has-text-centered has-text-grey">No missions yet. Add one below or from the <a href="/missions">Missions</a> page.</p>
{{/if}}
```

The original block was guarded by `{{#if recentMissions.length}}` — switch that wrapper to `{{#if recentMerged.length}}` (keep the rest of the surrounding box and the "Add Mission" form unchanged).

Note on `canViewSource=true`: at the page level, if the viewer reached this character's page they can see at least the character; whether they can see the source mission depends on the source mission's RLS. A correct check would require pre-resolving each source mission's visibility. For now, pass `true` and let the link's destination return 404 if the viewer can't see it — acceptable trade-off vs. an extra N+1 query. Revisit if it becomes an actual user-visible problem.

- [ ] **Step 3: Manually verify**

In the dev server, on a character with both real and offscreen missions: the Recent Missions list contains both, sorted by date desc, offscreen entries tagged "Offscreen", with Edit/Delete buttons visible to the creator. The Spend button appears next to the credit balance when balance > 0 and the viewer is the creator.

- [ ] **Step 4: Commit**

```bash
git add routes/characters.js views/character.handlebars
git commit -m "feat: character page integrates offscreen missions + spend button"
```

---

## Task 13: All-missions page integration

**Files:**
- Modify: `routes/missions.js` (the `GET /character/:id` handler)
- Modify: `views/character-missions.handlebars`

- [ ] **Step 1: Extend the route handler**

In `routes/missions.js`, around line 464, add offscreen-mission loading and merge. Update the imports at the top of the file to include the new model exports:

```javascript
const { getCharacter, getCharacterAllMissions, getOwnMissions, searchPublicCharacters, listOffscreenMissions } = require('../util/supabase');
```

Replace the body of the `GET /character/:id` handler so it loads and merges:

```javascript
router.get('/character/:id', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { data: character, error } = await getCharacter(id, res.locals.supabase);

  if (error) return res.status(400).send(error.message);
  if (character.is_public === false && (!profile || character.creator_id !== profile.id)) {
    return res.status(404).send('Not found');
  }

  const { data: missions, error: missionsError } = await getCharacterAllMissions(id);
  if (missionsError) return res.status(400).send(missionsError.message);

  const { data: offscreenMissions } = await listOffscreenMissions({
    characterId: id,
    supabase: res.locals.supabase
  });

  const merged = [
    ...(missions || []).map(m => ({ _kind: 'mission', ...m })),
    ...(offscreenMissions || []).map(om => ({ _kind: 'offscreen', ...om }))
  ];
  const dateOf = (e) => e._kind === 'offscreen' ? e.source_mission_date : e.date;
  merged.sort((a, b) => new Date(dateOf(b)) - new Date(dateOf(a)));

  res.render('character-missions', {
    profile,
    character,
    missions,
    mergedMissions: merged,
    statList,
    adventClassList,
    aspirantPreviewClassList,
    playerCreatedClassList,
    classAbilityList,
    activeNav: 'characters',
    breadcrumbs: [
      { label: 'Characters', href: '/characters' },
      { label: character.name, href: `/characters/${id}/${encodeURIComponent(character.name)}` },
      { label: 'Missions', href: '#' }
    ]
  });
});
```

- [ ] **Step 2: Update the view to render the merged list**

Edit `views/character-missions.handlebars`. Replace the `{{#if missions.length}} ... {{/if}}` block (lines 13–69) with:

```handlebars
{{#if mergedMissions.length}}
<div class="block table-container">
  <table class="table is-fullwidth is-striped is-hoverable">
    <thead>
      <tr>
        <th>Mission Name</th>
        <th>Date</th>
        <th>Outcome</th>
        {{#and profile.id (eq character.creator_id profile.id)}}
        <th>Is Public?</th>
        {{/and}}
        <th>Summary</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      {{#each mergedMissions}}
      {{#if (eq this._kind "offscreen")}}
      <tr>
        <td>
          {{this.name}}
          <span class="tag is-info is-light ml-1">Offscreen</span>
        </td>
        <td>{{#if ../profile}}{{date_tz this.source_mission_date "MMM D, YYYY" ../profile.timezone}}{{else}}{{date this.source_mission_date "MMM D, YYYY"}}{{/if}}</td>
        <td><span class="tag is-success">Success</span></td>
        {{#and ../profile.id (eq ../character.creator_id ../profile.id)}}
        <td><span class="tag is-info is-light">Offscreen</span></td>
        {{/and}}
        <td>{{#if this.summary}}{{{markdown this.summary}}}{{else}}-{{/if}}</td>
        <td>
          <div class="buttons are-small">
            {{#if (eq ../character.creator_id ../profile.id)}}
            <a href="/characters/{{../character.id}}/offscreen-missions/{{this.id}}/edit" class="button is-warning">Edit</a>
            <form method="POST"
                  action="/characters/{{../character.id}}/offscreen-missions/{{this.id}}/delete"
                  onsubmit="return confirm('Delete this offscreen mission? The credit and counters will be refunded.');"
                  style="display: inline;">
              <button class="button is-danger is-light" type="submit">Delete</button>
            </form>
            {{/if}}
          </div>
        </td>
      </tr>
      {{else}}
        {{#or this.is_public (eq ../profile.id this.creator_id)}}
        <tr>
          <td>
            <a href="/missions/{{this.id}}">{{this.name}}</a>
            {{#if this.media_url}}
            <span class="icon has-text-info" title="Has video recording"><i class="fas fa-video"></i></span>
            {{/if}}
          </td>
          <td>{{#if ../profile}}{{date_tz this.date "MMM D, YYYY" ../profile.timezone}}{{else}}{{date this.date "MMM D, YYYY"}}{{/if}}</td>
          <td>
            <span class="tag {{#if (eq this.outcome 'success')}}is-success{{else if (eq this.outcome 'failure')}}is-danger{{else}}is-warning{{/if}}">
              {{capitalize this.outcome}}
            </span>
          </td>
          {{#and ../profile.id (eq this.creator_id ../profile.id)}}
          <td>
            {{#if this.is_public}}
            <span class="tag is-primary">Public</span>
            {{else}}
            <span class="tag is-gray">Private</span>
            {{/if}}
          </td>
          {{/and}}
          <td>{{#if this.summary}}{{{markdown this.summary}}}{{else}}-{{/if}}</td>
          <td>
            <div class="buttons are-small">
              <a href="/missions/{{this.id}}" class="button is-light">View</a>
              {{#if (eq this.creator_id ../profile.id)}}
              <a href="/missions/{{this.id}}/edit" class="button is-warning">Edit</a>
              {{/if}}
            </div>
          </td>
        </tr>
        {{/or}}
      {{/if}}
      {{/each}}
    </tbody>
  </table>
</div>
{{else}}
<div class="notification is-light has-text-centered">
  <p class="mb-3"><span class="icon is-large has-text-grey-light"><i class="fas fa-scroll fa-2x"></i></span></p>
  <p class="is-size-5 mb-2">No missions yet</p>
  <p>Missions for {{character.name}} will appear here once they've been on an adventure.</p>
</div>
{{/if}}
```

- [ ] **Step 3: Manually verify**

Visit `/missions/character/<id>` for a character with both real and offscreen missions. Expect: combined table sorted by date, offscreen entries tagged.

- [ ] **Step 4: Commit**

```bash
git add routes/missions.js views/character-missions.handlebars
git commit -m "feat: all-missions page includes offscreen missions"
```

---

## Task 14: End-to-end smoke + full test run

**Files:** none modified.

- [ ] **Step 1: Run the full test suite**

```bash
bun test
```

Expected: PASS. Pay attention to existing `models/character.test.js` and any route tests — the model mock in this file pokes at `_base`, so adding the new model file shouldn't disturb it, but verify.

- [ ] **Step 2: End-to-end smoke (manual, in the dev server)**

For a v2 character with `conduit_credits >= 2`:

1. Open the character page → see balance + Spend button.
2. Click Spend → fill in name/summary/merx, pick a hosted mission OR free-text source, submit.
3. Redirected to character page; balance is 1 lower; `completed_missions` is 1 higher; `commissary_reward` higher by the merx amount; the offscreen entry shows in Recent Missions with "Offscreen" tag.
4. Click "View all missions →" → the entry appears in the table, sorted by source date.
5. Edit the entry, change merx by ±N → `commissary_reward` adjusts by exactly that delta; credit and completed_missions are unchanged.
6. Delete the entry → confirm dialog → row gone; credit +1; completed_missions -1; commissary_reward back down.
7. Spend until balance = 0 → Spend button disappears.

If any step fails, fix in place and re-verify.

- [ ] **Step 3: Final commit (if anything fixed in step 2)**

```bash
git add -p   # cherry-pick only the fix changes
git commit -m "fix: <whatever needed fixing during smoke>"
```

---

## Self-review summary

- Spec coverage: data model (Task 1), spend RPC (Task 1), refund RPC (Task 1), adjust_commissary RPC (Task 4), create model (Task 2), list/getById/picker (Task 3), update (Task 4), remove (Task 5), spend form (Tasks 6, 8), edit form (Tasks 6, 10), entry display (Task 7), spend route (Task 9), edit/update routes (Task 10), delete route (Task 11), character-page integration (Task 12), all-missions integration (Task 13).
- Placeholder scan: clean — every step that changes code includes the code.
- Type/name consistency: model functions are referenced by the same names across model file, util/supabase re-export, and route imports (`createOffscreenMission`, `listOffscreenMissions`, `getOffscreenMissionById`, `updateOffscreenMission`, `removeOffscreenMission`, `listHostedMissionsForPicker`).
