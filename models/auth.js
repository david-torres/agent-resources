const { supabase } = require('./_base');

const getUserFromToken = async (authToken, refreshToken) => {
  const { data, error } = await supabase.auth.getUser(authToken);

  if (error || !data?.user) {
    console.error(error);
    return false;
  }

  try {
    if (authToken && refreshToken) {
      await supabase.auth.setSession({ access_token: authToken, refresh_token: refreshToken });
    }
  } catch (sessionError) {
    console.warn('setSession failed; continuing with valid user', sessionError?.message || sessionError);
  }

  return data.user;
}

module.exports = {
  getUserFromToken
};