const express = require('express');
const router = express.Router();
const { getMissions, getMission, createMission, updateMission, deleteMission, addCharacterToMission, removeCharacterFromMission } = require('../util/supabase');
const { isAuthenticated, authOptional } = require('../util/auth');

router.get('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: missions, error } = await getMissions();
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('mission-list', { profile, missions });
  }
});

router.get('/new', isAuthenticated, (req, res) => {
  const { profile } = res.locals;
  res.render('mission-form', { profile, isNew: true });
});

router.post('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data, error } = await createMission(req.body, profile);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', '/missions').send();
  }
});

router.get('/:id', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { data: mission, error } = await getMission(req.params.id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('mission', { profile, mission });
  }
});

router.get('/:id/edit', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: mission, error } = await getMission(req.params.id);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.render('mission-form', { profile, mission, isNew: false });
  }
});

router.put('/:id', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data, error } = await updateMission(req.params.id, req.body, profile);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', `/missions/${req.params.id}`).send();
  }
});

router.delete('/:id', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { error } = await deleteMission(req.params.id, profile);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.header('HX-Location', '/missions').send();
  }
});

router.post('/:id/characters', isAuthenticated, async (req, res) => {
  const { missionId, characterId } = req.body;
  const { error } = await addCharacterToMission(missionId, characterId);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.send('Character added to mission');
  }
});

router.delete('/:id/characters/:characterId', isAuthenticated, async (req, res) => {
  const { id, characterId } = req.params;
  const { error } = await removeCharacterFromMission(id, characterId);
  if (error) {
    res.status(400).send(error.message);
  } else {
    res.send('Character removed from mission');
  }
});

module.exports = router;
