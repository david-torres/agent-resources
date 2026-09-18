// Gates the load: nothing may be written to a database until this reports clean.
//
// The document's text must survive extraction token for token AND land in the field and the
// entry the page prints it under. So the comparison is per entry, per paragraph and per note,
// never per class: a class-wide token multiset cannot see a note that drifted onto a
// neighbouring entry, because the tokens never leave the class, and that is the one defect
// this kind of extraction has actually shipped.
//
// The PDF side is read through `pdftotext -layout` and segmented on the document's own
// printed structure -- the running header, the printed folio, the page's own blank gutter, and
// the labels the book sets in type: Paired Action, Sample Perks, (Compounded) and the Default
// Enchantment divider. The extractor reads `-bbox-layout` and segments on blank-band geometry
// and leading, so neither side can borrow the other's mistake. Every value the record derives
// rather than transcribes -- the gear category, the column and position within the spread --
// is checked against where the page puts it, never against itself.
//
// Notes, list items and cover paragraphs are matched run by run: a record note must account
// for a whole number of consecutive printed lines. That pins each note to the lines it was
// read from without depending on word order within a line, which `-layout` does not always
// preserve -- a raised Power Rating can be emitted on an output line of its own.
//
// The pure readings of a page, and the constants that decide them, are in
// util/aspirant-verify.js so that a unit test can pin them: scripts/run-tests.mjs scans
// models, routes, services, test, util and views, so nothing under scripts/ can carry one.
// This file is the CLI around them -- arguments, the PDF, the allowances, the report and the
// exit code. That module must never require util/aspirant-extract.js, and does not: the
// independence this gate rests on is from the extractor, not from util/.
//
// Two things `-layout` cannot settle from the page.
//
// (a) Which words the book sets raised: the mode carries no type size, so a <sup> pair the
// extractor dropped leaves no trace on the PDF side. The record side closes this: every rating
// the record holds is inside the markup, so a rating-shaped token outside it is a pair that went
// missing, and every field is checked for one. One residual stays invisible -- a removal that
// lands on the final initial of an attributed quote, because "— Tim M." ends in a rating-shaped
// token of its own and is therefore excused.
//
// (b) Where one note ends and the next begins when the two are at the same depth, because the
// book prints no bullet, no rule and no leading the mode preserves between them. Run-matching
// pins each note to a whole number of consecutive printed lines instead, which is as far as the
// page goes. Two rules to close this have been written and measured against the whole book and
// both were rejected: a per-depth reflow rule and a sentence-end-at-line-break rule each call
// correctly printed pages defects, by hundreds and by tens respectively. The counts are in the
// plan's fix-round record; do not pay for this a fourth time.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  checkBareRatings, checkSupMarkup, gutterOf, indentOf, repairRaisedRatings, rowsOf, surplus, tokenize,
  untilNextColumn,
} from '../util/aspirant-verify.js';
import { bookFor } from './lib/books.mjs';

const PDF = process.argv[2];
const ARTIFACT = process.argv[3] || bookFor('aspirant-v1').artifact;
const REVIEW_DIR = '/tmp/aspirant-v1-review';

// A class runs six pages and the record stores the printed numbers of the first and last.
// The offset from printed to PDF page is checked on every page against the folio the page
// itself prints, so a wrong offset cannot quietly read the wrong pages.
const PRINTED_FOLIO_OFFSET = 5;
const PAGES_PER_CLASS = 6;
const [COVER, CORE, SIGNATURE_LEFT, SIGNATURE_RIGHT, ADVANCED, TIPS] = [0, 1, 2, 3, 4, 5];
const HEADER_OFFSETS = [CORE, SIGNATURE_LEFT, ADVANCED, TIPS];

const ENTRIES_PER_COLUMN = 3;
const COLUMNS_PER_PAGE = 2;

const PAIRED_ACTION_LABEL = 'Paired Action:';
const SAMPLE_PERKS_HEADING = 'Sample Perks';
const COMPOUNDED_LABEL = '(Compounded)';
const ENCHANTMENT_DIVIDER = 'Default Enchantment';
const PLAYER_HEADING = 'Player';
const CONDUIT_HEADING = 'Conduit';

const STAT_LINE = /^\+{1,2}\S/;
const EXAMPLES_HEADING = /^Examples from .+ include:$/;
const QUICK_TIPS_HEADING = 'Quick Tips';
const CHALLENGE_LEVEL_LABEL = 'Challenge Level:';
const CHALLENGE_LEVEL = new RegExp(`^${CHALLENGE_LEVEL_LABEL}\\s*(\\S+)$`);
const FOLIO = /^\d+$/;
const ATTRIBUTION_DASH = '—';

const SUP_OPEN = '<sup>';
const SUP_CLOSE = '</sup>';
const SUP_MARKUP = /<\/?sup>/g;

// The first column of the spread is the Class's Default Roster by the backwards-compatibility
// rule on printed page 2; every later column is Elective. The page prints no roster heading,
// so what this checks the category against is which column of the spread the entry was found
// in, which is read off the page's gutter and the cadence.
const DEFAULT_ROSTER_COLUMN = 1;

const pageLines = (page) => execFileSync('pdftotext',
    ['-f', String(page), '-l', String(page), '-layout', PDF, '-'],
    { encoding: 'utf8', maxBuffer: 1 << 26 })
  .replace(/\f/g, '')
  .split('\n');

const textOf = (value) => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(textOf);
  if (value && typeof value === 'object') return Object.values(value).flatMap(textOf);
  return [];
};

// Numeric fields -- stat_spread's counts, page_range, column and position -- are derived
// rather than transcribed and carry no document token, so they drop out here by type.
// `category` is derived too but is a string, so it is named.
const textsExcept = (record, skip) => Object.entries(record)
  .filter(([key]) => !skip.includes(key))
  .flatMap(([, value]) => textOf(value));

// The record wraps a Power Rating in markup the page sets as size rather than as text, and the
// sentence's own mark can follow the closing tag inside one printed word. Lifting the tags out
// whole leaves the rating joined to that mark exactly as the page prints it, and leaves only
// the tags themselves to an allowance.
const tokensOf = (texts) => [
  ...texts.flatMap((text) => tokenize(String(text).replace(SUP_MARKUP, ''))),
  ...texts.flatMap((text) => String(text).match(SUP_MARKUP) ?? []),
];

const flattenNotes = (notes, depth = 0) => notes.flatMap((note) =>
  [{ depth, text: note.text }, ...flattenNotes(note.children, depth + 1)]);

const report = [];
const failures = [];

const fail = (where, detail) => failures.push(`${where}: ${detail}`);

// An allowance is a named, enumerated set of tokens one side prints and the other has no
// field for. It is matched against the observed difference exactly -- a token allowed but
// not observed is as much a failure as one observed but not allowed. Every allowance is built
// from what the PDF prints or from a constant, never from the record value it covers, or it
// would cancel that value out of the comparison.
const allow = (side, tokens, why) => ({ side, tokens, why });

// The markup's multiplicity is the record's, but the tokens are constants and the rating they
// wrap is not among them, so this allowance cancels nothing out of the comparison: every
// rating still has to be matched against the word the page prints.
const supAllowance = (tokens) => allow('record',
  tokens.filter((token) => token === SUP_OPEN || token === SUP_CLOSE),
  'the <sup> markup, which the page sets as a raised smaller glyph rather than as text');

const compare = (where, pdfTokens, recordTokens, allowances) => {
  const allowedMissing = allowances.filter((entry) => entry.side === 'pdf').flatMap((entry) => entry.tokens);
  const allowedExtra = allowances.filter((entry) => entry.side === 'record').flatMap((entry) => entry.tokens);
  const missing = surplus(pdfTokens, recordTokens);
  const extra = surplus(recordTokens, pdfTokens);
  const expectedMissing = surplus(allowedMissing, []);
  const expectedExtra = surplus(allowedExtra, []);
  if (missing.join(' | ') !== expectedMissing.join(' | ')) {
    fail(where, `in the PDF but not the record: [${missing.join(' | ')}], allowed [${expectedMissing.join(' | ')}]`);
  }
  if (extra.join(' | ') !== expectedExtra.join(' | ')) {
    fail(where, `in the record but not the PDF: [${extra.join(' | ')}], allowed [${expectedExtra.join(' | ')}]`);
  }
};

const bandOf = (lines) => repairRaisedRatings(rowsOf(lines.map(untilNextColumn)));

const printedLinesOf = (lines) => lines.filter((line) => line.trim());

const readingOf = (lines) => repairRaisedRatings(rowsOf(lines));

const tokensIn = (rows) => rows.flatMap((row) => row.tokens);

// Depth is the rank of a line's left edge among the left edges the band uses: a wrapped
// continuation returns to the edge its own item started at, so the edges are the levels.
const withDepth = (band) => {
  const edges = [...new Set(band.map((line) => line.indent))].sort((a, b) => a - b);
  return band.map((line) => ({ ...line, depth: edges.indexOf(line.indent) }));
};

// A record item must account for a whole number of consecutive printed lines: the run is
// grown until its tokens match the item's exactly. That places every item on the lines it was
// read from -- so an item that took a line from its neighbour, or left one behind, is caught
// -- while staying independent of word order inside a line.
const runsOf = (where, kind, band, items) => {
  const runs = [];
  let at = 0;
  for (const [index, item] of items.entries()) {
    const wanted = tokenize(String(item.text).replace(SUP_MARKUP, ''));
    const start = at;
    while (at < band.length) {
      at += 1;
      const held = band.slice(start, at).flatMap((row) => row.tokens);
      if (!surplus(held, wanted).length && !surplus(wanted, held).length) break;
    }
    const held = band.slice(start, at).flatMap((row) => row.tokens);
    if (surplus(held, wanted).length || surplus(wanted, held).length) {
      fail(`${where} ${kind} ${index + 1}`, `the record holds "${wanted.join(' ')}" but the printed`
        + ` lines from here on read "${held.join(' ')}"`);
      return null;
    }
    runs.push({ start, end: at });
  }
  if (at < band.length) {
    fail(where, `${band.length - at} printed ${kind} line(s) past the last one in the record:`
      + ` "${band.slice(at).map((row) => row.text).join(' / ')}"`);
    return null;
  }
  return runs;
};

// A paragraph opens on a first-line indent of 3.84pt, which is narrower than the character
// cell `-layout` lays the page out on, so an opening resolves to an indent on most covers and
// to nothing on the rest -- the Thunderbird cover prints its third paragraph flush. What the
// page therefore settles is the one direction: a line it does indent opens a paragraph. The
// notes and lists carry no such mark, no bullet and no constant measure -- an entry's prose
// wraps around its meter table -- so for those, run-matching is as far as the page goes.
const checkParagraphOpenings = (where, band, runs) => {
  const left = Math.min(...band.map((row) => row.indent));
  const opened = new Set(runs.slice(1).map((run) => run.start));
  band.forEach((row, at) => {
    if (row.indent > left && !opened.has(at)) {
      fail(where, `the page opens a paragraph at "${row.text}" but the record runs it on`);
    }
  });
};

const matchRuns = (where, kind, band, items, { depths = true } = {}) => {
  const runs = runsOf(where, kind, band, items);
  if (!runs) return null;
  if (depths) {
    runs.forEach((run, index) => {
      const found = [...new Set(band.slice(run.start, run.end).map((row) => row.depth))];
      if (found.length !== 1 || found[0] !== items[index].depth) {
        fail(`${where} ${kind} ${index + 1}`, `the record nests it at depth ${items[index].depth}`
          + ` but it is printed at depth ${found.join('/')}`);
      }
    });
  }
  return runs;
};

const matchNotes = (where, band, notes) =>
  matchRuns(where, 'note', withDepth(band), flattenNotes(notes));

// Where one entry ends and the next begins is not printed: the book sets no rule between
// them, and the blank output lines that look like a gap belong to whichever column happens to
// be empty there. What is printed is the label that opens the last field of an entry, so the
// boundary is found by consuming that field and taking the next line as the next entry's
// first. Every line between two labels is then assigned to one entry or the other, so a line
// taken from the wrong one leaves its owner short and both comparisons fail.
const consumedThrough = (rows, from, wanted) => {
  const held = [];
  for (let at = from; at < rows.length; at += 1) {
    held.push(...rows[at].tokens);
    if (!surplus(held, wanted).length && !surplus(wanted, held).length) return at + 1;
  }
  return null;
};

const recordRun = (value) => tokenize(textOf(value).join(' ').replace(SUP_MARKUP, ''));

const rowIndexes = (rows, matches) => rows
  .map((row, index) => ({ row, index }))
  .filter(({ row }) => matches(row.text))
  .map(({ index }) => index);

const columnsOf = (where, lines) => {
  const gutter = gutterOf(fail, where, lines);
  if (gutter === null) return null;
  return [lines.map((line) => line.slice(0, gutter)), lines.map((line) => line.slice(gutter))];
};

const soleLine = (where, lines, matches, what) => {
  const hits = lines.filter((line) => matches(line.trim()));
  if (hits.length !== 1) {
    fail(where, `expected exactly one ${what} line, found ${hits.length}`);
    return null;
  }
  return hits[0];
};

// The quote and its attribution share a printed block, so the record's split between them is
// checked at the page's own single em dash rather than by re-joining the two fields -- which
// would pass however the split had been placed.
const checkQuote = (where, headTokens, row) => {
  const dashes = headTokens.filter((token) => token === ATTRIBUTION_DASH);
  if (dashes.length !== 1) {
    fail(where, `${dashes.length} attribution dashes above the body text, expected 1`);
    return;
  }
  const at = headTokens.indexOf(ATTRIBUTION_DASH);
  const source = tokenize(row.quote_source);
  const quote = tokenize(row.quote);
  if (headTokens.slice(at + 1).join(' ') !== source.join(' ')) {
    fail(where, `attribution printed "${headTokens.slice(at + 1).join(' ')}"`
      + ` but quote_source holds "${source.join(' ')}"`);
  }
  if (at !== quote.length) {
    fail(where, `quote holds ${quote.length} tokens but ${at} are printed before the attribution`);
    return;
  }
  if (headTokens.slice(0, at).join(' ') !== quote.join(' ')) {
    fail(where, `quote printed "${headTokens.slice(0, at).join(' ')}"`
      + ` but the record holds "${quote.join(' ')}"`);
  }
};

// The running header and the folio are page chrome: the header is the one thing that says
// whose pages these are, the folio the one thing that says which printed page this is. Both
// are compared here, against the record's name and page_range, and taken out of the content
// so that no entry has to account for them.
const chromeOf = (where, lines, className, printed, hasHeader, review) => {
  const filled = lines.map((text, index) => ({ index, text })).filter((line) => line.text.trim());
  if (!filled.length) {
    fail(where, 'the page is blank');
    return null;
  }
  const allowances = [];
  const folio = filled[filled.length - 1];
  if (!FOLIO.test(folio.text.trim())) {
    fail(where, `the last printed line is "${folio.text.trim()}", not a page number`);
  } else if (Number(folio.text.trim()) !== printed) {
    fail(where, `the footer prints page ${folio.text.trim()} where page_range puts ${printed}`);
  }
  allowances.push(allow('pdf', tokenize(folio.text),
    'the printed page number in the footer; page_range holds it as a number'));

  const head = filled[0];
  let first = 0;
  if (hasHeader) {
    if (head.text.trim() !== className) {
      fail(where, `the running header reads "${head.text.trim()}" on a ${className} page`);
    }
    allowances.push(allow('pdf', tokenize(head.text),
      'the running header; it names the class, which no entry on the page holds'));
    first = head.index + 1;
  } else if (head.text.trim() === className) {
    fail(where, 'a running header is printed on a page the cadence heads with none');
  }
  compare(`${where} chrome`, allowances.flatMap((allowance) => allowance.tokens), [], allowances);
  review.push(...allowances.map((allowance) =>
    `   allowed (${allowance.side}): ${allowance.tokens.join(' ')} -- ${allowance.why}`));
  return lines.slice(first, folio.index);
};

const verifyCover = (row, lines, review) => {
  const where = `${row.name} cover p${row.page_range[0]}`;
  const statLine = soleLine(where, lines, (text) => STAT_LINE.test(text), 'stat');
  const attribution = soleLine(where, lines, (text) => text.startsWith(ATTRIBUTION_DASH), 'attribution');
  const examples = soleLine(where, lines, (text) => EXAMPLES_HEADING.test(text), 'examples heading');
  const tips = soleLine(where, lines, (text) => text === QUICK_TIPS_HEADING, 'Quick Tips heading');
  const challenge = soleLine(where, lines, (text) => CHALLENGE_LEVEL.test(text), 'Challenge Level');
  if (!statLine || !attribution || !examples || !tips || !challenge) return;

  const between = (from, to) => lines.slice(lines.indexOf(from) + 1, lines.indexOf(to));
  const allowances = [];

  if (statLine.trim() !== row.stat_line) {
    fail(where, `the stat line printed "${statLine.trim()}" but the record holds "${row.stat_line}"`);
  }
  if (row.stat_note !== null) {
    fail(where, `stat_note holds ${JSON.stringify(row.stat_note)} but no Aspirant cover prints one`);
  }
  checkQuote(where, [...between(statLine, attribution), attribution].flatMap(tokenize), row);
  allowances.push(allow('pdf', [ATTRIBUTION_DASH],
    'the em dash that opens the attribution; quote_source holds only the name after it'));

  if (examples.trim() !== row.examples_heading) {
    fail(where, `the examples heading printed "${examples.trim()}"`
      + ` but the record holds "${row.examples_heading}"`);
  }
  if (tips.trim() !== row.tips_heading) {
    fail(where, `the tips heading printed "${tips.trim()}" but the record holds "${row.tips_heading}"`);
  }
  const level = challenge.trim().match(CHALLENGE_LEVEL)[1];
  if (level !== row.challenge_level) {
    fail(where, `the page prints Challenge Level ${level}, the record holds ${row.challenge_level}`);
  }
  allowances.push(allow('pdf', tokenize(CHALLENGE_LEVEL_LABEL),
    'the Challenge Level label; its value is in challenge_level'));

  // A paragraph opens on a first-line indent, so its left edge is a paragraph mark here rather
  // than a nesting level, and the runs are matched without it.
  const prose = bandOf(between(attribution, examples));
  const paragraphs = matchRuns(where, 'body paragraph', prose,
    [row.overview, row.conduit_notes, row.grounding].map((text) => ({ depth: 0, text })),
    { depths: false });
  if (paragraphs) checkParagraphOpenings(where, prose, paragraphs);
  matchRuns(where, 'example', withDepth(bandOf(between(examples, tips))),
    row.examples.map((text) => ({ depth: 0, text })));
  matchRuns(where, 'tip', withDepth(bandOf(between(tips, challenge))),
    row.tips.map((text) => ({ depth: 0, text })));

  const { abilities, advanced_abilities: advanced, gear, expanded_tips: expanded, ...cover } = row;
  // `name` comes from the running header, which is compared against it page by page.
  const recordTexts = textsExcept(cover, ['name']);
  checkSupMarkup(fail, where, recordTexts);
  checkBareRatings(fail, where, recordTexts);
  const recordTokens = tokensOf(recordTexts);
  allowances.push(supAllowance(recordTokens));
  compare(where, tokensIn(readingOf(lines)), recordTokens, allowances);

  review.push(`== cover, printed page ${row.page_range[0]}`,
    ...allowances.map((allowance) =>
      `   allowed (${allowance.side}): ${allowance.tokens.join(' ')} -- ${allowance.why}`),
    '--- printed ---', ...lines.filter((line) => line.trim()),
    '--- record ---', JSON.stringify(cover, null, 2), '');
};

// The notes are the last thing printed in an ability, between its Paired Action text and the
// Sample Perks heading, and they are set further left than that text. Reading the band
// upwards from the heading is what keeps a note out of the entry below it.
const abilityNoteBand = (printed, label, heading) => {
  const after = printed.slice(label + 1, heading);
  const opening = printed[label];
  const trailing = opening.slice(opening.indexOf(PAIRED_ACTION_LABEL) + PAIRED_ACTION_LABEL.length);
  const pairedIndent = trailing.trim()
    ? opening.length - trailing.length + indentOf(trailing)
    : Math.max(...after.map(indentOf));
  const band = [];
  for (let at = after.length - 1; at >= 0; at -= 1) {
    if (indentOf(after[at]) >= pairedIndent) break;
    band.unshift(after[at]);
  }
  return band;
};

// Each ability prints these three in this order and prints them nowhere else, so the page
// segments into abilities on them rather than on the white space between.
const abilityAnchors = (where, rows, entries) => {
  const labels = rowIndexes(rows, (text) => text.startsWith(PAIRED_ACTION_LABEL));
  const headings = rowIndexes(rows, (text) => text === SAMPLE_PERKS_HEADING);
  const compounds = rowIndexes(rows, (text) => text.startsWith(COMPOUNDED_LABEL));
  const counts = [labels, headings, compounds].map((found) => found.length);
  if (counts.some((count) => count !== entries.length)) {
    fail(where, `${counts.join('/')} Paired Action, Sample Perks and (Compounded) lines,`
      + ` expected ${entries.length} of each`);
    return null;
  }
  const anchors = [];
  let start = 0;
  for (let index = 0; index < entries.length; index += 1) {
    if (!(labels[index] < headings[index] && headings[index] < compounds[index])) {
      fail(where, `ability ${index + 1} prints its labels out of order`);
      return null;
    }
    const compound = entries[index].sample_perks[entries[index].sample_perks.length - 1].compound_text;
    if (compound === null) {
      fail(where, `ability ${index + 1} (${entries[index].name}) holds no compound_text`);
      return null;
    }
    // The label shares its line with the text it opens, so the run starts at what is left of
    // that line once the label is off it.
    const label = rows[compounds[index]];
    const opening = { ...label,
      tokens: label.tokens.slice(label.tokens.indexOf(COMPOUNDED_LABEL) + 1) };
    const end = consumedThrough([opening, ...rows.slice(compounds[index] + 1)], 0, recordRun(compound));
    if (end === null) {
      fail(where, `ability ${index + 1} (${entries[index].name}) holds a compound_text the page`
        + ' does not finish printing before the end of the page');
      return null;
    }
    const next = compounds[index] + end;
    anchors.push({ start, label: labels[index], heading: headings[index], end: next });
    start = next;
  }
  if (start !== rows.length) {
    fail(where, `${rows.length - start} printed line(s) below the last ability:`
      + ` "${rows.slice(start).map((row) => row.text).join(' / ')}"`);
    return null;
  }
  return anchors;
};

const verifyAbilityPage = (row, printed, lines, entries, review) => {
  const where = `${row.name} p${printed}`;
  const onPage = printedLinesOf(lines);
  const rows = readingOf(lines);
  const anchors = abilityAnchors(where, rows, entries);
  if (!anchors) return;

  anchors.forEach((anchor, index) => {
    const entry = entries[index];
    const region = rows.slice(anchor.start, anchor.end);
    const spot = `${where} ability ${index + 1} (${entry.name})`;
    const recordTexts = textsExcept(entry, []);
    checkSupMarkup(fail, spot, recordTexts);
    checkBareRatings(fail, spot, recordTexts);
    const recordTokens = tokensOf(recordTexts);
    const allowances = [
      allow('pdf', tokenize(PAIRED_ACTION_LABEL), 'a structural label; its text is in paired_action'),
      allow('pdf', tokenize(SAMPLE_PERKS_HEADING), 'a structural heading; its items are in sample_perks'),
      allow('pdf', tokenize(COMPOUNDED_LABEL), 'a structural label; its text is in compound_text'),
      supAllowance(recordTokens),
    ];
    compare(spot, tokensIn(region), recordTokens, allowances);
    matchNotes(spot, bandOf(abilityNoteBand(onPage, rows[anchor.label].at, rows[anchor.heading].at)),
      entry.notes);

    review.push(`== printed page ${printed}, ability ${index + 1}: ${entry.name}`,
      ...allowances.map((allowance) =>
        `   allowed (${allowance.side}): ${allowance.tokens.join(' ')} -- ${allowance.why}`),
      '--- printed ---', ...region.map((line) => line.line),
      '--- record ---', JSON.stringify(entry, null, 2), '');
  });
};

// A signature's notes hang inside its own text frame, below the name and description that sit
// at the frame's left edge and above the divider that closes the band. Reading upwards from
// the divider is what keeps the meter table, which is printed above the name, out of them.
const signatureNoteBand = (printed, divider) => {
  const above = printed.slice(0, divider);
  const left = Math.min(...above.map(indentOf));
  const band = [];
  for (let at = above.length - 1; at >= 0; at -= 1) {
    if (indentOf(above[at]) <= left) break;
    band.unshift(above[at]);
  }
  return band;
};

// Every signature prints the divider once and nothing else does, so the column segments into
// signatures on it and on the enchantment it introduces, rather than on the white space
// between them -- which, in a column, is only wherever the facing column happens to be empty.
const signatureAnchors = (where, rows, entries) => {
  const dividers = rowIndexes(rows, (text) => text === ENCHANTMENT_DIVIDER);
  if (dividers.length !== entries.length) {
    fail(where, `${dividers.length} "${ENCHANTMENT_DIVIDER}" dividers, expected ${entries.length}`);
    return null;
  }
  const anchors = [];
  let start = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const end = consumedThrough(rows, dividers[index] + 1,
      recordRun(entries[index].default_enchantment));
    if (end === null) {
      fail(where, `signature ${index + 1} (${entries[index].name}) holds a default_enchantment the`
        + ' page does not finish printing before the end of the column');
      return null;
    }
    anchors.push({ start, divider: dividers[index], end });
    start = end;
  }
  if (start !== rows.length) {
    fail(where, `${rows.length - start} printed line(s) below the last signature:`
      + ` "${rows.slice(start).map((row) => row.text).join(' / ')}"`);
    return null;
  }
  return anchors;
};

const verifySignatureColumn = (row, printed, lines, column, entries, review) => {
  const where = `${row.name} p${printed} column ${column}`;
  const onPage = printedLinesOf(lines);
  const rows = readingOf(lines);
  const anchors = signatureAnchors(where, rows, entries);
  if (!anchors) return;

  anchors.forEach((anchor, index) => {
    const entry = entries[index];
    const region = rows.slice(anchor.start, anchor.end);
    const spot = `${where} signature ${index + 1} (${entry.name})`;

    if (entry.column !== column) fail(spot, `column holds ${entry.column}, printed in column ${column}`);
    if (entry.position !== index + 1) {
      fail(spot, `position holds ${entry.position}, printed ${index + 1} down the column`);
    }
    const printedCategory = column === DEFAULT_ROSTER_COLUMN ? 'default' : 'elective';
    if (entry.category !== printedCategory) {
      fail(spot, `category holds "${entry.category}" but column ${column} of the spread`
        + ` is the ${printedCategory} roster`);
    }

    const recordTexts = textsExcept(entry, ['category']);
    checkSupMarkup(fail, spot, recordTexts);
    checkBareRatings(fail, spot, recordTexts);
    const recordTokens = tokensOf(recordTexts);
    const allowances = [
      allow('pdf', tokenize(ENCHANTMENT_DIVIDER),
        'the divider; what it separates is the default_enchantment object'),
      supAllowance(recordTokens),
    ];
    compare(spot, tokensIn(region), recordTokens, allowances);
    matchNotes(spot, bandOf(signatureNoteBand(onPage.slice(rows[anchor.start].at),
      rows[anchor.divider].at - rows[anchor.start].at)), entry.notes);

    review.push(`== printed page ${printed}, column ${column}, signature ${index + 1}: ${entry.name}`,
      ...allowances.map((allowance) =>
        `   allowed (${allowance.side}): ${allowance.tokens.join(' ')} -- ${allowance.why}`),
      '--- printed ---', ...region.map((line) => line.line),
      '--- record ---', JSON.stringify(entry, null, 2), '');
  });
};

const verifySignaturePage = (row, printed, lines, column, entries, review) => {
  const where = `${row.name} p${printed}`;
  const columns = columnsOf(where, lines);
  if (!columns) return;
  columns.forEach((columnLines, index) => verifySignatureColumn(row, printed, columnLines,
    column + index, entries.slice(index * ENTRIES_PER_COLUMN, (index + 1) * ENTRIES_PER_COLUMN), review));
};

const verifyTipsPage = (row, printed, lines, review) => {
  const where = `${row.name} p${printed}`;
  const columns = columnsOf(where, lines);
  if (!columns) return;
  [
    { heading: PLAYER_HEADING, notes: row.expanded_tips.player },
    { heading: CONDUIT_HEADING, notes: row.expanded_tips.conduit },
  ].forEach(({ heading, notes }, index) => {
    const spot = `${where} ${heading}`;
    const printedLines = columns[index].filter((line) => line.trim());
    if (!printedLines.length || printedLines[0].trim() !== heading) {
      fail(spot, `the column heads "${(printedLines[0] || '').trim()}", expected "${heading}"`);
      return;
    }
    const body = printedLines.slice(1);
    const recordTexts = textsExcept({ notes }, []);
    checkSupMarkup(fail, spot, recordTexts);
    checkBareRatings(fail, spot, recordTexts);
    const recordTokens = tokensOf(recordTexts);
    const allowances = [
      allow('pdf', tokenize(heading), 'the column heading; it is the expanded_tips key, not a value'),
      supAllowance(recordTokens),
    ];
    compare(spot, tokensIn(readingOf(printedLines)), recordTokens, allowances);
    matchNotes(spot, bandOf(body), notes);

    review.push(`== printed page ${printed}, ${heading} tips`,
      ...allowances.map((allowance) =>
        `   allowed (${allowance.side}): ${allowance.tokens.join(' ')} -- ${allowance.why}`),
      '--- printed ---', ...printedLines, '--- record ---', JSON.stringify(notes, null, 2), '');
  });
};

if (!PDF) throw new Error('usage: verify-aspirant-v1-extract.mjs <pdf> [artifact.json]');

const rows = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
mkdirSync(REVIEW_DIR, { recursive: true });

let cleanClasses = 0;

for (const row of rows) {
  if (!Array.isArray(row.page_range)) {
    console.log(`skip ${row.name} — no page_range, not locatable in the PDF`);
    continue;
  }
  const before = failures.length;
  const review = [`${row.name} -- printed pages ${row.page_range.join('-')} of ${PDF}`, ''];
  const [first, last] = row.page_range;
  if (last - first + 1 !== PAGES_PER_CLASS) {
    fail(row.name, `page_range spans ${last - first + 1} pages, expected ${PAGES_PER_CLASS}`);
  }
  const body = [];
  for (let offset = 0; offset < PAGES_PER_CLASS; offset += 1) {
    const printed = first + offset;
    const where = `${row.name} p${printed}`;
    review.push(`== chrome, printed page ${printed}`);
    body.push(chromeOf(where, pageLines(printed + PRINTED_FOLIO_OFFSET), row.name, printed,
      HEADER_OFFSETS.includes(offset), review));
  }
  review.push('');
  if (body.every(Boolean)) {
    verifyCover(row, body[COVER], review);
    verifyAbilityPage(row, first + CORE, body[CORE], row.abilities, review);
    verifyAbilityPage(row, first + ADVANCED, body[ADVANCED], row.advanced_abilities, review);
    verifySignaturePage(row, first + SIGNATURE_LEFT, body[SIGNATURE_LEFT], 1,
      row.gear.slice(0, COLUMNS_PER_PAGE * ENTRIES_PER_COLUMN), review);
    verifySignaturePage(row, first + SIGNATURE_RIGHT, body[SIGNATURE_RIGHT], 3,
      row.gear.slice(COLUMNS_PER_PAGE * ENTRIES_PER_COLUMN), review);
    verifyTipsPage(row, first + TIPS, body[TIPS], review);
  }
  const found = failures.slice(before);
  if (!found.length) cleanClasses += 1;
  review.push(found.length ? `VERDICT: ${found.length} difference(s)` : 'VERDICT: clean', ...found);
  writeFileSync(join(REVIEW_DIR, `${row.name}.txt`), `${review.join('\n')}\n`);
  report.push(`${found.length ? 'FAIL' : 'ok  '}  ${row.name} p${row.page_range.join('-')}${found.length ? ` (${found.length})` : ''}`);
}

console.log(report.join('\n'));
for (const failure of failures) console.log(`  ${failure}`);
const entries = rows.reduce((total, row) =>
  total + row.abilities.length + row.advanced_abilities.length + row.gear.length, 0);
console.log(`${cleanClasses}/${rows.length} classes verified, `
  + `${entries} entries compared, ${failures.length} token differences`);
console.log(`review files in ${REVIEW_DIR}`);
process.exitCode = failures.length ? 1 : 0;
