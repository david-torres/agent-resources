const express = require('express');
const router = express.Router();
const { getOwnCharacters, getCharacter, createCharacter, updateCharacter, deleteCharacter, getCharacterRecentMissions, searchPublicCharacters, getMission } = require('../util/supabase');
const { statList, adventClassList, aspirantPreviewClassList, playerCreatedClassList, personalityMap, classGearList, classAbilityList } = require('../util/enclave-consts');
const { getUnlockedClasses } = require('../models/class');
const { isAuthenticated, authOptional } = require('../util/auth');
const { processCharacterImport } = require('../util/character-import');

// Helper to filter class lists/lookup maps by user's unlocked classes
const filterClassDataForUser = async (user) => {
  let filteredAdvent = adventClassList;
  let filteredAspirant = aspirantPreviewClassList;
  let filteredPCC = playerCreatedClassList;
  let filteredGear = classGearList;
  let filteredAbilities = classAbilityList;

  if (user) {
    const { data: unlocked } = await getUnlockedClasses(user.id);
    if (Array.isArray(unlocked) && unlocked.length > 0) {
      const allowed = new Set(unlocked.map(c => c.name));
      const filterArr = arr => arr.filter(n => allowed.has(n));
      const filterMap = m => Object.fromEntries(Object.entries(m).filter(([k]) => allowed.has(k)));
      filteredAdvent = filterArr(adventClassList);
      filteredAspirant = filterArr(aspirantPreviewClassList);
      filteredPCC = filterArr(playerCreatedClassList);
      filteredGear = filterMap(classGearList);
      filteredAbilities = filterMap(classAbilityList);
    } else {
      filteredAdvent = [];
      filteredAspirant = [];
      filteredPCC = [];
      filteredGear = {};
      filteredAbilities = {};
    }
  }

  return { filteredAdvent, filteredAspirant, filteredPCC, filteredGear, filteredAbilities };
};

router.get('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: characters, error } = await getOwnCharacters(profile);
  if (error) {
    return res.status(400).send(error.message);
  } else {
    res.render('character-list', { characters });
  }
});

router.get('/new', isAuthenticated, async (req, res) => {
  const { profile, user } = res.locals;
  const { filteredAdvent, filteredAspirant, filteredPCC, filteredGear, filteredAbilities } = await filterClassDataForUser(user);
  res.render('character-form', {
    profile,
    isNew: true,
    statList,
    adventClassList: filteredAdvent,
    aspirantPreviewClassList: filteredAspirant,
    playerCreatedClassList: filteredPCC,
    personalityMap,
    classGearList: filteredGear,
    classAbilityList: filteredAbilities
  });
});

router.get('/:id/edit', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: character, error } = await getCharacter(req.params.id);
  if (error) {
    return res.status(400).send(error.message);
  } else {
    const { filteredAdvent, filteredAspirant, filteredPCC, filteredGear, filteredAbilities } = await filterClassDataForUser(res.locals.user);
    res.render('character-form', {
      profile,
      isNew: false,
      character,
      statList,
      adventClassList: filteredAdvent,
      aspirantPreviewClassList: filteredAspirant,
      playerCreatedClassList: filteredPCC,
      personalityMap,
      classGearList: filteredGear,
      classAbilityList: filteredAbilities
    });
  }
});

router.post('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data, error } = await createCharacter(req.body, profile);
  if (error) {
    return res.status(400).send(error.message);
  } else {
    return res.header('HX-Location', '/characters').send();
  }
});

router.get('/class-gear', authOptional, async (req, res) => {
  const { filteredGear } = await filterClassDataForUser(res.locals.user);
  res.render('partials/character-class-gear', { layout: false, classGearList: filteredGear });
});

router.get('/class-abilities', authOptional, async (req, res) => {
  const { filteredAbilities } = await filterClassDataForUser(res.locals.user);
  res.render('partials/character-class-abilities', { layout: false, classAbilityList: filteredAbilities });
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
    return res.header('HX-Location', `/characters/${character.id}/${encodeURIComponent(character.name)}`).send();
  } catch (error) {
    return res.status(400).send(error.message);
  }
});

router.get('/add-to-mission-search', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { q, count, mission:missionId } = req.query;

  const { data: mission, errorMission } = await getMission(missionId);
  if (errorMission) {
    return res.status(400).send(errorMission.message);
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
    return res.status(400).send(error.message);
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
    return res.status(400).send(error.message);
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
    return res.status(400).send(error.message);
  } else {
    if (character.is_public === false && (!profile || character.creator_id !== profile.id)) {
      return res.status(404).send('Not found');
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
    return res.status(400).send(error.message);
  } else {
    return res.header('HX-Location', `/characters/${id}/${encodeURIComponent(data.name)}`).send();
  }
});

router.delete('/:id/:name?', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { error } = await deleteCharacter(id, profile);
  if (error) {
    return res.status(400).send(error.message);
  } else {
    return res.header('HX-Location', '/characters').send();
  }
});

module.exports = router;
