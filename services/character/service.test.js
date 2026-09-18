const { test, expect } = require('bun:test');
const { CharacterService } = require('./service');
const { AuthorizationError } = require('../../util/errors');
const { findUpgradeTargetsFor } = require('../../models/character');
const { classesStub } = require('../../test/helpers/classes-family-stub');

// Gunslinger as the catalogue holds it: Advent v1, its same-family v2, and the
// Aspirant V1 fork, which differs on both family axes.
const GUNSLINGER_FAMILY_AND_FORK = [
  { id: 'gunslinger-v1', name: 'Gunslinger', rules_edition: 'advent', rules_version: 'v1', content_format: 'advent', base_class_id: null },
  { id: 'gunslinger-v2', name: 'Gunslinger', rules_edition: 'advent', rules_version: 'v2', content_format: 'advent', base_class_id: 'gunslinger-v1' },
  { id: 'gunslinger-aspirant-v1', name: 'Gunslinger', rules_edition: 'aspirant', rules_version: 'v1', content_format: 'aspirant', base_class_id: 'gunslinger-v1' }
];

const ok = data => ({ data, error: null });

const CREATOR = { profileId: 'profile-1', role: null };
const STRANGER = { profileId: 'someone-else', role: null };
const ADMIN = { profileId: 'admin-profile', role: 'admin' };

// Minimal adapter satisfying every REQUIRED_ADAPTER_METHODS entry, so
// `new CharacterService(...)` passes constructor validation. Individual
// tests override the methods they actually exercise.
const minimalRequiredAdapter = () => makeAdapter([]);

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
    abilityNameToDescription: new Map(),
    itemsByClassId: new Map(),
    classesByName: new Map(),
    classRows: []
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
  levelUpAtomic: async ({ fields }) => ok({ id: 'character-1', name: 'Owned Hero', ...fields }),
  createBackfillMission: async () => ({ error: null }),
  getAvailableHostedMissions: async () => ok([]),
  createOffscreenMissionRow: async () => ok({}),
  findUpgradeTargets: async () => ([{ id: 'target-class', name: 'Upgraded Class' }]),
  // Offscreen-mission capability defaults (create/update/deleteOffscreenMission).
  getOffscreenMissionRow: async () => ok(null),
  getSourceMissionForCredit: async () => ok(null),
  getConduitCredits: async () => ok(null),
  insertOffscreenMission: async () => ({ error: null }),
  updateOffscreenMissionRow: async () => ({ error: null }),
  deleteOffscreenMissionRow: async () => ({ error: null }),
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

// A hidden button protects only half the feature: upgradeClass validates the
// POST against the same scoped candidate list, so wire the REAL lookup in and
// pass a cross-format id directly.
const familyScopedAdapter = (calls, rows) => makeAdapter(calls, {
  fetchCharacterOwnership: async () => ok({
    id: 'character-1', creator_id: 'profile-1', class_id: 'gunslinger-v1'
  }),
  findUpgradeTargets: (classId) => findUpgradeTargetsFor(classId, classesStub(rows))
});

test('CharacterService.upgradeClass rejects a cross-format target id passed directly', async () => {
  const calls = [];
  const service = new CharacterService(familyScopedAdapter(calls, GUNSLINGER_FAMILY_AND_FORK));

  const result = await service.upgradeClass(CREATOR, 'character-1', 'gunslinger-aspirant-v1', {});
  expect(result).toEqual({
    data: null, error: 'Target class is not a valid upgrade for this character'
  });
  expect(calls).toEqual([]);
});

test('CharacterService.upgradeClass still accepts the in-family v2 target id', async () => {
  const calls = [];
  const service = new CharacterService(familyScopedAdapter(calls, GUNSLINGER_FAMILY_AND_FORK));

  const result = await service.upgradeClass(CREATOR, 'character-1', 'gunslinger-v2', {});
  expect(result.error).toBeNull();
  expect(result.data.class_id).toBe('gunslinger-v2');
  expect(calls).toEqual([['updateClass', 'character-1', 'profile-1', 'gunslinger-v2', 'Gunslinger']]);
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

test('levelUp persists via a single levelUpAtomic call (not updateOwnedFields + insertPerks)', async () => {
  const calls = [];
  const adapter = {
    ...minimalRequiredAdapter(),
    getCharacter: async () => ok({ id: 'character-1', creator_id: 'profile-1', class_id: 'class-1', level: 1, completed_missions: 0, commissary_reward: 0, abilities: [] }),
    getRealMissions: async () => ok([]),
    listOffscreenMissions: async () => ok([]),
    getClassRulesVersion: async () => ok('v2'),
    fetchAllowedAbilityIds: async () => ok([{ id: 'ab-1' }]),
    fetchExistingPerks: async () => ok([]),
    levelUpAtomic: async (args) => { calls.push(args); return ok({ id: 'character-1', name: 'Hero', level: 2, completed_missions: 0, commissary_reward: 0 }); },
    updateOwnedFields: async () => { throw new Error('updateOwnedFields must not be called by levelUp'); },
  };
  const svc = new CharacterService(adapter);
  const { data, error } = await svc.levelUp(CREATOR, 'character-1', {
    level: 2,
    ability_perks: [{ class_ability_id: 'ab-1', text: 'New perk', ref: 'r1' }]
  });
  expect(error).toBeNull();
  expect(data.level).toBe(2);
  expect(calls).toHaveLength(1);
  expect(calls[0].characterId).toBe('character-1');
  expect(calls[0].creatorId).toBe('profile-1');
  expect(calls[0].perks[0]).toMatchObject({ class_ability_id: 'ab-1', text: 'New perk', position: 0 });
});

test('levelUp still refuses a non-owner with AuthorizationError', async () => {
  const svc = new CharacterService({ ...minimalRequiredAdapter(),
    getCharacter: async () => ok({ id: 'character-1', creator_id: 'profile-1', abilities: [] }) });
  await expect(svc.levelUp(STRANGER, 'character-1', {})).rejects.toBeInstanceOf(AuthorizationError);
});

// --- Offscreen-mission capabilities ----------------------------------

const offscreenAdapter = (overrides = {}) => ({
  // Baseline first so the specific offscreen stubs below (and per-test
  // `overrides`) take precedence — object-spread/property order means a
  // later same-named key wins, and minimalRequiredAdapter() also defines
  // generic versions of the six offscreen methods (for constructor
  // validation elsewhere), so it must not be spread after them here.
  ...minimalRequiredAdapter(),
  getCharacter: async () => ok({ id: 'character-1', creator_id: 'profile-1', name: 'Hero', abilities: [] }),
  getOffscreenMissionRow: async () => ok({ id: 'om-1', character_id: 'character-1' }),
  getSourceMissionForCredit: async () => ok({ id: 'm-1', name: 'Raid', date: '2026-01-01', host_id: 'profile-1' }),
  getConduitCredits: async () => ok({ balance: 3 }),
  insertOffscreenMission: async () => ({ error: null }),
  updateOffscreenMissionRow: async () => ({ error: null }),
  deleteOffscreenMissionRow: async () => ({ error: null }),
  ...overrides
});

test('createOffscreenMission refuses a non-owner with AuthorizationError', async () => {
  const svc = new CharacterService(offscreenAdapter());
  await expect(svc.createOffscreenMission(STRANGER, 'character-1', { name: 'x', summary: 'y' }))
    .rejects.toBeInstanceOf(AuthorizationError);
});

test('createOffscreenMission requires name and summary', async () => {
  const svc = new CharacterService(offscreenAdapter());
  // Supply a valid freeform source so this isolates the name/summary check —
  // resolveOffscreenSource runs first (route parity), so a request missing
  // both would surface the source error instead.
  const { error } = await svc.createOffscreenMission(CREATOR, 'character-1', {
    name: '', summary: '', source_mission_name_other: 'Freeform', source_mission_date_other: '2026-02-02'
  });
  expect(error).toEqual({ status: 400, message: 'Name and summary are required.' });
});

test('createOffscreenMission rejects a source mission the actor does not host', async () => {
  const svc = new CharacterService(offscreenAdapter({
    getSourceMissionForCredit: async () => ok({ id: 'm-1', name: 'Raid', date: '2026-01-01', host_id: 'someone-else' })
  }));
  const { error } = await svc.createOffscreenMission(CREATOR, 'character-1', {
    name: 'n', summary: 's', source_mission_id: 'm-1'
  });
  expect(error.status).toBe(400);
});

test('createOffscreenMission gates a hosted source on the credit balance', async () => {
  const svc = new CharacterService(offscreenAdapter({
    getConduitCredits: async () => ok({ balance: 0 })
  }));
  const { error } = await svc.createOffscreenMission(CREATOR, 'character-1', {
    name: 'n', summary: 's', source_mission_id: 'm-1'
  });
  expect(error).toEqual({ status: 400, message: 'No Conduit Credits available.' });
});

test('createOffscreenMission inserts on the happy path', async () => {
  const calls = [];
  const svc = new CharacterService(offscreenAdapter({
    insertOffscreenMission: async (args) => { calls.push(args); return { error: null }; }
  }));
  const { error } = await svc.createOffscreenMission(CREATOR, 'character-1', {
    name: 'n', summary: 's', source_mission_name_other: 'Freeform', source_mission_date_other: '2026-02-02'
  });
  expect(error).toBeNull();
  expect(calls[0].characterId).toBe('character-1');
});

test('updateOffscreenMission refuses a non-owner with AuthorizationError', async () => {
  const svc = new CharacterService(offscreenAdapter());
  await expect(svc.updateOffscreenMission(STRANGER, 'character-1', 'om-1', { name: 'n', summary: 's' }))
    .rejects.toBeInstanceOf(AuthorizationError);
});

test('updateOffscreenMission 404s when the row belongs to another character', async () => {
  const svc = new CharacterService(offscreenAdapter({
    getOffscreenMissionRow: async () => ok({ id: 'om-1', character_id: 'other-char' })
  }));
  const { error } = await svc.updateOffscreenMission(CREATOR, 'character-1', 'om-1', { name: 'n', summary: 's' });
  expect(error.status).toBe(404);
});

test('deleteOffscreenMission refuses a non-owner with AuthorizationError', async () => {
  const svc = new CharacterService(offscreenAdapter());
  await expect(svc.deleteOffscreenMission(STRANGER, 'character-1', 'om-1'))
    .rejects.toBeInstanceOf(AuthorizationError);
});

// --- Class item resolution -------------------------------------------
//
// A character's gear/ability rows carry the class_id of the class the item
// came from. The global name->class_id map is last-writer-wins across the
// whole public catalogue, so a player-created class sharing an item name with
// a canonical class poisons every other character's row. Resolution must
// prefer the character's OWN class, then its version family, then the class
// named by the submitted "ClassName::ItemName" value, and only then the
// global map.

// gunslinger-v2 is an in-family upgrade of gunslinger-v1 (same rules_edition);
// pcc-class is an unrelated player-created class that happens to reuse both
// Gunslinger gear names; haberdasher-class owns a name no Gunslinger defines.
const CLASS_ROWS = [
  { id: 'gunslinger-v1', name: 'Gunslinger', base_class_id: null, rules_edition: 'advent', rules_version: 'v1' },
  { id: 'gunslinger-v2', name: 'Gunslinger', base_class_id: 'gunslinger-v1', rules_edition: 'advent', rules_version: 'v2' },
  { id: 'pcc-class', name: 'Seamus McGlide — Gunslinger (PCC)', base_class_id: null, rules_edition: 'advent', rules_version: 'v2' },
  { id: 'haberdasher-class', name: 'Haberdasher', base_class_id: null, rules_edition: 'advent', rules_version: 'v2' },
  { id: 'wanderer-class', name: 'Wanderer', base_class_id: null, rules_edition: 'advent', rules_version: 'v2' }
];

const ITEMS_BY_CLASS_ID = new Map([
  ['gunslinger-v1', {
    gear: new Map([['Sharps Rifle', 'A long gun.']]),
    abilities: new Map()
  }],
  ['gunslinger-v2', {
    gear: new Map([['Revolver', 'A six-shooter.']]),
    abilities: new Map()
  }],
  ['pcc-class', {
    gear: new Map([['Revolver', 'A PCC six-shooter.'], ['Sharps Rifle', 'A PCC long gun.']]),
    abilities: new Map()
  }],
  ['haberdasher-class', {
    gear: new Map([['Borrowed Duster', 'A very fine coat.']]),
    abilities: new Map()
  }],
  ['wanderer-class', {
    gear: new Map([['Walking Stick', 'A road-worn stick.']]),
    abilities: new Map()
  }]
]);

// The class NAME the edit form submits as the "ClassName::ItemName" prefix,
// trimmed and lower-cased, to every class id carrying that name. "Gunslinger"
// is genuinely ambiguous in the real catalogue (advent/v1 and advent/v2).
const CLASSES_BY_NAME = () => new Map([
  ['gunslinger', ['gunslinger-v1', 'gunslinger-v2']],
  ['seamus mcglide — gunslinger (pcc)', ['pcc-class']],
  ['haberdasher', ['haberdasher-class']],
  ['wanderer', ['wanderer-class']]
]);

// The production poisoning: the PCC is concatenated last, so it wins globally
// for every name it shares with a canonical class.
const POISONED_GLOBAL_MAPS = () => ({
  gearNameToClassId: new Map([
    ['Revolver', 'pcc-class'],
    ['Sharps Rifle', 'pcc-class'],
    ['Borrowed Duster', 'haberdasher-class']
  ]),
  gearNameToDescription: new Map(),
  abilityNameToClassId: new Map(),
  abilityNameToDescription: new Map(),
  itemsByClassId: ITEMS_BY_CLASS_ID,
  classesByName: CLASSES_BY_NAME(),
  classRows: CLASS_ROWS
});

// Saves gear through updateCharacter for a character whose (immutable) stored
// class is `classId`, reporting both the service result and whatever reached
// adapter.saveCharacterAtomic (null when the save was refused before the write).
const saveGearAsClass = async (classId, gear) => {
  let saved = null;
  const service = new CharacterService(makeAdapter([], {
    getCharacter: async () => ok({ id: 'character-1', creator_id: 'profile-1', class_id: classId, abilities: [] }),
    getClassContentLookupMaps: async () => POISONED_GLOBAL_MAPS(),
    saveCharacterAtomic: async (args) => {
      saved = args;
      return ok({ id: 'character-1' });
    }
  }));
  const result = await service.updateCharacter('character-1', { name: 'Hero', gear }, { id: 'profile-1' });
  return { result, saved };
};

// Gear rows handed to saveCharacterAtomic for a character of `classId`.
const saveGearForClass = async (classId, gear) => {
  const { result, saved } = await saveGearAsClass(classId, gear);
  expect(result.error).toBeNull();
  return saved.gear;
};

const saveGearForGunslinger = gear => saveGearForClass('gunslinger-v2', gear);

test('gear resolves to the character\'s own class, not a player-created class that reuses the name', async () => {
  const gear = await saveGearForGunslinger(['Revolver']);
  expect(gear).toEqual([{ name: 'Revolver', class_id: 'gunslinger-v2', description: 'A six-shooter.' }]);
});

test('gear the character\'s own class lacks resolves within its version family', async () => {
  const gear = await saveGearForGunslinger(['Sharps Rifle']);
  expect(gear[0].class_id).toBe('gunslinger-v1');
});

test('gear no class in the character\'s family defines still falls back to the global map', async () => {
  const gear = await saveGearForGunslinger(['Borrowed Duster']);
  expect(gear[0].class_id).toBe('haberdasher-class');
});

test('an explicit class_id on a gear item wins over every fallback', async () => {
  const gear = await saveGearForGunslinger([{ name: 'Revolver', class_id: 'pcc-class' }]);
  expect(gear[0].class_id).toBe('pcc-class');
});

test('borrowed gear resolves to the class the form named, not the player-created class the global map points at', async () => {
  const gear = await saveGearForClass('wanderer-class', ['Gunslinger::Revolver']);
  expect(gear).toEqual([{ name: 'Revolver', class_id: 'gunslinger-v2', description: 'A six-shooter.' }]);
});

test('a submitted class name that does not define the item falls through to the global map', async () => {
  const gear = await saveGearForClass('wanderer-class', ['Haberdasher::Revolver']);
  expect(gear[0].class_id).toBe('pcc-class');
});

test('an ambiguous class name resolves to the class id that defines the item', async () => {
  const gear = await saveGearForClass('wanderer-class', ['Gunslinger::Sharps Rifle']);
  expect(gear[0].class_id).toBe('gunslinger-v1');
});

test('gear no class defines any more falls back to the character\'s own class instead of failing the save', async () => {
  const { result, saved } = await saveGearAsClass('gunslinger-v2', ['Renamed Peacemaker']);
  expect(result.error).toBeNull();
  expect(saved.gear).toEqual([{ name: 'Renamed Peacemaker', class_id: 'gunslinger-v2', description: null }]);
});

test('gear no class defines still fails the save when the character has no class to fall back to', async () => {
  const { result, saved } = await saveGearAsClass(null, ['Renamed Peacemaker']);
  expect(result.error).toBe('[setCharacterGear] Missing class_id for gear item "Renamed Peacemaker"');
  expect(saved).toBeNull();
});

// --- Enchantment and Mods forwarding (atomic path, p_gear) -------------
//
// saveCharacterAtomic builds the payload for save_character_atomic, which is
// the path production uses (services/character/repository.js wires it
// whenever supabaseAdmin.rpc exists, and CharacterService prefers it). The
// RPC's contract keys on whether 'enchantment'/'mods' are present on a p_gear
// item at all, so these pin the payload's shape, not just its values.

test('a submitted Enchantment and Mods reach the atomic gear payload', async () => {
  const gear = await saveGearForGunslinger([{
    name: 'Revolver',
    enchantment: { source: 'custom', name: 'Ported', description: 'Retooled.' },
    mods: [{ name: 'Lined', description: 'Warm.' }]
  }]);
  expect(gear[0]).toEqual({
    name: 'Revolver',
    class_id: 'gunslinger-v2',
    description: 'A six-shooter.',
    enchantment: { source: 'custom', name: 'Ported', description: 'Retooled.' },
    mods: [{ name: 'Lined', description: 'Warm.' }]
  });
});

// An OBJECT submission that never mentions equipment, not the bare-string
// shape the edit form sends -- the string shape carries no equipment keys
// regardless of this code, so it cannot show whether an object's absence is
// preserved. Before normalizeGearEquipment used an `in` check (and before
// this mapping forwarded the fields at all), this shape reached the RPC as
// enchantment: null, mods: [], which reads as "remove the Enchantment".
test('a gear item submitted as an object with no equipment keys reaches the atomic payload with none either', async () => {
  const gear = await saveGearForGunslinger([{ name: 'Revolver' }]);
  expect(gear).toEqual([{ name: 'Revolver', class_id: 'gunslinger-v2', description: 'A six-shooter.' }]);
});

test('an explicit null Enchantment reaches the atomic payload as null, leaving an unmentioned Mods key absent', async () => {
  const gear = await saveGearForGunslinger([{ name: 'Revolver', enchantment: null }]);
  expect(gear[0]).toEqual({
    name: 'Revolver', class_id: 'gunslinger-v2', description: 'A six-shooter.', enchantment: null
  });
  expect('mods' in gear[0]).toBe(false);
});

// --- Enchantment and Mods forwarding (fallback path, reconcileGear) ----
//
// The fake-client unit tests above never define adapter.saveCharacterAtomic,
// so updateCharacter falls back to reconcileGear -- the path a real
// supabaseAdmin without an rpc method would take.

const HIP_FLASK_MAPS = () => ({
  gearNameToClassId: new Map([['Hip Flask', 'class-1']]),
  gearNameToDescription: new Map([['Hip Flask', 'A flask.']]),
  abilityNameToClassId: new Map(),
  abilityNameToDescription: new Map(),
  itemsByClassId: new Map(),
  classesByName: new Map(),
  classRows: []
});

const ENCHANTED_GEAR_ROW = {
  id: 'gear-row-1', name: 'Hip Flask', class_id: 'class-1', description: 'A flask.',
  enchantment: { source: 'default' }, mods: [{ name: 'Lined', description: 'Warm.' }]
};

test('reconcileGear leaves a stored Enchantment and Mods alone when the submitted item omits them', async () => {
  const calls = [];
  const adapter = makeAdapter(calls, {
    getChildRows: async (table) => ok(table === 'class_gear' ? [ENCHANTED_GEAR_ROW] : []),
    getClassContentLookupMaps: async () => HIP_FLASK_MAPS()
  });
  const service = new CharacterService(adapter);
  const result = await service.updateCharacter('character-1', {
    name: 'Hero', gear: [{ name: 'Hip Flask', class_id: 'class-1' }]
  }, { id: 'profile-1' });

  expect(result.error).toBeNull();
  expect(calls.filter(c => c[0] === 'updateChildRow' && c[1] === 'class_gear')).toEqual([]);
  expect(calls.filter(c => c[0] === 'insertChildRows' && c[1] === 'class_gear')).toEqual([]);
  expect(calls.filter(c => c[0] === 'deleteChildRows' && c[1] === 'class_gear')).toEqual([]);
});

test('reconcileGear clears a stored Enchantment when the submitted item sets it to null', async () => {
  const calls = [];
  const adapter = makeAdapter(calls, {
    getChildRows: async (table) => ok(table === 'class_gear' ? [ENCHANTED_GEAR_ROW] : []),
    getClassContentLookupMaps: async () => HIP_FLASK_MAPS()
  });
  const service = new CharacterService(adapter);
  const result = await service.updateCharacter('character-1', {
    name: 'Hero', gear: [{ name: 'Hip Flask', class_id: 'class-1', enchantment: null }]
  }, { id: 'profile-1' });

  expect(result.error).toBeNull();
  const update = calls.find(c => c[0] === 'updateChildRow' && c[1] === 'class_gear');
  expect(update[3]).toEqual({ enchantment: null });
});

// --- Auto-calculate economy -------------------------------------------
//
// deriveCharacterTotals prices gear differently depending on which economy
// the character's class belongs to (util/merx-economy.js#economyFor), keyed
// on the stored class's content_format. The service must resolve that economy
// itself rather than let deriveCharacterTotals default to advent.
//
// Reuses GUNSLINGER_FAMILY_AND_FORK's two ends: gunslinger-v1 (content_format
// advent) and gunslinger-aspirant-v1 (content_format aspirant).
const ASPIRANT_CLASS_ID = 'gunslinger-aspirant-v1';
const ADVENT_CLASS_ID = 'gunslinger-v1';

// Saves gear through updateCharacter with auto_calculate on, for a character
// whose (immutable) stored class is `classId`. Mirrors saveGearAsClass above,
// but exercises the derived Merx totals rather than gear-resolution.
const autoCalculateOnClass = async (classId, gear) => {
  let saved = null;
  const service = new CharacterService(makeAdapter([], {
    getCharacter: async () => ok({ id: 'character-1', creator_id: 'profile-1', class_id: classId, abilities: [] }),
    getClassContentLookupMaps: async () => ({
      gearNameToClassId: new Map(),
      gearNameToDescription: new Map(),
      abilityNameToClassId: new Map(),
      abilityNameToDescription: new Map(),
      itemsByClassId: new Map(),
      classesByName: new Map(),
      classRows: GUNSLINGER_FAMILY_AND_FORK
    }),
    saveCharacterAtomic: async (args) => {
      saved = args.character;
      return ok({ id: 'character-1' });
    }
  }));
  const result = await service.updateCharacter('character-1', { name: 'Hero', gear, auto_calculate: true }, { id: 'profile-1' });
  return { result, saved };
};

test('auto-calculate prices a V1 character under the aspirant economy', async () => {
  const gear = [
    { name: 'S0', class_id: ASPIRANT_CLASS_ID },
    { name: 'S1', class_id: ASPIRANT_CLASS_ID }
  ];
  const { result, saved } = await autoCalculateOnClass(ASPIRANT_CLASS_ID, gear);
  expect(result.error).toBeNull();
  // Aspirant grants 12 Merx at creation and charges 2 Merx per own-class
  // Signature with no free allotment, so two Signatures (4 spent) leave an
  // 8 Merx reward. Misresolved to advent -- which grants 0 Merx but gives the
  // first four Signatures free -- this same character would show 0 instead.
  expect(saved.commissary_reward).toBe(8);
});

test('auto-calculate leaves an Advent character on the advent economy', async () => {
  const gear = [
    { name: 'S0', class_id: ADVENT_CLASS_ID },
    { name: 'S1', class_id: ADVENT_CLASS_ID },
    { name: 'S2', class_id: ADVENT_CLASS_ID },
    { name: 'S3', class_id: ADVENT_CLASS_ID }
  ];
  const { result, saved } = await autoCalculateOnClass(ADVENT_CLASS_ID, gear);
  expect(result.error).toBeNull();
  // Four own-class Signatures sit inside Advent's four-item free allotment,
  // so nothing is charged and the reward stays 0 -- unchanged from before
  // this task, since Advent was always the default economy.
  expect(saved.commissary_reward).toBe(0);
});

// --- commissary_reward derived at creation -----------------------------
//
// The wizard hardcodes commissary_reward: 0 in its create payload. For the
// two V1 economies createCharacter now knows the right answer -- the Merx
// grant minus what the submitted gear spends, with no missions yet to add
// to it -- so it computes that rather than trusting the client's number.
// Advent keeps trusting the submitted value: nothing here recalculates a
// budget-less character's reward.
const makeServiceOnClass = () => {
  const saved = {};
  const adapter = makeAdapter([], {
    getClassContentLookupMaps: async () => ({
      gearNameToClassId: new Map(),
      gearNameToDescription: new Map(),
      abilityNameToClassId: new Map(),
      abilityNameToDescription: new Map(),
      itemsByClassId: new Map(),
      classesByName: new Map(),
      classRows: GUNSLINGER_FAMILY_AND_FORK
    }),
    saveCharacterAtomic: async (args) => {
      Object.assign(saved, args.character);
      return ok({ id: 'character-1', ...args.character });
    }
  });
  return { service: new CharacterService(adapter), saved };
};

const makeServiceOnAspirantClass = makeServiceOnClass;
const makeServiceOnAdventClass = makeServiceOnClass;

test('a created V1 character keeps the Merx it did not spend', async () => {
  // Four own-class Signatures cost 8 of the 12-Merx grant.
  const { service, saved } = makeServiceOnAspirantClass({});
  await service.createCharacter({
    name: 'Thrifty', class_id: ASPIRANT_CLASS_ID, creator_mode: 'aspirant',
    gear: Array.from({ length: 4 }, (_, i) => ({ name: `S${i}`, class_id: ASPIRANT_CLASS_ID })),
    commissary_reward: 0
  }, { id: 'profile-1' });
  expect(saved.commissary_reward).toBe(4);
});

test('a created Advent character keeps the reward it submitted', async () => {
  const { service, saved } = makeServiceOnAdventClass({});
  await service.createCharacter({
    name: 'Legacy', class_id: ADVENT_CLASS_ID, creator_mode: 'advent',
    gear: [], commissary_reward: 7
  }, { id: 'profile-1' });
  expect(saved.commissary_reward).toBe(7);
});

// The wizard sends type on every aspiring ability
// (public/js/character-wizard.js:3225,3228), but both write paths projected
// abilities down to {name, class_id, description}. A dropped tag makes an
// aspiring character's abilities indistinguishable from any other's.
test('reconcileAbilities persists the core/advanced tag', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls));
  await service.reconcileAbilities('character-1', [
    { name: 'Dodge', class_id: 'class-a', type: 'core' },
    { name: 'Overdrive', class_id: 'class-b', type: 'advanced' }
  ]);
  const inserted = calls.find(c => c[0] === 'insertChildRows' && c[1] === 'class_abilities');
  expect(inserted[3]).toEqual([
    { name: 'Dodge', class_id: 'class-a', description: null, type: 'core' },
    { name: 'Overdrive', class_id: 'class-b', description: null, type: 'advanced' }
  ]);
});

// An untagged ability is core. Advent characters submit no type at all, and a
// null would violate the NOT NULL added by 20260913000000.
test('an ability submitted without a type defaults to core', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls));
  await service.reconcileAbilities('character-1', [{ name: 'Dodge', class_id: 'class-a' }]);
  const inserted = calls.find(c => c[0] === 'insertChildRows' && c[1] === 'class_abilities');
  expect(inserted[3][0].type).toBe('core');
});

// type is an attribute, not identity: retagging an existing ability must update
// the row in place rather than delete and reinsert it, or character_perks
// (class_ability_id ON DELETE CASCADE) is destroyed.
test('retagging an ability updates the row instead of replacing it', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getChildRows: async (table, id) => {
      calls.push(['getChildRows', table, id]);
      return ok([{ id: 'row-1', name: 'Dodge', class_id: 'class-a', description: null, type: 'core' }]);
    }
  }));
  await service.reconcileAbilities('character-1', [{ name: 'Dodge', class_id: 'class-a', type: 'advanced' }]);
  expect(calls.some(c => c[0] === 'deleteChildRows' && c[3].length)).toBe(false);
  const updated = calls.find(c => c[0] === 'updateChildRow');
  expect(updated[3]).toEqual({ type: 'advanced' });
});

// type is an attribute, not identity: the edit form submits abilities with no
// type at all, so a save that says nothing about type must leave the stored tag
// alone rather than silently retagging an advanced ability core.
test('an ability submitted without a type keeps the stored type of an existing row', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getChildRows: async (table, id) => {
      calls.push(['getChildRows', table, id]);
      return ok([{ id: 'row-1', name: 'Dodge', class_id: 'class-a', description: null, type: 'advanced' }]);
    }
  }));
  await service.reconcileAbilities('character-1', [{ name: 'Dodge', class_id: 'class-a' }]);
  expect(calls.some(c => c[0] === 'updateChildRow' && c[3].type === 'core')).toBe(false);
  expect(calls.some(c => c[0] === 'deleteChildRows' && c[3].length)).toBe(false);
  expect(calls.some(c => c[0] === 'insertChildRows' && c[3].length)).toBe(false);
});
