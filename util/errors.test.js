const { test, expect } = require('bun:test');
const { AuthorizationError } = require('./errors');

test('AuthorizationError carries a forbidden code and 403 status', () => {
  const err = new AuthorizationError('nope', { reason: 'not_owner' });
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe('AuthorizationError');
  expect(err.code).toBe('forbidden');
  expect(err.status).toBe(403);
  expect(err.reason).toBe('not_owner');
  expect(err.message).toBe('nope');
});

test('AuthorizationError has a default message', () => {
  expect(new AuthorizationError().message).toBe('Not authorized');
});
