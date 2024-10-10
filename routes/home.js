const express = require('express');
const router = express.Router();
const { getProfile } = require('../util/supabase');

router.get('/', async (req, res) => {
  const user = res.locals.user;
  let profile = null;
  if (user) {
    profile = await getProfile(user);
  }
  res.render('home', { user, profile });
});

module.exports = router;
