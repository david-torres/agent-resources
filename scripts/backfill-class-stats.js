require('../util/env');
const { createClient } = require('@supabase/supabase-js');
const { classStatSpread } = require('../util/enclave-consts');

// One-time backfill: classes seeded before the stat_spread column existed
// (migration 20260609_classes_stat_spread) have an empty stat_spread, which
// breaks the character creator wizard's step 2. Fill each such row from the
// canonical classStatSpread map in util/enclave-consts, keyed by class name.
//
// Idempotent: rows that already carry a non-empty stat_spread are skipped, so
// this is safe to re-run. Classes with no entry in classStatSpread (e.g.
// player-created classes) are left untouched.

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const isEmptySpread = (spread) =>
  !spread || typeof spread !== 'object' || Object.keys(spread).length === 0;

(async () => {
  const { data: classes, error } = await supabase
    .from('classes')
    .select('id, name, stat_spread');
  if (error) {
    console.error('Failed to fetch classes:', error.message);
    process.exit(1);
  }

  let updated = 0;
  let skipped = 0;
  let unmapped = 0;

  for (const cls of classes) {
    if (!isEmptySpread(cls.stat_spread)) {
      skipped++;
      continue;
    }
    const spread = classStatSpread[cls.name];
    if (!spread) {
      unmapped++;
      console.log(`No canonical spread for "${cls.name}" (${cls.id}); leaving empty.`);
      continue;
    }
    const { error: updateError } = await supabase
      .from('classes')
      .update({ stat_spread: spread })
      .eq('id', cls.id);
    if (updateError) {
      console.error(`Failed to update "${cls.name}" (${cls.id}):`, updateError.message);
      continue;
    }
    updated++;
    console.log(`Backfilled "${cls.name}":`, JSON.stringify(spread));
  }

  console.log(
    `\nDone. ${updated} updated, ${skipped} already populated, ${unmapped} without a canonical spread.`
  );
  process.exit(0);
})();
