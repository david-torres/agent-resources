function isSafeHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeHttpUrl(value) {
  if (!isSafeHttpUrl(value)) return null;
  return new URL(value).toString();
}

function sanitizeUrlFields(obj, fields) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const field of fields) {
    if (field in obj) {
      obj[field] = obj[field] ? sanitizeHttpUrl(obj[field]) : null;
    }
  }
  return obj;
}

module.exports = { isSafeHttpUrl, sanitizeHttpUrl, sanitizeUrlFields };
