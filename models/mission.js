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
  // Check if profile can edit this mission (creator, host, or editor)
  const canEdit = await canEditMission(id, profile);
  if (!canEdit) {
    return { data: null, error: 'Unauthorized: You do not have permission to edit this mission' };
  }

  const { data, error } = await supabase
    .from('missions')
    .update(missionData)
    .eq('id', id)
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

const setUnregisteredCharacterNames = async (missionId, names, profile) => {
  // Filter and clean names
  const cleanedNames = (Array.isArray(names) ? names : [])
    .map(n => (typeof n === 'string' ? n.trim() : ''))
    .filter(n => n.length > 0);
  
  const { data, error } = await supabase
    .from('missions')
    .update({ unregistered_character_names: cleanedNames })
    .eq('id', missionId)
    .eq('creator_id', profile.id)
    .select();
  
  return { data, error };
}

const searchPublicMissions = async (q, count = 12, hasVideo = false, characterName = null, characterClass = null) => {
  try {
    // Determine pool size based on filters - fetch more if filtering in JS
    const needsJsFiltering = characterName || characterClass;
    const poolSize = needsJsFiltering ? Math.max(count * 5, 100) : count;

    let query = supabase
      .from('missions')
      .select(`
        id,
        name,
        date,
        outcome,
        summary,
        media_url,
        unregistered_character_names,
        characters:mission_characters(
          character:characters(
            id,
            name,
            class,
            is_deceased
          )
        )
      `)
      .eq('is_public', true)
      .order('date', { ascending: false })
      .limit(poolSize);

    if (q && q.trim().length > 0) {
      query = query.ilike('name', `%${q}%`);
    }

    if (hasVideo) {
      query = query.not('media_url', 'is', null).neq('media_url', '');
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
      return { data: null, error };
    }

    // Transform the nested data structure
    let transformedData = data.map(mission => ({
      ...mission,
      characters: mission.characters.map(mc => mc.character)
    }));

    // Filter by character class - filter missions that have at least one character with matching class
    if (characterClass && characterClass.trim().length > 0) {
      transformedData = transformedData.filter(mission => {
        return mission.characters.some(char => 
          char && char.class && char.class === characterClass
        );
      });
    }

    // Filter by character name (both registered and unregistered)
    if (characterName && characterName.trim().length > 0) {
      const searchTerm = characterName.trim().toLowerCase();
      transformedData = transformedData.filter(mission => {
        // Check registered characters
        const hasMatchingRegistered = mission.characters.some(char => 
          char && char.name && char.name.toLowerCase().includes(searchTerm)
        );
        
        // Check unregistered character names
        const hasMatchingUnregistered = Array.isArray(mission.unregistered_character_names) &&
          mission.unregistered_character_names.some(name => 
            name && name.toLowerCase().includes(searchTerm)
          );
        
        return hasMatchingRegistered || hasMatchingUnregistered;
      });
    }

    // Limit to requested count after filtering
    transformedData = transformedData.slice(0, count);

    return { data: transformedData, error: null };
  } catch (error) {
    console.error(error);
    return { data: null, error };
  }
}

const getRandomPublicMissions = async (count = 12, hasVideo = false, characterName = null, characterClass = null) => {
  try {
    // Fetch a reasonably sized pool, then sample client-side for randomness
    // Fetch more if filtering in JS
    const needsJsFiltering = characterName || characterClass;
    const poolSize = needsJsFiltering ? Math.max(count * 10, 200) : Math.max(Math.min(count * 5, 100), count);

    let query = supabase
      .from('missions')
      .select(`
        id,
        name,
        date,
        outcome,
        summary,
        media_url,
        unregistered_character_names,
        characters:mission_characters(
          character:characters(
            id,
            name,
            class,
            is_deceased
          )
        )
      `)
      .eq('is_public', true)
      .order('date', { ascending: false })
      .limit(poolSize);

    if (hasVideo) {
      query = query.not('media_url', 'is', null).neq('media_url', '');
    }

    const { data, error } = await query;

    if (error) {
      console.error(error);
      return { data: null, error };
    }

    // Transform the nested data structure
    let transformedData = data.map(mission => ({
      ...mission,
      characters: mission.characters.map(mc => mc.character)
    }));

    // Filter by character class - filter missions that have at least one character with matching class
    if (characterClass && characterClass.trim().length > 0) {
      transformedData = transformedData.filter(mission => {
        return mission.characters.some(char => 
          char && char.class && char.class === characterClass
        );
      });
    }

    // Filter by character name (both registered and unregistered)
    if (characterName && characterName.trim().length > 0) {
      const searchTerm = characterName.trim().toLowerCase();
      transformedData = transformedData.filter(mission => {
        // Check registered characters
        const hasMatchingRegistered = mission.characters.some(char => 
          char && char.name && char.name.toLowerCase().includes(searchTerm)
        );
        
        // Check unregistered character names
        const hasMatchingUnregistered = Array.isArray(mission.unregistered_character_names) &&
          mission.unregistered_character_names.some(name => 
            name && name.toLowerCase().includes(searchTerm)
          );
        
        return hasMatchingRegistered || hasMatchingUnregistered;
      });
    }

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

// ============================================
// Editor Management Functions
// ============================================

/**
 * Get all editors for a mission
 */
const getMissionEditors = async (missionId) => {
  const { data, error } = await supabase
    .from('mission_editors')
    .select(`
      profile_id,
      added_by,
      added_at,
      profile:profiles!mission_editors_profile_id_fkey(
        id,
        name,
        image_url
      ),
      added_by_profile:profiles!mission_editors_added_by_fkey(
        id,
        name
      )
    `)
    .eq('mission_id', missionId);
  
  if (error) {
    console.error(error);
    return { data: null, error };
  }

  // Transform to a cleaner structure
  const editors = data.map(e => ({
    profile_id: e.profile_id,
    name: e.profile?.name,
    image_url: e.profile?.image_url,
    added_by: e.added_by,
    added_by_name: e.added_by_profile?.name,
    added_at: e.added_at
  }));

  return { data: editors, error: null };
};

/**
 * Add an editor to a mission
 */
const addMissionEditor = async (missionId, profileId, addedBy) => {
  const { data, error } = await supabase
    .from('mission_editors')
    .upsert({
      mission_id: missionId,
      profile_id: profileId,
      added_by: addedBy
    })
    .select();
  return { data, error };
};

/**
 * Remove an editor from a mission
 */
const removeMissionEditor = async (missionId, profileId) => {
  const { data, error } = await supabase
    .from('mission_editors')
    .delete()
    .eq('mission_id', missionId)
    .eq('profile_id', profileId);
  return { data, error };
};

/**
 * Check if a profile can edit a mission
 * Returns true if profile is creator, host, or an editor
 */
const canEditMission = async (missionId, profile) => {
  if (!profile || !profile.id) return false;

  // First check if user is creator or host
  const { data: mission, error: missionError } = await supabase
    .from('missions')
    .select('creator_id, host_id')
    .eq('id', missionId)
    .single();

  if (missionError || !mission) return false;

  if (mission.creator_id === profile.id || mission.host_id === profile.id) {
    return true;
  }

  // Check if user is an editor
  const { data: editor, error: editorError } = await supabase
    .from('mission_editors')
    .select('profile_id')
    .eq('mission_id', missionId)
    .eq('profile_id', profile.id)
    .single();

  if (editorError && editorError.code !== 'PGRST116') {
    console.error(editorError);
    return false;
  }

  return !!editor;
};

/**
 * Check if a profile is the creator of a mission
 */
const isCreator = async (missionId, profile) => {
  if (!profile || !profile.id) return false;

  const { data: mission, error } = await supabase
    .from('missions')
    .select('creator_id')
    .eq('id', missionId)
    .single();

  if (error || !mission) return false;
  return mission.creator_id === profile.id;
};

/**
 * Get missions where profile is an editor (but not creator)
 */
const getEditableMissions = async (profile) => {
  const { data, error } = await supabase
    .from('mission_editors')
    .select(`
      mission:missions(
        id,
        name,
        date,
        outcome,
        is_public,
        creator_id,
        characters:mission_characters(
          character:characters(
            id,
            name,
            is_deceased
          )
        )
      )
    `)
    .eq('profile_id', profile.id);

  if (error) {
    console.error(error);
    return { data: null, error };
  }

  // Transform and filter out null missions
  const missions = data
    .filter(d => d.mission !== null)
    .map(d => ({
      ...d.mission,
      characters: d.mission.characters.map(mc => mc.character)
    }));

  return { data: missions, error: null };
};

// ============================================
// Similar Mission Search (for deduplication)
// ============================================

/**
 * Search for potentially similar/duplicate missions
 * Searches by date proximity and name similarity
 */
const searchSimilarMissions = async (date, name, excludeId = null, daysRange = 3) => {
  try {
    const targetDate = new Date(date);
    const startDate = new Date(targetDate);
    startDate.setDate(startDate.getDate() - daysRange);
    const endDate = new Date(targetDate);
    endDate.setDate(endDate.getDate() + daysRange);

    let query = supabase
      .from('missions')
      .select(`
        id,
        name,
        date,
        outcome,
        summary,
        is_public,
        creator_id,
        creator:profiles!missions_creator_id_fkey(
          id,
          name
        ),
        characters:mission_characters(
          character:characters(
            id,
            name,
            is_deceased
          )
        )
      `)
      .gte('date', startDate.toISOString())
      .lte('date', endDate.toISOString())
      .order('date', { ascending: false })
      .limit(20);

    if (excludeId) {
      query = query.neq('id', excludeId);
    }

    const { data, error } = await query;

    if (error) {
      console.error(error);
      return { data: null, error };
    }

    // Transform data
    let missions = data.map(mission => ({
      ...mission,
      creator_name: mission.creator?.name,
      characters: mission.characters.map(mc => mc.character)
    }));

    // If name provided, filter and score by name similarity
    if (name && name.trim().length > 0) {
      const searchName = name.trim().toLowerCase();
      missions = missions
        .map(m => {
          const missionName = (m.name || '').toLowerCase();
          // Simple similarity: check for common words or substring match
          const searchWords = searchName.split(/\s+/).filter(w => w.length > 2);
          const missionWords = missionName.split(/\s+/).filter(w => w.length > 2);
          
          let score = 0;
          // Exact match
          if (missionName === searchName) score = 100;
          // Contains match
          else if (missionName.includes(searchName) || searchName.includes(missionName)) score = 80;
          // Word overlap
          else {
            const commonWords = searchWords.filter(w => missionWords.some(mw => mw.includes(w) || w.includes(mw)));
            score = (commonWords.length / Math.max(searchWords.length, 1)) * 60;
          }
          
          return { ...m, similarityScore: score };
        })
        .filter(m => m.similarityScore > 20)
        .sort((a, b) => b.similarityScore - a.similarityScore);
    }

    return { data: missions, error: null };
  } catch (error) {
    console.error(error);
    return { data: null, error };
  }
};

// ============================================
// Mission Merge Functions
// ============================================

/**
 * Merge two missions into one (primary absorbs secondary)
 * - Combines characters from both missions
 * - Concatenates summaries
 * - Uses earlier date
 * - Merges unregistered character names
 * - Adds editors from secondary to primary
 * - Deletes secondary mission
 */
const mergeMissions = async (primaryId, secondaryId, profile) => {
  try {
    // Verify profile can edit both missions
    const canEditPrimary = await canEditMission(primaryId, profile);
    const canEditSecondary = await canEditMission(secondaryId, profile);

    if (!canEditPrimary || !canEditSecondary) {
      return { data: null, error: 'Unauthorized: You must be able to edit both missions to merge them' };
    }

    // Fetch both missions with full data
    const [{ data: primary, error: primaryError }, { data: secondary, error: secondaryError }] = await Promise.all([
      getMission(primaryId),
      getMission(secondaryId)
    ]);

    if (primaryError || !primary) {
      return { data: null, error: primaryError || 'Primary mission not found' };
    }
    if (secondaryError || !secondary) {
      return { data: null, error: secondaryError || 'Secondary mission not found' };
    }

    // Determine merged values
    const earlierDate = new Date(primary.date) <= new Date(secondary.date) ? primary.date : secondary.date;
    
    // Combine summaries if both exist
    let mergedSummary = primary.summary || '';
    if (secondary.summary && secondary.summary.trim()) {
      if (mergedSummary) {
        mergedSummary += '\n\n---\n\n' + secondary.summary;
      } else {
        mergedSummary = secondary.summary;
      }
    }

    // Merge unregistered character names (union, deduplicated)
    const primaryUnreg = Array.isArray(primary.unregistered_character_names) ? primary.unregistered_character_names : [];
    const secondaryUnreg = Array.isArray(secondary.unregistered_character_names) ? secondary.unregistered_character_names : [];
    const mergedUnregistered = [...new Set([...primaryUnreg, ...secondaryUnreg])];

    // Update primary mission
    const { error: updateError } = await supabase
      .from('missions')
      .update({
        date: earlierDate,
        summary: mergedSummary || null,
        unregistered_character_names: mergedUnregistered,
        // Keep media_url from primary if it exists, otherwise use secondary's
        media_url: primary.media_url || secondary.media_url || null
      })
      .eq('id', primaryId);

    if (updateError) {
      console.error(updateError);
      return { data: null, error: updateError };
    }

    // Move characters from secondary to primary (ignore conflicts)
    const { data: secondaryChars } = await getMissionCharacters(secondaryId);
    if (secondaryChars && secondaryChars.length > 0) {
      for (const char of secondaryChars) {
        await addCharacterToMission(primaryId, char.character_id);
      }
    }

    // Move editors from secondary to primary
    const { data: secondaryEditors } = await getMissionEditors(secondaryId);
    if (secondaryEditors && secondaryEditors.length > 0) {
      for (const editor of secondaryEditors) {
        await addMissionEditor(primaryId, editor.profile_id, profile.id);
      }
    }

    // Add secondary's creator as editor on primary (if not already)
    if (secondary.creator_id && secondary.creator_id !== primary.creator_id) {
      await addMissionEditor(primaryId, secondary.creator_id, profile.id);
    }

    // Delete secondary mission
    const { error: deleteError } = await supabase
      .from('missions')
      .delete()
      .eq('id', secondaryId);

    if (deleteError) {
      console.error('Warning: Failed to delete secondary mission after merge:', deleteError);
      // Don't fail the whole operation, merge was successful
    }

    // Return updated primary mission
    return await getMission(primaryId);
  } catch (error) {
    console.error(error);
    return { data: null, error };
  }
};

/**
 * Preview what a merge would look like without actually performing it
 */
const previewMergeMissions = async (primaryId, secondaryId) => {
  try {
    const [{ data: primary }, { data: secondary }] = await Promise.all([
      getMission(primaryId),
      getMission(secondaryId)
    ]);

    if (!primary || !secondary) {
      return { data: null, error: 'One or both missions not found' };
    }

    // Build preview
    const earlierDate = new Date(primary.date) <= new Date(secondary.date) ? primary.date : secondary.date;
    
    let mergedSummary = primary.summary || '';
    if (secondary.summary && secondary.summary.trim()) {
      if (mergedSummary) {
        mergedSummary += '\n\n---\n\n' + secondary.summary;
      } else {
        mergedSummary = secondary.summary;
      }
    }

    const primaryUnreg = Array.isArray(primary.unregistered_character_names) ? primary.unregistered_character_names : [];
    const secondaryUnreg = Array.isArray(secondary.unregistered_character_names) ? secondary.unregistered_character_names : [];
    
    // Combine characters (deduplicated by id)
    const allChars = [...primary.characters];
    for (const char of secondary.characters) {
      if (!allChars.some(c => c.id === char.id)) {
        allChars.push(char);
      }
    }

    const preview = {
      primary,
      secondary,
      merged: {
        name: primary.name,
        date: earlierDate,
        outcome: primary.outcome,
        summary: mergedSummary || null,
        media_url: primary.media_url || secondary.media_url || null,
        characters: allChars,
        unregistered_character_names: [...new Set([...primaryUnreg, ...secondaryUnreg])]
      }
    };

    return { data: preview, error: null };
  } catch (error) {
    console.error(error);
    return { data: null, error };
  }
};

module.exports = {
  getMissions,
  getMission,
  createMission,
  updateMission,
  deleteMission,
  addCharacterToMission,
  removeCharacterFromMission,
  getMissionCharacters,
  setUnregisteredCharacterNames,
  getOwnMissions,
  searchPublicMissions,
  getRandomPublicMissions,
  // Editor management
  getMissionEditors,
  addMissionEditor,
  removeMissionEditor,
  canEditMission,
  isCreator,
  getEditableMissions,
  // Similar/duplicate search
  searchSimilarMissions,
  // Merge functions
  mergeMissions,
  previewMergeMissions
};
