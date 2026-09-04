// normalizeAbilities' container-shape handling, tested directly.
//
// routes/classes-structured-fields.test.js owns everything reachable over HTTP:
// the nested field names, the dropping rules, ends-only trimming, and both the
// urlencoded and multipart parsers. What it CANNOT reach is the object-shaped
// input branch, and the reason is worth stating because it looks like an
// HTTP-testable case and is not:
//
//   - multer's append-field, which parses the multipart body the form actually
//     submits, ALWAYS builds an array -- `abilities[500]` yields a length-501
//     sparse array, never an object.
//   - qs, which parses the urlencoded body, builds an object with numeric
//     string keys only past `arrayLimit`. body-parser sets that to
//     `Math.max(100, paramCount)` (body-parser/lib/types/urlencoded.js:168),
//     not the default 20, so index 21 and index 99 both still arrive as arrays.
//
// So a request cannot produce the object shape through this app at all. The
// branch is kept because a bare `qs.parse` at its default arrayLimit does
// produce it, and it is pinned here instead of by an HTTP test pretending to
// reach it.
const { test, expect } = require('bun:test');
const { normalizeAbilities } = require('./class-abilities');

const named = (name) => ({ name });

test('an array of rows keeps its order', () => {
  expect(normalizeAbilities([named('First'), named('Second'), named('Third')])
    .map((ability) => ability.name))
    .toEqual(['First', 'Second', 'Third']);
});

// The shape qs produces past its arrayLimit. Array order IS the print order,
// so the keys are sorted numerically rather than iterated.
test('an object of rows keyed by index is ordered numerically', () => {
  expect(normalizeAbilities({ 0: named('First'), 1: named('Second'), 2: named('Third') })
    .map((ability) => ability.name))
    .toEqual(['First', 'Second', 'Third']);
});

// Integer-like keys happen to iterate in ascending numeric order, so an
// implementation that just called Object.values() would pass the test above.
// Non-integer-like keys do NOT: they iterate in insertion order, which is what
// makes this the case that proves the sort is load-bearing rather than
// decorative. "21" before "9" is also where a lexicographic sort diverges.
test('an object of rows is sorted numerically, not by insertion or lexically', () => {
  const body = {};
  body['21'] = named('TwentyOne');
  body['9'] = named('Nine');
  body['100'] = named('OneHundred');

  expect(normalizeAbilities(body).map((ability) => ability.name))
    .toEqual(['Nine', 'TwentyOne', 'OneHundred']);
});

test('meters, notes and children are ordered numerically when object-shaped', () => {
  const meters = {};
  meters['21'] = { label: 'TwentyOne', value: 'v' };
  meters['9'] = { label: 'Nine', value: 'v' };

  const children = {};
  children['21'] = { text: 'ChildTwentyOne' };
  children['9'] = { text: 'ChildNine' };

  const notes = {};
  notes['21'] = { text: 'NoteTwentyOne' };
  notes['9'] = { text: 'NoteNine', children };

  const [ability] = normalizeAbilities({ 0: { name: 'Collar', meters, notes } });

  expect(ability.meters.map((meter) => meter.label)).toEqual(['Nine', 'TwentyOne']);
  expect(ability.notes.map((note) => note.text)).toEqual(['NoteNine', 'NoteTwentyOne']);
  expect(ability.notes[0].children.map((child) => child.text))
    .toEqual(['ChildNine', 'ChildTwentyOne']);
});

// append-field's real output for a high index: a sparse array whose holes must
// collapse rather than become blank abilities.
test('a sparse array drops its holes and keeps the rows dense', () => {
  const rows = [];
  rows[9] = named('Nine');
  rows[500] = named('FiveHundred');

  expect(normalizeAbilities(rows).map((ability) => ability.name))
    .toEqual(['Nine', 'FiveHundred']);
});

test('a missing, null or scalar abilities value yields an empty array', () => {
  for (const input of [undefined, null, '', 'Collar', 42, true]) {
    expect(normalizeAbilities(input)).toEqual([]);
  }
});

// A repeated field name arrives as an array where a string is expected. Writing
// it through would put ["a","b"] into a text column, so it reads as blank and
// the row drops.
test('a non-string field value is treated as blank', () => {
  expect(normalizeAbilities([{ name: ['Collar', 'Collar'] }])).toEqual([]);
  expect(normalizeAbilities([{ name: 'Collar', description: ['a', 'b'] }]))
    .toEqual([{ name: 'Collar', description: '', paired_action: '', meters: [], notes: [] }]);
});
