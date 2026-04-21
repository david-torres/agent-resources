const { supabase, supabaseAdmin } = require('./_base');
const { sanitizeUrlFields } = require('../util/url');
const { escapeLikePattern } = require('../util/validate');

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

const getMission = async (id, client = supabase) => {
  const { data, error } = await client
    .from('missions')
    .select(`
      *,
      characters:mission_characters(
        character:characters(
          id,
          name,
          is_deceased
        )
      ),
      host:profiles!missions_host_id_fkey(
        id,
        name
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

const getOwnMissions = async (profile, client = supabase) => {
  const { data, error } = await client
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
  sanitizeUrlFields(missionData, ['media_url']);
  const { data, error } = await supabaseAdmin.from('missions').insert(missionData).select();
  return { data, error };
};

const updateMission = async (id, missionData, profile) => {
  // Check if profile can edit this mission (creator, host, or editor)
  const canEdit = await canEditMission(id, profile);
  if (!canEdit) {
    return { data: null, error: 'Unauthorized: You do not have permission to edit this mission' };
  }

  sanitizeUrlFields(missionData, ['media_url']);

  const { data, error } = await supabaseAdmin
    .from('missions')
    .update(missionData)
    .eq('id', id)
    .select();
  return { data, error };
};

const deleteMission = async (id, profile) => {
  const { data, error } = await supabaseAdmin
    .from('missions')
    .delete()
    .eq('id', id)
    .eq('creator_id', profile.id);
  return { data, error };
};

const addCharacterToMission = async (missionId, characterId) => {
  const { data, error } = await supabaseAdmin
    .from('mission_characters')
    .upsert({ mission_id: missionId, character_id: characterId })
    .select();
  return { data, error };
};

const removeCharacterFromMission = async (missionId, characterId) => {
  const { data, error } = await supabaseAdmin
    .from('mission_characters')
    .delete()
    .eq('mission_id', missionId)
    .eq('character_id', characterId);
  return { data, error };
};

const getMissionCharacters = async (missionId, client = supabase) => {
  const { data, error } = await client
    .from('mission_characters')
    .select('character_id')
    .eq('mission_id', missionId);
  return { data, error };
}

const setUnregisteredCharacterNames = async (missionId, names, profile) => {
  // Check if profile can edit this mission (creator, host, or editor)
  const canEdit = await canEditMission(missionId, profile);
  if (!canEdit) {
    return { data: null, error: 'Unauthorized: You do not have permission to edit this mission' };
  }

  // Filter and clean names
  const cleanedNames = (Array.isArray(names) ? names : [])
    .map(n => (typeof n === 'string' ? n.trim() : ''))
    .filter(n => n.length > 0);
  
  const { data, error } = await supabaseAdmin
    .from('missions')
    .update({ unregistered_character_names: cleanedNames })
    .eq('id', missionId)
    .select();
  
  return { data, error };
}

const searchPublicMissions = async (q, count = 12, hasVideo = false, characterName = null, characterClass = null, conduitName = null) => {
  try {
    // Determine pool size based on filters - fetch more if filtering in JS
    const needsJsFiltering = characterName || characterClass || conduitName;
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
        host_name,
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
      query = query.ilike('name', `%${escapeLikePattern(q)}%`);
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

    // Filter by conduit name
    if (conduitName && conduitName.trim().length > 0) {
      const searchTerm = conduitName.trim().toLowerCase();
      transformedData = transformedData.filter(mission =>
        mission.host_name && mission.host_name.toLowerCase().includes(searchTerm)
      );
    }

    // Limit to requested count after filtering
    transformedData = transformedData.slice(0, count);

    return { data: transformedData, error: null };
  } catch (error) {
    console.error(error);
    return { data: null, error };
  }
}

const getRandomPublicMissions = async (count = 12, hasVideo = false, characterName = null, characterClass = null, conduitName = null) => {
  try {
    // Fetch a reasonably sized pool, then sample client-side for randomness
    // Fetch more if filtering in JS
    const needsJsFiltering = characterName || characterClass || conduitName;
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
        host_name,
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

    // Filter by conduit name
    if (conduitName && conduitName.trim().length > 0) {
      const searchTerm = conduitName.trim().toLowerCase();
      transformedData = transformedData.filter(mission =>
        mission.host_name && mission.host_name.toLowerCase().includes(searchTerm)
      );
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
 * Get all editors for a mission (excluding creator and host)
 */
const getMissionEditors = async (missionId, client = supabase) => {
  // First get the mission to know creator_id and host_id
  const { data: mission, error: missionError } = await client
    .from('missions')
    .select('creator_id, host_id')
    .eq('id', missionId)
    .single();

  if (missionError) {
    console.error(missionError);
    return { data: null, error: missionError };
  }

  const { data, error } = await client
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

  // Transform to a cleaner structure and filter out creator/host
  const editors = data
    .filter(e => {
      // Exclude creator and host from editor list (they're already editors by default)
      return e.profile_id !== mission.creator_id && 
             e.profile_id !== mission.host_id;
    })
    .map(e => ({
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
  const { data, error } = await supabaseAdmin
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
  const { data, error } = await supabaseAdmin
    .from('mission_editors')
    .delete()
    .eq('mission_id', missionId)
    .eq('profile_id', profileId);
  return { data, error };
};

/**
 * Check if a profile can edit a mission
 * Returns true if profile is creator, host, or an editor
 *
 * Uses supabaseAdmin to bypass RLS — this is a permission check in
 * application code, not a data-visibility read. Without admin, the
 * anon client (no JWT) would fail-closed for private missions and
 * lock creators out of their own mission edit pages.
 */
const canEditMission = async (missionId, profile) => {
  if (!profile || !profile.id) return false;

  // First check if user is creator or host
  const { data: mission, error: missionError } = await supabaseAdmin
    .from('missions')
    .select('creator_id, host_id')
    .eq('id', missionId)
    .single();

  if (missionError || !mission) {
    console.error('Error checking mission permissions:', missionError);
    return false;
  }

  // Check if user is creator or host
  if (mission.creator_id === profile.id || (mission.host_id && mission.host_id === profile.id)) {
    return true;
  }

  // Check if user is an editor
  const { data: editor, error: editorError } = await supabaseAdmin
    .from('mission_editors')
    .select('profile_id')
    .eq('mission_id', missionId)
    .eq('profile_id', profile.id)
    .single();

  if (editorError && editorError.code !== 'PGRST116') {
    // PGRST116 is "not found" which is fine - means user is not an editor
    // Other errors are logged but don't necessarily mean no access
    if (editorError.code !== 'PGRST116') {
      console.error('Error checking editor permissions:', editorError);
    }
    return false;
  }

  return !!editor;
};

/**
 * Check if a profile is the creator of a mission.
 * Uses supabaseAdmin for the same reason as canEditMission.
 */
const isCreator = async (missionId, profile) => {
  if (!profile || !profile.id) return false;

  const { data: mission, error } = await supabaseAdmin
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
const getEditableMissions = async (profile, client = supabase) => {
  const { data, error } = await client
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
const searchSimilarMissions = async (date, name, excludeId = null, daysRange = 3, client = supabase) => {
  try {
    const targetDate = new Date(date);
    const startDate = new Date(targetDate);
    startDate.setDate(startDate.getDate() - daysRange);
    const endDate = new Date(targetDate);
    endDate.setDate(endDate.getDate() + daysRange);

    let query = client
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
  const [canPrimary, canSecondary] = await Promise.all([
    canEditMission(primaryId, profile),
    canEditMission(secondaryId, profile)
  ]);
  if (!canPrimary || !canSecondary) {
    return { data: null, error: 'You must be able to edit both missions to merge them' };
  }

  const { error } = await supabaseAdmin.rpc('merge_missions', {
    primary_id: primaryId,
    secondary_id: secondaryId,
    actor_profile_id: profile.id
  });
  if (error) {
    console.error('merge_missions RPC failed:', error);
    return { data: null, error };
  }

  return await getMission(primaryId);
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
