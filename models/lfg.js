const { supabase, supabaseAdmin } = require('./_base');
const { statList } = require('../util/enclave-consts');
const moment = require('moment-timezone');
moment.tz.setDefault('UTC');

const fetchProfileById = async (profileId) => {
  if (!profileId) return { profile: null, error: null };
  const { data, error } = await supabase.from('profiles').select('*').eq('id', profileId).single();
  if (error && error.code !== 'PGRST116') return { profile: null, error };
  return { profile: data || null, error: null };
};

const assignCreatorMeta = (post, creator) => {
  post.creator_name = creator?.name || 'Unknown Agent';
  post.creator_is_public = Boolean(creator?.is_public);
};

const getLfgPosts = async () => {
  const { data, error } = await supabase
    .from('lfg_posts')
    .select('*')
    .eq('is_public', true)
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (error || !data) return { data, error };
  for (let post of data) {
    const { profile: creator, error: creatorError } = await fetchProfileById(post.creator_id);
    if (creatorError) return { data: null, error: creatorError };
    assignCreatorMeta(post, creator);

    const { data: host, error: hostError } = await supabase.from('profiles').select('*').eq('id', post.host_id).single();
    if (!hostError) {
      post.host_name = host.name;
      post.host_is_public = host.is_public;
    }

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id);
    if (joinRequestsError) return { data, error: joinRequestsError };
    post.join_requests = joinRequests;
  }
  return { data, error };
}

const getLfgPostsByOthers = async (profileId) => {
  const today = moment().startOf('day').toISOString();
  const { data, error } = await supabase
    .from('lfg_posts')
    .select('*')
    .neq('creator_id', profileId)
    .eq('is_public', true)
    .eq('status', 'open')
    .gte('date', today)
    .order('created_at', { ascending: false });
  if (error || !data) return { data, error };
  for (let post of data) {
    const { profile: creator, error: creatorError } = await fetchProfileById(post.creator_id);
    if (creatorError) return { data: null, error: creatorError };
    assignCreatorMeta(post, creator);

    const { data: host, error: hostError } = await supabase.from('profiles').select('*').eq('id', post.host_id).single();
    if (!hostError) {
      post.host_name = host.name;
      post.host_is_public = host.is_public;
    }

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id);
    if (joinRequestsError) return { data, error: joinRequestsError };
    post.join_requests = joinRequests;
  }
  return { data, error };
}

const getLfgPostsByCreator = async (creator_id) => {
  const { data, error } = await supabase
    .from('lfg_posts')
    .select('*')
    .eq('creator_id', creator_id)
    .order('created_at', { ascending: false });
  if (error || !data) return { data, error };
  for (let post of data) {
    const { profile: creator, error: creatorError } = await fetchProfileById(post.creator_id);
    if (creatorError) return { data: null, error: creatorError };
    assignCreatorMeta(post, creator);

    const { data: host, error: hostError } = await supabase.from('profiles').select('*').eq('id', post.host_id).single();
    if (!hostError) {
      post.host_name = host.name;
      post.host_is_public = host.is_public;
    }

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id);
    if (joinRequestsError) return { data, error: joinRequestsError };
    post.join_requests = joinRequests;
    post.pending_request_count = (joinRequests || []).filter(r => r.status === 'pending').length;
  }
  return { data, error };
}

const getLfgPost = async (id) => {
  const { data, error } = await supabase
    .from('lfg_posts')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return { data, error };

  let post = data;
  const { profile: creator, error: creatorError } = await fetchProfileById(post.creator_id);
  if (creatorError) return { data: null, error: creatorError };
  assignCreatorMeta(post, creator);

  const { data: host, error: hostError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', post.host_id)
    .single();
  if (!hostError) {
    post.host_name = host.name;
    post.host_is_public = host.is_public;
  }

  const { data: joinRequests, error: joinRequestsError } = await supabase
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

    const { data: joinRows, error: joinErr } = await joinLfgPost(post.id, profile.id, 'player', characterId);
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
    const { data: joinRows, error: joinErr } = await joinLfgPost(id, profile.id, 'player', characterId);
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

const joinLfgPost = async (postId, profileId, joinType, characterId = null) => {
  if (joinType == 'player' && !characterId) return { data: null, error: 'Character is required for player join' };
  if (joinType == 'player') {
    const { data: character, error: characterError } = await supabase.from('characters').select('*').eq('id', characterId).single();
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

const getLfgJoinRequests = async (postId) => {
  const { data, error } = await supabase
    .from('lfg_join_requests')
    .select(`
      *,
      profile:profile_id (id,name,is_public),
      character:character_id (id,name,is_public,is_deceased)
    `)
    .eq('lfg_post_id', postId);
  return { data, error };
}

const getLfgJoinRequestForUserAndPost = async (profileId, postId) => {
  const { data, error } = await supabase
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

const getLfgJoinedPosts = async (profileId) => {
  const { data, error } = await supabase
    .from('lfg_join_requests')
    .select(`
      *,
      lfg_posts:lfg_post_id (*)
    `)
    .eq('profile_id', profileId);

  if (error) return { data: null, error };

  const joinedPosts = data.map(request => request.lfg_posts);

  for (let post of joinedPosts) {
    const { profile: creator, error: creatorError } = await fetchProfileById(post.creator_id);
    if (creatorError) return { data: null, error: creatorError };
    assignCreatorMeta(post, creator);

    const { data: host, error: hostError } = await supabase.from('profiles').select('*').eq('id', post.host_id).single();
    if (!hostError) {
      post.host_name = host.name;
      post.host_is_public = host.is_public;
    }

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id);
    if (joinRequestsError) return { data: null, error: joinRequestsError };
    post.join_requests = joinRequests;
  }

  return { data: joinedPosts, error: null };
}

const getPendingJoinRequestCount = async (profileId) => {
  const { count, error } = await supabase
    .from('lfg_join_requests')
    .select('*, lfg_posts!inner(creator_id)', { count: 'exact', head: true })
    .eq('lfg_posts.creator_id', profileId)
    .eq('status', 'pending');
  return { count: count || 0, error };
}

module.exports = {
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
  getPendingJoinRequestCount
};
