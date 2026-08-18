const { test, expect } = require('bun:test');
const { canViewRulesPdf } = require('./rules');

test('a free_access PDF is viewable with no user at all', async () => {
  const { data, error } = await canViewRulesPdf(
    { userId: null, role: null },
    { id: 'qs', storage_path: 'pdfs/qs.pdf', free_access: true }
  );
  expect(error).toBeNull();
  expect(data).toBe(true);
});

test('a free_access PDF with no stored file is still not viewable', async () => {
  const { data } = await canViewRulesPdf(
    { userId: null, role: null },
    { id: 'qs', storage_path: null, free_access: true }
  );
  expect(data).toBe(false);
});

test('a non-free PDF still refuses a signed-out viewer', async () => {
  const { data } = await canViewRulesPdf(
    { userId: null, role: null },
    { id: 'core', storage_path: 'pdfs/core.pdf', free_access: false }
  );
  expect(data).toBe(false);
});
