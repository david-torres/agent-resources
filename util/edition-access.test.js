const { test, expect } = require('bun:test');
const { populateEditionAccess, trialStatus, trialEndedAt } = require('./edition-access');

const TRIAL = { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false };
const STATUS = { advent: TRIAL, aspirant: { state: 'none' } };

const makeReq = (headers = {}) => ({ get: (name) => headers[name.toLowerCase()] });
const makeRes = (locals = {}) => ({
  locals: { user: { id: 'u1' }, profile: { id: 'p1', user_id: 'u1', timezone: 'America/New_York' }, ...locals }
});
const recorder = (result = STATUS) => {
  const calls = [];
  return { calls, deps: { getEditionAccess: async (...args) => { calls.push(args); return result; } } };
};

test("a full page request gets the viewer's edition access, in their timezone", async () => {
  const { calls, deps } = recorder();
  const res = makeRes();
  await populateEditionAccess(makeReq(), res, deps);
  expect(res.locals.editionAccess).toBe(STATUS);
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe('u1');
  expect(calls[0][1]).toBeInstanceOf(Date);
  expect(calls[0][2]).toEqual({ timeZone: 'America/New_York' });
});

test('an htmx fragment swapped into a target element skips the lookup', async () => {
  const { calls, deps } = recorder();
  const res = makeRes();
  await populateEditionAccess(makeReq({ 'hx-request': 'true', 'hx-target': 'alerts' }), res, deps);
  expect(calls).toHaveLength(0);
  expect(res.locals.editionAccess).toBeUndefined();
});

test('a boosted navigation renders the layout, so it looks up', async () => {
  const { calls, deps } = recorder();
  await populateEditionAccess(makeReq({ 'hx-request': 'true', 'hx-boosted': 'true', 'hx-target': 'main' }), makeRes(), deps);
  expect(calls).toHaveLength(1);
});

test('a history restore renders the layout, so it looks up', async () => {
  const { calls, deps } = recorder();
  await populateEditionAccess(makeReq({ 'hx-request': 'true', 'hx-history-restore-request': 'true', 'hx-target': 'x' }), makeRes(), deps);
  expect(calls).toHaveLength(1);
});

// hx-target="body" (the catalog's Create/Import buttons) sends no HX-Target,
// because <body> has no id, and the response carries the full layout.
test('an hx-target="body" swap renders the layout, so it looks up', async () => {
  const { calls, deps } = recorder();
  await populateEditionAccess(makeReq({ 'hx-request': 'true' }), makeRes(), deps);
  expect(calls).toHaveLength(1);
});

test('a signed-in user without a profile gets no lookup', async () => {
  const { calls, deps } = recorder();
  const res = makeRes({ profile: null });
  await populateEditionAccess(makeReq(), res, deps);
  expect(calls).toHaveLength(0);
  expect(res.locals.editionAccess).toBeUndefined();
});

test('a signed-out request gets no lookup', async () => {
  const { calls, deps } = recorder();
  const res = makeRes({ user: null, profile: null });
  await populateEditionAccess(makeReq(), res, deps);
  expect(calls).toHaveLength(0);
});

test('a failed lookup leaves editionAccess null', async () => {
  const { deps } = recorder(null);
  const res = makeRes();
  await populateEditionAccess(makeReq(), res, deps);
  expect(res.locals.editionAccess).toBeNull();
});

test('trialStatus and trialEndedAt read one edition and tolerate a missing status', () => {
  const expired = { advent: { state: 'expired', endedAt: '2026-09-20T12:00:00Z' }, aspirant: { state: 'none' } };
  expect(trialStatus(STATUS, 'advent')).toBe(TRIAL);
  expect(trialStatus(expired, 'advent')).toBeNull();
  expect(trialEndedAt(expired, 'advent')).toBe('2026-09-20T12:00:00Z');
  expect(trialEndedAt(STATUS, 'advent')).toBeNull();
  expect(trialStatus(null, 'advent')).toBeNull();
  expect(trialEndedAt(undefined, 'advent')).toBeNull();
});
