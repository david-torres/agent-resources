const { test, expect, mock, beforeEach, afterAll } = require('bun:test');

const realClass = require('../../models/class');
const realCharacter = require('../../models/character');

let calls;
const RESULT = { data: { id: 'row' }, error: null };
const record = (name) => async (...args) => {
  calls.push([name, ...args]);
  return RESULT;
};

mock.module('../../models/class', () => ({
  ...realClass,
  listClassesForAgent: record('listClassesForAgent'),
  getClassForAgent: record('getClassForAgent')
}));
mock.module('../../models/character', () => ({
  ...realCharacter,
  searchCharactersForAgent: record('searchCharactersForAgent'),
  getCharacterForAgent: record('getCharacterForAgent')
}));

delete require.cache[require.resolve('./service')];
const service = require('./service');

afterAll(() => {
  mock.module('../../models/class', () => realClass);
  mock.module('../../models/character', () => realCharacter);
  delete require.cache[require.resolve('./service')];
});

beforeEach(() => { calls = []; });

const ACTOR = { userId: 'u1', profileId: 'p1', role: 'admin' };

test('actorFromAuth keeps the profile\'s real role', () => {
  expect(service.actorFromAuth({ user: { id: 'u1' }, profile: { id: 'p1', role: 'admin' } })).toEqual(ACTOR);
});

test('actorFromAuth nulls every field it cannot find', () => {
  expect(service.actorFromAuth({})).toEqual({ userId: null, profileId: null, role: null });
  expect(service.actorFromAuth()).toEqual({ userId: null, profileId: null, role: null });
});

test('buildMe whitelists profile fields and defaults the timezone to UTC', () => {
  const me = service.buildMe({
    user: { id: 'u1', email: 'x@y' },
    profile: { id: 'p1', user_id: 'u1', name: 'N', role: 'user', timezone: '', secret: 's' },
    agentToken: { id: 't1', name: 'Bot', hint: 'abcd' }
  });
  expect(me).toEqual({
    user: { id: 'u1' },
    profile: { id: 'p1', user_id: 'u1', name: 'N', role: 'user', timezone: 'UTC' },
    token: { id: 't1', name: 'Bot', hint: 'abcd' }
  });
});

test('buildMe keeps a set timezone', () => {
  const me = service.buildMe({ user: { id: 'u1' }, profile: { id: 'p1', timezone: 'Europe/Paris' }, agentToken: null });
  expect(me.profile.timezone).toBe('Europe/Paris');
});

test('listClasses picks the known filters and returns the model result', async () => {
  const result = await service.listClasses({
    rules_edition: '2e', rules_version: '1', status: 'published', is_player_created: 'false', other: 'dropped'
  }, ACTOR);
  expect(result).toBe(RESULT);
  expect(calls).toEqual([[
    'listClassesForAgent',
    { rules_edition: '2e', rules_version: '1', status: 'published', is_player_created: false },
    ACTOR
  ]]);
});

test.each([
  ['true', true],
  ['false', false],
  [true, true],
  [false, false],
  ['yes', undefined],
  [undefined, undefined]
])('listClasses parses is_player_created %p as %p', async (raw, expected) => {
  await service.listClasses({ is_player_created: raw }, ACTOR);
  expect(calls[0][1].is_player_created).toBe(expected);
});

test('listClasses tolerates missing filters', async () => {
  await service.listClasses(undefined, ACTOR);
  expect(calls[0][1]).toEqual({
    rules_edition: undefined, rules_version: undefined, status: undefined, is_player_created: undefined
  });
});

test('getClass delegates id and actor', async () => {
  expect(await service.getClass('c1', ACTOR)).toBe(RESULT);
  expect(calls).toEqual([['getClassForAgent', 'c1', ACTOR]]);
});

test.each([
  ['ada', 'ada'],
  [undefined, ''],
  [['a', 'b'], ''],
  [{ x: 1 }, '']
])('searchCharacters coerces q %p to %p', async (q, expected) => {
  expect(await service.searchCharacters(q, ACTOR)).toBe(RESULT);
  expect(calls).toEqual([['searchCharactersForAgent', expected, ACTOR]]);
});

test('getCharacter delegates id and actor', async () => {
  expect(await service.getCharacter('ch1', ACTOR)).toBe(RESULT);
  expect(calls).toEqual([['getCharacterForAgent', 'ch1', ACTOR]]);
});
