const { AgentTokenService, AGENT_TOKEN_PREFIX } = require('../services/agent-token/service');
const agentTokenRepository = require('../services/agent-token/repository');

const agentTokenService = new AgentTokenService(agentTokenRepository);

// Route-facing compatibility functions. The service enforces the
// manage-own-tokens policy (self, or admin/system) and throws
// AuthorizationError on denial; this model remains the thin caller that
// threads the actor through.

// authz: self-command (or admin/system), enforced by agentTokenService.
const createAgentToken = async (actor, { name } = {}) => agentTokenService.createToken(actor, { name });

// authz: self-read (or admin/system), enforced by agentTokenService.
const listAgentTokens = async (actor, { includeRevoked = false } = {}) =>
  agentTokenService.listTokens(actor, { includeRevoked });

// authz: self-command (or admin/system), enforced by agentTokenService.
const revokeAgentToken = async (actor, { tokenId } = {}) => agentTokenService.revokeToken(actor, { tokenId });

// Authentication primitive: no actor (it produces one for the caller). Used
// by util/auth.js's isAgentAuthenticated middleware.
const verifyAgentToken = async (token) => agentTokenService.verifyAgentToken(token);

module.exports = {
  AGENT_TOKEN_PREFIX,
  createAgentToken,
  listAgentTokens,
  revokeAgentToken,
  verifyAgentToken
};
