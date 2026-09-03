const { supabaseAdmin } = require('../../models/_base');
const { trimStrings } = require('../../util/trim-input');

// The only consumer of supabaseAdmin for the profile domain. Holds every
// privileged (service-role) query verbatim; models/profile.js keeps the
// surrounding logic (starter-unlock granting via RPC, input sanitization).
const withResult = async (query) => {
  const { data, error } = await query;
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error: null };
};

// Like withResult, but silent on PGRST116 (row-not-found): fetchOwnProfile hits
// this on every first sign-in (models/profile.js getProfile provisions a new
// profile in that branch), so logging it is expected-noise, not an error.
const withResultQuiet404 = async (query) => {
  const { data, error } = await query;
  if (error) {
    if (error.code !== 'PGRST116') console.error(error);
    return { data: null, error };
  }
  return { data, error: null };
};

module.exports = {
  // Reads
  fetchOwnProfile: (userId) => withResultQuiet404(
    supabaseAdmin.from('profiles').select('*').eq('user_id', userId).single()
  ),
  // Admin variants bypass RLS — only call from routes already gated by requireAdmin.
  fetchProfileByIdAdmin: (id) => withResult(
    supabaseAdmin.from('profiles').select('*').eq('id', id).single()
  ),
  fetchProfileByNameAdmin: (name) => withResult(
    supabaseAdmin.from('profiles').select('*').eq('name', name).single()
  ),
  searchProfilesAdmin: (likePattern, limit = 10) => withResult(
    supabaseAdmin.from('profiles').select('id, name, image_url').ilike('name', likePattern).limit(limit)
  ),

  // Writes
  insertProfile: (row) => withResult(
    supabaseAdmin.from('profiles').insert(trimStrings(row)).select()
  ),
  updateAuthUser: async (userId, attrs) => {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, attrs);
    if (error) console.error(error);
    return { error: error || null };
  },
  updateProfileByUserId: async (userId, fields) => {
    const { data, error } = await supabaseAdmin.from('profiles').update(trimStrings(fields)).eq('user_id', userId);
    if (error) console.error(error);
    return { data, error: error || null };
  },
  updateDiscord: (userId, discordId, discordEmail) => withResult(
    supabaseAdmin.from('profiles').update({ discord_id: discordId, discord_email: discordEmail }).eq('user_id', userId).select()
  ),
  // Stamps the starter-grant guard column; models/profile.js grantStarterUnlocks
  // calls this only after the grant RPC succeeds.
  markStarterGranted: (userId) => withResult(
    supabaseAdmin.from('profiles').update({ starter_granted_at: new Date().toISOString() }).eq('user_id', userId)
  )
};
