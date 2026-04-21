const { mock, test, expect, beforeAll, afterAll } = require('bun:test');

// Capture the real `_base` exports before we replace them, so we can restore
// after this file runs. Without this, the mock leaks into subsequent test
// files (e.g. routes/bot-link.test.js) and breaks them because their real
// `supabaseAdmin.from(...).delete()` calls land on our fake client.
const realBase = require('./_base');

// Build a tiny fake supabase client. Each `.from(table)` returns a chain
// that resolves to `{ data, error }` where data comes from the provided
// `tableToRows` map (keyed by table name). The chain supports `.select()`,
// `.eq()`, `.in()`, and `.single()`. Both `.eq()` and `.in()` are terminal
// (thenable); `.single()` resolves with the first row. This mirrors how
// the supabase-js client is actually used inside `models/character.js`.
const makeClient = (tableToRows, { singleTables = new Set(['characters']) } = {}) => ({
  from(table) {
    const rows = tableToRows[table] ?? [];
    const result = { data: rows, error: null };
    const singleResult = {
      data: Array.isArray(rows) ? (rows[0] ?? null) : rows,
      error: null
    };

    const chain = {
      select() { return chain; },
      eq() {
        // Terminal in the code paths we care about — return a thenable.
        if (singleTables.has(table)) {
          // `characters` uses `.eq(...).single()`, so keep the chain alive
          // but also allow awaiting directly.
          return chain;
        }
        return Promise.resolve(result);
      },
      in() {
        return Promise.resolve(result);
      },
      single() {
        return Promise.resolve(singleResult);
      },
      maybeSingle() {
        return Promise.resolve(singleResult);
      },
      // Allow the chain itself to be awaited as a fallback (e.g., if code
      // ever awaits a non-terminal node). Resolves to the list result.
      then(onFulfilled, onRejected) {
        return Promise.resolve(result).then(onFulfilled, onRejected);
      }
    };
    return chain;
  }
});

const characterRowBase = {
  id: 'char-uuid-1',
  creator_id: 'profile-1',
  name: 'Testy',
  class_id: 'class-1',
  class: 'Soldier',
  level: 1,
  is_public: true,
  is_deceased: false,
  profile: { name: 'Owner' }
};

// Anon client can still read the public `characters` row (its RLS policy
// doesn't hop through profiles), but returns no rows for the related
// tables — simulating RLS wiping those rows because the shared anon
// client carries no JWT after `setSession` removal. The embedded PostgREST
// joins (personality/abilities/gear) likewise come back empty under anon RLS.
const fakeAnon = makeClient({
  characters: [{
    ...characterRowBase,
    personality: [],
    abilities: [],
    gear: []
  }],
  traits: [],
  class_gear: [],
  class_abilities: [],
  classes: []
});

// Admin client has the full picture: the character row (with embedded
// children populated, mirroring what PostgREST returns when the select
// is actually authorized) plus one each of traits / gear / abilities for
// the legacy `getCharacter` multi-query path.
const fakeAdmin = makeClient({
  characters: [{
    ...characterRowBase,
    personality: [{ name: 'Brave' }],
    abilities: [{ name: 'Dodge', description: 'Evade an attack' }],
    gear: [{ name: 'Knife', description: 'A sharp knife' }]
  }],
  traits: [{ character_id: 'char-uuid-1', name: 'Brave' }],
  class_gear: [{ character_id: 'char-uuid-1', class_id: 'class-1', name: 'Knife' }],
  class_abilities: [{ character_id: 'char-uuid-1', class_id: 'class-1', name: 'Dodge' }],
  classes: []
});

mock.module('./_base', () => ({
  supabase: fakeAnon,
  supabaseAdmin: fakeAdmin,
  anonKey: 'test-anon-key',
  createUserClient: () => fakeAnon
}));

// `character.js` captures `supabase` and `supabaseAdmin` at module-load time,
// and an earlier test file (e.g. character-agent.test.js) may have already
// loaded it with the real `_base`. Bust the cache so this require re-executes
// `character.js` with the mocked `_base` in place.
delete require.cache[require.resolve('./character')];
const { getCharacter, getCharacterForAgent } = require('./character');

afterAll(() => {
  mock.module('./_base', () => realBase);
  // Restore the real character.js for any later test file that loads it.
  delete require.cache[require.resolve('./character')];
});

test('getCharacter returns traits/gear/abilities even when anon client is RLS-blocked', async () => {
  const { data, error } = await getCharacter('char-uuid-1');

  expect(error).toBeFalsy();
  expect(data).toBeTruthy();
  expect(Array.isArray(data.traits)).toBe(true);
  expect(data.traits.length).toBeGreaterThan(0);
  expect(Array.isArray(data.gear)).toBe(true);
  expect(data.gear.length).toBeGreaterThan(0);
  expect(Array.isArray(data.abilities)).toBe(true);
  expect(data.abilities.length).toBeGreaterThan(0);
});

test('getCharacterForAgent returns gear/abilities/personality even when anon embedded select is RLS-blocked', async () => {
  const { data, error } = await getCharacterForAgent('char-uuid-1', {
    profileId: 'profile-1',
    role: 'admin'
  });

  expect(error).toBeFalsy();
  expect(data).toBeTruthy();
  expect(Array.isArray(data.traits)).toBe(true);
  expect(data.traits.length).toBeGreaterThan(0);
  expect(Array.isArray(data.abilities)).toBe(true);
  expect(data.abilities.length).toBeGreaterThan(0);
  expect(Array.isArray(data.gear)).toBe(true);
  expect(data.gear.length).toBeGreaterThan(0);
});

test('getOwnCharacters uses the passed client', async () => {
  const userClient = makeClient({
    characters: [{ id: 'c1', name: 'Test', creator_id: 'p1', is_public: false }]
  });
  const { getOwnCharacters } = require('./character');
  const { data } = await getOwnCharacters({ id: 'p1' }, userClient);
  expect(data).toBeTruthy();
  expect(data.length).toBe(1);
});
