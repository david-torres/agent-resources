const { test, expect } = require('bun:test');
const { isSafeHttpUrl, sanitizeHttpUrl } = require('./url');

test('accepts http and https', () => {
  expect(isSafeHttpUrl('http://example.com')).toBe(true);
  expect(isSafeHttpUrl('https://example.com/path?q=1')).toBe(true);
});

test('rejects javascript: and data:', () => {
  expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
  expect(isSafeHttpUrl('JAVASCRIPT:alert(1)')).toBe(false);
  expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
});

test('rejects malformed', () => {
  expect(isSafeHttpUrl('not a url')).toBe(false);
  expect(isSafeHttpUrl('')).toBe(false);
  expect(isSafeHttpUrl(null)).toBe(false);
  expect(isSafeHttpUrl(undefined)).toBe(false);
});

test('sanitizeHttpUrl returns null for unsafe', () => {
  expect(sanitizeHttpUrl('javascript:alert(1)')).toBe(null);
  expect(sanitizeHttpUrl('')).toBe(null);
  expect(sanitizeHttpUrl(null)).toBe(null);
});

test('sanitizeHttpUrl returns normalized URL for safe', () => {
  expect(sanitizeHttpUrl('https://example.com')).toBe('https://example.com/');
});
