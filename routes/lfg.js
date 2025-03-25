const express = require('express');
const router = express.Router();
const { getOwnCharacters, getLfgPosts, getLfgPostsByCreator, getLfgPostsByOthers, getLfgJoinedPosts, getLfgPost, createLfgPost, updateLfgPost, deleteLfgPost, joinLfgPost, getLfgJoinRequests, getLfgJoinRequestForUserAndPost, updateJoinRequest, deleteJoinRequest, createMission } = require('../util/supabase');
const { isAuthenticated, authOptional } = require('../util/auth');
const { statList } = require('../util/enclave-consts');

router.get('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: ownPosts, error: ownPostsError } = await getLfgPostsByCreator(profile.id);
  res.render('lfg', { profile, ownPosts });
});

router.get('/tab/my-posts', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: ownPosts, error: ownPostsError } = await getLfgPostsByCreator(profile.id);
  if (ownPostsError) {
    console.error(ownPostsError);
    res.status(400).send(ownPostsError.message);
  } else {
    res.render('partials/lfg-my-posts', { layout: false, ownPosts, profile });
  }
});

router.get('/tab/joined', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: joinedPosts, error: joinedPostsError } = await getLfgJoinedPosts(profile.id);
  if (joinedPostsError) {
    console.error(joinedPostsError);
    res.status(400).send(joinedPostsError.message);
  } else {
    res.render('partials/lfg-joined-posts', { layout: false, joinedPosts, profile });
  }
});

router.get('/tab/public', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: publicPosts, error: publicPostsError } = await getLfgPostsByOthers(profile.id);
  if (publicPostsError) {
    console.error(publicPostsError);
    res.status(400).send(publicPostsError.message);
  } else {
    res.render('partials/lfg-public-posts', { layout: false, publicPosts, profile });
  }
});

router.get('/new', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: characters, error: characterError } = await getOwnCharacters(profile);
  res.render('partials/lfg-form', { layout: false, isNew: true, profile, characters });
});

router.post('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data, error } = await createLfgPost(req.body, profile);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', '/lfg').send();
  }
});

router.get('/:id', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { data, error } = await getLfgPost(req.params.id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    if (req.headers['x-calendar']) {
      res.header('HX-Push-Url', `/lfg/${req.params.id}`);
    }
    const party = data.join_requests.reduce((acc, item) => {
      if (item.status === 'approved') {
        acc.push(item.characters);
      }
      return acc;
    }, []);
    const partyStats = party.reduce((acc, item) => {
      statList.forEach(stat => {
        acc[stat] = (acc[stat] || 0) + (item[stat] || 0);
      });
      return acc;
    }, {});


    res.render('lfg-post', { profile, post: data, statList, partyStats, authOptional: true });
  }
});

router.get('/:id/edit', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: characters, error: characterError } = await getOwnCharacters(profile);
  const { data, error } = await getLfgPost(req.params.id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('partials/lfg-form', { layout: false, isNew: false, profile, post: data, characters });
  }
});

router.put('/:id', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data, error } = await updateLfgPost(req.params.id, req.body, profile);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', `/lfg`).send();
  }
});

router.delete('/:id', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data, error } = await deleteLfgPost(req.params.id, profile);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', '/lfg').send();
  }
});

router.get('/:id/join', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: post, error: postError } = await getLfgPost(req.params.id);
  const { data: characters, error: characterError } = await getOwnCharacters(profile);

  if (postError) {
    res.status(400).send(postError.message);
  } else {
    res.render('partials/lfg-join-form', { layout: false, profile, post, characters });
  }
});

router.post('/:id/join', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { joinType, characterId } = req.body;

  const { data, error } = await joinLfgPost(req.params.id, profile.id, joinType, characterId);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', `/lfg/${req.params.id}`).send();
  }
});

router.get('/:id/requests', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
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
  const { profile } = res.locals;
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
  const { profile } = res.locals;

  const { data: post, error: postError } = await getLfgPost(req.params.id);
  if (postError) {
    res.status(400).send(postError.message);
  }

  if (post.host_id === profile.id) {
    post.host_id = null;
    const { data: updatePost, error: updatePostError } = await updateLfgPost(req.params.id, post, profile);
    if (updatePostError) {
      res.status(400).send(updatePostError.message);
      return;
    }
    res.headers('HX-Location', `/lfg`).send();
    return;
  }

  const { data: request, error: requestError } = await getLfgJoinRequestForUserAndPost(profile.id, req.params.id);
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

router.get('/events/all', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: allPosts, error } = await getLfgPosts();

  if (error) {
    console.error(error);
    res.status(400).json({ error: error.message });
  } else {
    const events = allPosts.map(post => ({
      id: post.id,
      title: post.title,
      start: post.date,
      allDay: false,
      extendedProps: {
        description: post.description,
        creatorId: post.creator_id,
        isCreator: post.creator_id === profile.id
      }
    }));
    res.json(events);
  }
});

router.post('/:id/create-mission', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: lfgPost, error: lfgError } = await getLfgPost(req.params.id);
  if (lfgError) {
    res.status(400).send(lfgError.message);
    return;
  }

  // look up host id
  let hostProfile = null;
  if (lfgPost.host_id === null) {
    hostProfile = await getProfile(lfgPost.host_id);
  }

  const missionData = {
    name: lfgPost.title,
    focus_words: '',
    statement: lfgPost.description,
    summary: '',
    date: lfgPost.date,
    is_public: lfgPost.is_public,
    host_id: lfgPost.host_id,
    host_name: lfgPost.host_name || hostProfile.name,
  };

  const { data: mission, error: missionError } = await createMission(missionData, profile);
  if (missionError) {
    res.status(400).send(missionError.message);
  } else {
    res.header('HX-Location', `/missions/${mission.id}`).send();
  }
});

module.exports = router;