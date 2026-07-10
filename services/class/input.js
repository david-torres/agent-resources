const { sanitizeUrlFields } = require('../../util/url');

const cloneInput = (input) => ({ ...(input || {}) });

const normalizeClassInput = (input) => {
  const data = cloneInput(input);
  sanitizeUrlFields(data, ['image_url']);
  return data;
};

module.exports = { cloneInput, normalizeClassInput };
