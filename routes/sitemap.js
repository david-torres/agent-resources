const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../util/async-handler');
const { getSitemapXml } = require('../services/sitemap/build');
const { resolveBaseUrl } = require('../util/site-url');

router.get('/sitemap.xml', asyncHandler(async (req, res) => {
  const { xml, failures } = await getSitemapXml({ baseUrl: resolveBaseUrl(req) });

  res.set('Content-Type', 'application/xml; charset=utf-8');
  // A degraded document is marked short-lived so crawlers and any CDN in front
  // of us come back for the complete one soon.
  res.set('Cache-Control', failures.length === 0 ? 'public, max-age=900' : 'public, max-age=60');
  return res.send(xml);
}));

module.exports = router;
