const { supabase } = require('./_base');
const { getProfile } = require('./profile');

const getLfgPosts = async () => {
  const { data, error } = await supabase.from('lfg_posts').select('*').eq('is_public', true).order('created_at', { ascending: false });
  for (let post of data) {
    const { data: creator, error: creatorError } = await supabase.from('profiles').select('*').eq('id', post.creator_id).single();
    post.creator_name = creator.name;

    const { data: host, error: hostError } = await supabase.from('profiles').select('*').eq('id', post.host_id).single();
    if (!hostError) post.host_name = host.name;
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
  }
  return { data, error };
}

const getLfgPost = async (id) => {
  const { data, error } = await supabase.from('lfg_posts').select('*').eq('id', id).single();
  let post = data;
  const { data: creator, error: creatorError } = await supabase.from('profiles').select('*').eq('id', post.creator_id).single();
  post.creator_name = creator.name;

  const { data: host, error: hostError } = await supabase.from('profiles').select('*').eq('id', post.host_id).single();
  if (!hostError) post.host_name = host.name;
  return { data: post, error };
}

const createLfgPost = async (post, user) => {
  const profile = await getProfile(user);
  post.creator_id = profile.id;
  const { data, error } = await supabase.from('lfg_posts').insert(post);
  return { data, error };
}

const updateLfgPost = async (id, postReq, user) => {
  const profile = await getProfile(user);
  const { data: post, error: postError } = await getLfgPost(id);
  if (post.creator_id != profile.id) return { data: null, error: 'Unauthorized' };

  delete post.creator_name;
  delete post.host_name;

  if (postReq.host_id == 'on') {
    postReq.host_id = profile.id;
  } else {
    postReq.host_id = null;
  }

  const { data, error } = await supabase.from('lfg_posts').update({ ...post, ...postReq }).eq('id', id).eq('creator_id', profile.id);
  return { data, error };
}

const deleteLfgPost = async (id, user) => {
  const profile = await getProfile(user);
  const { data: post, error: postError } = await getLfgPost(id);
  if (post.creator_id != profile.id) return { data: null, error: 'Unauthorized' };

  const { data, error } = await supabase.from('lfg_posts').delete().eq('id', id).eq('creator_id', profile.id);
  return { data, error };
}

module.exports = {
  getLfgPosts,
  getLfgPostsByCreator,
  getLfgPost,
  createLfgPost,
  updateLfgPost,
  deleteLfgPost
};