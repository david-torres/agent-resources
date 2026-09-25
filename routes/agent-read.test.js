// Pins the HTTP contract of the agent read surface (/api/agent/me, classes,
// characters): status codes, exact JSON bodies, and the filters/actor handed
// to the *ForAgent model functions.
const { test, expect, mock, beforeAll, beforeEach, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realAgentToken = require('../models/agent-token');
const realClass = require('../models/class');
const realCharacter = require('../models/character');
const realNavLoader = require('../util/nav-loader');

const VALID_TOKEN = 'ar_pat_valid';
const CLASS_ID = '11111111-1111-4111-8111-111111111111';
const CHARACTER_ID = '22222222-2222-4222-8222-222222222222';
const PROFILE = { id: 'p1', user_id: 'u1', name: 'Agent Owner', role: 'admin', timezone: null, extra: 'hidden' };
const ACTOR = { userId: 'u1', profileId: 'p1', role: 'admin' };

let calls;
let responses;

const record = (name, result) => async (...args) => {
  calls.push([name, ...args]);
  return responses[name] ?? result;
};

mock.module('../models/agent-token', () => ({
  ...realAgentToken,
  verifyAgentToken: async (token) => {
    calls.push(['verifyAgentToken', token]);
    if (token !== VALID_TOKEN) return { data: null, error: new Error('bad token') };
    return {
      data: { userId: 'u1', profile: PROFILE, tokenId: 't1', tokenName: 'Bot', tokenHint: 'alid' },
      error: null
    };
  }
}));
mock.module('../models/class', () => ({
  ...realClass,
  listClassesForAgent: record('listClassesForAgent', { data: [{ id: CLASS_ID, name: 'Knight' }], error: null }),
  getClassForAgent: record('getClassForAgent', { data: { id: CLASS_ID, name: 'Knight' }, error: null })
}));
mock.module('../models/character', () => ({
  ...realCharacter,
  searchCharactersForAgent: record('searchCharactersForAgent', { data: [{ id: CHARACTER_ID, name: 'Ada' }], error: null }),
  getCharacterForAgent: record('getCharacterForAgent', { data: { id: CHARACTER_ID, name: 'Ada' }, error: null })
}));

mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next()
}));

let server;
let baseUrl;
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');

beforeAll(async () => {
  delete require.cache[require.resolve('../routes/agent')];
  delete require.cache[require.resolve('../app')];
  const { createApp } = require('../app');
  ({ server, baseUrl } = await startHttpServer(createApp()));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/agent-token', () => realAgentToken);
  mock.module('../models/class', () => realClass);
  mock.module('../models/character', () => realCharacter);
  mock.module('../util/nav-loader', () => realNavLoader);
  delete require.cache[require.resolve('../routes/agent')];
  delete require.cache[require.resolve('../app')];
});

beforeEach(() => {
  calls = [];
  responses = {};
});

const get = (path, headers = { 'X-Agent-Token': VALID_TOKEN }) => fetch(`${baseUrl}/api/agent${path}`, { headers });
const modelCalls = () => calls.filter(([name]) => name !== 'verifyAgentToken');

test('missing token answers 401 without consulting verifyAgentToken', async () => {
  const res = await get('/me', {});
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'Missing agent token' });
  expect(calls).toEqual([]);
});

test('a bearer token without the agent prefix counts as missing', async () => {
  const res = await get('/me', { Authorization: 'Bearer some-jwt' });
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'Missing agent token' });
});

test('invalid token answers 401', async () => {
  const res = await get('/me', { 'X-Agent-Token': 'ar_pat_wrong' });
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'Invalid agent token' });
  expect(calls).toEqual([['verifyAgentToken', 'ar_pat_wrong']]);
});

test('GET /me returns the user, a whitelisted profile with UTC fallback, and the token summary', async () => {
  const res = await get('/me');
  expect(res.status).toBe(200);
  expect(await res.text()).toBe(JSON.stringify({
    user: { id: 'u1' },
    profile: { id: 'p1', user_id: 'u1', name: 'Agent Owner', role: 'admin', timezone: 'UTC' },
    token: { id: 't1', name: 'Bot', hint: 'alid' }
  }));
});

test('GET /me accepts an ar_pat_ bearer token', async () => {
  const res = await get('/me', { Authorization: `Bearer ${VALID_TOKEN}` });
  expect(res.status).toBe(200);
  expect(calls).toEqual([['verifyAgentToken', VALID_TOKEN]]);
});

test('GET /classes passes through string filters and the actor', async () => {
  const res = await get('/classes?rules_edition=2e&rules_version=1.1&status=published&is_player_created=true');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ classes: [{ id: CLASS_ID, name: 'Knight' }] });
  expect(modelCalls()).toEqual([[
    'listClassesForAgent',
    { rules_edition: '2e', rules_version: '1.1', status: 'published', is_player_created: true },
    ACTOR
  ]]);
});

test.each([
  ['false', false],
  ['garbage', undefined],
  ['TRUE', undefined]
])('GET /classes maps is_player_created=%s to %p', async (raw, expected) => {
  await get(`/classes?is_player_created=${raw}`);
  expect(modelCalls()[0][1].is_player_created).toBe(expected);
});

test('GET /classes with no query passes all-undefined filters', async () => {
  await get('/classes');
  expect(modelCalls()).toEqual([[
    'listClassesForAgent',
    { rules_edition: undefined, rules_version: undefined, status: undefined, is_player_created: undefined },
    ACTOR
  ]]);
});

test('GET /classes surfaces a model error as 500', async () => {
  responses.listClassesForAgent = { data: null, error: new Error('db down') };
  const res = await get('/classes');
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'db down' });
});

test('GET /classes/:id returns the class', async () => {
  const res = await get(`/classes/${CLASS_ID}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ class: { id: CLASS_ID, name: 'Knight' } });
  expect(modelCalls()).toEqual([['getClassForAgent', CLASS_ID, ACTOR]]);
});

test('GET /classes/:id answers 404 when the model finds nothing', async () => {
  responses.getClassForAgent = { data: null, error: null };
  const res = await get(`/classes/${CLASS_ID}`);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'Class not found' });
});

test('GET /classes/:id answers 500 on a model error', async () => {
  responses.getClassForAgent = { data: null, error: new Error('boom') };
  const res = await get(`/classes/${CLASS_ID}`);
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'boom' });
});

test('GET /classes/:id rejects a non-UUID id with plain-text 400', async () => {
  const res = await get('/classes/not-a-uuid');
  expect(res.status).toBe(400);
  expect(await res.text()).toBe('Invalid ID');
  expect(modelCalls()).toEqual([]);
});

test('GET /classes/:id authenticates before validating the id', async () => {
  const res = await get('/classes/not-a-uuid', {});
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'Missing agent token' });
});

test('GET /characters passes q and the actor', async () => {
  const res = await get('/characters?q=ada');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ characters: [{ id: CHARACTER_ID, name: 'Ada' }] });
  expect(modelCalls()).toEqual([['searchCharactersForAgent', 'ada', ACTOR]]);
});

test('GET /characters without q searches with an empty string', async () => {
  await get('/characters');
  expect(modelCalls()).toEqual([['searchCharactersForAgent', '', ACTOR]]);
});

test('GET /characters with a repeated q (array) searches with an empty string', async () => {
  await get('/characters?q=a&q=b');
  expect(modelCalls()).toEqual([['searchCharactersForAgent', '', ACTOR]]);
});

test('GET /characters answers 500 on a model error', async () => {
  responses.searchCharactersForAgent = { data: null, error: new Error('nope') };
  const res = await get('/characters?q=x');
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'nope' });
});

test('GET /characters/:id returns the character', async () => {
  const res = await get(`/characters/${CHARACTER_ID}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ character: { id: CHARACTER_ID, name: 'Ada' } });
  expect(modelCalls()).toEqual([['getCharacterForAgent', CHARACTER_ID, ACTOR]]);
});

test('GET /characters/:id answers 404 when the model finds nothing', async () => {
  responses.getCharacterForAgent = { data: null, error: null };
  const res = await get(`/characters/${CHARACTER_ID}`);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'Character not found' });
});

test('GET /characters/:id rejects a non-UUID id with plain-text 400', async () => {
  const res = await get('/characters/123');
  expect(res.status).toBe(400);
  expect(await res.text()).toBe('Invalid ID');
  expect(modelCalls()).toEqual([]);
});
