// Rules-PDF version families: versions of the same product share a title
// (rules_pdfs is UNIQUE(edition, title); the edition column holds the
// version). An unlock for any version applies to every version of that
// title — mirrors class version-family unlocks (util/class-family.js).

// rules: array of { id, title } (the rendered PDF list)
// unlocks: array of { rules_pdf_id, expires_at, ... }
// Returns Map of rules_pdf_id -> best unlock covering it (non-expiring
// preferred, else latest expiry).
const expandRulesUnlocksByTitle = (rules, unlocks) => {
  const titleById = new Map(rules.map(r => [r.id, r.title]));

  const better = (a, b) => {
    if (!a) return b;
    if (!a.expires_at) return a;
    if (!b.expires_at) return b;
    return new Date(a.expires_at) >= new Date(b.expires_at) ? a : b;
  };

  const bestByTitle = new Map();
  for (const unlock of unlocks) {
    const title = titleById.get(unlock.rules_pdf_id);
    if (!title) continue; // unlock for a PDF outside the visible list
    bestByTitle.set(title, better(bestByTitle.get(title), unlock));
  }

  const covered = new Map();
  for (const rule of rules) {
    const unlock = bestByTitle.get(rule.title);
    if (unlock) covered.set(rule.id, unlock);
  }
  return covered;
};

module.exports = { expandRulesUnlocksByTitle };
