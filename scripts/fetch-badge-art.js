// Reconstructs the badge source-art directory (public/img/badges/) by pulling
// each asset from the PUBLIC prod badges storage bucket. The bucket stores
// files flat as "<slug>.png"; this maps them back to the original nested source
// paths that seed-badges.js expects, so the normal seed path works locally
// (and offline afterwards). Public bucket => no credentials required.
//
// Idempotent: skips files already present unless --force is passed.
//
// Usage: bun run scripts/fetch-badge-art.js [--force]
//   Override the source with BADGE_ART_SOURCE_URL (defaults to prod public bucket).
require('../util/env');
const fs = require('fs');
const path = require('path');
const { catalog, EXTRA_UPLOADS, ART_DIR } = require('./seed-badges');

const SOURCE = (
  process.env.BADGE_ART_SOURCE_URL ||
  'https://ndneltuukvijkvdfaqfu.supabase.co/storage/v1/object/public/badges'
).replace(/\/$/, '');

const force = process.argv.includes('--force');

// slug/object-name in the bucket -> original source path under ART_DIR.
const downloads = [
  ...catalog.map((e) => ({ object: `${e.slug}.png`, dest: e.file })),
  ...EXTRA_UPLOADS.map((e) => ({ object: e.storagePath, dest: e.file }))
];

async function fetchOne({ object, dest }) {
  const destPath = path.join(ART_DIR, dest);
  if (!force && fs.existsSync(destPath)) return 'skipped';

  const res = await fetch(`${SOURCE}/${object}`);
  if (!res.ok) {
    throw new Error(`GET ${object} -> ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
  return 'fetched';
}

async function main() {
  console.log(`Fetching ${downloads.length} badge assets from ${SOURCE}`);
  let fetched = 0;
  let skipped = 0;
  for (const d of downloads) {
    const result = await fetchOne(d);
    if (result === 'fetched') {
      fetched++;
      console.log(`  fetched ${d.dest}`);
    } else {
      skipped++;
    }
  }
  console.log(`\nDone: ${fetched} fetched, ${skipped} already present.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
