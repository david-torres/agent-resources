require('../../util/env');
const { Client } = require('pg');

const connectionString = process.env.SUPABASE_DB_URL
  || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const connect = async () => {
  const db = new Client({ connectionString });
  await db.connect();
  return db;
};

// Every fixture row's name starts with this, so cleanup is a single LIKE and
// two concurrent runs can never collide.
const newPrefix = (spec) =>
  `e2e-${spec}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const profileForEmail = async (db, email) => {
  const { rows } = await db.query(
    `select p.* from profiles p join auth.users u on u.id = p.user_id where u.email = $1`,
    [email]
  );
  if (!rows[0]) {
    throw new Error(`No profile for ${email}. Run \`bun run seed:local\` and re-run the suite.`);
  }
  return rows[0];
};

// Children are deleted explicitly rather than relying on ON DELETE CASCADE,
// so this is correct whether or not the FKs cascade.
const cleanupByPrefix = async (db, prefix) => {
  const like = `${prefix}%`;

  const { rows: characters } = await db.query(
    'select id from characters where name like $1', [like]
  );
  const characterIds = characters.map((r) => r.id);
  if (characterIds.length) {
    // `lfg_join_requests` is in this list for a reason the others are not:
    // lfg_join_requests_character_id_fkey has NO referential action at all
    // (baseline schema; verified with \d lfg_join_requests), so a
    // character-bound join request is a hard FK block on the character delete
    // below -- and NOT reachable from the lfg_posts pass further down, which
    // only ever deletes requests whose POST carries the prefix. A spec that
    // joins a prefixed character to a NON-prefixed post (a developer's own, or
    // another worker's) would otherwise leave the character undeletable and
    // fail cleanup with a foreign-key violation. Deleting by character_id here
    // is scoped to prefixed characters only, so nothing else is in range.
    for (const table of ['character_perks', 'class_abilities', 'class_gear', 'traits', 'offscreen_missions', 'lfg_join_requests']) {
      await db.query(`delete from ${table} where character_id = any($1::uuid[])`, [characterIds]);
    }
    await db.query('delete from characters where id = any($1::uuid[])', [characterIds]);
  }

  // After characters: offscreen_missions reference source_mission_id, and they
  // were deleted above with their character.
  const { rows: missions } = await db.query('select id from missions where name like $1', [like]);
  const missionIds = missions.map((r) => r.id);
  if (missionIds.length) {
    await db.query('delete from mission_characters where mission_id = any($1::uuid[])', [missionIds]);
    await db.query('delete from missions where id = any($1::uuid[])', [missionIds]);
  }

  const { rows: classes } = await db.query('select id from classes where name like $1', [like]);
  const classIds = classes.map((r) => r.id);
  if (classIds.length) {
    await db.query('delete from class_unlock_codes where class_id = any($1::uuid[])', [classIds]);
    // class_unlocks.class_id has no ON DELETE action, so a fixture-granted
    // unlock (see fixtures/class.js#unlockClassForProfile) would otherwise
    // block the class delete below with a foreign-key violation.
    await db.query('delete from class_unlocks where class_id = any($1::uuid[])', [classIds]);
    // Deleted by class_id (not just the character_id pass above): a
    // character belonging to a DIFFERENT (possibly non-prefixed) run can end
    // up with a class_abilities row pointing at one of our classes -- e.g.
    // the silent class-reassignment defect this suite regression-tests in
    // 03b-class-reassignment.spec.js. Without this, that stray row blocks
    // the class delete below with the same foreign-key violation.
    await db.query('delete from class_abilities where class_id = any($1::uuid[])', [classIds]);
    await db.query('delete from classes where id = any($1::uuid[])', [classIds]);
  }

  const { rows: posts } = await db.query('select id from lfg_posts where title like $1', [like]);
  const postIds = posts.map((r) => r.id);
  if (postIds.length) {
    await db.query('delete from lfg_join_requests where lfg_post_id = any($1::uuid[])', [postIds]);
    await db.query('delete from lfg_posts where id = any($1::uuid[])', [postIds]);
  }

  await db.query('delete from pages where title like $1', [like]);
};

module.exports = { connect, newPrefix, profileForEmail, cleanupByPrefix };
