const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const alpinePkg = require('alpinejs/package.json');

const head = () => fs.readFileSync(
  path.join(__dirname, 'head.handlebars'), 'utf8'
);

test('the Alpine CDN pin matches the installed alpinejs package', () => {
  const match = head().match(/alpinejs@([\d.]+)\/dist\/cdn\.min\.js/);
  expect(match).not.toBeNull();
  expect(match[1]).toBe(alpinePkg.version);
});

test('the Alpine script carries an SRI hash', () => {
  const tag = head().split('\n').find(l => l.includes('alpinejs@'));
  expect(tag).toContain('integrity="sha384-');
  expect(tag).toContain('defer');
});

test('Alpine loads last among ALL deferred scripts so registrations run before Alpine.start()', () => {
  const src = head();

  const otherDeferredScripts = {
    'htmx': 'htmx.org@2.0.8',
    'supabase-js': '@supabase/supabase-js@2',
    '/js/app.js': '/js/app.js',
    '/js/alpine-components.js': '/js/alpine-components.js'
  };

  const alpineIndex = src.indexOf('alpinejs@');
  expect(alpineIndex).toBeGreaterThan(-1);

  for (const [name, needle] of Object.entries(otherDeferredScripts)) {
    const index = src.indexOf(needle);
    expect(index, `${name} script must be found in head.handlebars`).toBeGreaterThan(-1);
    expect(
      index,
      `${name} (found at index ${index}) must load before Alpine (at index ${alpineIndex}) — ` +
      `Alpine.start() fires in a microtask right after its own tag, before any later ` +
      `deferred script, so ${name} would end up after Alpine and never get processed in time.`
    ).toBeLessThan(alpineIndex);
  }
});

test('htmx settle runs synchronously so it cannot clobber Alpine', () => {
  const meta = head().match(/<meta name="htmx-config" content='([^']+)'/);
  expect(meta).not.toBeNull();
  const config = JSON.parse(meta[1]);
  // Non-zero settle lets htmx overwrite class/style that x-show and
  // :class wrote on the intervening microtask. See the spec.
  expect(config.defaultSettleDelay).toBe(0);
  expect(config.includeIndicatorStyles).toBe(false);
});
