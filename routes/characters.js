const express = require('express');
const router = express.Router();
const { getOwnCharacters, getCharacter, createCharacter, updateCharacter, deleteCharacter, getCharacterRecentMissions, searchPublicCharacters, getMission } = require('../util/supabase');
const { getClasses, getUnlockedClasses, getClass } = require('../models/class');
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

router.get('/new', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  // Fetch available classes: public, created by user, or unlocked
  let classes = [];
  const { data: publicClasses } = await getClasses({ visibility: 'public', status: 'release' });
  classes = classes.concat(publicClasses || []);
  // Include unlocked classes if user has any
  const { data: unlocked } = await getUnlockedClasses(res.locals.user?.id);
  if (unlocked) {
    const byId = new Set(classes.map(c => c.id));
    unlocked.forEach(c => { if (!byId.has(c.id)) classes.push(c); });
  }

  res.render('character-form', {
    profile,
    isNew: true,
    statList,
    classes,
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
    let classes = [];
    const { data: publicClasses } = await getClasses({ visibility: 'public', status: 'release' });
    classes = classes.concat(publicClasses || []);
    const { data: unlocked } = await getUnlockedClasses(res.locals.user?.id);
    if (unlocked) {
      const byId = new Set(classes.map(c => c.id));
      unlocked.forEach(c => { if (!byId.has(c.id)) classes.push(c); });
    }

    res.render('character-form', {
      profile,
      isNew: false,
      character,
      statList,
      classes,
      personalityMap,
      classGearList,
      classAbilityList
    });
  }
});

router.post('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  // Validate class access if class_id provided
  if (req.body.class_id) {
    const { data: cls, error: clsError } = await getClass(req.body.class_id);
    if (clsError || !cls) {
      return res.status(400).send('Invalid class');
    }
    let allowed = cls.visibility === 'public';
    if (!allowed) {
      if (res.locals.user?.id && cls.created_by === res.locals.user.id) {
        allowed = true;
      } else {
        const { data: unlocked } = await getUnlockedClasses(res.locals.user?.id);
        if (unlocked && unlocked.find(c => c.id === cls.id)) allowed = true;
      }
    }
    if (!allowed) {
      return res.status(403).send('Not authorized to use selected class');
    }
  }
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

// Prefill gear/abilities from selected class (HTMX)
router.get('/class-defaults', isAuthenticated, async (req, res) => {
  const { class_id: classId } = req.query;
  if (!classId) {
    return res.status(400).send('Missing class_id');
  }
  const { data: cls, error } = await getClass(classId);
  if (error || !cls) {
    return res.status(400).send('Invalid class');
  }
  // Normalize to arrays of names (class JSON may be array of objects or strings)
  const defaultGear = Array.isArray(cls.gear) ? cls.gear.map(g => g.name || g) : [];
  const defaultAbilities = Array.isArray(cls.abilities) ? cls.abilities.map(a => a.name || a) : [];

  res.render('partials/character-class-defaults', {
    layout: false,
    classGearList,
    classAbilityList,
    selectedGear: defaultGear,
    selectedAbilities: defaultAbilities
  });
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
  // Validate class access if class_id provided
  if (req.body.class_id) {
    const { data: cls, error: clsError } = await getClass(req.body.class_id);
    if (clsError || !cls) {
      return res.status(400).send('Invalid class');
    }
    let allowed = cls.visibility === 'public';
    if (!allowed) {
      if (res.locals.user?.id && cls.created_by === res.locals.user.id) {
        allowed = true;
      } else {
        const { data: unlocked } = await getUnlockedClasses(res.locals.user?.id);
        if (unlocked && unlocked.find(c => c.id === cls.id)) allowed = true;
      }
    }
    if (!allowed) {
      return res.status(403).send('Not authorized to use selected class');
    }
  }
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
