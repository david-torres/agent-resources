// Collapse a flat list of rules PDFs into title-family groups for the library
// page. Versions of a document are rows sharing a title and differing by
// edition (see util/rules-family.js). Operates ONLY on the rows passed in
// (the viewer's set), so we never surface a version the viewer can't see.

// Highest edition first, by plain string comparison — the same ordering the
// list query uses — with newest created_at breaking ties.
const byEditionDesc = (a, b) => {
  const ea = String(a.edition || '');
  const eb = String(b.edition || '');
  if (ea !== eb) return ea < eb ? 1 : -1;
  return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
};

// rules: array of rules_pdf rows (need id, title, edition, created_at).
// Returns ordered array of { primary, previous }, group order following
// first appearance of each title among the input rows.
const groupRulesVersions = (rules) => {
  const rows = Array.isArray(rules) ? rules.filter(r => r && r.id) : [];
  const membersByTitle = new Map();
  for (const row of rows) {
    if (!membersByTitle.has(row.title)) membersByTitle.set(row.title, []);
    membersByTitle.get(row.title).push(row);
  }
  return [...membersByTitle.values()].map((members) => {
    const sorted = members.slice().sort(byEditionDesc);
    return { primary: sorted[0], previous: sorted.slice(1) };
  });
};

module.exports = { groupRulesVersions };
