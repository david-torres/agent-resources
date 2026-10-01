const { test, expect } = require('bun:test');
const { normalizeMissionInput } = require('./input');

test('trims mission name and host name', () => {
  const out = normalizeMissionInput({ name: 'Operation Abyssal Echo ', host_name: ' Dave ' },
    { creatorId: 'p1' });
  expect(out.name).toBe('Operation Abyssal Echo');
  expect(out.host_name).toBe('Dave');
});

test('stakes are optional and each axis is validated independently', () => {
  expect(normalizeMissionInput({ name: 'Ordinary' })).not.toHaveProperty('difficulty');
  for (const field of ['difficulty', 'danger']) {
    for (const value of ['conventional', 'critical', 'crisis']) {
      expect(normalizeMissionInput({ [field]: ` ${value} ` })[field]).toBe(value);
    }
    for (const value of ['', null, 'extreme', ['critical']]) {
      try {
        normalizeMissionInput({ [field]: value });
        throw new Error('expected validation failure');
      } catch (error) {
        expect(error.status).toBe(400);
      }
    }
  }
});
