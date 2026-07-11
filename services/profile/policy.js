const { isAdmin, isSystem } = require('../../util/actor');

// Actor may mutate the profile owned by targetUserId (self), or is admin/system.
const canMutateOwnProfile = (actor, targetUserId) => {
  if (isSystem(actor) || isAdmin(actor)) return true;
  return !!actor && !!actor.userId && actor.userId === targetUserId;
};

module.exports = { canMutateOwnProfile };
