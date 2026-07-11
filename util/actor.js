// Who is performing a privileged command, derived from the request.
// Shape matches the existing agent-read convention ({ userId, profileId, role }).
const actorFromLocals = (locals = {}) => ({
  userId: (locals && locals.user && locals.user.id) || null,
  profileId: (locals && locals.profile && locals.profile.id) || null,
  role: (locals && locals.profile && locals.profile.role) || null,
});

// Trusted actor for internal, non-user-triggered privileged commands
// (badge recalculation, backfill, denormalization). Never built from input.
const SYSTEM_ACTOR = Object.freeze({ userId: null, profileId: null, role: 'system' });

const isAdmin = (actor) => !!actor && actor.role === 'admin';
const isSystem = (actor) => !!actor && actor.role === 'system';

module.exports = { actorFromLocals, SYSTEM_ACTOR, isAdmin, isSystem };
