const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

const source = () => fs.readFileSync(
  path.join(__dirname, 'character-form.handlebars'), 'utf8'
);

test('deceased modal opens through App.openModal, not raw classList', () => {
  const html = source();
  expect(html).toContain("App.openModal('#deceased-modal')");
  expect(html).not.toContain("getElementById('deceased-modal').classList.add");
});
