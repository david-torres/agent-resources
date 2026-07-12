// models/lfg-agent.test.js
// Integration tests for agent-scoped LFG model wrappers.
// Requires local Supabase to be running (http://127.0.0.1:54321).
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { supabaseAdmin } = require('./_base');

const {
  listPostsForAgent,
  getPostForAgent,
  createForAgent,
  updateForAgent,
  closeForAgent,
  deleteForAgent,
  joinForAgent,
  leaveForAgent,
  updateRequestForAgent,
  listEligibleCharactersForAgent
} = require('./lfg');

// ─── Seeding helpers ──────────────────────────────────────────────────────────

const SERVICE_ROLE_KEY = process.env.SUPABASE_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;

async function createAuthUser(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password: 'test-password-123', email_confirm: true })
  });
  const json = await res.json();
  if (!json.id) throw new Error(`createAuthUser failed: ${JSON.stringify(json)}`);
  return json.id; // auth user UUID
}

async function deleteAuthUser(userId) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    }
  });
}

async function createProfile(authUserId, name) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .insert({ user_id: authUserId, name, is_public: true, timezone: 'UTC' })
    .select()
    .single();
  if (error) throw new Error(`createProfile failed: ${JSON.stringify(error)}`);
  return data;
}

async function createCharacter(profileId, { name = 'TestChar', is_deceased = false } = {}) {
  const { data, error } = await supabaseAdmin
    .from('characters')
    .insert({
      creator_id: profileId,
      name,
      class: 'Warrior',
      level: 1,
      is_deceased,
      is_public: true,
      vitality: 1, might: 1, resilience: 1, spirit: 1, arcane: 1,
      will: 1, sensory: 1, reflex: 1, vigor: 1, skill: 1,
      intelligence: 1, luck: 1, completed_missions: 0,
      commissary_reward: 0
    })
    .select()
    .single();
  if (error) throw new Error(`createCharacter failed: ${JSON.stringify(error)}`);
  return data;
}

async function createPost(creatorId, { title = 'Test Post', is_public = true, status = 'open' } = {}) {
  const { data, error } = await supabaseAdmin
    .from('lfg_posts')
    .insert({
      title,
      description: 'A test post',
      date: new Date(Date.now() + 86400000).toISOString(),
      creator_id: creatorId,
      host_id: creatorId,
      max_characters: 4,
      is_public,
      status
    })
    .select()
    .single();
  if (error) throw new Error(`createPost failed: ${JSON.stringify(error)}`);
  return data;
}

async function createJoinRequest(postId, profileId, joinType = 'player', characterId = null, status = 'pending') {
  const { data, error } = await supabaseAdmin
    .from('lfg_join_requests')
    .insert({ lfg_post_id: postId, profile_id: profileId, join_type: joinType, character_id: characterId, status })
    .select()
    .single();
  if (error) throw new Error(`createJoinRequest failed: ${JSON.stringify(error)}`);
  return data;
}

// ─── Test state ───────────────────────────────────────────────────────────────

let hostAuthId, joinerAuthId;
let hostProfile, joinerProfile;
let joinerCharacter, deceasedCharacter;
let openPost;

beforeEach(async () => {
  // Create two auth users
  hostAuthId = await createAuthUser(`lfg-test-host-${Date.now()}@test.invalid`);
  joinerAuthId = await createAuthUser(`lfg-test-joiner-${Date.now()}@test.invalid`);

  // Create profiles
  hostProfile = await createProfile(hostAuthId, 'Test Host');
  joinerProfile = await createProfile(joinerAuthId, 'Test Joiner');

  // Characters owned by joiner
  joinerCharacter = await createCharacter(joinerProfile.id, { name: 'Alive Char' });
  deceasedCharacter = await createCharacter(joinerProfile.id, { name: 'Dead Char', is_deceased: true });

  // Open public post hosted by host
  openPost = await createPost(hostProfile.id, { title: 'Open Public Post', is_public: true, status: 'open' });
});

afterEach(async () => {
  // Delete in reverse FK order. Cascade handles join_requests when posts deleted.
  if (openPost) {
    await supabaseAdmin.from('lfg_posts').delete().eq('id', openPost.id);
  }
  if (joinerCharacter) {
    await supabaseAdmin.from('characters').delete().eq('id', joinerCharacter.id);
  }
  if (deceasedCharacter) {
    await supabaseAdmin.from('characters').delete().eq('id', deceasedCharacter.id);
  }
  if (joinerProfile) {
    await supabaseAdmin.from('profiles').delete().eq('id', joinerProfile.id);
  }
  if (hostProfile) {
    await supabaseAdmin.from('profiles').delete().eq('id', hostProfile.id);
  }
  if (joinerAuthId) await deleteAuthUser(joinerAuthId);
  if (hostAuthId) await deleteAuthUser(hostAuthId);
});

// ─── listPostsForAgent ────────────────────────────────────────────────────────

describe('listPostsForAgent', () => {
  test('scope=public returns only public open posts', async () => {
    const { data, error } = await listPostsForAgent({
      agentProfileId: joinerProfile.id,
      scope: 'public',
      status: 'open'
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    const found = data.find((p) => p.id === openPost.id);
    expect(found).toBeDefined();
    expect(found.is_public).toBe(true);
    expect(found.status).toBe('open');
  });

  test('scope=mine returns posts created by caller', async () => {
    const { data, error } = await listPostsForAgent({
      agentProfileId: hostProfile.id,
      scope: 'mine'
    });
    expect(error).toBeNull();
    const found = data.find((p) => p.id === openPost.id);
    expect(found).toBeDefined();
  });

  test('scope=joined returns posts caller has an active request on', async () => {
    // Joiner creates a join request
    await createJoinRequest(openPost.id, joinerProfile.id, 'conduit', null, 'pending');

    const { data, error } = await listPostsForAgent({
      agentProfileId: joinerProfile.id,
      scope: 'joined'
    });
    expect(error).toBeNull();
    const found = data.find((p) => p.id === openPost.id);
    expect(found).toBeDefined();
  });
});

// ─── getPostForAgent ──────────────────────────────────────────────────────────

describe('getPostForAgent', () => {
  test('omits pending_requests when caller is not host', async () => {
    // Create a pending join request from host's perspective — joiner calls getPost
    await createJoinRequest(openPost.id, joinerProfile.id, 'conduit', null, 'pending');

    const { data, error } = await getPostForAgent({
      agentProfileId: joinerProfile.id,
      postId: openPost.id
    });
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.pending_requests).toBeUndefined();
  });

  test('includes pending_requests when caller is host', async () => {
    await createJoinRequest(openPost.id, joinerProfile.id, 'conduit', null, 'pending');

    const { data, error } = await getPostForAgent({
      agentProfileId: hostProfile.id,
      postId: openPost.id
    });
    expect(error).toBeNull();
    expect(Array.isArray(data.pending_requests)).toBe(true);
    expect(data.pending_requests.length).toBe(1);
    expect(data.pending_requests[0].profile_id).toBe(joinerProfile.id);
  });

  test('attaches my_request when caller has an active request', async () => {
    const req = await createJoinRequest(openPost.id, joinerProfile.id, 'conduit', null, 'pending');

    const { data, error } = await getPostForAgent({
      agentProfileId: joinerProfile.id,
      postId: openPost.id
    });
    expect(error).toBeNull();
    expect(data.my_request).toBeDefined();
    expect(data.my_request.id).toBe(req.id);
    expect(data.my_request.join_type).toBe('conduit');
    expect(data.my_request.status).toBe('pending');
  });
});

// ─── joinForAgent ─────────────────────────────────────────────────────────────

describe('joinForAgent', () => {
  test('returns 400 code=character_ineligible for non-owned character', async () => {
    // Host tries to join with a character owned by joiner
    const { data, error } = await joinForAgent({
      agentProfileId: hostProfile.id,
      postId: openPost.id,
      joinType: 'player',
      characterId: joinerCharacter.id
    });
    expect(data).toBeNull();
    expect(error.status).toBe(400);
    expect(error.code).toBe('character_ineligible');
  });

  test('returns 400 code=character_ineligible for deceased character', async () => {
    const { data, error } = await joinForAgent({
      agentProfileId: joinerProfile.id,
      postId: openPost.id,
      joinType: 'player',
      characterId: deceasedCharacter.id
    });
    expect(data).toBeNull();
    expect(error.status).toBe(400);
    expect(error.code).toBe('character_ineligible');
  });

  test('returns 409 code=duplicate_request on existing active request', async () => {
    // Create an initial pending conduit request
    await createJoinRequest(openPost.id, joinerProfile.id, 'conduit', null, 'pending');

    // Try to join again
    const { data, error } = await joinForAgent({
      agentProfileId: joinerProfile.id,
      postId: openPost.id,
      joinType: 'conduit'
    });
    expect(data).toBeNull();
    expect(error.status).toBe(409);
    expect(error.code).toBe('duplicate_request');
  });

  test('returns 409 code=conduit_taken when conduit slot filled', async () => {
    // Approve a conduit request for joiner
    await createJoinRequest(openPost.id, joinerProfile.id, 'conduit', null, 'approved');

    // Third user tries to also join as conduit — use host trying to join own post as conduit
    // We need a third profile; create an extra auth user+profile inline
    const thirdAuthId = await createAuthUser(`lfg-test-third-${Date.now()}@test.invalid`);
    const thirdProfile = await createProfile(thirdAuthId, 'Third User');

    try {
      const { data, error } = await joinForAgent({
        agentProfileId: thirdProfile.id,
        postId: openPost.id,
        joinType: 'conduit'
      });
      expect(data).toBeNull();
      expect(error.status).toBe(409);
      expect(error.code).toBe('conduit_taken');
    } finally {
      await supabaseAdmin.from('profiles').delete().eq('id', thirdProfile.id);
      await deleteAuthUser(thirdAuthId);
    }
  });
});

// ─── self-join auto-approve ───────────────────────────────────────────────────

describe('self-join auto-approve', () => {
  beforeEach(async () => {
    // Clear seeded host_id so host can self-join as conduit without tripping conduit_taken
    await supabaseAdmin.from('lfg_posts').update({ host_id: null }).eq('id', openPost.id);
  });

  test('creator joining own post as conduit → request auto-approved', async () => {
    const { data, error } = await joinForAgent({
      agentProfileId: hostProfile.id,
      postId: openPost.id,
      joinType: 'conduit'
    });
    expect(error).toBeNull();
    expect(data.request[0].status).toBe('approved');
  });

  test('creator joining own post as player → request auto-approved', async () => {
    const hostCharacter = await createCharacter(hostProfile.id, { name: 'Host Char' });
    try {
      const { data, error } = await joinForAgent({
        agentProfileId: hostProfile.id,
        postId: openPost.id,
        joinType: 'player',
        characterId: hostCharacter.id
      });
      expect(error).toBeNull();
      expect(data.request[0].status).toBe('approved');
    } finally {
      await supabaseAdmin.from('characters').delete().eq('id', hostCharacter.id);
    }
  });

  test('non-creator joining stays pending', async () => {
    const { data, error } = await joinForAgent({
      agentProfileId: joinerProfile.id,
      postId: openPost.id,
      joinType: 'conduit'
    });
    expect(error).toBeNull();
    expect(data.request[0].status).toBe('pending');
  });

  test('creator conduit self-join syncs host_id on the post', async () => {
    const { error } = await joinForAgent({
      agentProfileId: hostProfile.id,
      postId: openPost.id,
      joinType: 'conduit'
    });
    expect(error).toBeNull();
    const { data: postRow } = await supabaseAdmin
      .from('lfg_posts').select('host_id').eq('id', openPost.id).single();
    expect(postRow.host_id).toBe(hostProfile.id);
  });
});

// ─── create/update role reconciliation ────────────────────────────────────────

describe('createLfgPost host-flag flow', () => {
  test('host_id=on creates+approves a conduit join_request and syncs host_id', async () => {
    const { createLfgPost } = require('./lfg');
    const { data: post, error } = await createLfgPost({
      title: 'Host-flag post',
      description: 'test',
      date: new Date(Date.now() + 86400000).toISOString(),
      max_characters: 4,
      host_id: 'on'
    }, hostProfile);
    expect(error).toBeNull();
    expect(post).toBeTruthy();
    try {
      const { data: req } = await supabaseAdmin
        .from('lfg_join_requests')
        .select('join_type, status')
        .eq('lfg_post_id', post.id)
        .eq('profile_id', hostProfile.id)
        .maybeSingle();
      expect(req).toBeTruthy();
      expect(req.join_type).toBe('conduit');
      expect(req.status).toBe('approved');

      const { data: row } = await supabaseAdmin
        .from('lfg_posts').select('host_id').eq('id', post.id).single();
      expect(row.host_id).toBe(hostProfile.id);
    } finally {
      await supabaseAdmin.from('lfg_posts').delete().eq('id', post.id);
    }
  });

  test('no host_id flag leaves post with no conduit', async () => {
    const { createLfgPost } = require('./lfg');
    const { data: post, error } = await createLfgPost({
      title: 'No-host post',
      description: 'test',
      date: new Date(Date.now() + 86400000).toISOString(),
      max_characters: 4
    }, hostProfile);
    expect(error).toBeNull();
    try {
      const { data: row } = await supabaseAdmin
        .from('lfg_posts').select('host_id').eq('id', post.id).single();
      expect(row.host_id).toBeNull();
      const { data: reqs } = await supabaseAdmin
        .from('lfg_join_requests')
        .select('id')
        .eq('lfg_post_id', post.id);
      expect(reqs.length).toBe(0);
    } finally {
      await supabaseAdmin.from('lfg_posts').delete().eq('id', post.id);
    }
  });
});

describe('updateLfgPost role reconciliation', () => {
  beforeEach(async () => {
    await supabaseAdmin.from('lfg_posts').update({ host_id: null }).eq('id', openPost.id);
  });

  test('setting host_id=on when not yet conduit creates+approves the conduit request', async () => {
    const { updateLfgPost } = require('./lfg');
    const { error } = await updateLfgPost(openPost.id, {
      title: openPost.title,
      description: openPost.description,
      date: new Date(Date.now() + 86400000).toISOString(),
      max_characters: 4,
      host_id: 'on'
    }, hostProfile);
    expect(error).toBeNull();

    const { data: req } = await supabaseAdmin
      .from('lfg_join_requests')
      .select('join_type, status')
      .eq('lfg_post_id', openPost.id)
      .eq('profile_id', hostProfile.id)
      .maybeSingle();
    expect(req.join_type).toBe('conduit');
    expect(req.status).toBe('approved');

    const { data: row } = await supabaseAdmin
      .from('lfg_posts').select('host_id').eq('id', openPost.id).single();
    expect(row.host_id).toBe(hostProfile.id);
  });

  test('update without host_id/character does not delete existing self-request', async () => {
    // Creator already has an approved conduit request (e.g. joined via normal flow)
    await createJoinRequest(openPost.id, hostProfile.id, 'conduit', null, 'approved');
    await supabaseAdmin.from('lfg_posts').update({ host_id: hostProfile.id }).eq('id', openPost.id);

    const { updateLfgPost } = require('./lfg');
    const { error } = await updateLfgPost(openPost.id, {
      title: 'Edited title',
      description: openPost.description,
      date: new Date(Date.now() + 86400000).toISOString(),
      max_characters: 4
      // note: no host_id field at all
    }, hostProfile);
    expect(error).toBeNull();

    const { data: req } = await supabaseAdmin
      .from('lfg_join_requests')
      .select('join_type, status')
      .eq('lfg_post_id', openPost.id)
      .eq('profile_id', hostProfile.id)
      .maybeSingle();
    expect(req).toBeTruthy();
    expect(req.join_type).toBe('conduit');
    expect(req.status).toBe('approved');
  });
});

// ─── joinLfgPost conduit_taken (shared impl) ──────────────────────────────────

describe('joinLfgPost conduit slot enforcement', () => {
  test('rejects a conduit join when an approved conduit already exists', async () => {
    await createJoinRequest(openPost.id, joinerProfile.id, 'conduit', null, 'approved');
    const thirdAuthId = await createAuthUser(`lfg-test-third-${Date.now()}@test.invalid`);
    const thirdProfile = await createProfile(thirdAuthId, 'Third User');
    try {
      const { joinLfgPost } = require('./lfg');
      const { data, error } = await joinLfgPost(openPost.id, thirdProfile.id, 'conduit');
      expect(data).toBeNull();
      expect(error).toBeTruthy();
      const message = typeof error === 'string' ? error : error.message;
      expect(message).toMatch(/conduit/i);
    } finally {
      await supabaseAdmin.from('profiles').delete().eq('id', thirdProfile.id);
      await deleteAuthUser(thirdAuthId);
    }
  });
});

// ─── closeForAgent ────────────────────────────────────────────────────────────

describe('closeForAgent', () => {
  test('flips status to closed when caller is host', async () => {
    const { data, error } = await closeForAgent({
      agentProfileId: hostProfile.id,
      postId: openPost.id
    });
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.status).toBe('closed');
  });

  test('returns 403 code=not_host when caller is not creator', async () => {
    const { data, error } = await closeForAgent({
      agentProfileId: joinerProfile.id,
      postId: openPost.id
    });
    expect(data).toBeNull();
    expect(error.status).toBe(403);
    expect(error.code).toBe('not_host');
  });
});

// ─── updateRequestForAgent ────────────────────────────────────────────────────

describe('updateRequestForAgent', () => {
  test('host approves a pending player request → request.status approved and id populated', async () => {
    const joinReq = await createJoinRequest(openPost.id, joinerProfile.id, 'player', joinerCharacter.id, 'pending');

    const { data, error } = await updateRequestForAgent({
      agentProfileId: hostProfile.id,
      requestId: joinReq.id,
      status: 'approved'
    });
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.request).toBeDefined();
    expect(data.request.id).toBe(joinReq.id);
    expect(data.request.status).toBe('approved');
  });

  test('non-host tries to approve → error.status 403, error.code not_host', async () => {
    const joinReq = await createJoinRequest(openPost.id, joinerProfile.id, 'player', joinerCharacter.id, 'pending');

    const { data, error } = await updateRequestForAgent({
      agentProfileId: joinerProfile.id,
      requestId: joinReq.id,
      status: 'approved'
    });
    expect(data).toBeNull();
    expect(error.status).toBe(403);
    expect(error.code).toBe('not_host');
  });

  test('unknown requestId → error.status 404, error.code not_found', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const { data, error } = await updateRequestForAgent({
      agentProfileId: hostProfile.id,
      requestId: fakeId,
      status: 'approved'
    });
    expect(data).toBeNull();
    expect(error.status).toBe(404);
    expect(error.code).toBe('not_found');
  });
});

// ─── leaveForAgent ────────────────────────────────────────────────────────────

describe('leaveForAgent', () => {
  test('joiner withdraws an active request → deleted true and request row is gone', async () => {
    const joinReq = await createJoinRequest(openPost.id, joinerProfile.id, 'conduit', null, 'pending');

    const { data, error } = await leaveForAgent({
      agentProfileId: joinerProfile.id,
      postId: openPost.id
    });
    expect(error).toBeNull();
    expect(data.deleted).toBe(true);

    // Verify the request row is gone from DB
    const { data: row } = await supabaseAdmin
      .from('lfg_join_requests')
      .select('id')
      .eq('id', joinReq.id)
      .maybeSingle();
    expect(row).toBeNull();
  });

  test('joiner who never joined → deleted false and post is still returned', async () => {
    const { data, error } = await leaveForAgent({
      agentProfileId: joinerProfile.id,
      postId: openPost.id
    });
    expect(error).toBeNull();
    expect(data.deleted).toBe(false);
    expect(data.post).toBeDefined();
    expect(data.post.id).toBe(openPost.id);
  });
});

// ─── conduit host_id sync ─────────────────────────────────────────────────────

describe('conduit host_id sync', () => {
  beforeEach(async () => {
    // Start each sync test from a clean slate where host_id is null, so we can
    // observe the sync logic flipping it on/off rather than the seed value.
    await supabaseAdmin.from('lfg_posts').update({ host_id: null }).eq('id', openPost.id);
  });

  test('approving a conduit join_request sets lfg_posts.host_id to the conduit profile', async () => {
    const joinReq = await createJoinRequest(openPost.id, joinerProfile.id, 'conduit', null, 'pending');

    const { error } = await updateRequestForAgent({
      agentProfileId: hostProfile.id,
      requestId: joinReq.id,
      status: 'approved'
    });
    expect(error).toBeNull();

    const { data: postRow } = await supabaseAdmin
      .from('lfg_posts')
      .select('host_id')
      .eq('id', openPost.id)
      .single();
    expect(postRow.host_id).toBe(joinerProfile.id);
  });

  test('rejecting an approved conduit clears lfg_posts.host_id', async () => {
    const joinReq = await createJoinRequest(openPost.id, joinerProfile.id, 'conduit', null, 'approved');
    await supabaseAdmin.from('lfg_posts').update({ host_id: joinerProfile.id }).eq('id', openPost.id);

    const { error } = await updateRequestForAgent({
      agentProfileId: hostProfile.id,
      requestId: joinReq.id,
      status: 'rejected'
    });
    expect(error).toBeNull();

    const { data: postRow } = await supabaseAdmin
      .from('lfg_posts')
      .select('host_id')
      .eq('id', openPost.id)
      .single();
    expect(postRow.host_id).toBeNull();
  });

  test('approving a player request does not touch host_id', async () => {
    const joinReq = await createJoinRequest(openPost.id, joinerProfile.id, 'player', joinerCharacter.id, 'pending');

    const { error } = await updateRequestForAgent({
      agentProfileId: hostProfile.id,
      requestId: joinReq.id,
      status: 'approved'
    });
    expect(error).toBeNull();

    const { data: postRow } = await supabaseAdmin
      .from('lfg_posts')
      .select('host_id')
      .eq('id', openPost.id)
      .single();
    expect(postRow.host_id).toBeNull();
  });

  test('leaving as approved conduit clears host_id', async () => {
    await createJoinRequest(openPost.id, joinerProfile.id, 'conduit', null, 'approved');
    await supabaseAdmin.from('lfg_posts').update({ host_id: joinerProfile.id }).eq('id', openPost.id);

    const { error } = await leaveForAgent({
      agentProfileId: joinerProfile.id,
      postId: openPost.id
    });
    expect(error).toBeNull();

    const { data: postRow } = await supabaseAdmin
      .from('lfg_posts')
      .select('host_id')
      .eq('id', openPost.id)
      .single();
    expect(postRow.host_id).toBeNull();
  });
});
