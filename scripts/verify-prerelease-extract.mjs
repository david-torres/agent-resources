// Gates the load: nothing may be written to a database until this reports clean.
//
// The document's text must survive extraction token for token AND land in the field and the
// entry the page prints it under. So the comparison is per entry, per paragraph and per
// bullet, never per class: a class-wide token multiset cannot see a note that drifted onto a
// neighbouring entry, because the tokens never leave the class, and that is the one defect
// this extraction has actually shipped.
//
// The PDF side is read through `pdftotext -layout` and segmented on the document's own
// printed structure -- bullet glyphs, blank-line runs, and the rule that an entry's notes are
// printed last within it. The extractor reads `-bbox-layout` and segments on blank-band
// geometry, so neither side can borrow the other's mistake. Every value the record derives
// rather than transcribes -- the gear category, the section heading -- is checked against
// what the page prints, never against itself.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { tokenize } from '../util/prerelease-extract.js';

const PDF = process.argv[2];
const ARTIFACT = process.argv[3] || 'docs/data/prerelease-classes-2026-08.json';
const REVIEW_DIR = '/tmp/prerelease-review';

const BULLET_GLYPHS = '❖➢';
const RUNNING_TITLE = /^(\S+) (Abilities|Signatures)$/;
const GEAR_DIVIDER = /^(Default|Elective)$/;
const DESIGN_CREDIT = /^Design by (.+)$/;
const CHALLENGE_LEVEL = /^Challenge Level:\s*(\S+)$/;
const EXAMPLES_HEADING = /^Examples from .*:$/;
const TIPS_HEADING = /^(Quick Tips|Tips on Playing .+)$/;
const STAT_LINE = /^\+{1,2}[A-Z]/;
const STAT_NOTE = /^\*/;
const CLASS_TITLE = /^[^a-z]+$/;
const SECTION_HEADINGS = ['PCCs', 'EXCLUSIVES', 'ASPIRANT CLASSES'];
const ATTRIBUTION_DASH = '—';
const ENTRIES_PER_PAGE = 3;
const BODY_PARAGRAPHS = 3;

const pageLines = (page) => execFileSync('pdftotext',
    ['-f', String(page), '-l', String(page), '-layout', PDF, '-'],
    { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n');

// Nesting depth is the glyph's index: ❖ is a top-level note, ➢ a child of the note above it.
const bulletDepth = (line) => {
  const match = line.match(new RegExp(`^\\s*([${BULLET_GLYPHS}])`));
  return match ? BULLET_GLYPHS.indexOf(match[1]) : null;
};

// A bullet wraps onto unglyphed lines beneath it, so a unit runs from one glyph to the next
// non-blank interruption. Units carry the line they start on, which is what places a cover
// bullet on one side or the other of a heading; plain lines keep their line number too, so a
// wrapped bullet leaves a gap rather than reading as prose.
const splitBullets = (lines) => {
  const units = [];
  const plain = [];
  for (let index = 0; index < lines.length; index += 1) {
    const depth = bulletDepth(lines[index]);
    if (depth === null) {
      plain.push({ line: index, text: lines[index] });
      continue;
    }
    const body = [lines[index]];
    const line = index;
    while (index + 1 < lines.length && lines[index + 1].trim() && bulletDepth(lines[index + 1]) === null) {
      index += 1;
      body.push(lines[index]);
    }
    units.push({ depth, line, text: body.join(' ') });
  }
  return { units, plain };
};

// A paragraph is a run of consecutive plain lines, broken by a blank line or by any line a
// bullet has taken -- which is how the cover separates its prose from its headings and lists.
const plainRuns = (plain) => {
  const runs = [];
  let open = null;
  let previous = -2;
  for (const { line, text } of plain) {
    if (!text.trim()) {
      open = null;
    } else {
      if (!open || line !== previous + 1) {
        open = { line, lines: [] };
        runs.push(open);
      }
      open.lines.push(text.trim());
    }
    previous = line;
  }
  return runs.map((run) => ({ ...run, text: run.lines.join(' ') }));
};

// Notes are printed last within an entry, so an entry ends at the last line of its note run.
// The run itself is unbroken -- every one of the document's runs is followed by a blank line
// before the next entry's first line -- which makes the boundary structural rather than
// measured, and independent of the blank-band geometry the extractor segments on.
const entryRegions = (lines) => {
  const regions = [];
  let start = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (bulletDepth(lines[index]) === null) continue;
    let end = index;
    while (end + 1 < lines.length && lines[end + 1].trim() && bulletDepth(lines[end + 1]) === null) end += 1;
    const next = lines.slice(end + 1).find((line) => line.trim());
    index = end;
    if (next && bulletDepth(next) !== null) continue;
    regions.push(lines.slice(start, end + 1));
    start = end + 1;
  }
  return regions;
};

const textOf = (value) => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(textOf);
  if (value && typeof value === 'object') return Object.values(value).flatMap(textOf);
  return [];
};

// Numeric fields -- stat_spread's counts and page_range -- are derived rather than
// transcribed and carry no document token, so they drop out here by type.
const tokensExcept = (record, skip) => Object.entries(record)
  .filter(([key]) => !skip.includes(key))
  .flatMap(([, value]) => textOf(value))
  .flatMap(tokenize);

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

const compareSequence = (where, kind, printed, held) => {
  if (printed.length !== held.length) {
    fail(where, `${printed.length} ${kind}s printed, ${held.length} in the record`);
    return;
  }
  printed.forEach((unit, index) => {
    const onPage = tokenize(unit.text).join(' ');
    const onRecord = tokenize(held[index].text).join(' ');
    if (onPage !== onRecord) {
      fail(`${where} ${kind} ${index + 1}`, `printed "${onPage}" but the record holds "${onRecord}"`);
    }
    if (unit.depth !== held[index].depth) {
      fail(`${where} ${kind} ${index + 1}`,
        `printed at nesting depth ${unit.depth} but the record nests it at ${held[index].depth}`);
    }
  });
};

const asSequence = (texts) => texts.map((text) => ({ depth: 0, text: text ?? '' }));

const matchingLines = (lines, pattern) => lines.map((line) => line.trim().match(pattern)).filter(Boolean);

const soleMatch = (where, lines, pattern, what) => {
  const hits = matchingLines(lines, pattern);
  if (hits.length !== 1) {
    fail(where, `expected exactly one ${what} line, found ${hits.length}`);
    return null;
  }
  return hits[0];
};

const checkSoleLine = (where, lines, pattern, what, held) => {
  const hits = lines.map((line) => line.trim()).filter((line) => pattern.test(line));
  if (hits.length !== 1) {
    fail(where, `expected exactly one ${what} line, found ${hits.length}`);
    return;
  }
  if (hits[0] !== held) fail(where, `${what} printed "${hits[0]}" but the record holds "${held}"`);
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
  if (headTokens.slice(at).join(' ') !== source.join(' ')) {
    fail(where, `attribution printed "${headTokens.slice(at).join(' ')}" but quote_source holds "${source.join(' ')}"`);
  }
  if (at < quote.length) {
    fail(where, `quote holds ${quote.length} tokens but only ${at} are printed before the attribution`);
    return;
  }
  if (headTokens.slice(at - quote.length, at).join(' ') !== quote.join(' ')) {
    fail(where, `quote printed "${headTokens.slice(at - quote.length, at).join(' ')}" but the record holds "${quote.join(' ')}"`);
  }
};

const verifyCover = (row, section, review) => {
  const where = `${row.name} cover p${row.page_range[0]}`;
  const lines = pageLines(row.page_range[0]);
  const { units, plain } = splitBullets(lines);
  const plainText = plain.map((entry) => entry.text);
  const runs = plainRuns(plain);
  const allowances = [];

  // Nine classes carry no credit line, so its absence is legitimate; what is not legitimate
  // is the page and the record disagreeing about whether there is one.
  const credits = matchingLines(plainText, DESIGN_CREDIT);
  if (credits.length > 1) fail(where, `${credits.length} credit lines`);
  if (Boolean(row.designer) !== (credits.length === 1)) {
    fail(where, `designer is ${JSON.stringify(row.designer)} but the page prints ${credits.length} credit lines`);
  } else if (credits.length === 1) {
    if (credits[0][1] !== row.designer) {
      fail(where, `credit line names "${credits[0][1]}", record holds "${row.designer}"`);
    }
    allowances.push(allow('pdf', ['Design', 'by'], 'credit label; the designer name itself is in the record'));
  }

  const challenge = soleMatch(where, plainText, CHALLENGE_LEVEL, 'Challenge Level');
  if (challenge) {
    if (challenge[1] !== row.challenge_level) {
      fail(where, `page prints Challenge Level ${challenge[1]}, record holds ${row.challenge_level}`);
    }
    allowances.push(allow('pdf', ['Challenge', 'Level:'],
      'structural label with no field; its value is in challenge_level'));
  }

  if (row.prerelease_section !== section) {
    fail(where, `prerelease_section holds "${row.prerelease_section}" but the section-intro page above this class prints "${section}"`);
  }
  allowances.push(allow('record', tokenize(section),
    'section heading, printed on the section-intro page outside this class\'s page range'));

  const headings = runs.filter((run) => EXAMPLES_HEADING.test(run.text));
  const tipsHeadings = runs.filter((run) => TIPS_HEADING.test(run.text));
  if (headings.length !== 1 || tipsHeadings.length !== 1) {
    fail(where, `${headings.length} examples headings and ${tipsHeadings.length} tips headings, expected 1 of each`);
  } else {
    const [examples] = headings;
    const [tips] = tipsHeadings;
    if (examples.text !== row.examples_heading) {
      fail(where, `examples heading printed "${examples.text}" but the record holds "${row.examples_heading}"`);
    }
    if (tips.text !== row.tips_heading) {
      fail(where, `tips heading printed "${tips.text}" but the record holds "${row.tips_heading}"`);
    }

    // The three body paragraphs are printed immediately above the examples heading, in the
    // order the record stores them.
    const at = runs.indexOf(examples);
    compareSequence(where, 'body paragraph',
      asSequence(runs.slice(at - BODY_PARAGRAPHS, at).map((run) => run.text)),
      asSequence([row.overview, row.conduit_notes, row.grounding]));

    const head = runs.slice(0, at - BODY_PARAGRAPHS);
    const headLines = head.flatMap((run) => run.lines);
    checkSoleLine(where, headLines, CLASS_TITLE, 'class title', row.name);
    checkSoleLine(where, headLines, STAT_LINE, 'stat line', row.stat_line);
    checkQuote(where, head.flatMap((run) => tokenize(run.text)), row);

    // The stat note is the only prose between the two headings, and nine classes print none.
    const between = runs.slice(at + 1, runs.indexOf(tips));
    const printedNote = between.length === 1 && STAT_NOTE.test(between[0].text) ? between[0].text : null;
    if (between.length > 1) fail(where, `${between.length} runs between the headings, expected at most the stat note`);
    if (printedNote !== row.stat_note) {
      fail(where, `stat note printed ${JSON.stringify(printedNote)} but the record holds ${JSON.stringify(row.stat_note)}`);
    }

    // Which list a bullet belongs to is decided by which heading it is printed under, not by
    // where the record happens to have put it.
    const early = units.filter((unit) => unit.line < examples.line);
    if (early.length) fail(where, `${early.length} bullets printed above the examples heading`);
    compareSequence(where, 'example',
      units.filter((unit) => unit.line > examples.line && unit.line < tips.line), asSequence(row.examples));
    compareSequence(where, 'tip', units.filter((unit) => unit.line > tips.line), asSequence(row.tips));
  }

  compare(where, tokenize(plainText.join('\n')),
    tokensExcept(row, ['examples', 'tips', 'abilities', 'gear']), allowances);

  const { abilities, gear, ...coverFields } = row;
  review.push(`== cover, page ${row.page_range[0]}`,
    ...allowances.map((allowance) => `   allowed (${allowance.side}): ${allowance.tokens.join(' ')} -- ${allowance.why}`),
    '--- printed ---', ...plainText,
    '--- record ---', JSON.stringify(coverFields, null, 2), '',
    `   (${abilities.length} abilities and ${gear.length} gear items follow, one section each)`, '');
};

const verifyEntryPage = (row, page, entries, chrome, review) => {
  const lines = pageLines(page);
  const regions = entryRegions(lines);
  const where = `${row.name} p${page}`;
  if (regions.length !== ENTRIES_PER_PAGE) {
    fail(where, `page segments into ${regions.length} entries, expected ${ENTRIES_PER_PAGE}`);
    return;
  }

  // The abilities and default-gear pages head themselves with a running title; the
  // elective-gear page prints only its divider, on all 19 classes.
  const titles = matchingLines(lines, RUNNING_TITLE);
  const pageAllowances = [];
  if (titles.length !== (chrome.title ? 1 : 0)) {
    fail(where, `${titles.length} running title lines, expected ${chrome.title ? 1 : 0}`);
  } else if (chrome.title) {
    const [title] = titles;
    if (title[1].toUpperCase() !== row.name.toUpperCase()) {
      fail(where, `running title reads "${title[0]}" on a ${row.name} page`);
    }
    if (title[2] !== chrome.title) fail(where, `running title reads "${title[2]}", expected "${chrome.title}"`);
    pageAllowances.push(allow('pdf', [title[1], title[2]], 'per-page running title'));
  }
  let printedCategory = null;
  if (chrome.divider) {
    const divider = soleMatch(where, lines, GEAR_DIVIDER, 'gear divider');
    if (divider) {
      if (divider[1] !== chrome.divider) fail(where, `divider reads "${divider[1]}", expected "${chrome.divider}"`);
      printedCategory = divider[1].toLowerCase();
      pageAllowances.push(allow('pdf', [divider[1]], 'gear divider; re-encoded as the category field'));
    }
  }

  regions.forEach((region, index) => {
    const entry = entries[index];
    const { units, plain } = splitBullets(region);
    const allowances = index === 0 ? [...pageAllowances] : [];
    if ('paired_action' in entry) {
      allowances.push(allow('pdf', ['Paired', 'Action:'], 'structural label with no field'));
    }
    const spot = `${row.name} p${page} entry ${index + 1} (${entry.name})`;
    if ('category' in entry) {
      if (entry.category !== printedCategory) {
        fail(spot, `category holds "${entry.category}" but the page prints the "${chrome.divider}" divider`);
      }
      allowances.push(allow('record', [printedCategory],
        'the page\'s gear divider, lower-cased into the category field'));
    }
    compare(spot, tokenize(plain.map((line) => line.text).join('\n')), tokensExcept(entry, ['notes']), allowances);
    compareSequence(spot, 'note', units, flattenNotes(entry.notes));

    review.push(`== page ${page}, entry ${index + 1}: ${entry.name}`,
      ...allowances.map((allowance) => `   allowed (${allowance.side}): ${allowance.tokens.join(' ')} -- ${allowance.why}`),
      '--- printed ---', ...region, '--- record ---', JSON.stringify(entry, null, 2), '');
  });
};

// Each section heading is printed on its own intro page, which lies outside every class's
// page_range. Finding those pages is what lets prerelease_section be checked against the
// document instead of against itself.
const sectionPages = (rows) => {
  const covered = new Set();
  for (const row of rows) {
    const [first, last] = row.page_range;
    for (let page = first; page <= last; page += 1) covered.add(page);
  }
  const found = [];
  for (let page = 1; page <= Math.max(...rows.map((row) => row.page_range[1])); page += 1) {
    if (covered.has(page)) continue;
    const heading = (pageLines(page).find((line) => line.trim()) || '').trim();
    if (SECTION_HEADINGS.includes(heading)) found.push({ page, heading });
  }
  return found;
};

if (!PDF) throw new Error('usage: verify-prerelease-extract.mjs <pdf> [artifact.json]');

const rows = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
mkdirSync(REVIEW_DIR, { recursive: true });

const sections = sectionPages(rows);
if (sections.length !== SECTION_HEADINGS.length) {
  throw new Error(`found ${sections.length} section-intro pages, expected ${SECTION_HEADINGS.length}`);
}
const sectionAbove = (page) => sections.filter((entry) => entry.page < page).map((entry) => entry.heading).pop() ?? null;

let cleanClasses = 0;

for (const row of rows) {
  const before = failures.length;
  const review = [`${row.name} -- pages ${row.page_range.join('-')} of ${PDF}`, ''];
  const [cover] = row.page_range;
  verifyCover(row, sectionAbove(cover), review);
  verifyEntryPage(row, cover + 1, row.abilities, { title: 'Abilities' }, review);
  verifyEntryPage(row, cover + 2, row.gear.slice(0, ENTRIES_PER_PAGE), { title: 'Signatures', divider: 'Default' }, review);
  verifyEntryPage(row, cover + 3, row.gear.slice(ENTRIES_PER_PAGE), { title: null, divider: 'Elective' }, review);
  const found = failures.slice(before);
  if (!found.length) cleanClasses += 1;
  review.push(found.length ? `VERDICT: ${found.length} difference(s)` : 'VERDICT: clean', ...found);
  writeFileSync(join(REVIEW_DIR, `${row.name}.txt`), `${review.join('\n')}\n`);
  report.push(`${found.length ? 'FAIL' : 'ok  '}  ${row.name} p${row.page_range.join('-')}${found.length ? ` (${found.length})` : ''}`);
}

console.log(report.join('\n'));
for (const failure of failures) console.log(`  ${failure}`);
const entries = rows.reduce((total, row) => total + row.abilities.length + row.gear.length, 0);
console.log(`${cleanClasses}/${rows.length} classes verified, `
  + `${entries} entries compared, ${failures.length} token differences`);
console.log(`review files in ${REVIEW_DIR}`);
process.exitCode = failures.length ? 1 : 0;
