const { mock, test, expect, afterAll } = require('bun:test');

const realBase = require('../../models/_base');

// Resolves a dotted PostgREST column reference ('rules_pdf.book_type')
// against a joined row, so the fake below can honour qualified filters the
// same way the server does.
const valueAt = (row, path) => path
  .split('.')
  .reduce((acc, key) => (acc == null ? acc : acc[key]), row);

// Narrows each embedded resource to the columns the select string actually
// asks for. book_type is filtered on but never selected, so without this the
// fake would hand the caller a column the real query cannot return.
const EMBED = /(\w+):\w+(?:!inner)?\(([^)]*)\)/g;
const projectEmbeds = (row, select) => {
  if (typeof select !== 'string') return row;
  const projected = { ...row };
  for (const [, alias, cols] of select.matchAll(EMBED)) {
    if (!projected[alias]) continue;
    projected[alias] = Object.fromEntries(
      cols.split(',').map(col => col.trim()).filter(Boolean).map(col => [col, projected[alias][col]])
    );
  }
  return projected;
};

// Records the query the repository builds and resolves it to `result`, with
// `.eq()` actually applied to the rows. Filtering here is what makes "a
// supplement must not come back" a real assertion rather than a restatement
// of the fixture: drop the book_type filter from the repository and the
// supplement row survives. Dropped rows model an INNER join — the `!inner`
// hint that makes the server behave this way is asserted separately, since a
// non-inner embed would return the parent row with a null embed instead.
const makeClient = (result, calls) => ({
  from(table) {
    calls.push({ table });
    const eqFilters = [];
    let projection = null;
    const chain = {
      select(cols) { calls.push({ select: cols }); projection = cols; return chain; },
      eq(col, val) { calls.push({ eq: [col, val] }); eqFilters.push([col, val]); return chain; },
      or(expr) { calls.push({ or: expr }); return chain; },
      then(onFulfilled, onRejected) {
        const { data, error } = result;
        const resolved = (error || !Array.isArray(data))
          ? result
          : {
              // Filter against the unprojected row — a filter may reference a
              // column the projection omits, which is exactly the book_type case.
              data: data
                .filter(row => eqFilters.every(([col, val]) => valueAt(row, col) === val))
                .map(row => projectEmbeds(row, projection)),
              error: null
            };
        return Promise.resolve(resolved).then(onFulfilled, onRejected);
      }
    };
    return chain;
  }
});

const calls = [];
// One core rulebook and one supplement for the same ruleset. The supplement
// is legitimately rules_edition 'advent' — it belongs to that ruleset — but
// it confers no classes, so it must never reach the resolver.
const rows = [
  { user_id: 'u1', expires_at: '2026-09-16T00:00:00Z', rules_pdf: { rules_edition: 'advent', title: 'Enclave: Advent', book_type: 'core' } },
  { user_id: 'u1', expires_at: null, rules_pdf: { rules_edition: 'advent', title: 'Advent GM Screen', book_type: 'supplement' } }
];

mock.module('../../models/_base', () => ({
  supabase: makeClient({ data: [], error: null }, []),
  supabaseAdmin: makeClient({ data: rows, error: null }, calls),
  anonKey: 'test-anon-key',
  createUserClient: () => makeClient({ data: [], error: null }, [])
}));

delete require.cache[require.resolve('./repository')];
const rulesRepository = require('./repository');

afterAll(() => {
  mock.module('../../models/_base', () => realBase);
  delete require.cache[require.resolve('./repository')];
});

// The grant's expires_at rides along with the book: a book-derived class is
// only as durable as the grant conferring it, so the resolver needs both.
test('flattens the joined rules_pdfs rows, carrying the grant expiry', async () => {
  const { data, error } = await rulesRepository.fetchActiveBooksForUser({
    userId: 'u1',
    nowIso: '2026-08-07T00:00:00.000Z'
  });

  expect(error).toBeNull();
  expect(data).toEqual([
    { rules_edition: 'advent', title: 'Enclave: Advent', expires_at: '2026-09-16T00:00:00Z' }
  ]);
});

// rules_edition says which ruleset a book belongs to; book_type says whether
// it is the core rulebook. Only a core book confers the ruleset's roster —
// a supplement, GM screen, or adventure module for Advent grants nothing.
test('a supplement for the ruleset does not come back', async () => {
  const { data } = await rulesRepository.fetchActiveBooksForUser({
    userId: 'u1',
    nowIso: '2026-08-07T00:00:00.000Z'
  });

  expect(data.map(book => book.title)).toEqual(['Enclave: Advent']);
});

// book_type lives on the EMBEDDED rules_pdfs resource, not on the
// rules_pdf_unlocks row being selected. A bare .eq('book_type', 'core')
// would target rules_pdf_unlocks and error; the filter has to be qualified
// with the embed alias, and the embed has to be an inner join or the parent
// unlock row still comes back (with a null embed) instead of being dropped.
test('filters book_type on the embedded resource through an inner join', async () => {
  calls.length = 0;
  await rulesRepository.fetchActiveBooksForUser({
    userId: 'u1',
    nowIso: '2026-08-07T00:00:00.000Z'
  });

  const select = calls.find(c => typeof c.select === 'string');
  expect(select.select).toContain('rules_pdfs!inner');
  expect(calls.some(c => Array.isArray(c.eq) && c.eq[0] === 'rules_pdf.book_type' && c.eq[1] === 'core')).toBe(true);
  expect(calls.some(c => Array.isArray(c.eq) && c.eq[0] === 'book_type')).toBe(false);
});

test('queries rules_pdf_unlocks for the user, filtering expired grants', async () => {
  calls.length = 0;
  await rulesRepository.fetchActiveBooksForUser({
    userId: 'u1',
    nowIso: '2026-08-07T00:00:00.000Z'
  });

  expect(calls.some(c => c.table === 'rules_pdf_unlocks')).toBe(true);
  expect(calls.some(c => Array.isArray(c.eq) && c.eq[0] === 'user_id' && c.eq[1] === 'u1')).toBe(true);
  expect(calls.some(c => typeof c.or === 'string' && c.or.includes('expires_at.is.null'))).toBe(true);
  // is_active is deliberately NOT filtered: a retired edition still names the
  // ruleset the user owns.
  expect(calls.some(c => Array.isArray(c.eq) && c.eq[0] === 'is_active')).toBe(false);
});

test('surfaces the error when the query fails, with no data to mistake for no books', async () => {
  mock.module('../../models/_base', () => ({
    supabase: makeClient({ data: null, error: { message: 'boom' } }, []),
    supabaseAdmin: makeClient({ data: null, error: { message: 'boom' } }, []),
    anonKey: 'test-anon-key',
    createUserClient: () => makeClient({ data: null, error: null }, [])
  }));
  delete require.cache[require.resolve('./repository')];
  const failing = require('./repository');

  const { data, error } = await failing.fetchActiveBooksForUser({
    userId: 'u1',
    nowIso: '2026-08-07T00:00:00.000Z'
  });

  expect(data).toBeNull();
  expect(error).not.toBeNull();
});
