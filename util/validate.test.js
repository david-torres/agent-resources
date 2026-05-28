const { test, expect } = require('bun:test');
const { isValidUuid, escapeLikePattern } = require('./validate');

test('isValidUuid accepts valid UUID', () => {
  expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
});

test('isValidUuid rejects non-UUID', () => {
  expect(isValidUuid('not-a-uuid')).toBe(false);
  expect(isValidUuid('')).toBe(false);
  expect(isValidUuid(null)).toBe(false);
  expect(isValidUuid(123)).toBe(false);
});

test('escapeLikePattern escapes wildcards', () => {
  expect(escapeLikePattern('100%')).toBe('100\\%');
  expect(escapeLikePattern('foo_bar')).toBe('foo\\_bar');
  expect(escapeLikePattern('back\\slash')).toBe('back\\\\slash');
});

test('escapeLikePattern leaves ordinary text', () => {
  expect(escapeLikePattern('hello world')).toBe('hello world');
});

test('escapeLikePattern returns empty for nullish', () => {
  expect(escapeLikePattern(null)).toBe('');
  expect(escapeLikePattern(undefined)).toBe('');
  expect(escapeLikePattern('')).toBe('');
});

const { countWords } = require('./validate');

test('countWords splits on whitespace and trims', () => {
  expect(countWords('one two three')).toBe(3);
  expect(countWords('  leading and trailing  ')).toBe(3);
  expect(countWords('multi   space   words')).toBe(3);
});

test('countWords returns 0 for empty / whitespace / non-strings', () => {
  expect(countWords('')).toBe(0);
  expect(countWords('   ')).toBe(0);
  expect(countWords(null)).toBe(0);
  expect(countWords(undefined)).toBe(0);
  expect(countWords(42)).toBe(0);
});

test('countWords handles newlines and tabs', () => {
  expect(countWords('a\nb\tc')).toBe(3);
});

const { validateAbilityPerks } = require('./validate');

test('validateAbilityPerks accepts empty input', () => {
  const res = validateAbilityPerks([]);
  expect(res.ok).toBe(true);
});

test('validateAbilityPerks rejects perks over 25 words', () => {
  const longText = Array.from({ length: 26 }, (_, i) => `w${i}`).join(' ');
  const res = validateAbilityPerks([
    { class_ability_id: 'a1', text: longText }
  ]);
  expect(res.ok).toBe(false);
  expect(res.errors[0]).toMatch(/25 words/);
});

test('validateAbilityPerks rejects more than 5 perks for the same ability', () => {
  const perks = Array.from({ length: 6 }, () => ({ class_ability_id: 'a1', text: 'ok' }));
  const res = validateAbilityPerks(perks);
  expect(res.ok).toBe(false);
  expect(res.errors[0]).toMatch(/per ability/);
});

test('validateAbilityPerks allows 5 perks on one ability and 5 on another', () => {
  const perks = [
    ...Array.from({ length: 5 }, () => ({ class_ability_id: 'a1', text: 'ok' })),
    ...Array.from({ length: 5 }, () => ({ class_ability_id: 'a2', text: 'ok' }))
  ];
  const res = validateAbilityPerks(perks);
  expect(res.ok).toBe(true);
});

test('validateAbilityPerks accepts custom limits', () => {
  const perks = [
    { class_ability_id: 'a1', text: 'one two three' }
  ];
  const res = validateAbilityPerks(perks, { wordLimit: 2, perAbility: 5 });
  expect(res.ok).toBe(false);
  expect(res.errors[0]).toMatch(/2 words/);
});
