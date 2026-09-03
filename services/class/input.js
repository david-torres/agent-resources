const { sanitizeUrlFields } = require('../../util/url');
const { trimStrings } = require('../../util/trim-input');

const cloneInput = (input) => ({ ...(input || {}) });

const normalizeClassInput = (input) => {
  const data = trimStrings(cloneInput(input));
  sanitizeUrlFields(data, ['image_url']);
  return data;
};

module.exports = { cloneInput, normalizeClassInput };
