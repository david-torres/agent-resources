// Every game table rule that is not pure validation (services/game-tables/policy.js):
// loading a table for any viewer, who may change it, the seat cap, and keeping an
// LFG-linked table in step with its post's approved roster.
//
// Tables are read with the service-role client because a link is a capability:
// anyone holding it may view, signed in or not. Each user write first checks
// permission here, then runs through the caller's own RLS client as a second
// guard: a disallowed insert is rejected, while a disallowed update or delete
// matches no rows and silently changes nothing. Roster sync is system
// bookkeeping and writes with the service-role client.
const crypto = require('crypto');
const { summarizeParty, PARTY_CAP } = require('../../util/party-stats');
const { FRIENDLY_NOT_FOUND } = require('../../util/http-error');
const { applyAction, stateFromRow, stateToColumns, snapshotOf, emptyState } = require('../../util/exertion');
const { sourcesFor } = require('../../util/source-meters');
const { buildTrackerView } = require('./tracker-view');
const { normalizeGuestInput, normalizeTableName, toDisplayMember, capabilitiesFor, TABLE_NAME_MAX } = require('./policy');

const REQUIRED_REPOSITORY_METHODS = [
  'loadTable', 'listTables', 'insertTable', 'updateTable', 'deleteTable', 'insertMembers', 'updateMember',
  'deleteMember', 'deleteMembers', 'getCharacterSeatInfo', 'findTableIdByPostId', 'findLinkedTable', 'getPostRoster',
  'listApprovedPlayers', 'listStates', 'getState', 'updateState', 'setSessionStarted',
];

const notFound = () => ({ status: 404, code: 'not_found', message: FRIENDLY_NOT_FOUND });
const forbidden = (message) => ({ status: 403, code: 'forbidden', title: 'No access', message });
const invalid = (message) => ({ status: 400, code: 'invalid', title: 'Invalid submission', message });
const conflict = (message) => ({ status: 409, code: 'conflict', title: 'Changed elsewhere', message });
const undoUnavailable = (row) => conflict(`Changed by ${row.updater?.name || 'someone else'} since \u2014 undo unavailable.`);
const RESET_ATTEMPTS = 3;
const tableFull = () => invalid(`A table seats at most ${PARTY_CAP}.`);
const VERSION_CONFLICT = '55P03';
const SEAT_CAP_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const seatError = (error) => (error.code === SEAT_CAP_VIOLATION ? tableFull() : error);

// The toast after an action: short, and naming what changed.
const describeAction = (action, sources, member) => {
  const source = sources.find((s) => s.key === action.source);
  const who = member.name;
  const pool = action.pool === 'essence' ? 'Essence' : 'Stamina';
  switch (action.type) {
    case 'use': return `${who} used ${source?.name || 'a source'}${action.level ? ` (${action.level})` : ''}.`;
    case 'spend': return `${who} spent ${action.amount} ${pool}.`;
    case 'restore': return `${who} restored ${action.amount === 'Threshold' ? 'a Threshold of' : action.amount} ${pool}.`;
    case 'set': return `${who}'s ${pool} set.`;
    case 'toggle_cooldown': return `${source?.name || 'Cooldown'} cooldown toggled.`;
    case 'impose': return `Limiter imposed on ${source?.name || 'a source'}.`;
    case 'lift': return `Limiter lifted from ${source?.name || 'a source'}.`;
    case 'undo': return 'Undone.';
    default: return 'Updated.';
  }
};

class GameTableService {
  constructor(repository, { systemClient, newId = () => crypto.randomUUID(), loadCharacter = async () => ({ data: null }) } = {}) {
    const missing = REQUIRED_REPOSITORY_METHODS.filter((method) => typeof repository?.[method] !== 'function');
    if (missing.length) throw new TypeError(`GameTableService requires repository methods: ${missing.join(', ')}`);
    this.repo = repository;
    this.system = systemClient;
    this.newId = newId;
    this.loadCharacter = loadCharacter;
  }

  async load(tableId, actor, { withUnseated = true } = {}) {
    const { data: table, error } = await this.repo.loadTable(tableId, this.system);
    if (error) return { data: null, error };
    if (!table) return { data: null, error: notFound() };

    const capabilities = capabilitiesFor(table, actor);
    const profileId = actor?.profileId || null;
    const members = [...(table.members || [])]
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
      .map((row) => toDisplayMember(row, profileId))
      .map((member) => ({
        ...member,
        canRemove: capabilities.canManage || (Boolean(profileId) && member.ownerId === profileId),
        canEdit: capabilities.canManage && member.isGuest,
      }));

    return {
      data: {
        table, members, summary: summarizeParty(members), capabilities, isFull: members.length >= PARTY_CAP,
        unseatedApproved: withUnseated ? await this.countUnseatedApproved(table, members) : 0,
      },
      error: undefined,
    };
  }

  // Approved LFG players whose character is not at the table: private
  // characters the sync leaves for their owners to seat, or a full table.
  async countUnseatedApproved(table, members) {
    if (!table.lfg_post_id) return 0;
    const { data: approved } = await this.repo.listApprovedPlayers(table.lfg_post_id, this.system);
    const seatedIds = new Set(members.filter((member) => !member.isGuest).map((member) => member.id));
    return (approved || []).filter((request) => request.character_id && !seatedIds.has(request.character_id)).length;
  }

  // Who may change a member's tracker: its character's owner, or the
  // table's creator/Conduit (the only ones who can for a guest).
  canTrack(capabilities, member, actor) {
    return capabilities.canManage || (Boolean(actor?.profileId) && member.ownerId === actor.profileId);
  }

  async trackerContext(member) {
    if (member.isGuest) return { stats: member, sources: sourcesFor(null) };
    const { data: character, error } = await this.loadCharacter(member.id);
    if (error) return { error };
    return { stats: member, sources: sourcesFor(character) };
  }

  trackerViewFor(view, member, row, context, actor) {
    return buildTrackerView({
      state: row ? stateFromRow(row) : emptyState(),
      version: row?.version ?? 0,
      sources: context.sources,
      stats: context.stats,
      canTrack: this.canTrack(view.capabilities, member, actor),
      isConduit: view.capabilities.isConduit,
      actionUrl: `/tables/${view.table.id}/members/${member.memberId}/actions`,
    });
  }

  async trackers(view, actor) {
    const { data: rows, error } = await this.repo.listStates(view.table.id, this.system);
    if (error) return { data: null, error };
    const byMember = new Map((rows || []).map((row) => [row.member_id, row]));
    const entries = await Promise.all(view.members.map(async (member) => {
      const context = await this.trackerContext(member);
      if (context.error) {
        console.error(context.error);
        return null;
      }
      return [member.memberId, this.trackerViewFor(view, member, byMember.get(member.memberId), context, actor)];
    }));
    return { data: new Map(entries.filter(Boolean)), error: undefined };
  }

  async tracker(actor, tableId, memberId, { sinceVersion } = {}) {
    let polled;
    // An unchanged poll costs one query. A row at this table is proof the
    // member sits here, so the table load is only for the full path.
    if (typeof sinceVersion === 'number') {
      polled = await this.repo.getState(memberId, this.system);
      if (polled.error) return { data: null, error: polled.error };
      if (!polled.data) return { data: null, error: notFound() };
      if (polled.data.table_id === tableId && polled.data.version === sinceVersion) {
        return { data: { unchanged: true, version: sinceVersion }, error: undefined };
      }
    }
    const loaded = await this.load(tableId, actor, { withUnseated: false });
    if (loaded.error) return loaded;
    const member = loaded.data.members.find((m) => m.memberId === memberId);
    if (!member) return { data: null, error: notFound() };
    const { data: row, error } = polled || await this.repo.getState(memberId, this.system);
    if (error) return { data: null, error };
    const context = await this.trackerContext(member);
    if (context.error) return { data: null, error: context.error };
    return { data: { tracker: this.trackerViewFor(loaded.data, member, row, context, actor), member, tableId }, error: undefined };
  }

  async act(actor, tableId, memberId, action, client) {
    const loaded = await this.load(tableId, actor, { withUnseated: false });
    if (loaded.error) return loaded;
    const view = loaded.data;
    const member = view.members.find((m) => m.memberId === memberId);
    if (!member) return { data: null, error: notFound() };
    if (!this.canTrack(view.capabilities, member, actor)) {
      return { data: null, error: forbidden('Only the character\'s owner or the table\'s creator or Conduit can change this tracker.') };
    }
    if ((action.type === 'impose' || action.type === 'lift') && !view.capabilities.isConduit) {
      return { data: null, error: forbidden('Only the Conduit imposes or lifts Limiters.') };
    }
    const context = await this.trackerContext(member);
    if (context.error) return { data: null, error: context.error };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data: row, error } = await this.repo.getState(memberId, this.system);
      if (error) return { data: null, error };
      if (!row) return { data: null, error: notFound() };
      const current = stateFromRow(row);

      let next;
      if (action.type === 'undo') {
        if (Number(action.version) !== row.version) {
          return { data: null, error: undoUnavailable(row) };
        }
        if (!row.undo) return { data: null, error: invalid('Nothing to undo.') };
        next = stateFromRow(row.undo);
        if (!view.capabilities.isConduit) next.imposedLimiters = current.imposedLimiters;
      } else {
        const result = applyAction(current, action, context);
        if (result.error) return { data: null, error: invalid(result.error) };
        next = result.state;
      }

      const version = row.version + 1;
      const patch = {
        ...stateToColumns(next),
        undo: action.type === 'undo' ? null : snapshotOf(current),
        version,
        updated_by: actor.profileId,
        updated_at: new Date().toISOString(),
      };
      const updated = await this.repo.updateState(memberId, row.version, patch, client);
      if (updated.error && updated.error.code !== VERSION_CONFLICT) return { data: null, error: updated.error };
      if (updated.data?.length) {
        const fresh = { ...row, ...patch };
        return {
          data: {
            tracker: this.trackerViewFor(view, member, fresh, context, actor),
            member,
            tableId,
            acted: { message: describeAction(action, context.sources, member), undoable: action.type !== 'undo', version },
          },
          error: undefined,
        };
      }
      if (action.type === 'undo') {
        const { data: latest } = await this.repo.getState(memberId, this.system);
        return { data: null, error: undoUnavailable(latest || row) };
      }
    }
    return { data: null, error: conflict('Someone else changed this tracker at the same moment. Try again.') };
  }

  async newSession(actor, tableId) {
    const loaded = await this.load(tableId, actor);
    if (loaded.error) return loaded;
    if (!loaded.data.capabilities.canManage) return { data: null, error: forbidden('Only the table\'s creator or Conduit can start a new session.') };
    const { data: rows, error } = await this.repo.listStates(tableId, this.system);
    if (error) return { data: null, error };
    const reset = { ...stateToColumns(emptyState()), undo: null, updated_by: actor.profileId, updated_at: new Date().toISOString() };
    let unreset = false;
    for (const listed of rows || []) {
      let row = listed;
      let done = false;
      for (let attempt = 0; attempt < RESET_ATTEMPTS && !done; attempt += 1) {
        if (attempt > 0) {
          const fresh = await this.repo.getState(row.member_id, this.system);
          if (fresh.error) return { data: null, error: fresh.error };
          if (!fresh.data) { done = true; break; }
          row = fresh.data;
        }
        const updated = await this.repo.updateState(row.member_id, row.version, { ...reset, version: row.version + 1 }, this.system);
        if (updated.error && updated.error.code !== VERSION_CONFLICT) return { data: null, error: updated.error };
        done = Boolean(updated.data?.length);
      }
      if (!done) unreset = true;
    }
    if (unreset) return { data: null, error: conflict('A tracker changed while the session was resetting. Try again.') };
    const stamped = await this.repo.setSessionStarted(tableId, new Date().toISOString(), this.system);
    return { data: null, error: stamped.error || undefined };
  }

  listFor(client) {
    return this.repo.listTables(client);
  }

  async create(actor, { name, characterIds, guests = [] } = {}, client) {
    if (!actor?.profileId) return { data: null, error: forbidden('Sign in to save a table.') };
    const named = normalizeTableName(name);
    if (named.error) return { data: null, error: invalid(named.error) };

    const guestRows = [];
    if (!Array.isArray(guests)) return { data: null, error: invalid('Invalid unregistered characters.') };
    for (const guest of guests) {
      const result = normalizeGuestInput(guest);
      if (result.errors) return { data: null, error: invalid(result.errors.join(' ')) };
      guestRows.push(result.data);
    }
    const id = this.newId();
    const inserted = await this.repo.insertTable(
      { id, name: named.name, creator_id: actor.profileId, conduit_id: actor.profileId }, client);
    if (inserted.error) return { data: null, error: inserted.error };

    const seats = [...new Set(Array.isArray(characterIds) ? characterIds : [])].slice(0, PARTY_CAP).map((characterId) => ({ table_id: id, character_id: characterId }));
    seats.push(...guestRows.slice(0, PARTY_CAP - seats.length).map((guest) => ({ table_id: id, ...guest })));
    if (seats.length) {
      const seated = await this.repo.insertMembers(seats, client);
      if (seated.error) return { data: { id }, error: seatError(seated.error) };
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
    if (seated.error) return { data: null, error: seatError(seated.error) };
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
    if (inserted.error) return { data: null, error: seatError(inserted.error) };
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
      { id, name, creator_id: post.creator_id, conduit_id: post.host_id || post.creator_id, lfg_post_id: post.id }, this.system);
    if (inserted.error) {
      // Two clicks raced; the unique lfg_post_id kept one table. Use it.
      if (inserted.error.code === UNIQUE_VIOLATION) {
        const winner = await this.repo.findTableIdByPostId(post.id, this.system);
        if (winner.data) return { data: { id: winner.data }, error: undefined };
      }
      return { data: null, error: inserted.error };
    }

    const synced = await this.syncLinkedTable(post.id);
    if (synced.error) return { data: { id }, error: synced.error };
    return { data: { id }, error: undefined };
  }

  findTableIdForPost(postId) {
    return this.repo.findTableIdByPostId(postId, this.system);
  }

  // Seats approved players' public characters the table lacks (while seats
  // remain) and unseats any it seated for a request that is no longer
  // approved. Seats it did not make -- guests, characters seated by hand --
  // are never touched.
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
      if (!request.is_public) continue;
      if (seatedRequestIds.has(request.id) || seatedCharacterIds.has(request.character_id)) continue;
      toSeat.push({ table_id: table.id, character_id: request.character_id, lfg_join_request_id: request.id });
      seatedCharacterIds.add(request.character_id);
      room -= 1;
    }
    // One row at a time, so a seat a concurrent sync already made (23505)
    // does not cost the others theirs.
    for (const row of toSeat) {
      const seated = await this.repo.insertMembers([row], this.system);
      if (seated.error?.code === SEAT_CAP_VIOLATION) break;
      if (seated.error && seated.error.code !== UNIQUE_VIOLATION) return { data: null, error: seated.error };
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
