const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const alpinePkg = require('alpinejs/package.json');

const head = () => fs.readFileSync(
  path.join(__dirname, 'head.handlebars'), 'utf8'
);

test('the Alpine CDN pin matches the installed alpinejs package', () => {
  const match = head().match(/alpinejs@([\d.]+)\/dist\/cdn\.min\.js/);
  expect(match).not.toBeNull();
  expect(match[1]).toBe(alpinePkg.version);
});

test('the Alpine script carries an SRI hash', () => {
  const tag = head().split('\n').find(l => l.includes('alpinejs@'));
  expect(tag).toContain('integrity="sha384-');
  expect(tag).toContain('defer');
});

test('Alpine loads last so registrations run before Alpine.start()', () => {
  const src = head();
  expect(src.indexOf('/js/alpine-components.js')).toBeGreaterThan(-1);
  expect(src.indexOf('/js/alpine-components.js'))
    .toBeLessThan(src.indexOf('alpinejs@'));
});
