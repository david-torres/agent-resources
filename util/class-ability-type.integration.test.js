// util/class-ability-type.integration.test.js
//
// Requires the local Supabase stack: SUPABASE_URL=http://127.0.0.1:54321

require('./require-local-supabase');

const { test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// The backfill must not be a blanket DEFAULT 'core'. Aspirant-mode characters
// draw their abilities from the class's advanced_abilities jsonb, so a blanket
// default would silently mislabel every one of them. See
// docs/superpowers/specs/2026-09-13-aspiring-persistence-design.md.
test('an ability named in its class advanced_abilities is tagged advanced', async () => {
  const { data, error } = await sb.from('class_abilities')
    .select('name, type, classes(advanced_abilities)');
  expect(error).toBeNull();

  const mislabeled = (data ?? []).filter((row) => {
    const advanced = Array.isArray(row.classes?.advanced_abilities)
      ? row.classes.advanced_abilities
      : [];
    return advanced.some((a) => a && a.name === row.name) && row.type !== 'advanced';
  });
  expect(mislabeled).toEqual([]);
});

// A CHECK constraint is the backstop for the structural validation in
// services/character/input.js -- the DB must refuse a bad tag even if a
// caller bypasses the service layer.
test('class_abilities rejects a type outside core and advanced', async () => {
  const { data: character } = await sb.from('characters').select('id').limit(1).single();
  // class_abilities.class_id is NOT NULL (baseline_schema.sql:174-186), so the
  // row needs a real class or the insert fails for the wrong reason.
  const { data: cls } = await sb.from('classes').select('id').limit(1).single();

  const { error } = await sb.from('class_abilities').insert({
    character_id: character.id, name: 'Bogus', class_id: cls.id, type: 'legendary'
  });
  expect(error).not.toBeNull();
});
