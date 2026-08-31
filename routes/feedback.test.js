// routes/feedback.test.js
//
// HTTP-tier coverage for the in-app reporter (POST /feedback). The two things
// worth pinning here are the ones no unit test can see: that the route is
// closed to anyone without a valid session, and that a multipart submission
// (fields plus a screenshot part) actually reaches the service intact --
// screenshots go over multipart precisely to dodge the global express.json()
// body limit, so a JSON-parsing regression would be invisible everywhere else.
const { test, expect, mock, beforeAll, afterAll, beforeEach } = require('bun:test');

// _base.js throws unless these exist; nothing on the paths exercised here
// makes a network call.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Capture real modules up front so afterAll can restore them -- bun's
// mock.module is process-global and would otherwise leak into other files.
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');
const realGithub = require('../services/feedback/github');
const realRepository = require('../services/feedback/repository');

let createdIssue = null;
let githubConfigured = true;
let uploadedScreenshot = null;

// Any token beginning with `valid` authenticates as its own user, and each
// user gets its own profile id. The route rate-limits per profile, so tests
// that would otherwise share (and exhaust) one window each take their own.
mock.module('../models/auth', () => ({
  getUserFromToken: async (token) => (token && token.startsWith('valid') ? { id: token } : false),
}));
mock.module('../models/profile', () => ({
  getProfile: async (user) => ({ id: `profile-${user.id}`, user_id: user.id, name: 'Ada', role: 'player' }),
}));
mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next(),
}));
// The GitHub call is the one side effect this suite must never perform for
// real: a passing test run would file issues on the tracker.
mock.module('../services/feedback/github', () => ({
  isGithubConfigured: () => githubConfigured,
  createIssue: async (issue) => {
    createdIssue = issue;
    return { data: { url: 'https://github.com/o/r/issues/9', number: 9 }, error: null };
  },
}));
mock.module('../services/feedback/repository', () => ({
  SCREENSHOT_BUCKET: 'bug-screenshots',
  uploadScreenshot: async (storagePath, bytes, contentType) => {
    uploadedScreenshot = { storagePath, bytes, contentType };
    return { error: null };
  },
  getPublicUrl: (storagePath) => `https://cdn.test/${storagePath}`,
}));

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('./feedback')];
  const app = express();
  app.use('/feedback', require('./feedback'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../services/feedback/github', () => realGithub);
  mock.module('../services/feedback/repository', () => realRepository);
  delete require.cache[require.resolve('./feedback')];
});

beforeEach(() => {
  createdIssue = null;
  uploadedScreenshot = null;
  githubConfigured = true;
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const reportForm = (overrides = {}) => {
  const form = new FormData();
  const fields = {
    kind: 'bug',
    title: 'Character sheet fails to save',
    description: 'I pressed save and nothing happened.',
    page_url: 'https://agent-resources.vip/characters/1',
    ...overrides
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) form.append(key, value);
  }
  return form;
};

const post = (form, { token = 'valid-jwt' } = {}) => fetch(`${baseUrl}/feedback`, {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  },
  body: form,
  redirect: 'manual'
});

test('a report from a signed-in user is filed as an issue', async () => {
  const res = await post(reportForm());

  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ url: 'https://github.com/o/r/issues/9', number: 9 });
  expect(createdIssue.title).toBe('[Bug] Character sheet fails to save');
  expect(createdIssue.body).toContain('Ada');
  expect(createdIssue.body).toContain('https://agent-resources.vip/characters/1');
});

// The whole feature is signed-in-only; without a token the shared middleware
// bounces the request to the sign-in flow and no issue is filed.
test('an anonymous request files nothing', async () => {
  const res = await post(reportForm(), { token: null });

  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toContain('/auth/check');
  expect(createdIssue).toBeNull();
});

test('an invalid token files nothing', async () => {
  const res = await post(reportForm(), { token: 'expired-jwt' });

  expect(res.status).toBe(302);
  expect(createdIssue).toBeNull();
});

test('a multipart screenshot is uploaded and linked in the issue', async () => {
  const form = reportForm();
  form.append('screenshot', new Blob([PNG], { type: 'image/png' }), 'screenshot.png');

  const res = await post(form, { token: 'valid-screenshot' });

  expect(res.status).toBe(201);
  expect(uploadedScreenshot).not.toBeNull();
  expect(uploadedScreenshot.contentType).toBe('image/png');
  expect(uploadedScreenshot.storagePath).toStartWith('profile-valid-screenshot/');
  expect(createdIssue.body).toContain('https://cdn.test/profile-valid-screenshot/');
});

test('opted-in diagnostics reach the issue body', async () => {
  const form = reportForm({
    browser_info: JSON.stringify({ userAgent: 'Mozilla/5.0 (Test)', viewport: '1280x800' }),
    console_log: JSON.stringify([{ level: 'error', at: '2026-08-31T11:59:00.000Z', message: 'Save failed: 500' }])
  });

  const res = await post(form, { token: 'valid-diagnostics' });

  expect(res.status).toBe(201);
  expect(createdIssue.body).toContain('Mozilla/5.0 (Test)');
  expect(createdIssue.body).toContain('Save failed: 500');
});

// The counterpart to the test above: nothing about the browser is collected
// unless the reporter opted in, so a report without those fields must not
// grow them server-side.
test('a report without diagnostics carries none', async () => {
  const res = await post(reportForm(), { token: 'valid-no-diagnostics' });

  expect(res.status).toBe(201);
  expect(createdIssue.body).not.toContain('### Browser');
  expect(createdIssue.body).not.toContain('### Console');
});

test('a report missing its description is rejected before GitHub', async () => {
  const res = await post(reportForm({ description: 'short' }), { token: 'valid-invalid-report' });

  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain('10 characters');
  expect(createdIssue).toBeNull();
});

test('an unconfigured server answers 503 instead of half-working', async () => {
  githubConfigured = false;

  const res = await post(reportForm(), { token: 'valid-unconfigured' });

  expect(res.status).toBe(503);
  expect(createdIssue).toBeNull();
});

// Filing an issue writes to a public tracker, so one profile cannot flood it.
// This test uses a profile of its own so exhausting the window here cannot
// make an unrelated test fail for the wrong reason.
test('a burst of reports from one profile is rate limited', async () => {
  const statuses = [];
  for (let i = 0; i < 8; i += 1) {
    const res = await post(reportForm({ title: `Repeated report ${i}` }), { token: 'valid-flooder' });
    statuses.push(res.status);
  }

  expect(statuses.filter((status) => status === 201)).toHaveLength(5);
  expect(statuses.slice(5)).toEqual([429, 429, 429]);
});
