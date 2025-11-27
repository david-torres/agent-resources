const { supabase } = require('./_base');
const { statList } = require('../util/enclave-consts');
const moment = require('moment-timezone');
moment.tz.setDefault('UTC');

const getLfgPosts = async () => {
  const { data, error } = await supabase
    .from('lfg_posts')
    .select('*')
    .eq('is_public', true)
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  for (let post of data) {
    const { data: creator, error: creatorError } = await supabase.from('profiles').select('*').eq('id', post.creator_id).single();
    post.creator_name = creator.name;
    post.creator_is_public = creator.is_public;

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
  for (let post of data) {
    const { data: creator, error: creatorError } = await supabase.from('profiles').select('*').eq('id', post.creator_id).single();
    post.creator_name = creator.name;
    post.creator_is_public = creator.is_public;

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
  for (let post of data) {
    const { data: creator, error: creatorError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', post.creator_id)
      .single();
    post.creator_name = creator.name;
    post.creator_is_public = creator.is_public;

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

const getLfgPost = async (id) => {
  const { data, error } = await supabase
    .from('lfg_posts')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return { data, error };

  let post = data;
  const { data: creator, error: creatorError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', post.creator_id)
    .single();
  post.creator_name = creator.name;
  post.creator_is_public = creator.is_public;

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

  const characterId = postReq.character;
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

  const { data: post, error } = await supabase.from('lfg_posts').insert(postReq).select();

  if (postReq.character) {
    const { data: lfgRequest, error: lfgRequestError } = await getLfgJoinRequestForUserAndPost(profile.id, post.id);

    if (lfgRequest) {
      const { data: deleteRequest, error: deleteRequestError } = await deleteJoinRequest(lfgRequest.id);
      if (deleteRequestError) return { data: null, error: deleteRequestError };
    }

    const { data: lfgJoin, error: lfgJoinError } = await joinLfgPost(post.id, profile.id, 'player', character);
    if (lfgJoinError) return { data: null, error: lfgJoinError };

    const { data: joinRequest, error: joinRequestError } = await updateJoinRequest(lfgJoin[0].id, 'approved');
    if (joinRequestError) return { data: null, error: joinRequestError };
  }

  return { data: post, error };
}

const updateLfgPost = async (id, postReq, profile) => {
  const { data: post, error: postError } = await getLfgPost(id);
  if (post.creator_id != profile.id) return { data: null, error: 'Unauthorized' };
  if (postReq.character) {
    const { data: lfgRequest, error: lfgRequestError } = await getLfgJoinRequestForUserAndPost(profile.id, id);

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

  const creatorName = post.creator_name;
  const hostName = post.host_name;
  delete post.creator_name;
  delete post.host_name;
  delete post.join_requests;

  delete postReq.creator_name;
  delete postReq.host_name;
  delete postReq.join_requests;
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

  const { data, error } = await supabase.from('lfg_posts').update({ ...post, ...postReq }).eq('id', id).eq('creator_id', profile.id).select();

  return { data: data.pop(), error };
}

const deleteLfgPost = async (id, profile) => {
  const { data: post, error: postError } = await getLfgPost(id);
  if (postError) return { data: null, error: postError };
  if (post.creator_id != profile.id) return { data: null, error: 'Unauthorized' };

  const { data, error } = await supabase.from('lfg_posts').delete().eq('id', id).eq('creator_id', profile.id);
  return { data, error };
}

const joinLfgPost = async (postId, profileId, joinType, characterId = null) => {
  if (joinType == 'player' && !characterId) return { data: null, error: 'Character is required for player join' };
  if (joinType == 'player') {
    const { data: character, error: characterError } = await supabase.from('characters').select('*').eq('id', characterId).single();
    if (characterError) return { data: null, error: characterError };
  }
  if (joinType == 'conduit') characterId = null;

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
      profile:profile_id (id,name,is_public),
      character:character_id (id,name,is_public)
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
    post.creator_is_public = creator.is_public;

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
  deleteJoinRequest
};
