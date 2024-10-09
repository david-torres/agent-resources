const { supabase } = require('./_base');

let user;

const getUserFromToken = async (authToken, refreshToken) => {
  const { data, error } = await supabase.auth.getUser(authToken);
  
  if (error) {
    console.error(error);
    return false;
  }

  if (data) {
    user = data.user;

    const {data:sessionData, error:sessionError } = await supabase.auth.setSession({ access_token: authToken, refresh_token: refreshToken });
    if (sessionError) {
      console.error(sessionError);
      user = null;
      return false;
    }

    return user;
  }
}

const getUser = async () => {
  return user;
}

const clearUser = () => {
  user = null;
  return true;
}

module.exports = {
  getUserFromToken,
  clearUser,
  getUser
};