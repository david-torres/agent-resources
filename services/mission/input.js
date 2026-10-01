const { sanitizeUrlFields } = require('../../util/url');
const { trimStrings } = require('../../util/trim-input');

const cloneInput = (input) => ({ ...(input || {}) });

// Mission forms share a mutable sanitizer with older callers. Apply it only
// to this copy so service consumers can safely reuse their submitted payload.
const normalizeMissionInput = (input, { creatorId } = {}) => {
  const data = trimStrings(cloneInput(input));
  if (creatorId) data.creator_id = creatorId;
  // Omitted stakes preserve existing values on updates; new rows use DB defaults.
  for (const field of ['difficulty', 'danger']) {
    if (!Object.hasOwn(data, field)) continue;
    if (!['conventional', 'critical', 'crisis'].includes(data[field])) {
      const error = new Error(`${field} must be Conventional, Critical, or Crisis`);
      error.status = 400;
      throw error;
    }
  }
  sanitizeUrlFields(data, ['media_url']);
  return data;
};

module.exports = { cloneInput, normalizeMissionInput };
