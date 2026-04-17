const { test, expect } = require('bun:test');
const { renderMarkdown } = require('./markdown');

test('renders basic markdown to HTML', () => {
  expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
});

test('strips script tags', () => {
  const out = renderMarkdown('hello <script>alert(1)</script>');
  expect(out).not.toContain('<script');
  expect(out).not.toContain('alert(1)');
});

test('strips on* handlers', () => {
  const out = renderMarkdown('<img src=x onerror="alert(1)">');
  expect(out).not.toContain('onerror');
});

test('blocks javascript: hrefs', () => {
  const out = renderMarkdown('[click](javascript:alert(1))');
  expect(out).not.toContain('javascript:');
});

test('allows http and https links', () => {
  const out = renderMarkdown('[ok](https://example.com)');
  expect(out).toContain('href="https://example.com"');
});

test('returns empty string for nullish input', () => {
  expect(renderMarkdown(null)).toBe('');
  expect(renderMarkdown(undefined)).toBe('');
  expect(renderMarkdown('')).toBe('');
});
