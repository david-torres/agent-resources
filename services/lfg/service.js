const { normalizeLfgInput } = require('./input');

const REQUIRED_ADAPTER_METHODS = [
  'getPost', 'createPost', 'updatePost', 'getCreatorRequest',
  'deleteJoinRequest', 'joinPost'
];

/** Owns LFG write decisions; the adapter owns Supabase reads and writes. */
class LfgService {
  constructor(adapter) {
    const missing = REQUIRED_ADAPTER_METHODS.filter(method => typeof adapter?.[method] !== 'function');
    if (missing.length) throw new TypeError(`LfgService requires adapter methods: ${missing.join(', ')}`);
    this.adapter = adapter;
  }

  async createPost(input, actor) {
    const normalized = normalizeLfgInput(input, { creatorId: actor.id, timezone: actor.timezone });
    const created = await this.adapter.createPost(normalized.data);
    if (created.error || !created.data || created.data.length === 0) {
      return created.error ? { data: null, error: created.error } : { data: null, error: 'Failed to create LFG post' };
    }
    const post = created.data[0];
    const role = await this.reconcileCreatorRole(post.id, actor.id, normalized.role);
    if (role.error) return { data: null, error: role.error };
    return { data: post, error: null };
  }

  async updatePost(id, input, actor) {
    const existing = await this.adapter.getPost(id);
    if (existing.error || !existing.data) return { data: null, error: existing.error || 'LFG post not found' };
    if (existing.data.creator_id !== actor.id) return { data: null, error: 'Unauthorized' };

    const normalized = normalizeLfgInput(input, { timezone: actor.timezone });
    // Kept before the parent update to retain the historical outcome ordering.
    const role = await this.reconcileCreatorRole(id, actor.id, normalized.role);
    if (role.error) return { data: null, error: role.error };
    const updated = await this.adapter.updatePost(id, actor.id, normalized.data);
    if (updated.error) return { data: null, error: updated.error };
    if (!updated.data || updated.data.length === 0) return { data: null, error: 'Update returned no rows' };
    return { data: updated.data[0], error: null };
  }

  async reconcileCreatorRole(postId, profileId, { hostFlag, characterId }) {
    const desired = hostFlag ? { type: 'conduit', character: null }
      : (characterId ? { type: 'player', character: characterId } : null);
    if (!desired) return { error: null };
    const existing = await this.adapter.getCreatorRequest(profileId, postId);
    const request = existing.data;
    if (existing.error && existing.error.code !== 'PGRST116') return { error: existing.error };
    if (request && request.join_type === desired.type && request.character_id === desired.character) return { error: null };
    if (request) {
      const deleted = await this.adapter.deleteJoinRequest(request.id);
      if (deleted.error) return { error: deleted.error };
    }
    const joined = await this.adapter.joinPost(postId, profileId, desired.type, desired.character);
    return { error: joined.error || null };
  }
}

module.exports = { LfgService };
