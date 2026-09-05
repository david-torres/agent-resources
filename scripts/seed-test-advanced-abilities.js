require('../util/env');
const { createClient } = require('@supabase/supabase-js');

// Dev/test-only seeder: fills `classes.advanced_abilities` with three
// procedurally-generated placeholder entries per class so aspirant/aspiring
// mode wizards have something to render. **Intentionally separate from the
// canonical `classAdvancedAbilityList` backfill** (scripts/backfill-class-
// advanced-abilities.js) — real advanced abilities belong in
// util/enclave-consts.js, not here.
//
// Safety rules:
//   - Only fills rows whose `advanced_abilities` is currently empty. Any row
//     that already has content (real or test) is skipped, so this never
//     overwrites existing data.
//   - Every generated name is prefixed with "Test:" so it's obvious in the
//     DB and in the wizard UI that the entry is placeholder content.
//   - Live re-runs are idempotent.
//
// Usage: bun scripts/seed-test-advanced-abilities.js

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Tiny seeded RNG so the same class always produces the same three abilities
// across runs. Determinism matters: if you delete the seeded row and re-run,
// you get the same names back, which makes "did this change?" easy to eyeball.
const hash = (str) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return h >>> 0;
};
const pick = (arr, seed) => arr[seed % arr.length];

const VERBS = ['Echoing', 'Veiled', 'Binding', 'Furious', 'Warding', 'Surging', 'Honed', 'Resonant'];
const NOUNS = ['Step', 'Bond', 'Mark', 'Pact', 'Grip', 'Wake', 'Veil', 'Pulse'];
const FORMS = ['Strike', 'Ward', 'Burst', 'Echo', 'Shield', 'Maneuver'];

const generateTestAdvancedAbilities = (className) => [0, 1, 2].map((i) => {
  const s = hash(className) + i * 1013;
  const name = `Test: ${pick(VERBS, s + 1)} ${pick(NOUNS, s + 3)}`;
  const description =
    `[TEST DATA — replace with real advanced ability for ${className}] ` +
    `Mechanical placeholder: a ${pick(FORMS, s + 5)} effect that scales with level.`;
  return { name, description };
});

const hasContent = (list) => Array.isArray(list) && list.length > 0;

(async () => {
  const { data: classes, error } = await supabase
    .from('classes')
    .select('id, name, advanced_abilities');
  if (error) {
    console.error('Failed to fetch classes:', error.message);
    process.exit(1);
  }

  let updated = 0;
  let skipped = 0;

  for (const cls of classes) {
    if (hasContent(cls.advanced_abilities)) {
      skipped++;
      continue;
    }
    const next = generateTestAdvancedAbilities(cls.name);
    const { error: updateError } = await supabase
      .from('classes')
      .update({ advanced_abilities: next })
      .eq('id', cls.id);
    if (updateError) {
      console.error(`Failed to update "${cls.name}" (${cls.id}):`, updateError.message);
      continue;
    }
    updated++;
    console.log(`Seeded test advanced abilities for "${cls.name}":`,
      JSON.stringify(next.map(a => a.name)));
  }

  console.log(
    `\nDone. ${updated} updated, ${skipped} already populated (skipped to avoid overwriting).`
  );
  process.exit(0);
})();