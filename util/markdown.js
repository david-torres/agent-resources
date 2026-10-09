const { Marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

const markedInstance = new Marked({
  gfm: true,
  breaks: true
});

const allowedTags = sanitizeHtml.defaults.allowedTags.concat([
  'img', 'h1', 'h2'
]);

const allowedAttributes = {
  ...sanitizeHtml.defaults.allowedAttributes,
  img: ['src', 'alt', 'title'],
  a: ['href', 'name', 'target', 'rel']
};

const sanitizeOpts = {
  allowedTags,
  allowedAttributes,
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' })
  }
};

function renderMarkdown(input) {
  if (input == null || input === '') return '';
  const rendered = markedInstance.parse(String(input));
  return sanitizeHtml(rendered, sanitizeOpts);
}

// Power Ratings are printed as superscripts throughout Aspirant
// (ENCLAVE: Aspirant, pg. 12) and are stored that way, because "Boosted L–H"
// flattened into prose reads as an ordinary word.
//
// Deliberately not renderMarkdown: these fields hold content any signed-in user
// can write through the class import endpoint, and running them through a full
// markdown parser would start interpreting asterisks and underscores that have
// been literal text until now. Permitting exactly one tag keeps the change to
// the one thing it is for.
//
// Element text position only -- quotes are not escaped, so this must never be
// used inside an attribute value.
const renderPowerRatings = (input) => sanitizeHtml(String(input ?? ''), {
  allowedTags: ['sup'],
  allowedAttributes: {}
});

// Gear notes as views/partials/class-notes.handlebars prints them, for
// surfaces that build their HTML outside Handlebars.
const renderNotes = (notes) => {
  if (!Array.isArray(notes) || notes.length === 0) return '';
  const items = notes.map((note) => {
    const children = Array.isArray(note && note.children) ? note.children : [];
    const nested = children.length
      ? '<ul>' + children.map((child) => '<li>' + renderPowerRatings(child && child.text) + '</li>').join('') + '</ul>'
      : '';
    return '<li>' + renderPowerRatings(note && note.text) + nested + '</li>';
  });
  return '<ul>' + items.join('') + '</ul>';
};

module.exports = { renderMarkdown, renderPowerRatings, renderNotes };
