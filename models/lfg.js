const { supabase, supabaseAdmin } = require('./_base');
const { statList } = require('../util/enclave-consts');
const moment = require('moment-timezone');
moment.tz.setDefault('UTC');

const fetchProfileById = async (profileId, client = supabase) => {
  if (!profileId) return { profile: null, error: null };
  const { data, error } = await client.from('profiles').select('*').eq('id', profileId).single();
  if (error && error.code !== 'PGRST116') return { profile: null, error };
  return { profile: data || null, error: null };
};

const assignCreatorMeta = (post, creator) => {
  post.creator_name = creator?.name || 'Unknown Agent';
  post.creator_is_public = Boolean(creator?.is_public);
};

const getLfgPosts = async (client = supabase) => {
  const { data, error } = await client
    .from('lfg_posts')
    .select('*')
    .eq('is_public', true)
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (error || !data) return { data, error };
  for (let post of data) {
    const { profile: creator, error: creatorError } = await fetchProfileById(post.creator_id, client);
    if (creatorError) return { data: null, error: creatorError };
    assignCreatorMeta(post, creator);

    const { data: host, error: hostError } = await client.from('profiles').select('*').eq('id', post.host_id).single();
    if (!hostError) {
      post.host_name = host.name;
      post.host_is_public = host.is_public;
    }

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id, client);
    if (joinRequestsError) return { data, error: joinRequestsError };
    post.join_requests = joinRequests;
  }
  return { data, error };
}

const getLfgPostsByOthers = async (profileId, client = supabase) => {
  const today = moment().startOf('day').toISOString();
  const { data, error } = await client
    .from('lfg_posts')
    .select('*')
    .neq('creator_id', profileId)
    .eq('is_public', true)
    .eq('status', 'open')
    .gte('date', today)
    .order('created_at', { ascending: false });
  if (error || !data) return { data, error };
  for (let post of data) {
    const { profile: creator, error: creatorError } = await fetchProfileById(post.creator_id, client);
    if (creatorError) return { data: null, error: creatorError };
    assignCreatorMeta(post, creator);

    const { data: host, error: hostError } = await client.from('profiles').select('*').eq('id', post.host_id).single();
    if (!hostError) {
      post.host_name = host.name;
      post.host_is_public = host.is_public;
    }

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id, client);
    if (joinRequestsError) return { data, error: joinRequestsError };
    post.join_requests = joinRequests;
  }
  return { data, error };
}

const getLfgPostsByCreator = async (creator_id, client = supabase) => {
  const { data, error } = await client
    .from('lfg_posts')
    .select('*')
    .eq('creator_id', creator_id)
    .order('created_at', { ascending: false });
  if (error || !data) return { data, error };
  for (let post of data) {
    const { profile: creator, error: creatorError } = await fetchProfileById(post.creator_id, client);
    if (creatorError) return { data: null, error: creatorError };
    assignCreatorMeta(post, creator);

    const { data: host, error: hostError } = await client.from('profiles').select('*').eq('id', post.host_id).single();
    if (!hostError) {
      post.host_name = host.name;
      post.host_is_public = host.is_public;
    }

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id, client);
    if (joinRequestsError) return { data, error: joinRequestsError };
    post.join_requests = joinRequests;
    post.pending_request_count = (joinRequests || []).filter(r => r.status === 'pending').length;
  }
  return { data, error };
}

const getLfgPost = async (id, client = supabase) => {
  const { data, error } = await client
    .from('lfg_posts')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return { data, error };

  let post = data;
  const { profile: creator, error: creatorError } = await fetchProfileById(post.creator_id, client);
  if (creatorError) return { data: null, error: creatorError };
  assignCreatorMeta(post, creator);

  const { data: host, error: hostError } = await client
    .from('profiles')
    .select('*')
    .eq('id', post.host_id)
    .single();
  if (!hostError) {
    post.host_name = host.name;
    post.host_is_public = host.is_public;
  }

  const { data: joinRequests, error: joinRequestsError } = await client
    .from('lfg_join_requests')
    .select(`
      *,
      profile:profile_id (id, name, is_public),
      character:character_id (
        id,
        name,
        class,
        level,
        is_public,
        is_deceased,
        ${statList.join(',')},
        personality:traits(name),
        abilities:class_abilities(name,description,class_id),
        gear:class_gear(name,description,class_id)
      )
    `)
    .eq('lfg_post_id', id);

  if (joinRequestsError) return { data: post, error: joinRequestsError };
  post.join_requests = joinRequests;

  return { data: post, error };
}

const createLfgPost = async (postReq, profile) => {
  postReq.creator_id = profile.id;

  const characterId = postReq.character || null;
  delete postReq.character;

  postReq.host_id = postReq.host_id === 'on' ? profile.id : null;
  postReq.is_public = postReq.is_public === 'on';
  postReq.date = moment.tz(postReq.date, profile.timezone).utc();

  // authz: creator_id is set server-side to profile.id above
  const { data: postRows, error } = await supabaseAdmin
    .from('lfg_posts')
    .insert(postReq)
    .select();

  if (error || !postRows || postRows.length === 0) {
    return { data: null, error: error || 'Failed to create LFG post' };
  }
  const post = postRows[0];

  if (characterId) {
    const { data: existingRequest } = await getLfgJoinRequestForUserAndPost(profile.id, post.id);
    if (existingRequest) {
      const { error: deleteErr } = await deleteJoinRequest(existingRequest.id);
      if (deleteErr) return { data: null, error: deleteErr };
    }

    // creator-gated flow: use admin for the character read so private
    // characters aren't hidden; the ownership check inside joinLfgPost
    // enforces authz in app code.
    const { data: joinRows, error: joinErr } = await joinLfgPost(post.id, profile.id, 'player', characterId, supabaseAdmin);
    if (joinErr) return { data: null, error: joinErr };

    const { error: approveErr } = await updateJoinRequest(joinRows[0].id, 'approved');
    if (approveErr) return { data: null, error: approveErr };
  }

  return { data: post, error: null };
}

const updateLfgPost = async (id, postReq, profile) => {
  const { data: post, error: postError } = await getLfgPost(id);
  if (postError || !post) return { data: null, error: postError || 'LFG post not found' };
  if (post.creator_id !== profile.id) return { data: null, error: 'Unauthorized' };

  const characterId = postReq.character || null;
  delete postReq.character;

  if (characterId) {
    const { data: existingRequest } = await getLfgJoinRequestForUserAndPost(profile.id, id);
    if (existingRequest) {
      const { error: deleteErr } = await deleteJoinRequest(existingRequest.id);
      if (deleteErr) return { data: null, error: deleteErr };
    }
    // creator-gated: see createLfgPost comment.
    const { data: joinRows, error: joinErr } = await joinLfgPost(id, profile.id, 'player', characterId, supabaseAdmin);
    if (joinErr) return { data: null, error: joinErr };
    const { error: approveErr } = await updateJoinRequest(joinRows[0].id, 'approved');
    if (approveErr) return { data: null, error: approveErr };
  }

  delete postReq.creator_name;
  delete postReq.host_name;
  delete postReq.join_requests;

  postReq.host_id = postReq.host_id === 'on' ? profile.id : null;
  postReq.is_public = postReq.is_public === 'on';
  postReq.date = moment.tz(postReq.date, profile.timezone).utc();

  // authz: creator_id check above + filter below
  const { data, error } = await supabaseAdmin
    .from('lfg_posts')
    .update(postReq)
    .eq('id', id)
    .eq('creator_id', profile.id)
    .select();

  if (error) return { data: null, error };
  if (!data || data.length === 0) return { data: null, error: 'Update returned no rows' };
  return { data: data[0], error: null };
}

const deleteLfgPost = async (id, profile) => {
  const { data: post, error: postError } = await getLfgPost(id);
  if (postError || !post) return { data: null, error: postError || 'LFG post not found' };
  if (post.creator_id !== profile.id) return { data: null, error: 'Unauthorized' };

  // authz: creator_id check above + filter below
  const { data, error } = await supabaseAdmin.from('lfg_posts').delete().eq('id', id).eq('creator_id', profile.id);
  return { data, error };
}

const joinLfgPost = async (postId, profileId, joinType, characterId = null, client = supabase) => {
  if (joinType == 'player' && !characterId) return { data: null, error: 'Character is required for player join' };
  if (joinType == 'player') {
    const { data: character, error: characterError } = await client.from('characters').select('*').eq('id', characterId).single();
    if (characterError) return { data: null, error: characterError };
    if (character.creator_id !== profileId) return { data: null, error: 'You can only join with your own character' };
    if (character.is_deceased) return { data: null, error: 'Deceased characters cannot join games' };
  }
  if (joinType == 'conduit') characterId = null;

  const joinRequest = {
    lfg_post_id: postId,
    profile_id: profileId,
    join_type: joinType,
    character_id: characterId,
    status: 'pending'
  };

  // authz: profile_id comes from authenticated session; character ownership verified above for player joins.
  const { data, error } = await supabaseAdmin.from('lfg_join_requests').insert(joinRequest).select();
  return { data, error };
}

const getLfgJoinRequests = async (postId, client = supabase) => {
  const { data, error } = await client
    .from('lfg_join_requests')
    .select(`
      *,
      profile:profile_id (id,name,is_public),
      character:character_id (id,name,is_public,is_deceased)
    `)
    .eq('lfg_post_id', postId);
  return { data, error };
}

const getLfgJoinRequestForUserAndPost = async (profileId, postId, client = supabase) => {
  const { data, error } = await client
    .from('lfg_join_requests')
    .select('*')
    .eq('lfg_post_id', postId)
    .eq('profile_id', profileId)
    .single();
  return { data, error };
}

const updateJoinRequest = async (requestId, status, postId = null) => {
  // authz: caller scopes by postId when mutating cross-user requests;
  // internal callers (createLfgPost/updateLfgPost auto-approve) pass null because they just inserted the request.
  let query = supabaseAdmin
    .from('lfg_join_requests')
    .update({ status })
    .eq('id', requestId);
  if (postId) query = query.eq('lfg_post_id', postId);
  const { data, error } = await query;
  return { data, error };
}

const deleteJoinRequest = async (requestId) => {
  // authz: caller (routes/lfg.js DELETE /:id/join) scopes requestId to the authenticated profile;
  // also called internally by createLfgPost/updateLfgPost (creator-gated) to clear prior requests.
  const { data, error } = await supabaseAdmin
    .from('lfg_join_requests')
    .delete()
    .eq('id', requestId);
  return { data, error };
}

const getLfgJoinedPosts = async (profileId, client = supabase) => {
  const { data, error } = await client
    .from('lfg_join_requests')
    .select(`
      *,
      lfg_posts:lfg_post_id (*)
    `)
    .eq('profile_id', profileId);

  if (error) return { data: null, error };

  const joinedPosts = data.map(request => request.lfg_posts);

  for (let post of joinedPosts) {
    const { profile: creator, error: creatorError } = await fetchProfileById(post.creator_id, client);
    if (creatorError) return { data: null, error: creatorError };
    assignCreatorMeta(post, creator);

    const { data: host, error: hostError } = await client.from('profiles').select('*').eq('id', post.host_id).single();
    if (!hostError) {
      post.host_name = host.name;
      post.host_is_public = host.is_public;
    }

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id, client);
    if (joinRequestsError) return { data: null, error: joinRequestsError };
    post.join_requests = joinRequests;
  }

  return { data: joinedPosts, error: null };
}

const getPendingJoinRequestCount = async (profileId, client = supabase) => {
  const { count, error } = await client
    .from('lfg_join_requests')
    .select('*, lfg_posts!inner(creator_id)', { count: 'exact', head: true })
    .eq('lfg_posts.creator_id', profileId)
    .eq('status', 'pending');
  return { count: count || 0, error };
}

// ─── Agent-scoped LFG wrappers ────────────────────────────────────────────────

const closeLfgPost = async (id, profile) => {
  const { data, error } = await supabaseAdmin
    .from('lfg_posts')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('creator_id', profile.id)
    .select()
    .maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: { status: 403, code: 'not_host', message: 'Only the host can close this post' } };
  return { data, error: null };
};

const serializePostForAgent = (post, { agentProfileId, includePending }) => {
  const host = post.creator || post.host || {};
  const roster = (post.join_requests || [])
    .filter((r) => r.status === 'approved' && r.join_type === 'player')
    .map((r) => ({
      character_id: r.character_id,
      name: r.character?.name || null,
      class_name: r.character?.class || null,
      level: r.character?.level || null,
      profile_id: r.profile_id,
      profile_display_name: r.profile?.name || null
    }));
  const conduit = (post.join_requests || []).find(
    (r) => r.status === 'approved' && r.join_type === 'conduit'
  );
  const myRequest = (post.join_requests || []).find(
    (r) => r.profile_id === agentProfileId && r.status !== 'rejected'
  );
  const base = {
    id: post.id,
    title: post.title,
    description: post.description,
    date: post.date,
    host: { id: host.id, display_name: host.name },
    max_characters: post.max_characters,
    is_public: post.is_public,
    status: post.status,
    player_count: roster.length,
    has_conduit: !!conduit,
    roster,
    conduit: conduit
      ? { profile_id: conduit.profile_id, display_name: conduit.profile?.name || null }
      : null,
    my_request: myRequest
      ? { id: myRequest.id, join_type: myRequest.join_type, status: myRequest.status }
      : null
  };
  if (includePending && host.id === agentProfileId) {
    base.pending_requests = (post.join_requests || [])
      .filter((r) => r.status === 'pending')
      .map((r) => ({
        id: r.id,
        profile_id: r.profile_id,
        profile_display_name: r.profile?.name || null,
        join_type: r.join_type,
        character: r.character
          ? { id: r.character.id, name: r.character.name, class_name: r.character.class, level: r.character.level }
          : null
      }));
  }
  return base;
};

// Internal: fetch lfg_posts with full joins, filtered by arbitrary column equality + optional status
const AGENT_POST_SELECT = '*, creator:creator_id(id,name), lfg_join_requests(*, profile:profile_id(id,name), character:character_id(*))';

const getPostsWithRequestsBy = async (filters, { status } = {}) => {
  let query = supabaseAdmin
    .from('lfg_posts')
    .select(AGENT_POST_SELECT);
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }
  if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  const { data, error } = await query;
  // Normalize: rename lfg_join_requests -> join_requests for serializePostForAgent
  if (data) {
    for (const row of data) {
      row.join_requests = row.lfg_join_requests || [];
      delete row.lfg_join_requests;
    }
  }
  return { data, error };
};

// Internal: fetch lfg_posts where the given profile has a non-rejected join request
const getPostsByJoiner = async (profileId, { status } = {}) => {
  const { data: requests, error: reqError } = await supabaseAdmin
    .from('lfg_join_requests')
    .select('lfg_post_id')
    .eq('profile_id', profileId)
    .neq('status', 'rejected');
  if (reqError) return { data: null, error: reqError };
  const ids = (requests || []).map((r) => r.lfg_post_id);
  if (ids.length === 0) return { data: [], error: null };

  let query = supabaseAdmin
    .from('lfg_posts')
    .select(AGENT_POST_SELECT)
    .in('id', ids);
  if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  const { data, error } = await query;
  // Normalize: rename lfg_join_requests -> join_requests for serializePostForAgent
  if (data) {
    for (const row of data) {
      row.join_requests = row.lfg_join_requests || [];
      delete row.lfg_join_requests;
    }
  }
  return { data, error };
};

const listPostsForAgent = async ({ agentProfileId, scope = 'public', status = 'open' }) => {
  let rows;
  let error;
  if (scope === 'mine') {
    ({ data: rows, error } = await getPostsWithRequestsBy(
      { creator_id: agentProfileId },
      { status }
    ));
  } else if (scope === 'joined') {
    ({ data: rows, error } = await getPostsByJoiner(agentProfileId, { status }));
  } else {
    ({ data: rows, error } = await getPostsWithRequestsBy(
      { is_public: true },
      { status }
    ));
  }
  if (error) return { data: null, error };
  const projected = (rows || []).map((p) => {
    const full = serializePostForAgent(p, { agentProfileId, includePending: false });
    return {
      id: full.id,
      title: full.title,
      date: full.date,
      host: full.host,
      max_characters: full.max_characters,
      is_public: full.is_public,
      status: full.status,
      player_count: full.player_count,
      has_conduit: full.has_conduit,
      my_request_status: full.my_request?.status || null
    };
  });
  return { data: projected, error: null };
};

const getPostForAgent = async ({ agentProfileId, postId }) => {
  const { data: raw, error } = await supabaseAdmin
    .from('lfg_posts')
    .select(AGENT_POST_SELECT)
    .eq('id', postId)
    .maybeSingle();
  if (error) return { data: null, error };
  if (!raw) return { data: null, error: { status: 404, code: 'not_found', message: 'Post not found' } };
  // Normalize lfg_join_requests -> join_requests
  raw.join_requests = raw.lfg_join_requests || [];
  delete raw.lfg_join_requests;
  return {
    data: serializePostForAgent(raw, { agentProfileId, includePending: true }),
    error: null
  };
};

const createForAgent = async ({ agentProfile, body }) => {
  const { data, error } = await createLfgPost(body, agentProfile);
  if (error) return { data: null, error };
  return getPostForAgent({ agentProfileId: agentProfile.id, postId: data.id });
};

const updateForAgent = async ({ agentProfile, postId, body }) => {
  const { data, error } = await updateLfgPost(postId, body, agentProfile);
  if (error) {
    if (error.message === 'not found' || error.code === 'PGRST116') {
      return { data: null, error: { status: 403, code: 'not_host', message: 'Only the host can edit this post' } };
    }
    return { data: null, error };
  }
  return getPostForAgent({ agentProfileId: agentProfile.id, postId });
};

const closeForAgent = async ({ agentProfileId, postId }) => {
  const profile = { id: agentProfileId };
  const { data, error } = await closeLfgPost(postId, profile);
  if (error) return { data: null, error };
  return getPostForAgent({ agentProfileId, postId: data.id });
};

const deleteForAgent = async ({ agentProfile, postId }) => {
  const { error } = await deleteLfgPost(postId, agentProfile);
  if (error) {
    if (error.code === 'PGRST116' || error.message === 'not found') {
      return { data: null, error: { status: 403, code: 'not_host', message: 'Only the host can delete this post' } };
    }
    return { data: null, error };
  }
  return { data: { deleted: true }, error: null };
};

const joinForAgent = async ({ agentProfileId, postId, joinType, characterId }) => {
  if (joinType === 'player') {
    if (!characterId) {
      return { data: null, error: { status: 400, code: 'character_required', message: 'Player joins require a character' } };
    }
    const { data: character, error: charErr } = await supabaseAdmin
      .from('characters')
      .select('id, creator_id, is_deceased')
      .eq('id', characterId)
      .maybeSingle();
    if (charErr) return { data: null, error: charErr };
    if (!character || character.creator_id !== agentProfileId || character.is_deceased) {
      return { data: null, error: { status: 400, code: 'character_ineligible', message: 'Character is deceased or not yours' } };
    }
  }

  const { data: existing } = await supabaseAdmin
    .from('lfg_join_requests')
    .select('id, status')
    .eq('lfg_post_id', postId)
    .eq('profile_id', agentProfileId)
    .maybeSingle();
  if (existing && existing.status !== 'rejected') {
    return { data: null, error: { status: 409, code: 'duplicate_request', message: 'You already have a request on this post' } };
  }

  if (joinType === 'conduit') {
    const { data: conduitRequests } = await supabaseAdmin
      .from('lfg_join_requests')
      .select('id')
      .eq('lfg_post_id', postId)
      .eq('status', 'approved')
      .eq('join_type', 'conduit')
      .limit(1);
    if (conduitRequests && conduitRequests.length > 0) {
      return { data: null, error: { status: 409, code: 'conduit_taken', message: 'Conduit slot is already filled' } };
    }
  }

  const { data: request, error } = await joinLfgPost(postId, agentProfileId, joinType, characterId || null);
  if (error) return { data: null, error };
  const { data: post } = await getPostForAgent({ agentProfileId, postId });
  return { data: { request, post }, error: null };
};

const leaveForAgent = async ({ agentProfileId, postId }) => {
  const { data: existing } = await supabaseAdmin
    .from('lfg_join_requests')
    .select('id, status')
    .eq('lfg_post_id', postId)
    .eq('profile_id', agentProfileId)
    .maybeSingle();
  if (!existing) {
    const { data: post } = await getPostForAgent({ agentProfileId, postId });
    return { data: { deleted: false, post }, error: null };
  }
  const { error } = await supabaseAdmin
    .from('lfg_join_requests')
    .delete()
    .eq('id', existing.id);
  if (error) return { data: null, error };
  const { data: post } = await getPostForAgent({ agentProfileId, postId });
  return { data: { deleted: true, post }, error: null };
};

const updateRequestForAgent = async ({ agentProfileId, requestId, status }) => {
  if (status !== 'approved' && status !== 'rejected') {
    return { data: null, error: { status: 400, code: 'invalid_status', message: 'status must be approved or rejected' } };
  }
  const { data: req } = await supabaseAdmin
    .from('lfg_join_requests')
    .select('id, lfg_post_id, post:lfg_post_id(creator_id)')
    .eq('id', requestId)
    .maybeSingle();
  if (!req) return { data: null, error: { status: 404, code: 'not_found', message: 'Request not found' } };
  if (req.post?.creator_id !== agentProfileId) {
    return { data: null, error: { status: 403, code: 'not_host', message: 'Only the host can update requests on this post' } };
  }
  const { data, error } = await updateJoinRequest(requestId, status, req.lfg_post_id);
  if (error) return { data: null, error };
  const { data: post } = await getPostForAgent({ agentProfileId, postId: req.lfg_post_id });
  return { data: { request: data, post }, error: null };
};

const listEligibleCharactersForAgent = async ({ agentProfileId }) => {
  const { data, error } = await supabaseAdmin
    .from('characters')
    .select('id, name, class, level')
    .eq('creator_id', agentProfileId)
    .eq('is_deceased', false)
    .order('name', { ascending: true });
  if (error) return { data: null, error };
  return {
    data: (data || []).map((c) => ({ id: c.id, name: c.name, class_name: c.class, level: c.level })),
    error: null
  };
};

module.exports = {
  fetchProfileById,
  getLfgPosts,
  getLfgPostsByCreator,
  getLfgPostsByOthers,
  getLfgJoinedPosts,
  getLfgPost,
  createLfgPost,
  updateLfgPost,
  deleteLfgPost,
  closeLfgPost,
  joinLfgPost,
  getLfgJoinRequests,
  getLfgJoinRequestForUserAndPost,
  updateJoinRequest,
  deleteJoinRequest,
  getPendingJoinRequestCount,
  listPostsForAgent,
  getPostForAgent,
  createForAgent,
  updateForAgent,
  closeForAgent,
  deleteForAgent,
  joinForAgent,
  leaveForAgent,
  updateRequestForAgent,
  listEligibleCharactersForAgent
};
