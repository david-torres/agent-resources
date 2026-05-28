# Conduit Credits — Profile Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Conduit Credits pool from per-character (`characters.conduit_credits`) to per-profile (derived from hosted missions and offscreen missions spent), enforce 1:1 between hosted missions and picker-linked spends via a partial unique index, and keep free-text-source spends available without consuming from the balance.

**Architecture:** Drop the dead column and its two RPCs. Add a partial unique index on `offscreen_missions.source_mission_id` and two new RPCs (`apply_offscreen_mission_progress`, `revert_offscreen_mission_progress`) that only touch `completed_missions` and `commissary_reward`. Balance is computed by `getProfileConduitCredits` (two cheap counts). The source picker uses `getAvailableHostedMissionsForPicker`, which excludes already-used missions (plus optionally the currently-edited source). Route handlers compute balance and gate picker-source submissions; free-text submissions bypass the gate.

**Tech Stack:** Node.js (Express), Bun (runtime + test runner), Supabase Postgres, Handlebars, htmx.

**Spec:** `docs/superpowers/specs/2026-05-26-conduit-credits-profile-pool-design.md`

---

## File map

**Create:**
- `supabase/migrations/20260526000001_conduit_credits_profile_pool.sql` — migration to drop the column + old functions, add the partial unique index + new functions.

**Modify:**
- `schema.sql` — mirror the migration (drop the old column/functions, add the new ones).
- `models/offscreen-mission.js` — swap RPC names in create/remove; map 23505 in create/update; add `getAvailableHostedMissionsForPicker`.
- `models/offscreen-mission.test.js` — update existing tests for new RPC names and order; add tests for the picker and 23505 handling.
- `models/profile.js` — add `getProfileConduitCredits`.
- `models/profile.test.js` *(may not exist; create if needed)* — add tests for the balance helper.
- `routes/characters.js` — use the new picker; balance check for picker-source on POST create/update; map 23505; remove the dead `character.conduit_credits` gate on GET new.
- `routes/profile.js` — fetch balance in `GET /` and pass to the view.
- `views/profile.handlebars` — render the Conduit Credits section.
- `views/character.handlebars` — remove per-character balance tag; spend button visible to creator unconditionally.
- `views/partials/character-v2-fields.handlebars` — remove the `conduit_credits` number input block.
- `views/partials/offscreen-mission-form.handlebars` — use `availableHostedMissions` instead of `hostedMissions`; show free-text-only guidance when picker is empty.

**Not touched:**
- `offscreen_missions` table structure (existing columns/RLS stay).
- `adjust_commissary_reward` RPC (still used by update flow).
- The 5 route URLs (paths stay the same).
- All-missions table view (`views/character-missions.handlebars`) — offscreen entries already render correctly there.

---

## Task 1: Schema migration

**Files:**
- Create: `supabase/migrations/20260526000001_conduit_credits_profile_pool.sql`
- Modify: `schema.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260526000001_conduit_credits_profile_pool.sql`:

```sql
-- Conduit Credits revision: drop the per-character pool, add profile-pool primitives.

-- 1. Drop the old per-character credit primitives.
DROP FUNCTION IF EXISTS spend_conduit_credit(UUID, INT);
DROP FUNCTION IF EXISTS refund_conduit_credit(UUID, INT);
ALTER TABLE characters DROP COLUMN IF EXISTS conduit_credits;

-- 2. Enforce 1:1 between hosted missions and picker-linked offscreen missions.
-- Free-text spends (source_mission_id IS NULL) are excluded via the partial WHERE.
CREATE UNIQUE INDEX IF NOT EXISTS offscreen_missions_source_unique_idx
  ON offscreen_missions (source_mission_id)
  WHERE source_mission_id IS NOT NULL;

-- 3. Replace the credit-bookkeeping RPCs with progress-only RPCs.

-- SECURITY INVOKER (default): runs as the caller so characters_update RLS applies as defense in depth.
-- Bumps completed_missions +1 and commissary_reward + p_merx. Used by createOffscreenMission.
CREATE OR REPLACE FUNCTION apply_offscreen_mission_progress(p_character_id UUID, p_merx INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET completed_missions = completed_missions + 1,
         commissary_reward = commissary_reward + COALESCE(p_merx, 0)
   WHERE id = p_character_id;
$$;

-- SECURITY INVOKER (default): runs as the caller so characters_update RLS applies as defense in depth.
-- Reverses apply_offscreen_mission_progress, clamped at 0. Used by removeOffscreenMission.
CREATE OR REPLACE FUNCTION revert_offscreen_mission_progress(p_character_id UUID, p_merx INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET completed_missions = GREATEST(completed_missions - 1, 0),
         commissary_reward = GREATEST(commissary_reward - COALESCE(p_merx, 0), 0)
   WHERE id = p_character_id;
$$;
```

- [ ] **Step 2: Mirror into `schema.sql`**

Edit `schema.sql`:

**(a)** Remove the existing line `ALTER TABLE characters ADD COLUMN IF NOT EXISTS conduit_credits INTEGER NOT NULL DEFAULT 0;` (around line 302 in the current file).

**(b)** In the block added by the prior revision (lines 303–397 of the current file — confirm with `grep -n "offscreen_missions" schema.sql`), remove the `spend_conduit_credit` and `refund_conduit_credit` function definitions (and their `SECURITY INVOKER` comments). The `offscreen_missions` table, its index, its RLS, and the `adjust_commissary_reward` function stay.

**(c)** Append the partial unique index and the two new functions immediately after `adjust_commissary_reward` (which now is the only kept function in the original block):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS offscreen_missions_source_unique_idx
  ON offscreen_missions (source_mission_id)
  WHERE source_mission_id IS NOT NULL;

-- SECURITY INVOKER (default): runs as the caller so characters_update RLS applies as defense in depth.
-- Bumps completed_missions +1 and commissary_reward + p_merx. Used by createOffscreenMission.
CREATE OR REPLACE FUNCTION apply_offscreen_mission_progress(p_character_id UUID, p_merx INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET completed_missions = completed_missions + 1,
         commissary_reward = commissary_reward + COALESCE(p_merx, 0)
   WHERE id = p_character_id;
$$;

-- SECURITY INVOKER (default): runs as the caller so characters_update RLS applies as defense in depth.
-- Reverses apply_offscreen_mission_progress, clamped at 0. Used by removeOffscreenMission.
CREATE OR REPLACE FUNCTION revert_offscreen_mission_progress(p_character_id UUID, p_merx INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET completed_missions = GREATEST(completed_missions - 1, 0),
         commissary_reward = GREATEST(commissary_reward - COALESCE(p_merx, 0), 0)
   WHERE id = p_character_id;
$$;
```

- [ ] **Step 3: Apply locally if possible**

If `$DATABASE_URL` is set in the environment:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260526000001_conduit_credits_profile_pool.sql
```

Expected: exits 0; `\d offscreen_missions` shows the new partial unique index; `\df+ apply_offscreen_mission_progress` shows the new function; `\d characters` no longer lists `conduit_credits`.

If `$DATABASE_URL` isn't set, skip and note in your report — the user will apply manually.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260526000001_conduit_credits_profile_pool.sql schema.sql
git commit -m "feat: migrate conduit credits to profile pool primitives"
```

---

## Task 2: Update createOffscreenMission — insert first, swap RPC, map 23505

**Files:**
- Modify: `models/offscreen-mission.js`
- Modify: `models/offscreen-mission.test.js`

Flips the call order: insert is now the integrity point (partial unique index rejects duplicate source_mission_id). The bookkeeping RPC moves to second. Maps Postgres 23505 to a clean duplicate-source error.

- [ ] **Step 1: Update existing tests and add new ones**

Open `models/offscreen-mission.test.js`. Find the three `createOffscreenMission` tests (first three in the file). Rewrite them as below — and add one new test for the 23505 path.

The current tests assert that `spend_conduit_credit` is called first and the insert is second; the new behavior is the reverse. The mock factory `makeClient` must also be extended so the `insert(...).select().single()` chain can return an error (to simulate the 23505).

First, find `makeClient` near the top of the file. Update its `insert` block to accept a per-test error:

```javascript
// Existing factory signature already accepts `inserted`. Add a new optional `insertError`.
const makeClient = ({ inserted = [], updated = [], deleted = [], rpcCalls = [], rpcError = null, rows = [], insertError = null } = {}) => {
  // ... rest unchanged until the insert handler:
        insert(payload) {
          inserted.push({ table, payload });
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: insertError ? null : { id: 'om-1', ...payload },
                    error: insertError
                  });
                }
              };
            }
          };
        },
  // ... rest unchanged
};
```

(Apply the equivalent change to the factory in place — only the `insert` chain's `single()` needs to honor `insertError`.)

Now replace the three existing `createOffscreenMission` tests with:

```javascript
test('createOffscreenMission inserts the row then calls apply_offscreen_mission_progress', async () => {
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
  expect(rpcCalls).toEqual([
    { name: 'apply_offscreen_mission_progress', args: { p_character_id: 'char-1', p_merx: 3 } }
  ]);
  expect(data.id).toBe('om-1');
});

test('createOffscreenMission surfaces 23505 unique-constraint error as duplicate_source_mission', async () => {
  const inserted = [];
  const rpcCalls = [];
  const client = makeClient({
    inserted,
    rpcCalls,
    insertError: {
      code: '23505',
      message: 'duplicate key value violates unique constraint "offscreen_missions_source_unique_idx"'
    }
  });

  const { createOffscreenMission } = require('./offscreen-mission');
  const { data, error } = await createOffscreenMission({
    characterId: 'char-1',
    payload: {
      name: 'x', summary: 'x', merx_gained: 0,
      source_mission_id: 'mis-1',
      source_mission_name: 'Real Mission', source_mission_date: '2026-05-01'
    },
    profileId: 'profile-1',
    supabase: client
  });

  expect(data).toBeNull();
  expect(error).toEqual({ code: '23505', message: 'duplicate_source_mission' });
  // Insert was attempted but RPC was not — we short-circuit on insert error.
  expect(inserted).toHaveLength(1);
  expect(rpcCalls).toHaveLength(0);
});

test('createOffscreenMission returns RPC error after successful insert', async () => {
  // The new failure mode: row exists but progress wasn't applied.
  const inserted = [];
  const rpcCalls = [];
  const client = makeClient({
    inserted,
    rpcCalls,
    rpcError: { code: 'XX000', message: 'boom' }
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
  expect(error.code).toBe('XX000');
  expect(inserted).toHaveLength(1);
  expect(rpcCalls).toEqual([
    { name: 'apply_offscreen_mission_progress', args: { p_character_id: 'char-1', p_merx: 0 } }
  ]);
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

  expect(inserted[0].payload.merx_gained).toBe(0);
  expect(rpcCalls[0].args.p_merx).toBe(0);
});
```

(Net effect: replace the three old tests with four new ones — happy path, 23505 duplicate, RPC error after insert, merx normalization.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test models/offscreen-mission.test.js
```

Expected: the four new tests fail because the implementation still calls `spend_conduit_credit` first. The 23505 test additionally fails because `duplicate_source_mission` isn't being mapped.

- [ ] **Step 3: Update the implementation**

Replace the entire `createOffscreenMission` in `models/offscreen-mission.js` with:

```javascript
const createOffscreenMission = async ({ characterId, payload, profileId, supabase: client = supabase }) => {
  // Two-step: insert row (integrity check via partial unique index on source_mission_id),
  // then bump character counters. Not atomic — if the RPC fails after the insert, the
  // offscreen mission row exists but completed_missions/commissary_reward weren't bumped.
  // Acceptable trade-off for a low-frequency, deliberate user action.
  // Recovery: call apply_offscreen_mission_progress manually with the same args.
  const merx = normalizeMerx(payload.merx_gained);

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

  const { data, error: insertError } = await client
    .from('offscreen_missions')
    .insert(row)
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      return { data: null, error: { code: '23505', message: 'duplicate_source_mission' } };
    }
    return { data: null, error: insertError };
  }

  const { error: rpcError } = await client.rpc('apply_offscreen_mission_progress', {
    p_character_id: characterId,
    p_merx: merx
  });
  if (rpcError) return { data: null, error: rpcError };

  return { data, error: null };
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test models/offscreen-mission.test.js
```

Expected: all four createOffscreenMission tests pass. Other tests in the file may still fail (they target the not-yet-updated remove path); that's fine for now.

- [ ] **Step 5: Commit**

```bash
git add models/offscreen-mission.js models/offscreen-mission.test.js
git commit -m "feat: createOffscreenMission — insert first, apply RPC, map 23505"
```

---

## Task 3: Update removeOffscreenMission — swap RPC name

**Files:**
- Modify: `models/offscreen-mission.js`
- Modify: `models/offscreen-mission.test.js`

- [ ] **Step 1: Update tests**

In `models/offscreen-mission.test.js`, find the four `removeOffscreenMission` tests. Update the expected RPC name in each from `refund_conduit_credit` to `revert_offscreen_mission_progress`. Specifically:

The happy-path test currently asserts:

```javascript
  expect(calls.rpcRefund).toEqual({
    name: 'refund_conduit_credit',
    args: { p_character_id: 'char-1', p_merx: 4 }
  });
```

Replace `refund_conduit_credit` with `revert_offscreen_mission_progress` in that assertion.

The RPC-error-after-delete test currently asserts:

```javascript
  expect(calls.rpcRefund).toEqual({
    name: 'refund_conduit_credit',
    args: { p_character_id: 'char-1', p_merx: 4 }
  });
```

Apply the same rename.

(The other two remove tests — delete-error and fetch-error — assert `calls.rpcRefund` is null and don't reference the RPC name; leave them alone.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test models/offscreen-mission.test.js
```

Expected: the two remove tests that name the RPC fail; the rest pass.

- [ ] **Step 3: Update the implementation**

In `models/offscreen-mission.js`, find `removeOffscreenMission` and change the RPC name from `'refund_conduit_credit'` to `'revert_offscreen_mission_progress'`. Also update the inline comment to say "Two-step: delete row then revert-progress RPC" instead of "refund". Final function:

```javascript
const removeOffscreenMission = async ({ id, supabase: client = supabase }) => {
  // Two-step: delete row then revert-progress RPC. Not atomic (same trade-off as create/update);
  // if the RPC fails after the delete, the row is gone but counters weren't reverted.
  // Recovery: call revert_offscreen_mission_progress manually with the deleted row's character_id/merx.
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

  const { error: rpcError } = await client.rpc('revert_offscreen_mission_progress', {
    p_character_id: existing.character_id,
    p_merx: existing.merx_gained || 0
  });
  if (rpcError) return { data: null, error: rpcError };

  return { data: { id }, error: null };
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test models/offscreen-mission.test.js
```

Expected: all remove tests pass.

- [ ] **Step 5: Commit**

```bash
git add models/offscreen-mission.js models/offscreen-mission.test.js
git commit -m "feat: removeOffscreenMission — call revert_offscreen_mission_progress"
```

---

## Task 4: Update updateOffscreenMission — handle 23505 on source change

**Files:**
- Modify: `models/offscreen-mission.js`
- Modify: `models/offscreen-mission.test.js`

The update flow needs to map a 23505 (unique constraint) thrown when the user changes the source mission to one already used. The merx-delta + adjust_commissary_reward logic stays.

- [ ] **Step 1: Add a failing test**

Append to `models/offscreen-mission.test.js`:

```javascript
test('updateOffscreenMission surfaces 23505 on source change as duplicate_source_mission', async () => {
  const existing = {
    id: 'om-1', character_id: 'char-1',
    name: 'x', summary: 'x', merx_gained: 2,
    source_mission_id: null, source_mission_name: 'M', source_mission_date: '2026-05-01'
  };
  const { calls, client } = makeUpdateClient({
    existing,
    updateError: {
      code: '23505',
      message: 'duplicate key value violates unique constraint "offscreen_missions_source_unique_idx"'
    }
  });

  const { updateOffscreenMission } = require('./offscreen-mission');
  const { data, error } = await updateOffscreenMission({
    id: 'om-1',
    payload: { name: 'x', summary: 'x', merx_gained: 2, source_mission_id: 'mis-9', source_mission_name: 'M9', source_mission_date: '2026-05-01' },
    supabase: client
  });

  expect(data).toBeNull();
  expect(error).toEqual({ code: '23505', message: 'duplicate_source_mission' });
  expect(calls.rpcAdjust).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify it fails**

```bash
bun test models/offscreen-mission.test.js
```

Expected: the new test fails — the current implementation returns the raw `updateError` (whose `message` is the Postgres error string, not `duplicate_source_mission`).

- [ ] **Step 3: Update the implementation**

In `models/offscreen-mission.js`, in `updateOffscreenMission`, change the post-update error handling from:

```javascript
  if (error) return { data: null, error };
```

to:

```javascript
  if (error) {
    if (error.code === '23505') {
      return { data: null, error: { code: '23505', message: 'duplicate_source_mission' } };
    }
    return { data: null, error };
  }
```

- [ ] **Step 4: Run tests**

```bash
bun test models/offscreen-mission.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add models/offscreen-mission.js models/offscreen-mission.test.js
git commit -m "feat: updateOffscreenMission — map 23505 on source change"
```

---

## Task 5: Profile model — getProfileConduitCredits

**Files:**
- Modify: `models/profile.js`
- Create or modify: `models/profile.test.js`

Adds a model function that returns `{ earned, spent_linked, balance }` for a profile.

- [ ] **Step 1: Check if `models/profile.test.js` exists; create skeleton if not**

```bash
ls models/profile.test.js 2>/dev/null && echo "exists" || echo "missing"
```

If it doesn't exist, create `models/profile.test.js` with this skeleton:

```javascript
const { mock, test, expect, beforeAll, afterAll } = require('bun:test');

const realBase = require('./_base');

beforeAll(() => {
  mock.module('./_base', () => ({
    supabase: realBase.supabase,
    supabaseAdmin: realBase.supabaseAdmin
  }));
});

afterAll(() => {
  mock.module('./_base', () => realBase);
});
```

If it does exist, skip the skeleton and append to the bottom.

- [ ] **Step 2: Add a failing test**

Append:

```javascript
test('getProfileConduitCredits returns earned, spent_linked, and balance', async () => {
  // The mock returns a chosen `count` per (table, eq, not) combination.
  const calls = { queries: [] };
  const fakeClient = {
    from(table) {
      const state = { table, filters: [], notFilters: [], opts: {} };
      const chain = {
        select(_cols, opts) { state.opts = opts || {}; return chain; },
        eq(col, val) { state.filters.push({ col, val }); return chain; },
        not(col, op, val) { state.notFilters.push({ col, op, val }); return chain; },
        then(onF, onR) {
          calls.queries.push(state);
          let count = 0;
          if (state.table === 'missions') count = 7;
          if (state.table === 'offscreen_missions') count = 2;
          return Promise.resolve({ count, data: null, error: null }).then(onF, onR);
        }
      };
      return chain;
    }
  };

  const { getProfileConduitCredits } = require('./profile');
  const { data, error } = await getProfileConduitCredits({ profileId: 'profile-1', supabase: fakeClient });

  expect(error).toBeNull();
  expect(data).toEqual({ earned: 7, spent_linked: 2, balance: 5 });

  // Verify the two queries were shaped correctly.
  const missionsCall = calls.queries.find(q => q.table === 'missions');
  expect(missionsCall.filters).toContainEqual({ col: 'host_id', val: 'profile-1' });
  expect(missionsCall.opts).toMatchObject({ count: 'exact', head: true });

  const offscreenCall = calls.queries.find(q => q.table === 'offscreen_missions');
  expect(offscreenCall.filters).toContainEqual({ col: 'created_by', val: 'profile-1' });
  expect(offscreenCall.notFilters).toContainEqual({ col: 'source_mission_id', op: 'is', val: null });
});
```

- [ ] **Step 3: Verify it fails**

```bash
bun test models/profile.test.js
```

Expected: `getProfileConduitCredits is not a function`.

- [ ] **Step 4: Implement**

In `models/profile.js`, just before `module.exports`, add:

```javascript
const getProfileConduitCredits = async ({ profileId, supabase: client = supabase }) => {
  const { count: earnedCount, error: earnedError } = await client
    .from('missions')
    .select('*', { count: 'exact', head: true })
    .eq('host_id', profileId);
  if (earnedError) return { data: null, error: earnedError };

  const { count: spentLinkedCount, error: spentError } = await client
    .from('offscreen_missions')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', profileId)
    .not('source_mission_id', 'is', null);
  if (spentError) return { data: null, error: spentError };

  const earned = earnedCount || 0;
  const spent_linked = spentLinkedCount || 0;
  return {
    data: { earned, spent_linked, balance: earned - spent_linked },
    error: null
  };
};
```

Add `getProfileConduitCredits` to the `module.exports` block at the bottom of the file.

- [ ] **Step 5: Run tests**

```bash
bun test models/profile.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add models/profile.js models/profile.test.js
git commit -m "feat: getProfileConduitCredits — derived balance from counts"
```

---

## Task 6: Offscreen-mission model — getAvailableHostedMissionsForPicker

**Files:**
- Modify: `models/offscreen-mission.js`
- Modify: `models/offscreen-mission.test.js`

Returns missions where `host_id = profileId` AND `id NOT IN (SELECT source_mission_id FROM offscreen_missions WHERE source_mission_id IS NOT NULL)`. If `currentSourceId` is provided, the currently-linked mission is re-included so it stays selectable in edit mode.

The supabase-js client doesn't have a clean `NOT IN (subquery)` API; the cleanest path is to fetch the used IDs first, then exclude in a second query via `.not('id', 'in', ...)`. Two round-trips, both cheap.

- [ ] **Step 1: Add a failing test**

Append to `models/offscreen-mission.test.js`:

```javascript
test('getAvailableHostedMissionsForPicker excludes missions already used as a source', async () => {
  // The mock returns specific row sets per table.
  const calls = { tables: [], filters: [], notFilters: [], orders: [] };
  const tablesData = {
    offscreen_missions: [
      { source_mission_id: 'mis-2' },
      { source_mission_id: 'mis-4' }
    ],
    missions: [
      { id: 'mis-1', name: 'A', date: '2026-05-01' },
      { id: 'mis-3', name: 'C', date: '2026-04-01' }
    ]
  };
  const fakeClient = {
    from(table) {
      calls.tables.push(table);
      const chain = {
        select() { return chain; },
        eq(col, val) { calls.filters.push({ table, col, val }); return chain; },
        not(col, op, val) { calls.notFilters.push({ table, col, op, val }); return chain; },
        order(col, opts) {
          calls.orders.push({ table, col, ascending: opts && opts.ascending });
          return Promise.resolve({ data: tablesData[table] || [], error: null });
        },
        then(onF, onR) {
          return Promise.resolve({ data: tablesData[table] || [], error: null }).then(onF, onR);
        }
      };
      return chain;
    }
  };

  const { getAvailableHostedMissionsForPicker } = require('./offscreen-mission');
  const { data, error } = await getAvailableHostedMissionsForPicker({
    profileId: 'profile-1',
    supabase: fakeClient
  });

  expect(error).toBeNull();
  expect(data).toEqual([
    { id: 'mis-1', name: 'A', date: '2026-05-01' },
    { id: 'mis-3', name: 'C', date: '2026-04-01' }
  ]);

  // Verify the missions query was filtered by host_id and ordered by date desc.
  const missionsFilter = calls.filters.find(f => f.table === 'missions' && f.col === 'host_id');
  expect(missionsFilter.val).toBe('profile-1');
  // Verify it excluded the used IDs.
  const exclusion = calls.notFilters.find(f => f.table === 'missions' && f.col === 'id' && f.op === 'in');
  expect(exclusion).toBeDefined();
  // The exclusion list is formatted as a PostgREST array literal: "(mis-2,mis-4)"
  expect(exclusion.val).toContain('mis-2');
  expect(exclusion.val).toContain('mis-4');
});

test('getAvailableHostedMissionsForPicker with currentSourceId re-adds that mission to results', async () => {
  // Mission mis-2 is "used" — but we pass currentSourceId='mis-2', so it should be available.
  const tablesData = {
    offscreen_missions: [{ source_mission_id: 'mis-2' }],
    missions: [
      { id: 'mis-1', name: 'A', date: '2026-05-01' },
      { id: 'mis-2', name: 'B', date: '2026-04-15' },
      { id: 'mis-3', name: 'C', date: '2026-04-01' }
    ]
  };
  const fakeClient = {
    from(table) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        not() { return chain; },
        order() { return Promise.resolve({ data: tablesData[table] || [], error: null }); },
        then(onF, onR) { return Promise.resolve({ data: tablesData[table] || [], error: null }).then(onF, onR); }
      };
      return chain;
    }
  };

  const { getAvailableHostedMissionsForPicker } = require('./offscreen-mission');
  const { data } = await getAvailableHostedMissionsForPicker({
    profileId: 'profile-1',
    currentSourceId: 'mis-2',
    supabase: fakeClient
  });

  // mis-2 is included because currentSourceId points to it. mis-1 and mis-3 come back from the
  // missions query (the mock returns the same set regardless of `.not` filter, which is fine —
  // we only verify the model's *output*: that mis-2 is present even though it was "used").
  const ids = (data || []).map(m => m.id);
  expect(ids).toContain('mis-2');
});

test('getAvailableHostedMissionsForPicker with no used missions skips the .not filter', async () => {
  // When there are no used source missions, the model should not call `.not('id', 'in', ...)`
  // because PostgREST rejects `.in.()` with an empty list. Instead it should just run the host_id query.
  const calls = { notFilters: [] };
  const tablesData = {
    offscreen_missions: [],
    missions: [
      { id: 'mis-1', name: 'A', date: '2026-05-01' }
    ]
  };
  const fakeClient = {
    from(table) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        not(col, op, val) { calls.notFilters.push({ col, op, val }); return chain; },
        order() { return Promise.resolve({ data: tablesData[table] || [], error: null }); },
        then(onF, onR) { return Promise.resolve({ data: tablesData[table] || [], error: null }).then(onF, onR); }
      };
      return chain;
    }
  };

  const { getAvailableHostedMissionsForPicker } = require('./offscreen-mission');
  const { data, error } = await getAvailableHostedMissionsForPicker({
    profileId: 'profile-1',
    supabase: fakeClient
  });

  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  // No exclusion filter applied to missions because there's nothing to exclude.
  const idExclusion = calls.notFilters.find(f => f.col === 'id' && f.op === 'in');
  expect(idExclusion).toBeUndefined();
});
```

- [ ] **Step 2: Verify the tests fail**

```bash
bun test models/offscreen-mission.test.js
```

Expected: three new FAILs — function not exported.

- [ ] **Step 3: Implement**

In `models/offscreen-mission.js`, just before `module.exports`, add:

```javascript
const getAvailableHostedMissionsForPicker = async ({ profileId, currentSourceId = null, supabase: client = supabase }) => {
  // Step 1: gather mission IDs already used as a source for some offscreen mission.
  const { data: usedRows, error: usedError } = await client
    .from('offscreen_missions')
    .select('source_mission_id')
    .not('source_mission_id', 'is', null);
  if (usedError) return { data: null, error: usedError };

  // currentSourceId is the source the row being edited already points to — we want to keep
  // it available so the user can leave it selected. Drop it from the exclusion set.
  let usedIds = (usedRows || []).map(r => r.source_mission_id);
  if (currentSourceId) {
    usedIds = usedIds.filter(id => id !== currentSourceId);
  }

  // Step 2: query missions the user hosted, excluding the used set.
  let query = client
    .from('missions')
    .select('id, name, date')
    .eq('host_id', profileId);

  if (usedIds.length > 0) {
    // PostgREST `.in` value: parenthesized comma-separated list.
    query = query.not('id', 'in', `(${usedIds.join(',')})`);
  }

  const { data, error } = await query.order('date', { ascending: false });
  return { data, error };
};
```

Add `getAvailableHostedMissionsForPicker` to `module.exports`.

- [ ] **Step 4: Run tests**

```bash
bun test models/offscreen-mission.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add models/offscreen-mission.js models/offscreen-mission.test.js
git commit -m "feat: getAvailableHostedMissionsForPicker — exclude used sources"
```

---

## Task 7: Route — GET /:id/offscreen-missions/new uses the new picker + drops the dead gate

**Files:**
- Modify: `routes/characters.js`

- [ ] **Step 1: Update the imports**

Find the line that imports from `'../models/offscreen-mission'` (added earlier in this branch — should be around line 10 of `routes/characters.js`):

```javascript
const { createOffscreenMission, getOffscreenMissionById, updateOffscreenMission, removeOffscreenMission, listOffscreenMissions } = require('../models/offscreen-mission');
```

Replace with:

```javascript
const { createOffscreenMission, getOffscreenMissionById, updateOffscreenMission, removeOffscreenMission, listOffscreenMissions, getAvailableHostedMissionsForPicker } = require('../models/offscreen-mission');
```

Also add an import for `getProfileConduitCredits` from `models/profile`. Find the existing `const { getOwnCharacters, getCharacter, ... } = require('../util/supabase');` line (line 5). Add a new line right after it:

```javascript
const { getProfileConduitCredits } = require('../models/profile');
```

- [ ] **Step 2: Find and replace the GET /new handler**

Locate the handler `router.get('/:id/offscreen-missions/new', isAuthenticated, ...)` (added in Task 8 of the prior plan; should be in the file already). Replace its body with:

```javascript
router.get('/:id/offscreen-missions/new', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { data: character, error } = await getCharacter(id, res.locals.supabase);
  if (error) return res.status(400).send(error.message);
  if (character.creator_id !== profile.id) return res.status(403).send('Forbidden');

  const { data: availableHostedMissions } = await getAvailableHostedMissionsForPicker({
    profileId: profile.id,
    supabase: res.locals.supabase
  });
  const { data: profileCredits } = await getProfileConduitCredits({
    profileId: profile.id,
    supabase: res.locals.supabase
  });

  res.render('offscreen-mission-new', {
    title: `Spend a Credit — ${character.name}`,
    profile,
    character,
    availableHostedMissions: availableHostedMissions || [],
    profileCredits: profileCredits || { earned: 0, spent_linked: 0, balance: 0 },
    breadcrumbs: [
      { label: 'Characters', href: '/characters' },
      { label: character.name, href: `/characters/${id}/${encodeURIComponent(character.name)}` },
      { label: 'Spend Conduit Credit', href: '#' }
    ]
  });
});
```

Two notable changes vs. the prior version:
- The `if (!character.conduit_credits || character.conduit_credits <= 0)` gate is gone — no per-character balance to check anymore. The form handles "no available picker" by offering free-text.
- `hostedMissions` rename → `availableHostedMissions`. The form partial will be updated in Task 12 to use the new name. (For now the form still references `hostedMissions`; the new view renders are temporarily broken but will be fixed in Task 12.)

- [ ] **Step 3: Run tests**

```bash
bun test
```

Expected: still green. Route file should parse.

- [ ] **Step 4: Commit**

```bash
git add routes/characters.js
git commit -m "feat: GET offscreen-missions/new — fetch picker + balance from profile"
```

---

## Task 8: Route — POST /:id/offscreen-missions balance check + 23505 mapping

**Files:**
- Modify: `routes/characters.js`

- [ ] **Step 1: Update the POST create handler**

Find `router.post('/:id/offscreen-missions', isAuthenticated, ...)`. Inside, after the existing `if (!req.body.name || !req.body.summary)` validation, and BEFORE the `resolveOffscreenSource` call (which uses `getMission`), we'll add a balance check that's conditional on a picker source.

Replace the section from the `resolveOffscreenSource` call through the `createOffscreenMission` call with:

```javascript
  const src = await resolveOffscreenSource({
    body: req.body, profileId: profile.id, supabaseClient: res.locals.supabase
  });
  if (src.error) return res.status(400).send(src.error);

  // If the user picked a hosted mission as the source, gate on the profile's balance.
  // Free-text sources bypass the gate.
  if (src.source_mission_id) {
    const { data: credits } = await getProfileConduitCredits({
      profileId: profile.id,
      supabase: res.locals.supabase
    });
    if (!credits || credits.balance <= 0) {
      return res.status(400).send('No Conduit Credits available.');
    }
  }

  const { error } = await createOffscreenMission({
    characterId,
    profileId: profile.id,
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

  if (error) {
    if (error.code === '23505' || error.message === 'duplicate_source_mission') {
      return res.status(400).send('That mission has already funded a credit.');
    }
    return res.status(400).send(error.message);
  }

  return res.redirect(`/characters/${characterId}/${encodeURIComponent(character.name)}`);
});
```

This replaces both the old `no_conduit_credit_available` regex check (which targeted the now-dropped RPC error) and the prior generic `error.message` fallback. The new mapping is: 23505 → "duplicate source" (clean message); anything else → raw message.

- [ ] **Step 2: Run tests**

```bash
bun test
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add routes/characters.js
git commit -m "feat: POST offscreen-missions — profile balance check + 23505 mapping"
```

---

## Task 9: Route — GET edit picker includes current source; POST update 23505 mapping

**Files:**
- Modify: `routes/characters.js`

- [ ] **Step 1: Update GET edit handler**

Find `router.get('/:id/offscreen-missions/:omId/edit', isAuthenticated, ...)`. Replace the `getHostedMissions` call inside with a `getAvailableHostedMissionsForPicker` call that passes the currently-linked source as `currentSourceId`:

```javascript
  const { data: availableHostedMissions } = await getAvailableHostedMissionsForPicker({
    profileId: profile.id,
    currentSourceId: offscreenMission.source_mission_id || null,
    supabase: res.locals.supabase
  });
```

(Replaces the previous `getHostedMissions({ profileId, supabase })` call.)

Then update the `res.render('offscreen-mission-edit', { ... })` block: rename `hostedMissions: hostedMissions || []` to `availableHostedMissions: availableHostedMissions || []`.

Also remove the import line `const { getHostedMissions } = require('../models/mission');` from the top of the file if it's no longer referenced (run a grep to confirm). It was added in the prior plan; if no other code uses it, drop the import.

```bash
grep -n "getHostedMissions" routes/characters.js
```

If the only reference is the import line, remove that line. If something else still uses it, leave the import alone.

- [ ] **Step 2: Update POST update handler**

Find `router.post('/:id/offscreen-missions/:omId', isAuthenticated, ...)`. After the call to `updateOffscreenMission`, change the error handling from:

```javascript
  if (error) return res.status(400).send(error.message);
```

to:

```javascript
  if (error) {
    if (error.code === '23505' || error.message === 'duplicate_source_mission') {
      return res.status(400).send('That mission has already funded a credit.');
    }
    return res.status(400).send(error.message);
  }
```

(Same mapping as the POST create route in Task 8.)

Note: the edit flow doesn't need an explicit profile-balance gate. The user is editing an existing offscreen mission — the credit was already spent. If they change the source from one picker mission to another, the partial unique index enforces 1:1; if they change to free-text, no gate needed; if they change from free-text to picker, the balance is unchanged from before the edit (it's derived from the same row count). Free-text-to-picker on an edit increases `spent_linked` by 1, which could in theory drop balance below 0 — but only if the user was over-spending via free-text in the first place, which we explicitly allow.

(Actually one edge case: if the user has 0 picker-linked spends and 0 hosted missions, and they edit a free-text spend to point at a picker mission… they shouldn't be able to, because there's no picker mission for them to pick. The picker is filtered by `host_id = profile.id`, so the dropdown would be empty. Safe.)

- [ ] **Step 3: Run tests**

```bash
bun test
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add routes/characters.js
git commit -m "feat: edit/update routes — picker excludes used, map 23505"
```

---

## Task 10: Profile page integration — show Conduit Credits section

**Files:**
- Modify: `routes/profile.js`
- Modify: `views/profile.handlebars`

- [ ] **Step 1: Update the route handler**

In `routes/profile.js`, update the imports at the top. Find:

```javascript
const { updateUser, getProfileByName, setDiscordId, getPublicCharactersByCreator, getClasses, searchProfiles } = require('../util/supabase');
```

Append `getProfileConduitCredits` to that destructure:

```javascript
const { updateUser, getProfileByName, setDiscordId, getPublicCharactersByCreator, getClasses, searchProfiles, getProfileConduitCredits } = require('../util/supabase');
```

(The util/supabase module re-exports `...profile` which exports `getProfileConduitCredits` after Task 5.)

Then update the `router.get('/', ...)` handler. Currently:

```javascript
router.get('/', isAuthenticated, async (req, res) => {
  const { user, profile } = res.locals;
  let unlockedClasses = [];
  try {
    const { data } = await getUnlockedClasses(user.id);
    if (Array.isArray(data)) unlockedClasses = data;
  } catch (_) {}
  res.render('profile', {
    user,
    profile,
    unlockedClasses,
    activeNav: 'profile',
    breadcrumbs: [
      { label: 'Profile', href: '/profile' }
    ]
  });
});
```

Replace with:

```javascript
router.get('/', isAuthenticated, async (req, res) => {
  const { user, profile } = res.locals;
  let unlockedClasses = [];
  try {
    const { data } = await getUnlockedClasses(user.id);
    if (Array.isArray(data)) unlockedClasses = data;
  } catch (_) {}

  let conduitCredits = { earned: 0, spent_linked: 0, balance: 0 };
  try {
    const { data } = await getProfileConduitCredits({
      profileId: profile.id,
      supabase: res.locals.supabase
    });
    if (data) conduitCredits = data;
  } catch (_) {}

  res.render('profile', {
    user,
    profile,
    unlockedClasses,
    conduitCredits,
    activeNav: 'profile',
    breadcrumbs: [
      { label: 'Profile', href: '/profile' }
    ]
  });
});
```

- [ ] **Step 2: Update the view**

In `views/profile.handlebars`, insert a new section after the `</div>` closing the profile-info box (the one that ends with the View Profile button, around line 22). Add:

```handlebars
{{#if (or conduitCredits.earned conduitCredits.spent_linked)}}
<div class="box">
  <h3 class="title is-4">Conduit Credits</h3>
  <p><strong>Earned:</strong> {{conduitCredits.earned}} <span class="has-text-grey">(missions hosted)</span></p>
  <p><strong>Spent:</strong> {{conduitCredits.spent_linked}} <span class="has-text-grey">(offscreen missions with linked source)</span></p>
  <p><strong>Available:</strong> {{conduitCredits.balance}}</p>
</div>
{{/if}}
```

The `or` helper is registered via the `handlebars-helpers` package (already in use elsewhere — see `views/character.handlebars`).

- [ ] **Step 3: Run tests**

```bash
bun test
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add routes/profile.js views/profile.handlebars
git commit -m "feat: profile page shows Conduit Credits earned/spent/available"
```

---

## Task 11: Character page cleanup — remove balance tag, simplify Spend gating

**Files:**
- Modify: `views/character.handlebars`

The current character page (post Task 12 of the prior plan) has a v2-gated block that shows "Conduit Credits: N" + a "Spend Conduit Credit" button, gated on `character.conduit_credits`. With the column dropped, the tag is meaningless and the gate has to switch.

- [ ] **Step 1: Replace the Conduit Credits block**

Find this block (added by the prior plan, located in the character sidebar area):

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

Replace with:

```handlebars
      {{#if (eq effectiveVersion "v2")}}
        {{#if (and profile (eq character.creator_id profile.id))}}
        <div class="field is-grouped mb-3">
          <div class="control">
            <a class="button is-primary"
               href="/characters/{{character.id}}/offscreen-missions/new">
              Spend Conduit Credit
            </a>
          </div>
        </div>
        {{/if}}
      {{/if}}
```

The Spend button now:
- Is visible whenever the viewer is the creator of a v2 character.
- The "balance" lives on the profile page (already added in Task 10).
- The form behind it handles "no credits available" by showing only the free-text source path.

- [ ] **Step 2: Run tests**

```bash
bun test
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add views/character.handlebars
git commit -m "feat: character page — drop balance tag, simplify spend gating"
```

---

## Task 12: Character form cleanup — remove conduit_credits input

**Files:**
- Modify: `views/partials/character-v2-fields.handlebars`
- Modify: `models/character.js`
- Modify: `models/character.test.js`

The number input on the character edit form needs to go. The model's `createCharacter` / `updateCharacter` paths also reference the (now-dropped) `conduit_credits` column.

- [ ] **Step 1: Remove the form input**

In `views/partials/character-v2-fields.handlebars`, delete this block (currently at the top of the file, lines 4–10):

```handlebars
  <div class="field">
    <label class="label" for="char-conduit-credits">Conduit Credits</label>
    <div class="control">
      <input class="input" type="number" name="conduit_credits" id="char-conduit-credits"
             value="{{#if character.conduit_credits}}{{character.conduit_credits}}{{else}}0{{/if}}" min="0">
    </div>
  </div>

  <hr />
```

(Remove both the `<div class="field">...</div>` block AND the immediately-following `<hr />`. The file should then start directly with the next `<hr />` or the Quirks block.)

- [ ] **Step 2: Remove `conduit_credits` from the model**

In `models/character.js`, find these references and remove them:

**(a)** Line 122 (or near it): `const v2OnlyFields = ['conduit_credits', 'quirks', 'accessories', 'ability_perks'];` — drop `'conduit_credits'` from the array.

**(b)** Lines 208–209 (or near):

```javascript
    const cc = Number(characterReq.conduit_credits);
    characterReq.conduit_credits = Number.isFinite(cc) && cc >= 0 ? Math.floor(cc) : 0;
```

Delete these two lines entirely.

**(c)** Line 273 (or near): same `v2OnlyFields` array in the update path — drop `'conduit_credits'`.

**(d)** Lines 362–363 (or near): same `cc` coercion in the update path — delete the two lines.

**(e)** Line 1086 (or near):

```javascript
    out.conduit_credits = Number(row.conduit_credits) || 0;
```

Delete this line.

Use `grep -n conduit_credits models/character.js` to verify all references are gone after editing.

- [ ] **Step 3: Update tests**

In `models/character.test.js`, find and remove all `conduit_credits` references:

- Line ~109 (`conduit_credits: 0`) — remove from test row.
- Line ~208 (`conduit_credits: 7`) — remove from test row.
- Line ~218 (`expect(payload.conduit_credits).toBeUndefined();`) — remove the whole assertion.
- Line ~241 (`conduit_credits: 3`) — remove from test row.
- Line ~247 (`expect(payload.conduit_credits).toBe(3);`) — remove the whole assertion.
- Line ~382 (`conduit_credits: 0, ...`) — remove from test row.
- Line ~386 (`expect(out).not.toHaveProperty('conduit_credits');`) — remove the whole assertion.
- Line ~398 (`conduit_credits: 4`) — remove from test row.
- Line ~405 (`expect(out.conduit_credits).toBe(4);`) — remove the whole assertion.

Use `grep -n conduit_credits models/character.test.js` to verify clean.

- [ ] **Step 4: Run tests**

```bash
bun test
```

Expected: green. The character tests no longer reference the dropped field, so they should still pass.

- [ ] **Step 5: Commit**

```bash
git add views/partials/character-v2-fields.handlebars models/character.js models/character.test.js
git commit -m "feat: drop conduit_credits from character form, model, and tests"
```

---

## Task 13: Form partial — picker uses availableHostedMissions, free-text guidance

**Files:**
- Modify: `views/partials/offscreen-mission-form.handlebars`

The form currently iterates `hostedMissions`. We need to switch the var name to `availableHostedMissions` and add a help hint when it's empty.

- [ ] **Step 1: Rename the loop variable and add empty-state guidance**

In `views/partials/offscreen-mission-form.handlebars`, find the source mission `<select>` block:

```handlebars
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
```

Replace with (just rename `hostedMissions` to `availableHostedMissions` — same syntax otherwise):

```handlebars
        <select name="source_mission_id" id="om-source-select"
                onchange="document.getElementById('om-source-other').style.display = this.value === '__other__' ? 'block' : 'none';">
          {{#each availableHostedMissions}}
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
```

- [ ] **Step 2: Update the help text below the select**

Find the line:

```handlebars
    <p class="help">The hosted mission that earned this credit. Pick from the list, or "Other" to enter manually.</p>
```

Replace with a conditional that gives a different message when the picker is empty:

```handlebars
    {{#if availableHostedMissions.length}}
    <p class="help">The hosted mission that earned this credit. Pick from the list, or "Other" to enter manually.</p>
    {{else}}
    <p class="help">You have no available Conduit Credits to spend. To create an offscreen mission anyway, use "Other / not in the system" below.</p>
    {{/if}}
```

- [ ] **Step 3: Run tests**

```bash
bun test
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add views/partials/offscreen-mission-form.handlebars
git commit -m "feat: form partial — use availableHostedMissions, empty-state guidance"
```

---

## Task 14: End-to-end smoke + full test run

**Files:** none modified.

- [ ] **Step 1: Full test suite**

```bash
bun test
```

Expected: all pass. The model layer test count should be 16 offscreen-mission tests (down from 16 → adjusted for the four createOffscreenMission rewrites plus the new 23505/picker tests) plus profile tests. Exact number depends on test rewrites in Task 2 — verify nothing accidentally regressed.

- [ ] **Step 2: Static smoke checks**

```bash
# Confirm the dropped column and old RPCs are gone from app code.
grep -rn "conduit_credits" routes/ models/ views/ util/ | grep -v "specs/\|plans/"
# Expected: only `getProfileConduitCredits` references should remain (in models/profile.js, routes/profile.js, views/profile.handlebars).

grep -rn "spend_conduit_credit\|refund_conduit_credit" routes/ models/ views/ util/ | grep -v "specs/\|plans/"
# Expected: nothing.

# Confirm the new functions and methods are exported.
grep -n "apply_offscreen_mission_progress\|revert_offscreen_mission_progress" supabase/migrations/20260526000001_conduit_credits_profile_pool.sql schema.sql
# Expected: each appears in both files.

# Confirm the new model methods are exported through util/supabase.
bun -e "const u = require('./util/supabase'); for (const n of ['getProfileConduitCredits','getAvailableHostedMissionsForPicker','createOffscreenMission','removeOffscreenMission','updateOffscreenMission','listOffscreenMissions']) { if (typeof u[n] !== 'function') throw new Error('missing: '+n); } console.log('all exports present');"
# Expected: "all exports present"
```

- [ ] **Step 3: Manual smoke (only if env available)**

If you can start the dev server (`bun run dev`) with a logged-in account that has hosted at least one mission:

1. Open `/profile` → see "Conduit Credits — Earned N, Spent 0, Available N".
2. Open a v2 character page (creator-owned) → see "Spend Conduit Credit" button.
3. Click it → form renders. Source picker lists your hosted missions.
4. Submit a picker-source offscreen mission. Confirm:
   - Redirected to character page; entry appears in Recent Missions with "Offscreen" tag.
   - `/profile` now shows Spent +1, Available −1.
   - The same hosted mission no longer appears in the picker on a fresh form.
5. Submit a free-text offscreen mission. Confirm Spent counter stays unchanged.
6. Edit a picker-source offscreen mission, change the source to another hosted mission → succeeds. The freed mission is now available again in a fresh picker.
7. Try to manually POST a duplicate source (or simulate by editing two entries to point at the same mission). Confirm a "That mission has already funded a credit." 400.
8. Delete an offscreen mission. Confirm Spent counter decreases.

If you can't run the dev server, skip and note in the report.

- [ ] **Step 4: Final commit (if smoke turned anything up)**

```bash
git add -p   # cherry-pick fixes only
git commit -m "fix: <whatever needed fixing during smoke>"
```

---

## Self-review summary

**Spec coverage:**
- Drop `characters.conduit_credits`: Task 1 (migration) + Task 12 (model/form/tests).
- Drop `spend_conduit_credit` / `refund_conduit_credit`: Task 1.
- Add `apply_offscreen_mission_progress` / `revert_offscreen_mission_progress`: Task 1.
- Keep `adjust_commissary_reward`: not touched.
- Partial unique index on `offscreen_missions.source_mission_id`: Task 1.
- `getProfileConduitCredits`: Task 5.
- `getAvailableHostedMissionsForPicker` with `currentSourceId`: Task 6.
- `createOffscreenMission` insert-first, swap RPC, 23505 mapping: Task 2.
- `removeOffscreenMission` swap RPC: Task 3.
- `updateOffscreenMission` 23505 mapping on source change: Task 4.
- Route picker rename + balance fetch (GET new): Task 7.
- Route picker balance gate + 23505 mapping (POST create): Task 8.
- Route picker includes current source on edit; 23505 mapping on update: Task 9.
- Profile page integration: Task 10.
- Character page balance tag removal + spend button gating: Task 11.
- Character form `conduit_credits` input removal: Task 12.
- Form partial picker rename + empty-state guidance: Task 13.
- E2E + static smoke: Task 14.

**Placeholder scan:** clean — every step that changes code includes the code.

**Type/name consistency:**
- Model method names: `createOffscreenMission`, `updateOffscreenMission`, `removeOffscreenMission`, `listOffscreenMissions`, `getOffscreenMissionById`, `getAvailableHostedMissionsForPicker`, `getProfileConduitCredits` — all match across tasks.
- RPC names: `apply_offscreen_mission_progress`, `revert_offscreen_mission_progress`, `adjust_commissary_reward` — match across migration (Task 1), model (Tasks 2–4), and tests.
- Render-context keys: `availableHostedMissions` (renamed from `hostedMissions`), `profileCredits`, `conduitCredits` — consistent where used.
- Error codes: `23505` → `duplicate_source_mission` mapping appears identically in model (Tasks 2 + 4) and routes (Tasks 8 + 9).
