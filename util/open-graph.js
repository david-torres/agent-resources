const { resolveBaseUrl } = require('./site-url');

const SITE_NAME = 'Agent Resources';
const SITE_TAGLINE = 'Agent Resources is a tool for Enclave players to create and share '
  + 'Enclave characters, look for games, and log missions.';

// Facebook truncates around 300 characters and Discord around 350; 200 keeps
// the card readable on a phone, which is where these links get opened.
const OG_DESCRIPTION_LIMIT = 200;

const toPlainText = (value) => String(value)
  .replace(/<[^>]*>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const truncate = (text) => {
  if (text.length <= OG_DESCRIPTION_LIMIT) return text;

  const clipped = text.slice(0, OG_DESCRIPTION_LIMIT - 1);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).replace(/[\s.,;:!?-]+$/, '')}…`;
};

// A card with no image beats a card with a broken one, so anything a crawler
// could not fetch over http is dropped rather than guessed at.
//
// image_crop is deliberately ignored: the crop is applied in the browser by
// public/js, and a crawler runs no JavaScript. Honoring it would mean fetching
// and re-encoding arbitrary remote images server-side, so the card shows the
// uncropped original instead.
const absoluteImage = (image, baseUrl) => {
  if (!image) return undefined;
  const trimmed = String(image).trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `${baseUrl}${trimmed}`;
  return undefined;
};

const buildOpenGraph = ({ baseUrl, path, title, description, image, type = 'website', suppress = false }) => {
  const root = String(baseUrl).replace(/\/+$/, '');
  const canonicalPath = String(path).split(/[?#]/)[0];

  const og = { type, title: toPlainText(title), url: `${root}${canonicalPath}` };
  if (suppress) return og;

  const text = description ? toPlainText(description) : '';
  if (text) og.description = truncate(text);

  const src = absoluteImage(image, root);
  if (src) og.image = src;

  return og;
};

// Gives every page the site-wide card and hands routes a builder that already
// knows the origin and the page's own path, so a detail route only supplies
// what makes it different.
const openGraphDefaults = (req, res, next) => {
  const baseUrl = resolveBaseUrl(req);

  res.locals.openGraph = (options = {}) => buildOpenGraph({
    baseUrl,
    path: req.originalUrl,
    title: SITE_NAME,
    description: SITE_TAGLINE,
    ...options
  });
  res.locals.og = res.locals.openGraph();

  next();
};

module.exports = { buildOpenGraph, openGraphDefaults, OG_DESCRIPTION_LIMIT, SITE_NAME, SITE_TAGLINE };
