// routes/library-book-type.test.js
//
// rules_pdfs.book_type decides whether a book confers its ruleset's core
// class roster (services/rules/repository.js#fetchActiveBooksForUser). The
// column defaults to 'supplement' precisely so nothing grants classes by
// accident, which makes the admin form the only way a book becomes core —
// so both write paths have to validate and persist it, exactly the way they
// already do for rules_edition.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realRules = require('../models/rules');
const realPdf = require('../models/pdf');
const realLfg = require('../models/lfg');
const realNav = require('../models/nav');

const EXISTING_ID = '11111111-1111-4111-8111-111111111111';
const EXISTING_ROW = {
  id: EXISTING_ID,
  title: 'Enclave: Advent',
  edition: 'v1',
  rules_edition: 'advent',
  book_type: 'supplement',
  storage_path: `${EXISTING_ID}/book.pdf`,
  is_active: true
};

// What the route handed the model on the last successful write.
const writes = { created: null, updated: null };

mock.module('../models/auth', () => ({
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false)
}));
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: 'p-admin', user_id: 'u1', role: 'admin' }),
  getProfileByNameAdmin: async () => ({ data: null }),
  getProfileByIdAdmin: async () => ({ data: null })
}));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../models/nav', () => ({
  getNavItems: async () => ({ data: [], error: null }),
  getPages: async () => ({ data: [], error: null })
}));
mock.module('../models/rules', () => ({
  ...realRules,
  getRulesPdfs: async () => ({ data: [], error: null }),
  getRulesPdf: async (id) => (id === EXISTING_ID
    ? { data: { ...EXISTING_ROW }, error: null }
    : { data: null, error: null }),
  createRulesPdf: async (payload) => { writes.created = payload; return { data: payload, error: null }; },
  updateRulesPdf: async (id, updates) => { writes.updated = { id, updates }; return { data: updates, error: null }; },
  listRulesPdfUnlocks: async () => ({ data: [], error: null })
}));
mock.module('../models/pdf', () => ({
  ...realPdf,
  storeRulesPdf: async (id) => ({ data: { path: `${id}/stored.pdf` }, error: null }),
  deletePdfObject: async () => ({ error: null })
}));

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('./library')];
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    res.render = (view, ctx) => res.json({ view, ctx: ctx || {} });
    next();
  });
  app.use('/library', require('./library'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/rules', () => realRules);
  mock.module('../models/pdf', () => realPdf);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../models/nav', () => realNav);
  delete require.cache[require.resolve('./library')];
});

const post = (path, form) => fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: {
    Authorization: 'Bearer valid-jwt',
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded'
  },
  body: new URLSearchParams(form).toString(),
  redirect: 'manual'
});

const postCreate = (fields) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  body.append('rules_pdf', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'book.pdf');
  return fetch(`${baseUrl}/library`, {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt', Accept: 'application/json' },
    body,
    redirect: 'manual'
  });
};

test('creating a book persists the submitted book_type', async () => {
  writes.created = null;
  const res = await postCreate({
    title: 'Enclave: Aspirant',
    edition: 'v1',
    rules_edition: 'aspirant',
    book_type: 'core'
  });

  expect(res.status).toBe(302);
  expect(writes.created.book_type).toBe('core');
});

test('creating a supplement persists supplement, not the core default', async () => {
  writes.created = null;
  const res = await postCreate({
    title: 'Advent GM Screen',
    edition: 'v1',
    rules_edition: 'advent',
    book_type: 'supplement'
  });

  expect(res.status).toBe(302);
  expect(writes.created.book_type).toBe('supplement');
});

test('creating a book with an unknown book_type is rejected', async () => {
  writes.created = null;
  const res = await postCreate({
    title: 'Mystery Tome',
    edition: 'v1',
    rules_edition: 'advent',
    book_type: 'grimoire'
  });

  expect(res.status).toBe(400);
  expect(writes.created).toBeNull();
});

// A missing field is the dangerous case, not just the malformed one: an
// omitted book_type must not silently fall through to 'core'.
test('creating a book with no book_type at all is rejected', async () => {
  writes.created = null;
  const res = await postCreate({
    title: 'Mystery Tome',
    edition: 'v1',
    rules_edition: 'advent'
  });

  expect(res.status).toBe(400);
  expect(writes.created).toBeNull();
});

test('editing a book persists the submitted book_type', async () => {
  writes.updated = null;
  const res = await post(`/library/${EXISTING_ID}`, {
    title: 'Enclave: Advent',
    edition: 'v1',
    rules_edition: 'advent',
    book_type: 'core',
    is_active: 'on'
  });

  expect(res.status).toBe(302);
  expect(writes.updated.updates.book_type).toBe('core');
});

test('editing a book with an unknown book_type is rejected', async () => {
  writes.updated = null;
  const res = await post(`/library/${EXISTING_ID}`, {
    title: 'Enclave: Advent',
    edition: 'v1',
    rules_edition: 'advent',
    book_type: 'grimoire',
    is_active: 'on'
  });

  expect(res.status).toBe(400);
  expect(writes.updated).toBeNull();
});

// Regression guard for the pattern this mirrors: rules_edition validation
// must keep working alongside the new field.
test('an unknown rules_edition is still rejected', async () => {
  writes.updated = null;
  const res = await post(`/library/${EXISTING_ID}`, {
    title: 'Enclave: Advent',
    edition: 'v1',
    rules_edition: 'homebrew',
    book_type: 'core',
    is_active: 'on'
  });

  expect(res.status).toBe(400);
  expect(writes.updated).toBeNull();
});
