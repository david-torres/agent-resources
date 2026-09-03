const { test, expect } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');

const loadRulesModel = (fakeClient) => freshRequire(require.resolve('./rules'), new Map([
  [require.resolve('./_base'), { supabase: fakeClient, supabaseAdmin: fakeClient }]
]));

test('createRulesPdf trims the title before inserting', async () => {
  let inserted = null;
  const fakeClient = {
    from() {
      return {
        insert(payload) {
          inserted = payload;
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'r1', ...payload }, error: null }) }) };
        }
      };
    }
  };
  const { createRulesPdf } = loadRulesModel(fakeClient);
  const { error } = await createRulesPdf({ title: ' Advent Rules ', edition: 1 });

  expect(error).toBeNull();
  expect(inserted.title).toBe('Advent Rules');
});

test('updateRulesPdf trims the title before updating', async () => {
  let updated = null;
  const fakeClient = {
    from() {
      return {
        update(payload) {
          updated = payload;
          return { eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'r1', ...payload }, error: null }) }) }) };
        }
      };
    }
  };
  const { updateRulesPdf } = loadRulesModel(fakeClient);
  const { error } = await updateRulesPdf('r1', { title: ' New Title ' });

  expect(error).toBeNull();
  expect(updated.title).toBe('New Title');
});
