const { normalizeLfgInput } = require('./input');
const { AuthorizationError } = require('../../util/errors');
const { isSystem } = require('../../util/actor');
const {
  canManagePost,
  canModerateJoinRequest,
  canJoinAsCharacter,
  canManageOwnJoinRequest
} = require('./policy');

const REQUIRED_REPOSITORY_METHODS = [
  'createPost', 'updatePost', 'getCreatorRequest', 'fetchPostPermissionRow',
  'deletePost', 'closePost', 'getApprovedConduit', 'getPostCreatorId', 'insertJoinRequest',
  'getApprovedConduitProfile', 'updatePostHostId', 'fetchJoinRequestWithPost', 'getJoinRequestRow',
  'updateJoinRequestStatusRow', 'deleteJoinRequestRow',
  'listPostsWithRequestsBy', 'listJoinedPostIds', 'listPostsByIds', 'getPostForAgentRow',
  'getCharacterForJoin', 'getExistingJoinRequest', 'listEligibleCharacters'
];

// I3 (carried over from the pre-refactor model): rename lfg_join_requests ->
// join_requests on agent-surface rows so serializePostForAgent has one shape
// to read regardless of which repository query produced the row.
const normalizeJoinRequests = (rows) => {
  for (const row of rows) {
    row.join_requests = row.lfg_join_requests || [];
    delete row.lfg_join_requests;
  }
  return rows;
};

const serializePostForAgent = (post, { agentProfileId, includePending }) => {
  const host = post.creator || post.host || {};
  // `&& r.character` matches the web UI's party filter (routes/lfg.js:102) and
  // is what makes lfg_join_requests_character_id_fkey's ON DELETE SET NULL
  // safe: deleting a character leaves its approved player rows in place with a
  // null character_id. Without this they serialise as ghost roster entries
  // ({character_id: null, name: null, ...}) AND inflate player_count -- a
  // published contract on GET /api/agent/lfg/posts[/:id] -- so the web UI
  // would show 0 players while the agent API reported 1.
  const roster = (post.join_requests || [])
    .filter((r) => r.status === 'approved' && r.join_type === 'player' && r.character)
    .map((r) => ({
      character_id: r.character_id,
      name: r.character?.name || null,
      class_name: r.character?.class || null,
      level: r.character?.level || null,
      profile_id: r.profile_id,
      profile_display_name: r.profile?.name || null
    }));
  const conduit = (post.join_requests || []).find(
    (r) => r.status === 'approved' && r.join_type === 'conduit'
  );
  const myRequest = (post.join_requests || []).find(
    (r) => r.profile_id === agentProfileId && r.status !== 'rejected'
  );
  const base = {
    id: post.id,
    title: post.title,
    description: post.description,
    date: post.date,
    host: { id: host.id, display_name: host.name },
    max_characters: post.max_characters,
    is_public: post.is_public,
    status: post.status,
    player_count: roster.length,
    has_conduit: !!conduit,
    roster,
    conduit: conduit
      ? { profile_id: conduit.profile_id, display_name: conduit.profile?.name || null }
      : null,
    my_request: myRequest
      ? { id: myRequest.id, join_type: myRequest.join_type, status: myRequest.status }
      : null
  };
  if (includePending && host.id === agentProfileId) {
    base.pending_requests = (post.join_requests || [])
      .filter((r) => r.status === 'pending')
      .map((r) => ({
        id: r.id,
        profile_id: r.profile_id,
        profile_display_name: r.profile?.name || null,
        join_type: r.join_type,
        character: r.character
          ? { id: r.character.id, name: r.character.name, class_name: r.character.class, level: r.character.level }
          : null
      }));
  }
  return base;
};

/** Coordinates LFG write decisions and authorization; the repository owns Supabase reads/writes. */
class LfgService {
  constructor(repository) {
    const missing = REQUIRED_REPOSITORY_METHODS.filter(method => typeof repository?.[method] !== 'function');
    if (missing.length) throw new TypeError(`LfgService requires repository methods: ${missing.join(', ')}`);
    this.repo = repository;
  }

  // No ownership check — the creator becomes the owner, unless the system
  // actor supplies an explicit creator_id (e.g. backfill/import flows).
  async createPost(actor, input, { timezone } = {}) {
    const creatorId = isSystem(actor) ? (input?.creator_id ?? actor?.profileId ?? null) : (actor?.profileId ?? null);
    const normalized = normalizeLfgInput(input, { creatorId, timezone });
    const created = await this.repo.createPost(normalized.data);
    if (created.error || !created.data || created.data.length === 0) {
      return created.error ? { data: null, error: created.error } : { data: null, error: 'Failed to create LFG post' };
    }
    const post = created.data[0];
    const role = await this.reconcileCreatorRole(post.id, actor, creatorId, normalized.role);
    if (role.error) return { data: null, error: role.error };
    return { data: post, error: null };
  }

  async updatePost(actor, id, input, { timezone } = {}) {
    const { data: existing, error: existingError } = await this.repo.fetchPostPermissionRow(id);
    if (existingError) return { data: null, error: existingError };
    if (!existing) return { data: null, error: { status: 404, code: 'not_found', message: 'LFG post not found' } };
    if (!canManagePost(actor, existing)) {
      throw new AuthorizationError('Not authorized to update this LFG post', { reason: 'not_host' });
    }

    const normalized = normalizeLfgInput(input, { timezone });
    // Kept before the parent update to retain the historical outcome ordering.
    const role = await this.reconcileCreatorRole(id, actor, existing.creator_id, normalized.role);
    if (role.error) return { data: null, error: role.error };
    const updated = await this.repo.updatePost(id, existing.creator_id, normalized.data);
    if (updated.error) return { data: null, error: updated.error };
    if (!updated.data || updated.data.length === 0) return { data: null, error: 'Update returned no rows' };
    return { data: updated.data[0], error: null };
  }

  async deletePost(actor, id) {
    const { data: post, error } = await this.repo.fetchPostPermissionRow(id);
    if (error) return { data: null, error };
    if (!post) return { data: null, error: { status: 404, code: 'not_found', message: 'LFG post not found' } };
    if (!canManagePost(actor, post)) {
      throw new AuthorizationError('Not authorized to delete this LFG post', { reason: 'not_host' });
    }
    return this.repo.deletePost(id, post.creator_id);
  }

  async closePost(actor, id) {
    const { data: post, error } = await this.repo.fetchPostPermissionRow(id);
    if (error) return { data: null, error };
    if (!post) return { data: null, error: { status: 404, code: 'not_found', message: 'Post not found' } };
    if (!canManagePost(actor, post)) {
      throw new AuthorizationError('Only the host can close this post', { reason: 'not_host' });
    }
    const result = await this.repo.closePost(id, post.creator_id);
    if (result.error) return { data: null, error: result.error };
    // Race guard: the row could have changed creator between the read above
    // and the write's .eq('creator_id', ...) filter.
    if (!result.data) throw new AuthorizationError('Only the host can close this post', { reason: 'not_host' });
    return { data: result.data, error: null };
  }

  // Shared join logic for both the web-facing joinLfgPost (which may pass a
  // caller-scoped `client` for the character-ownership read, preserving
  // pre-refactor behavior) and the agent surface (which always reads via the
  // repository/service-role client, since there is no user session to scope to).
  async join(actor, { postId, joinType, characterId, client } = {}) {
    if (joinType === 'player' && !characterId) {
      return { data: null, error: 'Character is required for player join' };
    }
    let resolvedCharacterId = characterId;
    if (joinType === 'player') {
      const { data: character, error: characterError } = client
        ? await client.from('characters').select('*').eq('id', characterId).single()
        : await this.repo.getCharacterForJoin(characterId);
      if (characterError) return { data: null, error: characterError };
      if (!canJoinAsCharacter(actor, character)) {
        // Ownership is checked before deceased status, matching the
        // pre-refactor joinLfgPost ordering: a non-owned, deceased character
        // must still surface the ownership message, not the deceased one.
        const ownsCharacter = !!character && actor?.profileId === character.creator_id;
        return {
          data: null,
          error: !ownsCharacter
            ? 'You can only join with your own character'
            : 'Deceased characters cannot join games'
        };
      }
    }
    if (joinType === 'conduit') resolvedCharacterId = null;

    if (joinType === 'conduit') {
      const { data: approvedConduit } = await this.repo.getApprovedConduit(postId);
      if (approvedConduit && approvedConduit.length > 0) {
        return { data: null, error: { status: 409, code: 'conduit_taken', message: 'Conduit slot is already filled' } };
      }
    }

    // Auto-approve when the joiner is the post's creator — they're picking a role for their own post.
    const { data: postRow } = await this.repo.getPostCreatorId(postId);
    const status = postRow?.creator_id === actor.profileId ? 'approved' : 'pending';

    const joinRequest = {
      lfg_post_id: postId,
      profile_id: actor.profileId,
      join_type: joinType,
      character_id: resolvedCharacterId,
      status
    };

    const { data, error } = await this.repo.insertJoinRequest(joinRequest);
    if (error) return { data, error };
    if (status === 'approved' && joinType === 'conduit') await this.syncConduitHostId(postId);
    return { data, error };
  }

  async reconcileCreatorRole(postId, actor, profileId, { hostFlag, characterId }) {
    const desired = hostFlag ? { type: 'conduit', character: null }
      : (characterId ? { type: 'player', character: characterId } : null);
    if (!desired) return { error: null };
    const existing = await this.repo.getCreatorRequest(profileId, postId);
    const request = existing.data;
    if (existing.error && existing.error.code !== 'PGRST116') return { error: existing.error };
    if (request && request.join_type === desired.type && request.character_id === desired.character) return { error: null };
    if (request) {
      const deleted = await this.repo.deleteJoinRequestRow(request.id);
      if (deleted.error) return { error: deleted.error };
    }
    // The role being reconciled always belongs to `profileId` (the post's
    // creator), which may differ from actor.profileId when a system actor
    // creates a post on another profile's behalf.
    const joinActor = { profileId, role: actor?.role };
    const joined = await this.join(joinActor, { postId, joinType: desired.type, characterId: desired.character });
    return { error: joined.error || null };
  }

  // Internal denormalization: keeps lfg_posts.host_id in sync with the
  // approved conduit join_request (if any). Not policy-gated — this is
  // system-triggered bookkeeping after an already-authorized mutation, never
  // a direct user command.
  async syncConduitHostId(postId) {
    const { data: approved } = await this.repo.getApprovedConduitProfile(postId);
    const newHostId = approved?.profile_id || null;
    return this.repo.updatePostHostId(postId, newHostId);
  }

  // Approve/reject a join request. Closes the previously caller-enforced gap:
  // the capability now verifies the actor is the post's host (or admin/system)
  // itself, rather than trusting the caller to have checked.
  async updateJoinRequest(actor, { requestId, status, postId = null }) {
    const { data: request, error } = await this.repo.fetchJoinRequestWithPost(requestId);
    if (error) return { data: null, error };
    if (!request) return { data: null, error: { status: 404, code: 'not_found', message: 'Request not found' } };
    if (!canModerateJoinRequest(actor, { creator_id: request.post?.creator_id })) {
      throw new AuthorizationError('Only the host can moderate join requests', { reason: 'not_host' });
    }
    const resolvedPostId = postId || request.lfg_post_id;
    const result = await this.repo.updateJoinRequestStatusRow(requestId, status, resolvedPostId);
    if (result.error) return { data: null, error: result.error };
    await this.syncConduitHostId(resolvedPostId);
    return result;
  }

  // Withdraw/remove a join request. Closes the previously caller-enforced gap:
  // the capability now verifies the actor owns the request (or is the post's
  // host/admin/system moderating it), rather than trusting the caller.
  async leave(actor, requestId) {
    const { data: request, error } = await this.repo.fetchJoinRequestWithPost(requestId);
    if (error) return { data: null, error };
    if (!request) return { data: null, error: { status: 404, code: 'not_found', message: 'Join request not found' } };
    const post = { creator_id: request.post?.creator_id };
    if (!canManageOwnJoinRequest(actor, request) && !canModerateJoinRequest(actor, post)) {
      throw new AuthorizationError('Not authorized to remove this join request', { reason: 'not_owner' });
    }
    const result = await this.repo.deleteJoinRequestRow(requestId);
    if (!result.error && request.lfg_post_id) await this.syncConduitHostId(request.lfg_post_id);
    return result;
  }

  // ─── Agent-scoped capabilities ─────────────────────────────────────────

  async listForAgent(actor, { scope = 'public', status = 'open' } = {}) {
    let rows;
    let error;
    if (scope === 'mine') {
      ({ data: rows, error } = await this.repo.listPostsWithRequestsBy({ creator_id: actor.profileId }, { status }));
    } else if (scope === 'joined') {
      const { data: joined, error: joinedErr } = await this.repo.listJoinedPostIds(actor.profileId);
      if (joinedErr) return { data: null, error: joinedErr };
      const ids = (joined || []).map((r) => r.lfg_post_id);
      if (ids.length === 0) return { data: [], error: null };
      ({ data: rows, error } = await this.repo.listPostsByIds(ids, { status }));
    } else {
      const cutoff = new Date();
      cutoff.setUTCHours(0, 0, 0, 0);
      cutoff.setUTCDate(cutoff.getUTCDate() - 14);
      ({ data: rows, error } = await this.repo.listPostsWithRequestsBy(
        { is_public: true },
        { status, dateFrom: cutoff.toISOString() }
      ));
    }
    if (error) return { data: null, error };
    normalizeJoinRequests(rows || []);
    const projected = (rows || []).map((p) => {
      const full = serializePostForAgent(p, { agentProfileId: actor.profileId, includePending: false });
      return {
        id: full.id,
        title: full.title,
        date: full.date,
        host: full.host,
        max_characters: full.max_characters,
        is_public: full.is_public,
        status: full.status,
        player_count: full.player_count,
        has_conduit: full.has_conduit,
        my_request_status: full.my_request?.status || null
      };
    });
    return { data: projected, error: null };
  }

  async getForAgent(actor, { postId }) {
    const { data: raw, error } = await this.repo.getPostForAgentRow(postId);
    if (error) return { data: null, error };
    if (!raw) return { data: null, error: { status: 404, code: 'not_found', message: 'Post not found' } };
    raw.join_requests = raw.lfg_join_requests || [];
    delete raw.lfg_join_requests;
    return {
      data: serializePostForAgent(raw, { agentProfileId: actor.profileId, includePending: true }),
      error: null
    };
  }

  async joinForAgent(actor, { postId, joinType, characterId }) {
    if (joinType === 'player') {
      if (!characterId) {
        return { data: null, error: { status: 400, code: 'character_required', message: 'Player joins require a character' } };
      }
      const { data: character, error: charErr } = await this.repo.getCharacterForJoin(characterId);
      if (charErr) return { data: null, error: charErr };
      if (!canJoinAsCharacter(actor, character)) {
        return { data: null, error: { status: 400, code: 'character_ineligible', message: 'Character is deceased or not yours' } };
      }
    }

    const { data: existing, error: existingErr } = await this.repo.getExistingJoinRequest(postId, actor.profileId);
    if (existingErr) return { data: null, error: existingErr };
    if (existing && existing.status !== 'rejected') {
      return { data: null, error: { status: 409, code: 'duplicate_request', message: 'You already have a request on this post' } };
    }

    if (joinType === 'conduit') {
      const { data: conduitRequests, error: conduitErr } = await this.repo.getApprovedConduit(postId);
      if (conduitErr) return { data: null, error: conduitErr };
      if (conduitRequests && conduitRequests.length > 0) {
        return { data: null, error: { status: 409, code: 'conduit_taken', message: 'Conduit slot is already filled' } };
      }
    }

    const { data: request, error } = await this.join(actor, { postId, joinType, characterId: characterId || null });
    if (error) return { data: null, error };
    const post = await this.getForAgent(actor, { postId });
    if (post.error) return { data: null, error: post.error };
    return { data: { request, post: post.data }, error: null };
  }

  async leaveForAgent(actor, { postId }) {
    const { data: existing, error } = await this.repo.getExistingJoinRequest(postId, actor.profileId);
    if (error) return { data: null, error };
    if (!existing) {
      const post = await this.getForAgent(actor, { postId });
      if (post.error) return { data: null, error: post.error };
      return { data: { deleted: false, post: post.data }, error: null };
    }
    const result = await this.leave(actor, existing.id);
    if (result.error) return result;
    const post = await this.getForAgent(actor, { postId });
    if (post.error) return { data: null, error: post.error };
    return { data: { deleted: true, post: post.data }, error: null };
  }

  async updateRequestForAgent(actor, { requestId, status }) {
    if (status !== 'approved' && status !== 'rejected') {
      return { data: null, error: { status: 400, code: 'invalid_status', message: 'status must be approved or rejected' } };
    }
    const updateResult = await this.updateJoinRequest(actor, { requestId, status });
    if (updateResult.error) return updateResult;
    const { data: updatedRequest, error: fetchErr } = await this.repo.getJoinRequestRow(requestId);
    if (fetchErr) return { data: null, error: fetchErr };
    const post = await this.getForAgent(actor, { postId: updatedRequest.lfg_post_id });
    if (post.error) return { data: null, error: post.error };
    return { data: { request: updatedRequest, post: post.data }, error: null };
  }

  async listEligibleCharactersForAgent(actor) {
    const { data, error } = await this.repo.listEligibleCharacters(actor.profileId);
    if (error) return { data: null, error };
    return {
      data: (data || []).map((c) => ({ id: c.id, name: c.name, class_name: c.class, level: c.level })),
      error: null
    };
  }
}

module.exports = { LfgService };
