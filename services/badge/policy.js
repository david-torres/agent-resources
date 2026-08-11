const { isAdmin } = require('../../util/actor');

// Only admins grant or revoke non-milestone badges (today's requireAdmin
// route). Deliberately admin-only, not admin-or-system like class/rules
// unlock-code minting: milestone badges are earned automatically via
// recalculateMilestoneBadges (system-by-construction, no policy call at
// all), and there is no other system caller for grant/revoke.
const canGrantBadge = (actor) => isAdmin(actor);
const canRevokeBadge = (actor) => isAdmin(actor);

module.exports = { canGrantBadge, canRevokeBadge };
