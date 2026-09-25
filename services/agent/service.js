const { listClassesForAgent, getClassForAgent } = require('../../models/class');
const { searchCharactersForAgent, getCharacterForAgent } = require('../../models/character');

const parseBooleanFilter = (value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

// Unlike lfg's buildAgentActor (models/lfg.js), this deliberately preserves
// the profile's REAL role (e.g. 'admin') rather than stripping it: an admin's
// agent token gets the same admin-wide read visibility an admin's session
// would, matching the pre-refactor resolveClassAgentAccess contract.
const actorFromAuth = ({ user, profile } = {}) => ({
  userId: user?.id || null,
  profileId: profile?.id || null,
  role: profile?.role || null
});

const buildMe = ({ user, profile, agentToken }) => ({
  user: { id: user.id },
  profile: {
    id: profile.id,
    user_id: profile.user_id,
    name: profile.name,
    role: profile.role,
    timezone: profile.timezone || 'UTC'
  },
  token: agentToken
});

const listClasses = (rawFilters = {}, actor) => listClassesForAgent({
  rules_edition: rawFilters.rules_edition,
  rules_version: rawFilters.rules_version,
  status: rawFilters.status,
  is_player_created: parseBooleanFilter(rawFilters.is_player_created)
}, actor);

const getClass = (id, actor) => getClassForAgent(id, actor);

const searchCharacters = (q, actor) => searchCharactersForAgent(typeof q === 'string' ? q : '', actor);

const getCharacter = (id, actor) => getCharacterForAgent(id, actor);

module.exports = {
  actorFromAuth,
  buildMe,
  listClasses,
  getClass,
  searchCharacters,
  getCharacter
};
