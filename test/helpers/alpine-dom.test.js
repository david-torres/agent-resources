const { test, expect, beforeAll } = require('bun:test');
const { setupAlpine, render, tick } = require('./alpine-dom');

beforeAll(async () => { await setupAlpine(); });

test('Alpine initializes markup and evaluates expressions', async () => {
  await render('<div x-data="{ msg: \'ok\' }"><p x-text="msg"></p></div>');
  expect(document.querySelector('p').textContent).toBe('ok');
});

test('Alpine reacts to events after a tick', async () => {
  await render(`
    <div x-data="{ n: 1 }">
      <button @click="n++"></button>
      <span x-text="n"></span>
    </div>
  `);
  document.querySelector('button').click();
  await tick();
  expect(document.querySelector('span').textContent).toBe('2');
});

test('Alpine auto-initializes content inserted after start (hx-boost swap)', async () => {
  await render('<div x-data="{ a: 1 }"><i x-text="a"></i></div>');
  // A second render() is a full body replacement — exactly what hx-boost does.
  await render('<div x-data="{ b: 2 }"><i x-text="b"></i></div>');
  expect(document.querySelector('i').textContent).toBe('2');
});

test('Alpine tears down components whose nodes are removed', async () => {
  await render('<div id="gone" x-data="{ a: 1 }"></div>');
  const el = document.getElementById('gone');
  expect(el._x_marker).toBeDefined();
  await render('<p>replaced</p>');
  expect(el._x_marker).toBeUndefined();
});
