// A chainable stand-in for the Supabase query builder. Every call records
// itself, so tests can assert the FILTERS were applied — a stub that only
// returned rows would pass even if a filter like hide_from_search were dropped.
//
// Every method (including `limit` and `single`) returns the same builder, and
// the builder is itself thenable, resolving to { data: rows, error: null } —
// `single` narrows that to the first row instead. This mirrors the real
// PostgREST builder, which stays chainable after `limit()`: isSlugUnique
// (models/pages.js) calls `.limit(1)` and then conditionally chains `.neq()`
// onto the result.
const clientStub = (rows) => {
  const calls = [];
  const singleRow = () => (Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null));
  const builder = {
    select: (...a) => { calls.push(['select', ...a]); return builder; },
    eq: (...a) => { calls.push(['eq', ...a]); return builder; },
    neq: (...a) => { calls.push(['neq', ...a]); return builder; },
    order: (...a) => { calls.push(['order', ...a]); return builder; },
    insert: (...a) => { calls.push(['insert', ...a]); return builder; },
    update: (...a) => { calls.push(['update', ...a]); return builder; },
    limit: (...a) => { calls.push(['limit', ...a]); return builder; },
    single: (...a) => { calls.push(['single', ...a]); return Promise.resolve({ data: singleRow(), error: null }); },
    then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject)
  };
  const client = {
    from: (table) => { calls.push(['from', table]); return builder; }
  };
  return { client, builder: { calls } };
};

module.exports = { clientStub };
