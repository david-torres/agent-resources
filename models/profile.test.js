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
