// A chainable stand-in for the Supabase query builder. Every call records
// itself, so tests can assert the FILTERS were applied — a stub that only
// returned rows would pass even if a filter like hide_from_search were dropped.
//
// Most queries terminate the chain by calling `limit`, which returns a real
// Promise. A few (e.g. getAllNews) never call `.limit()` and instead `await`
// the builder directly after `.order()` — so the builder itself is also
// thenable, resolving to the same { data, error } shape. Callers that do call
// `.limit()` never see this: `await`ing its real Promise never touches
// `builder.then`.
const clientStub = (rows) => {
  const calls = [];
  const builder = {
    select: (...a) => { calls.push(['select', ...a]); return builder; },
    eq: (...a) => { calls.push(['eq', ...a]); return builder; },
    neq: (...a) => { calls.push(['neq', ...a]); return builder; },
    order: (...a) => { calls.push(['order', ...a]); return builder; },
    limit: (...a) => { calls.push(['limit', ...a]); return Promise.resolve({ data: rows, error: null }); },
    then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject)
  };
  const client = {
    from: (table) => { calls.push(['from', table]); return builder; }
  };
  return { client, builder: { calls } };
};

module.exports = { clientStub };
