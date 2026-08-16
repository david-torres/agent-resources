const express = require('express');
const router = express.Router();
const { authOptional } = require('../util/auth');
const { asyncHandler } = require('../util/async-handler');
const { loadHomeSections } = require('../services/home/sections');
const { getAllNews } = require('../models/pages');
const { buildExcerpt } = require('../services/home/excerpt');

router.get('/', authOptional, asyncHandler(async (req, res) => {
  const { profile } = res.locals;

  // loadHomeSections already answers "does this player have any characters"
  // via sections.hasCharacters (read from the raw character query, before
  // recentMine's cross-type merge/truncation) -- so there is no need for a
  // second, unbounded getOwnCharacters query (which pulls every column,
  // including background/appearance/private_notes/perks, of every character
  // the player owns) solely to compute this flag.
  const sections = await loadHomeSections({ profile, client: res.locals.supabase });

  res.render('home', {
    profile,
    authOptional: true,
    ...sections
  });
}));

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

router.get('/news', authOptional, asyncHandler(async (req, res) => {
  const { profile } = res.locals;

  const { data: newsRows, error } = await getAllNews(res.locals.supabase);
  if (error) {
    console.error('news index failed:', error);
  }

  const news = (newsRows || []).map(row => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    created_at: row.created_at,
    excerpt: buildExcerpt(row.content)
  }));

  res.render('news', {
    profile,
    authOptional: true,
    title: 'News',
    news,
    breadcrumbs: [
      { label: 'News', href: '/news' }
    ]
  });
}));

module.exports = router;
