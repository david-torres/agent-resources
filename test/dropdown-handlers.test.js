// Regression test for ar-7v3k (Task 8): the global outside-click dropdown
// handler and the dropdown half of the Escape handler were deleted from
// public/js/app.js because every `.dropdown` is now a self-sufficient Alpine
// component (@click.outside / @keydown.escape.window). The modal half of the
// Escape handler survived untouched until Task 19, which converted the last
// modal (#levelUpModal) to the shared Alpine `modal` component. Every modal
// now declares its own `@keydown.escape.window="close()"` (see
// public/js/alpine-components.js and views/partials/character-level-up.handlebars),
// so the global handler this file used to guard is gone by design, along
// with App.openModal/App.closeModal themselves. The contiguity-guard test
// that used to live here (`the modal Escape handler still closes
// .modal.is-active, as one contiguous block`) is retired as part of that
// same Task 19 change — it existed specifically to stop someone deleting
// that handler by accident, and Task 19 is the change legitimately doing so.
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
