const { test, expect } = require('bun:test');
const { canMutateCharacter } = require('./policy');

const character = { id: 'char-1', creator_id: 'profile-1' };

test('canMutateCharacter allows the creator', () => {
  expect(canMutateCharacter({ profileId: 'profile-1', role: null }, character)).toBe(true);
});

test('canMutateCharacter allows an admin actor regardless of ownership', () => {
  expect(canMutateCharacter({ profileId: 'someone-else', role: 'admin' }, character)).toBe(true);
});

test('canMutateCharacter allows the system actor regardless of ownership', () => {
  expect(canMutateCharacter({ profileId: null, role: 'system' }, character)).toBe(true);
});

test('canMutateCharacter denies a stranger profile', () => {
  expect(canMutateCharacter({ profileId: 'someone-else', role: null }, character)).toBe(false);
});

test('canMutateCharacter denies an actor with no profileId', () => {
  expect(canMutateCharacter({ profileId: null, role: null }, character)).toBe(false);
});

test('canMutateCharacter denies when the character is missing', () => {
  expect(canMutateCharacter({ profileId: 'profile-1', role: null }, null)).toBe(false);
});
