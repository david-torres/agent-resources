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
    writes: () => calls.filter((c) => !['loadTable', 'getCharacterSeatInfo', 'findTableIdByPostId', 'findLinkedTable', 'getPostRoster', 'listTables'].includes(c.name)),
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
  };
};

const service = (state) => {
  const repo = fakeRepo(state);
  return { repo, svc: new GameTableService(repo, { systemClient: SYSTEM, newId: () => 'new-id' }) };
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

test('opening a new linked table names it after the post and makes the post\'s Conduit its Conduit', async () => {
  const { svc, repo } = service({});
  await svc.openForPost(CREATOR, POST);
  expect(repo.calls.find((c) => c.name === 'insertTable').args).toEqual([
    { id: 'new-id', name: 'Heist night', creator_id: 'creator', conduit_id: 'conduit', lfg_post_id: 'post1' }, SYSTEM,
  ]);
});

test('sync seats newly approved characters and unseats withdrawn ones, through the system client', async () => {
  const linked = { id: 't1', creator_id: 'creator', conduit_id: 'conduit', members: [
    { id: 'm-old', character_id: 'c-old', lfg_join_request_id: 'r-old' },
  ] };
  const roster = { host_id: 'conduit', approved: [{ id: 'r-new', character_id: 'c-new' }] };
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
  const { svc, repo } = service({ linked, roster: { host_id: 'conduit', approved: [{ id: 'r1', character_id: 'c1' }] } });
  await svc.syncLinkedTable('post1');
  expect(repo.writes()).toEqual([]);
});

test('sync respects the cap', async () => {
  const members = Array.from({ length: 7 }, (_, i) => ({ id: `g${i}`, character_id: null, lfg_join_request_id: null }));
  const linked = { id: 't1', creator_id: 'creator', conduit_id: 'conduit', members };
  const roster = { host_id: 'conduit', approved: [{ id: 'r1', character_id: 'c1' }, { id: 'r2', character_id: 'c2' }] };
  const { svc, repo } = service({ linked, roster });
  await svc.syncLinkedTable('post1');
  const [rows] = repo.calls.find((c) => c.name === 'insertMembers').args;
  expect(rows.map((r) => r.character_id)).toEqual(['c1']);
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
