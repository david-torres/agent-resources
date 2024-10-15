const { supabase } = require('./_base');

const getMissions = async () => {
  const { data, error } = await supabase.from('missions').select('*').order('date', { ascending: false });
  return { data, error };
};

const getMission = async (id) => {
  const { data, error } = await supabase.from('missions').select('*').eq('id', id).single();
  return { data, error };
};

const createMission = async (missionData, profile) => {
  missionData.creator_id = profile.id;
  const { data, error } = await supabase.from('missions').insert(missionData).select();
  return { data, error };
};

const updateMission = async (id, missionData, profile) => {
  const { data, error } = await supabase
    .from('missions')
    .update(missionData)
    .eq('id', id)
    .eq('creator_id', profile.id)
    .select();
  return { data, error };
};

const deleteMission = async (id, profile) => {
  const { data, error } = await supabase
    .from('missions')
    .delete()
    .eq('id', id)
    .eq('creator_id', profile.id);
  return { data, error };
};

const addCharacterToMission = async (missionId, characterId) => {
  const { data, error } = await supabase
    .from('mission_characters')
    .insert({ mission_id: missionId, character_id: characterId })
    .select();
  return { data, error };
};

const removeCharacterFromMission = async (missionId, characterId) => {
  const { data, error } = await supabase
    .from('mission_characters')
    .delete()
    .eq('mission_id', missionId)
    .eq('character_id', characterId);
  return { data, error };
};

module.exports = {
  getMissions,
  getMission,
  createMission,
  updateMission,
  deleteMission,
  addCharacterToMission,
  removeCharacterFromMission,
};
