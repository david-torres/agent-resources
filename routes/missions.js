const express = require('express');
const router = express.Router();
const { getMissions, getMission, createMission, updateMission, deleteMission, addCharacterToMission, removeCharacterFromMission, getMissionCharacters } = require('../util/supabase');
const { getCharacter, getCharacterAllMissions, getOwnMissions } = require('../util/supabase');
const { statList, adventClassList, aspirantPreviewClassList, playerCreatedClassList, classAbilityList } = require('../util/enclave-consts');
const { isAuthenticated, authOptional } = require('../util/auth');
const supabase = require('../util/supabase');

router.get('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: missions, error } = await getOwnMissions(profile);
  if (error) {
    return res.status(400).send(error.message);
  } else {
    res.render('mission-list', { profile, missions });
  }
});

router.get('/new', isAuthenticated, (req, res) => {
  const { profile } = res.locals;
  res.render('mission-form', { profile, isNew: true });
});

router.post('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { characters, ...missionData } = req.body;
  
  // Create the mission
  const { data: missionRes, error: missionError } = await createMission({
    ...missionData,
    date: new Date().toISOString(),
    outcome: 'success'
  }, profile);

  if (missionError) {
    return res.status(400).send(missionError.message);
  }

  const mission = missionRes[0];

  // Add characters to the mission
  if (characters && characters.length > 0) {
    for (const characterId of characters) {
      const { error: characterError } = await addCharacterToMission(mission.id, characterId);
      if (characterError) {
        return res.status(400).send(characterError.message);
      }
    }
  }

  return res.header('HX-Location', `/missions/${mission.id}/edit`).send();
});

router.get('/:id', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { data: mission, error } = await getMission(req.params.id);
  if (error) {
    return res.status(400).send(error.message);
  } else {
    res.render('mission', { profile, mission, authOptional: true });
  }
});

router.get('/:id/edit', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: mission, error } = await getMission(req.params.id);
  if (error) {
    return res.status(400).send(error.message);
  } else {
    res.render('mission-form', { profile, mission, isNew: false });
  }
});

router.put('/:id', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  let { characters, ...missionData } = req.body;

  delete missionData.q;

  if (missionData.is_public === 'on') {
    missionData.is_public = true
  } else {
    missionData.is_public = false
  }
  
  // Update the mission
  const { data, error } = await updateMission(req.params.id, missionData, profile);
  if (error) {
    return res.status(400).send(error.message);
  }

  // Get current characters
  const { data: currentCharacters, error: characterError } = await getMissionCharacters(req.params.id);
  const newIds = characters || [];
  const currentIds = currentCharacters.map(mc => mc.character_id);

  // Remove characters that are no longer in the mission
  for (const id of currentIds) {
    if (!newIds.includes(id)) {
      const { error: removeError } = await removeCharacterFromMission(req.params.id, id);
      if (removeError) {
        return res.status(400).send(removeError.message);
      }
    }
  }

  // Add new characters
  for (const id of newIds) {
    if (!currentIds.includes(id)) {
      const { error: addError } = await addCharacterToMission(req.params.id, id);
      if (addError) {
        return res.status(400).send(addError.message);
      }
    }
  }

  return res.header('HX-Location', `/missions/${req.params.id}`).send();
});

router.delete('/:id', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { error } = await deleteMission(req.params.id, profile);
  if (error) {
    return res.status(400).send(error.message);
  } else {
    return res.header('HX-Location', '/missions').send();
  }
});

router.post('/:id/characters/:characterId', isAuthenticated, async (req, res) => {
  const { id, characterId } = req.params;
  const { error } = await addCharacterToMission(id, characterId);
  if (error) {
    return res.status(400).send(error.message);
  } else {
    return res.header('HX-Location', `/missions/${id}/edit`).send();
  }
});

router.delete('/:id/characters/:characterId', isAuthenticated, async (req, res) => {
  const { id, characterId } = req.params;
  const { error } = await removeCharacterFromMission(id, characterId);
  if (error) {
    return res.status(400).send(error.message);
  } else {
    return res.header('HX-Location', `/missions/${id}/edit`).send();
  }
});

router.get('/character/:id', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { data: character, error } = await getCharacter(id);
  
  if (error) {
    return res.status(400).send(error.message);
  } else {
    if (character.is_public === false && (!profile || character.creator_id !== profile.id)) {
      return res.status(404).send('Not found');
    } else {
      const { data: missions, error: missionsError } = await getCharacterAllMissions(id);
      if (missionsError) {
        return res.status(400).send(missionsError.message);
      } else {
        res.render('character-missions', {
          profile,
          character,
          missions,
          statList,
          adventClassList,
          aspirantPreviewClassList,
          playerCreatedClassList,
          classAbilityList
        });
      }
    }
  }
});

module.exports = router;
