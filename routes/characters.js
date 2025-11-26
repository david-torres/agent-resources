const express = require('express');
const router = express.Router();
const { getOwnCharacters, getCharacter, createCharacter, updateCharacter, deleteCharacter, markCharacterDeceased, getCharacterRecentMissions, searchPublicCharacters, getRandomPublicCharacters, getMission, getClasses, getClass, getLfgPost, getProfileById } = require('../util/supabase');
const { statList, personalityMap } = require('../util/enclave-consts');
const { getUnlockedClasses } = require('../models/class');
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

      // fetch class record (non-fatal on failure)
      let characterClass = null;
      try {
        if (character.class_id) {
          const { data: cls } = await getClass(character.class_id);
          if (cls) {
            characterClass = cls;
          }
        }
      } catch (_) {
        // ignore; continue rendering without class details
      }

      // fetch creator profile
      let ownerProfile = null;
      try {
        const { data: creator } = await getProfileById(character.creator_id);
        if (creator) ownerProfile = creator;
      } catch (_) {
        // owner link is optional
      }

      // compute tooltip availability and description maps (never block render)
      try {
        const characterId = character.id;
        let hostingViaLfg = false;

        // If an LFG context is provided and the current user is the host for this character on that post,
        // allow full descriptions regardless of unlocks
        if (profile && req.query.lfg) {
          try {
            const { data: lfgPost } = await getLfgPost(req.query.lfg);
            if (lfgPost && lfgPost.host_id === profile.id) {
              hostingViaLfg = Array.isArray(lfgPost.join_requests) && lfgPost.join_requests.some(r =>
                r && r.status === 'approved' && r.character && r.character.id === characterId
              );
            }
          } catch (_) { /* ignore; hostingViaLfg remains false */ }
        }

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
        } else if (!hostingViaLfg) {
          // Logged in but not host in this LFG context: enforce unlock gating
          const userId = profile.user_id || (res.locals.user && res.locals.user.id) || null;
          let unlockedClassIds = new Set();
          try {
            const { data: unlocked } = await getUnlockedClasses(userId);
            if (Array.isArray(unlocked)) {
              unlockedClassIds = new Set(unlocked.map(c => c.id));
            }
          } catch (e) {
            // On error fetching unlocks, default to hiding everything that is class-gated
            unlockedClassIds = new Set();
          }

          if (Array.isArray(character.abilities)) {
            for (const ability of character.abilities) {
              if (ability && ability.class_id && !unlockedClassIds.has(ability.class_id)) {
                ability.description = '';
              }
            }
          }
          if (Array.isArray(character.gear)) {
            for (const gear of character.gear) {
              if (gear && gear.class_id && !unlockedClassIds.has(gear.class_id)) {
                gear.description = '';
              }
            }
          }
        }
      } catch (_) {
        // Never block page render for tooltip logic; fail closed by hiding descriptions
        try {
          if (Array.isArray(character.abilities)) {
            for (const ability of character.abilities) {
              if (ability) ability.description = '';
            }
          }
          if (Array.isArray(character.gear)) {
            for (const gear of character.gear) {
              if (gear) gear.description = '';
            }
          }
        } catch (_) { /* ignore */ }
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

router.post('/:id/deceased', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { confirmName } = req.body;

  // Get the character to verify ownership and name
  const { data: character, error: getError } = await getCharacter(id);
  if (getError) {
    return res.status(400).send(getError.message || getError);
  }

  // Verify the confirmation name matches
  if (!confirmName || confirmName.trim() !== character.name) {
    return res.status(400).send('Character name does not match. Please type the exact name to confirm.');
  }

  // Mark as deceased
  const { data, error } = await markCharacterDeceased(id, profile);
  if (error) {
    return res.status(400).send(error.message || error);
  }

  return res.header('HX-Location', `/characters/${id}/${encodeURIComponent(data.name)}`).send();
});

module.exports = router;
