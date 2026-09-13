// util/class-duplicate.integration.test.js
//
// Requires the local Supabase stack: SUPABASE_URL=http://127.0.0.1:54321

require('./require-local-supabase');

const { test, expect, afterAll } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const FIXTURE_NAME_PREFIX = 'Fork Source';

// Both the base row and the fork dup_class makes of it carry this prefix, and
// leaving them behind does more than grow the table: a leaked row on its own
// satisfies the `counts.advanced_abilities > 0` coverage guard in
// util/class-form-round-trip.integration.test.js, so that test's own fixture
// could stop carrying advanced abilities and its guard would still pass.
afterAll(async () => {
  const { error } = await supabase.from('classes').delete().like('name', `${FIXTURE_NAME_PREFIX} %`);
  expect(error).toBeNull();
});

// dup_class lists its columns explicitly, so a column added after it was last
// written is dropped by every fork without a word. That is how
// advanced_abilities (supabase/migrations/20260817000004_classes_advanced_abilities.sql)
// and free_play_access (supabase/migrations/20260905000000_free_prerelease_play_access.sql)
// both came to be lost.
test('a forked class keeps its advanced abilities and free play access', async () => {
  const advanced = [{
    name: 'High Noon', description: 'Pitch a Fizzle.', paired_action: '',
    meters: [], notes: [], sample_perks: []
  }];

  const { data: base } = await supabase.from('classes')
    .insert({
      name: `${FIXTURE_NAME_PREFIX} ${Date.now()}`, rules_edition: 'aspirant', rules_version: 'v1',
      status: 'alpha', is_public: false, is_player_created: true,
      stat_spread: {}, gear: [], abilities: [],
      advanced_abilities: advanced, free_play_access: true
    })
    .select('id').single();

  const newId = crypto.randomUUID();
  const { error } = await supabase.rpc('dup_class', {
    new_id: newId, base_id: base.id, new_version: 'v1', new_edition: null
  });
  expect(error).toBeNull();

  const { data: fork } = await supabase.from('classes')
    .select('advanced_abilities,free_play_access').eq('id', newId).single();

  expect(fork.advanced_abilities).toEqual(advanced);
  expect(fork.free_play_access).toBe(true);
});
