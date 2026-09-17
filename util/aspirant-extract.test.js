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

  test('the ten rating strings are the whole observed set, with en dashes', () => {
    expect(POWER_RATINGS).toEqual(
      ['L', 'M', 'H', 'H+', 'L–M', 'L–H', 'M–H', 'L–H+', 'M–H+', 'H–H+']);
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

  test('a null threshold is derived from the lines, for pages whose font varies', () => {
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

  test('a child with no parent is refused rather than silently promoted', () => {
    expect(() => noteTree([ln(90.72, 100, 'orphan')],
      { step: TIPS_NOTE_STEP, threshold: TIPS_NOTE_THRESHOLD })).toThrow('orphan');
  });

  test('no lines is no notes', () => {
    expect(noteTree([], { step: TIPS_NOTE_STEP, threshold: TIPS_NOTE_THRESHOLD })).toEqual([]);
  });
});
