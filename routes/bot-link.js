// routes/bot-link.js
const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../util/auth');
const { createAgentToken } = require('../models/agent-token');
const {
  normalizeLinkCode,
  getPendingLinkByCode,
  attachTokenToPendingLink,
  cleanupStaleLinks
} = require('../models/bot-link');
const { supabaseAdmin } = require('../models/_base');

router.get('/', isAuthenticated, (req, res) => {
  return res.render('bot-link', { title: 'Link Discord bot' });
});

router.post('/confirm', express.urlencoded({ extended: false }), isAuthenticated, async (req, res) => {
  await cleanupStaleLinks();

  const normalized = normalizeLinkCode(req.body?.code);
  if (!normalized) {
    return res.render('bot-link', {
      title: 'Link Discord bot',
      error: 'Code must be 8 letters or numbers, e.g. XXXX-XXXX.'
    });
  }

  const { data: pending, error: pendingError } = await getPendingLinkByCode(normalized);
  if (pendingError) {
    return res.render('bot-link', { title: 'Link Discord bot', error: 'Lookup failed.' });
  }
  if (!pending) {
    return res.render('bot-link', { title: 'Link Discord bot', error: 'Code not found. Run /link in Discord again.' });
  }
  if (pending.consumed_at || new Date(pending.expires_at).getTime() < Date.now()) {
    return res.render('bot-link', { title: 'Link Discord bot', error: 'Code expired. Run /link in Discord again.' });
  }
  if (pending.agent_token_id) {
    return res.render('bot-link', { title: 'Link Discord bot', success: true });
  }

  const tokenName = `Discord bot (${pending.discord_user_id})`;
  const { data: tokenRow, error: tokenError } = await createAgentToken({
    userId: res.locals.user.id,
    profileId: res.locals.profile.id,
    name: tokenName
  });
  if (tokenError || !tokenRow) {
    return res.render('bot-link', { title: 'Link Discord bot', error: 'Could not create a token. Try again.' });
  }

  const { error: stashError } = await supabaseAdmin
    .from('pending_bot_links_raw_tokens')
    .insert({ agent_token_id: tokenRow.id, raw_token: tokenRow.token });
  if (stashError) {
    return res.render('bot-link', { title: 'Link Discord bot', error: 'Could not stash token. Try again.' });
  }

  const { error: attachError } = await attachTokenToPendingLink({
    code: normalized,
    agentTokenId: tokenRow.id
  });
  if (attachError) {
    return res.render('bot-link', { title: 'Link Discord bot', error: 'Could not attach token. Try again.' });
  }

  return res.render('bot-link', { title: 'Link Discord bot', success: true });
});

module.exports = router;
