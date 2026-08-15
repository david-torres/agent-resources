// models/nav-rls-client.test.js
//
// Creating a nav item from /nav/manage failed with Postgres 42501:
//   new row violates row-level security policy for table "nav_items"
//
// nav_items RLS gates every write on is_admin()
// (supabase/migrations/20260609000100_nav_items.sql), and is_admin() reads
// auth.uid(). Every function in models/nav.js was bound to the module-level
// anon singleton from ./_base, which carries no user JWT -- so auth.uid() is
// NULL, is_admin() returns false, and the INSERT's WITH CHECK fails. The route
// already gates on requireAdmin and already had the caller's client on
// res.locals.supabase (util/auth.js), it just never reached the model.
//
// The reads have the quieter half of the same bug: the SELECT policy is
// USING (is_active = true), so bound to the anon client the admin management
// screen cannot see -- or load for editing -- any deactivated item.
//
// models/pages.js already fixed this exact failure by threading the caller's
// client through as a defaulted last argument. These tests pin the same
// contract for nav.
const { mock, test, expect, afterAll } = require('bun:test');

const realBase = require('./_base');

// Two distinguishable clients: the anon singleton the model used to reach for,
// and the caller's authenticated client that must be used instead.
const makeClient = (name, calls) => ({
    name,
    from(table) {
        calls.push({ client: name, table });
        const chain = {
            insert() { return chain; },
            update() { return chain; },
            delete() { return chain; },
            select() { return chain; },
            eq() { return chain; },
            order() { return chain; },
            limit() { return chain; },
            single() { return chain; },
            then(onFulfilled, onRejected) {
                return Promise.resolve({ data: { id: 'n1' }, error: null })
                    .then(onFulfilled, onRejected);
            }
        };
        return chain;
    }
});

const calls = [];
const anonClient = makeClient('anon', calls);
const callerClient = makeClient('caller', calls);

mock.module('./_base', () => ({
    supabase: anonClient,
    supabaseAdmin: anonClient,
    anonKey: 'test-anon-key',
    createUserClient: () => callerClient
}));

delete require.cache[require.resolve('./nav')];
const {
    getNavItem,
    getAllNavItems,
    createNavItem,
    updateNavItem,
    deleteNavItem,
    reorderNavItems,
    getDropdownParents
} = require('./nav');

afterAll(() => {
    mock.module('./_base', () => realBase);
    delete require.cache[require.resolve('./nav')];
});

const clientsUsed = () => [...new Set(calls.map((c) => c.client))];

test('createNavItem issues its INSERT on the caller client, not the anon singleton', async () => {
    calls.length = 0;

    const { error } = await createNavItem(
        { label: 'Characters', type: 'link', url: '/characters', position: 0 },
        callerClient
    );

    expect(error).toBeNull();
    // The anon client has no JWT, so is_admin() is false and the insert is
    // rejected by RLS before it ever reaches the table.
    expect(clientsUsed()).toEqual(['caller']);
});

test('createNavItem looks up sibling positions on the caller client too', async () => {
    calls.length = 0;

    // No position supplied: the model first reads existing siblings. That read
    // is subject to USING (is_active = true), so on the anon client an inactive
    // sibling is invisible and the new item collides with its position.
    await createNavItem({ label: 'Rules', type: 'link', url: '/rules' }, callerClient);

    expect(calls.length).toBeGreaterThan(1);
    expect(clientsUsed()).toEqual(['caller']);
});

test('updateNavItem issues its UPDATE on the caller client', async () => {
    calls.length = 0;
    await updateNavItem('n1', { label: 'Renamed' }, callerClient);
    expect(clientsUsed()).toEqual(['caller']);
});

test('deleteNavItem issues its DELETE on the caller client', async () => {
    calls.length = 0;
    await deleteNavItem('n1', callerClient);
    expect(clientsUsed()).toEqual(['caller']);
});

test('reorderNavItems issues every UPDATE on the caller client', async () => {
    calls.length = 0;
    await reorderNavItems(
        [{ id: 'n1', position: 1, parent_id: null }, { id: 'n2', position: 0, parent_id: null }],
        callerClient
    );
    expect(calls.length).toBe(2);
    expect(clientsUsed()).toEqual(['caller']);
});

test('admin reads use the caller client so deactivated items stay visible', async () => {
    calls.length = 0;
    await getAllNavItems(callerClient);
    await getNavItem('n1', callerClient);
    await getDropdownParents(callerClient);
    expect(clientsUsed()).toEqual(['caller']);
});

test('omitting the client falls back to the anon singleton for public reads', async () => {
    calls.length = 0;
    await getAllNavItems();
    expect(clientsUsed()).toEqual(['anon']);
});
