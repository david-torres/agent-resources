const { test, expect, describe } = require('bun:test');
const { resolveEditionStatus, isLockedStatus } = require('./edition-status');

const NOW = new Date('2026-09-28T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (ms) => new Date(NOW.getTime() + ms).toISOString();
const advent = (expires_at) => ({ rules_edition: 'advent', expires_at });

describe('resolveEditionStatus', () => {
  test('a permanent grant is owned', () => {
    expect(resolveEditionStatus([advent(null)], NOW).advent).toEqual({ state: 'owned' });
  });

  test('an edition with no grant is none, independently of the other edition', () => {
    expect(resolveEditionStatus([advent(null)], NOW).aspirant).toEqual({ state: 'none' });
  });

  test('an unexpired grant is a trial with the days left rounded up', () => {
    expect(resolveEditionStatus([advent(at(10 * DAY - 1000))], NOW).advent).toEqual({
      state: 'trial', endsAt: at(10 * DAY - 1000), daysLeft: 10, urgent: false, endsToday: false
    });
  });

  test('a lapsed grant is expired, carrying when it ended', () => {
    expect(resolveEditionStatus([advent(at(-3 * DAY))], NOW).advent)
      .toEqual({ state: 'expired', endedAt: at(-3 * DAY) });
  });

  test('a grant expiring this very instant has ended', () => {
    expect(resolveEditionStatus([advent(at(0))], NOW).advent.state).toBe('expired');
  });

  test('a permanent grant beats an active trial', () => {
    expect(resolveEditionStatus([advent(at(5 * DAY)), advent(null)], NOW).advent).toEqual({ state: 'owned' });
  });

  test('a code redeemed after the trial lapsed reads as owned, in either row order', () => {
    expect(resolveEditionStatus([advent(at(-2 * DAY)), advent(null)], NOW).advent).toEqual({ state: 'owned' });
    expect(resolveEditionStatus([advent(null), advent(at(-2 * DAY))], NOW).advent).toEqual({ state: 'owned' });
  });

  test('the latest active expiry is the trial end', () => {
    const status = resolveEditionStatus([advent(at(3 * DAY)), advent(at(20 * DAY)), advent(at(-DAY))], NOW).advent;
    expect(status.endsAt).toBe(at(20 * DAY));
    expect(status.daysLeft).toBe(20);
  });

  test('the latest lapsed expiry is the end date', () => {
    expect(resolveEditionStatus([advent(at(-10 * DAY)), advent(at(-2 * DAY))], NOW).advent.endedAt)
      .toBe(at(-2 * DAY));
  });

  test('exactly seven days left is urgent', () => {
    const status = resolveEditionStatus([advent(at(7 * DAY))], NOW).advent;
    expect(status.daysLeft).toBe(7);
    expect(status.urgent).toBe(true);
  });

  test('seven days and a moment left is eight days and not urgent', () => {
    const status = resolveEditionStatus([advent(at(7 * DAY + 1))], NOW).advent;
    expect(status.daysLeft).toBe(8);
    expect(status.urgent).toBe(false);
  });

  test('a +00:00 offset is compared as an instant, not a string', () => {
    expect(resolveEditionStatus([advent('2026-10-01T12:00:00+00:00')], NOW).advent.daysLeft).toBe(3);
  });

  test('unknown editions and malformed rows are ignored', () => {
    const status = resolveEditionStatus(
      [{ rules_edition: 'quickstart', expires_at: null }, null, { expires_at: null }],
      NOW
    );
    expect(status).toEqual({ advent: { state: 'none' }, aspirant: { state: 'none' } });
  });

  test('no grants at all resolves every edition to none', () => {
    expect(resolveEditionStatus(null, NOW)).toEqual({ advent: { state: 'none' }, aspirant: { state: 'none' } });
  });
});

describe('endsToday', () => {
  const EVENING = new Date('2026-09-30T20:00:00Z');
  const endsAt = '2026-10-01T02:00:00Z';

  test('an end six hours away falls on the same local day in New York', () => {
    const status = resolveEditionStatus([advent(endsAt)], EVENING, { timeZone: 'America/New_York' }).advent;
    expect(status.daysLeft).toBe(1);
    expect(status.endsToday).toBe(true);
  });

  test('the same end is tomorrow in UTC', () => {
    expect(resolveEditionStatus([advent(endsAt)], EVENING, { timeZone: 'UTC' }).advent.endsToday).toBe(false);
  });

  test('no timezone reads as UTC', () => {
    expect(resolveEditionStatus([advent(endsAt)], EVENING).advent.endsToday).toBe(false);
  });

  test('an unknown timezone reads as UTC rather than throwing', () => {
    expect(resolveEditionStatus([advent(endsAt)], EVENING, { timeZone: 'Mars/Olympus' }).advent.endsToday).toBe(false);
  });
});

describe('isLockedStatus', () => {
  test('only a lapsed or never-granted edition is locked', () => {
    expect(isLockedStatus({ state: 'expired', endedAt: 'x' })).toBe(true);
    expect(isLockedStatus({ state: 'none' })).toBe(true);
    expect(isLockedStatus({ state: 'owned' })).toBe(false);
    expect(isLockedStatus({ state: 'trial' })).toBe(false);
    expect(isLockedStatus(null)).toBe(false);
    expect(isLockedStatus(undefined)).toBe(false);
  });
});
