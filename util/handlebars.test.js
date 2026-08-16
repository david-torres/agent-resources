const { test, expect } = require('bun:test');
const moment = require('moment-timezone');
const { time_ago } = require('./handlebars');

test('time_ago renders a past timestamp as a relative phrase', () => {
  const threeDaysAgo = moment.utc().subtract(3, 'days').toISOString();
  expect(time_ago(threeDaysAgo)).toBe('3 days ago');
});

test('time_ago renders a recent timestamp in minutes', () => {
  const tenMinutesAgo = moment.utc().subtract(10, 'minutes').toISOString();
  expect(time_ago(tenMinutesAgo)).toBe('10 minutes ago');
});

test('time_ago returns an empty string for falsy input', () => {
  expect(time_ago(null)).toBe('');
  expect(time_ago(undefined)).toBe('');
  expect(time_ago('')).toBe('');
});

test('time_ago returns an empty string for an unparseable value', () => {
  expect(time_ago('not-a-date')).toBe('');
});

test('time_ago ignores the Handlebars options object passed as a second argument', () => {
  const oneHourAgo = moment.utc().subtract(1, 'hour').toISOString();
  expect(time_ago(oneHourAgo, { hash: {}, data: {} })).toBe('an hour ago');
});
