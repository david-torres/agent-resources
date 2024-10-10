const express = require('express');
const router = express.Router();
const { getProfile, getOwnCharacters, getCharacter, getLfgPosts, getLfgPostsByCreator, getLfgPostsByOthers, getLfgPost, createLfgPost, updateLfgPost, deleteLfgPost, joinLfgPost, getLfgJoinRequests, getLfgJoinRequestByPostIdAndProfileId, updateJoinRequest, deleteJoinRequest } = require('../util/supabase');
const { isAuthenticated } = require('../util/auth');

router.get('/', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const profile = await getProfile(user);
  const { data, error } = await getLfgPostsByOthers(profile.id);

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
  const { data: characters, error: characterError } = await getOwnCharacters(user);
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
  const { data: characters, error: characterError } = await getOwnCharacters(user);
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
    res.header('HX-Location', `/lfg`).send();
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

router.get('/:id/join', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const profile = await getProfile(user);
  const { data: post, error: postError } = await getLfgPost(req.params.id);
  const { data: characters, error: characterError } = await getOwnCharacters(user);

  if (postError) {
    res.status(400).send(postError.message);
  } else {
    res.render('partials/lfg-join-form', { layout: false, profile, post, characters });
  }
});

router.post('/:id/join', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const profile = await getProfile(user);
  const { joinType, characterId } = req.body;

  const { data, error } = await joinLfgPost(req.params.id, profile.id, joinType, characterId);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', `/lfg/${req.params.id}`).send();
  }
});

router.get('/:id/requests', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const profile = await getProfile(user);
  const { data: post, error: postError } = await getLfgPost(req.params.id);

  if (post.creator_id !== profile.id) {
    res.status(403).send('Unauthorized');
    return;
  }

  const { data: requests, error: requestsError } = await getLfgJoinRequests(req.params.id);
  if (requestsError) {
    res.status(400).send(requestsError.message);
  } else {
    res.render('partials/lfg-join-requests', { layout: false, requests, post });
  }
});

router.put('/:id/requests/:requestId', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const profile = await getProfile(user);
  const { data: post, error: postError } = await getLfgPost(req.params.id);

  if (post.creator_id !== profile.id) {
    res.status(403).send('Unauthorized');
    return;
  }

  const { status } = req.body;
  const { data, error } = await updateJoinRequest(req.params.requestId, status);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.send('Request updated successfully');
  }
});

router.delete('/:id/join', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const profile = await getProfile(user);

  const { data: post, error: postError } = await getLfgPost(req.params.id);
  if (postError) {
    res.status(400).send(postError.message);
  }

  if (post.host_id === profile.id) {
    post.host_id = null;
    const { data: updatePost, error: updatePostError } = await updateLfgPost(req.params.id, post, user);
    if (updatePostError) {
      res.status(400).send(error.message);
    }
    res.headers('HX-Location', `/lfg`).send();
    return;
  }

  const { data: request, error: requestError } = await getLfgJoinRequestByPostIdAndProfileId(req.params.id, profile.id);
  if (requestError) {
    res.status(400).send(requestError.message);
  }
  const { data, error } = await deleteJoinRequest(request.id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', `/lfg`).send();
  }
});

module.exports = router;
