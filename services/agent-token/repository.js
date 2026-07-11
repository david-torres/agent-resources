const { supabaseAdmin } = require('../../models/_base');

// The only consumer of supabaseAdmin for the agent-token domain. Holds every
// privileged (service-role) query verbatim; models/agent-token.js keeps the
// surrounding logic (token generation/hashing).
const withResult = async (query) => {
  const { data, error } = await query;
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error: null };
};

const TOKEN_ROW_SELECT = 'id, name, token_hint, created_at, last_used_at, revoked_at';

module.exports = {
  insertToken: (row) => withResult(
    supabaseAdmin.from('agent_api_tokens').insert(row).select(TOKEN_ROW_SELECT).single()
  ),

  listTokens: ({ userId, profileId, includeRevoked = false }) => {
    let query = supabaseAdmin
      .from('agent_api_tokens')
      .select(TOKEN_ROW_SELECT)
      .eq('user_id', userId)
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false });

    if (!includeRevoked) {
      query = query.is('revoked_at', null);
    }

    return withResult(query);
  },

  // Keeps the same self-scoping as the original model: a token can only be
  // revoked by the user_id/profile_id that owns it, and only while active.
  revokeToken: ({ tokenId, userId, profileId }) => withResult(
    supabaseAdmin
      .from('agent_api_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', tokenId)
      .eq('user_id', userId)
      .eq('profile_id', profileId)
      .is('revoked_at', null)
      .select(TOKEN_ROW_SELECT)
      .single()
  ),

  // Authentication primitive lookup — always called with a hash (never a
  // raw token). Returns the profile join needed to build the agent actor.
  findTokenByHash: (tokenHash) => withResult(
    supabaseAdmin
      .from('agent_api_tokens')
      .select('id, user_id, profile_id, name, token_hint, revoked_at, profile:profile_id(id, user_id, name, role, timezone)')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .single()
  ),

  // System write (no policy) — bumps the token's last-used timestamp on a
  // successful authentication.
  touchLastUsed: async (tokenId) => {
    const { error } = await supabaseAdmin
      .from('agent_api_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', tokenId);
    if (error) console.error(error);
    return { error: error || null };
  },

  // Task-8's bot-link claim route resolves a token's owning profile through
  // this lookup; nothing in this task calls it yet.
  fetchTokenWithProfile: (tokenId) => withResult(
    supabaseAdmin
      .from('agent_api_tokens')
      .select('id, profile:profile_id(id, name)')
      .eq('id', tokenId)
      .single()
  )
};
