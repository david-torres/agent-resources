const { test, expect } = require('bun:test');
const { isValidUuid, escapeLikePattern } = require('./validate');

test('isValidUuid accepts valid UUID', () => {
  expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
});

test('isValidUuid rejects non-UUID', () => {
  expect(isValidUuid('not-a-uuid')).toBe(false);
  expect(isValidUuid('')).toBe(false);
  expect(isValidUuid(null)).toBe(false);
  expect(isValidUuid(123)).toBe(false);
});

test('escapeLikePattern escapes wildcards', () => {
  expect(escapeLikePattern('100%')).toBe('100\\%');
  expect(escapeLikePattern('foo_bar')).toBe('foo\\_bar');
  expect(escapeLikePattern('back\\slash')).toBe('back\\\\slash');
});

test('escapeLikePattern leaves ordinary text', () => {
  expect(escapeLikePattern('hello world')).toBe('hello world');
});

test('escapeLikePattern returns empty for nullish', () => {
  expect(escapeLikePattern(null)).toBe('');
  expect(escapeLikePattern(undefined)).toBe('');
  expect(escapeLikePattern('')).toBe('');
});
