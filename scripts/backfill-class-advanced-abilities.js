require('../util/env');
const { createClient } = require('@supabase/supabase-js');
const { classAdvancedAbilityList } = require('../util/enclave-consts');

// One-time backfill: classes seeded before the advanced_abilities column
// existed (migration 20260817000000_classes_advanced_abilities) have an
// empty list, which means aspirant/aspiring mode wizards have nothing to
// show in their step 3 primer. Fill each such row from the canonical
// classAdvancedAbilityList map in util/enclave-consts, keyed by class
// name.
//
// Idempotent: rows whose advanced_abilities is already a non-empty array
// are skipped, so this is safe to re-run. Classes with no entry in
// classAdvancedAbilityList (e.g. player-created classes, or any class
// without canonical content yet) are left untouched.
//
// Empty/unmapped canon is the expected state at the time this script is
// first added — it will simply report "no canonical content" for every
// class and exit cleanly.

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

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
  let unmapped = 0;

  for (const cls of classes) {
    if (hasContent(cls.advanced_abilities)) {
      skipped++;
      continue;
    }
    const canon = classAdvancedAbilityList[cls.name];
    if (!hasContent(canon)) {
      unmapped++;
      console.log(`No canonical advanced abilities for "${cls.name}" (${cls.id}); leaving empty.`);
      continue;
    }
    const next = canon.map((name) => ({ name, description: '' }));
    const { error: updateError } = await supabase
      .from('classes')
      .update({ advanced_abilities: next })
      .eq('id', cls.id);
    if (updateError) {
      console.error(`Failed to update "${cls.name}" (${cls.id}):`, updateError.message);
      continue;
    }
    updated++;
    console.log(`Backfilled "${cls.name}":`, JSON.stringify(next.map(a => a.name)));
  }

  console.log(
    `\nDone. ${updated} updated, ${skipped} already populated, ${unmapped} without canonical content.`
  );
  process.exit(0);
})();