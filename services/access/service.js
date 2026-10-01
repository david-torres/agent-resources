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

const hasAspirantAccess = (access) => ['owned', 'trial'].includes(access?.aspirant?.state);
const ASPIRANT_ACCESS_ERROR = Object.freeze({ status: 403, message: 'Unlock the Aspirant book to use Aspiring and Aspirant features.' });

module.exports = { getEditionAccess, hasAspirantAccess, ASPIRANT_ACCESS_ERROR };
