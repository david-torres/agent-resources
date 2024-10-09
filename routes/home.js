const express = require('express');
const router = express.Router();
const { getUser, getProfile } = require('../util/supabase');

router.get('/', async (req, res) => {
  const user = await getUser();
  let profile = null;
  if (user) {
    profile = await getProfile();
  }
  res.render('home', { user, profile });
});

module.exports = router;
