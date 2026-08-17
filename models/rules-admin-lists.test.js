const { test, expect } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');

// Records which table each query starts from, the select column string, and
// order calls; resolves with canned data.
const queries = [];
const fakeClient = {
    from(table) {
        const record = { table, select: null, orders: [], eqs: [] };
        queries.push(record);
        const chain = {
            select(cols) { record.select = cols; return chain; },
            eq(column, value) { record.eqs.push({ column, value }); return chain; },
            order(column, options) { record.orders.push({ column, options }); return chain; },
            then(onFulfilled, onRejected) {
                return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
            }
        };
        return chain;
    },
    rpc() { return Promise.resolve({ data: null, error: null }); }
};

// bun's mock.module permanently rebinds a resolved path the first time any
// file calls it (see routes/library-unlocks.test.js and
// util/redeem-code.test.js, which mock the whole '../models/rules' module
// for their own route/fallback tests). Once that happens, deleting
// require.cache and re-requiring './rules' can no longer force real code
// to re-run -- it just keeps returning whatever mock.module last
// registered for that path, regardless of import order. freshRequire loads
// the real file via Node's own module loader instead, bypassing bun's
// mock.module registry entirely so this file can't be poisoned by (or
// poison) any other test file.
const { listAllUnlockGrantsAdmin, listAllUnlockCodesAdmin } = freshRequire(require.resolve('./rules'), new Map([
    [require.resolve('./_base'), {
        supabase: fakeClient,
        supabaseAdmin: fakeClient,
        anonKey: 'test-anon-key',
        createUserClient: () => fakeClient
    }]
]));

test('listAllUnlockGrantsAdmin queries all unlocks with profile, granter, and pdf joins', async () => {
    queries.length = 0;
    const { data, error } = await listAllUnlockGrantsAdmin();
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(queries.length).toBe(1);
    const q = queries[0];
    expect(q.table).toBe('rules_pdf_unlocks');
    // Cross-PDF list: no rules_pdf_id filter.
    expect(q.eqs).toEqual([]);
    expect(q.select).toContain('profile:profiles!rules_pdf_unlocks_profile_id_fkey(id, name)');
    expect(q.select).toContain('granter:profiles!rules_pdf_unlocks_granted_by_fkey(id, name)');
    expect(q.select).toContain('rules_pdf:rules_pdfs(id, title, edition)');
    expect(q.orders).toEqual([{ column: 'unlocked_at', options: { ascending: false } }]);
});

test('listAllUnlockCodesAdmin queries all codes with pdf and creator joins', async () => {
    queries.length = 0;
    const { data, error } = await listAllUnlockCodesAdmin();
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(queries.length).toBe(1);
    const q = queries[0];
    expect(q.table).toBe('rules_pdf_unlock_codes');
    expect(q.eqs).toEqual([]);
    expect(q.select).toContain('used_count');
    expect(q.select).toContain('rules_pdf:rules_pdfs(id, title, edition)');
    expect(q.select).toContain('creator:profiles!rules_pdf_unlock_codes_created_by_fkey(id, name)');
    expect(q.orders).toEqual([{ column: 'created_at', options: { ascending: false } }]);
});
