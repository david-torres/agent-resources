const express = require('express');
const router = express.Router();
const { registerUuidParams } = require('../util/validate');
registerUuidParams(router, ['id', 'requestId']);
const {
    getLfgPosts,
    getLfgPostsByCreator,
    getLfgPostsByOthers,
    getLfgJoinedPosts,
    getLfgPost,
    createLfgPost,
    updateLfgPost,
    deleteLfgPost,
    joinLfgPost,
    getLfgJoinRequests,
    getLfgJoinRequestForUserAndPost,
    updateJoinRequest,
    deleteJoinRequest,
    syncConduitHostId
} = require('../models/lfg');
const { getOwnCharacters } = require('../models/character');
const { isAuthenticated, authOptional } = require('../util/auth');
const { sendError, FRIENDLY_NOT_FOUND } = require('../util/http-error');
const { actorFromLocals } = require('../util/actor');
const { asyncHandler } = require('../util/async-handler');
const { summarizeParty } = require('../util/party-stats');

router.get('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: ownPosts, error: ownPostsError } = await getLfgPostsByCreator(profile.id, res.locals.supabase);
  res.render('lfg', {
    profile,
    ownPosts,
    activeNav: 'lfg',
    breadcrumbs: [
      { label: 'Looking for Game', href: '/lfg' }
    ]
  });
});

router.get('/tab/my-posts', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: ownPosts, error: ownPostsError } = await getLfgPostsByCreator(profile.id, res.locals.supabase);
  if (ownPostsError) {
    console.error(ownPostsError);
    return sendError(req, res, ownPostsError);
  } else {
    res.render('partials/lfg-my-posts', { layout: false, ownPosts, profile });
  }
});

router.get('/tab/joined', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: joinedPosts, error: joinedPostsError } = await getLfgJoinedPosts(profile.id, res.locals.supabase);
  if (joinedPostsError) {
    console.error(joinedPostsError);
    return sendError(req, res, joinedPostsError);
  } else {
    res.render('partials/lfg-joined-posts', { layout: false, joinedPosts, profile });
  }
});

router.get('/tab/public', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: publicPosts, error: publicPostsError } = await getLfgPostsByOthers(profile.id, res.locals.supabase);
  if (publicPostsError) {
    console.error(publicPostsError);
    return sendError(req, res, publicPostsError);
  } else {
    res.render('partials/lfg-public-posts', { layout: false, publicPosts, profile });
  }
});

router.get('/tab/calendar', isAuthenticated, async (req, res) => {
  // The container only; public/js/app.js fills it from /lfg/events/all once the
  // tab's htmx request settles, which also lazy-loads the FullCalendar script.
  res.render('partials/lfg-calendar', { layout: false });
});

router.get('/new', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: allCharacters, error: characterError } = await getOwnCharacters(profile, res.locals.supabase);
  const characters = (allCharacters || []).filter(c => !c.is_deceased);
  res.render('partials/lfg-form', { layout: false, isNew: true, profile, characters });
});

router.post('/', isAuthenticated, asyncHandler(async (req, res) => {
  const { profile } = res.locals;
  const actor = { ...actorFromLocals(res.locals), timezone: profile.timezone };
  const { data, error } = await createLfgPost(actor, req.body);
  if (error) {
    return sendError(req, res, error);
  } else {
    return res.header('HX-Location', '/lfg').send();
  }
}));

router.get('/:id', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { data, error } = await getLfgPost(req.params.id, res.locals.supabase);
  if (error) {
    return sendError(req, res, error);
  } else {
    if (req.headers['x-calendar']) {
      return res.header('HX-Push-Url', `/lfg/${req.params.id}`);
    }
    const party = (data.join_requests || [])
      .filter((item) => item.status === 'approved' && item.character)
      .map((item) => item.character);
    const approvedCount = party.length;
    const partySummary = summarizeParty(party);
    const partyCsv = party.map(character => character.id).join(',');

    const pendingCount = (data.join_requests || []).filter(r => r.status === 'pending').length;

    res.render('lfg-post', {
      profile,
      post: data,
      partySummary,
      partyCsv,
      approvedCount,
      pendingCount,
      authOptional: true,
      activeNav: 'lfg',
      breadcrumbs: [
        { label: 'Looking for Game', href: '/lfg' },
        { label: data.title, href: `/lfg/${data.id}` }
      ]
    });
  }
});

router.get('/:id/edit', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: allCharacters, error: characterError } = await getOwnCharacters(profile, res.locals.supabase);
  const characters = (allCharacters || []).filter(c => !c.is_deceased);
  const { data, error } = await getLfgPost(req.params.id, res.locals.supabase);
  if (error) {
    return sendError(req, res, error);
  } else {
    res.render('partials/lfg-form', { layout: false, isNew: false, profile, post: data, characters });
  }
});

router.put('/:id', isAuthenticated, asyncHandler(async (req, res) => {
  const { profile } = res.locals;
  const actor = { ...actorFromLocals(res.locals), timezone: profile.timezone };
  const { data, error } = await updateLfgPost(actor, req.params.id, req.body);
  if (error) {
    return sendError(req, res, error);
  } else {
    return res.header('HX-Location', `/lfg`).send();
  }
}));

router.delete('/:id', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { data, error } = await deleteLfgPost(actor, req.params.id);
  if (error) {
    return sendError(req, res, error);
  } else {
    return res.header('HX-Location', '/lfg').send();
  }
}));

router.get('/:id/join', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: post, error: postError } = await getLfgPost(req.params.id, res.locals.supabase);
  const { data: allCharacters, error: characterError } = await getOwnCharacters(profile, res.locals.supabase);
  const characters = (allCharacters || []).filter(c => !c.is_deceased);

  if (postError) {
    return sendError(req, res, postError);
  } else {
    res.render('partials/lfg-join-form', { layout: false, profile, post, characters });
  }
});

router.post('/:id/join', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { joinType, characterId } = req.body;

  const { data, error } = await joinLfgPost(req.params.id, profile.id, joinType, characterId, res.locals.supabase);
  if (error) {
    return sendError(req, res, error, { message: 'Join failed' });
  } else {
    return res.header('HX-Location', `/lfg/${req.params.id}`).send();
  }
});

router.get('/:id/requests', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: post, error: postError } = await getLfgPost(req.params.id, res.locals.supabase);

  if (post.creator_id !== profile.id) {
    return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });
  }

  const { data: requests, error: requestsError } = await getLfgJoinRequests(req.params.id, res.locals.supabase);
  if (requestsError) {
    return sendError(req, res, requestsError);
  } else {
    const layout = req.get('HX-Request') ? false : 'main';
    res.render('partials/lfg-join-requests', { layout, requests, post });
  }
});

router.put('/:id/requests/:requestId', isAuthenticated, asyncHandler(async (req, res) => {
  const { profile } = res.locals;
  const { data: post, error: postError } = await getLfgPost(req.params.id, res.locals.supabase);

  if (postError || !post) {
    return sendError(req, res, null, { status: 404, message: 'Not found' });
  }
  if (post.creator_id !== profile.id) {
    return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });
  }

  const actor = actorFromLocals(res.locals);
  const { status } = req.body;
  const { data, error } = await updateJoinRequest(actor, req.params.requestId, status, req.params.id);
  if (error) {
    return sendError(req, res, error);
  } else {
    res.send('Request updated successfully');
  }
}));

router.delete('/:id/join', isAuthenticated, asyncHandler(async (req, res) => {
  const { profile } = res.locals;
  const actor = actorFromLocals(res.locals);

  const { data: request } = await getLfgJoinRequestForUserAndPost(profile.id, req.params.id, res.locals.supabase);
  if (request) {
    const { error } = await deleteJoinRequest(actor, request.id);
    if (error) {
      return sendError(req, res, error, { message: 'Failed to unjoin' });
    }
    return res.header('HX-Location', `/lfg`).send();
  }

  // Legacy fallback: a pre-migration post may still have host_id set without a matching
  // approved conduit join_request. syncConduitHostId re-derives host_id from join_requests,
  // which will clear it when none exists.
  const { data: post } = await getLfgPost(req.params.id, res.locals.supabase);
  if (post && post.host_id === profile.id) {
    await syncConduitHostId(req.params.id);
    return res.header('HX-Location', `/lfg`).send();
  }
  return sendError(req, res, null, { status: 400, message: 'No join request found' });
}));

router.get('/events/all', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: allPosts, error } = await getLfgPosts(res.locals.supabase);

  if (error) {
    console.error(error);
    return res.status(400).json({ error: error.message });
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

module.exports = router;