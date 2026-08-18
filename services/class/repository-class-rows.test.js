// services/class/repository-class-rows.test.js
//
// classRowsByIds hydrates the profile page's "Unlocked Classes" table. Since
// the ids it receives are family-expanded (models/class.js
// #getEffectiveClassUnlocks), an admin's unpublished v2 draft of a core class
// is now in that set for every holder of the book — and the class-view route
// reads through the RLS-bound anon client, so its link 404s for them. The
// admin client this repository uses sees the draft; the filter here is what
// keeps it off the page.
const { mock, test, expect, afterAll } = require('bun:test');

const realBase = require('../../models/_base');

const PUBLIC_CORE = 'aaaaaaaa-0000-4000-8000-000000000001';
const PRIVATE_DRAFT_FORK = 'aaaaaaaa-0000-4000-8000-000000000002';
const PRIVATE_HELD_DIRECTLY = 'aaaaaaaa-0000-4000-8000-000000000003';

const ROWS = [
  { id: PUBLIC_CORE, name: 'Librarian', is_public: true },
  // An admin's unpublished v2 draft: same family, not visible to anyone else.
  { id: PRIVATE_DRAFT_FORK, name: 'Archivist', is_public: false },
  // A private class this user holds an explicit class_unlocks row for.
  { id: PRIVATE_HELD_DIRECTLY, name: 'Bespoke', is_public: false }
];

// Evaluates the subset of PostgREST filter syntax this repository emits:
// `is_public.eq.true` and `id.in.(uuid,uuid)`, or-joined at the top level.
const matchesTerm = (row, term) => {
  const inMatch = term.match(/^(\w+)\.in\.\((.*)\)$/);
  if (inMatch) return inMatch[2].split(',').includes(String(row[inMatch[1]]));
  const eqMatch = term.match(/^(\w+)\.eq\.(.*)$/);
  if (eqMatch) return String(row[eqMatch[1]]) === eqMatch[2];
  throw new Error(`unsupported filter term: ${term}`);
};
// Split on commas that are not inside an in-list's parentheses.
const splitOr = (expr) => expr.split(/,(?![^(]*\))/).map(term => term.trim()).filter(Boolean);

const calls = [];
const makeClient = () => ({
  from(table) {
    calls.push({ table });
    let rows = ROWS;
    const chain = {
      select(cols) { calls.push({ select: cols }); return chain; },
      in(col, values) {
        calls.push({ in: [col, values] });
        rows = rows.filter(row => values.includes(row[col]));
        return chain;
      },
      eq(col, val) {
        calls.push({ eq: [col, val] });
        rows = rows.filter(row => row[col] === val);
        return chain;
      },
      or(expr) {
        calls.push({ or: expr });
        const terms = splitOr(expr);
        rows = rows.filter(row => terms.some(term => matchesTerm(row, term)));
        return chain;
      },
      order(col) {
        calls.push({ order: col });
        rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
        return chain;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      }
    };
    return chain;
  }
});

mock.module('../../models/_base', () => ({
  supabase: makeClient(),
  supabaseAdmin: makeClient(),
  anonKey: 'test-anon-key',
  createUserClient: () => makeClient()
}));

delete require.cache[require.resolve('./repository')];
const repository = require('./repository');

afterAll(() => {
  mock.module('../../models/_base', () => realBase);
  delete require.cache[require.resolve('./repository')];
});

const ALL = [PUBLIC_CORE, PRIVATE_DRAFT_FORK, PRIVATE_HELD_DIRECTLY];

test('an unpublished fork pulled in by family expansion is not hydrated', async () => {
  const { data } = await repository.classRowsByIds(ALL);

  expect(data.map(row => row.id)).not.toContain(PRIVATE_DRAFT_FORK);
});

// Over-filtering is the opposite failure: a class the user holds an explicit
// class_unlocks row for was listed before this change and must stay listed,
// private or not. Only ids reached by family expansion get filtered.
test('a private class the user holds directly is still hydrated', async () => {
  const { data } = await repository.classRowsByIds(ALL, { alwaysVisibleIds: [PRIVATE_HELD_DIRECTLY] });

  expect(data.map(row => row.id)).toContain(PRIVATE_HELD_DIRECTLY);
  // ...and the exemption is scoped to that id, not a blanket disable.
  expect(data.map(row => row.id)).not.toContain(PRIVATE_DRAFT_FORK);
});

// The table now holds 6-12+ rows; with no ORDER BY, Postgres is free to
// return them in a different order on every page load.
test('rows come back ordered by name', async () => {
  const { data } = await repository.classRowsByIds(ALL, { alwaysVisibleIds: [PRIVATE_HELD_DIRECTLY] });

  expect(data.map(row => row.name)).toEqual(['Bespoke', 'Librarian']);
  expect(calls.some(call => call.order === 'name')).toBe(true);
});

test('an empty id set short-circuits without querying', async () => {
  calls.length = 0;
  const { data, error } = await repository.classRowsByIds([]);

  expect(data).toEqual([]);
  expect(error).toBeNull();
  expect(calls).toEqual([]);
});
