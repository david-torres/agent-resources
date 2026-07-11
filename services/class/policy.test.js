const { test, expect } = require('bun:test');
const { canManageClass, canMintUnlockCodes } = require('./policy');

const cls = { id: 'c1', created_by: 'p1' };

test('creator may manage their class', () => {
  expect(canManageClass({ profileId: 'p1', role: 'user' }, cls)).toBe(true);
});
test('a non-creator non-admin may not manage the class', () => {
  expect(canManageClass({ profileId: 'p2', role: 'user' }, cls)).toBe(false);
});
test('admin and system may manage any class', () => {
  expect(canManageClass({ profileId: 'pX', role: 'admin' }, cls)).toBe(true);
  expect(canManageClass({ role: 'system' }, cls)).toBe(true);
});
test('only admin/system may mint unlock codes', () => {
  expect(canMintUnlockCodes({ role: 'admin' })).toBe(true);
  expect(canMintUnlockCodes({ role: 'system' })).toBe(true);
  expect(canMintUnlockCodes({ profileId: 'p1', role: 'user' })).toBe(false);
});
