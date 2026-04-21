const { test, expect, mock, afterAll } = require('bun:test');

const realBase = require('../models/_base');

const fakeAnon = { __name: 'anon', auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
const fakeAdmin = { __name: 'admin' };
const fakeCreateUserClient = (token) => ({ __name: 'user', __token: token });

mock.module('../models/_base', () => ({
  supabase: fakeAnon,
  supabaseAdmin: fakeAdmin,
  anonKey: 'x',
  createUserClient: fakeCreateUserClient
}));

mock.module('./supabase', () => ({
  getUserFromToken: async (token) => token === 'valid-jwt' ? { id: 'u1' } : false,
  getProfile: async () => ({ id: 'p1', user_id: 'u1' })
}));
mock.module('./system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../models/agent-token', () => ({
  verifyAgentToken: async () => ({ data: { userId: 'u1', profile: { id: 'p1' }, tokenId: 't1', tokenName: 'n', tokenHint: 'h' }, error: null }),
  AGENT_TOKEN_PREFIX: 'aat_'
}));
mock.module('./nav-loader', () => ({ populateNavItems: async () => {} }));

delete require.cache[require.resolve('./auth')];
const { isAuthenticated, authOptional, isAgentAuthenticated } = require('./auth');

afterAll(() => {
  mock.module('../models/_base', () => realBase);
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

test('isAgentAuthenticated attaches the admin client', async () => {
  const req = makeReq({ 'x-agent-token': 'aat_stub' });
  const res = makeRes();
  await isAgentAuthenticated(req, res, () => {});
  expect(res.locals.supabase.__name).toBe('admin');
});
