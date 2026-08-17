const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../util/async-handler');
const { getSitemapXml } = require('../services/sitemap/build');

// <loc> must be absolute, so the document needs its own origin. SITE_URL wins
// when set (Host is client controlled, and behind a TLS-terminating proxy
// req.protocol reads as http); the fallback is what makes local dev work.
const resolveBaseUrl = (req) => {
  const configured = (process.env.SITE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  const forwarded = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  return `${forwarded || req.protocol}://${req.get('host')}`;
};

router.get('/sitemap.xml', asyncHandler(async (req, res) => {
  const { xml, failures } = await getSitemapXml({ baseUrl: resolveBaseUrl(req) });

  res.set('Content-Type', 'application/xml; charset=utf-8');
  // A degraded document is marked short-lived so crawlers and any CDN in front
  // of us come back for the complete one soon.
  res.set('Cache-Control', failures.length === 0 ? 'public, max-age=900' : 'public, max-age=60');
  return res.send(xml);
}));

module.exports = router;
