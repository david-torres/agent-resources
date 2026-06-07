// Seeds the badge system: uploads badge art from public/img/badges/ to the
// public 'badges' storage bucket and upserts catalog rows keyed on slug.
// Idempotent — safe to re-run (uploads use upsert, catalog upserts on slug).
//
// Usage: bun run scripts/seed-badges.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = process.env.SUPABASE_BADGES_BUCKET || 'badges';
const ART_DIR = path.join(__dirname, '..', 'public', 'img', 'badges');

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const PLAYER_THRESHOLDS = [23, 25, 28, 32, 37, 43, 50, 58, 67, 77, 88, 100];
const CONDUIT_THRESHOLDS = [5, 7, 10, 14, 19, 25, 32, 40, 49, 59, 70, 82];

const catalog = [];

// Newcomer 1..12 + Final (13). Counter: distinct missions appeared on,
// playing or conduiting.
for (let i = 1; i <= 12; i++) {
  catalog.push({
    slug: `newcomer-${i}`,
    name: `Newcomer ${ROMAN[i - 1]}`,
    description: `Appeared (playing or conduiting) on ${i} officially logged mission${i === 1 ? '' : 's'}.`,
    category: 'milestone',
    track: 'newcomer',
    rank: i,
    threshold: i,
    file: path.join('AR Newcomer Badges', `AR Badge Newcomer ${i}.png`)
  });
}
catalog.push({
  slug: 'newcomer-final',
  name: 'Newcomer Final',
  description: 'Appeared (playing or conduiting) on 13 officially logged missions. Newcomer track complete.',
  category: 'milestone',
  track: 'newcomer',
  rank: 13,
  threshold: 13,
  file: path.join('AR Newcomer Badges', 'AR Badge Newcomer Final.png')
});

for (let i = 1; i <= 12; i++) {
  catalog.push({
    slug: `veteran-player-${i}`,
    name: `Veteran Player ${ROMAN[i - 1]}`,
    description: `Appeared on ${PLAYER_THRESHOLDS[i - 1]} missions as a player.`,
    category: 'milestone',
    track: 'veteran_player',
    rank: i,
    threshold: PLAYER_THRESHOLDS[i - 1],
    file: path.join('AR Veteran Badges', `AR Badge Veteran Player ${i}.png`)
  });
  catalog.push({
    slug: `veteran-conduit-${i}`,
    name: `Veteran Conduit ${ROMAN[i - 1]}`,
    description: `Hosted ${CONDUIT_THRESHOLDS[i - 1]} missions as conduit.`,
    category: 'milestone',
    track: 'veteran_conduit',
    rank: i,
    threshold: CONDUIT_THRESHOLDS[i - 1],
    file: path.join('More AR Badges', `AR Badge Veteran Conduit ${i}.png`)
  });
}

// Enclave Day 1-14 live in their own folder; 15 shipped later in More AR Badges.
for (let i = 1; i <= 15; i++) {
  catalog.push({
    slug: `enclave-day-${i}`,
    name: `Enclave Day ${i}`,
    description: `Participated in Enclave Day ${i}.`,
    category: 'event',
    track: null,
    rank: null,
    threshold: null,
    file: i <= 14
      ? path.join('Enclave Day Badges', `Enclave Day Badge ${i}.png`)
      : path.join('More AR Badges', `Enclave Day Badge ${i}.png`)
  });
}

catalog.push({
  slug: 'big-12-1',
  name: 'Big 12',
  description: 'Participated in the Big 12.',
  category: 'event',
  track: null,
  rank: null,
  threshold: null,
  file: path.join('More AR Badges', 'Big 12 Badge 1.png')
});

for (const person of ['Dippy', 'Julian', 'Meeks', 'Robby', 'Tomas']) {
  catalog.push({
    slug: `personal-${person.toLowerCase()}`,
    name: person,
    description: `Personal badge for ${person}.`,
    category: 'personal',
    track: null,
    rank: null,
    threshold: null,
    file: path.join('More AR Badges', `AR Badge for ${person}.png`)
  });
}

// Not earnable: locked/placeholder art for unstarted veteran tracks. Uploaded
// to the bucket (the UI references it) but gets no catalog row.
const EXTRA_UPLOADS = [
  { storagePath: 'veteran-base.png', file: path.join('AR Veteran Badges', 'AR Badge Veteran Base.png') }
];

async function ensureBucket() {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message || '')) {
    throw new Error(`Failed to create bucket '${BUCKET}': ${error.message}`);
  }
}

async function uploadOne(storagePath, fileRelPath) {
  const buffer = fs.readFileSync(path.join(ART_DIR, fileRelPath));
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: 'image/png',
    cacheControl: '86400',
    upsert: true
  });
  if (error) throw new Error(`Upload failed for ${storagePath}: ${error.message}`);
}

async function main() {
  // Fail fast if any art file is missing before touching the network.
  const missing = [...catalog, ...EXTRA_UPLOADS].filter(
    e => !fs.existsSync(path.join(ART_DIR, e.file))
  );
  if (missing.length) {
    throw new Error(`Missing art files:\n${missing.map(e => `  ${e.file}`).join('\n')}`);
  }

  await ensureBucket();

  for (const entry of catalog) {
    const storagePath = `${entry.slug}.png`;
    await uploadOne(storagePath, entry.file);
    const { error } = await supabase.from('badges').upsert({
      slug: entry.slug,
      name: entry.name,
      description: entry.description,
      category: entry.category,
      track: entry.track,
      rank: entry.rank,
      threshold: entry.threshold,
      image_path: storagePath,
      is_active: true
    }, { onConflict: 'slug' });
    if (error) throw new Error(`Catalog upsert failed for ${entry.slug}: ${error.message}`);
    console.log(`seeded ${entry.slug}`);
  }

  for (const extra of EXTRA_UPLOADS) {
    await uploadOne(extra.storagePath, extra.file);
    console.log(`uploaded ${extra.storagePath}`);
  }

  console.log(`\nDone: ${catalog.length} catalog rows, ${EXTRA_UPLOADS.length} extra assets.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
