const express = require('express');
const router = express.Router();
const { updateUser, getProfileByName } = require('../util/supabase');
const { isAuthenticated, authOptional } = require('../util/auth');

router.get('/', isAuthenticated, async (req, res) => {
  const { user, profile } = res.locals;
  res.render('profile', { user, profile });
});

router.get('/edit', isAuthenticated, async (req, res) => {
  const { user, profile } = res.locals;
  res.render('partials/profile-form', { layout: false, user, profile });
});

router.get('/view/:name', authOptional, async (req, res) => {
  const { user, profile } = res.locals;
  const { data: viewProfile, error } = await getProfileByName(req.params.name);
  if (error) {
    res.status(400).send('Not found');
  }
  if (profile.is_public === false) {
    res.status(404).send('Not found');
  }
  res.render('profile-view', { user, profile, viewProfile });
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
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', '/profile').send();
  }
});

module.exports = router;
