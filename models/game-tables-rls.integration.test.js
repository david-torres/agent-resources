// The game tables' RLS and column grants (supabase/migrations/20261009000000_game_tables.sql).
// A table's link is a capability: only participants read through the API,
// and only the service role may set the columns the LFG roster sync trusts.
require('../util/require-local-supabase');
const { test, expect, afterAll } = require('bun:test');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const { supabaseAdmin, createUserClient } = require('./_base');
const { statList } = require('../util/enclave-consts');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const db = new Client({ connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, clientOptions);

const created = { authUserIds: [], profileIds: [], characterIds: [], tableIds: [], postIds: [] };
let users;
let connected = false;

const makeUser = async (tag) => {
  const email = `gt-rls-${tag}-${suffix}@example.test`;
  const password = `gt-rls-${tag}-${suffix}`;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  created.authUserIds.push(data.user.id);
  const { data: profile, error: profileError } = await supabaseAdmin.from('profiles')
    .insert({ user_id: data.user.id, name: `GT ${tag} ${suffix}`, is_public: false, timezone: 'UTC' })
    .select().single();
  if (profileError) throw profileError;
  created.profileIds.push(profile.id);
  const signIn = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, clientOptions);
  const { data: session, error: signInError } = await signIn.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { profile, client: createUserClient(session.session.access_token) };
};

const makeCharacter = async (profileId, { isPublic }) => {
  const row = {
    creator_id: profileId, name: `GT char ${suffix}`, class: 'Test', level: 1,
    completed_missions: 0, commissary_reward: 0, is_public: isPublic,
    ...Object.fromEntries(statList.map((stat) => [stat, 1])),
  };
  const { data, error } = await supabaseAdmin.from('characters').insert(row).select('id').single();
  if (error) throw error;
  created.characterIds.push(data.id);
  return data.id;
};

// creator runs the table; player owns a private character; stranger owns a
// public one and is otherwise unrelated.
const setup = async () => {
  if (users) return users;
  if (!connected) { await db.connect(); connected = true; }
  const [creator, player, stranger] = await Promise.all([makeUser('creator'), makeUser('player'), makeUser('stranger')]);
  const outsider = await makeUser('outsider');
  const playerPrivate = await makeCharacter(player.profile.id, { isPublic: false });
  const strangerPublic = await makeCharacter(stranger.profile.id, { isPublic: true });
  const tableId = crypto.randomUUID();
  const { error } = await creator.client.from('game_tables')
    .insert({ id: tableId, name: `GT table ${suffix}`, creator_id: creator.profile.id, conduit_id: creator.profile.id });
  if (error) throw error;
  created.tableIds.push(tableId);
  users = { outsider, creator, player, stranger, playerPrivate, strangerPublic, tableId };
  return users;
};

const membersOf = async (tableId) =>
  (await supabaseAdmin.from('game_table_members').select('*').eq('table_id', tableId)).data;

afterAll(async () => {
  if (created.postIds.length) await supabaseAdmin.from('lfg_posts').delete().in('id', created.postIds);
  if (created.tableIds.length) await supabaseAdmin.from('game_tables').delete().in('id', created.tableIds);
  if (created.characterIds.length) await supabaseAdmin.from('characters').delete().in('id', created.characterIds);
  for (const id of created.profileIds) await db.query('delete from profiles where id = $1', [id]);
  for (const id of created.authUserIds) await db.query('delete from auth.users where id = $1', [id]);
  if (connected) await db.end();
});

test('anon reads no tables and cannot create one', async () => {
  const { creator } = await setup();
  const { data } = await anonClient.from('game_tables').select('id');
  expect(data || []).toEqual([]);
  const { error } = await anonClient.from('game_tables')
    .insert({ id: crypto.randomUUID(), name: 'x', creator_id: creator.profile.id, conduit_id: creator.profile.id });
  expect(error?.code).toBe('42501');
});

test('a stranger cannot read a table they have no part in; its creator can', async () => {
  const { creator, stranger, tableId } = await setup();
  expect((await stranger.client.from('game_tables').select('id').eq('id', tableId)).data).toEqual([]);
  expect((await creator.client.from('game_tables').select('id').eq('id', tableId)).data).toHaveLength(1);
});

test('users cannot create a table for someone else or pre-linked to an LFG post', async () => {
  const { creator, player } = await setup();
  const forOther = await creator.client.from('game_tables')
    .insert({ id: crypto.randomUUID(), name: 'x', creator_id: player.profile.id, conduit_id: player.profile.id });
  expect(forOther.error?.code).toBe('42501');
  const { data: post, error: postError } = await supabaseAdmin.from('lfg_posts')
    .insert({ title: `GT post ${suffix}`, description: 'x', date: new Date().toISOString(), creator_id: creator.profile.id, max_characters: 4 })
    .select('id').single();
  if (postError) throw postError;
  created.postIds.push(post.id);
  const linked = await creator.client.from('game_tables').insert({
    id: crypto.randomUUID(), name: 'x', creator_id: creator.profile.id, conduit_id: creator.profile.id,
    lfg_post_id: post.id,
  });
  expect(linked.error?.code).toBe('42501');
});

test('a player seats their own private character and becomes a participant', async () => {
  const { player, playerPrivate, tableId } = await setup();
  const { error } = await player.client.from('game_table_members').insert({ table_id: tableId, character_id: playerPrivate });
  expect(error).toBeNull();
  expect((await player.client.from('game_tables').select('id').eq('id', tableId)).data).toHaveLength(1);
});

test('the creator may seat a public character but not someone else\'s private one', async () => {
  const { creator, strangerPublic, tableId } = await setup();
  const otherPrivate = await makeCharacter(users.stranger.profile.id, { isPublic: false });
  expect((await creator.client.from('game_table_members').insert({ table_id: tableId, character_id: strangerPublic })).error).toBeNull();
  expect((await creator.client.from('game_table_members').insert({ table_id: tableId, character_id: otherPrivate })).error?.code).toBe('42501');
});

test('only the creator or Conduit adds and edits guests', async () => {
  const { creator, player, stranger, tableId } = await setup();
  const guest = { table_id: tableId, guest_name: `Guest ${suffix}`, guest_stats: { might: 2 } };
  expect((await stranger.client.from('game_table_members').insert(guest)).error?.code).toBe('42501');
  expect((await creator.client.from('game_table_members').insert(guest)).error).toBeNull();
  const row = (await membersOf(tableId)).find((m) => m.guest_name === guest.guest_name);
  await player.client.from('game_table_members').update({ guest_name: 'Renamed by player' }).eq('id', row.id);
  expect((await membersOf(tableId)).find((m) => m.id === row.id).guest_name).toBe(guest.guest_name);
});

test('a player removes their own seat but not a guest', async () => {
  const { creator, player, playerPrivate, tableId } = await setup();
  await creator.client.from('game_table_members').insert({ table_id: tableId, guest_name: `Keep ${suffix}`, guest_stats: {} });
  const rows = await membersOf(tableId);
  const keep = rows.find((m) => m.guest_name === `Keep ${suffix}`);
  await player.client.from('game_table_members').delete().eq('id', keep.id);
  expect((await membersOf(tableId)).some((m) => m.id === keep.id)).toBe(true);
  const own = rows.find((m) => m.character_id === playerPrivate);
  await player.client.from('game_table_members').delete().eq('id', own.id);
  expect((await membersOf(tableId)).some((m) => m.id === own.id)).toBe(false);
});

test('users cannot set the columns the LFG roster sync trusts', async () => {
  const { creator, strangerPublic, tableId } = await setup();
  const relink = await creator.client.from('game_tables').update({ lfg_post_id: crypto.randomUUID() }).eq('id', tableId);
  expect(relink.error?.code).toBe('42501');
  const forged = await creator.client.from('game_table_members')
    .insert({ table_id: tableId, character_id: strangerPublic, lfg_join_request_id: crypto.randomUUID() });
  expect(forged.error?.code).toBe('42501');
});

test('the creator renames the table; a participant who is not the creator cannot', async () => {
  const { creator, stranger, tableId } = await setup();
  expect((await stranger.client.from('game_tables').select('id').eq('id', tableId)).data).toHaveLength(1);
  await stranger.client.from('game_tables').update({ name: 'Player rename' }).eq('id', tableId);
  expect((await supabaseAdmin.from('game_tables').select('name').eq('id', tableId).single()).data.name).not.toBe('Player rename');
  expect((await creator.client.from('game_tables').update({ name: `Renamed ${suffix}` }).eq('id', tableId)).error).toBeNull();
  expect((await supabaseAdmin.from('game_tables').select('name').eq('id', tableId).single()).data.name).toBe(`Renamed ${suffix}`);
});

test('anon and a user with no part in the table read none of its members', async () => {
  const { outsider, tableId } = await setup();
  expect((await membersOf(tableId)).length).toBeGreaterThan(0);
  expect((await anonClient.from('game_table_members').select('id').eq('table_id', tableId)).data || []).toEqual([]);
  expect((await outsider.client.from('game_table_members').select('id').eq('table_id', tableId)).data).toEqual([]);
});

test('a table seats at most 8, whoever adds the ninth', async () => {
  const { creator, player, tableId: _ } = await setup();
  const fullId = crypto.randomUUID();
  expect((await creator.client.from('game_tables')
    .insert({ id: fullId, name: `GT full ${suffix}`, creator_id: creator.profile.id, conduit_id: creator.profile.id })).error).toBeNull();
  created.tableIds.push(fullId);
  for (let i = 0; i < 8; i++) {
    const { error } = await creator.client.from('game_table_members')
      .insert({ table_id: fullId, guest_name: `Seat ${i}`, guest_stats: {} });
    expect(error).toBeNull();
  }
  const ninthGuest = await creator.client.from('game_table_members').insert({ table_id: fullId, guest_name: 'Ninth', guest_stats: {} });
  expect(ninthGuest.error?.code).toBe('23514');
  const playerChar = await makeCharacter(player.profile.id, { isPublic: false });
  const ninthPlayer = await player.client.from('game_table_members').insert({ table_id: fullId, character_id: playerChar });
  expect(ninthPlayer.error?.code).toBe('23514');
  expect(await membersOf(fullId)).toHaveLength(8);
});

test('a Conduit who did not create the table manages it', async () => {
  const { creator, player, strangerPublic } = await setup();
  const hostedId = crypto.randomUUID();
  const { error } = await supabaseAdmin.from('game_tables')
    .insert({ id: hostedId, name: `GT hosted ${suffix}`, creator_id: creator.profile.id, conduit_id: player.profile.id });
  if (error) throw error;
  created.tableIds.push(hostedId);
  expect((await player.client.from('game_table_members').insert({ table_id: hostedId, character_id: strangerPublic })).error).toBeNull();
  expect((await player.client.from('game_table_members')
    .insert({ table_id: hostedId, guest_name: `Conduit guest ${suffix}`, guest_stats: {} })).error).toBeNull();
  expect(await membersOf(hostedId)).toHaveLength(2);
});

test('deleting a linked LFG post keeps the table and its LFG-seated members', async () => {
  const { creator, stranger, strangerPublic } = await setup();
  const { data: post, error: postError } = await supabaseAdmin.from('lfg_posts')
    .insert({ title: `GT linked ${suffix}`, description: 'x', date: new Date().toISOString(), creator_id: creator.profile.id, max_characters: 4 })
    .select('id').single();
  if (postError) throw postError;
  created.postIds.push(post.id);
  const { data: request, error: requestError } = await supabaseAdmin.from('lfg_join_requests')
    .insert({ lfg_post_id: post.id, profile_id: stranger.profile.id, join_type: 'player', character_id: strangerPublic, status: 'approved' })
    .select('id').single();
  if (requestError) throw requestError;
  const linkedId = crypto.randomUUID();
  const linked = await supabaseAdmin.from('game_tables')
    .insert({ id: linkedId, name: `GT linked ${suffix}`, creator_id: creator.profile.id, conduit_id: creator.profile.id, lfg_post_id: post.id });
  if (linked.error) throw linked.error;
  created.tableIds.push(linkedId);
  const seat = await supabaseAdmin.from('game_table_members')
    .insert({ table_id: linkedId, character_id: strangerPublic, lfg_join_request_id: request.id });
  if (seat.error) throw seat.error;

  expect((await supabaseAdmin.from('lfg_posts').delete().eq('id', post.id)).error).toBeNull();

  const table = (await supabaseAdmin.from('game_tables').select('lfg_post_id').eq('id', linkedId).single()).data;
  expect(table.lfg_post_id).toBeNull();
  const members = await membersOf(linkedId);
  expect(members).toHaveLength(1);
  expect(members[0]).toMatchObject({ character_id: strangerPublic, lfg_join_request_id: null });
});
