const { mock, test, expect, afterAll } = require('bun:test');

const realBase = require('./_base');

// Records inserts, eq filters, and rpc calls; resolves with canned data.
const inserted = [];
const eqCalls = [];
const rpcCalls = [];
const fakeClient = {
    from(table) {
        let pendingRows = [];
        const chain = {
            insert(rows) {
                inserted.push({ table, rows });
                pendingRows = rows;
                return chain;
            },
            select() { return chain; },
            eq(column, value) {
                eqCalls.push({ table, column, value });
                return chain;
            },
            order() { return chain; },
            then(onFulfilled, onRejected) {
                return Promise.resolve({ data: pendingRows, error: null }).then(onFulfilled, onRejected);
            }
        };
        return chain;
    },
    rpc(name, args) {
        rpcCalls.push({ name, args });
        return Promise.resolve({ data: 'pdf-1', error: null });
    }
};

mock.module('./_base', () => ({
    supabase: fakeClient,
    supabaseAdmin: fakeClient,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeClient
}));

delete require.cache[require.resolve('./rules')];
const {
    createRulesPdfUnlockCodes,
    listRulesPdfUnlockCodes,
    redeemRulesPdfUnlockCode
} = require('./rules');

afterAll(() => {
    mock.module('./_base', () => realBase);
    delete require.cache[require.resolve('./rules')];
});

test('createRulesPdfUnlockCodes inserts amount rows with unique base64url codes', async () => {
    inserted.length = 0;
    const { data, error } = await createRulesPdfUnlockCodes({
        rulesPdfId: 'pdf-1',
        createdByProfileId: 'profile-1',
        expiresAt: null,
        maxUses: 5,
        amount: 3
    });
    expect(error).toBeNull();
    expect(inserted.length).toBe(1);
    const { table, rows } = inserted[0];
    expect(table).toBe('rules_pdf_unlock_codes');
    expect(rows.length).toBe(3);
    for (const row of rows) {
        expect(row.rules_pdf_id).toBe('pdf-1');
        expect(row.created_by).toBe('profile-1');
        expect(row.expires_at).toBeNull();
        expect(row.max_uses).toBe(5);
        // crypto.randomBytes(12).toString('base64url') => 16 url-safe chars
        expect(row.code).toMatch(/^[A-Za-z0-9_-]{16}$/);
    }
    expect(new Set(rows.map(r => r.code)).size).toBe(3);
    expect(Array.isArray(data)).toBe(true);
});

test('listRulesPdfUnlockCodes filters by rules_pdf_id', async () => {
    eqCalls.length = 0;
    const { error } = await listRulesPdfUnlockCodes('pdf-1');
    expect(error).toBeNull();
    expect(eqCalls).toEqual([
        { table: 'rules_pdf_unlock_codes', column: 'rules_pdf_id', value: 'pdf-1' }
    ]);
});

test('redeemRulesPdfUnlockCode calls the for_user RPC', async () => {
    rpcCalls.length = 0;
    const { data, error } = await redeemRulesPdfUnlockCode('CODE123', 'user-1');
    expect(error).toBeNull();
    expect(data).toBe('pdf-1');
    expect(rpcCalls).toEqual([
        { name: 'redeem_rules_pdf_code_for_user', args: { p_code: 'CODE123', p_user_id: 'user-1' } }
    ]);
});
