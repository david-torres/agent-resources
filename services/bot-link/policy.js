const { isSystem } = require('../../util/actor');

// Authorization for this domain is by protocol/possession, not identity: the
// Discord bot and the browser confirm page act as unauthenticated or
// pseudonymous callers for the claim step. A caller proves the right to
// consume a pending link by presenting the exact code + discord_user_id pair
// the link was minted for — there is no user identity to check against.
// This predicate documents that decision explicitly; it never throws (the
// PUBLIC claim route maps a `false` result to its own protocol status code).
const canClaimByPossession = (link, { code, discordUserId }) =>
  !!link &&
  link.code === code &&
  link.discord_user_id === discordUserId &&
  !link.consumed_at &&
  !!link.agent_token_id;

// Attaching a freshly-minted agent token to a pending link is performed by
// the authenticated web user who just created that token in the same
// request (or the system actor). The `agent_token_id == null` guard ensures
// a link can only ever be attached once.
const canAttachToken = (actor, link) =>
  isSystem(actor) || (!!actor?.profileId && !!link && link.agent_token_id == null);

module.exports = { canClaimByPossession, canAttachToken };
