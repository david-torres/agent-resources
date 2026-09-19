// util/stat-caps-integrity.integration.test.js
//
// traits_stat_known (supabase/migrations/20260919000000_traits_stat_affiliation.sql)
// restricts traits.stat to the twelve stat names, or NULL while the column is
// still nullable. This pins that constraint by attempting real writes and
// asserting on the error, not by reading the DDL.
//
// It mutates one existing trait row rather than inserting/deleting a fixture:
// a fixture character needs an auth.users row and a profile
// (models/character-atomic.integration.test.js), which is more setup than a
// CHECK constraint needs. util/character-equipment.integration.test.js proves
// the lighter approach out for the same kind of constraint -- "the test
// changes no data, which is what makes it safe against a restored production
// copy". The row's original stat is restored in afterAll either way.
//
// Requires the local Supabase stack: SUPABASE_URL=http://127.0.0.1:54321
require('./require-local-supabase');

const { test, expect, afterAll } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');
const { statList } = require('./enclave-consts');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

let fixtureId;
let fixtureOriginalStat;

const fixtureRow = async () => {
  if (fixtureId) return fixtureId;
  const { data, error } = await sb.from('traits').select('id,stat').limit(1);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  fixtureId = data[0].id;
  fixtureOriginalStat = data[0].stat;
  return fixtureId;
};

afterAll(async () => {
  if (fixtureId) {
    const { error } = await sb.from('traits').update({ stat: fixtureOriginalStat }).eq('id', fixtureId);
    expect(error).toBeNull();
  }
  const { count, error: countError } = await sb.from('traits').select('id', { count: 'exact', head: true });
  expect(countError).toBeNull();
  expect(count).toBe(981);
});

test('a stat outside the twelve names is rejected', async () => {
  const id = await fixtureRow();
  const { error } = await sb.from('traits').update({ stat: 'nonsense' }).eq('id', id);
  // 23514 is check_violation. Asserting the code, not just truthiness, keeps a
  // missing constraint from standing in for a working one.
  expect(error?.code).toBe('23514');
});

// Correct only until Task 9, which makes traits.stat NOT NULL once every
// write path supplies a value. Task 9 owns flipping this assertion to
// `expect(error?.code).toBe('23502')` (not_null_violation) -- see this
// migration's header comment for why the column is nullable today.
test('a null stat is still accepted -- Task 9 flips this to rejected', async () => {
  const id = await fixtureRow();
  const { error } = await sb.from('traits').update({ stat: null }).eq('id', id);
  expect(error).toBeNull();
});

test.each(statList)('%s is an accepted stat', async (stat) => {
  const id = await fixtureRow();
  const { error } = await sb.from('traits').update({ stat }).eq('id', id);
  expect(error).toBeNull();
});
