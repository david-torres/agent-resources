# Aspirant V1 Ingestion Implementation Plan (plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the twelve classes of `ENCLAVE___Aspirant_V1.pdf` into a verified artifact, load them as forks that leave every existing row untouched, grant them through the Aspirant book, and repair the `class_abilities.type` backfill that slice 2 shipped as a no-op.

**Architecture:** Extraction logic lives in `util/aspirant-extract.js` — a pure, unit-tested module — with `scripts/extract-aspirant-v1-classes.mjs` reduced to a thin CLI wrapper, because `scripts/run-tests.mjs:54` scans only `models, routes, services, test, util, views` and a test under `scripts/` would silently never run. A second script re-reads the PDF in a different `pdftotext` mode and compares bidirectional token multisets against an exact allowance list, so extractor and verifier cannot share a segmentation bug. The existing loader gains an explicit per-plan *disposition* (create / update / fork) rather than branching on the truthiness of a matched row, and a per-book descriptor replaces the artifact-path literals now copied across five files.

**Tech Stack:** Bun, Node ESM under `scripts/`, CommonJS under `util/`, `bun:test`, poppler (`pdftotext -bbox-layout` and `-layout`), Supabase/Postgres, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-16-aspirant-v1-ingestion-design.md`

**Measured geometry:** `docs/superpowers/specs/2026-09-16-aspirant-v1-geometry.md` — every number in the extractor tasks comes from this file. It was measured against the real PDF, and **it contradicts the spec in three places**; where they disagree, the geometry document wins:

| Spec says | Measurement says |
| --- | --- |
| recto/verso differ by ~11.5pt for every column | 11.52 everywhere **except** signature-page note indents, which shift **16.32** |
| note indent step ~19.2pt | 19.20 on signature and ability pages; **18.72** on Expanded Tips |
| note boundaries from y-leading | Confirmed, and separable with clear air — thresholds **16.00** (Tips) and **minLeading + 2.0** (elsewhere) |

**Plan 1 of 2** (`docs/superpowers/plans/2026-09-16-aspirant-v1-class-format.md`) landed the schema and contract work: `content_format`, `expanded_tips`, gear `column`/`position`, the family firewall, Power Rating rendering. It is complete and merged into this branch. This plan consumes those contracts and does not revisit them.

## Global Constraints

Copied from the spec and from CLAUDE.md. Every task's requirements implicitly include this section.

- **TDD throughout**, via the `tdd-red` / `tdd-green` / `tdd-refactor` agents. Write the failing test, run it, see it fail for the stated reason, then implement.
- **No dead code.** When you replace something, delete the thing it replaced in the same change. No `_old` duplicates, no fallbacks, no deprecation paths.
- **Comments explain non-obvious *why* only.** Never restate what the code says, never narrate history ("was X, now Y"), never leave changelog notes.
- **`SUPABASE_URL` is hand-switched between the local stack and LIVE PRODUCTION.** Read it before anything that writes. Prefer `eval "$(supabase status -o env)"` and assert `http://127.0.0.1:54321`.
- **NEVER run `supabase db reset`.** The local database holds a restored production copy, not seed data. Apply migrations with `supabase migration up` only.
- **Never read or restore anything under `backups/`.**
- `bun run test:unit` is always safe — it scrubs `SUPABASE_URL`.
- **`bun run test:integration <file>` silently ignores its file argument.** `scripts/run-tests.mjs:47` reads `argv[2]` as the *mode*, so the whole integration set runs and exits at the first pre-existing failure and your file never executes. To run one integration file:
  ```bash
  SUPABASE_URL=http://127.0.0.1:54321 bun test util/some-file.integration.test.js
  ```
- **Known pre-existing failures — do not mistake these for new breakage.** Establish this baseline before changing anything:
  - http: `routes/open-graph.test.js` (1)
  - integration: `character-content-integrity`, `image-crop-integrity` (2), and `util/class-form-round-trip.integration.test.js` (1 of 3 — the other 2 pass and must stay passing)
  - e2e: `22-classes-crud` (5), `18-book-class-unlocks` (1)
- **Never debug a page with a single-page `pdftotext` extract.** `pdftotext -bbox-layout -f 20 -l 20` emits that page as page **1**, so `parseBboxPages` numbers it 1, which flips its recto/verso parity and with it every indent the extractor expects. The block count and coordinates are otherwise identical, so the failure looks like a code bug: page 20 parses correctly from a whole-book extract and throws `signature entry block at no known indent` from a single-page one. Parse the whole book and index into it, or set the page number explicitly on the fixture.
- **The en dash in Power Ratings is U+2013**, verified by codepoint. U+2014 (em dash) occurs only as the quote-attribution dash. Do not normalize either.
- The book spells it **Witchfinder**. The string `Witchhunter` does not occur in it.
- PDF page = printed page + 5. The twelve class blocks start at PDF pages 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84.

---

## File Structure

**Created:**
- `util/aspirant-extract.js` — all extraction logic, pure, CommonJS, unit-tested. Deliberately a sibling of `util/prerelease-extract.js` rather than an extension of it, so a change made for this book cannot silently alter the artifact the other book already produced.
- `util/aspirant-extract.test.js` — its unit cover.
- `scripts/lib/books.mjs` — the per-book descriptor.
- `test/books.test.js` — its cover.
- `scripts/extract-aspirant-v1-classes.mjs` — thin CLI wrapper.
- `scripts/verify-aspirant-v1-extract.mjs` — the gate.
- `docs/data/aspirant-v1-classes-2026-09.json` — the artifact (generated, committed).
- `supabase/migrations/20260917000000_retag_class_abilities_advanced.sql` — the re-run backfill.
- `e2e/specs/27-aspirant-v1-class-page.spec.js` — the rendered-page pass.

**Modified:**
- `scripts/load-prerelease-classes.mjs` — fork disposition; descriptor.
- `scripts/lib/character-impact.mjs` — fork projection shape.
- `test/load-prerelease-classes.test.js` — descriptor; fork cover; `base_class_id` leaves `FORBIDDEN` for fork plans.
- `scripts/extract-prerelease-classes.mjs`, `scripts/verify-prerelease-extract.mjs`, `scripts/report-character-impact.mjs` — descriptor.
- `util/starter-content.js` — `CORE_CLASS_UNLOCKS.aspirant` gains twelve ids and changes shape.
- `util/book-classes.js`, `util/seed-classes.js` — read the new shape.
- `util/book-classes.test.js`, `util/seed-classes.test.js`, `util/core-roster.integration.test.js`, `models/class-book-unlocks.test.js`, `e2e/specs/18-book-class-unlocks.spec.js` — follow it.

## Shared interfaces

Every extractor task consumes and extends this one module. These signatures are fixed here so tasks 2–8 agree without reading each other.

```js
// util/aspirant-extract.js — exported surface when the plan is complete

// --- bbox parsing (Task 2) ---
decodeEntities(text) -> string
parseBboxPages(xhtml) -> [Page]
// Page  := { page: int, blocks: [Block] }                 // page is 1-based PDF page
// Block := { xMin, yMin, yMax, lines: [Line] }
// Line  := { xMin, yMin, yMax, words: [Word] }
// Word  := { xMin, yMin, xMax, yMax, text }

// --- page model (Task 2) ---
CLASS_NAMES            // the twelve, in book order
FIRST_CLASS_PAGE       // 18
PAGES_PER_CLASS        // 6
classPageNumbers(i) -> { cover, core, sigLeft, sigRight, advanced, tips }   // i = 0..11
isCoverPage(page) -> boolean
printedPage(pdfPage) -> int
headerName(page) -> string | null
isRecto(pdfPage) -> boolean            // odd PDF page

// --- bands (Task 2) ---
RECTO_SHIFT                   // 11.52
SIGNATURE_NOTE_RECTO_SHIFT    // 16.32
shiftFor(pdfPage, kind) -> number      // kind: 'body' | 'signature-note'

// --- superscripts (Task 3) ---
POWER_RATINGS                 // the ten strings, U+2013 dashes
isSuperscript(word, line) -> boolean
rethreadSuperscripts(page) -> Page     // reattaches the 21 detached ratings
markPowerRatings(line) -> string       // "Boosted <sup>L–H</sup> and ..."

// --- notes (Task 4) ---
noteTree(lines, { step, threshold }) -> [{ text, children }]
TIPS_NOTE_STEP        // 18.72
TIPS_NOTE_THRESHOLD   // 16.00
BODY_NOTE_STEP        // 19.20

// --- sections (Tasks 5-7) ---
signatureEntries(page, side) -> [Entry]      // 6 per page, column/position assigned
abilityEntries(page) -> [Ability]            // 3 per page
coverFields(page) -> { stat_line, quote, ... }
expandedTips(page) -> { player: [note], conduit: [note] }

// --- assembly (Task 8) ---
extractClass(pages, i) -> Record
extractBook(pages) -> [Record]
```

**The artifact record** mirrors `docs/data/prerelease-classes-2026-08.json` and adds the V1 fields. Keys, in order:

```
name, designer, stat_line, stat_note, stat_spread, quote, quote_source,
overview, conduit_notes, grounding, examples_heading, examples,
tips_heading, tips, challenge_level, abilities, advanced_abilities,
gear, expanded_tips, page_range
```

`prerelease_section` is absent — that column describes the other book's page sections and has no meaning here. `gear[i]` carries `name, description, category, meters, notes, default_enchantment, column, position`. `abilities[i]` and `advanced_abilities[i]` carry `name, pronunciation, dedication, description, paired_action, meters, notes, sample_perks`, where `sample_perks[j]` is `{ name, dedication, text, compound_text }`. An **ability** carries its own `dedication` because one does: p64 `Gravity Check` prints an `In Honor of` line under the ability name, 60pt above its `Sample Perks` heading. Without that field the book's dedication count comes to 37 rather than 38.

---

### Task 1: The per-book descriptor

The artifact and remap paths are module constants repeated as literals across five files. A second book would add a sixth copy. Replace them with one descriptor before anything else needs it.

**Files:**
- Create: `scripts/lib/books.mjs`
- Create: `test/books.test.js`
- Modify: `scripts/load-prerelease-classes.mjs:37-39,44,225` (`DATA`, `ARTIFACT`, `REMAP`, `ALIASES`, the `readFileSync(ARTIFACT)` call)
- Modify: `scripts/lib/character-impact.mjs:30,63` (`PUBLISHED_BY_LOAD` moves out; `projectImport` gains a `book` parameter; its call site is `scripts/load-prerelease-classes.mjs:296`)
- Modify: `scripts/extract-prerelease-classes.mjs:10`
- Modify: `scripts/verify-prerelease-extract.mjs:23`
- Modify: `scripts/report-character-impact.mjs:35`
- Modify: `test/load-prerelease-classes.test.js:19-22,237-262`

**Interfaces:**
- Produces: `BOOKS` (keyed `'prerelease'` and `'aspirant-v1'`), `bookFor(key)`, and each descriptor's `{ key, artifact, remap, aliases, publishedByLoad, contentFormat, rulesEdition, forks }`. `artifact` and `remap` are absolute paths already joined against the repo root — a consumer never joins again. `remap` is `null` when the book has no remap file.
- Produces: `projectImport(classes, plans, book)` — the third parameter replaces the module-level `PUBLISHED_BY_LOAD`.

- [ ] **Step 1: Write the failing test**

`test/books.test.js`:

```js
import { test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { BOOKS, bookFor } from '../scripts/lib/books.mjs';

// Widened to every book by Task 8, which produces the second artifact. Scoped
// here so the unit suite does not sit red through the seven extractor tasks,
// where a standing failure would mask a new one.
test('the pre-release descriptor names an artifact that exists on disk', () => {
  expect(existsSync(BOOKS.prerelease.artifact)).toBe(true);
});

test('a remap path is either null or a file that exists', () => {
  for (const book of Object.values(BOOKS)) {
    if (book.remap === null) continue;
    expect(existsSync(book.remap)).toBe(true);
  }
});

test('each descriptor carries its own key', () => {
  for (const [key, book] of Object.entries(BOOKS)) expect(book.key).toBe(key);
});

test('an unknown book key is refused by name rather than returning undefined', () => {
  expect(() => bookFor('no-such-book')).toThrow('no-such-book');
});

test('the pre-release book keeps the Witchhunter alias and the Aspirant book does not', () => {
  expect(bookFor('prerelease').aliases).toEqual({ Witchfinder: 'Witchhunter' });
  expect(bookFor('aspirant-v1').aliases).toEqual({});
});

test('only the Aspirant book forks, and only it carries aspirant content', () => {
  expect(bookFor('prerelease').forks).toBe(false);
  expect(bookFor('prerelease').contentFormat).toBe('advent');
  expect(bookFor('aspirant-v1').forks).toBe(true);
  expect(bookFor('aspirant-v1').contentFormat).toBe('aspirant');
  expect(bookFor('aspirant-v1').rulesEdition).toBe('aspirant');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
bun test test/books.test.js
```
Expected: FAIL — `Cannot find module '../scripts/lib/books.mjs'`.

- [ ] **Step 3: Write `scripts/lib/books.mjs`**

```js
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'data');

// One book's ingestion in one place: where its artifact lives, what names it
// resolves under, and what the load is authorised to make visible.
export const BOOKS = {
  prerelease: {
    key: 'prerelease',
    artifact: join(DATA, 'prerelease-classes-2026-08.json'),
    remap: join(DATA, 'prerelease-name-remap.json'),
    // The document renames this class; the catalogue still holds the old
    // spelling until a load lands. Resolution accepts both, so a second run
    // finds the row it renamed rather than creating another.
    aliases: { Witchfinder: 'Witchhunter' },
    publishedByLoad: ['Ardent', 'Offdriver', 'Squire', 'Drachentöter', 'Charlatan'],
    contentFormat: 'advent',
    rulesEdition: null,
    forks: false
  },
  'aspirant-v1': {
    key: 'aspirant-v1',
    artifact: join(DATA, 'aspirant-v1-classes-2026-09.json'),
    // V1 introduces no name this catalogue already holds under a different
    // spelling, and it renames nothing: it only adds rows.
    remap: null,
    aliases: {},
    publishedByLoad: ['Gunslinger', 'Illusionist', 'Librarian', 'Thane', 'Thunderbird',
      'Wanderer', 'Berserker', 'Freerunner', 'Infiltrator', 'Samaritan', 'Vessel',
      'Witchfinder'],
    contentFormat: 'aspirant',
    rulesEdition: 'aspirant',
    forks: true
  }
};

export const bookFor = (key) => {
  const book = BOOKS[key];
  if (!book) throw new Error(`unknown book: ${JSON.stringify(key)}`);
  return book;
};
```

- [ ] **Step 4: Point the five consumers at it**

In each file, delete the path literal and read it from the descriptor. `scripts/load-prerelease-classes.mjs` currently hardcodes the pre-release book; it gains a `--book <key>` flag defaulting to `prerelease`, and `ALIASES` (`:44`) is deleted in favour of `book.aliases` — `resolveTarget(payload, rows)` becomes `resolveTarget(payload, rows, book)`.

In `scripts/lib/character-impact.mjs`, delete `PUBLISHED_BY_LOAD` (`:30`) and change the last line of `projectImport` to read the list from the new third parameter:

```js
export const projectImport = (classes, plans, book) => {
  // ... unchanged ...
  return [...updated, ...created].map((cls) =>
      (book.publishedByLoad.includes(cls.name) ? { ...cls, is_public: true } : cls));
};
```

Update the four call sites that break: `scripts/load-prerelease-classes.mjs:296`, `scripts/report-character-impact.mjs`, and `test/load-prerelease-classes.test.js:237-262` (which imports `PUBLISHED_BY_LOAD` at `:16` — it now imports `bookFor` and reads `bookFor('prerelease').publishedByLoad`).

- [ ] **Step 5: Run the tests**

```bash
bun run test:unit
```
Expected: green apart from the known pre-existing failures. This task must not leave a new standing failure — every later task uses a green unit suite as its baseline.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/books.mjs test/books.test.js scripts/ test/load-prerelease-classes.test.js
git commit -m "refactor: give each book one descriptor instead of five path literals"
```

---

### Task 2: bbox parsing, the page model, and per-side bands

The foundation every later extractor task builds on. All numbers here are measured — see `docs/superpowers/specs/2026-09-16-aspirant-v1-geometry.md` §1, §2, §3.

**Files:**
- Create: `util/aspirant-extract.js`
- Create: `util/aspirant-extract.test.js`

**Interfaces:**
- Produces: `decodeEntities`, `parseBboxPages`, `CLASS_NAMES`, `FIRST_CLASS_PAGE`, `PAGES_PER_CLASS`, `classPageNumbers`, `isCoverPage`, `printedPage`, `headerName`, `isRecto`, `RECTO_SHIFT`, `SIGNATURE_NOTE_RECTO_SHIFT`, `shiftFor`. Shapes are as declared under "Shared interfaces" above.

**Why a new module rather than extending `util/prerelease-extract.js`:** that module's artifact is already committed and verified token-for-token. A change made for this book must not be able to alter it. `parseStatLine`, `clusterBands` and `pairMeters` are reused by **importing** them from `util/prerelease-extract.js`, not by copying them.

- [ ] **Step 1: Write the failing test**

`util/aspirant-extract.test.js`:

```js
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
bun test util/aspirant-extract.test.js
```
Expected: FAIL — `Cannot find module './aspirant-extract'`.

- [ ] **Step 3: Implement `util/aspirant-extract.js`**

Port `decodeEntities`, the `PAGE`/`BLOCK`/`LINE`/`WORD` regexes and the `lowest()` helper from `scripts/extract-prerelease-classes.mjs:15-46`, changing the return shape from a flat block list to pages of blocks (the page model needs to address a page directly, and `Page.page` must be the 1-based PDF page). Then:

```js
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

// Identical on all 48 header pages.
const HEADER_Y_MIN = 23.23;
const HEADER_Y_MAX = 38.86;

const RECTO_SHIFT = 11.52;
const SIGNATURE_NOTE_RECTO_SHIFT = 16.32;

const shiftFor = (pdfPage, kind) => {
  if (!isRecto(pdfPage)) return 0;
  return kind === 'signature-note' ? SIGNATURE_NOTE_RECTO_SHIFT : RECTO_SHIFT;
};
```

`isCoverPage(page)` requires **both** markers: a single-line block whose word height rounds to `STAT_LINE_HEIGHT` at `STAT_LINE_Y`, horizontally centred within `CENTRE_TOLERANCE` of `PAGE_CENTRE`; and the two-word run `Challenge Level:` with `yMin > CHALLENGE_LEVEL_MIN_Y`. Compare floats with a tolerance (use `0.5` for y and height) — never `===`.

`headerName(page)` returns the text of the single line whose `yMin` is within `0.5` of `HEADER_Y_MIN` and `yMax` within `0.5` of `HEADER_Y_MAX`, or `null` when no line sits in that band.

- [ ] **Step 4: Run the tests**

```bash
bun test util/aspirant-extract.test.js
```
Expected: PASS, all cases.

- [ ] **Step 5: Prove the model against the real book**

This is the step that catches a cadence that is right in the fixtures and wrong in the PDF. Write `/tmp/check-cadence.mjs` in the scratchpad, not the repo:

```js
import { execFileSync } from 'node:child_process';
const { parseBboxPages, isCoverPage, headerName, classPageNumbers, CLASS_NAMES } =
  await import('../util/aspirant-extract.js').then((m) => m.default ?? m);

const xhtml = execFileSync('pdftotext',
  ['-bbox-layout', '/home/dave/Documents/Enclave/ENCLAVE___Aspirant_V1.pdf', '-'],
  { encoding: 'utf8', maxBuffer: 1 << 28 });
const pages = parseBboxPages(xhtml);

const covers = pages.filter(isCoverPage).map((p) => p.page);
console.log('covers:', covers.join(', '));
console.log('expected:', CLASS_NAMES.map((_, i) => classPageNumbers(i).cover).join(', '));
for (const [i, name] of CLASS_NAMES.entries()) {
  const { core } = classPageNumbers(i);
  const found = headerName(pages[core - 1]);
  if (found !== name) console.log(`MISMATCH class ${i}: header "${found}" != "${name}"`);
}
```

Run it. Expected: `covers` is exactly `18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84`, and no MISMATCH lines. **If either differs, stop and report it** — the whole plan's page model rests on this and every later task inherits the error.

- [ ] **Step 6: Commit**

```bash
git add util/aspirant-extract.js util/aspirant-extract.test.js
git commit -m "feat: parse the Aspirant V1 page geometry and find its class blocks"
```

---

### Task 3: Power Rating superscripts — identify and re-thread

`pdftotext` hoists 21 of the book's 622 Power Ratings out of their sentence into their own block or line, dropping them out of reading order and leaving a stray one-character cell that pollutes every x-band cluster downstream. Re-threading them is what makes the marked-up representation possible at all, and it must happen **before** any other segmentation runs.

Measured detail: `docs/superpowers/specs/2026-09-16-aspirant-v1-geometry.md` §7.

**Files:**
- Modify: `util/aspirant-extract.js`
- Modify: `util/aspirant-extract.test.js`

**Interfaces:**
- Consumes: `parseBboxPages` (Task 2) and its `Page`/`Line`/`Word` shapes.
- Produces: `POWER_RATINGS` (the ten strings), `isSuperscript(word, line)`, `rethreadSuperscripts(page) -> Page`, `markPowerRatings(line) -> string`.

**The three facts this task encodes, all measured:**

1. **Identification is a ratio, not a font list.** Never hardcode an absolute font height — the book uses six body sizes. A word is a Power Rating superscript iff its height is **at most 0.75** of its host line's (markedly smaller than body text) **and** `(word.yMax − line.yMin) / lineHeight` is `0.65 ± 0.05` (it hangs from the line top). The top-hang is the precise discriminator; the height is only a bound, because at least one rating in the book sits at ratio 0.525 rather than the usual 0.583 — p21 `Deadlier L–H`, see the geometry document's correction note in §7.
2. **Re-threading is anchored on candidates, then `yMin` proximity, then `xMin` sort.** A detached rating's `yMin` is `host.yMin + 0.70..1.04`, so a ±1.5 `yMin` agreement identifies its host line, and re-sorting the merged word list by `xMin` recovers reading order. The same rule handles the two hard cases (p21 y≈649.3, p63) where pdftotext also splits the *host* line into two fragments around the gap.

   **Grouping must be anchored on detached-rating candidates — a single-word line whose word is in `POWER_RATINGS` — and must additionally require x-adjacency to that candidate (gap ≤ 5pt).** Applying `yMin` proximity page-wide instead merges credits columns and table-of-contents rows that happen to share a baseline: measured, that produces ~1990 false merges book-wide and drops the rating tally to 557. The real inter-word gaps around a detached rating measure 1.3–2.1pt; the gaps to unrelated same-baseline lines are 79pt and up, so the bound separates them with room to spare.
3. **The dash is U+2013.** `L–H`, not `L-H`.

- [ ] **Step 1: Write the failing test**

Append to `util/aspirant-extract.test.js`:

```js
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

  test('re-threading leaves a page with no detached ratings untouched', () => {
    const page = { page: 20, blocks: [{ xMin: 40, yMin: 200, yMax: 211.75, lines: [host] }] };
    expect(rethreadSuperscripts(page)).toEqual(page);
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
bun test util/aspirant-extract.test.js
```
Expected: FAIL — `POWER_RATINGS is not exported` / `isSuperscript is not a function`.

- [ ] **Step 3: Implement**

```js
const EN = '–';
// The complete observed set, whole book: M 221, L 108, H 106, L-H 61, L-M 60,
// M-H 32, H+ 20, M-H+ 7, L-H+ 3, H-H+ 3. No L+, M+ or L-M+ occurs.
const POWER_RATINGS = ['L', 'M', 'H', 'H+',
  `L${EN}M`, `L${EN}H`, `M${EN}H`, `L${EN}H+`, `M${EN}H+`, `H${EN}H+`];

// A rating is printed at 58.3% of body size and hangs from the line top. The
// ratio holds exactly across all six body sizes in the book, so matching on it
// rather than on an absolute height survives the font changing per entry.
const SUPERSCRIPT_RATIO = 0.583;
const TOP_HANG_RATIO = 0.65;
const RATIO_TOLERANCE = 0.05;

// pdftotext drops a rating into the inter-word gap of its host line as a
// separate line or block. Its yMin sits 0.70-1.04 below the host's, so lines
// agreeing this closely are one printed line however they were emitted.
const SAME_LINE_Y = 1.5;
```

`isSuperscript(word, line)` — compute `lineHeight = line.yMax - line.yMin`; return false when it is zero; require both `|(word.yMax - word.yMin) / lineHeight - SUPERSCRIPT_RATIO| <= RATIO_TOLERANCE` and `|(word.yMax - line.yMin) / lineHeight - TOP_HANG_RATIO| <= RATIO_TOLERANCE`.

`rethreadSuperscripts(page)` — collect every line on the page with its owning block, group lines whose `yMin` agrees within `SAME_LINE_Y`, and for each group of more than one, merge all words into the line with the **largest height** (the host; a lone superscript line has no height to speak of), sorted by `xMin`. The merged line keeps the host's `yMin`/`yMax`. Drop emptied lines, and drop blocks left with no lines. Return a new page — do not mutate the input, because Task 8 re-reads the same parsed pages.

`markPowerRatings(line)` — join the line's words with a single space, wrapping any word that both `isSuperscript(word, line)` and appears in `POWER_RATINGS` in `<sup>…</sup>`. A small word that is not a known rating stays plain: the markup is a claim about a Power Rating, not about font size.

- [ ] **Step 4: Run the tests**

```bash
bun test util/aspirant-extract.test.js
```
Expected: PASS.

- [ ] **Step 5: Prove the counts against the real book**

In the scratchpad, parse the PDF, re-thread every page, and count. Expected, and all four are measured facts:
- 622 rating occurrences in total across the book, 621 of which are in `POWER_RATINGS`
- exactly **21** lines were merged by re-threading
- the per-string tally is `M` 221, `L` 108, `H` 106, `L–H` 61, `L–M` 60, `M–H` 32, `H+` 20, `M–H+` 7, `L–H+` 3, `H–H+` 3
- no rating contains U+002D or U+2014

**If the merge count is not 21, stop and report it.** A higher count means the grouping is swallowing real adjacent lines and later tasks will silently lose text.

- [ ] **Step 6: Commit**

```bash
git add util/aspirant-extract.js util/aspirant-extract.test.js
git commit -m "feat: re-thread detached Power Ratings and mark them up as superscripts"
```

---

### Task 4: Glyphless note trees

The book has no bullet glyphs — they are vector art. `buildNoteTree` in `util/prerelease-extract.js:57` keys entirely on `❖`/`➢` and has nothing to match here. Depth comes from x-indent; the note **boundary** comes from y-leading, because a wrapped continuation line shares its parent's `xMin` exactly.

Measured detail: `docs/superpowers/specs/2026-09-16-aspirant-v1-geometry.md` §6.

**Files:**
- Modify: `util/aspirant-extract.js`
- Modify: `util/aspirant-extract.test.js`

**Interfaces:**
- Produces: `noteTree(lines, { step, threshold })`, `TIPS_NOTE_STEP` (18.72), `TIPS_NOTE_THRESHOLD` (16.00), `BODY_NOTE_STEP` (19.20).
- Output shape is the existing note tree the contract already uses: `[{ text, children: [] }]`, so `buildNoteTree`'s consumers, `util/class-gear.js#normalizeNote` and the new `util/class-expanded-tips.js`, serve it unchanged.

**The two step sizes are different and this is the spec's second error.** Expanded Tips indent at **18.72** per level; signature and ability notes at **19.20**. Do not unify them.

**Threshold.** Expanded Tips uses the fixed **16.00** — measured wrapped leading 12.00, new-note leading 20.39, with 8.1pt of clear air and zero overlap across 871 lines. Signature and ability notes vary their font per entry, so a fixed number is fragile there; pass `threshold: null` and let `noteTree` derive `min(observed leading) + 2.0`. Measured: wrapped leading is exactly `0.766 × lineHeight` and a new note adds ~4.30, so the derived threshold has ~2.3pt of margin on both sides at every observed font size.

**Only two depth levels occur anywhere in the book.** Implement `round((xMin - baseX) / step)` generally rather than special-casing two, but a depth of 3 from real pages means the geometry is being misread — Step 5 asserts it never happens.

- [ ] **Step 1: Write the failing test**

Append to `util/aspirant-extract.test.js`:

```js
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

  // The detectable orphan is a note deeper than anything before it. A lone line
  // at a deep xMin is NOT detectable: baseX is the minimum over note-start
  // lines, so a solitary note is always its own baseline and computes depth 0.
  test('a note deeper than anything before it is refused rather than silently promoted', () => {
    expect(() => noteTree([
      ln(109.44, 100, 'orphan'),
      ln(90.72, 120.39, 'parent')
    ], { step: TIPS_NOTE_STEP, threshold: TIPS_NOTE_THRESHOLD })).toThrow('orphan');
  });

  test('a single top-level note on its own parses and does not throw', () => {
    expect(noteTree([ln(72.0, 100, 'only')],
      { step: TIPS_NOTE_STEP, threshold: TIPS_NOTE_THRESHOLD }))
      .toEqual([{ text: 'only', children: [] }]);
  });

  test('no lines is no notes', () => {
    expect(noteTree([], { step: TIPS_NOTE_STEP, threshold: TIPS_NOTE_THRESHOLD })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
bun test util/aspirant-extract.test.js
```
Expected: FAIL — `noteTree is not a function`.

- [ ] **Step 3: Implement**

```js
// Expanded Tips indent 18.72 per level; signature and ability notes 19.20.
// Measured separately and deliberately not unified.
const TIPS_NOTE_STEP = 18.72;
const BODY_NOTE_STEP = 19.2;

// Wrapped leading 12.00 against a new note's 20.39, with 8.1pt of clear air.
const TIPS_NOTE_THRESHOLD = 16.0;

// Signature and ability entries change font size per entry, so their boundary
// is a ratio of each line's own height rather than a figure derived from the
// run: measured over 944 pairs, a wrapped continuation leads at 0.766 x
// lineHeight and a new note at 1.098-1.132, with no overlap.
const NOTE_LEADING_RATIO = 0.93;
```

`noteTree(lines, { step, threshold })`:
- Return `[]` for no lines.
- Sort by `yMin`.
- When `threshold` is `null`, a line starts a new note when its leading exceeds `NOTE_LEADING_RATIO × lineHeight`. **Do not derive a threshold from the run's minimum leading**: 11 of the 70 ability entries that carry notes print no wrapped line at all, so the minimum gap is already a new-note gap and the whole run collapses into a single note (p22 `Stick 'Em Up`: four notes become one).
- Walk the lines. The first line starts a note; thereafter a line starts a new note when `yMin - previous.yMin > threshold`, and otherwise appends its text to the current note separated by a single space.
- A note's depth is `Math.round((xMin - baseX) / step)` where `baseX` is the smallest `xMin` among note-**start** lines only. Wrapped lines never contribute to depth.
- Depth 0 pushes to the root; depth *n* pushes to the last note at depth *n−1*. **Throw naming the note's text** when there is no such parent — a silently promoted orphan is a note that changes meaning, and this book's structure never produces one. Do **not** additionally refuse a batch for being short: a single top-level note is valid content (a class with one Conduit tip), and a line-count guard would reject it at extraction time.
- Use `markPowerRatings(line)` (Task 3) rather than a plain word join, so a rating inside a note survives as markup.

- [ ] **Step 4: Run the tests**

```bash
bun test util/aspirant-extract.test.js
```
Expected: PASS.

- [ ] **Step 5: Prove it against the real Expanded Tips pages**

In the scratchpad, run `noteTree` over the note lines of all twelve `+5` pages (PDF 23, 29, 35, 41, 47, 53, 59, 65, 71, 77, 83, 89) and assert:
- every page yields a non-empty `player` and `conduit` list
- **no note anywhere has depth > 1** (only two levels occur in the whole book)
- no note text is empty or starts/ends with a space
- the two known p83 outliers (wrapped leadings of 11.73 and 12.27) still resolve as wrapped, not as new notes. **Check this per column.** Merging Player and Conduit into one y-sorted list first finds neither outlier, because a gap measured across two side-by-side columns is not a leading.

**If any page produces a depth-2 note, stop and report it.**

- [ ] **Step 6: Commit**

```bash
git add util/aspirant-extract.js util/aspirant-extract.test.js
git commit -m "feat: build note trees from indent and leading, without bullet glyphs"
```

---

### Task 5: Signature pages — two columns, six entries, `column` and `position`

The hardest page in the book. Two independent columns that do not share baselines, an item name distinguished only by font size, a signature name that shares its baseline with the description beside it, and dedications that land mid-paragraph.

Measured detail: `docs/superpowers/specs/2026-09-16-aspirant-v1-geometry.md` §4, §5.

**Files:**
- Modify: `util/aspirant-extract.js`
- Modify: `util/aspirant-extract.test.js`

**Interfaces:**
- Consumes: `rethreadSuperscripts`, `markPowerRatings` (Task 3); `noteTree`, `BODY_NOTE_STEP` (Task 4); `shiftFor` (Task 2); `pairMeters` imported from `util/prerelease-extract.js`.
- Produces: `COLUMN_SPLIT_X` (306), `signatureEntries(page) -> [Entry]` returning six entries in reading order (left column top-to-bottom, then right), each:
  ```js
  { name, description, meters: [{label, value}], notes: [note],
    default_enchantment: { name, description, dedication }, column, position }
  ```
  `column` and `position` are **not** assigned here — `signatureEntries` returns six entries per page and Task 8 assigns `column`/`position` when it joins the two pages, because the left page is columns 1–2 and the right page is columns 3–4.

**The measured constants:**

```js
// No line crosses x=306 on any of the 24 signature pages. Column pitch 276.48.
const COLUMN_SPLIT_X = 306;

// An item name is the tallest line in its entry. Never hardcode 20.88: the
// book auto-fits long names down to 19.57. No body line anywhere exceeds 14.36.
const NAME_MIN_HEIGHT = 18.0;

// "In Honor of" is printed smaller than every body font, and lands inside the
// description's y-range -- on p50 literally between two wrapped lines. Lift it
// out by height before reflowing or it is spliced into the sentence.
const DEDICATION_HEIGHT = 7.83;

// Entries start as high as yMin 40.77 (Samaritan p75) -- above the header band
// -- and run to 742.66. A yMin > 60 filter silently loses eight entries.
const CONTENT_MIN_Y = 39;

// The folio sits at yMin 764.84, below all entry content. Without this bound it
// is swept into the last entry and appended to its signature description --
// "...onlookers (Mid Cooldown). 15". It does NOT read as an item name: name
// blocks are matched on x against colLeft, and the folio is centred.
const CONTENT_MAX_Y = 750;
```

- [ ] **Step 1: Write the failing test**

Cover these cases in `util/aspirant-extract.test.js`, building fixtures from the real bboxes quoted in §5 of the geometry document:

1. **Column partition.** Six entries come back; the first three have every word at `xMin < 306` and the last three at `xMin > 306`.
2. **Columns are partitioned by x, never paired by y.** Give the left and right columns deliberately interleaved `yMin` values (measured: only 3 of 32 lines coincide on p20) and assert entries do not cross.
3. **`Default Enchantment` is one per entry.** A column containing three of the centred dividers yields exactly three entries.
4. **The item name is the tallest line, at 19.57 as well as 20.88.** Two fixtures, one at each measured height, both resolve as the name.
5. **An entry with no description, no meters and no notes still parses** — Cowboy Hat, Bandolier and Bowie Knife each have no description; Cowboy Hat, Bandolier, Wild Rag and Duster have no meters. Assert `description` is `''` and `meters`/`notes` are `[]` rather than the entry being dropped.
6. **The signature name is not spliced into its description.** Use the real p20 Cowboy Hat fixture: name `Hats Off to You` at `43.20–102.56, y 217.11`, description first line at `136.80, y 217.11` (same `yMin`). Assert `default_enchantment.name` is `'Hats Off to You'` and the description begins `'Portray a Turning Point'` — not `'Hats Off to You Portray …'`.
7. **A two-line signature name stays one name.** p74 `Doctor Without / Borders` is two `<line>`s in one `<block>` — assert `'Doctor Without Borders'`, not two entries.
8. **`In Honor of` is lifted out of the paragraph.** Use the real p50 case: a 7.83-height line at `y 372.85` between description lines at `371.83` and `380.83`. Assert `dedication` is `'In Honor of Xela'` and the description reads continuously across it.
9. **Meters pair label to value on a shared baseline** and come back `[{ label: 'Ammunition', value: 'Mid' }]` for the p20 fixture (label `170.66–223.20`, value `246.65–264.55`, both `yMin 468.47`).
10. **An entry starting above the header band is not dropped** — a fixture at `yMin 40.77` still parses.

- [ ] **Step 2: Run it and watch it fail**

```bash
bun test util/aspirant-extract.test.js
```
Expected: FAIL — `signatureEntries is not a function`.

- [ ] **Step 3: Implement**

`signatureEntries(page)`, in this order:

1. `rethreadSuperscripts(page)` first — before any clustering, because a stray one-character cell pollutes every x-band.
2. Partition every line with `yMin > CONTENT_MIN_Y` on `COLUMN_SPLIT_X`. Process each side independently; **never pair by `yMin` across the split.**
3. Within a side, find the three `Default Enchantment` divider lines and sort by `yMin`. Entry *n* runs from the previous entry's end to divider *n*'s own entry end — that is, each entry spans from its item name down to the line above the next entry's item name, with the divider inside it. Derive `colLeft` as the minimum `xMin` of the side's lines.
4. Lift out every line whose height is within `0.5` of `DEDICATION_HEIGHT` — that is the `In Honor of` dedication, and it must be removed before any paragraph reflow.
5. Item name: the tallest line above the divider with height `>= NAME_MIN_HEIGHT`. Item description: the **block at `colLeft`** — **not** a height band. Measured counterexamples: p80R `Eerie mask, meant for the dead.` is height 13.05, outside any 14.0–14.5 window; and p57R `Chainblade`'s description is indented around its own item name, starting at x 444.00.
6. Meters: selected **by x only**, never by a y-band around the item name. `Barded Destrier` (p38R) has a third meter row at `name.yMin + 24.29` while that entry's item description sits 1.26pt below it at +25.55, so any y-band wide enough for the meter swallows the description. Note also that `colLeft + 120` is too far right — p27R's label `Thrown Accuracy Boost` starts at `colLeft + 112.56` and would be truncated.
7. Item notes: the depth-1 indent is `colLeft - shiftFor(page.page, 'body') + BODY_NOTE_STEP + shiftFor(page.page, 'signature-note')`. **`colLeft` already absorbs the 11.52 body shift**, so adding the note shift to it directly double-counts: that gives 60.00 verso / 87.84 recto against the measured 64.80 / 81.12. Feed the result to `noteTree(lines, { step: BODY_NOTE_STEP, threshold: null })`.
8. Signature name: **the block at `colLeft - 2.40`** — not the tallest line. Height carries no signal here: p20's `Hats Off to You` is 11.745, identical to the divider and to every description line beside it. The x position is unique across all 144 entries (no other below-divider block lies within 4pt to the left of `colLeft`). A two-line name is two lines of that one block, so joining them falls out for free.
9. Signature description: every remaining block below the divider, sorted by `(yMin, xMin)`, joined with `markPowerRatings`. **Do not drop lines whose `xMin` falls inside the signature name's x-range** — identifying the name by its own block (step 8) already keeps it out of the sentence, and an x-range drop destroys real content: measured, it deletes 30 description lines across 21 of the 144 entries. On p21 the name `Smokey Bandit` spans 331.20–387.92 and its own description's last line begins at 376.80, inside that range; the same rule also swallows the following entry's name and body.

Every text value is produced through `markPowerRatings`, never a plain word join.

- [ ] **Step 4: Run the tests**

```bash
bun test util/aspirant-extract.test.js
```
Expected: PASS.

- [ ] **Step 5: Prove it against all 24 signature pages**

In the scratchpad, run `signatureEntries` over PDF pages 20, 21, 26, 27, … 86, 87 and assert:
- exactly **6** entries per page, **144** in total
- every entry has a non-empty item name and a non-empty `default_enchantment.name`
- exactly **15** dedications across the 24 pages (the other 38 are on ability pages)
- no item name or signature name contains the substring `In Honor of`
- no signature description begins with its own signature name

**If any page yields other than 6, stop and report which.**

- [ ] **Step 6: Commit**

```bash
git add util/aspirant-extract.js util/aspirant-extract.test.js
git commit -m "feat: extract the four-column Signature spread"
```

---

### Task 6: Ability pages — core, advanced, paired actions and sample perks

Offsets +1 and +4 are structurally identical; only their position in the class block says which is core and which advanced. Nothing on either page says so.

Measured detail: `docs/superpowers/specs/2026-09-16-aspirant-v1-geometry.md` §8.

**Files:**
- Modify: `util/aspirant-extract.js`
- Modify: `util/aspirant-extract.test.js`

**Interfaces:**
- Produces: `abilityEntries(page) -> [Ability]`, three per page, each:
  ```js
  { name, pronunciation, dedication, description, paired_action, meters: [{label, value}],
    notes: [note], sample_perks: [{ name, dedication, text, compound_text }] }
  ```
  `sample_perks` always has length 2. The second perk carries `compound_text`; the first carries `null`.

**Two traps this task must encode:**

- **Anchor on `Paired Action:`, never on `Essence Cost`.** `Paired Action:`, `Sample Perks` and `(Compounded)` each occur exactly 3 times on every one of the 24 ability pages, verified with zero exceptions. `Essence Cost` line counts are **4** on p22/p28/p46/p55 and **2** on p82.
- **pdftotext's `<block>` grouping is untrustworthy here.** On p37 it merges the meter table, `Paired Action:`, the notes and the body into a single block spanning `x 72.30–511.20`. Re-derive structure from `(yMin, xMin)`; do not trust block boundaries on ability pages.
- **`(Compounded)` is a restatement of the *second* sample perk, not a third perk.** Verified on p19, p22, p40, p67.

- [ ] **Step 1: Write the failing test**

Cover, with fixtures built from the p19 (recto) and p22 (verso) bboxes in §8:

1. Three entries per page, anchored on the three `Paired Action:` lines.
2. The ability name is the tallest line in the 70pt above its `Paired Action:` line — assert it resolves at height 20.88 **and** at the auto-fitted sizes: `Identity Theft` is 19.57 and `Rally Point` is 19.58.
3. A two-line ability name joins into one string (**16** of the 72 ability names are two lines).
4. `paired_action` text is captured even though it begins slightly *above* its label's `yMin` (p19: text band `142.92`, label `147.41`).
5. `sample_perks` has exactly two entries, and the second's `compound_text` is the `(Compounded)` body while the first's is `null`.
6. A perk name and its body share a baseline and are not concatenated.
7. A page whose blocks are merged — the p37 shape, one block spanning `72.30–511.20` containing meters, label, notes and body — still yields three entries with correct parts. **This is the regression test for trusting block boundaries.**
8. Notes resolve through `noteTree` at both measured body sizes (h 13.05 on p19, h 11.75 on p40) using the derived threshold.
9. `In Honor of` on an ability page becomes the perk's `dedication`, not part of any text.
10. A Power Rating inside a description, a note, a perk body and a compounded body all come back as `<sup>…</sup>`.

- [ ] **Step 2: Run it and watch it fail**

```bash
bun test util/aspirant-extract.test.js
```
Expected: FAIL — `abilityEntries is not a function`.

- [ ] **Step 3: Implement**

Follow the same shape as Task 5: re-thread superscripts, then segment on the three `Paired Action:` anchors, then read each entry's parts by `(yMin, xMin)` bands derived per entry — **never per book**, because notes are h 13.05 on p19 but h 11.75 on p40 and p31, and perks are h 11.75 on p19 but 10.44 on p31/p40.

`pronunciation` is **not** a trailing run on the name line. It is its own line at height **7.83** — the same height as an `In Honor of` dedication — hanging 18.07 below the name. Exactly one occurs in the whole book (p61 `Dérive`). Any height rule that lifts out dedications must also account for it, or it is read as a third perk name. Where absent it is `null`.

**Indents are measured from the entry's own `Paired Action:` label, never from an absolute page frame.** The geometry document's §3b recto/verso table is not exact on these pages: p37's first entry prints every structural x 10.56pt right of the tabulated frame (label at 82.86 rather than 72.30, notes at 106.08, perk body at 183.36), and two further frame offsets occur elsewhere. Classifying by absolute x mis-files 15 of the 72 entries. `shiftFor` is therefore not used on ability pages.

§8's `xMax < 210` bound on the name lookup is **inert** — mutating it to 1e9 leaves all 24 pages byte-identical — so it is not carried. Tightening it to 150 destroys 15 pages.

- [ ] **Step 4: Run the tests**

```bash
bun test util/aspirant-extract.test.js
```
Expected: PASS.

- [ ] **Step 5: Prove it against all 24 ability pages**

Run over PDF pages 19, 22, 25, 28, … 85, 88 and assert:
- exactly **3** entries per page, **72** in total
- every entry has a non-empty name, a non-empty `paired_action`, and exactly **2** sample perks
- exactly **72** non-null `compound_text` values (one per entry)
- exactly **38** dedications across the 24 pages
- no ability name contains `Paired Action` or `Sample Perks`

**If the compounded count is not 72, stop and report it** — it means `(Compounded)` is being read as a third perk somewhere.

- [ ] **Step 6: Commit**

```bash
git add util/aspirant-extract.js util/aspirant-extract.test.js
git commit -m "feat: extract Core and Advanced Ability pages with their sample perks"
```

---

### Task 7: Cover pages and Expanded Tips

The two remaining page kinds. The cover is rigidly consistent; the Tips page is byte-identical across all twelve classes.

Measured detail: `docs/superpowers/specs/2026-09-16-aspirant-v1-geometry.md` §9, §10.

**Files:**
- Modify: `util/aspirant-extract.js`
- Modify: `util/aspirant-extract.test.js`

**Interfaces:**
- Consumes: `parseStatLine` imported from `util/prerelease-extract.js` — **unchanged**. The book prints `++Skill, +Sensory` and the existing splitter already accepts `,` as well as `/`.
- Produces:
  ```js
  coverFields(page) -> { stat_line, stat_note, stat_spread, quote, quote_source,
                         overview, conduit_notes, grounding,
                         examples_heading, examples, tips_heading, tips,
                         challenge_level }
  expandedTips(page) -> { player: [note], conduit: [note] }
  ```

**How the three prose paragraphs are told apart — all three rules verified on all twelve covers:**

1. ~~They are the only three blocks whose box is exactly `336.00 – 565.20` at line height 13.05, and they are contiguous.~~ **This rule is false in both directions and must not be used.** On p60 (Freerunner) the Examples heading has that exact box and is the contiguous next block, so the rule selects four; on p42 paragraph 3 and p54 paragraphs 1–2 the right edge is **565.21**, so an exact match drops real paragraphs. Close the band on the quote attribution above and the pattern-matched Examples heading below instead.
2. **Paragraph 1 has no first-line indent (`336.00`); paragraphs 2 and 3 indent 3.84 (`339.84`).**
3. Paragraph 1 opens `You are a` / `You are an`; paragraph 2 opens `Conduits designing a mission for you`; paragraph 3 opens `Grounded in`.

Implement rule 2 as the discriminator and **assert rule 3** — if an opening does not match, throw naming the class, because a silently mis-assigned paragraph puts the Conduit's guidance in the player-facing overview.

**The Examples heading is six different strings.** Do not match it literally. Match `/^Examples from .+ include:$/` at `xMin == 336.00`, and store the heading as printed in `examples_heading`, the way the other book's artifact already does.

**Other measured facts to encode:**

```js
// Quick Tips: exactly 3 on all twelve covers, xMin 60.48.
// Examples: 5 or 6 items, every item xMin 355.68, one <block> each, no glyphs.
// Quote attribution: always its own block, always begins "— " (U+2014).
// Verse lines inside a quote are joined by a literal "|" (Illusionist, Berserker).
// There is deliberately no right-edge constant: the prose right edge is 565.20
// on most covers but 565.21 on p42 and p54, and matching it exactly drops real
// paragraphs while admitting p60's Examples heading.
const PROSE_LEFT_X = 336.0;
const PROSE_INDENT_X = 339.84;
const EXAMPLES_ITEM_X = 355.68;
const QUICK_TIPS_ITEM_X = 60.48;
const ATTRIBUTION_DASH = '—';

// Byte-identical on all twelve +5 pages, to the hundredth of a point.
const TIPS_PLAYER_X = 134.45;
const TIPS_CONDUIT_X = 397.94;
const TIPS_HEADING_Y = 98.29;
const TIPS_PLAYER_LIST_X = 72.0;
const TIPS_CONDUIT_LIST_X = 348.48;
```

- [ ] **Step 1: Write the failing test**

Cover:

1. `parseStatLine('++Skill, +Sensory')` returns `{ skill: 2, sensory: 1 }` — **an assertion that the imported function needs no change**, so a later edit to it shows up here.
2. Paragraph 1 is distinguished from paragraphs 2 and 3 by the 3.84 first-line indent.
3. A cover whose second paragraph does not open `Conduits designing a mission for you` throws, naming the class.
4. The quote attribution is split on its own block into `quote_source`, and the em dash is stripped from the value.
5. A multi-line verse quote keeps its literal `|` separator.
6. `examples_heading` stores the printed string, and all six observed variants match the pattern.
7. `challenge_level` parses to `'Low'`, `'Mid'` or `'High'` — the three values `util/class-fields.js`'s `CONSTRAINED_SELECTS.challenge_level` accepts.
8. `tips` is the three Quick Tips as a list.
9. `expandedTips` partitions on `COLUMN_SPLIT_X` (306), **not** on the headings' `xMin`. The headings are centred over their columns — `Player` at 134.45 above a list at 72.00, `Conduit` at 397.94 above one at 348.48 — so splitting on their own x puts every Player line in neither column. The headings mark each column's top edge; the split is the same 306 the signature pages use (Player's widest line ends 294.97, Conduit begins 348.48, on all twelve). Each list then goes through `noteTree` at `TIPS_NOTE_STEP` / `TIPS_NOTE_THRESHOLD`.
10. A tip that is an attributed quote (`"…" — Tim M.`) stays one note — there is no marker separating editorial tips from quotes, and the em dash is inside the same block.

- [ ] **Step 2–4: red, implement, green**

```bash
bun test util/aspirant-extract.test.js
```

- [ ] **Step 5: Prove it against all twelve covers and Tips pages**

Assert:
- all twelve covers yield a non-empty `stat_line`, `quote`, three prose paragraphs, an `examples_heading` matching the pattern, **exactly 3** `tips`, and a `challenge_level` in `['Low','Mid','High']`
- the challenge levels are exactly: Low for Gunslinger, Illusionist, Thane, Thunderbird, Freerunner; Mid for Librarian, Wanderer, Berserker, Infiltrator, Witchfinder; High for Samaritan, Vessel
- examples counts are 6 for Gunslinger, Wanderer, Berserker, Infiltrator, Samaritan, Vessel, Witchfinder and 5 for Illusionist, Librarian, Thane, Thunderbird, Freerunner
- all twelve Tips pages yield non-empty `player` and `conduit`

- [ ] **Step 6: Commit**

```bash
git add util/aspirant-extract.js util/aspirant-extract.test.js
git commit -m "feat: extract cover pages and the Expanded Tips spread"
```

---

### Task 8: Assemble the book and produce the artifact

Join the six pages of each class into one record, assign the four-column `column`/`position` contract, and reduce the script to a CLI wrapper.

**Files:**
- Modify: `util/aspirant-extract.js`
- Modify: `util/aspirant-extract.test.js`
- Create: `scripts/extract-aspirant-v1-classes.mjs`
- Create: `docs/data/aspirant-v1-classes-2026-09.json` (generated)

**Interfaces:**
- Produces: `extractClass(pages, index) -> Record`, `extractBook(pages) -> [Record]`. Record keys and order are as declared under "Shared interfaces".

**The column contract.** The left page (offset +2) carries columns **1 and 2**; the right page (offset +3) carries columns **3 and 4**. Within a page, the entries left of `COLUMN_SPLIT_X` are the lower-numbered column. `position` is 1–3 down each column. `category` is derived from the column and nothing else: **column 1 is `default`, columns 2–4 are `elective`** — the book's own backwards-compatibility rule, stated normatively on printed p. 2:

> Treat the first column on the first page of Signatures as the Class's Default Roster. Treat the second column on the first page of Signatures as the Class's Elective Roster.

This is arithmetically identical to `util/class-gear.js#gearCategory`'s existing `index < 3` test for a six-item class, so every one of the fifty live classes keeps the category it has today.

`page_range` is `[cover, tips]` in **printed** page numbers, matching the other artifact's convention (`printedPage(18)` = 13, so Gunslinger is `[13, 18]`).

- [ ] **Step 1: Write the failing test**

```js
describe('assembling a class record', () => {
  test('column and position span the four columns across the two pages', () => {
    // 12 entries: left page columns 1,2 then right page columns 3,4.
    const gear = extractClass(fixturePages, 0).gear;
    expect(gear).toHaveLength(12);
    expect(gear.map((g) => g.column)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
    expect(gear.map((g) => g.position)).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]);
  });

  test('category is derived from the column: 1 is default, 2 to 4 elective', () => {
    const gear = extractClass(fixturePages, 0).gear;
    expect(gear.slice(0, 3).map((g) => g.category)).toEqual(['default', 'default', 'default']);
    expect(gear.slice(3).every((g) => g.category === 'elective')).toBe(true);
  });

  test('core abilities come from offset +1 and advanced from offset +4', () => {
    const record = extractClass(fixturePages, 0);
    expect(record.abilities).toHaveLength(3);
    expect(record.advanced_abilities).toHaveLength(3);
    expect(record.abilities[0].name).not.toBe(record.advanced_abilities[0].name);
  });

  test('the class name comes from the running header, not the cover', () => {
    expect(extractClass(fixturePages, 0).name).toBe('Gunslinger');
  });

  test('page_range is printed pages, not PDF pages', () => {
    expect(extractClass(fixturePages, 0).page_range).toEqual([13, 18]);
  });

  test('a header that disagrees with the expected roster name is refused', () => {
    expect(() => extractClass(wrongHeaderPages, 0)).toThrow('Gunslinger');
  });

  test('every record carries the full key set in a stable order', () => {
    expect(Object.keys(extractClass(fixturePages, 0))).toEqual([
      'name', 'designer', 'stat_line', 'stat_note', 'stat_spread', 'quote', 'quote_source',
      'overview', 'conduit_notes', 'grounding', 'examples_heading', 'examples',
      'tips_heading', 'tips', 'challenge_level', 'abilities', 'advanced_abilities',
      'gear', 'expanded_tips', 'page_range'
    ]);
  });
});
```

- [ ] **Step 2–4: red, implement, green**

`extractClass` asserts the running header of offset +1 equals `CLASS_NAMES[index]` and throws naming both when it does not — the cadence is the only thing locating a class, so a drift must be loud rather than producing a well-formed record for the wrong class.

- [ ] **Step 5: Write the CLI wrapper**

`scripts/extract-aspirant-v1-classes.mjs` does four things and nothing else: read the PDF path from `process.argv[2]`, shell out to `pdftotext -bbox-layout`, call `extractBook`, and write JSON to `process.argv[3] || bookFor('aspirant-v1').artifact`. All logic stays in `util/aspirant-extract.js`, because `scripts/run-tests.mjs:54` scans only `models, routes, services, test, util, views` and a test under `scripts/` would silently never run.

- [ ] **Step 6: Generate the artifact**

```bash
bun scripts/extract-aspirant-v1-classes.mjs "/home/dave/Documents/Enclave/ENCLAVE___Aspirant_V1.pdf"
```

Then assert the shape of what came out:
- 12 records, names exactly `CLASS_NAMES`
- every record: 12 gear, 3 abilities, 3 advanced_abilities, 3 tips, non-empty `expanded_tips.player` and `.conduit`
- 144 `default_enchantment` objects, none null
- 144 sample perks across the two ability lists per class (12 × 6 abilities × 2), of which 72 carry `compound_text`
- no value anywhere has leading or trailing whitespace (`util/whitespace-integrity.integration.test.js` fails the build on one)
- no value contains `<sup` outside a matched `<sup>…</sup>` pair

- [ ] **Step 7: Commit**

```bash
git add util/aspirant-extract.js util/aspirant-extract.test.js test/books.test.js \
        scripts/extract-aspirant-v1-classes.mjs docs/data/aspirant-v1-classes-2026-09.json
git commit -m "feat: extract ENCLAVE: Aspirant V1 into a reviewable artifact"
```

Now widen Task 1's scoped assertion in `test/books.test.js` to cover every book, since the second artifact exists from this commit on:

```js
test('every descriptor names an artifact that exists on disk', () => {
  for (const book of Object.values(BOOKS)) {
    expect(existsSync(book.artifact)).toBe(true);
  }
});
```

Delete the narrower `the pre-release descriptor names an artifact...` test it replaces. Re-run `bun test test/books.test.js` and confirm it passes.

---

### Task 9: The verifier

Nothing may be written to a database until this reports clean. It re-reads the PDF in a **different `pdftotext` mode** from the extractor (`-layout`, not `-bbox-layout`) so the two cannot share a segmentation bug, and compares bidirectional token multisets against an exact declared allowance list — an allowance that is declared but never observed fails as loudly as an unexpected token.

**Files:**
- Create: `scripts/verify-aspirant-v1-extract.mjs`
- Modify: `docs/data/aspirant-v1-classes-2026-09.json` (only if verification finds real extraction defects)

**Model it on `scripts/verify-prerelease-extract.mjs`**, which is the design worth keeping — read it first. Reuse its `tokensExcept`, `tally`, `surplus`, `flattenNotes`, `allow` and reporting shape. Do **not** reuse its segmentation: that script keys on bullet glyphs (`❖➢`), `Default`/`Elective` dividers and a `^(\S+) (Abilities|Signatures)$` running title, none of which exist in this book.

**Comparison is per entry, per paragraph and per note — never per class.** A class-wide token multiset cannot see a note that drifted onto a neighbouring entry, because the tokens never leave the class, and that is the one defect this kind of extraction has actually shipped.

**Fields excluded from token comparison, with the reason each is excluded:**

| field | why |
| --- | --- |
| `stat_spread` | numeric, derived from `stat_line` |
| `page_range` | numeric, derived from the cadence |
| `column`, `position` | derived from geometry; the book prints no column index |
| `category` | derived from `column` by the book's printed rule, which is on p. 2 and not on the Signature page |
| `name` (class) | comes from the running header, which is compared separately |

**Allowances this book needs** — each built from what the PDF prints or from a constant, never from the record value it covers, or it would cancel that value out of the comparison:

- the running header on offsets +1, +2, +4, +5 (the class name, four times per class)
- the printed page number in the footer on every page
- the `<sup>` and `</sup>` markup the record adds and the page does not print
- the literal `Player` and `Conduit` headings, which become object keys rather than values
- the `Default Enchantment` divider, which becomes structure rather than text

- [ ] **Step 1: Fix the shape of the record-side token walk**

`tokensExcept` (`scripts/verify-prerelease-extract.mjs:125-128`) filters by *type*, so numeric derived fields drop out on their own — but `category` is a **string** and would contribute the tokens `default`/`elective`, which appear nowhere on the page. Exclude it by name.

- [ ] **Step 2: Run the verifier and drive it to zero**

```bash
bun scripts/verify-aspirant-v1-extract.mjs \
    "/home/dave/Documents/Enclave/ENCLAVE___Aspirant_V1.pdf" \
    docs/data/aspirant-v1-classes-2026-09.json
```

Iterate until it reports **0 differences across all twelve classes**. Every difference is one of three things, and each has a different fix:
1. **An extraction defect** — fix `util/aspirant-extract.js` and regenerate the artifact. Add a unit test for the case first.
2. **A legitimate difference between page and record** — add a named allowance, enumerated, and say why.
3. **A verifier segmentation bug** — fix the verifier.

**Never** fix a difference by editing the artifact by hand. `CHARLATAN` was hand-added to the other book's artifact in `e55f998` with no `page_range`, which crashed that verifier and left it dead for weeks.

- [ ] **Step 3: Confirm the other book's verifier still passes**

Plan 1 repaired `scripts/verify-prerelease-extract.mjs`. Confirm the repair holds and that Task 1's descriptor change did not disturb it:

```bash
bun scripts/verify-prerelease-extract.mjs \
    "/home/dave/Downloads/Current_Pre-Release_Classes__Aug__2026_.pdf"
```
Expected: **19/20 classes, 180 entries, 0 token differences.** The twentieth is `CHARLATAN`, which was hand-appended to that artifact with no `page_range` and so cannot be located in the PDF; the repaired helper skips it rather than crashing. That is the defect plan 1 fixed.

**The pre-release book is `~/Downloads/Current_Pre-Release_Classes__Aug__2026_.pdf`.** It is *not* `~/Documents/Enclave/_Beta_Release__ENCLAVE___Aspirant.pdf`, which is a different 172-page document containing none of those nineteen classes — running the verifier against it fails with `found 0 section-intro pages, expected 3`.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-aspirant-v1-extract.mjs docs/data/aspirant-v1-classes-2026-09.json
git commit -m "feat: gate the Aspirant V1 artifact token-for-token against the PDF"
```

---

### Task 10: The loader learns to fork

`planLoad` collapses a match to a single `row` and everything downstream branches on its truthiness (`:264-265, :275, :353, :387`). A plan gains an explicit **disposition** instead. Running the loader as it stands would destroy content: its `abilities` and `gear` payloads are whole-column replacements applied with a plain `.update()` (`:354-355`), so pointing it at a class carrying sample perks or enchantments strips them.

**Files:**
- Modify: `scripts/load-prerelease-classes.mjs` (`FIELDS`, `DERIVED`, `resolveTarget`, `planLoad`, `reportPlan`, the create/update split, `rowByName`)
- Modify: `scripts/lib/character-impact.mjs` (`projectImport`)
- Modify: `util/starter-content.js` (add `ASPIRANT_V1_CLASS_IDS`; the roster itself is Task 11)
- Modify: `test/load-prerelease-classes.test.js`

**Interfaces:**
- Consumes: `bookFor`, and each descriptor's `forks`, `contentFormat`, `rulesEdition` (Task 1).
- Produces: `planLoad(records, rows, book)` where each plan is `{ payload, matches, row, parent, disposition }` and `disposition` is one of `'create' | 'update' | 'fork'`; `fieldsFor(book)`; `buildPayload(record, book)` and `resolveTarget(payload, rows, book)`, both of which gain the book as a trailing parameter; and `ASPIRANT_V1_CLASS_IDS` in `util/starter-content.js` — the twelve minted uuids, which Task 11 then wires into the roster.

**How a fork resolves, and why each clause is there:**

```
existing fork := name match AND content_format = book.contentFormat
                            AND rules_edition  = book.rulesEdition
parent        := name match AND content_format = 'advent'
                            AND rules_version  = 'v1'
                            AND is_player_created = false
```

- An **existing fork** means the load already ran: disposition `update`, `row` is the fork. This is what makes a second `--apply` a no-op.
- Otherwise a **parent** means disposition `fork`: `row` is null, `parent` is the row to descend from.
- `rules_version = 'v1'` is what disambiguates Gunslinger, which has both a v1 and a v2 row. Forking v1 rather than v2 is deliberate: v2 is itself a fork of v1, and the V1 Aspirant class is a sibling of both rather than a descendant of either. Its family is new regardless, so the parent pointer records provenance rather than membership.
- `is_player_created = false` keeps a player's own class named `Gunslinger` from being mistaken for the parent.
- More than one candidate on either side is **ambiguous** and aborts the whole run, as today.

**Verified against the live local catalogue (50 rows):** all twelve names resolve to exactly one parent under this rule. The six Advent base classes each have a v1 and a v2 row and the clause picks v1; the six pre-release Aspirant classes have one row each, `rules_version = 'v1'`, `content_format = 'advent'`.

| name | parent id | parent `rules_edition` / `content_format` / `rules_version` |
| --- | --- | --- |
| Gunslinger | `b6ce893b-8207-4f89-abfc-a02ae0e9b65d` | advent / advent / v1 |
| Illusionist | `018fcdba-39cf-4cc8-8f4d-92e2023719cf` | advent / advent / v1 |
| Librarian | `f0de4397-5e71-4ed6-a16a-26dc72c46801` | advent / advent / v1 |
| Thane | `aa0f9690-37a6-4784-9119-1b2117f798a7` | advent / advent / v1 |
| Thunderbird | `a605940b-f27f-45d8-af76-abda848b3e12` | advent / advent / v1 |
| Wanderer | `ebd55f52-9768-400a-94d6-392cd07e2b24` | advent / advent / v1 |
| Berserker | `3c8f036f-06f0-4f72-9336-aa9c3fdd5541` | aspirant / advent / v1 |
| Freerunner | `42d39b55-7db1-49a1-a53b-b1cd5fc9bc47` | aspirant / advent / v1 |
| Infiltrator | `c687840c-a781-4d46-9570-b344e1b9be04` | aspirant / advent / v1 |
| Samaritan | `f0726c9b-bfaf-4c22-9318-75c50c8e3cbf` | aspirant / advent / v1 |
| Vessel | `3a863d9c-8454-4326-87ad-ed105fccbbd4` | aspirant / advent / v1 |
| Witchfinder | `79721ac8-378e-4b3e-b1e3-8266689da89e` | aspirant / advent / v1 |

**The fork payload.** `FIELDS` becomes `fieldsFor(book)`:
- both books: the current list, **plus `expanded_tips`** (the column is NOT NULL since plan 1)
- the pre-release book only: `prerelease_section` (the V1 artifact has no such key and `DERIVED.prerelease_section` would throw on it)
- fork plans only: `id`, `base_class_id`, `rules_edition`, `content_format`

`id` comes from `ASPIRANT_V1_CLASS_IDS` rather than from Postgres, so the same class carries the same id in local and in production. The alternative — load, then read the ids back and paste them into the roster — is the exact manual reconciliation the 2026-08-07 deployment checklist shows going wrong.

**`free_play_access` is `false` for V1.** `DERIVED.free_play_access` currently returns `true` unconditionally, which was right for a pre-release book given away. The Aspirant book grants the V1 classes through `CORE_CLASS_UNLOCKS`, and making them free-play as well would make that roster meaningless. Make the derivation read `book.key === 'prerelease'`.

**`FORBIDDEN` moves.** `test/load-prerelease-classes.test.js:31` forbids `rules_edition`, `rules_version` and `base_class_id` in every payload. For **fork plans specifically** those three are now required. Split the assertion: non-fork payloads keep the full `FORBIDDEN` list; fork payloads assert the three are present and correct, and that `is_public`, `status`, `teaser`, `image_url` and `image_crop` are still absent.

**A book with no remap file skips the remap machinery entirely.** `main` unconditionally does `JSON.parse(readFileSync(REMAP, 'utf8'))` (`:283`) and then runs `unresolvableTargets`, `fetchHeldRows`, `groupUnresolvable` and `unremapped` over it. With `book.remap === null` there is nothing to read: treat the remap as `[]` and skip the read, but **still run the orphan scan**. Forking orphans nothing by construction, so the scan should come back empty — and that is the point. A scan that is skipped cannot tell you the projection is wrong; a scan that runs and reports zero can.

**`rowByName` goes ambiguous.** `:387-388` maps payload name to row for the publish step. Once a parent and its fork share a name, that map has two entries for `Berserker` and silently keeps one. Publishing must key on the **plan**, not the name — carry the created row back onto its plan after the insert and publish from `plan.row.id`.

- [ ] **Step 1: Write the failing tests**

```js
const forkBook = bookFor('aspirant-v1');
const row = (name, over = {}) => ({ id: `id-${name}`, name, rules_edition: 'advent',
  content_format: 'advent', rules_version: 'v1', is_player_created: false, ...over });

test('a class with an advent-format parent forks rather than updating it', () => {
  const rows = [row('Berserker', { rules_edition: 'aspirant' })];
  const [plan] = planLoad([berserkerRecord], rows, forkBook);
  expect(plan.disposition).toBe('fork');
  expect(plan.row).toBeNull();
  expect(plan.parent.id).toBe('id-Berserker');
});

test('the fork payload carries the parent pointer and both axes', () => {
  const [plan] = planLoad([berserkerRecord], [row('Berserker', { rules_edition: 'aspirant' })], forkBook);
  expect(plan.payload.base_class_id).toBe('id-Berserker');
  expect(plan.payload.rules_edition).toBe('aspirant');
  expect(plan.payload.content_format).toBe('aspirant');
  expect(plan.payload.id).toBe(ASPIRANT_V1_CLASS_IDS.Berserker);
});

test('v1 is the parent when a class has both a v1 and a v2 row', () => {
  const rows = [row('Gunslinger'), row('Gunslinger', { id: 'id-v2', rules_version: 'v2' })];
  const [plan] = planLoad([gunslingerRecord], rows, forkBook);
  expect(plan.disposition).toBe('fork');
  expect(plan.parent.id).toBe('id-Gunslinger');
});

test("a player's own class of the same name is not a fork parent", () => {
  const rows = [row('Gunslinger', { id: 'id-mine', is_player_created: true })];
  expect(() => planLoad([gunslingerRecord], rows, forkBook)).toThrow('Gunslinger');
});

test('re-running after a fork updates the fork and never creates a second one', () => {
  const rows = [row('Berserker', { rules_edition: 'aspirant' }),
    row('Berserker', { id: 'id-v1fork', rules_edition: 'aspirant', content_format: 'aspirant' })];
  const [plan] = planLoad([berserkerRecord], rows, forkBook);
  expect(plan.disposition).toBe('update');
  expect(plan.row.id).toBe('id-v1fork');
});

test('a fork leaves its parent untouched in the post-import projection', () => {
  const parent = row('Berserker', { rules_edition: 'aspirant', gear: [{ name: 'Old Axe' }] });
  const [plan] = planLoad([berserkerRecord], [parent], forkBook);
  const after = projectImport([parent], [plan], forkBook);
  expect(after.find((c) => c.id === 'id-Berserker').gear).toEqual([{ name: 'Old Axe' }]);
  expect(after).toHaveLength(2);
});

test("the parent's item names survive the fork, so nothing is orphaned", () => {
  const parent = row('Berserker', { is_public: true, rules_edition: 'aspirant',
    gear: [{ name: 'Old Axe' }], abilities: [] });
  const [plan] = planLoad([berserkerRecord], [parent], forkBook);
  const names = catalogueNames(projectImport([parent], [plan], forkBook));
  expect(names.gear.has('Old Axe')).toBe(true);
});

test('only the pre-release book grants free play access', () => {
  expect(buildPayload(berserkerRecord, forkBook).free_play_access).toBe(false);
  expect(buildPayload(prereleaseRecord, bookFor('prerelease')).free_play_access).toBe(true);
});

test('every payload carries expanded_tips, because the column is NOT NULL', () => {
  expect(buildPayload(prereleaseRecord, bookFor('prerelease')).expanded_tips)
    .toEqual({ player: [], conduit: [] });
});
```

- [ ] **Step 2: Add the minted class ids to `util/starter-content.js`**

```js
// The twelve rows scripts/load-prerelease-classes.mjs creates for
// ENCLAVE: Aspirant V1. Minted here rather than left to Postgres so the same
// class carries the same id in every environment -- which is the invariant
// util/core-roster.integration.test.js exists to check, and the one the
// 2026-08-07 deployment checklist had to reconcile by hand.
const ASPIRANT_V1_CLASS_IDS = {
  Gunslinger:  "3311fb69-4f9a-45f1-88d1-529bd8870a4c",
  Illusionist: "84543c7f-bb35-45e6-af5a-899b954bdc95",
  Librarian:   "3667c568-616f-4910-a89a-e576e197c862",
  Thane:       "0f8bbc56-90e7-4997-9356-a7aecaaecb21",
  Thunderbird: "4837502d-6595-44a9-8488-86e125a4bab3",
  Wanderer:    "00e706bd-fe35-478c-b817-3ce65c7ff91a",
  Berserker:   "cd56fcba-10b5-41af-9bbd-3c882377ac9d",
  Freerunner:  "c8b18cea-b8c9-4433-aa93-545eb28dcf66",
  Infiltrator: "a8b0d13d-280b-48b1-b410-37b34bfc1a81",
  Samaritan:   "fa42bce0-431c-4d00-a9f4-a21a1be0e519",
  Vessel:      "e293cb3a-98b0-492c-bf32-6311413574e4",
  Witchfinder: "81bccc24-a7f3-4217-8bf8-de65d1ae4633",
};
```

Export it alongside `CORE_CLASS_UNLOCKS`. Do **not** touch `CORE_CLASS_UNLOCKS` here — reshaping it is Task 11, and doing both at once makes two unrelated failures land in one diff.

- [ ] **Step 3–5: red, implement, green**

```bash
bun test test/load-prerelease-classes.test.js
bun run test:unit
```

- [ ] **Step 6: Dry-run against the real local catalogue**

```bash
eval "$(supabase status -o env)"
echo "$SUPABASE_URL"   # MUST print http://127.0.0.1:54321
bun scripts/load-prerelease-classes.mjs --book aspirant-v1
```
Expected output: `12 classes resolved (0 update, 0 create, 12 fork), 0 ambiguous`, and `DRY RUN - nothing written`. Each of the twelve reports `FORK <name> from <parent id>` with its full field list.

**Confirm the parent id of each of the twelve matches the table above.** If any differs, stop and report it.

Then dry-run the **other** book and confirm the refactor did not disturb it:
```bash
bun scripts/load-prerelease-classes.mjs
```
Expected, measured on this database on 2026-09-17, before any of this plan's work:

```
20 classes resolved (19 update, 1 create), 0 ambiguous
CREATE Charlatan
3 of 19 existing rows differ     # Ardent, Offdriver, Squire — each on `tips` and `abilities`
```

**This drift is pre-existing and is not yours to fix.** The pre-release load was never fully applied to this local database. **Do NOT run the pre-release loader with `--apply`** to make the numbers match — that writes content unrelated to this plan. The check here is only that the descriptor refactor did not *change* this output; compare against the three lines above.

- [ ] **Step 7: Commit**

```bash
git add scripts/load-prerelease-classes.mjs scripts/lib/character-impact.mjs test/load-prerelease-classes.test.js
git commit -m "feat: give the loader an explicit create/update/fork disposition"
```

---

### Task 11: The unlock roster

`CORE_CLASS_UNLOCKS.aspirant` is keyed by class name, and the V1 Berserker shares its name with the pre-release Berserker. The map's value must become a list of ids.

**Decision recorded:** owning the Aspirant book unlocks **all twelve** V1 classes, not six. The book contains twelve classes and an owner should get what the book contains, including the Aspirant V1 Gunslinger, Illusionist, Librarian, Thane, Thunderbird and Wanderer. The pre-release six stay, so nobody loses access to a class they already have characters on. The roster ends at **18 ids under 12 names**.

**Files:**
- Modify: `util/starter-content.js`
- Modify: `util/book-classes.js:13-17`
- Modify: `util/seed-classes.js:71-74`
- Modify: `util/book-classes.test.js:5-6,45`, `util/seed-classes.test.js:14,21,27,76,85,102`
- **Unchanged:** `routes/library.js:48` reads only `Object.keys(CORE_CLASS_UNLOCKS)`, so the value reshape does not reach it — verified, `models/class-book-unlocks.test.js:8-9`, `util/core-roster.integration.test.js:44`
- Modify: `e2e/specs/18-book-class-unlocks.spec.js:19,22,29,58`

**Interfaces:**
- Consumes: `ASPIRANT_V1_CLASS_IDS` (Task 10).
- Produces: `CORE_CLASS_UNLOCKS` where **every** roster value is a `string[]`, both editions, so no consumer has to branch on the shape.

- [ ] **Step 1: Write the failing test**

```js
test('every roster value is a list of ids, in both editions', () => {
  for (const roster of Object.values(CORE_CLASS_UNLOCKS)) {
    for (const ids of Object.values(roster)) {
      expect(Array.isArray(ids)).toBe(true);
      expect(ids.every((id) => typeof id === 'string')).toBe(true);
    }
  }
});

test('the Aspirant roster grants all twelve V1 classes and keeps the pre-release six', () => {
  const granted = Object.values(CORE_CLASS_UNLOCKS.aspirant).flat();
  expect(granted).toHaveLength(18);
  for (const id of Object.values(ASPIRANT_V1_CLASS_IDS)) expect(granted).toContain(id);
});

test('the twelve V1 ids are distinct and none collides with a pre-release id', () => {
  const v1 = Object.values(ASPIRANT_V1_CLASS_IDS);
  expect(new Set(v1).size).toBe(12);
  const advent = Object.values(CORE_CLASS_UNLOCKS.advent).flat();
  for (const id of v1) expect(advent).not.toContain(id);
});

test('a book grants every id under every name of its roster', () => {
  const ids = coreClassIdsForEditions(['aspirant']);
  expect(ids.size).toBe(18);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
bun test util/book-classes.test.js util/seed-classes.test.js
```
Expected: FAIL — every roster value is a bare string, so `Array.isArray` is false and the granted-id count is 6 rather than 18.

- [ ] **Step 3: Implement**

```js
// A name can grant more than one row: the Aspirant book contains both the
// pre-release Berserker and its V1 successor, which are separate version
// families and separate rows sharing a name.
const CORE_CLASS_UNLOCKS = {
  advent: {
    Gunslinger:  ['b6ce893b-8207-4f89-abfc-a02ae0e9b65d'],
    Illusionist: ['018fcdba-39cf-4cc8-8f4d-92e2023719cf'],
    Librarian:   ['f0de4397-5e71-4ed6-a16a-26dc72c46801'],
    Thane:       ['aa0f9690-37a6-4784-9119-1b2117f798a7'],
    Thunderbird: ['a605940b-f27f-45d8-af76-abda848b3e12'],
    Wanderer:    ['ebd55f52-9768-400a-94d6-392cd07e2b24'],
  },
  aspirant: {
    Berserker:   ['3c8f036f-06f0-4f72-9336-aa9c3fdd5541', ASPIRANT_V1_CLASS_IDS.Berserker],
    Freerunner:  ['42d39b55-7db1-49a1-a53b-b1cd5fc9bc47', ASPIRANT_V1_CLASS_IDS.Freerunner],
    Infiltrator: ['c687840c-a781-4d46-9570-b344e1b9be04', ASPIRANT_V1_CLASS_IDS.Infiltrator],
    Samaritan:   ['f0726c9b-bfaf-4c22-9318-75c50c8e3cbf', ASPIRANT_V1_CLASS_IDS.Samaritan],
    Vessel:      ['3a863d9c-8454-4326-87ad-ed105fccbbd4', ASPIRANT_V1_CLASS_IDS.Vessel],
    Witchfinder: ['79721ac8-378e-4b3e-b1e3-8266689da89e', ASPIRANT_V1_CLASS_IDS.Witchfinder],
    Gunslinger:  [ASPIRANT_V1_CLASS_IDS.Gunslinger],
    Illusionist: [ASPIRANT_V1_CLASS_IDS.Illusionist],
    Librarian:   [ASPIRANT_V1_CLASS_IDS.Librarian],
    Thane:       [ASPIRANT_V1_CLASS_IDS.Thane],
    Thunderbird: [ASPIRANT_V1_CLASS_IDS.Thunderbird],
    Wanderer:    [ASPIRANT_V1_CLASS_IDS.Wanderer],
  },
};

module.exports = { STARTER_RULES_PDF_ID, CORE_CLASS_UNLOCKS, ASPIRANT_V1_CLASS_IDS };
```

The six Advent ids are unchanged — only their wrapping — and the six pre-release Aspirant ids are unchanged too. Every value in the file is now a list, so no consumer branches on the shape.

Then fix every consumer. `util/book-classes.js:15` becomes `for (const id of Object.values(roster).flat()) ids.add(id);`. `util/seed-classes.js:73` reads `row.id = roster[cls][0];` (the guard above it is a `hasOwnProperty` check, which still holds). The five test files and the e2e spec follow the shape — `e2e/specs/18-book-class-unlocks.spec.js:22` destructures `Object.entries(CORE_CLASS_UNLOCKS.aspirant)[0]` and must take `ids[0]`.

- [ ] **Step 4: Run the tests**

```bash
bun run test:unit
```
Expected: PASS, except the known pre-existing failures.

**`util/core-roster.integration.test.js` will now fail** — it asserts every roster id resolves to a real row, and the twelve V1 rows do not exist until Task 12. That is the test doing its job. Record it in the ledger as expected-red and re-check it at Task 12:

```bash
SUPABASE_URL=http://127.0.0.1:54321 bun test util/core-roster.integration.test.js
```
Expected now: FAIL, naming the twelve missing ids. Expected after Task 12: PASS.

- [ ] **Step 5: Commit**

```bash
git add util/starter-content.js util/book-classes.js util/seed-classes.js \
        util/book-classes.test.js util/seed-classes.test.js util/core-roster.integration.test.js \
        models/class-book-unlocks.test.js e2e/specs/18-book-class-unlocks.spec.js
git commit -m "feat: grant all twelve Aspirant V1 classes through the Aspirant book"
```

---

### Task 12: Run the load

The only task in this plan that writes to a database. Everything before it is a dry run.

**Files:** none. This task changes no source; it executes and verifies.

**Before anything else, confirm the target.** `.env` is hand-switched between the local stack and the **live production** project.

```bash
eval "$(supabase status -o env)"
echo "$SUPABASE_URL"
```
This **must** print `http://127.0.0.1:54321`. If it does not, stop. **Never run `supabase db reset`** — the local database holds a restored production copy, not seed data.

- [ ] **Step 1: Record the before-state**

```bash
bun -e '
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const { count: classes } = await sb.from("classes").select("*", { count: "exact", head: true });
const { count: characters } = await sb.from("characters").select("*", { count: "exact", head: true });
const { data } = await sb.from("classes").select("id,updated_at");
console.log({ classes, characters, fingerprint: data.map(r => `${r.id}:${r.updated_at}`).sort().join("|").length });
'
```
Expected before: **50 classes, 327 characters.** Save the full `id:updated_at` list to the scratchpad — Step 4 compares against it.

- [ ] **Step 2: Apply**

```bash
bun scripts/load-prerelease-classes.mjs --book aspirant-v1 --apply
```
Expected: `12 classes resolved (0 update, 0 create, 12 fork), 0 ambiguous`, then `12 classes created`, then twelve `published:` lines. No remap lines — the Aspirant book's descriptor carries `remap: null` because it renames nothing.

- [ ] **Step 3: Confirm a second `--apply` is a no-op**

```bash
bun scripts/load-prerelease-classes.mjs --book aspirant-v1 --apply
```
Expected: `12 classes resolved (12 update, 0 create, 0 fork)`, `0 of 12 existing rows differ`, `0 classes written`, and twelve `already public:` lines. **Nothing may be created.** If a second fork appears, resolution is not finding the row it just wrote and the run must be rolled back before going further.

- [ ] **Step 4: Verify the after-state**

Assert every one of these:
- **62 classes** (50 + 12), **327 characters** — the character count must not move
- **every one of the 50 pre-existing rows has an unchanged `updated_at`** against the Step 1 fingerprint. This is the success criterion "no existing class row is modified by the load", and it is the one this plan can most easily get wrong.
- `content_format` census is exactly **50 `advent` / 12 `aspirant`**
- each of the twelve new rows carries the id from `ASPIRANT_V1_CLASS_IDS`, `rules_edition = 'aspirant'`, `content_format = 'aspirant'`, `rules_version = 'v1'`, `is_public = true`, `free_play_access = false`, and a `base_class_id` matching the parent table in Task 10
- each of the twelve has **12 gear** spanning columns 1–4 at positions 1–3, **3 abilities**, **3 advanced_abilities**, and non-empty `expanded_tips.player` and `.conduit`
- the 40 characters on pre-release Aspirant classes and the 201 on the Advent base six keep their `class_id`

- [ ] **Step 5: The firewall holds**

A format fork must be in a **different version family** from its parent. Check all four consumers against real rows:

```bash
SUPABASE_URL=http://127.0.0.1:54321 bun test util/core-roster.integration.test.js
SUPABASE_URL=http://127.0.0.1:54321 bun test util/class-structured-columns.integration.test.js
SUPABASE_URL=http://127.0.0.1:54321 bun test util/class-form-round-trip.integration.test.js
```
`core-roster` was expected-red from Task 11 and **must now pass** — all 18 Aspirant roster ids resolve to real rows carrying `rules_edition = 'aspirant'`. `class-form-round-trip` stays at its known 2 pass / 1 fail.

Then confirm by query that `computeVersionFamily` puts each V1 class alone: the V1 Berserker's family must contain only itself, not the pre-release Berserker, and the V1 Gunslinger's must contain neither Advent Gunslinger row.

- [ ] **Step 6: The full suite**

```bash
bun run test:unit
bun run check
bun run test:e2e
```
Expected: unit green, `check` exit 0, e2e at the known **6** pre-existing failures. `18-book-class-unlocks` was already one of the six; confirm it has not grown new failures beyond its known one.

- [ ] **Step 7: Restate the two jsonb key censuses**

Both describe a pre-Aspirant catalogue and are wrong the moment this load lands:

- `util/class-gear.js` — the `normalizeGear` comment says "a census of jsonb_object_keys over the **300** live gear items answers `{category, description, name}` and `{category, description, meters, name, notes}`". After the load there are **444**, and the twelve new classes' 144 items carry all eight keys including `column`, `position` and `default_enchantment`.
- `routes/classes-structured-fields.test.js` — the comparable census comment above the gear-shape tests.

Re-run the census and rewrite both comments to what is now true. Do not delete them: they are the record of why `normalizeGear` back-fills keys on save.

```bash
bun -e '
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const { data } = await sb.from("classes").select("gear");
const shapes = new Map();
for (const row of data) for (const item of row.gear || []) {
  const key = Object.keys(item).sort().join(",");
  shapes.set(key, (shapes.get(key) || 0) + 1);
}
console.log([...shapes.entries()].sort((a, b) => b[1] - a[1]));
'
```

- [ ] **Step 8: Commit**

The census comments are the only source change in this task:

```bash
git add util/class-gear.js routes/classes-structured-fields.test.js
git commit -m "docs: restate the gear key census now that V1 content is loaded"
```

The load itself writes only to the database. Record the before/after counts in the ledger, because the next task's migration is judged against them.

---

### Task 13: Re-tag `class_abilities`

Ruling 23 from slice 2's ledger. `class_abilities.type` was added with a corrective backfill keyed on `classes.advanced_abilities` (`supabase/migrations/20260913000000_class_abilities_type.sql`), which matched **zero** rows because no class had any advanced abilities. All 916 rows read `core` today, so the core/advanced distinction — and with it the 4-Perk economy slice 4 depends on — is not recoverable from the database.

Now that twelve classes carry advanced abilities, the backfill is worth re-running. **It must run after the load, not before** — running it first would repeat slice 2's no-op exactly.

**Files:**
- Create: `supabase/migrations/20260917000000_retag_class_abilities_advanced.sql`

- [ ] **Step 1: Measure what the migration should change, before writing it**

```bash
bun -e '
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const { data } = await sb.from("class_abilities").select("type");
const tally = {}; for (const r of data) tally[r.type] = (tally[r.type] || 0) + 1;
console.log(tally);
'
```
Record the count. Expect `{ core: 916 }` — or `core: 916 + n` if characters have been created against a V1 class since Task 12, which is exactly the population this migration exists to correct.

- [ ] **Step 2: Write the migration**

```sql
-- 20260913000000_class_abilities_type.sql ran this same backfill at a moment
-- when no class carried advanced abilities, so it matched zero rows and every
-- pick has read 'core' since. The twelve Aspirant V1 classes are the first
-- rows it can resolve against.
--
-- Keyed on a name match against the row's own class rather than on a mode flag,
-- so it is correct for all three creator modes rather than correct for one. It
-- touches nothing on an Advent-format class, which has no advanced list.
UPDATE public.class_abilities a
SET type = 'advanced'
FROM public.classes c
WHERE a.class_id = c.id
  AND a.type <> 'advanced'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(c.advanced_abilities) AS adv
    WHERE adv->>'name' = a.name
  );
```

The `a.type <> 'advanced'` clause makes a re-run write nothing rather than rewriting rows that are already correct.

- [ ] **Step 3: Apply it locally**

```bash
eval "$(supabase status -o env)"
echo "$SUPABASE_URL"   # MUST print http://127.0.0.1:54321
supabase migration up
```
**Never `supabase db reset`.**

- [ ] **Step 4: Verify**

- Re-run the tally. Every row whose name appears in its class's `advanced_abilities` reads `'advanced'`; everything else still reads `'core'`.
- **A character on an Advent-format class is untouched** — pick one of the 201 characters on an Advent base class and confirm every one of its `class_abilities` rows still reads `'core'`.
- Running `supabase migration up` again changes nothing.

Write an integration test asserting the invariant rather than the counts, so it keeps meaning as content grows:

```js
test('an ability pick is tagged advanced exactly when its class lists it as advanced', async () => {
  // for every class_abilities row: type === 'advanced' iff the row's name
  // appears in its class's advanced_abilities
});
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260917000000_retag_class_abilities_advanced.sql
git commit -m "fix: re-run the advanced-ability backfill now that classes carry advanced lists"
```

---

### Task 14: The rendered V1 class page

An end-to-end pass proving the twelve-signature, four-column, two-ability-section page actually renders.

**Files:**
- Create: `e2e/specs/27-aspirant-v1-class-page.spec.js`

**Interfaces:**
- Consumes: `ASPIRANT_V1_CLASS_IDS` from `util/starter-content.js` — the spec navigates by id, not by name, because two public classes are now named `Berserker`.

- [ ] **Step 1: Write the spec**

Against `/classes/<ASPIRANT_V1_CLASS_IDS.Gunslinger>`, assert:
- **twelve** signature items, distributed **3 / 3 / 3 / 3** across the four `.signature-column` elements (the partial plan 1 added at `views/partials/class-signature-columns.handlebars`)
- **six** abilities in two sections — three core, three advanced
- every signature shows a Default Enchantment
- every ability shows two sample perks, one of which has a Compounded variant
- the Expanded Tips section renders both a Player and a Conduit list
- a Power Rating renders as a real `<sup>` element, not as the literal text `<sup>` — locate one and assert `sup` is in the DOM
- the page has no horizontal overflow at 1280px

Then against a pre-release Aspirant class (`CORE_CLASS_UNLOCKS.aspirant.Berserker[0]`, the **parent** row), assert it still renders **six** signatures in columns 1–2 and **three** abilities with no advanced section. This is the regression guard for "no existing row is modified": the same template serves both formats, and the parent must look exactly as it did before the load.

- [ ] **Step 2: Run it**

```bash
bun run test:e2e e2e/specs/27-aspirant-v1-class-page.spec.js
```

If the harness needs seeding after a wipe: `bun run seed:admin --yes`.

- [ ] **Step 3: Run the whole e2e suite**

```bash
bun run test:e2e
```
Expected: the known **6** pre-existing failures and no more. Note that `15-auth-redirect` and `26-aspiring-wizard` are known flakes under full-suite load — if either fails, re-run it in isolation before calling it a regression.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/27-aspirant-v1-class-page.spec.js
git commit -m "test: cover the rendered Aspirant V1 class page in both formats"
```

---

## Success criteria

Checked at the end, against the spec's list:

- [ ] Twelve V1 classes exist as forks, each with twelve signatures across four columns, three core and three advanced abilities, every ability carrying two sample perks of which one has a Compounded variant, and every signature a Default Enchantment.
- [ ] No existing class row is modified by the load — verified by unchanged `updated_at` on all 50 pre-existing rows — and every character on a pre-release Aspirant or Advent base class keeps its class, its picks and its rendered content.
- [ ] The verifier passes token-for-token against the PDF for all twelve classes, and passes again for the pre-release artifact (19/20 classes — CHARLATAN has no `page_range` and is skipped — 180 entries, 0 differences).
- [ ] A second `--apply` is a no-op.
- [ ] `content_format` is `NOT NULL` with 50 rows `'advent'` and exactly the twelve new rows `'aspirant'`.
- [ ] A format fork is in a different version family from its parent, in all four consumers.
- [ ] `class_abilities.type` reads `'advanced'` for every pick drawn from a class's advanced list, and `'core'` otherwise.
- [ ] Power Ratings render as superscripts everywhere they appear.

## Deliberately not in this plan

Carried forward from the spec, and two found during plan 1:

- **Upgrading a character to an Aspirant class.** Moving a character between families is a player decision with rules consequences — stat caps, the Merx and Perk economies — none of which land before slices 4 and 5. This slice makes the destination exist; it does not build the road.
- **Retiring the pre-release rows.** They stay public and playable.
- **`routes/characters.js:245-250`** slices gear to 6 and hardcodes a third copy of the column-1-is-default rule, so the character wizard will show only 6 of a 12-signature class. The spec defers this to slices 4–5. **The comment above it says "all 6 class items" and will read as correct to whoever picks up slice 4.**
- **`views/character-wizard.handlebars:2`** emits `{{{json wizardData}}}` through a stringifier that does not escape `</script`, and that data carries user-writable class content. Pre-existing and untouched by this work.
