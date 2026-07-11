const { test, expect } = require('bun:test');
const { asyncHandler } = require('./async-handler');

test('asyncHandler forwards a rejected promise to next', async () => {
  const boom = new Error('boom');
  let passed = null;
  const handler = asyncHandler(async () => { throw boom; });
  await handler({}, {}, (e) => { passed = e; });
  await new Promise((r) => setImmediate(r));
  expect(passed).toBe(boom);
});

test('asyncHandler does not call next on success', async () => {
  let called = false;
  const handler = asyncHandler(async (req, res) => { res.ok = true; });
  const res = {};
  await handler({}, res, () => { called = true; });
  await new Promise((r) => setImmediate(r));
  expect(res.ok).toBe(true);
  expect(called).toBe(false);
});
