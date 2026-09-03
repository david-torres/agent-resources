const { test, expect } = require('bun:test');
const { parseStatLine, clusterBands, pairMeters, buildNoteTree, tokenize } = require('./prerelease-extract');

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

test('groups near-identical xMin values into one band', () => {
  expect(clusterBands([75.8, 75.8, 76.1, 421.5, 421.5, 503.4]))
    .toEqual([75.9, 421.5, 503.4]);
});

test('splits bands further apart than the tolerance', () => {
  expect(clusterBands([92.3, 99.0], 3)).toEqual([92.3, 99.0]);
});

test('pairs labels with values on the same row, in printed order', () => {
  const blocks = [
    { xMin: 421.5, yMin: 128.5, text: 'Essence Cost' },
    { xMin: 503.4, yMin: 128.5, text: 'Low' },
    { xMin: 421.5, yMin: 152.4, text: 'Cooldown' },
    { xMin: 503.4, yMin: 152.4, text: 'Low' },
  ];
  expect(pairMeters(blocks)).toEqual([
    { label: 'Essence Cost', value: 'Low' },
    { label: 'Cooldown', value: 'Low' },
  ]);
});

// A wide value like "Low–High" starts further left than "Mid" does, so the
// value column is not a single x. Pairing is by row, not by exact offset.
test('pairs a wide value whose xMin differs from the narrow values', () => {
  const blocks = [
    { xMin: 421.5, yMin: 328.1, text: 'Duration' },
    { xMin: 491.4, yMin: 328.1, text: 'Low–High' },
  ];
  expect(pairMeters(blocks)).toEqual([{ label: 'Duration', value: 'Low–High' }]);
});

test('tolerates a half-point row misalignment', () => {
  const blocks = [
    { xMin: 421.5, yMin: 476.7, text: 'Essence Cost' },
    { xMin: 503.2, yMin: 478.9, text: 'Mid' },
  ];
  expect(pairMeters(blocks)).toEqual([{ label: 'Essence Cost', value: 'Mid' }]);
});

test('throws when a label has no value on its row', () => {
  const blocks = [{ xMin: 421.5, yMin: 100, text: 'Cooldown' }];
  expect(() => pairMeters(blocks)).toThrow(/Cooldown/);
});

test('nests sub-bullets under the preceding top-level bullet', () => {
  const bullets = [
    { xMin: 75.8, text: '❖​ If the beast is powerful enough, this Ability ends prematurely.' },
    { xMin: 102.8, text: '➢​ Also ends prematurely if the collar is destroyed.' },
    { xMin: 75.8, text: '❖​ Cooldown begins on use rather than on expiry.' },
  ];
  expect(buildNoteTree(bullets)).toEqual([
    {
      text: 'If the beast is powerful enough, this Ability ends prematurely.',
      children: [{ text: 'Also ends prematurely if the collar is destroyed.', children: [] }],
    },
    { text: 'Cooldown begins on use rather than on expiry.', children: [] },
  ]);
});

test('gives every note an array of children even when it has none', () => {
  const [note] = buildNoteTree([{ xMin: 75.8, text: '❖​ Only note.' }]);
  expect(note.children).toEqual([]);
});

// Supplement correction: sub-bullet must come first with no preceding
// top-level band for it to fall into, otherwise it IS the top band.
test('throws on a sub-bullet with no parent', () => {
  expect(() => buildNoteTree([
    { xMin: 102.8, text: '➢ orphan' },
    { xMin: 75.9, text: '❖ a real top-level note' },
  ])).toThrow(/no parent/);
});

test('collapses whitespace and drops bullet furniture', () => {
  expect(tokenize('❖​  Cooldown   begins\non use.'))
    .toEqual(['Cooldown', 'begins', 'on', 'use.']);
});

// The whole point of the harness: typography changes must be visible.
test('does not normalize curly quotes or en dashes away', () => {
  expect(tokenize('Low–High ‘Em!')).toEqual(['Low–High', '‘Em!']);
  expect(tokenize('Low-High')).not.toEqual(tokenize('Low–High'));
});
