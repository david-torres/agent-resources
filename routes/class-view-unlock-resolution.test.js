// routes/class-view-unlock-resolution.test.js
//
// The class-view page resolved the viewer's effective unlocks twice: once
// directly (for the teaser gate) and once more inside canViewClassPdf. Each
// resolve is three queries including a full `classes` projection, so a class
// page with a PDF ran six queries and read the whole classes table twice.
//
// This pins the count at the repository boundary rather than trusting the
// route's shape: the real models/class is used, only the repositories under
// it are faked, so the assertion counts real reads.
const { test, expect, mock, beforeAll, afterAll, beforeEach } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realBase = require('../models/_base');
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');
const realClassRepo = require('../services/class/repository');
const realRulesRepo = require('../services/rules/repository');

const CLASS_ID = 'cccccccc-0000-4000-8000-000000000001';
const CLASS_ROW = {
  id: CLASS_ID,
  name: 'Librarian',
  created_by: 'p-admin',
  status: 'release',
  is_public: true,
  rules_edition: 'advent',
  pdf_storage_path: `${CLASS_ID}/class.pdf`
};

// How many times the effective-unlock resolver actually hit the database.
const reads = { unlockRows: 0, familyRows: 0 };

const makeClient = () => ({
  from() {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      or() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      single() { return Promise.resolve({ data: CLASS_ROW, error: null }); },
      maybeSingle() { return Promise.resolve({ data: CLASS_ROW, error: null }); },
      then(onF, onR) { return Promise.resolve({ data: [CLASS_ROW], error: null }).then(onF, onR); }
    };
    return chain;
  }
});

mock.module('../models/_base', () => ({
  supabase: makeClient(),
  supabaseAdmin: makeClient(),
  createUserClient: () => makeClient(),
  anonKey: 'test-anon-key'
}));
mock.module('../models/auth', () => ({
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false)
}));
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: 'p1', user_id: 'u1', role: 'player' }),
  getProfileById: async () => ({ data: null, error: null })
}));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../util/nav-loader', () => ({ populateNavItems: async () => {} }));
mock.module('../services/rules/repository', () => ({
  ...realRulesRepo,
  fetchActiveBooksForUser: async () => ({ data: [], error: null })
}));
mock.module('../services/class/repository', () => ({
  ...realClassRepo,
  unlockedClassIdRows: async () => {
    reads.unlockRows += 1;
    return { data: [{ class_id: CLASS_ID }], error: null };
  },
  fetchClassFamilyRows: async () => {
    reads.familyRows += 1;
    return [{ id: CLASS_ID, base_class_id: null, rules_edition: 'advent' }];
  }
}));

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('../models/class')];
  delete require.cache[require.resolve('./classes')];
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    res.render = (view, ctx) => res.json({ view, ctx: ctx || {} });
    next();
  });
  app.use('/classes', require('./classes'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/_base', () => realBase);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../services/class/repository', () => realClassRepo);
  mock.module('../services/rules/repository', () => realRulesRepo);
  delete require.cache[require.resolve('../models/class')];
  delete require.cache[require.resolve('./classes')];
});

beforeEach(() => {
  reads.unlockRows = 0;
  reads.familyRows = 0;
});

const viewClass = async () => {
  const res = await fetch(`${baseUrl}/classes/${CLASS_ID}/Librarian`, {
    headers: { Authorization: 'Bearer valid-jwt', Accept: 'application/json' }
  });
  expect(res.status).toBe(200);
  return res.json();
};

test('a class page with a PDF resolves the viewer\'s unlocks exactly once', async () => {
  await viewClass();

  expect(reads.unlockRows).toBe(1);
  expect(reads.familyRows).toBe(1);
});

test('reusing the resolved unlock state still gates the PDF correctly', async () => {
  const { view, ctx } = await viewClass();

  // Unlocked: the full page, with the PDF link enabled.
  expect(view).toBe('class-view');
  expect(ctx.unlocked).toBe(true);
  expect(ctx.classPdfAccessible).toBe(true);
});
