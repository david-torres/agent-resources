// util/whitespace-integrity.integration.test.js
// There is no CHECK constraint enforcing this -- normalization happens in the
// application input layer only. That makes coverage the whole guard, and this
// test the thing that notices a write path which skipped it.
const { test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

test('no stored text value carries leading or trailing whitespace', async () => {
  const { data, error } = await sb.rpc('untrimmed_text_values');
  expect(error).toBeNull();
  expect(data).toEqual([]);
});
