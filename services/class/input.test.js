const { test, expect } = require('bun:test');
const { normalizeClassInput } = require('./input');

test('trims the class name and every item name', () => {
  const out = normalizeClassInput({
    name: 'Zoologist ',
    gear: [{ name: 'Training Weights ', description: 'Heavy. ' }],
    abilities: [{ name: 'Captain Obvious ', description: 'd' }],
  });
  expect(out.name).toBe('Zoologist');
  expect(out.gear[0]).toEqual({ name: 'Training Weights', description: 'Heavy.' });
  expect(out.abilities[0].name).toBe('Captain Obvious');
});

test('still sanitizes image_url', () => {
  const out = normalizeClassInput({ name: 'X', image_url: 'javascript:alert(1)' });
  expect(out.image_url).toBeFalsy();
});
