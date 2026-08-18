const { test, expect } = require('bun:test');
const { ProfileService } = require('./service');
const { AuthorizationError } = require('../../util/errors');

const makeRepo = () => {
  const calls = [];
  return {
    calls,
    fetchOwnProfile: async userId => { calls.push(['fetchOwnProfile', userId]); return { data: null, error: null }; },
    fetchProfileByIdAdmin: async id => { calls.push(['fetchProfileByIdAdmin', id]); return { data: null, error: null }; },
    fetchProfileByNameAdmin: async name => { calls.push(['fetchProfileByNameAdmin', name]); return { data: null, error: null }; },
    searchProfilesAdmin: async pattern => { calls.push(['searchProfilesAdmin', pattern]); return { data: [], error: null }; },
    insertProfile: async row => { calls.push(['insertProfile', row]); return { data: [{ id: 'profile-1', ...row }], error: null }; },
    updateAuthUser: async (userId, attrs) => { calls.push(['updateAuthUser', userId, attrs]); return { error: null }; },
    updateProfileByUserId: async (userId, fields) => { calls.push(['updateProfileByUserId', userId, fields]); return { data: fields, error: null }; },
    updateDiscord: async (userId, discordId, discordEmail) => { calls.push(['updateDiscord', userId, discordId, discordEmail]); return { data: [{ discord_id: discordId }], error: null }; }
  };
};

const SELF_ACTOR = { userId: 'u1', role: 'user' };
const OTHER_ACTOR = { userId: 'u2', role: 'user' };
const ADMIN_ACTOR = { userId: 'admin-1', role: 'admin' };
const SYSTEM_ACTOR = { role: 'system' };

test('constructor requires every repository method', () => {
  expect(() => new ProfileService({})).toThrow(TypeError);
});

test('a user may update their own profile', async () => {
  const repo = makeRepo();
  const service = new ProfileService(repo);
  await service.updateUser(SELF_ACTOR, 'u1', 'new@example.test', '', { name: 'Agent' });
  expect(repo.calls).toEqual([
    ['updateAuthUser', 'u1', { email: 'new@example.test' }],
    ['updateProfileByUserId', 'u1', { name: 'Agent' }]
  ]);
});

test('updateUser skips the auth update when no email/password is given', async () => {
  const repo = makeRepo();
  const service = new ProfileService(repo);
  await service.updateUser(SELF_ACTOR, 'u1', undefined, undefined, { name: 'Agent' });
  expect(repo.calls).toEqual([
    ['updateProfileByUserId', 'u1', { name: 'Agent' }]
  ]);
});

test('a mismatched actor updating another profile throws AuthorizationError, never reaching the repository', async () => {
  const repo = makeRepo();
  const service = new ProfileService(repo);
  await expect(service.updateUser(OTHER_ACTOR, 'u1', 'x@example.test', '', {})).rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([]);
});

test('an admin may update another user\'s profile', async () => {
  const repo = makeRepo();
  const service = new ProfileService(repo);
  await service.updateUser(ADMIN_ACTOR, 'u1', undefined, undefined, { name: 'Agent' });
  expect(repo.calls).toEqual([
    ['updateProfileByUserId', 'u1', { name: 'Agent' }]
  ]);
});

test('a user may sync their own discord id', async () => {
  const repo = makeRepo();
  const service = new ProfileService(repo);
  await service.setDiscordId(SELF_ACTOR, 'u1', 'discord-1', 'd@example.test');
  expect(repo.calls).toEqual([['updateDiscord', 'u1', 'discord-1', 'd@example.test']]);
});

test('a mismatched actor setting another user\'s discord id throws AuthorizationError', async () => {
  const repo = makeRepo();
  const service = new ProfileService(repo);
  await expect(service.setDiscordId(OTHER_ACTOR, 'u1', 'discord-1')).rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([]);
});

test('the system actor may create a profile for a newly-verified user', async () => {
  const repo = makeRepo();
  const service = new ProfileService(repo);
  const { data } = await service.createProfileForUser(SYSTEM_ACTOR, { id: 'u1' });
  expect(repo.calls).toEqual([['insertProfile', { user_id: 'u1', name: 'Agent #u1', role: 'user' }]]);
  expect(data).toEqual([{ id: 'profile-1', user_id: 'u1', name: 'Agent #u1', role: 'user' }]);
});

test('a mismatched actor creating a profile for another user throws AuthorizationError', async () => {
  const repo = makeRepo();
  const service = new ProfileService(repo);
  await expect(service.createProfileForUser(OTHER_ACTOR, { id: 'u1' })).rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([]);
});
