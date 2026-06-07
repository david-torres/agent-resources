// Retroactively awards milestone badges to every profile by running the same
// recalculateMilestoneBadges used by the live mission hooks. Idempotent —
// safe to re-run any time. Per-profile failures are collected and reported
// at the end instead of aborting the run.
//
// Usage: bun run scripts/backfill-badges.js
require('dotenv').config();
const { supabaseAdmin } = require('../models/_base');
const { recalculateMilestoneBadges } = require('../models/badge');

async function main() {
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id, name')
    .order('name', { ascending: true });
  if (error) throw new Error(`Failed to list profiles: ${error.message}`);

  const failures = [];
  let ensured = 0;

  for (const profile of profiles) {
    const { data, error: recalcError } = await recalculateMilestoneBadges(profile.id);
    if (recalcError) {
      failures.push({ profile: profile.name, error: recalcError.message || String(recalcError) });
      continue;
    }
    ensured += data.awarded;
    console.log(
      `${profile.name}: ${data.awarded} milestone badges ` +
      `(newcomer=${data.counters.newcomer} player=${data.counters.player} conduit=${data.counters.conduit})`
    );
  }

  console.log(`\nProcessed ${profiles.length} profiles; ${ensured} award rows ensured.`);
  if (failures.length) {
    console.error(`\n${failures.length} failures:`);
    for (const f of failures) console.error(`  ${f.profile}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
