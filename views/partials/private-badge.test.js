// views/partials/private-badge.test.js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const src = fs.readFileSync(path.join(__dirname, 'private-badge.handlebars'), 'utf8');
const render = (ctx) => Handlebars.compile(src)(ctx).trim();

test('renders the Private badge when isPublic is false', () => {
  const html = render({ isPublic: false });
  expect(html).toContain('Private');
  expect(html).toContain('fa-lock');
  expect(html).toContain('tag');
});

test('renders nothing when isPublic is true', () => {
  expect(render({ isPublic: true })).toBe('');
});
