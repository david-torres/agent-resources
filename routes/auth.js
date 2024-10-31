const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('auth');
});

router.get('/check', (req, res) => {
  res.render('auth-check');
});

router.get('/signin-form', (req, res) => {
  res.render('partials/signin-form', { layout: false });
});

router.get('/signup-form', (req, res) => {
  res.render('partials/signup-form', { layout: false });
});

module.exports = router;
