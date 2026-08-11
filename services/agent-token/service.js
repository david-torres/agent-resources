const crypto = require('crypto');
const { AuthorizationError } = require('../../util/errors');
const { canManageOwnTokens } = require('./policy');

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

const REQUIRED_REPOSITORY_METHODS = [
  'insertToken',
  'listTokens',
  'revokeToken',
  'findTokenByHash',
  'touchLastUsed'
];

const requireOwner = (actor, ownerProfileId) => {
  if (!canManageOwnTokens(actor, ownerProfileId)) {
    throw new AuthorizationError('Not authorized to manage this agent token', { reason: 'not_owner' });
  }
};

/** Application boundary for agent-token commands: policy -> validate -> mutate.
 * create/list/revoke act on the caller's own profile (owner defaults to the
 * actor's own userId/profileId; an explicit override is only honored for
 * admin/system actors — see canManageOwnTokens). verifyAgentToken is the
 * authentication primitive that PRODUCES an actor, so it takes none and
 * bypasses policy entirely. */
class AgentTokenService {
  constructor(repository) {
    const missing = REQUIRED_REPOSITORY_METHODS.filter(method => typeof repository?.[method] !== 'function');
    if (missing.length) throw new TypeError(`AgentTokenService requires repository methods: ${missing.join(', ')}`);
    this.repo = repository;
  }

  async createToken(actor, { name, userId, profileId } = {}) {
    const ownerProfileId = profileId ?? actor?.profileId ?? null;
    const ownerUserId = userId ?? actor?.userId ?? null;
    requireOwner(actor, ownerProfileId);

    const trimmedName = (name || '').trim();
    if (!ownerUserId || !ownerProfileId) {
      return { data: null, error: new Error('Missing user context') };
    }
    if (!trimmedName) {
      return { data: null, error: new Error('Token name is required') };
    }

    const { token, tokenHint } = generateAgentToken();
    const tokenHash = hashAgentToken(token);

    const { data, error } = await this.repo.insertToken({
      user_id: ownerUserId,
      profile_id: ownerProfileId,
      name: trimmedName,
      token_hash: tokenHash,
      token_hint: tokenHint
    });

    if (error) {
      return { data: null, error };
    }

    return {
      data: {
        ...data,
        token
      },
      error: null
    };
  }

  async listTokens(actor, { userId, profileId, includeRevoked = false } = {}) {
    const ownerProfileId = profileId ?? actor?.profileId ?? null;
    const ownerUserId = userId ?? actor?.userId ?? null;
    requireOwner(actor, ownerProfileId);

    if (!ownerUserId || !ownerProfileId) {
      return { data: null, error: new Error('Missing user context') };
    }

    return this.repo.listTokens({ userId: ownerUserId, profileId: ownerProfileId, includeRevoked });
  }

  async revokeToken(actor, { tokenId, userId, profileId } = {}) {
    const ownerProfileId = profileId ?? actor?.profileId ?? null;
    const ownerUserId = userId ?? actor?.userId ?? null;
    requireOwner(actor, ownerProfileId);

    if (!tokenId || !ownerUserId || !ownerProfileId) {
      return { data: null, error: new Error('Missing revoke context') };
    }

    return this.repo.revokeToken({ tokenId, userId: ownerUserId, profileId: ownerProfileId });
  }

  // Authentication primitive: verifies a raw bearer token and returns the
  // actor-shaped payload util/auth.js needs to populate res.locals. Takes no
  // actor (it produces one) and performs no authorization check — there is
  // nothing to authorize yet.
  async verifyAgentToken(token) {
    if (!token || !token.startsWith(AGENT_TOKEN_PREFIX)) {
      return { data: null, error: new Error('Invalid token format') };
    }

    const tokenHash = hashAgentToken(token);
    const { data, error } = await this.repo.findTokenByHash(tokenHash);
    if (error) {
      return { data: null, error };
    }

    await this.repo.touchLastUsed(data.id);

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
  }
}

module.exports = { AgentTokenService, AGENT_TOKEN_PREFIX };
