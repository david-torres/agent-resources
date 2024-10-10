const express = require('express');
const router = express.Router();
const { getProfile, getOwnCharacters, getCharacter, createCharacter, updateCharacter, deleteCharacter } = require('../util/supabase');
const { statList, adventClassList, aspirantPreviewClassList, playerCreatedClassList, personalityMap, classGearList, classAbilityList } = require('../util/enclave-consts');
const { isAuthenticated, authOptional } = require('../util/auth');

router.get('/', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const { data, error } = await getOwnCharacters(user);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('character-list', { user, characters: data });
  }
});

router.get('/new', isAuthenticated, (req, res) => {
  const user = res.locals.user;
  res.render('character-form', {
    user,
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
  const user = res.locals.user;
  const { data: character, error } = await getCharacter(req.params.id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('character-form', {
      user,
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
  const user = res.locals.user;
  const { data, error } = await createCharacter(req.body, user);
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

router.get('/:id', authOptional, async (req, res) => {
  const user = res.locals.user;
  let profile = null;
  if (user) profile = await getProfile(user);
  const { id } = req.params;
  const { data: character, error } = await getCharacter(id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    if (character.is_public === false && (!profile || character.creator_id !== profile.id)) {
      res.status(404).send('Not found').send();
    } else {
      res.render('character', {
        user,
        profile,
        character,
        statList,
        adventClassList,
        aspirantPreviewClassList,
        playerCreatedClassList,
        classAbilityList
      });
    }
  }
});

router.put('/:id', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const { id } = req.params;
  const { data, error } = await updateCharacter(id, req.body, user);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', `/characters/${id}`).send();
  }
});

router.delete('/:id', isAuthenticated, async (req, res) => {
  const user = res.locals.user;
  const { id } = req.params;
  const { error } = await deleteCharacter(id, user);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', '/characters').send();
  }
});

module.exports = router;
