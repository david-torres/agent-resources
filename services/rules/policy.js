const { isAdmin, isSystem } = require('../../util/actor');

// Only admins (or the system actor) mint unlock codes for a rules PDF
// (today's requireAdmin route).
const canMintRulesUnlockCodes = (actor) => isAdmin(actor) || isSystem(actor);

module.exports = { canMintRulesUnlockCodes };
