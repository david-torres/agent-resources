const { test, expect } = require('bun:test');
const { serializeCharacterForAgent, serializeCharacterSummaryForAgent } = require('./character');

const baseCharacter = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Alice',
  class: 'Scout',
  level: 3,
  is_public: true,
  is_deceased: false,
  created_by: 'profile-1',
  owner_name: 'Bob'
};

test('serializeCharacterSummaryForAgent returns compact shape', () => {
  const out = serializeCharacterSummaryForAgent(baseCharacter);
  expect(out).toEqual({
    id: baseCharacter.id,
    name: 'Alice',
    class: 'Scout',
    level: 3,
    is_public: true,
    is_deceased: false,
    owner_profile_id: 'profile-1',
    owner_name: 'Bob'
  });
});

test('serializeCharacterForAgent returns null when actor cannot see private char', () => {
  const priv = { ...baseCharacter, is_public: false, created_by: 'profile-other' };
  expect(serializeCharacterForAgent(priv, { profileId: 'profile-self', role: 'player' })).toBe(null);
});

test('serializeCharacterForAgent returns detail when owner is the actor', () => {
  const priv = { ...baseCharacter, is_public: false, created_by: 'profile-self' };
  const out = serializeCharacterForAgent(priv, { profileId: 'profile-self', role: 'player' });
  expect(out.id).toBe(priv.id);
  expect(out.is_public).toBe(false);
});

test('serializeCharacterForAgent returns detail for admin regardless of visibility', () => {
  const priv = { ...baseCharacter, is_public: false, created_by: 'profile-other' };
  const out = serializeCharacterForAgent(priv, { profileId: 'profile-self', role: 'admin' });
  expect(out.id).toBe(priv.id);
});
