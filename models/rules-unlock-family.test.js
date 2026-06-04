const { mock, test, expect, afterAll } = require('bun:test');

const realBase = require('./_base');

// NOTE: the fake ignores filter args, so negative cases (expired/missing
// unlocks) can't be asserted in this file; expiry preference logic is
// covered by util/rules-family.test.js.
const makeRecordingClient = (tableToRows, inCalls) => ({
    from(table) {
        const rows = tableToRows[table] ?? [];
        const result = { data: rows, error: null };
        const chain = {
            select() { return chain; },
            eq() { return chain; },
            or() { return chain; },
            limit() { return chain; },
            order() { return chain; },
            in(column, values) {
                inCalls.push({ table, column, values });
                return chain;
            },
            single() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
            maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
            then(onFulfilled, onRejected) {
                return Promise.resolve(result).then(onFulfilled, onRejected);
            }
        };
        return chain;
    }
});

const inCalls = [];
const fakeClient = makeRecordingClient({
    rules_pdfs: [
        { id: 'adv-v1', title: 'Enclave: Advent', edition: 'v1' },
        { id: 'adv-v2', title: 'Enclave: Advent', edition: 'v2' }
    ],
    rules_pdf_unlocks: [{ rules_pdf_id: 'adv-v1', expires_at: null }]
}, inCalls);

mock.module('./_base', () => ({
    supabase: fakeClient,
    supabaseAdmin: fakeClient,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeClient
}));

delete require.cache[require.resolve('./rules')];
const { canViewRulesPdf } = require('./rules');

afterAll(() => {
    mock.module('./_base', () => realBase);
    delete require.cache[require.resolve('./rules')];
});

test('canViewRulesPdf honors unlocks across the title family', async () => {
    inCalls.length = 0;
    // User holds a v1 unlock; viewing the v2 PDF must be allowed.
    const result = await canViewRulesPdf(
        { userId: 'u1', role: null },
        { id: 'adv-v2', title: 'Enclave: Advent', storage_path: 'p.pdf' }
    );
    expect(result).toEqual({ data: true, error: null });

    const unlockCall = inCalls.find(c => c.table === 'rules_pdf_unlocks' && c.column === 'rules_pdf_id');
    expect(unlockCall).toBeTruthy();
    expect(new Set(unlockCall.values)).toEqual(new Set(['adv-v1', 'adv-v2']));
});
