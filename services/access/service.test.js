const { test, expect } = require('bun:test');
const { getEditionAccess } = require('./service');

const NOW = new Date('2026-09-28T12:00:00Z');

test('resolves the grants the repository returns for the user', async () => {
  const calls = [];
  const access = await getEditionAccess('u1', NOW, {}, {
    fetchCoreBookGrantsForUser: async (args) => {
      calls.push(args);
      return { data: [{ rules_edition: 'advent', expires_at: '2026-10-08T12:00:00Z' }], error: null };
    }
  });

  expect(calls).toEqual([{ userId: 'u1' }]);
  expect(access.advent).toMatchObject({ state: 'trial', daysLeft: 10, urgent: false });
  expect(access.aspirant).toEqual({ state: 'none' });
});

test('passes the viewer timezone through to endsToday', async () => {
  const access = await getEditionAccess('u1', new Date('2026-09-30T20:00:00Z'), { timeZone: 'America/New_York' }, {
    fetchCoreBookGrantsForUser: async () => ({
      data: [{ rules_edition: 'advent', expires_at: '2026-10-01T02:00:00Z' }], error: null
    })
  });
  expect(access.advent.endsToday).toBe(true);
});

test('a repository error is null, never a confident "none"', async () => {
  const access = await getEditionAccess('u1', NOW, {}, {
    fetchCoreBookGrantsForUser: async () => ({ data: null, error: { message: 'boom' } })
  });
  expect(access).toBeNull();
});

test('a throwing repository is null', async () => {
  const access = await getEditionAccess('u1', NOW, {}, {
    fetchCoreBookGrantsForUser: async () => { throw new Error('down'); }
  });
  expect(access).toBeNull();
});
