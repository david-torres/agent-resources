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
