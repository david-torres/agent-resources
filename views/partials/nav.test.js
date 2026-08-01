const { test, expect, beforeAll } = require('bun:test');
const { setupAlpine, render, tick } = require('../../test/helpers/alpine-dom');
const { readFileSync } = require('fs');
const { resolve } = require('path');

beforeAll(async () => { await setupAlpine(); });

const NAV = `
  <nav class="navbar is-dark" x-data="{ open: false }">
    <div class="navbar-brand">
      <button class="navbar-burger" id="navbar-burger"
              :class="open && 'is-active'" :aria-expanded="open"
              @click="open = !open"></button>
    </div>
    <div class="navbar-menu" id="navbar-menu" :class="open && 'is-active'"></div>
  </nav>
`;

test('burger and menu start closed', async () => {
  await render(NAV);
  expect(document.getElementById('navbar-burger').classList.contains('is-active')).toBe(false);
  expect(document.getElementById('navbar-menu').classList.contains('is-active')).toBe(false);
  expect(document.getElementById('navbar-burger').getAttribute('aria-expanded')).toBe('false');
});

test('clicking the burger opens both and sets aria-expanded', async () => {
  await render(NAV);
  document.getElementById('navbar-burger').click();
  await tick();
  expect(document.getElementById('navbar-burger').classList.contains('is-active')).toBe(true);
  expect(document.getElementById('navbar-menu').classList.contains('is-active')).toBe(true);
  expect(document.getElementById('navbar-burger').getAttribute('aria-expanded')).toBe('true');
});

test('clicking again closes both', async () => {
  await render(NAV);
  const burger = document.getElementById('navbar-burger');
  burger.click(); await tick();
  burger.click(); await tick();
  expect(burger.classList.contains('is-active')).toBe(false);
  expect(document.getElementById('navbar-menu').classList.contains('is-active')).toBe(false);
});

test('menu is closed again after a simulated boosted navigation', async () => {
  await render(NAV);
  document.getElementById('navbar-burger').click();
  await tick();
  // hx-boost replaces the body; a fresh nav must come back closed.
  await render(NAV);
  expect(document.getElementById('navbar-menu').classList.contains('is-active')).toBe(false);
});

test('real nav.handlebars has Alpine directives and no hx-on:click on burger', () => {
  const navPath = resolve(__dirname, 'nav.handlebars');
  const content = readFileSync(navPath, 'utf8');

  // Assert new Alpine directives are present
  expect(content).toContain('x-data="{ open: false }"');
  expect(content).toContain(':class="open && \'is-active\'"');
  expect(content).toContain(':aria-expanded="open"');
  expect(content).toContain('@click="open = !open"');

  // Assert the burger itself doesn't have hx-on:click
  // Extract the navbar-burger button element
  const burgerMatch = content.match(/<button[^>]*?id="navbar-burger"[^>]*?>/);
  expect(burgerMatch).not.toBeNull();
  expect(burgerMatch[0]).not.toContain('hx-on:click');
});
