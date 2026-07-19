const { supabase } = require('./_base');
const { statList } = require('../util/enclave-consts');
const moment = require('moment-timezone');
const { LfgService } = require('../services/lfg/service');
const lfgRepository = require('../services/lfg/repository');
const { AuthorizationError } = require('../util/errors');
moment.tz.setDefault('UTC');

const fetchProfileById = async (profileId, client = supabase) => {
  if (!profileId) return { profile: null, error: null };
  const { data, error } = await client.from('profiles').select('*').eq('id', profileId).single();
  if (error && error.code !== 'PGRST116') return { profile: null, error };
  return { profile: data || null, error: null };
};

const assignCreatorMeta = (post, creator) => {
  post.creator_name = creator?.name || 'Unknown Agent';
  post.creator_is_public = Boolean(creator?.is_public);
};

// Derive conduit metadata from the post's join_requests (single source of truth).
// Overrides any stale host_id on the row and keeps post.host_id/host_name/host_is_public
// in sync with the approved conduit join_request for template consumption.
const applyConduitMeta = (post) => {
  const conduit = (post.join_requests || []).find(
    (r) => r.status === 'approved' && r.join_type === 'conduit'
  );
  if (conduit && conduit.profile) {
    post.host_id = conduit.profile.id;
    post.host_name = conduit.profile.name;
    post.host_is_public = Boolean(conduit.profile.is_public);
  } else {
    post.host_id = null;
    post.host_name = null;
    post.host_is_public = false;
  }
  post.has_conduit = Boolean(conduit);
};

const getLfgPosts = async (client = supabase) => {
  const { data, error } = await client
    .from('lfg_posts')
    .select('*')
    .eq('is_public', true)
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (error || !data) return { data, error };
  for (let post of data) {
    const { profile: creator, error: creatorError } = await fetchProfileById(post.creator_id, client);
    if (creatorError) return { data: null, error: creatorError };
    assignCreatorMeta(post, creator);

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id, client);
    if (joinRequestsError) return { data, error: joinRequestsError };
    post.join_requests = joinRequests;
    applyConduitMeta(post);
  }
  return { data, error };
}

const getLfgPostsByOthers = async (profileId, client = supabase) => {
  const today = moment().startOf('day').toISOString();
  const { data, error } = await client
    .from('lfg_posts')
    .select('*')
    .neq('creator_id', profileId)
    .eq('is_public', true)
    .eq('status', 'open')
    .gte('date', today)
    .order('created_at', { ascending: false });
  if (error || !data) return { data, error };
  for (let post of data) {
    const { profile: creator, error: creatorError } = await fetchProfileById(post.creator_id, client);
    if (creatorError) return { data: null, error: creatorError };
    assignCreatorMeta(post, creator);

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id, client);
    if (joinRequestsError) return { data, error: joinRequestsError };
    post.join_requests = joinRequests;
    applyConduitMeta(post);
  }
  return { data, error };
}

const getLfgPostsByCreator = async (creator_id, client = supabase) => {
  const { data, error } = await client
    .from('lfg_posts')
    .select('*')
    .eq('creator_id', creator_id)
    .order('created_at', { ascending: false });
  if (error || !data) return { data, error };
  for (let post of data) {
    const { profile: creator, error: creatorError } = await fetchProfileById(post.creator_id, client);
    if (creatorError) return { data: null, error: creatorError };
    assignCreatorMeta(post, creator);

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id, client);
    if (joinRequestsError) return { data, error: joinRequestsError };
    post.join_requests = joinRequests;
    applyConduitMeta(post);
    post.pending_request_count = (joinRequests || []).filter(r => r.status === 'pending').length;
  }
  return { data, error };
}

const getLfgPost = async (id, client = supabase) => {
  const { data, error } = await client
    .from('lfg_posts')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return { data, error };

  let post = data;
  const { profile: creator, error: creatorError } = await fetchProfileById(post.creator_id, client);
  if (creatorError) return { data: null, error: creatorError };
  assignCreatorMeta(post, creator);

  const { data: joinRequests, error: joinRequestsError } = await client
    .from('lfg_join_requests')
    .select(`
      *,
      profile:profile_id (id, name, is_public),
      character:character_id (
        id,
        name,
        class,
        level,
        is_public,
        is_deceased,
        ${statList.join(',')},
        personality:traits(name),
        abilities:class_abilities(name,description,class_id),
        gear:class_gear(name,description,class_id)
      )
    `)
    .eq('lfg_post_id', id);

  if (joinRequestsError) return { data: post, error: joinRequestsError };
  post.join_requests = joinRequests;
  applyConduitMeta(post);

  return { data: post, error };
}

// The service instance owns every write decision (authorization, role
// reconciliation, join-request moderation) independently of Supabase; the
// repository (services/lfg/repository.js) is the only lfg consumer of the
// service-role client. The compatibility functions below remain the
// route-facing API; mutations take `actor` (built by the caller via
// actorFromLocals/buildAgentActor, optionally extended with `timezone`).
// The agent surface always uses the role-stripped buildAgentActor (no
// role-based bypass), consistent across all six agent capabilities.
// Denials throw AuthorizationError.
const lfgService = new LfgService(lfgRepository);

// Converts a thrown AuthorizationError (or any other thrown error) into the
// same {status, code, message} shape the agent-scoped wrappers have always
// returned, so agent routes/tests never observe an unhandled rejection.
const toAgentError = (err) => {
  if (err instanceof AuthorizationError) {
    return { status: err.status, code: err.reason || 'forbidden', message: err.message };
  }
  if (err && typeof err === 'object' && err.status) {
    return { status: err.status, code: err.code, message: err.message };
  }
  return { status: 500, code: 'internal_error', message: (err && err.message) || 'Unexpected error' };
};

const buildAgentActor = (profileId) => ({ profileId, role: null });

const createLfgPost = async (actor, postReq) => lfgService.createPost(actor, postReq, { timezone: actor?.timezone });
const updateLfgPost = async (actor, id, postReq) => lfgService.updatePost(actor, id, postReq, { timezone: actor?.timezone });
const deleteLfgPost = async (actor, id) => lfgService.deletePost(actor, id);

// Preserves the exact positional signature relied on by routes/lfg.js (which
// passes the caller's own RLS-scoped `client` for the character-ownership
// read) and by models/lfg.test.js / models/lfg-agent.test.js. `profileId` is
// intentionally a bare id here, not an actor object; internally this builds
// the lightweight actor the policy layer needs.
const joinLfgPost = async (postId, profileId, joinType, characterId = null, client = supabase) =>
  lfgService.join(buildAgentActor(profileId), { postId, joinType, characterId, client });

const getLfgJoinRequests = async (postId, client = supabase) => {
  const { data, error } = await client
    .from('lfg_join_requests')
    .select(`
      *,
      profile:profile_id (id,name,is_public),
      character:character_id (id,name,is_public,is_deceased)
    `)
    .eq('lfg_post_id', postId);
  return { data, error };
}

const getLfgJoinRequestForUserAndPost = async (profileId, postId, client = supabase) => {
  const { data, error } = await client
    .from('lfg_join_requests')
    .select('*')
    .eq('lfg_post_id', postId)
    .eq('profile_id', profileId)
    .single();
  return { data, error };
}

// Keep lfg_posts.host_id in sync with the approved conduit join_request (if any).
// host_id is treated as a denormalized cache of "who is the approved conduit", needed by
// RLS policies (schema.sql) and by the character-view helper (routes/characters.js).
// All conduit state changes go through lfg_join_requests; this helper mirrors the result.
// Internal denormalization only — no policy check applies (see LfgService.syncConduitHostId).
const syncConduitHostId = (postId) => lfgService.syncConduitHostId(postId);

// Approve/reject a join request. Previously caller-enforced (routes/models
// checked host-ness before calling); the capability now verifies it itself.
const updateJoinRequest = async (actor, requestId, status, postId = null) =>
  lfgService.updateJoinRequest(actor, { requestId, status, postId });

// Withdraw/remove a join request (self-leave, or host moderation). Previously
// caller-enforced; the capability now verifies ownership/moderation itself.
const deleteJoinRequest = async (actor, requestId) => lfgService.leave(actor, requestId);

const getLfgJoinedPosts = async (profileId, client = supabase) => {
  const { data, error } = await client
    .from('lfg_join_requests')
    .select(`
      *,
      lfg_posts:lfg_post_id (*)
    `)
    .eq('profile_id', profileId);

  if (error) return { data: null, error };

  const joinedPosts = data.map(request => request.lfg_posts);

  for (let post of joinedPosts) {
    const { profile: creator, error: creatorError } = await fetchProfileById(post.creator_id, client);
    if (creatorError) return { data: null, error: creatorError };
    assignCreatorMeta(post, creator);

    const { data: joinRequests, error: joinRequestsError } = await getLfgJoinRequests(post.id, client);
    if (joinRequestsError) return { data: null, error: joinRequestsError };
    post.join_requests = joinRequests;
    applyConduitMeta(post);
  }

  return { data: joinedPosts, error: null };
}

// Not admin: called by util/auth.js with the request's own RLS client.
const getPendingJoinRequestCount = async (profileId, client = supabase) => {
  const { count, error } = await client
    .from('lfg_join_requests')
    .select('*, lfg_posts!inner(creator_id)', { count: 'exact', head: true })
    .eq('lfg_posts.creator_id', profileId)
    .eq('status', 'pending');
  return { count: count || 0, error };
}

// ─── Agent-scoped LFG wrappers ────────────────────────────────────────────────
// Every wrapper here keeps its historical {data, error} contract (never
// throws): the underlying service capabilities may throw AuthorizationError
// on a policy denial, so each wrapper catches and translates via
// toAgentError, preserving the exact status/code combinations the agent
// routes and models/lfg-agent.test.js depend on.

const listPostsForAgent = async ({ agentProfileId, scope = 'public', status = 'open' }) => {
  try {
    return await lfgService.listForAgent(buildAgentActor(agentProfileId), { scope, status });
  } catch (err) {
    return { data: null, error: toAgentError(err) };
  }
};

const getPostForAgent = async ({ agentProfileId, postId }) => {
  try {
    return await lfgService.getForAgent(buildAgentActor(agentProfileId), { postId });
  } catch (err) {
    return { data: null, error: toAgentError(err) };
  }
};

const createForAgent = async ({ agentProfile, body }) => {
  try {
    const actor = { ...buildAgentActor(agentProfile.id), timezone: agentProfile.timezone };
    const { data, error } = await createLfgPost(actor, body);
    if (error) return { data: null, error };
    return getPostForAgent({ agentProfileId: agentProfile.id, postId: data.id });
  } catch (err) {
    return { data: null, error: toAgentError(err) };
  }
};

const updateForAgent = async ({ agentProfile, postId, body }) => {
  try {
    const actor = { ...buildAgentActor(agentProfile.id), timezone: agentProfile.timezone };
    const { data, error } = await updateLfgPost(actor, postId, body);
    if (error) return { data: null, error };
    return getPostForAgent({ agentProfileId: agentProfile.id, postId });
  } catch (err) {
    return { data: null, error: toAgentError(err) };
  }
};

const closeForAgent = async ({ agentProfileId, postId }) => {
  try {
    const { data, error } = await lfgService.closePost(buildAgentActor(agentProfileId), postId);
    if (error) return { data: null, error };
    return getPostForAgent({ agentProfileId, postId: data.id });
  } catch (err) {
    return { data: null, error: toAgentError(err) };
  }
};

const deleteForAgent = async ({ agentProfile, postId }) => {
  try {
    const { error } = await lfgService.deletePost(buildAgentActor(agentProfile.id), postId);
    if (error) return { data: null, error };
    return { data: { deleted: true }, error: null };
  } catch (err) {
    return { data: null, error: toAgentError(err) };
  }
};

const joinForAgent = async ({ agentProfileId, postId, joinType, characterId }) => {
  try {
    return await lfgService.joinForAgent(buildAgentActor(agentProfileId), { postId, joinType, characterId });
  } catch (err) {
    return { data: null, error: toAgentError(err) };
  }
};

const leaveForAgent = async ({ agentProfileId, postId }) => {
  try {
    return await lfgService.leaveForAgent(buildAgentActor(agentProfileId), { postId });
  } catch (err) {
    return { data: null, error: toAgentError(err) };
  }
};

const updateRequestForAgent = async ({ agentProfileId, requestId, status }) => {
  try {
    return await lfgService.updateRequestForAgent(buildAgentActor(agentProfileId), { requestId, status });
  } catch (err) {
    return { data: null, error: toAgentError(err) };
  }
};

const listEligibleCharactersForAgent = async ({ agentProfileId }) => {
  try {
    return await lfgService.listEligibleCharactersForAgent(buildAgentActor(agentProfileId));
  } catch (err) {
    return { data: null, error: toAgentError(err) };
  }
};

module.exports = {
  fetchProfileById,
  getLfgPosts,
  getLfgPostsByCreator,
  getLfgPostsByOthers,
  getLfgJoinedPosts,
  getLfgPost,
  createLfgPost,
  updateLfgPost,
  deleteLfgPost,
  joinLfgPost,
  getLfgJoinRequests,
  getLfgJoinRequestForUserAndPost,
  updateJoinRequest,
  deleteJoinRequest,
  getPendingJoinRequestCount,
  syncConduitHostId,
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
};
