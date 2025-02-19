const express = require('express');
const router = express.Router();
const { authOptional } = require('../util/auth');

router.get('/', authOptional, async (req, res) => {
  const { profile } = res.locals;
  res.render('home', { profile, authOptional: true });
});

module.exports = router;
