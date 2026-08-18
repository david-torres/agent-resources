const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

const view = () => fs.readFileSync(
  path.join(__dirname, 'profile.handlebars'), 'utf8'
);

// Book-derived access lapses with the book. A user needs to see which classes
// are theirs outright and which ride on a rulebook grant.
test('book-derived classes render a badge naming the book', () => {
  const src = view();

  expect(src).toContain(`eq this.unlock_source 'book'`);
  expect(src).toContain('{{this.unlock_book_title}}');
});

test('the badge copy says the class is included with the book', () => {
  expect(view()).toContain('Included with');
});
