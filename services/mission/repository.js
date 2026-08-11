const { supabaseAdmin } = require('../../models/_base');

// The only consumer of supabaseAdmin for the mission domain. Holds every
// privileged (service-role) query verbatim; models/mission.js keeps the
// surrounding logic (transforms, search, badge orchestration via the service).
const withResult = async (query) => {
  const { data, error } = await query;
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error: null };
};

module.exports = {
  // Verbatim from the former inline adapter in models/mission.js.
  getHost: id => supabaseAdmin.from('missions').select('host_id').eq('id', id).maybeSingle(),
  createMissionRow: data => supabaseAdmin.from('missions').insert(data).select(),
  updateMissionRow: (id, data) => supabaseAdmin.from('missions').update(data).eq('id', id).select(),
  deleteMissionRow: (id, creatorId) => supabaseAdmin
    .from('missions').delete().eq('id', id).eq('creator_id', creatorId),
  getCharacterCreator: id => supabaseAdmin
    .from('characters').select('creator_id').eq('id', id).maybeSingle(),
  upsertMissionCharacter: (missionId, characterId) => supabaseAdmin
    .from('mission_characters').upsert({ mission_id: missionId, character_id: characterId }).select(),
  deleteMissionCharacter: (missionId, characterId) => supabaseAdmin
    .from('mission_characters').delete().eq('mission_id', missionId).eq('character_id', characterId),
  mergeMissions: (primaryId, secondaryId, actorId) => supabaseAdmin.rpc('merge_missions', {
    primary_id: primaryId, secondary_id: secondaryId, actor_profile_id: actorId
  }),

  // New: privileged reads/writes used by the policy-gated capabilities.
  updateUnregisteredNames: (missionId, names) => withResult(
    supabaseAdmin.from('missions').update({ unregistered_character_names: names }).eq('id', missionId).select()
  ),
  upsertEditor: (row) => withResult(
    supabaseAdmin.from('mission_editors').upsert(row).select()
  ),
  deleteEditor: async ({ missionId, profileId }) => {
    const { error } = await supabaseAdmin
      .from('mission_editors')
      .delete()
      .eq('mission_id', missionId)
      .eq('profile_id', profileId);
    if (error) {
      console.error(error);
      return { error };
    }
    return { error: null };
  },
  // Permission checks use supabaseAdmin to bypass RLS — this is a decision
  // read for application-level authorization, not a data-visibility read.
  // Without admin, the anon client (no JWT) would fail-closed for private
  // missions and lock creators out of their own mission edit pages.
  fetchMissionPermissionRow: (missionId) => withResult(
    supabaseAdmin.from('missions').select('creator_id, host_id').eq('id', missionId).single()
  ),
  fetchCreatorId: (missionId) => withResult(
    supabaseAdmin.from('missions').select('creator_id').eq('id', missionId).single()
  ),
  fetchEditorRow: async ({ missionId, profileId }) => {
    const { data, error } = await supabaseAdmin
      .from('mission_editors')
      .select('profile_id')
      .eq('mission_id', missionId)
      .eq('profile_id', profileId)
      .single();
    if (error) {
      // PGRST116 is "no rows" — not being an editor is a normal outcome, not a failure.
      if (error.code === 'PGRST116') return { data: null, error: null };
      console.error(error);
      return { data: null, error };
    }
    return { data, error: null };
  }
};
