// The empty-list guard on getPartyCharacters. It must return early rather
// than issuing .in('id', []) — a query that is both pointless and, on some
// PostgREST versions, malformed. The stub client throws on any use, so the
// test fails loudly if the guard ever stops short-circuiting.
const { test, expect } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const { getPartyCharacters } = require('./character');

const explodingClient = {
  from() { throw new Error('getPartyCharacters must not query for an empty id list'); }
};

test('an empty id list resolves to an empty party without querying', async () => {
  const { data, error } = await getPartyCharacters([], explodingClient);
  expect(data).toEqual([]);
  expect(error).toBeNull();
});

test('a missing or non-array id list is treated as an empty party', async () => {
  for (const input of [null, undefined, 'not-an-array']) {
    const { data, error } = await getPartyCharacters(input, explodingClient);
    expect(data).toEqual([]);
    expect(error).toBeNull();
  }
});
