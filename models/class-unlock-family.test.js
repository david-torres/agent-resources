const { mock, test, expect, afterAll } = require('bun:test');

// Capture real `_base` so we can restore it and not leak the mock into
// sibling test files (same pattern as class.test.js).
const realBase = require('./_base');

// Like class.test.js's makeClient, but records `.in()` calls so tests can
// assert which ids the unlock query was given.
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
            then(onFulfilled, onRejected) {
                return Promise.resolve(result).then(onFulfilled, onRejected);
            }
        };
        return chain;
    }
});

// Advent Librarian v1 + v2 fork, plus an aspirant edition fork that must
// stay outside the family.
const classRows = [
    { id: 'lib-v1', base_class_id: null, rules_edition: 'advent' },
    { id: 'lib-v2', base_class_id: 'lib-v1', rules_edition: 'advent' },
    { id: 'lib-asp', base_class_id: 'lib-v1', rules_edition: 'aspirant' }
];

const inCalls = [];
const fakeClient = makeRecordingClient({
    classes: classRows,
    class_unlocks: [{ class_id: 'lib-v1', expires_at: null }]
}, inCalls);

mock.module('./_base', () => ({
    supabase: fakeClient,
    supabaseAdmin: fakeClient,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeClient
}));

// Bust the cache in case a sibling test file already loaded `./class`.
delete require.cache[require.resolve('./class')];
const { isClassUnlocked } = require('./class');

afterAll(() => {
    mock.module('./_base', () => realBase);
    delete require.cache[require.resolve('./class')];
});

test('isClassUnlocked checks the whole same-edition version family', async () => {
    inCalls.length = 0;
    // User unlocked lib-v1; checking the v2 fork must count as unlocked.
    const result = await isClassUnlocked('u1', 'lib-v2');
    expect(result).toEqual({ data: true, error: null });

    // The unlock query must cover exactly the same-edition family —
    // not the aspirant edition fork.
    const unlockCall = inCalls.find(c => c.table === 'class_unlocks' && c.column === 'class_id');
    expect(unlockCall).toBeTruthy();
    expect(new Set(unlockCall.values)).toEqual(new Set(['lib-v1', 'lib-v2']));
});
