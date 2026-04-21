const express = require('express');
const router = express.Router();
const { registerUuidParams } = require('../util/validate');
registerUuidParams(router, ['id', 'requestId']);
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
const {
  listPostsForAgent,
  getPostForAgent,
  createForAgent,
  updateForAgent,
  closeForAgent,
  deleteForAgent,
  joinForAgent,
  leaveForAgent,
  updateRequestForAgent,
  listEligibleCharactersForAgent
} = require('../models/lfg');
const { createRateLimiter } = require('../util/rate-limit');
const lfgLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });

const sendLfgError = (res, err) => {
  const status = (err && err.status) || 500;
  const message = (err && (err.message || (typeof err === 'string' ? err : null))) || 'Unexpected error';
  const code = (err && err.code) || undefined;
  const payload = { error: message };
  if (code) payload.code = code;
  return res.status(status).json(payload);
};

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
      role: res.locals.profile.role,
      timezone: res.locals.profile.timezone || 'UTC'
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

const validatePostBody = (body, { isEdit = false } = {}) => {
  if (!body || typeof body !== 'object') {
    return { error: { status: 400, code: 'invalid_body', message: 'Body is required' } };
  }
  const out = {};
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.length < 1 || body.title.length > 100) {
      return { error: { status: 400, code: 'invalid_title', message: 'Title must be 1–100 characters' } };
    }
    out.title = body.title;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string' || body.description.length > 4000) {
      return { error: { status: 400, code: 'invalid_description', message: 'Description must be 0–4000 characters' } };
    }
    out.description = body.description;
  }
  if (body.date !== undefined) {
    const d = new Date(body.date);
    if (Number.isNaN(d.getTime())) {
      return { error: { status: 400, code: 'invalid_date', message: 'Date must be a valid ISO timestamp' } };
    }
    if (!isEdit && d.getTime() < Date.now()) {
      return { error: { status: 400, code: 'date_in_past', message: 'Date must be in the future' } };
    }
    out.date = d.toISOString();
  }
  if (body.max_characters !== undefined) {
    const n = Number(body.max_characters);
    if (!Number.isInteger(n) || n < 1 || n > 8) {
      return { error: { status: 400, code: 'invalid_max', message: 'max_characters must be 1–8' } };
    }
    out.max_characters = n;
  }
  if (body.is_public !== undefined) {
    if (typeof body.is_public !== 'boolean') {
      return { error: { status: 400, code: 'invalid_is_public', message: 'is_public must be boolean' } };
    }
    out.is_public = body.is_public;
  }
  if (!isEdit) {
    for (const req of ['title', 'description', 'date', 'max_characters']) {
      if (out[req] === undefined) {
        return { error: { status: 400, code: 'missing_field', message: `${req} is required` } };
      }
    }
  }
  if (isEdit && Object.keys(out).length === 0) {
    return { error: { status: 400, code: 'no_fields', message: 'At least one field is required' } };
  }
  return { body: out };
};

router.get('/lfg/posts', lfgLimiter.middleware, async (req, res) => {
  const scope = ['public', 'mine', 'joined'].includes(req.query.scope) ? req.query.scope : 'public';
  const status = ['open', 'closed', 'all'].includes(req.query.status) ? req.query.status : 'open';
  const { data, error } = await listPostsForAgent({
    agentProfileId: res.locals.profile.id,
    scope,
    status
  });
  if (error) return sendLfgError(res, error);
  return res.json({ posts: data });
});

router.get('/lfg/posts/:id', lfgLimiter.middleware, async (req, res) => {
  const { data, error } = await getPostForAgent({
    agentProfileId: res.locals.profile.id,
    postId: req.params.id
  });
  if (error) return sendLfgError(res, error);
  return res.json({ post: data });
});

router.post('/lfg/posts', lfgLimiter.middleware, async (req, res) => {
  const { body, error: validationError } = validatePostBody(req.body);
  if (validationError) return sendLfgError(res, validationError);
  const { data, error } = await createForAgent({
    agentProfile: res.locals.profile,
    body
  });
  if (error) return sendLfgError(res, error);
  return res.json({ post: data });
});

router.patch('/lfg/posts/:id', lfgLimiter.middleware, async (req, res) => {
  const { body, error: validationError } = validatePostBody(req.body, { isEdit: true });
  if (validationError) return sendLfgError(res, validationError);
  const { data, error } = await updateForAgent({
    agentProfile: res.locals.profile,
    postId: req.params.id,
    body
  });
  if (error) return sendLfgError(res, error);
  return res.json({ post: data });
});

router.post('/lfg/posts/:id/close', lfgLimiter.middleware, async (req, res) => {
  const { data, error } = await closeForAgent({
    agentProfileId: res.locals.profile.id,
    postId: req.params.id
  });
  if (error) return sendLfgError(res, error);
  return res.json({ post: data });
});

router.delete('/lfg/posts/:id', lfgLimiter.middleware, async (req, res) => {
  const { data, error } = await deleteForAgent({
    agentProfile: res.locals.profile,
    postId: req.params.id
  });
  if (error) return sendLfgError(res, error);
  return res.json(data);
});

router.post('/lfg/posts/:id/join', lfgLimiter.middleware, async (req, res) => {
  const { join_type, character_id } = req.body || {};
  if (join_type !== 'player' && join_type !== 'conduit') {
    return sendLfgError(res, { status: 400, code: 'invalid_join_type', message: 'join_type must be player or conduit' });
  }
  const { data, error } = await joinForAgent({
    agentProfileId: res.locals.profile.id,
    postId: req.params.id,
    joinType: join_type,
    characterId: character_id || null
  });
  if (error) return sendLfgError(res, error);
  return res.json(data);
});

router.delete('/lfg/posts/:id/join', lfgLimiter.middleware, async (req, res) => {
  const { data, error } = await leaveForAgent({
    agentProfileId: res.locals.profile.id,
    postId: req.params.id
  });
  if (error) return sendLfgError(res, error);
  return res.json(data);
});

router.patch('/lfg/requests/:requestId', lfgLimiter.middleware, async (req, res) => {
  const { status } = req.body || {};
  const { data, error } = await updateRequestForAgent({
    agentProfileId: res.locals.profile.id,
    requestId: req.params.requestId,
    status
  });
  if (error) return sendLfgError(res, error);
  return res.json(data);
});

router.get('/lfg/characters', lfgLimiter.middleware, async (req, res) => {
  const { data, error } = await listEligibleCharactersForAgent({
    agentProfileId: res.locals.profile.id
  });
  if (error) return sendLfgError(res, error);
  return res.json({ characters: data });
});

module.exports = router;
