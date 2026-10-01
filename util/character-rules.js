// Published edition/version and character mechanics are separate identities.
const V2_MODES = new Set(['aspirant', 'aspiring']);
const rulesError = message => Object.assign(new Error(message), { code: 'CHARACTER_RULES_UNAVAILABLE', status: 503 });

const validateClassRules = (classRules, { allowLegacy = true } = {}) => {
  if (!classRules || typeof classRules !== 'object') throw rulesError('Class rules are unavailable');
  const { rules_edition: edition, rules_version: version } = classRules;
  if (edition === 'advent' && ['v1', 'v2'].includes(version)) return classRules;
  if (edition === 'aspirant' && (version === 'v1' || (allowLegacy && version === 'v2'))) return classRules;
  throw rulesError(`Unsupported class rules: ${edition || 'unknown'} ${version || 'unknown'}`);
};

const resolveCharacterMechanics = ({ classRules, creatorMode } = {}) => {
  if (classRules !== null) validateClassRules(classRules);
  if (creatorMode != null && creatorMode !== '' && !['advent', 'aspirant', 'aspiring'].includes(creatorMode)) {
    throw rulesError(`Unsupported character mode: ${creatorMode}`);
  }
  if (V2_MODES.has(creatorMode)) return 'advent-v2';
  if (classRules === null) return 'advent-v1';
  return classRules.rules_edition === 'aspirant' || classRules.rules_version === 'v2' ? 'advent-v2' : 'advent-v1';
};

// Deprecated effective-mechanics alias. The old version-only input is retained
// for adapter compatibility; application readers must provide complete classRules.
const characterRulesVersion = (args = {}) => {
  const classRules = Object.hasOwn(args, 'classRules') ? args.classRules
    : args.classRulesVersion == null ? null : { rules_edition: 'advent', rules_version: args.classRulesVersion };
  return resolveCharacterMechanics({ classRules, creatorMode: args.creatorMode }) === 'advent-v2' ? 'v2' : 'v1';
};

const assertPublishedClassRules = classRules => {
  try { return validateClassRules(classRules, { allowLegacy: false }); }
  catch (error) { throw Object.assign(error, { code: 'INVALID_CLASS_RULES', status: 400 }); }
};
module.exports = { assertPublishedClassRules, resolveCharacterMechanics, characterRulesVersion, validateClassRules, rulesError };
