// util/prerelease-classes.integration.test.js
//
// Requires the local Supabase stack: SUPABASE_URL=http://127.0.0.1:54321
//
// A pre-release class (prerelease_section set) is released Advent-format
// content at Advent v2; Aspirant forks retain Aspirant v1. A row filed under its
// PCC section is player-created. The class list, the loader and the character
// pages all read these columns, so a row that drifts from them is listed or
// played under the wrong rules. A stack seeded by util/seed-classes.js holds no
// pre-release row, and there both tests pass on an empty list.

require('./require-local-supabase');

const { test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const prereleaseRows = async () => {
  const { data, error } = await sb.from('classes')
    .select('id, name, prerelease_section, content_format, rules_edition, rules_version, status, is_player_created')
    .not('prerelease_section', 'is', null);
  expect(error).toBeNull();
  return data;
};

test('pre-release classes retain their published Advent v2 or Aspirant v1 identity', async () => {
  const off = (await prereleaseRows())
    .filter((row) => row.status !== 'release' || (row.rules_edition === 'aspirant'
      ? row.rules_version !== 'v1' || !['advent', 'aspirant'].includes(row.content_format)
      : row.rules_edition !== 'advent' || row.content_format !== 'advent' || row.rules_version !== 'v2'))
    .map((row) => `${row.name} (${row.id}) is ${row.rules_edition}/${row.content_format} ${row.rules_version} ${row.status}`);
  expect(off).toEqual([]);
});

test('every pre-release PCC is player-created', async () => {
  const off = (await prereleaseRows())
    .filter((row) => row.prerelease_section === 'pcc' && !row.is_player_created)
    .map((row) => `${row.name} (${row.id})`);
  expect(off).toEqual([]);
});
