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
        // Always return the chain (thenable) so callers can either await
        // directly or continue chaining (e.g. .eq(...).order(...)).
        return chain;
      },
      order() {
        // Terminal for ordered list queries — return a resolved promise.
        return Promise.resolve(result);
      },
      in() {
        // Return the chain (thenable) so callers can continue chaining
        // (e.g. .in(...).eq(...)) or await directly — mirrors .eq() behavior.
        return chain;
      },
      single() {
        return Promise.resolve(singleResult);
      },
      maybeSingle() {
        return Promise.resolve(singleResult);
      },
      insert() { return chain; },
      update() { return chain; },
      delete() { return chain; },
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
  classes: [{ id: 'class-1', name: 'Soldier', rules_version: 'v1' }]
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
  classes: [{ id: 'class-1', name: 'Soldier', rules_version: 'v1' }]
});

const fakeAdminV2 = makeClient({
  characters: [{
    ...characterRowBase,
    class_id: 'class-v2',
    class: 'Thane-v2',
    quirks: [],
    accessories: [],
    personality: [{ name: 'Brave' }],
    abilities: [],
    gear: []
  }],
  traits: [],
  class_gear: [],
  class_abilities: [],
  character_perks: [],
  classes: [{ id: 'class-v2', name: 'Thane-v2', rules_version: 'v2' }]
}, { singleTables: new Set(['characters', 'classes']) });

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
  expect(Array.isArray(data.signature_gear)).toBe(true);
  expect(data.signature_gear.length).toBeGreaterThan(0);
  expect(data).not.toHaveProperty('gear');
});

test('getOwnCharacters uses the passed client', async () => {
  // fakeAnon.characters already has id 'char-uuid-1'; the injected client
  // returns a different id, so data[0].id distinguishes which client ran.
  const userClient = makeClient({
    characters: [{ id: 'injected-only', name: 'Test', creator_id: 'p1', is_public: false }]
  });
  const { getOwnCharacters } = require('./character');
  const { data } = await getOwnCharacters({ id: 'p1' }, userClient);
  expect(data).toBeTruthy();
  expect(data.length).toBe(1);
  expect(data[0].id).toBe('injected-only');
});

test('getCharacter uses the passed client for the characters SELECT', async () => {
  // fakeAnon.characters returns id 'char-uuid-1'; inject a different id so
  // we can tell which client dispatched the read.
  const userClient = makeClient({
    characters: [{ id: 'injected-char', name: 'Test', creator_id: 'p1', is_public: false }]
  });
  const { getCharacter } = require('./character');
  const { data } = await getCharacter('injected-char', userClient);
  expect(data).toBeTruthy();
  expect(data.id).toBe('injected-char');
});

test('createCharacter drops v2-only fields when linked class is v1', async () => {
  const { createCharacter } = require('./character');
  const payload = {
    name: 'Versionless',
    class_id: 'class-1',          // class is v1 in fakeAnon
    class: 'Soldier',
    level: 1,
    vitality: 1, might: 1, resilience: 1, spirit: 1, arcane: 1, will: 1,
    sensory: 1, reflex: 1, vigor: 1, skill: 1, intelligence: 1, luck: 1,
    completed_missions: 0, commissary_reward: 0,
    quirks: [{ name: 'Synthetic', description: 'Built, not born' }],
    accessories: [{ name: 'Monocle' }]
  };
  const { data, error } = await createCharacter(payload, { id: 'profile-1' });
  expect(error).toBeFalsy();
  expect(data).toBeTruthy();
  // The fake admin client always echoes characterRowBase, so we check that
  // the payload mutation happened: createCharacter should have deleted v2
  // keys before insert.
  expect(payload.quirks).toBeUndefined();
  expect(payload.accessories).toBeUndefined();
});

test('createCharacter preserves v2 fields when linked class is v2', async () => {
  mock.module('./_base', () => ({
    supabase: fakeAdminV2,
    supabaseAdmin: fakeAdminV2,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeAdminV2
  }));
  delete require.cache[require.resolve('./character')];
  const { createCharacter } = require('./character');

  const payload = {
    name: 'V2',
    class_id: 'class-v2',
    class: 'Thane-v2',
    level: 1,
    vitality: 1, might: 1, resilience: 1, spirit: 1, arcane: 1, will: 1,
    sensory: 1, reflex: 1, vigor: 1, skill: 1, intelligence: 1, luck: 1,
    completed_missions: 0, commissary_reward: 0,
    quirks: [{ name: 'Synthetic', description: 'Built, not born' }],
    accessories: [{ name: 'Monocle' }]
  };
  const { data, error } = await createCharacter(payload, { id: 'profile-1' });
  expect(error).toBeFalsy();
  expect(Array.isArray(payload.quirks)).toBe(true);
  expect(payload.quirks.length).toBe(1);
  expect(payload.accessories[0].name).toBe('Monocle');

  // Restore the original module mock for subsequent tests.
  mock.module('./_base', () => ({
    supabase: fakeAnon,
    supabaseAdmin: fakeAdmin,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeAnon
  }));
  delete require.cache[require.resolve('./character')];
});

test('createCharacter rejects v2 perks that violate validation', async () => {
  mock.module('./_base', () => ({
    supabase: fakeAdminV2,
    supabaseAdmin: fakeAdminV2,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeAdminV2
  }));
  delete require.cache[require.resolve('./character')];
  const { createCharacter } = require('./character');

  const longText = Array.from({ length: 26 }, (_, i) => `w${i}`).join(' ');
  const payload = {
    name: 'V2', class_id: 'class-v2', class: 'Thane-v2', level: 1,
    vitality: 1, might: 1, resilience: 1, spirit: 1, arcane: 1, will: 1,
    sensory: 1, reflex: 1, vigor: 1, skill: 1, intelligence: 1, luck: 1,
    completed_missions: 0, commissary_reward: 0,
    ability_perks: [{ class_ability_id: 'a1', text: longText }]
  };
  const { error } = await createCharacter(payload, { id: 'profile-1' });
  expect(error).toBeTruthy();
  expect(String(error)).toMatch(/25 words/);

  mock.module('./_base', () => ({
    supabase: fakeAnon, supabaseAdmin: fakeAdmin,
    anonKey: 'test-anon-key', createUserClient: () => fakeAnon
  }));
  delete require.cache[require.resolve('./character')];
});

test('getCharacter attaches ability_perks for v2 characters', async () => {
  mock.module('./_base', () => {
    const v2Admin = makeClient({
      characters: [{
        ...characterRowBase,
        class_id: 'class-v2',
        class: 'Thane-v2',
        personality: [],
        abilities: [],
        gear: []
      }],
      traits: [],
      class_gear: [],
      class_abilities: [],
      classes: [{ id: 'class-v2', name: 'Thane-v2', rules_version: 'v2' }],
      character_perks: [
        { id: 'p1', character_id: 'char-uuid-1', class_ability_id: 'a1', text: 'Bigger sword', position: 0, compounds_with: null },
        { id: 'p2', character_id: 'char-uuid-1', class_ability_id: 'a1', text: 'Even bigger',  position: 1, compounds_with: 'p1' }
      ]
    }, { singleTables: new Set(['characters', 'classes']) });
    return {
      supabase: v2Admin, supabaseAdmin: v2Admin,
      anonKey: 'test-anon-key', createUserClient: () => v2Admin
    };
  });
  delete require.cache[require.resolve('./character')];
  const { getCharacter } = require('./character');
  const { data, error } = await getCharacter('char-uuid-1');
  expect(error).toBeFalsy();
  expect(Array.isArray(data.ability_perks)).toBe(true);
  expect(data.ability_perks.length).toBe(2);
  expect(data.ability_perks[0].text).toBe('Bigger sword');

  // restore
  mock.module('./_base', () => ({
    supabase: fakeAnon, supabaseAdmin: fakeAdmin,
    anonKey: 'test-anon-key', createUserClient: () => fakeAnon
  }));
  delete require.cache[require.resolve('./character')];
});

test('getCharacter rewrites compounds_with UUIDs into position-N sentinels', async () => {
  mock.module('./_base', () => {
    const v2Admin = makeClient({
      characters: [{
        ...characterRowBase,
        class_id: 'class-v2',
        class: 'Thane-v2',
        personality: [],
        abilities: [],
        gear: []
      }],
      traits: [],
      class_gear: [],
      class_abilities: [],
      classes: [{ id: 'class-v2', name: 'Thane-v2', rules_version: 'v2' }],
      character_perks: [
        { id: 'p1', character_id: 'char-uuid-1', class_ability_id: 'a1', text: 'Base', position: 0, compounds_with: null },
        { id: 'p2', character_id: 'char-uuid-1', class_ability_id: 'a1', text: 'Stacks',  position: 1, compounds_with: 'p1' },
        { id: 'p3', character_id: 'char-uuid-1', class_ability_id: 'a1', text: 'Orphan',  position: 2, compounds_with: '00000000-0000-0000-0000-000000000000' }
      ]
    }, { singleTables: new Set(['characters', 'classes']) });
    return {
      supabase: v2Admin, supabaseAdmin: v2Admin,
      anonKey: 'test-anon-key', createUserClient: () => v2Admin
    };
  });
  delete require.cache[require.resolve('./character')];
  const { getCharacter } = require('./character');
  const { data } = await getCharacter('char-uuid-1');
  const perks = data.ability_perks;
  expect(perks[0].compounds_with).toBeNull();
  expect(perks[1].compounds_with).toBe('position-0');
  // Orphan reference (UUID points to nothing) collapses to null.
  expect(perks[2].compounds_with).toBeNull();

  // restore
  mock.module('./_base', () => ({
    supabase: fakeAnon, supabaseAdmin: fakeAdmin,
    anonKey: 'test-anon-key', createUserClient: () => fakeAnon
  }));
  delete require.cache[require.resolve('./character')];
});

test('serializeCharacterForAgent omits v2 fields on v1 characters', () => {
  const { serializeCharacterForAgent } = require('./character');
  const row = {
    id: 'c1', creator_id: 'p1', name: 'V1', class: 'Soldier', level: 1,
    is_public: true, is_deceased: false,
    // version is resolved externally; the serializer receives it as a hint:
    rules_version: 'v1',
    quirks: [], accessories: [], ability_perks: []
  };
  const out = serializeCharacterForAgent(row, { profileId: 'p1', role: 'admin' });
  expect(out.rules_version).toBe('v1');
  expect(out).not.toHaveProperty('quirks');
  expect(out).not.toHaveProperty('accessories');
  expect(out).not.toHaveProperty('ability_perks');
});

test('serializeCharacterForAgent includes v2 fields on v2 characters', () => {
  const { serializeCharacterForAgent } = require('./character');
  const row = {
    id: 'c2', creator_id: 'p1', name: 'V2', class: 'Thane-v2', level: 1,
    is_public: true, is_deceased: false,
    rules_version: 'v2',
    quirks: [{ name: 'Synthetic' }],
    accessories: [{ name: 'Monocle' }],
    ability_perks: [{ class_ability_id: 'a1', text: 'Bigger sword', position: 0 }]
  };
  const out = serializeCharacterForAgent(row, { profileId: 'p1', role: 'admin' });
  expect(out.rules_version).toBe('v2');
  expect(out.quirks[0].name).toBe('Synthetic');
  expect(out.accessories[0].name).toBe('Monocle');
  expect(out.ability_perks[0].text).toBe('Bigger sword');
});
