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

const { filterBy } = require('./handlebars');

test('filterBy treats a whitespace-only category as default', () => {
  const list = [{ name: 'Spacey', category: '   ' }];
  expect(filterBy(list, 'category', 'default')).toEqual(list);
  expect(filterBy(list, 'category', 'elective')).toEqual([]);
});

test('filterBy trims a padded category before comparing', () => {
  const list = [{ name: 'Padded', category: ' elective ' }];
  expect(filterBy(list, 'category', 'elective')).toEqual(list);
  expect(filterBy(list, 'category', 'default')).toEqual([]);
});

test('filterBy drops null and non-object entries from every column', () => {
  const keeper = { name: 'Real', category: 'default' };
  const list = [null, undefined, 'a string', 7, keeper];
  expect(filterBy(list, 'category', 'default')).toEqual([keeper]);
  expect(filterBy(list, 'category', 'elective')).toEqual([]);
});

test('filterBy treats a missing, null or empty category as default', () => {
  const list = [{ name: 'None' }, { name: 'Null', category: null }, { name: 'Empty', category: '' }];
  expect(filterBy(list, 'category', 'default')).toEqual(list);
  expect(filterBy(list, 'category', 'elective')).toEqual([]);
});

test('filterBy returns an empty array for a non-array list', () => {
  expect(filterBy(null, 'category', 'default')).toEqual([]);
  expect(filterBy(undefined, 'category', 'default')).toEqual([]);
});
