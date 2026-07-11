const { test, expect } = require('bun:test');
const { canGrantBadge, canRevokeBadge } = require('./policy');

const ADMIN_ACTOR = { profileId: 'admin-1', role: 'admin' };
const USER_ACTOR = { profileId: 'p1', role: 'user' };
const SYSTEM_ACTOR = { role: 'system' };

test('an admin may grant a badge', () => {
  expect(canGrantBadge(ADMIN_ACTOR)).toBe(true);
});

test('a non-admin user may not grant a badge', () => {
  expect(canGrantBadge(USER_ACTOR)).toBe(false);
});

// Grant/revoke are human-admin actions with no system caller today (unlike
// milestone recalc, which is system-by-construction) — deliberately not
// admin-or-system.
test('the system actor may not grant a badge', () => {
  expect(canGrantBadge(SYSTEM_ACTOR)).toBe(false);
});

test('an admin may revoke a badge', () => {
  expect(canRevokeBadge(ADMIN_ACTOR)).toBe(true);
});

test('a non-admin user may not revoke a badge', () => {
  expect(canRevokeBadge(USER_ACTOR)).toBe(false);
});

test('the system actor may not revoke a badge', () => {
  expect(canRevokeBadge(SYSTEM_ACTOR)).toBe(false);
});
