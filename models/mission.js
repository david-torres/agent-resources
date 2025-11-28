const { supabase } = require('./_base');

const getMissions = async () => {
  const { data, error } = await supabase
    .from('missions')
    .select(`
      *,
      characters:mission_characters(
        character:characters(
          id,
          name,
          is_deceased
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
          name,
          is_deceased
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
          name,
          is_deceased
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

const setUnknownCharacterNames = async (missionId, names, profile) => {
  // Filter and clean names
  const cleanedNames = (Array.isArray(names) ? names : [])
    .map(n => (typeof n === 'string' ? n.trim() : ''))
    .filter(n => n.length > 0);
  
  const { data, error } = await supabase
    .from('missions')
    .update({ unknown_character_names: cleanedNames })
    .eq('id', missionId)
    .eq('creator_id', profile.id)
    .select();
  
  return { data, error };
}

const searchPublicMissions = async (q, count = 12) => {
  try {
    let query = supabase
      .from('missions')
      .select(`
        id,
        name,
        date,
        outcome,
        summary,
        media_url,
        unknown_character_names,
        characters:mission_characters(
          character:characters(
            id,
            name,
            is_deceased
          )
        )
      `)
      .eq('is_public', true)
      .order('date', { ascending: false })
      .limit(count);

    if (q && q.trim().length > 0) {
      query = query.ilike('name', `%${q}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
      return { data: null, error };
    }

    // Transform the nested data structure
    const transformedData = data.map(mission => ({
      ...mission,
      characters: mission.characters.map(mc => mc.character)
    }));

    return { data: transformedData, error: null };
  } catch (error) {
    console.error(error);
    return { data: null, error };
  }
}

const getRandomPublicMissions = async (count = 12) => {
  try {
    // Fetch a reasonably sized pool, then sample client-side for randomness
    const poolSize = Math.max(Math.min(count * 5, 100), count);
    const { data, error } = await supabase
      .from('missions')
      .select(`
        id,
        name,
        date,
        outcome,
        summary,
        media_url,
        unknown_character_names,
        characters:mission_characters(
          character:characters(
            id,
            name,
            is_deceased
          )
        )
      `)
      .eq('is_public', true)
      .order('date', { ascending: false })
      .limit(poolSize);

    if (error) {
      console.error(error);
      return { data: null, error };
    }

    // Transform the nested data structure
    const transformedData = data.map(mission => ({
      ...mission,
      characters: mission.characters.map(mc => mc.character)
    }));

    if (!Array.isArray(transformedData) || transformedData.length <= count) {
      return { data: transformedData, error: null };
    }

    // Reservoir sample
    const sampled = [];
    for (let i = 0; i < transformedData.length; i++) {
      if (i < count) {
        sampled.push(transformedData[i]);
      } else {
        const j = Math.floor(Math.random() * (i + 1));
        if (j < count) {
          sampled[j] = transformedData[i];
        }
      }
    }
    return { data: sampled, error: null };
  } catch (error) {
    console.error(error);
    return { data: null, error };
  }
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
  setUnknownCharacterNames,
  getOwnMissions,
  searchPublicMissions,
  getRandomPublicMissions
};
