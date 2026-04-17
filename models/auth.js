const { supabase } = require('./_base');

const getUserFromToken = async (authToken) => {
  if (!authToken) return false;
  const { data, error } = await supabase.auth.getUser(authToken);
  if (error || !data?.user) {
    console.error(error);
    return false;
  }
  return data.user;
};

module.exports = {
  getUserFromToken
};
