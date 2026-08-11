const { sanitizeUrlFields } = require('../../util/url');

const cloneInput = (input) => ({ ...(input || {}) });

// Mission forms share a mutable sanitizer with older callers. Apply it only
// to this copy so service consumers can safely reuse their submitted payload.
const normalizeMissionInput = (input, { creatorId } = {}) => {
  const data = cloneInput(input);
  if (creatorId) data.creator_id = creatorId;
  sanitizeUrlFields(data, ['media_url']);
  return data;
};

module.exports = { cloneInput, normalizeMissionInput };
