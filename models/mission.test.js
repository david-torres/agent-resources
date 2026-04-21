const { test, expect, mock, afterAll } = require('bun:test');
const realBase = require('./_base');

const makeSpyClient = (tableToRows = {}) => {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const rows = tableToRows[table] ?? [];
      const result = { data: rows, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (onF, onR) => Promise.resolve(result).then(onF, onR)
      };
      return chain;
    }
  };
};

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
