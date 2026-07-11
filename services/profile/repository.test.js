const { test, expect } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const repository = require('./repository');

// Guards against a missed extraction: every privileged profile query must be
// reachable through the repository, the sole consumer of supabaseAdmin for
// this domain. Deep behavior is covered by the model/service tests that
// already exercise these paths.
const expectedMethods = [
  'fetchOwnProfile',
  'fetchStarterUnlockRows',
  'fetchProfileByIdAdmin',
  'fetchProfileByNameAdmin',
  'searchProfilesAdmin',
  'insertProfile',
  'updateAuthUser',
  'updateProfileByUserId',
  'updateDiscord'
];

test('exports every repository method', () => {
  for (const method of expectedMethods) {
    expect(typeof repository[method]).toBe('function');
  }
});
