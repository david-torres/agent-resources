const express = require('express');
const router = express.Router();
const { authOptional } = require('../util/auth');
const { getOwnCharacters } = require('../models/character');

router.get('/', authOptional, async (req, res) => {
  const { profile } = res.locals;
  let hasCharacters = false;
  if (profile) {
    const { data } = await getOwnCharacters(profile, res.locals.supabase);
    hasCharacters = data && data.length > 0;
  }
  res.render('home', { profile, authOptional: true, hasCharacters });
});

router.get('/privacy', authOptional, (req, res) => {
  const { profile } = res.locals;

  res.render('privacy', {
    profile,
    authOptional: true,
    title: 'Privacy Policy',
    breadcrumbs: [
      { label: 'Privacy Policy', href: '/privacy' }
    ]
  });
});

router.get('/terms', authOptional, (req, res) => {
  const { profile } = res.locals;

  res.render('terms', {
    profile,
    authOptional: true,
    title: 'Terms of Use',
    breadcrumbs: [
      { label: 'Terms of Use', href: '/terms' }
    ]
  });
});

router.get('/contact', authOptional, (req, res) => {
  const { profile } = res.locals;

  res.render('contact', {
    profile,
    authOptional: true,
    title: 'Contact',
    breadcrumbs: [
      { label: 'Contact', href: '/contact' }
    ]
  });
});

module.exports = router;
