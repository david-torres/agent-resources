const { supabaseAdmin } = require('../../models/_base');

// The only consumer of supabaseAdmin for the lfg domain. Holds every
// privileged (service-role) query; models/lfg.js keeps the surrounding logic
// (RLS-scoped reads, transforms, and the general-purpose `client` parameter
// used by joinLfgPost's character-ownership read, which is not privileged).
const withResult = async (query) => {
  const { data, error } = await query;
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error: null };
};

// Selection used by the agent-scoped post reads: the post plus its creator
// and every join request (with joiner profile + character), mirroring
// getLfgPost's shape closely enough for serializePostForAgent to consume.
const AGENT_POST_SELECT = '*, creator:creator_id(id,name), lfg_join_requests(*, profile:profile_id(id,name), character:character_id(*))';

module.exports = {
  // Verbatim from the former inline adapter in models/lfg.js.
  createPost: data => supabaseAdmin.from('lfg_posts').insert(data).select(),
  updatePost: (id, creatorId, data) => supabaseAdmin
    .from('lfg_posts').update(data).eq('id', id).eq('creator_id', creatorId).select(),
  getCreatorRequest: (profileId, postId) => supabaseAdmin
    .from('lfg_join_requests').select('*').eq('lfg_post_id', postId).eq('profile_id', profileId).single(),

  // New: privileged reads used by the policy-gated capabilities. A lighter
  // permission row than the full joined getLfgPost — only creator_id is
  // needed to decide canManagePost/canModerateJoinRequest.
  fetchPostPermissionRow: (postId) => withResult(
    supabaseAdmin.from('lfg_posts').select('id, creator_id').eq('id', postId).maybeSingle()
  ),
  deletePost: (id, creatorId) => supabaseAdmin
    .from('lfg_posts').delete().eq('id', id).eq('creator_id', creatorId),
  closePost: (id, creatorId) => supabaseAdmin
    .from('lfg_posts')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('creator_id', creatorId)
    .select()
    .maybeSingle(),

  // Join / join-request primitives (used by joinLfgPost's admin-only steps).
  getApprovedConduit: (postId) => supabaseAdmin
    .from('lfg_join_requests').select('id').eq('lfg_post_id', postId).eq('join_type', 'conduit').eq('status', 'approved').limit(1),
  getPostCreatorId: (postId) => supabaseAdmin
    .from('lfg_posts').select('creator_id').eq('id', postId).maybeSingle(),
  insertJoinRequest: (row) => supabaseAdmin.from('lfg_join_requests').insert(row).select(),

  // Conduit host_id denormalization sync (internal, no policy — see
  // syncConduitHostId in models/lfg.js).
  getApprovedConduitProfile: (postId) => supabaseAdmin
    .from('lfg_join_requests').select('profile_id').eq('lfg_post_id', postId).eq('join_type', 'conduit').eq('status', 'approved').maybeSingle(),
  updatePostHostId: async (postId, hostId) => {
    const { error } = await supabaseAdmin.from('lfg_posts').update({ host_id: hostId }).eq('id', postId);
    return { error };
  },

  // Join-request moderation/ownership primitives.
  fetchJoinRequestWithPost: (requestId) => withResult(
    supabaseAdmin
      .from('lfg_join_requests')
      .select('id, lfg_post_id, profile_id, post:lfg_post_id(creator_id)')
      .eq('id', requestId)
      .maybeSingle()
  ),
  getJoinRequestRow: (requestId) => withResult(
    supabaseAdmin
      .from('lfg_join_requests')
      .select('id, lfg_post_id, profile_id, character_id, join_type, status')
      .eq('id', requestId)
      .single()
  ),
  updateJoinRequestStatusRow: async (requestId, status, postId) => {
    let query = supabaseAdmin.from('lfg_join_requests').update({ status }).eq('id', requestId);
    if (postId) query = query.eq('lfg_post_id', postId);
    const { data, error } = await query;
    if (error) console.error(error);
    return { data, error };
  },
  deleteJoinRequestRow: async (requestId) => {
    const { data, error } = await supabaseAdmin.from('lfg_join_requests').delete().eq('id', requestId);
    if (error) console.error(error);
    return { data, error };
  },

  // Agent-surface reads.
  listPostsWithRequestsBy: async (filters, { status, dateFrom } = {}) => {
    let query = supabaseAdmin.from('lfg_posts').select(AGENT_POST_SELECT);
    for (const [key, value] of Object.entries(filters)) {
      query = query.eq(key, value);
    }
    if (status && status !== 'all') query = query.eq('status', status);
    if (dateFrom) query = query.gte('date', dateFrom);
    return query;
  },
  listJoinedPostIds: (profileId) => supabaseAdmin
    .from('lfg_join_requests').select('lfg_post_id').eq('profile_id', profileId).neq('status', 'rejected'),
  listPostsByIds: (ids, { status } = {}) => {
    let query = supabaseAdmin.from('lfg_posts').select(AGENT_POST_SELECT).in('id', ids);
    if (status && status !== 'all') query = query.eq('status', status);
    return query;
  },
  getPostForAgentRow: (postId) => supabaseAdmin
    .from('lfg_posts').select(AGENT_POST_SELECT).eq('id', postId).maybeSingle(),
  getCharacterForJoin: (characterId) => supabaseAdmin
    .from('characters').select('id, creator_id, is_deceased').eq('id', characterId).maybeSingle(),
  getExistingJoinRequest: (postId, profileId) => supabaseAdmin
    .from('lfg_join_requests').select('id, status').eq('lfg_post_id', postId).eq('profile_id', profileId).maybeSingle(),
  listEligibleCharacters: (profileId) => supabaseAdmin
    .from('characters')
    .select('id, name, class, level')
    .eq('creator_id', profileId)
    .eq('is_deceased', false)
    .order('name', { ascending: true }),

  AGENT_POST_SELECT
};
