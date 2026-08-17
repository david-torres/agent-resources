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
