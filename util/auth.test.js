const { test, expect, mock, afterAll } = require('bun:test');

const realBase = require('../models/_base');
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realSystemMessage = require('./system-message');
const realLfg = require('../models/lfg');
const realAgentToken = require('../models/agent-token');
const realNavLoader = require('./nav-loader');

const fakeAnon = { __name: 'anon', auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
const fakeAdmin = { __name: 'admin' };
const fakeCreateUserClient = (token) => ({ __name: 'user', __token: token });

mock.module('../models/_base', () => ({
  supabase: fakeAnon,
  supabaseAdmin: fakeAdmin,
  anonKey: 'x',
  createUserClient: fakeCreateUserClient
}));

mock.module('../models/auth', () => ({
  getUserFromToken: async (token) => token === 'valid-jwt' ? { id: 'u1' } : false,
}));
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: 'p1', user_id: 'u1' })
}));
mock.module('./system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
const VERIFIED_TOKEN = { data: { userId: 'u1', profile: { id: 'p1' }, tokenId: 't1', tokenName: 'n', tokenHint: 'h' }, error: null };
let verifyAgentTokenImpl = async () => VERIFIED_TOKEN;
const verifiedTokens = [];
mock.module('../models/agent-token', () => ({
  verifyAgentToken: async (token) => {
    verifiedTokens.push(token);
    return verifyAgentTokenImpl(token);
  },
  AGENT_TOKEN_PREFIX: 'aat_'
}));
mock.module('./nav-loader', () => ({ populateNavItems: async () => {} }));

delete require.cache[require.resolve('./auth')];
const { isAuthenticated, authOptional, isAgentAuthenticated, resolveAgentAuth } = require('./auth');

afterAll(() => {
  mock.module('../models/_base', () => realBase);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('./system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../models/agent-token', () => realAgentToken);
  mock.module('./nav-loader', () => realNavLoader);
  delete require.cache[require.resolve('./auth')];
});

const makeRes = () => ({
  locals: {},
  header() {},
  set() {},
  status() { return this; },
  end() {},
  redirect() {}
});
const makeReq = (headers = {}) => ({
  headers,
  get(h) { return headers[h.toLowerCase()]; },
  originalUrl: '/x'
});

test('isAuthenticated attaches a user-scoped client built from the bearer token', async () => {
  const req = makeReq({ authorization: 'Bearer valid-jwt' });
  const res = makeRes();
  let nextCalled = false;
  await isAuthenticated(req, res, () => { nextCalled = true; });
  expect(nextCalled).toBe(true);
  expect(res.locals.supabase.__name).toBe('user');
  expect(res.locals.supabase.__token).toBe('valid-jwt');
});

test('authOptional without a token attaches the anon client', async () => {
  const req = makeReq({});
  const res = makeRes();
  await authOptional(req, res, () => {});
  expect(res.locals.supabase.__name).toBe('anon');
});

test('authOptional with a token attaches the user-scoped client', async () => {
  const req = makeReq({ authorization: 'Bearer valid-jwt' });
  const res = makeRes();
  await authOptional(req, res, () => {});
  expect(res.locals.supabase.__name).toBe('user');
});

test('isAgentAuthenticated attaches the anon client (agent reads go through *ForAgent repositories, not res.locals.supabase)', async () => {
  const req = makeReq({ 'x-agent-token': 'aat_stub' });
  const res = makeRes();
  await isAgentAuthenticated(req, res, () => {});
  expect(res.locals.supabase.__name).toBe('anon');
});

const withVerifyAgentToken = async (impl, run) => {
  verifyAgentTokenImpl = impl;
  verifiedTokens.length = 0;
  try {
    return await run();
  } finally {
    verifyAgentTokenImpl = async () => VERIFIED_TOKEN;
  }
};

test('resolveAgentAuth reports a missing token without verifying anything', async () => {
  await withVerifyAgentToken(async () => VERIFIED_TOKEN, async () => {
    expect(await resolveAgentAuth(makeReq({}))).toEqual({ ok: false, status: 401, error: 'Missing agent token' });
    expect(verifiedTokens).toEqual([]);
  });
});

test('resolveAgentAuth ignores a bearer token without the agent prefix', async () => {
  await withVerifyAgentToken(async () => VERIFIED_TOKEN, async () => {
    const result = await resolveAgentAuth(makeReq({ authorization: 'Bearer valid-jwt' }));
    expect(result).toEqual({ ok: false, status: 401, error: 'Missing agent token' });
    expect(verifiedTokens).toEqual([]);
  });
});

test('resolveAgentAuth prefers X-Agent-Token over a prefixed bearer token', async () => {
  await withVerifyAgentToken(async () => VERIFIED_TOKEN, async () => {
    await resolveAgentAuth(makeReq({ 'x-agent-token': 'aat_header', authorization: 'Bearer aat_bearer' }));
    expect(verifiedTokens).toEqual(['aat_header']);
  });
});

test('resolveAgentAuth accepts a prefixed bearer token and returns the auth context', async () => {
  await withVerifyAgentToken(async () => VERIFIED_TOKEN, async () => {
    const result = await resolveAgentAuth(makeReq({ authorization: 'Bearer aat_bearer' }));
    expect(verifiedTokens).toEqual(['aat_bearer']);
    expect(result).toEqual({
      ok: true,
      auth: {
        user: { id: 'u1' },
        profile: { id: 'p1' },
        agentToken: { id: 't1', name: 'n', hint: 'h' },
        supabase: fakeAnon
      }
    });
  });
});

test.each([
  ['a verification error', { data: VERIFIED_TOKEN.data, error: new Error('db') }],
  ['no data', { data: null, error: null }],
  ['no profile', { data: { ...VERIFIED_TOKEN.data, profile: null }, error: null }]
])('resolveAgentAuth reports an invalid token on %s', async (_label, verified) => {
  await withVerifyAgentToken(async () => verified, async () => {
    const result = await resolveAgentAuth(makeReq({ 'x-agent-token': 'aat_x' }));
    expect(result).toEqual({ ok: false, status: 401, error: 'Invalid agent token' });
  });
});

test('resolveAgentAuth lets a thrown verification error propagate', async () => {
  await withVerifyAgentToken(async () => { throw new Error('exploded'); }, async () => {
    await expect(resolveAgentAuth(makeReq({ 'x-agent-token': 'aat_x' }))).rejects.toThrow('exploded');
  });
});

test('isAgentAuthenticated answers 401 JSON and skips next when auth fails', async () => {
  await withVerifyAgentToken(async () => ({ data: null, error: null }), async () => {
    const sent = {};
    const res = {
      locals: {},
      status(code) { sent.status = code; return this; },
      json(body) { sent.body = body; return this; }
    };
    let nextCalled = false;
    await isAgentAuthenticated(makeReq({ 'x-agent-token': 'aat_x' }), res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(sent).toEqual({ status: 401, body: { error: 'Invalid agent token' } });
    expect(res.locals).toEqual({});
  });
});

test('isAgentAuthenticated copies the resolved auth context onto res.locals', async () => {
  const res = makeRes();
  let nextCalled = false;
  await isAgentAuthenticated(makeReq({ 'x-agent-token': 'aat_ok' }), res, () => { nextCalled = true; });
  expect(nextCalled).toBe(true);
  expect(res.locals).toEqual({
    user: { id: 'u1' },
    supabase: fakeAnon,
    profile: { id: 'p1' },
    agentToken: { id: 't1', name: 'n', hint: 'h' }
  });
});

// ---------------------------------------------------------------------------
// History-restore requests (issue #163).
//
// htmx's cache-miss path, loadHistoryFromServer (htmx 2.0.8 dist 3310-3337),
// re-fetches the URL with `HX-Request: true` and `HX-History-Restore-Request:
// true`, then swaps the response body VERBATIM -- it never looks at
// HX-Redirect. Answering it the way every other htmx request is answered
// (`200`, an HX-Redirect header, an empty body) therefore swaps zero bytes
// into <body> and leaves the user on a permanently white page at a
// correct-looking URL.
//
// So a history restore must be answered with something renderable. These
// tests pin that: a real body, and specifically NOT the empty-body shape.
// ---------------------------------------------------------------------------
const makeRecordingRes = () => {
  const calls = { render: [], set: {}, header: {}, end: 0, redirect: [], status: null };
  return {
    calls,
    locals: {},
    header(k, v) { calls.header[k] = v; },
    set(k, v) { calls.set[k] = v; },
    status(code) { calls.status = code; return this; },
    end() { calls.end += 1; },
    redirect(url) { calls.redirect.push(url); },
    render(view, opts) { calls.render.push([view, opts]); }
  };
};

test('a history-restore request with no token renders the sign-in page, not an empty body', async () => {
  const req = makeReq({
    'hx-request': 'true',
    'hx-history-restore-request': 'true'
  });
  req.originalUrl = '/profile';
  const res = makeRecordingRes();
  let nextCalled = false;
  await isAuthenticated(req, res, () => { nextCalled = true; });

  expect(nextCalled).toBe(false);
  expect(res.calls.render.length).toBe(1);
  expect(res.calls.render[0][0]).toBe('auth');
  // The defect, stated directly: zero bytes swapped into <body>.
  expect(res.calls.end).toBe(0);
  // ...and no HX-Redirect, which this path can never act on.
  expect(res.calls.set['HX-Redirect']).toBeUndefined();
});

test('a history-restore request with an expired token renders the sign-in page, not an empty body', async () => {
  const req = makeReq({
    authorization: 'Bearer expired-jwt',
    'hx-request': 'true',
    'hx-history-restore-request': 'true'
  });
  req.originalUrl = '/profile';
  const res = makeRecordingRes();
  let nextCalled = false;
  await isAuthenticated(req, res, () => { nextCalled = true; });

  expect(nextCalled).toBe(false);
  expect(res.calls.render.length).toBe(1);
  expect(res.calls.render[0][0]).toBe('auth');
  expect(res.calls.end).toBe(0);
  expect(res.calls.set['HX-Redirect']).toBeUndefined();
});

// Positive control. An ordinary boosted request has a live client behind it
// that DOES process HX-Redirect, and rewriting that path would break the
// signed-out bounce for every navigation in the app.
test('an ordinary htmx request with no token still gets the HX-Redirect bounce', async () => {
  const req = makeReq({ 'hx-request': 'true' });
  req.originalUrl = '/profile';
  const res = makeRecordingRes();
  await isAuthenticated(req, res, () => {});

  expect(res.calls.render.length).toBe(0);
  expect(res.calls.set['HX-Redirect']).toBe('/auth/check?r=%2Fprofile');
  expect(res.calls.end).toBe(1);
});

test('an ordinary htmx request with an expired token still gets the HX-Redirect bounce', async () => {
  const req = makeReq({ authorization: 'Bearer expired-jwt', 'hx-request': 'true' });
  const res = makeRecordingRes();
  await isAuthenticated(req, res, () => {});

  expect(res.calls.render.length).toBe(0);
  expect(res.calls.set['HX-Redirect']).toBe('/auth');
  expect(res.calls.end).toBe(1);
});
