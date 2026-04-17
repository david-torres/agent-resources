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

module.exports = { isValidUuid, validateIdParam, escapeLikePattern, registerUuidParams };
