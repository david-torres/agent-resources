const express = require('express');
const router = express.Router();
const { registerUuidParams } = require('../util/validate');
registerUuidParams(router, ['id']);
const { updateUser, getProfileByName, setDiscordId, getPublicCharactersByCreator, getClasses, searchProfiles, getProfileConduitCredits } = require('../util/supabase');
const { parseImageCrop } = require('../util/crop');
const { getUnlockedClasses } = require('../models/class');
const { createAgentToken, listAgentTokens, revokeAgentToken } = require('../models/agent-token');
const { isAuthenticated, authOptional } = require('../util/auth');
const { sendError } = require('../util/http-error');

router.get('/', isAuthenticated, async (req, res) => {
  const { user, profile } = res.locals;
  let unlockedClasses = [];
  try {
    const { data } = await getUnlockedClasses(user.id);
    if (Array.isArray(data)) unlockedClasses = data;
  } catch (_) {}

  let conduitCredits = { earned: 0, spent_linked: 0, balance: 0 };
  try {
    const { data } = await getProfileConduitCredits({
      profileId: profile.id,
      supabase: res.locals.supabase
    });
    if (data) conduitCredits = data;
  } catch (_) {}

  res.render('profile', {
    user,
    profile,
    unlockedClasses,
    conduitCredits,
    activeNav: 'profile',
    breadcrumbs: [
      { label: 'Profile', href: '/profile' }
    ]
  });
});

router.get('/edit', isAuthenticated, async (req, res) => {
  const { user, profile } = res.locals;
  res.render('partials/profile-form', { layout: false, user, profile });
});

router.get('/view/:name', authOptional, async (req, res) => {
  const { user, profile } = res.locals;
  const { name } = req.params;
  const { data: viewProfile, error } = await getProfileByName(name);
  if (error) {
    return sendError(req, res, error, { message: 'Not found' });
  }
  if (viewProfile.is_public === false) {
    return sendError(req, res, null, { status: 404, message: 'Not found' });
  }
  const { data: publicCharacters, error: charsError } = await getPublicCharactersByCreator(viewProfile.id);
  if (charsError) {
    return sendError(req, res, charsError);
  }
  const { data: publicClasses, error: classesError } = await getClasses({ is_public: true, created_by: viewProfile.id });
  if (classesError) {
    return sendError(req, res, classesError);
  }
  res.render('profile-view', {
    user,
    profile,
    viewProfile,
    authOptional: true,
    publicCharacters,
    publicClasses,
    activeNav: 'profile',
    breadcrumbs: [
      { label: viewProfile.name, href: `/profile/view/${encodeURIComponent(name)}` }
    ]
  });
});

router.put('/', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const { email, password, name, bio, image_url, is_public, timezone, conduit_briefing } = req.body;
  const image_crop = parseImageCrop(req.body.image_crop);
  const profile = {
    name,
    bio,
    image_url,
    image_crop,
    is_public: (is_public ? true : false),
    timezone,
    conduit_briefing
  }
  const { data, error } = await updateUser(user.id, email, password, profile);
  if (error) {
    return sendError(req, res, error);
  } else {
    return res.header('HX-Location', '/profile').send();
  }
});

router.post('/discord/sync', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const { discord_id, discord_email } = req.body;
  const { error } = await setDiscordId(user.id, discord_id, discord_email);
  if (error) {
    return sendError(req, res, error);
  }
  return res.status(204).send();
});

router.post('/discord/clear', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const { error } = await setDiscordId(user.id, null, null);
  if (error) {
    return sendError(req, res, error);
  }
  return res.status(204).send();
});

router.get('/agent-tokens', isAuthenticated, async (req, res) => {
  const { user, profile } = res.locals;
  const includeRevoked = req.query.include_revoked === 'true';
  const { data, error } = await listAgentTokens({
    userId: user.id,
    profileId: profile.id,
    includeRevoked
  });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ tokens: data });
});

router.post('/agent-tokens', isAuthenticated, async (req, res) => {
  const { user, profile } = res.locals;
  const name = (req.body.name || '').trim();

  if (!name) {
    return res.status(400).json({ error: 'Token name is required' });
  }

  const { data, error } = await createAgentToken({
    userId: user.id,
    profileId: profile.id,
    name
  });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(201).json(data);
});

router.delete('/agent-tokens/:id', isAuthenticated, async (req, res) => {
  const { user, profile } = res.locals;
  const { data, error } = await revokeAgentToken({
    tokenId: req.params.id,
    userId: user.id,
    profileId: profile.id
  });

  if (error) {
    return res.status(404).json({ error: 'Token not found' });
  }

  return res.json(data);
});

// Search profiles (for adding editors, etc.)
router.get('/search', isAuthenticated, async (req, res) => {
  const { q } = req.query;
  const { data: profiles, error } = await searchProfiles(q, 10);
  if (error) {
    return sendError(req, res, error);
  }
  res.render('partials/profile-search-results', {
    layout: false,
    profiles
  });
});

module.exports = router;
