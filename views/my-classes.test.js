const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

const source = () => fs.readFileSync(
  path.join(__dirname, 'my-classes.handlebars'), 'utf8'
);

test('my-classes has no unreachable historyModal markup', () => {
  expect(source()).not.toContain('historyModal');
});

test('my-classes still renders the duplicate modal', () => {
  expect(source()).toContain('duplicateModal-');
});
