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
