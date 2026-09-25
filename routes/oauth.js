const express = require('express');
const { isAuthenticated } = require('../util/auth');

const router = express.Router();

router.get('/consent', isAuthenticated, (req, res) => {
  const { authorization_id: authorizationId } = req.query;
  res.render('oauth-consent', { authorizationId: typeof authorizationId === 'string' ? authorizationId : '' });
});

module.exports = router;
