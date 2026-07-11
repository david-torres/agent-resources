// routes/bot-link.js
const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../util/auth');
const { actorFromLocals } = require('../util/actor');
const { normalizeLinkCode, cleanupStaleLinks } = require('../models/bot-link');
const { BotLinkService } = require('../services/bot-link/service');
const botLinkRepository = require('../services/bot-link/repository');
const { createAgentToken } = require('../models/agent-token');

const botLinkService = new BotLinkService(botLinkRepository, createAgentToken);

const CONFIRM_ERROR_MESSAGES = {
  lookup_failed: 'Lookup failed.',
  not_found: 'Code not found. Run /link in Discord again.',
  expired: 'Code expired. Run /link in Discord again.',
  token_create_failed: 'Could not create a token. Try again.',
  stash_failed: 'Could not stash token. Try again.',
  attach_failed: 'Could not attach token. Try again.'
};

router.get('/', isAuthenticated, (req, res) => {
  return res.render('bot-link', { title: 'Link Discord bot' });
});

// This is an HTML render route, not a JSON API — it gets its own local
// try/catch rather than asyncHandler. asyncHandler forwards a thrown error
// to the central error handler, which renders a JSON/generic error response;
// that would break this page. A thrown AuthorizationError (e.g. an
// authenticated-but-unconfirmed user, whose res.locals.profile is `false`
// and therefore has no profileId) must instead render the existing graceful
// "Could not create a token" error view.
router.post('/confirm', express.urlencoded({ extended: false }), isAuthenticated, async (req, res) => {
  try {
    await cleanupStaleLinks();

    const normalized = normalizeLinkCode(req.body?.code);
    if (!normalized) {
      return res.render('bot-link', {
        title: 'Link Discord bot',
        error: 'Code must be 8 letters or numbers, e.g. XXXX-XXXX.'
      });
    }

    const actor = actorFromLocals(res.locals);
    const { data, error } = await botLinkService.confirmLink(actor, { code: normalized });

    if (error) {
      const message = CONFIRM_ERROR_MESSAGES[error] || 'Could not create a token. Try again.';
      return res.render('bot-link', { title: 'Link Discord bot', error: message });
    }

    return res.render('bot-link', { title: 'Link Discord bot', success: true });
  } catch (err) {
    // Covers AuthorizationError (e.g. an unconfirmed user with no profile)
    // and any other unexpected failure — always degrade to the same
    // graceful error view rather than letting the request hang or 500.
    console.error(err);
    return res.render('bot-link', { title: 'Link Discord bot', error: 'Could not create a token. Try again.' });
  }
});

module.exports = router;
