const { deriveCharacterTotals } = require('../../util/character-derived');
const { economyFor } = require('../../util/merx-economy');

const progressFields = ['completed_missions', 'commissary_reward', 'level'];

const calculateCharacterProgress = ({ character, realMissions, offscreenMissions, classRules }) => {
  const derived = deriveCharacterTotals({
    character,
    realMissions,
    offscreenMissions,
    rulesVersion: classRules.data || 'v1',
    economy: economyFor({
      contentFormat: classRules.contentFormat,
      creatorMode: character.creator_mode
    })
  });
  return Object.fromEntries(progressFields.map(field => [field, derived[field]]));
};

// Mission writes happen outside the character editor. Keep its stored counters
// in sync with the same derivation the editor uses, without changing a
// character whose owner opted out of automatic calculation.
const inspectCharacterProgress = async (characterId, repository) => {
  const { data: character, error: characterError } = await repository.getCharacter(characterId);
  if (characterError) throw characterError;
  if (!character || !character.auto_calculate) return null;

  const [missions, offscreenMissions, classRules] = await Promise.all([
    repository.getRealMissions(characterId),
    repository.listOffscreenMissions(characterId),
    repository.getClassRulesVersion(character.class_id)
  ]);
  if (missions.error || offscreenMissions.error || classRules.error) {
    throw missions.error || offscreenMissions.error || classRules.error;
  }

  const totals = calculateCharacterProgress({
    character,
    realMissions: missions.data || [],
    offscreenMissions: offscreenMissions.data || [],
    classRules
  });
  const current = Object.fromEntries(progressFields.map(field => [field, character[field]]));
  const changed = progressFields.some(field => current[field] !== totals[field]);
  return { current, totals, changed };
};

const recalculateCharacterProgress = async (characterId, repository) => {
  const inspection = await inspectCharacterProgress(characterId, repository);
  if (!inspection || !inspection.changed) return inspection;
  const { error } = await repository.updateCharacterProgress(characterId, inspection.totals);
  if (error) throw error;
  return inspection;
};

module.exports = { calculateCharacterProgress, inspectCharacterProgress, recalculateCharacterProgress };
