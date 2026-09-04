// normalizeGear's container-shape handling and its category rule, tested
// directly.
//
// routes/classes-structured-fields.test.js owns everything reachable over HTTP:
// the nested field names, the dropping rules, ends-only trimming, the
// positional category default, and both the urlencoded and multipart parsers.
// What it CANNOT reach is the object-shaped input branch, and the reason is
// worth stating because it looks like an HTTP-testable case and is not:
//
//   - multer's append-field, which parses the multipart body the form actually
//     submits, ALWAYS builds an array -- `gear[500]` yields a length-501 sparse
//     array, never an object.
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
const { normalizeGear, gearCategory } = require('./class-gear');

const named = (name) => ({ name });

test('an array of rows keeps its order', () => {
  expect(normalizeGear([named('First'), named('Second'), named('Third')])
    .map((item) => item.name))
    .toEqual(['First', 'Second', 'Third']);
});

// The shape qs produces past its arrayLimit. Array order IS the print order and
// the input to the positional category default, so the keys are sorted
// numerically rather than iterated.
test('an object of rows keyed by index is ordered numerically', () => {
  expect(normalizeGear({ 0: named('First'), 1: named('Second'), 2: named('Third') })
    .map((item) => item.name))
    .toEqual(['First', 'Second', 'Third']);
});

// This pins the ORDER the branch must answer with, not the sort that produces
// it -- and the difference is worth stating, because the test name used to
// claim otherwise. '9', '21' and '100' are canonical array indices, so JS
// enumerates them in ascending numeric order by itself: deleting the sort
// leaves this green, and a bare Object.values() passes it too. The one thing it
// does catch is a LEXICOGRAPHIC sort, which would answer "100" before "21".
//
// The sort stays regardless, and it is unpinnable by construction (R73):
// pinning it would take a key that is integer-like but NOT a canonical index --
// '01', say, which does enumerate in insertion order -- and neither qs nor
// append-field ever produces one. It states intent on a branch no real request
// can reach.
test('an object of rows keyed out of order comes back ascending', () => {
  const body = {};
  body['21'] = named('TwentyOne');
  body['9'] = named('Nine');
  body['100'] = named('OneHundred');

  expect(normalizeGear(body).map((item) => item.name))
    .toEqual(['Nine', 'TwentyOne', 'OneHundred']);
});

// Whatever order the rows come back in is also the order the category default
// is read from, so an ordering bug here mislabels the columns rather than just
// shuffling them -- the exact mistake the backfill migration's ORDER BY ord
// guards against on the SQL side. Same caveat as above: this pins the answer,
// not the sort, since these keys are canonical indices too.
test('the category default follows the order an object of rows comes back in', () => {
  const body = {};
  body['5'] = named('Sixth');
  body['0'] = named('First');
  body['3'] = named('Fourth');

  expect(normalizeGear(body).map((item) => [item.name, item.category]))
    .toEqual([['First', 'default'], ['Fourth', 'default'], ['Sixth', 'default']]);
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

  const [item] = normalizeGear({ 0: { name: 'Visor', meters, notes } });

  expect(item.meters.map((meter) => meter.label)).toEqual(['Nine', 'TwentyOne']);
  expect(item.notes.map((note) => note.text)).toEqual(['NoteNine', 'NoteTwentyOne']);
  expect(item.notes[0].children.map((child) => child.text))
    .toEqual(['ChildNine', 'ChildTwentyOne']);
});

// append-field's real output for a high index: a sparse array whose holes must
// collapse rather than become blank gear items. The holes collapse BEFORE the
// category default is read, so a form that posted `gear[500]` does not get five
// hundred phantom Base positions.
test('a sparse array drops its holes and keeps the rows dense', () => {
  const rows = [];
  rows[9] = named('Nine');
  rows[500] = named('FiveHundred');

  expect(normalizeGear(rows).map((item) => [item.name, item.category]))
    .toEqual([['Nine', 'default'], ['FiveHundred', 'default']]);
});

test('a missing, null or scalar gear value yields an empty array', () => {
  for (const input of [undefined, null, '', 'Visor', 42, true]) {
    expect(normalizeGear(input)).toEqual([]);
  }
});

// A repeated field name arrives as an array where a string is expected. Writing
// it through would put ["a","b"] into a text column, so it reads as blank and
// the row drops.
test('a non-string field value is treated as blank', () => {
  expect(normalizeGear([{ name: ['Visor', 'Visor'] }])).toEqual([]);
  expect(normalizeGear([{ name: 'Visor', description: ['a', 'b'], category: ['default'] }]))
    .toEqual([{ name: 'Visor', description: '', category: 'default', meters: [], notes: [] }]);
});

// The position the default is read from is the position in the SUBMITTED list,
// dropped blank rows included -- the list is mapped before it is filtered. In
// practice every row the form renders carries an explicit <select> value, so
// this only decides hand-built requests; it is pinned so that the answer is a
// decision rather than an accident of statement order.
test('a dropped blank row still occupies its position for the category default', () => {
  const rows = [named('   '), named('Second'), named('Third'), named('Fourth')];

  expect(normalizeGear(rows).map((item) => [item.name, item.category]))
    .toEqual([['Second', 'default'], ['Third', 'default'], ['Fourth', 'elective']]);
});

// gearCategory is exported so views/class-form.handlebars can pick the
// `selected` <option> with the identical rule rather than a second copy of it.
test('gearCategory answers the positional default for a missing or unknown value', () => {
  expect(gearCategory(undefined, 0)).toBe('default');
  expect(gearCategory(undefined, 2)).toBe('default');
  expect(gearCategory(undefined, 3)).toBe('elective');
  expect(gearCategory('', 5)).toBe('elective');
  expect(gearCategory('Base', 0)).toBe('default');
  expect(gearCategory('Base', 4)).toBe('elective');
});

test('gearCategory honours a recognised value at any position', () => {
  expect(gearCategory('elective', 0)).toBe('elective');
  expect(gearCategory('  default  ', 5)).toBe('default');
});
