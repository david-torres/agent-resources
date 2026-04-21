const { mock, test, expect, beforeAll, afterAll } = require('bun:test');

// Capture real `_base` so we can restore it after this file runs and not
// leak the mock into sibling test files.
const realBase = require('./_base');

// Build a fake supabase client. `.from(table)` returns a chain object whose
// `.select()`, `.eq()`, `.or()`, `.limit()`, `.single()` all return the
// chain again. The chain itself is thenable, resolving to `{ data, error }`
// with data sourced from `tableToRows`. `.single()` resolves to the first
// row. This supports both terminal shapes used by `class.js`:
//   .from(t).select(...).eq(k,v).eq(k2,v2).or(expr).limit(n)
//   .from(t).select(...).eq(k,v).or(expr)
const makeClient = (tableToRows) => ({
    from(table) {
        const rows = tableToRows[table] ?? [];
        const result = { data: rows, error: null };
        const singleResult = {
            data: Array.isArray(rows) ? (rows[0] ?? null) : rows,
            error: null
        };

        const chain = {
            select() { return chain; },
            eq() { return chain; },
            or() { return chain; },
            limit() { return chain; },
            order() { return chain; },
            single() { return Promise.resolve(singleResult); },
            then(onFulfilled, onRejected) {
                return Promise.resolve(result).then(onFulfilled, onRejected);
            }
        };
        return chain;
    }
});

const unlockRow = {
    class: { id: 'class-1', name: 'Illusionist' },
    expires_at: null
};

// Anon is RLS-blocked: zero class_unlocks rows even when the user really
// has unlocks. This mirrors the production bug — the shared anon client
// carries no JWT after `setSession` removal.
const fakeAnon = makeClient({
    class_unlocks: []
});

// Admin has the real row. The fix routes these reads through supabaseAdmin.
const fakeAdmin = makeClient({
    class_unlocks: [unlockRow]
});

mock.module('./_base', () => ({
    supabase: fakeAnon,
    supabaseAdmin: fakeAdmin,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeAnon
}));

// Bust the cache in case a sibling test file already loaded `./class` with
// the real `_base`.
delete require.cache[require.resolve('./class')];
const { getUnlockedClasses, isClassUnlocked } = require('./class');

afterAll(() => {
    mock.module('./_base', () => realBase);
    delete require.cache[require.resolve('./class')];
});

test('unlock reads route through supabaseAdmin so anon RLS does not hide rows', async () => {
    const listResult = await getUnlockedClasses('u1');
    expect(listResult.error).toBeFalsy();
    expect(Array.isArray(listResult.data)).toBe(true);
    expect(listResult.data.length).toBe(1);
    expect(listResult.data[0]).toEqual({ id: 'class-1', name: 'Illusionist' });

    const unlockedResult = await isClassUnlocked('u1', 'class-1');
    expect(unlockedResult).toEqual({ data: true, error: null });
});
