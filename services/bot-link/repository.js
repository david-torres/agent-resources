const { supabaseAdmin } = require('../../models/_base');

// The only consumer of supabaseAdmin for the bot-link domain. Holds every
// privileged (service-role) query verbatim; models/bot-link.js keeps the
// surrounding pure logic (code generation/formatting/validation).
const withResult = async (query) => {
  const { data, error } = await query;
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error: null };
};

const PENDING_LINK_SELECT = 'code, discord_user_id, agent_token_id, created_at, expires_at, consumed_at';

module.exports = {
  // System write (no policy) — periodic cleanup of abandoned rows.
  deleteStaleLinks: async (olderThanIso) => {
    const { error } = await supabaseAdmin
      .from('pending_bot_links')
      .delete()
      .lt('created_at', olderThanIso);
    if (error) console.error(error);
    return { error: error || null };
  },

  // Rate-limit gate for starting a new link, keyed by discord_user_id.
  countRecentPending: async (discordUserId, sinceIso) => {
    const { count, error } = await supabaseAdmin
      .from('pending_bot_links')
      .select('code', { count: 'exact', head: true })
      .eq('discord_user_id', discordUserId)
      .gte('created_at', sinceIso)
      .is('consumed_at', null);
    if (error) return { count: 0, error };
    return { count: count || 0, error: null };
  },

  // PUBLIC — the Discord bot starts a link for itself; row is keyed only by
  // a randomly generated code (retried by the caller on unique violations).
  insertPendingLink: (row) => withResult(
    supabaseAdmin
      .from('pending_bot_links')
      .insert(row)
      .select('code, discord_user_id, expires_at')
      .single()
  ),

  fetchPendingByCode: async (code) => {
    const { data, error } = await supabaseAdmin
      .from('pending_bot_links')
      .select(PENDING_LINK_SELECT)
      .eq('code', code)
      .maybeSingle();
    return { data: data || null, error };
  },

  // Authenticated web user attaches the token they just minted. Guards
  // (unconsumed / unexpired / not already attached) are enforced in the
  // query itself so the attach is atomic against a racing second request.
  attachToken: ({ code, agentTokenId }) => withResult(
    supabaseAdmin
      .from('pending_bot_links')
      .update({ agent_token_id: agentTokenId })
      .eq('code', code)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .is('agent_token_id', null)
      .select('code')
      .single()
  ),

  // PUBLIC/possession — the Discord-side claim marks the link consumed. The
  // discord_user_id filter is a defense-in-depth guard: the caller (service)
  // has already verified possession via policy before calling this, but
  // scoping the mutation itself closes the race window between check and use.
  consumePending: ({ code, discordUserId }) => withResult(
    supabaseAdmin
      .from('pending_bot_links')
      .update({ consumed_at: new Date().toISOString() })
      .eq('code', code)
      .eq('discord_user_id', discordUserId)
      .is('consumed_at', null)
      .select('code, agent_token_id')
      .single()
  ),

  // Raw-token stash: the one-time disclosure channel between the web confirm
  // step (which has the raw token) and the Discord-side claim step (which
  // doesn't). Never touched by anything but the service that mediates both.
  stashRawToken: ({ agentTokenId, rawToken }) => withResult(
    supabaseAdmin
      .from('pending_bot_links_raw_tokens')
      .insert({ agent_token_id: agentTokenId, raw_token: rawToken })
  ),

  fetchRawToken: async (agentTokenId) => {
    const { data, error } = await supabaseAdmin
      .from('pending_bot_links_raw_tokens')
      .select('raw_token')
      .eq('agent_token_id', agentTokenId)
      .maybeSingle();
    return { data: data || null, error };
  },

  deleteRawToken: async (agentTokenId) => {
    const { error } = await supabaseAdmin
      .from('pending_bot_links_raw_tokens')
      .delete()
      .eq('agent_token_id', agentTokenId);
    if (error) console.error(error);
    return { error: error || null };
  }
};
