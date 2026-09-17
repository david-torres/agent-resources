const { pairMeters, parseStatLine } = require('./prerelease-extract');

const NAMED_ENTITIES = { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' };

const decodeEntities = (text) => text
  .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&(quot|apos|lt|gt|amp);/g, (_, name) => NAMED_ENTITIES[name]);

const PAGE = /<page [^>]*>([\s\S]*?)<\/page>/g;
const BLOCK = /<block xMin="([\d.eE+-]+)" yMin="([\d.eE+-]+)"[^>]*>([\s\S]*?)<\/block>/g;
const LINE = /<line xMin="([\d.eE+-]+)" yMin="([\d.eE+-]+)"[^>]*>([\s\S]*?)<\/line>/g;
const WORD = /<word xMin="([\d.eE+-]+)" yMin="([\d.eE+-]+)" xMax="([\d.eE+-]+)" yMax="([\d.eE+-]+)"[^>]*>([\s\S]*?)<\/word>/g;

const lowest = (boxes) => Math.max(...boxes.map((box) => box.yMax));

const textOf = (line) => line.words.map((word) => word.text).join(' ');

// pdftotext -bbox-layout gives every page in document order, so the 1-based
// PDF page number is just a running count of <page> matches.
const parseBboxPages = (xhtml) => {
  const pages = [];
  let pageNumber = 0;
  for (const [, pageBody] of xhtml.matchAll(PAGE)) {
    pageNumber += 1;
    const blocks = [];
    for (const [, blockX, blockY, blockBody] of pageBody.matchAll(BLOCK)) {
      const lines = [];
      for (const [, lineX, lineY, lineBody] of blockBody.matchAll(LINE)) {
        const words = [...lineBody.matchAll(WORD)].map(([, x, y, xMax, yMax, text]) => ({
          xMin: Number(x), yMin: Number(y), xMax: Number(xMax), yMax: Number(yMax), text: decodeEntities(text),
        }));
        lines.push({ xMin: Number(lineX), yMin: Number(lineY), yMax: lowest(words), words });
      }
      blocks.push({ xMin: Number(blockX), yMin: Number(blockY), yMax: lowest(lines), lines });
    }
    pages.push({ page: pageNumber, blocks });
  }
  return pages;
};

const CLASS_NAMES = ['Gunslinger', 'Illusionist', 'Librarian', 'Thane', 'Thunderbird',
  'Wanderer', 'Berserker', 'Freerunner', 'Infiltrator', 'Samaritan', 'Vessel', 'Witchfinder'];

const FIRST_CLASS_PAGE = 18;
const PAGES_PER_CLASS = 6;
const PRINTED_PAGE_OFFSET = 5;

const OFFSETS = ['cover', 'core', 'sigLeft', 'sigRight', 'advanced', 'tips'];

const classPageNumbers = (index) => Object.fromEntries(OFFSETS.map((name, offset) =>
  [name, FIRST_CLASS_PAGE + index * PAGES_PER_CLASS + offset]));

const printedPage = (pdfPage) => pdfPage - PRINTED_PAGE_OFFSET;
const isRecto = (pdfPage) => pdfPage % 2 === 1;

// The cover carries no class name -- the title is outlined art -- so a class
// block is found by its cadence, anchored on these two markers. Measured
// against all 172 pages: each is independently exact, 12 hits, no false
// positives. A stat-line regex with no geometry constraint also matches p96,
// so the height and centring are load-bearing rather than belt-and-braces.
const STAT_LINE_Y = 76.73;
const STAT_LINE_HEIGHT = 24.0;
const PAGE_CENTRE = 300.24;
const CENTRE_TOLERANCE = 1.0;
const CHALLENGE_LEVEL_MIN_Y = 700;
const Y_TOLERANCE = 0.5;
const HEIGHT_TOLERANCE = 0.5;

// Identical on all 48 header pages.
const HEADER_Y_MIN = 23.23;
const HEADER_Y_MAX = 38.86;
const HEADER_BAND_TOLERANCE = 0.5;

const RECTO_SHIFT = 11.52;
const SIGNATURE_NOTE_RECTO_SHIFT = 16.32;

const shiftFor = (pdfPage, kind) => {
  if (!isRecto(pdfPage)) return 0;
  return kind === 'signature-note' ? SIGNATURE_NOTE_RECTO_SHIFT : RECTO_SHIFT;
};

const centreOf = (words) => {
  const xMins = words.map((w) => w.xMin);
  const xMaxs = words.map((w) => w.xMax);
  return (Math.min(...xMins) + Math.max(...xMaxs)) / 2;
};

const isStatLine = (block) => {
  if (block.lines.length !== 1) return false;
  const [line] = block.lines;
  if (Math.abs(line.yMin - STAT_LINE_Y) > Y_TOLERANCE) return false;
  if (Math.abs((line.yMax - line.yMin) - STAT_LINE_HEIGHT) > HEIGHT_TOLERANCE) return false;
  return Math.abs(centreOf(line.words) - PAGE_CENTRE) <= CENTRE_TOLERANCE;
};

const hasChallengeLevel = (block) => block.lines.some((line) => {
  if (line.yMin <= CHALLENGE_LEVEL_MIN_Y) return false;
  return line.words.some((word, i) =>
    word.text === 'Challenge' && line.words[i + 1]?.text === 'Level:');
});

const isCoverPage = (page) =>
  page.blocks.some(isStatLine) && page.blocks.some(hasChallengeLevel);

const headerName = (page) => {
  for (const block of page.blocks) {
    for (const line of block.lines) {
      if (Math.abs(line.yMin - HEADER_Y_MIN) <= HEADER_BAND_TOLERANCE
        && Math.abs(line.yMax - HEADER_Y_MAX) <= HEADER_BAND_TOLERANCE) {
        return textOf(line);
      }
    }
  }
  return null;
};

const EN = '–';
// The complete observed set, counted over the whole book after re-threading:
// M 221, L 108, H 106, L-H 61, L-M 60, M-H 32, H+ 20, M-H+ 7, 0-M 3, L-H+ 3,
// H-H+ 3, 0-L 2, 0-H 2, plus one further L-H with a comma fused to it (below).
// Two of the three 0-M are class pages, p33 and p88; the third is the
// definition quoted below. No L+, M+, L-M+ or 0-H+ occurs.
//
// The 0 forms are ranges with no lower bound, not mis-decoded Ls. Printed page
// 12 defines them: "If a range does not include a lower bound (\"up to Mid\", or
// 0-M as a superscript), insufficiently fulfilling its scaling criteria will
// result in no effect."
const POWER_RATINGS = ['L', 'M', 'H', 'H+',
  `L${EN}M`, `L${EN}H`, `M${EN}H`, `L${EN}H+`, `M${EN}H+`, `H${EN}H+`,
  `0${EN}L`, `0${EN}M`, `0${EN}H`];

// p45 sets one rating with its sentence's comma inside the word -- the whole
// token 548.25-561.49 at rating height -- and it is the only mark any rating
// fuses to anywhere in the book, so it is enumerated rather than widened to a
// class of punctuation. The rating is matched with the mark stripped and the
// mark printed outside the tag, which leaves the joined text reading exactly
// as the page does.
const FUSED_RATING_MARK = ',';

const ratingIn = (text) => {
  if (POWER_RATINGS.includes(text)) return { rating: text, mark: '' };
  const stripped = text.endsWith(FUSED_RATING_MARK) ? text.slice(0, -1) : null;
  return stripped !== null && POWER_RATINGS.includes(stripped)
    ? { rating: stripped, mark: FUSED_RATING_MARK }
    : null;
};

// A rating is printed markedly smaller than the body text it hangs off, and
// hangs from the line top. The top-hang ratio is exact (0.65) across all six
// body sizes in the book, so matching on it rather than on an absolute height
// survives the font changing per entry. Height is a loose upper bound, not a
// band pinned to 0.583: on p21, "Deadlier L–H when fired..." sets its rating
// at the font size for a *different*, smaller body bucket (11.75) than the
// 13.05-tall line it actually sits in, giving heightRatio 0.5247 -- a real
// inconsistency in the source PDF that a tight band around 0.583 rejects but
// the top-hang check alone (0.6618) still correctly identifies as a superscript.
const SUPERSCRIPT_MAX_RATIO = 0.75;
const TOP_HANG_RATIO = 0.65;
const RATIO_TOLERANCE = 0.05;

// pdftotext drops a rating into the inter-word gap of its host line as a
// separate line or block. Its yMin sits 0.70-1.04 below the host's, so lines
// agreeing this closely are one printed line however they were emitted.
const SAME_LINE_Y = 1.5;

const isSuperscript = (word, line) => {
  const lineHeight = line.yMax - line.yMin;
  if (lineHeight === 0) return false;
  const heightRatio = (word.yMax - word.yMin) / lineHeight;
  const hangRatio = (word.yMax - line.yMin) / lineHeight;
  return heightRatio <= SUPERSCRIPT_MAX_RATIO
    && Math.abs(hangRatio - TOP_HANG_RATIO) <= RATIO_TOLERANCE;
};

const lineHeightOf = (line) => line.yMax - line.yMin;

// A detached rating arrives as a line pdftotext gave to no one else: exactly
// one word, and that word is one of the ten known strings. Judged against its
// own single-word line it reads as a normal-height line (heightRatio 1.0,
// over the bound) -- isSuperscript only sees the truth once it is next to
// its host -- so this is the one thing that can flag it before re-threading
// happens.
const isDetachedRating = (line) =>
  line.words.length === 1 && POWER_RATINGS.includes(line.words[0].text);

const lineXMin = (line) => Math.min(...line.words.map((word) => word.xMin));
const lineXMax = (line) => Math.max(...line.words.map((word) => word.xMax));

// A detached rating's true host is the line it interrupts: its x-range sits
// inside the host's, or right against one of the host's fragments where
// pdftotext split the host around the gap (inter-word gaps in this book run
// ~1.3-2.1pt). An unrelated line that merely shares the candidate's yMin --
// a facing column, an unrelated heading -- sits tens to hundreds of points
// away in x, so a small gap tolerance separates the two cleanly.
const HOST_X_GAP = 5;

const isAdjacentTo = (line, candidateLine) => {
  const gapLeft = lineXMin(candidateLine) - lineXMax(line);
  const gapRight = lineXMin(line) - lineXMax(candidateLine);
  return gapLeft <= HOST_X_GAP && gapRight <= HOST_X_GAP;
};

const mergeGroup = (lines) => {
  const host = lines.reduce((tallest, line) =>
    lineHeightOf(line) > lineHeightOf(tallest) ? line : tallest);
  const words = lines.flatMap((line) => line.words).sort((a, b) => a.xMin - b.xMin);
  return { ...host, words };
};

const rethreadSuperscripts = (page) => {
  const allLines = page.blocks.flatMap((block, blockIndex) =>
    block.lines.map((line, lineIndex) => ({ line, blockIndex, lineIndex })));

  // Grouping by yMin proximity alone, page-wide, false-merges unrelated
  // lines that share a baseline (credits columns, table-of-contents rows).
  // Anchoring each group on a detached rating and requiring x-adjacency
  // keeps re-threading scoped to the 21 real cases instead of every
  // same-height coincidence on the page.
  const consumed = new Set();
  const key = (entry) => `${entry.blockIndex}.${entry.lineIndex}`;
  const mergedByBlockAndLine = new Map();
  const dropped = new Set();

  for (const candidate of allLines) {
    if (!isDetachedRating(candidate.line) || consumed.has(key(candidate))) continue;
    const group = allLines.filter((entry) => !consumed.has(key(entry))
      && Math.abs(entry.line.yMin - candidate.line.yMin) <= SAME_LINE_Y
      && isAdjacentTo(entry.line, candidate.line));
    for (const entry of group) consumed.add(key(entry));

    const merged = mergeGroup(group.map((entry) => entry.line));
    const host = group.reduce((tallest, entry) =>
      lineHeightOf(entry.line) > lineHeightOf(tallest.line) ? entry : tallest);
    mergedByBlockAndLine.set(key(host), merged);
    for (const entry of group) {
      if (entry !== host) dropped.add(key(entry));
    }
  }

  const blocks = page.blocks
    .map((block, blockIndex) => {
      const lines = block.lines
        .map((line, lineIndex) => {
          const cellKey = `${blockIndex}.${lineIndex}`;
          if (dropped.has(cellKey)) return null;
          return mergedByBlockAndLine.get(cellKey) ?? line;
        })
        .filter((line) => line !== null);
      return { ...block, lines };
    })
    .filter((block) => block.lines.length > 0);

  return { ...page, blocks };
};

const markPowerRatings = (line) => line.words
  .map((word) => {
    const marked = isSuperscript(word, line) ? ratingIn(word.text) : null;
    return marked ? `<sup>${marked.rating}</sup>${marked.mark}` : word.text;
  })
  .join(' ');

// Expanded Tips indent 18.72 per level; signature and ability notes 19.20.
// Measured separately and deliberately not unified (geometry doc, section 6).
const TIPS_NOTE_STEP = 18.72;
const BODY_NOTE_STEP = 19.2;

// Wrapped leading 12.00 against a new note's 20.39, with 8.1pt of clear air
// and zero overlap across 871 measured lines.
const TIPS_NOTE_THRESHOLD = 16.0;

// Signature and ability entries change font size per entry, so their boundary
// is read off each line's own height rather than off a fixed leading: measured
// over 944 line pairs, a wrapped continuation follows at 0.766 x lineHeight and
// the next note at 1.098-1.132 x, with no overlap at either body size. The
// smallest leading an entry happens to print cannot stand in for it -- 11 of
// the 70 ability entries that carry notes print no wrapped line at all, and
// their whole run then reads as a single note.
const NOTE_LEADING_RATIO = 0.93;

const startsNewNote = (line, previous, threshold) => {
  if (previous === null) return true;
  return (line.yMin - previous.yMin) > (threshold ?? NOTE_LEADING_RATIO * lineHeightOf(previous));
};

// A wrapped continuation line shares its parent's xMin exactly, so depth
// cannot be read from x-indent alone; only note-start lines anchor baseX
// and contribute to depth (geometry doc, section 6, "the important caveat").
const noteTree = (lines, { step, threshold }) => {
  if (lines.length === 0) return [];

  const sorted = [...lines].sort((a, b) => a.yMin - b.yMin);

  const startLines = [];
  const notes = [];
  let previous = null;

  for (const line of sorted) {
    if (startsNewNote(line, previous, threshold)) {
      startLines.push(line);
      notes.push({ text: markPowerRatings(line), children: [] });
    } else {
      const current = notes[notes.length - 1];
      current.text = `${current.text} ${markPowerRatings(line)}`;
    }
    previous = line;
  }

  const baseX = Math.min(...startLines.map((line) => lineXMin(line)));
  const roots = [];
  const lastAtDepth = [];

  notes.forEach((note, i) => {
    const depth = Math.round((lineXMin(startLines[i]) - baseX) / step);
    if (depth === 0) {
      roots.push(note);
    } else {
      const parent = lastAtDepth[depth - 1];
      if (!parent) throw new Error(`no parent for note: "${note.text}"`);
      parent.children.push(note);
    }
    lastAtDepth[depth] = note;
    lastAtDepth.length = depth + 1;
  });

  return roots;
};

// No line crosses x=306 on any of the 24 signature pages; the two columns are
// laid out independently and share almost no baselines, so they are partitioned
// here and read separately.
const COLUMN_SPLIT_X = 306;

// An item name is the tallest line in its entry. Never an absolute 20.88: the
// book auto-fits a long name down to 19.57. No body line anywhere exceeds 14.36.
const NAME_MIN_HEIGHT = 18.0;

// "In Honor of" is printed smaller than every body font and lands inside the
// signature description's y-range -- on p50 literally between its wrapped lines
// at 371.83 and 380.83 -- so it is lifted out by height before any reflow.
const DEDICATION_HEIGHT = 7.83;

// Entries start as high as yMin 40.77 (Blank Check, Samaritan p75), above the
// running-header band, and the last body line of a column reaches 742.66. The
// folio stands alone at 764.84, centred at x 292.82 -- inside the left column
// and below its last entry's last line -- so unless the band is closed below
// it, it is appended to that entry's signature description on every page.
const CONTENT_MIN_Y = 39;
const CONTENT_MAX_Y = 750;

const DIVIDER_TEXT = 'Default Enchantment';

// Offsets from the column's text origin -- the item name's left edge -- which
// is 45.60/57.12 in the left column and 322.08/333.60 in the right. Measured on
// all 24 pages: the signature name outdents 2.40 and its description 4.80, so
// 0.5 is all the room there is to tell those two apart. The meter gutter never
// begins closer in than 112.56 while no note block begins further out than
// 24.34, which leaves the widest gap on the page to separate meters from prose.
const SIGNATURE_NAME_OUTDENT = 2.40;
const SIGNATURE_NAME_TOLERANCE = 0.5;
const COLUMN_X_TOLERANCE = 1.0;
const METER_GUTTER_MIN = 100;

// A two-row meter block starts 4.11 above its own item name's baseline, so an
// entry begins slightly above the name that titles it.
const ENTRY_LEAD = 6;

// Within a meter row the words of one label are 2.13 apart and a value never
// starts closer than 7.28 to its label's right edge.
const METER_CELL_GAP = 5;
const METER_LABEL_GAP = 6;

// A label that wraps to two lines is centred against its value, 5.00 from it;
// the next meter row down is 14.00 away at the closest.
const METER_ROW_BAND = 7;

const blockLeft = (block) => Math.min(...block.lines.map(lineXMin));
const blockTop = (block) => Math.min(...block.lines.map((line) => line.yMin));
const byTop = (a, b) => blockTop(a) - blockTop(b);

// A description wraps around the name printed beside it, and pdftotext splits
// a line a superscript interrupts into fragments that do not share a yMin: a
// detached cell sits ~0.78 BELOW both halves of its host. Ordering strictly by
// yMin therefore sorts any cell re-threading did not claim past the words it
// interrupts. Gathering one visual line on the tolerance that identifies a
// split line, then ordering within it by xMin, reads them all in place.
//
// Every detached cell in this book is a known rating, so re-threading claims
// them all and this ordering changes no output here. It stays for two reasons:
// a token multiset -- what the verifier compares -- cannot see a word that
// reads in the wrong place inside its own paragraph, and the coincidence holds
// only while POWER_RATINGS enumerates every cell the book prints, which is a
// property of the set rather than of the layout.
const visualLines = (lines) => [...lines]
  .sort((a, b) => a.yMin - b.yMin)
  .reduce((bands, line) => {
    const open = bands[bands.length - 1];
    if (open && line.yMin - open[0].yMin <= SAME_LINE_Y) open.push(line);
    else bands.push([line]);
    return bands;
  }, []);

const joinLines = (lines) => visualLines(lines)
  .flatMap((band) => band.sort((a, b) => lineXMin(a) - lineXMin(b)))
  .map(markPowerRatings)
  .join(' ');

// Everything in an entry mirrors recto/verso at 11.52 except the note frame,
// which mirrors at 16.32 (geometry doc, section 3a), so the column origin is
// taken back to its verso coordinate before the note frame's own shift applies.
const noteIndentFor = (pdfPage, colLeft) =>
  colLeft - shiftFor(pdfPage, 'body') + BODY_NOTE_STEP + shiftFor(pdfPage, 'signature-note');

const meterCells = (lines) => lines.flatMap((line) => line.words.reduce((cells, word) => {
  const open = cells[cells.length - 1];
  if (open && word.xMin - open.xMax <= METER_CELL_GAP) {
    open.text = `${open.text} ${word.text}`;
    open.xMax = word.xMax;
    return cells;
  }
  return [...cells, { xMin: word.xMin, xMax: word.xMax, yMin: word.yMin, text: word.text }];
}, []));

// Labels are right-ragged, so they cannot be told from values by a left band;
// what is constant is that the whole label group ends before any value begins.
const splitAtGutter = (cells) => {
  const sorted = [...cells].sort((a, b) => a.xMin - b.xMin);
  let labelEdge = -Infinity;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    labelEdge = Math.max(labelEdge, sorted[i].xMax);
    if (sorted[i + 1].xMin - labelEdge >= METER_LABEL_GAP) {
      return { labels: sorted.slice(0, i + 1), values: sorted.slice(i + 1) };
    }
  }
  throw new Error(`meter cells with no label/value gap: ${sorted.map((c) => c.text).join(' ')}`);
};

const readMeters = (lines) => {
  if (lines.length === 0) return [];
  const { labels, values } = splitAtGutter(meterCells(lines));
  return [...values].sort((a, b) => a.yMin - b.yMin).flatMap((value) => {
    const rowLabels = labels
      .filter((label) => Math.abs(label.yMin - value.yMin) <= METER_ROW_BAND)
      .sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
    if (rowLabels.length === 0) throw new Error(`meter value with no label: ${value.text}`);
    // pairMeters reads a row off one baseline; a wrapped label has none of its
    // own, so the row is presented on the value's.
    return pairMeters([
      {
        xMin: Math.min(...rowLabels.map((label) => label.xMin)),
        yMin: value.yMin,
        text: rowLabels.map((label) => label.text).join(' '),
      },
      { xMin: value.xMin, yMin: value.yMin, text: value.text },
    ]);
  });
};

const entryFrom = (pdfPage, colLeft, nameBlock, ownBlocks) => {
  const dividerBlock = ownBlocks.find((block) =>
    block.lines.some((line) => markPowerRatings(line) === DIVIDER_TEXT));
  if (!dividerBlock) {
    throw new Error(`signature entry with no ${DIVIDER_TEXT}: ${joinLines(nameBlock.lines)}`);
  }
  const dividerY = blockTop(dividerBlock);
  const body = ownBlocks.filter((block) => block !== dividerBlock);
  const above = body.filter((block) => blockTop(block) < dividerY);
  const below = body.filter((block) => blockTop(block) > dividerY);

  const noteIndent = noteIndentFor(pdfPage, colLeft);
  const meterBlocks = above.filter((block) => blockLeft(block) >= colLeft + METER_GUTTER_MIN);
  const descriptionBlocks = above.filter((block) =>
    Math.abs(blockLeft(block) - colLeft) <= COLUMN_X_TOLERANCE);
  const noteBlocks = above.filter((block) => !meterBlocks.includes(block)
    && blockLeft(block) >= noteIndent - COLUMN_X_TOLERANCE);
  const unplaced = above.filter((block) => !meterBlocks.includes(block)
    && !descriptionBlocks.includes(block) && !noteBlocks.includes(block));
  if (unplaced.length > 0) {
    throw new Error(`signature entry block at no known indent: ${joinLines(unplaced[0].lines)}`);
  }

  const signatureNameBlock = below.find((block) =>
    Math.abs(blockLeft(block) - (colLeft - SIGNATURE_NAME_OUTDENT)) <= SIGNATURE_NAME_TOLERANCE);
  if (!signatureNameBlock) {
    throw new Error(`signature entry with no signature name: ${joinLines(nameBlock.lines)}`);
  }
  const signatureLines = below
    .filter((block) => block !== signatureNameBlock)
    .flatMap((block) => block.lines);
  const isDedication = (line) =>
    Math.abs(lineHeightOf(line) - DEDICATION_HEIGHT) <= HEIGHT_TOLERANCE;
  const dedications = signatureLines.filter(isDedication);

  return {
    name: joinLines(nameBlock.lines.filter((line) => lineHeightOf(line) >= NAME_MIN_HEIGHT)),
    description: joinLines(descriptionBlocks.flatMap((block) => block.lines)),
    meters: readMeters(meterBlocks.flatMap((block) => block.lines)),
    notes: noteTree(noteBlocks.flatMap((block) => block.lines),
      { step: BODY_NOTE_STEP, threshold: null }),
    default_enchantment: {
      name: joinLines(signatureNameBlock.lines),
      description: joinLines(signatureLines.filter((line) => !isDedication(line))),
      dedication: dedications.length > 0 ? joinLines(dedications) : null,
    },
  };
};

const columnEntries = (pdfPage, blocks) => {
  const nameLines = blocks.flatMap((block) => block.lines)
    .filter((line) => lineHeightOf(line) >= NAME_MIN_HEIGHT);
  if (nameLines.length === 0) return [];
  const colLeft = Math.min(...nameLines.map(lineXMin));
  const nameBlocks = blocks
    .filter((block) => block.lines.some((line) => lineHeightOf(line) >= NAME_MIN_HEIGHT
      && Math.abs(lineXMin(line) - colLeft) <= COLUMN_X_TOLERANCE))
    .sort(byTop);

  return nameBlocks.map((nameBlock, i) => {
    const top = blockTop(nameBlock) - ENTRY_LEAD;
    const bottom = nameBlocks[i + 1] ? blockTop(nameBlocks[i + 1]) - ENTRY_LEAD : Infinity;
    const ownBlocks = blocks.filter((block) => block !== nameBlock
      && blockTop(block) >= top && blockTop(block) < bottom);
    return entryFrom(pdfPage, colLeft, nameBlock, ownBlocks);
  });
};

// Re-threading runs first: a detached one-character cell sits in the middle of
// the column and pollutes every x-band it is measured against.
const signatureColumns = (page) => {
  const blocks = rethreadSuperscripts(page).blocks
    .map((block) => ({
      ...block,
      lines: block.lines.filter((line) => line.yMin > CONTENT_MIN_Y && line.yMin < CONTENT_MAX_Y),
    }))
    .filter((block) => block.lines.length > 0);
  return [
    columnEntries(page.page, blocks.filter((block) => blockLeft(block) < COLUMN_SPLIT_X)),
    columnEntries(page.page, blocks.filter((block) => blockLeft(block) >= COLUMN_SPLIT_X)),
  ];
};

const signatureEntries = (page) => signatureColumns(page).flat();

// "Paired Action:", "Sample Perks" and "(Compounded)" each print exactly three
// times on every one of the 24 ability pages. "Paired Action:" and
// "(Compounded)" are also exclusive to them, at 72 whole lines apiece
// book-wide; "Sample Perks" prints 73, the extra being a rules heading on p12
// at yMin 557.68. The anchor is "Paired Action:" and not "Essence Cost", which
// pdftotext gives 4 lines on p22/p28/p46/p55 and 2 on p82 (geometry doc,
// section 8).
const PAIRED_ACTION_LABEL = 'Paired Action:';
const SAMPLE_PERKS_HEADING = 'Sample Perks';
const COMPOUNDED_LABEL = '(Compounded)';
const DEDICATION_PREFIX = 'In Honor of';
const ABILITIES_PER_PAGE = 3;
const SAMPLE_PERKS_PER_ABILITY = 2;

// An ability name's first line sits 26.24-46.94 above its own label and is the
// tallest line in that window. The window must also stop short of the entry
// above, whose last name line is 180.14 above the label at the tightest (p55,
// the label above Bloodlust reaching back to Warp Spasm) -- so 70 has 23.06 pt
// of margin below and 110.14 above. Height is the only signal available: the
// book auto-fits 11 of the 72 names from 20.88 down to 19.57 or 19.58, and 16
// of the 88 name lines are the second line of a two-line name.
const ABILITY_NAME_LOOKBACK = 70;

// An entry opens above the name that titles it, because its meter table starts
// as much as 9.93 higher. The next name is never nearer than 39.59 below the
// line that closes the entry above it.
const ABILITY_ENTRY_LEAD = 12;

// Both offsets are measured from the entry's own "Paired Action:" label, not
// from the page margin: p37's first entry prints every part of itself 10.56 pt
// right of the frame section 3b tabulates, so absolute x classifies it wrongly.
//
// Meters: no prose line reaches further than 139.38 past the label and no meter
// label starts nearer than 382.01 -- the widest gap on the page.
// Text frame: notes and perk names stay within 43.20 of the label while the
// paired-action text, description, perk bodies and compounded body all start at
// 63.84 or beyond.
const ABILITY_METER_GUTTER = 200;
const ABILITY_TEXT_FRAME = 50;

// A label and the text it introduces share a band without sharing a baseline:
// the paired-action text opens up to 4.49 ABOVE its own label, the compounded
// body 0.02 to 0.89 below. This bound partitions prose, and no other prose line
// comes nearer than 15.42 to either label; the nearest line of any kind is a
// dedication 13.88 above a "(Compounded)", and those are lifted out by height
// before the split.
const LABEL_BAND_LEAD = 10;

const abilityNameLines = (lines, label) => {
  const window = lines.filter((line) =>
    line.yMin >= label.yMin - ABILITY_NAME_LOOKBACK && line.yMin < label.yMin);
  if (window.length === 0) throw new Error(`no ability name above yMin ${label.yMin}`);
  const tallest = Math.max(...window.map(lineHeightOf));
  return window
    .filter((line) => Math.abs(lineHeightOf(line) - tallest) <= HEIGHT_TOLERANCE)
    .sort((a, b) => a.yMin - b.yMin);
};

const abilityFrom = (ownLines, label, nameLines) => {
  const labelLeft = lineXMin(label);
  const soleLine = (text) => {
    const found = ownLines.filter((line) => textOf(line) === text);
    if (found.length !== 1) {
      throw new Error(`${found.length} "${text}" lines in ability: ${joinLines(nameLines)}`);
    }
    return found[0];
  };
  const perksHeading = soleLine(SAMPLE_PERKS_HEADING);
  const compounded = soleLine(COMPOUNDED_LABEL);

  // "In Honor of ..." and the one respelling the book prints are both set
  // smaller than every body font and both hang under the name they belong to,
  // so they are lifted out by height before any reflow.
  const isHanging = (line) =>
    Math.abs(lineHeightOf(line) - DEDICATION_HEIGHT) <= HEIGHT_TOLERANCE;
  const hanging = ownLines.filter(isHanging);
  const structural = new Set([label, perksHeading, compounded, ...nameLines]);
  const content = ownLines.filter((line) => !structural.has(line) && !isHanging(line));
  const meterLines = content.filter((line) => lineXMin(line) - labelLeft >= ABILITY_METER_GUTTER);
  const prose = content.filter((line) => !meterLines.includes(line));
  const inTextFrame = (line) => lineXMin(line) - labelLeft >= ABILITY_TEXT_FRAME;

  const descriptionLines = prose.filter((line) => line.yMin < label.yMin - LABEL_BAND_LEAD);
  const pairedBand = prose.filter((line) =>
    line.yMin >= label.yMin - LABEL_BAND_LEAD && line.yMin < perksHeading.yMin);
  const perkBand = prose.filter((line) =>
    line.yMin >= perksHeading.yMin && line.yMin < compounded.yMin - LABEL_BAND_LEAD);
  const compoundLines = prose.filter((line) => line.yMin >= compounded.yMin - LABEL_BAND_LEAD);

  const outdented = [...descriptionLines, ...compoundLines].filter((line) => !inTextFrame(line));
  if (outdented.length > 0) {
    throw new Error(`ability line at no known indent: ${joinLines([outdented[0]])}`);
  }
  const perkNameLines = perkBand.filter((line) => !inTextFrame(line)).sort((a, b) => a.yMin - b.yMin);
  if (perkNameLines.length !== SAMPLE_PERKS_PER_ABILITY) {
    throw new Error(`${perkNameLines.length} sample perks in ability: ${joinLines(nameLines)}`);
  }

  const abilityHost = nameLines[nameLines.length - 1];
  const hosts = [...nameLines, ...perkNameLines].sort((a, b) => a.yMin - b.yMin);
  const hostOf = (line) => hosts.filter((host) => host.yMin < line.yMin).pop();
  const hangingUnder = (host, dedication) => {
    const found = hanging.filter((line) => hostOf(line) === host
      && textOf(line).startsWith(DEDICATION_PREFIX) === dedication);
    return found.length > 0 ? joinLines(found) : null;
  };
  // Only a dedication hangs under a perk name, and only the ability carries a
  // respelling, so anything else set at this size would be read by no field.
  const stray = hanging.find((line) => hostOf(line) === undefined
    || (hostOf(line) !== abilityHost && !textOf(line).startsWith(DEDICATION_PREFIX)));
  if (stray) throw new Error(`hanging line under no name: ${joinLines([stray])}`);

  // A perk body opens 0.13 to 4.64 below its own name -- never above it, but by
  // as little as 0.13 (p19 One Bullet Left) -- while the next perk name is
  // 15.60 further down at the closest, so the split is on the names' baselines.
  const perkAt = (index) => {
    const nameLine = perkNameLines[index];
    const next = perkNameLines[index + 1];
    return {
      name: joinLines([nameLine]),
      dedication: hangingUnder(nameLine, true),
      text: joinLines(perkBand.filter((line) => inTextFrame(line)
        && line.yMin >= nameLine.yMin && (!next || line.yMin < next.yMin))),
      compound_text: next ? null : joinLines(compoundLines),
    };
  };

  return {
    name: joinLines(nameLines),
    pronunciation: hangingUnder(abilityHost, false),
    dedication: hangingUnder(abilityHost, true),
    description: joinLines(descriptionLines),
    paired_action: joinLines(pairedBand.filter(inTextFrame)),
    meters: readMeters(meterLines),
    notes: noteTree(pairedBand.filter((line) => !inTextFrame(line)),
      { step: BODY_NOTE_STEP, threshold: null }),
    sample_perks: perkNameLines.map((_, index) => perkAt(index)),
  };
};

// pdftotext's block grouping carries nothing here -- on p37 the meter table,
// the label, its text and every note arrive as one block spanning x
// 72.30-511.20 -- so the page is flattened to lines and read by (yMin, xMin).
const abilityEntries = (page) => {
  const lines = rethreadSuperscripts(page).blocks
    .flatMap((block) => block.lines)
    .filter((line) => line.yMin > CONTENT_MIN_Y && line.yMin < CONTENT_MAX_Y)
    .sort((a, b) => a.yMin - b.yMin);

  const labels = lines.filter((line) => textOf(line) === PAIRED_ACTION_LABEL);
  if (labels.length !== ABILITIES_PER_PAGE) {
    throw new Error(`${labels.length} "${PAIRED_ACTION_LABEL}" lines on page ${page.page}`);
  }
  const names = labels.map((label) => abilityNameLines(lines, label));

  return labels.map((label, index) => {
    const top = names[index][0].yMin - ABILITY_ENTRY_LEAD;
    const next = names[index + 1];
    const bottom = next ? next[0].yMin - ABILITY_ENTRY_LEAD : Infinity;
    return abilityFrom(lines.filter((line) => line.yMin >= top && line.yMin < bottom),
      label, names[index]);
  });
};

// A cover carries no class name -- the title is outlined art -- and no running
// header, so the only thing that says whose cover it is, for an error message,
// is its place in the six-page cadence.
const classOnPage = (pdfPage) =>
  CLASS_NAMES[Math.floor((pdfPage - FIRST_CLASS_PAGE) / PAGES_PER_CLASS)];

const soleLine = (lines, predicate, what, page) => {
  const found = lines.filter(predicate);
  if (found.length !== 1) {
    throw new Error(`${found.length} ${what} lines on ${classOnPage(page.page)} page ${page.page}`);
  }
  return found[0];
};

// The heading over the examples is six different strings, differing in which
// traditions the class is drawn from, so it is matched by shape and stored as
// printed.
const EXAMPLES_HEADING = /^Examples from .+ include:$/;
const QUICK_TIPS_HEADING = 'Quick Tips';
const CHALLENGE_LEVEL_LABEL = 'Challenge Level:';
const CHALLENGE_LEVELS = ['Low', 'Mid', 'High'];

// The attribution is the only line on a cover that opens with an em dash, and
// it is what closes the quote's band. The class view prints the dash itself, so
// what is stored is the name that follows it.
const ATTRIBUTION_DASH = '—';

// All three prose paragraphs set to 336.00 and paragraphs 2 and 3 open on a
// 3.84 pt first-line indent, which is the only thing that tells them apart.
// Their block box does not: 336.00-565.20 at line height 13.05 fits the
// Examples heading too on the Freerunner cover, whose heading is long enough
// to reach the right margin.
const PROSE_LEFT_X = 336.0;
const PROSE_INDENT_X = 339.84;

const PROSE_OPENINGS = [
  /^You are an? /,
  /^Conduits designing a mission for you /,
  /^Grounded in /,
];

// Examples hang 19.68 inside the prose frame; Quick Tips sit out at the left
// margin. A wrapped line returns to the x its own item started at, so x cuts
// neither list into items -- what it does is assert that every line the band
// holds belongs to the list, since a line at any other indent would be read by
// no field at all.
const EXAMPLES_ITEM_X = 355.68;
const QUICK_TIPS_ITEM_X = 60.48;

const coverFields = (page) => {
  const className = classOnPage(page.page);
  const lines = page.blocks.flatMap((block) => block.lines).sort((a, b) => a.yMin - b.yMin);
  const sole = (predicate, what) => soleLine(lines, predicate, what, page);

  const statBlock = page.blocks.find(isStatLine);
  if (!statBlock) throw new Error(`no stat line on ${className} page ${page.page}`);
  const attribution = sole((line) => textOf(line).startsWith(ATTRIBUTION_DASH), 'quote attribution');
  const examplesHeading = sole((line) => EXAMPLES_HEADING.test(textOf(line)), 'Examples heading');
  const tipsHeading = sole((line) => textOf(line) === QUICK_TIPS_HEADING, 'Quick Tips heading');
  const challenge = sole((line) => textOf(line).startsWith(CHALLENGE_LEVEL_LABEL), 'Challenge Level');

  const between = (top, bottom) =>
    lines.filter((line) => line.yMin > top.yMin && line.yMin < bottom.yMin);

  const isIndented = (line) => Math.abs(lineXMin(line) - PROSE_INDENT_X) <= COLUMN_X_TOLERANCE;
  const proseLines = between(attribution, examplesHeading);
  const outdented = proseLines.find((line) => !isIndented(line)
    && Math.abs(lineXMin(line) - PROSE_LEFT_X) > COLUMN_X_TOLERANCE);
  if (outdented) {
    throw new Error(`${className} cover prose line at no known indent: ${textOf(outdented)}`);
  }
  const paragraphs = proseLines.reduce((grouped, line) => {
    if (grouped.length === 0 || isIndented(line)) return [...grouped, [line]];
    grouped[grouped.length - 1].push(line);
    return grouped;
  }, []);
  if (paragraphs.length !== PROSE_OPENINGS.length) {
    throw new Error(`${paragraphs.length} prose paragraphs on the ${className} cover`);
  }
  const [overview, conduitNotes, grounding] = paragraphs.map((paragraph, index) => {
    const text = joinLines(paragraph);
    if (!PROSE_OPENINGS[index].test(text)) {
      throw new Error(`${className} cover paragraph ${index + 1} opens "${text.slice(0, 40)}"`);
    }
    return text;
  });

  // Each list is closed by the heading below it -- the Examples by "Quick Tips",
  // the Quick Tips by the Challenge Level, which clears the last tip by 14.33
  // at the tightest -- so the band holds the list and nothing else, and every
  // line in it must be at the list's own indent. Every item then sets at that
  // one x, which is why noteTree returns both lists flat.
  const listBetween = (top, bottom, itemX, options) => {
    const band = between(top, bottom);
    const outdented = band.find((line) =>
      Math.abs(lineXMin(line) - itemX) > COLUMN_X_TOLERANCE);
    if (outdented) {
      throw new Error(`${className} cover list line at no known indent: ${textOf(outdented)}`);
    }
    return noteTree(band, options).map((item) => item.text);
  };

  const statLine = joinLines(statBlock.lines);
  // The other book marks a stat whose allocation is footnoted with a trailing
  // "*" and prints the note below the stat line. No Aspirant cover prints
  // either, which is why stat_note is null; the marker is what would say
  // otherwise.
  if (statLine.includes('*')) {
    throw new Error(`${className} stat line carries a note marker: ${statLine}`);
  }
  const challengeLevel = textOf(challenge).slice(CHALLENGE_LEVEL_LABEL.length).trim();
  if (!CHALLENGE_LEVELS.includes(challengeLevel)) {
    throw new Error(`${className} challenge level "${challengeLevel}"`);
  }

  return {
    stat_line: statLine,
    stat_note: null,
    stat_spread: parseStatLine(statLine),
    quote: joinLines(between(statBlock.lines[0], attribution)),
    quote_source: textOf(attribution).slice(ATTRIBUTION_DASH.length).trim(),
    overview,
    conduit_notes: conduitNotes,
    grounding,
    examples_heading: textOf(examplesHeading),
    // Examples lead 10.00 wrapped against 18.33 to the next item, which the
    // per-line-height rule separates; the Quick Tips are set in the same body
    // as the Expanded Tips page and lead the same 12.00 against 20.39.
    examples: listBetween(examplesHeading, tipsHeading, EXAMPLES_ITEM_X,
      { step: TIPS_NOTE_STEP, threshold: null }),
    tips_heading: textOf(tipsHeading),
    tips: listBetween(tipsHeading, challenge, QUICK_TIPS_ITEM_X,
      { step: TIPS_NOTE_STEP, threshold: TIPS_NOTE_THRESHOLD }),
    challenge_level: challengeLevel,
  };
};

// The headings are centred over their columns -- 134.45 and 397.94 against
// lists that start at 72.00 and 348.48 -- so they cannot partition the lists by
// x. What they give is each column's top edge, below the running header.
const TIPS_PLAYER_HEADING = 'Player';
const TIPS_CONDUIT_HEADING = 'Conduit';

const expandedTips = (page) => {
  const lines = page.blocks.flatMap((block) => block.lines);
  const heading = (text) => soleLine(lines, (line) => textOf(line) === text, text, page);

  // The two lists interleave down the page and share no baselines, so one
  // y-sorted list of both reads the 12.00 pt step across the gutter as a
  // wrapped line and collapses the whole page into a single tip. The folio sets
  // at x 304.82-319.18, straddling the split, so it is the content band rather
  // than the split that keeps it out of the Player list.
  const column = (top, isLeft) => noteTree(
    lines.filter((line) => line.yMin > top.yMin && line.yMin < CONTENT_MAX_Y
      && (lineXMin(line) < COLUMN_SPLIT_X) === isLeft),
    { step: TIPS_NOTE_STEP, threshold: TIPS_NOTE_THRESHOLD });

  return {
    player: column(heading(TIPS_PLAYER_HEADING), true),
    conduit: column(heading(TIPS_CONDUIT_HEADING), false),
  };
};

// A class is located by the six-page cadence and nothing else, so every page
// that prints a running header is checked against the roster name before
// anything is read off it. Four of the six print one: the cover's title is
// outlined art, and the signature spread heads its left page only.
const HEADER_PAGES = ['core', 'sigLeft', 'advanced', 'tips'];

const pageIn = (pages, pdfPage, className) => {
  const page = pages[pdfPage - 1];
  if (!page) throw new Error(`${className} page ${pdfPage} is not in the parse`);
  return page;
};

// V1 prints no roster heading over a Signature column. What assigns `category`
// is the backwards-compatibility rule on printed page 2, which reads the first
// column of the spread as the Class's Default Roster and the second as its
// Elective one. Columns 3 and 4 are new to V1 and that rule names no roster for
// them; they follow column 2. util/class-gear.js holds the same constant for
// the same reason, and over six items both come to the `index < 3` split the
// fifty live classes were backfilled on.
const DEFAULT_ROSTER_COLUMN = 1;

// Three items down each of the spread's four columns, on all 24 signature
// pages. A column reads short when an entry loses the name block that opens it:
// the rest of that entry is then read into the entry above, or dropped where it
// opened the column, and no count downstream of here can see either.
const ENTRIES_PER_COLUMN = 3;

const gearFrom = (entry, column, position) => ({
  name: entry.name,
  description: entry.description,
  category: column === DEFAULT_ROSTER_COLUMN ? 'default' : 'elective',
  meters: entry.meters,
  notes: entry.notes,
  default_enchantment: entry.default_enchantment,
  column,
  position,
});

// The spread reads as four columns: the left page carries 1 and 2, the right 3
// and 4. Neither page says which pair it holds -- that is its place in the
// cadence -- so the two arrive already ordered.
const spreadGear = (leftPage, rightPage) =>
  [leftPage, rightPage]
    .flatMap((page) => signatureColumns(page).map((entries) => ({ page, entries })))
    .flatMap(({ page, entries }, index) => {
      if (entries.length !== ENTRIES_PER_COLUMN) {
        throw new Error(`${entries.length} signature entries in column ${index + 1}`
          + ` of the spread, on page ${page.page}`);
      }
      return entries.map((entry, position) => gearFrom(entry, index + 1, position + 1));
    });

const extractClass = (pages, index) => {
  const className = CLASS_NAMES[index];
  const numbers = classPageNumbers(index);
  const pageOf = (offset) => pageIn(pages, numbers[offset], className);

  for (const offset of HEADER_PAGES) {
    const header = headerName(pageOf(offset));
    if (header !== className) {
      throw new Error(`page ${numbers[offset]} heads ${JSON.stringify(header)}`
        + ` where the cadence expects ${className}`);
    }
  }

  return {
    name: headerName(pageOf('core')),
    // The book credits its contributors once, on a book-wide Credits page; the
    // "Design by" line the other book prints on each cover appears nowhere.
    designer: null,
    // coverFields returns the cover's thirteen fields in the artifact's own key
    // order, so spreading it here is what places them.
    ...coverFields(pageOf('cover')),
    abilities: abilityEntries(pageOf('core')),
    advanced_abilities: abilityEntries(pageOf('advanced')),
    gear: spreadGear(pageOf('sigLeft'), pageOf('sigRight')),
    expanded_tips: expandedTips(pageOf('tips')),
    page_range: [printedPage(numbers.cover), printedPage(numbers.tips)],
  };
};

const extractBook = (pages) => CLASS_NAMES.map((_, index) => extractClass(pages, index));

module.exports = {
  decodeEntities, parseBboxPages, CLASS_NAMES, FIRST_CLASS_PAGE, PAGES_PER_CLASS,
  classPageNumbers, isCoverPage, printedPage, headerName, isRecto, shiftFor,
  RECTO_SHIFT, SIGNATURE_NOTE_RECTO_SHIFT,
  POWER_RATINGS, isSuperscript, rethreadSuperscripts, markPowerRatings,
  noteTree, TIPS_NOTE_STEP, TIPS_NOTE_THRESHOLD, BODY_NOTE_STEP,
  signatureEntries, COLUMN_SPLIT_X, abilityEntries, coverFields, expandedTips,
  extractClass, extractBook,
};
