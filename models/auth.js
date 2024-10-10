const { supabase } = require('./_base');

const getUserFromToken = async (authToken, refreshToken) => {
  const { data, error } = await supabase.auth.getUser(authToken);
  
  if (error) {
    console.error(error);
    return false;
  }

  if (data) {
    const {data:sessionData, error:sessionError } = await supabase.auth.setSession({ access_token: authToken, refresh_token: refreshToken });
    if (sessionError) {
      console.error(sessionError);
      return false;
    }

    return data.user;
  }
}

module.exports = {
  getUserFromToken
};