const express = require('express');
const router = express.Router();
const { getUser, getProfile, getOwnCharacters, getCharacter, getLfgPosts, getLfgPost, createLfgPost, updateLfgPost, deleteLfgPost } = require('../util/supabase');
const { isAuthenticated } = require('../util/is-authenticated');

router.get('/', isAuthenticated, async (req, res) => {
  const user = await getUser();
  const profile = await getProfile();
  const { data, error } = await getLfgPosts();
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('lfg', { user, profile, posts: data });
  }
});

router.get('/new', isAuthenticated, async (req, res) => {
  const profile = await getProfile();
  const characters = await getOwnCharacters();
  res.render('partials/lfg-form', { layout: false, isNew: true, profile, characters });
});


router.post('/', isAuthenticated, async (req, res) => {
  const profile = await getProfile();
  const post = req.body;

  if (post.host_id == 'on') {
    post.host_id = profile.id;
  }

  const { data, error } = await createLfgPost(req.body);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', '/lfg').send();
  }
});

router.get('/:id', isAuthenticated, async (req, res) => {
  const user = await getUser();
  const profile = await getProfile();
  const { data, error } = await getLfgPost(req.params.id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('lfg-post', { user, profile, post: data });
  }
});

router.get('/:id/edit', isAuthenticated, async (req, res) => {
  const profile = await getProfile();
  const characters = await getOwnCharacters();
  const { data, error } = await getLfgPost(req.params.id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('partials/lfg-form', { layout: false, isNew: false, profile, post: data, characters });
  }
});

router.put('/:id', isAuthenticated, async (req, res) => {
  const { data, error } = await updateLfgPost(req.params.id, req.body);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', `/lfg/${req.params.id}`).send();
  }
});

router.delete('/:id', isAuthenticated, async (req, res) => {
  const { data, error } = await deleteLfgPost(req.params.id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', '/lfg').send();
  }
});

module.exports = router;
