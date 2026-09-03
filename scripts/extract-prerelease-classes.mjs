// Turns the pre-release bundle PDF into the reviewed JSON artifact. Every string is
// lifted from the PDF's own word stream -- nothing is retyped, and nothing is rewritten.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { parseStatLine, clusterBands, pairMeters, buildNoteTree } from '../util/prerelease-extract.js';

const PDF = process.argv[2];
const OUT = process.argv[3] || 'docs/data/prerelease-classes-2026-08.json';

const readBoxes = (pdf) => execFileSync('pdftotext',
    ['-bbox-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });

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

const parseBlocks = (xhtml) => {
  const blocks = [];
  let page = 0;
  for (const [, pageBody] of xhtml.matchAll(PAGE)) {
    page += 1;
    for (const [, blockX, blockY, blockBody] of pageBody.matchAll(BLOCK)) {
      const lines = [];
      for (const [, lineX, lineY, lineBody] of blockBody.matchAll(LINE)) {
        const words = [...lineBody.matchAll(WORD)].map(([, x, y, xMax, yMax, text]) => ({
          xMin: Number(x), yMin: Number(y), xMax: Number(xMax), yMax: Number(yMax), text: decodeEntities(text),
        }));
        lines.push({ xMin: Number(lineX), yMin: Number(lineY), yMax: lowest(words), words });
      }
      blocks.push({ page, xMin: Number(blockX), yMin: Number(blockY), yMax: lowest(lines), lines });
    }
  }
  return blocks;
};

const joinWords = (words) => words.map((word) => word.text).join(' ');
const lineText = (line) => joinWords(line.words);
const blockText = (block) => joinWords(block.lines.flatMap((line) => line.words));
const isBullet = (text) => /^[❖➢]/.test(text);
const isNoteBlock = (block) => isBullet(lineText(block.lines[0]));
const byPosition = (a, b) => a.yMin - b.yMin || a.xMin - b.xMin;

const partOf = (line) => ({ xMin: line.xMin, yMin: line.yMin, words: [...line.words] });
const sealed = (part) => ({ ...part, text: joinWords(part.words) });

// A wrapped bullet continues on the next line of the same block, so a part runs from one
// bullet glyph to the next rather than from line to line.
const bulletParts = (block) => {
  const parts = [];
  for (const line of block.lines) {
    if (!parts.length || isBullet(lineText(line))) parts.push(partOf(line));
    else parts[parts.length - 1].words.push(...line.words);
  }
  return parts.map(sealed);
};

// -- Entry pages (abilities and signatures) -----------------------------------------
//
// These pages print an entry's name, its paired action, its description and its meters in
// four columns. pdftotext merges two columns into a single line whenever they share a
// baseline, so cells are cut back apart on the horizontal gap: within a column the widest
// gap between words is 3.6pt, while the narrowest jump between columns is 7.6pt.
const COLUMN_BREAK_GAP = 5;
const NAME_COLUMN_MAX_X = 150;
const METER_GUTTER_X = 380;
const COLUMN_SLACK = 5;
const PAIRED_ACTION_LABEL = 'Paired Action:';

// Two abilities print a pronunciation guide on its own line under the name. It is kept out
// of `name`, which is the key characters are matched on, but its brackets stay inside the
// value: the PDF fuses them to the adjacent words -- "(Pronounced" and "(“OON-fer-VOOST-leek”)"
// are single words in the stream -- so dropping them would alter the document's own tokens.
const isPronunciation = (text) => text.startsWith('(');

// A note spans the full text width and so never shares a line with another column.
const entryCells = (block) => {
  if (isNoteBlock(block)) {
    return [{
      xMin: block.lines[0].xMin,
      yMin: block.lines[0].yMin,
      yMax: block.yMax,
      text: blockText(block),
      isNote: true,
    }];
  }
  const cells = [];
  for (const line of block.lines) {
    let run = [];
    const flush = () => {
      if (run.length) {
        cells.push({
          xMin: run[0].xMin, yMin: run[0].yMin, yMax: lowest(run), text: joinWords(run), isNote: false,
        });
      }
      run = [];
    };
    for (const [index, word] of line.words.entries()) {
      if (index > 0 && word.xMin - line.words[index - 1].xMax >= COLUMN_BREAK_GAP) flush();
      run.push(word);
    }
    flush();
  }
  return cells;
};

// The two inner columns sit 30pt apart (paired action at 168.8, description at 198.8/199.5)
// while the cells of either one spread less than a point, so 25 separates them with room to
// spare. clusterBands measures a run from its start, so its default of 6 is never relied on:
// it would shatter the document's own 99-112 name column into a band per entry.
const COLUMN_TOLERANCE = 25;

// The description column is printed at 198.8 or 199.5 throughout. Bounding it on both sides
// catches a stray block dragging the band away, which is how an unrecognised running title
// first surfaced -- it pushed the derived column out to 246 and swallowed the descriptions.
const DESCRIPTION_COLUMN_RANGE = [190, 210];

const descriptionColumnX = (cells) => {
  const inner = cells
    .filter((cell) => !cell.isNote && cell.xMin > NAME_COLUMN_MAX_X && cell.xMin < METER_GUTTER_X)
    .map((cell) => cell.xMin);
  const bands = clusterBands(inner, COLUMN_TOLERANCE);
  const column = bands[bands.length - 1];
  const [low, high] = DESCRIPTION_COLUMN_RANGE;
  if (!(column >= low && column <= high)) {
    throw new Error(`Description column ${column} outside ${low}-${high}, from bands [${bands}]`);
  }
  return column;
};

// A name wrapping onto a second line drops about 19pt; the next entry starts more than 100pt
// below.
const NAME_WRAP_GAP = 25;

const nameGroups = (cells) => {
  const groups = [];
  const names = cells
    .filter((cell) => !cell.isNote && cell.xMin < NAME_COLUMN_MAX_X && cell.text !== PAIRED_ACTION_LABEL)
    .sort(byPosition);
  for (const cell of names) {
    const open = groups[groups.length - 1];
    if (open && cell.yMin - open[open.length - 1].yMin <= NAME_WRAP_GAP) open.push(cell);
    else groups.push([cell]);
  }
  return groups;
};

// An entry's meters and description begin above its name, so the split cannot simply precede
// each name. Between two names there is exactly one entry boundary, and it is the widest
// band of blank page in that interval -- measured against the lowest line reached so far,
// since a note four lines deep occupies far more of the page than its first line.
const entryTops = (cells, groups) => {
  const ordered = [...cells].sort(byPosition);
  return groups.slice(1).map((group, index) => {
    const after = groups[index][groups[index].length - 1].yMin;
    const before = group[0].yMin;
    let bottom = -Infinity;
    let widest = -1;
    let top = before;
    for (const cell of ordered) {
      if (cell.yMin > before) break;
      if (cell.yMin > after && cell.yMin - bottom > widest) {
        widest = cell.yMin - bottom;
        top = cell.yMin;
      }
      bottom = Math.max(bottom, cell.yMax);
    }
    return top;
  });
};

// pairMeters takes the FIRST value within 3pt of a label's row and does not consume it, so two
// labels sharing a row both claim the same value and silently orphan another -- and because the
// orphan still balances the cell count, no count-based check can see it. Guard the precondition
// instead: a correctly printed meter row holds exactly one label and one value.
const METER_ROW_TOLERANCE = 3;

const meterRows = (meterCells) => {
  const rows = [];
  for (const cell of [...meterCells].sort((a, b) => a.yMin - b.yMin)) {
    const open = rows[rows.length - 1];
    if (open && cell.yMin - open[0].yMin <= METER_ROW_TOLERANCE) open.push(cell);
    else rows.push([cell]);
  }
  return rows;
};

const readEntry = (cells, descriptionX, label, wantsPairedAction) => {
  const ordered = [...cells].sort(byPosition);
  const meterCells = ordered.filter((cell) => !cell.isNote && cell.xMin >= METER_GUTTER_X);
  const body = ordered.filter((cell) => !cell.isNote && cell.xMin < METER_GUTTER_X);
  const nameCells = body.filter((cell) => cell.xMin < NAME_COLUMN_MAX_X && cell.text !== PAIRED_ACTION_LABEL);
  const titleCells = nameCells.filter((cell) => !isPronunciation(cell.text));
  const spokenCells = nameCells.filter((cell) => isPronunciation(cell.text));
  const descriptionCells = body.filter((cell) => cell.xMin >= descriptionX - COLUMN_SLACK);
  const pairedCells = body.filter((cell) =>
    cell.xMin >= NAME_COLUMN_MAX_X && cell.xMin < descriptionX - COLUMN_SLACK);

  const meters = pairMeters(meterCells);
  const crowded = meterRows(meterCells).find((row) => row.length !== 2);
  if (crowded) {
    throw new Error(`${label}: meter row of ${crowded.length}: ${crowded.map((c) => c.text).join(' | ')}`);
  }
  if (!titleCells.length) throw new Error(`${label}: no name`);
  // Notes are printed last in an entry. A note above the name means a boundary landed too high
  // and this entry has taken a note off its neighbour.
  const stray = ordered.find((cell) => cell.isNote && cell.yMin < titleCells[0].yMin);
  if (stray) throw new Error(`${label}: note above the name: ${stray.text.slice(0, 60)}`);
  if (wantsPairedAction !== (pairedCells.length > 0)) {
    throw new Error(`${label}: ${pairedCells.length} paired-action cells`);
  }

  return {
    name: titleCells.map((cell) => cell.text).join(' '),
    pronunciation: spokenCells.map((cell) => cell.text).join(' ') || null,
    description: descriptionCells.length ? descriptionCells.map((cell) => cell.text).join(' ') : null,
    paired_action: pairedCells.map((cell) => cell.text).join(' ') || null,
    meters,
    notes: buildNoteTree(ordered.filter((cell) => cell.isNote)),
  };
};

// The running title sits at the top of every entry page, but not at a fixed height: the
// Bogatyr signatures page drops it 34pt lower than the rest.
const isPageChrome = (block) => /^(.+) (Abilities|Signatures)$/.test(blockText(block))
  || ['Default', 'Elective'].includes(blockText(block));

const readEntryPage = (pageBlocks, label, wantsPairedAction) => {
  const cells = pageBlocks.filter((block) => !isPageChrome(block)).flatMap(entryCells);
  const descriptionX = descriptionColumnX(cells);
  const groups = nameGroups(cells);
  if (groups.length !== 3) {
    throw new Error(`${label}: found ${groups.length} names, expected 3`);
  }
  const tops = entryTops(cells, groups);
  const bucket = (cell) => tops.filter((top) => cell.yMin >= top).length;
  return groups.map((_, index) => readEntry(
    cells.filter((cell) => bucket(cell) === index),
    descriptionX,
    `${label} entry ${index + 1}`,
    wantsPairedAction,
  ));
};

// -- Cover pages ---------------------------------------------------------------------
const BODY_COLUMN_X = 72;
const ATTRIBUTION_DASH = '—';

const flatBullets = (parts, label) => buildNoteTree(parts).map((note) => {
  if (note.children.length) throw new Error(`${label}: unexpected sub-bullet`);
  return note.text;
});

const readCover = (pageBlocks) => {
  const parts = pageBlocks.flatMap(bulletParts).sort(byPosition);
  const only = (test, what) => {
    const hits = parts.filter((part) => test(part.text));
    if (hits.length !== 1) throw new Error(`${what}: expected 1, found ${hits.length}`);
    return hits[0];
  };
  const atMostOne = (test, what) => {
    const hits = parts.filter((part) => test(part.text));
    if (hits.length > 1) throw new Error(`${what}: expected at most 1, found ${hits.length}`);
    return hits[0] ?? null;
  };

  const title = only((text) => /^[^a-z]+$/.test(text) && /\p{Lu}/u.test(text), 'class title');
  const statLine = only((text) => /^\+{1,2}[A-Z]/.test(text), 'stat line');
  const quote = only((text) => /^[“"]/.test(text), 'quote');
  const examplesHeading = only((text) => /^Examples from .*:$/.test(text), 'examples heading');
  const tipsHeading = only((text) => /^(Quick Tips|Tips on Playing .+)$/.test(text), 'tips heading');
  const challenge = only((text) => /^Challenge Level:\s*(\S+)$/.test(text), 'challenge level');
  const designer = atMostOne((text) => /^Design by (.+)$/.test(text), 'designer');
  const statNote = atMostOne((text) => text.startsWith('*'), 'stat note');

  const body = parts.filter((part) => Math.abs(part.xMin - BODY_COLUMN_X) < 1
    && !isBullet(part.text) && part !== examplesHeading && part !== statNote);
  if (body.length !== 3) throw new Error(`${title.text}: ${body.length} body paragraphs, expected 3`);
  const [overview, conduitNotes, grounding] = body;
  if (!conduitNotes.text.startsWith('Conduits designing')) {
    throw new Error(`${title.text}: second paragraph is not the Conduit note`);
  }
  if (!grounding.text.startsWith('Grounded in')) {
    throw new Error(`${title.text}: third paragraph is not the grounding note`);
  }

  const spoken = quote.words.map((word) => word.text);
  const dash = spoken.indexOf(ATTRIBUTION_DASH);
  if (dash < 1 || spoken.indexOf(ATTRIBUTION_DASH, dash + 1) !== -1) {
    throw new Error(`${title.text}: quote has no single attribution dash`);
  }

  const statSpread = parseStatLine(statLine.text);
  // parseStatLine skips a token its regex cannot match, so an unreadable line would yield a
  // partial spread and no error. The pluses on the page are the only check on that.
  const points = Object.values(statSpread).reduce((total, value) => total + value, 0);
  const printedPoints = (statLine.text.match(/\+/g) ?? []).length;
  const printedStats = statLine.text.split(/[,/]/).filter((token) => token.includes('+')).length;
  if (!points || points !== printedPoints || Object.keys(statSpread).length !== printedStats) {
    throw new Error(`${title.text}: "${statLine.text}" parsed to ${JSON.stringify(statSpread)}`);
  }

  return {
    name: title.text,
    designer: designer && designer.text.match(/^Design by (.+)$/)[1],
    stat_line: statLine.text,
    stat_note: statNote && statNote.text,
    stat_spread: statSpread,
    quote: spoken.slice(0, dash).join(' '),
    quote_source: spoken.slice(dash).join(' '),
    overview: overview.text,
    conduit_notes: conduitNotes.text,
    grounding: grounding.text,
    examples_heading: examplesHeading.text,
    examples: flatBullets(parts.filter((part) => isBullet(part.text)
      && part.yMin > examplesHeading.yMin && part.yMin < tipsHeading.yMin), 'examples'),
    tips_heading: tipsHeading.text,
    tips: flatBullets(parts.filter((part) => isBullet(part.text)
      && part.yMin > tipsHeading.yMin), 'tips'),
    challenge_level: challenge.text.match(/^Challenge Level:\s*(\S+)$/)[1],
  };
};

// -- Whole document --------------------------------------------------------------------
const SECTION_HEADINGS = ['PCCs', 'EXCLUSIVES', 'ASPIRANT CLASSES'];

// Only abilities carry a pronunciation, so a gear item growing one would otherwise lose the
// text silently.
const asGear = (category) => ({ name, pronunciation, description, meters, notes }) => {
  if (pronunciation) throw new Error(`gear "${name}" carries a pronunciation: ${pronunciation}`);
  return { name, description, category, meters, notes };
};

const extract = (blocks) => {
  const pages = new Map();
  for (const block of blocks) {
    if (!pages.has(block.page)) pages.set(block.page, []);
    pages.get(block.page).push(block);
  }
  for (const pageBlocks of pages.values()) pageBlocks.sort(byPosition);

  const heading = (page) => (pages.has(page) ? blockText(pages.get(page)[0]) : '');
  const classes = [];
  let section = null;

  for (const page of [...pages.keys()].sort((a, b) => a - b)) {
    const top = heading(page);
    if (SECTION_HEADINGS.includes(top)) section = top;
    if (!/^(.+) Abilities$/.test(top)) continue;

    const cover = readCover(pages.get(page - 1));
    const abilities = readEntryPage(pages.get(page), `${cover.name} abilities`, true);
    const gear = [
      ...readEntryPage(pages.get(page + 1), `${cover.name} default gear`, false).map(asGear('default')),
      ...readEntryPage(pages.get(page + 2), `${cover.name} elective gear`, false).map(asGear('elective')),
    ];

    classes.push({
      name: cover.name,
      prerelease_section: section,
      designer: cover.designer,
      stat_line: cover.stat_line,
      stat_note: cover.stat_note,
      stat_spread: cover.stat_spread,
      quote: cover.quote,
      quote_source: cover.quote_source,
      overview: cover.overview,
      conduit_notes: cover.conduit_notes,
      grounding: cover.grounding,
      examples_heading: cover.examples_heading,
      examples: cover.examples,
      tips_heading: cover.tips_heading,
      tips: cover.tips,
      challenge_level: cover.challenge_level,
      abilities: abilities.map(({ name, pronunciation, description, paired_action, meters, notes }) =>
        ({ name, pronunciation, description, paired_action, meters, notes })),
      gear,
      page_range: [page - 1, page + 2],
    });
  }
  return classes;
};

if (!PDF) throw new Error('usage: extract-prerelease-classes.mjs <pdf> [out.json]');

const rows = extract(parseBlocks(readBoxes(PDF)));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`extracted ${rows.length} classes`);
