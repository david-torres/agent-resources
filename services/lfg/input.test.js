const { test, expect } = require('bun:test');
const moment = require('moment-timezone');
const { normalizeLfgInput } = require('./input');

test('trims the title and leaves the moment-derived date correct', () => {
  const input = { title: ' Game Night ', date: '2026-07-11T20:00', is_public: 'on' };
  const { data } = normalizeLfgInput(input, { creatorId: 'actor-1', timezone: 'America/New_York' });

  expect(data.title).toBe('Game Night');
  expect(data.date.isValid()).toBe(true);
  expect(data.date.toISOString()).toBe(
    moment.tz('2026-07-11T20:00', 'America/New_York').utc().toISOString()
  );
});
