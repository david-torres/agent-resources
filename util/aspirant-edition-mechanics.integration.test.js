require('./require-local-supabase');
const { test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');
const { resolveCharacterMechanics } = require('./character-rules');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
test('Aspirant class published version is v1 and mechanics are Advent v2 in either format', async () => {
  const { data, error } = await sb.from('classes').select('id, name, rules_edition, rules_version, content_format').eq('rules_edition', 'aspirant');
  expect(error).toBeNull();
  for (const row of data) {
    expect(row.rules_version).toBe('v1');
    expect(resolveCharacterMechanics({ classRules: row })).toBe('advent-v2');
  }
});
