const { test, expect } = require('bun:test');
const { normalizeMissionInput } = require('./input');
const { MissionService } = require('./service');
const { AuthorizationError } = require('../../util/errors');
const { SYSTEM_ACTOR } = require('../../util/actor');

const MISSION_ID = 'mission-1';

const CREATOR = { profileId: 'creator-1', role: 'user' };
const HOST = { profileId: 'host-1', role: 'user' };
const EDITOR = { profileId: 'editor-1', role: 'user' };
const STRANGER = { profileId: 'stranger', role: 'user' };
const ADMIN = { profileId: 'admin-1', role: 'admin' };

const makeRepo = ({ mission = { creator_id: 'creator-1', host_id: 'host-1' }, editorProfileIds = ['editor-1'] } = {}) => {
  const calls = [];
  return {
    calls,
    getHost: async () => ({ data: { host_id: 'old-host' }, error: null }),
    createMissionRow: async data => { calls.push(['create', data]); return { data: [data], error: null }; },
    updateMissionRow: async (id, data) => { calls.push(['update', id, data]); return { data: [data], error: null }; },
    deleteMissionRow: async (id, creatorId) => { calls.push(['delete', id, creatorId]); return { data: null, error: null }; },
    getMissionProfileIds: async id => { calls.push(['affected', id]); return ['host', 'character-owner']; },
    getCharacterCreator: async () => { calls.push(['getCharacterCreator']); return { data: { creator_id: 'character-owner' }, error: null }; },
    upsertMissionCharacter: async (id, charId) => { calls.push(['add', id, charId]); return { data: [], error: null }; },
    deleteMissionCharacter: async (id, charId) => { calls.push(['remove', id, charId]); return { data: null, error: null }; },
    mergeMissions: async (primary, secondary, actorId) => { calls.push(['merge', primary, secondary, actorId]); return { error: null }; },
    getMission: async id => ({ data: { id }, error: null }),
    recalcBadges: async ids => { calls.push(['recalc', ids]); },
    updateUnregisteredNames: async (id, names) => { calls.push(['setNames', id, names]); return { data: [{ id, unregistered_character_names: names }], error: null }; },
    upsertEditor: async row => { calls.push(['upsertEditor', row]); return { data: [row], error: null }; },
    deleteEditor: async ({ missionId, profileId }) => { calls.push(['deleteEditor', missionId, profileId]); return { error: null }; },
    fetchMissionPermissionRow: async id => { calls.push(['fetchPermission', id]); return { data: mission, error: null }; },
    fetchCreatorId: async id => { calls.push(['fetchCreatorId', id]); return { data: mission ? { creator_id: mission.creator_id } : null, error: null }; },
    fetchEditorRow: async ({ profileId }) => {
      calls.push(['fetchEditorRow', profileId]);
      return { data: editorProfileIds.includes(profileId) ? { profile_id: profileId } : null, error: null };
    }
  };
};

test('normalizes mission input without modifying the caller payload', () => {
  const input = { name: 'Mission', media_url: 'javascript:bad()' };
  const data = normalizeMissionInput(input, { creatorId: 'creator-1' });
  expect(input).toEqual({ name: 'Mission', media_url: 'javascript:bad()' });
  expect(data).toEqual({ name: 'Mission', media_url: null, creator_id: 'creator-1' });
});

test('constructor requires every repository method', () => {
  expect(() => new MissionService({})).toThrow(TypeError);
});

test('createMission derives creator_id from the actor', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.createMission(CREATOR, { name: 'Mission' });
  expect(repo.calls).toEqual([['create', { name: 'Mission', creator_id: 'creator-1' }]]);
});

test('createMission recalcs the host when one is set', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.createMission(CREATOR, { name: 'Mission', host_id: 'host-9' });
  expect(repo.calls).toEqual([
    ['create', { name: 'Mission', host_id: 'host-9', creator_id: 'creator-1' }],
    ['recalc', ['host-9']]
  ]);
});

test('the system actor may set an explicit creator_id on create', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.createMission(SYSTEM_ACTOR, { name: 'Mission', creator_id: 'explicit-creator' });
  expect(repo.calls).toEqual([['create', { name: 'Mission', creator_id: 'explicit-creator' }]]);
});

test('the creator may update their mission; the write reaches the repository', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.updateMission(CREATOR, MISSION_ID, { host_id: 'new-host' });
  expect(repo.calls).toEqual([
    ['fetchPermission', MISSION_ID],
    ['fetchEditorRow', 'creator-1'],
    ['update', MISSION_ID, { host_id: 'new-host' }],
    ['recalc', ['old-host', 'new-host']]
  ]);
});

test('the host may update the mission', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.updateMission(HOST, MISSION_ID, { name: 'New name' });
  expect(repo.calls.map(c => c[0])).toEqual(['fetchPermission', 'fetchEditorRow', 'update', 'recalc']);
});

test('an editor may update the mission', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.updateMission(EDITOR, MISSION_ID, { name: 'New name' });
  expect(repo.calls.map(c => c[0])).toEqual(['fetchPermission', 'fetchEditorRow', 'update', 'recalc']);
});

test('an admin may update a mission they do not own', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.updateMission(ADMIN, MISSION_ID, { name: 'New name' });
  expect(repo.calls.map(c => c[0])).toEqual(['fetchPermission', 'update', 'recalc']);
});

test('the system actor may update any mission', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.updateMission(SYSTEM_ACTOR, MISSION_ID, { name: 'New name' });
  expect(repo.calls.map(c => c[0])).toEqual(['fetchPermission', 'update', 'recalc']);
});

test('a stranger updating a mission throws AuthorizationError, never reaching the write', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await expect(service.updateMission(STRANGER, MISSION_ID, { name: 'Nope' })).rejects.toThrow(AuthorizationError);
  expect(repo.calls.map(c => c[0])).toEqual(['fetchPermission', 'fetchEditorRow']);
});

test('updating a mission that does not exist throws AuthorizationError (not_found)', async () => {
  const repo = makeRepo({ mission: null });
  const service = new MissionService(repo);
  await expect(service.updateMission(CREATOR, 'missing', {})).rejects.toThrow(AuthorizationError);
});

test('the creator may delete their mission; the SQL filter uses the loaded creator_id', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.deleteMission(CREATOR, MISSION_ID);
  expect(repo.calls).toEqual([
    ['fetchPermission', MISSION_ID],
    ['affected', MISSION_ID],
    ['delete', MISSION_ID, 'creator-1'],
    ['recalc', ['host', 'character-owner']]
  ]);
});

test('an admin may delete a mission they do not own; the filter uses the actual creator_id', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.deleteMission(ADMIN, MISSION_ID);
  expect(repo.calls).toEqual([
    ['fetchPermission', MISSION_ID],
    ['affected', MISSION_ID],
    ['delete', MISSION_ID, 'creator-1'],
    ['recalc', ['host', 'character-owner']]
  ]);
});

test('the host may NOT delete the mission (delete is creator-only)', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await expect(service.deleteMission(HOST, MISSION_ID)).rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([['fetchPermission', MISSION_ID]]);
});

test('a stranger deleting a mission throws AuthorizationError, never reaching the delete', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await expect(service.deleteMission(STRANGER, MISSION_ID)).rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([['fetchPermission', MISSION_ID]]);
});

test('the creator may add a character to their mission', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.addCharacter(CREATOR, { missionId: MISSION_ID, characterId: 'char-1' });
  expect(repo.calls.map(c => c[0])).toEqual(['fetchPermission', 'fetchEditorRow', 'add', 'getCharacterCreator', 'recalc']);
});

test('the system actor may add a character (internal backfill path)', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.addCharacter(SYSTEM_ACTOR, { missionId: MISSION_ID, characterId: 'char-1' });
  expect(repo.calls.map(c => c[0])).toEqual(['fetchPermission', 'add', 'getCharacterCreator', 'recalc']);
});

test('a stranger may NOT add a character to a mission they cannot edit', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await expect(service.addCharacter(STRANGER, { missionId: MISSION_ID, characterId: 'char-1' })).rejects.toThrow(AuthorizationError);
  expect(repo.calls.map(c => c[0])).toEqual(['fetchPermission', 'fetchEditorRow']);
});

test('the creator may remove a character from their mission', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.removeCharacter(CREATOR, { missionId: MISSION_ID, characterId: 'char-1' });
  expect(repo.calls.map(c => c[0])).toEqual(['fetchPermission', 'fetchEditorRow', 'remove', 'getCharacterCreator', 'recalc']);
});

test('the system actor may remove a character (internal path)', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.removeCharacter(SYSTEM_ACTOR, { missionId: MISSION_ID, characterId: 'char-1' });
  expect(repo.calls.map(c => c[0])).toEqual(['fetchPermission', 'remove', 'getCharacterCreator', 'recalc']);
});

test('a stranger may NOT remove a character from a mission they cannot edit', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await expect(service.removeCharacter(STRANGER, { missionId: MISSION_ID, characterId: 'char-1' })).rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([['fetchPermission', MISSION_ID], ['fetchEditorRow', 'stranger']]);
});

test('the creator (via canEditMission) may set unregistered character names', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.setUnregisteredNames(CREATOR, MISSION_ID, [' Alice ', '', 'Bob']);
  expect(repo.calls).toEqual([
    ['fetchPermission', MISSION_ID],
    ['fetchEditorRow', 'creator-1'],
    ['setNames', MISSION_ID, ['Alice', 'Bob']]
  ]);
});

test('a stranger may NOT set unregistered character names', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await expect(service.setUnregisteredNames(STRANGER, MISSION_ID, ['Nope'])).rejects.toThrow(AuthorizationError);
});

test('the mission creator may add an editor', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.addEditor(CREATOR, { missionId: MISSION_ID, profileId: 'new-editor' });
  expect(repo.calls).toEqual([
    ['fetchPermission', MISSION_ID],
    ['upsertEditor', { mission_id: MISSION_ID, profile_id: 'new-editor', added_by: 'creator-1' }]
  ]);
});

test('the host may NOT add an editor (addEditor is creator-only)', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await expect(service.addEditor(HOST, { missionId: MISSION_ID, profileId: 'new-editor' })).rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([['fetchPermission', MISSION_ID]]);
});

test('the system actor may add an editor', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.addEditor(SYSTEM_ACTOR, { missionId: MISSION_ID, profileId: 'new-editor' });
  expect(repo.calls).toEqual([
    ['fetchPermission', MISSION_ID],
    ['upsertEditor', { mission_id: MISSION_ID, profile_id: 'new-editor', added_by: null }]
  ]);
});

test('the mission creator may remove an editor', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await service.removeEditor(CREATOR, { missionId: MISSION_ID, profileId: 'editor-1' });
  expect(repo.calls).toEqual([
    ['fetchPermission', MISSION_ID],
    ['deleteEditor', MISSION_ID, 'editor-1']
  ]);
});

test('an editor may NOT remove another editor (removeEditor is creator-only)', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await expect(service.removeEditor(EDITOR, { missionId: MISSION_ID, profileId: 'editor-1' })).rejects.toThrow(AuthorizationError);
});

test('merging requires the actor to edit BOTH missions; success recalculates and returns the merged mission', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  const result = await service.mergeMissions(CREATOR, 'primary', 'secondary');
  expect(repo.calls.filter(c => c[0] !== 'fetchPermission' && c[0] !== 'fetchEditorRow')).toEqual([
    ['affected', 'primary'],
    ['affected', 'secondary'],
    ['merge', 'primary', 'secondary', 'creator-1'],
    ['recalc', ['host', 'character-owner', 'host', 'character-owner']]
  ]);
  expect(result).toEqual({ data: { id: 'primary' }, error: null });
});

test('a stranger cannot merge missions they cannot edit; no writes occur', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  await expect(service.mergeMissions(STRANGER, 'primary', 'secondary')).rejects.toThrow(AuthorizationError);
  expect(repo.calls.some(c => c[0] === 'merge')).toBe(false);
});

test('canEditMission compatibility check returns a boolean without throwing', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  expect(await service.canEditMission(CREATOR, MISSION_ID)).toBe(true);
  expect(await service.canEditMission(STRANGER, MISSION_ID)).toBe(false);
});

test('isCreator compatibility check returns a boolean without throwing', async () => {
  const repo = makeRepo();
  const service = new MissionService(repo);
  expect(await service.isCreator(CREATOR, MISSION_ID)).toBe(true);
  expect(await service.isCreator(HOST, MISSION_ID)).toBe(false);
});
