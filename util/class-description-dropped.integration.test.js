// util/class-description-dropped.integration.test.js
//
// Requires the local Supabase stack: SUPABASE_URL=http://127.0.0.1:54321
//
// `classes.description` was an assembled duplicate of the structured prose
// columns. Task 13 drops it. Two things a unit test cannot see:
//
//  1. the column is actually gone (a reader that survives would 42703 in
//     production, not in any mocked test), and
//  2. `dup_class` still runs. DROP COLUMN does not rewrite a plpgsql body, so
//     the function kept naming `description` and would have failed at call
//     time -- and while it names its copy list explicitly, it omitted every
//     structured prose column, silently dropping the entire pre-release import
//     from any duplicate.
const { test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');
const { CLASS_PROSE_FIELDS } = require('./class-prose');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

test('classes no longer has a description column', async () => {
  const { error } = await sb.from('classes').select('description').limit(1);
  // 42703 is undefined_column.
  expect(error?.code).toBe('42703');
});

test('dup_class copies every structured prose column to the fork', async () => {
  const { data: source, error: sourceError } = await sb.from('classes')
    .select('*')
    .eq('name', 'Beastmaster')
    .single();
  expect(sourceError).toBeNull();
  // Guards against a vacuously green diff: a source with no prose set would
  // match an empty copy on every field.
  expect(source.overview).toBeTruthy();
  expect(source.examples.length).toBeGreaterThan(0);

  const newId = crypto.randomUUID();
  try {
    const { error: dupError } = await sb.rpc('dup_class', {
      new_id: newId,
      base_id: source.id,
      new_version: 'v2',
      new_edition: source.rules_edition,
    });
    expect(dupError).toBeNull();

    const { data: copy, error: copyError } = await sb.from('classes')
      .select('*')
      .eq('id', newId)
      .single();
    expect(copyError).toBeNull();
    expect(copy.base_class_id).toBe(source.id);
    expect(copy.rules_version).toBe('v2');

    for (const field of CLASS_PROSE_FIELDS) {
      expect([field, copy[field]]).toEqual([field, source[field]]);
    }
  } finally {
    await sb.from('classes').delete().eq('id', newId);
  }
});
