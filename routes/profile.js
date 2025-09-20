const express = require('express');
const router = express.Router();
const { updateUser, getProfileByName, setDiscordId, getPublicCharactersByCreator, getClasses } = require('../util/supabase');
const { getUnlockedClasses } = require('../models/class');
const { isAuthenticated, authOptional } = require('../util/auth');

router.get('/', isAuthenticated, async (req, res) => {
  const { user, profile } = res.locals;
  let unlockedClasses = [];
  try {
    const { data } = await getUnlockedClasses(user.id);
    if (Array.isArray(data)) unlockedClasses = data;
  } catch (_) {}
  res.render('profile', { user, profile, unlockedClasses });
});

router.get('/edit', isAuthenticated, async (req, res) => {
  const { user, profile } = res.locals;
  res.render('partials/profile-form', { layout: false, user, profile });
});

router.get('/view/:name', authOptional, async (req, res) => {
  const { user, profile } = res.locals;
  const { data: viewProfile, error } = await getProfileByName(req.params.name);
  if (error) {
    return res.status(400).send('Not found');
  }
  if (viewProfile.is_public === false) {
    return res.status(404).send('Not found');
  }
  const { data: publicCharacters, error: charsError } = await getPublicCharactersByCreator(viewProfile.id);
  if (charsError) {
    return res.status(400).send(charsError.message);
  }
  const { data: publicClasses, error: classesError } = await getClasses({ is_public: true, created_by: viewProfile.id });
  if (classesError) {
    return res.status(400).send(classesError.message);
  }
  res.render('profile-view', { user, profile, viewProfile, authOptional: true, publicCharacters, publicClasses });
});

router.put('/', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const { email, password, name, bio, image_url, is_public, timezone } = req.body;
  const profile = {
    name,
    bio,
    image_url,
    is_public: (is_public ? true : false),
    timezone
  }
  const { data, error } = await updateUser(email, password, profile);
  if (error) {
    return res.status(400).send(error.message);
  } else {
    return res.header('HX-Location', '/profile').send();
  }
});

router.post('/discord/sync', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const { discord_id, discord_email } = req.body;
  const { error } = await setDiscordId(user.id, discord_id, discord_email);
  if (error) {
    return res.status(400).send(error.message);
  }
  return res.status(204).send();
});

router.post('/discord/clear', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const { error } = await setDiscordId(user.id, null, null);
  if (error) {
    return res.status(400).send(error.message);
  }
  return res.status(204).send();
});

module.exports = router;
