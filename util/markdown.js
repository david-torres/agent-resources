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

module.exports = { renderMarkdown };
