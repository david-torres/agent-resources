const { mock, test, expect, afterAll } = require('bun:test');

// Capture real `_base` so we can restore it and not leak the mock into
// sibling test files (same pattern as class.test.js).
const realBase = require('./_base');

// Like class.test.js's makeClient. NOTE: the fake ignores filter args, so
// negative cases (expired/missing unlocks) can't be asserted in this file;
// they're covered by util/class-family.test.js and class.test.js.
const makeClient = (tableToRows) => ({
    from(table) {
        const rows = tableToRows[table] ?? [];
        const result = { data: rows, error: null };
        const chain = {
            select() { return chain; },
            eq() { return chain; },
            or() { return chain; },
            limit() { return chain; },
            order() { return chain; },
            in() { return chain; },
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

const fakeClient = makeClient({
    classes: classRows,
    class_unlocks: [{ class_id: 'lib-v1', expires_at: null }]
});

mock.module('./_base', () => ({
    supabase: fakeClient,
    supabaseAdmin: fakeClient,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeClient
}));

// Bust the cache in case a sibling test file already loaded `./class`.
delete require.cache[require.resolve('./class')];
const { isClassUnlocked, getUnlockedClassIdsForUser } = require('./class');

afterAll(() => {
    mock.module('./_base', () => realBase);
    delete require.cache[require.resolve('./class')];
});

test('isClassUnlocked checks the whole same-edition version family', async () => {
    // User unlocked lib-v1; checking the v2 fork must count as unlocked
    // because both are in the same version family, and the aspirant fork
    // (lib-asp) must not, because it sits across the edition boundary.
    const result = await isClassUnlocked('u1', 'lib-v2');
    expect(result).toEqual({ data: true, error: null });

    const aspirantResult = await isClassUnlocked('u1', 'lib-asp');
    expect(aspirantResult).toEqual({ data: false, error: null });
});

test('getUnlockedClassIdsForUser expands direct unlocks to version families', async () => {
    const { data, error } = await getUnlockedClassIdsForUser('u1');
    expect(error).toBeNull();
    expect(data.has('lib-v1')).toBe(true);   // direct unlock
    expect(data.has('lib-v2')).toBe(true);   // same-edition fork included
    expect(data.has('lib-asp')).toBe(false); // edition fork excluded
});
