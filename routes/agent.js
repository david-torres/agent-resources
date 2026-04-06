const express = require('express');
const router = express.Router();
const { isAgentAuthenticated } = require('../util/auth');
const { listClassesForAgent, getClassForAgent } = require('../models/class');

const parseBooleanFilter = (value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

const getActorContext = (res) => ({
  userId: res.locals.user?.id || null,
  profileId: res.locals.profile?.id || null,
  role: res.locals.profile?.role || null
});

router.use(isAgentAuthenticated);

router.get('/me', async (req, res) => {
  return res.json({
    user: {
      id: res.locals.user.id
    },
    profile: {
      id: res.locals.profile.id,
      user_id: res.locals.profile.user_id,
      name: res.locals.profile.name,
      role: res.locals.profile.role
    },
    token: res.locals.agentToken
  });
});

router.get('/classes', async (req, res) => {
  const filters = {
    rules_edition: req.query.rules_edition,
    rules_version: req.query.rules_version,
    status: req.query.status,
    is_player_created: parseBooleanFilter(req.query.is_player_created)
  };

  const { data, error } = await listClassesForAgent(filters, getActorContext(res));
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ classes: data });
});

router.get('/classes/:id', async (req, res) => {
  const { data, error } = await getClassForAgent(req.params.id, getActorContext(res));
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  if (!data) {
    return res.status(404).json({ error: 'Class not found' });
  }

  return res.json({ class: data });
});

module.exports = router;
