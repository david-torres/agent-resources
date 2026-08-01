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

test('no .dropdown.is-active query remains anywhere in app.js', () => {
  // Covers both the old outside-click handler and the old dropdown-closing
  // loop inside the Escape handler: if this string is absent from the whole
  // file, neither of those blocks can exist in any form.
  expect(source).not.toContain('dropdown.is-active');
});

test('the modal Escape handler still closes .modal.is-active, as one contiguous block', () => {
  // This is the guard against a future edit (or this task itself) deleting
  // the modal half of the Escape handler along with the dropdown half.
  //
  // Deliberately a single regex spanning all four facts with bounded gaps,
  // not four separate `expect` calls. Separate calls only prove each
  // fragment exists *somewhere* in the file — they would still pass if the
  // real handler were deleted and any one fragment happened to survive
  // elsewhere (e.g. a different keydown listener, or App.closeModal invoked
  // from a click handler). Requiring contiguity is what makes this a
  // guarantee that the handler itself, not just its vocabulary, is intact.
  //
  // If this stops matching, the modal-Escape handler has been removed or
  // restructured beyond recognition — that is load-bearing behavior, not
  // an incidental refactor, and should not be waved through silently.
  expect(source).toMatch(
    /addEventListener\('keydown'[\s\S]{0,200}Escape'[\s\S]{0,200}\.modal\.is-active[\s\S]{0,200}App\.closeModal/
  );
});
