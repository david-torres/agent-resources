const { test, expect } = require('bun:test');
const { normalizeLfgInput } = require('./input');
const { LfgService } = require('./service');

const makeAdapter = () => {
  const calls = [];
  return {
    calls,
    getPost: async () => ({ data: { id: 'post-1', creator_id: 'actor-1' }, error: null }),
    createPost: async data => { calls.push(['createPost', data]); return { data: [{ id: 'post-1', ...data }], error: null }; },
    updatePost: async (id, actorId, data) => { calls.push(['updatePost', id, actorId, data]); return { data: [{ id, ...data }], error: null }; },
    getCreatorRequest: async () => ({ data: null, error: null }),
    deleteJoinRequest: async id => { calls.push(['deleteJoinRequest', id]); return { data: null, error: null }; },
    joinPost: async (...args) => { calls.push(['joinPost', ...args]); return { data: [], error: null }; }
  };
};

test('normalizes LFG input without mutating the submitted request', () => {
  const input = { title: 'Game', character: 'char-1', host_id: 'on', is_public: 'on', date: '2026-07-11T20:00' };
  const result = normalizeLfgInput(input, { creatorId: 'actor-1', timezone: 'America/New_York' });
  expect(input).toEqual({ title: 'Game', character: 'char-1', host_id: 'on', is_public: 'on', date: '2026-07-11T20:00' });
  expect(result.data).toMatchObject({ title: 'Game', creator_id: 'actor-1', is_public: true });
  expect(result.data.character).toBeUndefined();
  expect(result.role).toEqual({ hostFlag: true, characterId: 'char-1' });
});

test('creates a normalized post then reconciles the creator role', async () => {
  const adapter = makeAdapter();
  const service = new LfgService(adapter);
  const result = await service.createPost({ title: 'Game', host_id: 'on', is_public: false, date: '2026-07-11' }, { id: 'actor-1', timezone: 'UTC' });
  expect(result.error).toBeNull();
  expect(adapter.calls.map(call => call[0])).toEqual(['createPost', 'joinPost']);
  expect(adapter.calls[1]).toEqual(['joinPost', 'post-1', 'actor-1', 'conduit', null]);
});

test('rejects an update by a non-owner without writing', async () => {
  const adapter = makeAdapter();
  const service = new LfgService(adapter);
  const result = await service.updatePost('post-1', { title: 'Nope' }, { id: 'other', timezone: 'UTC' });
  expect(result.error).toBe('Unauthorized');
  expect(adapter.calls).toEqual([]);
});
