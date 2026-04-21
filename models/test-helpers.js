// Shared test helper: a tiny thenable Supabase-like client that records
// which tables were hit. Used by model tests to prove the injected client
// is actually dispatched to (and the default anon client is not).

const makeSpyClient = (tableToRows = {}) => {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const rows = tableToRows[table] ?? [];
      const result = { data: rows, error: null, count: rows.length };
      const chain = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        gte: () => chain,
        lte: () => chain,
        in: () => chain,
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (onF, onR) => Promise.resolve(result).then(onF, onR)
      };
      return chain;
    }
  };
};

module.exports = { makeSpyClient };
