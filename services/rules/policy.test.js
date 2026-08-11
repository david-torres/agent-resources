const { test, expect } = require('bun:test');
const { canMintRulesUnlockCodes } = require('./policy');

test('admin may mint rules unlock codes', () => {
  expect(canMintRulesUnlockCodes({ profileId: 'admin-1', role: 'admin' })).toBe(true);
});

test('system actor may mint rules unlock codes', () => {
  expect(canMintRulesUnlockCodes({ role: 'system' })).toBe(true);
});

test('a regular user may not mint rules unlock codes', () => {
  expect(canMintRulesUnlockCodes({ profileId: 'p1', role: 'user' })).toBe(false);
});

test('a missing/anonymous actor may not mint rules unlock codes', () => {
  expect(canMintRulesUnlockCodes(null)).toBe(false);
  expect(canMintRulesUnlockCodes(undefined)).toBe(false);
});
