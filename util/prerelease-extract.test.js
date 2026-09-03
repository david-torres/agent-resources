const { test, expect } = require('bun:test');
const { parseStatLine } = require('./prerelease-extract');

test('parses the three-single form', () => {
  expect(parseStatLine('+Sensory, +Skill, +Vitality*'))
    .toEqual({ sensory: 1, skill: 1, vitality: 1 });
});

test('parses the double-plus comma form', () => {
  expect(parseStatLine('++Will, +Might')).toEqual({ will: 2, might: 1 });
});

test('parses the double-plus slash form used by the Aspirant six', () => {
  expect(parseStatLine('++Might/+Resilience')).toEqual({ might: 2, resilience: 1 });
});

// Brainiac is the one class whose pluses total 2, not 3. The parser must not
// "correct" it to 3 -- the document says what it says.
test('parses a lone double-plus without padding to three points', () => {
  expect(parseStatLine('++Intelligence*')).toEqual({ intelligence: 2 });
});

test('rejects a stat name not in statList', () => {
  expect(() => parseStatLine('+Charisma')).toThrow(/Charisma/);
});
