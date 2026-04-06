const crypto = require('crypto');
const { supabaseAdmin } = require('./_base');

const AGENT_TOKEN_PREFIX = 'ar_pat_';
const AGENT_TOKEN_BYTES = 24;

const hashAgentToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const generateAgentToken = () => {
  const secret = crypto.randomBytes(AGENT_TOKEN_BYTES).toString('base64url');
  const token = `${AGENT_TOKEN_PREFIX}${secret}`;
  return {
    token,
    tokenHint: secret.slice(-4)
  };
};

const createAgentToken = async ({ userId, profileId, name }) => {
  const trimmedName = (name || '').trim();
  if (!userId || !profileId) {
    return { data: null, error: new Error('Missing user context') };
  }
  if (!trimmedName) {
    return { data: null, error: new Error('Token name is required') };
  }

  const { token, tokenHint } = generateAgentToken();
  const tokenHash = hashAgentToken(token);

  const { data, error } = await supabaseAdmin
    .from('agent_api_tokens')
    .insert({
      user_id: userId,
      profile_id: profileId,
      name: trimmedName,
      token_hash: tokenHash,
      token_hint: tokenHint
    })
    .select('id, name, token_hint, created_at, last_used_at, revoked_at')
    .single();

  if (error) {
    console.error(error);
    return { data: null, error };
  }

  return {
    data: {
      ...data,
      token
    },
    error: null
  };
};

const listAgentTokens = async ({ userId, profileId, includeRevoked = false }) => {
  if (!userId || !profileId) {
    return { data: null, error: new Error('Missing user context') };
  }

  let query = supabaseAdmin
    .from('agent_api_tokens')
    .select('id, name, token_hint, created_at, last_used_at, revoked_at')
    .eq('user_id', userId)
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });

  if (!includeRevoked) {
    query = query.is('revoked_at', null);
  }

  const { data, error } = await query;
  if (error) {
    console.error(error);
    return { data: null, error };
  }

  return { data, error: null };
};

const revokeAgentToken = async ({ tokenId, userId, profileId }) => {
  if (!tokenId || !userId || !profileId) {
    return { data: null, error: new Error('Missing revoke context') };
  }

  const { data, error } = await supabaseAdmin
    .from('agent_api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    .eq('user_id', userId)
    .eq('profile_id', profileId)
    .is('revoked_at', null)
    .select('id, name, token_hint, created_at, last_used_at, revoked_at')
    .single();

  if (error) {
    console.error(error);
    return { data: null, error };
  }

  return { data, error: null };
};

const verifyAgentToken = async (token) => {
  if (!token || !token.startsWith(AGENT_TOKEN_PREFIX)) {
    return { data: null, error: new Error('Invalid token format') };
  }

  const tokenHash = hashAgentToken(token);
  const { data, error } = await supabaseAdmin
    .from('agent_api_tokens')
    .select('id, user_id, profile_id, name, token_hint, revoked_at, profile:profile_id(id, user_id, name, role)')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .single();

  if (error) {
    return { data: null, error };
  }

  const now = new Date().toISOString();
  await supabaseAdmin
    .from('agent_api_tokens')
    .update({ last_used_at: now })
    .eq('id', data.id);

  return {
    data: {
      tokenId: data.id,
      tokenName: data.name,
      tokenHint: data.token_hint,
      userId: data.user_id,
      profile: data.profile
    },
    error: null
  };
};

module.exports = {
  AGENT_TOKEN_PREFIX,
  createAgentToken,
  listAgentTokens,
  revokeAgentToken,
  verifyAgentToken
};
