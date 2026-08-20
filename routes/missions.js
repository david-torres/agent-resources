const express = require('express');
const router = express.Router();
const { registerUuidParams, isValidUuid } = require('../util/validate');
registerUuidParams(router, ['id', 'characterId', 'profileId', 'targetId']);
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
  getMissionEditors,
  addMissionEditor,
  removeMissionEditor,
  canEditMission,
  isCreator,
  getEditableMissions,
  searchSimilarMissions,
  mergeMissions,
  previewMergeMissions,
  getOwnMissions,
  getMissionByLfgPostId
} = require('../models/mission');
const { getLfgPost } = require('../models/lfg');
const { canLogGame, buildMissionDraft } = require('../util/lfg-mission-draft');
const { getCharacter, getCharacterAllMissions, searchPublicCharacters } = require('../models/character');
const { getClasses } = require('../models/class');
const { searchProfiles } = require('../models/profile');
const { listOffscreenMissions } = require('../models/offscreen-mission');
const { statList, adventClassList, aspirantPreviewClassList, playerCreatedClassList, classAbilityList } = require('../util/enclave-consts');
const { isAuthenticated, authOptional } = require('../util/auth');
const { sendError, FRIENDLY_NOT_FOUND } = require('../util/http-error');
const { processMissionImport } = require('../util/mission-import');
const { actorFromLocals } = require('../util/actor');
const { asyncHandler } = require('../util/async-handler');

router.get('/search', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { has_video, character_name, character_class, conduit_name } = req.query;
  const [{ data: classes }, { data: initialMissions }] = await Promise.all([
    getClasses({ is_public: true }),
    getRandomPublicMissions(12, has_video === 'true', character_name, character_class, conduit_name)
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
  const { q, count, has_video, character_name, character_class, conduit_name } = req.query;

  // If no search query, no character name, no character class, no conduit, and no video filter, return empty results
  const hasQuery = q && q.length >= 2;
  const hasCharacterName = character_name && character_name.length >= 2;
  const hasCharacterClass = character_class && character_class.length > 0;
  const hasConduitName = conduit_name && conduit_name.length >= 2;
  const hasVideoFilter = has_video === 'true';

  if (!hasQuery && !hasCharacterName && !hasCharacterClass && !hasConduitName && !hasVideoFilter) {
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
    hasCharacterClass ? character_class : null,
    hasConduitName ? conduit_name : null
  );

  if (error) {
    return sendError(req, res, error);
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
    getOwnMissions(profile, res.locals.supabase),
    getEditableMissions(profile, res.locals.supabase)
  ]);
  
  if (ownError) {
    return sendError(req, res, ownError);
  }
  
  if (editableError) {
    // Log error but don't fail the request - just show empty editable missions
    console.error('Error fetching editable missions:', editableError);
  }
  
  // Mark own missions and filter duplicates from editable
  const ownMissionsMarked = (ownMissions || []).map(m => ({ ...m, isOwner: true }));
  const ownIds = new Set(ownMissionsMarked.map(m => m.id));
  const editableOnly = ((editableMissions && !editableError) ? editableMissions : [])
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

// A submitted lfg_post_id is honoured only when the saver could have opened
// the draft for that post and the post is still unlogged. Anything else drops
// the link rather than failing the save: by this point the user has written a
// log, and losing the back-link costs far less than losing the log.
const resolveLfgPostLink = async (lfgPostId, { profile, supabase }) => {
  if (!lfgPostId || !isValidUuid(lfgPostId)) return null;
  const { data: post } = await getLfgPost(lfgPostId, supabase);
  if (!canLogGame(post, profile?.id)) return null;
  const { data: logged } = await getMissionByLfgPostId(post.id, supabase);
  return logged ? null : post.id;
};

router.get('/new', isAuthenticated, asyncHandler(async (req, res) => {
  const { profile } = res.locals;
  const breadcrumbs = [
    { label: 'Missions', href: '/missions' },
    { label: 'New Mission', href: '/missions/new' }
  ];

  // "Log this game": ?lfg=<post> pre-fills the form from an LFG post whose
  // date has passed. The draft is never persisted -- it exists only as the
  // form values below until the user submits them.
  const lfgPostId = req.query.lfg;
  if (lfgPostId) {
    const { data: post } = isValidUuid(lfgPostId)
      ? await getLfgPost(lfgPostId, res.locals.supabase)
      : { data: null };
    if (!canLogGame(post, profile.id)) {
      return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });
    }

    // One log per post -- send the user to the log that already exists rather
    // than to a draft the unique index would reject on save.
    const { data: logged } = await getMissionByLfgPostId(post.id, res.locals.supabase);
    if (logged) return res.redirect(`/missions/${logged.id}`);

    return res.render('mission-form', {
      profile,
      isNew: true,
      mission: buildMissionDraft(post),
      activeNav: 'missions',
      breadcrumbs
    });
  }

  res.render('mission-form', {
    profile,
    isNew: true,
    activeNav: 'missions',
    breadcrumbs
  });
}));

router.get('/import', isAuthenticated, (req, res) => {
  const { profile } = res.locals;
  res.render('mission-import', {
    profile,
    activeNav: 'missions',
    breadcrumbs: [
      { label: 'Missions', href: '/missions' },
      { label: 'Import Mission', href: '/missions/import' }
    ]
  });
});

router.post('/import', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { inputText } = req.body;
  try {
    const { mission } = await processMissionImport(inputText, profile, res.locals.supabase);
    return res.header('HX-Location', `/missions/${mission.id}`).send();
  } catch (error) {
    return sendError(req, res, error);
  }
});

router.post('/', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { characters, ...missionData } = req.body;

  // Normalize host_id: empty string means no linked profile
  if (!missionData.host_id) {
    missionData.host_id = null;
  }

  missionData.lfg_post_id = await resolveLfgPostLink(missionData.lfg_post_id, res.locals);

  // Parse date from datetime-local input format
  let missionDate = missionData.date;
  if (missionDate && !missionDate.includes('T')) {
    // If date doesn't have time, add default time
    missionDate = missionDate + 'T00:00';
  }
  if (missionDate) {
    missionDate = new Date(missionDate).toISOString();
  } else {
    missionDate = new Date().toISOString();
  }

  // Use form outcome or default to 'pending'
  const outcome = missionData.outcome || 'pending';

  // Create the mission
  const { data: missionRes, error: missionError } = await createMission(actor, {
    ...missionData,
    date: missionDate,
    outcome: outcome
  });

  if (missionError) {
    return sendError(req, res, missionError);
  }
  if (!missionRes || missionRes.length === 0) {
    return sendError(req, res, null, { status: 400, message: 'Mission creation returned no rows' });
  }

  const mission = missionRes[0];

  // Add characters to the mission. Filtered to real ids first: the mission row
  // is already committed above, so a junk value ('' from an empty hidden input,
  // a single id arriving as a bare string rather than an array) would 500 the
  // request and strand a mission the user is never told about.
  const characterIds = [].concat(characters || []).filter(isValidUuid);
  for (const characterId of characterIds) {
    const { error: characterError } = await addCharacterToMission(actor, mission.id, characterId);
    if (characterError) {
      return sendError(req, res, characterError);
    }
  }

  return res.header('HX-Location', `/missions/${mission.id}/edit`).send();
}));

// ============================================
// Similar Missions / Deduplication Endpoints
// ============================================

// Search for similar missions (for deduplication)
router.get('/similar', isAuthenticated, async (req, res) => {
  const { date, name, exclude_id } = req.query;

  if (!date) {
    return sendError(req, res, null, { status: 400, message: 'Date is required' });
  }

  const { data: missions, error } = await searchSimilarMissions(date, name, exclude_id, 3, res.locals.supabase);
  if (error) {
    return sendError(req, res, error);
  }

  res.render('partials/similar-missions', {
    layout: false,
    profile: res.locals.profile,
    missions
  });
});

router.get('/:id', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { data: mission, error } = await getMission(id, res.locals.supabase);
  if (error) {
    return sendError(req, res, error);
  } else {
    const missionDate = new Date(mission.date);

    res.render('mission', {
      profile,
      og: res.locals.openGraph({
        type: 'article',
        title: mission.name,
        description: [
          Number.isNaN(missionDate.getTime())
            ? null
            : missionDate.toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' }),
          mission.host_name ? `Conduit ${mission.host_name}` : null,
          mission.summary
        ].filter(Boolean).join(' · '),
        suppress: mission.is_public === false
      }),
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
    return sendError(req, res, null, { status: 403, title: 'No access', message: 'You do not have permission to edit this mission' });
  }

  const [{ data: mission, error }, { data: editors }, userIsCreator] = await Promise.all([
    getMission(id, res.locals.supabase),
    getMissionEditors(id, res.locals.supabase),
    isCreator(id, profile)
  ]);

  if (error) {
    return sendError(req, res, error);
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

router.put('/:id', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  let { characters, unregistered_character_names, ...missionData } = req.body;

  delete missionData.q;
  // The LFG back-link is set once, when the log is created from the post. No
  // edit form offers it, so a submitted value here is only ever a forged one.
  delete missionData.lfg_post_id;

  // Normalize host_id: empty string means no linked profile
  if (!missionData.host_id) {
    missionData.host_id = null;
  }

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
  const { data, error } = await updateMission(actor, req.params.id, missionData);
  if (error) {
    return sendError(req, res, error);
  }

  // Get current characters
  const { data: currentCharacters, error: characterError } = await getMissionCharacters(req.params.id, res.locals.supabase);
  const newIds = characters || [];
  const currentIds = currentCharacters.map(mc => mc.character_id);

  // Remove characters that are no longer in the mission
  for (const id of currentIds) {
    if (!newIds.includes(id)) {
      const { error: removeError } = await removeCharacterFromMission(actor, req.params.id, id);
      if (removeError) {
        return sendError(req, res, removeError);
      }
    }
  }

  // Add new characters
  for (const id of newIds) {
    if (!currentIds.includes(id)) {
      const { error: addError } = await addCharacterToMission(actor, req.params.id, id);
      if (addError) {
        return sendError(req, res, addError);
      }
    }
  }

  return res.header('HX-Location', `/missions/${req.params.id}`).send();
}));

router.delete('/:id', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { error } = await deleteMission(actor, req.params.id);
  if (error) {
    return sendError(req, res, error);
  } else {
    return res.header('HX-Location', '/missions').send();
  }
}));

router.post('/:id/characters/:characterId', isAuthenticated, asyncHandler(async (req, res) => {
  const { profile } = res.locals;
  const actor = actorFromLocals(res.locals);
  const { id, characterId } = req.params;
  const canEdit = await canEditMission(id, profile);
  if (!canEdit) {
    return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });
  }
  const { error } = await addCharacterToMission(actor, id, characterId);
  if (error) {
    return sendError(req, res, error);
  }
  const { data: character, error: characterError } = await getCharacter(characterId, res.locals.supabase);
  if (characterError || !character) {
    return sendError(req, res, characterError, { message: 'Character not found' });
  }
  return res.render('partials/selected-character-item', {
    layout: false,
    mission: { id },
    character: { id: character.id, name: character.name },
  });
}));

// Search characters (JSON, for link UI)
router.get('/:id/search-characters', isAuthenticated, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.json([]);
  }
  const { data, error } = await searchPublicCharacters(q, 8);
  if (error) {
    return res.json([]);
  }
  res.json((data || []).map(c => ({ id: c.id, name: c.name, class: c.class, is_deceased: c.is_deceased })));
});

// Link an unregistered character name to a real character
// Adds the character to the mission and removes the unregistered name
router.post('/:id/link-character', isAuthenticated, asyncHandler(async (req, res) => {
  const { profile } = res.locals;
  const actor = actorFromLocals(res.locals);
  const { id } = req.params;
  const { character_id, unregistered_name } = req.body;

  if (!character_id || !unregistered_name) {
    return sendError(req, res, null, { status: 400, message: 'Character ID and unregistered name are required' });
  }

  const canEdit = await canEditMission(id, profile);
  if (!canEdit) {
    return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });
  }

  // Add character to mission
  const { error: addError } = await addCharacterToMission(actor, id, character_id);
  if (addError) {
    return sendError(req, res, addError);
  }

  // Remove the unregistered name
  const { data: mission } = await getMission(id, res.locals.supabase);
  if (mission) {
    const names = (mission.unregistered_character_names || [])
      .filter(n => n !== unregistered_name);
    await setUnregisteredCharacterNames(actor, id, names);
  }

  const { data: character, error: characterError } = await getCharacter(character_id, res.locals.supabase);
  if (characterError || !character) {
    return sendError(req, res, characterError, { message: 'Character not found' });
  }
  return res.render('partials/selected-character-item', {
    layout: false,
    mission: { id },
    character: { id: character.id, name: character.name },
  });
}));

router.delete('/:id/characters/:characterId', isAuthenticated, asyncHandler(async (req, res) => {
  const { profile } = res.locals;
  const actor = actorFromLocals(res.locals);
  const { id, characterId } = req.params;
  const canEdit = await canEditMission(id, profile);
  if (!canEdit) {
    return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });
  }
  const { error } = await removeCharacterFromMission(actor, id, characterId);
  if (error) {
    return sendError(req, res, error);
  }
  return res.send('');
}));

router.get('/character/:id', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { data: character, error } = await getCharacter(id, res.locals.supabase);

  if (error) return sendError(req, res, error);
  if (character.is_public === false && (!profile || character.creator_id !== profile.id)) {
    return sendError(req, res, null, { status: 404, message: 'Not found' });
  }

  const { data: missions, error: missionsError } = await getCharacterAllMissions(id);
  if (missionsError) return sendError(req, res, missionsError);

  const { data: offscreenMissions } = await listOffscreenMissions({
    characterId: id,
    supabase: res.locals.supabase
  });

  const merged = [
    ...(missions || []).map(m => ({ _kind: 'mission', ...m })),
    ...(offscreenMissions || []).map(om => ({ _kind: 'offscreen', ...om }))
  ];
  const dateOf = (e) => e._kind === 'offscreen' ? e.source_mission_date : e.date;
  merged.sort((a, b) => new Date(dateOf(b)) - new Date(dateOf(a)));

  res.render('character-missions', {
    profile,
    character,
    missions,
    mergedMissions: merged,
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
    return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });
  }

  const { data: editors, error } = await getMissionEditors(id, res.locals.supabase);
  if (error) {
    return sendError(req, res, error);
  }

  res.render('partials/mission-editors', {
    layout: false,
    editors,
    missionId: id,
    canRemoveEditors: await isCreator(id, profile)
  });
});

// Add an editor to a mission
router.post('/:id/editors', isAuthenticated, asyncHandler(async (req, res) => {
  const { profile } = res.locals;
  const actor = actorFromLocals(res.locals);
  const { id } = req.params;
  const { profile_id } = req.body;

  if (!profile_id) {
    return sendError(req, res, null, { status: 400, message: 'Profile ID is required' });
  }

  // Validate profile_id is a valid UUID format
  if (!isValidUuid(profile_id)) {
    return sendError(req, res, null, { status: 400, message: 'Invalid profile ID format' });
  }

  // Prevent adding creator or host as editor (redundant)
  const { data: mission, error: missionError } = await getMission(id, res.locals.supabase);
  if (missionError) {
    return sendError(req, res, null, { status: 400, message: 'Mission not found' });
  }
  if (mission && (mission.creator_id === profile_id || mission.host_id === profile_id)) {
    return sendError(req, res, null, { status: 400, message: 'Creator and host are already editors by default' });
  }

  // Managing editors is creator-only — enforced by the service (addMissionEditor).
  const { error } = await addMissionEditor(actor, id, profile_id);
  if (error) {
    return sendError(req, res, error);
  }

  // Return updated editors list
  const { data: editors } = await getMissionEditors(id, res.locals.supabase);
  res.render('partials/mission-editors', {
    layout: false,
    editors,
    missionId: id,
    canRemoveEditors: await isCreator(id, profile)
  });
}));

// Remove an editor from a mission
router.delete('/:id/editors/:profileId', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { id, profileId } = req.params;

  // Managing editors is creator-only — enforced by the service (removeMissionEditor).
  const { error } = await removeMissionEditor(actor, id, profileId);
  if (error) {
    return sendError(req, res, error);
  }

  // Return updated editors list
  const { data: editors } = await getMissionEditors(id, res.locals.supabase);
  res.render('partials/mission-editors', {
    layout: false,
    editors,
    missionId: id,
    canRemoveEditors: true
  });
}));

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
    return sendError(req, res, null, { status: 403, title: 'No access', message: 'You must be able to edit both missions to merge them' });
  }

  const { data: preview, error } = await previewMergeMissions(id, targetId);
  if (error) {
    return sendError(req, res, error);
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
router.post('/:id/merge/:targetId', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { id, targetId } = req.params;

  const { data: mergedMission, error } = await mergeMissions(actor, id, targetId);
  if (error) {
    return sendError(req, res, error);
  }

  return res.header('HX-Location', `/missions/${mergedMission.id}`).send();
}));

module.exports = router;
