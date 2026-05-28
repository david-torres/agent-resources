const { mock, test, expect, beforeAll, afterAll } = require('bun:test');

const realBase = require('./_base');

// Mock the supabase clients so the model never touches the network.
// Mirrors the pattern in models/character.test.js.
const makeClient = ({ inserted = [], updated = [], deleted = [], rpcCalls = [], rpcError = null, rows = [], insertError = null } = {}) => {
  const calls = { tables: [], filters: [], orders: [] };
  const client = {
    from(table) {
      calls.tables.push(table);
      const chain = {
        _table: table,
        select() { return chain; },
        eq(column, value) {
          calls.filters.push({ table, column, value });
          return chain;
        },
        order(column, opts) {
          calls.orders.push({ table, column, ascending: opts ? opts.ascending : true });
          return Promise.resolve({ data: rows, error: null });
        },
        single() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
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
  };
  client._calls = calls;
  return client;
};

beforeAll(() => {
  mock.module('./_base', () => ({
    supabase: realBase.supabase,
    supabaseAdmin: realBase.supabaseAdmin
  }));
});

afterAll(() => {
  mock.module('./_base', () => realBase);
});

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
  expect(client._calls.tables).toContain('offscreen_missions');
  expect(client._calls.filters).toContainEqual({ table: 'offscreen_missions', column: 'character_id', value: 'char-1' });
  expect(client._calls.orders).toContainEqual({ table: 'offscreen_missions', column: 'source_mission_date', ascending: false });
});

test('getOffscreenMissionById returns the row', async () => {
  const client = makeClient({ rows: [{ id: 'om-1', character_id: 'char-1' }] });
  const { getOffscreenMissionById } = require('./offscreen-mission');
  const { data, error } = await getOffscreenMissionById({ id: 'om-1', supabase: client });
  expect(error).toBeNull();
  expect(data.id).toBe('om-1');
  expect(client._calls.filters).toContainEqual({ table: 'offscreen_missions', column: 'id', value: 'om-1' });
});

test('getOffscreenMissionById returns null data when no row matches', async () => {
  const client = makeClient({ rows: [] });
  const { getOffscreenMissionById } = require('./offscreen-mission');
  const { data, error } = await getOffscreenMissionById({ id: 'missing', supabase: client });
  expect(error).toBeNull();
  expect(data).toBeNull();
});

// Update needs a richer client mock that lets us script per-call results.
const makeUpdateClient = ({ existing, fetchError = null, updateError = null, deltaRpcError = null }) => {
  const calls = { rowUpdate: null, rpcAdjust: null };
  return {
    calls,
    client: {
      from(table) {
        if (table !== 'offscreen_missions') throw new Error(`unexpected table ${table}`);
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          single() {
            // Initial fetch chain: gate on fetchError so the update path can short-circuit.
            return Promise.resolve({ data: fetchError ? null : existing, error: fetchError });
          },
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

test('updateOffscreenMission short-circuits and returns fetch error', async () => {
  const { calls, client } = makeUpdateClient({
    existing: null,
    fetchError: { code: 'PGRST116', message: 'not found' }
  });

  const { updateOffscreenMission } = require('./offscreen-mission');
  const { data, error } = await updateOffscreenMission({
    id: 'missing',
    payload: { name: 'x', summary: 'x', merx_gained: 0, source_mission_id: null, source_mission_name: 'M', source_mission_date: '2026-05-01' },
    supabase: client
  });

  expect(data).toBeNull();
  expect(error.code).toBe('PGRST116');
  expect(calls.rowUpdate).toBeNull();
  expect(calls.rpcAdjust).toBeNull();
});

test('updateOffscreenMission short-circuits on update error without calling RPC', async () => {
  const existing = {
    id: 'om-1', character_id: 'char-1',
    name: 'x', summary: 'x', merx_gained: 2,
    source_mission_id: null, source_mission_name: 'M', source_mission_date: '2026-05-01'
  };
  const { calls, client } = makeUpdateClient({
    existing,
    updateError: { code: '42501', message: 'permission denied' }
  });

  const { updateOffscreenMission } = require('./offscreen-mission');
  const { data, error } = await updateOffscreenMission({
    id: 'om-1',
    payload: { name: 'new', summary: 'new', merx_gained: 9, source_mission_id: null, source_mission_name: 'M', source_mission_date: '2026-05-01' },
    supabase: client
  });

  expect(data).toBeNull();
  expect(error.code).toBe('42501');
  expect(calls.rpcAdjust).toBeNull();
});

test('updateOffscreenMission returns RPC error when adjust_commissary_reward fails', async () => {
  const existing = {
    id: 'om-1', character_id: 'char-1',
    name: 'x', summary: 'x', merx_gained: 2,
    source_mission_id: null, source_mission_name: 'M', source_mission_date: '2026-05-01'
  };
  const { calls, client } = makeUpdateClient({
    existing,
    deltaRpcError: { code: 'XX000', message: 'boom' }
  });

  const { updateOffscreenMission } = require('./offscreen-mission');
  const { data, error } = await updateOffscreenMission({
    id: 'om-1',
    payload: { name: 'x', summary: 'x', merx_gained: 5, source_mission_id: null, source_mission_name: 'M', source_mission_date: '2026-05-01' },
    supabase: client
  });

  expect(data).toBeNull();
  expect(error.code).toBe('XX000');
  expect(calls.rpcAdjust).toEqual({
    name: 'adjust_commissary_reward',
    args: { p_character_id: 'char-1', p_delta: 3 }
  });
});

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

const makeRemoveClient = ({ existing, rpcError = null, deleteError = null, fetchError = null }) => {
  const calls = { rpcRefund: null, deletedFrom: null };
  return {
    calls,
    client: {
      from(table) {
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          single() { return Promise.resolve({ data: fetchError ? null : existing, error: fetchError }); },
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

test('removeOffscreenMission deletes the row and reverts the character progress', async () => {
  const existing = { id: 'om-1', character_id: 'char-1', merx_gained: 4 };
  const { calls, client } = makeRemoveClient({ existing });

  const { removeOffscreenMission } = require('./offscreen-mission');
  const { error } = await removeOffscreenMission({ id: 'om-1', supabase: client });

  expect(error).toBeNull();
  expect(calls.deletedFrom).toBe('offscreen_missions');
  expect(calls.rpcRefund).toEqual({
    name: 'revert_offscreen_mission_progress',
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

test('removeOffscreenMission short-circuits on fetch error without deleting or refunding', async () => {
  const { calls, client } = makeRemoveClient({
    existing: null,
    fetchError: { code: 'PGRST116', message: 'not found' }
  });

  const { removeOffscreenMission } = require('./offscreen-mission');
  const { data, error } = await removeOffscreenMission({ id: 'missing', supabase: client });

  expect(data).toBeNull();
  expect(error.code).toBe('PGRST116');
  expect(calls.deletedFrom).toBeNull();
  expect(calls.rpcRefund).toBeNull();
});

test('removeOffscreenMission returns RPC error after successful delete', async () => {
  const existing = { id: 'om-1', character_id: 'char-1', merx_gained: 4 };
  const { calls, client } = makeRemoveClient({
    existing,
    rpcError: { code: 'XX000', message: 'boom' }
  });

  const { removeOffscreenMission } = require('./offscreen-mission');
  const { data, error } = await removeOffscreenMission({ id: 'om-1', supabase: client });

  expect(data).toBeNull();
  expect(error.code).toBe('XX000');
  // Delete was attempted (and succeeded — the row is gone) but the refund failed.
  expect(calls.deletedFrom).toBe('offscreen_missions');
  expect(calls.rpcRefund).toEqual({
    name: 'revert_offscreen_mission_progress',
    args: { p_character_id: 'char-1', p_merx: 4 }
  });
});

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
  // (We can't fully assert presence of mis-2 in the result set because the mock returns the same
  // missions list regardless of `.not` filter — we instead assert the exclusion didn't include mis-2.)
  const tablesData = {
    offscreen_missions: [{ source_mission_id: 'mis-2' }],
    missions: [
      { id: 'mis-1', name: 'A', date: '2026-05-01' },
      { id: 'mis-2', name: 'B', date: '2026-04-15' },
      { id: 'mis-3', name: 'C', date: '2026-04-01' }
    ]
  };
  const calls = { notFilters: [] };
  const fakeClient = {
    from(table) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        not(col, op, val) { calls.notFilters.push({ table, col, op, val }); return chain; },
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

  // The mock returns all 3 missions regardless of `.not`. What we can verify is that the
  // model didn't put mis-2 into the exclusion list — it was filtered out by currentSourceId.
  const idExclusion = calls.notFilters.find(f => f.table === 'missions' && f.col === 'id' && f.op === 'in');
  // Since mis-2 was the only "used" id and we passed it as currentSourceId, the exclusion
  // list becomes empty — meaning the model should skip the .not('id', 'in', ...) call entirely.
  expect(idExclusion).toBeUndefined();
});

test('getAvailableHostedMissionsForPicker with no used missions skips the .not filter on missions', async () => {
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
        not(col, op, val) { calls.notFilters.push({ table, col, op, val }); return chain; },
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
  // No exclusion filter applied to the missions table.
  const idExclusion = calls.notFilters.find(f => f.table === 'missions' && f.col === 'id' && f.op === 'in');
  expect(idExclusion).toBeUndefined();
});
