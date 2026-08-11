const { isAdmin, isSystem } = require('../../util/actor');

// A mission may be edited by its creator, its host, an editor, or an
// admin/system actor. Operates over pre-loaded rows (no I/O) so the
// repository owns every privileged read.
const canEditMission = (actor, { mission, editorRow } = {}) => {
  if (isSystem(actor) || isAdmin(actor)) return true;
  const isCreatorOrHost = !!actor?.profileId && !!mission &&
    (actor.profileId === mission.creator_id || actor.profileId === mission.host_id);
  return isCreatorOrHost || !!editorRow;
};

// Only the mission's creator (or an admin/system actor) may manage editors
// or delete the mission — narrower than canEditMission, which also admits
// the host and any editor.
const isMissionCreator = (actor, mission) => {
  if (isSystem(actor) || isAdmin(actor)) return true;
  return !!actor?.profileId && !!mission && actor.profileId === mission.creator_id;
};

module.exports = { canEditMission, isMissionCreator };
