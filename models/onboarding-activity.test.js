const { test, expect } = require('bun:test');
const { hasAnyGameActivity } = require('./lfg');
const { countCharactersByCreator } = require('./character');

// Fake that resolves each table's head-count query with a canned count.
const makeCountClient = (countsByTable) => ({
  from(table) {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      then(onFulfilled, onRejected) {
        return Promise.resolve({ count: countsByTable[table] ?? 0, error: null })
          .then(onFulfilled, onRejected);
      }
    };
    return chain;
  }
});

test('hasAnyGameActivity is true for a host with no joins', async () => {
  const client = makeCountClient({ lfg_posts: 2, lfg_join_requests: 0 });
  const { data, error } = await hasAnyGameActivity('p1', client);
  expect(error).toBeNull();
  expect(data).toBe(true);
});

test('hasAnyGameActivity is true for an approved joiner who never hosted', async () => {
  const client = makeCountClient({ lfg_posts: 0, lfg_join_requests: 1 });
  const { data } = await hasAnyGameActivity('p1', client);
  expect(data).toBe(true);
});

test('hasAnyGameActivity is false with neither', async () => {
  const client = makeCountClient({ lfg_posts: 0, lfg_join_requests: 0 });
  const { data } = await hasAnyGameActivity('p1', client);
  expect(data).toBe(false);
});

test('countCharactersByCreator returns the head count', async () => {
  const client = makeCountClient({ characters: 3 });
  const { data, error } = await countCharactersByCreator('p1', client);
  expect(error).toBeNull();
  expect(data).toBe(3);
});
