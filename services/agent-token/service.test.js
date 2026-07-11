const { test, expect } = require('bun:test');
const { AgentTokenService, AGENT_TOKEN_PREFIX } = require('./service');
const { AuthorizationError } = require('../../util/errors');

const TOKEN_ROW = { id: 'token-1', name: 'Bot', token_hint: 'abcd', created_at: 't', last_used_at: null, revoked_at: null };

const makeRepo = ({ hashLookupRow } = {}) => {
  const calls = [];
  return {
    calls,
    insertToken: async (row) => { calls.push(['insertToken', row]); return { data: { ...TOKEN_ROW }, error: null }; },
    listTokens: async (opts) => { calls.push(['listTokens', opts]); return { data: [TOKEN_ROW], error: null }; },
    revokeToken: async (opts) => { calls.push(['revokeToken', opts]); return { data: TOKEN_ROW, error: null }; },
    findTokenByHash: async (hash) => {
      calls.push(['findTokenByHash', hash]);
      return { data: hashLookupRow !== undefined ? hashLookupRow : {
        id: 'token-1', user_id: 'u1', profile_id: 'p1', name: 'Bot', token_hint: 'abcd', revoked_at: null,
        profile: { id: 'p1', user_id: 'u1', name: 'Bot Profile', role: 'user', timezone: 'UTC' }
      }, error: null };
    },
    touchLastUsed: async (tokenId) => { calls.push(['touchLastUsed', tokenId]); return { error: null }; }
  };
};

const SELF_ACTOR = { userId: 'u1', profileId: 'p1', role: 'user' };
const OTHER_ACTOR = { userId: 'u2', profileId: 'p2', role: 'user' };
const ADMIN_ACTOR = { userId: 'admin-1', profileId: 'admin-profile', role: 'admin' };
const SYSTEM_ACTOR = { role: 'system' };

test('constructor requires every repository method', () => {
  expect(() => new AgentTokenService({})).toThrow(TypeError);
});

test('createToken derives the owner from the actor and inserts a hashed token row', async () => {
  const repo = makeRepo();
  const service = new AgentTokenService(repo);
  const { data, error } = await service.createToken(SELF_ACTOR, { name: '  My Bot  ' });
  expect(error).toBe(null);
  expect(repo.calls).toHaveLength(1);
  const [method, row] = repo.calls[0];
  expect(method).toBe('insertToken');
  expect(row.user_id).toBe('u1');
  expect(row.profile_id).toBe('p1');
  expect(row.name).toBe('My Bot');
  expect(typeof row.token_hash).toBe('string');
  expect(data.token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
});

test('createToken rejects an empty name without reaching the repository', async () => {
  const repo = makeRepo();
  const service = new AgentTokenService(repo);
  const { data, error } = await service.createToken(SELF_ACTOR, { name: '   ' });
  expect(data).toBe(null);
  expect(error.message).toBe('Token name is required');
  expect(repo.calls).toEqual([]);
});

test('createToken throws AuthorizationError when a caller claims a profile that is not their own', async () => {
  const repo = makeRepo();
  const service = new AgentTokenService(repo);
  await expect(service.createToken(OTHER_ACTOR, { name: 'Bot', profileId: 'p1', userId: 'u1' }))
    .rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([]);
});

test('admin may create a token on behalf of another profile', async () => {
  const repo = makeRepo();
  const service = new AgentTokenService(repo);
  await service.createToken(ADMIN_ACTOR, { name: 'Bot', profileId: 'p1', userId: 'u1' });
  expect(repo.calls[0][1].profile_id).toBe('p1');
});

test('listTokens lists the caller\'s own tokens', async () => {
  const repo = makeRepo();
  const service = new AgentTokenService(repo);
  const { data, error } = await service.listTokens(SELF_ACTOR, { includeRevoked: true });
  expect(error).toBe(null);
  expect(data).toEqual([TOKEN_ROW]);
  expect(repo.calls).toEqual([['listTokens', { userId: 'u1', profileId: 'p1', includeRevoked: true }]]);
});

test('listTokens throws AuthorizationError for a mismatched profile, never reaching the repository', async () => {
  const repo = makeRepo();
  const service = new AgentTokenService(repo);
  await expect(service.listTokens(OTHER_ACTOR, { profileId: 'p1', userId: 'u1' })).rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([]);
});

test('revokeToken revokes the caller\'s own token', async () => {
  const repo = makeRepo();
  const service = new AgentTokenService(repo);
  const { data, error } = await service.revokeToken(SELF_ACTOR, { tokenId: 'token-1' });
  expect(error).toBe(null);
  expect(data).toEqual(TOKEN_ROW);
  expect(repo.calls).toEqual([['revokeToken', { tokenId: 'token-1', userId: 'u1', profileId: 'p1' }]]);
});

test('revoking another profile\'s token throws AuthorizationError, never reaching the repository', async () => {
  const repo = makeRepo();
  const service = new AgentTokenService(repo);
  await expect(service.revokeToken(OTHER_ACTOR, { tokenId: 'token-1', profileId: 'p1', userId: 'u1' }))
    .rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([]);
});

test('the system actor may revoke a token on behalf of any profile', async () => {
  const repo = makeRepo();
  const service = new AgentTokenService(repo);
  await service.revokeToken(SYSTEM_ACTOR, { tokenId: 'token-1', profileId: 'p1', userId: 'u1' });
  expect(repo.calls).toEqual([['revokeToken', { tokenId: 'token-1', userId: 'u1', profileId: 'p1' }]]);
});

test('verifyAgentToken rejects a malformed token before touching the repository', async () => {
  const repo = makeRepo();
  const service = new AgentTokenService(repo);
  const { data, error } = await service.verifyAgentToken('not-a-real-token');
  expect(data).toBe(null);
  expect(error.message).toBe('Invalid token format');
  expect(repo.calls).toEqual([]);
});

test('verifyAgentToken looks up the hash, touches last_used_at, and returns the actor-shaped payload', async () => {
  const repo = makeRepo();
  const service = new AgentTokenService(repo);
  const token = `${AGENT_TOKEN_PREFIX}abcdef`;
  const { data, error } = await service.verifyAgentToken(token);
  expect(error).toBe(null);
  expect(data).toEqual({
    tokenId: 'token-1',
    tokenName: 'Bot',
    tokenHint: 'abcd',
    userId: 'u1',
    profile: { id: 'p1', user_id: 'u1', name: 'Bot Profile', role: 'user', timezone: 'UTC' }
  });
  expect(repo.calls.map(c => c[0])).toEqual(['findTokenByHash', 'touchLastUsed']);
  expect(repo.calls[1][1]).toBe('token-1');
});

test('verifyAgentToken propagates a repository lookup error without touching last_used_at', async () => {
  const repo = makeRepo();
  repo.findTokenByHash = async (hash) => { repo.calls.push(['findTokenByHash', hash]); return { data: null, error: new Error('not found') }; };
  const service = new AgentTokenService(repo);
  const { data, error } = await service.verifyAgentToken(`${AGENT_TOKEN_PREFIX}xyz`);
  expect(data).toBe(null);
  expect(error.message).toBe('not found');
  expect(repo.calls).toEqual([['findTokenByHash', expect.any(String)]]);
});
