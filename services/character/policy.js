const { isAdmin, isSystem } = require('../../util/actor');

// A character may be mutated by its creator, or by an admin/system actor.
// Operates over a pre-loaded character row (no I/O) so the repository owns
// every privileged read; mirrors services/mission/policy.js's canEditMission
// and services/class/policy.js's canManageClass.
const canMutateCharacter = (actor, character) => {
  if (isSystem(actor) || isAdmin(actor)) return true;
  return !!actor?.profileId && !!character && actor.profileId === character.creator_id;
};

module.exports = { canMutateCharacter };
