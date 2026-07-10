const { test, expect } = require('bun:test');
const { normalizeMissionInput } = require('./input');
const { MissionService } = require('./service');

const makeAdapter = () => {
  const calls = [];
  return {
    calls,
    canEdit: async () => true,
    getHost: async () => ({ data: { host_id: 'old-host' }, error: null }),
    createMissionRow: async data => { calls.push(['create', data]); return { data: [data], error: null }; },
    updateMissionRow: async (id, data) => { calls.push(['update', id, data]); return { data: [data], error: null }; },
    deleteMissionRow: async (id, actorId) => { calls.push(['delete', id, actorId]); return { data: null, error: null }; },
    getMissionProfileIds: async id => { calls.push(['affected', id]); return ['host', 'character-owner']; },
    getCharacterCreator: async () => ({ data: { creator_id: 'character-owner' }, error: null }),
    upsertMissionCharacter: async (id, charId) => { calls.push(['add', id, charId]); return { data: [], error: null }; },
    deleteMissionCharacter: async (id, charId) => { calls.push(['remove', id, charId]); return { data: null, error: null }; },
    mergeMissions: async (primary, secondary, actor) => { calls.push(['merge', primary, secondary, actor]); return { error: null }; },
    getMission: async id => ({ data: { id }, error: null }),
    recalcBadges: async ids => { calls.push(['recalc', ids]); }
  };
};

test('normalizes mission input without modifying the caller payload', () => {
  const input = { name: 'Mission', media_url: 'javascript:bad()' };
  const data = normalizeMissionInput(input, { creatorId: 'creator-1' });
  expect(input).toEqual({ name: 'Mission', media_url: 'javascript:bad()' });
  expect(data).toEqual({ name: 'Mission', media_url: null, creator_id: 'creator-1' });
});

test('updates a mission then recalculates both affected hosts', async () => {
  const adapter = makeAdapter();
  const service = new MissionService(adapter);
  await service.updateMission('mission-1', { host_id: 'new-host' }, { id: 'actor-1' });
  expect(adapter.calls).toEqual([
    ['update', 'mission-1', { host_id: 'new-host' }],
    ['recalc', ['old-host', 'new-host']]
  ]);
});

test('does not write an unauthorized mission update', async () => {
  const adapter = makeAdapter();
  adapter.canEdit = async () => false;
  const service = new MissionService(adapter);
  const result = await service.updateMission('mission-1', { name: 'Nope' }, { id: 'actor-1' });
  expect(result.error).toMatch('Unauthorized');
  expect(adapter.calls).toEqual([]);
});
