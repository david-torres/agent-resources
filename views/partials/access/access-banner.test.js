const { test, expect } = require('bun:test');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../../../util/handlebars');
const { registerAccessPartials } = require('../../../test/helpers/access-partials');

const render = (editionAccess) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  registerAccessPartials(hb);
  return hb.compile('{{> access/access-banner}}')({ profile: { timezone: 'UTC' }, editionAccess }).trim();
};

const trial = (over = {}) => ({
  advent: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false, ...over },
  aspirant: { state: 'none' }
});

test('a trial shows the days left and the end date in warning colours', () => {
  const html = render(trial());
  expect(html).toContain('ADVENT FREE TRIAL — 10 days left');
  expect(html).toContain('Ends Oct 8, 2026');
  expect(html).toContain('notification is-warning');
  expect(html).toContain('data-access-banner="trial"');
  expect(html).toContain('https://enclave-aspirant.backerkit.com/hosted_preorders/822768');
});

test('an urgent trial turns danger', () => {
  const html = render(trial({ daysLeft: 5, urgent: true }));
  expect(html).toContain('ADVENT FREE TRIAL — 5 days left');
  expect(html).toContain('notification is-danger');
});

test('one day left is singular', () => {
  const html = render(trial({ daysLeft: 1, urgent: true, endsAt: '2026-10-01T12:00:00Z' }));
  expect(html).toContain('ADVENT FREE TRIAL — 1 day left');
  expect(html).not.toContain('1 days');
  expect(html).toContain('Ends Oct 1, 2026');
});

test('a trial ending today says so instead of a date', () => {
  const html = render(trial({ daysLeft: 1, urgent: true, endsToday: true }));
  expect(html).toContain('Ends today');
  expect(html).not.toContain('Ends Oct');
});

test('an expired trial names the end date and what is locked', () => {
  const html = render({ advent: { state: 'expired', endedAt: '2026-09-20T12:00:00Z' }, aspirant: { state: 'none' } });
  expect(html).toContain('Your Advent free trial ended Sep 20, 2026.');
  expect(html).toContain('Advent classes, character abilities and the rulebook are locked.');
  expect(html).toContain('notification is-danger');
  expect(html).toContain('data-access-banner="expired"');
  expect(html).toContain('Redeem a code');
});

test('the banner cannot be dismissed', () => {
  expect(render(trial())).not.toContain('class="delete"');
});

test('an owner, a never-granted user and a failed lookup get no banner', () => {
  expect(render({ advent: { state: 'owned' }, aspirant: { state: 'none' } })).toBe('');
  expect(render({ advent: { state: 'none' }, aspirant: { state: 'none' } })).toBe('');
  expect(render(null)).toBe('');
  expect(render(undefined)).toBe('');
});

test('Aspirant never produces a banner', () => {
  expect(render({
    advent: { state: 'owned' },
    aspirant: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false }
  })).toBe('');
});
