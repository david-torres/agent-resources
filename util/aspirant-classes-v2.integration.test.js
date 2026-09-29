// util/aspirant-classes-v2.integration.test.js
//
// Requires the local Supabase stack: SUPABASE_URL=http://127.0.0.1:54321
//
// classes.rules_version names the character rules a class's characters are
// built under. ENCLAVE: Aspirant V1 builds on Advent v2 -- Defining Quirk,
// Accessories, Ability Perks and the v2 level curve -- so an aspirant-format
// class off v2 would have its characters' v2 fields stripped on every save.

require('./require-local-supabase');

const { test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

test('every aspirant-format class is built under the v2 character rules', async () => {
  const { data, error } = await sb.from('classes')
    .select('id, name, rules_version')
    .eq('content_format', 'aspirant');
  expect(error).toBeNull();
  const off = data
    .filter((row) => row.rules_version !== 'v2')
    .map((row) => `${row.name} (${row.id}) is ${row.rules_version}`);
  expect(off).toEqual([]);
});
