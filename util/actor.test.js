const { test, expect } = require('bun:test');
const { actorFromLocals, actorFromProfile, SYSTEM_ACTOR, isAdmin, isSystem } = require('./actor');

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

test('actorFromProfile reads user_id, id, and role from a profile row', () => {
  const actor = actorFromProfile({ user_id: 'u1', id: 'p1', role: 'admin' });
  expect(actor).toEqual({ userId: 'u1', profileId: 'p1', role: 'admin' });
});

test('actorFromProfile tolerates missing/null profile', () => {
  expect(actorFromProfile({})).toEqual({ userId: null, profileId: null, role: null });
  expect(actorFromProfile(null)).toEqual({ userId: null, profileId: null, role: null });
  expect(actorFromProfile(undefined)).toEqual({ userId: null, profileId: null, role: null });
});

test('actorFromProfile tolerates a profile missing individual fields', () => {
  expect(actorFromProfile({ id: 'p1' })).toEqual({ userId: null, profileId: 'p1', role: null });
  expect(actorFromProfile({ user_id: 'u1', role: 'user' })).toEqual({ userId: 'u1', profileId: null, role: 'user' });
});
