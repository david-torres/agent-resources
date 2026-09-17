const { pairMeters } = require('./prerelease-extract');

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
        return line.words.map((word) => word.text).join(' ');
      }
    }
  }
  return null;
};

const EN = '–';
// The complete observed set, whole book: M 221, L 108, H 106, L-H 61, L-M 60,
// M-H 32, H+ 20, M-H+ 7, L-H+ 3, H-H+ 3. No L+, M+ or L-M+ occurs.
const POWER_RATINGS = ['L', 'M', 'H', 'H+',
  `L${EN}M`, `L${EN}H`, `M${EN}H`, `L${EN}H+`, `M${EN}H+`, `H${EN}H+`];

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
  .map((word) => (isSuperscript(word, line) && POWER_RATINGS.includes(word.text)
    ? `<sup>${word.text}</sup>`
    : word.text))
  .join(' ');

// Expanded Tips indent 18.72 per level; signature and ability notes 19.20.
// Measured separately and deliberately not unified (geometry doc, section 6).
const TIPS_NOTE_STEP = 18.72;
const BODY_NOTE_STEP = 19.2;

// Wrapped leading 12.00 against a new note's 20.39, with 8.1pt of clear air
// and zero overlap across 871 measured lines.
const TIPS_NOTE_THRESHOLD = 16.0;

// Signature and ability entries change font size per entry, so their
// boundary is derived from the entry's own lines: wrapped leading is
// 0.766 x lineHeight and a new note adds ~4.30, which leaves ~2.3pt of
// margin either side of the derived threshold at every observed font size.
const DERIVED_THRESHOLD_MARGIN = 2.0;

const deriveThreshold = (lines) => {
  if (lines.length < 2) return null;
  const gaps = lines.slice(1).map((current, i) => current.yMin - lines[i].yMin);
  return Math.min(...gaps) + DERIVED_THRESHOLD_MARGIN;
};

// A wrapped continuation line shares its parent's xMin exactly, so depth
// cannot be read from x-indent alone; only note-start lines anchor baseX
// and contribute to depth (geometry doc, section 6, "the important caveat").
const noteTree = (lines, { step, threshold }) => {
  if (lines.length === 0) return [];

  const sorted = [...lines].sort((a, b) => a.yMin - b.yMin);
  const effectiveThreshold = threshold ?? deriveThreshold(sorted);

  const startLines = [];
  const notes = [];
  let previous = null;

  for (const line of sorted) {
    const isNewNote = previous === null || (line.yMin - previous.yMin) > effectiveThreshold;
    if (isNewNote) {
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
// folio stands alone at 764.84 and is 18.27 tall, so it reads as an item name
// unless the content band is closed below it.
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

// Sorting by xMin as well as yMin is what puts a detached rating back between
// the words it interrupts, and what reads a description that wraps around the
// name printed beside it in the order it is meant to be read.
const joinLines = (lines) => [...lines]
  .sort((a, b) => a.yMin - b.yMin || lineXMin(a) - lineXMin(b))
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
const signatureEntries = (page) => {
  const blocks = rethreadSuperscripts(page).blocks
    .map((block) => ({
      ...block,
      lines: block.lines.filter((line) => line.yMin > CONTENT_MIN_Y && line.yMin < CONTENT_MAX_Y),
    }))
    .filter((block) => block.lines.length > 0);
  return [
    ...columnEntries(page.page, blocks.filter((block) => blockLeft(block) < COLUMN_SPLIT_X)),
    ...columnEntries(page.page, blocks.filter((block) => blockLeft(block) >= COLUMN_SPLIT_X)),
  ];
};

module.exports = {
  decodeEntities, parseBboxPages, CLASS_NAMES, FIRST_CLASS_PAGE, PAGES_PER_CLASS,
  classPageNumbers, isCoverPage, printedPage, headerName, isRecto, shiftFor,
  RECTO_SHIFT, SIGNATURE_NOTE_RECTO_SHIFT,
  POWER_RATINGS, isSuperscript, rethreadSuperscripts, markPowerRatings,
  noteTree, TIPS_NOTE_STEP, TIPS_NOTE_THRESHOLD, BODY_NOTE_STEP,
  signatureEntries, COLUMN_SPLIT_X,
};
