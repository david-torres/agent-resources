// searchProfilesAdmin must use the service-role client (private profiles are
// findable in admin tooling) and keep searchProfiles' short-query guard.
const { mock, test, expect, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || 'test-secret-key';

const realBase = require('./_base');

const calls = { admin: 0, anon: 0 };
const makeClient = (key) => ({
  from() {
    calls[key]++;
    const chain = {
      select() { return chain; },
      ilike() { return chain; },
      limit() { return Promise.resolve({ data: [{ id: 'p1', name: 'Hidden User', image_url: null }], error: null }); }
    };
    return chain;
  }
});

mock.module('./_base', () => ({
  supabase: makeClient('anon'),
  supabaseAdmin: makeClient('admin'),
  anonKey: 'test-anon-key',
  createUserClient: () => makeClient('anon')
}));

delete require.cache[require.resolve('./profile')];
const { searchProfilesAdmin } = require('./profile');

afterAll(() => {
  mock.module('./_base', () => realBase);
  delete require.cache[require.resolve('./profile')];
});

test('searchProfilesAdmin queries via the admin client', async () => {
  const { data, error } = await searchProfilesAdmin('hidden');
  expect(error).toBeNull();
  expect(data).toEqual([{ id: 'p1', name: 'Hidden User', image_url: null }]);
  expect(calls.admin).toBe(1);
  expect(calls.anon).toBe(0);
});

test('searchProfilesAdmin returns [] for short queries without querying', async () => {
  calls.admin = 0;
  const { data } = await searchProfilesAdmin('a');
  expect(data).toEqual([]);
  expect(calls.admin).toBe(0);
});
