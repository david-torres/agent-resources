const { test, expect } = require('bun:test');
const { nameKey, duplicateNames } = require('./item-name');

test('a name key ignores surrounding space and case', () => {
  expect(nameKey('  Trick Shot ')).toBe('trick shot');
  expect(nameKey(null)).toBe('');
});

test('duplicateNames reports each repeated name once, in its first spelling', () => {
  expect(duplicateNames(['Veneer', 'Phantasm', 'veneer ', 'VENEER', 'Glamour', 'glamour'])).toEqual(['Veneer', 'Glamour']);
  expect(duplicateNames(['Veneer', 'Phantasm'])).toEqual([]);
});
