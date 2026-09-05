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

// Class prose is a character-for-character copy of a source document, and the
// loader writes its line endings as LF. A browser posts every textarea line
// ending as CRLF, so without this a no-op admin save rewrote bytes in all 19
// imported classes' `tips`. Normalizing at the write path is what makes the
// stored value converge: LF at rest, CRLF over the wire, LF again at rest.
test('collapses CRLF and lone CR to LF everywhere in the payload', () => {
  const out = normalizeClassInput({
    name: 'Zoologist',
    tips: '- One\r\n- Two\r- Three\n- Four',
    teaser: 'A\r\nB',
    abilities: [{ name: 'Wild Empathy', description: 'First\r\n\r\nSecond' }],
    gear: [{ name: 'Net', description: 'Throws.\r\n', notes: [{ text: 'A\r\nB', children: [{ text: 'C\rD' }] }] }],
    examples: ['Steve Irwin\r\n'],
  });
  expect(out.tips).toBe('- One\n- Two\n- Three\n- Four');
  expect(out.teaser).toBe('A\nB');
  expect(out.abilities[0].description).toBe('First\n\nSecond');
  expect(out.gear[0].description).toBe('Throws.');
  expect(out.gear[0].notes[0].text).toBe('A\nB');
  expect(out.gear[0].notes[0].children[0].text).toBe('C\nD');
  expect(out.examples[0]).toBe('Steve Irwin');
});

test('leaves LF line endings and interior text alone', () => {
  const out = normalizeClassInput({ name: 'X', overview: 'One\n\nTwo  ·  three — four' });
  expect(out.overview).toBe('One\n\nTwo  ·  three — four');
});
