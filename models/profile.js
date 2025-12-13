const { supabase } = require('./_base');

const PROFILE_NOT_FOUND_ERROR = 'PGRST116';

// Starter content IDs - Advent v1 rules and base 6 classes
const STARTER_RULES_PDF_ID = 'a10948ac-5f78-481f-9e53-c582b59926cd'; // Enclave: Advent v1
const STARTER_CLASS_IDS = [
  'b6ce893b-8207-4f89-abfc-a02ae0e9b65d', // Gunslinger
  '018fcdba-39cf-4cc8-8f4d-92e2023719cf', // Illusionist
  'f0de4397-5e71-4ed6-a16a-26dc72c46801', // Librarian
  'aa0f9690-37a6-4784-9119-1b2117f798a7', // Thane
  'a605940b-f27f-45d8-af76-abda848b3e12', // Thunderbird
  'ebd55f52-9768-400a-94d6-392cd07e2b24', // Wanderer
];
const STARTER_UNLOCK_DAYS = 30;

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

  if (!error && data && data.length > 0) {
    // Grant starter unlocks (30-day trial) for new accounts
    const profile = data[0];
    await grantStarterUnlocks(user_id, profile.id);
  }

  return { data, error };
}

const grantStarterUnlocks = async (userId, profileId) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + STARTER_UNLOCK_DAYS);
  const expiresAtISO = expiresAt.toISOString();

  // Grant rules PDF unlock
  try {
    await supabase
      .from('rules_pdf_unlocks')
      .insert({
        user_id: userId,
        profile_id: profileId,
        rules_pdf_id: STARTER_RULES_PDF_ID,
        expires_at: expiresAtISO
      });
  } catch (err) {
    console.error('Failed to grant starter rules unlock:', err);
  }

  // Grant class unlocks
  const classUnlocks = STARTER_CLASS_IDS.map(classId => ({
    user_id: userId,
    class_id: classId,
    expires_at: expiresAtISO
  }));

  try {
    await supabase
      .from('class_unlocks')
      .insert(classUnlocks);
  } catch (err) {
    console.error('Failed to grant starter class unlocks:', err);
  }
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

/**
 * Search for profiles by name (for adding editors, etc.)
 */
const searchProfiles = async (query, limit = 10) => {
  if (!query || query.trim().length < 2) {
    return { data: [], error: null };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, image_url')
    .ilike('name', `%${query}%`)
    .limit(limit);

  return { data, error };
}

module.exports = {
  getProfile,
  getProfileById,
  getProfileByName,
  createProfile,
  updateUser,
  setDiscordId,
  searchProfiles
};