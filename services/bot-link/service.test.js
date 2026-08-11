const { test, expect } = require('bun:test');
const { BotLinkService } = require('./service');

const REQUIRED_REPO_METHODS = [
  'deleteStaleLinks',
  'countRecentPending',
  'insertPendingLink',
  'fetchPendingByCode',
  'attachToken',
  'consumePending',
  'stashRawToken',
  'fetchRawToken',
  'deleteRawToken'
];

const makeRepo = (overrides = {}) => {
  const calls = [];
  const base = {
    deleteStaleLinks: async (olderThanIso) => { calls.push(['deleteStaleLinks', olderThanIso]); return { error: null }; },
    countRecentPending: async (discordUserId, sinceIso) => { calls.push(['countRecentPending', discordUserId, sinceIso]); return { count: 0, error: null }; },
    insertPendingLink: async (row) => { calls.push(['insertPendingLink', row]); return { data: { code: row.code, discord_user_id: row.discord_user_id, expires_at: row.expires_at }, error: null }; },
    fetchPendingByCode: async (code) => { calls.push(['fetchPendingByCode', code]); return { data: null, error: null }; },
    attachToken: async ({ code, agentTokenId }) => { calls.push(['attachToken', code, agentTokenId]); return { data: { code }, error: null }; },
    consumePending: async ({ code, discordUserId }) => { calls.push(['consumePending', code, discordUserId]); return { data: { code, agent_token_id: 'token-1' }, error: null }; },
    stashRawToken: async ({ agentTokenId, rawToken }) => { calls.push(['stashRawToken', agentTokenId, rawToken]); return { data: {}, error: null }; },
    fetchRawToken: async (agentTokenId) => { calls.push(['fetchRawToken', agentTokenId]); return { data: { raw_token: 'ar_pat_secret' }, error: null }; },
    deleteRawToken: async (agentTokenId) => { calls.push(['deleteRawToken', agentTokenId]); return { error: null }; }
  };
  return { calls, ...base, ...overrides };
};

const makeCreateAgentToken = (overrides) => overrides || (async (actor, { name }) => ({
  data: { id: 'token-1', token: 'ar_pat_secret', name },
  error: null
}));

test('constructor requires every repository method', () => {
  expect(() => new BotLinkService({}, makeCreateAgentToken())).toThrow();
  for (const method of REQUIRED_REPO_METHODS) {
    const repo = makeRepo();
    delete repo[method];
    expect(() => new BotLinkService(repo, makeCreateAgentToken())).toThrow();
  }
});

test('constructor requires a createAgentToken function', () => {
  expect(() => new BotLinkService(makeRepo(), null)).toThrow();
});

// --- startLink -------------------------------------------------------------

test('startLink rejects an invalid discord_user_id without touching the repo', async () => {
  const repo = makeRepo();
  const service = new BotLinkService(repo, makeCreateAgentToken());
  const { data, error } = await service.startLink({ discordUserId: 'not-a-snowflake' });
  expect(data).toBe(null);
  expect(error).toBeInstanceOf(Error);
  expect(repo.calls).toEqual([]);
});

test('startLink rate-limits after the max pending count for a discord_user_id', async () => {
  const repo = makeRepo({ countRecentPending: async () => ({ count: 3, error: null }) });
  const service = new BotLinkService(repo, makeCreateAgentToken());
  const { data, error } = await service.startLink({ discordUserId: '123456789012345678' });
  expect(data).toBe(null);
  expect(error.message).toBe('Too many pending codes');
});

test('startLink cleans up stale links then inserts a fresh pending link', async () => {
  const repo = makeRepo();
  const service = new BotLinkService(repo, makeCreateAgentToken());
  const { data, error } = await service.startLink({ discordUserId: '123456789012345678' });
  expect(error).toBe(null);
  expect(data.discord_user_id).toBe('123456789012345678');
  expect(repo.calls[0][0]).toBe('deleteStaleLinks');
  expect(repo.calls[1][0]).toBe('countRecentPending');
  expect(repo.calls[2][0]).toBe('insertPendingLink');
});

test('startLink retries code generation on a unique-constraint collision', async () => {
  let attempts = 0;
  const repo = makeRepo({
    insertPendingLink: async (row) => {
      attempts += 1;
      if (attempts < 2) return { data: null, error: { code: '23505' } };
      return { data: { code: row.code, discord_user_id: row.discord_user_id, expires_at: row.expires_at }, error: null };
    }
  });
  const service = new BotLinkService(repo, makeCreateAgentToken());
  const { data, error } = await service.startLink({ discordUserId: '123456789012345678' });
  expect(error).toBe(null);
  expect(data).toBeTruthy();
  expect(attempts).toBe(2);
});

// --- claimLink ---------------------------------------------------------

test('claimLink returns not_found when no link matches the code', async () => {
  const repo = makeRepo({ fetchPendingByCode: async () => ({ data: null, error: null }) });
  const service = new BotLinkService(repo, makeCreateAgentToken());
  const { data, error } = await service.claimLink({ code: 'ABCD1234', discordUserId: 'd1' });
  expect(data).toBe(null);
  expect(error).toBe('not_found');
});

test('claimLink returns expired for a consumed link', async () => {
  const repo = makeRepo({
    fetchPendingByCode: async () => ({
      data: { code: 'ABCD1234', discord_user_id: 'd1', agent_token_id: 'token-1', consumed_at: '2020-01-01T00:00:00.000Z', expires_at: '2999-01-01T00:00:00.000Z' },
      error: null
    })
  });
  const service = new BotLinkService(repo, makeCreateAgentToken());
  const { error } = await service.claimLink({ code: 'ABCD1234', discordUserId: 'd1' });
  expect(error).toBe('expired');
});

test('claimLink returns expired for a link past its expires_at', async () => {
  const repo = makeRepo({
    fetchPendingByCode: async () => ({
      data: { code: 'ABCD1234', discord_user_id: 'd1', agent_token_id: 'token-1', consumed_at: null, expires_at: '2000-01-01T00:00:00.000Z' },
      error: null
    })
  });
  const service = new BotLinkService(repo, makeCreateAgentToken());
  const { error } = await service.claimLink({ code: 'ABCD1234', discordUserId: 'd1' });
  expect(error).toBe('expired');
});

test('claimLink returns mismatch when the discord_user_id does not match (possession check)', async () => {
  const repo = makeRepo({
    fetchPendingByCode: async () => ({
      data: { code: 'ABCD1234', discord_user_id: 'd1', agent_token_id: 'token-1', consumed_at: null, expires_at: '2999-01-01T00:00:00.000Z' },
      error: null
    })
  });
  const service = new BotLinkService(repo, makeCreateAgentToken());
  const { error } = await service.claimLink({ code: 'ABCD1234', discordUserId: 'someone-else' });
  expect(error).toBe('mismatch');
  expect(repo.calls.some(c => c[0] === 'consumePending')).toBe(false);
});

test('claimLink returns pending when no token has been attached yet', async () => {
  const repo = makeRepo({
    fetchPendingByCode: async () => ({
      data: { code: 'ABCD1234', discord_user_id: 'd1', agent_token_id: null, consumed_at: null, expires_at: '2999-01-01T00:00:00.000Z' },
      error: null
    })
  });
  const service = new BotLinkService(repo, makeCreateAgentToken());
  const { error } = await service.claimLink({ code: 'ABCD1234', discordUserId: 'd1' });
  expect(error).toBe('pending');
});

test('claimLink consumes the link and discloses+purges the raw token on a valid possession match', async () => {
  const repo = makeRepo({
    fetchPendingByCode: async () => ({
      data: { code: 'ABCD1234', discord_user_id: 'd1', agent_token_id: 'token-1', consumed_at: null, expires_at: '2999-01-01T00:00:00.000Z' },
      error: null
    })
  });
  const service = new BotLinkService(repo, makeCreateAgentToken());
  const { data, error } = await service.claimLink({ code: 'ABCD1234', discordUserId: 'd1' });
  expect(error).toBe(null);
  expect(data).toEqual({ agentTokenId: 'token-1', rawToken: 'ar_pat_secret' });
  expect(repo.calls.some(c => c[0] === 'consumePending')).toBe(true);
  expect(repo.calls.some(c => c[0] === 'fetchRawToken')).toBe(true);
  expect(repo.calls.some(c => c[0] === 'deleteRawToken')).toBe(true);
});

test('claimLink surfaces an internal error if the raw token stash is missing', async () => {
  const repo = makeRepo({
    fetchPendingByCode: async () => ({
      data: { code: 'ABCD1234', discord_user_id: 'd1', agent_token_id: 'token-1', consumed_at: null, expires_at: '2999-01-01T00:00:00.000Z' },
      error: null
    }),
    fetchRawToken: async () => ({ data: null, error: null })
  });
  const service = new BotLinkService(repo, makeCreateAgentToken());
  const { data, error } = await service.claimLink({ code: 'ABCD1234', discordUserId: 'd1' });
  expect(data).toBe(null);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe('Token stash missing');
});

// --- confirmLink ---------------------------------------------------------

test('confirmLink returns not_found when the code does not resolve to a link', async () => {
  const repo = makeRepo({ fetchPendingByCode: async () => ({ data: null, error: null }) });
  const service = new BotLinkService(repo, makeCreateAgentToken());
  const actor = { userId: 'u1', profileId: 'p1', role: 'user' };
  const { data, error } = await service.confirmLink(actor, { code: 'ABCD1234' });
  expect(data).toBe(null);
  expect(error).toBe('not_found');
});

test('confirmLink returns expired for an expired link', async () => {
  const repo = makeRepo({
    fetchPendingByCode: async () => ({
      data: { code: 'ABCD1234', discord_user_id: 'd1', agent_token_id: null, consumed_at: null, expires_at: '2000-01-01T00:00:00.000Z' },
      error: null
    })
  });
  const service = new BotLinkService(repo, makeCreateAgentToken());
  const actor = { userId: 'u1', profileId: 'p1', role: 'user' };
  const { error } = await service.confirmLink(actor, { code: 'ABCD1234' });
  expect(error).toBe('expired');
});

test('confirmLink short-circuits to already-linked success if a token is already attached', async () => {
  const repo = makeRepo({
    fetchPendingByCode: async () => ({
      data: { code: 'ABCD1234', discord_user_id: 'd1', agent_token_id: 'token-existing', consumed_at: null, expires_at: '2999-01-01T00:00:00.000Z' },
      error: null
    })
  });
  const service = new BotLinkService(repo, makeCreateAgentToken());
  const actor = { userId: 'u1', profileId: 'p1', role: 'user' };
  const { data, error } = await service.confirmLink(actor, { code: 'ABCD1234' });
  expect(error).toBe(null);
  expect(data.alreadyLinked).toBe(true);
  expect(repo.calls.some(c => c[0] === 'attachToken')).toBe(false);
});

test('confirmLink throws AuthorizationError for an actor with no profile (unconfirmed user)', async () => {
  const repo = makeRepo({
    fetchPendingByCode: async () => ({
      data: { code: 'ABCD1234', discord_user_id: 'd1', agent_token_id: null, consumed_at: null, expires_at: '2999-01-01T00:00:00.000Z' },
      error: null
    })
  });
  const service = new BotLinkService(repo, makeCreateAgentToken());
  const actor = { userId: 'u1', profileId: null, role: null };
  await expect(service.confirmLink(actor, { code: 'ABCD1234' })).rejects.toThrow();
  expect(repo.calls.some(c => c[0] === 'stashRawToken')).toBe(false);
});

test('confirmLink creates a token, stashes the raw token, and attaches it for an authenticated actor', async () => {
  const repo = makeRepo({
    fetchPendingByCode: async () => ({
      data: { code: 'ABCD1234', discord_user_id: 'd1', agent_token_id: null, consumed_at: null, expires_at: '2999-01-01T00:00:00.000Z' },
      error: null
    })
  });
  let createTokenArgs = null;
  const createAgentToken = async (actor, opts) => {
    createTokenArgs = [actor, opts];
    return { data: { id: 'token-new', token: 'ar_pat_freshsecret', name: opts.name }, error: null };
  };
  const service = new BotLinkService(repo, createAgentToken);
  const actor = { userId: 'u1', profileId: 'p1', role: 'user' };
  const { data, error } = await service.confirmLink(actor, { code: 'ABCD1234' });
  expect(error).toBe(null);
  expect(data.linked).toBe(true);
  expect(createTokenArgs[1].name).toBe('Discord bot (d1)');
  expect(repo.calls.some(c => c[0] === 'stashRawToken' && c[1] === 'token-new' && c[2] === 'ar_pat_freshsecret')).toBe(true);
  expect(repo.calls.some(c => c[0] === 'attachToken' && c[1] === 'ABCD1234' && c[2] === 'token-new')).toBe(true);
});

test('confirmLink returns a protocol error if token creation fails', async () => {
  const repo = makeRepo({
    fetchPendingByCode: async () => ({
      data: { code: 'ABCD1234', discord_user_id: 'd1', agent_token_id: null, consumed_at: null, expires_at: '2999-01-01T00:00:00.000Z' },
      error: null
    })
  });
  const createAgentToken = async () => ({ data: null, error: new Error('boom') });
  const service = new BotLinkService(repo, createAgentToken);
  const actor = { userId: 'u1', profileId: 'p1', role: 'user' };
  const { data, error } = await service.confirmLink(actor, { code: 'ABCD1234' });
  expect(data).toBe(null);
  expect(error).toBe('token_create_failed');
});
