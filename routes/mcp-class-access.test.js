// The MCP getClass tool must not be a way around the class teaser gate. Only
// the repositories under models/class are faked, so the real agent serializer
// decides what a non-owner without an unlock gets to see.
const { test, expect, mock, beforeAll, beforeEach, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realAgentToken = require('../models/agent-token');
const realNavLoader = require('../util/nav-loader');
const realClassRepo = require('../services/class/repository');
const realRulesRepo = require('../services/rules/repository');

const VALID_TOKEN = 'ar_pat_valid_secret_value';
const CLASS_ID = '33333333-3333-4333-8333-333333333333';
const PROFILE = { id: 'p-player', user_id: 'u-player', name: 'Player', role: 'player', timezone: 'UTC' };

const CLASS_ROW = {
  id: CLASS_ID,
  name: 'Warden',
  teaser: 'Guards the threshold.',
  status: 'release',
  is_public: true,
  is_player_created: false,
  rules_edition: 'advent',
  rules_version: '1.0',
  created_by: 'p-someone-else',
  description: 'Full secret description of the Warden.',
  overview: 'Paid overview prose.',
  abilities: [{ name: 'Hold the Line' }],
  gear: [{ name: 'Tower Shield' }]
};

let classRow;
let unlockRows;

mock.module('../models/agent-token', () => ({
  ...realAgentToken,
  verifyAgentToken: async (token) => {
    if (token !== VALID_TOKEN) return { data: null, error: new Error('bad token') };
    return {
      data: { userId: 'u-player', profile: PROFILE, tokenId: 't1', tokenName: 'Bot', tokenHint: 'alue' },
      error: null
    };
  }
}));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next()
}));
mock.module('../services/class/repository', () => ({
  ...realClassRepo,
  fetchClassByIdAdmin: async (id) => (id === CLASS_ID
    ? { data: classRow, error: null }
    : { data: null, error: null }),
  unlockedClassIdRows: async () => ({ data: unlockRows, error: null }),
  fetchClassFamilyRows: async () => [{
    id: CLASS_ID,
    base_class_id: null,
    rules_edition: 'advent',
    free_play_access: false
  }]
}));
mock.module('../services/rules/repository', () => ({
  ...realRulesRepo,
  fetchActiveBooksForUser: async () => ({ data: [], error: null })
}));

const forget = (path) => {
  try {
    delete require.cache[require.resolve(path)];
  } catch {
    // Not every module exists yet; nothing cached to forget.
  }
};
const forgetAll = () => [
  '../models/class',
  '../services/agent/service',
  '../routes/agent',
  '../routes/mcp',
  '../app'
].forEach(forget);

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
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../services/class/repository', () => realClassRepo);
  mock.module('../services/rules/repository', () => realRulesRepo);
  forgetAll();
});

beforeEach(() => {
  classRow = { ...CLASS_ROW };
  unlockRows = [];
});

const getClass = async () => {
  const res = await fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${VALID_TOKEN}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'getClass', arguments: { id: CLASS_ID } }
    })
  });
  expect(res.status).toBe(200);
  const text = await res.text();
  const { result } = JSON.parse(text);
  expect(result.isError).toBeFalsy();
  return { text, cls: result.structuredContent.class };
};

test('a locked release class is served teaser-only to a non-owner without an unlock', async () => {
  const { text, cls } = await getClass();
  expect(cls.access_level).toBe('teaser_only');
  expect(cls.unlocked).toBe(false);
  expect(cls.teaser).toBe('Guards the threshold.');
  expect(cls).not.toHaveProperty('description');
  expect(cls).not.toHaveProperty('overview');
  expect(cls).not.toHaveProperty('abilities');
  expect(cls).not.toHaveProperty('signature_gear');
  expect(text).not.toContain('Paid overview prose.');
  expect(text).not.toContain('Hold the Line');
  expect(text).not.toContain('Tower Shield');
});

test('an unlocked release class is served in full', async () => {
  unlockRows = [{ class_id: CLASS_ID }];
  const { cls } = await getClass();
  expect(cls.access_level).toBe('full');
  expect(cls.unlocked).toBe(true);
  expect(cls.overview).toBe('Paid overview prose.');
  expect(cls.abilities).toEqual([{ name: 'Hold the Line' }]);
  expect(cls.signature_gear).toEqual([{ name: 'Tower Shield' }]);
});

test('the owner of a release class gets it in full without an unlock', async () => {
  classRow = { ...CLASS_ROW, created_by: PROFILE.id };
  const { cls } = await getClass();
  expect(cls.access_level).toBe('full');
  expect(cls.unlocked).toBe(false);
  expect(cls.abilities).toEqual([{ name: 'Hold the Line' }]);
  expect(cls.signature_gear).toEqual([{ name: 'Tower Shield' }]);
});
