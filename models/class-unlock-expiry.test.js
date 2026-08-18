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

// getUnlockedClasses reads `classes` twice: once unfiltered for the version
// family projection, once with `.in('id', ...)` to hydrate the resolved ids.
// Set this to make only the first fail, which is the case the degradation
// path is about.
let familyProjectionFails = false;

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
        // `.in()` IS honored (unlike the other filter methods): hydration
        // reads `classes` with `.in('id', resolvedIds)`, and a fake that
        // served every class row regardless would hide whether the resolver
        // picked the right ids at all.
        let filter = null;
        const resolve = () => {
            if (familyProjectionFails && table === 'classes' && !filter) {
                return { data: null, error: null };
            }
            if (!filter || !Array.isArray(rows)) return { data: rows, error: null };
            const [column, values] = filter;
            return { data: rows.filter(row => values.includes(row[column])), error: null };
        };
        const chain = {
            select() { return chain; },
            eq() { return chain; },
            or() { return chain; },
            limit() { return chain; },
            order() { return chain; },
            in(column, values) { filter = [column, values]; return chain; },
            single() {
                const data = resolve().data;
                const first = Array.isArray(data) ? (data[0] ?? null) : null;
                return Promise.resolve({ data: first, error: null });
            },
            then(onFulfilled, onRejected) {
                return Promise.resolve(resolve()).then(onFulfilled, onRejected);
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
const { getEffectiveClassUnlock, isClassUnlocked, getUnlockedClasses, canViewClassPdf } = require('./class');

afterAll(() => {
    mock.module('./_base', () => realBase);
    delete require.cache[require.resolve('./class')];
});

// Advent Librarian v1 -> v2 fork, plus an aspirant fork that must stay
// outside the family.
// These rows serve both reads now -- the family projection and the hydration
// -- so they carry the display columns getUnlockedClasses returns.
const CLASS_ROWS = [
    { id: 'lib-v1', name: 'Librarian', is_public: true, base_class_id: null, rules_edition: 'advent' },
    { id: 'lib-v2', name: 'Librarian II', is_public: true, base_class_id: 'lib-v1', rules_edition: 'advent' },
    { id: 'lib-asp', name: 'Librarian (Aspirant)', is_public: true, base_class_id: 'lib-v1', rules_edition: 'aspirant' }
];

beforeEach(() => {
    tableRows = { classes: CLASS_ROWS, class_unlocks: [], rules_pdf_unlocks: [] };
    tableErrors = {};
    fromCalls = [];
    familyProjectionFails = false;
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
// (a permanent grant beats a temporary one; the latest expiry wins regardless
// of row order) using whatever rows `tableRows.class_unlocks` holds. The
// resolver reduces every grant covering an id down to one effective expiry,
// so these pin that reduction rather than the family scoping that feeds it.
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
// closed on data (no access leaks) -- but the error itself has to SURFACE,
// not degrade into "no unlocks". An infrastructure failure answered with
// `{ unlocked: false, error: null }` is indistinguishable from an
// authoritative denial, so routes turn a transient outage into a 403
// instead of a 500 and nothing is observable. Pre-1da7c8b these paths
// propagated the error; these tests pin that contract.
test('a repository error on the unlocks read surfaces a non-null error and fails closed', async () => {
    tableErrors.class_unlocks = { message: 'unlocks table unreadable' };
    const { data, error } = await getEffectiveClassUnlock('user-1', 'lib-v1');
    expect(error).not.toBeNull();
    // Fail closed on data: whether the envelope carries null data or an
    // explicit locked shape, it must not report the class as unlocked.
    expect(data?.unlocked).toBeFalsy();
});

test('a repository error on the books read surfaces a non-null error and fails closed', async () => {
    tableErrors.rules_pdf_unlocks = { message: 'books table unreadable' };
    const { data, error } = await getEffectiveClassUnlock('user-1', 'lib-v1');
    expect(error).not.toBeNull();
    expect(data?.unlocked).toBeFalsy();
});

// The route-facing check: routes/classes.js decides 500-vs-403 off this
// envelope, so the error member must ride through isClassUnlocked and
// canViewClassPdf rather than being flattened to `error: null`.
test('canViewClassPdf propagates the error when the unlocks read fails', async () => {
    tableErrors.class_unlocks = { message: 'unlocks table unreadable' };
    const { data, error } = await canViewClassPdf(
        { userId: 'user-1' },
        { id: 'lib-v1', pdf_storage_path: 'pdfs/lib-v1.pdf' }
    );
    expect(error).not.toBeNull();
    expect(data).toBe(false);
});

// Unlock rows are read flat now (`class_id, expires_at`) and the class body
// is hydrated separately from CLASS_ROWS, so the nested `class` object here
// is vestigial for hydration -- it stays only because the flat fields are
// what the resolver reads.
const unlockRow = (classId, name, expiresAt) => ({
    class_id: classId,
    expires_at: expiresAt,
    class: { id: classId, name, status: 'release', rules_edition: 'advent', rules_version: 'v1' }
});

test('a temporary unlock surfaces its expiry on the listed class', async () => {
    tableRows.class_unlocks = [unlockRow('lib-v1', 'Librarian', '2026-09-16T00:00:00Z')];
    const { data } = await getUnlockedClasses('user-1');
    // The unlock covers the whole same-edition family, so v2 is listed too;
    // the aspirant fork stays out of it.
    expect(data.map(c => c.id).sort()).toEqual(['lib-v1', 'lib-v2']);
    const v1 = data.find(c => c.id === 'lib-v1');
    expect(v1.name).toBe('Librarian');
    expect(v1.unlock_expires_at).toBe('2026-09-16T00:00:00Z');
    // The expiry is family-wide: the fork it reaches carries it too.
    expect(data.find(c => c.id === 'lib-v2').unlock_expires_at).toBe('2026-09-16T00:00:00Z');
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
    // be read (`services/class/repository.js` bails on a non-array). Only
    // that read fails here -- hydration still resolves the ids -- so each
    // row must fall back to its own expiry rather than losing it.
    familyProjectionFails = true;
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
