const { test, expect } = require('bun:test');
const { RulesService } = require('./service');
const { AuthorizationError } = require('../../util/errors');

const makeRepo = () => {
  const calls = [];
  return {
    calls,
    insertUnlockCodes: async rows => { calls.push(['insertUnlockCodes', rows]); return { data: rows, error: null }; }
  };
};

const ADMIN_ACTOR = { profileId: 'admin-1', role: 'admin' };
const SYSTEM_ACTOR = { role: 'system' };
const USER_ACTOR = { profileId: 'p1', role: 'user' };

test('constructor requires every repository method', () => {
  expect(() => new RulesService({})).toThrow(TypeError);
});

test('an admin may mint unlock codes', async () => {
  const repo = makeRepo();
  const service = new RulesService(repo);
  await service.mintUnlockCodes(ADMIN_ACTOR, [{ code: 'abc' }]);
  expect(repo.calls).toEqual([['insertUnlockCodes', [{ code: 'abc' }]]]);
});

test('the system actor may mint unlock codes', async () => {
  const repo = makeRepo();
  const service = new RulesService(repo);
  await service.mintUnlockCodes(SYSTEM_ACTOR, [{ code: 'abc' }]);
  expect(repo.calls).toEqual([['insertUnlockCodes', [{ code: 'abc' }]]]);
});

test('a non-admin minting unlock codes throws AuthorizationError, never reaching the repository', async () => {
  const repo = makeRepo();
  const service = new RulesService(repo);
  await expect(service.mintUnlockCodes(USER_ACTOR, [{ code: 'abc' }])).rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([]);
});
