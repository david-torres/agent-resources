// util/class-structured-columns.integration.test.js
//
// Requires the local Supabase stack: SUPABASE_URL=http://127.0.0.1:54321
//
// The pre-release import writes per-class structure into columns that only a
// migration can create, and into a `challenge_level` whose vocabulary only a
// CHECK constraint can enforce. A loader that writes a bad level would
// otherwise fail silently at read time, long after the import.

const { test, expect } = require('bun:test');
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
