const { test, expect } = require('bun:test');
const { canManageOwnTokens } = require('./policy');

test('a user may manage tokens owned by their own profile', () => {
  expect(canManageOwnTokens({ profileId: 'p1', role: 'user' }, 'p1')).toBe(true);
});

test('a user may not manage tokens owned by another profile', () => {
  expect(canManageOwnTokens({ profileId: 'p2', role: 'user' }, 'p1')).toBe(false);
});

test('admin and system may manage any profile\'s tokens', () => {
  expect(canManageOwnTokens({ profileId: 'pX', role: 'admin' }, 'p1')).toBe(true);
  expect(canManageOwnTokens({ role: 'system' }, 'p1')).toBe(true);
});

test('a missing/anonymous actor may not manage tokens', () => {
  expect(canManageOwnTokens(null, 'p1')).toBe(false);
  expect(canManageOwnTokens({ role: 'user' }, 'p1')).toBe(false);
});
