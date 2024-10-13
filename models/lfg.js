const { supabase } = require('./_base');
const { getProfile } = require('./profile');
const moment = require('moment-timezone');
moment.tz.setDefault('UTC');

const getLfgPosts = async () => {
  const { data, error } = await supabase.from('lfg_posts').select('*').eq('is_public', true).eq('status', 'open').order('created_at', { ascending: false });
  for (let post of data) {
    const { data: creator, error: creatorError } = await supabase.from('profiles').select('*').eq('id', post.creator_id).single();
    post.creator_name = creator.name;

    const { data: host, error: hostError } = await supabase.from('profiles').select('*').eq('id', post.host_id).single();
    if (!hostError) post.host_name = host.name;

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id);
    if (joinRequestsError) return { data, error: joinRequestsError };
    post.join_requests = joinRequests;
  }
  return { data, error };
}

const getLfgPostsByOthers = async (profileId) => {
  const { data, error } = await supabase.from('lfg_posts').select('*').neq('creator_id', profileId).eq('is_public', true).eq('status', 'open').order('created_at', { ascending: false });
  for (let post of data) {
    const { data: creator, error: creatorError } = await supabase.from('profiles').select('*').eq('id', post.creator_id).single();
    post.creator_name = creator.name;

    const { data: host, error: hostError } = await supabase.from('profiles').select('*').eq('id', post.host_id).single();
    if (!hostError) post.host_name = host.name;

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id);
    if (joinRequestsError) return { data, error: joinRequestsError };
    post.join_requests = joinRequests;
  }
  return { data, error };
}

const getLfgPostsByCreator = async (creator_id) => {
  const { data, error } = await supabase.from('lfg_posts').select('*').eq('creator_id', creator_id).order('created_at', { ascending: false });
  for (let post of data) {
    const { data: creator, error: creatorError } = await supabase.from('profiles').select('*').eq('id', post.creator_id).single();
    post.creator_name = creator.name;

    const { data: host, error: hostError } = await supabase.from('profiles').select('*').eq('id', post.host_id).single();
    if (!hostError) post.host_name = host.name;

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id);
    if (joinRequestsError) return { data, error: joinRequestsError };
    post.join_requests = joinRequests;
  }
  return { data, error };
}

const getLfgPost = async (id) => {
  const { data, error } = await supabase.from('lfg_posts').select('*').eq('id', id).single();
  if (error) return { data, error };

  let post = data;
  const { data: creator, error: creatorError } = await supabase.from('profiles').select('*').eq('id', post.creator_id).single();
  post.creator_name = creator.name;

  const { data: host, error: hostError } = await supabase.from('profiles').select('*').eq('id', post.host_id).single();
  if (!hostError) post.host_name = host.name;

  const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(id);
  if (joinRequestsError) return { data: post, error: joinRequestsError };
  post.join_requests = joinRequests;

  return { data: post, error };
}

const createLfgPost = async (postReq, user) => {
  const profile = await getProfile(user);
  postReq.creator_id = profile.id;

  if (postReq.character) {
    const { data: lfgRequest, error: lfgRequestError } = await getLfgJoinRequestByPostIdAndProfileId(id, profile.id);

    if (lfgRequest) {
      const { data: deleteRequest, error: deleteRequestError } = await deleteJoinRequest(lfgRequest.id);
      if (deleteRequestError) return { data: null, error: deleteRequestError };
    }

    const { data: lfgJoin, error: lfgJoinError } = await joinLfgPost(id, profile.id, 'player', postReq.character);
    if (lfgJoinError) return { data: null, error: lfgJoinError };

    const { data: joinRequest, error: joinRequestError } = await updateJoinRequest(lfgJoin[0].id, 'approved');
    if (joinRequestError) return { data: null, error: joinRequestError };
  }
  delete postReq.character;

  if (postReq.host_id == 'on') {
    postReq.host_id = profile.id;
  } else {
    postReq.host_id = null;
  }
  if (postReq.is_public == 'on') {
    postReq.is_public = true;
  } else {
    postReq.is_public = false;
  }

  // make sure the date is in UTC
  postReq.date = moment.tz(postReq.date, profile.timezone).utc();

  const { data, error } = await supabase.from('lfg_posts').insert(postReq).select();
  return { data, error };
}

const updateLfgPost = async (id, postReq, user) => {
  const profile = await getProfile(user);
  const { data: post, error: postError } = await getLfgPost(id);
  if (post.creator_id != profile.id) return { data: null, error: 'Unauthorized' };
  if (postReq.character) {
    const { data: lfgRequest, error: lfgRequestError } = await getLfgJoinRequestByPostIdAndProfileId(id, profile.id);

    if (lfgRequest) {
      const { data: deleteRequest, error: deleteRequestError } = await deleteJoinRequest(lfgRequest.id);
      if (deleteRequestError) return { data: null, error: deleteRequestError };
    }

    const { data: lfgJoin, error: lfgJoinError } = await joinLfgPost(id, profile.id, 'player', postReq.character);
    if (lfgJoinError) return { data: null, error: lfgJoinError };

    const { data: joinRequest, error: joinRequestError } = await updateJoinRequest(lfgJoin[0].id, 'approved');
    if (joinRequestError) return { data: null, error: joinRequestError };
  }
  delete postReq.character;

  delete post.creator_name;
  delete post.host_name;
  delete post.join_requests;

  if (postReq.host_id == 'on') {
    postReq.host_id = profile.id;
  } else {
    postReq.host_id = null;
  }

  if (postReq.is_public == 'on') {
    postReq.is_public = true;
  } else {
    postReq.is_public = false;
  }

  // make sure the date is in UTC
  postReq.date = moment.tz(postReq.date, profile.timezone).utc();

  const { data, error } = await supabase.from('lfg_posts').update({ ...post, ...postReq }).eq('id', id).eq('creator_id', profile.id);
  return { data, error };
}

const deleteLfgPost = async (id, user) => {
  const profile = await getProfile(user);
  const { data: post, error: postError } = await getLfgPost(id);
  if (postError) return { data: null, error: postError };
  if (post.creator_id != profile.id) return { data: null, error: 'Unauthorized' };

  const { data, error } = await supabase.from('lfg_posts').delete().eq('id', id).eq('creator_id', profile.id);
  return { data, error };
}

const joinLfgPost = async (postId, profileId, joinType, characterId = null) => {
  const joinRequest = {
    lfg_post_id: postId,
    profile_id: profileId,
    join_type: joinType,
    character_id: characterId,
    status: 'pending'
  };

  const { data, error } = await supabase.from('lfg_join_requests').insert(joinRequest).select();
  return { data, error };
}

const getLfgJoinRequests = async (postId) => {
  const { data, error } = await supabase
    .from('lfg_join_requests')
    .select(`
      *,
      profiles:profile_id (name),
      characters:character_id (name)
    `)
    .eq('lfg_post_id', postId);
  return { data, error };
}

const getLfgJoinRequestByPostIdAndProfileId = async (postId, profileId) => {
  const { data, error } = await supabase
    .from('lfg_join_requests')
    .select('*')
    .eq('lfg_post_id', postId)
    .eq('profile_id', profileId)
    .single();
  return { data, error };
}

const updateJoinRequest = async (requestId, status) => {
  const { data, error } = await supabase
    .from('lfg_join_requests')
    .update({ status })
    .eq('id', requestId);
  return { data, error };
}

const deleteJoinRequest = async (requestId) => {
  const { data, error } = await supabase
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
    const { data: creator, error: creatorError } = await supabase.from('profiles').select('*').eq('id', post.creator_id).single();
    post.creator_name = creator.name;

    const { data: host, error: hostError } = await supabase.from('profiles').select('*').eq('id', post.host_id).single();
    if (!hostError) post.host_name = host.name;

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id);
    if (joinRequestsError) return { data: null, error: joinRequestsError };
    post.join_requests = joinRequests;
  }

  return { data: joinedPosts, error: null };
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
  getLfgJoinRequestByPostIdAndProfileId,
  updateJoinRequest,
  deleteJoinRequest
};
