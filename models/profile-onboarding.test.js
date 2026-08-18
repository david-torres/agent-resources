const { test, expect } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');

// Records the update call; serves a canned current row for the read.
let currentOnboarding = { path: 'new' };
let updateCall = null;

const fakeAdmin = {
  from(table) {
    const chain = {
      select() { return chain; },
      eq(col, val) { chain._eq = { col, val }; return chain; },
      single() {
        return Promise.resolve({ data: { onboarding: currentOnboarding }, error: null });
      },
      update(values) {
        updateCall = { table, values, eq: null };
        const updChain = {
          eq(col, val) { updateCall.eq = { col, val }; return updChain; },
          select() { return updChain; },
          single() { return Promise.resolve({ data: { onboarding: values.onboarding }, error: null }); }
        };
        return updChain;
      }
    };
    return chain;
  }
};

// profile.js's actual top-of-file requires (models/profile.js):
//   ./_base                       -> { supabase, supabaseAdmin } (destructured)
//   ../util/validate               -> { escapeLikePattern } (no relative requires of its own; loaded for real)
//   ../util/actor                  -> { SYSTEM_ACTOR } (no relative requires of its own; loaded for real)
//   ../services/profile/service    -> { ProfileService } (a class, `new`-ed at module load time)
//   ../services/profile/repository -> the whole module object (default require, not destructured)
//   ../util/starter-content        -> { STARTER_RULES_PDF_ID }
// Only _base needs a real fake (supabaseAdmin); the rest are inert stand-ins
// shaped to match how profile.js actually imports them, so the module loads
// without touching real Supabase clients or the real ProfileService's
// repository-shape validation.
const loadProfileModel = () => freshRequire(require.resolve('../models/profile'), new Map([
  [require.resolve('../models/_base'), {
    supabase: {}, supabaseAdmin: fakeAdmin, createUserClient: () => ({})
  }],
  [require.resolve('../services/profile/service'), { ProfileService: class ProfileService {} }],
  [require.resolve('../services/profile/repository'), {}],
  [require.resolve('../util/starter-content'), { STARTER_RULES_PDF_ID: 'starter-pdf' }]
]));

test('patchOnboarding shallow-merges the patch into the existing jsonb', async () => {
  currentOnboarding = { path: 'new' };
  updateCall = null;
  const { patchOnboarding } = loadProfileModel();
  const { data, error } = await patchOnboarding('u1', { read_rules: true });
  expect(error).toBeNull();
  expect(data).toEqual({ path: 'new', read_rules: true });
  expect(updateCall.values.onboarding).toEqual({ path: 'new', read_rules: true });
  expect(updateCall.eq).toEqual({ col: 'user_id', val: 'u1' });
});

test('patchOnboarding treats a null current value as an empty object', async () => {
  currentOnboarding = null;
  updateCall = null;
  const { patchOnboarding } = loadProfileModel();
  const { data, error } = await patchOnboarding('u1', { dismissed: true });
  expect(error).toBeNull();
  expect(data).toEqual({ dismissed: true });
});
