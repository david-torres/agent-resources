import { test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { BOOKS, bookFor } from '../scripts/lib/books.mjs';

test('every descriptor names an artifact that exists on disk', () => {
  for (const book of Object.values(BOOKS)) {
    expect(existsSync(book.artifact)).toBe(true);
  }
});

test('a remap path is either null or a file that exists', () => {
  for (const book of Object.values(BOOKS)) {
    if (book.remap === null) continue;
    expect(existsSync(book.remap)).toBe(true);
  }
});

test('each descriptor carries its own key', () => {
  for (const [key, book] of Object.entries(BOOKS)) expect(book.key).toBe(key);
});

test('an unknown book key is refused by name rather than returning undefined', () => {
  expect(() => bookFor('no-such-book')).toThrow('no-such-book');
});

test('the pre-release book keeps the Witchhunter alias and the Aspirant book does not', () => {
  expect(bookFor('prerelease').aliases).toEqual({ Witchfinder: 'Witchhunter' });
  expect(bookFor('aspirant-v1').aliases).toEqual({});
});

test('only the Aspirant book forks, and only it carries aspirant content', () => {
  expect(bookFor('prerelease').forks).toBe(false);
  expect(bookFor('prerelease').contentFormat).toBe('advent');
  expect(bookFor('aspirant-v1').forks).toBe(true);
  expect(bookFor('aspirant-v1').contentFormat).toBe('aspirant');
  expect(bookFor('aspirant-v1').rulesEdition).toBe('aspirant');
});
