const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * Middleware that validates req.params.id is a valid UUID.
 * Returns 400 if invalid, preventing bad values from reaching the database.
 */
function validateIdParam(req, res, next, value) {
  if (!isValidUuid(value)) {
    return res.status(400).send('Invalid ID');
  }
  next();
}

function escapeLikePattern(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function registerUuidParams(router, names) {
  for (const name of names) {
    router.param(name, validateIdParam);
  }
}

function countWords(value) {
  if (typeof value !== 'string') return 0;
  const trimmed = value.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Guard for AI import entry points: ensures we never send empty/whitespace
 * input to the LLM. Throws on missing, non-string, or blank text; otherwise
 * returns the trimmed text so callers can reuse it.
 */
function assertNonEmptyImportText(inputText, subject = 'content') {
  if (typeof inputText !== 'string' || inputText.trim().length === 0) {
    throw new Error(`No ${subject} provided to import`);
  }
  return inputText.trim();
}

function validateAbilityPerks(perks, { wordLimit = 25, perAbility = 5 } = {}) {
  if (!Array.isArray(perks)) return { ok: true };

  const errors = [];
  const countsByAbility = new Map();

  for (let i = 0; i < perks.length; i++) {
    const perk = perks[i];
    if (!perk || typeof perk !== 'object') continue;

    const abilityId = perk.class_ability_id;
    const text = typeof perk.text === 'string' ? perk.text : '';
    const words = countWords(text);
    if (words > wordLimit) {
      errors.push(`Perk #${i + 1}: must be at most ${wordLimit} words (was ${words}).`);
    }

    if (abilityId) {
      const next = (countsByAbility.get(abilityId) || 0) + 1;
      countsByAbility.set(abilityId, next);
    }
  }

  for (const [abilityId, count] of countsByAbility.entries()) {
    if (count > perAbility) {
      errors.push(`Ability ${abilityId}: at most ${perAbility} perks per ability (had ${count}).`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

module.exports = {
  isValidUuid, validateIdParam, escapeLikePattern, registerUuidParams,
  countWords, validateAbilityPerks, assertNonEmptyImportText
};
