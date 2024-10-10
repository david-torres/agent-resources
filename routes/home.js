const express = require('express');
const router = express.Router();
const { getProfile } = require('../util/supabase');
const { authOptional } = require('../util/auth');

router.get('/', authOptional, async (req, res) => {
  const user = res.locals.user;
  let profile = null;
  if (user) {
    profile = await getProfile(user);
  }
  res.render('home', { user, profile });
});

module.exports = router;
