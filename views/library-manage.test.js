const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

const source = () => fs.readFileSync(
  path.join(__dirname, 'library-manage.handlebars'), 'utf8'
);

test('library-manage no longer renders any unlock or code UI', () => {
  expect(source()).not.toContain('Grant Access');
  expect(source()).not.toContain('Current Unlocks');
  expect(source()).not.toContain('Generate Unlock Codes');
  expect(source()).not.toContain('hx-delete');
  expect(source()).not.toContain('pdfCodeResult');
});

test('library-manage links to the unlock dashboard', () => {
  expect(source()).toContain('href="/library/unlocks"');
});

test('library-manage keeps the content-management forms', () => {
  expect(source()).toContain('Add New Rules PDF');
  expect(source()).toContain('Replace PDF');
  expect(source()).toContain('name="is_active"');
});

test('library-manage create form has an unchecked free_access checkbox', () => {
  const html = source();
  const createFormEnd = html.indexOf('Upload the official PDF');
  const createForm = html.slice(0, createFormEnd);
  expect(createForm).toContain('name="free_access"');
  expect(createForm).not.toContain('name="free_access" checked');
});

test('library-manage edit form renders a checked free_access checkbox when the rule is free', () => {
  const Handlebars = require('handlebars');
  const customHelpers = require('../util/handlebars');
  const handlebarsHelpers = require('handlebars-helpers')();

  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('breadcrumbs', fs.readFileSync(
    path.join(__dirname, 'partials', 'breadcrumbs.handlebars'), 'utf8'
  ));

  const template = hb.compile(source());
  const html = template({
    breadcrumbs: [],
    rules: [
      { id: 'r1', title: 'Core', edition: 'Advent v2', is_active: true, free_access: true },
      { id: 'r2', title: 'Quickstart', edition: 'Advent v1', is_active: true, free_access: false }
    ]
  });
  const freeCheckboxes = html.match(/name="free_access"[^>]*checked/g) || [];
  expect(freeCheckboxes.length).toBe(1);
});

// rules_edition drives which core class roster the book grants
// (util/book-classes.js), so admins must set it deliberately rather than
// inherit the column default.
test('both forms expose a rules_edition select with both rulesets', () => {
  const src = source();
  const selects = src.match(/<select[^>]*name="rules_edition"/g) || [];

  expect(selects.length).toBe(2); // create form + per-row edit form
  expect(src).toContain('value="advent"');
  expect(src).toContain('value="aspirant"');
});

test("the edit form preselects the row's current ruleset", () => {
  expect(source()).toContain(`eq this.rules_edition 'aspirant'`);
});

// rules_edition says which ruleset a book belongs to; book_type says whether
// it is that ruleset's core rulebook. Only 'core' confers the roster
// (services/rules/repository.js), so a supplement uploaded for Advent must be
// markable as such from the form rather than inheriting anything implicit.
test('both forms expose a book_type select with core and supplement', () => {
  const src = source();
  const selects = src.match(/<select[^>]*name="book_type"/g) || [];

  expect(selects.length).toBe(2); // create form + per-row edit form
  expect(src).toContain('value="core"');
  expect(src).toContain('value="supplement"');
});

test('the edit form preselects the row\'s current book type', () => {
  expect(source()).toContain(`eq this.book_type 'core'`);
});

// Bulma column widths in a row must sum to a whole row or the last field
// wraps onto its own line. Both rows carry five fields now, so the quarters
// they used to use no longer add up.
test('both field rows use column widths that sum to a whole row', () => {
  const src = source();

  expect(src.match(/is-one-quarter/g)).toBeNull();
  expect((src.match(/is-one-fifth/g) || []).length).toBe(10); // 5 per form, 2 forms
});

test('the version field is still labelled distinctly from the ruleset', () => {
  const src = source();
  // `edition` (version, e.g. v1) and `rules_edition` (ruleset) are different
  // columns; identical labels would guarantee admin error.
  expect(src).toContain('Ruleset');
  expect(src).toContain('Version');
});
