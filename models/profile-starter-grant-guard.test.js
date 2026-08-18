const { test, expect } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');

// Starter grants used to be detected by probing class_unlocks
// (fetchStarterUnlockRows). Since starter classes now derive from the
// rules_pdf_unlocks book row, that probe is empty for book-only users on
// EVERY request, so getProfile re-fires grantStarterUnlocks each time --
// and re-inserts a revoked starter book with a fresh 30-day expiry.
//
// Target behavior: profiles carry a `starter_granted_at` timestamptz.
// getProfile grants ONLY when the fetched row's starter_granted_at is
// null/absent, and grantStarterUnlocks stamps it (via
// profileRepository.markStarterGranted) once the grant RPC succeeds.

const makeProfileRow = (overrides = {}) => ({
  id: 'p1',
  user_id: 'u1',
  name: 'Agent #u1',
  role: 'user',
  onboarding: {},
  ...overrides
});

const CONFIRMED_USER = { id: 'u1', confirmed_at: '2026-08-17T00:00:00Z' };

const loadProfileModel = ({ profileRow, repositoryExtras = {}, rpc }) => {
  const rpcCalls = [];
  const model = freshRequire(require.resolve('../models/profile'), new Map([
    [require.resolve('../models/_base'), {
      supabase: {
        rpc: async (name, args) => {
          rpcCalls.push({ name, args });
          return rpc ? rpc(name, args) : { data: null, error: null };
        }
      },
      supabaseAdmin: {},
      createUserClient: () => ({})
    }],
    [require.resolve('../services/profile/service'), {
      ProfileService: class ProfileService { }
    }],
    [require.resolve('../services/profile/repository'), {
      fetchOwnProfile: async () => ({ data: profileRow, error: null }),
      ...repositoryExtras
    }],
    [require.resolve('../util/starter-content'), { STARTER_RULES_PDF_ID: 'starter-pdf' }]
  ]));
  return { model, rpcCalls };
};

// Revoke-resurrection regression: an admin deleted the starter book row, so
// the class_unlocks/book probe looks "empty" -- but starter_granted_at says
// the trial was already granted. The next request must NOT grant it again.
test('getProfile does not re-grant when the profile is already stamped starter_granted_at', async () => {
  const { model, rpcCalls } = loadProfileModel({
    profileRow: makeProfileRow({ starter_granted_at: '2026-07-01T00:00:00Z' }),
    // Book-only (or revoked) user: the legacy probe finds nothing.
    repositoryExtras: { fetchStarterUnlockRows: async () => ({ data: [], error: null }) }
  });

  await model.getProfile(CONFIRMED_USER);

  expect(rpcCalls.map(c => c.name)).not.toContain('grant_starter_rules_unlock');
});

// Backfill: profiles created before the feature have starter_granted_at null.
// The guard must key off that column alone -- no class_unlocks probe -- and
// fire the grant.
test('getProfile grants starter unlocks when starter_granted_at is null', async () => {
  const { model, rpcCalls } = loadProfileModel({
    profileRow: makeProfileRow({ starter_granted_at: null }),
    // Deliberately no fetchStarterUnlockRows: the target guard reads only
    // the profile row it already fetched.
    repositoryExtras: { markStarterGranted: async () => ({ data: null, error: null }) }
  });

  await model.getProfile(CONFIRMED_USER);

  expect(rpcCalls.map(c => c.name)).toContain('grant_starter_rules_unlock');
});

test('grantStarterUnlocks stamps starter_granted_at through the repository on RPC success', async () => {
  const stampCalls = [];
  const { model } = loadProfileModel({
    profileRow: makeProfileRow(),
    repositoryExtras: {
      markStarterGranted: async (userId) => {
        stampCalls.push(userId);
        return { data: null, error: null };
      }
    }
  });

  await model.grantStarterUnlocks('u1', 'p1');

  expect(stampCalls).toEqual(['u1']);
});

// A failed grant must stay re-tryable: no stamp means the next request's
// guard fires again.
test('grantStarterUnlocks does not stamp starter_granted_at when the grant RPC errors', async () => {
  const stampCalls = [];
  const { model } = loadProfileModel({
    profileRow: makeProfileRow(),
    rpc: () => ({ data: null, error: { message: 'boom' } }),
    repositoryExtras: {
      markStarterGranted: async (userId) => {
        stampCalls.push(userId);
        return { data: null, error: null };
      }
    }
  });

  await model.grantStarterUnlocks('u1', 'p1');

  expect(stampCalls).toEqual([]);
});
