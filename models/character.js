const { supabase } = require('./_base');
const { getClasses, getClass } = require('./class');

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
  data.gear = gear.map(gear => gear.name);

  const { data: abilities, error: abilitiesError } = await getCharacterAbilities(id);
  if (abilitiesError) {
    console.error(abilitiesError);
    return { data: null, error: abilitiesError };
  }
  data.abilities = abilities.map(ability => ability.name);

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
  const { data, error } = await supabase.from('class_gear').select('*').eq('character_id', id);
  return { data, error };
}

const setCharacterGear = async (id, gear) => {
  const { data, error } = await supabase.from('class_gear').delete().eq('character_id', id);
  if (error) {
    return { data: null, error };
  }

  const gearData = gear.map(gear => ({ character_id: id, name: gear }));
  const { data: newGear, error: newGearError } = await supabase.from('class_gear').insert(gearData);
  if (newGearError) {
    return { data: null, error: newGearError };
  }

  return { data: newGear, error: null };
}

const getCharacterAbilities = async (id) => {
  const { data, error } = await supabase.from('class_abilities').select('*').eq('character_id', id);
  return { data, error };
}

const setCharacterAbilities = async (id, abilities) => {
  const { data, error } = await supabase.from('class_abilities').delete().eq('character_id', id);
  if (error) {
    return { data: null, error };
  }

  const abilitiesData = abilities.map(ability => ({ character_id: id, name: ability }));
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

const searchPublicCharacters = async (q, count) => {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, image_url')
    .ilike('name', `%${q}%`)
    .match({is_public: true})
    .limit(count);
  
    if (error) {
      console.error(error);
      return { data: null, error };
    }

    return { data, error }
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
  getPublicCharactersByCreator
};
