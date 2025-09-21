const { supabase } = require('./_base');
const { getClasses, getClass, buildClassContentLookupMaps } = require('./class');

const getOwnCharacters = async (profile) => {
  const { data, error } = await supabase.from('characters').select('*').eq('creator_id', profile.id);
  if (error) {
    console.error(error);
    return { data: null, error };
  }

  return { data, error };
}

const getPublicCharactersByCreator = async (creatorId) => {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, image_url')
    .eq('creator_id', creatorId)
    .eq('is_public', true)
    .order('name', { ascending: true });
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error };
}

const getCharacter = async (id) => {
  const { data, error } = await supabase.from('characters').select('*').eq('id', id).single();
  if (error) {
    console.error(error);
    return { data: null, error };
  }

  const { data: traits, error: traitsError } = await getCharacterTraits(id);
  if (traitsError) {
    console.error(traitsError);
    return { data: null, error: traitsError };
  }
  data.traits = traits.map(trait => trait.name);

  const { data: gear, error: gearError } = await getCharacterGear(id);
  if (gearError) {
    console.error(gearError);
    return { data: null, error: gearError };
  }
  data.gear = gear;

  const { data: abilities, error: abilitiesError } = await getCharacterAbilities(id);
  if (abilitiesError) {
    console.error(abilitiesError);
    return { data: null, error: abilitiesError };
  }
  data.abilities = abilities;

  return { data, error };
}

const createCharacter = async (characterReq, profile) => {
  characterReq.creator_id = profile.id;

  // Ensure class_id is populated from the class name when missing
  if (!characterReq.class_id && characterReq.class) {
    try {
      let lookup = await getClasses({ name: characterReq.class });
      if ((!lookup || !Array.isArray(lookup.data) || lookup.data.length === 0)) {
        lookup = await getClasses({ name: characterReq.class, is_public: true });
      }
      if (lookup && Array.isArray(lookup.data) && lookup.data.length > 0) {
        characterReq.class_id = lookup.data[0].id;
      }
    } catch (_) {
      // Non-fatal: if lookup fails, proceed without blocking character creation
    }
  }

  // Ensure class name is populated from class_id when missing
  if (characterReq.class_id && !characterReq.class) {
    try {
      const { data: cls } = await getClass(characterReq.class_id);
      if (cls && cls.name) {
        characterReq.class = cls.name;
      }
    } catch (_) {
      // ignore
    }
  }

  // handle personality traits
  const traitFields = [characterReq.trait0, characterReq.trait1, characterReq.trait2];
  ['trait0', 'trait1', 'trait2'].forEach(trait => delete characterReq[trait]);
  
  // handle class gear
  const classGear = characterReq.gear;
  delete characterReq.gear;

  // handle class abilities
  const classAbilities = characterReq.abilities;
  delete characterReq.abilities;

  // handle is_public
  if (characterReq.is_public == 'on') {
    characterReq.is_public = true;
  } else {
    characterReq.is_public = false;
  }

  // create character
  const { data, error } = await supabase.from('characters').insert(characterReq).select();
  if (error) {
    console.error(error);
    return { data, error };
  }
  const character = data[0];

  // set personality traits
  const { data: traitsSet, error: traitsSetError } = await setCharacterTraits(character.id, traitFields);
  if (traitsSetError) {
    console.error(traitsSetError);
    return { data: null, error: traitsSetError };
  }

  // set class gear
  if (classGear) {
    const { data: gearSet, error: gearSetError } = await setCharacterGear(character.id, classGear);
    if (gearSetError) {
      console.error(gearSetError);
      return { data: null, error: gearSetError };
    }
  }

  // set class abilities
  if (classAbilities) {
    const { data: abilitiesSet, error: abilitiesSetError } = await setCharacterAbilities(character.id, classAbilities);
    if (abilitiesSetError) {
      console.error(abilitiesSetError);
      return { data: null, error: abilitiesSetError };
    }
  }

  return { data: character, error };
}

const updateCharacter = async (id, characterReq, profile) => {
  const { data: characterData, error: characterError } = await getCharacter(id);
  if (characterError) return { data: null, error: characterError };
  if (characterData.creator_id != profile.id) return { data: null, error: 'Unauthorized' };

  // Ensure class_id is populated from the class name when missing or when class changed
  if (!characterReq.class_id && characterReq.class) {
    try {
      let lookup = await getClasses({ name: characterReq.class });
      if ((!lookup || !Array.isArray(lookup.data) || lookup.data.length === 0)) {
        lookup = await getClasses({ name: characterReq.class, is_public: true });
      }
      if (lookup && Array.isArray(lookup.data) && lookup.data.length > 0) {
        characterReq.class_id = lookup.data[0].id;
      }
    } catch (_) {
      // Non-fatal: if lookup fails, proceed with remaining updates
    }
  }

  // Ensure class name is populated from class_id when missing
  if (characterReq.class_id && !characterReq.class) {
    try {
      const { data: cls } = await getClass(characterReq.class_id);
      if (cls && cls.name) {
        characterReq.class = cls.name;
      }
    } catch (_) {
      // ignore
    }
  }

  // handle personality traits
  const traitFields = [characterReq.trait0, characterReq.trait1, characterReq.trait2];
  ['trait0', 'trait1', 'trait2'].forEach(trait => delete characterReq[trait]);
  delete characterData.traits;

  // handle class gear
  const classGear = characterReq.gear;
  delete characterReq.gear;
  delete characterData.gear;

  // handle class abilities
  const classAbilities = characterReq.abilities;
  delete characterReq.abilities;
  delete characterData.abilities;

  // handle is_public
  if (characterReq.is_public == 'on') {
    characterReq.is_public = true;
  } else {
    characterReq.is_public = false;
  }

  // update character
  const { data, error } = await supabase.from('characters').update({ ...characterData, ...characterReq }).eq('id', id).eq('creator_id', profile.id).select();
  if (error) {
    console.error(error);
    return { data, error };
  }

  const character = data[0];

  // update traits
  const { data: traitsSet, error: traitsSetError } = await setCharacterTraits(character.id, traitFields);
  if (traitsSetError) {
    console.error(traitsSetError);
    return { data: null, error: traitsSetError };
  }

  // update gear
  if (classGear) {
    const { data: gearSet, error: gearSetError } = await setCharacterGear(character.id, classGear);
    if (gearSetError) {
      console.error(gearSetError);
      return { data: null, error: gearSetError };
    }
  }

  // update abilities
  if (classAbilities) {
    const { data: abilitiesSet, error: abilitiesSetError } = await setCharacterAbilities(character.id, classAbilities);
    if (abilitiesSetError) {
      console.error(abilitiesSetError);
      return { data: null, error: abilitiesSetError };
    }
  }

  return { data: character, error };
}

const deleteCharacter = async (id, profile) => {
  const { data: characterData, error: characterError } = await getCharacter(id);
  if (characterError) return { data: null, error: characterError };
  if (characterData.creator_id != profile.id) return { data: null, error: 'Unauthorized' };

  const { data, error } = await supabase.from('characters').delete().eq('id', id).eq('creator_id', profile.id);
  return { data, error };
}

// helpers

const getCharacterTraits = async (id) => {
  const { data, error } = await supabase.from('traits').select('*').eq('character_id', id);
  return { data, error };
}

const setCharacterTraits = async (id, traits) => {
  const { data, error } = await supabase.from('traits').delete().eq('character_id', id);
  if (error) {
    console.error(error);
    return { data: null, error };
  }

  const traitData = traits.map(trait => ({ character_id: id, name: trait }));
  const { data: newTraits, error: newTraitsError } = await supabase.from('traits').insert(traitData);
  if (newTraitsError) {
    console.error(newTraitsError);
    return { data: null, error: newTraitsError };
  }

  return { data: newTraits, error: null };
}

const getCharacterGear = async (id) => {
  // Fetch character gear rows
  const { data: gear, error: gearError } = await supabase
    .from('class_gear')
    .select('*')
    .eq('character_id', id);
  if (gearError) {
    return { data: null, error: gearError };
  }

  if (!Array.isArray(gear) || gear.length === 0) {
    return { data: [], error: null };
  }

  // Fetch related class definitions (non-fatal)
  const classIds = [...new Set(gear.map(g => g.class_id).filter(Boolean))];
  if (classIds.length === 0) {
    return { data: gear, error: null };
  }
  const { data: classes, error: classesError } = await supabase
    .from('classes')
    .select('id, name, gear')
    .in('id', classIds);
  if (classesError) {
    // Fallback: return raw gear rows as-is
    return { data: gear, error: null };
  }

  // Merge class gear definition values directly onto each character gear row
  const mergedGear = gear.map(item => {
    const cls = classes?.find(c => c.id === item.class_id);
    const classGear = Array.isArray(cls?.gear)
      ? cls.gear.find(g => g && g.name === item.name)
      : null;

    if (classGear) {
      // Prefer existing row values when overlapping keys exist
      return { ...classGear, ...item };
    }
    return item;
  });

  return { data: mergedGear, error: null };
}

const setCharacterGear = async (id, gear) => {
  const { data, error } = await supabase.from('class_gear').delete().eq('character_id', id);
  if (error) {
    return { data: null, error };
  }

  const { gearNameToClassId, gearNameToDescription } = await buildClassContentLookupMaps();
  const gearData = gear.map(itemName => {
    const record = { character_id: id, name: itemName };
    const clsId = gearNameToClassId.get(itemName);
    if (clsId) record.class_id = clsId;
    const desc = gearNameToDescription.get(itemName);
    if (desc) record.description = desc;
    return record;
  });
  const { data: newGear, error: newGearError } = await supabase.from('class_gear').insert(gearData);
  if (newGearError) {
    return { data: null, error: newGearError };
  }

  return { data: newGear, error: null };
}

const getCharacterAbilities = async (id) => {
  // First get the character abilities
  const { data: abilities, error: abilitiesError } = await supabase
    .from('class_abilities')
    .select('*')
    .eq('character_id', id);
  
  if (abilitiesError) {
    return { data: null, error: abilitiesError };
  }

  if (!abilities || abilities.length === 0) {
    return { data: [], error: null };
  }

  // Get unique class IDs
  const classIds = [...new Set(abilities.map(ability => ability.class_id).filter(Boolean))];
  if (classIds.length === 0) {
    return { data: abilities, error: null };
  }
  
  // Get classes with their abilities JSONB (non-fatal)
  const { data: classes, error: classesError } = await supabase
    .from('classes')
    .select('id, name, abilities')
    .in('id', classIds);

  if (classesError) {
    // Fallback: return raw ability rows as-is
    return { data: abilities, error: null };
  }

  // Merge class ability definition values directly onto each character ability
  const mergedAbilities = abilities.map(ability => {
    const cls = classes.find(c => c.id === ability.class_id);
    const classAbility = Array.isArray(cls?.abilities)
      ? cls.abilities.find(a => a && a.name === ability.name)
      : null;

    if (classAbility) {
      // Prefer existing ability row values when overlapping keys exist
      return { ...classAbility, ...ability };
    }

    return ability;
  });

  return { data: mergedAbilities, error: null };
}

const setCharacterAbilities = async (id, abilities) => {
  const { data, error } = await supabase.from('class_abilities').delete().eq('character_id', id);
  if (error) {
    return { data: null, error };
  }

  const { abilityNameToClassId, abilityNameToDescription } = await buildClassContentLookupMaps();
  const abilitiesData = abilities.map(abilityName => {
    const record = { character_id: id, name: abilityName };
    const clsId = abilityNameToClassId.get(abilityName);
    if (clsId) record.class_id = clsId;
    const desc = abilityNameToDescription.get(abilityName);
    if (desc) record.description = desc;
    return record;
  });
  const { data: newAbilities, error: newAbilitiesError } = await supabase.from('class_abilities').insert(abilitiesData);
  if (newAbilitiesError) {
    return { data: null, error: newAbilitiesError };
  }

  return { data: newAbilities, error: null };
}

const getCharacterRecentMissions = async (characterId, limit = 5) => {
  const { data, error } = await supabase
    .from('mission_characters')
    .select(`
      mission_id,
      missions (
        id,
        name,
        date,
        outcome,
        is_public,
        creator_id
      )
    `)
    .eq('character_id', characterId)
    .order('missions(date)', { ascending: false })
    .limit(limit);
  
  if (error) {
    console.error(error);
    return { data: null, error };
  }

  const filteredMissions = data.filter(mc => {
    if (mc.missions !== null) {
      return true;
    }
    return false;
  }).map(m => m.missions);

  return {
    data: filteredMissions, 
    error 
  };
};

const incrementMissionCount = async (characterId) => {
  const { data, error } = await supabase.rpc('increment_missions_count', { x: 1, character_id: characterId });
  return { data, error };
}

const getCharacterAllMissions = async (characterId) => {
  const { data, error } = await supabase
    .from('mission_characters')
    .select(`
      mission_id,
      missions (
        id,
        name,
        date,
        outcome,
        summary,
        is_public,
        creator_id
      )
    `)
    .eq('character_id', characterId)
    .order('missions(date)', { ascending: false });
  
  if (error) {
    console.error(error);
    return { data: null, error };
  }

  return { 
    data: data.map(mc => mc.missions), 
    error 
  };
};

const searchPublicCharacters = async (q, count, options = {}) => {
  try {
    let query = supabase
      .from('characters')
      .select('id, name, image_url, class_id, class')
      .eq('is_public', true)
      .limit(count);

    if (q && q.trim().length > 0) {
      query = query.ilike('name', `%${q}%`);
    }

    if (options.classId) {
      query = query.eq('class_id', options.classId);
    } else if (options.className) {
      query = query.eq('class', options.className);
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
      return { data: null, error };
    }
    return { data, error: null };
  } catch (error) {
    console.error(error);
    return { data: null, error };
  }
}

const getRandomPublicCharacters = async (count = 12, options = {}) => {
  try {
    // Fetch a reasonably sized pool, then sample client-side for randomness
    const poolSize = Math.max(Math.min(count * 5, 100), count);
    let query = supabase
      .from('characters')
      .select('id, name, image_url, class_id, class')
      .eq('is_public', true)
      .limit(poolSize);

    if (options.classId) {
      query = query.eq('class_id', options.classId);
    } else if (options.className) {
      query = query.eq('class', options.className);
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
      return { data: null, error };
    }

    if (!Array.isArray(data) || data.length <= count) {
      return { data, error: null };
    }

    // Reservoir sample
    const sampled = [];
    for (let i = 0; i < data.length; i++) {
      if (i < count) {
        sampled.push(data[i]);
      } else {
        const j = Math.floor(Math.random() * (i + 1));
        if (j < count) {
          sampled[j] = data[i];
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
  getOwnCharacters,
  getCharacter,
  createCharacter,
  updateCharacter,
  incrementMissionCount,
  deleteCharacter,
  getCharacterRecentMissions,
  getCharacterAllMissions,
  searchPublicCharacters,
  getRandomPublicCharacters,
  getPublicCharactersByCreator
};
