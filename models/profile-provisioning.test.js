const { test, expect } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');

// First sign-in: fetchOwnProfile misses (PGRST116), provisionProfile inserts.
// createProfileForUser resolves with the insert's row ARRAY -- getProfile must
// unwrap it, or res.locals.profile becomes an array for that first request and
// every profile.id / profile.user_id read on the page sends "undefined".
const ROW = { id: 'p1', user_id: 'u1', name: 'Agent #u1', role: 'user', onboarding: {} };

const loadProfileModel = () => freshRequire(require.resolve('../models/profile'), new Map([
  [require.resolve('../models/_base'), {
    // grantStarterUnlocks runs during provisioning; its rpc calls just no-op.
    supabase: { rpc: async () => ({ error: null }) },
    supabaseAdmin: {},
    createUserClient: () => ({})
  }],
  [require.resolve('../services/profile/service'), {
    ProfileService: class ProfileService {
      async createProfileForUser() { return { data: [ROW], error: null }; }
    }
  }],
  [require.resolve('../services/profile/repository'), {
    fetchOwnProfile: async () => ({ data: null, error: { code: 'PGRST116' } })
  }],
  [require.resolve('../util/starter-content'), { STARTER_RULES_PDF_ID: 'starter-pdf', STARTER_CLASS_UNLOCKS: {} }]
]));

test('getProfile returns the profile object, not the insert array, on first sign-in', async () => {
  const { getProfile } = loadProfileModel();
  const profile = await getProfile({ id: 'u1', confirmed_at: '2026-08-17T00:00:00Z' });
  expect(Array.isArray(profile)).toBe(false);
  expect(profile).toEqual(ROW);
});

test('getProfile returns false when provisioning yields no row', async () => {
  const emptyInsert = freshRequire(require.resolve('../models/profile'), new Map([
    [require.resolve('../models/_base'), {
      supabase: { rpc: async () => ({ error: null }) }, supabaseAdmin: {}, createUserClient: () => ({})
    }],
    [require.resolve('../services/profile/service'), {
      ProfileService: class ProfileService {
        async createProfileForUser() { return { data: [], error: null }; }
      }
    }],
    [require.resolve('../services/profile/repository'), {
      fetchOwnProfile: async () => ({ data: null, error: { code: 'PGRST116' } })
    }],
    [require.resolve('../util/starter-content'), { STARTER_RULES_PDF_ID: 'starter-pdf', STARTER_CLASS_UNLOCKS: {} }]
  ]));
  const profile = await emptyInsert.getProfile({ id: 'u1', confirmed_at: '2026-08-17T00:00:00Z' });
  expect(profile).toBe(false);
});
