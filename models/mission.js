const { supabase } = require('./_base');

const getMissions = async () => {
  const { data, error } = await supabase
    .from('missions')
    .select(`
      *,
      characters:mission_characters(
        character:characters(
          id,
          name
        )
      )
    `)
    .order('date', { ascending: false });
  
  if (error) return { data: null, error };
  
  // Transform the nested data structure
  const transformedData = data.map(mission => ({
    ...mission,
    characters: mission.characters.map(mc => mc.character)
  }));
  
  return { data: transformedData, error };
};

const getMission = async (id) => {
  const { data, error } = await supabase
    .from('missions')
    .select(`
      *,
      characters:mission_characters(
        character:characters(
          id,
          name
        )
      )
    `)
    .eq('id', id)
    .single();
  
  if (error) return { data: null, error };
  
  // Transform the nested data structure
  const transformedData = {
    ...data,
    characters: data.characters.map(mc => mc.character)
  };
  
  return { data: transformedData, error };
};

const getOwnMissions = async (profile) => {
  const { data, error } = await supabase
    .from('missions')
    .select(`
      *,
      characters:mission_characters(
        character:characters(
          id,
          name
        )
      )
    `)
    .eq('creator_id', profile.id)
    .order('date', { ascending: false });
  
  if (error) return { data: null, error };
  
  // Transform the nested data structure
  const transformedData = data.map(mission => ({
    ...mission,
    characters: mission.characters.map(mc => mc.character)
  }));
  
  return { data: transformedData, error };
}

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
    .upsert({ mission_id: missionId, character_id: characterId })
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

const getMissionCharacters = async (missionId) => {
  const { data, error } = await supabase
    .from('mission_characters')
    .select('character_id')
    .eq('mission_id', missionId);
  return { data, error };
}

module.exports = {
  getMissions,
  getMission,
  createMission,
  updateMission,
  deleteMission,
  addCharacterToMission,
  removeCharacterFromMission,
  getMissionCharacters,
  getOwnMissions
};
