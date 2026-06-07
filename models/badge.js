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

module.exports = {
  BADGES_BUCKET,
  MILESTONE_TRACKS,
  getMissionCounters
};
