const { test, expect } = require('bun:test');
const { buildExcerpt } = require('./excerpt');

test('buildExcerpt strips common markdown syntax', () => {
  const md = '## Patch 3\n\nWe shipped **badges** and [profiles](/profiles) today.';
  expect(buildExcerpt(md)).toBe('Patch 3 We shipped badges and profiles today.');
});

test('buildExcerpt collapses whitespace and newlines into single spaces', () => {
  expect(buildExcerpt('one\n\n\ntwo   three')).toBe('one two three');
});

test('buildExcerpt truncates on a word boundary and appends an ellipsis', () => {
  const md = 'alpha bravo charlie delta echo foxtrot';
  const out = buildExcerpt(md, 20);
  expect(out).toBe('alpha bravo charlie…');
  expect(out.length).toBeLessThanOrEqual(21);
});

test('buildExcerpt leaves short content untouched, with no ellipsis', () => {
  expect(buildExcerpt('short note', 160)).toBe('short note');
});

test('buildExcerpt returns an empty string for empty or non-string input', () => {
  expect(buildExcerpt('')).toBe('');
  expect(buildExcerpt(null)).toBe('');
  expect(buildExcerpt(undefined)).toBe('');
});

test('buildExcerpt only strips paired emphasis delimiters, not lone delimiters', () => {
  expect(buildExcerpt('my_var_name and another__thing__here')).toBe('my_var_name and another__thing__here');
});

test('buildExcerpt reduces markdown tables to their cell text', () => {
  const table = '| A | B |\n| --- | --- |\n| 1 | 2 |';
  expect(buildExcerpt(table)).toBe('A B 1 2');
});

test('buildExcerpt strips horizontal rule lines', () => {
  expect(buildExcerpt('Para one.\n\n---\n\nPara two.')).toBe('Para one. Para two.');
});

test('buildExcerpt handles reference-style links by keeping link text and dropping definitions', () => {
  const refLink = 'See [my link][1] for info.\n\n[1]: https://example.com';
  expect(buildExcerpt(refLink)).toBe('See my link for info.');
});

test('buildExcerpt strips inline HTML tags while keeping inner text', () => {
  expect(buildExcerpt('Before <strong>bold</strong> and <a href="/x">link</a> after.')).toBe('Before bold and link after.');
});

test('buildExcerpt handles emphasis adjacent to parentheses without content loss', () => {
  expect(buildExcerpt('(__bold__)')).toBe('(bold)');
});

test('buildExcerpt handles emphasis adjacent to quotes without content loss', () => {
  expect(buildExcerpt('"__bold__"')).toBe('"bold"');
});

test('buildExcerpt handles emphasis in realistic news context without content loss', () => {
  expect(buildExcerpt('Big news: (__major__) update shipped.')).toBe('Big news: (major) update shipped.');
});

test('buildExcerpt preserves intraword emphasis delimiters', () => {
  expect(buildExcerpt('Wow__amazing__!')).toBe('Wow__amazing__!');
});

test('buildExcerpt re-passes syntax that emphasis stripping exposes (heading markers nested inside bold/strike/underline)', () => {
  // Stripping the outer **__~~ ... ~~__** emphasis in a single pass leaves a
  // bare "###" behind, which is only caught by a second iteration of the
  // stripping rules -- this is why the loop in excerpt.js exists.
  expect(buildExcerpt('**__~~###~~__**')).toBe('');
});
