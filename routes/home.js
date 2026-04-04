const express = require('express');
const router = express.Router();
const { authOptional } = require('../util/auth');
const { getOwnCharacters } = require('../models/character');

router.get('/', authOptional, async (req, res) => {
  const { profile } = res.locals;
  let hasCharacters = false;
  if (profile) {
    const { data } = await getOwnCharacters(profile);
    hasCharacters = data && data.length > 0;
  }
  res.render('home', { profile, authOptional: true, hasCharacters });
});

module.exports = router;
