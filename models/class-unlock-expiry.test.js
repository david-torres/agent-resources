const { mock, test, expect, afterAll, beforeEach } = require('bun:test');

// Capture real `_base` so the mock doesn't leak into sibling test files
// (same pattern as models/class-unlock-family.test.js).
const realBase = require('./_base');

// Rows the fake client serves, swapped per test. The fake ignores filter
// args (including `.in()` -- it serves every row in a table regardless of
// which ids were requested), so each test supplies exactly the rows the
// real query would return after its `.eq()` / `.or()` / `.in()` filters ran.
let tableRows = { classes: [], class_unlocks: [] };

// Per-table error to simulate a failed read (e.g. an unreadable
// `class_unlocks` table). Empty by default; a test sets an entry to make
// the next `.from(that table)` resolve with `{ data: null, error }`.
let tableErrors = {};

// Every `.from(table)` call, in order, so a test can assert a table was
// (or wasn't) queried at all -- e.g. that the classes projection is skipped
// when there's nothing to resolve families for.
let fromCalls = [];

const fakeClient = {
    from(table) {
        fromCalls.push(table);
        if (tableErrors[table]) {
            const errorResult = { data: null, error: tableErrors[table] };
            const chain = {
                select() { return chain; },
                eq() { return chain; },
                or() { return chain; },
                limit() { return chain; },
                order() { return chain; },
                in() { return chain; },
                single() { return Promise.resolve(errorResult); },
                then(onFulfilled, onRejected) {
                    return Promise.resolve(errorResult).then(onFulfilled, onRejected);
                }
            };
            return chain;
        }

        // `table in tableRows` rather than `??` on purpose: a test sets a
        // table to null to simulate a projection that failed to load, and
        // `??` would silently rewrite that null into an empty array.
        const rows = table in tableRows ? tableRows[table] : [];
        const result = { data: rows, error: null };
        const chain = {
            select() { return chain; },
            eq() { return chain; },
            or() { return chain; },
            limit() { return chain; },
            order() { return chain; },
            in() { return chain; },
            single() {
                const first = Array.isArray(rows) ? (rows[0] ?? null) : null;
                return Promise.resolve({ data: first, error: null });
            },
            then(onFulfilled, onRejected) {
                return Promise.resolve(result).then(onFulfilled, onRejected);
            }
        };
        return chain;
    }
};

mock.module('./_base', () => ({
    supabase: fakeClient,
    supabaseAdmin: fakeClient,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeClient
}));

// Bust the cache in case a sibling test file already loaded `./class`.
delete require.cache[require.resolve('./class')];
const { getEffectiveClassUnlock, isClassUnlocked, getUnlockedClasses } = require('./class');

afterAll(() => {
    mock.module('./_base', () => realBase);
    delete require.cache[require.resolve('./class')];
});

// Advent Librarian v1 -> v2 fork, plus an aspirant fork that must stay
// outside the family.
const CLASS_ROWS = [
    { id: 'lib-v1', base_class_id: null, rules_edition: 'advent' },
    { id: 'lib-v2', base_class_id: 'lib-v1', rules_edition: 'advent' },
    { id: 'lib-asp', base_class_id: 'lib-v1', rules_edition: 'aspirant' }
];

beforeEach(() => {
    tableRows = { classes: CLASS_ROWS, class_unlocks: [] };
    tableErrors = {};
    fromCalls = [];
});

test('reports not unlocked when the user holds no active unlock', async () => {
    const { data, error } = await getEffectiveClassUnlock('user-1', 'lib-v1');
    expect(error).toBeNull();
    expect(data).toEqual({ unlocked: false, expiresAt: null });
});

test('reports not unlocked without a userId, without querying', async () => {
    const { data, error } = await getEffectiveClassUnlock(null, 'lib-v1');
    expect(error).toBeNull();
    expect(data).toEqual({ unlocked: false, expiresAt: null });
});

test('a single temporary unlock reports that row\'s expiry', async () => {
    tableRows.class_unlocks = [
        { class_id: 'lib-v1', expires_at: '2026-09-16T00:00:00Z' }
    ];
    const { data } = await getEffectiveClassUnlock('user-1', 'lib-v1');
    expect(data).toEqual({ unlocked: true, expiresAt: '2026-09-16T00:00:00Z' });
});

// The next three tests exercise leastRestrictiveExpiry's precedence rules
// (a permanent row beats a temporary one; the latest expiry wins regardless
// of row order) using whatever rows `tableRows.class_unlocks` holds. The
// fake's `.in()` is a no-op, so it serves these rows for ANY class id --
// these tests do NOT verify that family scoping itself (getVersionFamilyIds
// -> activeUnlockRows's `.in(familyIds)`) actually restricts the query to
// the right ids; a class outside the family would pass identically here.
// Family scoping is pinned by models/class-unlock-family.test.js, whose fake
// records `.in()` calls and asserts on them.
test('a permanent unlock in the family beats a temporary one', async () => {
    tableRows.class_unlocks = [
        { class_id: 'lib-v2', expires_at: '2026-09-16T00:00:00Z' },
        { class_id: 'lib-v1', expires_at: null }
    ];
    const { data } = await getEffectiveClassUnlock('user-1', 'lib-v2');
    expect(data).toEqual({ unlocked: true, expiresAt: null });
});

test('two temporary unlocks in one family resolve to the later expiry', async () => {
    tableRows.class_unlocks = [
        { class_id: 'lib-v1', expires_at: '2026-09-16T00:00:00Z' },
        { class_id: 'lib-v2', expires_at: '2026-12-01T00:00:00Z' }
    ];
    const { data } = await getEffectiveClassUnlock('user-1', 'lib-v1');
    expect(data).toEqual({ unlocked: true, expiresAt: '2026-12-01T00:00:00Z' });
});

test('the later expiry wins regardless of row order', async () => {
    tableRows.class_unlocks = [
        { class_id: 'lib-v2', expires_at: '2026-12-01T00:00:00Z' },
        { class_id: 'lib-v1', expires_at: '2026-09-16T00:00:00Z' }
    ];
    const { data } = await getEffectiveClassUnlock('user-1', 'lib-v1');
    expect(data.expiresAt).toBe('2026-12-01T00:00:00Z');
});

// `leastRestrictiveExpiry` compares timestamps as instants (Date.parse), not
// as strings, precisely because Postgres/Supabase can hand back the same
// domain of timestamps formatted with different offset spellings. Here
// lib-v1's row uses a `+09:00` offset -- real instant 2026-09-16T16:00:00Z --
// while lib-v2's uses `Z` and represents the genuinely later
// 2026-09-16T20:00:00Z. Lexicographically, though, '2026-09-17T01:00:00+09:00'
// > '2026-09-16T20:00:00Z' (the '17' day digit beats '16'), so a plain
// string comparison would pick lib-v1's row -- the actually-earlier instant
// -- as "latest".
test('the later expiry wins by real instant, not by lexicographic string order', async () => {
    tableRows.class_unlocks = [
        { class_id: 'lib-v1', expires_at: '2026-09-17T01:00:00+09:00' }, // = 2026-09-16T16:00:00Z
        { class_id: 'lib-v2', expires_at: '2026-09-16T20:00:00Z' }       // later real instant
    ];
    const { data } = await getEffectiveClassUnlock('user-1', 'lib-v1');
    expect(data.expiresAt).toBe('2026-09-16T20:00:00Z');
});

test('isClassUnlocked still returns a plain boolean', async () => {
    tableRows.class_unlocks = [
        { class_id: 'lib-v1', expires_at: '2026-09-16T00:00:00Z' }
    ];
    const unlocked = await isClassUnlocked('user-1', 'lib-v1');
    expect(unlocked).toEqual({ data: true, error: null });

    tableRows.class_unlocks = [];
    const locked = await isClassUnlocked('user-1', 'lib-v1');
    expect(locked).toEqual({ data: false, error: null });
});

// This feeds `canViewClassPdf` directly, so a repository error must fail
// closed (no access, no crash) rather than throw or leak a truthy value.
test('a repository error on the unlocks read fails closed', async () => {
    tableErrors.class_unlocks = { message: 'unlocks table unreadable' };
    const { data, error } = await getEffectiveClassUnlock('user-1', 'lib-v1');
    expect(error).toEqual({ message: 'unlocks table unreadable' });
    expect(data).toEqual({ unlocked: false, expiresAt: null });
});

// `unlockedClassRows` selects `class:classes(*), expires_at`, so its rows
// carry a nested class object. The fake ignores `.select()`, so a fixture
// row can carry both that nested object and the flat `class_id` the
// family-resolution path reads.
const unlockRow = (classId, name, expiresAt) => ({
    class_id: classId,
    expires_at: expiresAt,
    class: { id: classId, name, status: 'release', rules_edition: 'advent', rules_version: 'v1' }
});

test('a temporary unlock surfaces its expiry on the listed class', async () => {
    tableRows.class_unlocks = [unlockRow('lib-v1', 'Librarian', '2026-09-16T00:00:00Z')];
    const { data } = await getUnlockedClasses('user-1');
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('lib-v1');
    expect(data[0].name).toBe('Librarian');
    expect(data[0].unlock_expires_at).toBe('2026-09-16T00:00:00Z');
});

test('a permanent unlock surfaces a null expiry', async () => {
    tableRows.class_unlocks = [unlockRow('lib-v1', 'Librarian', null)];
    const { data } = await getUnlockedClasses('user-1');
    expect(data[0].unlock_expires_at).toBeNull();
});

test('a permanent unlock elsewhere in the family clears its relatives\' expiry', async () => {
    tableRows.class_unlocks = [
        unlockRow('lib-v1', 'Librarian', null),
        unlockRow('lib-v2', 'Librarian II', '2026-09-16T00:00:00Z')
    ];
    const { data } = await getUnlockedClasses('user-1');
    const v2 = data.find(c => c.id === 'lib-v2');
    expect(v2.unlock_expires_at).toBeNull();
});

test('an unlock in a different edition does not affect the family', async () => {
    // lib-asp is an aspirant fork of lib-v1, so it is a separate family.
    tableRows.class_unlocks = [
        unlockRow('lib-asp', 'Librarian (Aspirant)', null),
        unlockRow('lib-v1', 'Librarian', '2026-09-16T00:00:00Z')
    ];
    const { data } = await getUnlockedClasses('user-1');
    const v1 = data.find(c => c.id === 'lib-v1');
    expect(v1.unlock_expires_at).toBe('2026-09-16T00:00:00Z');
});

test('the later expiry wins across a family', async () => {
    tableRows.class_unlocks = [
        unlockRow('lib-v1', 'Librarian', '2026-09-16T00:00:00Z'),
        unlockRow('lib-v2', 'Librarian II', '2026-12-01T00:00:00Z')
    ];
    const { data } = await getUnlockedClasses('user-1');
    expect(data.find(c => c.id === 'lib-v1').unlock_expires_at).toBe('2026-12-01T00:00:00Z');
    expect(data.find(c => c.id === 'lib-v2').unlock_expires_at).toBe('2026-12-01T00:00:00Z');
});

test('degrades to the row\'s own expiry when the class projection is unavailable', async () => {
    // `fetchClassFamilyRows` returns null when the classes projection can't
    // be read (`services/class/repository.js:43-57` bails on a non-array),
    // so a null `classes` table is what that failure looks like here. Each
    // row must fall back to its own expiry rather than losing it.
    tableRows.classes = null;
    tableRows.class_unlocks = [
        unlockRow('lib-v1', 'Librarian', '2026-09-16T00:00:00Z'),
        unlockRow('lib-v2', 'Librarian II', null)
    ];
    const { data } = await getUnlockedClasses('user-1');
    // Without the projection there is no family, so v2's permanent unlock
    // must NOT clear v1's expiry.
    expect(data.find(c => c.id === 'lib-v1').unlock_expires_at).toBe('2026-09-16T00:00:00Z');
    expect(data.find(c => c.id === 'lib-v2').unlock_expires_at).toBeNull();
});

test('returns an empty list when the user has no active unlocks', async () => {
    tableRows.class_unlocks = [];
    fromCalls.length = 0;
    const { data } = await getUnlockedClasses('user-1');
    expect(data).toEqual([]);
    // No unlocks means no family to resolve -- the classes projection must
    // not be fetched at all.
    expect(fromCalls).not.toContain('classes');
});
