const { isAdmin, isSystem } = require('../../util/actor');

// A class may be edited or deleted by its creator or an admin.
const canManageClass = (actor, classRow) => {
  if (isSystem(actor) || isAdmin(actor)) return true;
  return !!actor && !!actor.profileId && !!classRow && actor.profileId === classRow.created_by;
};

// Only admins mint unlock codes for a class (today's requireAdmin route).
const canMintUnlockCodes = (actor) => isAdmin(actor) || isSystem(actor);

module.exports = { canManageClass, canMintUnlockCodes };
