const { mock, test, expect, afterAll } = require('bun:test');
const { classesStub } = require('../test/helpers/classes-family-stub');

// Capture real `_base` so we can restore it and not leak the mock into
// sibling test files (same pattern as class-unlock-family.test.js).
const realBase = require('./_base');

// Gunslinger as the catalogue holds it: Advent v1, its same-family v2, and the
// Aspirant V1 fork, which differs on BOTH family axes.
const classRows = [
  { id: 'gun-v1', name: 'Gunslinger', base_class_id: null, rules_edition: 'advent', rules_version: 'v1', content_format: 'advent', created_at: '2024-01-01' },
  { id: 'gun-v2', name: 'Gunslinger', base_class_id: 'gun-v1', rules_edition: 'advent', rules_version: 'v2', content_format: 'advent', created_at: '2024-06-01' },
  { id: 'gun-asp', name: 'Gunslinger', base_class_id: 'gun-v1', rules_edition: 'aspirant', rules_version: 'v1', content_format: 'aspirant', created_at: '2026-09-01' }
];

const fakeClient = classesStub(classRows);
mock.module('./_base', () => ({
  supabase: fakeClient,
  supabaseAdmin: fakeClient,
  anonKey: 'test-anon-key',
  createUserClient: () => fakeClient
}));

// Bust the cache in case a sibling test file already loaded `./class`.
delete require.cache[require.resolve('./class')];
const { getVersionHistory } = require('./class');

afterAll(() => {
  mock.module('./_base', () => realBase);
  delete require.cache[require.resolve('./class')];
});

const historyIds = async (classId) => {
  const { data } = await getVersionHistory(classId);
  return data.map(row => row.id).sort();
};

test('getVersionHistory lists the class and its in-family child', async () => {
  expect(await historyIds('gun-v1')).toEqual(['gun-v1', 'gun-v2']);
});

test('getVersionHistory does not list a format fork as derived from its parent', async () => {
  expect(await historyIds('gun-v1')).not.toContain('gun-asp');
});

test('getVersionHistory shows a format fork alone, not under its parent', async () => {
  expect(await historyIds('gun-asp')).toEqual(['gun-asp']);
});
