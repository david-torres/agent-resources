// Regression test for ar-7v3k (Task 8): the global outside-click dropdown
// handler and the dropdown half of the Escape handler were deleted from
// public/js/app.js because every `.dropdown` is now a self-sufficient Alpine
// component (@click.outside / @keydown.escape.window). The modal half of the
// Escape handler must survive untouched until Task 19 replaces it.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'app.js'),
  'utf8'
);

test('the global outside-click dropdown handler is gone', () => {
  // Old code: document.addEventListener('click', ...) closing any
  // '.dropdown.is-active' whose bounds do not contain the click target.
  expect(source).not.toMatch(
    /document\.addEventListener\('click',[\s\S]{0,400}dropdown\.is-active/
  );
});

test('no .dropdown.is-active query remains anywhere in app.js', () => {
  expect(source).not.toContain('dropdown.is-active');
});

test('the modal Escape handler still closes .modal.is-active', () => {
  // This is the guard against a future edit (or this task itself) deleting
  // the modal half of the Escape handler along with the dropdown half.
  expect(source).toMatch(/document\.addEventListener\('keydown'/);
  expect(source).toMatch(/event\.key === 'Escape'/);
  expect(source).toMatch(/document\.querySelector\('\.modal\.is-active'\)/);
  expect(source).toMatch(/App\.closeModal\('#' \+ activeModal\.id\)/);
});
