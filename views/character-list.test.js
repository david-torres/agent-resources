const { test, expect, beforeAll } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => {
  await setupAlpine();
  require('../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

const source = () => fs.readFileSync(path.join(__dirname, 'character-list.handlebars'), 'utf8');

const order = () => Array.from(document.querySelectorAll('tbody tr'))
  .map(tr => tr.id);

const TABLE = `
  <table x-data="sortableTable()">
    <thead>
      <tr>
        <th id="h-name" data-sort-key="name" @click="sortBy('name', 'text')">
          Name <span class="sort-indicator" :class="indicatorClass('name')" x-text="indicator('name')"></span>
        </th>
        <th id="h-level" data-sort-key="level" @click="sortBy('level', 'number')">
          Level <span class="sort-indicator" :class="indicatorClass('level')" x-text="indicator('level')"></span>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr id="r-b"><td data-sort-value="Brannigan">Brannigan</td><td data-sort-value="10">10</td></tr>
      <tr id="r-a"><td data-sort-value="Ashe">Ashe</td><td data-sort-value="2">2</td></tr>
      <tr id="r-c"><td data-sort-value="Caul">Caul</td><td data-sort-value="7">7</td></tr>
    </tbody>
  </table>
`;

test('rows keep their server order before any sort', async () => {
  await render(TABLE);
  expect(order()).toEqual(['r-b', 'r-a', 'r-c']);
});

test('clicking a text header sorts ascending', async () => {
  await render(TABLE);
  document.getElementById('h-name').click();
  await tick();
  expect(order()).toEqual(['r-a', 'r-b', 'r-c']);
});

test('clicking the same header again reverses the order', async () => {
  await render(TABLE);
  document.getElementById('h-name').click();
  await tick();
  document.getElementById('h-name').click();
  await tick();
  expect(order()).toEqual(['r-c', 'r-b', 'r-a']);
});

test('numeric columns sort numerically, not lexically', async () => {
  await render(TABLE);
  document.getElementById('h-level').click();
  await tick();
  expect(order()).toEqual(['r-a', 'r-c', 'r-b']);
});

test('indicators show direction on the active column only', async () => {
  await render(TABLE);
  document.getElementById('h-name').click();
  await tick();
  const [name, level] = document.querySelectorAll('.sort-indicator');
  expect(name.textContent).toBe('▲');
  expect(level.textContent).toBe('⇅');

  document.getElementById('h-name').click();
  await tick();
  expect(document.querySelectorAll('.sort-indicator')[0].textContent).toBe('▼');
});

test('switching the active column resets the new column to ascending and the old column to neutral', async () => {
  await render(TABLE);
  document.getElementById('h-name').click();
  await tick();
  document.getElementById('h-name').click();
  await tick();
  // h-name is now descending. Switch to h-level.
  document.getElementById('h-level').click();
  await tick();
  const [nameIndicator, levelIndicator] = document.querySelectorAll('.sort-indicator');
  expect(levelIndicator.textContent).toBe('▲');
  expect(nameIndicator.textContent).toBe('⇅');
  expect(order()).toEqual(['r-a', 'r-c', 'r-b']);
});

test('the active column indicator is not dimmed; inactive ones are', async () => {
  await render(TABLE);
  document.getElementById('h-name').click();
  await tick();
  const [nameIndicator, levelIndicator] = document.querySelectorAll('.sort-indicator');
  expect(nameIndicator.classList.contains('has-text-grey-light')).toBe(false);
  expect(levelIndicator.classList.contains('has-text-grey-light')).toBe(true);
});

test('dimming flips to the newly active column when a different header is sorted', async () => {
  await render(TABLE);
  document.getElementById('h-name').click();
  await tick();
  document.getElementById('h-level').click();
  await tick();
  const [nameIndicator, levelIndicator] = document.querySelectorAll('.sort-indicator');
  expect(nameIndicator.classList.contains('has-text-grey-light')).toBe(true);
  expect(levelIndicator.classList.contains('has-text-grey-light')).toBe(false);
});

// --- Assertions against the real template ---

test('the real template puts x-data on the table element', () => {
  const src = source();
  expect(src).toMatch(/<table[^>]*x-data="sortableTable\(\)"/);
});

test('the real template gives every sortable th a data-sort-key and @click binding', () => {
  const src = source();
  expect(src).toMatch(/<th data-sort-key="name"[^>]*@click="sortBy\('name', 'string'\)"/);
  expect(src).toMatch(/<th data-sort-key="class"[^>]*@click="sortBy\('class', 'string'\)"/);
  expect(src).toMatch(/<th data-sort-key="level"[^>]*@click="sortBy\('level', 'number'\)"/);
  expect(src).toMatch(/<th data-sort-key="edition"[^>]*@click="sortBy\('edition', 'string'\)"/);
});

test('the real template gives every sortable th an indicator span bound to indicator() and indicatorClass()', () => {
  const src = source();
  for (const key of ['name', 'class', 'level', 'edition']) {
    expect(src).toMatch(new RegExp(
      `<span class="sort-indicator" :class="indicatorClass\\('${key}'\\)" x-text="indicator\\('${key}'\\)"></span>`
    ));
  }
});

test('the real template gives sortable headers a pointer-cursor affordance via CSS, not inline JS', () => {
  const cssPath = path.join(__dirname, '..', 'public', 'css', 'styles.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  expect(css).toMatch(/\[data-sort-key\]\s*\{[^}]*cursor:\s*pointer/);
  expect(css).toMatch(/\[data-sort-key\]\s*\{[^}]*user-select:\s*none/);
});

test('the real template preserves data-sort-value on every sortable cell', () => {
  const src = source();
  expect(src).toContain('data-sort-value="{{this.name}}"');
  expect(src).toContain('data-sort-value="{{this.class}}"');
  expect(src).toContain('data-sort-value="{{this.level}}"');
  expect(src).toContain('data-sort-value="{{#if this.linked_class}}');
});

test('the real template no longer contains the inline sort script', () => {
  const src = source();
  expect(src).not.toContain('<script>');
  expect(src).not.toContain('data-sortable');
  expect(src).not.toContain('activeIndex');
  expect(src).not.toContain('getVal');
});

test('the real template still has the hx-confirm delete button untouched', () => {
  const src = source();
  expect(src).toContain('hx-delete="/characters/{{this.id}}"');
  expect(src).toContain('hx-confirm="Are you sure you want to delete this character?"');
});
