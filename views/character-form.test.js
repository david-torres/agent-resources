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

const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

const CONFIRM = `
  <div x-data="{ typed: '', required: 'Vex Kalloway' }">
    <input id="confirm-input" x-model="typed">
    <button id="deceased-submit" :disabled="typed !== required"></button>
  </div>
`;

test('confirm button starts disabled', async () => {
  await setupAlpine();
  await render(CONFIRM);
  expect(document.getElementById('deceased-submit').disabled).toBe(true);
});

test('confirm button stays disabled for a partial name', async () => {
  await setupAlpine();
  await render(CONFIRM);
  const input = document.getElementById('confirm-input');
  input.value = 'Vex';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('deceased-submit').disabled).toBe(true);
});

test('confirm button enables on an exact match', async () => {
  await setupAlpine();
  await render(CONFIRM);
  const input = document.getElementById('confirm-input');
  input.value = 'Vex Kalloway';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('deceased-submit').disabled).toBe(false);
});

test('confirm button re-disables when the name stops matching', async () => {
  await setupAlpine();
  await render(CONFIRM);
  const input = document.getElementById('confirm-input');
  input.value = 'Vex Kalloway';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  input.value = 'Vex Kallowa';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('deceased-submit').disabled).toBe(true);
});

test('deceased form uses Alpine x-data state', () => {
  const html = source();
  const deathSection = html.substring(
    html.indexOf('deceased-modal'),
    html.indexOf('deceased-modal') + 2000
  );
  expect(deathSection).toContain('x-data=');
  expect(deathSection).toContain('typed');
  expect(deathSection).toContain('required');
});

test('deceased form no longer uses oninput', () => {
  const html = source();
  const deathSection = html.substring(
    html.indexOf('deceased-modal'),
    html.indexOf('deceased-modal') + 2000
  );
  expect(deathSection).not.toContain('oninput');
});

test('deceased form no longer uses data-confirm-name', () => {
  const html = source();
  const deathSection = html.substring(
    html.indexOf('deceased-modal'),
    html.indexOf('deceased-modal') + 2000
  );
  expect(deathSection).not.toContain('data-confirm-name');
});

test('deceased input uses x-model binding', () => {
  const html = source();
  const deathSection = html.substring(
    html.indexOf('deceased-modal'),
    html.indexOf('deceased-modal') + 2000
  );
  expect(deathSection).toContain('x-model="typed"');
});

test('deceased button uses :disabled binding', () => {
  const html = source();
  const deathSection = html.substring(
    html.indexOf('deceased-modal'),
    html.indexOf('deceased-modal') + 3000
  );
  expect(deathSection).toContain(':disabled="typed !== required"');
});
