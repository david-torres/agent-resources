const { supabase } = require('./_base');
const { getProfile } = require('./profile');

const getOwnCharacters = async () => {
  const profile = await getProfile();
  const { data, error } = await supabase.from('characters').select('*').eq('creator_id', profile.id);
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

  return { data, error };
}

const createCharacter = async (characterReq) => {
  const profile = await getProfile();
  characterReq.creator_id = profile.id;

  // handle personality traits
  const traitFields = [characterReq.trait0, characterReq.trait1, characterReq.trait2];
  ['trait0', 'trait1', 'trait2'].forEach(trait => delete characterReq[trait]);
  
  // handle class gear
  const classGear = characterReq.gear;
  delete characterReq.gear;

  // create character
  const { data, error } = await supabase.from('characters').insert(characterReq).select();
  if (error) {
    console.error(error);
    return { data, error };
  }
  const character = data[0];

  // set personality traits
  const { data: traitsSet, error: traitsSetError } = setCharacterTraits(character.id, traitFields);
  if (traitsSetError) {
    console.error(traitsSetError);
    return { data: null, error: traitsSetError };
  }

  // set class gear
  const { data: gearSet, error: gearSetError } = setCharacterGear(character.id, classGear);
  if (gearSetError) {
    console.error(gearSetError);
    return { data: null, error: gearSetError };
  }

  return { data: character, error };
}

const updateCharacter = async (id, characterReq) => {
  const profile = await getProfile();
  const { data: characterData, error: characterError } = await getCharacter(id);
  if (characterError) return { data: null, error: characterError };
  if (characterData.creator_id != profile.id) return { data: null, error: 'Unauthorized' };

  // handle personality traits
  const traitFields = [characterReq.trait0, characterReq.trait1, characterReq.trait2];
  ['trait0', 'trait1', 'trait2'].forEach(trait => delete characterReq[trait]);
  delete characterData.traits;

  // handle class gear
  const classGear = characterReq.gear;
  delete characterReq.gear;
  delete characterData.gear;

  // update character
  const { data, error } = await supabase.from('characters').update({ ...characterReq, ...characterData }).eq('id', id).eq('creator_id', profile.id).select();
  if (error) {
    console.error(error);
    return { data, error };
  }

  const character = data[0];

  // update traits
  const { data: traitsSet, error: traitsSetError } = setCharacterTraits(character.id, traitFields);
  if (traitsSetError) {
    console.error(traitsSetError);
    return { data: null, error: traitsSetError };
  }

  // update gear
  const { data: gearSet, error: gearSetError } = setCharacterGear(character.id, classGear);
  if (gearSetError) {
    console.error(gearSetError);
    return { data: null, error: gearSetError };
  }

  return { data: character, error };
}

const deleteCharacter = async (id, character) => {
  const profile = await getProfile();
  const { data: characterData, error: characterError } = await getCharacter(id);
  if (characterError) return { data: null, error: characterError };
  if (characterData.creator_id != profile.id) return { data: null, error: 'Unauthorized' };

  const { data, error } = await supabase.from('characters').delete(character).eq('id', id).eq('creator_id', profile.id);
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

module.exports = {
  getOwnCharacters,
  getCharacter,
  createCharacter,
  updateCharacter,
  deleteCharacter
};