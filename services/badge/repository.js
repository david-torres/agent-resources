const { supabaseAdmin } = require('../../models/_base');

const BADGES_BUCKET = process.env.SUPABASE_BADGES_BUCKET || 'badges';

// The only consumer of supabaseAdmin for the badge domain. Holds every
// privileged (service-role) query verbatim; models/badge.js keeps the
// surrounding logic (counter math, milestone gating, display-shelf shaping).
const withResult = async (query) => {
  const { data, error } = await query;
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error: null };
};

module.exports = {
  BADGES_BUCKET,

  // Reads
  // Counters deliberately use supabaseAdmin: private missions count toward
  // badges, and the shared anon client (no JWT) would be RLS-filtered.
  countMissionsPlayed: (profileId) => withResult(
    supabaseAdmin
      .from('mission_characters')
      .select('mission_id, characters!inner(creator_id)')
      .eq('characters.creator_id', profileId)
  ),
  countMissionsHosted: (profileId) => withResult(
    supabaseAdmin.from('missions').select('id').eq('host_id', profileId)
  ),
  // Shared by milestone recalc (id/track/threshold) and the profile-badges
  // progress shelf (track/threshold/name) — one active-milestone-catalog
  // projection serves both call sites.
  fetchActiveMilestoneBadges: () => withResult(
    supabaseAdmin
      .from('badges')
      .select('id, track, threshold, name')
      .eq('category', 'milestone')
      .eq('is_active', true)
      .order('threshold', { ascending: true })
  ),
  // All profiles affected by a mission: host + creators of attached
  // characters. Used by delete/merge hooks, which must capture this BEFORE
  // the mutation.
  fetchMissionHostId: (missionId) => withResult(
    supabaseAdmin.from('missions').select('host_id').eq('id', missionId).maybeSingle()
  ),
  fetchMissionCharacterCreators: (missionId) => withResult(
    supabaseAdmin
      .from('mission_characters')
      .select('character:characters(creator_id)')
      .eq('mission_id', missionId)
  ),
  publicBadgeImageUrl: (imagePath) =>
    supabaseAdmin.storage.from(BADGES_BUCKET).getPublicUrl(imagePath).data.publicUrl,
  listProfileBadgeRows: (profileId) => withResult(
    supabaseAdmin
      .from('profile_badges')
      .select('awarded_at, granted_by, badge:badges(id, slug, name, description, category, track, rank, threshold, image_path, is_active)')
      .eq('profile_id', profileId)
      .order('awarded_at', { ascending: true })
  ),
  fetchBadgeCatalog: () => withResult(
    supabaseAdmin
      .from('badges')
      .select('*')
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('track', { ascending: true })
      .order('rank', { ascending: true })
      .order('name', { ascending: true })
  ),
  // Authz-support read for grant/revoke: the authoritative gate (milestone
  // category / inactive / unknown slug) is applied by the caller against
  // this row, not here.
  fetchGrantableBadgeBySlug: (slug) => withResult(
    supabaseAdmin.from('badges').select('id, slug, category, is_active').eq('slug', slug).maybeSingle()
  ),

  // Writes
  // Insert-only: badges are permanent once earned. ignoreDuplicates keeps
  // the original awarded_at (and any granted_by) on re-runs — backfill and
  // live hooks share this single code path so retroactive and ongoing
  // awards cannot drift.
  upsertProfileBadges: (rows) => withResult(
    supabaseAdmin
      .from('profile_badges')
      .upsert(rows, { onConflict: 'profile_id,badge_id', ignoreDuplicates: true })
  ),
  upsertGrantedBadge: (row) => withResult(
    supabaseAdmin
      .from('profile_badges')
      .upsert(row, { onConflict: 'profile_id,badge_id', ignoreDuplicates: true })
  ),
  deleteProfileBadge: async ({ profileId, badgeId }) => {
    const { error } = await supabaseAdmin
      .from('profile_badges')
      .delete()
      .eq('profile_id', profileId)
      .eq('badge_id', badgeId);
    if (error) console.error(error);
    return { error: error || null };
  }
};
