const { isAdmin, isSystem } = require('../../util/actor');

// Only the post's creator (host of the game) — or an admin/system actor —
// may update, delete, or close an LFG post.
const canManagePost = (actor, post) => {
  if (isSystem(actor) || isAdmin(actor)) return true;
  return !!actor?.profileId && !!post && actor.profileId === post.creator_id;
};

// Moderating (approving/rejecting) a join request is a host action: only the
// post's creator — or an admin/system actor — may do it. Kept distinct from
// canManagePost even though the check is identical today: this predicate is
// about the *post the request belongs to*, not the request row itself.
const canModerateJoinRequest = (actor, post) => {
  if (isSystem(actor) || isAdmin(actor)) return true;
  return !!actor?.profileId && !!post && actor.profileId === post.creator_id;
};

// A profile may join with a character only if they own it and it is not
// deceased. The system actor may always join (e.g. backfill/import flows);
// there is no admin bypass here because character ownership is not an
// admin-adjacent concern.
const canJoinAsCharacter = (actor, character) => {
  if (isSystem(actor)) return true;
  return !!actor?.profileId && !!character &&
    actor.profileId === character.creator_id && !character.is_deceased;
};

// Withdrawing/removing your own join request. An admin/system actor may
// manage any request (moderation cleanup); the host managing another
// profile's request goes through canModerateJoinRequest instead.
const canManageOwnJoinRequest = (actor, request) => {
  if (isSystem(actor) || isAdmin(actor)) return true;
  return !!actor?.profileId && !!request && actor.profileId === request.profile_id;
};

module.exports = { canManagePost, canModerateJoinRequest, canJoinAsCharacter, canManageOwnJoinRequest };
