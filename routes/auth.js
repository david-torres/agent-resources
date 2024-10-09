const express = require('express');
const router = express.Router();
const { clearUser } = require('../util/supabase');

router.get('/', (req, res) => {
  res.render('auth');
});

router.get('/signin-form', (req, res) => {
  res.render('partials/signin-form', { layout: false });
});

router.get('/signup-form', (req, res) => {
  res.render('partials/signup-form', { layout: false });
});

router.post('/signout', async (req, res) => {
  clearUser();
  res.header('HX-Location', '/auth').send();
});

module.exports = router;
