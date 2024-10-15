const express = require('express');
const router = express.Router();
const { getOwnCharacters, getCharacter, createCharacter, updateCharacter, deleteCharacter } = require('../util/supabase');
const { statList, adventClassList, aspirantPreviewClassList, playerCreatedClassList, personalityMap, classGearList, classAbilityList } = require('../util/enclave-consts');
const { isAuthenticated, authOptional } = require('../util/auth');

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

router.get('/:id', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { data: character, error } = await getCharacter(id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    if (character.is_public === false && (!profile || character.creator_id !== profile.id)) {
      res.status(404).send('Not found').send();
    } else {
      res.render('character', {
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
  const { profile } = res.locals;
  const { id } = req.params;
  const { data, error } = await updateCharacter(id, req.body, profile);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', `/characters/${id}`).send();
  }
});

router.delete('/:id', isAuthenticated, async (req, res) => {
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
