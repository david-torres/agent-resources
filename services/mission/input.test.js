const { test, expect } = require('bun:test');
const { normalizeMissionInput } = require('./input');

test('trims mission name and host name', () => {
  const out = normalizeMissionInput({ name: 'Operation Abyssal Echo ', host_name: ' Dave ' },
    { creatorId: 'p1' });
  expect(out.name).toBe('Operation Abyssal Echo');
  expect(out.host_name).toBe('Dave');
});
