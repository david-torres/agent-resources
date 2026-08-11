const { isAdmin, isSystem } = require('../../util/actor');

// A caller may manage agent tokens owned by their own profile, or is
// admin/system acting on behalf of a user.
const canManageOwnTokens = (actor, ownerProfileId) => {
  if (isSystem(actor) || isAdmin(actor)) return true;
  return !!actor && !!actor.profileId && actor.profileId === ownerProfileId;
};

module.exports = { canManageOwnTokens };
