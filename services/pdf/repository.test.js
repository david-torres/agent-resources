const { test, expect } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const repository = require('./repository');

// Guards against a missed extraction: every privileged storage call must be
// reachable through the repository, the sole consumer of supabaseAdmin.storage
// for the pdf domain. Deep behavior is covered by the class/library PDF tests
// that already exercise these paths through models/pdf.js.
const expectedMethods = ['uploadObject', 'removeObject', 'createSignedUrl'];

test('exports every repository method', () => {
  for (const method of expectedMethods) {
    expect(typeof repository[method]).toBe('function');
  }
});
