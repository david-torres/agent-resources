const { describe, test, expect } = require('bun:test');
const {
  decodeEntities, parseBboxPages, CLASS_NAMES, FIRST_CLASS_PAGE, PAGES_PER_CLASS,
  classPageNumbers, isCoverPage, printedPage, headerName, isRecto, shiftFor,
  RECTO_SHIFT, SIGNATURE_NOTE_RECTO_SHIFT
} = require('./aspirant-extract');

const word = (x, y, text, { xMax = x + 20, yMax = y + 12 } = {}) =>
  `<word xMin="${x}" yMin="${y}" xMax="${xMax}" yMax="${yMax}">${text}</word>`;
const line = (x, y, words) => `<line xMin="${x}" yMin="${y}" xMax="0" yMax="0">${words.join('')}</line>`;
const block = (x, y, lines) => `<block xMin="${x}" yMin="${y}" xMax="0" yMax="0">${lines.join('')}</block>`;
const doc = (...pages) => pages.map((p) => `<page width="612" height="792">${p}</page>`).join('');

describe('bbox parsing', () => {
  test('numeric extents come back as numbers, not strings', () => {
    const [page] = parseBboxPages(doc(block(40.8, 100, [line(40.8, 100, [word(40.8, 100, 'Ward')])])));
    expect(page.page).toBe(1);
    expect(page.blocks[0].xMin).toBe(40.8);
    expect(page.blocks[0].lines[0].words[0].yMax).toBe(112);
  });

  test("a line's yMax is the lowest of its words, which pdftotext does not give us", () => {
    const [page] = parseBboxPages(doc(block(40, 100, [line(40, 100, [
      word(40, 100, 'tall', { yMax: 118 }), word(70, 104, 'M', { yMax: 111 })
    ])])));
    expect(page.blocks[0].lines[0].yMax).toBe(118);
  });

  test('entities decode, including the en dash the Power Ratings use', () => {
    expect(decodeEntities('L&#x2013;H')).toBe('L–H');
    expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'');
  });
});

describe('the page model', () => {
  test('the twelve classes are in book order', () => {
    expect(CLASS_NAMES).toHaveLength(12);
    expect(CLASS_NAMES[0]).toBe('Gunslinger');
    expect(CLASS_NAMES[6]).toBe('Berserker');
    expect(CLASS_NAMES[11]).toBe('Witchfinder');
  });

  test('the six-page cadence starts at PDF page 18 and strides 6', () => {
    expect(FIRST_CLASS_PAGE).toBe(18);
    expect(PAGES_PER_CLASS).toBe(6);
    expect(classPageNumbers(0)).toEqual({
      cover: 18, core: 19, sigLeft: 20, sigRight: 21, advanced: 22, tips: 23
    });
    expect(classPageNumbers(11).cover).toBe(84);
  });

  test('printed page is PDF page minus five', () => {
    expect(printedPage(18)).toBe(13);
  });

  test('signature-left pages are verso and signature-right pages are recto', () => {
    expect(isRecto(20)).toBe(false);
    expect(isRecto(21)).toBe(true);
  });
});

describe('the cover detector', () => {
  // Measured: a cover's stat line is a single-line block of height exactly
  // 24.00 at yMin 76.73, centred on 300.24. A loose regex alone also matches
  // p96; the geometry is what makes the test exact (geometry doc, section 1).
  const statLineBlock = (yMin, height, centre) => block(centre - 60, yMin, [
    line(centre - 60, yMin, [word(centre - 60, yMin, '++Skill,', { xMax: centre + 60, yMax: yMin + height })])
  ]);
  const challenge = block(100, 720, [line(100, 720, [word(100, 720, 'Challenge'), word(160, 720, 'Level:')])]);

  test('a real cover page is detected', () => {
    const [page] = parseBboxPages(doc(statLineBlock(76.73, 24.0, 300.24) + challenge));
    expect(isCoverPage(page)).toBe(true);
  });

  test('a stat-line-shaped string at the wrong height is not a cover', () => {
    const [page] = parseBboxPages(doc(statLineBlock(76.73, 13.05, 300.24) + challenge));
    expect(isCoverPage(page)).toBe(false);
  });

  test('a stat line with no Challenge Level below it is not a cover', () => {
    const [page] = parseBboxPages(doc(statLineBlock(76.73, 24.0, 300.24)));
    expect(isCoverPage(page)).toBe(false);
  });

  test('an off-centre stat line is not a cover', () => {
    const [page] = parseBboxPages(doc(statLineBlock(76.73, 24.0, 260.0) + challenge));
    expect(isCoverPage(page)).toBe(false);
  });
});

describe('the running header', () => {
  // Measured: identical band on all 48 header pages -- yMin 23.23, yMax 38.86.
  // Present on offsets +1, +2, +4, +5; absent on the cover (+0) and on the
  // signature-right page (+3).
  test('the header band yields the class name', () => {
    const [page] = parseBboxPages(doc(block(40, 23.23, [
      line(40, 23.23, [word(40, 23.23, 'Gunslinger', { yMax: 38.86 })])
    ])));
    expect(headerName(page)).toBe('Gunslinger');
  });

  // The whole-line read is gap-aware, the same rule joinLines uses: one rule in this module for
  // whether a space belongs between two word boxes, so a reader has no second one to choose
  // between. The two rules cannot disagree on a line this module matches -- fusing only closes a
  // space pdftotext opened inside one printed word -- but they can be told apart on a fixture.
  test('the header band closes a gap narrower than a printed space', () => {
    const [page] = parseBboxPages(doc(block(40, 23.23, [
      line(40, 23.23, [
        word(40, 23.23, 'Witch', { xMax: 60, yMax: 38.86 }),
        word(60.1, 23.23, 'finder', { xMax: 80, yMax: 38.86 }),
      ])
    ])));
    expect(headerName(page)).toBe('Witchfinder');
  });

  test('the header band keeps a gap as wide as a printed space', () => {
    const [page] = parseBboxPages(doc(block(40, 23.23, [
      line(40, 23.23, [
        word(40, 23.23, 'Witch', { xMax: 60, yMax: 38.86 }),
        word(60.9, 23.23, 'finder', { xMax: 80, yMax: 38.86 }),
      ])
    ])));
    expect(headerName(page)).toBe('Witch finder');
  });

  test('body text below the header band is not mistaken for a header', () => {
    const [page] = parseBboxPages(doc(block(40, 200, [
      line(40, 200, [word(40, 200, 'Gunslinger', { yMax: 213 })])
    ])));
    expect(headerName(page)).toBeNull();
  });
});

describe('per-side bands', () => {
  test('body columns shift 11.52 from verso to recto', () => {
    expect(RECTO_SHIFT).toBe(11.52);
    expect(shiftFor(20, 'body')).toBe(0);
    expect(shiftFor(21, 'body')).toBe(11.52);
  });

  // The one place the spec's single constant is wrong: signature-page note
  // indents shift 16.32, not 11.52 (geometry doc, section 3a).
  test('signature note indents shift 16.32, not 11.52', () => {
    expect(SIGNATURE_NOTE_RECTO_SHIFT).toBe(16.32);
    expect(shiftFor(21, 'signature-note')).toBe(16.32);
    expect(shiftFor(20, 'signature-note')).toBe(0);
  });
});

const { POWER_RATINGS, isSuperscript, rethreadSuperscripts, markPowerRatings } =
  require('./aspirant-extract');

describe('Power Rating superscripts', () => {
  // Measured host line: height 11.75, superscript height 6.85 (= 0.583 x).
  const host = { xMin: 40, yMin: 200, yMax: 211.75, words: [
    { xMin: 40, yMin: 200, xMax: 130.61, yMax: 211.75, text: 'Ward' },
    { xMin: 139.54, yMin: 200, xMax: 200, yMax: 211.75, text: 'against' }
  ] };
  const rating = { xMin: 132.04, yMin: 200.78, xMax: 137.41, yMax: 207.63, text: 'M' };

  test('the thirteen rating strings are the whole observed set, with en dashes', () => {
    expect(POWER_RATINGS).toEqual(
      ['L', 'M', 'H', 'H+', 'L–M', 'L–H', 'M–H', 'L–H+', 'M–H+', 'H–H+',
        '0–L', '0–M', '0–H']);
    expect(POWER_RATINGS.every((r) => !r.includes('-'))).toBe(true);
  });

  test('a word at 0.583 of the line height hanging at the line top is a superscript', () => {
    expect(isSuperscript(rating, host)).toBe(true);
  });

  test('a full-height word on the same line is not', () => {
    expect(isSuperscript(host.words[0], host)).toBe(false);
  });

  test('a small word sitting on the baseline is not a superscript', () => {
    const subscript = { ...rating, yMin: 205, yMax: 211.75 };
    expect(isSuperscript(subscript, host)).toBe(false);
  });

  test('p21 "Deadlier L–H": a rating set at a smaller body bucket than its host line is still a superscript', () => {
    // Real measured values: host line yMin 581.820/yMax 594.870 (height
    // 13.05), word yMin 583.609271/yMax 590.456606 (height 6.847335). That
    // gives heightRatio 0.5247, outside a band pinned to 0.583, but topHang
    // 0.6618 is well inside tolerance -- the source PDF set this one rating
    // at the font size for the 11.75 body bucket, not the 13.05 line it's on.
    const deadlierHost = { xMin: 81.12, yMin: 581.820, yMax: 594.870, words: [] };
    const deadlierLH = {
      xMin: 116.213, yMin: 583.609271, xMax: 126.880151, yMax: 590.456606, text: 'L–H',
    };
    expect(isSuperscript(deadlierLH, deadlierHost)).toBe(true);
  });

  test('a detached rating in its own block rejoins its host line in reading order', () => {
    const page = { page: 20, blocks: [
      { xMin: 40, yMin: 200, yMax: 211.75, lines: [host] },
      { xMin: 132.04, yMin: 200.78, yMax: 207.63, lines: [{ ...rating, words: [rating] }] }
    ] };
    const [line] = rethreadSuperscripts(page).blocks[0].lines;
    expect(line.words.map((w) => w.text)).toEqual(['Ward', 'M', 'against']);
  });

  test('a host line split in two around the gap is rejoined as one line', () => {
    // p21 y~649.3: pdftotext emits three fragments at the same yMin.
    const lineAt = (xMin, xMax, text, yMin = 649.3, yMax = 661.05) =>
      ({ xMin, yMin, yMax, words: [{ xMin, yMin, xMax, yMax, text }] });
    const page = { page: 21, blocks: [{ xMin: 328.8, yMin: 649.3, yMax: 661.05, lines: [
      lineAt(328.8, 382.54, 'Happenstance'),
      lineAt(383.82, 395.14, 'L–M', 650.08, 656.93),
      lineAt(397.06, 528.06, 'and')
    ] }] };
    const lines = rethreadSuperscripts(page).blocks[0].lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].words.map((w) => w.text)).toEqual(['Happenstance', 'L–M', 'and']);
  });

  test('a host line split in two around the gap is rejoined as one line (p63)', () => {
    // Measured directly via `pdftotext -bbox-layout -f 63 -l 63`, since the
    // geometry doc's §7 table only records the H+ candidate's own bbox for
    // p63, not the host fragments -- unlike p21, which it spells out. Here
    // the three fragments aren't even siblings in one block, as in the p21
    // case: "perfectly" and "H+" are each their own single-line block, and
    // "copy ... notwithstanding)." is one line inside a taller multi-line
    // block (that block's other two lines, an unrelated preceding sentence,
    // are omitted here since they take no part in the merge).
    const page = { page: 63, blocks: [
      { xMin: 328.8, yMin: 741.282, yMax: 753.027, lines: [
        { xMin: 328.8, yMin: 741.282, yMax: 753.027, words: [
          { xMin: 328.8, yMin: 741.282, xMax: 359.769, yMax: 753.027, text: 'perfectly' },
        ] },
      ] },
      { xMin: 361.054515, yMin: 742.064271, yMax: 748.911606, lines: [
        { xMin: 361.054515, yMin: 742.064271, yMax: 748.911606, words: [
          { xMin: 361.054515, yMin: 742.064271, xMax: 368.416056, yMax: 748.911606, text: 'H+' },
        ] },
      ] },
      { xMin: 370.333, yMin: 741.282, yMax: 753.027, lines: [
        { xMin: 370.333, yMin: 741.282, yMax: 753.027, words: [
          { xMin: 370.333, yMin: 741.282, xMax: 387.010, yMax: 753.027, text: 'copy' },
          { xMin: 388.927, yMin: 741.282, xMax: 405.946, yMax: 753.027, text: 'their' },
          { xMin: 407.863, yMin: 741.282, xMax: 425.737, yMax: 753.027, text: 'exact' },
          { xMin: 427.654, yMin: 741.282, xMax: 452.800, yMax: 753.027, text: 'actions' },
          { xMin: 454.717, yMin: 741.282, xMax: 474.562, yMax: 753.027, text: '(Stats' },
          { xMin: 476.479, yMin: 741.282, xMax: 540.973, yMax: 753.027, text: 'notwithstanding).' },
        ] },
      ] },
    ] };
    const rethreaded = rethreadSuperscripts(page);
    const lines = rethreaded.blocks.flatMap((block) => block.lines);
    expect(lines).toHaveLength(1);
    expect(lines[0].words.map((w) => w.text)).toEqual(
      ['perfectly', 'H+', 'copy', 'their', 'exact', 'actions', '(Stats', 'notwithstanding).']);
  });

  test('re-threading leaves a page with no detached ratings untouched', () => {
    const page = { page: 20, blocks: [{ xMin: 40, yMin: 200, yMax: 211.75, lines: [host] }] };
    expect(rethreadSuperscripts(page)).toEqual(page);
  });

  test('rethreading does not mutate its input, even where a real merge happens', () => {
    const page = { page: 20, blocks: [
      { xMin: 40, yMin: 200, yMax: 211.75, lines: [
        { xMin: 40, yMin: 200, yMax: 211.75, words: [
          { xMin: 40, yMin: 200, xMax: 130.61, yMax: 211.75, text: 'Ward' },
          { xMin: 139.54, yMin: 200, xMax: 200, yMax: 211.75, text: 'against' },
        ] },
      ] },
      { xMin: 132.04, yMin: 200.78, yMax: 207.63, lines: [
        { xMin: 132.04, yMin: 200.78, yMax: 207.63, words: [
          { xMin: 132.04, yMin: 200.78, xMax: 137.41, yMax: 207.63, text: 'M' },
        ] },
      ] },
    ] };
    const pristine = JSON.parse(JSON.stringify(page));

    // Freeze every level so an in-place mutation -- e.g. a regression that
    // sorts or assigns into the original words array instead of building a
    // new one -- throws at the mutation site (Array.prototype.sort on a
    // frozen array always throws, independent of the caller's strict mode)
    // rather than only being caught later, and only if someone thinks to
    // compare against a clone.
    const freezeDeep = (value) => {
      if (Array.isArray(value)) value.forEach(freezeDeep);
      else if (value !== null && typeof value === 'object') Object.values(value).forEach(freezeDeep);
      return Object.freeze(value);
    };
    freezeDeep(page);

    const result = rethreadSuperscripts(page);

    expect(page).toEqual(pristine);
    expect(result.blocks[0].lines[0].words.map((w) => w.text)).toEqual(['Ward', 'M', 'against']);
  });

  test('markup wraps the rating and nothing else', () => {
    const threaded = { ...host, words: [host.words[0], rating, host.words[1]] };
    expect(markPowerRatings(threaded)).toBe('Ward <sup>M</sup> against');
  });

  test('a small word that is not a known rating is left as plain text', () => {
    const footnote = { ...rating, text: '7' };
    const threaded = { ...host, words: [host.words[0], footnote, host.words[1]] };
    expect(markPowerRatings(threaded)).toBe('Ward 7 against');
  });

  // Printed page 12 defines the form these three take: "If a range does not
  // include a lower bound ("up to Mid", or 0–M as a superscript), insufficiently
  // fulfilling its scaling criteria will result in no effect." The 0 is the
  // book's notation for an absent lower bound, not a mis-decoded L.
  const p81Line = { xMin: 357.6, yMin: 401.784, yMax: 413.529, words: [
    { xMin: 357.6, yMin: 401.784, xMax: 374.169, yMax: 413.529, text: 'both' },
    { xMin: 375.816, yMin: 401.784, xMax: 398.946, yMax: 413.529, text: 'scaling' },
    { xMin: 400.01781, yMin: 402.566271, xMax: 410.296683, yMax: 409.413606, text: '0–H' },
    { xMin: 412, yMin: 401.784, xMax: 421.216, yMax: 413.529, text: 'on' },
    { xMin: 422.863, yMin: 401.784, xMax: 438.1, yMax: 413.529, text: 'how' },
  ] };

  test('p81 "scaling 0–H": a rating with no lower bound is marked like any other', () => {
    expect(markPowerRatings(p81Line)).toBe('both scaling <sup>0–H</sup> on how');
  });

  test('a rating form the book never prints is left as plain text', () => {
    // 0–H+ is the shape a pattern would admit and the book does not print: the
    // set is enumerated from the page, so this reads as ordinary text.
    const speculative = p81Line.words.map((word) =>
      (word.text === '0–H' ? { ...word, text: '0–H+' } : word));
    expect(markPowerRatings({ ...p81Line, words: speculative }))
      .toBe('both scaling 0–H+ on how');
  });

  test('p33 "Grants a Ward 0–M against": the detached 0–M rejoins its host', () => {
    // Its host is split in two around the gap the rating sits in, and the
    // rating is its own block, 0.78 below both halves.
    const fragment = (xMin, xMax, ...words) => ({ xMin, yMin: 440.082, yMax: 451.827,
      words: words.map(([wordXMin, wordXMax, text]) =>
        ({ xMin: wordXMin, yMin: 440.082, xMax: wordXMax, yMax: 451.827, text })) });
    const page = { page: 33, blocks: [
      { xMin: 148.32, yMin: 440.082, yMax: 451.827, lines: [
        fragment(148.32, 201.438, [148.32, 172.647, 'Grants'], [174.564, 178.281, 'a'],
          [180.198, 201.438, 'Ward']),
        fragment(215.717, 261.365, [215.717, 240.548, 'against'], [242.465, 261.365, 'those']),
      ] },
      { xMin: 202.723515, yMin: 440.864271, yMax: 447.711606, lines: [
        { xMin: 202.723515, yMin: 440.864271, yMax: 447.711606, words: [
          { xMin: 202.723515, yMin: 440.864271, xMax: 213.799932, yMax: 447.711606, text: '0–M' },
        ] },
      ] },
    ] };
    const lines = rethreadSuperscripts(page).blocks.flatMap((block) => block.lines);
    expect(lines).toHaveLength(1);
    expect(markPowerRatings(lines[0])).toBe('Grants a Ward <sup>0–M</sup> against those');
  });

  test('p45 "power L–H,": a comma fused to the rating is marked outside the tag', () => {
    // pdftotext gives the comma inside the superscript word, which spans
    // 548.25-561.49 entirely at rating height. The rating is L–H; the comma
    // belongs to the sentence.
    const line = { xMin: 376.8, yMin: 665.82, yMax: 678.87, words: [
      { xMin: 522.48, yMin: 665.82, xMax: 546.9, yMax: 678.87, text: 'power' },
      { xMin: 548.2492, yMin: 666.68919, xMax: 561.48913, yMax: 674.29734, text: 'L–H,' },
    ] };
    expect(markPowerRatings(line)).toBe('power <sup>L–H</sup>,');
  });

  test('p21 "faster M.": a mark set against the rating takes no space before it', () => {
    // The raised M is lifted out from between "faster" and the full stop, so the stop is a
    // word of its own -- and its box overlaps the M's by 0.09.
    const line = { xMin: 357.6, yMin: 153.49, yMax: 166.54, words: [
      { xMin: 541.53, yMin: 153.49, xMax: 562.35, yMax: 166.54, text: 'faster' },
      { xMin: 563.54, yMin: 154.36, xMax: 568.91, yMax: 161.97, text: 'M' },
      { xMin: 568.82, yMin: 153.49, xMax: 571.18, yMax: 166.54, text: '.' },
    ] };
    expect(markPowerRatings(line)).toBe('faster <sup>M</sup>.');
  });

  test('p83 "Advent, pg.": a mark against an italic word takes no space either', () => {
    const line = { xMin: 348.48, yMin: 507.27, yMax: 523.28, words: [
      { xMin: 348.48, yMin: 507.27, xMax: 383.69, yMax: 523.28, text: 'Advent' },
      { xMin: 383.58, yMin: 507.54, xMax: 386.16, yMax: 523.2, text: ',' },
      { xMin: 388.34, yMin: 507.54, xMax: 400.96, yMax: 523.2, text: 'pg.' },
    ] };
    expect(markPowerRatings(line)).toBe('Advent, pg.');
  });
});

const { noteTree, TIPS_NOTE_STEP, TIPS_NOTE_THRESHOLD, BODY_NOTE_STEP } =
  require('./aspirant-extract');

describe('glyphless note trees', () => {
  const ln = (xMin, yMin, text, height = 12) =>
    ({ xMin, yMin, yMax: yMin + height, words: [{ xMin, yMin, xMax: xMin + 100, yMax: yMin + height, text }] });

  test('the measured constants', () => {
    expect(TIPS_NOTE_STEP).toBe(18.72);
    expect(TIPS_NOTE_THRESHOLD).toBe(16.0);
    expect(BODY_NOTE_STEP).toBe(19.2);
  });

  test('lines at one indent and new-note leading are siblings', () => {
    const notes = noteTree([
      ln(72.0, 100, 'first'), ln(72.0, 120.39, 'second')
    ], { step: TIPS_NOTE_STEP, threshold: TIPS_NOTE_THRESHOLD });
    expect(notes).toEqual([
      { text: 'first', children: [] }, { text: 'second', children: [] }
    ]);
  });

  test('a wrapped line joins the note above it instead of starting a new one', () => {
    // Measured Expanded Tips leadings: wrapped 12.00, new note 20.39.
    const notes = noteTree([
      ln(72.0, 100, 'a note that'), ln(72.0, 112.0, 'wraps here')
    ], { step: TIPS_NOTE_STEP, threshold: TIPS_NOTE_THRESHOLD });
    expect(notes).toEqual([{ text: 'a note that wraps here', children: [] }]);
  });

  test('the indent step makes a child, and the child may itself wrap', () => {
    const notes = noteTree([
      ln(72.0, 100, 'parent'),
      ln(90.72, 120.39, 'child'),
      ln(90.72, 132.39, 'wrapped')
    ], { step: TIPS_NOTE_STEP, threshold: TIPS_NOTE_THRESHOLD });
    expect(notes).toEqual([
      { text: 'parent', children: [{ text: 'child wrapped', children: [] }] }
    ]);
  });

  test('a wrapped child line shares its parent xMin and is still not a new note', () => {
    // The caveat that makes the leading load-bearing: x-indent alone cannot
    // tell these apart (geometry doc, section 6, "The important caveat").
    const notes = noteTree([
      ln(90.72, 100, 'child one'), ln(90.72, 112.0, 'continues')
    ], { step: TIPS_NOTE_STEP, threshold: TIPS_NOTE_THRESHOLD });
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('child one continues');
  });

  test('a null threshold reads the boundary off the line height, per entry', () => {
    // Measured body pair: lineHeight 11.75 -> wrapped 9.00, new note 13.29.
    const notes = noteTree([
      ln(64.8, 100, 'first', 11.75),
      ln(64.8, 109.0, 'wrapped', 11.75),
      ln(64.8, 122.29, 'second', 11.75)
    ], { step: BODY_NOTE_STEP, threshold: null });
    expect(notes.map((n) => n.text)).toEqual(['first wrapped', 'second']);
  });

  test('the other measured body font size resolves the same way', () => {
    // lineHeight 13.05 -> wrapped 10.00, new note 14.33.
    const notes = noteTree([
      ln(64.8, 100, 'first', 13.05),
      ln(64.8, 110.0, 'wrapped', 13.05),
      ln(64.8, 124.33, 'second', 13.05)
    ], { step: BODY_NOTE_STEP, threshold: null });
    expect(notes.map((n) => n.text)).toEqual(['first wrapped', 'second']);
  });

  test('a run with no wrapped line at all still separates into notes', () => {
    // p22 Stick ‘Em Up prints four notes and not one wrapped line, every
    // leading 14.33 at lineHeight 13.05. Taking the boundary from the smallest
    // observed leading reads the whole run as a single note; the leading a
    // wrapped line would have is a fixed fraction of the line height, so the
    // boundary comes from the height instead.
    const notes = noteTree([
      ln(84.0, 361.89, 'first', 13.05),
      ln(103.2, 376.22, 'second', 13.05),
      ln(103.2, 390.55, 'third', 13.05),
      ln(84.0, 404.88, 'fourth', 13.05)
    ], { step: BODY_NOTE_STEP, threshold: null });
    expect(notes.map((note) => note.text)).toEqual(['first', 'fourth']);
    expect(notes[0].children.map((child) => child.text)).toEqual(['second', 'third']);
  });

  test('a note deeper than anything before it is refused rather than silently promoted', () => {
    expect(() => noteTree([
      ln(109.44, 100, 'orphan'),
      ln(90.72, 120.39, 'parent')
    ], { step: TIPS_NOTE_STEP, threshold: TIPS_NOTE_THRESHOLD })).toThrow('orphan');
  });

  test('a single top-level note is not mistaken for an orphan', () => {
    const notes = noteTree([ln(90.72, 100, 'alone')],
      { step: TIPS_NOTE_STEP, threshold: TIPS_NOTE_THRESHOLD });
    expect(notes).toEqual([{ text: 'alone', children: [] }]);
  });

  test('no lines is no notes', () => {
    expect(noteTree([], { step: TIPS_NOTE_STEP, threshold: TIPS_NOTE_THRESHOLD })).toEqual([]);
  });
});

const { signatureEntries, COLUMN_SPLIT_X } = require('./aspirant-extract');

// Every coordinate in the fixtures below is lifted from `pdftotext
// -bbox-layout` over the real book (geometry doc, sections 4 and 5). Tidy
// invented numbers would let a fixture agree with the code by construction:
// the traps this page sets are all 2-5pt apart.
//
// A line is [xMin, yMin, xMax, height, text]. `text` may instead be a list of
// [xMin, xMax, text] segments -- which is how pdftotext emits a line that a
// superscript interrupts -- each optionally carrying its own [yMin, height].
const sigWord = (lineY, lineHeight) => (segment) => {
  const [x, xMax, text, y = lineY, height = lineHeight] = segment;
  return word(x, y, text, { xMax, yMax: y + height });
};
const sigLine = ([x, y, xMax, height, text]) => line(x, y,
  (Array.isArray(text) ? text : [[x, xMax, text]]).map(sigWord(y, height)));
const sigBlock = ([x, y, lines]) => block(x, y, lines.map(sigLine));

// The page number selects the recto/verso note shift, so a fixture taken from
// PDF page 20 has to arrive as page 20.
const pageAt = (pdfPage, blocks) => parseBboxPages(
  doc(...Array(pdfPage - 1).fill(''), blocks.map(sigBlock).join('')))[pdfPage - 1];

// PDF page 20, Gunslinger verso, columns 1-2: every block that carries
// content, in pdftotext's own emission order, which is not y-order.
const P20_LEFT = [
  [259.851, 23.233, [[259.851, 23.233, 340.621, 15.630, 'Gunslinger']]],
  [45.600, 117.568, [[45.600, 117.568, 131.584, 20.880, 'Cowboy Hat']]],
  [64.800, 143.493, [
    [64.800, 143.493, 248.968, 13.050, [[64.800, 130.610, 'Provides a Ward'],
      [139.538, 248.968, 'against weather such as sun,']]],
    [64.800, 153.493, 118.530, 13.050, 'wind, or rain.'],
    [64.800, 167.820, 235.658, 13.050, [[64.800, 228.860, 'Delivering a smooth one-liner Galvanizes'],
      [230.288, 235.658, 'M', 168.689, 7.608]]],
    [64.800, 177.820, 258.150, 13.050, 'others towards perceiving the owner as more cool'],
    [64.800, 187.820, 251.840, 13.050, 'and mysterious and taking them more seriously.']]],
  [132.038, 144.362, [[132.038, 144.362, 137.408, 7.608, 'M']]],
  [124.965, 203.159, [[124.965, 203.159, 199.035, 11.745, 'Default Enchantment']]],
  [43.200, 217.114, [[43.200, 217.114, 102.555, 11.745, 'Hats Off to You']]],
  [40.800, 217.114, [
    [136.800, 217.114, 274.014, 11.745, 'Portray a Turning Point of newfound'],
    [136.800, 226.114, 271.179, 11.745, 'appreciation or admiration for an ally,'],
    [40.800, 235.114, 280.515, 11.745, 'culminating in a tip of this hat, to instantly share an Expertise with'],
    [40.800, 244.114, 257.304, 11.745, 'them (implicit or Pitched), using whoever’s Stat(s) are higher.']]],
  [45.600, 292.549, [[45.600, 292.549, 111.920, 20.880, 'Bandolier']]],
  [64.800, 318.474, [
    [64.800, 318.474, 273.030, 13.050, 'Increases the Ammunition of all the owner’s firearms'],
    [64.800, 328.474, 228.980, 13.050, 'by one Power Rating (to Low if unlisted).'],
    [64.800, 342.801, 263.228, 13.050, 'Grab Bag M for semi-realistic, specialized ammo —'],
    [64.800, 352.801, 245.940, 13.050, 'incendiary, smokescreen, or similar. (3x Uses).']]],
  [124.965, 378.141, [[124.965, 378.141, 199.035, 11.745, 'Default Enchantment']]],
  [43.200, 392.095, [[43.200, 392.095, 81.819, 11.745, 'Epic Drop']]],
  [40.800, 392.095, [
    [136.800, 392.095, 259.371, 11.745, 'Conjure a magical round from the'],
    [136.800, 401.095, 276.612, 11.745, 'corpse of a dead enemy with a Pitched H'],
    [40.800, 410.095, 282.108, 11.745, 'supernatural property themed around that enemy (Mid Cooldown).']]],
  [45.600, 458.182, [[45.600, 458.182, 105.664, 20.880, 'Revolver']]],
  [170.660, 468.469, [[170.660, 468.469, 223.200, 13.050, 'Ammunition']]],
  [246.650, 468.469, [[246.650, 468.469, 264.550, 13.050, 'Mid']]],
  [45.600, 484.631, [[45.600, 484.631, 150.804, 14.355, 'Single-action six-shooter.']]],
  [64.800, 503.307, [
    [64.800, 503.307, 264.580, 13.050, 'Instantly reloaded from the owner’s ammo reserves'],
    [64.800, 513.307, 185.210, 13.050, 'when sheathed with a flourish.']]],
  [124.965, 529.141, [[124.965, 529.141, 199.035, 11.745, 'Default Enchantment']]],
  [43.200, 543.096, [[43.200, 543.096, 74.637, 11.745, 'Big Iron']]],
  [40.800, 543.096, [
    [136.800, 543.096, 283.140, 11.745, 'Outside of combat, the owner may subtly'],
    [136.800, 552.096, 257.391, 11.745, 'show off this Revolver to project a'],
    [66.773, 561.878, 71.605, 6.847, 'M'],
    [40.800, 561.096, 251.686, 11.745, [[40.800, 65.487, 'Vision'],
      [73.522, 251.686, 'of their past feats with it into the minds of curious']]],
    [40.800, 570.096, 140.898, 11.745, 'onlookers (Mid Cooldown).']]],
  [292.818, 764.837, [[292.818, 764.837, 307.182, 18.270, '15']]],
];

const P20_RIGHT = [
  [322.080, 117.568, [[322.080, 117.568, 405.936, 20.880, 'Sharps Rifle']]],
  [447.140, 127.855, [[447.140, 127.855, 499.680, 13.050, 'Ammunition']]],
  [522.765, 127.855, [[522.765, 127.855, 541.395, 13.050, 'Low']]],
  [322.080, 144.018, [[322.080, 144.018, 494.109, 14.355, 'Single-shot, falling block-action firearm.']]],
  [341.280, 162.693, [
    [341.280, 162.693, 555.277, 13.050, 'The first shot this fires at a given target gains boosted H'],
    [341.280, 172.693, 489.120, 13.050, 'accuracy and range (Low Cooldown).']]],
  [401.445, 188.528, [[401.445, 188.528, 475.515, 11.745, 'Default Enchantment']]],
  [319.680, 202.482, [[319.680, 202.482, 371.709, 11.745, 'California Joe']]],
  [317.280, 202.482, [
    [413.280, 202.482, 546.561, 11.745, 'Sighting down this rifle will gradually'],
    [413.280, 211.482, 549.695, 11.745, 'zoom in L–H the owner’s eyesight over a'],
    [317.280, 220.482, 541.029, 11.745, 'Low Duration; zoomed vision may even be slightly bent to look'],
    [317.280, 229.482, 546.814, 11.745, 'around shallow corners. The affected eye is temporarily M blinded'],
    [317.280, 238.482, 356.880, 11.745, 'afterwards.']]],
  [322.080, 286.768, [[322.080, 286.768, 397.664, 20.880, 'Coach Gun']]],
  [447.140, 297.055, [[447.140, 297.055, 499.680, 13.050, 'Ammunition']]],
  [522.765, 297.055, [[522.765, 297.055, 541.395, 13.050, 'Low']]],
  [322.080, 312.518, [
    [322.080, 312.518, 556.776, 14.355, 'Short, breech-loading, double-barreled shotgun firing a'],
    [322.080, 323.518, 414.964, 14.355, 'tight cone of buckshot.']]],
  [341.280, 341.493, [
    [341.280, 341.493, 547.115, 13.050, 'The owner may Dash L in the opposite direction of a'],
    [341.280, 351.493, 451.940, 13.050, 'fired shot (Low Cooldown).']]],
  [401.445, 367.328, [[401.445, 367.328, 475.515, 11.745, 'Default Enchantment']]],
  [319.680, 381.282, [[319.680, 381.282, 380.394, 11.745, 'Riding Shotgun']]],
  [413.280, 381.282, [
    [413.280, 381.282, 542.646, 11.745, 'The owner may bring a single ally by'],
    [413.280, 390.282, 539.307, 11.745, 'their side with them when Dashing.']]],
  [322.080, 437.968, [[322.080, 437.968, 373.008, 20.880, 'Saddler']]],
  [442.229, 448.255, [[442.229, 448.255, 509.779, 13.050, 'Endurance Boost']]],
  [528.180, 448.255, [[528.180, 448.255, 546.080, 13.050, 'Mid']]],
  [322.080, 464.418, [[322.080, 464.418, 544.973, 14.355, 'Calm, surefooted horse, comfortable around gunfire.']]],
  [341.280, 483.093, [
    [341.280, 483.093, 548.735, 13.050, 'Saddle bags serve as a Grab Bag L for riding and basic'],
    [341.280, 493.093, 392.420, 13.050, 'survival gear.'],
    [341.280, 507.420, 558.450, 13.050, 'May be Summoned or Dismissed with a call or whistle'],
    [341.280, 517.420, 522.960, 13.050, 'from the owner, galloping into or out of sight.']]],
  [401.445, 532.927, [[401.445, 532.927, 475.515, 11.745, 'Default Enchantment']]],
  [319.680, 546.882, [[319.680, 546.882, 369.243, 11.745, 'Pony Express']]],
  [365.280, 546.910, [
    [413.280, 546.910, 555.246, 11.745, 'Summon another Saddler (mechanically'],
    [413.280, 555.910, 552.735, 11.745, 'identical, different individual horse) for'],
    [365.280, 564.910, 552.957, 11.745, 'an ally within view (Mid Duration, Mid Cooldown).']]],
];

describe('the signature spread', () => {
  test('the split sits inside the measured gutter on both parities', () => {
    // The gutter runs 283.14 -> 317.28 on verso and 294.86 -> 328.80 on recto
    // (geometry doc, section 4), so only 294.86 < x < 317.28 separates the two
    // columns on every one of the 24 pages.
    expect(COLUMN_SPLIT_X).toBeGreaterThan(294.86);
    expect(COLUMN_SPLIT_X).toBeLessThan(317.28);
  });

  test('six entries come back, the left column first, in reading order', () => {
    const entries = signatureEntries(pageAt(20, [...P20_LEFT, ...P20_RIGHT]));
    expect(entries.map((entry) => entry.name)).toEqual([
      'Cowboy Hat', 'Bandolier', 'Revolver', 'Sharps Rifle', 'Coach Gun', 'Saddler'
    ]);
  });

  test('the columns are partitioned by x, never paired by baseline', () => {
    // On p20 only 3 of 32 baselines coincide, and the columns interleave the
    // other way round further down: the left column's third name is at 458.18
    // while the right column's is at 437.97, and the left column's third
    // divider (529.14) sits above the right column's (532.93). Pairing the two
    // sides by yMin swaps content between them.
    const entries = signatureEntries(pageAt(20, [...P20_LEFT, ...P20_RIGHT]));
    expect(entries.map((entry) => entry.default_enchantment.name)).toEqual([
      'Hats Off to You', 'Epic Drop', 'Big Iron',
      'California Joe', 'Riding Shotgun', 'Pony Express'
    ]);
    const leftText = JSON.stringify(entries.slice(0, 3));
    for (const fromTheRight of ['Sharps', 'Coach Gun', 'Saddler', 'Dash', 'buckshot']) {
      expect(leftText).not.toContain(fromTheRight);
    }
  });

  test('one column read on its own yields its own three entries', () => {
    const entries = signatureEntries(pageAt(20, P20_LEFT));
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.name)).toEqual(['Cowboy Hat', 'Bandolier', 'Revolver']);
  });

  test('the item name is the tallest line in its entry, not a fixed height', () => {
    // The book auto-fits a long name from 20.88 down to 19.57, so nothing may
    // key on 20.88. Both heights clear every body size on the page (max 14.36).
    const autoFitted = P20_LEFT.map(([x, y, lines]) => [x, y, lines.map((line) =>
      (line[4] === 'Cowboy Hat' ? [line[0], line[1], line[2], 19.570, line[4]] : line))]);
    expect(signatureEntries(pageAt(20, P20_LEFT))[0].name).toBe('Cowboy Hat');
    expect(signatureEntries(pageAt(20, autoFitted))[0].name).toBe('Cowboy Hat');
  });

  test('an entry with no description, no meters and no notes still parses', () => {
    // Cowboy Hat prints neither a description nor meters.
    const [cowboyHat] = signatureEntries(pageAt(20, P20_LEFT));
    expect(cowboyHat.description).toBe('');
    expect(cowboyHat.meters).toEqual([]);

    // Cowboy Hat's notes, and the rating detached out of them, removed.
    const noteless = P20_LEFT.filter(([x, y]) => y !== 143.493 && y !== 144.362);
    expect(signatureEntries(pageAt(20, noteless))[0].notes).toEqual([]);
  });

  test('the signature name is not spliced into the description beside it', () => {
    // `Hats Off to You` (43.20-102.56) and the description's first line
    // (136.80) are both at yMin 217.11. A plain positional sort splices one
    // into the other.
    const [cowboyHat] = signatureEntries(pageAt(20, P20_LEFT));
    expect(cowboyHat.default_enchantment.name).toBe('Hats Off to You');
    expect(cowboyHat.default_enchantment.description).toBe(
      'Portray a Turning Point of newfound appreciation or admiration for an ally,'
      + ' culminating in a tip of this hat, to instantly share an Expertise with them'
      + ' (implicit or Pitched), using whoever’s Stat(s) are higher.');
  });

  test('a two-line signature name is one name, not two entries', () => {
    // p74 Asklepian: `Doctor Without` / `Borders`, two <line>s in one <block>.
    const [asklepian] = signatureEntries(pageAt(74, [
      [45.600, 325.168, [[45.600, 325.168, 113.440, 20.880, 'Asklepian']]],
      [45.600, 351.618, [[45.600, 351.618, 238.804, 14.355, 'Large wand entwined with a stylized serpent.']]],
      [64.800, 370.293, [
        [64.800, 370.293, 245.440, 13.050, 'Gently touch another being with this wand to'],
        [64.800, 380.293, 267.492, 13.050, 'gradually Heal L–H them over up to a Low Duration']]],
      [124.965, 450.127, [[124.965, 450.127, 199.035, 11.745, 'Default Enchantment']]],
      [43.200, 464.082, [
        [43.200, 464.082, 104.931, 11.745, 'Doctor Without'],
        [50.400, 473.082, 79.731, 11.745, 'Borders']]],
      [40.800, 464.110, [
        [136.800, 464.110, 272.484, 11.745, 'Using this wand to Heal an enemy will'],
        [40.800, 491.110, 270.192, 11.745, 'neutral party, scaling on the amount of Healing rendered and the']]],
    ]));
    expect(asklepian.default_enchantment.name).toBe('Doctor Without Borders');
    expect(asklepian.default_enchantment.description).toBe(
      'Using this wand to Heal an enemy will neutral party, scaling on the amount'
      + ' of Healing rendered and the');
  });

  test('`In Honor of` is lifted out of the paragraph it lands inside', () => {
    // p50 Satchel: the dedication is height 7.83 at y 372.85, inside the
    // description block, between its wrapped lines at 371.83 and 380.83.
    const [satchel] = signatureEntries(pageAt(50, [
      [45.600, 287.517, [[45.600, 287.517, 93.984, 20.880, 'Satchel']]],
      [64.800, 313.442, [
        [64.800, 313.442, 273.698, 13.050, 'Grab Bag M for cheap, everyday objects and souvenirs']]],
      [124.965, 348.877, [[124.965, 348.877, 199.035, 11.745, 'Default Enchantment']]],
      [43.200, 362.831, [[43.200, 362.831, 127.314, 11.745, 'Caution: Sharp Objects']]],
      [40.800, 362.831, [
        [136.800, 362.831, 273.021, 11.745, 'Substantially improves this Grab Bag H'],
        [65.685, 372.852, 104.715, 7.830, 'In Honor of Xela'],
        [136.800, 371.831, 259.758, 11.745, 'for the purposes of acquiring small'],
        [136.800, 380.831, 278.172, 11.745, 'blades (knives, razors, or similar). Blades'],
        [40.800, 389.831, 282.049, 11.745, 'acquired in this way are rendered Inconspicuous L for a few seconds.']]],
    ]));
    expect(satchel.default_enchantment.dedication).toBe('In Honor of Xela');
    expect(satchel.default_enchantment.description).toBe(
      'Substantially improves this Grab Bag H for the purposes of acquiring small'
      + ' blades (knives, razors, or similar). Blades acquired in this way are'
      + ' rendered Inconspicuous L for a few seconds.');
  });

  test('a meter pairs its label to the value on the same baseline', () => {
    const entries = signatureEntries(pageAt(20, P20_LEFT));
    expect(entries[2].meters).toEqual([{ label: 'Ammunition', value: 'Mid' }]);
    expect(entries[0].meters).toEqual([]);
  });

  test('the folio is cut out of the content band, not read as body text', () => {
    // The page number stands alone at yMin 764.84. It is centred at x 292.82,
    // inside the left column, and lands below the last entry's last line, so
    // without the upper bound it is appended to that entry's signature
    // description -- "...onlookers (Mid Cooldown). 15".
    const entries = signatureEntries(pageAt(20, P20_LEFT));
    expect(entries[2].default_enchantment.description).toBe(
      'Outside of combat, the owner may subtly show off this Revolver to project'
      + ' a Vision <sup>M</sup> of their past feats with it into the minds of'
      + ' curious onlookers (Mid Cooldown).');
  });

  test('a long meter label reaching in past the gutter is read whole', () => {
    // p27 right, Wild Cards. `Thrown Accuracy Boost` begins at colLeft +
    // 112.56, so a gutter starting at colLeft + 120 truncates it to
    // `Accuracy Boost`. Its first meter row also starts 4.11 ABOVE the item
    // name's own baseline, so an entry that began exactly at its name would
    // lose the whole block.
    const [wildCards] = signatureEntries(pageAt(27, [
      [446.162, 383.929, [
        [506.352, 383.929, 564.636, 13.050, [[506.352, 542.662, 'Quantity'],
          [554.026, 564.636, '4x']]],
        [446.162, 398.329, 568.281, 13.050, [[446.162, 542.662, 'Thrown Accuracy Boost'],
          [550.381, 568.281, 'Mid']]]]],
      [333.600, 388.042, [[333.600, 388.042, 411.856, 20.880, 'Wild Cards']]],
      [333.600, 414.492, [
        [333.600, 414.492, 569.880, 14.355, 'Magical playing cards, hidden within a standard deck.']]],
      [357.600, 433.167, [
        [357.600, 433.167, 566.950, 13.050, 'May be Teleported anywhere within the deck or into'],
        [357.600, 443.167, 454.140, 13.050, 'the owner’s hand at will.']]],
      [412.965, 492.607, [[412.965, 492.607, 487.035, 11.745, 'Default Enchantment']]],
      [331.200, 506.562, [[331.200, 506.562, 369.432, 11.745, '52 Pickup']]],
      [376.800, 506.598, [
        [424.800, 506.598, 567.819, 11.745, 'Throw the entire deck in a wide flurry to'],
        [376.800, 524.598, 470.859, 11.745, 'remaining mundane cards.']]],
    ]));
    expect(wildCards.meters).toEqual([
      { label: 'Quantity', value: '4x' },
      { label: 'Thrown Accuracy Boost', value: 'Mid' },
    ]);
  });

  test('three meter rows stay three, each with its own label', () => {
    // p38 right, Barded Destrier: rows at name.yMin -3.71, +10.29 and +24.29,
    // 14.00 apart. Widening the row band to swallow a wrapped label would give
    // the first value all three labels; and the third row sits 1.26 pt ABOVE
    // this entry's own item description, so no y band separates them either.
    const [destrier] = signatureEntries(pageAt(38, [
      [322.080, 481.145, [[322.080, 481.145, 431.104, 20.880, 'Barded Destrier']]],
      [446.202, 477.432, [
        [453.992, 477.432, 513.132, 13.050, 'Strength Boost'],
        [446.202, 491.432, 513.132, 13.050, 'Toughness Boost'],
        [453.712, 505.432, 513.132, 13.050, 'Armor Quality']]],
      [529.491, 477.432, [
        [529.491, 477.432, 548.121, 13.050, 'Low'],
        [529.491, 491.432, 548.121, 13.050, 'Low'],
        [529.856, 505.432, 547.756, 13.050, 'Mid']]],
      [322.080, 506.695, [
        [322.080, 506.695, 397.397, 14.355, 'Fierce, courageous'],
        [322.080, 517.695, 495.000, 14.355, 'warhorse, armored across its entire body.']]],
      [341.280, 535.670, [
        [341.280, 535.670, 546.670, 13.050, 'Strength and toughness Boosts are improved to Mid'],
        [341.280, 545.670, 512.680, 13.050, 'along with speed while charging into battle.']]],
      [401.445, 561.505, [[401.445, 561.505, 475.515, 11.745, 'Default Enchantment']]],
      [319.680, 575.459, [[319.680, 575.459, 353.556, 11.745, 'Logistica']]],
      [365.280, 575.459, [
        [413.280, 575.459, 549.621, 11.745, 'While charging into battle, this horse’s'],
        [365.280, 593.459, 525.714, 11.745, 'Mid Range to shake, barely perceptible at the']]],
    ]));
    expect(destrier.meters).toEqual([
      { label: 'Strength Boost', value: 'Low' },
      { label: 'Toughness Boost', value: 'Low' },
      { label: 'Armor Quality', value: 'Mid' },
    ]);
    expect(destrier.description).toBe(
      'Fierce, courageous warhorse, armored across its entire body.');
  });

  test('a meter label that wraps keeps the value centred between its lines', () => {
    // p44 left, Thunder Hammer. pdftotext puts `Durability` and the value
    // `High+` on one line with a 7.64 gap between them -- wide enough to read
    // as two cells, where the words of a label are 2.13 apart -- and wraps
    // `Boost` onto the next. The value's own baseline (297.80) belongs to
    // neither label line; it sits 5.00 from each.
    const [thunderHammer] = signatureEntries(pageAt(44, [
      [203.170, 292.804, [
        [203.170, 292.804, 280.360, 18.050, [[203.170, 244.800, 'Durability'],
          [252.400, 280.360, 'High+', 297.804, 13.050]]],
        [222.120, 302.804, 244.800, 13.050, 'Boost']]],
      [45.600, 292.317, [[45.600, 292.317, 169.920, 20.880, 'Thunder Hammer']]],
      [45.600, 318.767, [
        [45.600, 318.767, 229.366, 14.355, 'Ceremonial warhammer, heavy for its size.']]],
      [64.800, 337.442, [
        [64.800, 337.442, 282.870, 13.050, 'The owner may briefly hold this hammer aloft to infuse'],
        [64.800, 347.442, 259.720, 13.050, 'their next immediate strike with notable electrical']]],
      [124.965, 372.877, [[124.965, 372.877, 199.035, 11.745, 'Default Enchantment']]],
      [43.200, 386.831, [[43.200, 386.831, 127.215, 11.745, 'Smasher of Thousands']]],
      [40.800, 386.831, [
        [136.800, 386.831, 265.131, 11.745, 'Purposefully hurl this hammer at an'],
        [40.800, 404.831, 268.572, 11.745, 'Low Duration, hovering around the target and fiercely battering']]],
    ]));
    expect(thunderHammer.meters).toEqual([{ label: 'Durability Boost', value: 'High+' }]);
    expect(thunderHammer.name).toBe('Thunder Hammer');
  });

  test('right-ragged labels are not clustered by their left edge', () => {
    // p27 left, Magician's Wand: labels at 180.52 and 216.53, 36 pt apart, one
    // above the other, each with its value on its own line. Reading the rows
    // together makes `Range` look like a value; reading a row with too wide a
    // band gives the first value both labels.
    const [wand] = signatureEntries(pageAt(27, [
      [57.120, 325.168, [[57.120, 325.168, 166.160, 20.880, 'Magician’s Wand']]],
      [180.521, 321.055, [
        [180.521, 321.055, 292.236, 13.050, [[180.521, 241.930, 'Essence Burden'],
          [249.210, 292.236, 'Low–Mid']]],
        [216.531, 335.455, 292.236, 13.050, [[216.531, 241.930, 'Range'],
          [249.210, 292.236, 'Low–Mid']]]]],
      [57.120, 350.918, [
        [57.120, 350.918, 294.016, 14.355, 'Small, polished wand producing shimmering ribbons of']]],
      [81.120, 379.893, [
        [81.120, 379.893, 280.600, 13.050, 'Range scales and Essence Burden inversely scales on'],
        [81.120, 389.893, 267.850, 13.050, 'how much attention the owner currently holds.']]],
      [136.485, 429.728, [[136.485, 429.728, 210.555, 11.745, 'Default Enchantment']]],
      [54.720, 443.682, [[54.720, 443.682, 116.010, 11.745, 'Tontus Talontus']]],
      [52.320, 443.682, [
        [148.320, 443.682, 285.543, 11.745, 'Speaking complex magical words while'],
        [52.320, 461.682, 270.300, 11.745, 'non-allies who hear them, ending only after that magic is cast.']]],
    ]));
    expect(wand.meters).toEqual([
      { label: 'Essence Burden', value: 'Low–Mid' },
      { label: 'Range', value: 'Low–Mid' },
    ]);
  });

  test('the signature name is told from its description by 2.40 pt', () => {
    // p50 right, Nostrum: the name sits at colLeft - 2.40 (319.68) and the
    // description's full-width lines at colLeft - 4.80 (317.28), and here
    // pdftotext emits the description FIRST, so anything looser than 2.40
    // takes the paragraph for the name and the name for the paragraph.
    const [nostrum] = signatureEntries(pageAt(50, [
      [322.080, 268.768, [[322.080, 268.768, 383.600, 20.880, 'Nostrum']]],
      [481.680, 279.055, [[481.680, 279.055, 499.680, 13.050, 'Uses']]],
      [526.775, 279.055, [[526.775, 279.055, 537.385, 13.050, '3x']]],
      [322.080, 295.218, [
        [322.080, 295.218, 481.558, 14.355, 'Unmarked bottle of suspicious liquid.']]],
      [341.280, 313.893, [
        [341.280, 313.893, 558.963, 13.050, 'Heals L the drinker and Cures M their physical maladies,'],
        [341.280, 323.893, 544.570, 13.050, 'but the owner must Pitch a negative side-effect that']]],
      [401.445, 349.327, [[401.445, 349.327, 475.515, 11.745, 'Default Enchantment']]],
      [317.280, 363.282, [
        [413.280, 363.282, 533.115, 11.745, 'Warning another being about this'],
        [317.280, 381.282, 558.696, 11.745, 'wanting to drink it more. If they then do so, the Pitched downside is']]],
      [319.680, 363.282, [[319.680, 363.282, 395.820, 11.745, 'Drink At Own Peril']]],
    ]));
    expect(nostrum.default_enchantment.name).toBe('Drink At Own Peril');
    expect(nostrum.default_enchantment.description).toBe(
      'Warning another being about this wanting to drink it more. If they then do'
      + ' so, the Pitched downside is');
  });

  // p33 left, Coffee Cup. pdftotext splits `Grants a Ward <0-M> against those`
  // into two fragments at y 440.08 and drops the superscript between them at
  // y 440.86 -- 0.78 BELOW both. The cell's text is the only thing these two
  // tests vary, and it decides which mechanism puts it back in reading order.
  const coffeeCupWith = (detached) => signatureEntries(pageAt(33, [
    [57.120, 315.568, [[57.120, 315.568, 133.456, 20.880, 'Coffee Cup']]],
    [182.594, 325.855, [[182.594, 325.855, 261.414, 13.050, 'Full Refill Duration']]],
    [271.517, 325.855, [[271.517, 325.855, 289.417, 13.050, 'Mid']]],
    [81.120, 341.493, [
      [81.120, 341.493, 215.670, 13.050, 'Gradually refills of its own accord.'],
      [81.120, 355.820, 278.142, 13.050, 'Galvanizes L–H the drinker either towards alertness'],
      [100.320, 390.147, 280.020, 13.050, 'Anyone the owner interacts with while in this']]],
    [136.485, 426.127, [[136.485, 426.127, 210.555, 11.745, 'Default Enchantment']]],
    [54.720, 440.082, [
      [54.720, 440.082, 113.247, 11.745, 'Good Morning,'],
      [61.920, 449.082, 96.192, 11.745, 'Sunshine']]],
    [100.320, 440.082, [
      [148.320, 440.082, 201.438, 11.745, 'Grants a Ward'],
      [215.717, 440.082, 261.365, 11.745, 'against those'],
      [148.320, 449.082, 281.547, 11.745, 'dispositionally opposite to the owner’s'],
      [148.320, 458.082, 278.379, 11.745, 'current coffee-induced Altered State,'],
      [100.320, 467.082, 279.384, 11.745, 'scaling as above on your effective portrayal thereof.']]],
    [202.724, 440.864, [[202.724, 440.864, 213.800, 6.847, detached]]],
  ]))[0];

  const coffeeCupTail = ' dispositionally opposite to the owner’s current'
    + ' coffee-induced Altered State, scaling as above on your effective'
    + ' portrayal thereof.';

  test('a rating dropped between two fragments of its host reads in place', () => {
    // 0–M is one of the known strings, so re-threading claims the cell and the
    // merge orders the three fragments by x.
    const coffeeCup = coffeeCupWith('0–M');
    expect(coffeeCup.default_enchantment.name).toBe('Good Morning, Sunshine');
    expect(coffeeCup.default_enchantment.description)
      .toBe(`Grants a Ward <sup>0–M</sup> against those${coffeeCupTail}`);
  });

  test('a superscript the rating set does not hold reads in place too', () => {
    // The same cell carrying a token no rating rule claims: `(L–M–H)`, which
    // the book prints on p17 as the notation gloss, at superscript height
    // inside a body line. Re-threading leaves a cell like this where it is, so
    // nothing but joinLines' banding puts it back in order -- the cell's yMin
    // sits below both fragments of its host, and a plain yMin sort reads it
    // after `against those`.
    //
    // The book prints no such cell today: every detached one is a known
    // rating. That is what this test stands in for, and it is why the
    // combination is assembled rather than lifted from a page.
    expect(coffeeCupWith('(L–M–H)').default_enchantment.description)
      .toBe(`Grants a Ward (L–M–H) against those${coffeeCupTail}`);
  });

  test('an entry that starts above the running-header band is not dropped', () => {
    // Blank Check, Samaritan p75, right column: yMin 40.77. A `yMin > 60`
    // filter loses eight entries book-wide.
    const [blankCheck] = signatureEntries(pageAt(75, [
      [333.600, 40.768, [[333.600, 40.768, 420.400, 20.880, 'Blank Check']]],
      [504.030, 51.055, [[504.030, 51.055, 522.030, 13.050, 'Uses']]],
      [543.710, 51.055, [[543.710, 51.055, 554.320, 13.050, '1x']]],
      [333.600, 67.218, [[333.600, 67.218, 431.940, 14.355, 'Signed promissory note.']]],
      [357.600, 85.893, [
        [357.600, 85.893, 550.340, 13.050, 'Give this check to a non-agent to let them make a'],
        [357.600, 95.893, 509.662, 13.050, 'Wish L–H that immediately comes true.'],
        [376.800, 110.220, 567.660, 13.050, 'The source character incurs heavy costs scaling on']]],
      [412.965, 240.128, [[412.965, 240.128, 487.035, 11.745, 'Default Enchantment']]],
      [331.200, 254.082, [[331.200, 254.082, 380.421, 11.745, 'Angel Donor']]],
      [328.800, 254.082, [
        [424.800, 254.082, 570.330, 11.745, 'After establishing substantial rapport M–H'],
        [328.800, 272.082, 568.802, 11.745, 'used to Conjure a similarly substantial amount M–H of local currency']]],
    ]));
    expect(blankCheck.name).toBe('Blank Check');
    expect(blankCheck.description).toBe('Signed promissory note.');
    expect(blankCheck.meters).toEqual([{ label: 'Uses', value: '1x' }]);
    expect(blankCheck.notes).toEqual([
      { text: 'Give this check to a non-agent to let them make a Wish L–H that immediately comes true.',
        children: [
          { text: 'The source character incurs heavy costs scaling on', children: [] }] }]);
  });
});


const { abilityEntries } = require('./aspirant-extract');

// The fixtures below are whole ability pages lifted from `pdftotext
// -bbox-layout` over the real book. A whole page is the smallest fixture that
// exists here: abilityEntries refuses a page that does not carry exactly three
// "Paired Action:" labels, and the traps this page kind sets -- a frame shifted
// 10.56 pt, a dedication 10.02 below its perk name, a paired-action line 4.49
// above its own label -- are all a few points wide.
// PDF page 19, Gunslinger core, recto. Every block that carries content, in
// pdftotext's own emission order, which is not y-order.
const P19 = [
  [271.371, 23.233, [
    [271.371, 23.233, 352.141, 15.630, 'Gunslinger']]],
  [177.600, 112.028, [
    [177.600, 112.028, 407.940, 14.355, 'Bounce a projectile off a surface; it remains intact and'],
    [177.600, 123.028, 275.599, 14.355, 'retains its momentum.']]],
  [74.368, 114.873, [
    [74.368, 114.873, 141.152, 20.880, 'Trickshot']]],
  [72.300, 147.415, [
    [72.300, 147.415, 127.920, 11.745, 'Paired Action:']]],
  [460.530, 110.760, [
    [460.530, 110.760, 511.200, 13.050, 'Essence Cost'],
    [469.290, 125.160, 511.200, 13.050, 'Cooldown']]],
  [534.285, 110.760, [
    [534.285, 110.760, 552.915, 13.050, 'Low'],
    [534.285, 125.160, 552.915, 13.050, 'Low']]],
  [142.320, 142.922, [
    [142.320, 142.922, 479.514, 11.745, 'Perform a stylish flourish with the weapon or projectile being used, Pitching how the shot'],
    [142.320, 151.922, 244.829, 11.745, [[142.320, 178.113, 'Redirects'], [179.357, 183.449, 'H', 152.704, 6.847], [185.582, 244.829, 'after bouncing.']]]]],
  [95.520, 169.598, [
    [95.520, 169.598, 564.340, 13.050, [[95.520, 344.880, 'The user may choose for the projectile to inflict significantly less'], [346.122, 350.780, 'H', 170.467, 7.608], [352.910, 564.340, 'damage upon the surface it bounces off, though doing']]],
    [95.520, 179.598, 276.870, 13.050, 'so will increase Trickshot’s Cooldown to Mid.']]],
  [289.305, 195.421, [
    [289.305, 195.421, 334.215, 11.745, 'Sample Perks']]],
  [68.165, 209.376, [
    [68.165, 209.376, 147.356, 11.745, 'Smoke Off the Barrel']]],
  [89.274, 226.176, [
    [89.274, 226.176, 126.246, 11.745, 'Waco Kid']]],
  [172.800, 226.603, [
    [172.800, 226.603, 521.695, 11.745, [[172.800, 205.875, 'Improves'], [206.993, 211.825, 'M', 227.385, 6.847], [213.742, 521.695, 'user’s hand speed while drawing a weapon for this Ability and during its Paired Action.']]]]],
  [121.462, 243.078, [
    [121.462, 243.078, 172.132, 11.745, '(Compounded)']]],
  [193.462, 243.103, [
    [193.462, 243.103, 550.592, 11.745, [[193.462, 226.537, 'Improves'], [227.655, 232.487, 'M', 243.885, 6.847], [234.404, 550.592, 'user’s hand speed while drawing a weapon for this Ability and during its Paired Action. A']]],
    [193.462, 252.103, 514.069, 11.745, 'weapon used for this Ability may be Teleported back to its sheath immediately afterwards.']]],
  [177.600, 311.217, [
    [177.600, 311.217, 434.314, 14.355, [[177.600, 391.176, 'Hold one or more targets\' attention, Compelling'], [392.747, 397.871, 'H', 312.173, 8.369], [400.214, 434.314, 'them to']]],
    [177.600, 322.217, 274.818, 14.355, 'neither attack nor flee.']]],
  [78.640, 314.062, [
    [78.640, 314.062, 136.880, 20.880, 'Standoff']]],
  [72.300, 346.603, [
    [72.300, 346.603, 127.920, 11.745, 'Paired Action:']]],
  [172.800, 209.803, [
    [172.800, 209.803, 507.519, 11.745, 'Jauntily blowing smoke from the gun right after using this Ability will refund its Essence Cost.']]],
  [142.320, 342.110, [
    [142.320, 342.110, 418.134, 11.745, 'Catch your targets’ attention while behaving disproportionately cool and'],
    [142.320, 351.110, 415.569, 11.745, 'unruffled. You must continue to do so or Standoff will end prematurely.']]],
  [454.460, 309.949, [
    [460.530, 309.949, 511.200, 13.050, 'Essence Cost'],
    [454.460, 324.349, 511.200, 13.050, 'Max Duration'],
    [469.290, 338.749, 511.200, 13.050, 'Cooldown']]],
  [534.650, 309.949, [
    [534.650, 309.949, 552.550, 13.050, 'Mid'],
    [534.650, 324.349, 552.550, 13.050, 'Mid'],
    [534.650, 338.749, 552.550, 13.050, 'Mid']]],
  [95.520, 368.787, [
    [95.520, 368.787, 570.030, 13.050, 'If targets put together pose a greater threat to the user than the user does to them, Standoff’s Duration is proportionately'],
    [95.520, 378.787, 212.820, 13.050, 'reduced (no lower than Low).'],
    [95.520, 393.114, 389.760, 13.050, 'If the user or targets are attacked in any way, Standoff will end prematurely.'],
    [95.520, 407.441, 431.498, 13.050, [[95.520, 372.260, 'The first few attacks made by targets after this Ability ends are notably'], [373.688, 379.058, 'M', 408.310, 7.608], [381.188, 431.498, 'less accurate.']]]]],
  [289.305, 423.421, [
    [289.305, 423.421, 334.215, 11.745, 'Sample Perks']]],
  [78.537, 437.376, [
    [78.537, 437.376, 136.983, 11.745, 'One Bullet Left']]],
  [172.800, 437.503, [
    [172.800, 437.503, 553.722, 11.745, [[172.800, 333.270, 'Once per use, may make a greatly empowered'], [334.556, 338.748, 'H', 438.285, 6.847], [340.665, 553.722, 'Deduction to confirm how much ammunition (or similar) a']]],
    [172.800, 446.503, 277.272, 11.745, 'specific enemy has remaining.']]],
  [89.553, 462.576, [
    [89.553, 462.576, 125.967, 11.745, 'True Grit']]],
  [172.800, 463.003, [
    [172.800, 463.003, 552.129, 11.745, [[172.800, 243.603, 'Substantially boosts'], [244.889, 249.081, 'H', 463.785, 6.847], [250.998, 552.129, 'physical toughness against the first few attacks made by targets after this Ability ends.']]]]],
  [121.462, 479.478, [
    [121.462, 479.478, 172.132, 11.745, '(Compounded)']]],
  [177.600, 551.017, [
    [177.600, 551.017, 423.043, 14.355, 'Teleport one of your sheathed weapons into your hands;'],
    [177.600, 562.017, 414.771, 14.355, 'while this Ability lasts, your weapons are automatically'],
    [177.600, 573.017, 343.018, 14.355, 'reloaded with Conjured ammunition.']]],
  [76.512, 555.622, [
    [76.512, 555.622, 139.008, 20.880, 'Shootout']]],
  [72.300, 591.403, [
    [72.300, 591.403, 127.920, 11.745, 'Paired Action:']]],
  [193.462, 479.503, [
    [193.462, 479.503, 552.550, 11.745, [[193.462, 264.265, 'Substantially boosts'], [265.551, 269.743, 'H', 480.285, 6.847], [271.660, 552.550, 'physical toughness against the first few attacks made by targets after this Ability']]],
    [193.462, 488.503, 417.974, 11.745, [[193.462, 316.789, 'ends. Those targets are Compelled'], [318.075, 322.907, 'M', 489.285, 6.847], [324.824, 417.974, 'to aim such attacks at you.']]]]],
  [460.530, 546.349, [
    [460.530, 546.349, 511.200, 13.050, 'Essence Cost'],
    [474.150, 560.749, 511.200, 13.050, 'Duration'],
    [469.290, 575.149, 511.200, 13.050, 'Cooldown']]],
  [534.285, 546.349, [
    [534.650, 546.349, 552.550, 13.050, 'Mid'],
    [534.285, 560.749, 552.915, 13.050, 'Low'],
    [534.650, 575.149, 552.550, 13.050, 'Mid']]],
  [142.320, 591.410, [
    [142.320, 591.410, 424.056, 11.745, 'A few seconds of focused stillness broken by a sudden arm/hand movement.']]],
  [95.520, 607.587, [
    [95.520, 607.587, 333.290, 13.050, 'Teleporting a weapon is optional if the user is already armed.'],
    [95.520, 621.914, 527.720, 13.050, 'Ammunition Conjuring applies to all of the user’s weapons, not just the one they first Teleport to their hands.']]],
  [289.305, 637.021, [
    [289.305, 637.021, 334.215, 11.745, 'Sample Perks']]],
  [78.172, 650.976, [
    [78.172, 650.976, 137.347, 11.745, 'Double Trouble']]],
  [113.496, 660.997, [
    [113.496, 660.997, 163.200, 7.830, 'In Honor of Caroline']]],
  [85.269, 676.176, [
    [85.269, 676.176, 130.251, 11.745, 'Wild Butler']]],
  [121.462, 693.078, [
    [121.462, 693.078, 172.132, 11.745, '(Compounded)']]],
  [172.800, 655.618, [
    [172.800, 655.618, 435.168, 11.745, 'This Ability may Teleport up to two sheathed weapons to the user\'s hands.']]],
  [172.800, 676.603, [
    [172.800, 676.603, 499.266, 11.745, 'Kills made during this Ability will extend its Duration (up to Mid after ten typical enemies).']]],
  [193.462, 693.104, [
    [193.462, 693.104, 565.612, 11.745, 'Kills made during this Ability will extend its Duration (up to Mid after ten typical enemies). Further kills'],
    [193.462, 702.104, 392.299, 11.745, 'will reduce its Cooldown (down to Low after ten more).']]],
  [304.818, 764.837, [
    [304.818, 764.837, 319.182, 18.270, '14']]]
];

// PDF page 22, Gunslinger advanced, verso. Every block that carries content, in
// pdftotext's own emission order, which is not y-order.
const P22 = [
  [259.851, 23.233, [
    [259.851, 23.233, 340.621, 15.630, 'Gunslinger']]],
  [57.840, 117.568, [
    [57.840, 117.568, 134.640, 20.880, [[57.840, 92.848, 'High'], [96.768, 134.640, 'Noon']]]]],
  [60.780, 144.110, [
    [60.780, 144.110, 116.400, 11.745, 'Paired Action:']]],
  [166.080, 114.723, [
    [166.080, 114.723, 412.755, 14.355, 'Pitch a combat action made by an enemy under pressure,'],
    [166.080, 125.723, 321.176, 14.355, [[166.080, 311.885, 'including how that action Fizzles'], [313.456, 318.580, 'H', 126.679, 8.369], [318.580, 321.176, '.']]]]],
  [449.010, 113.455, [
    [449.010, 113.455, 499.680, 13.050, 'Essence Cost'],
    [523.130, 113.455, 541.030, 13.050, 'Mid'],
    [457.770, 127.855, 555.585, 13.050, [[457.770, 499.680, 'Cooldown'], [508.575, 555.585, 'Low–High']]]]],
  [130.800, 144.116, [
    [130.800, 144.116, 449.931, 11.745, 'Make the target feel tense, cornered, desperate, or similar without overtly aggressing.']]],
  [84.000, 160.293, [
    [84.000, 160.293, 518.210, 13.050, 'The more prolonged the Paired Action (up to a Mid Duration), the shorter this Ability’s Cooldown once used.'],
    [84.000, 174.620, 488.715, 13.050, [[84.000, 153.680, 'May affect a small'], [155.108, 158.525, 'L', 175.489, 7.608], [160.655, 488.715, 'group of targets so long as your Paired Action believably applies to the entire group.']]]]],
  [277.785, 189.728, [
    [277.785, 189.728, 322.695, 11.745, 'Sample Perks']]],
  [67.638, 203.682, [
    [67.638, 203.682, 124.842, 11.745, 'Ecstasy of Gold']]],
  [161.280, 204.110, [
    [161.280, 204.110, 507.510, 11.745, 'Untraceable music Pitched by the user will play as this Ability\'s Paired Action is being performed.']]],
  [63.192, 220.482, [
    [63.192, 220.482, 129.288, 11.745, 'Ain’t Big Enough']]],
  [161.280, 220.610, [
    [161.280, 220.610, 558.693, 11.745, 'High Noon also locks the target into a Duel to first blood with the user, with max Duration proportional to that'],
    [161.280, 229.610, 235.017, 11.745, 'of the Paired Action.']]],
  [109.942, 245.784, [
    [109.942, 245.784, 160.612, 11.745, '(Compounded)']]],
  [51.712, 307.168, [
    [51.712, 307.168, 140.768, 20.880, [[51.712, 86.256, 'Stick'], [90.176, 116.224, '‘Em'], [120.144, 140.768, 'Up']]]]],
  [60.780, 339.710, [
    [60.780, 339.710, 116.400, 11.745, 'Paired Action:']]],
  [181.942, 245.810, [
    [181.942, 245.810, 553.498, 11.745, 'High Noon also locks the target into a Duel to first blood with the user, with max Duration proportional'],
    [181.942, 254.810, 422.708, 11.745, [[181.942, 331.639, 'to the Paired Action. Winning Galvanizes'], [332.925, 337.757, 'M', 255.592, 6.847], [339.674, 422.708, 'spectators towards awe.']]]]],
  [166.080, 304.323, [
    [166.080, 304.323, 421.949, 14.355, [[166.080, 202.413, 'Compel'], [203.984, 209.891, 'M', 305.279, 8.369], [212.234, 421.949, 'an off-guard target at gunpoint to comply with a']]],
    [166.080, 315.323, 287.630, 14.355, 'handful of basic commands.']]],
  [130.800, 335.216, [
    [130.800, 335.216, 410.808, 11.745, 'Calmly keep a weapon aimed at the target. Must continue to do so or Stick'],
    [130.800, 344.216, 243.309, 11.745, '‘Em Up will end prematurely.']]],
  [443.225, 303.055, [
    [458.215, 303.055, 508.885, 13.050, 'Essence Cost'],
    [443.225, 317.455, 508.885, 13.050, 'Max Commands'],
    [452.145, 331.855, 508.885, 13.050, 'Max Duration'],
    [466.975, 346.255, 508.885, 13.050, 'Cooldown']]],
  [527.368, 303.055, [
    [527.733, 303.055, 545.633, 13.050, 'Mid'],
    [531.378, 317.455, 541.988, 13.050, '3x'],
    [527.733, 331.855, 545.633, 13.050, 'Mid'],
    [527.368, 346.255, 545.998, 13.050, 'Low']]],
  [84.000, 361.893, [
    [84.000, 361.893, 506.550, 13.050, 'Commands should be straightforward but can be continuous. (e.g. “Walk in front of me with your hands up.”)'],
    [103.200, 376.220, 537.870, 13.050, 'The more commands the user issues, especially complex ones, the more likely this Ability is to end prematurely.'],
    [103.200, 390.547, 551.350, 13.050, 'Commands may include questions, which the target is compelled to answer truthfully. (e.g. “What’s the password?”)'],
    [84.000, 404.875, 490.030, 13.050, 'If the user kills their target during or immediately after Stick ‘Em Up ends, its Cooldown is set to High.']]],
  [277.785, 420.128, [
    [277.785, 420.128, 322.695, 11.745, 'Sample Perks']]],
  [76.445, 434.082, [
    [76.445, 434.082, 116.035, 11.745, 'Dry Gulch']]],
  [161.280, 434.510, [
    [161.280, 434.510, 539.388, 11.745, 'Taking an enemy by surprise with Stick ‘Em Up will Disarm a single weapon they currently have equipped.']]],
  [75.977, 450.882, [
    [75.977, 450.882, 116.504, 11.745, 'Angel Eyes']]],
  [161.280, 451.310, [
    [161.280, 451.310, 539.541, 11.745, 'This Ability may be activated and maintained by staring at the target instead of pointing a weapon at them.']]],
  [109.942, 467.784, [
    [109.942, 467.784, 160.612, 11.745, '(Compounded)']]],
  [69.496, 529.168, [
    [69.496, 529.168, 122.984, 20.880, 'Surefire']]],
  [60.780, 555.710, [
    [60.780, 555.710, 116.400, 11.745, 'Paired Action:']]],
  [181.942, 467.810, [
    [181.942, 467.810, 537.676, 11.745, 'This Ability may be activated and maintained by staring at the target instead of pointing a weapon at'],
    [181.942, 476.810, 397.157, 11.745, [[181.942, 250.171, 'them, Galvanizing'], [251.457, 256.289, 'M', 477.592, 6.847], [258.206, 397.157, 'them towards lingering fear of the user.']]]]],
  [166.080, 530.123, [
    [166.080, 530.123, 381.713, 14.355, 'A perfect shot that can only be aimed at an object.']]],
  [449.010, 525.055, [
    [449.010, 525.055, 499.680, 13.050, 'Essence Cost'],
    [457.770, 539.455, 499.680, 13.050, 'Cooldown']]],
  [510.565, 525.055, [
    [510.565, 525.055, 553.595, 13.050, 'Low–Mid'],
    [522.765, 539.455, 541.395, 13.050, 'Low']]],
  [130.800, 555.716, [
    [130.800, 555.716, 338.772, 11.745, 'Say a clever one-line quip immediately before shooting.']]],
  [84.000, 571.893, [
    [84.000, 571.893, 309.377, 13.050, [[84.000, 141.500, 'Greatly Boosts'], [142.928, 147.587, 'H', 572.762, 7.608], [149.717, 309.377, 'user’s accuracy and that of their weapon.']]],
    [103.200, 586.220, 464.377, 13.050, [[103.200, 423.940, 'If the targeted object is moving (no matter how fast), Surefire’s shot will Redirect'], [425.368, 430.027, 'H', 587.089, 7.608], [432.157, 464.377, 'to hit it.']]],
    [84.000, 600.547, 557.170, 13.050, 'Will somehow completely spare those in close proximity to the targeted object. (e.g. Shooting a teacup out of someone’s hand'],
    [84.000, 610.547, 234.850, 13.050, 'wouldn’t even leave them with a scratch.)'],
    [84.000, 624.875, 538.250, 13.050, 'Essence Cost scales on the improbability of the shot. (e.g. Shooting a cigarette out of someone’s mouth from across a room'],
    [84.000, 634.875, 383.970, 13.050, 'would have a Low Cost; doing so from a city block away would have a Mid Cost.)']]],
  [277.785, 650.528, [
    [277.785, 650.528, 322.695, 11.745, 'Sample Perks']]],
  [66.603, 664.482, [
    [66.603, 664.482, 125.877, 11.745, 'Wings Off a Fly']]],
  [66.868, 681.282, [
    [66.868, 681.282, 125.612, 11.745, 'Hexbuster Shot']]],
  [110.466, 691.303, [
    [110.466, 691.303, 151.680, 7.830, 'In Honor of Crow']]],
  [109.942, 706.584, [
    [109.942, 706.584, 160.612, 11.745, '(Compounded)']]],
  [161.280, 664.910, [
    [161.280, 664.910, 346.140, 11.745, 'Surefire may target bugs and similarly tiny creatures.']]],
  [161.280, 685.909, [
    [161.280, 685.909, 398.677, 11.745, [[161.280, 335.727, 'Surefire may target visible magic, its shot Stifling'], [337.013, 340.087, 'L', 686.692, 6.847], [342.004, 398.677, 'whatever it hits.']]]]],
  [181.942, 706.909, [
    [181.942, 706.909, 421.097, 11.745, [[181.942, 356.389, 'Surefire may target visible magic, its shot Stifling'], [357.675, 362.507, 'M', 707.692, 6.847], [364.424, 421.097, 'whatever it hits.']]]]],
  [292.818, 764.837, [
    [292.818, 764.837, 307.182, 18.270, '17']]]
];

// PDF page 28, Illusionist advanced, verso -- two-line ability names. Every block that carries content, in
// pdftotext's own emission order, which is not y-order.
const P28 = [
  [264.477, 23.233, [
    [264.477, 23.233, 335.998, 15.630, 'Illusionist']]],
  [47.545, 105.568, [
    [47.545, 105.568, 150.713, 20.880, [[47.545, 96.873, 'Private'], [100.793, 150.713, 'Reality']]]]],
  [60.780, 136.309, [
    [60.780, 136.309, 116.400, 11.745, 'Paired Action:']]],
  [171.859, 102.723, [
    [171.859, 102.723, 414.409, 14.355, 'Take full control of a single target’s perception, affecting'],
    [171.859, 113.723, 388.218, 14.355, 'every way they experience the world around them.']]],
  [130.800, 131.816, [
    [130.800, 131.816, 424.846, 11.745, [[130.800, 196.428, 'Hold a prolonged'], [197.714, 200.747, 'L', 132.598, 6.847], [202.879, 424.846, 'conversation with the target. You must continue to do so or']]],
    [130.800, 140.816, 273.810, 11.745, 'Private Reality will end prematurely.']]],
  [442.940, 101.455, [
    [449.010, 101.455, 499.680, 13.050, 'Essence Cost'],
    [442.940, 115.855, 499.680, 13.050, 'Max Duration'],
    [457.770, 130.255, 499.680, 13.050, 'Cooldown']]],
  [521.140, 101.455, [
    [521.140, 101.455, 543.020, 13.050, 'High'],
    [521.140, 115.855, 543.020, 13.050, 'High'],
    [523.130, 130.255, 541.030, 13.050, 'Mid']]],
  [84.000, 156.693, [
    [84.000, 156.693, 531.567, 13.050, [[84.000, 485.830, 'Can affect all five senses, creating extremely believable and immersive illusions. Only a major disruption'], [487.258, 491.917, 'H', 157.562, 7.608], [494.047, 531.567, 'can break']]],
    [84.000, 166.693, 384.380, 13.050, 'through these illusions; if this happens, Private Reality will end prematurely.']]],
  [277.785, 182.528, [
    [277.785, 182.528, 322.695, 11.745, 'Sample Perks']]],
  [71.850, 196.482, [
    [71.850, 196.482, 120.630, 11.745, 'Pay No Heed']]],
  [161.280, 196.910, [
    [161.280, 196.910, 499.473, 11.745, 'If you can find a way to explain away a major disruption, it will not end the Ability prematurely.']]],
  [72.133, 213.282, [
    [72.133, 213.282, 120.347, 11.745, 'Hyperreality']]],
  [161.280, 213.410, [
    [161.280, 213.410, 487.935, 11.745, 'An established Private Reality may gradually affect a second target who is seamlessly brought'],
    [161.280, 222.410, 238.203, 11.745, 'into the conversation.']]],
  [109.942, 238.584, [
    [109.942, 238.584, 160.612, 11.745, '(Compounded)']]],
  [58.680, 287.968, [
    [58.680, 287.968, 133.800, 20.880, [[58.680, 107.800, 'Behind'], [111.720, 133.800, 'the']]],
    [69.064, 303.968, 123.416, 20.880, 'Curtain']]],
  [60.780, 334.910, [
    [60.780, 334.910, 116.400, 11.745, 'Paired Action:']]],
  [181.942, 238.610, [
    [181.942, 238.610, 554.992, 11.745, [[181.942, 442.096, 'An established Private Reality may gradually affect additional targets who'], [445.930, 554.992, 'are seamlessly brought into the']]],
    [181.942, 247.610, 276.100, 11.745, 'conversation one at a time.']]],
  [166.080, 288.523, [
    [166.080, 288.523, 424.404, 14.355, 'While you remain hidden, your other Abilities have reduced'],
    [166.080, 299.523, 411.919, 14.355, 'Costs and Cooldowns and may be Transmitted through'],
    [166.080, 310.523, 294.263, 14.355, 'lingering magic you have cast.']]],
  [452.145, 284.183, [
    [458.215, 284.183, 508.885, 13.050, 'Essence Cost'],
    [452.145, 298.583, 508.885, 13.050, 'Max Duration'],
    [466.975, 312.983, 508.885, 13.050, 'Cooldown']]],
  [525.743, 284.183, [
    [525.743, 284.183, 547.623, 13.050, 'High'],
    [527.733, 298.583, 545.633, 13.050, 'Mid'],
    [527.733, 312.983, 545.633, 13.050, 'Mid']]],
  [130.800, 330.416, [
    [130.800, 330.416, 505.344, 11.745, 'Completely conceal yourself from everyone, both allies and non-allies. You must continue to do so or'],
    [130.800, 339.416, 289.659, 11.745, 'Behind the Curtain will end prematurely.']]],
  [84.000, 357.093, [
    [84.000, 357.093, 509.120, 13.050, 'Other Abilities’ Costs and Cooldowns are decreased by one Power Rating; if Low, they are negated outright.'],
    [103.200, 371.420, 559.679, 13.050, [[103.200, 123.390, 'Note'], [126.872, 143.012, 'that'], [146.494, 159.154, 'the'], [162.636, 185.166, 'above'], [188.648, 219.458, 'benefits'], [222.941, 238.721, 'only'], [242.203, 263.833, 'apply'], [267.315, 275.645, 'to'], [279.127, 314.917, 'Abilities,'], [318.399, 347.279, 'though'], [350.761, 364.591, 'any'], [368.073, 391.373, 'magic'], [394.855, 409.495, 'you'], [412.977, 430.527, 'have'], [434.009, 448.779, 'cast'], [452.261, 470.641, 'with'], [474.123, 478.253, 'a'], [481.735, 518.785, 'Duration'], [522.267, 538.647, 'may'], [542.129, 559.679, 'have']]],
    [103.200, 381.420, 232.640, 13.050, 'Abilities Transmitted through it.'],
    [84.000, 395.747, 559.680, 13.050, 'If Behind the Curtain ends prematurely due to the user being revealed, its Cooldown increases to High and all magic cast'],
    [84.000, 405.747, 219.970, 13.050, 'during it immediately ends as well.']]],
  [277.785, 421.328, [
    [277.785, 421.328, 322.695, 11.745, 'Sample Perks']]],
  [79.882, 435.282, [
    [79.882, 435.282, 112.597, 11.745, 'God Mic']]],
  [161.280, 435.710, [
    [161.280, 435.710, 429.514, 11.745, [[161.280, 393.336, 'Lingering magic may also Transmit the user\'s voice with increased'], [394.622, 399.454, 'M', 436.492, 6.847], [401.371, 429.514, 'volume.']]]]],
  [72.489, 452.082, [
    [72.489, 452.082, 119.991, 11.745, 'Curtain Call']]],
  [161.280, 452.224, [
    [161.280, 452.224, 554.256, 11.745, 'If the user deliberately ends this Ability prematurely by dramatically revealing themselves, everyone within view'],
    [161.280, 461.224, 273.832, 11.745, [[161.280, 209.664, 'is Compelled'], [210.950, 215.782, 'M', 462.006, 6.847], [217.699, 273.832, 'to look at them.']]]]],
  [109.942, 477.384, [
    [109.942, 477.384, 160.612, 11.745, '(Compounded)']]],
  [64.608, 526.768, [
    [66.848, 526.768, 125.632, 20.880, [[66.848, 110.928, 'Seeing'], [114.848, 125.632, 'is']]],
    [64.608, 542.768, 127.872, 20.880, 'Believing']]],
  [60.780, 573.710, [
    [60.780, 573.710, 116.400, 11.745, 'Paired Action:']]],
  [181.942, 477.424, [
    [181.942, 477.424, 556.603, 11.745, 'If the user deliberately ends this Ability prematurely by dramatically revealing themselves, everyone within'],
    [181.942, 486.424, 440.613, 11.745, [[181.942, 248.641, 'view is Compelled'], [249.927, 254.759, 'M', 487.206, 6.847], [256.676, 434.129, 'to look at them, and enemies who do so are Dazed'], [435.415, 438.489, 'L', 487.206, 6.847], [438.489, 440.613, '.']]]]],
  [166.080, 530.901, [
    [166.080, 530.901, 424.063, 14.355, 'Render a chosen illusion fully physically tangible for up to a'],
    [166.080, 541.901, 354.059, 14.355, 'few targets who completely believe it is real.']]],
  [449.010, 522.655, [
    [449.010, 522.655, 555.585, 13.050, [[449.010, 499.680, 'Essence Cost'], [508.575, 555.585, 'Low–High']]],
    [457.770, 537.055, 499.680, 13.050, 'Cooldown'],
    [523.130, 537.055, 541.030, 13.050, 'Mid']]],
  [130.800, 569.216, [
    [130.800, 569.216, 483.159, 11.745, 'Convince the target(s) that the chosen illusion is, in fact, real. If they come to doubt this at all,'],
    [130.800, 578.216, 283.863, 11.745, 'Seeing is Believing will end prematurely.']]],
  [84.000, 595.893, [
    [84.000, 595.893, 309.000, 13.050, 'Max Duration is equivalent to that of the chosen illusion.'],
    [84.000, 610.220, 559.683, 13.050, [[84.000, 382.234, 'Essence Cost scales with Impact and number of targets (no more than a small'], [383.394, 386.810, 'L', 611.089, 7.608], [388.678, 559.683, 'group). (e.g. Convincing one person that a rope']]],
    [84.000, 620.220, 559.686, 13.050, 'is real so they can climb it would have a Low Cost; convincing one person that a knife is real so that you can stab them with it would'],
    [84.000, 630.220, 559.680, 13.050, 'have a Mid Cost; convincing a half-dozen people that a damaged bridge isn’t collapsing so they don’t fall would have a High Cost.)'],
    [103.200, 644.547, 442.150, 13.050, 'Cannot affect a target who knows for a fact that the illusion isn’t real (such as the user).'],
    [84.000, 658.875, 543.680, 13.050, 'Physical damage and other tangible aftermath is not undone once Seeing is Believing ends. (e.g. A wound inflicted by an'],
    [84.000, 668.875, 414.550, 13.050, 'illusory sword will still be just as bad even if the sword is learned to have been an illusion.)']]],
  [277.785, 684.128, [
    [277.785, 684.128, 322.695, 11.745, 'Sample Perks']]],
  [61.181, 698.082, [
    [61.181, 698.082, 131.299, 11.745, 'Broken Into Pieces']]],
  [106.632, 708.103, [
    [106.632, 708.103, 151.680, 7.830, 'In Honor of Nimué']]],
  [66.968, 723.282, [
    [66.968, 723.282, 125.513, 11.745, 'Selective Vision']]],
  [109.942, 740.184, [
    [109.942, 740.184, 160.612, 11.745, '(Compounded)']]],
  [161.280, 702.724, [
    [161.280, 702.724, 536.904, 11.745, 'Portray a Turning Point of intense inner turmoil to enable Seeing is Believing to affect the user themselves.']]],
  [161.280, 723.710, [
    [161.280, 723.710, 529.443, 11.745, 'Once per use, the user may briefly exempt one or more targets from it at will without ending the Ability.']]],
  [181.942, 740.524, [
    [181.942, 740.524, 559.240, 11.745, 'The user may briefly exempt one or more targets from Seeing is Believing at will without ending the Ability.']]],
  [292.818, 764.837, [
    [292.818, 764.837, 307.182, 18.270, '23']]]
];

// PDF page 37, Thane core, recto -- merged blocks and a shifted frame. Every block that carries content, in
// pdftotext's own emission order, which is not y-order.
const P37 = [
  [289.689, 23.233, [
    [289.689, 23.233, 333.833, 15.630, 'Thane']]],
  [188.160, 110.423, [
    [188.160, 110.423, 427.399, 14.355, 'Conjure weapons and armor onto yourself and/or your'],
    [188.160, 121.423, 211.920, 14.355, 'allies.']]],
  [86.368, 113.268, [
    [86.368, 113.268, 150.272, 20.880, [[86.368, 104.144, 'To'], [108.064, 150.272, 'Arms!']]]]],
  [82.860, 139.810, [
    [82.860, 139.810, 138.480, 11.745, 'Paired Action:']]],
  [471.090, 109.155, [
    [471.090, 109.155, 577.665, 13.050, [[471.090, 521.760, 'Essence Cost'], [530.655, 577.665, 'Low–High']]],
    [479.850, 123.555, 521.760, 13.050, 'Cooldown'],
    [544.845, 123.555, 563.475, 13.050, 'Low']]],
  [152.880, 139.816, [
    [152.880, 139.816, 321.261, 11.745, 'Make a brief speech calling targets to action.']]],
  [106.080, 155.993, [
    [106.080, 155.993, 434.820, 13.050, 'Armaments are determined via Pitch and must be grounded in the user’s Backstory.'],
    [106.080, 170.320, 581.710, 13.050, 'Cost scales on number of targets and Impact of the armaments. (e.g. A sword, shield, and helm for half a dozen people would have'],
    [106.080, 180.320, 575.680, 13.050, 'a Low Cost; modern riot gear for a dozen would have a Mid Cost; a musket and plate mail for two dozen would have a High Cost.)'],
    [106.080, 194.647, 524.300, 13.050, 'Lasts until the end of the mission but ends early for any targets who deliberately disobey or betray the user.']]],
  [299.865, 210.628, [
    [299.865, 210.628, 344.775, 11.745, 'Sample Perks']]],
  [90.263, 224.582, [
    [90.263, 224.582, 146.377, 11.745, 'Workers’ Rally']]],
  [183.360, 229.210, [
    [183.360, 229.210, 494.571, 11.745, 'May Conjure tools (still grounded in the user’s Backstory) as well as weapons and armor.']]],
  [112.392, 234.603, [
    [112.392, 234.603, 173.760, 7.830, 'In Honor of John Sinclair']]],
  [99.168, 249.782, [
    [99.168, 249.782, 137.472, 11.745, 'Fine Farer']]],
  [183.360, 249.910, [
    [183.360, 249.910, 575.598, 11.745, 'May Conjure a single mount (still grounded in the user’s Backstory) instead of weapons and armor, always with'],
    [183.360, 258.910, 252.228, 11.745, 'at least a Mid Cost.']]],
  [128.046, 259.803, [
    [128.046, 259.803, 173.760, 7.830, 'In Honor of Lewyck']]],
  [132.022, 275.084, [
    [132.022, 275.084, 182.692, 11.745, '(Compounded)']]],
  [204.022, 275.110, [
    [204.022, 275.110, 573.148, 11.745, 'May Conjure mounts (still grounded in the user’s Backstory) as well as weapons and armor, though these'],
    [204.022, 284.110, 277.597, 11.745, 'tend to be expensive.']]],
  [72.300, 327.555, [
    [460.530, 327.555, 511.200, 13.050, 'Essence Cost'],
    [485.810, 341.955, 511.200, 13.050, 'Range'],
    [465.560, 356.355, 511.200, 13.050, 'Wall Width'],
    [72.300, 358.210, 127.920, 11.745, 'Paired Action:'],
    [142.320, 358.216, 405.804, 11.745, 'A stomp, shout, or similar, made with a resolute, unyielding attitude.'],
    [474.150, 370.755, 511.200, 13.050, 'Duration'],
    [95.520, 374.393, 431.486, 13.050, [[95.520, 379.610, 'Shields are large enough to fully cover a human and exert a rebuffing force'], [380.928, 386.297, 'M', 375.262, 7.608], [388.316, 431.486, 'on enemies']]],
    [95.520, 384.393, 259.620, 13.050, 'attempting to climb over or push through.'],
    [469.290, 385.155, 511.200, 13.050, 'Cooldown'],
    [95.520, 398.720, 495.840, 13.050, 'The user or any ally may gesture for the shields to briefly part for them to pass, look, or shoot through.'],
    [95.520, 413.047, 488.450, 13.050, 'Shieldwall’s Duration scales on whether or not it is being actively defended by the user or their allies.']]],
  [72.600, 331.668, [
    [72.600, 331.668, 142.920, 20.880, 'Shieldwall']]],
  [177.600, 328.823, [
    [177.600, 328.823, 427.850, 14.355, 'Conjure a line of interlocked, hovering shields at a chosen'],
    [177.600, 339.823, 425.580, 14.355, [[177.600, 416.289, 'point and orientation, immobile but incredibly durable'], [417.860, 422.984, 'H', 340.779, 8.369], [422.984, 425.580, '.']]]]],
  [522.085, 327.555, [
    [534.650, 327.555, 552.550, 13.050, 'Mid'],
    [534.285, 341.955, 552.915, 13.050, 'Low'],
    [522.085, 356.355, 565.115, 13.050, 'Low–Mid'],
    [522.085, 370.755, 565.115, 13.050, 'Low–Mid'],
    [534.285, 385.155, 552.915, 13.050, 'Low']]],
  [289.305, 429.028, [
    [289.305, 429.028, 334.215, 11.745, 'Sample Perks']]],
  [88.131, 442.982, [
    [88.131, 442.982, 127.389, 11.745, 'Shieldring']]],
  [112.326, 453.003, [
    [112.326, 453.003, 163.200, 7.830, 'In Honor of Kaeranis']]],
  [81.647, 468.182, [
    [81.647, 468.182, 133.874, 11.745, 'Mirror Finish']]],
  [121.614, 478.203, [
    [121.614, 478.203, 163.200, 7.830, 'In Honor of Nemi']]],
  [121.462, 493.484, [
    [121.462, 493.484, 172.132, 11.745, '(Compounded)']]],
  [70.416, 555.228, [
    [70.416, 555.228, 145.104, 20.880, 'Gairethinx']]],
  [72.300, 597.010, [
    [72.300, 597.010, 127.920, 11.745, 'Paired Action:']]],
  [172.800, 447.610, [
    [172.800, 447.610, 487.287, 11.745, 'May be Conjured in a circle around the user and a single target, locking both into a Duel.']]],
  [172.800, 472.810, [
    [172.800, 472.810, 566.109, 11.745, 'Any projectile that strikes the Shieldwall ricochets wildly, largely remaining intact and retaining its momentum.']]],
  [193.462, 493.510, [
    [193.462, 493.510, 564.493, 11.745, [[193.462, 387.556, 'Any projectile that strikes the Shieldwall is Redirected'], [388.842, 393.034, 'H', 494.292, 6.847], [394.951, 564.493, 'back towards its source, largely remaining intact']]],
    [193.462, 502.510, 297.187, 11.745, 'and retaining its momentum.']]],
  [177.600, 550.623, [
    [177.600, 550.623, 417.378, 14.355, 'Make a commotion to draw the attention of everyone in'],
    [177.600, 561.623, 404.112, 14.355, 'earshot, gradually sapping the morale of enemies and'],
    [177.600, 572.623, 306.146, 14.355, 'bolstering the morale of allies.']]],
  [454.460, 545.955, [
    [460.530, 545.955, 511.200, 13.050, 'Essence Cost'],
    [454.460, 560.355, 511.200, 13.050, 'Max Duration'],
    [469.290, 574.755, 511.200, 13.050, 'Cooldown']]],
  [534.285, 545.955, [
    [534.285, 545.955, 552.915, 13.050, 'Low'],
    [534.650, 560.355, 552.550, 13.050, 'Mid'],
    [534.650, 574.755, 552.550, 13.050, 'Mid']]],
  [142.320, 592.516, [
    [142.320, 592.516, 505.767, 11.745, 'Yell challenges to your enemies, clatter your weapons and armor, or similar. Must continue to do'],
    [142.320, 601.516, 288.444, 11.745, 'so or Gairethinx will end prematurely.']]],
  [95.520, 619.193, [
    [95.520, 619.193, 537.061, 13.050, [[95.520, 121.560, 'Boosts'], [122.988, 128.358, 'M', 620.062, 7.608], [130.488, 310.188, 'the user’s loudness; Gairethinx’s Impact scales'], [311.616, 324.192, 'L–M', 620.062, 7.608], [326.321, 537.061, 'on how well a given target can hear the Paired Action.']]],
    [95.520, 633.520, 562.950, 13.050, 'Allies may take up Gairethinx’s Paired Action, intensifying the Ability’s effects and enabling the user to drop the Paired'],
    [95.520, 643.520, 246.630, 13.050, 'Action without ending it prematurely.']]],
  [289.305, 659.428, [
    [289.305, 659.428, 334.215, 11.745, 'Sample Perks']]],
  [93.293, 673.382, [
    [93.293, 673.382, 122.228, 11.745, 'Alarum']]],
  [86.029, 698.582, [
    [86.029, 698.582, 129.490, 11.745, 'If You Dare']]],
  [101.640, 708.603, [
    [101.640, 708.603, 163.200, 7.830, 'In Honor of Lance Veyron']]],
  [121.462, 723.884, [
    [121.462, 723.884, 172.132, 11.745, '(Compounded)']]],
  [172.800, 678.010, [
    [172.800, 678.010, 514.647, 11.745, 'Convey a Telepathic message of 3 words or less to all allies who hear Gairethinx’s Paired Action.']]],
  [172.800, 698.710, [
    [172.800, 698.710, 512.247, 11.745, [[172.800, 426.177, 'Intensifies the noise of the Paired Action for enemies, disorienting them'], [427.463, 438.780, 'L–M', 699.492, 6.847], [440.697, 512.247, 'scaling on how close']]],
    [172.800, 707.710, 275.373, 11.745, 'they are (Low Range or less).']]],
  [193.462, 723.909, [
    [193.462, 723.909, 559.915, 11.745, 'Intensifies the noise of the Paired Action for enemies, disorienting them and throwing enemy projectiles'],
    [193.462, 732.909, 418.600, 11.745, [[193.462, 228.040, 'off course'], [229.326, 240.643, 'L–M', 733.692, 6.847], [242.560, 418.600, 'scaling on how close they are (Low Range or less).']]]]],
  [304.818, 764.837, [
    [304.818, 764.837, 319.182, 18.270, '32']]]
];

// PDF page 61, Freerunner core, recto -- the one pronunciation the book prints. Every block that carries content, in
// pdftotext's own emission order, which is not y-order.
const P61 = [
  [271.441, 23.233, [
    [271.441, 23.233, 352.076, 15.630, 'Freerunner']]],
  [177.600, 109.628, [
    [177.600, 109.628, 417.554, 14.355, 'Pitch a convenient terrain feature, using it to perform a'],
    [177.600, 120.628, 312.612, 14.355, [[177.600, 212.624, 'Boosted'], [214.195, 220.102, 'M', 121.584, 8.369], [222.445, 312.612, 'acrobatic movement.']]]]],
  [85.112, 112.473, [
    [85.112, 112.473, 130.408, 20.880, 'Dérive']]],
  [78.048, 130.543, [
    [78.048, 130.543, 137.472, 7.830, '(Pronounced “DAY–reev”)']]],
  [72.300, 145.015, [
    [72.300, 145.015, 127.920, 11.745, 'Paired Action:']]],
  [460.530, 108.360, [
    [460.530, 108.360, 511.200, 13.050, 'Essence Cost'],
    [469.290, 122.760, 511.200, 13.050, 'Cooldown']]],
  [534.285, 108.360, [
    [534.285, 108.360, 552.915, 13.050, 'Low'],
    [534.285, 122.760, 552.915, 13.050, 'Low']]],
  [142.320, 145.022, [
    [142.320, 145.022, 387.507, 11.745, 'Notice the terrain feature and incorporate it into a fitting stunt.']]],
  [95.520, 161.198, [
    [95.520, 161.198, 565.578, 13.050, [[95.520, 235.000, 'Boosted acrobatics are notably safer'], [236.428, 241.798, 'M', 162.067, 7.608], [243.928, 565.578, 'for the user than they would normally be. (e.g. While falling, catching and swinging']]],
    [95.520, 171.198, 353.440, 13.050, 'from a protruding flagpole would be less likely to dislocate your arms).']]],
  [289.305, 187.033, [
    [289.305, 187.033, 334.215, 11.745, 'Sample Perks']]],
  [75.549, 200.987, [
    [75.549, 200.987, 139.971, 11.745, 'One Jump Ahead']]],
  [172.800, 201.429, [
    [172.800, 201.429, 529.506, 11.745, 'May Pitch a local bystander instead of a terrain feature, incorporating them into the performed stunt.']]],
  [73.524, 217.787, [
    [73.524, 217.787, 141.996, 11.745, 'Falling With Style']]],
  [172.800, 218.215, [
    [172.800, 218.215, 569.940, 11.745, [[172.800, 357.759, 'If currently airborne, the user may minorly Redirect'], [358.973, 362.048, 'L', 218.997, 6.847], [363.894, 569.940, 'their current trajectory towards the Pitched terrain feature.']]]]],
  [121.462, 234.689, [
    [121.462, 234.689, 172.132, 11.745, '(Compounded)']]],
  [63.306, 291.273, [
    [63.306, 291.273, 154.986, 20.880, [[63.306, 92.234, 'Tag,'], [96.154, 138.954, 'You’re'], [142.874, 154.986, 'It']]]]],
  [72.300, 323.815, [
    [72.300, 323.815, 127.920, 11.745, 'Paired Action:']]],
  [193.462, 234.715, [
    [193.462, 234.715, 540.652, 11.745, [[193.462, 379.294, 'If currently airborne, the user may majorly Redirect'], [380.580, 384.772, 'H', 235.497, 6.847], [386.689, 540.652, 'their current trajectory towards the Pitched']]],
    [193.462, 243.715, 246.328, 11.745, 'terrain feature.']]],
  [180.372, 293.706, [
    [180.372, 293.706, 413.473, 14.355, 'Encourage allies or goad non-allies into following you.']]],
  [142.320, 319.322, [
    [142.320, 319.322, 432.597, 11.745, 'Touch any number of targets then run away from them; if any target catches'],
    [142.320, 328.322, 405.138, 11.745, 'up or all targets stop pursuing you, this Ability will end prematurely.']]],
  [454.460, 287.160, [
    [460.530, 287.160, 511.200, 13.050, 'Essence Cost'],
    [454.460, 301.560, 511.200, 13.050, 'Max Duration'],
    [469.290, 315.960, 511.200, 13.050, 'Cooldown']]],
  [534.650, 287.160, [
    [534.650, 287.160, 552.550, 13.050, 'Mid'],
    [534.650, 301.560, 552.550, 13.050, 'Mid'],
    [534.650, 315.960, 552.550, 13.050, 'Mid']]],
  [95.520, 345.998, [
    [95.520, 345.998, 448.371, 13.050, [[95.520, 198.930, 'Affected allies gain Boosted'], [200.105, 212.494, 'L–M', 346.867, 7.608], [214.371, 448.371, 'speed and agility, scaling on how effectively you cheer them on']]],
    [95.520, 360.325, 569.637, 13.050, [[95.520, 223.410, 'Affected non-allies are Compelled'], [224.474, 236.781, 'L–M', 361.194, 7.608], [238.547, 569.637, 'to keep following you, no matter how difficult, scaling on how effectively you taunt them.']]]]],
  [289.305, 375.433, [
    [289.305, 375.433, 334.215, 11.745, 'Sample Perks']]],
  [67.004, 389.387, [
    [67.004, 389.387, 148.517, 11.745, 'Catch Me If You Can!']]],
  [83.626, 406.187, [
    [83.626, 406.187, 131.893, 11.745, 'World Chase']]],
  [172.800, 406.615, [
    [172.800, 406.615, 448.821, 11.745, '3x additional targets may be added through tagging while the Ability is active.']]],
  [121.462, 423.089, [
    [121.462, 423.089, 172.132, 11.745, '(Compounded)']]],
  [193.462, 423.115, [
    [193.462, 423.115, 554.731, 11.745, '3x additional targets may be added through tagging while the Ability is active. You may Transmit this'],
    [193.462, 432.115, 444.238, 11.745, 'Ability onto an ally tagged this way, making targets chase them instead.']]],
  [177.600, 476.828, [
    [177.600, 476.828, 430.749, 14.355, [[177.600, 331.314, 'Perform an enormously empowered'], [332.833, 341.811, 'H+', 477.784, 8.369], [344.102, 430.749, 'jump that draws the']]],
    [177.600, 487.828, 268.453, 14.355, [[177.600, 194.738, 'eyes'], [196.257, 210.051, 'L–M', 488.784, 8.369], [212.342, 268.453, 'of onlookers.']]]]],
  [73.648, 479.673, [
    [73.648, 479.673, 141.872, 20.880, 'Hangtime']]],
  [72.300, 506.215, [
    [72.300, 506.215, 127.920, 11.745, 'Paired Action:']]],
  [172.800, 389.829, [
    [172.800, 389.829, 508.311, 11.745, 'This Ability may be activated on a single non-ally by taunting them rather than touching them.']]],
  [460.530, 475.560, [
    [460.530, 475.560, 511.200, 13.050, 'Essence Cost'],
    [469.290, 489.960, 511.200, 13.050, 'Cooldown']]],
  [534.285, 475.560, [
    [534.650, 475.560, 552.550, 13.050, 'Mid'],
    [534.285, 489.960, 552.915, 13.050, 'Low']]],
  [142.320, 506.222, [
    [142.320, 506.222, 396.525, 11.745, 'Briefly pause, then take a conspicuous running start into the jump.']]],
  [95.520, 522.398, [
    [95.520, 522.398, 570.514, 13.050, [[95.520, 326.740, 'Attacks made against the user during this jump are notably'], [328.168, 340.744, 'L–M', 523.267, 7.608], [342.874, 570.514, 'less accurate, scaling on how death-defying and impressive']]],
    [95.520, 532.398, 344.520, 13.050, 'the jump is (the eye-catching effect scaling in the same manner).'],
    [95.520, 546.725, 508.250, 13.050, 'The user is fully spared the falling impact of this jump’s height (but not any additional drop beyond that).']]],
  [289.305, 562.633, [
    [289.305, 562.633, 334.215, 11.745, 'Sample Perks']]],
  [74.271, 576.587, [
    [74.271, 576.587, 141.249, 11.745, 'Stick the Landing']]],
  [89.773, 593.387, [
    [89.773, 593.387, 125.746, 11.745, 'Dropkick']]],
  [121.326, 603.408, [
    [121.326, 603.408, 163.200, 7.830, 'In Honor of Ardis']]],
  [121.462, 618.689, [
    [121.462, 618.689, 172.132, 11.745, '(Compounded)']]],
  [172.800, 577.015, [
    [172.800, 577.015, 506.537, 11.745, [[172.800, 280.638, 'The user may powerfully adhere'], [287.378, 506.537, 'their feet to whatever surface they land on for up to a few seconds.']]]]],
  [281.596, 577.797, [
    [281.596, 577.797, 285.788, 6.847, 'H']]],
  [172.800, 598.015, [
    [172.800, 598.015, 547.031, 11.745, [[172.800, 381.213, 'Ending Hangtime with a kick adds substantial Knockback'], [382.499, 393.176, 'L–H', 598.797, 6.847], [395.093, 547.031, 'to that kick, scaling on the jump\'s distance.']]]]],
  [193.462, 618.715, [
    [193.462, 618.715, 569.799, 11.745, [[193.462, 401.875, 'Ending Hangtime with a kick adds substantial Knockback'], [403.161, 413.838, 'L–H', 619.497, 6.847], [415.755, 569.799, 'to that kick, scaling on the distance the user']]],
    [193.462, 627.715, 487.093, 11.745, [[193.462, 348.379, 'traveled through the air, and greatly reduces'], [349.665, 353.857, 'H', 628.497, 6.847], [355.774, 487.093, 'additional falling impact for the user.']]]]],
  [304.818, 764.837, [
    [304.818, 764.837, 319.182, 18.270, '56']]]
];

// PDF page 64, Freerunner advanced, verso -- a dedication under an ability name. Every block that carries content, in
// pdftotext's own emission order, which is not y-order.
const P64 = [
  [259.921, 23.233, [
    [259.921, 23.233, 340.556, 15.630, 'Freerunner']]],
  [56.265, 117.928, [
    [56.265, 117.928, 141.993, 20.880, [[56.265, 92.601, 'Floor'], [96.521, 107.305, 'is'], [111.225, 141.993, 'Lava']]]]],
  [60.780, 159.709, [
    [60.780, 159.709, 116.400, 11.745, 'Paired Action:']]],
  [171.859, 113.323, [
    [171.859, 113.323, 404.993, 14.355, 'Cause a thick, glowing liquid to bubble up from a low'],
    [171.859, 124.323, 373.848, 14.355, [[171.859, 247.319, 'point and rapidly'], [248.890, 254.014, 'H', 125.279, 8.369], [256.357, 373.848, 'fill the user’s surroundings,']]],
    [171.859, 135.323, 343.345, 14.355, [[171.859, 228.421, 'Suppressing'], [229.992, 235.116, 'H', 136.279, 8.369], [237.459, 343.345, 'anything that touches it.']]]]],
  [442.940, 108.655, [
    [449.010, 108.655, 499.680, 13.050, 'Essence Cost'],
    [442.940, 123.055, 499.680, 13.050, 'Max Duration'],
    [457.770, 137.455, 499.680, 13.050, 'Cooldown']]],
  [521.140, 108.655, [
    [521.140, 108.655, 543.020, 13.050, 'High'],
    [523.130, 123.055, 541.030, 13.050, 'Mid'],
    [521.140, 137.455, 543.020, 13.050, 'High']]],
  [130.800, 155.216, [
    [130.800, 155.216, 543.198, 11.745, 'Count down from three at the top of your lungs and warn everyone to not touch the liquid. Must avoid being'],
    [130.800, 164.216, 417.675, 11.745, 'touched and Suppressed by the liquid or Floor is Lava will end prematurely.']]],
  [84.000, 181.893, [
    [84.000, 181.893, 546.610, 13.050, 'The liquid causes no harm to those it Suppresses (not even suffocation) and will not leave behind “wetness” or residue.'],
    [84.000, 196.220, 510.900, 13.050, 'Upon expiry, the liquid will completely drain within a Low Duration, gradually freeing those immersed in it.'],
    [103.200, 210.547, 512.950, 13.050, 'Any being completely removed from the liquid before then will also instantly regain control of their body.'],
    [84.000, 224.875, 554.680, 13.050, 'No set range or area of effect: behaves like any other liquid, working to flood its surroundings. However, if this Ability is'],
    [84.000, 234.875, 369.560, 13.050, 'used in an open, flat area, the liquid is unlikely to rise above ankle height.']]],
  [277.785, 250.927, [
    [277.785, 250.927, 322.695, 11.745, 'Sample Perks']]],
  [73.186, 264.882, [
    [73.186, 264.882, 119.293, 11.745, 'Level Editor']]],
  [161.280, 265.310, [
    [161.280, 265.310, 337.923, 11.745, 'While this Ability lasts, Dérive has no Cooldown.']]],
  [73.281, 281.682, [
    [73.281, 281.682, 119.199, 11.745, 'Midoriyama']]],
  [161.280, 282.124, [
    [161.280, 282.124, 515.502, 11.745, 'If the user is the last person not to be Suppressed within a Mid Range, a Mid Essence Cost is refunded.']]],
  [109.942, 298.584, [
    [109.942, 298.584, 160.612, 11.745, '(Compounded)']]],
  [50.968, 355.168, [
    [50.968, 355.168, 141.512, 20.880, 'Double-Jump']]],
  [60.780, 381.709, [
    [60.780, 381.709, 116.400, 11.745, 'Paired Action:']]],
  [181.942, 298.624, [
    [181.942, 298.624, 557.512, 11.745, 'If the user is the last person not to be Suppressed within a Mid Range, a Mid Essence Cost is refunded and'],
    [181.942, 307.624, 333.628, 11.745, 'this Ability\'s Cooldown is reduced to Mid.']]],
  [458.215, 351.055, [
    [458.215, 351.055, 508.885, 13.050, 'Essence Cost']]],
  [166.080, 357.600, [
    [166.080, 357.600, 349.890, 14.355, 'Push off of thin air as though it were solid.']]],
  [527.368, 351.055, [
    [527.368, 351.055, 545.998, 13.050, 'Low']]],
  [130.800, 381.716, [
    [130.800, 381.716, 236.919, 11.745, 'Try to jump while airborne.']]],
  [84.000, 397.893, [
    [84.000, 397.893, 344.200, 13.050, 'Cooldown lasts until the user next lands on an actual solid surface.'],
    [84.000, 412.220, 464.050, 13.050, 'Does not negate current momentum, fall impact, or similar any more than a normal jump would.']]],
  [277.785, 427.327, [
    [277.785, 427.327, 322.695, 11.745, 'Sample Perks']]],
  [73.124, 441.282, [
    [73.124, 441.282, 119.356, 11.745, 'Triple-Jump']]],
  [161.280, 441.709, [
    [161.280, 441.709, 456.156, 11.745, 'Can be used twice (at full cost) before the user next lands on an actual solid surface.']]],
  [78.690, 458.082, [
    [78.690, 458.082, 113.790, 11.745, 'Footstool']]],
  [161.280, 458.524, [
    [161.280, 458.524, 559.014, 11.745, [[161.280, 378.288, 'May be used to jump off of a person rather than thin air, Dazing'], [379.331, 382.406, 'L', 459.306, 6.847], [384.081, 559.014, 'them and putting this Ability on a Low Cooldown.']]]]],
  [109.942, 474.984, [
    [109.942, 474.984, 160.612, 11.745, '(Compounded)']]],
  [47.080, 523.168, [
    [47.080, 523.168, 145.400, 20.880, [[47.080, 98.824, 'Gravity'], [102.744, 145.400, 'Check']]]]],
  [75.303, 541.238, [
    [75.303, 541.238, 117.177, 7.830, 'In Honor of Ardis']]],
  [60.780, 555.710, [
    [60.780, 555.710, 116.400, 11.745, 'Paired Action:']]],
  [181.942, 475.310, [
    [181.942, 475.310, 436.943, 11.745, [[181.942, 410.056, 'May be used to jump off of a person rather than thin air, Dazing'], [411.342, 414.416, 'L', 476.092, 6.847], [416.333, 436.943, 'them.']]]]],
  [166.080, 526.323, [
    [166.080, 526.323, 411.435, 14.355, 'Change the direction of gravity for yourself alone, falling'],
    [166.080, 537.323, 277.565, 14.355, 'that way instead of down.']]],
  [130.800, 555.716, [
    [130.800, 555.716, 336.981, 11.745, 'Choose the direction your character will treat as down.']]],
  [449.010, 519.055, [
    [449.010, 519.055, 499.680, 13.050, 'Essence Cost'],
    [462.630, 533.455, 499.680, 13.050, 'Duration'],
    [457.770, 547.855, 499.680, 13.050, 'Cooldown']]],
  [521.140, 519.055, [
    [521.140, 519.055, 543.020, 13.050, 'High'],
    [522.765, 533.455, 541.395, 13.050, 'Low'],
    [522.765, 547.855, 541.395, 13.050, 'Low']]],
  [84.000, 571.893, [
    [84.000, 571.893, 493.880, 13.050, 'Gravity Check cannot be ended early at will unless the user falls a High Distance in the chosen direction.']]],
  [277.785, 586.928, [
    [277.785, 586.928, 322.695, 11.745, 'Sample Perks']]],
  [76.328, 600.882, [
    [76.328, 600.882, 116.153, 11.745, 'Acrophilia']]],
  [161.280, 601.010, [
    [161.280, 601.010, 263.673, 11.745, 'If at a truly staggering height'],
    [161.280, 610.010, 256.365, 11.745, 'Ability’s Duration to Mid.']]],
  [75.306, 626.082, [
    [75.306, 626.082, 117.174, 11.745, 'Free to Fall']]],
  [161.280, 626.510, [
    [161.280, 626.510, 534.994, 11.745, [[161.280, 420.975, 'After a successful Defiance during Gravity Check, the user may Redirect'], [422.261, 427.093, 'M', 627.292, 6.847], [429.010, 534.994, 'their chosen gravity direction.']]]]],
  [109.942, 642.984, [
    [109.942, 642.984, 160.612, 11.745, '(Compounded)']]],
  [264.959, 601.792, [
    [264.959, 601.792, 272.320, 6.847, 'H+']]],
  [274.237, 601.010, [
    [274.237, 601.010, 548.287, 11.745, 'above the (actual) ground, portray a Turning Point of elation to increase this']]],
  [181.942, 643.310, [
    [181.942, 643.310, 512.395, 11.745, 'After a successful Defiance during Gravity Check, the user may reactivate the Ability for free.']]],
  [292.818, 764.837, [
    [292.818, 764.837, 307.182, 18.270, '59']]]
];

// PDF page 67, Infiltrator core, recto -- an auto-fitted 19.57 name. Every block that carries content, in
// pdftotext's own emission order, which is not y-order.
const P67 = [
  [271.490, 23.233, [
    [271.490, 23.233, 352.033, 15.630, 'Infiltrator']]],
  [61.583, 112.775, [
    [61.583, 112.775, 153.938, 19.575, [[61.583, 113.513, 'Identity'], [117.188, 153.938, 'Theft']]]]],
  [71.520, 139.015, [
    [71.520, 139.015, 127.140, 11.745, 'Paired Action:']]],
  [177.600, 109.628, [
    [177.600, 109.628, 427.784, 14.355, 'Perfectly disguise yourself as a target you have neutralized,'],
    [177.600, 120.628, 392.738, 14.355, 'absorbing some of their knowledge in the process.']]],
  [142.320, 139.022, [
    [142.320, 139.022, 436.737, 11.745, 'Kill, knock out, or otherwise get rid of the target while taking an object from them.']]],
  [454.460, 108.360, [
    [460.530, 108.360, 511.200, 13.050, 'Essence Cost'],
    [454.460, 122.760, 511.200, 13.050, 'Max Duration'],
    [460.930, 137.160, 511.200, 13.050, 'Max Queries'],
    [469.290, 151.560, 511.200, 13.050, 'Cooldown']]],
  [532.660, 108.360, [
    [534.650, 108.360, 552.550, 13.050, 'Mid'],
    [532.660, 122.760, 554.540, 13.050, 'High'],
    [538.295, 137.160, 548.905, 13.050, '3x'],
    [534.285, 151.560, 552.915, 13.050, 'Low']]],
  [95.520, 155.198, [
    [95.520, 155.198, 428.285, 13.050, [[95.520, 259.750, 'This disguise can be extremely convincing'], [261.178, 274.995, 'M–H', 156.067, 7.608], [274.995, 428.285, ', extending to voice, outfit, and similar,']]],
    [95.520, 165.198, 410.030, 13.050, 'scaling on how important and/or emblematic the object taken from the target is.'],
    [95.520, 179.525, 540.038, 13.050, [[95.520, 253.270, 'While disguised, you may make Queries'], [254.698, 260.068, 'M', 180.394, 7.608], [262.198, 540.038, 'about basic information the target would have known. (e.g. “What’s the']]],
    [95.520, 189.525, 427.030, 13.050, 'password?”, “What’s the next item on their schedule?”, “Where is the boss’s office located?”)'],
    [95.520, 203.853, 556.480, 13.050, 'If news of the target’s discovery (dead or alive) reaches the user’s location or the user loses possession of the object they'],
    [95.520, 213.853, 322.470, 13.050, 'took from the target, Identity Theft will end prematurely.']]],
  [291.550, 229.620, [
    [291.550, 229.620, 331.969, 10.571, 'Sample Perks']]],
  [84.828, 242.987, [
    [84.828, 242.987, 130.692, 11.745, 'Closet Stash']]],
  [172.800, 243.415, [
    [172.800, 243.415, 268.380, 11.745, 'Grants Inconspicuousness']]],
  [73.709, 259.787, [
    [73.709, 259.787, 141.811, 11.745, 'Less Lethal Means']]],
  [113.148, 269.808, [
    [113.148, 269.808, 163.200, 7.830, 'In Honor of Reynard']]],
  [71.520, 358.615, [
    [71.520, 358.615, 127.140, 11.745, 'Paired Action:']]],
  [282.744, 243.415, [
    [282.744, 243.415, 570.492, 11.745, 'to the target’s body (dead or alive), scaling on the comedic value of its hiding place.']]],
  [172.800, 259.915, [
    [172.800, 259.915, 562.990, 11.745, [[172.800, 294.597, 'May be activated after a prolonged'], [295.883, 298.957, 'L', 260.697, 6.847], [300.874, 562.990, 'social interaction rather than through neutralizing the target, though Max']]],
    [172.800, 268.915, 323.361, 11.745, 'Duration drops to Mid and Queries to 2x.']]],
  [121.462, 285.089, [
    [121.462, 285.089, 172.132, 11.745, '(Compounded)']]],
  [60.432, 332.073, [
    [60.432, 332.073, 155.088, 20.880, [[60.432, 91.344, 'Case'], [95.264, 117.344, 'the'], [121.264, 155.088, 'Joint']]]]],
  [269.609, 244.197, [
    [269.609, 244.197, 280.884, 6.847, 'L–M']]],
  [193.462, 285.415, [
    [193.462, 285.415, 538.022, 11.745, [[193.462, 315.259, 'May be activated after a prolonged'], [316.545, 319.619, 'L', 286.197, 6.847], [321.536, 538.022, 'social interaction rather than through neutralizing the target.']]]]],
  [177.600, 334.506, [
    [177.600, 334.506, 386.314, 14.355, 'Develop a mental map of a structure or location.']]],
  [142.320, 358.622, [
    [142.320, 358.622, 436.350, 11.745, 'Closely observe the location for a Low Duration, then close your eyes to activate.']]],
  [460.530, 327.960, [
    [460.530, 327.960, 511.200, 13.050, 'Essence Cost'],
    [460.930, 342.360, 511.200, 13.050, 'Max Queries'],
    [469.290, 356.760, 511.200, 13.050, 'Cooldown']]],
  [534.285, 327.960, [
    [534.285, 327.960, 552.915, 13.050, 'Low'],
    [538.295, 342.360, 548.905, 13.050, '4x'],
    [534.650, 356.760, 552.550, 13.050, 'Mid']]],
  [95.520, 374.798, [
    [95.520, 374.798, 515.730, 13.050, 'Gives the user a 3D view of the location’s layout, which they may examine at will while their eyes are closed.'],
    [95.520, 389.125, 543.047, 13.050, [[95.520, 368.980, 'While the user is examining their mental map, you may make Queries'], [370.408, 375.067, 'H', 389.994, 7.608], [377.197, 543.047, 'about the location, anything that a regular']]],
    [95.520, 399.125, 563.790, 13.050, 'inhabitant of it might be privy to. (e.g. “When is the next shift change for the guards?”, “Are there any deliveries scheduled for'],
    [95.520, 409.125, 317.020, 13.050, 'today?”, “Is there a security camera covering the back door?”)'],
    [95.520, 423.453, 571.191, 13.050, 'No Duration, and Cooldown begins on use rather than on expiry, though reusing the Ability will end the current instance.']]],
  [289.305, 439.033, [
    [289.305, 439.033, 334.215, 11.745, 'Sample Perks']]],
  [72.430, 452.987, [
    [72.430, 452.987, 143.089, 11.745, 'Building Inspector']]],
  [172.800, 453.429, [
    [172.800, 453.429, 570.564, 11.745, [[172.800, 344.520, 'Expend two Queries to instead Pitch a noteworthy'], [345.563, 350.396, 'M', 454.211, 6.847], [352.071, 570.564, 'structural weakness, safety hazard, or similar within the location.']]]]],
  [66.180, 469.787, [
    [66.180, 469.787, 149.340, 11.745, 'Mischief Management']]],
  [172.800, 470.215, [
    [172.800, 470.215, 501.174, 11.745, 'Once per use, see a chosen target’s exact current position on your mental map for a couple seconds.']]],
  [121.462, 486.689, [
    [121.462, 486.689, 172.132, 11.745, '(Compounded)']]],
  [193.462, 487.015, [
    [193.462, 487.015, 570.940, 11.745, 'See a chosen target’s exact current position on your mental map for up to a Low Duration (Low Cooldown).']]],
  [57.207, 533.673, [
    [57.207, 533.673, 187.207, 20.880, [[57.207, 126.919, 'Maximum'], [130.839, 187.207, 'Security']]]]],
  [71.520, 560.215, [
    [71.520, 560.215, 127.140, 11.745, 'Paired Action:']]],
  [206.494, 530.828, [
    [206.494, 530.828, 419.113, 14.355, 'Pitch coming across both a valuable prize and the'],
    [206.494, 541.828, 383.385, 14.355, 'formidable security measures guarding it.']]],
  [460.530, 529.560, [
    [460.530, 529.560, 511.200, 13.050, 'Essence Cost'],
    [534.650, 529.560, 552.550, 13.050, 'Mid'],
    [469.290, 543.960, 567.105, 13.050, [[469.290, 511.200, 'Cooldown'], [520.095, 567.105, 'Low–High']]]]],
  [142.320, 560.222, [
    [142.320, 560.222, 504.273, 11.745, 'Narrowly avoid being detected, caught, or similar by the defenses as part of the initiating Pitch.']]],
  [95.520, 576.398, [
    [95.520, 576.398, 566.412, 13.050, [[95.520, 218.360, 'Cooldown scales on the Impact'], [219.788, 231.652, 'L–H', 577.267, 7.608], [233.782, 566.412, 'of the Pitched prize (as relevant to the user and their mission), which must in turn be']]],
    [95.520, 586.398, 553.500, 13.050, 'proportionate to the apparent challenge posed by the Pitched defenses. (e.g. A sleepy watchman posted at a side entrance'],
    [95.520, 596.398, 560.930, 13.050, 'would have a Low Cooldown; a sophisticated retinal scan gating access to top secret files would have a Mid Cooldown; a deadly'],
    [95.520, 606.398, 330.850, 13.050, 'monster guarding a sacred relic would have a High Cooldown.)'],
    [114.720, 620.725, 511.700, 13.050, 'You may choose to leave some elements of your Pitch ambiguous, the Conduit filling in as they see fit.']]],
  [289.305, 635.833, [
    [289.305, 635.833, 334.215, 11.745, 'Sample Perks']]],
  [72.444, 649.787, [
    [72.444, 649.787, 143.076, 11.745, 'Emergency Klaxon']]],
  [172.800, 649.915, [
    [172.800, 649.915, 557.035, 11.745, [[172.800, 514.863, 'If the user is detected by the Pitched defenses, a loud siren may blare from nowhere, Galvanizing'], [516.149, 520.981, 'M', 650.697, 6.847], [522.898, 557.035, 'non-allies']]],
    [172.800, 658.915, 278.640, 11.745, 'within earshot towards alarm.']]],
  [73.835, 674.987, [
    [73.835, 674.987, 141.685, 11.745, 'I Check For Traps']]],
  [172.800, 679.029, [
    [172.800, 679.029, 452.376, 11.745, 'May be used to just Pitch a hidden threat with no prize; Impact capped at Low.']]],
  [124.836, 685.008, [
    [124.836, 685.008, 163.200, 7.830, 'In Honor of Ryu']]],
  [121.462, 699.089, [
    [121.462, 699.089, 172.132, 11.745, '(Compounded)']]],
  [193.462, 699.129, [
    [193.462, 699.129, 538.423, 11.745, 'May be used to just Pitch a hidden threat with no prize; Impact capped at Mid. Similar threats are'],
    [193.462, 708.129, 413.798, 11.745, [[193.462, 240.496, 'Highlighted'], [241.782, 246.614, 'M', 708.911, 6.847], [248.531, 413.798, 'to the user while this Cooldown lasts (1x Use).']]]]],
  [304.818, 764.837, [
    [304.818, 764.837, 319.182, 18.270, '62']]]
];

// PDF page 76, Samaritan advanced, verso -- the smaller body font. Every block that carries content, in
// pdftotext's own emission order, which is not y-order.
const P76 = [
  [261.978, 23.233, [
    [261.978, 23.233, 338.506, 15.630, 'Samaritan']]],
  [52.694, 105.568, [
    [52.694, 105.568, 160.726, 20.880, [[52.694, 76.806, 'Pay'], [80.726, 92.838, 'It'], [96.758, 160.726, 'Forwards']]]]],
  [66.960, 132.164, [
    [66.960, 132.164, 116.400, 10.440, 'Paired Action:']]],
  [187.020, 102.723, [
    [187.020, 102.723, 406.305, 14.355, 'Perform a random act of kindness to later Pitch its'],
    [187.020, 113.723, 371.743, 14.355, 'recipient doing so in turn for someone else.']]],
  [449.010, 101.455, [
    [449.010, 101.455, 499.680, 13.050, 'Essence Cost'],
    [457.770, 115.855, 499.680, 13.050, 'Cooldown']]],
  [522.765, 101.455, [
    [522.765, 101.455, 541.395, 13.050, 'Low'],
    [523.130, 115.855, 541.030, 13.050, 'Mid']]],
  [130.800, 132.170, [
    [130.800, 132.170, 445.873, 10.440, [[130.800, 250.936, 'Surprise a non-agent with a modest'], [252.079, 262.410, 'L–M', 132.865, 6.087], [264.305, 445.873, 'gift, favor, or similar while getting nothing in return.']]]]],
  [84.000, 147.384, [
    [84.000, 147.384, 551.604, 11.745, 'The target’s Pitched act of kindness may happen at any point for the rest of the mission, with maximum Impact equivalent to that of'],
    [84.000, 156.384, 557.769, 11.745, 'the user’s original Paired Action. Your Pitch may include, in broad strokes, all elements of the act: what is done, where it happens, who'],
    [84.000, 165.384, 173.784, 11.745, 'it is done for, and similar.'],
    [103.200, 178.678, 559.688, 11.745, 'The Pitched act does not need to be in any way thematically linked to the user’s original Paired Action; the target doesn’t even need'],
    [103.200, 187.678, 303.891, 11.745, 'to be present in a scene in order for the Pitch to be made.'],
    [84.000, 200.973, 472.602, 11.745, 'The user becomes instinctively aware of their target\'s act of kindness, including all details laid out in the Pitch.']]],
  [280.280, 216.180, [
    [280.280, 216.180, 320.200, 10.440, 'Sample Perks']]],
  [63.252, 229.184, [
    [63.252, 229.184, 129.228, 10.440, 'And Also With You']]],
  [161.280, 229.564, [
    [161.280, 229.564, 558.096, 10.440, 'If the target responds graciously to the user’s Paired Action, you may make an immediate Happenstance Pitch for them (using'],
    [161.280, 237.564, 247.560, 10.440, 'your character’s Luck Stat).']]],
  [65.668, 253.184, [
    [65.668, 253.184, 126.812, 10.440, 'Shirt Off My Back']]],
  [161.280, 253.564, [
    [161.280, 253.564, 543.936, 10.440, [[161.280, 369.120, 'If the user’s Paired Action involves some form of minor self-sacrifice'], [370.149, 372.882, 'L', 254.259, 6.087], [372.840, 543.936, ', your Pitch may include the target self-sacrificing to the']]],
    [161.280, 261.564, 199.784, 10.440, 'same degree.']]],
  [109.942, 276.984, [
    [109.942, 276.984, 160.612, 11.745, '(Compounded)']]],
  [46.740, 325.168, [
    [46.740, 325.168, 155.892, 20.880, [[46.740, 105.972, 'Huddled'], [109.892, 155.892, 'Masses']]]]],
  [66.960, 351.764, [
    [66.960, 351.764, 116.400, 10.440, 'Paired Action:']]],
  [181.942, 277.564, [
    [181.942, 277.564, 547.929, 10.440, [[181.942, 373.358, 'If the user’s Paired Action involves some form of self-sacrifice'], [374.501, 384.561, 'L–M', 278.259, 6.087], [384.561, 547.929, ', your Pitch may include the target self-sacrificing to']]],
    [181.942, 285.564, 233.070, 10.440, 'the same degree.']]],
  [176.233, 322.323, [
    [176.233, 322.323, 397.456, 14.355, [[176.233, 315.207, 'Pitch the appearance of a group'], [316.778, 329.829, 'L–H', 323.279, 8.369], [332.171, 397.456, 'of beleaguered,']]],
    [176.233, 333.323, 242.354, 14.355, 'harmless locals.']]],
  [449.010, 321.055, [
    [449.010, 321.055, 499.680, 13.050, 'Essence Cost'],
    [523.130, 321.055, 541.030, 13.050, 'Mid'],
    [457.770, 335.455, 555.585, 13.050, [[457.770, 499.680, 'Cooldown'], [508.575, 555.585, 'Low–High']]]]],
  [130.800, 351.770, [
    [130.800, 351.770, 504.704, 10.440, 'Express immediate concern for the group, specifying their plight in broad strokes as part of the initiating Pitch.']]],
  [84.000, 366.984, [
    [84.000, 366.984, 550.353, 11.745, 'Maximum group size scales and Cooldown inversely scales on the fittingness of such a group within the surroundings. (e.g. A warzone'],
    [84.000, 375.984, 541.740, 11.745, 'would yield a High max group size and a Low Cooldown; a luxury cruise ship would yield a Low max group size and a High Cooldown.)'],
    [84.000, 389.278, 548.571, 11.745, 'These locals must be too scared, injured, ineffectual, or similar to be of any use when first discovered. However, as they are helped by'],
    [84.000, 398.278, 551.669, 11.745, [[84.000, 343.623, 'the user and their allies in relevant ways, they will be gradually Recruited'], [344.909, 355.586, 'L–H', 399.060, 6.847], [357.503, 551.669, 'to return the favor and assist those who helped them in']]],
    [84.000, 407.278, 145.677, 11.745, 'any way they can.'],
    [103.200, 420.573, 335.760, 11.745, 'Until Recruited, these locals should be controlled by the Conduit.']]],
  [280.280, 435.780, [
    [280.280, 435.780, 320.200, 10.440, 'Sample Perks']]],
  [68.580, 448.784, [
    [68.580, 448.784, 123.900, 10.440, 'Mother of Exiles']]],
  [161.280, 449.164, [
    [161.280, 449.164, 524.684, 10.440, [[161.280, 283.432, 'Instead of locals, you may Pitch a small'], [284.575, 287.308, 'L', 449.859, 6.087], [289.012, 524.684, 'group of applicable beings from your character’s homeland (no matter how']]],
    [161.280, 457.164, 201.888, 10.440, 'implausible).']]],
  [65.980, 472.784, [
    [65.980, 472.784, 126.500, 10.440, 'We Are the World']]],
  [161.280, 473.764, [
    [161.280, 473.764, 555.445, 10.440, [[161.280, 221.752, 'While a small group'], [222.679, 225.412, 'L', 474.459, 6.087], [226.901, 555.445, 'of the Recruited individuals are singing in unison, the user’s Abilities have their Essence Costs reduced by one']]],
    [161.280, 481.764, 204.840, 10.440, 'Power Rating.']]],
  [109.942, 498.074, [
    [109.942, 498.074, 154.982, 10.440, '(Compounded)']]],
  [53.992, 547.168, [
    [53.992, 547.168, 138.488, 20.880, [[53.992, 97.912, 'Holier'], [101.832, 138.488, 'Than']]],
    [77.592, 563.168, 114.888, 20.880, 'Thou']]],
  [66.960, 588.164, [
    [66.960, 588.164, 116.400, 10.440, 'Paired Action:']]],
  [181.942, 498.964, [
    [181.942, 498.964, 552.290, 10.440, [[181.942, 244.862, 'While a small group'], [246.005, 248.738, 'L', 499.659, 6.087], [250.442, 552.290, 'of the Recruited individuals are singing in unison, the user and a chosen ally within earshot have']]],
    [181.942, 506.964, 370.942, 10.440, 'their Abilities’s Essence Costs reduced by one Power Rating.']]],
  [166.080, 551.301, [
    [166.080, 551.301, 422.639, 14.355, [[166.080, 380.932, 'Condemn a lack of virtue in a target to Galvanize'], [382.503, 397.702, 'M–H', 552.257, 8.369], [400.045, 422.639, 'them']]],
    [166.080, 562.301, 315.658, 14.355, 'towards crippling guilt and shame.']]],
  [449.010, 543.055, [
    [449.010, 543.055, 499.680, 13.050, 'Essence Cost'],
    [523.130, 543.055, 541.030, 13.050, 'Mid'],
    [462.630, 557.455, 555.220, 13.050, [[462.630, 499.680, 'Duration'], [508.940, 555.220, 'Mid–High']]],
    [457.770, 571.855, 499.680, 13.050, 'Cooldown'],
    [523.130, 571.855, 541.030, 13.050, 'Mid']]],
  [130.800, 588.170, [
    [130.800, 588.170, 463.400, 10.440, 'Berate the target at length, focusing on a specific virtue they clearly lack or are observably shirking.']]],
  [84.000, 603.384, [
    [84.000, 603.384, 436.512, 11.745, 'Impact and Duration both scale on how negatively affected the target is by the user’s condemnation.'],
    [84.000, 616.678, 431.355, 11.745, 'Only successful when used on a trait or behavior that both the user and the target consider a virtue.'],
    [84.000, 629.973, 553.710, 11.745, 'As part of their Paired Action, the user may compare the target disfavorably with any other relevant being who clearly does exhibit the'],
    [84.000, 638.973, 529.541, 11.745, [[84.000, 283.998, 'chosen virtue. If they do, the target is further Galvanized'], [285.284, 297.719, 'M–H', 639.755, 6.847], [299.636, 529.541, 'towards burning resentment, envy, or similar towards that target.']]],
    [84.000, 652.267, 536.403, 11.745, 'The user may choose to end this Ability prematurely by sincerely praising their target for improving their behavior, reducing the'],
    [84.000, 661.267, 151.941, 11.745, 'Cooldown to Low.']]],
  [280.280, 675.780, [
    [280.280, 675.780, 320.200, 10.440, 'Sample Perks']]],
  [56.508, 688.784, [
    [56.508, 688.784, 135.972, 10.440, 'No Rest for the Wicked']]],
  [74.000, 704.384, [
    [74.000, 704.384, 118.480, 10.440, 'The Riot Act']]],
  [109.942, 728.475, [
    [109.942, 728.475, 154.982, 10.440, '(Compounded)']]],
  [161.280, 688.964, [
    [161.280, 688.964, 213.896, 10.440, 'Gradually drains']]],
  [215.039, 689.659, [
    [215.039, 689.659, 224.530, 6.087, 'L–H']]],
  [226.234, 688.964, [
    [226.234, 688.964, 474.858, 10.440, 'the target’s Stamina the longer they avoid or resist this Ability’s Galvanizations.']]],
  [161.280, 704.764, [
    [161.280, 704.764, 521.116, 10.440, [[161.280, 395.504, 'While berating the target during the Paired Action, the user may Suppress'], [396.647, 407.700, 'M–H', 705.459, 6.087], [409.404, 521.116, 'them from leaving their presence or']]],
    [161.280, 712.764, 257.880, 10.440, 'interrupting (scaling as above).']]],
  [181.942, 728.764, [
    [181.942, 728.764, 535.082, 10.440, [[181.942, 416.166, 'While berating the target during the Paired Action, the user may Suppress'], [417.309, 428.362, 'M–H', 729.459, 6.087], [430.066, 535.082, 'them from leaving their presence,']]],
    [181.942, 736.764, 322.886, 10.440, 'interrupting, or aggressing (scaling as above).']]],
  [292.818, 764.837, [
    [292.818, 764.837, 307.182, 18.270, '71']]]
];

describe('ability pages', () => {
  test('three abilities per page, anchored on the three "Paired Action:" labels', () => {
    // "Paired Action:" prints exactly three times on every one of the 24
    // ability pages; "Essence Cost" prints 4 lines on p22/p28/p46/p55 and 2 on
    // p82, so it cannot anchor an entry (geometry doc, section 8).
    const entries = abilityEntries(pageAt(19, P19));
    expect(entries.map((entry) => entry.name)).toEqual(['Trickshot', 'Standoff', 'Shootout']);
    expect(abilityEntries(pageAt(22, P22)).map((entry) => entry.name))
      .toEqual(['High Noon', 'Stick ‘Em Up', 'Surefire']);
  });

  test('the ability name is the tallest line above its label, at 19.57 as well as 20.88', () => {
    // Trickshot is 20.88; Identity Theft is one of the 11 names the book
    // auto-fits down to 19.57 (6 names) or 19.58 (5). Nothing may key on 20.88.
    expect(abilityEntries(pageAt(19, P19))[0].name).toBe('Trickshot');
    expect(abilityEntries(pageAt(67, P67))[0].name).toBe('Identity Theft');
  });

  test('a two-line ability name joins into one string', () => {
    // p28 prints two of the book's 16 two-line names; the second line of
    // "Behind the / Curtain" sits 16.00 below the first, at its own indent.
    expect(abilityEntries(pageAt(28, P28)).map((entry) => entry.name))
      .toEqual(['Private Reality', 'Behind the Curtain', 'Seeing is Believing']);
  });

  test('a name is looked for far enough above a two-line label to clear both lines', () => {
    // "Behind the / Curtain" puts its label 46.94 below the name's first line,
    // the widest lookback in the book; a 40 pt window resolves the name to the
    // perk names of the entry above instead.
    const entries = abilityEntries(pageAt(28, P28));
    expect(entries[1].name).toBe('Behind the Curtain');
    expect(entries[1].description).toBe(
      'While you remain hidden, your other Abilities have reduced Costs and'
      + ' Cooldowns and may be Transmitted through lingering magic you have cast.');
  });

  test('the lookback stops short of the entry above', () => {
    // Every name on the page is the same height, so a window deep enough to
    // reach the previous name takes that name too and the page loses its
    // entries entirely.
    expect(abilityEntries(pageAt(19, P19))[1].name).toBe('Standoff');
    expect(abilityEntries(pageAt(19, P19))[2].name).toBe('Shootout');
  });

  test('the paired-action text begins above its own label and is still its text', () => {
    // p19 Trickshot: the text band opens at 142.92, the label at 147.41.
    const [trickshot] = abilityEntries(pageAt(19, P19));
    expect(trickshot.paired_action).toBe(
      'Perform a stylish flourish with the weapon or projectile being used,'
      + ' Pitching how the shot Redirects <sup>H</sup> after bouncing.');
    expect(trickshot.description).toBe(
      'Bounce a projectile off a surface; it remains intact and retains its momentum.');
  });

  test('the compounded body belongs to the second perk, never to a third', () => {
    const [trickshot] = abilityEntries(pageAt(19, P19));
    expect(trickshot.sample_perks).toHaveLength(2);
    expect(trickshot.sample_perks[0].name).toBe('Smoke Off the Barrel');
    expect(trickshot.sample_perks[0].compound_text).toBeNull();
    expect(trickshot.sample_perks[1].name).toBe('Waco Kid');
    expect(trickshot.sample_perks[1].compound_text).toBe(
      'Improves <sup>M</sup> user’s hand speed while drawing a weapon for this'
      + ' Ability and during its Paired Action. A weapon used for this Ability may'
      + ' be Teleported back to its sheath immediately afterwards.');
  });

  test('a perk name and its body share a baseline and are not concatenated', () => {
    // "Waco Kid" is at yMin 226.18 and its body at 226.60.
    const [trickshot] = abilityEntries(pageAt(19, P19));
    expect(trickshot.sample_perks[1].text).toBe(
      'Improves <sup>M</sup> user’s hand speed while drawing a weapon for this'
      + ' Ability and during its Paired Action.');
  });

  test('an entry whose blocks pdftotext merged still yields its own parts', () => {
    // p37 Shieldwall: the meter table, the "Paired Action:" label, its text and
    // all three notes arrive in ONE block spanning x 72.30-511.20. Structure is
    // re-derived from (yMin, xMin); block boundaries carry nothing here.
    const shieldwall = abilityEntries(pageAt(37, P37))[1];
    expect(shieldwall.name).toBe('Shieldwall');
    expect(shieldwall.paired_action).toBe(
      'A stomp, shout, or similar, made with a resolute, unyielding attitude.');
    expect(shieldwall.meters).toEqual([
      { label: 'Essence Cost', value: 'Mid' },
      { label: 'Range', value: 'Low' },
      { label: 'Wall Width', value: 'Low–Mid' },
      { label: 'Duration', value: 'Low–Mid' },
      { label: 'Cooldown', value: 'Low' },
    ]);
    expect(shieldwall.notes.map((note) => note.text)).toEqual([
      'Shields are large enough to fully cover a human and exert a rebuffing'
      + ' force <sup>M</sup> on enemies attempting to climb over or push through.',
      'The user or any ally may gesture for the shields to briefly part for them'
      + ' to pass, look, or shoot through.',
      'Shieldwall’s Duration scales on whether or not it is being actively'
      + ' defended by the user or their allies.',
    ]);
  });

  test('an entry whose whole frame is shifted is read from its own label', () => {
    // p37 To Arms! prints every part of itself 10.56 pt right of the recto
    // frame section 3b tabulates -- label 82.86 not 72.30, notes 106.08 not
    // 95.52, perk bodies 183.36 not 172.80 -- so indents are measured from the
    // entry's own "Paired Action:" label, never from the page margin.
    const [toArms] = abilityEntries(pageAt(37, P37));
    expect(toArms.name).toBe('To Arms!');
    expect(toArms.paired_action).toBe('Make a brief speech calling targets to action.');
    expect(toArms.meters).toEqual([
      { label: 'Essence Cost', value: 'Low–High' },
      { label: 'Cooldown', value: 'Low' },
    ]);
    expect(toArms.notes).toHaveLength(3);
    expect(toArms.sample_perks.map((perk) => perk.dedication))
      .toEqual(['In Honor of John Sinclair', 'In Honor of Lewyck']);
  });

  test('notes nest at both measured body sizes', () => {
    // p22 Surefire's notes are 13.05 tall, p76's are 11.75; each has a depth-1
    // child, and a fixed leading threshold cannot serve both.
    const surefire = abilityEntries(pageAt(22, P22))[2];
    expect(surefire.notes.map((note) => note.children.map((child) => child.text))).toEqual([
      ['If the targeted object is moving (no matter how fast), Surefire’s shot'
        + ' will Redirect <sup>H</sup> to hit it.'],
      [], [],
    ]);
    const [payItForwards] = abilityEntries(pageAt(76, P76));
    expect(payItForwards.notes.map((note) => note.children.map((child) => child.text))).toEqual([
      ['The Pitched act does not need to be in any way thematically linked to the'
        + ' user\u2019s original Paired Action; the target doesn\u2019t even need to be'
        + ' present in a scene in order for the Pitch to be made.'],
      [],
    ]);
  });

  test('"In Honor of" becomes the dedication of the perk it hangs under', () => {
    // Height 7.83, smaller than every body font, and it lands between the perk
    // names rather than after them: p19's sits 10.02 below perk 1's name and
    // p22's 10.02 below perk 2's.
    const shootout = abilityEntries(pageAt(19, P19))[2];
    expect(shootout.sample_perks.map((perk) => perk.dedication))
      .toEqual(['In Honor of Caroline', null]);
    expect(shootout.sample_perks[0].text).toBe(
      "This Ability may Teleport up to two sheathed weapons to the user's hands.");
    const surefire = abilityEntries(pageAt(22, P22))[2];
    expect(surefire.sample_perks.map((perk) => perk.dedication))
      .toEqual([null, 'In Honor of Crow']);
  });

  test('a dedication printed under an ability name belongs to the ability', () => {
    // p64 Gravity Check is the one ability in the book that carries its own
    // dedication; it hangs 18.07 below the name, where a perk's hangs 10.02
    // below its perk name.
    const gravityCheck = abilityEntries(pageAt(64, P64))[2];
    expect(gravityCheck.dedication).toBe('In Honor of Ardis');
    expect(gravityCheck.sample_perks.map((perk) => perk.dedication)).toEqual([null, null]);
    expect(gravityCheck.description).toBe(
      'Change the direction of gravity for yourself alone, falling that way instead of down.');
  });

  test('the pronunciation is its own line under the name, not a trailing run', () => {
    // Dérive prints "(Pronounced “DAY–reev”)" as a separate 7.83-tall line at
    // yMin 130.54, inside the name's own 112.47-133.35 band.
    const [derive] = abilityEntries(pageAt(61, P61));
    expect(derive.name).toBe('Dérive');
    expect(derive.pronunciation).toBe('(Pronounced “DAY–reev”)');
    expect(derive.dedication).toBeNull();
    expect(abilityEntries(pageAt(19, P19))[0].pronunciation).toBeNull();
  });

  test('Power Ratings are marked up in description, note, perk body and compounded body', () => {
    const [highNoon] = abilityEntries(pageAt(22, P22));
    expect(highNoon.description).toBe(
      'Pitch a combat action made by an enemy under pressure, including how that'
      + ' action Fizzles <sup>H</sup>.');
    const [trickshot] = abilityEntries(pageAt(19, P19));
    expect(trickshot.notes[0].text).toContain('significantly less <sup>H</sup> damage');
    expect(trickshot.sample_perks[1].text).toStartWith('Improves <sup>M</sup>');
    expect(trickshot.sample_perks[1].compound_text).toStartWith('Improves <sup>M</sup>');
  });

  test('the folio is cut out of the content band, not read as a meter', () => {
    // The page number stands alone at yMin 764.84, centred at x 304.82 -- which
    // is 232 pt right of the third entry's label, past the meter gutter -- so
    // without the upper bound it joins that entry's meter table and the table
    // no longer splits into labels and values.
    expect(abilityEntries(pageAt(19, P19))[2].meters).toEqual([
      { label: 'Essence Cost', value: 'Mid' },
      { label: 'Duration', value: 'Low' },
      { label: 'Cooldown', value: 'Mid' },
    ]);
  });

  test('an entry opens above its own name, where its meter table starts', () => {
    // Shootout's meter table begins at 546.35, 9.27 above the name at 555.62;
    // the widest such overhang in the book is 9.93 (p34 Bibliophilia).
    expect(abilityEntries(pageAt(19, P19))[2].meters[0]).toEqual(
      { label: 'Essence Cost', value: 'Mid' });
    expect(abilityEntries(pageAt(19, P19))[1].meters).toHaveLength(3);
  });

  test('an entry does not reach back into the one above it', () => {
    // The tightest page in the book: p76's second name sits 39.59 below the
    // last line of the entry above, so an entry that opened much earlier would
    // splice that line onto the front of this description.
    const entries = abilityEntries(pageAt(76, P76));
    expect(entries[1].description).toBe(
      'Pitch the appearance of a group <sup>L–H</sup> of beleaguered, harmless locals.');
    expect(entries[0].description).toBe(
      'Perform a random act of kindness to later Pitch its recipient doing so in'
      + ' turn for someone else.');
  });

  test('a description reaching towards the meter gutter is not read as a meter', () => {
    // p67 Maximum Security's description runs out to 134.97 past its own label
    // while the nearest meter label in the book starts 382.01 past it: the
    // widest gap on the page, and the only thing that separates the two.
    const maximumSecurity = abilityEntries(pageAt(67, P67))[2];
    expect(maximumSecurity.description).toBe(
      'Pitch coming across both a valuable prize and the formidable security'
      + ' measures guarding it.');
    expect(maximumSecurity.meters).toEqual([
      { label: 'Essence Cost', value: 'Mid' },
      { label: 'Cooldown', value: 'Low–High' },
    ]);
  });

  test('a meter label and value pdftotext put on one line still pair', () => {
    const [highNoon] = abilityEntries(pageAt(22, P22));
    expect(highNoon.meters).toEqual([
      { label: 'Essence Cost', value: 'Mid' },
      { label: 'Cooldown', value: 'Low–High' },
    ]);
  });

  test('a depth-1 note is not read as paired-action text', () => {
    // A note indents 23.22 and 42.42 past its label while the paired-action
    // text sits 70.02 past it; on p22 Stick ‘Em Up two of the four notes are
    // depth-1, and reading them as paired action loses their nesting.
    const stickEmUp = abilityEntries(pageAt(22, P22))[1];
    expect(stickEmUp.paired_action).toBe(
      'Calmly keep a weapon aimed at the target. Must continue to do so or Stick'
      + ' ‘Em Up will end prematurely.');
    expect(stickEmUp.notes.map((note) => note.children.length)).toEqual([2, 0]);
  });

  test('paired-action text at the near edge of the text frame is not read as a note', () => {
    // p76 shifts its whole entry frame left: the notes sit 17.04 and 36.24 past
    // the label and the paired-action text only 63.84, the closest the two
    // frames ever come.
    const [payItForwards] = abilityEntries(pageAt(76, P76));
    expect(payItForwards.paired_action).toBe(
      'Surprise a non-agent with a modest <sup>L–M</sup> gift, favor, or similar'
      + ' while getting nothing in return.');
    expect(payItForwards.notes).toHaveLength(2);
  });
});

const { coverFields, expandedTips } = require('./aspirant-extract');
const { parseStatLine } = require('./prerelease-extract');
const { CONSTRAINED_SELECTS } = require('./class-fields');

// Whole cover and Expanded Tips pages, every coordinate lifted from `pdftotext
// -bbox-layout` over the real book (geometry doc, sections 9 and 10). A cover
// is read ordinally -- the quote lies between the stat line and the
// attribution, the prose between the attribution and the Examples heading --
// so nothing short of a whole page exercises it, and the traps are fractions
// of a point wide: the three prose paragraphs are told apart by a 3.84 pt
// first-line indent, and a quote line on the Wanderer cover sets 1.02 pt from
// the examples' own indent.
//
// p18 Gunslinger: the baseline cover -- a two-line quote, six examples of
//   which one wraps, three plain Quick Tips, Challenge Level: Low.
// p24 Illusionist: a verse quote, whose lines the book joins with a literal
//   "|"; five examples; a Quick Tip that is itself an attributed quote.
// p30 Librarian: Challenge Level: Mid, the "from myth" heading variant, and a
//   quote whose second line is centred rather than flush left.
// p78 Vessel: Challenge Level: High and the shortest heading variant,
//   "Examples from pop culture include:".
// p23 Gunslinger Tips: one nested tip in each column, and a folio at x
//   304.82-319.18 that straddles the column split.
// p83 Vessel Tips: the two leadings in the book that deviate from 12.00 --
//   11.73 and 12.27, either side of an italic run -- which must read as
//   wrapped lines against the 16.00 threshold.
const P18 = [
  [202.486, 76.727, [
    [202.486, 76.727, 397.994, 24.000, '++Skill, +Sensory']]],
  [349.940, 164.755, [
    [349.940, 164.755, 551.285, 13.342, '"There\'s two kinds of people, my friend: those with'],
    [387.311, 174.755, 513.900, 13.342, 'loaded guns and those who dig."']]],
  [387.850, 190.756, [
    [387.850, 190.756, 565.200, 13.342, '— Blondie, The Good, the Bad, and the Ugly']]],
  [336.000, 206.980, [
    [336.000, 206.980, 565.200, 13.050, 'You are a jaunty gunman whose cool-headed gravitas is'],
    [336.000, 216.980, 565.202, 13.050, 'backed up by deadly firepower. You pose an immediate'],
    [336.000, 226.980, 565.200, 13.050, 'threat, effortlessly controlling the pace of any fight you are in,'],
    [336.000, 236.980, 565.196, 13.050, 'but are dependent on good positioning and vulnerable if'],
    [336.000, 246.980, 402.530, 13.050, 'taken by surprise.']]],
  [336.000, 262.980, [
    [339.840, 262.980, 565.200, 13.050, 'Conduits designing a mission for you should try to give you'],
    [336.000, 272.980, 565.200, 13.050, 'plenty of combat but add intermittent lulls for you to reload'],
    [336.000, 282.980, 565.200, 13.050, 'and flex your social muscles. You can take on almost any'],
    [336.000, 292.980, 565.204, 13.050, 'number of mundane enemies, so if the Conduit wants to'],
    [336.000, 302.980, 565.202, 13.050, 'really challenge you, they could try upping the speed, stealth,'],
    [336.000, 312.980, 444.220, 13.050, 'or durability of their threats.']]],
  [336.000, 328.980, [
    [339.840, 328.980, 565.200, 13.050, 'Grounded in classic gunfighting stories and legends,'],
    [336.000, 338.980, 565.202, 13.050, 'particularly those of the American Wild West and the'],
    [336.000, 348.980, 558.140, 13.050, 'countless films, books, and video games they have inspired.']]],
  [336.000, 370.980, [
    [336.000, 370.980, 517.980, 13.050, 'Examples from history and pop culture include:']]],
  [355.680, 389.307, [
    [355.680, 389.307, 565.200, 13.050, 'Wyatt Earp, Annie Oakley, Ned Kelly, and similar'],
    [355.680, 399.307, 417.970, 13.050, 'historical figures']]],
  [355.680, 417.634, [
    [355.680, 417.634, 493.870, 13.050, 'Roland Deschain (The Dark Tower)']]],
  [355.680, 435.961, [
    [355.680, 435.961, 519.070, 13.050, 'Arthur Morgan (Red Dead Redemption 2)']]],
  [355.680, 454.289, [
    [355.680, 454.289, 477.140, 13.050, 'Din Djarin (The Mandalorian)']]],
  [355.680, 472.616, [
    [355.680, 472.616, 495.030, 13.050, 'Hol Horse (JoJo’s Bizarre Adventure)']]],
  [355.680, 490.943, [
    [355.680, 490.943, 430.610, 13.050, 'Rango (eponymous)']]],
  [154.257, 588.551, [
    [154.257, 588.551, 276.129, 26.208, 'Quick Tips']]],
  [60.480, 619.070, [
    [60.480, 619.070, 352.908, 15.660, 'Stuck on which Stats to give your Gunslinger besides Skill and'],
    [60.480, 631.070, 266.316, 15.660, 'Sensory? Consider Reflex, Luck, or Vitality.']]],
  [60.480, 651.463, [
    [60.480, 651.463, 349.608, 15.660, 'You aren’t worthless in close-quarters, but you should still try'],
    [60.480, 663.463, 251.892, 15.660, 'to keep foes at a range wherever possible.']]],
  [60.480, 683.855, [
    [60.480, 683.855, 333.912, 15.660, 'Try to demonstrate good shooting form in-character: guns'],
    [60.480, 695.855, 356.496, 15.660, 'have heavy recoil, and their accuracy depends a lot on handling.']]],
  [99.321, 722.707, [
    [99.321, 722.707, 331.065, 26.208, 'Challenge Level: Low']]],
  [292.818, 764.837, [
    [292.818, 764.837, 307.182, 18.270, '13']]],
];

const P24 = [
  [185.134, 76.727, [
    [185.134, 76.727, 415.346, 24.000, '++Sensory, +Arcane']]],
  [339.376, 164.755, [
    [339.376, 164.755, 561.845, 13.342, '"Is all that we see or seem | But a dream within a dream?"']]],
  [480.001, 180.756, [
    [480.001, 180.756, 554.740, 13.342, '— Edgar Allen Poe']]],
  [336.000, 196.980, [
    [336.000, 196.980, 565.200, 13.050, 'You are a poised deceiver whose subtle enchantments warp'],
    [336.000, 206.980, 565.199, 13.050, 'others’ view of reality. Stealth, manipulation, and controlling'],
    [336.000, 216.980, 565.198, 13.050, 'attention are your specialties, though smart, unpredictable'],
    [336.000, 226.980, 488.660, 13.050, 'enemies can pose a serious threat to you.']]],
  [336.000, 242.980, [
    [339.840, 242.980, 565.197, 13.050, 'Conduits designing a mission for you should try to provide'],
    [336.000, 252.980, 565.200, 13.050, 'you with plenty of deceivable foes. You will thrive in classic'],
    [336.000, 262.980, 565.200, 13.050, 'stealth scenarios but have enough utility to contribute to'],
    [336.000, 272.980, 565.200, 13.050, 'most styles of mission, so if the Conduit wants to really'],
    [336.000, 282.980, 565.202, 13.050, 'challenge you, they could try making enemies who are much'],
    [336.000, 292.980, 390.250, 13.050, 'harder to fool.']]],
  [336.000, 308.980, [
    [339.840, 308.980, 565.201, 13.050, 'Grounded in the classic tropes of illusory spellcraft found in'],
    [336.000, 318.980, 565.200, 13.050, 'myth, folklore, and fantasy as well as real-life stage magic and'],
    [336.000, 328.980, 386.170, 13.050, 'trompe-l\'œil.']]],
  [336.000, 350.980, [
    [336.000, 350.980, 517.980, 13.050, 'Examples from history and pop culture include:']]],
  [355.680, 369.307, [
    [355.680, 369.307, 550.010, 13.050, 'Jean-Eugène Robert-Houdin, David Copperfield,'],
    [355.680, 379.307, 511.500, 13.050, 'Penn & Teller, and other stage magicians']]],
  [355.680, 397.634, [
    [355.680, 397.634, 536.880, 13.050, 'Oz, the Great and Terrible (The Wizard of Oz)']]],
  [355.680, 415.961, [
    [355.680, 415.961, 456.250, 13.050, 'Mysterio (Marvel Comics)']]],
  [355.680, 434.289, [
    [355.680, 434.289, 430.280, 13.050, 'Zoroark (Pokémon)']]],
  [355.680, 452.616, [
    [355.680, 452.616, 450.290, 13.050, 'Queen Iris (Xanth series)']]],
  [154.257, 588.032, [
    [154.257, 588.032, 276.129, 26.208, 'Quick Tips']]],
  [60.480, 618.551, [
    [60.480, 618.551, 363.372, 15.660, 'Stuck on which Stats to give your Illusionist besides Sensory and'],
    [60.480, 630.551, 265.656, 15.660, 'Arcane? Consider Reflex, Vitality, or Spirit.']]],
  [60.480, 650.944, [
    [60.480, 650.944, 352.500, 15.660, 'Consider the psychology of your targets: what do they expect?'],
    [60.480, 662.944, 278.808, 15.660, 'Want? Know? How can you capitalize on this?']]],
  [60.480, 683.337, [
    [60.480, 683.337, 352.560, 15.660, '“Use your Abilities to distract enemies; a Phantasm of yourself'],
    [60.480, 695.337, 356.400, 15.660, 'running away while you hide is always a solid move.” — Alex D.']]],
  [99.321, 722.188, [
    [99.321, 722.188, 331.065, 26.208, 'Challenge Level: Low']]],
  [292.818, 764.837, [
    [292.818, 764.837, 307.182, 18.270, '19']]],
];

const P30 = [
  [171.058, 76.727, [
    [171.058, 76.727, 429.422, 24.000, '++Intelligence, +Spirit']]],
  [348.626, 164.755, [
    [348.626, 164.755, 552.599, 13.342, '“When you absolutely positively have to know, ask a'],
    [430.301, 174.755, 470.901, 13.342, 'librarian.”']]],
  [435.101, 190.756, [
    [435.101, 190.756, 565.209, 13.342, '— American Library Association']]],
  [336.000, 206.980, [
    [336.000, 206.980, 565.198, 13.050, 'You are a resourceful bibliophile with troves of knowledge at'],
    [336.000, 216.980, 565.200, 13.050, 'your fingertips. You are great at fact-finding and empowering'],
    [336.000, 226.980, 565.200, 13.050, 'allies but tend to play quite slowly and are largely helpless in'],
    [336.000, 236.980, 525.410, 13.050, 'a fight, using social tools as your primary defenses.']]],
  [336.000, 252.980, [
    [339.840, 252.980, 565.200, 13.050, 'Conduits designing a mission for you should try to have a'],
    [336.000, 262.980, 565.200, 13.050, 'rich and interesting world for you to interact with. You can'],
    [336.000, 272.980, 565.202, 13.050, 'complete some missions single-handed if your huge'],
    [336.000, 282.980, 565.199, 13.050, 'information- gathering capabilities aren’t accounted for, so if'],
    [336.000, 292.980, 565.201, 13.050, 'the Conduit wants to really challenge you, they could try'],
    [336.000, 302.980, 565.200, 13.050, 'adding hidden threats to their setting to force you to play'],
    [336.000, 312.980, 392.350, 13.050, 'more carefully.']]],
  [336.000, 328.980, [
    [339.840, 328.980, 565.202, 13.050, 'Grounded in myths and clichés surrounding libraries,'],
    [336.000, 338.980, 470.060, 13.050, 'books, and the “magic of learning”.']]],
  [336.000, 360.980, [
    [336.000, 360.980, 511.390, 13.050, 'Examples from myth and pop culture include:']]],
  [355.680, 379.307, [
    [355.680, 379.307, 564.140, 13.050, 'Thoth, Tenjin, Kui Xing, Nidaba, and other deities of'],
    [355.680, 389.307, 426.910, 13.050, 'written knowledge']]],
  [355.680, 407.634, [
    [355.680, 407.634, 466.790, 13.050, 'The Pagemaster (eponymous)']]],
  [355.680, 425.961, [
    [355.680, 425.961, 428.980, 13.050, 'Lucien (Sandman)']]],
  [355.680, 444.289, [
    [355.680, 444.289, 519.630, 13.050, 'Commodore Guff (Magic: The Gathering)']]],
  [355.680, 462.616, [
    [355.680, 462.616, 519.540, 13.050, 'Theo, Cleo, and family (Between the Lions)']]],
  [154.257, 588.032, [
    [154.257, 588.032, 276.129, 26.208, 'Quick Tips']]],
  [60.480, 618.551, [
    [60.480, 618.551, 378.696, 15.660, 'Stuck on which Stats to give your Librarian besides Intelligence and'],
    [60.480, 630.551, 257.064, 15.660, 'Spirit? Consider Arcane, Sensory, or Will.']]],
  [60.480, 650.944, [
    [60.480, 650.944, 356.772, 15.660, 'Be sure you understand how to Pitch before playing this Class.']]],
  [60.480, 671.336, [
    [60.480, 671.336, 330.492, 15.660, '“Fun Fact can save you in even the most dire situations. It'],
    [60.480, 683.337, 341.880, 15.660, 'doesn\'t have to be true until you make it true.” — Jennine C.']]],
  [101.517, 710.188, [
    [101.517, 710.188, 328.869, 26.208, 'Challenge Level: Mid']]],
  [292.818, 764.837, [
    [292.818, 764.837, 307.182, 18.270, '25']]],
];

const P78 = [
  [217.138, 76.727, [
    [217.138, 76.727, 383.342, 24.000, '++Spirit, +Will']]],
  [342.246, 164.755, [
    [342.246, 164.755, 558.981, 13.342, '“The battleline between good and evil cuts through the'],
    [410.810, 174.755, 490.396, 13.342, 'heart of every man.”']]],
  [461.110, 190.756, [
    [461.110, 190.756, 565.212, 13.342, '— Aleksandr Solzhenitsyn']]],
  [336.000, 206.980, [
    [336.000, 206.980, 565.200, 13.050, 'You are an unassuming host to a baleful supernatural entity,'],
    [336.000, 216.980, 565.203, 13.050, 'which occasionally escapes to sow chaos and reap'],
    [336.000, 226.980, 565.203, 13.050, 'destruction. While normally your playstyle is social and'],
    [336.000, 236.980, 565.196, 13.050, 'supportive, you can become a devastating magical threat to'],
    [336.000, 246.980, 537.990, 13.050, 'everyone (including your allies) at a moment’s notice.']]],
  [336.000, 262.980, [
    [339.840, 262.980, 565.200, 13.050, 'Conduits designing a mission for you should try to give you'],
    [336.000, 272.980, 565.200, 13.050, 'plenty of strong emotional hooks in their plot and NPCs,'],
    [336.000, 282.980, 565.204, 13.050, 'which you will need to unlock the full potential of your kit.'],
    [336.000, 292.980, 565.203, 13.050, 'You tend to function best when given time to build'],
    [336.000, 302.980, 565.200, 13.050, 'investment and set up future plays, so if the Conduit wants'],
    [336.000, 312.980, 565.203, 13.050, 'to really challenge you they could try increasing the mission’s'],
    [336.000, 322.980, 388.970, 13.050, 'time pressure.']]],
  [336.000, 338.980, [
    [339.840, 338.980, 565.196, 13.050, 'Grounded in the trope of evil sealed within an innocent,'],
    [336.000, 348.980, 529.310, 13.050, 'particularly pervasive across modern fantasy media.']]],
  [336.000, 370.980, [
    [336.000, 370.980, 473.010, 13.050, 'Examples from pop culture include:']]],
  [355.680, 389.307, [
    [355.680, 389.307, 484.630, 13.050, 'Raven (Teen Titans/DC Universe)']]],
  [355.680, 407.634, [
    [355.680, 407.634, 519.080, 13.050, 'Tokoyami Fumikage (My Hero Academia)']]],
  [355.680, 425.961, [
    [355.680, 425.961, 498.150, 13.050, 'The Hollow Knight (Hollow Knight)']]],
  [355.680, 444.289, [
    [355.680, 444.289, 494.820, 13.050, 'Number 6 (The Umbrella Academy)']]],
  [355.680, 462.616, [
    [355.680, 462.616, 437.040, 13.050, 'Midoriko (Inuyasha)']]],
  [355.680, 480.943, [
    [355.680, 480.943, 495.400, 13.050, 'Tia Dalma (Pirates of the Caribbean)']]],
  [154.257, 588.032, [
    [154.257, 588.032, 276.129, 26.208, 'Quick Tips']]],
  [60.480, 618.551, [
    [60.480, 618.551, 353.916, 15.660, 'Stuck on what stats to give your Vessel besides Spirit and Will?'],
    [60.480, 630.551, 238.776, 15.660, 'Consider Arcane, Luck, or Resilience.']]],
  [60.480, 650.944, [
    [60.480, 650.944, 347.436, 15.660, 'This is a complicated Class: be sure you understand Turning'],
    [60.480, 662.944, 313.332, 15.660, 'Points, Altered States, & Defiance before playing it.']]],
  [60.480, 683.337, [
    [60.480, 683.337, 331.008, 15.660, '“Friendly fire is a real danger with Embrace the Darkness:'],
    [60.480, 695.337, 305.352, 15.660, 'Fill the Void can only spare one person.” — Kadrien']]],
  [95.385, 722.188, [
    [95.385, 722.188, 335.001, 26.208, 'Challenge Level: High']]],
  [292.818, 764.837, [
    [292.818, 764.837, 307.182, 18.270, '73']]],
];

const P23 = [
  [271.371, 23.233, [
    [271.371, 23.233, 352.141, 15.630, 'Gunslinger']]],
  [134.448, 98.291, [
    [134.448, 98.291, 212.592, 26.208, 'Player']]],
  [397.944, 98.291, [
    [397.944, 98.291, 502.056, 26.208, 'Conduit']]],
  [72.000, 132.008, [
    [72.000, 132.008, 257.496, 15.660, 'You can be surprisingly functional even'],
    [72.000, 144.008, 271.992, 15.660, 'without a gun. Trickshot, for example, can'],
    [72.000, 156.008, 179.148, 15.660, 'apply to any projectile.']]],
  [348.480, 132.008, [
    [348.480, 132.008, 546.048, 15.660, 'Topography is important for Gunslingers.'],
    [348.480, 144.008, 561.576, 15.660, 'They can be effective in a cramped apartment'],
    [348.480, 156.008, 570.624, 15.660, 'building or a big, open field, but each will push'],
    [348.480, 168.008, 506.700, 15.660, 'them towards different playstyles.']]],
  [72.000, 176.400, [
    [72.000, 176.400, 268.212, 15.660, 'Always be looking for potential Trickshot'],
    [72.000, 188.400, 274.752, 15.660, 'angles to get around enemy armor or cover.']]],
  [348.480, 188.400, [
    [348.480, 188.400, 561.648, 15.660, 'Force Gunslingers to reposition! They will be'],
    [348.480, 200.400, 564.060, 15.660, 'perfectly happy to camp out in a safe spot and'],
    [348.480, 212.400, 549.072, 15.660, 'take potshots the entire mission if you give'],
    [348.480, 224.400, 464.436, 15.660, 'them no reason to move.']]],
  [72.000, 208.793, [
    [72.000, 208.793, 287.724, 15.660, '“Consider your environment: check for cover,'],
    [72.000, 220.793, 282.744, 15.660, 'choke points, and verticality options, and try'],
    [72.000, 232.793, 272.148, 15.660, 'to keep your sight lines open.” — David T.']]],
  [348.480, 244.793, [
    [348.480, 244.793, 570.600, 15.660, 'Environmental hazards can play hell with guns.'],
    [348.480, 256.793, 562.176, 15.660, 'Don’t hesitate to rule that one has jammed or'],
    [348.480, 268.793, 565.836, 15.660, 'misfired if used right after getting wet or filled'],
    [348.480, 280.793, 551.148, 15.660, 'with sand. Prompt the user to actually take'],
    [348.480, 292.793, 448.512, 15.660, 'some time to clean it.']]],
  [72.000, 253.186, [
    [72.000, 253.186, 263.964, 15.660, '“You will often be the most combat-ready'],
    [72.000, 265.186, 294.456, 15.660, 'character in your squad. Be aware of the security'],
    [72.000, 277.186, 257.004, 15.660, 'you afford your fellow agents.” — Dippy']]],
  [72.000, 297.578, [
    [72.000, 297.578, 264.384, 15.660, '“Guns are loud, and you don\'t have great'],
    [72.000, 309.578, 278.052, 15.660, 'escape options. Be careful to not reveal your'],
    [72.000, 321.578, 256.020, 15.660, 'position with gunfire, or you might get'],
    [72.000, 333.578, 193.320, 15.660, 'swarmed.” — Shadowsong']]],
  [348.480, 313.186, [
    [348.480, 313.186, 570.768, 15.660, 'Scarier for a Gunslinger than a powerful enemy'],
    [348.480, 325.186, 549.348, 15.660, 'is an unknown one. If you keep them in the'],
    [348.480, 337.186, 563.748, 15.660, 'dark about what they are up against, they will'],
    [348.480, 349.186, 483.888, 15.660, 'have to play more cautiously.']]],
  [72.000, 353.971, [
    [72.000, 353.971, 275.184, 15.660, '“Do not discount the power of suppressing'],
    [72.000, 365.971, 274.656, 15.660, 'fire. Even if you can’t land a hit, keeping an'],
    [72.000, 377.971, 281.760, 15.660, 'enemy\'s head down can buy enough time for'],
    [72.000, 389.971, 256.332, 15.660, 'you or someone else to act.” — Tim M.']]],
  [367.200, 369.578, [
    [367.200, 369.578, 548.796, 15.660, '"Keeping the number of enemies vague'],
    [367.200, 381.578, 517.320, 15.660, 'helps a lot with pacing." — Xela']]],
  [348.480, 401.971, [
    [348.480, 401.971, 569.508, 15.660, 'Standoff can ruin tempo if you’re not ready for'],
    [348.480, 413.971, 567.648, 15.660, 'it. Leave extra room in your designs to account'],
    [348.480, 425.971, 546.744, 15.660, 'for a Gunslinger slowing everything down'],
    [348.480, 437.971, 413.952, 15.660, 'once or twice.']]],
  [72.000, 410.363, [
    [72.000, 410.363, 291.576, 15.660, '“A gun does not need to be fired to hold power'],
    [72.000, 422.363, 214.848, 15.660, 'in a social situation.” — Dippy']]],
  [72.000, 442.756, [
    [72.000, 442.756, 281.076, 15.660, '“Your core gameplan is not particularly Stat-'],
    [72.000, 454.756, 279.732, 15.660, 'reliant: your two pluses in Skill will often be'],
    [72.000, 466.756, 287.856, 15.660, 'good enough to facilitate gunplay, leaving you'],
    [72.000, 478.756, 294.612, 15.660, 'with more pluses to put elsewhere.” — Reece D.']]],
  [348.480, 458.363, [
    [348.480, 458.363, 526.752, 15.660, '"An obvious weak point is trivial for a'],
    [348.480, 470.363, 562.128, 15.660, 'Gunslinger to hit; present them with enemies'],
    [348.480, 482.363, 564.228, 15.660, 'without clear weaknesses so they have to learn'],
    [348.480, 494.363, 509.604, 15.660, 'about the target first." — Tomáš S.']]],
  [72.000, 499.148, [
    [72.000, 499.148, 283.968, 15.660, '“With the right Pitch, Trickshot can ricochet'],
    [72.000, 511.148, 254.772, 15.660, 'off of non-solid surfaces.” — Gemini S.']]],
  [348.480, 514.756, [
    [348.480, 514.756, 569.088, 15.660, '"Organized, militarily competent enemies with'],
    [348.480, 526.756, 557.256, 15.660, 'good positioning are a really engaging threat'],
    [348.480, 538.756, 486.132, 15.660, 'for Gunslingers." — Tomáš S.']]],
  [72.000, 531.541, [
    [72.000, 531.541, 267.648, 15.660, '“You can Energywork Shootout to affect'],
    [72.000, 543.541, 275.160, 15.660, 'weapons you find on-mission.” — David T.']]],
  [348.480, 559.148, [
    [348.480, 559.148, 565.308, 15.660, '“Give a Gunslinger interesting things to shoot'],
    [348.480, 571.148, 566.688, 15.660, 'other than people — a precarious chandelier, a'],
    [348.480, 583.148, 530.880, 15.660, 'security camera, or similar.” — Rich D.']]],
  [72.000, 563.934, [
    [72.000, 563.934, 294.972, 15.660, '“Guns can overheat during Shootout.” — Tim M.']]],
  [72.000, 584.326, [
    [72.000, 584.326, 270.936, 15.660, '“Cross-Class a communication item if you'],
    [72.000, 596.326, 265.704, 15.660, 'often split from your squad to take up an'],
    [72.000, 608.326, 227.880, 15.660, 'overwatch position.” — David T.']]],
  [348.480, 603.541, [
    [348.480, 603.541, 558.384, 15.660, '“Allow a Gunslinger to be a threat outside of'],
    [348.480, 615.541, 564.240, 15.660, 'combat. They don’t even need to fire a shot to'],
    [348.480, 627.541, 517.968, 15.660, 'be intimidating and cool.” — Lee H.']]],
  [90.720, 628.719, [
    [90.720, 628.719, 273.648, 15.660, '“Don’t go running off unless you warn'],
    [90.720, 640.719, 226.320, 15.660, 'your squad first.” — Tim M.']]],
  [304.818, 764.837, [
    [304.818, 764.837, 319.182, 18.270, '18']]],
];

const P83 = [
  [291.923, 23.233, [
    [291.923, 23.233, 331.593, 15.630, 'Vessel']]],
  [134.448, 98.291, [
    [134.448, 98.291, 212.592, 26.208, 'Player']]],
  [397.944, 98.291, [
    [397.944, 98.291, 502.056, 26.208, 'Conduit']]],
  [72.000, 132.008, [
    [72.000, 132.008, 287.844, 15.660, 'This Class’s mere presence can warp a mission'],
    [72.000, 144.008, 289.020, 15.660, 'more than most others. Be sure to review your'],
    [72.000, 156.008, 255.276, 15.660, 'powers with your playgroup before the'],
    [72.000, 168.008, 291.432, 15.660, 'mission, discussing strategy and contingencies.']]],
  [348.480, 132.008, [
    [348.480, 132.008, 541.560, 15.660, 'Be ready to enforce Altered States when'],
    [348.480, 144.008, 457.800, 15.660, 'conduiting for a Vessel.']]],
  [348.480, 164.400, [
    [348.480, 164.400, 564.156, 15.660, 'A Vessel functions best when they care. Try to'],
    [348.480, 176.400, 532.692, 15.660, 'invest them in the mission as quickly as'],
    [348.480, 188.400, 567.192, 15.660, 'possible with punchy plot hooks or leave room'],
    [348.480, 200.400, 558.708, 15.660, 'for meaningful interactions with teammates.']]],
  [72.000, 188.400, [
    [72.000, 188.400, 287.472, 15.660, 'This is a very acting-heavy class and fluctuates'],
    [72.000, 200.400, 267.216, 15.660, 'dramatically between moods — always be'],
    [72.000, 212.400, 270.060, 15.660, 'looking for ways to prime your character’s'],
    [72.000, 224.400, 223.716, 15.660, 'feelings for future Ability usage.']]],
  [348.480, 220.793, [
    [348.480, 220.793, 552.396, 15.660, 'If a player desperately needs a Defiance but'],
    [348.480, 232.793, 557.868, 15.660, 'can’t quite imagine how to do so themselves,'],
    [348.480, 244.793, 562.788, 15.660, 'walk them through their character’s thoughts'],
    [348.480, 256.793, 569.064, 15.660, 'and feelings. Use simple questions to ease them'],
    [348.480, 268.793, 562.680, 15.660, 'into their character’s mindset (e.g. “When was'],
    [348.480, 280.793, 536.532, 15.660, 'the last time your character felt this way?”)']]],
  [90.720, 244.793, [
    [90.720, 244.793, 277.692, 15.660, '“Your character’s emotional nature may'],
    [90.720, 256.793, 287.796, 15.660, 'lead them to very different ideas of how to'],
    [90.720, 268.793, 263.976, 15.660, 'proceed during a mission, sometimes'],
    [90.720, 280.793, 288.444, 15.660, 'directly orthogonal to those of their team.'],
    [90.720, 292.793, 247.464, 15.660, 'Proceed with caution.” — Guy A.']]],
  [348.480, 301.186, [
    [348.480, 301.186, 554.004, 15.660, 'Remember that you can ask to use Insidious'],
    [348.480, 313.186, 452.232, 15.660, 'Whispers on an NPC.']]],
  [72.000, 313.186, [
    [72.000, 313.186, 260.976, 15.660, 'While it’s not mandatory, detailing your'],
    [72.000, 325.186, 285.864, 15.660, 'Vessel’s entity in broad strokes as part of their'],
    [72.000, 337.186, 273.180, 15.660, 'Backstory is often a good idea to give you a'],
    [72.000, 349.186, 218.544, 15.660, 'thematic basis for your powers.']]],
  [367.200, 333.578, [
    [367.200, 333.578, 571.008, 15.660, '“This can be an ideal plot driver.” — Vera C.']]],
  [348.480, 353.971, [
    [348.480, 353.971, 560.340, 15.660, '“Be sure you understand Galvanizing before'],
    [348.480, 365.971, 509.496, 15.660, 'conduiting for this Class.” — Xela']]],
  [72.000, 369.578, [
    [72.000, 369.578, 279.312, 15.660, 'You can Corrupt enemies by sharing secrets'],
    [72.000, 381.578, 243.588, 15.660, 'from Insidious Whispers with them.']]],
  [348.480, 386.363, [
    [348.480, 386.363, 570.816, 15.660, '“Be ready to remind players about Corruption,'],
    [348.480, 398.363, 553.596, 15.660, 'especially if new to the Vessel.” — Jennine C.']]],
  [90.720, 401.971, [
    [90.720, 401.971, 269.772, 15.660, 'Be careful of sharing secrets with your'],
    [90.720, 413.971, 244.608, 15.660, 'team, weighing the downsides of'],
    [90.720, 425.971, 285.840, 15.660, 'Corruption before doing so.” — Tomáš S.']]],
  [367.200, 418.756, [
    [367.200, 418.756, 557.952, 15.660, '“Corruption does not go away; in fact, it'],
    [367.200, 430.756, 514.968, 15.660, 'intensifies over time.” — Lee H.']]],
  [72.000, 446.363, [
    [72.000, 446.363, 290.592, 15.660, 'Make good use of Assembly (pg. 126)! It could'],
    [72.000, 458.363, 288.048, 15.660, 'lay the character groundwork for a critical Fill'],
    [72.000, 470.363, 206.232, 15.660, 'the Void during the mission.']]],
  [348.480, 451.148, [
    [348.480, 451.148, 561.708, 15.660, '“Have a rough idea of what Corruption might'],
    [348.480, 463.148, 509.832, 15.660, 'look like for key NPCs.” — Vera C.']]],
  [348.480, 483.541, [
    [348.480, 483.541, 560.772, 15.660, 'Player-vs-Player scenarios are all but inevitable'],
    [348.480, 495.541, 559.056, 15.660, 'with this Class (see “Inter-Player Resolution” in'],
    [348.483, 507.272, 570.840, 16.010, 'Advent , pg. 63). If your playgroup isn’t ready for'],
    [348.480, 519.541, 559.968, 15.660, 'this, do not let the Vessel be played.” — Lee H.']]],
  [72.000, 490.756, [
    [72.000, 490.756, 291.732, 15.660, '“This Class has one of the most synergized kits'],
    [72.000, 502.756, 270.288, 15.660, 'in the game. Look for combos and ways to'],
    [72.000, 514.756, 203.724, 15.660, 'blend your powers!" — Xela']]],
  [72.000, 535.148, [
    [72.000, 535.148, 268.140, 15.660, '“Remind your fellow players that they can'],
    [72.000, 547.148, 264.876, 15.660, 'activate Insidious Whispers on their own'],
    [72.000, 559.148, 178.980, 15.660, 'characters.” — Rich D.']]],
  [348.480, 539.934, [
    [348.480, 539.934, 567.036, 15.660, '“This Class depends on Turning Points more'],
    [348.480, 551.934, 560.580, 15.660, 'than most, so don’t be afraid to pump up the'],
    [348.480, 563.934, 435.216, 15.660, 'drama.” — Lacara']]],
  [72.000, 579.541, [
    [72.000, 579.541, 258.024, 15.660, '“While Corruption must be negative, it'],
    [72.000, 591.541, 253.188, 15.660, 'doesn’t necessarily need to be evil. Any'],
    [72.000, 603.541, 229.620, 15.660, 'emotion taken to its extremes can'],
    [72.000, 615.541, 211.284, 15.660, 'hypothetically work.” — Xela']]],
  [348.480, 584.326, [
    [348.480, 584.326, 566.352, 15.660, '“Before you conduit for a Vessel, chat with the'],
    [348.480, 596.326, 552.240, 15.660, 'player a bit: ask about the character’s entity'],
    [348.480, 608.326, 538.284, 15.660, 'and figure out the player’s veterancy and'],
    [348.480, 620.326, 515.220, 15.660, 'comfort levels with acting.” — Xela']]],
  [72.000, 635.934, [
    [72.000, 635.934, 294.276, 15.660, '“Be mindful of positioning and communication.'],
    [72.000, 647.934, 258.924, 15.660, 'They are important for all your Abilities,'],
    [72.000, 659.934, 280.104, 15.660, 'especially Embrace the Darkness.” — Tim M.']]],
  [348.480, 640.719, [
    [348.480, 640.719, 533.436, 15.660, '“Even though Insidious Whispers must'],
    [348.480, 652.719, 570.660, 15.660, 'truthfully convey a secret, you can make it more'],
    [348.480, 664.719, 554.100, 15.660, 'tricky and interesting by adding incomplete'],
    [348.480, 676.719, 540.816, 15.660, 'truths, playing to biases, or similar twists'],
    [348.480, 688.719, 546.312, 15.660, 'wherever you feel a player is asking for too'],
    [348.480, 700.719, 470.328, 15.660, 'much out of it.” — Lee H.']]],
  [72.000, 680.326, [
    [72.000, 680.326, 266.508, 15.660, '“While you can be terrifying, you aren’t a'],
    [72.000, 692.326, 285.096, 15.660, 'conventional fighter. Find other characters to'],
    [72.000, 704.326, 292.356, 15.660, 'shield you from danger and use Fill the Void to'],
    [72.000, 716.326, 234.420, 15.660, 'protect them in turn.” — Tomáš S.']]],
  [304.818, 764.837, [
    [304.818, 764.837, 319.182, 18.270, '78']]],
];

// The Examples heading prints six different strings across the twelve covers;
// every one is stored as printed, so the pattern is what identifies it.
const EXAMPLES_HEADINGS = [
  'Examples from history and pop culture include:',
  'Examples from myth and pop culture include:',
  'Examples from folklore and pop culture include:',
  'Examples from pop culture & contemporary history include:',
  'Examples from pop culture include:',
  'Examples from history & pop culture include:',
];

const proseBlocks = (cover) => cover.filter((blk) => blk[0] === 336.0 && blk[2].length > 1);

describe('cover pages', () => {
  test('the stat line the book prints needs no change to parseStatLine', () => {
    // "++Skill, +Sensory" is comma-separated where the other book uses "/";
    // the shared splitter already accepts both, and this is the guard that
    // says so, since editing it would alter a token-verified artifact.
    expect(parseStatLine('++Skill, +Sensory')).toEqual({ skill: 2, sensory: 1 });
    expect(coverFields(pageAt(18, P18)).stat_spread).toEqual({ skill: 2, sensory: 1 });
    expect(coverFields(pageAt(18, P18)).stat_line).toBe('++Skill, +Sensory');
  });

  test('a stat line carrying a footnote marker is refused rather than dropped', () => {
    // The other book marks a footnoted stat with a trailing "*" and prints the
    // note under the stat line. No Aspirant cover prints either, which is why
    // stat_note is null; the marker is what would say otherwise.
    expect(coverFields(pageAt(18, P18)).stat_note).toBeNull();
    const starred = P18.map((blk) => (blk[1] === 76.727
      ? [blk[0], blk[1], [[...blk[2][0].slice(0, 4), '++Skill*, +Sensory']]]
      : blk));
    expect(() => coverFields(pageAt(18, starred))).toThrow(/Gunslinger/);
  });

  test('the three prose paragraphs split on the 3.84 first-line indent', () => {
    const gunslinger = coverFields(pageAt(18, P18));
    expect(gunslinger.overview).toStartWith('You are a jaunty gunman whose cool-headed gravitas');
    expect(gunslinger.overview).toEndWith('vulnerable if taken by surprise.');
    expect(gunslinger.conduit_notes).toStartWith('Conduits designing a mission for you should try');
    expect(gunslinger.conduit_notes).toEndWith('or durability of their threats.');
    expect(gunslinger.grounding).toBe('Grounded in classic gunfighting stories and legends,'
      + ' particularly those of the American Wild West and the countless films, books, and'
      + ' video games they have inspired.');
  });

  test('the paragraphs split on the indent, not on pdftotext’s block grouping', () => {
    // The blocks agree with the indent on all twelve covers, but the box they
    // agree on -- 336.00-565.20 at line height 13.05 -- also fits the Examples
    // heading on the Freerunner cover, so the indent is what is read.
    const prose = proseBlocks(P18);
    expect(prose).toHaveLength(3);
    const merged = [...P18.filter((blk) => !prose.includes(blk)),
      [336.0, prose[0][1], prose.flatMap((blk) => blk[2])]];
    expect(coverFields(pageAt(18, merged))).toEqual(coverFields(pageAt(18, P18)));
  });

  test('a paragraph that does not open as the book opens it throws, naming the class', () => {
    // A silently mis-assigned paragraph would put the Conduit's guidance into
    // the player-facing overview, which neither a count nor a token check would
    // catch, so all three openings are asserted. Each rewording below still
    // matches a loosened form of its own rule -- /^You /, /^Conduits / and
    // /^Grounded / -- so the test fails if any of the three is weakened.
    const reworded = (yMin, opening) => P18.map((blk) => (blk[1] === yMin
      ? [blk[0], blk[1], blk[2].map((ln, i) => (i === 0 ? [...ln.slice(0, 4), opening] : ln))]
      : blk));
    const cases = [
      [206.98, 1, 'You play a jaunty gunman whose cool-headed gravitas is'],
      [262.98, 2, 'Conduits running a mission for you should try to give you'],
      [328.98, 3, 'Grounded within classic gunfighting stories and legends,'],
    ];
    for (const [yMin, index, opening] of cases) {
      expect(() => coverFields(pageAt(18, reworded(yMin, opening))))
        .toThrow(`Gunslinger cover paragraph ${index} opens "${opening.slice(0, 40)}"`);
    }
  });

  test('a list line at an unknown indent throws rather than being dropped', () => {
    // Examples set at 355.68 and Quick Tips at 60.48 on all twelve covers, and
    // between each list's heading and the heading that closes it there is
    // nothing else. A line off its list's indent is a line the record would
    // otherwise lose in silence, the way the prose band already refuses to.
    const shifted = (yMin, dx) => P18.map((blk) => (blk[1] === yMin
      ? [blk[0] + dx, blk[1], blk[2].map((ln) => [ln[0] + dx, ...ln.slice(1)])]
      : blk));
    expect(() => coverFields(pageAt(18, shifted(417.634, TIPS_NOTE_STEP))))
      .toThrow('Gunslinger cover list line at no known indent: Roland Deschain (The Dark Tower)');
    expect(() => coverFields(pageAt(18, shifted(651.463, RECTO_SHIFT))))
      .toThrow(/Gunslinger cover list line at no known indent: You aren/);
  });

  test('the attribution is split off the quote and the em dash is dropped', () => {
    // The class view prints the dash itself, so storing it would double it.
    const gunslinger = coverFields(pageAt(18, P18));
    expect(gunslinger.quote).toBe('"There\'s two kinds of people, my friend: those with'
      + ' loaded guns and those who dig."');
    expect(gunslinger.quote_source).toBe('Blondie, The Good, the Bad, and the Ugly');
    expect(coverFields(pageAt(30, P30)).quote)
      .toBe('“When you absolutely positively have to know, ask a librarian.”');
    expect(coverFields(pageAt(30, P30)).quote_source).toBe('American Library Association');
  });

  test('a verse quote keeps the literal "|" the book sets between its lines', () => {
    const illusionist = coverFields(pageAt(24, P24));
    expect(illusionist.quote).toBe('"Is all that we see or seem | But a dream within a dream?"');
    expect(illusionist.quote_source).toBe('Edgar Allen Poe');
  });

  test('examples_heading is stored as printed, and all six variants match the pattern', () => {
    expect(coverFields(pageAt(18, P18)).examples_heading)
      .toBe('Examples from history and pop culture include:');
    expect(coverFields(pageAt(30, P30)).examples_heading)
      .toBe('Examples from myth and pop culture include:');
    expect(coverFields(pageAt(78, P78)).examples_heading)
      .toBe('Examples from pop culture include:');
    for (const heading of EXAMPLES_HEADINGS) {
      expect(heading).toMatch(/^Examples from .+ include:$/);
    }
  });

  test('the examples are one entry each, however many lines the entry wraps to', () => {
    // Items sit 18.33 apart and wrap at 10.00, so the list is cut on the same
    // leading rule the notes use rather than on pdftotext's blocks.
    expect(coverFields(pageAt(18, P18)).examples).toEqual([
      'Wyatt Earp, Annie Oakley, Ned Kelly, and similar historical figures',
      'Roland Deschain (The Dark Tower)',
      'Arthur Morgan (Red Dead Redemption 2)',
      'Din Djarin (The Mandalorian)',
      'Hol Horse (JoJo’s Bizarre Adventure)',
      'Rango (eponymous)',
    ]);
    expect(coverFields(pageAt(24, P24)).examples).toEqual([
      'Jean-Eugène Robert-Houdin, David Copperfield, Penn & Teller, and other stage magicians',
      'Oz, the Great and Terrible (The Wizard of Oz)',
      'Mysterio (Marvel Comics)',
      'Zoroark (Pokémon)',
      'Queen Iris (Xanth series)',
    ]);
  });

  test('challenge_level parses to one of the three values the column accepts', () => {
    expect(coverFields(pageAt(18, P18)).challenge_level).toBe('Low');
    expect(coverFields(pageAt(30, P30)).challenge_level).toBe('Mid');
    expect(coverFields(pageAt(78, P78)).challenge_level).toBe('High');
    for (const [pdfPage, cover] of [[18, P18], [30, P30], [78, P78]]) {
      expect(CONSTRAINED_SELECTS.challenge_level.values)
        .toContain(coverFields(pageAt(pdfPage, cover)).challenge_level);
    }
  });

  test('the three Quick Tips come back as a list under the heading the book prints', () => {
    const gunslinger = coverFields(pageAt(18, P18));
    expect(gunslinger.tips_heading).toBe('Quick Tips');
    expect(gunslinger.tips).toEqual([
      'Stuck on which Stats to give your Gunslinger besides Skill and Sensory?'
        + ' Consider Reflex, Luck, or Vitality.',
      'You aren’t worthless in close-quarters, but you should still try to keep foes'
        + ' at a range wherever possible.',
      'Try to demonstrate good shooting form in-character: guns have heavy recoil,'
        + ' and their accuracy depends a lot on handling.',
    ]);
  });

  test('a Quick Tip that is an attributed quote stays one tip', () => {
    // Nothing marks an editorial tip off from a contributor's quote; the em
    // dash is inside the same run of lines.
    expect(coverFields(pageAt(30, P30)).tips[2])
      .toBe('“Fun Fact can save you in even the most dire situations. It doesn\'t have'
        + ' to be true until you make it true.” — Jennine C.');
    expect(coverFields(pageAt(30, P30)).tips).toHaveLength(3);
  });

  test('the folio and the Challenge Level line are not read as Quick Tips', () => {
    // Both sit below the Quick Tips heading; only the tips set at x 60.48.
    const vessel = coverFields(pageAt(78, P78));
    expect(vessel.tips).toHaveLength(3);
    expect(vessel.tips.join(' ')).not.toContain('Challenge');
    expect(vessel.tips.join(' ')).not.toContain('73');
  });
});

describe('the Expanded Tips spread', () => {
  test('the page splits into a Player list and a Conduit list', () => {
    const gunslinger = expandedTips(pageAt(23, P23));
    expect(gunslinger.player).toHaveLength(12);
    expect(gunslinger.conduit).toHaveLength(9);
    expect(gunslinger.player[0].text).toBe('You can be surprisingly functional even without a gun.'
      + ' Trickshot, for example, can apply to any projectile.');
    expect(gunslinger.conduit[0].text).toBe('Topography is important for Gunslingers. They can be'
      + ' effective in a cramped apartment building or a big, open field, but each will push them'
      + ' towards different playstyles.');
  });

  test('a tip indented 18.72 becomes a child of the tip above it', () => {
    const gunslinger = expandedTips(pageAt(23, P23));
    expect(gunslinger.player.map((note) => note.children.map((child) => child.text)))
      .toEqual([[], [], [], [], [], [], [], [], [], [], [],
        ['“Don’t go running off unless you warn your squad first.” — Tim M.']]);
    expect(gunslinger.conduit[3].children.map((child) => child.text))
      .toEqual(['"Keeping the number of enemies vague helps a lot with pacing." — Xela']);
  });

  test('an attributed quote stays one tip, dash and all', () => {
    expect(expandedTips(pageAt(23, P23)).player[10].text)
      .toBe('“Guns can overheat during Shootout.” — Tim M.');
  });

  test('each column is cut on its own leadings, not on one list of both', () => {
    // The two columns interleave down the page and share no baselines. Sorting
    // both into one list puts a 12.00 pt step across the gutter wherever a tip
    // ends, which reads as a wrapped line: p23 and p83 each collapse to a
    // single note.
    const vessel = expandedTips(pageAt(83, P83));
    expect(vessel.player).toHaveLength(10);
    expect(vessel.conduit).toHaveLength(11);
    const everyLine = pageAt(83, P83).blocks.flatMap((blk) => blk.lines)
      .filter((ln) => ln.yMin > 124 && ln.yMin < 750);
    expect(noteTree(everyLine, { step: TIPS_NOTE_STEP, threshold: TIPS_NOTE_THRESHOLD }))
      .toHaveLength(1);
  });

  test('the two leadings that deviate from 12.00 still read as wrapped lines', () => {
    // p83's Conduit column sets an italic book title mid-note, and the lines
    // either side of it lead 11.73 and 12.27 rather than 12.00. Both are a long
    // way below the 16.00 threshold, so the note stays whole.
    expect(expandedTips(pageAt(83, P83)).conduit[7].text)
      .toBe('Player-vs-Player scenarios are all but inevitable with this Class (see'
        + ' “Inter-Player Resolution” in Advent , pg. 63). If your playgroup isn’t ready'
        + ' for this, do not let the Vessel be played.” — Lee H.');
  });

  test('the folio is not read as a tip', () => {
    // It sets at x 304.82-319.18, straddling the column split, and 124 pt below
    // the last tip -- so only the content band keeps it out of the Player list.
    const gunslinger = expandedTips(pageAt(23, P23));
    expect(gunslinger.player[11].text).not.toContain('18');
    expect(gunslinger.player.map((note) => note.text).join(' ')).not.toContain('Gunslinger');
  });
});

const { extractClass, extractBook } = require('./aspirant-extract');

// PDF page 21, Gunslinger recto: columns 3 and 4 of the signature spread, and
// the one page kind in a class that prints no running header. Every block that
// carries content, in pdftotext's own emission order, which is not y-order.
const P21 = [
  [57.120, 117.568, [[57.120, 117.568, 123.248, 20.880, 'Wild Rag']]],
  [333.600, 117.568, [[333.600, 117.568, 418.304, 20.880, 'Bowie Knife']]],
  [81.120, 162.693, [
    [81.120, 162.693, 286.445, 13.050, [[81.120, 146.930, 'Provides a Ward'], [148.358, 151.775, 'L', 163.562, 7.608], [153.905, 286.445, 'against breathable hazards such as']]],
    [81.120, 172.693, 137.520, 13.050, 'dust or fumes.'],
    [81.120, 187.020, 275.330, 13.050, 'While the owner’s face is mostly concealed by this'],
    [81.120, 197.020, 287.990, 13.050, 'item, they may be Recognized (under a pseudonym)'],
    [81.120, 207.020, 242.170, 13.050, 'as a famous gunfighter (Mid Cooldown).']]],
  [412.965, 202.928, [[412.965, 202.928, 487.035, 11.745, 'Default Enchantment']]],
  [376.800, 216.882, [
    [424.800, 216.882, 555.642, 11.745, 'Show off this knife while denigrating'],
    [424.800, 225.882, 551.538, 11.745, 'someone else’s weapon to make that'],
    [376.800, 234.882, 568.462, 11.745, [[376.800, 431.583, 'weapon smaller'], [432.869, 437.701, 'M', 235.664, 6.847], [439.618, 568.462, 'and this knife proportionately larger']]],
    [376.800, 243.882, 495.681, 11.745, '(Mid Duration, Mid Cooldown).']]],
  [331.200, 216.896, [[331.200, 216.896, 405.315, 11.745, 'Now That\'s a Knife']]],
  [136.485, 222.128, [[136.485, 222.128, 210.555, 11.745, 'Default Enchantment']]],
  [148.320, 236.082, [
    [148.320, 236.082, 279.294, 11.745, [[148.320, 208.944, 'Greatly improves'], [210.230, 214.422, 'H', 236.864, 6.847], [216.339, 279.294, 'Defiances against']]],
    [148.320, 245.082, 266.085, 11.745, 'pain; doing so will also Stabilize a'],
    [148.320, 254.082, 273.303, 11.745, 'relevant injury for a Low Duration.']]],
  [333.600, 293.242, [[333.600, 293.242, 386.752, 20.880, 'Rollups']]],
  [57.120, 303.568, [[57.120, 303.568, 104.096, 20.880, 'Duster']]],
  [474.890, 303.529, [[474.890, 303.529, 511.200, 13.050, 'Quantity']]],
  [357.600, 347.967, [
    [357.600, 347.967, 545.555, 13.050, [[357.600, 402.350, 'Galvanizes'], [403.778, 407.195, 'L', 348.836, 7.608], [409.325, 545.555, 'the smoker towards being cool and']]],
    [357.600, 357.967, 394.310, 13.050, 'collected.'],
    [357.600, 372.294, 571.080, 13.050, 'A fitting local ingredient may be added to this cigarette'],
    [357.600, 382.294, 569.121, 13.050, [[357.600, 457.610, 'to grant the user Affinity'], [458.975, 464.344, 'M', 383.163, 7.608], [466.411, 569.121, 'with locals while smoking,']]],
    [357.600, 392.294, 569.598, 13.050, [[357.600, 467.270, 'but you must Pitch a minor'], [468.635, 472.051, 'L', 393.163, 7.608], [474.118, 569.598, 'thematic downside to be']]],
    [357.600, 402.294, 553.790, 13.050, 'incurred in the process such as incessant coughing,'],
    [357.600, 412.294, 526.150, 13.050, 'ringing in ears, lips turning blue, or similar.']]],
  [136.485, 414.128, [[136.485, 414.128, 210.555, 11.745, 'Default Enchantment']]],
  [412.965, 427.801, [[412.965, 427.801, 487.035, 11.745, 'Default Enchantment']]],
  [54.720, 428.082, [[54.720, 428.082, 131.895, 11.745, 'Man With No Name']]],
  [52.320, 428.082, [
    [148.320, 428.082, 267.273, 11.745, 'Coolly rebuffing a non-ally\'s social'],
    [148.320, 437.082, 279.702, 11.745, 'advances will steadily Galvanize them'],
    [52.320, 446.082, 275.117, 11.745, [[52.320, 144.138, 'towards being increasingly'], [145.295, 155.878, 'L–H', 446.864, 6.847], [157.667, 275.117, 'curious about the owner but leave']]],
    [52.320, 455.082, 294.231, 11.745, 'them proportionately less able to recall the owner once they part ways.']]],
  [182.180, 513.055, [[182.180, 513.055, 234.720, 13.050, 'Ammunition']]],
  [534.285, 303.529, [[534.285, 303.529, 552.915, 13.050, 'Low']]],
  [333.600, 318.992, [
    [333.600, 318.992, 570.463, 14.355, 'Handmade cigarettes, assembled from loose tobacco and'],
    [333.600, 329.992, 391.691, 14.355, 'rolling paper.']]],
  [81.120, 329.493, [
    [81.120, 329.493, 289.568, 13.050, [[81.120, 146.930, 'Provides a Ward'], [148.358, 153.728, 'M', 330.362, 7.608], [155.858, 289.568, 'against all environmental hazards,']]],
    [81.120, 339.493, 288.780, 13.050, 'including water, grit, inclement weather, and similar.'],
    [100.320, 353.820, 255.210, 13.050, 'This Ward extends to the owner’s other'],
    [100.320, 363.820, 267.057, 13.050, [[100.320, 258.610, 'Equipment, for which it is even stronger'], [260.038, 264.697, 'H', 364.689, 7.608], [264.697, 267.057, '.']]],
    [81.120, 378.147, 283.910, 13.050, 'While acting menacing, the owner will appear more'],
    [81.120, 388.147, 292.488, 13.050, [[81.120, 192.180, 'armed than they actually are'], [193.608, 198.978, 'M', 389.016, 7.608], [201.108, 292.488, 'to non-allies, as though']]],
    [81.120, 398.147, 270.340, 13.050, 'this Duster were concealing additional weapons.']]],
  [57.120, 502.768, [[57.120, 502.768, 125.840, 20.880, 'Derringer']]],
  [538.075, 127.855, [[538.075, 127.855, 559.955, 13.050, 'High']]],
  [357.600, 143.493, [
    [357.600, 143.493, 559.640, 13.050, 'Non-combat survivalist activities this knife is used for'],
    [357.600, 153.493, 571.183, 13.050, [[357.600, 562.350, '(such as skinning or whittling) are accomplished faster'], [563.541, 568.910, 'M', 154.362, 7.608], [568.823, 571.183, '.']]],
    [376.800, 167.820, 562.260, 13.050, 'This knife\'s deadliness improves as it is used for'],
    [376.800, 177.820, 559.120, 13.050, 'such activities by its owner (up to High after a'],
    [376.800, 187.820, 439.350, 13.050, 'Mid Duration).']]],
  [57.120, 144.018, [[57.120, 144.018, 292.619, 14.355, 'Kerchief worn on the face, covering the nose and mouth.']]],
  [54.720, 236.082, [[54.720, 236.082, 109.269, 11.745, 'Bite the Bullet']]],
  [455.590, 127.855, [[455.590, 127.855, 522.030, 13.050, 'Durability Boost']]],
  [331.200, 441.756, [[331.200, 441.756, 387.918, 11.745, 'Smokey Bandit']]],
  [376.800, 441.756, [
    [424.800, 441.756, 551.079, 11.745, 'The owner may take a massive drag,'],
    [424.800, 450.756, 566.649, 11.745, 'using up an entire cigarette in one go, to'],
    [424.800, 459.756, 563.821, 11.745, [[424.800, 534.258, 'exhale a thick cloud of choking'], [535.544, 540.376, 'M', 460.538, 6.847], [542.293, 563.821, 'fumes']]],
    [376.800, 468.756, 569.463, 11.745, '(to which they are immune), enough to fill a Low area.']]],
  [342.870, 451.777, [[342.870, 451.777, 403.530, 7.830, 'In Honor of Cowboy Will']]],
  [261.815, 513.055, [[261.815, 513.055, 272.425, 13.050, '4x']]],
  [333.600, 518.116, [[333.600, 518.116, 399.760, 20.880, 'Hip Flask']]],
  [57.120, 528.518, [
    [57.120, 528.518, 293.532, 14.355, 'Tiny, double-barreled pistol; surprisingly loud, very low'],
    [57.120, 539.518, 120.249, 14.355, 'effective range.']]],
  [493.200, 528.403, [[493.200, 528.403, 511.200, 13.050, 'Uses']]],
  [538.295, 528.403, [[538.295, 528.403, 548.905, 13.050, '3x']]],
  [357.600, 544.041, [
    [357.600, 544.041, 554.057, 13.050, [[357.600, 389.240, 'Rapidly'], [397.457, 554.057, 'inebriates any drinker besides the owner,']]],
    [357.600, 554.041, 566.760, 13.050, 'though they will sober up after only a Mid Duration.'],
    [376.800, 568.368, 552.590, 13.050, 'A Use is only spent if this inebriation occurs.'],
    [357.600, 582.695, 568.920, 13.050, 'After taking a swig, the owner may offer this flask to a'],
    [357.600, 592.695, 537.548, 13.050, [[357.600, 420.520, 'rival to Compel'], [421.948, 427.318, 'M', 593.564, 7.608], [429.448, 537.548, 'that target to drink in turn.']]]]],
  [390.668, 544.910, [[390.668, 544.910, 395.327, 7.608, 'H']]],
  [81.120, 557.493, [
    [81.120, 557.493, 253.628, 13.050, [[81.120, 139.980, 'You may Pitch'], [141.408, 146.778, 'M', 558.362, 7.608], [148.908, 253.628, 'this gun’s location on your']]],
    [81.120, 567.493, 199.780, 13.050, 'character’s person at any time.'],
    [81.120, 581.820, 270.604, 13.050, [[81.120, 114.800, 'Deadlier'], [116.213, 126.880, 'L–H', 583.609, 6.847], [128.994, 270.604, 'when fired outside of active combat,']]],
    [81.120, 591.820, 294.210, 13.050, 'scaling on how tense the situation is (Mid Cooldown).']]],
  [136.485, 607.327, [[136.485, 607.327, 210.555, 11.745, 'Default Enchantment']]],
  [412.965, 608.275, [[412.965, 608.275, 487.035, 11.745, 'Default Enchantment']]],
  [54.720, 621.282, [[54.720, 621.282, 121.761, 11.745, 'Pocket Advantage']]],
  [52.320, 621.282, [
    [148.320, 621.282, 288.558, 11.745, 'Firing this weapon through the owner’s'],
    [148.320, 630.282, 294.219, 11.745, 'own clothing will almost perfectly silence'],
    [52.320, 639.282, 262.614, 11.745, 'the shot. Anyone hit by this shot outside of active combat is'],
    [52.320, 648.282, 97.651, 11.745, [[52.320, 89.409, 'Disarmed'], [90.695, 95.527, 'M', 649.064, 6.847], [95.527, 97.651, '.']]]]],
  [331.200, 622.230, [[331.200, 622.230, 413.136, 11.745, 'I’m Your Huckleberry']]],
  [328.800, 622.258, [
    [424.800, 622.258, 552.600, 11.745, 'You may choose for your character to'],
    [424.800, 631.258, 562.815, 11.745, 'get drunk from this flask. Acting cocky'],
    [328.800, 640.258, 551.235, 11.745, 'while obviously drunk in this way will empower the character’s'],
    [383.825, 650.040, 395.142, 6.847, 'L–M'],
    [328.800, 649.258, 382.539, 11.745, 'Happenstance'],
    [397.059, 649.258, 528.058, 11.745, [[397.059, 449.232, 'and Galvanize'], [450.518, 461.835, 'L–M', 650.040, 6.847], [463.753, 528.058, 'non-allies towards']]],
    [328.800, 658.258, 542.064, 11.745, 'underestimating them, scaling on believable portrayal of this'],
    [328.800, 667.258, 377.112, 11.745, 'Altered State.']]],
  [304.818, 764.837, [[304.818, 764.837, 319.182, 18.270, '16']]],
];

// A record is found by its place in the six-page cadence, so a fixture class
// has to arrive at its own PDF page numbers: the pages before it are empty.
const bookPages = (blocksByPage) => parseBboxPages(doc(
  ...Array(FIRST_CLASS_PAGE - 1).fill(''),
  ...blocksByPage.map((blocks) => blocks.map(sigBlock).join(''))));

const GUNSLINGER = [P18, P19, [...P20_LEFT, ...P20_RIGHT], P21, P22, P23];
const fixturePages = bookPages(GUNSLINGER);

// The running header is the only line in the measured band, so a page heading
// the wrong class is the real page with that one line's text replaced.
const headed = (blocks, name) => blocks.map(([x, y, lines]) => [x, y, lines.map((ln) =>
  (Math.abs(ln[1] - 23.233) <= 0.5 ? [ln[0], ln[1], ln[2], ln[3], name] : ln))]);

describe('assembling a class record', () => {
  test('the right half of the signature spread prints no running header', () => {
    // Which is why the cadence is checked on four pages per class and not six:
    // the header stands once over the spread, and the cover's title is art.
    expect(headerName(pageAt(21, P21))).toBeNull();
    expect(headerName(pageAt(20, P20_LEFT))).toBe('Gunslinger');
  });

  test('column and position span the four columns across the two pages', () => {
    const gear = extractClass(fixturePages, 0).gear;
    expect(gear).toHaveLength(12);
    expect(gear.map((item) => item.column)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
    expect(gear.map((item) => item.position)).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]);
    expect(gear.map((item) => item.name)).toEqual(['Cowboy Hat', 'Bandolier', 'Revolver',
      'Sharps Rifle', 'Coach Gun', 'Saddler', 'Wild Rag', 'Duster', 'Derringer',
      'Bowie Knife', 'Rollups', 'Hip Flask']);
  });

  test('category is derived from the column: 1 is default, 2 to 4 elective', () => {
    const gear = extractClass(fixturePages, 0).gear;
    expect(gear.slice(0, 3).map((item) => item.category)).toEqual(['default', 'default', 'default']);
    expect(gear.slice(3).every((item) => item.category === 'elective')).toBe(true);
  });

  test('a gear item carries the eight keys the loader reads, in order', () => {
    expect(Object.keys(extractClass(fixturePages, 0).gear[0])).toEqual([
      'name', 'description', 'category', 'meters', 'notes', 'default_enchantment',
      'column', 'position'
    ]);
  });

  test('a column that does not print three items is refused', () => {
    // Column 4's first item name, removed, and nothing else: `Rollups` and
    // `Hip Flask` still read correctly, and everything the Bowie Knife prints
    // vanishes with no other trace. Silently shipping an eleven-item class is
    // the failure this guard exists to make loud.
    const shortened = P21.filter((blk) => blk[2][0][4] !== 'Bowie Knife');
    const pages = bookPages([P18, P19, [...P20_LEFT, ...P20_RIGHT], shortened, P22, P23]);
    expect(() => extractClass(pages, 0)).toThrow('column 4');
  });

  test('core abilities come from offset +1 and advanced from offset +4', () => {
    const record = extractClass(fixturePages, 0);
    expect(record.abilities).toHaveLength(3);
    expect(record.advanced_abilities).toHaveLength(3);
    expect(record.abilities.map((ability) => ability.name))
      .toEqual(['Trickshot', 'Standoff', 'Shootout']);
    expect(record.advanced_abilities.map((ability) => ability.name))
      .toEqual(['High Noon', 'Stick ‘Em Up', 'Surefire']);
  });

  test('the class name comes from the running header, not the cover', () => {
    expect(extractClass(fixturePages, 0).name).toBe('Gunslinger');
  });

  test('page_range is printed pages, not PDF pages', () => {
    expect(extractClass(fixturePages, 0).page_range).toEqual([13, 18]);
  });

  test('the record carries no designer, the book crediting none per class', () => {
    // Page 3 credits the book's contributors as one list. No class page prints
    // a "Design by" line, which the other book's covers do.
    expect(extractClass(fixturePages, 0).designer).toBeNull();
  });

  test('a header that disagrees with the expected roster name is refused', () => {
    const pages = bookPages([P18, headed(P19, 'Gunfighter'),
      [...P20_LEFT, ...P20_RIGHT], P21, P22, P23]);
    expect(() => extractClass(pages, 0)).toThrow('Gunslinger');
    expect(() => extractClass(pages, 0)).toThrow('Gunfighter');
  });

  test('a header that disagrees on the spread or the tips is refused too', () => {
    for (const offset of [2, 4, 5]) {
      const drifted = GUNSLINGER.map((blocks, index) =>
        (index === offset ? headed(blocks, 'Gunfighter') : blocks));
      expect(() => extractClass(bookPages(drifted), 0)).toThrow('Gunslinger');
    }
  });

  test('every record carries the full key set in a stable order', () => {
    expect(Object.keys(extractClass(fixturePages, 0))).toEqual([
      'name', 'designer', 'stat_line', 'stat_note', 'stat_spread', 'quote', 'quote_source',
      'overview', 'conduit_notes', 'grounding', 'examples_heading', 'examples',
      'tips_heading', 'tips', 'challenge_level', 'abilities', 'advanced_abilities',
      'gear', 'expanded_tips', 'page_range'
    ]);
  });

  test('the whole book is read by the cadence, class by class', () => {
    // The fixture holds one class, so the second one's pages are missing: what
    // this pins is that extractBook walks all twelve and names the class it
    // could not find rather than reading eleven and stopping quietly.
    expect(() => extractBook(fixturePages)).toThrow('Illusionist');
    expect(() => extractBook(fixturePages)).toThrow('page 25');
  });
});
