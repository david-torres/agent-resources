const { BotLinkService, ...botLinkConstants } = require('../services/bot-link/service');
const botLinkRepository = require('../services/bot-link/repository');
const { createAgentToken } = require('./agent-token');

const {
  LINK_CODE_TTL_MS,
  LINK_CODE_MAX_PENDING_PER_DISCORD_ID,
  LINK_CODE_RATE_WINDOW_MS,
  LINK_ROW_CLEANUP_AGE_MS,
  generateLinkCode,
  formatLinkCode,
  normalizeLinkCode,
  isValidDiscordUserId
} = botLinkConstants;

const botLinkService = new BotLinkService(botLinkRepository, createAgentToken);

// Route-facing compatibility functions. The service enforces bot-link's
// possession-based protocol for the PUBLIC capabilities and the
// authenticated attach policy for confirmLink; this model remains the thin
// caller so existing route imports keep working unchanged.

// System write (no policy) — periodic cleanup of abandoned rows.
const cleanupStaleLinks = async () => botLinkService.cleanupStaleLinks();

// PUBLIC — rate-limited per discord_user_id, enforced by botLinkService.
const createPendingLink = async (discordUserId) => botLinkService.startLink({ discordUserId });

// Plain read — no policy (used by the authenticated confirm route to render
// link state before it decides whether to attach a token).
const getPendingLinkByCode = async (code) => botLinkRepository.fetchPendingByCode(code);

// authz: canAttachToken (self actor, or system), enforced by botLinkService.
const attachTokenToPendingLink = async ({ code, agentTokenId }) =>
  botLinkRepository.attachToken({ code, agentTokenId });

// PUBLIC/possession — enforced by botLinkService via policy.canClaimByPossession.
// Note: on success this also discloses-and-purges the one-time raw token
// stash (see botLinkService.claimLink); the original model-level function
// only returned { agentTokenId }, so this adds a `rawToken` field to a
// successful result rather than removing anything existing callers rely on.
const consumePendingLink = async ({ code, discordUserId }) => botLinkService.claimLink({ code, discordUserId });

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
