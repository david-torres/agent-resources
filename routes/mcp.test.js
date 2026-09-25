// Pins the contract of the stateless Streamable HTTP MCP endpoint at /api/mcp:
// the handshake and tool catalogue (open to anyone), the tool results (exactly
// the REST read bodies), and the error envelope, including that no token,
// SQL text or stack ever leaks into a response.
const { test, expect, mock, beforeAll, beforeEach, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realAgentToken = require('../models/agent-token');
const realClass = require('../models/class');
const realCharacter = require('../models/character');
const realNavLoader = require('../util/nav-loader');

const VALID_TOKEN = 'ar_pat_valid_secret_value';
const INVALID_TOKEN = 'ar_pat_wrong_secret_value';
const CLASS_ID = '11111111-1111-4111-8111-111111111111';
const CHARACTER_ID = '22222222-2222-4222-8222-222222222222';
const PROFILE = { id: 'p1', user_id: 'u1', name: 'Agent Owner', role: 'admin', timezone: 'Europe/London', extra: 'hidden' };
const ACTOR = { userId: 'u1', profileId: 'p1', role: 'admin' };
const SQL_ERROR_TEXT = 'relation "classes" does not exist';

let calls;
let responses;

const record = (name, result) => async (...args) => {
  calls.push([name, ...args]);
  const response = responses[name] ?? result;
  if (response instanceof Error) throw response;
  return response;
};

mock.module('../models/agent-token', () => ({
  ...realAgentToken,
  verifyAgentToken: async (token) => {
    calls.push(['verifyAgentToken', token]);
    if (token !== VALID_TOKEN) return { data: null, error: new Error('bad token') };
    return {
      data: { userId: 'u1', profile: PROFILE, tokenId: 't1', tokenName: 'Bot', tokenHint: 'alue' },
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

const forget = (path) => {
  try {
    delete require.cache[require.resolve(path)];
  } catch {
    // Not every module exists yet; nothing cached to forget.
  }
};
const forgetAll = () => ['../services/agent/service', '../routes/agent', '../routes/mcp', '../app'].forEach(forget);

let server;
let baseUrl;
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');

beforeAll(async () => {
  forgetAll();
  const { createApp } = require('../app');
  ({ server, baseUrl } = await startHttpServer(createApp()));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/agent-token', () => realAgentToken);
  mock.module('../models/class', () => realClass);
  mock.module('../models/character', () => realCharacter);
  mock.module('../util/nav-loader', () => realNavLoader);
  forgetAll();
});

beforeEach(() => {
  calls = [];
  responses = {};
});

let nextId = 1;
const rpc = async (method, params = {}, { token } = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params })
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.status, text, body };
};

const callTool = (name, args = {}, options = { token: VALID_TOKEN }) =>
  rpc('tools/call', { name, arguments: args }, options);

const modelCalls = () => calls.filter(([name]) => name !== 'verifyAgentToken');

const expectSuccess = (response, structured) => {
  expect(response.status).toBe(200);
  const { result } = response.body;
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toEqual(structured);
  expect(result.content[0]).toEqual({ type: 'text', text: JSON.stringify(result.structuredContent) });
};

const toolError = (response) => {
  expect(response.status).toBe(200);
  const { result } = response.body;
  expect(result.isError).toBe(true);
  return JSON.parse(result.content[0].text).error;
};

test('initialize succeeds without a token and advertises tools', async () => {
  const response = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' }
  });
  expect(response.status).toBe(200);
  expect(response.body.result.serverInfo.name).toBe('agent-resources');
  expect(response.body.result.capabilities.tools).toBeDefined();
  expect(calls).toEqual([]);
});

test('tools/list works without a token and lists exactly the five read tools', async () => {
  const response = await rpc('tools/list');
  expect(response.status).toBe(200);
  const tools = response.body.result.tools;
  expect(tools.map(tool => tool.name).sort()).toEqual(
    ['getCharacter', 'getClass', 'getMe', 'listClasses', 'searchCharacters']
  );
  for (const tool of tools) {
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.inputSchema).toBeDefined();
    expect(tool.inputSchema.type).toBe('object');
  }
});

test('getClass and getCharacter input schemas require an id', async () => {
  const { body } = await rpc('tools/list');
  const byName = Object.fromEntries(body.result.tools.map(tool => [tool.name, tool]));
  expect(byName.getClass.inputSchema.required).toEqual(['id']);
  expect(byName.getCharacter.inputSchema.required).toEqual(['id']);
});

test('listClasses input schema has optional string filters and a boolean is_player_created', async () => {
  const { body } = await rpc('tools/list');
  const schema = body.result.tools.find(tool => tool.name === 'listClasses').inputSchema;
  expect(schema.properties.rules_edition.type).toBe('string');
  expect(schema.properties.rules_version.type).toBe('string');
  expect(schema.properties.status.type).toBe('string');
  expect(schema.properties.is_player_created.type).toBe('boolean');
  expect(schema.required ?? []).toEqual([]);
});

test('GET /api/mcp answers 405', async () => {
  const res = await fetch(`${baseUrl}/api/mcp`, { headers: { Accept: 'text/event-stream' } });
  expect(res.status).toBe(405);
});

test('a tool call without a token is unauthenticated', async () => {
  const response = await callTool('getMe', {}, {});
  expect(toolError(response)).toEqual({ code: 'unauthenticated', message: 'Missing agent token' });
  expect(calls).toEqual([]);
});

test('a tool call with a bad token is unauthenticated and never echoes the token', async () => {
  const response = await callTool('getMe', {}, { token: INVALID_TOKEN });
  expect(toolError(response)).toEqual({ code: 'unauthenticated', message: 'Invalid agent token' });
  expect(calls).toEqual([['verifyAgentToken', INVALID_TOKEN]]);
  expect(response.text).not.toContain(INVALID_TOKEN);
});

test('getMe returns the user, whitelisted profile and token summary, and nothing secret', async () => {
  const response = await callTool('getMe');
  expectSuccess(response, {
    user: { id: 'u1' },
    profile: { id: 'p1', user_id: 'u1', name: 'Agent Owner', role: 'admin', timezone: 'Europe/London' },
    token: { id: 't1', name: 'Bot', hint: 'alue' }
  });
  expect(response.text).not.toContain(VALID_TOKEN);
  expect(response.text).not.toContain('hidden');
});

test('listClasses forwards filters with booleans intact and the actor', async () => {
  const response = await callTool('listClasses', {
    rules_edition: '2e',
    rules_version: '1.1',
    status: 'published',
    is_player_created: true
  });
  expectSuccess(response, { classes: [{ id: CLASS_ID, name: 'Knight' }] });
  expect(modelCalls()).toEqual([[
    'listClassesForAgent',
    { rules_edition: '2e', rules_version: '1.1', status: 'published', is_player_created: true },
    ACTOR
  ]]);
});

test('listClasses forwards is_player_created false as false', async () => {
  await callTool('listClasses', { is_player_created: false });
  expect(modelCalls()[0][1].is_player_created).toBe(false);
});

test('listClasses rejects a non-boolean is_player_created', async () => {
  const response = await callTool('listClasses', { is_player_created: 'yes' });
  expect(response.status).toBe(200);
  expect(response.body.result.isError).toBe(true);
  expect(modelCalls()).toEqual([]);
});

test('getClass returns the class and passes the actor', async () => {
  const response = await callTool('getClass', { id: CLASS_ID });
  expectSuccess(response, { class: { id: CLASS_ID, name: 'Knight' } });
  expect(modelCalls()).toEqual([['getClassForAgent', CLASS_ID, ACTOR]]);
});

test('getClass with a malformed UUID is invalid_argument and never reaches the model', async () => {
  const response = await callTool('getClass', { id: 'not-a-uuid' });
  expect(toolError(response).code).toBe('invalid_argument');
  expect(modelCalls()).toEqual([]);
});

test('getClass is not_found when the model finds nothing', async () => {
  responses.getClassForAgent = { data: null, error: null };
  const response = await callTool('getClass', { id: CLASS_ID });
  expect(toolError(response)).toEqual({ code: 'not_found', message: 'Class not found' });
});

test('getClass hides a model error behind a generic internal error', async () => {
  responses.getClassForAgent = { data: null, error: new Error(SQL_ERROR_TEXT) };
  const response = await callTool('getClass', { id: CLASS_ID });
  expect(toolError(response)).toEqual({ code: 'internal', message: 'Internal error' });
  expect(response.text).not.toContain('relation');
  expect(response.text).not.toContain('does not exist');
  expect(response.text).not.toContain('    at ');
});

test('a thrown model error becomes a generic internal error without a stack', async () => {
  responses.listClassesForAgent = new Error(SQL_ERROR_TEXT);
  const response = await callTool('listClasses', {});
  expect(toolError(response)).toEqual({ code: 'internal', message: 'Internal error' });
  expect(response.text).not.toContain('relation');
  expect(response.text).not.toContain('    at ');
});

test('searchCharacters passes q and the actor', async () => {
  const response = await callTool('searchCharacters', { q: 'ada' });
  expectSuccess(response, { characters: [{ id: CHARACTER_ID, name: 'Ada' }] });
  expect(modelCalls()).toEqual([['searchCharactersForAgent', 'ada', ACTOR]]);
});

test('searchCharacters without q searches with an empty string', async () => {
  await callTool('searchCharacters', {});
  expect(modelCalls()).toEqual([['searchCharactersForAgent', '', ACTOR]]);
});

test('searchCharacters hides a model error behind a generic internal error', async () => {
  responses.searchCharactersForAgent = { data: null, error: new Error(SQL_ERROR_TEXT) };
  const response = await callTool('searchCharacters', { q: 'x' });
  expect(toolError(response)).toEqual({ code: 'internal', message: 'Internal error' });
  expect(response.text).not.toContain('relation');
});

test('getCharacter returns the character and passes the actor', async () => {
  const response = await callTool('getCharacter', { id: CHARACTER_ID });
  expectSuccess(response, { character: { id: CHARACTER_ID, name: 'Ada' } });
  expect(modelCalls()).toEqual([['getCharacterForAgent', CHARACTER_ID, ACTOR]]);
});

test('getCharacter with a malformed UUID is invalid_argument and never reaches the model', async () => {
  const response = await callTool('getCharacter', { id: '123' });
  expect(toolError(response).code).toBe('invalid_argument');
  expect(modelCalls()).toEqual([]);
});

test('getCharacter is not_found when the model finds nothing', async () => {
  responses.getCharacterForAgent = { data: null, error: null };
  const response = await callTool('getCharacter', { id: CHARACTER_ID });
  expect(toolError(response)).toEqual({ code: 'not_found', message: 'Character not found' });
});

test('X-Agent-Token is accepted as well as a bearer token', async () => {
  const res = await fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'X-Agent-Token': VALID_TOKEN
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name: 'getMe', arguments: {} } })
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.result.isError).toBeFalsy();
  expect(calls).toEqual([['verifyAgentToken', VALID_TOKEN]]);
});
