const { sanitizeUrlFields } = require('../../util/url');
const { trimStrings } = require('../../util/trim-input');
const { normalizeNewlines } = require('../../util/newlines');
const { buildClassTeaser } = require('./teaser');

const cloneInput = (input) => ({ ...(input || {}) });

const isBlank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

// Line endings first, then ends-only trimming: a value ending in CRLF becomes
// LF and is then trimmed away, rather than leaving a stray CR behind.
const normalizeClassInput = (input) => {
  const data = trimStrings(normalizeNewlines(cloneInput(input)));
  sanitizeUrlFields(data, ['image_url']);
  if (isBlank(data.teaser)) {
    data.teaser = buildClassTeaser(data.overview, data.designer);
  }
  return data;
};

module.exports = { cloneInput, normalizeClassInput };
