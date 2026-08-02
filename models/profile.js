const { supabase } = require('./_base');
const { escapeLikePattern } = require('../util/validate');
const { SYSTEM_ACTOR } = require('../util/actor');
const { ProfileService } = require('../services/profile/service');
const profileRepository = require('../services/profile/repository');
const { STARTER_RULES_PDF_ID, STARTER_CLASS_UNLOCKS } = require('../util/starter-content');

const PROFILE_NOT_FOUND_ERROR = 'PGRST116';

// Starter content IDs - Advent v1 rules and base 6 classes
const STARTER_CLASS_IDS = Object.values(STARTER_CLASS_UNLOCKS);
const STARTER_UNLOCK_DAYS = 30;

const profileService = new ProfileService(profileRepository);

const getProfile = async (user) => {
  if (!user) {
    throw new Error('User not found');
  }

  // authz: self-read; user.id comes from the verified auth session (see util/auth.js isAuthenticated)
  const { data, error } = await profileRepository.fetchOwnProfile(user.id);

  if (error) {
    if (PROFILE_NOT_FOUND_ERROR === error.code) {
      if (user.confirmed_at) {
        const { data, error } = await provisionProfile(SYSTEM_ACTOR, user);
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
    const { data: unlockData, error: unlockError } = await profileRepository.fetchStarterUnlockRows(user.id);

    // If no unlocks exist, grant starter unlocks (handles existing profiles created before feature)
    if (!unlockError && (!unlockData || unlockData.length === 0)) {
      await grantStarterUnlocks(user.id, data.id);
    }
  }

  return data;
}

const getProfileById = async (id, client = supabase) => {
  const { data, error } = await client.from('profiles').select('*').eq('id', id).single();
  return { data, error };
}

const getProfileByName = async (name) => {
  const { data, error } = await supabase.from('profiles').select('*').eq('name', name).single();
  return { data, error };
}

// Admin variants bypass RLS — only call from routes already gated by requireAdmin.
const getProfileByIdAdmin = async (id) => profileRepository.fetchProfileByIdAdmin(id);

const getProfileByNameAdmin = async (name) => profileRepository.fetchProfileByNameAdmin(name);

// Self-provisioning on first sign-in: inserts the profile row and grants the
// starter (trial) unlocks. `actor` gates the service's self-authz check;
// `user` is the just-verified auth user (only .id is used for the insert).
const provisionProfile = async (actor, user) => {
  const { data, error } = await profileService.createProfileForUser(actor, user);

  if (!error && data && data.length > 0) {
    const profile = data[0];
    await grantStarterUnlocks(user.id, profile.id);
  }

  return { data, error };
}

// Not route-triggered; kept for API compatibility with existing callers.
const createProfile = async (user_id) => provisionProfile(SYSTEM_ACTOR, { id: user_id });

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

// authz: self-write, enforced by profileService (throws AuthorizationError on
// denial); userId is the authenticated caller (res.locals.user.id).
const updateUser = async (actor, userId, email, password, profile) => profileService.updateUser(actor, userId, email, password, profile);

// authz: self-write, enforced by profileService; user_id is the authenticated
// caller's auth user id (passed from route res.locals.user.id).
const setDiscordId = async (actor, user_id, discord_id, discord_email = null) => profileService.setDiscordId(actor, user_id, discord_id, discord_email);

/**
 * Search for profiles by name (for adding editors, etc.)
 */
const searchProfiles = async (query, limit = 10) => {
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return { data: [], error: null };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, image_url')
    .ilike('name', `%${escapeLikePattern(query.trim())}%`)
    .limit(limit);

  return { data, error };
}

/**
 * Admin variant of searchProfiles: bypasses RLS so non-public profiles are
 * findable in admin tooling. Only call from requireAdmin-gated routes.
 */
const searchProfilesAdmin = async (query, limit = 10) => {
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return { data: [], error: null };
  }

  return profileRepository.searchProfilesAdmin(`%${escapeLikePattern(query.trim())}%`, limit);
}

const getProfileConduitCredits = async ({ profileId, supabase: client = supabase }) => {
  const { count: earnedCount, error: earnedError } = await client
    .from('missions')
    .select('*', { count: 'exact', head: true })
    .eq('host_id', profileId);
  if (earnedError) return { data: null, error: earnedError };

  const { count: spentLinkedCount, error: spentError } = await client
    .from('offscreen_missions')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', profileId)
    .not('source_mission_id', 'is', null);
  if (spentError) return { data: null, error: spentError };

  const earned = earnedCount || 0;
  const spent_linked = spentLinkedCount || 0;
  return {
    data: { earned, spent_linked, balance: earned - spent_linked },
    error: null
  };
};

module.exports = {
  getProfile,
  getProfileById,
  getProfileByName,
  getProfileByIdAdmin,
  getProfileByNameAdmin,
  createProfile,
  updateUser,
  setDiscordId,
  searchProfiles,
  searchProfilesAdmin,
  getProfileConduitCredits
};
