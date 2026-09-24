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
const { test, expect, describe } = require('bun:test');
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
    .toEqual([{
      name: 'Visor', description: '', category: 'default', meters: [], notes: [],
      default_enchantment: null, column: 1, position: 1
    }]);
});

// Each of an Aspirant class's twelve Signature Items comes with a unique
// Default Enchantment, unlocked with Merx (ENCLAVE: Aspirant, pg. 86). It is
// one object, not a list -- a Signature may hold no more than one Enchantment.
test('a default enchantment keeps its three fields', () => {
  const [item] = normalizeGear([{
    name: 'Cowboy Hat',
    default_enchantment: {
      name: 'Hats Off to You',
      description: 'Instantly share an Expertise with an ally.',
      dedication: 'In Honor of Cowboy Will'
    }
  }]);

  expect(item.default_enchantment).toEqual({
    name: 'Hats Off to You',
    description: 'Instantly share an Expertise with an ally.',
    dedication: 'In Honor of Cowboy Will'
  });
});

// The dedication is optional -- not every Default Enchantment carries an
// "In Honor of ..." line. It is stored as null rather than omitted so every
// enchantment has one shape, the same choice util/class-abilities.js:90-94
// makes for a Sample Perk's own optional dedication.
test('a default enchantment with no dedication stores null', () => {
  const [item] = normalizeGear([{
    name: 'Revolver',
    default_enchantment: { name: 'Big Iron', description: 'Project a Vision of past feats.' }
  }]);

  expect(item.default_enchantment)
    .toEqual({ name: 'Big Iron', description: 'Project a Vision of past feats.', dedication: null });
});

// Every one of the fifty live Advent classes has gear with no enchantment, so
// this is the overwhelmingly common case. It is a present null rather than an
// absent key so that every item has one shape.
test('an item with no enchantment gets a null', () => {
  expect(normalizeGear([named('Visor')])[0].default_enchantment).toBeNull();
});

// The enchantment's name decides whether it survives, the same rule the item
// itself follows -- an enchantment is not printable without one.
test('an unnamed enchantment is dropped', () => {
  for (const enchantment of [{ description: 'Orphaned.' }, { name: '   ' }, 'Big Iron', 42, null]) {
    expect(normalizeGear([{ name: 'Visor', default_enchantment: enchantment }])[0].default_enchantment)
      .toBeNull();
  }
});

// The position the default is read from is the position in the SAVED list, with
// blank rows already dropped -- the list is filtered before it is mapped. This
// reverses R76, which had the blank row hold its slot: under that rule the
// fourth row here fell to 'elective' and printed under Elective gear even
// though only three items were saved. A blank row must not move a real item
// between the two columns.
//
// In practice every row the form renders carries an explicit <select> value, so
// this only decides hand-built requests and legacy rows; it is pinned so that
// the answer is a decision rather than an accident of statement order.
test('a dropped blank row does not shift the category default of the items that survive', () => {
  const rows = [named('   '), named('Second'), named('Third'), named('Fourth')];

  expect(normalizeGear(rows).map((item) => [item.name, item.category]))
    .toEqual([['Second', 'default'], ['Third', 'default'], ['Fourth', 'default']]);
});

// The other half of the same rule: with the blanks gone the split falls where
// the saved array says it does, so a six-item save interleaved with blank
// repeater rows still prints three Base and three Elective.
test('blank rows between real ones leave the Base/Elective split at three and three', () => {
  const rows = [
    named('One'), named('  '), named('Two'), named('Three'), named(''),
    named('Four'), named('Five'), named('   '), named('Six'),
  ];

  expect(normalizeGear(rows).map((item) => [item.name, item.category]))
    .toEqual([
      ['One', 'default'], ['Two', 'default'], ['Three', 'default'],
      ['Four', 'elective'], ['Five', 'elective'], ['Six', 'elective'],
    ]);
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

const { gearColumn, gearPosition } = require('./class-gear');

describe('gearColumn and gearPosition', () => {
  test('three items fill a column before the next one starts', () => {
    expect([0, 1, 2, 3, 4, 5].map(gearColumn)).toEqual([1, 1, 1, 2, 2, 2]);
    expect([0, 1, 2, 3, 4, 5].map(gearPosition)).toEqual([1, 2, 3, 1, 2, 3]);
  });

  test('a twelve-item roster fills four columns', () => {
    expect([6, 7, 8, 9, 10, 11].map(gearColumn)).toEqual([3, 3, 3, 4, 4, 4]);
    expect([6, 7, 8, 9, 10, 11].map(gearPosition)).toEqual([1, 2, 3, 1, 2, 3]);
  });
});

describe('normalizeGear column contract', () => {
  test('every item carries column and position', () => {
    const items = normalizeGear([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }]);
    expect(items.map((item) => [item.column, item.position]))
      .toEqual([[1, 1], [1, 2], [1, 3], [2, 1]]);
  });

  test('category still derives from the column: 1 is default, 2-4 are elective', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
    const items = normalizeGear(names.map((name) => ({ name })));
    expect(items.map((item) => item.category)).toEqual([
      'default', 'default', 'default',
      'elective', 'elective', 'elective',
      'elective', 'elective', 'elective',
      'elective', 'elective', 'elective'
    ]);
  });

  test('a stored category still wins over the positional default', () => {
    const items = normalizeGear([{ name: 'A', category: 'elective' }]);
    expect(items[0].category).toBe('elective');
    expect(items[0].column).toBe(1);
  });
});

const { signatureSides } = require('./class-gear');

const sideNames = (sides) => sides.map((side) => side.map((item) => item.name));

describe('signatureSides', () => {
  test('a six-item class puts book column 1 on the left and column 2 on the right', () => {
    const items = ['A', 'B', 'C', 'D', 'E', 'F'].map(named);
    expect(sideNames(signatureSides(items))).toEqual([
      ['A', 'B', 'C'],
      ['D', 'E', 'F']
    ]);
  });

  test('a twelve-item class puts each page\'s first column on the left and its second on the right', () => {
    const items = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map(named);
    expect(sideNames(signatureSides(items))).toEqual([
      ['A', 'B', 'C', 'G', 'H', 'I'],
      ['D', 'E', 'F', 'J', 'K', 'L']
    ]);
  });

  test('a side lists the left page\'s column before the right page\'s even when the input is unsorted', () => {
    const items = [
      { name: 'D', column: 2 }, { name: 'J', column: 4 }, { name: 'G', column: 3 },
      { name: 'A', column: 1 }, { name: 'E', column: 2 }, { name: 'B', column: 1 }
    ];
    expect(sideNames(signatureSides(items))).toEqual([
      ['A', 'B', 'G'],
      ['D', 'E', 'J']
    ]);
  });

  // Of the 444 live gear items, the 300 answering {category, description,
  // name} or {category, description, meters, name, notes} carry no `column`,
  // and only the 144 ENCLAVE: Aspirant V1 items do. A strict `item.column ===
  // n` filter would return two empty sides for every unsaved class in the
  // catalog; falling back to the item's position in the list is what keeps an
  // unsaved class's Signatures on the page at all.
  test('items with no column key group by their position in the list', () => {
    const items = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']
      .map((name) => ({ category: 'default', description: '', meters: [], name, notes: [] }));
    expect(sideNames(signatureSides(items))).toEqual([
      ['A', 'B', 'C', 'G', 'H', 'I'],
      ['D', 'E', 'F', 'J', 'K', 'L']
    ]);
  });

  test('a non-array gear value yields two empty sides', () => {
    expect(signatureSides(undefined)).toEqual([[], []]);
    expect(signatureSides(null)).toEqual([[], []]);
  });
});
