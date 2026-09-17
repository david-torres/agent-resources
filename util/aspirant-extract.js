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

module.exports = {
  decodeEntities, parseBboxPages, CLASS_NAMES, FIRST_CLASS_PAGE, PAGES_PER_CLASS,
  classPageNumbers, isCoverPage, printedPage, headerName, isRecto, shiftFor,
  RECTO_SHIFT, SIGNATURE_NOTE_RECTO_SHIFT,
};
