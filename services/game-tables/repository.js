// Game table queries. Every function takes the client to run with: the
// caller's RLS client for user writes, the service-role client for reads
// served by link and for the LFG roster sync. Inserts never chain .select():
// the participant SELECT policy cannot see the row being inserted.
const { statList } = require('../../util/enclave-consts');

const withResult = async (query) => {
  const { data, error } = await query;
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error: null };
};

// The only character columns a table ever shows. Seating a private
// character consents to exactly these, nothing more.
const CHARACTER_COLUMNS = `id, name, image_url, class, class_id, level, is_deceased, is_public, creator_id, ${statList.join(', ')}`;

const TABLE_SELECT = `id, name, creator_id, conduit_id, lfg_post_id, session_started_at, created_at,
  creator:creator_id (id, name),
  conduit:conduit_id (id, name),
  members:game_table_members (id, character_id, lfg_join_request_id, guest_name, guest_class_label, guest_stats, created_at,
    character:character_id (${CHARACTER_COLUMNS}))`;

// Approved player requests with their character's visibility: the sync
// seats only public characters, since seating a private one is its owner's call.
const listApprovedPlayers = async (postId, client) => {
  const result = await withResult(client.from('lfg_join_requests')
    .select('id, character_id, character:character_id (is_public)')
    .eq('lfg_post_id', postId)
    .eq('status', 'approved')
    .eq('join_type', 'player'));
  if (result.error) return result;
  const approved = (result.data || []).map(({ id, character_id, character }) =>
    ({ id, character_id, is_public: Boolean(character?.is_public) }));
  return { data: approved, error: null };
};

const getPostRoster = async (postId, client) => {
  const post = await withResult(client.from('lfg_posts').select('host_id').eq('id', postId).maybeSingle());
  if (post.error) return post;
  const approved = await listApprovedPlayers(postId, client);
  if (approved.error) return approved;
  return { data: { host_id: post.data?.host_id || null, approved: approved.data }, error: null };
};

const findTableIdByPostId = async (postId, client) => {
  const result = await withResult(client.from('game_tables').select('id').eq('lfg_post_id', postId).maybeSingle());
  return { data: result.data?.id || null, error: result.error };
};

module.exports = {
  CHARACTER_COLUMNS,
  loadTable: (id, client) => withResult(client.from('game_tables').select(TABLE_SELECT).eq('id', id).maybeSingle()),
  listTables: (client) => withResult(client.from('game_tables')
    .select('id, name, lfg_post_id, updated_at')
    .order('updated_at', { ascending: false })),
  insertTable: (row, client) => withResult(client.from('game_tables').insert(row)),
  updateTable: (id, patch, client) => withResult(client.from('game_tables').update(patch).eq('id', id)),
  deleteTable: (id, client) => withResult(client.from('game_tables').delete().eq('id', id)),
  insertMembers: (rows, client) => withResult(client.from('game_table_members').insert(rows)),
  updateMember: (id, patch, client) => withResult(client.from('game_table_members').update(patch).eq('id', id)),
  deleteMember: (id, client) => withResult(client.from('game_table_members').delete().eq('id', id)),
  deleteMembers: (ids, client) => withResult(client.from('game_table_members').delete().in('id', ids)),
  getCharacterSeatInfo: (id, client) => withResult(client.from('characters')
    .select('id, is_public, creator_id').eq('id', id).maybeSingle()),
  findTableIdByPostId,
  findLinkedTable: (postId, client) => withResult(client.from('game_tables')
    .select('id, creator_id, conduit_id, members:game_table_members (id, character_id, lfg_join_request_id)')
    .eq('lfg_post_id', postId).maybeSingle()),
  getPostRoster,
  listApprovedPlayers,
};
