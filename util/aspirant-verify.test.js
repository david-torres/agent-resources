const { describe, test, expect } = require('bun:test');
const {
  indentOf, rowsOf, untilNextColumn, repairRaisedRatings, surplus,
  gutterOf, checkSupMarkup, checkBareRatings, misdeclaredChrome, unlocatable, MIN_GUTTER_WIDTH, RAISED_NOTATION, STRANDED_MARK
} = require('./aspirant-verify');

// The verifier reads the book in a different pdftotext mode from the extractor, so these
// fixtures are written out as `-layout` emits them rather than built from the extractor's
// output. Each one is modelled on a line the book actually prints; where a page is named,
// that is the page the shape was read off.
const collect = () => {
  const found = [];
  return { found, fail: (where, detail) => found.push(`${where}: ${detail}`) };
};

describe('indentOf', () => {
  test('is the column the line first sets a character in', () => {
    expect(indentOf('   Cowboy Hat')).toBe(3);
    expect(indentOf('Cowboy Hat')).toBe(0);
  });
});

describe('untilNextColumn', () => {
  // A meter row is printed down the right of an entry and lands on a note's output line when
  // the two share a baseline. Nothing inside a line of prose is set more than one space apart.
  test('cuts the line where a run of three spaces opens the next column', () => {
    expect(untilNextColumn('  Delivering a smooth one-liner   Essence Cost   Low'))
      .toBe('  Delivering a smooth one-liner');
  });

  test('keeps a line whose widest internal gap is two spaces', () => {
    expect(untilNextColumn('  Delivering a  smooth one-liner'))
      .toBe('  Delivering a  smooth one-liner');
  });
});

describe('gutterOf', () => {
  test('finds a channel exactly two blank columns wide', () => {
    const { found, fail } = collect();
    expect(gutterOf(fail, 'tips', ['Player  Conduit', 'abcdef  ghijklm'])).toBe(6);
    expect(found).toEqual([]);
  });

  test('does not take a single blank column inside a column for a channel', () => {
    const { found, fail } = collect();
    expect(gutterOf(fail, 'tips', ['Play r  Conduit', 'abcd f  ghijklm'])).toBe(6);
    expect(found).toEqual([]);
  });

  test('reports a page that offers more than one channel rather than guessing', () => {
    const { found, fail } = collect();
    expect(gutterOf(fail, 'tips', ['ab  cd  ef', 'gh  ij  kl'])).toBe(null);
    expect(found).toEqual(['tips: 2 blank column channels across the content, expected 1']);
  });

  test('is two columns wide', () => {
    expect(MIN_GUTTER_WIDTH).toBe(2);
  });
});

describe('RAISED_NOTATION', () => {
  // Printed page 12 defines the notation; these are the thirteen distinct strings the book
  // prints, counted over the whole book. The 0 forms are ranges with no lower bound.
  const PRINTED = ['L', 'M', 'H', 'L–M', 'L–H', 'M–H', 'H+', 'L–H+', 'M–H+', 'H–H+',
    '0–L', '0–M', '0–H'];

  test('matches every Power Rating the book prints', () => {
    expect(PRINTED.filter((rating) => !RAISED_NOTATION.test(rating))).toEqual([]);
  });

  test('matches none of the strings a widened pattern would let through', () => {
    // `0` and `0+` belong here: printed page 12 defines 0 as a range's absent lower bound,
    // so it is only ever the left of one, and the book prints neither form.
    const notRatings = ['Ward', 'Low', 'High', 'LM', 'L-M', 'X', 'H++', '0', '0+',
      'M–', '–M', 'H–H+.', '1', 'l', 'm–h'];
    expect(notRatings.filter((text) => RAISED_NOTATION.test(text))).toEqual([]);
  });
});

describe('checkSupMarkup', () => {
  test('passes markup that wraps a Power Rating', () => {
    const { found, fail } = collect();
    checkSupMarkup(fail, 'Vessel p73', ['Galvanizes <sup>0–M</sup> on a hit.']);
    expect(found).toEqual([]);
  });

  test('reports markup wrapped around an ordinary word', () => {
    const { found, fail } = collect();
    checkSupMarkup(fail, 'Vessel p73', ['Galvanizes <sup>Ward</sup> on a hit.']);
    expect(found).toEqual(['Vessel p73: <sup> markup around "Ward", which is not a Power Rating']);
  });

  test('reports a tag that wraps nothing', () => {
    const { found, fail } = collect();
    checkSupMarkup(fail, 'Vessel p73', ['Galvanizes <sup>M on a hit.']);
    expect(found).toEqual(['Vessel p73: <sup> markup that wraps no single word:'
      + ' "Galvanizes <sup>M on a hit."']);
  });
});

describe('checkBareRatings', () => {
  test('reports a rating left outside the markup mid-sentence', () => {
    const { found, fail } = collect();
    checkBareRatings(fail, 'Vessel p73', ['Galvanizes M on a hit and Wards after.']);
    expect(found).toEqual(['Vessel p73: "M" reads as a Power Rating but is outside <sup>:'
      + ' "Galvanizes M on a hit and Wards after."']);
  });

  test('reports a rating left outside the markup with the page\'s own mark on it', () => {
    const { found, fail } = collect();
    checkBareRatings(fail, 'Vessel p73', ['The strike Galvanizes 0–M.']);
    expect(found.length).toBe(1);
    expect(found[0]).toContain('"0–M."');
  });

  test('passes a rating that is inside the markup', () => {
    const { found, fail } = collect();
    checkBareRatings(fail, 'Vessel p73', ['The strike Galvanizes <sup>0–M</sup>.']);
    expect(found).toEqual([]);
  });

  // The quoted advice names its contributor and the attribution ends in an initial, so the
  // last token of "... — Tim M." is rating-shaped without any markup having been lost.
  test('excuses the initial that closes an attributed quote', () => {
    const { found, fail } = collect();
    checkBareRatings(fail, 'Gunslinger p13', ['“Let someone else to act.” — Tim M.',
      '“Keep it intimidating and cool.” — Lee H.', '“Never draw on a drawn weapon.” — Julian M.']);
    expect(found).toEqual([]);
  });

  test('excuses only the last token, and only under an attribution', () => {
    const { found, fail } = collect();
    checkBareRatings(fail, 'Gunslinger p13', ['“Galvanize M and run.” — Tim M.']);
    expect(found.length).toBe(1);
    expect(found[0]).toContain('"M"');
  });

  test('does not excuse a bare name that never opens with the attribution dash', () => {
    const { found, fail } = collect();
    checkBareRatings(fail, 'Gunslinger p13', ['Tim M.']);
    expect(found.length).toBe(1);
  });
});

describe('repairRaisedRatings', () => {
  // Read off PDF page 80, printed page 75 (Vessel, Shadow Blade): the book sets
  // "Glamer <sup>H</sup>," and -layout emits the H on an output line of its own at a left edge
  // no other line uses, leaving the comma behind on the line it interrupted as a word by itself.
  const shadowBlade = [
    '           Streak of dark, eerie Glamer , materializing around the',
    '                                                H',
    '           owner’s hand as though it were a continuation of their arm.',
  ];

  test('puts a stranded rating back in front of the mark it belongs to', () => {
    const [first, second] = repairRaisedRatings(rowsOf(shadowBlade));
    expect(first.tokens).toEqual(['Streak', 'of', 'dark,', 'eerie', 'Glamer', 'H,',
      'materializing', 'around', 'the']);
    expect(second.tokens[0]).toBe('owner’s');
  });

  test('leaves a lone token that is not one of the book\'s marks unjoined', () => {
    const rows = repairRaisedRatings(rowsOf([
      shadowBlade[0].replace(' , ', ' ! '), shadowBlade[1], shadowBlade[2],
    ]));
    expect(rows[0].tokens).toContain('!');
    expect(rows[0].tokens).toContain('H');
    expect(rows[0].tokens).not.toContain('H!');
  });

  // The book sets a perk or signature name on a line of its own at an indent no other line on
  // the page uses -- "Alarum" on printed page 32, "Dropkick" on printed page 56 -- which is the
  // same shape a stranded rating has. What tells the two apart is the notation, not the length:
  // the book prints no name of four characters or fewer on a line of its own, so this fixture
  // shortens one to the length a bound of four could not rule out.
  test('does not take a short word on a line of its own for a rating', () => {
    const rows = repairRaisedRatings(rowsOf([
      shadowBlade[0], shadowBlade[1].replace('H', 'Ally'), shadowBlade[2],
    ]));
    expect(rows.length).toBe(3);
    expect(rows[1].tokens).toEqual(['Ally']);
    expect(rows[0].tokens).not.toContain('Ally,');
    // With no rating to claim it, the stranded mark closes up against the word it was split
    // from, which is what the page prints when nothing is raised.
    expect(rows[0].tokens).toContain('Glamer,');
  });

  test('does not take a longer name on a line of its own for a rating', () => {
    const rows = repairRaisedRatings(rowsOf([
      shadowBlade[0], shadowBlade[1].replace('H', 'Alarum'), shadowBlade[2],
    ]));
    expect(rows.length).toBe(3);
    expect(rows[1].tokens).toEqual(['Alarum']);
  });

  test('takes a zero-bounded rating on a line of its own for a rating', () => {
    const rows = repairRaisedRatings(rowsOf([
      shadowBlade[0], shadowBlade[1].replace('H', '0–M'), shadowBlade[2],
    ]));
    expect(rows.length).toBe(2);
    expect(rows[0].tokens).toContain('0–M,');
  });

  test('treats the marks the book sets hard against a word as stranded', () => {
    expect(['.', ',', ';', ':'].filter((mark) => !STRANDED_MARK.test(mark))).toEqual([]);
    expect(['!', '?', '…', 'H.', ''].filter((text) => STRANDED_MARK.test(text))).toEqual([]);
  });
});

describe('surplus', () => {
  test('counts by multiplicity, not by membership', () => {
    expect(surplus(['M', 'M', 'H'], ['M'])).toEqual(['H x1', 'M x1']);
    expect(surplus(['M'], ['M', 'M'])).toEqual([]);
  });
});

describe('misdeclaredChrome', () => {
  // The running header and the printed folio are the only two things the chrome step takes out
  // of a page, and both are printed words the record holds as a name and a number rather than as
  // text. So a chrome allowance belongs on the pdf side, and one on the record side would excuse
  // a record token that no printed word accounts for.
  test('passes allowances declared against what the page prints', () => {
    expect(misdeclaredChrome([
      { side: 'pdf', tokens: ['13'], why: 'the printed page number in the footer' },
      { side: 'pdf', tokens: ['Gunslinger'], why: 'the running header' },
    ])).toEqual([]);
  });

  test('reports an allowance declared against the record', () => {
    expect(misdeclaredChrome([
      { side: 'pdf', tokens: ['13'], why: 'the printed page number in the footer' },
      { side: 'record', tokens: ['Gunslinger'], why: 'the running header' },
    ])).toEqual(['a chrome allowance declared on the record side: the running header']);
  });
});

describe('unlocatable', () => {
  // A record carrying no page_range cannot be found in the PDF, so nothing about it is verified.
  // The gate's job is to say so loudly: this is what the exit code is taken from.
  test('names every record that carries no page range', () => {
    expect(unlocatable([
      { name: 'Gunslinger', page_range: [13, 18] },
      { name: 'Charlatan' },
      { name: 'Wanderer', page_range: null },
    ])).toEqual(['Charlatan', 'Wanderer']);
  });

  test('names none when every record carries one', () => {
    expect(unlocatable([{ name: 'Gunslinger', page_range: [13, 18] }])).toEqual([]);
  });
});
