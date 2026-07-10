const { test, expect } = require('bun:test');
const { CharacterService } = require('./service');

const ok = data => ({ data, error: null });

const makeAdapter = (calls, overrides = {}) => ({
  getRulesVersion: async () => 'v1',
  resolveClassReference: async input => ({ ...input }),
  getCharacter: async () => ok({ id: 'character-1', creator_id: 'profile-1', abilities: [] }),
  createCharacterRow: async input => {
    calls.push(['createCharacterRow', input]);
    return ok([{ id: 'new-character' }]);
  },
  updateCharacterRow: async (id, input, actor) => {
    calls.push(['updateCharacterRow', id, input, actor]);
    return ok([{ id }]);
  },
  getChildRows: async (table, id) => {
    calls.push(['getChildRows', table, id]);
    return ok([]);
  },
  insertChildRows: async (table, id, rows) => {
    calls.push(['insertChildRows', table, id, rows]);
    return ok(true);
  },
  updateChildRow: async (table, id, changes) => {
    calls.push(['updateChildRow', table, id, changes]);
    return ok(true);
  },
  deleteChildRows: async (table, id, rowIds) => {
    calls.push(['deleteChildRows', table, id, rowIds]);
    return ok(true);
  },
  getClassContentLookupMaps: async () => ({
    gearNameToClassId: new Map([['Rifle', 'class-1']]),
    gearNameToDescription: new Map(),
    abilityNameToClassId: new Map(),
    abilityNameToDescription: new Map()
  }),
  getRealMissions: async () => ok([]),
  listOffscreenMissions: async () => ok([]),
  ...overrides
});

test('CharacterService creates through a recording adapter without mutating its request', async () => {
  const calls = [];
  const input = { name: 'New', trait0: 'Brave', is_public: 'on', gear: ['Class::Rifle'] };
  const service = new CharacterService(makeAdapter(calls));

  expect(await service.createCharacter(input, { id: 'profile-1' })).toEqual({
    data: { id: 'new-character' }, error: null
  });
  expect(input).toEqual({ name: 'New', trait0: 'Brave', is_public: 'on', gear: ['Class::Rifle'] });
  expect(calls).toEqual([
    ['createCharacterRow', { name: 'New', is_public: true, hide_from_search: false, creator_id: 'profile-1', creator_mode: null, common_items: [] }],
    ['getChildRows', 'traits', 'new-character'],
    ['insertChildRows', 'traits', 'new-character', [{ name: 'Brave' }]],
    ['getChildRows', 'class_gear', 'new-character'],
    ['insertChildRows', 'class_gear', 'new-character', [{ name: 'Rifle', class_id: 'class-1', description: null }]]
  ]);
});

test('CharacterService stops a create when a child write fails', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getChildRows: async () => ({ data: null, error: 'trait failure' })
  }));

  expect(await service.createCharacter({ name: 'New' }, { id: 'profile-1' })).toEqual({
    data: null, error: 'trait failure'
  });
  expect(calls).toEqual([['createCharacterRow', {
    name: 'New', is_public: false, hide_from_search: false, creator_id: 'profile-1', creator_mode: null, common_items: []
  }]]);
});

test('CharacterService enforces ownership before update persistence', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getCharacter: async () => ok({ id: 'character-1', creator_id: 'another-profile', abilities: [] })
  }));

  expect(await service.updateCharacter('character-1', { name: 'Changed' }, { id: 'profile-1' })).toEqual({
    data: null, error: 'Unauthorized'
  });
  expect(calls).toEqual([]);
});

test('CharacterService rejects an incomplete persistence adapter', () => {
  expect(() => new CharacterService({ createCharacter() {} })).toThrow(/requires/);
});
