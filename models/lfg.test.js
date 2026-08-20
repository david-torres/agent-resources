const { test, expect, mock, afterAll } = require('bun:test');
const realBase = require('./_base');
const { makeSpyClient } = require('./test-helpers');

const defaultAnon = makeSpyClient();
mock.module('./_base', () => ({
  supabase: defaultAnon,
  supabaseAdmin: makeSpyClient(),
  anonKey: 'x',
  createUserClient: () => defaultAnon
}));

delete require.cache[require.resolve('./lfg')];
const {
  fetchProfileById,
  getLfgPosts,
  getLfgPostsByOthers,
  getLfgPostsByCreator,
  getLfgPost,
  getLfgJoinRequests,
  getLfgJoinRequestForUserAndPost,
  getLfgJoinedPosts,
  getPendingJoinRequestCount
} = require('./lfg');

afterAll(() => {
  mock.module('./_base', () => realBase);
  delete require.cache[require.resolve('./lfg')];
});

test('fetchProfileById uses the passed client', async () => {
  const userClient = makeSpyClient({ profiles: [{ id: 'p1', name: 'Test' }] });
  defaultAnon.calls.length = 0;
  const { profile } = await fetchProfileById('p1', userClient);
  expect(userClient.calls).toContain('profiles');
  expect(defaultAnon.calls).not.toContain('profiles');
  expect(profile?.name).toBe('Test');
});

test('getLfgPosts uses the passed client for posts, profile and join-request reads', async () => {
  const userClient = makeSpyClient({
    lfg_posts: [{ id: 'l1', creator_id: 'c1', host_id: 'h1' }],
    profiles: [{ id: 'c1', name: 'Creator', is_public: true }],
    lfg_join_requests: []
  });
  defaultAnon.calls.length = 0;
  const { data } = await getLfgPosts(userClient);
  expect(userClient.calls).toContain('lfg_posts');
  expect(userClient.calls).toContain('profiles');
  expect(userClient.calls).toContain('lfg_join_requests');
  expect(defaultAnon.calls).not.toContain('lfg_posts');
  expect(defaultAnon.calls).not.toContain('profiles');
  expect(defaultAnon.calls).not.toContain('lfg_join_requests');
  expect(Array.isArray(data)).toBe(true);
});

test('getLfgPostsByOthers uses the passed client', async () => {
  const userClient = makeSpyClient({
    lfg_posts: [{ id: 'l1', creator_id: 'c1', host_id: 'h1' }],
    profiles: [{ id: 'c1', name: 'Creator' }],
    lfg_join_requests: []
  });
  defaultAnon.calls.length = 0;
  await getLfgPostsByOthers('p1', userClient);
  expect(userClient.calls).toContain('lfg_posts');
  expect(userClient.calls).toContain('profiles');
  expect(userClient.calls).toContain('lfg_join_requests');
  expect(defaultAnon.calls).not.toContain('lfg_posts');
  expect(defaultAnon.calls).not.toContain('profiles');
  expect(defaultAnon.calls).not.toContain('lfg_join_requests');
});

test('getLfgPostsByCreator uses the passed client', async () => {
  const userClient = makeSpyClient({
    lfg_posts: [{ id: 'l1', creator_id: 'c1', host_id: 'h1' }],
    profiles: [{ id: 'c1', name: 'Creator' }],
    lfg_join_requests: []
  });
  defaultAnon.calls.length = 0;
  await getLfgPostsByCreator('c1', userClient);
  expect(userClient.calls).toContain('lfg_posts');
  expect(userClient.calls).toContain('profiles');
  expect(userClient.calls).toContain('lfg_join_requests');
  expect(defaultAnon.calls).not.toContain('lfg_posts');
  expect(defaultAnon.calls).not.toContain('profiles');
  expect(defaultAnon.calls).not.toContain('lfg_join_requests');
});

test('getLfgPost uses the passed client for post, host profile and join-request reads', async () => {
  const userClient = makeSpyClient({
    lfg_posts: [{ id: 'l1', creator_id: 'c1', host_id: 'h1', title: 'Test post' }],
    profiles: [{ id: 'c1', name: 'Creator' }],
    lfg_join_requests: []
  });
  defaultAnon.calls.length = 0;
  const { data } = await getLfgPost('l1', userClient);
  expect(userClient.calls).toContain('lfg_posts');
  expect(userClient.calls).toContain('profiles');
  expect(userClient.calls).toContain('lfg_join_requests');
  expect(defaultAnon.calls).not.toContain('lfg_posts');
  expect(defaultAnon.calls).not.toContain('profiles');
  expect(defaultAnon.calls).not.toContain('lfg_join_requests');
  expect(data?.id).toBe('l1');
});

test('getLfgJoinRequests uses the passed client', async () => {
  const userClient = makeSpyClient({ lfg_join_requests: [{ id: 'jr1' }] });
  defaultAnon.calls.length = 0;
  const { data } = await getLfgJoinRequests('l1', userClient);
  expect(userClient.calls).toContain('lfg_join_requests');
  expect(defaultAnon.calls).not.toContain('lfg_join_requests');
  expect(data.length).toBe(1);
});

test('getLfgJoinRequestForUserAndPost uses the passed client', async () => {
  const userClient = makeSpyClient({ lfg_join_requests: [{ id: 'jr1' }] });
  defaultAnon.calls.length = 0;
  await getLfgJoinRequestForUserAndPost('p1', 'l1', userClient);
  expect(userClient.calls).toContain('lfg_join_requests');
  expect(defaultAnon.calls).not.toContain('lfg_join_requests');
});

test('getLfgJoinedPosts uses the passed client for join requests, profiles and nested join requests', async () => {
  const userClient = makeSpyClient({
    lfg_join_requests: [{
      id: 'jr1',
      lfg_posts: { id: 'l1', creator_id: 'c1', host_id: 'h1' }
    }],
    profiles: [{ id: 'c1', name: 'Creator' }]
  });
  defaultAnon.calls.length = 0;
  await getLfgJoinedPosts('p1', userClient);
  expect(userClient.calls).toContain('lfg_join_requests');
  expect(userClient.calls).toContain('profiles');
  expect(defaultAnon.calls).not.toContain('lfg_join_requests');
  expect(defaultAnon.calls).not.toContain('profiles');
});

test('getPendingJoinRequestCount uses the passed client', async () => {
  const userClient = makeSpyClient({ lfg_join_requests: [{ id: 'jr1' }] });
  defaultAnon.calls.length = 0;
  const { count } = await getPendingJoinRequestCount('p1', userClient);
  expect(userClient.calls).toContain('lfg_join_requests');
  expect(defaultAnon.calls).not.toContain('lfg_join_requests');
  expect(count).toBe(1);
});

test('getLfgJoinRequests falls back to default anon client when no client passed', async () => {
  defaultAnon.calls.length = 0;
  await getLfgJoinRequests('l1');
  expect(defaultAnon.calls).toContain('lfg_join_requests');
});

test('joinLfgPost uses the passed client to read the character', async () => {
  const userClient = makeSpyClient({
    characters: [{ id: 'char-1', creator_id: 'p1', is_deceased: false }]
  });
  defaultAnon.calls.length = 0;
  const { joinLfgPost } = require('./lfg');
  // Note: the insert path goes through supabaseAdmin (the mock supabaseAdmin
  // in _base returns empty arrays, so we get no error but empty data back).
  const { error } = await joinLfgPost('l1', 'p1', 'player', 'char-1', userClient);
  expect(userClient.calls).toContain('characters');
  expect(defaultAnon.calls).not.toContain('characters');
  // The function should have reached the insert phase without the character
  // read failing.
  expect(error).toBeFalsy();
});

// ─── agent actor construction consistency (no admin bypass on the agent surface) ───

test('updateForAgent does not grant an admin-role bypass: an admin-role agent profile acting on another profile\'s post is blocked, same as delete/close', async () => {
  mock.module('./_base', () => ({
    supabase: defaultAnon,
    supabaseAdmin: makeSpyClient({ lfg_posts: [{ id: 'post-1', creator_id: 'host-1' }] }),
    anonKey: 'x',
    createUserClient: () => defaultAnon
  }));
  delete require.cache[require.resolve('./lfg')];
  delete require.cache[require.resolve('../services/lfg/repository')];
  const { updateForAgent } = require('./lfg');

  const { data, error } = await updateForAgent({
    agentProfile: { id: 'admin-1', role: 'admin', timezone: 'UTC' },
    postId: 'post-1',
    body: { title: 'Hijacked title' }
  });
  expect(data).toBeNull();
  expect(error.status).toBe(403);
  expect(error.code).toBe('not_host');

  // Restore the original module mock for subsequent tests.
  mock.module('./_base', () => ({
    supabase: defaultAnon,
    supabaseAdmin: makeSpyClient(),
    anonKey: 'x',
    createUserClient: () => defaultAnon
  }));
  delete require.cache[require.resolve('./lfg')];
  delete require.cache[require.resolve('../services/lfg/repository')];
});

// Two-query stub: `from('lfg_posts')` returns hosted rows, `from('lfg_join_requests')`
// returns joined rows. Each builder resolves when awaited.
const upcomingClientStub = ({ hosted = [], joined = [] }) => {
  const calls = [];
  const make = (rows) => {
    const builder = {
      select: (...a) => { calls.push(['select', ...a]); return builder; },
      eq: (...a) => { calls.push(['eq', ...a]); return builder; },
      gte: (...a) => { calls.push(['gte', ...a]); return builder; },
      order: (...a) => { calls.push(['order', ...a]); return builder; },
      then: (resolve) => resolve({ data: rows, error: null })
    };
    return builder;
  };
  return {
    calls,
    client: { from: (table) => { calls.push(['from', table]); return make(table === 'lfg_posts' ? hosted : joined); } }
  };
};

const future = (days) => new Date(Date.now() + days * 86400000).toISOString();
const past = (days) => new Date(Date.now() - days * 86400000).toISOString();

// Renders `instant` (a Date) as an ISO string carrying an explicit numeric
// offset (e.g. +02:00) instead of `Z`, for the same instant.
const withOffset = (instant, offsetHours) => {
  const shifted = new Date(instant.getTime() + offsetHours * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  const sign = offsetHours >= 0 ? '+' : '-';
  const abs = Math.abs(offsetHours);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    `${sign}${pad(abs)}:00`;
};

test('getUpcomingForProfile labels created posts as host and joined posts as player', async () => {
  const { getUpcomingForProfile } = require('./lfg');
  const { client } = upcomingClientStub({
    hosted: [{ id: 'a', title: 'Hosted Run', date: future(2), creator_id: 'p1' }],
    joined: [{
      character: { name: 'Vex' },
      lfg_posts: { id: 'b', title: 'Joined Run', date: future(1), creator_id: 'p2' }
    }]
  });

  const { data, error } = await getUpcomingForProfile('p1', { limit: 3 }, client);

  expect(error).toBeNull();
  expect(data).toEqual([
    { id: 'b', title: 'Joined Run', date: data[0].date, role: 'player', characterName: 'Vex' },
    { id: 'a', title: 'Hosted Run', date: data[1].date, role: 'host', characterName: null }
  ]);
});

test('getUpcomingForProfile drops posts whose date has passed', async () => {
  const { getUpcomingForProfile } = require('./lfg');
  const { client } = upcomingClientStub({
    hosted: [],
    joined: [{ character: null, lfg_posts: { id: 'old', title: 'Last Week', date: past(3), creator_id: 'p2' } }]
  });

  const { data } = await getUpcomingForProfile('p1', { limit: 3 }, client);
  expect(data).toEqual([]);
});

test('getUpcomingForProfile lists a post once when the viewer both created and joined it', async () => {
  const { getUpcomingForProfile } = require('./lfg');
  const when = future(2);
  const { client } = upcomingClientStub({
    hosted: [{ id: 'a', title: 'My Run', date: when, creator_id: 'p1' }],
    joined: [{ character: { name: 'Vex' }, lfg_posts: { id: 'a', title: 'My Run', date: when, creator_id: 'p1' } }]
  });

  const { data } = await getUpcomingForProfile('p1', { limit: 3 }, client);
  expect(data).toHaveLength(1);
  expect(data[0].role).toBe('host');
  expect(data[0].characterName).toBe('Vex');
});

test('getUpcomingForProfile truncates to the limit', async () => {
  const { getUpcomingForProfile } = require('./lfg');
  const { client } = upcomingClientStub({
    hosted: [1, 2, 3, 4].map(n => ({ id: `h${n}`, title: `Run ${n}`, date: future(n), creator_id: 'p1' })),
    joined: []
  });

  const { data } = await getUpcomingForProfile('p1', { limit: 3 }, client);
  expect(data.map(p => p.id)).toEqual(['h1', 'h2', 'h3']);
});

test('getUpcomingForProfile skips join requests whose post was deleted', async () => {
  const { getUpcomingForProfile } = require('./lfg');
  const { client } = upcomingClientStub({ hosted: [], joined: [{ character: null, lfg_posts: null }] });

  const { data, error } = await getUpcomingForProfile('p1', { limit: 3 }, client);
  expect(error).toBeNull();
  expect(data).toEqual([]);
});

test('getUpcomingForProfile compares dates as instants, not raw strings, across timezone offsets', async () => {
  const { getUpcomingForProfile } = require('./lfg');
  // A +02:00 offset pushes the local hour digits up, so as a raw string this
  // past instant sorts *after* a `Z`-suffixed "now" -- a naive string
  // comparison would wrongly treat it as not-yet-past.
  const thirtyMinAgo = withOffset(new Date(Date.now() - 30 * 60000), 2);
  // A -05:00 offset pushes the local hour digits down, so this future instant
  // sorts *before* a `Z`-suffixed "now" -- a naive string comparison would
  // wrongly treat it as already past.
  const thirtyMinFromNow = withOffset(new Date(Date.now() + 30 * 60000), -5);

  const { client } = upcomingClientStub({
    hosted: [],
    joined: [
      { character: null, lfg_posts: { id: 'just-finished', title: 'Just Finished', date: thirtyMinAgo, creator_id: 'p2' } },
      { character: { name: 'Vex' }, lfg_posts: { id: 'starting-soon', title: 'Starting Soon', date: thirtyMinFromNow, creator_id: 'p2' } }
    ]
  });

  const { data } = await getUpcomingForProfile('p1', { limit: 3 }, client);
  expect(data.map(p => p.id)).toEqual(['starting-soon']);
});

// ─── conduit visibility for viewers who cannot see the join requests (#162) ───
//
// `lfg_posts_public_select` is `USING (is_public = true)`, so a signed-in
// non-owner receives the post row -- host_id included. `lfg_join_requests_select`
// shows that same viewer only their OWN requests, so the approved conduit's
// request is invisible and the derivation comes up empty. The row already names
// the conduit; a blind derivation must not overwrite it with null.

const conduitBlindPost = (overrides = {}) => ({
  id: 'l1',
  creator_id: 'c1',
  is_public: true,
  host_id: 'h1',
  host: { id: 'h1', name: 'Vega', is_public: true },
  ...overrides
});

test('getLfgPost keeps the row host when the viewer cannot see the conduit join request', async () => {
  const userClient = makeSpyClient({
    lfg_posts: [conduitBlindPost()],
    profiles: [{ id: 'c1', name: 'Creator', is_public: true }],
    lfg_join_requests: []
  });
  const { data } = await getLfgPost('l1', userClient);
  expect(data.host_id).toBe('h1');
  expect(data.host_name).toBe('Vega');
  expect(data.host_is_public).toBe(true);
  expect(data.has_conduit).toBe(true);
});

test('getLfgPostsByOthers keeps the row host when the viewer cannot see the conduit join request', async () => {
  const userClient = makeSpyClient({
    lfg_posts: [conduitBlindPost()],
    profiles: [{ id: 'c1', name: 'Creator', is_public: true }],
    lfg_join_requests: []
  });
  const { data } = await getLfgPostsByOthers('p9', userClient);
  expect(data[0].host_id).toBe('h1');
  expect(data[0].host_name).toBe('Vega');
  expect(data[0].has_conduit).toBe(true);
});

test('a post with no conduit anywhere still reads as needing one', async () => {
  const userClient = makeSpyClient({
    lfg_posts: [conduitBlindPost({ host_id: null, host: null })],
    profiles: [{ id: 'c1', name: 'Creator', is_public: true }],
    lfg_join_requests: []
  });
  const { data } = await getLfgPost('l1', userClient);
  expect(data.host_id).toBeNull();
  expect(data.host_name).toBeNull();
  expect(data.host_is_public).toBe(false);
  expect(data.has_conduit).toBe(false);
});

test('the approved conduit join request still wins over a stale host_id on the row', async () => {
  const userClient = makeSpyClient({
    lfg_posts: [conduitBlindPost({ host_id: 'stale', host: { id: 'stale', name: 'Old Host', is_public: true } })],
    profiles: [{ id: 'c1', name: 'Creator', is_public: true }],
    lfg_join_requests: [{
      id: 'jr1', status: 'approved', join_type: 'conduit', profile_id: 'h2',
      profile: { id: 'h2', name: 'Vega', is_public: false }
    }]
  });
  const { data } = await getLfgPost('l1', userClient);
  expect(data.host_id).toBe('h2');
  expect(data.host_name).toBe('Vega');
  expect(data.host_is_public).toBe(false);
  expect(data.has_conduit).toBe(true);
});

test('a conduit whose profile is private is named as unknown, never as no conduit at all', async () => {
  const userClient = makeSpyClient({
    lfg_posts: [conduitBlindPost({ host: null })],
    profiles: [{ id: 'c1', name: 'Creator', is_public: true }],
    lfg_join_requests: [{ id: 'jr1', status: 'approved', join_type: 'conduit', profile_id: 'h1', profile: null }]
  });
  const { data } = await getLfgPost('l1', userClient);
  expect(data.host_id).toBe('h1');
  expect(data.host_name).toBe('Unknown Agent');
  expect(data.host_is_public).toBe(false);
  expect(data.has_conduit).toBe(true);
});
