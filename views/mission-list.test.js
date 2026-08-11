const { test, expect, beforeAll } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { setupAlpine, render, tick, settle } = require('../test/helpers/alpine-dom');

beforeAll(async () => { await setupAlpine(); });

const source = () => fs.readFileSync(path.join(__dirname, 'mission-list.handlebars'), 'utf8');

// Pull the x-data expression straight off the real template's wrapping
// div, instead of hand-copying the match() logic into the test. If the
// real match() gets broken (or gutted to `return true`), these behavior
// tests inherit that exact breakage and fail -- a hand-typed duplicate
// would not have caught it.
const extractRootXData = () => {
  const src = source();
  const start = src.indexOf('<div id="mission-filter-root"');
  if (start === -1) throw new Error('mission-filter-root wrapper not found in mission-list.handlebars');
  const chunk = src.slice(start, src.indexOf('{{#if missions.length}}', start));
  const m = chunk.match(/x-data="([\s\S]*)"\s*>\s*$/);
  if (!m) throw new Error('x-data attribute not found on #mission-filter-root');
  return m[1];
};

// Mirrors the real template's shape: one x-data wraps the filter inputs
// AND two separate .mission-row tables driven by the same shared state.
// Every assertion here reads x-show visibility, so every trigger is
// followed by settle() -- never tick() alone -- per the harness's own
// warning: x-show's post-mount toggles route through requestAnimationFrame,
// and a microtask-only flush would let a broken (or deleted) filter read
// as passing because the toggle simply hasn't run yet.
const LIST = `
  <div x-data="${extractRootXData()}">
    <input id="filterName" x-model.debounce.150ms="name">
    <input id="filterCharacter" x-model.debounce.150ms="character">
    <input id="filterConduit" x-model.debounce.150ms="conduit">
    <select id="filterOutcome" x-model="outcome">
      <option value="">All</option>
      <option value="pending">Pending</option>
      <option value="success">Success</option>
      <option value="failure">Failure</option>
    </select>

    <table>
      <tbody>
        <tr class="mission-row" id="a1" data-name="Silent Harbor" data-characters="vex" data-conduit="mara" data-outcome="success" x-show="match($el)"></tr>
        <tr class="mission-row" id="a2" data-name="Ashfall" data-characters="juno" data-conduit="mara" data-outcome="failure" x-show="match($el)"></tr>
      </tbody>
    </table>

    <table>
      <tbody>
        <tr class="mission-row" id="b1" data-name="Silent Harbor Redux" data-characters="vex" data-conduit="mara" data-outcome="success" x-show="match($el)"></tr>
        <tr class="mission-row" id="b2" data-name="Ashfall Echo" data-characters="juno" data-conduit="mara" data-outcome="pending" x-show="match($el)"></tr>
      </tbody>
    </table>
  </div>
`;

test('all rows in both tables are visible with empty filters', async () => {
  await render(LIST);
  for (const id of ['a1', 'a2', 'b1', 'b2']) {
    expect(document.getElementById(id).style.display).not.toBe('none');
  }
});

test('name filter matches case-insensitively on a substring, in both tables', async () => {
  await render(LIST);
  const input = document.getElementById('filterName');
  input.value = 'HARB';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  await settle();
  expect(document.getElementById('a1').style.display).not.toBe('none');
  expect(document.getElementById('b1').style.display).not.toBe('none');
  expect(document.getElementById('a2').style.display).toBe('none');
  expect(document.getElementById('b2').style.display).toBe('none');
});

test('outcome select matches exactly, in both tables', async () => {
  await render(LIST);
  const select = document.getElementById('filterOutcome');
  select.value = 'success';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  expect(document.getElementById('a1').style.display).not.toBe('none');
  expect(document.getElementById('b1').style.display).not.toBe('none');
  expect(document.getElementById('a2').style.display).toBe('none');
  expect(document.getElementById('b2').style.display).toBe('none');
});

test('filters combine with AND across both tables', async () => {
  await render(LIST);
  const input = document.getElementById('filterName');
  input.value = 'ashfall';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const select = document.getElementById('filterOutcome');
  select.value = 'failure';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  await settle();
  // Only a2 is named "Ashfall" AND has outcome "failure". b2 is named
  // "Ashfall Echo" (substring match on name) but its outcome is "pending",
  // so the AND must exclude it.
  expect(document.getElementById('a2').style.display).not.toBe('none');
  expect(document.getElementById('a1').style.display).toBe('none');
  expect(document.getElementById('b1').style.display).toBe('none');
  expect(document.getElementById('b2').style.display).toBe('none');
});

test('clearing a filter restores all rows', async () => {
  await render(LIST);
  const input = document.getElementById('filterName');
  input.value = 'ashfall';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  await settle();
  expect(document.getElementById('a1').style.display).toBe('none');

  input.value = '';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  await settle();
  for (const id of ['a1', 'a2', 'b1', 'b2']) {
    expect(document.getElementById(id).style.display).not.toBe('none');
  }
});

test('text inputs are debounced ~150ms; the outcome select is not', async () => {
  await render(LIST);

  // Text input: right after the input event and a microtask tick, the
  // debounced model must NOT have updated yet -- all rows still visible.
  const input = document.getElementById('filterName');
  input.value = 'harb';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('a2').style.display).not.toBe('none');
  // Once the debounce window has elapsed, the filter takes effect.
  await new Promise((resolve) => setTimeout(resolve, 200));
  await settle();
  expect(document.getElementById('a2').style.display).toBe('none');

  // Select: settle() alone (no real-time wait) must be enough to observe
  // the change, proving there is no debounce on the outcome control.
  await render(LIST);
  const select = document.getElementById('filterOutcome');
  select.value = 'success';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  expect(document.getElementById('a2').style.display).toBe('none');
});

test('the real template carries x-show on every mission-row in both tables', () => {
  const src = source();
  const rowMatches = src.match(/<tr class="mission-row"[^>]*>/g) || [];
  expect(rowMatches.length).toBe(2);
  for (const row of rowMatches) {
    expect(row).toContain('x-show="match($el)"');
  }
});

test('the real template preserves every data-* attribute on both rows', () => {
  const src = source();
  const rowMatches = src.match(/<tr class="mission-row"[^>]*>/g) || [];
  for (const row of rowMatches) {
    expect(row).toContain('data-name=');
    expect(row).toContain('data-characters=');
    expect(row).toContain('data-conduit=');
    expect(row).toContain('data-outcome=');
  }
});

test('the real template binds the three text inputs with 150ms debounce and the select without it', () => {
  const src = source();
  expect(src).toContain('id="filterName"');
  expect(src).toContain('id="filterCharacter"');
  expect(src).toContain('id="filterConduit"');
  expect(src).toContain('id="filterOutcome"');
  expect(src).toMatch(/id="filterName"[^>]*x-model\.debounce\.150ms="name"/);
  expect(src).toMatch(/id="filterCharacter"[^>]*x-model\.debounce\.150ms="character"/);
  expect(src).toMatch(/id="filterConduit"[^>]*x-model\.debounce\.150ms="conduit"/);
  expect(src).toMatch(/<select id="filterOutcome" x-model="outcome"/);
  expect(src).not.toContain('x-model.debounce.150ms="outcome"');
});

test('the real template no longer contains the inline filter script', () => {
  const src = source();
  expect(src).not.toContain('<script>');
  expect(src).not.toContain('function filterRows');
  expect(src).not.toContain('setTimeout(filterRows');
  expect(src).not.toContain('.addEventListener(\'input\'');
});

test('the real template still has the hx-confirm delete button untouched', () => {
  const src = source();
  expect(src).toContain('hx-delete="/missions/{{this.id}}"');
  expect(src).toContain('hx-confirm="Are you sure you want to delete this mission?"');
});
