// Inserts an auth user and its public profile on the local stack and returns
// both, so an integration test owns a creator it can clean up.
const { supabaseAdmin } = require('../../models/_base');

async function createAuthUserAndProfile(db, { email, profileName }) {
  const { rows } = await db.query(
    `insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
     values (gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
     returning id`,
    [email]
  );
  const authUserId = rows[0].id;
  const { data: profile } = await supabaseAdmin.from('profiles')
    .insert({ user_id: authUserId, name: profileName, is_public: true, timezone: 'UTC' })
    .select()
    .single();
  return { authUserId, profile };
}

module.exports = { createAuthUserAndProfile };
