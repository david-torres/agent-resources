const { getEditionAccess } = require('../services/access/service');

// A non-boosted htmx request that names a target element swaps a fragment and
// never renders the layout, so it has no use for the banner's lookup. Boosted
// navigations, history restores and hx-target="body" swaps (which send no
// HX-Target: <body> has no id) do render it.
const rendersLayout = (req) => !req.get('HX-Request')
  || Boolean(req.get('HX-Boosted'))
  || req.get('HX-History-Restore-Request') === 'true'
  || !req.get('HX-Target');

const populateEditionAccess = async (req, res, deps = { getEditionAccess }) => {
  const { user, profile } = res.locals;
  if (!user || !profile || !rendersLayout(req)) return;
  res.locals.editionAccess = await deps.getEditionAccess(user.id, new Date(), { timeZone: profile.timezone || null });
};

const trialStatus = (editionAccess, edition) =>
  (editionAccess?.[edition]?.state === 'trial' ? editionAccess[edition] : null);

const trialEndedAt = (editionAccess, edition) =>
  (editionAccess?.[edition]?.state === 'expired' ? editionAccess[edition].endedAt : null);

module.exports = { populateEditionAccess, trialStatus, trialEndedAt };
