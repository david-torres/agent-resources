const { supabase } = require('./_base');
const { getUser } = require('./auth');

const getProfile = async () => {
  const user = await getUser();
  if (!user) {
    throw new Error('User not found');
  }

  const { data, error } = await supabase.from('profiles').select('*').eq('user_id', user.id).single();
  if (error) {
    console.error(error);
    throw new Error(error);
  }

  return data;
}

const createProfile = async (user_id) => {
  const user = await getUser();
  const { data, error } = await supabase.from('profiles').insert({ user_id: user.id });
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

module.exports = {
  getProfile,
  createProfile,
  updateUser
};