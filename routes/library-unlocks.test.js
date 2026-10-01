const { test, expect, beforeAll, afterAll } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');
const realEditionAccess = require('../util/edition-access');

const PDF_A = '11111111-1111-4111-8111-111111111111';
const PDF_FREE = '22222222-2222-4222-8222-222222222222';
const PDF_A_OLD = '33333333-3333-4333-8333-333333333333';
const PDF_OTHER = '44444444-4444-4444-8444-444444444444';
const CLASS_EXCL_Z = '55555555-5555-4555-8555-555555555555';
const CLASS_EXCL_A = '66666666-6666-4666-8666-666666666666';
const CLASS_PUBLIC = '77777777-7777-4777-8777-777777777777';
const CLASS_PRERELEASE = '88888888-8888-4888-8888-888888888888';
const CLASS_EXCL_A_ASPIRANT = '99999999-9999-4999-8999-999999999990';
const ADMIN_CLIENT = { name: 'admin-client' };

// Mutable per-test state.
let currentRole = 'admin';
let upsertCall = null;
let mintCall = null;
let getClassesCall = null;
let classUnlockCall = null;
let classMintCall = null;

// Deliberately unsorted, mixing sections; the exclusive Zephyr is not public
// so only an admin-client read would see it.
const CLASS_ROWS = [
  { id: CLASS_EXCL_Z, name: 'Zephyr', prerelease_section: 'exclusive', content_format: 'advent', is_public: false },
  { id: CLASS_PUBLIC, name: 'Brawler', prerelease_section: null, content_format: 'advent', is_public: true },
  { id: CLASS_EXCL_A_ASPIRANT, name: 'Arbiter', prerelease_section: 'exclusive', content_format: 'aspirant', is_public: true },
  { id: CLASS_EXCL_A, name: 'Arbiter', prerelease_section: 'exclusive', content_format: 'advent', is_public: true },
  { id: CLASS_PRERELEASE, name: 'Courier', prerelease_section: 'prerelease', content_format: 'advent', is_public: true }
];

const RULES_ROWS = [
  { id: PDF_A, title: 'Core Rules', edition: 'v2', is_active: true, free_access: false },
  { id: PDF_A_OLD, title: 'Core Rules', edition: 'v1', is_active: true, free_access: false },
  { id: PDF_OTHER, title: 'Aspirant', edition: 'v1', is_active: false, free_access: false },
  { id: PDF_FREE, title: 'Quickstart', edition: 'v1', is_active: true, free_access: true }
];
const GRANT_ROWS = [
  {
    user_id: 'user-1',
    profile: { id: 'p1', name: 'Alice' },
    granter: null,
    rules_pdf: { id: PDF_A, title: 'Core Rules', edition: 'Advent v2' },
    unlocked_at: '2026-08-01T00:00:00Z',
    expires_at: '2020-01-01T00:00:00Z' // already expired
  }
];
const CODE_ROWS = [
  {
    id: 'code-row-1',
    code: 'abc123',
    rules_pdf_id: PDF_A,
    created_at: '2026-08-10T00:00:00Z',
    expires_at: null,
    max_uses: 2,
    used_count: 2, // exhausted
    rules_pdf: { id: PDF_A, title: 'Core Rules', edition: 'Advent v2' },
    creator: { id: 'p9', name: 'Dave' }
  }
];

// bun test runs every *.test.js file in one shared process, and mock.module
// is a process-global, shared-object mutation -- around a dozen other test
// files also mock.module('../models/profile', ...) etc. for their own
// routes. Worse, bun test runs multiple *.test.js files' async work
// concurrently in that one process (verified empirically: two independent
// files' wall-clock time overlaps rather than summing), so another file's
// mock.module call can land in the middle of THIS file's in-flight request
// -- there's no lifecycle hook (beforeEach included) that closes that
// window, since the request is handled by our own in-process HTTP server
// while a `fetch()` in the test body is still pending.
//
// So this file doesn't use mock.module at all. Instead it loads
// routes/library.js with freshRequire, which evaluates the route file (and
// everything it pulls in via relative requires -- models/rules,
// models/profile, util/auth, models/_base, ...) through its own private
// loader and its own private module cache, substituting the fakes below by
// absolute path. Nothing routed through freshRequire is reachable from
// bun's require()/mock.module registry, so no other file's mocks -- however
// they're timed -- can reach in and change what this app sees.
const fakeRules = {
  getRulesPdfs: async () => ({ data: RULES_ROWS, error: null }),
  getRulesPdf: async (id) =>
    (id === PDF_A
      ? { data: { id: PDF_A, title: 'Core Rules', edition: 'Advent v2' }, error: null }
      : { data: null, error: { message: 'not found' } }),
  createRulesPdf: async () => ({ data: null, error: null }),
  updateRulesPdf: async () => ({ data: null, error: null }),
  listRulesPdfUnlocksForUser: async () => ({ data: [], error: null }),
  upsertRulesPdfUnlock: async (payload) => { upsertCall = payload; return { data: payload, error: null }; },
  deleteRulesPdfUnlock: async () => ({ error: null }),
  createRulesPdfUnlockCodes: async (actor, opts) => {
    mintCall = { actor, opts };
    return { data: [{ code: 'new-code', max_uses: opts.maxUses, expires_at: opts.expiresAt }], error: null };
  },
  canViewRulesPdf: async () => ({ data: true, error: null }),
  listAllUnlockGrantsAdmin: async () => ({ data: GRANT_ROWS, error: null }),
  listAllUnlockCodesAdmin: async () => ({ data: CODE_ROWS, error: null }),
};

const fakeClass = {
  getClasses: async (filters, client) => {
    getClassesCall = { filters, client };
    return { data: CLASS_ROWS, error: null };
  },
  getClass: async (id) => {
    const row = CLASS_ROWS.find((cls) => cls.id === id);
    return row ? { data: row, error: null } : { data: null, error: { message: 'not found' } };
  },
  upsertClassUnlock: async (payload) => { classUnlockCall = payload; return { data: payload, error: null }; },
  createUnlockCodes: async (actor, opts) => {
    classMintCall = { actor, opts };
    return { data: [{ code: 'class-code', max_uses: opts.maxUses, expires_at: opts.expiresAt }], error: null };
  },
};

const overrides = new Map([
  // util/auth.js reads supabase/createUserClient directly from
  // models/_base; res.locals.supabase is never consulted by the routes
  // under test, so an inert stand-in is enough.
  [require.resolve('../models/_base'), {
    supabase: {},
    supabaseAdmin: ADMIN_CLIENT,
    anonKey: 'test-anon-key',
    createUserClient: () => ({})
  }],
  [require.resolve('../models/auth'), {
    getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
  }],
  [require.resolve('../models/profile'), {
    getProfile: async () => ({ id: 'admin-profile', user_id: 'u1', role: currentRole }),
    getProfileByNameAdmin: async (name) =>
      (name === 'Alice' ? { data: { id: 'p1', user_id: 'user-1' } } : { data: null }),
    getProfileByIdAdmin: async (id) =>
      (id === 'p1' ? { data: { id: 'p1', user_id: 'user-1' } } : { data: null }),
  }],
  [require.resolve('../models/rules'), fakeRules],
  [require.resolve('../models/class'), fakeClass],
  [require.resolve('../models/pdf'), {
    storeRulesPdf: async () => ({ data: null, error: null }),
    deletePdfObject: async () => ({ error: null }),
    getSignedPdfUrl: async () => ({ data: null, error: null }),
    RULES_PDF_BUCKET: 'rules-pdfs',
  }],
  [require.resolve('../util/edition-access'), { ...realEditionAccess, populateEditionAccess: async () => {} }],
  [require.resolve('../util/system-message'), { getSystemMessage: () => null }],
  [require.resolve('../models/lfg'), { getPendingJoinRequestCount: async () => ({ count: 0 }) }],
  [require.resolve('../util/nav-loader'), {
    populateNavItems: async () => {},
    loadNavItems: (req, res, next) => next(),
  }],
]);

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  // Render capture: routes are exercised for their context, not their HTML.
  app.use((req, res, next) => {
    res.render = (view, ctx) => res.json({ view, ctx: ctx || {} });
    next();
  });
  app.use('/library', freshRequire(require.resolve('./library'), overrides));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
});

const authHeaders = { Authorization: 'Bearer valid-jwt' };

test('GET /library/unlocks renders the dashboard with stamped display state', async () => {
  currentRole = 'admin';
  const res = await fetch(`${baseUrl}/library/unlocks`, { headers: authHeaders });
  expect(res.status).toBe(200);
  const { view, ctx } = await res.json();
  expect(view).toBe('library-unlocks');
  expect(ctx.rules).toEqual(RULES_ROWS);
  expect(ctx.unlockableRules).toEqual([RULES_ROWS[0], RULES_ROWS[2]]);
  expect(ctx.grants.length).toBe(1);
  expect(ctx.grants[0].isExpired).toBe(true);
  expect(ctx.codes.length).toBe(1);
  expect(ctx.codes[0].isUsable).toBe(false); // exhausted: used_count == max_uses
  expect(ctx.title).toBe('Unlock Dashboard');
});

test('dashboard selects the newest active version when a newer family member is inactive', async () => {
  const newer = RULES_ROWS[0];
  newer.is_active = false;
  try {
    const res = await fetch(`${baseUrl}/library/unlocks`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const { ctx } = await res.json();
    expect(ctx.unlockableRules[0].id).toBe(PDF_A_OLD);
  } finally {
    newer.is_active = true;
  }
});

test('GET /library/unlocks rejects non-admins with 403', async () => {
  currentRole = 'user';
  const res = await fetch(`${baseUrl}/library/unlocks`, { headers: authHeaders });
  expect(res.status).toBe(403);
  currentRole = 'admin';
});

test('POST /library/unlocks grants by profile name and redirects to the dashboard', async () => {
  upsertCall = null;
  const res = await fetch(`${baseUrl}/library/unlocks`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    redirect: 'manual',
    body: JSON.stringify({ unlock_target: `pdf:${PDF_A}`, profile_name: 'Alice', expires_at: '' })
  });
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('/library/unlocks');
  expect(upsertCall).toEqual({
    userId: 'user-1',
    profileId: 'p1',
    rulesPdfId: PDF_A,
    expiresAt: null,
    grantedBy: 'admin-profile'
  });
});

test('POST /library/unlocks with a non-UUID pdf target is a 400', async () => {
  upsertCall = null;
  const res = await fetch(`${baseUrl}/library/unlocks`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
    redirect: 'manual',
    body: JSON.stringify({ unlock_target: 'pdf:not-a-uuid', profile_name: 'Alice' })
  });
  expect(res.status).toBe(400);
  expect(upsertCall).toBeNull();
});

test('POST /library/unlocks with an unknown profile is a 400', async () => {
  upsertCall = null;
  const res = await fetch(`${baseUrl}/library/unlocks`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
    redirect: 'manual',
    body: JSON.stringify({ unlock_target: `pdf:${PDF_A}`, profile_name: 'Nobody' })
  });
  expect(res.status).toBe(400);
  expect(upsertCall).toBeNull();
});

test('POST /library/codes mints codes for the selected document and renders the result partial', async () => {
  mintCall = null;
  const res = await fetch(`${baseUrl}/library/codes`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ unlock_target: `pdf:${PDF_A}`, expires_at: '', max_uses: '5', amount: '3' })
  });
  expect(res.status).toBe(200);
  const { view } = await res.json();
  expect(view).toBe('partials/unlock-code-result');
  expect(mintCall.opts).toEqual({
    rulesPdfId: PDF_A,
    createdByProfileId: 'admin-profile',
    expiresAt: null,
    maxUses: 5,
    amount: 3
  });
});

test('the replaced path-param endpoints are gone', async () => {
  const unlocksRes = await fetch(`${baseUrl}/library/${PDF_A}/unlocks`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    redirect: 'manual',
    body: JSON.stringify({ profile_name: 'Alice' })
  });
  expect(unlocksRes.status).toBe(404);

  const codesPostRes = await fetch(`${baseUrl}/library/${PDF_A}/codes`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_uses: '1', amount: '1' })
  });
  expect(codesPostRes.status).toBe(404);

  const codesGetRes = await fetch(`${baseUrl}/library/${PDF_A}/codes`, { headers: authHeaders });
  expect(codesGetRes.status).toBe(404);
});

test('GET /library/unlocks offers only the exclusive classes, labelled by edition and sorted, read with the admin client', async () => {
  getClassesCall = null;
  const res = await fetch(`${baseUrl}/library/unlocks`, { headers: authHeaders });
  expect(res.status).toBe(200);
  const { ctx } = await res.json();
  expect(getClassesCall.client).toBe(ADMIN_CLIENT);
  expect(ctx.unlockableClasses).toEqual([
    { id: CLASS_EXCL_A, label: 'Arbiter (Advent)' },
    { id: CLASS_EXCL_A_ASPIRANT, label: 'Arbiter (Aspirant)' },
    { id: CLASS_EXCL_Z, label: 'Zephyr (Advent)' }
  ]);
});

test('POST /library/unlocks with an exclusive class target upserts a class unlock and redirects', async () => {
  classUnlockCall = null;
  upsertCall = null;
  const res = await fetch(`${baseUrl}/library/unlocks`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    redirect: 'manual',
    body: JSON.stringify({ unlock_target: `class:${CLASS_EXCL_Z}`, profile_name: 'Alice', expires_at: '2027-01-02T00:00:00Z' })
  });
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('/library/unlocks');
  expect(classUnlockCall).toEqual({
    userId: 'user-1',
    classId: CLASS_EXCL_Z,
    expiresAt: '2027-01-02T00:00:00.000Z'
  });
  expect(upsertCall).toBeNull();
});

test('POST /library/unlocks with a non-exclusive class target is a 400', async () => {
  classUnlockCall = null;
  const res = await fetch(`${baseUrl}/library/unlocks`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
    redirect: 'manual',
    body: JSON.stringify({ unlock_target: `class:${CLASS_PUBLIC}`, profile_name: 'Alice' })
  });
  expect(res.status).toBe(400);
  expect(classUnlockCall).toBeNull();
});

test('POST /library/unlocks with an unknown class target is a 404', async () => {
  classUnlockCall = null;
  const res = await fetch(`${baseUrl}/library/unlocks`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
    redirect: 'manual',
    body: JSON.stringify({ unlock_target: 'class:99999999-9999-4999-8999-999999999999', profile_name: 'Alice' })
  });
  expect(res.status).toBe(404);
  expect(classUnlockCall).toBeNull();
});

for (const target of [PDF_A, `book:${PDF_A}`, 'class:not-a-uuid', '']) {
  test(`POST /library/unlocks with the malformed target ${JSON.stringify(target)} is a 400`, async () => {
    upsertCall = null;
    classUnlockCall = null;
    const res = await fetch(`${baseUrl}/library/unlocks`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
      redirect: 'manual',
      body: JSON.stringify({ unlock_target: target, profile_name: 'Alice' })
    });
    expect(res.status).toBe(400);
    expect(upsertCall).toBeNull();
    expect(classUnlockCall).toBeNull();
  });
}

test('POST /library/codes mints class codes for an exclusive class target', async () => {
  classMintCall = null;
  mintCall = null;
  const res = await fetch(`${baseUrl}/library/codes`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ unlock_target: `class:${CLASS_EXCL_A}`, expires_at: '', max_uses: '2', amount: '1' })
  });
  expect(res.status).toBe(200);
  const { view, ctx } = await res.json();
  expect(view).toBe('partials/unlock-code-result');
  expect(ctx.code).toBe('class-code');
  expect(classMintCall.opts).toEqual({
    classId: CLASS_EXCL_A,
    createdByProfileId: 'admin-profile',
    expiresAt: null,
    maxUses: 2,
    amount: 1
  });
  expect(mintCall).toBeNull();
});

test('POST /library/codes with a non-exclusive class target is a 400', async () => {
  classMintCall = null;
  const res = await fetch(`${baseUrl}/library/codes`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ unlock_target: `class:${CLASS_PRERELEASE}`, max_uses: '1', amount: '1' })
  });
  expect(res.status).toBe(400);
  expect(classMintCall).toBeNull();
});

test('POST /library/codes with a malformed target is a 400', async () => {
  mintCall = null;
  classMintCall = null;
  const res = await fetch(`${baseUrl}/library/codes`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ unlock_target: PDF_A, max_uses: '1', amount: '1' })
  });
  expect(res.status).toBe(400);
  expect(mintCall).toBeNull();
  expect(classMintCall).toBeNull();
});
