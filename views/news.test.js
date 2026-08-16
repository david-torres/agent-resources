const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const read = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');

// date_tz's third argument is a Handlebars options object when the template
// omits it (see util/handlebars.js). The stub keeps that shape so a template
// that forgets to pass a timezone renders "[object Object]" instead of
// silently looking correct in this test. Mirrors views/home.test.js.
let dateTzCalls = [];
const dateTzStub = (value, format, timezone) => {
  dateTzCalls.push({ value, format, timezone });
  const tzLabel = timezone && typeof timezone === 'object' ? '[no timezone]' : timezone;
  return `[${value}|${format}|${tzLabel}]`;
};

const render = (context) => {
  dateTzCalls = [];
  const hb = Handlebars.create();
  hb.registerHelper('date_tz', dateTzStub);
  hb.registerPartial('breadcrumbs', read('partials', 'breadcrumbs.handlebars'));
  return hb.compile(read('news.handlebars'))(context);
};

const NEWS = [
  { id: 'n1', title: 'Patch 4 Notes', slug: 'patch-4-notes', created_at: '2026-08-10T00:00:00+00:00', excerpt: 'Balance changes and bug fixes.' },
  { id: 'n2', title: 'Server Maintenance', slug: 'server-maintenance', created_at: '2026-08-01T00:00:00+00:00', excerpt: 'Downtime scheduled for the weekend.' }
];

test('every news post renders a link to its page, a date, and an excerpt', () => {
  const html = render({ news: NEWS });

  expect(html).toContain('href="/pages/patch-4-notes"');
  expect(html).toContain('Patch 4 Notes');
  expect(html).toContain('Balance changes and bug fixes.');

  expect(html).toContain('href="/pages/server-maintenance"');
  expect(html).toContain('Server Maintenance');
  expect(html).toContain('Downtime scheduled for the weekend.');
});

test('news titles and excerpts are HTML-escaped, not rendered raw', () => {
  const html = render({
    news: [{ id: 'n3', title: '<script>alert(1)</script>', slug: 'x', created_at: '2026-08-01T00:00:00+00:00', excerpt: '<b>bold</b> excerpt' }]
  });

  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<b>bold</b>');
});

test('the date is rendered through date_tz with the viewer\'s profile timezone', () => {
  render({ news: NEWS, profile: { timezone: 'Australia/Sydney' } });
  const call = dateTzCalls.find(c => c.value === NEWS[0].created_at);
  expect(call).toBeDefined();
  expect(call.timezone).toBe('Australia/Sydney');
});

test('an empty news list renders a sensible empty state, not an empty page', () => {
  const html = render({ news: [] });
  expect(html).toContain('No news posts yet.');
  expect(html).not.toContain('href="/pages/');
});

test('breadcrumbs render "News"', () => {
  const html = render({ news: [], breadcrumbs: [{ label: 'News', href: '/news' }] });
  expect(html).toContain('News');
  expect(html).toContain('href="/news"');
});
