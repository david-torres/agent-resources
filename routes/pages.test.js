// routes/pages.test.js
//
// Regression coverage for two bugs closed together:
//
// 1. `is_news` was added to the `pages` table and read by the homepage/news
//    index, but the admin write path (create/update) never accepted it -- so
//    no admin could ever mark a page as news through the UI.
// 2. Wiring the update handler turned up a second, pre-existing bug shared
//    with `is_published`: since an unchecked HTML checkbox submits nothing,
//    falling back to the existing page's value when the key is absent makes
//    unchecking a permanent no-op. Once a page was marked news (or
//    published), it could never be un-marked through the form.
//
// These tests exercise the REAL create/update handlers in routes/pages.js
// against mocked models, the way routes/missions.test.js does, and would
// have failed before is_news was wired in and before the false-fallback fix.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

// _base.js throws unless these exist; the real models pulled in transitively
// never make network calls on the paths we exercise.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Capture real modules up front so afterAll can restore them -- bun's
// mock.module is process-global and would otherwise leak into other files.
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realPages = require('../models/pages');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');

// Mutable test state, reset per-test.
let createPageCall = null;
let updatePageCall = null;
let existingPage = null;

const EXISTING_ID = '33333333-3333-3333-3333-333333333333';

mock.module('../models/auth', () => ({
  // Consumed by the real isAuthenticated middleware:
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
}));
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: 'admin-profile', user_id: 'u1', role: 'admin' }),
}));
mock.module('../models/pages', () => ({
  // Consumed by the routes under test:
  createPage: async (payload) => {
    createPageCall = payload;
    return { data: { id: 'new-page-id', ...payload }, error: null };
  },
  getPage: async (id) => {
    if (id !== EXISTING_ID) return { data: null, error: { message: 'not found' } };
    return { data: existingPage, error: null };
  },
  updatePage: async (id, updates) => {
    updatePageCall = updates;
    return { data: { id, ...existingPage, ...updates }, error: null };
  },
  // Unused by these tests, but required so requiring the module doesn't blow up.
  getPages: async () => ({ data: [], error: null }),
  getPageBySlug: async () => ({ data: null, error: { message: 'not found' } }),
  deletePage: async () => ({ error: null }),
  canViewPage: async () => ({ data: true, error: null }),
}));
mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next(),
}));

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('./pages')];
  const app = express();
  app.use(express.json());
  app.use('/pages', require('./pages'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/pages', () => realPages);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  delete require.cache[require.resolve('./pages')];
});

const headers = {
  Accept: 'application/json',
  Authorization: 'Bearer valid-jwt',
  'Content-Type': 'application/json'
};

test('POST /pages with is_news checked persists is_news: true', async () => {
  createPageCall = null;
  const res = await fetch(`${baseUrl}/pages`, {
    method: 'POST',
    headers,
    redirect: 'manual',
    body: JSON.stringify({
      title: 'Patch 4 Notes',
      content: 'Balance changes.',
      is_published: 'on',
      is_news: 'on'
    })
  });

  expect(res.status).toBe(302); // redirect to /pages/manage on success
  expect(createPageCall).not.toBeNull();
  expect(createPageCall.is_news).toBe(true);
});

test('POST /pages without is_news present creates a non-news page', async () => {
  createPageCall = null;
  const res = await fetch(`${baseUrl}/pages`, {
    method: 'POST',
    headers,
    redirect: 'manual',
    body: JSON.stringify({
      title: 'A Regular Page',
      content: 'Nothing newsworthy.',
      is_published: 'on'
    })
  });

  expect(res.status).toBe(302);
  expect(createPageCall.is_news).toBe(false);
});

// An unchecked HTML checkbox submits nothing at all -- there is no
// "is_news=off" in the body, the key is just absent. views/page-form.handlebars
// is the ONLY thing that POSTs to /pages/:id (no partial-update API caller
// exists), so "absent" here unambiguously means the admin unchecked the box,
// not "field not supplied by this caller, please leave it alone." The
// regression: falling back to existingPage.is_news when the key is absent
// makes unchecking a no-op -- once a page is marked news it could never be
// un-marked through the form. Same bug, same fix, for is_published.
test('regression: unchecking is_news on an existing news page actually un-marks it', async () => {
  existingPage = {
    id: EXISTING_ID,
    title: 'Old Title',
    slug: 'old-title',
    content: 'Old content.',
    access_level: 'public',
    is_published: true,
    is_news: true
  };
  updatePageCall = null;

  const res = await fetch(`${baseUrl}/pages/${EXISTING_ID}`, {
    method: 'POST',
    headers,
    redirect: 'manual',
    body: JSON.stringify({
      title: 'Old Title',
      content: 'Old content.',
      access_level: 'public',
      is_published: 'on'
      // is_news intentionally omitted -- the unchecked-checkbox case.
    })
  });

  expect(res.status).toBe(302);
  expect(updatePageCall).not.toBeNull();
  expect(updatePageCall.is_news).toBe(false);
});

test('POST /pages/:id with is_news checked sets it to true', async () => {
  existingPage = {
    id: EXISTING_ID,
    title: 'Old Title',
    slug: 'old-title',
    content: 'Old content.',
    access_level: 'public',
    is_published: true,
    is_news: false
  };
  updatePageCall = null;

  const res = await fetch(`${baseUrl}/pages/${EXISTING_ID}`, {
    method: 'POST',
    headers,
    redirect: 'manual',
    body: JSON.stringify({
      title: 'Old Title',
      content: 'Old content.',
      access_level: 'public',
      is_published: 'on',
      is_news: 'on'
    })
  });

  expect(res.status).toBe(302);
  expect(updatePageCall.is_news).toBe(true);
});

// Same regression, same fix, for is_published -- it has had the identical
// bug all along (also fed by an unpaired checkbox in the same form).
test('regression: unchecking is_published on a published page actually unpublishes it', async () => {
  existingPage = {
    id: EXISTING_ID,
    title: 'Old Title',
    slug: 'old-title',
    content: 'Old content.',
    access_level: 'public',
    is_published: true,
    is_news: false
  };
  updatePageCall = null;

  const res = await fetch(`${baseUrl}/pages/${EXISTING_ID}`, {
    method: 'POST',
    headers,
    redirect: 'manual',
    body: JSON.stringify({
      title: 'Old Title',
      content: 'Old content.',
      access_level: 'public'
      // is_published intentionally omitted -- the unchecked-checkbox case.
    })
  });

  expect(res.status).toBe(302);
  expect(updatePageCall).not.toBeNull();
  expect(updatePageCall.is_published).toBe(false);
});

test('POST /pages/:id with is_published checked publishes a draft', async () => {
  existingPage = {
    id: EXISTING_ID,
    title: 'Old Title',
    slug: 'old-title',
    content: 'Old content.',
    access_level: 'public',
    is_published: false,
    is_news: false
  };
  updatePageCall = null;

  const res = await fetch(`${baseUrl}/pages/${EXISTING_ID}`, {
    method: 'POST',
    headers,
    redirect: 'manual',
    body: JSON.stringify({
      title: 'Old Title',
      content: 'Old content.',
      access_level: 'public',
      is_published: 'on'
    })
  });

  expect(res.status).toBe(302);
  expect(updatePageCall.is_published).toBe(true);
});

// Unlike the two checkboxes, title/content/access_level are always submitted
// by the real form (text input / textarea / select) -- their existingPage
// fallback exists only to guard against accidental blanks, not to interpret
// "absent" as "leave alone." That behavior is unchanged by this fix and
// should stay that way.
test('title, content, and access_level still fall back to the existing page when absent from the body', async () => {
  existingPage = {
    id: EXISTING_ID,
    title: 'Kept Title',
    slug: 'kept-title',
    content: 'Kept content.',
    access_level: 'admin',
    is_published: true,
    is_news: true
  };
  updatePageCall = null;

  const res = await fetch(`${baseUrl}/pages/${EXISTING_ID}`, {
    method: 'POST',
    headers,
    redirect: 'manual',
    body: JSON.stringify({
      is_published: 'on',
      is_news: 'on'
      // title, content, access_level intentionally omitted.
    })
  });

  expect(res.status).toBe(302);
  expect(updatePageCall.title).toBe('Kept Title');
  expect(updatePageCall.content).toBe('Kept content.');
  expect(updatePageCall.access_level).toBe('admin');
});
