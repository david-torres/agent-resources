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
const { Client } = require('pg');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

test('classes carries the structured pre-release columns', async () => {
  const { data, error } = await sb.from('classes')
    .select('challenge_level,stat_line,stat_note,quote,quote_source,overview,conduit_notes,grounding,examples_heading,examples,tips_heading,designer,prerelease_section')
    .limit(1);
  expect(error).toBeNull();
  expect(Array.isArray(data)).toBe(true);
});

// A name alone is no longer a key: ENCLAVE: Aspirant V1 forks a catalogue row
// under its own name, so the same name can now match a parent and its fork.
// is_player_created picks out this fixture, which no book writes.
const BEASTMASTER = { name: 'Beastmaster', is_player_created: true };

test('challenge_level rejects a value outside Low/Mid/High', async () => {
  // PostgREST reports no error when an UPDATE matches no row, so asserting the
  // target exists is what keeps this from passing without touching the CHECK.
  const { data: existing, error: selectError } = await sb.from('classes')
    .select('id')
    .match(BEASTMASTER);
  expect(selectError).toBeNull();
  expect(existing).toHaveLength(1);

  const { error } = await sb.from('classes')
    .update({ challenge_level: 'Extreme' })
    .match(BEASTMASTER);
  // 23514 is check_violation. Asserting the code keeps a missing column from
  // standing in for a working constraint.
  expect(error?.code).toBe('23514');
});

test('prerelease_section rejects a value outside the normalized enum', async () => {
  const { data: existing, error: selectError } = await sb.from('classes')
    .select('id')
    .match(BEASTMASTER);
  expect(selectError).toBeNull();
  expect(existing).toHaveLength(1);

  // 'PCCs' is the document's own printed heading. The loader normalizes it to
  // 'pcc'; the raw heading must not reach the column.
  const { error } = await sb.from('classes')
    .update({ prerelease_section: 'PCCs' })
    .match(BEASTMASTER);
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

test('expanded_tips is never null and rejects an explicit null', async () => {
  const { data } = await sb.from('classes').select('id, expanded_tips');
  expect(data.every((row) => row.expanded_tips !== null)).toBe(true);

  // ENCLAVE: Aspirant V1 forks Berserker under its own name, so `name` alone
  // now matches two rows; content_format picks out the Advent parent.
  const { error } = await sb
    .from('classes')
    .update({ expanded_tips: null })
    .match({ name: 'Berserker', content_format: 'advent' });
  expect(error).not.toBeNull();
  expect(error.code).toBe('23502');
});

describe('classes.content_format', () => {
  // The CHECK in the sibling test below guards writes; this reads what is
  // stored, which is what a row written before the constraint existed would
  // violate. Both formats are live: the Advent catalogue and the twelve
  // ENCLAVE: Aspirant V1 forks.
  test("is never null and holds only 'advent' or 'aspirant'", async () => {
    const { data, error } = await sb
      .from('classes')
      .select('id, content_format');
    expect(error).toBeNull();
    expect(data.length).toBeGreaterThan(0);

    const outside = data
      .filter((row) => row.content_format !== 'advent' && row.content_format !== 'aspirant')
      .map((row) => `${row.id} is ${row.content_format ?? 'null'}`);

    expect(outside).toEqual([]);
  });

  // The population above cannot outlive the next book, but the column default
  // itself is readable without writing anything, straight from
  // information_schema.
  test("defaults to 'advent'", async () => {
    const db = new Client({
      connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    });
    await db.connect();
    try {
      const { rows } = await db.query(
        `select column_default from information_schema.columns
         where table_schema = $1 and table_name = $2 and column_name = $3`,
        ['public', 'classes', 'content_format']
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].column_default).toBe("'advent'::text");
    } finally {
      await db.end();
    }
  });

  test('rejects a value outside the enum', async () => {
    // `name` alone now matches Berserker's Advent parent and its Aspirant V1
    // fork; content_format picks out the parent.
    const { error } = await sb
      .from('classes')
      .update({ content_format: 'aspirant-v1' })
      .match({ name: 'Berserker', content_format: 'advent' });
    expect(error).not.toBeNull();
    expect(error.code).toBe('23514');
  });

  test('the family projection carries content_format', async () => {
    const rows = await require('../services/class/repository').fetchClassFamilyRows();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => typeof row.content_format === 'string')).toBe(true);
  });
});
