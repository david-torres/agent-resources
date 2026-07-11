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

// Some call sites (import utilities) receive a bare `profile` row rather than
// `res.locals`; this builds the same actor shape from that row.
const actorFromProfile = (profile) => ({
  userId: (profile && profile.user_id) || null,
  profileId: (profile && profile.id) || null,
  role: (profile && profile.role) || null,
});

const isAdmin = (actor) => !!actor && actor.role === 'admin';
const isSystem = (actor) => !!actor && actor.role === 'system';

module.exports = { actorFromLocals, actorFromProfile, SYSTEM_ACTOR, isAdmin, isSystem };
