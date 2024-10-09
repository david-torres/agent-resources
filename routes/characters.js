const express = require('express');
const router = express.Router();
const { getUser, getOwnCharacters, getCharacter, createCharacter, updateCharacter, deleteCharacter } = require('../util/supabase');
const { statList, adventClassList, aspirantPreviewClassList, playerCreatedClassList, personalityMap, classGearList } = require('../util/enclave-consts');
const { isAuthenticated } = require('../util/is-authenticated');

router.get('/', isAuthenticated, async (req, res) => {
  const user = await getUser();
  const { data, error } = await getOwnCharacters();
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('character-list', { user, characters: data });
  }
});

router.get('/new', isAuthenticated, (req, res) => {
  const user = getUser();
  res.render('character-form', {
    user,
    isNew: true,
    statList,
    adventClassList,
    aspirantPreviewClassList,
    playerCreatedClassList,
    personalityMap,
    classGearList
  });
});

router.get('/:id/edit', isAuthenticated, async (req, res) => {
  const user = await getUser();
  const { data:character, error } = await getCharacter(req.params.id);
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
      classGearList
    });
  }
});

router.post('/', isAuthenticated, async (req, res) => {
  const { data, error } = await createCharacter(req.body);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', '/characters').send();
  }
});

router.get('/class-gear', (req, res) => {
  res.render('partials/character-class-gear', { layout: false, classGearList });
});

router.get('/:id', async (req, res) => {
  const user = await getUser();
  const { id } = req.params;
  const { data, error } = await getCharacter(id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('character', {
      user,
      character: data,
      statList,
      adventClassList,
      aspirantPreviewClassList,
      playerCreatedClassList
    });
  }
});

router.put('/:id', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { data, error } = await updateCharacter(id, req.body);

  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', `/characters/${id}`).send();
  }
});

router.delete('/:id', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { error } = await deleteCharacter(id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', '/characters').send();
  }
});

module.exports = router;
