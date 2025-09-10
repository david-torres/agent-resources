const { supabase } = require('./_base');

const PROFILE_NOT_FOUND_ERROR = 'PGRST116';

const getProfile = async (user) => {
  if (!user) {
    throw new Error('User not found');
  }

  const { data, error } = await supabase.from('profiles').select('*').eq('user_id', user.id).single();
  if (error) {
    if (PROFILE_NOT_FOUND_ERROR === error.code) {
      if (user.confirmed_at) {
        const { data, error } = await createProfile(user.id);
        if (error) {
          console.error(error);
          return false;
        } else {
          return data;
        }
      } else {
        return false;
      }
    }
  }

  return data;
}

const getProfileById = async (id) => {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single();
  return { data, error };
}

const getProfileByName = async (name) => {
  const { data, error } = await supabase.from('profiles').select('*').eq('name', name).single();
  return { data, error };
}

const createProfile = async (user_id) => {
  const { data, error } = await supabase
    .from('profiles')
    .insert({ user_id, name: `Agent #${user_id}`, role: 'user' })
    .select();
  return { data, error };
}

const updateUser = async (email, password, profile) => {
  if (password === '') password = null;
  const { data, error } = await supabase.auth.updateUser({ email, password });
  if (error) return { data, error };

  const user = data.user;
  const { data: profileData, error: profileError } = await supabase.from('profiles').update(profile).eq('user_id', user.id);
  return { data: profileData, error: profileError };
}

const setDiscordId = async (user_id, discord_id, discord_email = null) => {
  const { data, error } = await supabase
    .from('profiles')
    .update({ discord_id, discord_email })
    .eq('user_id', user_id)
    .select();
  return { data, error };
}

module.exports = {
  getProfile,
  getProfileById,
  getProfileByName,
  createProfile,
  updateUser,
  setDiscordId
};