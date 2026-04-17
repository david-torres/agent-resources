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

module.exports = { isSafeHttpUrl, sanitizeHttpUrl };
