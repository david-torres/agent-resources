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

// Presentation categories do not grant access or change a book's ruleset.
const libraryCategory = ({ title = '', book_type, rules_edition }) => {
  if (/quick[\s-]*start/i.test(title)) return 'quickstart';
  if (/glossary|keyword/i.test(title)) return 'reference';
  if (book_type === 'core' && rules_edition === 'aspirant') return 'aspirant';
  if (book_type === 'core' && rules_edition === 'advent') return 'advent';
  // Older records may predate explicit book types.
  if (/^(enclave\s*:\s*)?aspirant$/i.test(title.trim())) return 'aspirant';
  if (/^(enclave\s*:\s*)?advent$/i.test(title.trim())) return 'advent';
  return 'reference';
};

const buildLibrarySections = (groups) => [
  {
    id: 'quickstart', label: '01 / Start here · Free', title: 'Quickstart',
    description: 'The bare Enclave essentials. Learn the basics with the free Quickstart.'
  },
  {
    id: 'advent', label: '02 / The core ruleset', title: 'Advent',
    description: 'Foundational Enclave knowledge: the full core rules you’ll use throughout the game.',
    note: '30-day free trial. Purchase Advent for continued access after your trial ends.'
  },
  {
    id: 'aspirant', label: '03 / The expansion', title: 'Aspirant',
    description: 'Explore new classes and advanced mechanics.',
    note: 'Builds on Advent.'
  },
  {
    id: 'reference', label: 'Useful reading', title: 'Reference materials',
    description: 'Free keyword glossary for Aspirant terms.'
  }
].map(section => ({ ...section, groups: groups.filter(group => libraryCategory(group.primary) === section.id) }));

module.exports = { groupRulesVersions, buildLibrarySections };
