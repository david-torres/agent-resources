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

  // Profile exists - check if user has any class unlocks, grant starter unlocks if missing
  if (data && user.confirmed_at) {
    const { data: unlockData, error: unlockError } = await supabase
      .from('class_unlocks')
      .select('class_id')
      .eq('user_id', user.id)
      .limit(1);

    // If no unlocks exist, grant starter unlocks (handles existing profiles created before feature)
    if (!unlockError && (!unlockData || unlockData.length === 0)) {
      await grantStarterUnlocks(user.id, data.id);
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

  // Grant rules PDF unlock using SECURITY DEFINER function (bypasses RLS)
  const rulesResult = await supabase.rpc('grant_starter_rules_unlock', {
    p_user_id: userId,
    p_profile_id: profileId,
    p_rules_pdf_id: STARTER_RULES_PDF_ID,
    p_expires_at: expiresAtISO
  });

  if (rulesResult.error) {
    console.error('Failed to grant starter rules unlock:', rulesResult.error);
  }

  // Grant class unlocks using SECURITY DEFINER function (bypasses RLS)
  const classResult = await supabase.rpc('grant_starter_class_unlocks', {
    p_user_id: userId,
    p_class_ids: STARTER_CLASS_IDS,
    p_expires_at: expiresAtISO
  });

  if (classResult.error) {
    console.error('Failed to grant starter class unlocks:', classResult.error);
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

module.exports = {
  getProfile,
  getProfileById,
  getProfileByName,
  createProfile,
  updateUser,
  setDiscordId
};