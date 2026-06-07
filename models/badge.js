const { supabase, supabaseAdmin } = require('./_base');

const BADGES_BUCKET = process.env.SUPABASE_BADGES_BUCKET || 'badges';

const MILESTONE_TRACKS = ['newcomer', 'veteran_player', 'veteran_conduit'];

// Counters deliberately use supabaseAdmin: private missions count toward
// badges, and the shared anon client (no JWT) would be RLS-filtered.
const getMissionCounters = async (profileId) => {
  const { data: playedRows, error: playedError } = await supabaseAdmin
    .from('mission_characters')
    .select('mission_id, characters!inner(creator_id)')
    .eq('characters.creator_id', profileId);
  if (playedError) {
    console.error(playedError);
    return { data: null, error: playedError };
  }

  const { data: hostedRows, error: hostedError } = await supabaseAdmin
    .from('missions')
    .select('id')
    .eq('host_id', profileId);
  if (hostedError) {
    console.error(hostedError);
    return { data: null, error: hostedError };
  }

  const playedIds = new Set((playedRows || []).map(r => r.mission_id));
  const hostedIds = new Set((hostedRows || []).map(r => r.id));
  const newcomerIds = new Set([...playedIds, ...hostedIds]);

  return {
    data: {
      newcomer: newcomerIds.size,
      player: playedIds.size,
      conduit: hostedIds.size
    },
    error: null
  };
};

const counterForTrack = (counters, track) => {
  if (track === 'newcomer') return counters.newcomer;
  if (track === 'veteran_player') return counters.player;
  if (track === 'veteran_conduit') return counters.conduit;
  return 0;
};

// Insert-only: badges are permanent once earned. ignoreDuplicates keeps the
// original awarded_at (and any granted_by) on re-runs — backfill and live
// hooks share this single code path so retroactive and ongoing awards
// cannot drift.
const recalculateMilestoneBadges = async (profileId) => {
  const { data: counters, error: countersError } = await getMissionCounters(profileId);
  if (countersError) return { data: null, error: countersError };

  const { data: catalog, error: catalogError } = await supabaseAdmin
    .from('badges')
    .select('id, track, threshold')
    .eq('category', 'milestone')
    .eq('is_active', true);
  if (catalogError) {
    console.error(catalogError);
    return { data: null, error: catalogError };
  }

  const earned = (catalog || []).filter(b =>
    b.track && Number.isFinite(b.threshold) && b.threshold <= counterForTrack(counters, b.track)
  );
  if (earned.length === 0) {
    return { data: { awarded: 0, counters }, error: null };
  }

  const rows = earned.map(b => ({ profile_id: profileId, badge_id: b.id }));
  const { error: upsertError } = await supabaseAdmin
    .from('profile_badges')
    .upsert(rows, { onConflict: 'profile_id,badge_id', ignoreDuplicates: true });
  if (upsertError) {
    console.error(upsertError);
    return { data: null, error: upsertError };
  }
  return { data: { awarded: earned.length, counters }, error: null };
};

// Hook entry point for mission mutations: never throws and never fails the
// caller. A missed/failed recalc self-heals on the next recalc or backfill.
const recalcMilestoneBadgesSafely = async (profileIds) => {
  const unique = [...new Set((profileIds || []).filter(Boolean))];
  for (const profileId of unique) {
    try {
      const { error } = await recalculateMilestoneBadges(profileId);
      if (error) console.error(`Badge recalc failed for profile ${profileId}:`, error);
    } catch (e) {
      console.error(`Badge recalc failed for profile ${profileId}:`, e);
    }
  }
};

// All profiles affected by a mission: host + creators of attached characters.
// Used by delete/merge hooks, which must capture this BEFORE the mutation.
const getMissionProfileIds = async (missionId) => {
  if (!missionId) return [];
  try {
    const [{ data: mission }, { data: rows }] = await Promise.all([
      supabaseAdmin.from('missions').select('host_id').eq('id', missionId).maybeSingle(),
      supabaseAdmin.from('mission_characters').select('character:characters(creator_id)').eq('mission_id', missionId)
    ]);
    const ids = (rows || []).map(r => r.character?.creator_id);
    if (mission?.host_id) ids.push(mission.host_id);
    return [...new Set(ids.filter(Boolean))];
  } catch (e) {
    console.error(`Failed to collect profiles for mission ${missionId}:`, e);
    return [];
  }
};

module.exports = {
  BADGES_BUCKET,
  MILESTONE_TRACKS,
  getMissionCounters,
  recalculateMilestoneBadges,
  recalcMilestoneBadgesSafely,
  getMissionProfileIds
};
