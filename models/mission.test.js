const { test, expect, mock, afterAll } = require('bun:test');
const realBase = require('./_base');
const { makeSpyClient } = require('./test-helpers');

const defaultAnon = makeSpyClient({ missions: [] });
mock.module('./_base', () => ({
  supabase: defaultAnon,
  supabaseAdmin: makeSpyClient(),
  anonKey: 'x',
  createUserClient: () => defaultAnon
}));

delete require.cache[require.resolve('./mission')];
const { getOwnMissions } = require('./mission');

afterAll(() => {
  mock.module('./_base', () => realBase);
  delete require.cache[require.resolve('./mission')];
});

test('getOwnMissions uses the passed client (not the default anon)', async () => {
  const userClient = makeSpyClient({
    missions: [{ id: 'm1', creator_id: 'p1', characters: [] }]
  });
  defaultAnon.calls.length = 0;
  const { data } = await getOwnMissions({ id: 'p1' }, userClient);
  expect(userClient.calls).toContain('missions');
  expect(defaultAnon.calls).not.toContain('missions');
  expect(data.length).toBe(1);
});

test('getOwnMissions falls back to the module-level anon client when no client passed', async () => {
  defaultAnon.calls.length = 0;
  await getOwnMissions({ id: 'p1' });
  expect(defaultAnon.calls).toContain('missions');
});

test('getMission uses the passed client', async () => {
  const userClient = makeSpyClient({
    missions: [{ id: 'm1', characters: [], host: null }]
  });
  defaultAnon.calls.length = 0;
  const { getMission } = require('./mission');
  const { data } = await getMission('m1', userClient);
  expect(userClient.calls).toContain('missions');
  expect(defaultAnon.calls).not.toContain('missions');
  expect(data.id).toBe('m1');
});

test('getMissionCharacters uses the passed client', async () => {
  const userClient = makeSpyClient({ mission_characters: [{ character_id: 'c1' }] });
  defaultAnon.calls.length = 0;
  const { getMissionCharacters } = require('./mission');
  const { data } = await getMissionCharacters('m1', userClient);
  expect(userClient.calls).toContain('mission_characters');
  expect(defaultAnon.calls).not.toContain('mission_characters');
  expect(data.length).toBe(1);
});

test('getMissionEditors uses the passed client for both reads', async () => {
  const userClient = makeSpyClient({
    missions: [{ creator_id: 'p1', host_id: null }],
    mission_editors: []
  });
  defaultAnon.calls.length = 0;
  const { getMissionEditors } = require('./mission');
  await getMissionEditors('m1', userClient);
  expect(userClient.calls.filter(t => t === 'missions').length).toBe(1);
  expect(userClient.calls.filter(t => t === 'mission_editors').length).toBe(1);
  expect(defaultAnon.calls).not.toContain('missions');
  expect(defaultAnon.calls).not.toContain('mission_editors');
});

test('getEditableMissions uses the passed client', async () => {
  const userClient = makeSpyClient({ mission_editors: [] });
  defaultAnon.calls.length = 0;
  const { getEditableMissions } = require('./mission');
  await getEditableMissions({ id: 'p1' }, userClient);
  expect(userClient.calls).toContain('mission_editors');
  expect(defaultAnon.calls).not.toContain('mission_editors');
});

test('searchSimilarMissions uses the passed client', async () => {
  const userClient = makeSpyClient({ missions: [] });
  defaultAnon.calls.length = 0;
  const { searchSimilarMissions } = require('./mission');
  await searchSimilarMissions('2026-04-21', 'test', null, 3, userClient);
  expect(userClient.calls).toContain('missions');
  expect(defaultAnon.calls).not.toContain('missions');
});
