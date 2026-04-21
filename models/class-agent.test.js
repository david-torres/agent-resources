const { test, expect } = require('bun:test');
const {
  serializeClassSummaryForAgent,
  serializeClassForAgent
} = require('./class');

const baseClass = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Tinker',
  teaser: 'Builds weird gadgets.',
  description: 'A very long description that should NOT appear in the list payload.',
  gear: [{ name: 'Wrench' }, { name: 'Bolt' }],
  abilities: [{ name: 'Jury Rig' }],
  status: 'release',
  rules_edition: 'advent',
  rules_version: '1.0',
  is_public: true,
  is_player_created: true,
  image_url: 'https://example/tinker.png',
  image_crop: { x: 0, y: 0 },
  base_class_id: null,
  pdf_storage_path: 'classes/tinker.pdf',
  created_by: 'profile-owner',
  updated_at: '2026-04-01T00:00:00Z',
  created_at: '2026-03-01T00:00:00Z'
};

test('serializeClassSummaryForAgent omits heavy fields', () => {
  const out = serializeClassSummaryForAgent({
    classData: baseClass,
    actor: { profileId: 'profile-other', role: 'player', userId: 'user-1' },
    unlockedClassIds: new Set()
  });

  expect(out).not.toBeNull();
  expect(out).not.toHaveProperty('description');
  expect(out).not.toHaveProperty('gear');
  expect(out).not.toHaveProperty('abilities');
  expect(out).not.toHaveProperty('image_url');
  expect(out).not.toHaveProperty('image_crop');
  expect(out.id).toBe(baseClass.id);
  expect(out.name).toBe('Tinker');
  expect(out.teaser).toBe('Builds weird gadgets.');
  expect(out.status).toBe('release');
  expect(out.rules_edition).toBe('advent');
  expect(out.rules_version).toBe('1.0');
  expect(out.is_public).toBe(true);
  expect(out.is_player_created).toBe(true);
  expect(out.access_level).toBe('teaser_only');
  expect(out.unlocked).toBe(false);
});

test('serializeClassSummaryForAgent returns null when actor cannot see private class', () => {
  const priv = { ...baseClass, is_public: false, created_by: 'profile-other' };
  const out = serializeClassSummaryForAgent({
    classData: priv,
    actor: { profileId: 'profile-self', role: 'player', userId: 'user-1' },
    unlockedClassIds: new Set()
  });
  expect(out).toBeNull();
});

test('serializeClassSummaryForAgent reports full access for owner', () => {
  const out = serializeClassSummaryForAgent({
    classData: baseClass,
    actor: { profileId: 'profile-owner', role: 'player', userId: 'user-1' },
    unlockedClassIds: new Set()
  });
  expect(out.access_level).toBe('full');
});

test('serializeClassSummaryForAgent reports unlocked when id is in set', () => {
  const out = serializeClassSummaryForAgent({
    classData: baseClass,
    actor: { profileId: 'profile-other', role: 'player', userId: 'user-1' },
    unlockedClassIds: new Set([baseClass.id])
  });
  expect(out.unlocked).toBe(true);
  expect(out.access_level).toBe('full');
});

test('serializeClassForAgent still returns full shape for detail endpoint', () => {
  const out = serializeClassForAgent({
    classData: baseClass,
    actor: { profileId: 'profile-owner', role: 'player', userId: 'user-1' },
    unlockedClassIds: new Set()
  });
  expect(out.description).toBe(baseClass.description);
  expect(out.gear).toEqual(baseClass.gear);
  expect(out.abilities).toEqual(baseClass.abilities);
});
