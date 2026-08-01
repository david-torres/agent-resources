const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

const source = () => fs.readFileSync(
  path.join(__dirname, 'character-form.handlebars'), 'utf8'
);

test('deceased modal opens through the modal Alpine component, not App.openModal', () => {
  const html = source();
  expect(html).toContain("$dispatch('open-modal', 'deceased')");
  expect(html).toContain("x-data=\"modal('deceased')\"");
  expect(html).not.toContain('App.openModal');
  expect(html).not.toContain('App.closeModal');
  expect(html).not.toContain("getElementById('deceased-modal')");
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

test('deceased form no longer uses oninput', () => {
  const html = source();
  expect(html).not.toContain('oninput');
});

test('deceased form no longer uses data-confirm-name', () => {
  const html = source();
  expect(html).not.toContain('data-confirm-name');
});

test('deceased input uses x-model binding', () => {
  const html = source();
  expect(html).toContain('x-model="typed"');
});

test('deceased button uses :disabled binding', () => {
  const html = source();
  expect(html).toContain(':disabled="typed !== required"');
});

test('deceased submit button has no bare disabled attribute', () => {
  const html = source();
  const buttonMatch = html.match(/<button[^>]*id="deceased-submit"[^>]*>/);
  expect(buttonMatch).toBeTruthy();
  const buttonTag = buttonMatch[0];
  // Match ' disabled' not followed by '-' or '=' (avoids matching ':disabled=')
  expect(buttonTag).not.toMatch(/\sdisabled(?![-=])/);
});
