// The pure readings the Aspirant V1 verifier makes of a `pdftotext -layout` page, and the
// constants that decide them. They live here rather than in scripts/verify-aspirant-v1-extract.mjs
// because scripts/run-tests.mjs scans models, routes, services, test, util and views, so nothing
// under scripts/ can carry a unit test -- and these constants decide what the project's
// correctness gate is willing to call a match.
//
// This shares a directory with util/aspirant-extract.js and must never require it. The
// verifier's whole value is that it reads the book in a different pdftotext mode and segments
// on different evidence, so neither side can borrow the other's mistake. Sharing a directory
// costs that nothing; sharing the extractor's code would cost all of it.
const { tokenize } = require('./prerelease-extract');

const indentOf = (line) => line.search(/\S/);

const tally = (tokens) => tokens.reduce((seen, token) => seen.set(token, (seen.get(token) || 0) + 1), new Map());

const surplus = (tokens, against) => {
  const held = tally(against);
  const over = [];
  for (const [token, count] of tally(tokens)) {
    const excess = count - (held.get(token) || 0);
    if (excess > 0) over.push(`${token} x${excess}`);
  }
  return over.sort();
};

// The allowance only covers the tags, so what stops it covering anything else is this: every
// tag must belong to a pair that wraps one unbroken run of characters.
const WRAPPED = /<sup>([^<]*)<\/sup>/g;
const STRAY_TAG = /<\/?sup>/;

// Printed page 12 gives the notation: a bound, optionally a range to a second bound, and
// optionally a plus. 0 is defined there as a range with no lower bound, so it only ever stands
// as the lower end of one -- `0–M` is a rating and a bare `0` is not. The en dash is U+2013,
// which is the character the book sets; the attribution dash on a cover is U+2014 and is a
// different character. `-layout` carries no type size, so what the page prints raised cannot be
// checked from it; what can be checked is that the markup wraps a rating and not a word of the
// sentence.
const RAISED_NOTATION = /^(0–[LMH]|[LMH](–[LMH])?)\+?$/;

const checkSupMarkup = (fail, where, texts) => {
  for (const text of texts) {
    const wrapped = [...String(text).matchAll(WRAPPED)];
    const stray = String(text).replace(WRAPPED, '');
    if (STRAY_TAG.test(stray)) {
      fail(where, `<sup> markup that wraps no single word: ${JSON.stringify(text)}`);
    }
    for (const [, rating] of wrapped) {
      if (!RAISED_NOTATION.test(rating)) {
        fail(where, `<sup> markup around "${rating}", which is not a Power Rating`);
      }
    }
  }
};

// `-layout` carries no type size, so the PDF side cannot say which words the book sets raised
// and a removed <sup> pair leaves no trace there. The record side can say it: the record holds
// every rating inside the markup, so a rating-shaped token outside it is a pair that went
// missing. A rating carries the sentence's own mark closed up against it, so the mark is part of
// the shape looked for here.
const BARE_RATING = /^(0–[LMH]|[LMH](–[LMH])?)\+?[.,;:]?$/;

// One shape is excused: the quoted advice names its contributor and the attribution ends in an
// initial, so "— Tim M." closes the string with a rating-shaped token. Run over the committed
// artifact, this excuses 37 tokens and leaves none unexcused; all 37 are the final token of a
// string that ends in an em-dash attribution, 36 of them in expanded_tips and one in tips, and
// none in an ability, a signature or a cover field. The dash is U+2014, which the book uses for
// nothing else -- a Power Rating range is set with U+2013.
const ATTRIBUTED_INITIAL = /— (?:\S+ )+[A-Z]\.$/;

const checkBareRatings = (fail, where, texts) => {
  for (const text of texts) {
    const attributed = ATTRIBUTED_INITIAL.test(String(text).trim());
    const tokens = tokenize(String(text).replace(WRAPPED, ' '));
    tokens.forEach((token, at) => {
      if (!BARE_RATING.test(token)) return;
      if (attributed && at === tokens.length - 1) return;
      fail(where, `"${token}" reads as a Power Rating but is outside <sup>: ${JSON.stringify(text)}`);
    });
  }
};

// pdftotext -layout gives a raised rating an output line of its own when the line it
// interrupts leaves it no room, at a left edge no other line uses; and the mark the book sets
// hard against that rating -- it prints no space before one -- is left behind on that line as
// a word by itself. Putting the rating back in front of the mark, and closing the space,
// restores the word the page prints. Gluing two printed words together can only widen the
// difference from the record, so a repair in the wrong place fails here rather than passing.
const STRANDED_MARK = /^[.,;:]$/;

// `at` is the row's place among the page's own printed lines, which is what lets a band be
// read back off those lines after a raised rating has been folded out of this reading.
const rowsOf = (lines) => lines
  .filter((line) => line.trim())
  .map((line, at) => ({ line, at, indent: indentOf(line), tokens: tokenize(line), text: line.trim() }));

// A line of the page's own can have this same shape -- a one-word perk name, a column heading,
// the last word of a quote -- and being at a left edge nothing else uses does not tell it from
// a rating: measured over the book, 45 lines hold a single token at an indent no other line on
// their page shares, and only 16 of them are ratings. What tells them apart is the notation.
const repairRaisedRatings = (rows) => {
  const raised = [];
  const kept = [];
  rows.forEach((row) => {
    const alone = row.tokens.length === 1 && RAISED_NOTATION.test(row.tokens[0])
      && rows.filter((other) => other.indent === row.indent).length === 1;
    if (alone && kept.length) raised.push({ token: row.tokens[0], line: kept.length - 1 });
    else kept.push({ ...row, tokens: [...row.tokens] });
  });

  const merged = [];
  for (const cell of kept.flatMap((row, line) => row.tokens.map((token) => ({ line, token })))) {
    // The rating is set on the very next output line, so the one a mark belongs to is the one
    // that follows the line the mark was stranded on, never some other line's.
    const at = raised.findIndex((glyph) => glyph.line === cell.line);
    if (!STRANDED_MARK.test(cell.token) || !merged.length) {
      merged.push({ ...cell });
    } else if (at !== -1) {
      merged.push({ line: cell.line, token: `${raised.splice(at, 1)[0].token}${cell.token}` });
    } else {
      merged[merged.length - 1].token += cell.token;
    }
  }
  for (const glyph of raised) merged.push(glyph);

  return kept.map((row, line) => ({ ...row,
    tokens: merged.filter((cell) => cell.line === line).map((cell) => cell.token) }));
};

// A meter row is printed in a column down the right of the entry and lands on the same output
// line as a note whenever the two share a baseline. Nothing within a line of prose is set more
// than one space apart, so the run of spaces between them is what separates the two columns --
// and a cut in the wrong place leaves a note short, which fails here rather than passing.
const COLUMN_GAP = / {3,}\S/;

const untilNextColumn = (line) => {
  const indent = indentOf(line);
  const at = line.slice(indent).search(COLUMN_GAP);
  return at === -1 ? line : line.slice(0, indent + at);
};

// A record with no page_range cannot be located in the PDF, so not one of its values is
// verified. This gate's whole purpose is to be the thing nothing gets written past, so a record
// it could not read is a failure rather than a line of output: the alternative is a run that
// reports 11/12 classes and still exits 0.
const unlocatable = (rows) => rows
  .filter((row) => !Array.isArray(row.page_range))
  .map((row) => row.name);

// The chrome step takes the running header and the printed folio out of a page so that no entry
// has to account for them, and both are printed words the record holds as a name and a number
// rather than as text. So a chrome allowance can only be on the pdf side; one declared against
// the record would excuse a record token that no printed word accounts for, and the chrome step
// compares nothing that would notice.
const misdeclaredChrome = (allowances) => allowances
  .filter((allowance) => allowance.side !== 'pdf')
  .map((allowance) => `a chrome allowance declared on the ${allowance.side} side: ${allowance.why}`);

// The two columns are separated by a channel of blank character cells running the whole
// height of the content. Requiring it to be the only such channel is what makes the split a
// reading of the page rather than an assumed coordinate.
const MIN_GUTTER_WIDTH = 2;

const gutterOf = (fail, where, lines) => {
  const width = Math.max(...lines.map((line) => line.trimEnd().length));
  const runs = [];
  for (let column = 0; column < width; column += 1) {
    if (lines.some((line) => (line[column] ?? ' ') !== ' ')) continue;
    const open = runs[runs.length - 1];
    if (open && open.end === column - 1) open.end = column;
    else runs.push({ start: column, end: column });
  }
  const channels = runs.filter((run) => run.end - run.start + 1 >= MIN_GUTTER_WIDTH);
  if (channels.length !== 1) {
    fail(where, `${channels.length} blank column channels across the content, expected 1`);
    return null;
  }
  return channels[0].start;
};

module.exports = {
  tokenize, indentOf, surplus, rowsOf, untilNextColumn, repairRaisedRatings,
  gutterOf, checkSupMarkup, checkBareRatings, misdeclaredChrome, unlocatable,
  RAISED_NOTATION, STRANDED_MARK, COLUMN_GAP, MIN_GUTTER_WIDTH,
};
