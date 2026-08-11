const { test, expect } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const { createApp } = require('../app');

test('createApp builds an Express application without starting a listener', () => {
  const app = createApp();
  expect(typeof app.listen).toBe('function');
  expect(app.listening).toBeUndefined();
});
