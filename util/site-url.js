// Absolute URLs need an origin the document can trust. SITE_URL wins when set
// (Host is client controlled, and behind a TLS-terminating proxy req.protocol
// reads as http); the fallback is what makes local dev work.
const resolveBaseUrl = (req) => {
  const configured = (process.env.SITE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  const forwarded = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  return `${forwarded || req.protocol}://${req.get('host')}`;
};

module.exports = { resolveBaseUrl };
