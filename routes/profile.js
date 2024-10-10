const express = require('express');
const router = express.Router();
const { getUser, updateUser, getProfile, getProfileByName } = require('../util/supabase');
const { isAuthenticated } = require('../util/is-authenticated');

router.get('/', isAuthenticated, async (req, res) => {
  const user = await getUser();
  const profile = await getProfile();
  res.render('profile', { user, profile });
});

router.get('/edit', isAuthenticated, async (req, res) => {
  const user = await getUser();
  const profile = await getProfile();
  res.render('partials/profile-form', { layout: false, user, profile });
});

router.get('/view/:name', async (req, res) => {
  const user = await getUser();
  const { data: profile, error } = await getProfileByName(req.params.name);
  if (error) {
    res.status(400).send('Not found');
  }
  if (profile.is_public === false) {
    res.status(404).send('Not found');
  }
  res.render('profile-view', { user, profile });
});

router.put('/', isAuthenticated, async (req, res) => {
  const { email, password, name, bio, image_url, is_public } = req.body;
  const profile = {
    name,
    bio,
    image_url,
    is_public: (is_public ? true : false),
  }
  const { data, error } = await updateUser(email, password, profile);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', '/profile').send();
  }
});

module.exports = router;
