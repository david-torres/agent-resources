const express = require('express');
const router = express.Router();
const { authOptional } = require('../util/auth');

router.get('/', authOptional, (req, res) => {
  res.render('auth');
});

router.post('/', authOptional, (req, res) => {
  res.render('auth');
});

router.get('/check', authOptional, (req, res) => {
  res.render('auth-check');
});

router.get('/signin-form', (req, res) => {
  res.render('partials/signin-form', { layout: false });
});

router.get('/signup-form', (req, res) => {
  res.render('partials/signup-form', { layout: false });
});

module.exports = router;
