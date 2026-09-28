// The render-time gate for class ability/gear descriptions, extracted from
// the inline block at routes/characters.js:863-939. These tests encode the
// old inline behavior — including both fail-closed paths — before anything
// else depends on the helper.
const { test, expect, mock, beforeEach } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Mutable per-test state consulted by the module mocks. mock.module is
// process-global, but scripts/run-tests.mjs runs one file per Bun process.
const state = {};

mock.module('../../models/lfg', () => ({
  getLfgPost: async () => {
    if (state.lfgThrows) throw new Error('lfg boom');
    return { data: state.lfgPost, error: null };
  },
}));

mock.module('../../models/class', () => ({
  getUnlockedClassIdsForUser: async () => {
    if (state.unlocksThrow) throw new Error('unlocks boom');
    return { data: state.unlockedIds, error: state.unlockError || null };
  },
}));

const { applyDescriptionGate } = require('./description-gate');

beforeEach(() => {
  state.lfgPost = null;
  state.lfgThrows = false;
  state.unlockedIds = new Set();
  state.unlocksThrow = false;
  state.unlockError = null;
});

const makeCharacter = () => ({
  id: 'char-1',
  abilities: [
    { name: 'Fireball', description: 'ability secret', class_id: 'class-a' },
    { name: 'Improvise', description: 'classless text', class_id: null },
  ],
  gear: [
    { name: 'Staff', description: 'gear secret', class_id: 'class-a' },
  ],
});

const descriptions = (character) => ({
  abilities: character.abilities.map(a => a.description),
  gear: character.gear.map(g => g.description),
});

const makeEquippedCharacter = () => ({
  id: 'char-1',
  gear: [
    {
      name: 'Hat', class_id: 'class-a', description: 'signature secret',
      enchantment: { source: 'default' },
      default_enchantment: { name: 'Hats Off', description: 'enchantment secret' },
      mods: [{ name: 'Scope', description: 'player mod' }],
    },
    {
      name: 'Coat', class_id: 'class-a', description: 'second secret',
      enchantment: { source: 'custom', name: 'Hex', description: 'player enchantment' },
      mods: [{ name: 'Lining', description: 'player lining' }],
    },
  ],
});

const expectEquipment = (character, defaultDescription) => {
  expect(character.gear[0].default_enchantment).toEqual({
    name: 'Hats Off', description: defaultDescription,
  });
  expect(character.gear[0].mods[0].description).toBe('player mod');
  expect(character.gear[1].enchantment.description).toBe('player enchantment');
  expect(character.gear[1].mods[0].description).toBe('player lining');
};

test('signed-out and locked viewers lose class-authored Default text, but retain player equipment', async () => {
  for (const profile of [null, { id: 'p1', user_id: 'u1' }]) {
    const character = makeEquippedCharacter();
    await applyDescriptionGate({ character, profile, client: {} });
    expect(character.gear.map(g => g.description)).toEqual(['', '']);
    expectEquipment(character, '');
  }
});

test('an unlocked viewer keeps Default Enchantment text', async () => {
  state.unlockedIds = new Set(['class-a']);
  const character = makeEquippedCharacter();
  await applyDescriptionGate({ character, profile: { id: 'p1', user_id: 'u1' }, client: {} });
  expectEquipment(character, 'enchantment secret');
});

test('an approved LFG host keeps Default Enchantment text without an unlock', async () => {
  state.lfgPost = {
    host_id: 'host-1',
    join_requests: [{ status: 'approved', character: { id: 'char-1' } }],
  };
  const character = makeEquippedCharacter();
  await applyDescriptionGate({
    character, profile: { id: 'host-1', user_id: 'u1' },
    lfgPostId: 'post-1', client: {},
  });
  expectEquipment(character, 'enchantment secret');
});

test('a failed unlock lookup or missing class id cannot reveal Default text', async () => {
  state.unlocksThrow = true;
  const character = makeEquippedCharacter();
  await applyDescriptionGate({ character, profile: { id: 'p1', user_id: 'u1' }, client: {} });
  expectEquipment(character, '');

  state.unlocksThrow = false;
  state.unlockedIds = new Set(['class-a']);
  const classless = makeEquippedCharacter();
  classless.gear[0].class_id = null;
  await applyDescriptionGate({ character: classless, profile: { id: 'p1', user_id: 'u1' }, client: {} });
  expectEquipment(classless, '');
});

test('an unlock lookup error fails closed even if it returns ids', async () => {
  state.unlockedIds = new Set(['class-a']);
  state.unlockError = { message: 'lookup failed' };
  const character = makeEquippedCharacter();
  await applyDescriptionGate({ character, profile: { id: 'p1', user_id: 'u1' }, client: {} });
  expectEquipment(character, '');
});

test('signed out, every description is blanked — class-gated or not', async () => {
  const character = makeCharacter();
  await applyDescriptionGate({ character, profile: null, client: {} });
  expect(descriptions(character)).toEqual({ abilities: ['', ''], gear: [''] });
});

test('signed out, a globally free class keeps its item descriptions', async () => {
  state.unlockedIds = new Set(['class-a']);
  const character = makeCharacter();

  await applyDescriptionGate({ character, profile: null, userId: null, client: {} });

  expect(descriptions(character)).toEqual({
    abilities: ['ability secret', ''],
    gear: ['gear secret']
  });
});

test('an unlocked class family keeps its descriptions', async () => {
  state.unlockedIds = new Set(['class-a']);
  const character = makeCharacter();
  await applyDescriptionGate({
    character, profile: { id: 'p1', user_id: 'u1' }, userId: 'u1', client: {},
  });
  expect(descriptions(character)).toEqual({
    abilities: ['ability secret', 'classless text'],
    gear: ['gear secret'],
  });
});

test('a locked class blanks its items but spares class-less ones', async () => {
  const character = makeCharacter();
  await applyDescriptionGate({
    character, profile: { id: 'p1', user_id: 'u1' }, userId: 'u1', client: {},
  });
  expect(descriptions(character)).toEqual({
    abilities: ['', 'classless text'],
    gear: [''],
  });
});

test('the host of the post sees an approved applicant in full, unlocks or not', async () => {
  state.lfgPost = {
    host_id: 'p1',
    join_requests: [{ status: 'approved', character: { id: 'char-1' } }],
  };
  const character = makeCharacter();
  await applyDescriptionGate({
    character, profile: { id: 'p1', user_id: 'u1' }, userId: 'u1',
    lfgPostId: 'post-1', client: {},
  });
  expect(descriptions(character).abilities[0]).toBe('ability secret');
  expect(descriptions(character).gear[0]).toBe('gear secret');
});

test('a pending applicant does not trigger the host exception', async () => {
  state.lfgPost = {
    host_id: 'p1',
    join_requests: [{ status: 'pending', character: { id: 'char-1' } }],
  };
  const character = makeCharacter();
  await applyDescriptionGate({
    character, profile: { id: 'p1', user_id: 'u1' }, userId: 'u1',
    lfgPostId: 'post-1', client: {},
  });
  expect(descriptions(character).abilities[0]).toBe('');
});

test('a viewer who is not the host gets normal gating despite ?lfg', async () => {
  state.lfgPost = {
    host_id: 'someone-else',
    join_requests: [{ status: 'approved', character: { id: 'char-1' } }],
  };
  const character = makeCharacter();
  await applyDescriptionGate({
    character, profile: { id: 'p1', user_id: 'u1' }, userId: 'u1',
    lfgPostId: 'post-1', client: {},
  });
  expect(descriptions(character).abilities[0]).toBe('');
});

test('a failing lfg lookup only cancels the host exception, not the unlocks', async () => {
  // Mirrors the inline code's inner try/catch: hostingViaLfg stays false and
  // the viewer's real unlocks still apply.
  state.lfgThrows = true;
  state.unlockedIds = new Set(['class-a']);
  const character = makeCharacter();
  await applyDescriptionGate({
    character, profile: { id: 'p1', user_id: 'u1' }, userId: 'u1',
    lfgPostId: 'post-1', client: {},
  });
  expect(descriptions(character).abilities[0]).toBe('ability secret');
});

test('a failing unlock lookup fails closed on class-gated items', async () => {
  state.unlocksThrow = true;
  const character = makeCharacter();
  await applyDescriptionGate({
    character, profile: { id: 'p1', user_id: 'u1' }, userId: 'u1', client: {},
  });
  expect(descriptions(character)).toEqual({
    abilities: ['', 'classless text'],
    gear: [''],
  });
});

test('returns the same character object it mutated', async () => {
  const character = makeCharacter();
  const result = await applyDescriptionGate({ character, profile: null, client: {} });
  expect(result.character).toBe(character);
});

test('a character with no abilities or gear arrays passes through untouched and ungated', async () => {
  const character = { id: 'char-1' };
  const result = await applyDescriptionGate({ character, profile: null, client: {} });
  expect(result).toEqual({ character, gated: false });
});

test('a locked viewer losing a description is reported as gated', async () => {
  const result = await applyDescriptionGate({ character: makeCharacter(), profile: { id: 'p1', user_id: 'u1' }, client: {} });
  expect(result.gated).toBe(true);
});

test('an unlocked viewer is not gated', async () => {
  state.unlockedIds = new Set(['class-a']);
  const result = await applyDescriptionGate({ character: makeCharacter(), profile: { id: 'p1', user_id: 'u1' }, client: {} });
  expect(result.gated).toBe(false);
});

test('blanking descriptions that were already empty is not gating', async () => {
  const character = {
    id: 'char-1',
    abilities: [{ name: 'Fireball', description: '', class_id: 'class-a' }],
    gear: [{ name: 'Staff', description: '', class_id: 'class-a' }]
  };
  const result = await applyDescriptionGate({ character, profile: { id: 'p1', user_id: 'u1' }, client: {} });
  expect(result.gated).toBe(false);
});

test('a hidden Default Enchantment alone counts as gated', async () => {
  const character = {
    id: 'char-1',
    gear: [{ name: 'Hat', description: '', class_id: 'class-a', default_enchantment: { name: 'Hats Off', description: 'secret' } }]
  };
  const result = await applyDescriptionGate({ character, profile: { id: 'p1', user_id: 'u1' }, client: {} });
  expect(result.gated).toBe(true);
});

test('the fail-closed path reports what it gated', async () => {
  state.unlocksThrow = true;
  const result = await applyDescriptionGate({ character: makeCharacter(), profile: { id: 'p1', user_id: 'u1' }, userId: 'u1', client: {} });
  expect(result.gated).toBe(true);
});

test('an unexpected error while gating blanks everything and reports it gated', async () => {
  let armed = true;
  const character = makeCharacter();
  Object.defineProperty(character.abilities[0], 'class_id', {
    get() {
      if (armed) { armed = false; throw new Error('boom'); }
      return 'class-a';
    }
  });
  const result = await applyDescriptionGate({ character, profile: { id: 'p1', user_id: 'u1' }, userId: 'u1', client: {} });
  expect(descriptions(result.character)).toEqual({ abilities: ['', ''], gear: [''] });
  expect(result.gated).toBe(true);
});
