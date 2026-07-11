const { test, expect } = require('bun:test');
const { canMutateOwnProfile } = require('./policy');

test('a user may mutate their own profile', () => {
  expect(canMutateOwnProfile({ userId: 'u1', role: 'user' }, 'u1')).toBe(true);
});

test('a user may not mutate another user\'s profile', () => {
  expect(canMutateOwnProfile({ userId: 'u1', role: 'user' }, 'u2')).toBe(false);
});

test('admin may mutate any profile', () => {
  expect(canMutateOwnProfile({ userId: 'admin-1', role: 'admin' }, 'u2')).toBe(true);
});

test('system actor may mutate any profile', () => {
  expect(canMutateOwnProfile({ role: 'system' }, 'u2')).toBe(true);
});

test('a missing/anonymous actor may not mutate a profile', () => {
  expect(canMutateOwnProfile(null, 'u2')).toBe(false);
  expect(canMutateOwnProfile({ role: 'user' }, 'u2')).toBe(false);
});
