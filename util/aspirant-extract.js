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

module.exports = {
  decodeEntities, parseBboxPages, CLASS_NAMES, FIRST_CLASS_PAGE, PAGES_PER_CLASS,
  classPageNumbers, isCoverPage, printedPage, headerName, isRecto, shiftFor,
  RECTO_SHIFT, SIGNATURE_NOTE_RECTO_SHIFT,
  POWER_RATINGS, isSuperscript, rethreadSuperscripts, markPowerRatings,
  noteTree, TIPS_NOTE_STEP, TIPS_NOTE_THRESHOLD, BODY_NOTE_STEP,
};
