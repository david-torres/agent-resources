const { test, expect } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// classes.rules_version is compared by exact string across the character sheet,
// so a stored 'v2 ' renders every character on the class as v1 with no error.
const loadModel = (rpcCalls) => {
    const client = {
        rpc: (name, params) => {
            rpcCalls.push({ name, params });
            return Promise.resolve({ data: { id: 'new-class' }, error: null });
        }
    };
    return freshRequire(require.resolve('./class'), new Map([
        [require.resolve('./_base'), {
            supabase: client,
            supabaseAdmin: client,
            anonKey: 'test-anon-key',
            createUserClient: () => client
        }]
    ]));
};

test('duplicateClass trims whitespace from the version before the RPC', async () => {
    const rpcCalls = [];
    const { duplicateClass } = loadModel(rpcCalls);

    await duplicateClass('base-1', ' v2 ');

    expect(rpcCalls[0].name).toBe('dup_class');
    expect(rpcCalls[0].params.new_version).toBe('v2');
});

test('duplicateClass trims whitespace from the edition before the RPC', async () => {
    const rpcCalls = [];
    const { duplicateClass } = loadModel(rpcCalls);

    await duplicateClass('base-1', 'v2', ' second ');

    expect(rpcCalls[0].params.new_edition).toBe('second');
});
