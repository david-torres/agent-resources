const crypto = require('crypto');
const { AuthorizationError } = require('../../util/errors');
const { canClaimByPossession, canAttachToken } = require('./policy');

const LINK_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const LINK_CODE_LENGTH = 8;
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const LINK_CODE_MAX_PENDING_PER_DISCORD_ID = 3;
const LINK_CODE_RATE_WINDOW_MS = 10 * 60 * 1000;
const LINK_ROW_CLEANUP_AGE_MS = 60 * 60 * 1000;
const CODE_ALLOCATION_ATTEMPTS = 5;

const nowIso = () => new Date().toISOString();
const plusMsIso = (ms) => new Date(Date.now() + ms).toISOString();
const minusMsIso = (ms) => new Date(Date.now() - ms).toISOString();

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

const REQUIRED_REPOSITORY_METHODS = [
  'deleteStaleLinks',
  'countRecentPending',
  'insertPendingLink',
  'fetchPendingByCode',
  'attachToken',
  'consumePending',
  'stashRawToken',
  'fetchRawToken',
  'deleteRawToken'
];

/** Application boundary for the bot-link domain: policy -> validate -> mutate.
 *
 * The Discord-facing capabilities (startLink, claimLink) are PUBLIC by
 * design — the Discord bot is an unauthenticated caller, and authorization
 * for the claim step is by possession of the code+discord_user_id pair
 * (see policy.canClaimByPossession), not actor identity. They therefore
 * return protocol-shaped errors (`'not_found' | 'expired' | 'mismatch' |
 * 'pending'` or an Error for internal failures) rather than throwing, so
 * the PUBLIC routes can keep their existing explicit status codes.
 *
 * confirmLink is the one authenticated capability — it requires an actor
 * and throws AuthorizationError (via policy.canAttachToken) when the actor
 * may not attach a token to the link.
 */
class BotLinkService {
  constructor(repository, createAgentToken) {
    const missing = REQUIRED_REPOSITORY_METHODS.filter(method => typeof repository?.[method] !== 'function');
    if (missing.length) throw new TypeError(`BotLinkService requires repository methods: ${missing.join(', ')}`);
    if (typeof createAgentToken !== 'function') {
      throw new TypeError('BotLinkService requires a createAgentToken(actor, { name }) function');
    }
    this.repo = repository;
    this.createAgentToken = createAgentToken;
  }

  async cleanupStaleLinks() {
    return this.repo.deleteStaleLinks(minusMsIso(LINK_ROW_CLEANUP_AGE_MS));
  }

  // PUBLIC — the Discord bot requests a fresh code for itself, rate-limited
  // per discord_user_id.
  async startLink({ discordUserId }) {
    if (!isValidDiscordUserId(discordUserId)) {
      return { data: null, error: new Error('Invalid discord_user_id') };
    }

    await this.cleanupStaleLinks();

    const since = minusMsIso(LINK_CODE_RATE_WINDOW_MS);
    const { count, error: countError } = await this.repo.countRecentPending(discordUserId, since);
    if (countError) return { data: null, error: countError };
    if (count >= LINK_CODE_MAX_PENDING_PER_DISCORD_ID) {
      return { data: null, error: new Error('Too many pending codes') };
    }

    for (let attempt = 0; attempt < CODE_ALLOCATION_ATTEMPTS; attempt++) {
      const code = generateLinkCode();
      const expiresAt = plusMsIso(LINK_CODE_TTL_MS);
      const { data, error } = await this.repo.insertPendingLink({
        code,
        discord_user_id: discordUserId,
        expires_at: expiresAt
      });
      if (!error) return { data, error: null };
      if (error.code !== '23505') return { data: null, error };
    }
    return { data: null, error: new Error('Could not allocate unique link code') };
  }

  // PUBLIC/possession — the Discord bot claims a code once the web confirm
  // step has attached a token. Consumes the link, then discloses-and-purges
  // the one-time raw token stash.
  async claimLink({ code, discordUserId }) {
    const { data: link, error } = await this.repo.fetchPendingByCode(code);
    if (error && error.code !== 'PGRST116') return { data: null, error };
    if (!link) return { data: null, error: 'not_found' };
    if (link.consumed_at) return { data: null, error: 'expired' };
    if (new Date(link.expires_at).getTime() < Date.now()) {
      return { data: null, error: 'expired' };
    }
    if (link.discord_user_id !== discordUserId) return { data: null, error: 'mismatch' };
    if (!link.agent_token_id) return { data: null, error: 'pending' };

    // Belt-and-suspenders: the checks above already establish possession;
    // this documents/re-asserts the same decision via the pure policy
    // predicate before the consuming mutation.
    if (!canClaimByPossession(link, { code, discordUserId })) {
      return { data: null, error: 'mismatch' };
    }

    const { data: consumed, error: consumeError } = await this.repo.consumePending({ code, discordUserId });
    if (consumeError || !consumed) return { data: null, error: 'expired' };

    const agentTokenId = consumed.agent_token_id;
    const { data: rawTokenRow, error: rawError } = await this.repo.fetchRawToken(agentTokenId);
    if (rawError || !rawTokenRow) {
      return { data: null, error: new Error('Token stash missing') };
    }

    await this.repo.deleteRawToken(agentTokenId);

    return { data: { agentTokenId, rawToken: rawTokenRow.raw_token }, error: null };
  }

  // Authenticated — the web user who ran /link in Discord confirms the code
  // in the browser. Mints a new agent token, stashes its raw value for the
  // one-time Discord-side disclosure, then attaches it to the link.
  async confirmLink(actor, { code }) {
    const { data: pending, error: pendingError } = await this.repo.fetchPendingByCode(code);
    if (pendingError) return { data: null, error: 'lookup_failed' };
    if (!pending) return { data: null, error: 'not_found' };
    if (pending.consumed_at || new Date(pending.expires_at).getTime() < Date.now()) {
      return { data: null, error: 'expired' };
    }
    if (pending.agent_token_id) {
      return { data: { alreadyLinked: true }, error: null };
    }

    if (!canAttachToken(actor, pending)) {
      throw new AuthorizationError('Not authorized to attach a token to this link', { reason: 'not_owner' });
    }

    const tokenName = `Discord bot (${pending.discord_user_id})`;
    const { data: tokenRow, error: tokenError } = await this.createAgentToken(actor, { name: tokenName });
    if (tokenError || !tokenRow) return { data: null, error: 'token_create_failed' };

    const { error: stashError } = await this.repo.stashRawToken({
      agentTokenId: tokenRow.id,
      rawToken: tokenRow.token
    });
    if (stashError) return { data: null, error: 'stash_failed' };

    const { error: attachError } = await this.repo.attachToken({ code, agentTokenId: tokenRow.id });
    if (attachError) return { data: null, error: 'attach_failed' };

    return { data: { linked: true }, error: null };
  }
}

module.exports = {
  BotLinkService,
  LINK_CODE_TTL_MS,
  LINK_CODE_MAX_PENDING_PER_DISCORD_ID,
  LINK_CODE_RATE_WINDOW_MS,
  LINK_ROW_CLEANUP_AGE_MS,
  generateLinkCode,
  formatLinkCode,
  normalizeLinkCode,
  isValidDiscordUserId,
  nowIso
};
