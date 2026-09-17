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

  test('a detached cell no rating rule recognises still reads in place', () => {
    // p33 left, Coffee Cup. pdftotext splits `Grants a Ward <0-M> against
    // those` into two fragments at y 440.08 and drops the superscript between
    // them at y 440.86 -- 0.78 BELOW both. `0–M` is not one of the ten strings
    // in POWER_RATINGS, so re-threading leaves it where it is, and ordering by
    // yMin before xMin sorts it past the words it interrupts.
    const [coffeeCup] = signatureEntries(pageAt(33, [
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
      [202.724, 440.864, [[202.724, 440.864, 213.800, 6.847, '0–M']]],
    ]));
    expect(coffeeCup.default_enchantment.name).toBe('Good Morning, Sunshine');
    expect(coffeeCup.default_enchantment.description).toBe(
      'Grants a Ward 0–M against those dispositionally opposite to the owner’s'
      + ' current coffee-induced Altered State, scaling as above on your'
      + ' effective portrayal thereof.');
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
