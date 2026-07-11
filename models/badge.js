const { BadgeService } = require('../services/badge/service');
const badgeRepository = require('../services/badge/repository');

const { BADGES_BUCKET } = badgeRepository;

const MILESTONE_TRACKS = ['newcomer', 'veteran_player', 'veteran_conduit'];

const badgeService = new BadgeService(badgeRepository);

// Counters deliberately route through the repository's privileged client:
// private missions count toward badges, and the shared anon client (no JWT)
// would be RLS-filtered.
const getMissionCounters = async (profileId) => {
  const { data: playedRows, error: playedError } = await badgeRepository.countMissionsPlayed(profileId);
  if (playedError) return { data: null, error: playedError };

  const { data: hostedRows, error: hostedError } = await badgeRepository.countMissionsHosted(profileId);
  if (hostedError) return { data: null, error: hostedError };

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
//
// System-by-construction: no user authorization exists for milestone
// recalc (it is milestone-only, insert-only), so this never routes through
// badgeService — it calls the repository directly, mirroring services/rules.
const recalculateMilestoneBadges = async (profileId) => {
  const { data: counters, error: countersError } = await getMissionCounters(profileId);
  if (countersError) return { data: null, error: countersError };

  const { data: catalog, error: catalogError } = await badgeRepository.fetchActiveMilestoneBadges();
  if (catalogError) return { data: null, error: catalogError };

  const earned = (catalog || []).filter(b =>
    b.track && Number.isFinite(b.threshold) && b.threshold <= counterForTrack(counters, b.track)
  );
  if (earned.length === 0) {
    return { data: { awarded: 0, counters }, error: null };
  }

  const rows = earned.map(b => ({ profile_id: profileId, badge_id: b.id }));
  const { error: upsertError } = await badgeRepository.upsertProfileBadges(rows);
  if (upsertError) return { data: null, error: upsertError };
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
      badgeRepository.fetchMissionHostId(missionId),
      badgeRepository.fetchMissionCharacterCreators(missionId)
    ]);
    const ids = (rows || []).map(r => r.character?.creator_id);
    if (mission?.host_id) ids.push(mission.host_id);
    return [...new Set(ids.filter(Boolean))];
  } catch (e) {
    console.error(`Failed to collect profiles for mission ${missionId}:`, e);
    return [];
  }
};

const badgeImageUrl = (imagePath) => badgeRepository.publicBadgeImageUrl(imagePath);

const TRACK_LABELS = {
  newcomer: 'Newcomer',
  veteran_player: 'Veteran Player',
  veteran_conduit: 'Veteran Conduit'
};

// Every active badge a profile holds, flat (admin manage page; also the
// basis for the public display shelf).
const listProfileBadges = async (profileId) => {
  const { data: rows, error } = await badgeRepository.listProfileBadgeRows(profileId);
  if (error) return { data: null, error };
  const held = (rows || [])
    .filter(r => r.badge && r.badge.is_active)
    .map(r => ({
      ...r.badge,
      awarded_at: r.awarded_at,
      granted_by: r.granted_by,
      image_url: badgeImageUrl(r.badge.image_path)
    }));
  return { data: held, error: null };
};

// Display shelf: highest earned rank per milestone track + all event/personal
// badges. With includeProgress, also returns per-track counters and the next
// unearned threshold (own-profile view).
const getProfileBadges = async (profileId, { includeProgress = false } = {}) => {
  const { data: held, error } = await listProfileBadges(profileId);
  if (error) return { data: null, error };

  const bestByTrack = {};
  const others = [];
  for (const b of held) {
    if (b.category === 'milestone' && b.track) {
      if (!bestByTrack[b.track] || b.rank > bestByTrack[b.track].rank) {
        bestByTrack[b.track] = b;
      }
    } else {
      others.push(b);
    }
  }
  const display = [
    ...MILESTONE_TRACKS.map(t => bestByTrack[t]).filter(Boolean),
    ...others
  ];

  if (!includeProgress) {
    return { data: { display }, error: null };
  }

  const { data: counters, error: countersError } = await getMissionCounters(profileId);
  if (countersError) {
    // Progress is decoration; degrade to display-only rather than failing.
    return { data: { display }, error: null };
  }

  const { data: catalog, error: catalogError } = await badgeRepository.fetchActiveMilestoneBadges();
  if (catalogError) {
    return { data: { display }, error: null };
  }

  const progress = MILESTONE_TRACKS.map(track => {
    const count = counterForTrack(counters, track);
    const next = (catalog || []).find(b => b.track === track && b.threshold > count) || null;
    return {
      track,
      label: TRACK_LABELS[track],
      count,
      currentSlug: bestByTrack[track]?.slug ?? null,
      nextName: next?.name ?? null,
      nextThreshold: next?.threshold ?? null,
      complete: !next
    };
  });

  return {
    data: { display, progress, veteranBaseUrl: badgeImageUrl('veteran-base.png') },
    error: null
  };
};

const getBadgeCatalog = async () => {
  const { data, error } = await badgeRepository.fetchBadgeCatalog();
  if (error) return { data: null, error };
  return { data: (data || []).map(b => ({ ...b, image_url: badgeImageUrl(b.image_path) })), error: null };
};

// authz: admin-only (badgeService enforces via canGrantBadge; throws
// AuthorizationError on denial). The milestone-category/inactive guard is
// the authoritative gate, enforced inside the service, not just the routes.
const grantBadge = async (actor, { profileId, badgeSlug, grantedById }) =>
  badgeService.grantBadge(actor, { profileId, badgeSlug, grantedById });

// authz: admin-only (badgeService enforces via canRevokeBadge). Revoking a
// badge the profile doesn't hold deletes 0 rows — no-op success.
const revokeBadge = async (actor, { profileId, badgeSlug }) =>
  badgeService.revokeBadge(actor, { profileId, badgeSlug });

module.exports = {
  BADGES_BUCKET,
  MILESTONE_TRACKS,
  getMissionCounters,
  recalculateMilestoneBadges,
  recalcMilestoneBadgesSafely,
  getMissionProfileIds,
  listProfileBadges,
  getProfileBadges,
  getBadgeCatalog,
  grantBadge,
  revokeBadge
};
