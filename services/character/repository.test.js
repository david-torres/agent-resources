const { test, expect } = require('bun:test');
const { mergeClassItems } = require('./repository');

test('merges a class item description despite a whitespace mismatch', () => {
  const classes = [{ id: 'c1', gear: [{ name: 'Training Weights ', description: 'Heavy.' }] }];
  const rows = [{ name: 'Training Weights', class_id: 'c1', character_id: 'ch1' }];
  const [merged] = mergeClassItems(rows, classes, 'gear');
  expect(merged.description).toBe('Heavy.');
});

test('merges an ability despite a whitespace mismatch using the abilities listKey', () => {
  const classes = [{ id: 'c1', abilities: [{ name: ' Focused Strike', description: 'Sharp.' }] }];
  const rows = [{ name: 'Focused Strike', class_id: 'c1', character_id: 'ch1' }];
  const [merged] = mergeClassItems(rows, classes, 'abilities');
  expect(merged.description).toBe('Sharp.');
});

test('passes a row through untouched when no class matches', () => {
  const classes = [{ id: 'c1', gear: [{ name: 'Training Weights', description: 'Heavy.' }] }];
  const rows = [{ name: 'Training Weights', class_id: 'unknown-class', character_id: 'ch1' }];
  const [merged] = mergeClassItems(rows, classes, 'gear');
  expect(merged).toEqual(rows[0]);
});

test('the character row wins over the class JSONB on a shared key', () => {
  const classes = [{ id: 'c1', gear: [{ name: 'Training Weights', description: 'Heavy.' }] }];
  const rows = [{ name: 'Training Weights', description: 'Custom description', class_id: 'c1', character_id: 'ch1' }];
  const [merged] = mergeClassItems(rows, classes, 'gear');
  expect(merged.description).toBe('Custom description');
});
