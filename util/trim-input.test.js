const { test, expect } = require('bun:test');
const { trimStrings } = require('./trim-input');

test('trims a plain string', () => {
  expect(trimStrings('  Zoologist ')).toBe('Zoologist');
});

test('trims strings nested in objects and arrays', () => {
  expect(trimStrings({ name: 'Shonen ', gear: [{ name: ' Gi ', description: 'x ' }] }))
    .toEqual({ name: 'Shonen', gear: [{ name: 'Gi', description: 'x' }] });
});

test('leaves non-string scalars alone', () => {
  expect(trimStrings({ a: 1, b: true, c: null, d: undefined }))
    .toEqual({ a: 1, b: true, c: null, d: undefined });
});

// services/character/input.js passes moment objects through its pipeline; a
// naive object walk would shred them into plain objects.
test('passes non-plain objects through untouched', () => {
  const date = new Date('2026-09-03T00:00:00Z');
  const out = trimStrings({ when: date });
  expect(out.when).toBe(date);
});

test('does not mutate its input', () => {
  const input = { name: 'Zoologist ', gear: [{ name: 'Gi ' }] };
  trimStrings(input);
  expect(input.name).toBe('Zoologist ');
  expect(input.gear[0].name).toBe('Gi ');
});

test('respects an exempt path, including inside an array', () => {
  const input = { name: 'X ', gear: [{ name: 'Gi ', description: '  indented ' }] };
  expect(trimStrings(input, { exempt: ['gear.description'] }))
    .toEqual({ name: 'X', gear: [{ name: 'Gi', description: '  indented ' }] });
});
