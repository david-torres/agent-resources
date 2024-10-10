const express = require('express');
const router = express.Router();
const { getProfile, getOwnCharacters, getCharacter, getLfgPosts, getLfgPostsByCreator, getLfgPost, createLfgPost, updateLfgPost, deleteLfgPost } = require('../util/supabase');
const { isAuthenticated } = require('../util/auth');

router.get('/', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const profile = await getProfile(user);
  const { data, error } = await getLfgPosts();

  // get own lfg posts
  const { data: ownPosts, error: ownPostsError } = await getLfgPostsByCreator(profile.id);
  if (ownPostsError) {
    console.error(ownPostsError);
  }

  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('lfg', { user, profile, posts: data, ownPosts });
  }
});

router.get('/new', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const profile = await getProfile(user);
  const characters = await getOwnCharacters(user);
  res.render('partials/lfg-form', { layout: false, isNew: true, profile, characters });
});


router.post('/', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const profile = await getProfile(user);
  const post = req.body;

  const { data, error } = await createLfgPost(req.body, user);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', '/lfg').send();
  }
});

router.get('/:id', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const profile = await getProfile(user);
  const { data, error } = await getLfgPost(req.params.id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('lfg-post', { user, profile, post: data });
  }
});

router.get('/:id/edit', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const profile = await getProfile(user);
  const characters = await getOwnCharacters(user);
  const { data, error } = await getLfgPost(req.params.id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('partials/lfg-form', { layout: false, isNew: false, profile, post: data, characters });
  }
});

router.put('/:id', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const { data, error } = await updateLfgPost(req.params.id, req.body, user);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', `/lfg/${req.params.id}`).send();
  }
});

router.delete('/:id', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const { data, error } = await deleteLfgPost(req.params.id, user);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', '/lfg').send();
  }
});

module.exports = router;
