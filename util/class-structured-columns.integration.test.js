// util/class-structured-columns.integration.test.js
//
// Requires the local Supabase stack: SUPABASE_URL=http://127.0.0.1:54321
//
// The pre-release import writes per-class structure into columns that only a
// migration can create, and into a `challenge_level` whose vocabulary only a
// CHECK constraint can enforce. A loader that writes a bad level would
// otherwise fail silently at read time, long after the import.

require('./require-local-supabase');

const { describe, test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

test('classes carries the structured pre-release columns', async () => {
  const { data, error } = await sb.from('classes')
    .select('challenge_level,stat_line,stat_note,quote,quote_source,overview,conduit_notes,grounding,examples_heading,examples,tips_heading,designer,prerelease_section')
    .limit(1);
  expect(error).toBeNull();
  expect(Array.isArray(data)).toBe(true);
});

test('challenge_level rejects a value outside Low/Mid/High', async () => {
  // PostgREST reports no error when an UPDATE matches no row, so asserting the
  // target exists is what keeps this from passing without touching the CHECK.
  const { data: existing, error: selectError } = await sb.from('classes')
    .select('id')
    .eq('name', 'Beastmaster');
  expect(selectError).toBeNull();
  expect(existing).toHaveLength(1);

  const { error } = await sb.from('classes')
    .update({ challenge_level: 'Extreme' })
    .eq('name', 'Beastmaster');
  // 23514 is check_violation. Asserting the code keeps a missing column from
  // standing in for a working constraint.
  expect(error?.code).toBe('23514');
});

test('prerelease_section rejects a value outside the normalized enum', async () => {
  const { data: existing, error: selectError } = await sb.from('classes')
    .select('id')
    .eq('name', 'Beastmaster');
  expect(selectError).toBeNull();
  expect(existing).toHaveLength(1);

  // 'PCCs' is the document's own printed heading. The loader normalizes it to
  // 'pcc'; the raw heading must not reach the column.
  const { error } = await sb.from('classes')
    .update({ prerelease_section: 'PCCs' })
    .eq('name', 'Beastmaster');
  expect(error?.code).toBe('23514');
});

// 20260817000000 added the column nullable, which no other class-content
// column is: `examples` and `stat_spread` are both NOT NULL with a default.
// A null here reaches models/class.js:418's `Array.isArray(...) ? ... : []`
// and normalizes to [] on the way out, so the null never surfaces -- which is
// exactly why nothing caught it.
test('advanced_abilities is not null on any class', async () => {
  const { data, error } = await sb
    .from('classes')
    .select('id')
    .is('advanced_abilities', null);

  expect(error).toBeNull();
  expect(data).toEqual([]);
});

test('advanced_abilities rejects an explicit null', async () => {
  const { data: existing } = await sb.from('classes').select('id').limit(1);
  // PostgREST reports no error when an UPDATE matches no row.
  expect(existing).toHaveLength(1);

  const { error } = await sb
    .from('classes')
    .update({ advanced_abilities: null })
    .eq('id', existing[0].id);

  // 23502 is not_null_violation. Asserting the code keeps a missing
  // constraint (an update that silently succeeds) from passing as a rejection.
  expect(error?.code).toBe('23502');
});

describe('classes.content_format', () => {
  test('defaults to advent and is never null', async () => {
    const { data, error } = await sb
      .from('classes')
      .select('id, content_format');
    expect(error).toBeNull();
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((row) => row.content_format === 'advent')).toBe(true);
  });

  test('rejects a value outside the enum', async () => {
    const { error } = await sb
      .from('classes')
      .update({ content_format: 'aspirant-v1' })
      .eq('name', 'Berserker');
    expect(error).not.toBeNull();
    expect(error.code).toBe('23514');
  });
});
