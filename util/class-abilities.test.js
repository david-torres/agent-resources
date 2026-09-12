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
    .toEqual([{ name: 'Collar', description: '', paired_action: '', meters: [], notes: [], sample_perks: [] }]);
});

// Every Aspirant ability prints two Sample Perks, one of which has a
// Compounded variant printed as a complete restatement rather than a delta
// (ENCLAVE: Aspirant, pg. 7). The book's own wording is what is being quoted,
// so compound_text holds the whole compounded text and nothing recombines it
// at render time.
test('a sample perk keeps its four fields', () => {
  const [ability] = normalizeAbilities([{
    name: 'Trickshot',
    sample_perks: [{
      name: 'Smoke Off the Barrel',
      text: 'Jauntily blowing smoke from the gun right after using this Ability will refund its Essence Cost.',
      dedication: 'In Honor of Caroline',
      compound_text: 'Refunds the Essence Cost and shortens the Cooldown.'
    }]
  }]);

  expect(ability.sample_perks).toEqual([{
    name: 'Smoke Off the Barrel',
    text: 'Jauntily blowing smoke from the gun right after using this Ability will refund its Essence Cost.',
    dedication: 'In Honor of Caroline',
    compound_text: 'Refunds the Essence Cost and shortens the Cooldown.'
  }]);
});

// dedication and compound_text are the two optional halves: most perks carry
// neither. They are stored as null rather than omitted so that every perk has
// the same shape, the rule the gear and ability contracts already follow.
test('a sample perk with no dedication or compound stores nulls', () => {
  const [ability] = normalizeAbilities([{
    name: 'Trickshot',
    sample_perks: [{ name: 'Waco Kid', text: 'Improves hand speed.' }]
  }]);

  expect(ability.sample_perks).toEqual([
    { name: 'Waco Kid', text: 'Improves hand speed.', dedication: null, compound_text: null }
  ]);
});

// The same rule every other row in this file follows: a blank row is a normal
// intermediate state in a repeater, so the name is what decides whether it survives.
test('a sample perk with no name is dropped', () => {
  const [ability] = normalizeAbilities([{
    name: 'Trickshot',
    sample_perks: [{ name: '  ', text: 'Orphaned.' }, { name: 'Waco Kid', text: 'Kept.' }]
  }]);

  expect(ability.sample_perks.map((perk) => perk.name)).toEqual(['Waco Kid']);
});

// The shape qs produces past its arrayLimit, for the reason this file's header
// records. Array order IS the print order.
test('sample perks are ordered numerically when object-shaped', () => {
  const sample_perks = {};
  sample_perks['21'] = { name: 'TwentyOne', text: 't' };
  sample_perks['9'] = { name: 'Nine', text: 't' };

  const [ability] = normalizeAbilities({ 0: { name: 'Trickshot', sample_perks } });

  expect(ability.sample_perks.map((perk) => perk.name)).toEqual(['Nine', 'TwentyOne']);
});

test('an ability with no sample perks gets an empty array', () => {
  expect(normalizeAbilities([named('Collar')])[0].sample_perks).toEqual([]);
});
