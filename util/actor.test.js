const { test, expect } = require('bun:test');
const { actorFromLocals, SYSTEM_ACTOR, isAdmin, isSystem } = require('./actor');

test('actorFromLocals reads user id, profile id, and role', () => {
  const actor = actorFromLocals({ user: { id: 'u1' }, profile: { id: 'p1', role: 'admin' } });
  expect(actor).toEqual({ userId: 'u1', profileId: 'p1', role: 'admin' });
});

test('actorFromLocals tolerates missing user/profile', () => {
  expect(actorFromLocals({})).toEqual({ userId: null, profileId: null, role: null });
  expect(actorFromLocals(undefined)).toEqual({ userId: null, profileId: null, role: null });
});

test('SYSTEM_ACTOR is a frozen system-role actor', () => {
  expect(SYSTEM_ACTOR.role).toBe('system');
  expect(Object.isFrozen(SYSTEM_ACTOR)).toBe(true);
});

test('isAdmin / isSystem discriminate on role', () => {
  expect(isAdmin({ role: 'admin' })).toBe(true);
  expect(isAdmin({ role: 'user' })).toBe(false);
  expect(isSystem(SYSTEM_ACTOR)).toBe(true);
  expect(isSystem({ role: 'admin' })).toBe(false);
});
