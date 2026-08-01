const { test, expect, beforeAll } = require('bun:test');
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => {
  await setupAlpine();
  // jsdom has no layout engine, so offsetWidth/offsetHeight are always 0.
  // Alpine's @click.outside bails early when both are < 1 (its way of
  // skipping outside-click handling for elements hidden via display:none),
  // which would make every outside-click test fail here regardless of
  // markup. Stub non-zero values so Alpine treats elements as visible.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 100 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 40 });
});

const DROPDOWN = `
  <div class="dropdown is-right" id="export-dropdown"
       x-data="{ open: false }"
       :class="open && 'is-active'"
       @click.outside="open = false"
       @keydown.escape.window="open = false">
    <div class="dropdown-trigger">
      <button id="trigger" :aria-expanded="open" @click="open = !open"></button>
    </div>
  </div>
  <a href="#" id="outside">elsewhere</a>
`;

test('export dropdown starts closed', async () => {
  await render(DROPDOWN);
  const dd = document.getElementById('export-dropdown');
  expect(dd.classList.contains('is-active')).toBe(false);
  expect(document.getElementById('trigger').getAttribute('aria-expanded')).toBe('false');
});

test('clicking the trigger opens it and updates aria-expanded', async () => {
  await render(DROPDOWN);
  document.getElementById('trigger').click();
  await tick();
  expect(document.getElementById('export-dropdown').classList.contains('is-active')).toBe(true);
  expect(document.getElementById('trigger').getAttribute('aria-expanded')).toBe('true');
});

test('clicking the trigger again closes it', async () => {
  await render(DROPDOWN);
  const trigger = document.getElementById('trigger');
  trigger.click(); await tick();
  trigger.click(); await tick();
  expect(document.getElementById('export-dropdown').classList.contains('is-active')).toBe(false);
});

test('clicking outside closes it', async () => {
  await render(DROPDOWN);
  document.getElementById('trigger').click();
  await tick();
  document.getElementById('outside').click();
  await tick();
  expect(document.getElementById('export-dropdown').classList.contains('is-active')).toBe(false);
});

test('Escape closes it', async () => {
  await render(DROPDOWN);
  document.getElementById('trigger').click();
  await tick();
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await tick();
  expect(document.getElementById('export-dropdown').classList.contains('is-active')).toBe(false);
});

test('both export dropdowns really carry the directives', () => {
  const fs = require('fs');
  const path = require('path');
  for (const file of ['character.handlebars', 'class-view.handlebars']) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    expect(src).toContain('@click="open = !open"');
    expect(src).toContain("@click.outside=\"open = false\"");
    expect(src).toContain(':aria-expanded="open"');
    expect(src).not.toContain("export-dropdown').classList.toggle");
  }
});
