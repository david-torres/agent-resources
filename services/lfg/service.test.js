const { test, expect } = require('bun:test');
const { normalizeLfgInput } = require('./input');
const { LfgService } = require('./service');
const { AuthorizationError } = require('../../util/errors');
const { SYSTEM_ACTOR } = require('../../util/actor');

const CREATOR = { profileId: 'creator-1', role: 'user' };
const STRANGER = { profileId: 'stranger', role: 'user' };
const ADMIN = { profileId: 'admin-1', role: 'admin' };

const makeRepo = (overrides = {}) => {
  const calls = [];
  const state = {
    post: { id: 'post-1', creator_id: 'creator-1' },
    request: { id: 'req-1', lfg_post_id: 'post-1', profile_id: 'creator-1', post: { creator_id: 'creator-1' } },
    ...overrides
  };
  return {
    calls,
    state,
    createPost: async (data) => { calls.push(['createPost', data]); return { data: [{ id: 'post-1', ...data }], error: null }; },
    updatePost: async (id, creatorId, data) => { calls.push(['updatePost', id, creatorId, data]); return { data: [{ id, ...data }], error: null }; },
    getCreatorRequest: async (profileId, postId) => { calls.push(['getCreatorRequest', profileId, postId]); return { data: null, error: null }; },
    fetchPostPermissionRow: async (id) => { calls.push(['fetchPostPermissionRow', id]); return { data: state.post, error: null }; },
    deletePost: async (id, creatorId) => { calls.push(['deletePost', id, creatorId]); return { data: null, error: null }; },
    closePost: async (id, creatorId) => { calls.push(['closePost', id, creatorId]); return { data: { id, status: 'closed' }, error: null }; },
    getApprovedConduit: async (postId) => { calls.push(['getApprovedConduit', postId]); return { data: [], error: null }; },
    getPostCreatorId: async (postId) => { calls.push(['getPostCreatorId', postId]); return { data: { creator_id: state.post?.creator_id }, error: null }; },
    insertJoinRequest: async (row) => { calls.push(['insertJoinRequest', row]); return { data: [{ id: 'jr-1', ...row }], error: null }; },
    getApprovedConduitProfile: async (postId) => { calls.push(['getApprovedConduitProfile', postId]); return { data: null, error: null }; },
    updatePostHostId: async (postId, hostId) => { calls.push(['updatePostHostId', postId, hostId]); return { error: null }; },
    fetchJoinRequestWithPost: async (id) => { calls.push(['fetchJoinRequestWithPost', id]); return { data: state.request, error: null }; },
    getJoinRequestRow: async (id) => { calls.push(['getJoinRequestRow', id]); return { data: { id, ...state.request }, error: null }; },
    updateJoinRequestStatusRow: async (id, status, postId) => { calls.push(['updateJoinRequestStatusRow', id, status, postId]); return { data: null, error: null }; },
    deleteJoinRequestRow: async (id) => { calls.push(['deleteJoinRequestRow', id]); return { data: null, error: null }; },
    listPostsWithRequestsBy: async (filters, opts) => { calls.push(['listPostsWithRequestsBy', filters, opts]); return { data: [], error: null }; },
    listJoinedPostIds: async (profileId) => { calls.push(['listJoinedPostIds', profileId]); return { data: [], error: null }; },
    listPostsByIds: async (ids, opts) => { calls.push(['listPostsByIds', ids, opts]); return { data: [], error: null }; },
    getPostForAgentRow: async (postId) => { calls.push(['getPostForAgentRow', postId]); return { data: { id: postId, creator: { id: 'creator-1' }, lfg_join_requests: [] }, error: null }; },
    getCharacterForJoin: async (id) => { calls.push(['getCharacterForJoin', id]); return { data: { id, creator_id: 'creator-1', is_deceased: false }, error: null }; },
    getExistingJoinRequest: async (postId, profileId) => { calls.push(['getExistingJoinRequest', postId, profileId]); return { data: null, error: null }; },
    listEligibleCharacters: async (profileId) => { calls.push(['listEligibleCharacters', profileId]); return { data: [{ id: 'char-1', name: 'A', class: 'Warrior', level: 1 }], error: null }; }
  };
};

test('normalizes LFG input without mutating the submitted request', () => {
  const input = { title: 'Game', character: 'char-1', host_id: 'on', is_public: 'on', date: '2026-07-11T20:00' };
  const result = normalizeLfgInput(input, { creatorId: 'actor-1', timezone: 'America/New_York' });
  expect(input).toEqual({ title: 'Game', character: 'char-1', host_id: 'on', is_public: 'on', date: '2026-07-11T20:00' });
  expect(result.data).toMatchObject({ title: 'Game', creator_id: 'actor-1', is_public: true });
  expect(result.data.character).toBeUndefined();
  expect(result.role).toEqual({ hostFlag: true, characterId: 'char-1' });
});

test('constructor requires every repository method', () => {
  expect(() => new LfgService({})).toThrow(TypeError);
});

// ─── createPost / updatePost ────────────────────────────────────────────────

test('creates a normalized post then reconciles the creator role', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const result = await service.createPost(CREATOR, { title: 'Game', host_id: 'on', is_public: false, date: '2026-07-11' });
  expect(result.error).toBeNull();
  expect(repo.calls.map(c => c[0])).toEqual([
    'createPost', 'getCreatorRequest', 'getApprovedConduit', 'getPostCreatorId', 'insertJoinRequest',
    'getApprovedConduitProfile', 'updatePostHostId'
  ]);
});

test('the system actor may create a post with an explicit creator_id', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  await service.createPost(SYSTEM_ACTOR, { title: 'Game', is_public: false, date: '2026-07-11', creator_id: 'other-profile' });
  expect(repo.calls[0]).toEqual(['createPost', expect.objectContaining({ creator_id: 'other-profile' })]);
});

test('the owner may update their post; the write reaches the repository', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const result = await service.updatePost(CREATOR, 'post-1', { title: 'New title' });
  expect(result.error).toBeNull();
  expect(repo.calls.map(c => c[0])).toEqual(['fetchPostPermissionRow', 'updatePost']);
  expect(repo.calls[1]).toEqual(['updatePost', 'post-1', 'creator-1', expect.objectContaining({ title: 'New title' })]);
});

test('an admin may update a post they do not own', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const result = await service.updatePost(ADMIN, 'post-1', { title: 'New title' });
  expect(result.error).toBeNull();
});

test('a non-owner updating a post throws AuthorizationError, never reaching the write', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  await expect(service.updatePost(STRANGER, 'post-1', { title: 'Nope' })).rejects.toThrow(AuthorizationError);
  expect(repo.calls.map(c => c[0])).toEqual(['fetchPostPermissionRow']);
});

test('updating a post that does not exist returns a structured 404, without throwing', async () => {
  const repo = makeRepo({ post: null });
  const service = new LfgService(repo);
  const result = await service.updatePost(CREATOR, 'missing', { title: 'x' });
  expect(result.data).toBeNull();
  expect(result.error).toEqual({ status: 404, code: 'not_found', message: 'LFG post not found' });
});

// ─── deletePost ──────────────────────────────────────────────────────────────

test('the owner may delete their post', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  await service.deletePost(CREATOR, 'post-1');
  expect(repo.calls).toEqual([['fetchPostPermissionRow', 'post-1'], ['deletePost', 'post-1', 'creator-1']]);
});

test('the system actor may delete any post', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  await service.deletePost(SYSTEM_ACTOR, 'post-1');
  expect(repo.calls.map(c => c[0])).toEqual(['fetchPostPermissionRow', 'deletePost']);
});

test('a stranger deleting a post throws AuthorizationError, never reaching the delete', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  await expect(service.deletePost(STRANGER, 'post-1')).rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([['fetchPostPermissionRow', 'post-1']]);
});

test('deleting a post that does not exist returns a structured 404', async () => {
  const repo = makeRepo({ post: null });
  const service = new LfgService(repo);
  const result = await service.deletePost(CREATOR, 'missing');
  expect(result.error).toEqual({ status: 404, code: 'not_found', message: 'LFG post not found' });
});

// ─── closePost ───────────────────────────────────────────────────────────────

test('the host may close their post', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const result = await service.closePost(CREATOR, 'post-1');
  expect(result.error).toBeNull();
  expect(result.data.status).toBe('closed');
});

test('a non-host closing a post throws AuthorizationError with reason not_host', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  try {
    await service.closePost(STRANGER, 'post-1');
    throw new Error('expected throw');
  } catch (err) {
    expect(err).toBeInstanceOf(AuthorizationError);
    expect(err.reason).toBe('not_host');
    expect(err.status).toBe(403);
  }
});

test('closing a post that does not exist returns a structured 404, without throwing', async () => {
  const repo = makeRepo({ post: null });
  const service = new LfgService(repo);
  const result = await service.closePost(STRANGER, 'missing');
  expect(result.error).toEqual({ status: 404, code: 'not_found', message: 'Post not found' });
});

// ─── join (shared by joinLfgPost and joinForAgent) ──────────────────────────

test('join uses the passed client for the character-ownership read when provided', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const clientCalls = [];
  const client = {
    from: (table) => {
      clientCalls.push(table);
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'char-1', creator_id: 'creator-1', is_deceased: false }, error: null }) }) }) };
    }
  };
  const result = await service.join(CREATOR, { postId: 'post-1', joinType: 'player', characterId: 'char-1', client });
  expect(result.error).toBeNull();
  expect(clientCalls).toEqual(['characters']);
  expect(repo.calls.some(c => c[0] === 'getCharacterForJoin')).toBe(false);
});

test('join falls back to the repository for the character read with no client', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const result = await service.join(CREATOR, { postId: 'post-1', joinType: 'player', characterId: 'char-1' });
  expect(result.error).toBeNull();
  expect(repo.calls.some(c => c[0] === 'getCharacterForJoin')).toBe(true);
});

test('join rejects a character the actor does not own', async () => {
  const repo = makeRepo();
  repo.getCharacterForJoin = async () => ({ data: { id: 'char-1', creator_id: 'someone-else', is_deceased: false }, error: null });
  const service = new LfgService(repo);
  const result = await service.join(CREATOR, { postId: 'post-1', joinType: 'player', characterId: 'char-1' });
  expect(result.data).toBeNull();
  expect(result.error).toBe('You can only join with your own character');
});

test('join rejects a deceased character', async () => {
  const repo = makeRepo();
  repo.getCharacterForJoin = async () => ({ data: { id: 'char-1', creator_id: 'creator-1', is_deceased: true }, error: null });
  const service = new LfgService(repo);
  const result = await service.join(CREATOR, { postId: 'post-1', joinType: 'player', characterId: 'char-1' });
  expect(result.data).toBeNull();
  expect(result.error).toBe('Deceased characters cannot join games');
});

test('join auto-approves when the joiner is the post creator', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const result = await service.join(CREATOR, { postId: 'post-1', joinType: 'conduit' });
  expect(result.data[0].status).toBe('approved');
});

test('join stays pending for a non-creator joiner', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const result = await service.join(STRANGER, { postId: 'post-1', joinType: 'conduit' });
  expect(result.data[0].status).toBe('pending');
});

test('join rejects a conduit request when the slot is already filled', async () => {
  const repo = makeRepo();
  repo.getApprovedConduit = async () => ({ data: [{ id: 'existing' }], error: null });
  const service = new LfgService(repo);
  const result = await service.join(STRANGER, { postId: 'post-1', joinType: 'conduit' });
  expect(result.data).toBeNull();
  expect(result.error).toBe('Conduit slot is already filled');
});

// ─── updateJoinRequest (previously caller-enforced — now gated here) ────────

test('the host may approve a join request', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const result = await service.updateJoinRequest(CREATOR, { requestId: 'req-1', status: 'approved' });
  expect(result.error).toBeNull();
  expect(repo.calls.map(c => c[0])).toEqual(['fetchJoinRequestWithPost', 'updateJoinRequestStatusRow', 'getApprovedConduitProfile', 'updatePostHostId']);
});

test('the system actor may update any join request', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const result = await service.updateJoinRequest(SYSTEM_ACTOR, { requestId: 'req-1', status: 'rejected' });
  expect(result.error).toBeNull();
});

test('a non-host updating a join request throws AuthorizationError(not_host), never writing', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  await expect(service.updateJoinRequest(STRANGER, { requestId: 'req-1', status: 'approved' })).rejects.toThrow(AuthorizationError);
  expect(repo.calls.map(c => c[0])).toEqual(['fetchJoinRequestWithPost']);
});

test('updating an unknown join request returns a structured 404', async () => {
  const repo = makeRepo({ request: null });
  const service = new LfgService(repo);
  const result = await service.updateJoinRequest(CREATOR, { requestId: 'missing', status: 'approved' });
  expect(result.error).toEqual({ status: 404, code: 'not_found', message: 'Request not found' });
});

// ─── leave (previously caller-enforced — now gated here) ────────────────────

test('the request owner may withdraw their own request', async () => {
  const repo = makeRepo({ request: { id: 'req-1', lfg_post_id: 'post-1', profile_id: 'stranger', post: { creator_id: 'creator-1' } } });
  const service = new LfgService(repo);
  const result = await service.leave(STRANGER, 'req-1');
  expect(result.error).toBeNull();
  expect(repo.calls.map(c => c[0])).toEqual(['fetchJoinRequestWithPost', 'deleteJoinRequestRow', 'getApprovedConduitProfile', 'updatePostHostId']);
});

test('the host may remove a join request they do not own (moderation)', async () => {
  const repo = makeRepo({ request: { id: 'req-1', lfg_post_id: 'post-1', profile_id: 'stranger', post: { creator_id: 'creator-1' } } });
  const service = new LfgService(repo);
  const result = await service.leave(CREATOR, 'req-1');
  expect(result.error).toBeNull();
});

test('the system actor may remove any join request', async () => {
  const repo = makeRepo({ request: { id: 'req-1', lfg_post_id: 'post-1', profile_id: 'stranger', post: { creator_id: 'creator-1' } } });
  const service = new LfgService(repo);
  const result = await service.leave(SYSTEM_ACTOR, 'req-1');
  expect(result.error).toBeNull();
});

test('a third party may NOT remove someone else\'s join request', async () => {
  const repo = makeRepo({ request: { id: 'req-1', lfg_post_id: 'post-1', profile_id: 'stranger', post: { creator_id: 'creator-1' } } });
  const service = new LfgService(repo);
  await expect(service.leave({ profileId: 'third-party', role: 'user' }, 'req-1')).rejects.toThrow(AuthorizationError);
  expect(repo.calls.map(c => c[0])).toEqual(['fetchJoinRequestWithPost']);
});

test('leaving an unknown join request returns a structured 404', async () => {
  const repo = makeRepo({ request: null });
  const service = new LfgService(repo);
  const result = await service.leave(CREATOR, 'missing');
  expect(result.error).toEqual({ status: 404, code: 'not_found', message: 'Join request not found' });
});

// ─── agent surface ──────────────────────────────────────────────────────────

test('joinForAgent rejects an ineligible character with a 400', async () => {
  const repo = makeRepo();
  repo.getCharacterForJoin = async () => ({ data: { id: 'char-1', creator_id: 'someone-else', is_deceased: false }, error: null });
  const service = new LfgService(repo);
  const result = await service.joinForAgent(CREATOR, { postId: 'post-1', joinType: 'player', characterId: 'char-1' });
  expect(result.data).toBeNull();
  expect(result.error).toEqual({ status: 400, code: 'character_ineligible', message: 'Character is deceased or not yours' });
});

test('joinForAgent rejects a duplicate active request with a 409', async () => {
  const repo = makeRepo();
  repo.getExistingJoinRequest = async () => ({ data: { id: 'existing', status: 'pending' }, error: null });
  const service = new LfgService(repo);
  const result = await service.joinForAgent(CREATOR, { postId: 'post-1', joinType: 'conduit' });
  expect(result.error).toEqual({ status: 409, code: 'duplicate_request', message: 'You already have a request on this post' });
});

test('joinForAgent rejects a conduit join when the slot is filled with a 409', async () => {
  const repo = makeRepo();
  repo.getApprovedConduit = async () => ({ data: [{ id: 'existing' }], error: null });
  const service = new LfgService(repo);
  const result = await service.joinForAgent(CREATOR, { postId: 'post-1', joinType: 'conduit' });
  expect(result.error).toEqual({ status: 409, code: 'conduit_taken', message: 'Conduit slot is already filled' });
});

test('joinForAgent succeeds and returns the request plus the refreshed post', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const result = await service.joinForAgent(CREATOR, { postId: 'post-1', joinType: 'conduit' });
  expect(result.error).toBeNull();
  expect(result.data.request).toBeDefined();
  expect(result.data.post).toBeDefined();
});

test('updateRequestForAgent rejects an invalid status with a 400, before touching the repository', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const result = await service.updateRequestForAgent(CREATOR, { requestId: 'req-1', status: 'bogus' });
  expect(result.error).toEqual({ status: 400, code: 'invalid_status', message: 'status must be approved or rejected' });
  expect(repo.calls).toEqual([]);
});

test('updateRequestForAgent: non-host gets error.status 403 / error.code not_host (thrown, not returned)', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  await expect(service.updateRequestForAgent(STRANGER, { requestId: 'req-1', status: 'approved' })).rejects.toThrow(AuthorizationError);
});

test('updateRequestForAgent succeeds for the host and returns the updated request plus post', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const result = await service.updateRequestForAgent(CREATOR, { requestId: 'req-1', status: 'approved' });
  expect(result.error).toBeNull();
  expect(result.data.request).toBeDefined();
  expect(result.data.post).toBeDefined();
});

test('leaveForAgent reports deleted:false and still returns the post when there is no active request', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const result = await service.leaveForAgent(STRANGER, { postId: 'post-1' });
  expect(result.error).toBeNull();
  expect(result.data.deleted).toBe(false);
  expect(result.data.post).toBeDefined();
});

test('leaveForAgent deletes the caller\'s own active request', async () => {
  const repo = makeRepo();
  repo.getExistingJoinRequest = async () => ({ data: { id: 'req-1', status: 'pending' }, error: null });
  const service = new LfgService(repo);
  const result = await service.leaveForAgent(CREATOR, { postId: 'post-1' });
  expect(result.error).toBeNull();
  expect(result.data.deleted).toBe(true);
});

test('listEligibleCharactersForAgent projects the eligible characters', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const result = await service.listEligibleCharactersForAgent(CREATOR);
  expect(result.error).toBeNull();
  expect(result.data).toEqual([{ id: 'char-1', name: 'A', class_name: 'Warrior', level: 1 }]);
});

test('getForAgent 404s on a missing post', async () => {
  const repo = makeRepo();
  repo.getPostForAgentRow = async () => ({ data: null, error: null });
  const service = new LfgService(repo);
  const result = await service.getForAgent(CREATOR, { postId: 'missing' });
  expect(result.error).toEqual({ status: 404, code: 'not_found', message: 'Post not found' });
});

test('listForAgent returns an empty list for scope=joined with no joined posts', async () => {
  const repo = makeRepo();
  const service = new LfgService(repo);
  const result = await service.listForAgent(CREATOR, { scope: 'joined' });
  expect(result.error).toBeNull();
  expect(result.data).toEqual([]);
});
