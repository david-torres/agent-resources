const crypto = require('crypto');
const { supabaseAdmin } = require('./_base');

const LINK_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const LINK_CODE_LENGTH = 8;
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const LINK_CODE_MAX_PENDING_PER_DISCORD_ID = 3;
const LINK_CODE_RATE_WINDOW_MS = 10 * 60 * 1000;
const LINK_ROW_CLEANUP_AGE_MS = 60 * 60 * 1000;

const generateLinkCode = () => {
  const bytes = crypto.randomBytes(LINK_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < LINK_CODE_LENGTH; i++) {
    out += LINK_CODE_ALPHABET[bytes[i] % LINK_CODE_ALPHABET.length];
  }
  return out;
};

const formatLinkCode = (code) => {
  if (typeof code !== 'string' || !/^[A-Z0-9]{8}$/.test(code)) {
    throw new Error('Invalid link code');
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
};

const normalizeLinkCode = (value) => {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(cleaned)) return null;
  return cleaned;
};

const isValidDiscordUserId = (value) =>
  typeof value === 'string' && /^[0-9]{1,32}$/.test(value);

const nowIso = () => new Date().toISOString();
const plusMsIso = (ms) => new Date(Date.now() + ms).toISOString();
const minusMsIso = (ms) => new Date(Date.now() - ms).toISOString();

const cleanupStaleLinks = async () => {
  await supabaseAdmin
    .from('pending_bot_links')
    .delete()
    .lt('created_at', minusMsIso(LINK_ROW_CLEANUP_AGE_MS));
};

const countRecentPendingForDiscordId = async (discordUserId) => {
  const since = minusMsIso(LINK_CODE_RATE_WINDOW_MS);
  const { count, error } = await supabaseAdmin
    .from('pending_bot_links')
    .select('code', { count: 'exact', head: true })
    .eq('discord_user_id', discordUserId)
    .gte('created_at', since)
    .is('consumed_at', null);
  if (error) return { count: 0, error };
  return { count: count || 0, error: null };
};

const createPendingLink = async (discordUserId) => {
  if (!isValidDiscordUserId(discordUserId)) {
    return { data: null, error: new Error('Invalid discord_user_id') };
  }

  await cleanupStaleLinks();

  const { count, error: countError } = await countRecentPendingForDiscordId(discordUserId);
  if (countError) return { data: null, error: countError };
  if (count >= LINK_CODE_MAX_PENDING_PER_DISCORD_ID) {
    return { data: null, error: new Error('Too many pending codes') };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateLinkCode();
    const expiresAt = plusMsIso(LINK_CODE_TTL_MS);
    const { data, error } = await supabaseAdmin
      .from('pending_bot_links')
      .insert({
        code,
        discord_user_id: discordUserId,
        expires_at: expiresAt
      })
      .select('code, discord_user_id, expires_at')
      .single();
    if (!error) return { data, error: null };
    if (error.code !== '23505') return { data: null, error };
  }
  return { data: null, error: new Error('Could not allocate unique link code') };
};

const getPendingLinkByCode = async (code) => {
  const { data, error } = await supabaseAdmin
    .from('pending_bot_links')
    .select('code, discord_user_id, agent_token_id, created_at, expires_at, consumed_at')
    .eq('code', code)
    .maybeSingle();
  return { data: data || null, error };
};

const attachTokenToPendingLink = async ({ code, agentTokenId }) => {
  const { data, error } = await supabaseAdmin
    .from('pending_bot_links')
    .update({ agent_token_id: agentTokenId })
    .eq('code', code)
    .is('consumed_at', null)
    .gt('expires_at', nowIso())
    .is('agent_token_id', null)
    .select('code')
    .single();
  return { data, error };
};

const consumePendingLink = async ({ code, discordUserId }) => {
  const { data: row, error } = await getPendingLinkByCode(code);
  if (error && error.code !== 'PGRST116') return { data: null, error };
  if (!row) return { data: null, error: 'not_found' };
  if (row.consumed_at) return { data: null, error: 'expired' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { data: null, error: 'expired' };
  }
  if (row.discord_user_id !== discordUserId) return { data: null, error: 'mismatch' };
  if (!row.agent_token_id) return { data: null, error: 'pending' };

  const { data: consumed, error: consumeError } = await supabaseAdmin
    .from('pending_bot_links')
    .update({ consumed_at: nowIso() })
    .eq('code', code)
    .is('consumed_at', null)
    .select('code, agent_token_id')
    .single();
  if (consumeError || !consumed) return { data: null, error: 'expired' };
  return { data: { agentTokenId: consumed.agent_token_id }, error: null };
};

module.exports = {
  LINK_CODE_TTL_MS,
  LINK_CODE_MAX_PENDING_PER_DISCORD_ID,
  LINK_CODE_RATE_WINDOW_MS,
  LINK_ROW_CLEANUP_AGE_MS,
  generateLinkCode,
  formatLinkCode,
  normalizeLinkCode,
  isValidDiscordUserId,
  cleanupStaleLinks,
  createPendingLink,
  getPendingLinkByCode,
  attachTokenToPendingLink,
  consumePendingLink
};
