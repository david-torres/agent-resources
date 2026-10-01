const { deriveCharacterTotals } = require('../../util/character-derived');
const { familyResolver } = require('../../util/class-family');
const { economyFor } = require('../../util/merx-economy');
const { resolveCharacterMechanics } = require('../../util/character-rules');

const progressFields = ['completed_missions', 'commissary_reward', 'level'];

const calculateCharacterProgress = ({ character, realMissions, offscreenMissions, classRules, classFamilyOf = null }) => {
  if (classRules.error) throw classRules.error;
  const derived = deriveCharacterTotals({
    character,
    realMissions,
    offscreenMissions,
    mechanics: resolveCharacterMechanics({
      classRules: Object.hasOwn(classRules, 'classRules') ? classRules.classRules
        : typeof classRules.data === 'object' ? classRules.data
          : { rules_edition: 'advent', rules_version: classRules.data },
      creatorMode: character.creator_mode
    }),
    economy: economyFor({
      contentFormat: classRules.contentFormat,
      creatorMode: character.creator_mode
    }),
    classFamilyOf
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

  const [missions, offscreenMissions, classRules, familyRows] = await Promise.all([
    repository.getRealMissions(characterId),
    repository.listOffscreenMissions(characterId),
    repository.getClassRulesVersion(character.class_id),
    character.class_id ? repository.getClassFamilyRows() : { data: [], error: null }
  ]);
  const readError = missions.error || offscreenMissions.error || classRules.error || familyRows.error;
  if (readError) throw readError;

  const totals = calculateCharacterProgress({
    character,
    realMissions: missions.data || [],
    offscreenMissions: offscreenMissions.data || [],
    classRules,
    classFamilyOf: familyResolver(familyRows.data, character.class_id)
  });
  const current = Object.fromEntries(progressFields.map(field => [field, character[field]]));
  const changed = progressFields.some(field => current[field] !== totals[field]);
  return { current, totals, changed, ...(character.updated_at ? { expectedUpdatedAt: character.updated_at } : {}) };
};

const recalculateCharacterProgress = async (characterId, repository) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const inspection = await inspectCharacterProgress(characterId, repository);
    if (!inspection || !inspection.changed) return inspection;
    const { error, stale } = await repository.updateCharacterProgress(characterId, inspection.totals, inspection.expectedUpdatedAt);
    if (error) throw error;
    if (!stale) return inspection;
  }
  throw Object.assign(new Error('Character progress changed concurrently; retry the operation'), { status: 409 });
};

module.exports = { calculateCharacterProgress, inspectCharacterProgress, recalculateCharacterProgress };
