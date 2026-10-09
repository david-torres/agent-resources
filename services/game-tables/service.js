// Every game table rule that is not pure validation (services/game-tables/policy.js):
// loading a table for any viewer, who may change it, the seat cap, and keeping an
// LFG-linked table in step with its post's approved roster.
//
// Tables are read with the service-role client because a link is a capability:
// anyone holding it may view, signed in or not. Each user write first checks
// permission here, then runs through the caller's own RLS client, so the
// database rejects anything this layer misses. Roster sync is system
// bookkeeping and writes with the service-role client.
const crypto = require('crypto');
const { summarizeParty, PARTY_CAP } = require('../../util/party-stats');
const { FRIENDLY_NOT_FOUND } = require('../../util/http-error');
const { normalizeGuestInput, normalizeTableName, toDisplayMember, capabilitiesFor, TABLE_NAME_MAX } = require('./policy');

const REQUIRED_REPOSITORY_METHODS = [
  'loadTable', 'listTables', 'insertTable', 'updateTable', 'deleteTable', 'insertMembers', 'updateMember',
  'deleteMember', 'deleteMembers', 'getCharacterSeatInfo', 'findTableIdByPostId', 'findLinkedTable', 'getPostRoster',
];

const notFound = () => ({ status: 404, code: 'not_found', message: FRIENDLY_NOT_FOUND });
const forbidden = (message) => ({ status: 403, code: 'forbidden', title: 'No access', message });
const invalid = (message) => ({ status: 400, code: 'invalid', title: 'Invalid submission', message });
const tableFull = () => invalid(`A table seats at most ${PARTY_CAP}.`);

class GameTableService {
  constructor(repository, { systemClient, newId = () => crypto.randomUUID() } = {}) {
    const missing = REQUIRED_REPOSITORY_METHODS.filter((method) => typeof repository?.[method] !== 'function');
    if (missing.length) throw new TypeError(`GameTableService requires repository methods: ${missing.join(', ')}`);
    this.repo = repository;
    this.system = systemClient;
    this.newId = newId;
  }

  async load(tableId, actor) {
    const { data: table, error } = await this.repo.loadTable(tableId, this.system);
    if (error) return { data: null, error };
    if (!table) return { data: null, error: notFound() };

    const capabilities = capabilitiesFor(table, actor);
    const profileId = actor?.profileId || null;
    const members = [...(table.members || [])]
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((row) => toDisplayMember(row, profileId))
      .map((member) => ({
        ...member,
        canRemove: capabilities.canManage || (Boolean(profileId) && member.ownerId === profileId),
        canEdit: capabilities.canManage && member.isGuest,
      }));

    return {
      data: { table, members, summary: summarizeParty(members), capabilities, isFull: members.length >= PARTY_CAP },
      error: undefined,
    };
  }

  listFor(client) {
    return this.repo.listTables(client);
  }

  async create(actor, { name, characterIds = [] } = {}, client) {
    if (!actor?.profileId) return { data: null, error: forbidden('Sign in to save a table.') };
    const named = normalizeTableName(name);
    if (named.error) return { data: null, error: invalid(named.error) };

    const id = this.newId();
    const inserted = await this.repo.insertTable(
      { id, name: named.name, creator_id: actor.profileId, conduit_id: actor.profileId }, client);
    if (inserted.error) return { data: null, error: inserted.error };

    const seats = [...new Set(characterIds)].slice(0, PARTY_CAP).map((characterId) => ({ table_id: id, character_id: characterId }));
    if (seats.length) {
      const seated = await this.repo.insertMembers(seats, client);
      if (seated.error) return { data: { id }, error: seated.error };
    }
    return { data: { id }, error: undefined };
  }

  async rename(actor, tableId, name, client) {
    const view = await this.load(tableId, actor);
    if (view.error) return view;
    if (!view.data.capabilities.isCreator) return { data: null, error: forbidden('Only the table\'s creator can rename it.') };
    const named = normalizeTableName(name);
    if (named.error) return { data: null, error: invalid(named.error) };
    const updated = await this.repo.updateTable(tableId, { name: named.name }, client);
    return { data: null, error: updated.error || undefined };
  }

  async destroy(actor, tableId, client) {
    const view = await this.load(tableId, actor);
    if (view.error) return view;
    if (!view.data.capabilities.isCreator) return { data: null, error: forbidden('Only the table\'s creator can delete it.') };
    const deleted = await this.repo.deleteTable(tableId, client);
    return { data: null, error: deleted.error || undefined };
  }

  async seatCharacter(actor, tableId, characterId, client) {
    const view = await this.load(tableId, actor);
    if (view.error) return view;
    const { capabilities, members, isFull } = view.data;
    if (!capabilities.signedIn) return { data: null, error: forbidden('Sign in to seat a character.') };
    if (members.some((member) => !member.isGuest && member.id === characterId)) return view;
    if (isFull) return { data: null, error: tableFull() };

    const { data: character, error } = await this.repo.getCharacterSeatInfo(characterId, this.system);
    if (error) return { data: null, error };
    if (!character) return { data: null, error: notFound() };
    const ownsIt = character.creator_id === actor.profileId;
    if (!ownsIt && !(capabilities.canManage && character.is_public)) {
      return { data: null, error: forbidden('You can seat your own characters; the table\'s creator or Conduit can also seat public ones.') };
    }

    const seated = await this.repo.insertMembers([{ table_id: tableId, character_id: characterId }], client);
    if (seated.error) return { data: null, error: seated.error };
    return this.load(tableId, actor);
  }

  async addGuest(actor, tableId, body, client) {
    const view = await this.load(tableId, actor);
    if (view.error) return view;
    if (!view.data.capabilities.canManage) return { data: null, error: forbidden('Only the table\'s creator or Conduit can add unregistered characters.') };
    if (view.data.isFull) return { data: null, error: tableFull() };
    const guest = normalizeGuestInput(body);
    if (guest.errors) return { data: null, error: invalid(guest.errors.join(' ')) };
    const inserted = await this.repo.insertMembers([{ table_id: tableId, ...guest.data }], client);
    if (inserted.error) return { data: null, error: inserted.error };
    return this.load(tableId, actor);
  }

  async guestFor(actor, tableId, memberId) {
    const view = await this.load(tableId, actor);
    if (view.error) return view;
    if (!view.data.capabilities.canManage) return { data: null, error: forbidden('Only the table\'s creator or Conduit can edit unregistered characters.') };
    const member = view.data.members.find((m) => m.memberId === memberId && m.isGuest);
    if (!member) return { data: null, error: notFound() };
    return { data: member, error: undefined };
  }

  async editGuest(actor, tableId, memberId, body, client) {
    const found = await this.guestFor(actor, tableId, memberId);
    if (found.error) return found;
    const guest = normalizeGuestInput(body);
    if (guest.errors) return { data: null, error: invalid(guest.errors.join(' ')) };
    const updated = await this.repo.updateMember(memberId, guest.data, client);
    if (updated.error) return { data: null, error: updated.error };
    return this.load(tableId, actor);
  }

  async removeMember(actor, tableId, memberId, client) {
    const view = await this.load(tableId, actor);
    if (view.error) return view;
    const member = view.data.members.find((m) => m.memberId === memberId);
    if (!member) return { data: null, error: notFound() };
    if (!member.canRemove) return { data: null, error: forbidden('You can remove your own characters; the table\'s creator or Conduit can remove anyone.') };
    const deleted = await this.repo.deleteMember(memberId, client);
    if (deleted.error) return { data: null, error: deleted.error };
    return this.load(tableId, actor);
  }

  async openForPost(actor, post) {
    const profileId = actor?.profileId || null;
    const runsPost = Boolean(profileId) && (post.creator_id === profileId || post.host_id === profileId);
    if (!runsPost && actor?.role !== 'admin') {
      return { data: null, error: forbidden('Only the post\'s creator or Conduit can open its table.') };
    }

    const existing = await this.repo.findTableIdByPostId(post.id, this.system);
    if (existing.error) return { data: null, error: existing.error };
    if (existing.data) return { data: { id: existing.data }, error: undefined };

    const id = this.newId();
    const name = String(post.title || '').trim().slice(0, TABLE_NAME_MAX) || 'Game night';
    const inserted = await this.repo.insertTable(
      { id, name, creator_id: profileId, conduit_id: post.host_id || profileId, lfg_post_id: post.id }, this.system);
    if (inserted.error) {
      // Two clicks raced; the unique lfg_post_id kept one table. Use it.
      if (inserted.error.code === '23505') {
        const winner = await this.repo.findTableIdByPostId(post.id, this.system);
        if (winner.data) return { data: { id: winner.data }, error: undefined };
      }
      return { data: null, error: inserted.error };
    }

    const synced = await this.syncLinkedTable(post.id);
    if (synced.error) return { data: { id }, error: synced.error };
    return { data: { id }, error: undefined };
  }

  // Seats approved player characters the table lacks (while seats remain) and
  // unseats any it seated for a request that is no longer approved. Seats it
  // did not make -- guests, characters seated by hand -- are never touched.
  async syncLinkedTable(postId) {
    const linked = await this.repo.findLinkedTable(postId, this.system);
    if (linked.error) return { data: null, error: linked.error };
    const table = linked.data;
    if (!table) return { data: null, error: undefined };

    const roster = await this.repo.getPostRoster(postId, this.system);
    if (roster.error) return { data: null, error: roster.error };
    const approved = (roster.data?.approved || []).filter((request) => request.character_id);
    const approvedIds = new Set(approved.map((request) => request.id));
    const members = table.members || [];

    const stale = members.filter((m) => m.lfg_join_request_id && !approvedIds.has(m.lfg_join_request_id)).map((m) => m.id);
    if (stale.length) {
      const removed = await this.repo.deleteMembers(stale, this.system);
      if (removed.error) return { data: null, error: removed.error };
    }

    const remaining = members.filter((m) => !stale.includes(m.id));
    const seatedRequestIds = new Set(remaining.map((m) => m.lfg_join_request_id).filter(Boolean));
    const seatedCharacterIds = new Set(remaining.map((m) => m.character_id).filter(Boolean));
    let room = PARTY_CAP - remaining.length;
    const toSeat = [];
    for (const request of approved) {
      if (room <= 0) break;
      if (seatedRequestIds.has(request.id) || seatedCharacterIds.has(request.character_id)) continue;
      toSeat.push({ table_id: table.id, character_id: request.character_id, lfg_join_request_id: request.id });
      seatedCharacterIds.add(request.character_id);
      room -= 1;
    }
    if (toSeat.length) {
      const seated = await this.repo.insertMembers(toSeat, this.system);
      if (seated.error) return { data: null, error: seated.error };
    }

    const conduitId = roster.data?.host_id || table.creator_id;
    if (conduitId !== table.conduit_id) {
      const updated = await this.repo.updateTable(table.id, { conduit_id: conduitId }, this.system);
      if (updated.error) return { data: null, error: updated.error };
    }
    return { data: { id: table.id }, error: undefined };
  }
}

module.exports = { GameTableService };
