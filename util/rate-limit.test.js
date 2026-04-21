const { test, expect } = require('bun:test');
const { createRateLimiter } = require('./rate-limit');

test('allows requests under the limit', () => {
  const limiter = createRateLimiter({ max: 5, windowMs: 1000 });
  for (let i = 0; i < 5; i++) {
    expect(limiter.check('token-a')).toBe(true);
  }
});

test('rejects the sixth request within the window', () => {
  const limiter = createRateLimiter({ max: 5, windowMs: 1000 });
  for (let i = 0; i < 5; i++) limiter.check('token-a');
  expect(limiter.check('token-a')).toBe(false);
});

test('different tokens have independent buckets', () => {
  const limiter = createRateLimiter({ max: 2, windowMs: 1000 });
  expect(limiter.check('token-a')).toBe(true);
  expect(limiter.check('token-a')).toBe(true);
  expect(limiter.check('token-a')).toBe(false);
  expect(limiter.check('token-b')).toBe(true);
});

test('requests expire from the window', async () => {
  const limiter = createRateLimiter({ max: 2, windowMs: 50 });
  limiter.check('token-a');
  limiter.check('token-a');
  expect(limiter.check('token-a')).toBe(false);
  await new Promise((r) => setTimeout(r, 60));
  expect(limiter.check('token-a')).toBe(true);
});
