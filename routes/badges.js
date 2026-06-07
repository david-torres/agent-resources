const express = require('express');
const router = express.Router();
const { isAuthenticated, requireAdmin } = require('../util/auth');
const { sendError } = require('../util/http-error');
const { getBadgeCatalog, listProfileBadges, grantBadge, revokeBadge } = require('../models/badge');
const { getProfileByIdAdmin, searchProfilesAdmin } = require('../models/profile');

router.get('/manage', isAuthenticated, requireAdmin, async (req, res) => {
  const { data: catalog, error } = await getBadgeCatalog();
  if (error) {
    return sendError(req, res, error, { message: 'Failed to load badge catalog' });
  }

  const q = (req.query.q || '').toString().trim();
  let matches = [];
  if (q) {
    const { data } = await searchProfilesAdmin(q);
    matches = data || [];
  }

  let selectedProfile = null;
  let heldSlugs = new Set();
  if (req.query.profile_id) {
    const { data: profileData } = await getProfileByIdAdmin(req.query.profile_id.toString());
    if (profileData) {
      selectedProfile = profileData;
      const { data: held } = await listProfileBadges(profileData.id);
      heldSlugs = new Set((held || []).map(b => b.slug));
    }
  }

  const decorate = (b) => ({ ...b, held: heldSlugs.has(b.slug) });
  const byCategory = (category) => (catalog || []).filter(b => b.category === category).map(decorate);

  return res.render('badges-manage', {
    profile: res.locals.profile,
    title: 'Manage Badges',
    q,
    matches,
    selectedProfile,
    milestoneBadges: byCategory('milestone'),
    eventBadges: byCategory('event'),
    personalBadges: byCategory('personal'),
    breadcrumbs: [
      { label: 'Badges', href: '/badges/manage' },
      { label: 'Manage', href: '/badges/manage' }
    ]
  });
});

const grantRevokeParams = (req, res) => {
  const profileId = (req.body.profile_id || '').toString().trim();
  const badgeSlug = (req.body.badge_slug || '').toString().trim();
  if (!profileId || !badgeSlug) {
    sendError(req, res, null, { status: 400, message: 'profile_id and badge_slug are required' });
    return null;
  }
  return { profileId, badgeSlug };
};

// Model-level errors (milestone guard, unknown badge) are client errors.
const grantRevokeErrorStatus = (error) =>
  /milestone|not found/i.test(error?.message || '') ? 400 : 500;

router.post('/grant', isAuthenticated, requireAdmin, async (req, res) => {
  const params = grantRevokeParams(req, res);
  if (!params) return;

  const { error } = await grantBadge({
    profileId: params.profileId,
    badgeSlug: params.badgeSlug,
    grantedById: res.locals.profile.id
  });
  if (error) {
    return sendError(req, res, error, {
      status: grantRevokeErrorStatus(error),
      message: error.message || 'Failed to grant badge'
    });
  }
  return res.redirect(`/badges/manage?profile_id=${encodeURIComponent(params.profileId)}`);
});

router.post('/revoke', isAuthenticated, requireAdmin, async (req, res) => {
  const params = grantRevokeParams(req, res);
  if (!params) return;

  const { error } = await revokeBadge({
    profileId: params.profileId,
    badgeSlug: params.badgeSlug
  });
  if (error) {
    return sendError(req, res, error, {
      status: grantRevokeErrorStatus(error),
      message: error.message || 'Failed to revoke badge'
    });
  }
  return res.redirect(`/badges/manage?profile_id=${encodeURIComponent(params.profileId)}`);
});

module.exports = router;
