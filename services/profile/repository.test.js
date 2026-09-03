const { test, expect } = require('bun:test');
const { freshRequire } = require('../../test/helpers/fresh-require');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const repository = require('./repository');

const loadRepository = (fakeAdmin) => freshRequire(require.resolve('./repository'), new Map([
  [require.resolve('../../models/_base'), { supabase: {}, supabaseAdmin: fakeAdmin }]
]));

// Guards against a missed extraction: every privileged profile query must be
// reachable through the repository, the sole consumer of supabaseAdmin for
// this domain. Deep behavior is covered by the model/service tests that
// already exercise these paths.
const expectedMethods = [
  'fetchOwnProfile',
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

test('insertProfile trims whitespace from the row before writing', async () => {
  let inserted = null;
  const fakeAdmin = {
    from(table) {
      return {
        insert(row) {
          inserted = row;
          return { select: () => Promise.resolve({ data: [{ ...row }], error: null }) };
        }
      };
    }
  };
  const { insertProfile } = loadRepository(fakeAdmin);
  await insertProfile({ name: 'Dave ', image_url: 'https://example.com/x.png' });
  expect(inserted.name).toBe('Dave');
});

test('updateProfileByUserId trims whitespace from the fields before writing', async () => {
  let updated = null;
  const fakeAdmin = {
    from(table) {
      return {
        update(fields) {
          updated = fields;
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        }
      };
    }
  };
  const { updateProfileByUserId } = loadRepository(fakeAdmin);
  await updateProfileByUserId('u1', { name: ' Dave ' });
  expect(updated.name).toBe('Dave');
});

test('updateDiscord trims whitespace from the discord identity before writing', async () => {
  let updated = null;
  const fakeAdmin = {
    from(table) {
      return {
        update(fields) {
          updated = fields;
          return { eq: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) };
        }
      };
    }
  };
  const { updateDiscord } = loadRepository(fakeAdmin);
  await updateDiscord('u1', ' 123456789 ', ' player@example.com ');
  expect(updated.discord_id).toBe('123456789');
  expect(updated.discord_email).toBe('player@example.com');
});
