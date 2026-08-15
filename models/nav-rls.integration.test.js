// Local-Supabase integration coverage for the nav_items RLS policies.
//
// These ran only as unit tests against a fake client, which is how the policy
// half of this bug survived: threading the caller's client through models/nav.js
// makes an admin's INSERT succeed, but deactivating an item still failed with
// the *same* 42501 code. The cause is not the is_admin() write policy at all --
// models/nav.js updates with a trailing .select(), Postgres applies SELECT
// policies to an UPDATE ... RETURNING, and the original SELECT policy
// (USING (is_active = true)) makes the new row invisible the moment is_active
// flips to false. Only a real database shows that; a fake client cannot.
// Fixed by 20260815000000_nav_items_admin_select.sql.
const { test, expect, afterAll } = require('bun:test');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const { supabaseAdmin, createUserClient } = require('./_base');
const { createNavItem, updateNavItem, getAllNavItems, getNavItem } = require('./nav');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `nav-rls-${suffix}@example.test`;
const password = `nav-rls-${suffix}`;
const label = (name) => `Nav RLS ${name} ${suffix}`;

const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});

const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
// A pristine anon client. Never sign in through this one: signInWithPassword
// attaches the session to the client in memory, which would silently turn it
// into an authenticated client and make the anon assertions vacuous.
const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, clientOptions);

let authUserId;
let profile;
let adminClient;

const setup = async () => {
  if (adminClient) return;
  await db.connect();

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true
  });
  if (createError) throw createError;
  authUserId = created.user.id;

  ({ data: profile } = await supabaseAdmin.from('profiles')
    .insert({ user_id: authUserId, name: `Nav RLS ${suffix}`, is_public: false, timezone: 'UTC', role: 'admin' })
    .select()
    .single());

  const signIn = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, clientOptions);
  const { data: session, error: signInError } = await signIn.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  adminClient = createUserClient(session.session.access_token);
};

afterAll(async () => {
  await supabaseAdmin.from('nav_items').delete().like('label', `%${suffix}`);
  if (profile?.id) await db.query('delete from profiles where id = $1', [profile.id]);
  if (authUserId) await db.query('delete from auth.users where id = $1', [authUserId]);
  await db.end();
});

test('an anonymous client cannot insert a nav item', async () => {
  await setup();
  const { error } = await createNavItem(
    { label: label('anon'), type: 'link', url: '/nav-rls-anon' },
    anonClient
  );
  // The originally reported failure: is_admin() is false without a user JWT.
  expect(error?.code).toBe('42501');
});

test("an admin's own client can create a nav item", async () => {
  await setup();
  const { data, error } = await createNavItem(
    { label: label('create'), type: 'link', url: '/nav-rls-create' },
    adminClient
  );
  expect(error).toBeNull();
  expect(data.id).toBeTruthy();
});

test('an admin can deactivate a nav item', async () => {
  await setup();
  const { data: item } = await createNavItem(
    { label: label('deactivate'), type: 'link', url: '/nav-rls-deactivate' },
    adminClient
  );

  const { data, error } = await updateNavItem(item.id, { is_active: false }, adminClient);

  // Before 20260815000000 this failed with 42501 on the RETURNING clause, so
  // the "Active" checkbox could never be unchecked.
  expect(error).toBeNull();
  expect(data.is_active).toBe(false);
});

test('an admin can still see and load a deactivated nav item', async () => {
  await setup();
  const { data: item } = await createNavItem(
    { label: label('visible'), type: 'link', url: '/nav-rls-visible' },
    adminClient
  );
  await supabaseAdmin.from('nav_items').update({ is_active: false }).eq('id', item.id);

  // /nav/manage must list it, and /nav/:id/edit must load it -- otherwise a
  // deactivated item is unrecoverable through the UI.
  const { data: all } = await getAllNavItems(adminClient);
  expect(all.some((row) => row.id === item.id)).toBe(true);

  const { data: single, error } = await getNavItem(item.id, adminClient);
  expect(error).toBeNull();
  expect(single.id).toBe(item.id);
});

test('a deactivated nav item stays hidden from anonymous callers', async () => {
  await setup();
  const { data: item } = await createNavItem(
    { label: label('hidden'), type: 'link', url: '/nav-rls-hidden' },
    adminClient
  );
  await supabaseAdmin.from('nav_items').update({ is_active: false }).eq('id', item.id);

  // Widening SELECT for admins must not widen it for everyone else.
  const { data: all } = await getAllNavItems(anonClient);
  expect(all.some((row) => row.id === item.id)).toBe(false);
});
