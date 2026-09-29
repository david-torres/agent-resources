// Signature and Ability names are written by class authors and players, and
// compare trimmed and case-folded wherever two must be told apart.
const nameKey = (value) => String(value ?? '').trim().toLowerCase();

// The first spelling of every name that appears more than once.
const duplicateNames = (names) => {
  const firstSpelling = new Map();
  const repeated = new Set();
  for (const name of names) {
    const key = nameKey(name);
    if (firstSpelling.has(key)) repeated.add(key);
    else firstSpelling.set(key, name);
  }
  return [...repeated].map(key => firstSpelling.get(key));
};

module.exports = { nameKey, duplicateNames };
