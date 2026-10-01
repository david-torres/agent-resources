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

const { getClassRules } = require('./repository');
const rulesClient = result => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }) });
test('class rules returns complete published identity without replacing Aspirant version', async () => {
  const rules = { rules_edition: 'aspirant', rules_version: 'v1', content_format: 'advent' };
  expect(await getClassRules('class', rulesClient({ data: rules, error: null }))).toEqual({ data: rules, error: null });
});
test('classless rules is explicit null, missing class and database failures are errors', async () => {
  expect(await getClassRules(null, {})).toEqual({ data: null, error: null });
  expect((await getClassRules('missing', rulesClient({ data: null, error: null }))).error.code).toBe('CHARACTER_RULES_UNAVAILABLE');
  const error = new Error('database unavailable');
  expect((await getClassRules('linked', rulesClient({ data: null, error }))).error).toBe(error);
  expect((await getClassRules('linked', { from: () => { throw error; } })).error).toBe(error);
});
test('unsupported rules metadata returns an error before selecting mechanics', async () => {
  const result = await getClassRules('class', rulesClient({ data: { rules_edition: 'advent', rules_version: 'v9' } }));
  expect(result.data).toBe(null);
  expect(result.error.code).toBe('CHARACTER_RULES_UNAVAILABLE');
});
