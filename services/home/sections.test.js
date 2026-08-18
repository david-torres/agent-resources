const { test, expect } = require('bun:test');
const { loadHomeSections } = require('./sections');

const ok = (rows) => async () => ({ data: rows, error: null });
const failsWith = (message) => async () => ({ data: null, error: new Error(message) });
const throws = (message) => async () => { throw new Error(message); };

const CHARACTER = { id: 'c1', name: 'Vex', class: 'Gunslinger', level: 3, updated_at: '2026-08-10T00:00:00+00:00' };
const MISSION = { id: 'm1', name: 'The Long Dark', outcome: 'success', date: '2026-08-01T00:00:00+00:00', updated_at: '2026-08-09T00:00:00+00:00' };
const KLASS = { id: 'k1', name: 'Tinkerer', status: 'beta', rules_edition: 'advent', updated_at: '2026-08-08T00:00:00+00:00' };
const NEWS = { id: 'n1', title: 'Patch 3', slug: 'patch-3', content: '## Patch 3\n\nBadges **shipped**.', created_at: '2026-08-07T00:00:00+00:00' };
const GAME = { id: 'g1', title: 'Saturday Run', date: '2026-08-20T18:00:00+00:00', role: 'host', characterName: null };

const allGood = () => ({
  getRecentCharactersByCreator: ok([CHARACTER]),
  getRecentPublicCharacters: ok([CHARACTER]),
  getRecentMissionsByCreator: ok([MISSION]),
  getRecentPublicMissions: ok([MISSION]),
  getRecentClassesByCreator: ok([KLASS]),
  getRecentNews: ok([NEWS]),
  getUpcomingForProfile: ok([GAME])
});

const profile = { id: 'p1' };
const client = {};

test('loadHomeSections merges the signed-in feed across all three types', async () => {
  const result = await loadHomeSections({ profile, client }, allGood());
  expect(result.recentMine.map(i => i.id)).toEqual(['c1', 'm1', 'k1']);
  expect(result.recentMine[0].href).toBe('/characters/c1');
});

test('loadHomeSections attaches an excerpt to each news post', async () => {
  const result = await loadHomeSections({ profile, client }, allGood());
  expect(result.news).toHaveLength(1);
  expect(result.news[0].slug).toBe('patch-3');
  expect(result.news[0].excerpt).toBe('Patch 3 Badges shipped.');
});

test('loadHomeSections returns upcoming games unchanged', async () => {
  const result = await loadHomeSections({ profile, client }, allGood());
  expect(result.upcomingGames).toEqual([GAME]);
});

test('loadHomeSections skips personalized sections for a signed-out visitor', async () => {
  let personalCalls = 0;
  const deps = {
    ...allGood(),
    getRecentCharactersByCreator: async () => { personalCalls++; return { data: [], error: null }; },
    getUpcomingForProfile: async () => { personalCalls++; return { data: [], error: null }; }
  };

  const result = await loadHomeSections({ profile: null, client }, deps);

  expect(personalCalls).toBe(0);
  expect(result.recentMine).toEqual([]);
  expect(result.upcomingGames).toEqual([]);
  expect(result.news).toHaveLength(1);
  expect(result.community).not.toHaveLength(0);
});

test('loadHomeSections excludes the viewer own rows from the community feed', async () => {
  let excluded;
  const deps = {
    ...allGood(),
    getRecentPublicCharacters: async (opts) => { excluded = opts.excludeProfileId; return { data: [], error: null }; }
  };

  await loadHomeSections({ profile, client }, deps);
  expect(excluded).toBe('p1');
});

test('one section returning an error empties that section and leaves the rest intact', async () => {
  const deps = { ...allGood(), getRecentNews: failsWith('news table exploded') };
  const result = await loadHomeSections({ profile, client }, deps);

  expect(result.news).toEqual([]);
  expect(result.recentMine).not.toHaveLength(0);
  expect(result.upcomingGames).not.toHaveLength(0);
  expect(result.community).not.toHaveLength(0);
});

test('one section throwing empties that section and leaves the rest intact', async () => {
  const deps = { ...allGood(), getUpcomingForProfile: throws('connection reset') };
  const result = await loadHomeSections({ profile, client }, deps);

  expect(result.upcomingGames).toEqual([]);
  expect(result.recentMine).not.toHaveLength(0);
  expect(result.news).not.toHaveLength(0);
});

// --- hasCharacters ----------------------------------------------------------
//
// Read from the raw myCharacters query, not from recentMine: recentMine
// merges characters/missions/classes together and truncates to MINE_LIMIT,
// so a player who has characters can still have every one of them pushed out
// of that merged, truncated list by enough more-recently-updated missions or
// classes. hasCharacters must stay true regardless of that truncation.

test('hasCharacters is true when the player has characters', async () => {
  const result = await loadHomeSections({ profile, client }, allGood());
  expect(result.hasCharacters).toBe(true);
});

test('hasCharacters is false when the player has no characters', async () => {
  const deps = { ...allGood(), getRecentCharactersByCreator: ok([]) };
  const result = await loadHomeSections({ profile, client }, deps);
  expect(result.hasCharacters).toBe(false);
});

test('hasCharacters stays true even when recentMine truncates every character out of the merged top MINE_LIMIT', async () => {
  // One character, older than six missions -- mergeRecent's global sort
  // across types plus its slice(0, 6) evicts the character entirely, so
  // recentMine carries zero character-typed rows even though the player
  // owns one.
  const oldCharacter = { ...CHARACTER, updated_at: '2026-08-01T00:00:00+00:00' };
  const newerMissions = Array.from({ length: 6 }, (_, i) => ({
    id: `m${i}`, name: `Mission ${i}`, outcome: 'success',
    date: '2026-08-01T00:00:00+00:00',
    updated_at: `2026-08-1${i}T00:00:00+00:00`
  }));
  const deps = {
    ...allGood(),
    getRecentCharactersByCreator: ok([oldCharacter]),
    getRecentMissionsByCreator: ok(newerMissions),
    getRecentClassesByCreator: ok([])
  };

  const result = await loadHomeSections({ profile, client }, deps);

  expect(result.recentMine.some(item => item.type === 'character')).toBe(false);
  expect(result.hasCharacters).toBe(true);
});

test('every section failing still resolves with four empty arrays', async () => {
  const deps = Object.fromEntries(Object.keys(allGood()).map(key => [key, throws('down')]));
  const result = await loadHomeSections({ profile, client }, deps);

  // Onboarding reads aren't part of allGood()'s key set, so they're absent
  // from `deps` here too and each throws inside loadOnboarding's own
  // settle() wrapper -- degrading to the same "nothing known yet" shape.
  expect(result).toEqual({
    hasCharacters: false, recentMine: [], upcomingGames: [], news: [], community: [],
    onboarding: {
      show: true, askPath: true, persistDismiss: false, path: null,
      nameDone: true, learnDone: false, redeemDone: false,
      characterDone: false, gameDone: false, allDone: false,
      adventDaysLeft: null, adventHref: null, quickstartHref: null
    }
  });
});

// --- onboarding --------------------------------------------------------------

const onboardingDeps = {
  countCharactersByCreator: ok(0),
  hasAnyGameActivity: ok(false),
  listRulesPdfUnlocksForUser: ok([]),
  getRulesPdfs: ok([{ id: 'qs-id', is_active: true, free_access: true }])
};

test('loadHomeSections computes onboarding for a signed-in player', async () => {
  const result = await loadHomeSections(
    { profile: { id: 'p1', user_id: 'u1', name: 'Agent #u1', onboarding: {} }, client },
    { ...allGood(), ...onboardingDeps, getRecentCharactersByCreator: ok([]), getRecentMissionsByCreator: ok([]) }
  );
  expect(result.onboarding.show).toBe(true);
  expect(result.onboarding.askPath).toBe(true);
});

test('loadHomeSections reuses its own character/mission reads for the onboarding gate', async () => {
  // Player has characters via the section read; the gate must see that
  // without a second count query.
  let countCalls = 0;
  const result = await loadHomeSections(
    { profile: { id: 'p1', user_id: 'u1', name: 'Agent #u1', onboarding: {} }, client },
    { ...allGood(), ...onboardingDeps, countCharactersByCreator: async () => { countCalls++; return { data: 9, error: null }; } }
  );
  expect(result.onboarding.show).toBe(false);       // has characters -> gated
  expect(result.onboarding.persistDismiss).toBe(true);
  expect(countCalls).toBe(0);
});

test('loadHomeSections gives a signed-out visitor the quickstart link only', async () => {
  const result = await loadHomeSections(
    { profile: null, client },
    { ...allGood(), ...onboardingDeps }
  );
  expect(result.onboarding.show).toBe(false);
  expect(result.onboarding.quickstartHref).toBe('/library/qs-id/view');
});
