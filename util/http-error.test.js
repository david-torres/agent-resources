// util/http-error.test.js
const { test, expect } = require('bun:test');
const { classifyError } = require('./http-error');

const FRIENDLY = "We couldn't find that, or you don't have access to it.";

test('PGRST116 maps to a friendly 404', () => {
  const d = classifyError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
  expect(d.status).toBe(404);
  expect(d.title).toBe('Not found');
  expect(d.message).toBe(FRIENDLY);
});

test('42501 (RLS/permission) maps to a friendly 403', () => {
  const d = classifyError({ code: '42501', message: 'permission denied' });
  expect(d.status).toBe(403);
  expect(d.title).toBe('No access');
  expect(d.message).toBe(FRIENDLY);
});

test('23505 (unique violation) maps to 409', () => {
  const d = classifyError({ code: '23505', message: 'duplicate key' });
  expect(d.status).toBe(409);
  expect(d.title).toBe('Already exists');
});

test('null error falls back to 404 Not found', () => {
  const d = classifyError(null);
  expect(d.status).toBe(404);
  expect(d.message).toBe(FRIENDLY);
});

test('fallback overrides win over the default mapping', () => {
  const d = classifyError(null, { status: 403, title: 'No access', message: 'Custom.' });
  expect(d.status).toBe(403);
  expect(d.title).toBe('No access');
  expect(d.message).toBe('Custom.');
});

test('unknown error is 500; non-production exposes the raw message', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const d = classifyError({ message: 'boom' });
  expect(d.status).toBe(500);
  expect(d.message).toBe('boom');
  process.env.NODE_ENV = prev;
});

test('unknown error in production hides the raw message', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const d = classifyError({ message: 'boom' });
  expect(d.status).toBe(500);
  expect(d.message).toBe('An unexpected error occurred. Please try again.');
  process.env.NODE_ENV = prev;
});
