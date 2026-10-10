// GameTableService: who may change a table, the cap, and the LFG roster sync.
// A fake repository records writes so each rule is checked without a database.
const { test, expect } = require('bun:test');
const { GameTableService } = require('./service');

const USER = { profileId: 'player' };
const CREATOR = { profileId: 'creator' };
const STRANGER = { profileId: 'stranger' };
const USER_CLIENT = { name: 'user-client' };
const SYSTEM = { name: 'system-client' };

// Members are shown in seating order (created_at); each fixture is seated
// after the one built before it.
let tick = 0;
const seatedAt = () => `2026-10-09T00:00:${String(++tick).padStart(2, '0')}Z`;
const seat = (id, characterId, ownerId, extra = {}) => ({
  id, character_id: characterId, lfg_join_request_id: null, created_at: seatedAt(),
  character: { id: characterId, name: characterId, creator_id: ownerId, is_public: true }, ...extra,
});
const guest = (id) => ({ id, character_id: null, lfg_join_request_id: null, created_at: seatedAt(), guest_name: id, guest_stats: {} });

const fakeRepo = (state) => {
  const calls = [];
  const record = (name) => async (...args) => { calls.push({ name, args }); return { data: null, error: null }; };
  return {
    calls,
    writes: () => calls.filter((c) => !['loadTable', 'getCharacterSeatInfo', 'findTableIdByPostId', 'findLinkedTable', 'getPostRoster', 'listApprovedPlayers', 'listTables'].includes(c.name)),
    loadTable: async (id) => { calls.push({ name: 'loadTable', args: [id] }); return { data: state.table ? { ...state.table, members: [...(state.members || [])] } : null, error: null }; },
    listTables: record('listTables'),
    insertTable: record('insertTable'),
    updateTable: record('updateTable'),
    deleteTable: record('deleteTable'),
    insertMembers: record('insertMembers'),
    updateMember: record('updateMember'),
    deleteMember: record('deleteMember'),
    deleteMembers: record('deleteMembers'),
    getCharacterSeatInfo: async (id) => ({ data: (state.characters || {})[id] || null, error: null }),
    findTableIdByPostId: async () => ({ data: state.linkedTableId || null, error: null }),
    findLinkedTable: async () => ({ data: state.linked || null, error: null }),
    getPostRoster: async () => ({ data: state.roster || null, error: null }),
    listApprovedPlayers: async (postId) => { calls.push({ name: 'listApprovedPlayers', args: [postId] }); return { data: state.roster?.approved || [], error: null }; },
    listStates: async (tableId) => { calls.push({ name: 'listStates', args: [tableId] }); return { data: Object.values(state.trackerRows || {}), error: null }; },
    getState: async (memberId) => {
      const found = (state.trackerRows || {})[memberId];
      return { data: found ? { ...found, updater: { name: found.updaterName } } : null, error: null };
    },
    updateState: async (...args) => {
      calls.push({ name: 'updateState', args });
      const scripted = state.updateResults?.shift();
      if (scripted && !Array.isArray(scripted)) return { data: null, error: scripted.error };
      return { data: scripted ?? [{ version: args[2].version }], error: null };
    },
    setSessionStarted: async (...args) => { calls.push({ name: 'setSessionStarted', args }); return { data: null, error: null }; },
  };
};

const service = (state) => {
  const repo = fakeRepo(state);
  return { repo, svc: new GameTableService(repo, {
    systemClient: SYSTEM,
    newId: () => 'new-id',
    loadCharacter: async (id) => ({ data: state.characters?.[id] ?? { abilities: [], gear: [] } }),
  }) };
};

const TABLE = { id: 't1', name: 'Friday', creator_id: 'creator', conduit_id: 'creator' };

test('a missing table is a 404', async () => {
  const { svc } = service({});
  expect((await svc.load('t1', USER)).error.status).toBe(404);
});

test('a player may remove only their own seat; the creator may remove any', async () => {
  const { svc } = service({ table: TABLE, members: [seat('m1', 'c1', 'player'), seat('m2', 'c2', 'other'), guest('g1')] });
  const asPlayer = (await svc.load('t1', USER)).data.members;
  expect(asPlayer.map((m) => m.canRemove)).toEqual([true, false, false]);
  const asCreator = (await svc.load('t1', CREATOR)).data.members;
  expect(asCreator.map((m) => m.canRemove)).toEqual([true, true, true]);
  expect(asCreator.map((m) => m.canEdit)).toEqual([false, false, true]);
});

test('anyone signed in may seat their own private character, through their own client', async () => {
  const { svc, repo } = service({ table: TABLE, members: [], characters: { c9: { id: 'c9', is_public: false, creator_id: 'player' } } });
  const { error } = await svc.seatCharacter(USER, 't1', 'c9', USER_CLIENT);
  expect(error).toBeUndefined();
  const insert = repo.calls.find((c) => c.name === 'insertMembers');
  expect(insert.args).toEqual([[{ table_id: 't1', character_id: 'c9' }], USER_CLIENT]);
});

test('the creator may seat public characters but not someone else\'s private one', async () => {
  const characters = { pub: { id: 'pub', is_public: true, creator_id: 'x' }, priv: { id: 'priv', is_public: false, creator_id: 'x' } };
  const { svc, repo } = service({ table: TABLE, members: [], characters });
  expect((await svc.seatCharacter(CREATOR, 't1', 'pub', USER_CLIENT)).error).toBeUndefined();
  expect((await svc.seatCharacter(CREATOR, 't1', 'priv', USER_CLIENT)).error.status).toBe(403);
  expect((await svc.seatCharacter(STRANGER, 't1', 'pub', USER_CLIENT)).error.status).toBe(403);
  expect(repo.calls.filter((c) => c.name === 'insertMembers')).toHaveLength(1);
});

test('a full table seats nobody else', async () => {
  const members = Array.from({ length: 8 }, (_, i) => guest(`g${i}`));
  const { svc, repo } = service({ table: TABLE, members, characters: { c9: { id: 'c9', is_public: false, creator_id: 'player' } } });
  expect((await svc.seatCharacter(USER, 't1', 'c9', USER_CLIENT)).error.status).toBe(400);
  expect((await svc.addGuest(CREATOR, 't1', { name: 'Mira' }, USER_CLIENT)).error.status).toBe(400);
  expect(repo.writes()).toEqual([]);
});

test('seating an already-seated character changes nothing', async () => {
  const { svc, repo } = service({ table: TABLE, members: [seat('m1', 'c1', 'player')], characters: { c1: { id: 'c1', is_public: true, creator_id: 'player' } } });
  expect((await svc.seatCharacter(USER, 't1', 'c1', USER_CLIENT)).data.members).toHaveLength(1);
  expect(repo.writes()).toEqual([]);
});

test('only the creator or Conduit adds guests, and bad input names its problem', async () => {
  const { svc, repo } = service({ table: TABLE, members: [] });
  expect((await svc.addGuest(USER, 't1', { name: 'Mira' }, USER_CLIENT)).error.status).toBe(403);
  const bad = await svc.addGuest(CREATOR, 't1', { name: '', might: '9' }, USER_CLIENT);
  expect(bad.error.status).toBe(400);
  expect(bad.error.message).toContain('Give the character a name.');
  expect(bad.error.message).toContain('might');
  await svc.addGuest(CREATOR, 't1', { name: 'Mira', might: '2' }, USER_CLIENT);
  const [rows] = repo.calls.find((c) => c.name === 'insertMembers').args;
  expect(rows[0]).toMatchObject({ table_id: 't1', guest_name: 'Mira', guest_class_label: null });
  expect(rows[0].guest_stats.might).toBe(2);
});

test('editing only applies to guests at this table', async () => {
  const { svc } = service({ table: TABLE, members: [seat('m1', 'c1', 'player')] });
  expect((await svc.editGuest(CREATOR, 't1', 'm1', { name: 'x' }, USER_CLIENT)).error.status).toBe(404);
});

test('a new table is run by its creator and seats at most eight distinct characters', async () => {
  const { svc, repo } = service({});
  const ids = ['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  const { data } = await svc.create(CREATOR, { name: ' Friday ', characterIds: ids }, USER_CLIENT);
  expect(data).toEqual({ id: 'new-id' });
  expect(repo.calls.find((c) => c.name === 'insertTable').args)
    .toEqual([{ id: 'new-id', name: 'Friday', creator_id: 'creator', conduit_id: 'creator' }, USER_CLIENT]);
  const [rows] = repo.calls.find((c) => c.name === 'insertMembers').args;
  expect(rows.map((r) => r.character_id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  expect((await svc.create(CREATOR, { name: '' }, USER_CLIENT)).error.status).toBe(400);
  expect((await svc.create({ profileId: null }, { name: 'x' }, USER_CLIENT)).error.status).toBe(403);
});

test('only the creator renames or deletes', async () => {
  const conduitTable = { ...TABLE, conduit_id: 'conduit' };
  const { svc } = service({ table: conduitTable, members: [] });
  expect((await svc.rename({ profileId: 'conduit' }, 't1', 'New', USER_CLIENT)).error.status).toBe(403);
  expect((await svc.destroy({ profileId: 'conduit' }, 't1', USER_CLIENT)).error.status).toBe(403);
  expect((await svc.rename(CREATOR, 't1', 'New', USER_CLIENT)).error).toBeUndefined();
});

test('losing the seat-cap race in the database reads as a full table', async () => {
  const raced = (extra) => {
    const { svc, repo } = service(extra);
    repo.insertMembers = async () => ({ data: null, error: { code: '23514', message: 'trigger' } });
    return svc;
  };
  const characters = { c9: { id: 'c9', is_public: false, creator_id: 'player' } };
  const seated = await raced({ table: TABLE, members: [], characters }).seatCharacter(USER, 't1', 'c9', USER_CLIENT);
  expect(seated.error.status).toBe(400);
  expect(seated.error.message).toContain('seats at most');
  expect((await raced({ table: TABLE, members: [] }).addGuest(CREATOR, 't1', { name: 'Mira' }, USER_CLIENT)).error.status).toBe(400);
  const created = await raced({}).create(CREATOR, { name: 'Friday', characterIds: ['a'] }, USER_CLIENT);
  expect(created.error.status).toBe(400);
});

test('members seated in the same instant keep a stable order by id', async () => {
  const at = '2026-10-09T00:00:00Z';
  const members = [guest('g2'), guest('g3'), guest('g1')].map((m) => ({ ...m, created_at: at }));
  const { svc } = service({ table: TABLE, members });
  expect((await svc.load('t1', CREATOR)).data.members.map((m) => m.memberId)).toEqual(['g1', 'g2', 'g3']);
});

test('a non-array character list seats nobody', async () => {
  const { svc, repo } = service({});
  expect((await svc.create(CREATOR, { name: 'Friday', characterIds: 'abc' }, USER_CLIENT)).error).toBeUndefined();
  expect(repo.calls.some((c) => c.name === 'insertMembers')).toBe(false);
});

test('every user-initiated write runs through the caller\'s client, never the system one', async () => {
  const { svc, repo } = service({ table: TABLE, members: [guest('g1'), guest('g2')] });
  await svc.addGuest(CREATOR, 't1', { name: 'Mira' }, USER_CLIENT);
  await svc.editGuest(CREATOR, 't1', 'g1', { name: 'Mira' }, USER_CLIENT);
  await svc.removeMember(CREATOR, 't1', 'g2', USER_CLIENT);
  await svc.rename(CREATOR, 't1', 'New', USER_CLIENT);
  await svc.destroy(CREATOR, 't1', USER_CLIENT);
  const writes = repo.writes();
  expect(writes.map((c) => c.name)).toEqual(['insertMembers', 'updateMember', 'deleteMember', 'updateTable', 'deleteTable']);
  for (const call of writes) expect(call.args.at(-1)).toBe(USER_CLIENT);
});

const POST = { id: 'post1', title: 'Heist night', creator_id: 'creator', host_id: 'conduit' };

test('only the post\'s creator or Conduit opens its table; a second open reuses it', async () => {
  const { svc } = service({ linkedTableId: 'existing' });
  expect((await svc.openForPost(STRANGER, POST)).error.status).toBe(403);
  expect((await svc.openForPost({ profileId: 'conduit' }, POST)).data).toEqual({ id: 'existing' });
});

test('opening a new linked table names it after the post and gives it the post\'s creator and Conduit', async () => {
  const { svc, repo } = service({});
  await svc.openForPost({ profileId: 'conduit' }, POST);
  expect(repo.calls.find((c) => c.name === 'insertTable').args).toEqual([
    { id: 'new-id', name: 'Heist night', creator_id: 'creator', conduit_id: 'conduit', lfg_post_id: 'post1' }, SYSTEM,
  ]);
});

test('sync seats newly approved characters and unseats withdrawn ones, through the system client', async () => {
  const linked = { id: 't1', creator_id: 'creator', conduit_id: 'conduit', members: [
    { id: 'm-old', character_id: 'c-old', lfg_join_request_id: 'r-old' },
  ] };
  const roster = { host_id: 'conduit', approved: [{ id: 'r-new', character_id: 'c-new', is_public: true }] };
  const { svc, repo } = service({ linked, roster });
  await svc.syncLinkedTable('post1');
  expect(repo.calls.find((c) => c.name === 'deleteMembers').args).toEqual([['m-old'], SYSTEM]);
  expect(repo.calls.find((c) => c.name === 'insertMembers').args)
    .toEqual([[{ table_id: 't1', character_id: 'c-new', lfg_join_request_id: 'r-new' }], SYSTEM]);
});

test('sync never touches manual seats or guests, and skips a character already seated by hand', async () => {
  const linked = { id: 't1', creator_id: 'creator', conduit_id: 'conduit', members: [
    { id: 'm-hand', character_id: 'c1', lfg_join_request_id: null },
    { id: 'g1', character_id: null, lfg_join_request_id: null },
  ] };
  const { svc, repo } = service({ linked, roster: { host_id: 'conduit', approved: [{ id: 'r1', character_id: 'c1', is_public: true }] } });
  await svc.syncLinkedTable('post1');
  expect(repo.writes()).toEqual([]);
});

test('sync respects the cap', async () => {
  const members = Array.from({ length: 7 }, (_, i) => ({ id: `g${i}`, character_id: null, lfg_join_request_id: null }));
  const linked = { id: 't1', creator_id: 'creator', conduit_id: 'conduit', members };
  const roster = { host_id: 'conduit', approved: [{ id: 'r1', character_id: 'c1', is_public: true }, { id: 'r2', character_id: 'c2', is_public: true }] };
  const { svc, repo } = service({ linked, roster });
  await svc.syncLinkedTable('post1');
  const [rows] = repo.calls.find((c) => c.name === 'insertMembers').args;
  expect(rows.map((r) => r.character_id)).toEqual(['c1']);
});

test('sync seats only public characters; a private one waits for its owner to seat it', async () => {
  const linked = { id: 't1', creator_id: 'creator', conduit_id: 'conduit', members: [
    { id: 'm-priv', character_id: 'c-seated-priv', lfg_join_request_id: 'r-seated-priv' },
  ] };
  const roster = { host_id: 'conduit', approved: [
    { id: 'r-priv', character_id: 'c-priv', is_public: false },
    { id: 'r-pub', character_id: 'c-pub', is_public: true },
    { id: 'r-seated-priv', character_id: 'c-seated-priv', is_public: false },
  ] };
  const { svc, repo } = service({ linked, roster });
  await svc.syncLinkedTable('post1');
  expect(repo.writes()).toEqual([
    { name: 'insertMembers', args: [[{ table_id: 't1', character_id: 'c-pub', lfg_join_request_id: 'r-pub' }], SYSTEM] },
  ]);
});

test('a seat another sync already made does not stop the rest from being seated', async () => {
  const linked = { id: 't1', creator_id: 'creator', conduit_id: 'conduit', members: [] };
  const roster = { host_id: 'conduit', approved: [
    { id: 'r1', character_id: 'c1', is_public: true },
    { id: 'r2', character_id: 'c2', is_public: true },
  ] };
  const { svc, repo } = service({ linked, roster });
  const seated = [];
  repo.insertMembers = async (rows) => {
    if (rows.some((row) => row.character_id === 'c1')) return { data: null, error: { code: '23505', message: 'duplicate' } };
    seated.push(...rows.map((row) => row.character_id));
    return { data: null, error: null };
  };
  expect((await svc.syncLinkedTable('post1')).error).toBeUndefined();
  expect(seated).toEqual(['c2']);
});

test('a linked table counts the approved players it has not seated', async () => {
  const linkedTable = { ...TABLE, lfg_post_id: 'post1' };
  const roster = { approved: [
    { id: 'r1', character_id: 'c1', is_public: true },
    { id: 'r2', character_id: 'c2', is_public: false },
    { id: 'r3', character_id: null, is_public: false },
  ] };
  const { svc } = service({ table: linkedTable, members: [seat('m1', 'c1', 'p1')], roster });
  expect((await svc.load('t1', CREATOR)).data.unseatedApproved).toBe(1);
});

test('a standalone table never asks about an LFG roster', async () => {
  const { svc, repo } = service({ table: TABLE, members: [] });
  expect((await svc.load('t1', CREATOR)).data.unseatedApproved).toBe(0);
  expect(repo.calls.some((c) => c.name === 'listApprovedPlayers')).toBe(false);
});

test('sync follows the post\'s Conduit, falling back to the table creator', async () => {
  const linked = { id: 't1', creator_id: 'creator', conduit_id: 'conduit', members: [] };
  const { svc, repo } = service({ linked, roster: { host_id: null, approved: [] } });
  await svc.syncLinkedTable('post1');
  expect(repo.calls.find((c) => c.name === 'updateTable').args).toEqual(['t1', { conduit_id: 'creator' }, SYSTEM]);
});

test('sync does nothing for a post with no table', async () => {
  const { svc, repo } = service({});
  expect((await svc.syncLinkedTable('post1')).data).toBeNull();
  expect(repo.writes()).toEqual([]);
});

test('a post\'s table is found through the system client', async () => {
  const { svc } = service({ linkedTableId: 't9' });
  expect((await svc.findTableIdForPost('post1')).data).toBe('t9');
});

const row = (memberId, extra = {}) => ({
  member_id: memberId, table_id: 't1', stamina_threshold: 0, stamina_spent: 0, essence_threshold: 0, essence_spent: 0,
  use_counts: {}, cooldowns: {}, imposed_limiters: {}, undo: null, version: 3, updaterName: 'Ash', ...extra,
});

test('the owner or a manager may track a seat; anyone else may not', async () => {
  const { svc } = service({ table: TABLE, members: [seat('m1', 'c1', 'player')], trackerRows: { m1: row('m1') } });
  expect((await svc.act(USER, 't1', 'm1', { type: 'spend', pool: 'essence', amount: 'Low' }, USER_CLIENT)).error).toBeUndefined();
  expect((await svc.act(CREATOR, 't1', 'm1', { type: 'spend', pool: 'essence', amount: 'Low' }, USER_CLIENT)).error).toBeUndefined();
  expect((await svc.act(STRANGER, 't1', 'm1', { type: 'spend', pool: 'essence', amount: 'Low' }, USER_CLIENT)).error.status).toBe(403);
});

test('a write goes through the caller\'s client, bumps the version, and saves the prior state for undo', async () => {
  const { svc, repo } = service({ table: TABLE, members: [seat('m1', 'c1', 'player')], trackerRows: { m1: row('m1') } });
  const { data } = await svc.act(USER, 't1', 'm1', { type: 'spend', pool: 'essence', amount: 'Mid' }, USER_CLIENT);
  const [memberId, expectedVersion, patch, client] = repo.calls.find((c) => c.name === 'updateState').args;
  expect([memberId, expectedVersion, client]).toEqual(['m1', 3, USER_CLIENT]);
  expect(patch).toMatchObject({ essence_spent: 3, version: 4, updated_by: 'player', undo: { essence_spent: 0 } });
  expect(data.acted).toMatchObject({ undoable: true, version: 4 });
});

test('only the Conduit imposes or lifts Limiters', async () => {
  const conduitTable = { ...TABLE, conduit_id: 'conduit' };
  const { svc } = service({ table: conduitTable, members: [guest('g1')], trackerRows: { g1: row('g1') } });
  const impose = { type: 'impose', source: 'mechanic:pitch', kind: 'Cooldown', rating: 'Low' };
  expect((await svc.act(CREATOR, 't1', 'g1', impose, USER_CLIENT)).error.status).toBe(403);
  expect((await svc.act({ profileId: 'conduit' }, 't1', 'g1', impose, USER_CLIENT)).error).toBeUndefined();
});

test('a version conflict is retried once against the fresh row', async () => {
  const { svc, repo } = service({ table: TABLE, members: [guest('g1')], trackerRows: { g1: row('g1') }, updateResults: [[], [{ version: 4 }]] });
  const { error } = await svc.act(CREATOR, 't1', 'g1', { type: 'spend', pool: 'essence', amount: 'Low' }, USER_CLIENT);
  expect(error).toBeUndefined();
  expect(repo.calls.filter((c) => c.name === 'updateState')).toHaveLength(2);
});

test('a version guard rejection (55P03) is a conflict too, retried once', async () => {
  const { svc, repo } = service({ table: TABLE, members: [guest('g1')], trackerRows: { g1: row('g1') }, updateResults: [{ error: { code: '55P03' } }, [{ version: 4 }]] });
  const { error } = await svc.act(CREATOR, 't1', 'g1', { type: 'spend', pool: 'essence', amount: 'Low' }, USER_CLIENT);
  expect(error).toBeUndefined();
  expect(repo.calls.filter((c) => c.name === 'updateState')).toHaveLength(2);
});

test('any other write error passes through unchanged', async () => {
  const denied = { code: '42501', message: 'Only the Conduit imposes or lifts Limiters.' };
  const { svc } = service({ table: TABLE, members: [guest('g1')], trackerRows: { g1: row('g1') }, updateResults: [{ error: denied }] });
  const { error } = await svc.act(CREATOR, 't1', 'g1', { type: 'spend', pool: 'essence', amount: 'Low' }, USER_CLIENT);
  expect(error).toBe(denied);
});

test('a second conflict gives up with a 409', async () => {
  const { svc } = service({ table: TABLE, members: [guest('g1')], trackerRows: { g1: row('g1') }, updateResults: [[], []] });
  expect((await svc.act(CREATOR, 't1', 'g1', { type: 'spend', pool: 'essence', amount: 'Low' }, USER_CLIENT)).error.status).toBe(409);
});

test('undo restores the snapshot only while nobody has changed the row since', async () => {
  const snapshot = { stamina_threshold: 0, stamina_spent: 0, essence_threshold: 0, essence_spent: 0, use_counts: {}, cooldowns: {}, imposed_limiters: {} };
  const { svc, repo } = service({ table: TABLE, members: [guest('g1')], trackerRows: { g1: row('g1', { essence_spent: 3, undo: snapshot }) } });
  const stale = await svc.act(CREATOR, 't1', 'g1', { type: 'undo', version: 2 }, USER_CLIENT);
  expect(stale.error.status).toBe(409);
  expect(stale.error.message).toBe('Changed by Ash since \u2014 undo unavailable.');
  await svc.act(CREATOR, 't1', 'g1', { type: 'undo', version: 3 }, USER_CLIENT);
  const [, , patch] = repo.calls.find((c) => c.name === 'updateState').args;
  expect(patch).toMatchObject({ essence_spent: 0, undo: null, version: 4 });
});

test('an owner\'s undo leaves the Conduit\'s imposed Limiters as they are; the Conduit\'s undo restores them', async () => {
  const limiter = { kind: 'Cooldown', rating: 'Low' };
  const snapshot = { stamina_threshold: 0, stamina_spent: 0, essence_threshold: 0, essence_spent: 0, use_counts: {}, cooldowns: {}, imposed_limiters: {} };
  const current = row('m1', { essence_spent: 3, imposed_limiters: { 'mechanic:pitch': [limiter] }, undo: snapshot });
  const conduitTable = { ...TABLE, conduit_id: 'conduit' };
  const { svc, repo } = service({ table: conduitTable, members: [seat('m1', 'c1', 'player')], trackerRows: { m1: current } });
  await svc.act(USER, 't1', 'm1', { type: 'undo', version: 3 }, USER_CLIENT);
  const [, , ownerPatch] = repo.calls.find((c) => c.name === 'updateState').args;
  expect(ownerPatch).toMatchObject({ essence_spent: 0, imposed_limiters: { 'mechanic:pitch': [limiter] } });
  await svc.act({ profileId: 'conduit' }, 't1', 'm1', { type: 'undo', version: 3 }, USER_CLIENT);
  const [, , conduitPatch] = repo.calls.filter((c) => c.name === 'updateState')[1].args;
  expect(conduitPatch.imposed_limiters).toEqual({});
});

test('bad tracker input is a 400 naming the problem', async () => {
  const { svc } = service({ table: TABLE, members: [guest('g1')], trackerRows: { g1: row('g1') } });
  const { error } = await svc.act(CREATOR, 't1', 'g1', { type: 'spend', pool: 'mana', amount: 'Low' }, USER_CLIENT);
  expect(error).toMatchObject({ status: 400, message: 'Unknown pool.' });
});

test('a guest tracks pools and mechanics only, budgeted from its own stats', async () => {
  const g = { ...guest('g1'), guest_stats: { will: 2 } };
  const { svc } = service({ table: TABLE, members: [g], trackerRows: { g1: row('g1') } });
  const { data } = await svc.tracker(CREATOR, 't1', 'g1');
  expect(data.tracker.sources.every((s) => s.kind === 'Mechanic')).toBe(true);
  expect(data.tracker.pools.find((p) => p.name === 'essence').budget).toBe(9);
});

test('a seated character\'s abilities and Signatures come from its sheet', async () => {
  const characters = { c1: { abilities: [{ id: 'a1', name: 'Bolt', meters: [{ label: 'Essence Cost', value: 'Mid' }] }], gear: [] } };
  const { svc } = service({ table: TABLE, members: [seat('m1', 'c1', 'player')], trackerRows: { m1: row('m1') }, characters });
  const { data } = await svc.tracker(USER, 't1', 'm1');
  expect(data.tracker.sources[0]).toMatchObject({ key: 'ability:a1', name: 'Bolt', kind: 'Ability' });
});

test('a new session resets every seat through the system client; only a manager may start one', async () => {
  const { svc, repo } = service({ table: TABLE, members: [guest('g1'), guest('g2')], trackerRows: { g1: row('g1', { essence_spent: 2 }), g2: row('g2', { use_counts: { 'mechanic:pitch': 3 } }) } });
  expect((await svc.newSession(USER, 't1')).error.status).toBe(403);
  await svc.newSession(CREATOR, 't1');
  const updates = repo.calls.filter((c) => c.name === 'updateState');
  expect(updates).toHaveLength(2);
  for (const [, , patch, client] of updates.map((c) => c.args)) {
    expect(patch).toMatchObject({ essence_spent: 0, use_counts: {}, cooldowns: {}, imposed_limiters: {}, undo: null, version: 4 });
    expect(client).toBe(SYSTEM);
  }
  expect(repo.calls.find((c) => c.name === 'setSessionStarted').args[2]).toBe(SYSTEM);
});

test('a seat that changes mid-reset is re-read and reset; the session is stamped once all are reset', async () => {
  const { svc, repo } = service({ table: TABLE, members: [guest('g1'), guest('g2')], trackerRows: { g1: row('g1', { essence_spent: 2 }), g2: row('g2') }, updateResults: [[], [{ version: 4 }]] });
  expect((await svc.newSession(CREATOR, 't1')).error).toBeUndefined();
  expect(repo.calls.filter((c) => c.name === 'updateState')).toHaveLength(3);
  expect(repo.calls.some((c) => c.name === 'setSessionStarted')).toBe(true);
});

test('a seat that never resets gives a 409 and the session is not stamped', async () => {
  const { svc, repo } = service({ table: TABLE, members: [guest('g1'), guest('g2')], trackerRows: { g1: row('g1'), g2: row('g2') }, updateResults: [[], [], []] });
  const { error } = await svc.newSession(CREATOR, 't1');
  expect(error).toMatchObject({ status: 409, message: 'A tracker changed while the session was resetting. Try again.' });
  expect(repo.calls.some((c) => c.name === 'setSessionStarted')).toBe(false);
});

test('an unchanged tracker answers a poll without loading the character', async () => {
  let loads = 0;
  const repo = fakeRepo({ table: TABLE, members: [seat('m1', 'c1', 'player')], trackerRows: { m1: row('m1') } });
  const svc = new GameTableService(repo, { systemClient: SYSTEM, loadCharacter: async () => { loads += 1; return { data: null }; } });
  expect((await svc.tracker(USER, 't1', 'm1', { sinceVersion: 3 })).data).toEqual({ unchanged: true, version: 3 });
  expect(loads).toBe(0);
  expect((await svc.tracker(USER, 't1', 'm1', { sinceVersion: 2 })).data.tracker.version).toBe(3);
});

test('a character that fails to load is an error, not a mechanics-only tracker', async () => {
  const boom = { code: 'x', message: 'down' };
  const repo = fakeRepo({ table: TABLE, members: [seat('m1', 'c1', 'player')], trackerRows: { m1: row('m1') } });
  const svc = new GameTableService(repo, { systemClient: SYSTEM, loadCharacter: async () => ({ data: null, error: boom }) });
  const view = (await svc.load('t1', USER)).data;
  expect((await svc.tracker(USER, 't1', 'm1')).error).toBe(boom);
  expect((await svc.trackers(view, USER)).error).toBe(boom);
  expect((await svc.act(USER, 't1', 'm1', { type: 'spend', pool: 'essence', amount: 'Low' }, USER_CLIENT)).error).toBe(boom);
});

test('an undo that loses the write race answers that someone changed it', async () => {
  const snapshot = { stamina_threshold: 0, stamina_spent: 0, essence_threshold: 0, essence_spent: 0, use_counts: {}, cooldowns: {}, imposed_limiters: {} };
  for (const lost of [[], { error: { code: '55P03' } }]) {
    const { svc } = service({ table: TABLE, members: [guest('g1')], trackerRows: { g1: row('g1', { essence_spent: 3, undo: snapshot }) }, updateResults: [lost] });
    const { error } = await svc.act(CREATOR, 't1', 'g1', { type: 'undo', version: 3 }, USER_CLIENT);
    expect(error).toMatchObject({ status: 409, message: 'Changed by Ash since — undo unavailable.' });
  }
});

test('trackers maps each member id to a view; a seat with no state row is empty at version 0', async () => {
  const { svc } = service({ table: TABLE, members: [guest('g1'), guest('g2')], trackerRows: { g1: row('g1', { essence_spent: 2 }) } });
  const view = (await svc.load('t1', CREATOR)).data;
  const { data } = await svc.trackers(view, CREATOR);
  expect([...data.keys()]).toEqual(['g1', 'g2']);
  expect(data.get('g1').version).toBe(3);
  expect(data.get('g2')).toMatchObject({ version: 0 });
  expect(data.get('g2').pools.every((p) => p.spent === 0 && p.threshold === 0)).toBe(true);
});

test('a signed-in non-manager may not act on a guest seat', async () => {
  const { svc } = service({ table: TABLE, members: [guest('g1')], trackerRows: { g1: row('g1') } });
  expect((await svc.act(USER, 't1', 'g1', { type: 'spend', pool: 'essence', amount: 'Low' }, USER_CLIENT)).error.status).toBe(403);
});
