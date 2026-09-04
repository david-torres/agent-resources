// Gates the load: nothing may be written to a database until this reports clean.
//
// The document's text must survive extraction token for token AND land in the entry the
// page prints it under. So the comparison is per entry and per bullet, never per class: a
// class-wide token multiset cannot see a note that drifted onto a neighbouring entry,
// because the tokens never leave the class, and that is the one defect this extraction has
// actually shipped.
//
// The PDF side is read through `pdftotext -layout` and segmented on the document's own
// printed structure -- bullet glyphs, and the rule that an entry's notes are printed last
// within it. The extractor reads `-bbox-layout` and segments on blank-band geometry, so
// neither side can borrow the other's mistake.
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
const ENTRIES_PER_PAGE = 3;

const pageLines = (page) => execFileSync('pdftotext',
    ['-f', String(page), '-l', String(page), '-layout', PDF, '-'],
    { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n');

// Nesting depth is the glyph's index: ❖ is a top-level note, ➢ a child of the note above it.
const bulletDepth = (line) => {
  const match = line.match(new RegExp(`^\\s*([${BULLET_GLYPHS}])`));
  return match ? BULLET_GLYPHS.indexOf(match[1]) : null;
};

// A bullet wraps onto unglyphed lines beneath it, so a unit runs from one glyph to the next
// non-blank interruption.
const splitBullets = (lines) => {
  const units = [];
  const plain = [];
  for (let index = 0; index < lines.length; index += 1) {
    const depth = bulletDepth(lines[index]);
    if (depth === null) {
      plain.push(lines[index]);
      continue;
    }
    const body = [lines[index]];
    while (index + 1 < lines.length && lines[index + 1].trim() && bulletDepth(lines[index + 1]) === null) {
      index += 1;
      body.push(lines[index]);
    }
    units.push({ depth, text: body.join(' ') });
  }
  return { units, plain };
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
// not observed is as much a failure as one observed but not allowed.
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

const compareBullets = (where, units, expected) => {
  if (units.length !== expected.length) {
    fail(where, `${units.length} bullets printed, ${expected.length} in the record`);
    return;
  }
  units.forEach((unit, index) => {
    const printed = tokenize(unit.text);
    const held = tokenize(expected[index].text);
    if (printed.join(' ') !== held.join(' ')) {
      fail(`${where} bullet ${index + 1}`, `printed "${printed.join(' ')}" but the record holds "${held.join(' ')}"`);
    }
    if (unit.depth !== expected[index].depth) {
      fail(`${where} bullet ${index + 1}`,
        `printed at nesting depth ${unit.depth} but the record nests it at ${expected[index].depth}`);
    }
  });
};

const matchingLines = (lines, pattern) => lines.map((line) => line.trim().match(pattern)).filter(Boolean);

const soleMatch = (where, lines, pattern, what) => {
  const hits = matchingLines(lines, pattern);
  if (hits.length !== 1) {
    fail(where, `expected exactly one ${what} line, found ${hits.length}`);
    return null;
  }
  return hits[0];
};

const verifyCover = (row, review) => {
  const where = `${row.name} cover p${row.page_range[0]}`;
  const { units, plain } = splitBullets(pageLines(row.page_range[0]));
  const allowances = [];

  // Nine classes carry no credit line, so its absence is legitimate; what is not legitimate
  // is the page and the record disagreeing about whether there is one.
  const credits = matchingLines(plain, DESIGN_CREDIT);
  if (credits.length > 1) fail(where, `${credits.length} credit lines`);
  if (Boolean(row.designer) !== (credits.length === 1)) {
    fail(where, `designer is ${JSON.stringify(row.designer)} but the page prints ${credits.length} credit lines`);
  } else if (credits.length === 1) {
    if (credits[0][1] !== row.designer) {
      fail(where, `credit line names "${credits[0][1]}", record holds "${row.designer}"`);
    }
    allowances.push(allow('pdf', ['Design', 'by'], 'credit label; the designer name itself is in the record'));
  }

  const challenge = soleMatch(where, plain, CHALLENGE_LEVEL, 'Challenge Level');
  if (challenge) {
    if (challenge[1] !== row.challenge_level) {
      fail(where, `page prints Challenge Level ${challenge[1]}, record holds ${row.challenge_level}`);
    }
    allowances.push(allow('pdf', ['Challenge', 'Level:'],
      'structural label with no field; its value is in challenge_level'));
  }

  allowances.push(allow('record', tokenize(row.prerelease_section),
    'section heading, printed on the section-intro page outside this class\'s page range'));

  compare(where, tokenize(plain.join('\n')),
    tokensExcept(row, ['examples', 'tips', 'abilities', 'gear']), allowances);
  compareBullets(where, units,
    [...row.examples, ...row.tips].map((text) => ({ depth: 0, text })));

  const { abilities, gear, ...coverFields } = row;
  review.push(`== cover, page ${row.page_range[0]}`,
    ...allowances.map((entry) => `   allowed (${entry.side}): ${entry.tokens.join(' ')} -- ${entry.why}`),
    '--- printed ---', ...plain,
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
  if (chrome.divider) {
    const divider = soleMatch(where, lines, GEAR_DIVIDER, 'gear divider');
    if (divider) {
      if (divider[1] !== chrome.divider) fail(where, `divider reads "${divider[1]}", expected "${chrome.divider}"`);
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
    if ('category' in entry) {
      allowances.push(allow('record', [entry.category], 'gear divider, lower-cased into the category field'));
    }
    const spot = `${row.name} p${page} entry ${index + 1} (${entry.name})`;
    compare(spot, tokenize(plain.join('\n')), tokensExcept(entry, ['notes']), allowances);
    compareBullets(spot, units, flattenNotes(entry.notes));

    review.push(`== page ${page}, entry ${index + 1}: ${entry.name}`,
      ...allowances.map((entry) => `   allowed (${entry.side}): ${entry.tokens.join(' ')} -- ${entry.why}`),
      '--- printed ---', ...region, '--- record ---', JSON.stringify(entry, null, 2), '');
  });
};

if (!PDF) throw new Error('usage: verify-prerelease-extract.mjs <pdf> [artifact.json]');

const rows = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
mkdirSync(REVIEW_DIR, { recursive: true });

let cleanClasses = 0;

for (const row of rows) {
  const before = failures.length;
  const review = [`${row.name} -- pages ${row.page_range.join('-')} of ${PDF}`, ''];
  const [cover] = row.page_range;
  verifyCover(row, review);
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
process.exit(failures.length ? 1 : 0);
