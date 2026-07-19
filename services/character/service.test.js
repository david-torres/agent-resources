const { test, expect } = require('bun:test');
const { CharacterService } = require('./service');
const { AuthorizationError } = require('../../util/errors');

const ok = data => ({ data, error: null });

const CREATOR = { profileId: 'profile-1', role: null };
const STRANGER = { profileId: 'someone-else', role: null };
const ADMIN = { profileId: 'admin-profile', role: 'admin' };

const OWNED_CHARACTER = {
  id: 'character-1',
  creator_id: 'profile-1',
  class_id: 'class-1',
  name: 'Owned Hero',
  level: 1,
  completed_missions: 0,
  commissary_reward: 0,
  is_deceased: false,
  gear: [],
  common_items: [],
  abilities: []
};

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
  // Mutation-capability defaults.
  fetchCharacterOwnership: async () => ok({ id: 'character-1', creator_id: 'profile-1', class_id: 'class-1' }),
  deleteCharacter: async ({ id, creatorId }) => {
    calls.push(['deleteCharacter', id, creatorId]);
    return ok(null);
  },
  setDeceased: async ({ id, creatorId }) => {
    calls.push(['setDeceased', id, creatorId]);
    return ok([{ id, creator_id: creatorId, is_deceased: true }]);
  },
  updateClass: async ({ id, creatorId, classId, className }) => {
    calls.push(['updateClass', id, creatorId, classId, className]);
    return ok([{ id, class_id: classId, class: className }]);
  },
  updateOwnedFields: async ({ id, creatorId, fields }) => {
    calls.push(['updateOwnedFields', id, creatorId, fields]);
    return ok({ id, name: 'Owned Hero', ...fields });
  },
  getClassRulesVersion: async () => ok('v1'),
  fetchAllowedAbilityIds: async () => ok([]),
  fetchExistingPerks: async () => ok([]),
  insertPerks: async () => ({ error: null }),
  updatePerkLinks: async () => ({ error: null }),
  createBackfillMission: async () => ({ error: null }),
  getAvailableHostedMissions: async () => ok([]),
  createOffscreenMissionRow: async () => ok({}),
  findUpgradeTargets: async () => ([{ id: 'target-class', name: 'Upgraded Class' }]),
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

test('CharacterService throws AuthorizationError before update persistence when the actor is not the owner', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getCharacter: async () => ok({ id: 'character-1', creator_id: 'another-profile', abilities: [] })
  }));

  await expect(
    service.updateCharacter('character-1', { name: 'Changed' }, { id: 'profile-1' })
  ).rejects.toThrow(AuthorizationError);
  expect(calls).toEqual([]);
});

test('CharacterService rejects an incomplete persistence adapter', () => {
  expect(() => new CharacterService({ createCharacter() {} })).toThrow(/requires/);
});

// --- Policy-gated mutation capabilities ------------------------------

test('CharacterService.deleteCharacter throws for a non-creator actor', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getCharacter: async () => ok({ ...OWNED_CHARACTER })
  }));
  await expect(service.deleteCharacter(STRANGER, 'character-1')).rejects.toThrow(AuthorizationError);
  expect(calls).toEqual([]);
});

test('CharacterService.deleteCharacter succeeds for the creator', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getCharacter: async () => ok({ ...OWNED_CHARACTER })
  }));
  const result = await service.deleteCharacter(CREATOR, 'character-1');
  expect(result.error).toBeNull();
  expect(calls).toEqual([['deleteCharacter', 'character-1', 'profile-1']]);
});

test('CharacterService.deleteCharacter succeeds for an admin acting on another profile\'s character', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getCharacter: async () => ok({ ...OWNED_CHARACTER })
  }));
  const result = await service.deleteCharacter(ADMIN, 'character-1');
  expect(result.error).toBeNull();
  // The SQL safety filter uses the *loaded row's* creator_id, not the actor's
  // profileId, so an admin/system mutation of someone else's row still matches.
  expect(calls).toEqual([['deleteCharacter', 'character-1', 'profile-1']]);
});

test('CharacterService.markDeceased throws for a non-creator actor', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getCharacter: async () => ok({ ...OWNED_CHARACTER })
  }));
  await expect(service.markDeceased(STRANGER, 'character-1', 'Owned Hero')).rejects.toThrow(AuthorizationError);
  expect(calls).toEqual([]);
});

test('CharacterService.markDeceased succeeds for the creator with a matching confirm name', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getCharacter: async () => ok({ ...OWNED_CHARACTER })
  }));
  const result = await service.markDeceased(CREATOR, 'character-1', 'Owned Hero');
  expect(result.error).toBeNull();
  expect(result.data.is_deceased).toBe(true);
  expect(calls).toEqual([['setDeceased', 'character-1', 'profile-1']]);
});

test('CharacterService.markDeceased returns a validation error (not a throw) for a mismatched confirm name', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getCharacter: async () => ok({ ...OWNED_CHARACTER })
  }));
  const result = await service.markDeceased(CREATOR, 'character-1', 'Wrong Name');
  expect(result.data).toBeNull();
  expect(result.error.status).toBe(400);
  expect(calls).toEqual([]);
});

test('CharacterService.upgradeClass throws for a non-creator actor', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls));
  await expect(service.upgradeClass(STRANGER, 'character-1', 'target-class', {})).rejects.toThrow(AuthorizationError);
  expect(calls).toEqual([]);
});

test('CharacterService.upgradeClass succeeds for the creator with a valid target', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls));
  const result = await service.upgradeClass(CREATOR, 'character-1', 'target-class', {});
  expect(result.error).toBeNull();
  expect(result.data.class_id).toBe('target-class');
  expect(calls).toEqual([['updateClass', 'character-1', 'profile-1', 'target-class', 'Upgraded Class']]);
});

test('CharacterService.updateStats throws for a non-creator actor', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getCharacter: async () => ok({ ...OWNED_CHARACTER })
  }));
  await expect(service.updateStats(STRANGER, 'character-1', { vitality: 5 })).rejects.toThrow(AuthorizationError);
  expect(calls).toEqual([]);
});

test('CharacterService.updateStats succeeds for the creator', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getCharacter: async () => ok({ ...OWNED_CHARACTER })
  }));
  const result = await service.updateStats(CREATOR, 'character-1', { vitality: '5' });
  expect(result.error).toBeNull();
  expect(result.data.stats.vitality).toBe(5);
  // normalizeStatsPayload fills every stat in statList (defaulting to 0),
  // not just the ones present in the raw payload.
  expect(calls[0][0]).toBe('updateOwnedFields');
  expect(calls[0][3].vitality).toBe(5);
  expect(Object.keys(calls[0][3]).length).toBe(12);
});

test('CharacterService.levelUp throws for a non-creator actor', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getCharacter: async () => ok({ ...OWNED_CHARACTER })
  }));
  await expect(service.levelUp(STRANGER, 'character-1', { level: 2 })).rejects.toThrow(AuthorizationError);
  expect(calls).toEqual([]);
});

test('CharacterService.levelUp succeeds for the creator, backfilling named missions', async () => {
  const calls = [];
  const backfillCalls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getCharacter: async () => ok({ ...OWNED_CHARACTER }),
    createBackfillMission: async (args) => {
      backfillCalls.push(args);
      return { error: null };
    },
    getRealMissions: async () => ok([{ outcome: 'success' }, { outcome: 'success' }])
  }));

  const result = await service.levelUp(CREATOR, 'character-1', {
    level: 2,
    completed_missions: 2,
    mission_names: ['Op Alpha', 'Op Bravo'],
    use_conduit_credit: false,
    stats: {}
  });

  expect(result.error).toBeNull();
  expect(result.data.completed_missions).toBe(2);
  expect(result.data.commissary_reward).toBe(2);
  expect(backfillCalls).toEqual([
    { characterId: 'character-1', name: 'Op Alpha', profileId: 'profile-1' },
    { characterId: 'character-1', name: 'Op Bravo', profileId: 'profile-1' }
  ]);
});

test('CharacterService.levelUp surfaces a backfill mission error without throwing (graceful, not a hang)', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getCharacter: async () => ok({ ...OWNED_CHARACTER }),
    createBackfillMission: async () => ({ error: new AuthorizationError('Mission not found', { reason: 'not_found' }) })
  }));

  const result = await service.levelUp(CREATOR, 'character-1', {
    level: 2,
    completed_missions: 1,
    mission_names: ['Op Charlie'],
    use_conduit_credit: false,
    stats: {}
  });

  expect(result.data).toBeNull();
  expect(result.error).toBeInstanceOf(AuthorizationError);
});
