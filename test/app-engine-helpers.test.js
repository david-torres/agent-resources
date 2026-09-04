const { test, expect } = require('bun:test');
const { createApp, engineHelpers } = require('../app');
const customHelpers = require('../util/handlebars');

// The unit harness in views/class-view.test.js registers the ENTIRE
// util/handlebars export, so it is strictly more permissive than production
// and cannot catch a helper that app.js never registers. These tests render
// through the engine createApp() actually builds.
const renderThroughApp = (view, context) => new Promise((resolve, reject) => {
  createApp().render(view, { ...context, layout: false }, (err, html) => {
    if (err) return reject(err);
    return resolve(html);
  });
});

test('every helper exported by util/handlebars is registered in the engine app.js builds', () => {
  const registered = Object.keys(engineHelpers);
  const missing = Object.keys(customHelpers).filter((name) => !registered.includes(name));
  expect(missing).toEqual([]);
});

test('a custom helper wins over the handlebars-helpers name it shares', () => {
  expect(engineHelpers.times).toBe(customHelpers.times);
});

test('the app engine renders class-view, splitting gear by category', async () => {
  const html = await renderThroughApp('class-view', {
    class: {
      id: 'c1',
      name: 'Test Class',
      abilities: [],
      gear: [
        { name: 'Base Thing', description: 'b', category: 'default', meters: [], notes: [] },
        { name: 'Elective Thing', description: 'e', category: 'elective', meters: [], notes: [] },
      ],
    },
  });

  const baseIdx = html.indexOf('Base Gear');
  const electiveIdx = html.indexOf('Elective Gear');
  expect(html.indexOf('Base Thing')).toBeGreaterThan(baseIdx);
  expect(html.indexOf('Base Thing')).toBeLessThan(electiveIdx);
  expect(html.indexOf('Elective Thing')).toBeGreaterThan(electiveIdx);
});
