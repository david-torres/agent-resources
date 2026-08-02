const { test, expect } = require('bun:test');
const { buildHardcodedRulesPdfs } = require('./seed-rules-pdfs');
const { STARTER_RULES_PDF_ID } = require('./starter-content');

// models/profile.js grants every new profile a rules-PDF unlock referencing
// STARTER_RULES_PDF_ID (util/starter-content.js). Locally, nothing seeds
// rules_pdfs, so that grant is a foreign-key violation waiting to happen.
// The seed's row id must be derived from the same constant the grant uses —
// never restated — or the two can drift apart again.
test('the seed builds the starter rules PDF row under the exact id the starter-unlock grant references', () => {
  const rows = buildHardcodedRulesPdfs();
  const row = rows.find(r => r.id === STARTER_RULES_PDF_ID);

  expect(row).toBeDefined();

  // Every NOT NULL column the rules_pdfs table requires must be present and
  // non-empty, or the row fails at insert time.
  expect(typeof row.title).toBe('string');
  expect(row.title.length).toBeGreaterThan(0);
  expect(typeof row.edition).toBe('string');
  expect(row.edition.length).toBeGreaterThan(0);
  expect(typeof row.storage_path).toBe('string');
  expect(row.storage_path.length).toBeGreaterThan(0);

  // Upload path convention (models/pdf.js storeRulesPdf): <rulesPdfId>/<name>.pdf
  // — a seeded storage object must land where the app looks for it.
  expect(row.storage_path.startsWith(`${STARTER_RULES_PDF_ID}/`)).toBe(true);
  expect(row.storage_path.endsWith('.pdf')).toBe(true);
});
