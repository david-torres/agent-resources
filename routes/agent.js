const express = require('express');
const router = express.Router();
const { registerUuidParams } = require('../util/validate');
registerUuidParams(router, ['id']);
const { isAgentAuthenticated } = require('../util/auth');
const { listClassesForAgent, getClassForAgent } = require('../models/class');
const {
  searchCharactersForAgent,
  getCharacterForAgent
} = require('../models/character');
const {
  normalizeLinkCode,
  isValidDiscordUserId,
  formatLinkCode,
  createPendingLink,
  consumePendingLink,
  cleanupStaleLinks
} = require('../models/bot-link');
const { supabaseAdmin } = require('../models/_base');
const { revokeAgentToken } = require('../models/agent-token');

const parseBooleanFilter = (value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

const getActorContext = (res) => ({
  userId: res.locals.user?.id || null,
  profileId: res.locals.profile?.id || null,
  role: res.locals.profile?.role || null
});

router.post('/bot-link/start', express.json(), async (req, res) => {
  const discordUserId = req.body?.discord_user_id;
  if (!isValidDiscordUserId(discordUserId)) {
    return res.status(400).json({ error: 'Invalid discord_user_id' });
  }
  const { data, error } = await createPendingLink(discordUserId);
  if (error) {
    if (error.message === 'Too many pending codes') {
      return res.status(429).json({ error: error.message });
    }
    return res.status(500).json({ error: error.message });
  }
  return res.json({
    code: data.code,
    formatted_code: formatLinkCode(data.code),
    expires_at: data.expires_at
  });
});

router.post('/bot-link/claim', express.json(), async (req, res) => {
  await cleanupStaleLinks();
  const normalized = normalizeLinkCode(req.body?.code);
  const discordUserId = req.body?.discord_user_id;
  if (!normalized || !isValidDiscordUserId(discordUserId)) {
    return res.status(400).json({ error: 'Invalid code or discord_user_id' });
  }

  const { data, error } = await consumePendingLink({
    code: normalized,
    discordUserId
  });
  if (error === 'not_found') return res.status(404).json({ error: 'Not found' });
  if (error === 'expired') return res.status(410).json({ error: 'Expired' });
  if (error === 'mismatch') return res.status(409).json({ error: 'Discord user mismatch' });
  if (error === 'pending') return res.status(202).json({ status: 'pending' });
  if (error) return res.status(500).json({ error: error.message || 'Internal error' });

  const { data: tokenRow, error: tokenError } = await supabaseAdmin
    .from('agent_api_tokens')
    .select('id, profile:profile_id(id, name)')
    .eq('id', data.agentTokenId)
    .single();
  if (tokenError || !tokenRow) {
    return res.status(500).json({ error: 'Token lookup failed' });
  }

  const { data: rawTokenRow, error: rawError } = await supabaseAdmin
    .from('pending_bot_links_raw_tokens')
    .select('raw_token')
    .eq('agent_token_id', data.agentTokenId)
    .maybeSingle();
  if (rawError || !rawTokenRow) {
    return res.status(500).json({ error: 'Token stash missing' });
  }

  await supabaseAdmin
    .from('pending_bot_links_raw_tokens')
    .delete()
    .eq('agent_token_id', data.agentTokenId);

  return res.json({
    token: rawTokenRow.raw_token,
    agent_token_id: data.agentTokenId,
    profile: {
      id: tokenRow.profile?.id || null,
      name: tokenRow.profile?.name || null
    }
  });
});

router.use(isAgentAuthenticated);

router.get('/me', async (req, res) => {
  return res.json({
    user: { id: res.locals.user.id },
    profile: {
      id: res.locals.profile.id,
      user_id: res.locals.profile.user_id,
      name: res.locals.profile.name,
      role: res.locals.profile.role
    },
    token: res.locals.agentToken
  });
});

router.get('/classes', async (req, res) => {
  const filters = {
    rules_edition: req.query.rules_edition,
    rules_version: req.query.rules_version,
    status: req.query.status,
    is_player_created: parseBooleanFilter(req.query.is_player_created)
  };
  const { data, error } = await listClassesForAgent(filters, getActorContext(res));
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ classes: data });
});

router.get('/classes/:id', async (req, res) => {
  const { data, error } = await getClassForAgent(req.params.id, getActorContext(res));
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Class not found' });
  return res.json({ class: data });
});

router.get('/characters', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const { data, error } = await searchCharactersForAgent(q, getActorContext(res));
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ characters: data });
});

router.get('/characters/:id', async (req, res) => {
  const { data, error } = await getCharacterForAgent(req.params.id, getActorContext(res));
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Character not found' });
  return res.json({ character: data });
});

router.delete('/tokens/me', async (req, res) => {
  const { data, error } = await revokeAgentToken({
    tokenId: res.locals.agentToken.id,
    userId: res.locals.user.id,
    profileId: res.locals.profile.id
  });
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Token not found or already revoked' });
  return res.json({ revoked: true });
});

module.exports = router;
