const express = require('express');
const router = express.Router();
const { getOwnCharacters, getCharacter, createCharacter, updateCharacter, deleteCharacter, getCharacterRecentMissions, searchPublicCharacters, getMission } = require('../util/supabase');
const { statList, adventClassList, aspirantPreviewClassList, playerCreatedClassList, personalityMap, classGearList, classAbilityList } = require('../util/enclave-consts');
const { isAuthenticated, authOptional } = require('../util/auth');
const { processCharacterImport } = require('../util/character-import');

router.get('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: characters, error } = await getOwnCharacters(profile);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('character-list', { characters });
  }
});

router.get('/new', isAuthenticated, (req, res) => {
  const { profile } = res.locals;
  res.render('character-form', {
    profile,
    isNew: true,
    statList,
    adventClassList,
    aspirantPreviewClassList,
    playerCreatedClassList,
    personalityMap,
    classGearList,
    classAbilityList
  });
});

router.get('/:id/edit', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: character, error } = await getCharacter(req.params.id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('character-form', {
      profile,
      isNew: false,
      character,
      statList,
      adventClassList,
      aspirantPreviewClassList,
      playerCreatedClassList,
      personalityMap,
      classGearList,
      classAbilityList
    });
  }
});

router.post('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data, error } = await createCharacter(req.body, profile);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', '/characters').send();
  }
});

router.get('/class-gear', (req, res) => {
  res.render('partials/character-class-gear', { layout: false, classGearList });
});

router.get('/class-abilities', (req, res) => {
  res.render('partials/character-class-abilities', { layout: false, classAbilityList });
});

router.get('/import', isAuthenticated, (req, res) => {
  const { profile } = res.locals;
  res.render('character-import', { profile });
});

router.post('/import', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { inputText } = req.body;
  try {
    const character = await processCharacterImport(inputText, profile);
    res.header('HX-Location', `/characters/${character.id}/${encodeURIComponent(character.name)}`).send();
  } catch (error) {
    res.status(400).send(error.message);
  }
});

router.get('/add-to-mission-search', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { q, count, mission:missionId } = req.query;

  const { data: mission, errorMission } = await getMission(missionId);
  if (errorMission) {
    res.status(400).send(errorMission.message);
    return;
  }

  if (!q || q.length < 2) {
    res.render('partials/add-to-mission-search-results', { 
      layout: false, 
      characters: [],
      mission,
      q
    });
    return;
  }
  const { data: characters, error } = await searchPublicCharacters(q, count);

  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('partials/add-to-mission-search-results', { 
      layout: false, 
      characters,
      mission,
      q
    });
  }
});

router.get('/s', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { q, count } = req.query;

  if (!q || q.length < 2) {
    res.render('partials/character-search-results', { 
      layout: false, 
      characters: [],
      q
    });
    return;
  }
  const { data: characters, error } = await searchPublicCharacters(q, count);

  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('partials/character-search-results', { 
      layout: false, 
      characters,
      q
    });
  }
});

router.get('/search', authOptional, (req, res) => {
  const { profile } = res.locals;
  res.render('character-search', { profile });
});

router.get('/:id/:name?', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { data: character, error } = await getCharacter(id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    if (character.is_public === false && (!profile || character.creator_id !== profile.id)) {
      res.status(404).send('Not found').send();
    } else {
      const { data: recentMissions } = await getCharacterRecentMissions(id);
      res.render('character', {
        title: character.name,
        profile,
        character,
        recentMissions,
        statList,
        adventClassList,
        aspirantPreviewClassList,
        playerCreatedClassList,
        classAbilityList,
        authOptional: true
      });
    }
  }
});

router.put('/:id/:name?', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { data, error } = await updateCharacter(id, req.body, profile);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', `/characters/${id}/${encodeURIComponent(data.name)}`).send();
  }
});

router.delete('/:id/:name?', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { error } = await deleteCharacter(id, profile);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', '/characters').send();
  }
});

module.exports = router;
