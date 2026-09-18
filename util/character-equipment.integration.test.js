// util/character-equipment.integration.test.js
//
// Requires the local Supabase stack: SUPABASE_URL=http://127.0.0.1:54321
//
// A character's Enchantment and Mods are priced from their stored shape
// (util/merx-economy.js), so a shape the pricing functions cannot read must not
// be storable. Every write here is expected to be REJECTED -- the test changes
// no data, which is what makes it safe against a restored production copy.

require('./require-local-supabase');

const { test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const anyGearRow = async () => {
  const { data, error } = await sb.from('class_gear').select('id').limit(1);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  return data[0].id;
};

test('class_gear carries the equipment columns', async () => {
  const { error } = await sb.from('class_gear').select('id,enchantment,mods').limit(1);
  expect(error).toBeNull();
});

test('mods defaults to an empty array rather than null', async () => {
  const { data, error } = await sb.from('class_gear').select('mods').limit(50);
  expect(error).toBeNull();
  expect(data.every((row) => Array.isArray(row.mods))).toBe(true);
});

test('an enchantment source outside default/custom is rejected', async () => {
  const id = await anyGearRow();
  const { error } = await sb.from('class_gear')
    .update({ enchantment: { source: 'legendary' } })
    .eq('id', id);
  // 23514 is check_violation. Asserting the code keeps a missing column from
  // standing in for a working constraint.
  expect(error?.code).toBe('23514');
});

test('a custom enchantment with no name is rejected', async () => {
  const id = await anyGearRow();
  const { error } = await sb.from('class_gear')
    .update({ enchantment: { source: 'custom', name: '   ', description: 'x' } })
    .eq('id', id);
  expect(error?.code).toBe('23514');
});

test('a third Mod on one Signature is rejected', async () => {
  const id = await anyGearRow();
  const { error } = await sb.from('class_gear')
    .update({ mods: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] })
    .eq('id', id);
  expect(error?.code).toBe('23514');
});

test('mods must be an array, not an object', async () => {
  const id = await anyGearRow();
  const { error } = await sb.from('class_gear')
    .update({ mods: { name: 'a' } })
    .eq('id', id);
  expect(error?.code).toBe('23514');
});
