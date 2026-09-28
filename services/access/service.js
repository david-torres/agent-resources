const rulesRepository = require('../rules/repository');
const { resolveEditionStatus } = require('./edition-status');

const defaultDeps = {
  fetchCoreBookGrantsForUser: (args) => rulesRepository.fetchCoreBookGrantsForUser(args)
};

// Fail quiet: the caller renders no banner or teasers rather than a wrong
// "none", and existing access checks still enforce the gating.
const getEditionAccess = async (userId, now = new Date(), { timeZone = null } = {}, deps = defaultDeps) => {
  try {
    const { data, error } = await deps.fetchCoreBookGrantsForUser({ userId });
    if (error) {
      console.error('edition access lookup failed:', error);
      return null;
    }
    return resolveEditionStatus(data, now, { timeZone });
  } catch (err) {
    console.error('edition access lookup threw:', err);
    return null;
  }
};

module.exports = { getEditionAccess };
