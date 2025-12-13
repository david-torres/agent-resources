const express = require('express');
const router = express.Router();
const { 
  getMissions, 
  getMission, 
  createMission, 
  updateMission, 
  deleteMission, 
  addCharacterToMission, 
  removeCharacterFromMission, 
  getMissionCharacters, 
  setUnregisteredCharacterNames, 
  searchPublicMissions, 
  getRandomPublicMissions, 
  getClasses,
  // Editor management
  getMissionEditors,
  addMissionEditor,
  removeMissionEditor,
  canEditMission,
  isCreator,
  getEditableMissions,
  // Similar/merge
  searchSimilarMissions,
  mergeMissions,
  previewMergeMissions,
  // Profile search
  searchProfiles
} = require('../util/supabase');
const { getCharacter, getCharacterAllMissions, getOwnMissions } = require('../util/supabase');
const { statList, adventClassList, aspirantPreviewClassList, playerCreatedClassList, classAbilityList } = require('../util/enclave-consts');
const { isAuthenticated, authOptional } = require('../util/auth');
const supabase = require('../util/supabase');

router.get('/search', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { has_video, character_name, character_class } = req.query;
  const [{ data: classes }, { data: initialMissions }] = await Promise.all([
    getClasses({ is_public: true }),
    getRandomPublicMissions(12, has_video === 'true', character_name, character_class)
  ]);

  res.render('mission-search', {
    profile,
    classes: Array.isArray(classes) ? classes : [],
    initialMissions: Array.isArray(initialMissions) ? initialMissions : [],
    activeNav: 'search-missions',
    breadcrumbs: [
      { label: 'Search Missions', href: '/missions/search' }
    ]
  });
});

router.get('/s', authOptional, async (req, res) => {
  const { q, count, has_video, character_name, character_class } = req.query;

  // If no search query, no character name, no character class, and no video filter, return empty results
  const hasQuery = q && q.length >= 2;
  const hasCharacterName = character_name && character_name.length >= 2;
  const hasCharacterClass = character_class && character_class.length > 0;
  const hasVideoFilter = has_video === 'true';

  if (!hasQuery && !hasCharacterName && !hasCharacterClass && !hasVideoFilter) {
    res.render('partials/mission-search-results', {
      layout: false,
      missions: [],
      q
    });
    return;
  }

  const { data: missions, error } = await searchPublicMissions(
    hasQuery ? q : null,
    count || 12,
    hasVideoFilter,
    hasCharacterName ? character_name : null,
    hasCharacterClass ? character_class : null
  );

  if (error) {
    return res.status(400).send(error.message);
  } else {
    res.render('partials/mission-search-results', {
      layout: false,
      missions,
      q
    });
  }
});

router.get('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  
  // Get both own missions and editable missions
  const [{ data: ownMissions, error: ownError }, { data: editableMissions, error: editableError }] = await Promise.all([
    getOwnMissions(profile),
    getEditableMissions(profile)
  ]);
  
  if (ownError) {
    return res.status(400).send(ownError.message);
  }
  
  // Mark own missions and filter duplicates from editable
  const ownMissionsMarked = (ownMissions || []).map(m => ({ ...m, isOwner: true }));
  const ownIds = new Set(ownMissionsMarked.map(m => m.id));
  const editableOnly = (editableMissions || [])
    .filter(m => !ownIds.has(m.id))
    .map(m => ({ ...m, isEditor: true }));
  
  res.render('mission-list', {
    profile,
    missions: ownMissionsMarked,
    editableMissions: editableOnly,
    activeNav: 'missions',
    breadcrumbs: [
      { label: 'Missions', href: '/missions' }
    ]
  });
});

router.get('/new', isAuthenticated, (req, res) => {
  const { profile } = res.locals;
  res.render('mission-form', {
    profile,
    isNew: true,
    activeNav: 'missions',
    breadcrumbs: [
      { label: 'Missions', href: '/missions' },
      { label: 'New Mission', href: '/missions/new' }
    ]
  });
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
  const { id } = req.params;
  const { data: mission, error } = await getMission(id);
  if (error) {
    return res.status(400).send(error.message);
  } else {
    res.render('mission', {
      profile,
      mission,
      authOptional: true,
      activeNav: 'missions',
      breadcrumbs: [
        { label: 'Missions', href: '/missions' },
        { label: mission.name, href: `/missions/${id}` }
      ]
    });
  }
});

router.get('/:id/edit', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  
  // Check if user can edit this mission
  const canEdit = await canEditMission(id, profile);
  if (!canEdit) {
    return res.status(403).send('You do not have permission to edit this mission');
  }
  
  const [{ data: mission, error }, { data: editors }, userIsCreator] = await Promise.all([
    getMission(id),
    getMissionEditors(id),
    isCreator(id, profile)
  ]);
  
  if (error) {
    return res.status(400).send(error.message);
  }
  
  res.render('mission-form', {
    profile,
    mission,
    editors: editors || [],
    isNew: false,
    isCreator: userIsCreator,
    canRemoveEditors: userIsCreator,
    activeNav: 'missions',
    breadcrumbs: [
      { label: 'Missions', href: '/missions' },
      { label: mission.name, href: `/missions/${id}` },
      { label: 'Edit', href: '#' }
    ]
  });
});

router.put('/:id', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  let { characters, unregistered_character_names, ...missionData } = req.body;

  delete missionData.q;

  if (missionData.is_public === 'on') {
    missionData.is_public = true
  } else {
    missionData.is_public = false
  }

  // Parse unregistered_character_names - handle both array and single string
  let unregisteredNames = [];
  if (unregistered_character_names) {
    if (Array.isArray(unregistered_character_names)) {
      unregisteredNames = unregistered_character_names;
    } else if (typeof unregistered_character_names === 'string') {
      unregisteredNames = [unregistered_character_names];
    }
  }
  // Store as JSON array in the mission
  missionData.unregistered_character_names = unregisteredNames.filter(n => n && n.trim().length > 0);
  
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
          classAbilityList,
          activeNav: 'characters',
          breadcrumbs: [
            { label: 'Characters', href: '/characters' },
            { label: character.name, href: `/characters/${id}/${encodeURIComponent(character.name)}` },
            { label: 'Missions', href: '#' }
          ]
        });
      }
    }
  }
});

// ============================================
// Editor Management Endpoints
// ============================================

// Get editors for a mission
router.get('/:id/editors', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;

  // Check if user can view this mission's editors
  const canEdit = await canEditMission(id, profile);
  if (!canEdit) {
    return res.status(403).send('Unauthorized');
  }

  const { data: editors, error } = await getMissionEditors(id);
  if (error) {
    return res.status(400).send(error.message || error);
  }

  res.render('partials/mission-editors', {
    layout: false,
    editors,
    missionId: id,
    canRemoveEditors: await isCreator(id, profile)
  });
});

// Add an editor to a mission
router.post('/:id/editors', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { profile_id } = req.body;

  if (!profile_id) {
    return res.status(400).send('Profile ID is required');
  }

  // Check if user can edit this mission
  const canEdit = await canEditMission(id, profile);
  if (!canEdit) {
    return res.status(403).send('Unauthorized');
  }

  const { error } = await addMissionEditor(id, profile_id, profile.id);
  if (error) {
    return res.status(400).send(error.message || error);
  }

  // Return updated editors list
  const { data: editors } = await getMissionEditors(id);
  res.render('partials/mission-editors', {
    layout: false,
    editors,
    missionId: id,
    canRemoveEditors: await isCreator(id, profile)
  });
});

// Remove an editor from a mission
router.delete('/:id/editors/:profileId', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id, profileId } = req.params;

  // Only creator can remove editors
  const creator = await isCreator(id, profile);
  if (!creator) {
    return res.status(403).send('Only the mission creator can remove editors');
  }

  const { error } = await removeMissionEditor(id, profileId);
  if (error) {
    return res.status(400).send(error.message || error);
  }

  // Return updated editors list
  const { data: editors } = await getMissionEditors(id);
  res.render('partials/mission-editors', {
    layout: false,
    editors,
    missionId: id,
    canRemoveEditors: true
  });
});

// ============================================
// Similar Missions / Deduplication Endpoints
// ============================================

// Search for similar missions (for deduplication)
router.get('/similar', isAuthenticated, async (req, res) => {
  const { date, name, exclude_id } = req.query;

  if (!date) {
    return res.status(400).send('Date is required');
  }

  const { data: missions, error } = await searchSimilarMissions(date, name, exclude_id);
  if (error) {
    return res.status(400).send(error.message || error);
  }

  res.render('partials/similar-missions', {
    layout: false,
    missions
  });
});

// ============================================
// Mission Merge Endpoints
// ============================================

// Preview a merge
router.get('/:id/merge/:targetId/preview', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id, targetId } = req.params;

  // Check permissions for both missions
  const canEditPrimary = await canEditMission(id, profile);
  const canEditTarget = await canEditMission(targetId, profile);

  if (!canEditPrimary || !canEditTarget) {
    return res.status(403).send('You must be able to edit both missions to merge them');
  }

  const { data: preview, error } = await previewMergeMissions(id, targetId);
  if (error) {
    return res.status(400).send(error.message || error);
  }

  res.render('mission-merge', {
    profile,
    preview,
    primaryId: id,
    secondaryId: targetId,
    activeNav: 'missions',
    breadcrumbs: [
      { label: 'Missions', href: '/missions' },
      { label: 'Merge Missions', href: '#' }
    ]
  });
});

// Execute a merge
router.post('/:id/merge/:targetId', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id, targetId } = req.params;

  const { data: mergedMission, error } = await mergeMissions(id, targetId, profile);
  if (error) {
    return res.status(400).send(error.message || error);
  }

  return res.header('HX-Location', `/missions/${mergedMission.id}`).send();
});

module.exports = router;
