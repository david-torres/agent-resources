const express = require('express');
const router = express.Router();
const { getOwnCharacters, getCharacter, createCharacter, updateCharacter, deleteCharacter, getCharacterRecentMissions, searchPublicCharacters, getRandomPublicCharacters, getMission, getClasses, getClass, getProfileById } = require('../util/supabase');
const { statList, personalityMap } = require('../util/enclave-consts');
const { getUnlockedClasses, isClassUnlocked } = require('../models/class');
const { isAuthenticated, authOptional } = require('../util/auth');
const { processCharacterImport } = require('../util/character-import');

// Helper to filter class lists/lookup maps by user's unlocked classes
const filterClassDataForUser = async (user) => {
  
  // Load classes from DB by category
  const [adventRes, aspirantRes, pccRes] = await Promise.all([
    getClasses({ is_public: true, is_player_created: false, rules_edition: 'advent' }),
    getClasses({ is_public: true, is_player_created: false, rules_edition: 'aspirant' }),
    getClasses({ is_public: true, is_player_created: true })
  ]);

  const advent = Array.isArray(adventRes.data) ? adventRes.data : [];
  const aspirant = Array.isArray(aspirantRes.data) ? aspirantRes.data : [];
  const pcc = Array.isArray(pccRes.data) ? pccRes.data : [];

  // Default to full class object lists
  let filteredAdvent = advent;
  let filteredAspirant = aspirant;
  let filteredPCC = pcc;

  // Build lookup maps for gear and abilities keyed by class name
  const allClasses = [...advent, ...aspirant, ...pcc];
  let filteredGear = Object.fromEntries(allClasses.map(c => [c.name, Array.isArray(c.gear) ? c.gear.map(g => g.name) : []]));
  let filteredAbilities = Object.fromEntries(allClasses.map(c => [c.name, Array.isArray(c.abilities) ? c.abilities.map(a => a.name) : []]));

  // If user provided, reduce to unlocked set
  if (user) {
    const { data: unlocked } = await getUnlockedClasses(user.id);
    if (Array.isArray(unlocked) && unlocked.length > 0) {
      const allowed = new Set(unlocked.map(c => c.name));
      const filterArr = arr => arr.filter(c => allowed.has(c.name));
      const filterMap = m => Object.fromEntries(Object.entries(m).filter(([k]) => allowed.has(k)));
      filteredAdvent = filterArr(filteredAdvent);
      filteredAspirant = filterArr(filteredAspirant);
      filteredPCC = filterArr(filteredPCC);
      filteredGear = filterMap(filteredGear);
      filteredAbilities = filterMap(filteredAbilities);
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
    adventClasses: filteredAdvent,
    aspirantPreviewClasses: filteredAspirant,
    playerCreatedClasses: filteredPCC,
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
      adventClasses: filteredAdvent,
      aspirantPreviewClasses: filteredAspirant,
      playerCreatedClasses: filteredPCC,
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
  const classId = req.query.classId || null;
  const className = req.query.class || null;

  const hasQuery = q && q.length >= 2;
  const hasClassFilter = !!(classId || className);

  if (!hasQuery && !hasClassFilter) {
    res.render('partials/character-search-results', {
      layout: false,
      characters: [],
      q,
      classFilter: null
    });
    return;
  }

  const options = {};
  if (classId) options.classId = classId;
  if (!options.classId && className) options.className = className;

  const { data: characters, error } = await searchPublicCharacters(hasQuery ? q : null, count, options);

  if (error) {
    return res.status(400).send(error.message);
  } else {
    res.render('partials/character-search-results', {
      layout: false,
      characters,
      q,
      classFilter: classId || className || null
    });
  }
});

router.get('/search', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const [{ data: classes }] = await Promise.all([
    getClasses({ is_public: true })
  ]);
  const { data: initialCharacters } = await getRandomPublicCharacters(12);

  res.render('character-search', { profile, classes: Array.isArray(classes) ? classes : [], initialCharacters: Array.isArray(initialCharacters) ? initialCharacters : [] });
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

      // fetch class record
      let characterClass = null;
      try {
        if (character.class_id) {
          const { data: cls } = await getClass(character.class_id);
          if (cls) {
            characterClass = cls;
          }
        }
      } catch (error) {
        return res.status(400).send(error.message);
      }

      // fetch creator profile
      let ownerProfile = null;
      try {
        const { data: creator } = await getProfileById(character.creator_id);
        if (creator) ownerProfile = creator;
      } catch (_) {
        // owner link is optional
      }

      // compute tooltip availability and description maps
      try { 
        if (!profile) {
          // Not logged in: hide all descriptions
          if (Array.isArray(character.abilities)) {
            for (const ability of character.abilities) {
              ability.description = '';
            }
          }
          if (Array.isArray(character.gear)) {
            for (const gear of character.gear) {
              gear.description = '';
            }
          }
        } else if (characterClass) {
          // Logged in: hide descriptions for items from locked classes
          if (Array.isArray(character.abilities)) {
            for (const ability of character.abilities) {
              if (ability.class_id) {
                const { data: abilityUnlocked } = await isClassUnlocked(profile.user_id, ability.class_id);
                if (!abilityUnlocked) {
                  ability.description = '';
                }
              }
            }
          }
          if (Array.isArray(character.gear)) {
            for (const gear of character.gear) {
              if (gear.class_id) {
                const { data: gearUnlocked } = await isClassUnlocked(profile.user_id, gear.class_id);
                if (!gearUnlocked) {
                  gear.description = '';
                }
              }
            }
          }
        }
      } catch (error) {
        return res.status(400).send(error.message);
      }

      res.render('character', {
        title: character.name,
        profile,
        character,
        characterClass,
        ownerProfile,
        recentMissions,
        statList,
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
