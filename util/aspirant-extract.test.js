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

  test('re-threading leaves a page with no detached ratings untouched', () => {
    const page = { page: 20, blocks: [{ xMin: 40, yMin: 200, yMax: 211.75, lines: [host] }] };
    expect(rethreadSuperscripts(page)).toEqual(page);
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
