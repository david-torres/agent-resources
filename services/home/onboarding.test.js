const { test, expect, spyOn } = require('bun:test');
const { computeOnboarding, loadOnboarding } = require('./onboarding');
const { STARTER_RULES_PDF_ID } = require('../../util/starter-content');

const NOW = new Date('2026-08-17T12:00:00Z');
const TRIAL_24 = { state: 'trial', endsAt: '2026-09-10T12:00:00Z', daysLeft: 24, urgent: false, endsToday: false };
const base = () => ({
  profile: { user_id: 'u1', name: 'Dave', onboarding: {} },
  hasCharacters: false, hasMissions: false, inGame: false,
  advent: TRIAL_24,
  freePdf: { id: 'qs-id' }
});

test('a fresh profile with no path is asked the path question', () => {
  const m = computeOnboarding(base());
  expect(m.show).toBe(true);
  expect(m.askPath).toBe(true);
  expect(m.persistDismiss).toBe(false);
});

test('an account that already has characters is silently dismissed instead of quizzed', () => {
  const m = computeOnboarding({ ...base(), hasCharacters: true });
  expect(m.show).toBe(false);
  expect(m.persistDismiss).toBe(true);
});

test('an account with mission logs is silently dismissed too', () => {
  const m = computeOnboarding({ ...base(), hasMissions: true });
  expect(m.show).toBe(false);
  expect(m.persistDismiss).toBe(true);
});

test('a dismissed profile never shows the card', () => {
  const m = computeOnboarding({ ...base(), profile: { user_id: 'u1', name: 'Dave', onboarding: { dismissed: true } } });
  expect(m.show).toBe(false);
  expect(m.persistDismiss).toBe(false);
});

test('the default provisioning name does not count as name set', () => {
  const m = computeOnboarding({ ...base(), profile: { user_id: 'u1', name: 'Agent #u1', onboarding: { path: 'new' } } });
  expect(m.nameDone).toBe(false);
});

test('a chosen name counts, even one starting with Agent #', () => {
  const m = computeOnboarding({ ...base(), profile: { user_id: 'u1', name: 'Agent #7', onboarding: { path: 'new' } } });
  expect(m.nameDone).toBe(true);
});

test('steps derive on the new path', () => {
  const m = computeOnboarding({
    ...base(),
    profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new', read_rules: true } },
    hasCharacters: true, inGame: false
  });
  expect(m.path).toBe('new');
  expect(m.askPath).toBe(false);
  expect(m.nameDone).toBe(true);
  expect(m.learnDone).toBe(true);
  expect(m.characterDone).toBe(true);
  expect(m.gameDone).toBe(false);
  expect(m.allDone).toBe(false);
});

test('all four done on the veteran path flags allDone and persists the dismissal', () => {
  const m = computeOnboarding({
    ...base(),
    profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'veteran', redeemed: true } },
    hasCharacters: true, inGame: true
  });
  expect(m.allDone).toBe(true);
  expect(m.show).toBe(true);          // renders the "You're all set" state once
  expect(m.persistDismiss).toBe(true); // caller stores dismissed so it never re-renders
});

test("advent days-left comes from the edition status and links the starter PDF", () => {
  const m = computeOnboarding({ ...base(), profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } } });
  expect(m.adventDaysLeft).toBe(24);
  expect(m.adventHref).toBe(`/library/${STARTER_RULES_PDF_ID}/view`);
  expect(m.quickstartHref).toBe('/library/qs-id/view');
});

test('an expired Advent trial drops the advent link but keeps the quickstart', () => {
  const m = computeOnboarding({
    ...base(),
    profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } },
    advent: { state: 'expired', endedAt: '2026-08-01T00:00:00Z' }
  });
  expect(m.adventDaysLeft).toBeNull();
  expect(m.adventHref).toBeNull();
  expect(m.quickstartHref).toBe('/library/qs-id/view');
});

test('an owned Advent shows no trial countdown', () => {
  const m = computeOnboarding({
    ...base(),
    profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } },
    advent: { state: 'owned' }
  });
  expect(m.adventDaysLeft).toBeNull();
  expect(m.adventHref).toBeNull();
});

test('no edition status behaves like no trial', () => {
  const m = computeOnboarding({
    ...base(),
    profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } },
    advent: null
  });
  expect(m.adventDaysLeft).toBeNull();
});

// ---- loadOnboarding ----

const deps = (over = {}) => ({
  countCharactersByCreator: async () => ({ data: 0, error: null }),
  hasAnyGameActivity: async () => ({ data: false, error: null }),
  getEditionAccess: async () => ({ advent: TRIAL_24, aspirant: { state: 'none' } }),
  getRulesPdfs: async () => ({
    data: [{ id: 'qs-id', is_active: true, free_access: true }, { id: 'core', is_active: true, free_access: false }],
    error: null
  }),
  ...over
});

test('loadOnboarding for a signed-out visitor returns only the quickstart link', async () => {
  const m = await loadOnboarding({ profile: null, client: {}, now: NOW }, deps());
  expect(m.show).toBe(false);
  expect(m.quickstartHref).toBe('/library/qs-id/view');
});

test('loadOnboarding short-circuits a dismissed profile with zero reads', async () => {
  let reads = 0;
  const counting = deps({
    countCharactersByCreator: async () => { reads++; return { data: 0, error: null }; },
    getRulesPdfs: async () => { reads++; return { data: [], error: null }; }
  });
  const m = await loadOnboarding(
    { profile: { user_id: 'u1', name: 'Dave', onboarding: { dismissed: true } }, client: {}, now: NOW },
    counting
  );
  expect(m.show).toBe(false);
  expect(reads).toBe(0);
});

test('loadOnboarding fills hasCharacters itself when the caller did not', async () => {
  const m = await loadOnboarding(
    { profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } }, client: {}, now: NOW },
    deps({ countCharactersByCreator: async () => ({ data: 2, error: null }) })
  );
  expect(m.characterDone).toBe(true);
});

test('loadOnboarding trusts a caller-supplied hasCharacters and skips that read', async () => {
  let called = false;
  const m = await loadOnboarding(
    { profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } }, client: {}, hasCharacters: true, hasMissions: false, now: NOW },
    deps({ countCharactersByCreator: async () => { called = true; return { data: 0, error: null }; } })
  );
  expect(m.characterDone).toBe(true);
  expect(called).toBe(false);
});

test('a failed read degrades that step, never the whole card', async () => {
  const m = await loadOnboarding(
    { profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } }, client: {}, now: NOW },
    deps({ hasAnyGameActivity: async () => { throw new Error('db down'); } })
  );
  expect(m.show).toBe(true);
  expect(m.gameDone).toBe(false);
});

// POST /profile/onboarding answers an htmx fragment, which the auth step
// skips, so loadOnboarding has to find the status on its own.
test('loadOnboarding looks the Advent status up itself when the caller has none', async () => {
  const calls = [];
  const m = await loadOnboarding(
    { profile: { user_id: 'u1', name: 'Vex', timezone: 'America/New_York', onboarding: { path: 'new' } }, client: {}, now: NOW },
    deps({ getEditionAccess: async (...args) => { calls.push(args); return { advent: TRIAL_24, aspirant: { state: 'none' } }; } })
  );
  expect(calls).toEqual([['u1', NOW, { timeZone: 'America/New_York' }]]);
  expect(m.adventDaysLeft).toBe(24);
});

test("loadOnboarding uses a caller-supplied Advent status and skips the lookup", async () => {
  let lookups = 0;
  const m = await loadOnboarding(
    { profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } }, client: {}, advent: { ...TRIAL_24, daysLeft: 3 }, now: NOW },
    deps({ getEditionAccess: async () => { lookups++; return null; } })
  );
  expect(m.adventDaysLeft).toBe(3);
  expect(lookups).toBe(0);
});

test('a throwing edition lookup degrades to no countdown, never the whole card', async () => {
  const errSpy = spyOn(console, 'error').mockImplementation(() => {});
  const m = await loadOnboarding(
    { profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } }, client: {}, now: NOW },
    deps({ getEditionAccess: async () => { throw new Error('down'); } })
  );
  expect(m.show).toBe(true);
  expect(m.adventDaysLeft).toBeNull();
  errSpy.mockRestore();
});
