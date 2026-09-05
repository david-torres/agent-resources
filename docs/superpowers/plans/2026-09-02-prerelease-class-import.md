# Pre-Release Class Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import all 19 classes from the August 2026 pre-release bundle into the `classes` table verbatim, restructuring class prose and ability/signature metadata into first-class columns and JSONB, and giving admins a UI that can edit all of it.

**Architecture:** Three layers, built in dependency order. (1) A pure-function extraction library plus driver scripts that turn the PDF's coordinate-tagged word stream into a reviewed JSON artifact, gated by a token-diff harness that proves no text was altered. (2) A migration adding structured columns, and an idempotent loader that writes the artifact into the DB. (3) App changes: class-view renders the structured parts, the admin form gains a full editing UI, and the old `description` blob is retired once every reader has moved off it.

**Tech Stack:** Bun, Express 4, express-handlebars, Alpine.js (CDN, registrations in `public/js/alpine-components.js`), Bulma, Supabase/Postgres, `bun:test`, `poppler-utils` (`pdftotext`).

**Spec:** `docs/superpowers/specs/2026-09-02-prerelease-class-import-design.md`

## Global Constraints

- **The document's text is copied verbatim.** No word is edited, rephrased, summarized, corrected, or reordered. Typography is preserved exactly: curly quotes (`'` `'` `"` `"`), en dashes in `Low–High`, `ō`/`ö`/`š`/`á`, and the `❖`/`➢` bullet glyphs. Structure may be added; text may not be changed.
- Nothing is written to any database until `scripts/verify-prerelease-extract.mjs` reports an empty token diff for all 19 classes.
- `bun run db:backup` against production runs before the first production write.
- Local Supabase stack is loaded and eyeballed before production. A seeded local database is **not** sufficient to exercise Tasks 10a/10b — it has no characters. Restore a production copy first:

  ```sh
  bun run db:backup                       # against the hosted project
  supabase db reset --no-seed             # HEAD schema, empty
  IMG=public.ecr.aws/supabase/postgres:17.6.1.095
  DB=postgresql://postgres:postgres@host.docker.internal:54322/postgres
  docker run --rm -i --add-host=host.docker.internal:host-gateway --entrypoint pg_restore $IMG \
    --data-only --no-owner --no-privileges --schema=auth --table=users -d "$DB" < backups/<dump>
  docker run --rm -i --entrypoint pg_restore $IMG \
    --data-only --no-owner --no-privileges --schema=public -f - < backups/<dump> > /tmp/public-data.sql
  { echo 'SET session_replication_role = replica;'; cat /tmp/public-data.sql; } \
    | PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -c "select setval('public.mission_characters_id_seq', coalesce((select max(id) from public.mission_characters),0)+1, false);"
  ```

  `pg_restore --disable-triggers` does **not** work here: the Supabase `postgres` role is not superuser and cannot disable system RI triggers, so the restore fails on foreign keys in alphabetical table order. `session_replication_role = replica` is settable by that role and achieves the same thing. The one sequence needs a manual `setval` because a data-only restore does not carry sequence state.
- Source PDF: `/home/dave/Downloads/Current_Pre-Release_Classes__Aug__2026_.pdf` (80 pages, "Last Updated: August 30th, 2026").
- Meter values come from a closed vocabulary: `Low`, `Mid`, `High`, `Low–Mid`, `Mid–High`, `Low–High`, `1x`–`5x`. The dash is U+2013 EN DASH, not a hyphen.
- Tests run with `bun run test:unit`. New route tests that boot Express must be added to the `httpFiles` set in `scripts/run-tests.mjs` and run with `bun run test:http`.
- **No class content is loaded until the character-impact report is clean.** `save_character_atomic` deletes and reinserts every `class_abilities`/`class_gear` row on each character save, and `services/character/service.js:284-302` resolves item names through a global name→class_id map that **throws** on an unknown name — so an item name that vanishes from the catalogue makes every character holding it unsaveable. Tasks 10a/10b are not optional.
- Follow the repo's comment discipline (`/home/dave/.claude/CLAUDE.md`): explain non-obvious *why*, never restate *what*, never narrate history.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `util/prerelease-extract.js` | Pure, import-safe parsing helpers: stat lines, meter pairing, note trees, column-band clustering, tokenization. No I/O. |
| `util/prerelease-extract.test.js` | Unit tests for the above. |
| `scripts/extract-prerelease-classes.mjs` | Driver: runs `pdftotext -bbox-layout`, segments pages per class, emits the JSON artifact. |
| `scripts/verify-prerelease-extract.mjs` | Token-diff harness gating the load; also emits per-class review files. |
| `scripts/load-prerelease-classes.mjs` | Idempotent loader with `--dry-run` / `--apply`. |
| `docs/data/prerelease-classes-2026-08.json` | The reviewed extraction artifact (committed — it is the audit trail). |
| `supabase/migrations/20260902000000_class_structured_content.sql` | Adds structured columns; drops dead `class_abilities` columns. |
| `supabase/migrations/20260902000001_drop_class_description.sql` | Drops `classes.description` after readers migrate. |
| `views/partials/class-meters.handlebars` | Renders a `meters` array as a definition list. |
| `views/partials/class-notes.handlebars` | Renders a two-level `notes` tree. |

**Modified:**

| Path | Change |
|---|---|
| `views/class-view.handlebars:106` | Description blob → structured prose parts. |
| `views/class-view.handlebars:183,200` | Positional gear split → `category`. |
| `views/class-view.handlebars:223-232` | Ability cards gain meters, paired action, notes. |
| `views/class-form.handlebars` | New scalar fields; Alpine-driven repeatable ability/gear editors. |
| `routes/classes.js:57-70,605-686,687-778` | Parse the new form shapes. |
| `routes/classes.js:407-411` | OpenGraph description off `description`. |
| `routes/characters.js:204-206` | Wizard payload off `description`. |
| `util/class-export.js:88-90,158-176` | Export the new fields; drop positional gear split. |
| `util/class-import.js:12-34` | Zod schemas accept the new fields. |
| `models/class.js` | `serializeClassForAgent` carries the new fields. |
| `util/enclave-consts.js:267-274,292+` | Witchhunter → Witchfinder. |
| `util/starter-content.js:12-30` | Aspirant roster key rename. |
| `util/seed-classes.js` | Seeds the renamed class. |
| `scripts/run-tests.mjs` | Register new http-mode test files. |

---

## Part A — Extraction

### Task 1: Stat-line parser

**Files:**
- Create: `util/prerelease-extract.js`
- Test: `util/prerelease-extract.test.js`

**Interfaces:**
- Produces: `parseStatLine(line: string) => { [stat: string]: number }` — lowercase stat keys matching `util/enclave-consts.js` `statList`; `++X` is 2 points, `+X` is 1. Trailing `*` is stripped. Separators may be `,` or `/`.

- [ ] **Step 1: Write the failing test**

```js
// util/prerelease-extract.test.js
const { test, expect } = require('bun:test');
const { parseStatLine } = require('./prerelease-extract');

test('parses the three-single form', () => {
  expect(parseStatLine('+Sensory, +Skill, +Vitality*'))
    .toEqual({ sensory: 1, skill: 1, vitality: 1 });
});

test('parses the double-plus comma form', () => {
  expect(parseStatLine('++Will, +Might')).toEqual({ will: 2, might: 1 });
});

test('parses the double-plus slash form used by the Aspirant six', () => {
  expect(parseStatLine('++Might/+Resilience')).toEqual({ might: 2, resilience: 1 });
});

// Brainiac is the one class whose pluses total 2, not 3. The parser must not
// "correct" it to 3 -- the document says what it says.
test('parses a lone double-plus without padding to three points', () => {
  expect(parseStatLine('++Intelligence*')).toEqual({ intelligence: 2 });
});

test('rejects a stat name not in statList', () => {
  expect(() => parseStatLine('+Charisma')).toThrow(/Charisma/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test util/prerelease-extract.test.js`
Expected: FAIL — `Cannot find module './prerelease-extract'`

- [ ] **Step 3: Write minimal implementation**

```js
// util/prerelease-extract.js
const { statList } = require('./enclave-consts');

const parseStatLine = (line) => {
    const spread = {};
    for (const token of String(line).split(/[,/]/)) {
        const match = token.trim().match(/^(\++)\s*([A-Za-z]+)\*?$/);
        if (!match) continue;
        const stat = match[2].toLowerCase();
        if (!statList.includes(stat)) {
            throw new Error(`Unknown stat in stat line: ${match[2]}`);
        }
        spread[stat] = match[1].length;
    }
    return spread;
};

module.exports = { parseStatLine };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test util/prerelease-extract.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add util/prerelease-extract.js util/prerelease-extract.test.js
git commit -m "feat: parse pre-release class stat lines into stat spreads"
```

---

### Task 2: Column-band clustering

**Files:**
- Modify: `util/prerelease-extract.js`
- Test: `util/prerelease-extract.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `clusterBands(xMins: number[], tolerance = 6) => number[]` — sorted band centres, each the mean of a run of `xMin` values within `tolerance` points of the run's start.

Bands are derived per page rather than hardcoded so a page laid out slightly differently still resolves. Page 4 of the source yields centres near 75.8, 92.3, 99–112, 168.8, 198.8, 421.5, and 491–503.

- [ ] **Step 1: Write the failing test**

```js
const { clusterBands } = require('./prerelease-extract');

test('groups near-identical xMin values into one band', () => {
  expect(clusterBands([75.8, 75.8, 76.1, 421.5, 421.5, 503.4]))
    .toEqual([75.9, 421.5, 503.4]);
});

test('keeps bands closer than the tolerance apart separate when given a tighter tolerance', () => {
  expect(clusterBands([92.3, 99.0], 3)).toEqual([92.3, 99.0]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test util/prerelease-extract.test.js`
Expected: FAIL — `clusterBands is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
const round1 = (value) => Math.round(value * 10) / 10;

const clusterBands = (xMins, tolerance = 6) => {
    const sorted = [...xMins].sort((a, b) => a - b);
    const bands = [];
    let run = [];
    for (const x of sorted) {
        if (run.length && x - run[0] > tolerance) {
            bands.push(round1(run.reduce((a, b) => a + b, 0) / run.length));
            run = [];
        }
        run.push(x);
    }
    if (run.length) bands.push(round1(run.reduce((a, b) => a + b, 0) / run.length));
    return bands;
};
```

Add `clusterBands` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test util/prerelease-extract.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add util/prerelease-extract.js util/prerelease-extract.test.js
git commit -m "feat: cluster PDF word x-offsets into column bands"
```

---

### Task 3: Meter pairing

**Files:**
- Modify: `util/prerelease-extract.js`
- Test: `util/prerelease-extract.test.js`

**Interfaces:**
- Consumes: `clusterBands` from Task 2.
- Produces: `pairMeters(blocks) => [{ label, value }]` where `blocks` is `[{ xMin, yMin, text }]` limited to the meter columns. Label and value pair by nearest `yMin` (within 3 points). Output order is by `yMin` ascending — the printed order.

- [ ] **Step 1: Write the failing test**

```js
const { pairMeters } = require('./prerelease-extract');

test('pairs labels with values on the same row, in printed order', () => {
  const blocks = [
    { xMin: 421.5, yMin: 128.5, text: 'Essence Cost' },
    { xMin: 503.4, yMin: 128.5, text: 'Low' },
    { xMin: 421.5, yMin: 152.4, text: 'Cooldown' },
    { xMin: 503.4, yMin: 152.4, text: 'Low' },
  ];
  expect(pairMeters(blocks)).toEqual([
    { label: 'Essence Cost', value: 'Low' },
    { label: 'Cooldown', value: 'Low' },
  ]);
});

// A wide value like "Low–High" starts further left than "Mid" does, so the
// value column is not a single x. Pairing is by row, not by exact offset.
test('pairs a wide value whose xMin differs from the narrow values', () => {
  const blocks = [
    { xMin: 421.5, yMin: 328.1, text: 'Duration' },
    { xMin: 491.4, yMin: 328.1, text: 'Low–High' },
  ];
  expect(pairMeters(blocks)).toEqual([{ label: 'Duration', value: 'Low–High' }]);
});

test('tolerates a half-point row misalignment', () => {
  const blocks = [
    { xMin: 421.5, yMin: 476.7, text: 'Essence Cost' },
    { xMin: 503.2, yMin: 478.9, text: 'Mid' },
  ];
  expect(pairMeters(blocks)).toEqual([{ label: 'Essence Cost', value: 'Mid' }]);
});

test('throws when a label has no value on its row', () => {
  const blocks = [{ xMin: 421.5, yMin: 100, text: 'Cooldown' }];
  expect(() => pairMeters(blocks)).toThrow(/Cooldown/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test util/prerelease-extract.test.js`
Expected: FAIL — `pairMeters is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
const ROW_TOLERANCE = 3;

const pairMeters = (blocks) => {
    const [labelBand] = clusterBands(blocks.map(b => b.xMin), 20);
    const labels = blocks.filter(b => Math.abs(b.xMin - labelBand) <= 20);
    const values = blocks.filter(b => !labels.includes(b));
    return labels
        .sort((a, b) => a.yMin - b.yMin)
        .map((label) => {
            const value = values.find(v => Math.abs(v.yMin - label.yMin) <= ROW_TOLERANCE);
            if (!value) throw new Error(`Meter label with no value: ${label.text}`);
            return { label: label.text, value: value.text };
        });
};
```

Add `pairMeters` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test util/prerelease-extract.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add util/prerelease-extract.js util/prerelease-extract.test.js
git commit -m "feat: pair meter labels with values by table row"
```

---

### Task 4: Note-tree builder

**Files:**
- Modify: `util/prerelease-extract.js`
- Test: `util/prerelease-extract.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildNoteTree(bullets) => [{ text, children: [{ text, children: [] }] }]` where `bullets` is `[{ xMin, text }]`. `❖` (xMin ≈ 75.8) is top level, `➢` (xMin ≈ 102.8) nests under the preceding top-level note. The glyph and the zero-width space that follows it are stripped from `text`; the words are not touched. `children` is always an array.

- [ ] **Step 1: Write the failing test**

```js
const { buildNoteTree } = require('./prerelease-extract');

test('nests sub-bullets under the preceding top-level bullet', () => {
  const bullets = [
    { xMin: 75.8, text: '❖​ If the beast is powerful enough, this Ability ends prematurely.' },
    { xMin: 102.8, text: '➢​ Also ends prematurely if the collar is destroyed.' },
    { xMin: 75.8, text: '❖​ Cooldown begins on use rather than on expiry.' },
  ];
  expect(buildNoteTree(bullets)).toEqual([
    {
      text: 'If the beast is powerful enough, this Ability ends prematurely.',
      children: [{ text: 'Also ends prematurely if the collar is destroyed.', children: [] }],
    },
    { text: 'Cooldown begins on use rather than on expiry.', children: [] },
  ]);
});

test('gives every note an array of children even when it has none', () => {
  const [note] = buildNoteTree([{ xMin: 75.8, text: '❖​ Only note.' }]);
  expect(note.children).toEqual([]);
});

test('throws on a sub-bullet with no parent', () => {
  expect(() => buildNoteTree([{ xMin: 102.8, text: '➢​ Orphan.' }]))
    .toThrow(/no parent/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test util/prerelease-extract.test.js`
Expected: FAIL — `buildNoteTree is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// The glyph is followed by U+200B in the source PDF; both are furniture, and
// stripping them leaves the sentence itself untouched.
const stripBullet = (text) => text.replace(/^[❖➢]​?\s*/, '').trim();

const buildNoteTree = (bullets) => {
    const [topBand] = clusterBands(bullets.map(b => b.xMin), 10);
    const notes = [];
    for (const bullet of bullets) {
        const note = { text: stripBullet(bullet.text), children: [] };
        if (Math.abs(bullet.xMin - topBand) <= 10) {
            notes.push(note);
            continue;
        }
        if (!notes.length) throw new Error(`Sub-bullet with no parent: ${note.text}`);
        notes[notes.length - 1].children.push(note);
    }
    return notes;
};
```

Add `buildNoteTree` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test util/prerelease-extract.test.js`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add util/prerelease-extract.js util/prerelease-extract.test.js
git commit -m "feat: build two-level note trees from PDF bullet blocks"
```

---

### Task 5: Verification tokenizer

**Files:**
- Modify: `util/prerelease-extract.js`
- Test: `util/prerelease-extract.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `tokenize(text: string) => string[]` — words with whitespace collapsed, bullet glyphs, zero-width spaces and soft hyphens removed. Case, punctuation and diacritics are **preserved**: the harness must catch a smart quote turned straight, or an en dash turned hyphen.

- [ ] **Step 1: Write the failing test**

```js
const { tokenize } = require('./prerelease-extract');

test('collapses whitespace and drops bullet furniture', () => {
  expect(tokenize('❖​  Cooldown   begins\non use.'))
    .toEqual(['Cooldown', 'begins', 'on', 'use.']);
});

// The whole point of the harness: typography changes must be visible.
test('does not normalize curly quotes or en dashes away', () => {
  expect(tokenize('Low–High ‘Em!')).toEqual(['Low–High', '‘Em!']);
  expect(tokenize('Low-High')).not.toEqual(tokenize('Low–High'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test util/prerelease-extract.test.js`
Expected: FAIL — `tokenize is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
const tokenize = (text) => String(text)
    .replace(/[❖➢​­]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
```

Add `tokenize` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test util/prerelease-extract.test.js`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```bash
git add util/prerelease-extract.js util/prerelease-extract.test.js
git commit -m "feat: tokenize class text for extraction verification"
```

---

### Task 6: Extraction driver

**Files:**
- Create: `scripts/extract-prerelease-classes.mjs`
- Create: `docs/data/prerelease-classes-2026-08.json` (output)

**Interfaces:**
- Consumes: `parseStatLine`, `clusterBands`, `pairMeters`, `buildNoteTree` from `util/prerelease-extract.js`.
- Produces: a JSON array of 19 records, each:
  `{ name, prerelease_section, designer, stat_line, stat_note, stat_spread, quote, quote_source, overview, conduit_notes, grounding, examples_heading, examples[], tips_heading, tips[], challenge_level, abilities[3], gear[6], page_range: [first, last] }`
  Ability: `{ name, description, paired_action, meters[], notes[] }`.
  Gear: `{ name, description, category, meters[], notes[] }`.

This script shells out to `pdftotext`, so it is exercised by running it, not by unit tests; its parsing logic lives in the tested helpers.

- [ ] **Step 1: Confirm the toolchain**

Run: `pdftotext -v`
Expected: version banner. If missing: `sudo apt install poppler-utils`.

- [ ] **Step 2: Write the driver**

Structure it as these stages, each a named function:

```js
// scripts/extract-prerelease-classes.mjs
// Turns the pre-release bundle PDF into the reviewed JSON artifact. Every
// string is lifted from the PDF's own word stream -- nothing is retyped, and
// nothing is rewritten. scripts/verify-prerelease-extract.mjs proves it.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PDF = process.argv[2];
const OUT = process.argv[3] || 'docs/data/prerelease-classes-2026-08.json';

// 1. `pdftotext -bbox-layout` -> per-word coordinates for all 80 pages.
const readBoxes = (pdf) => execFileSync('pdftotext',
    ['-bbox-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });

// 2. Parse the XHTML into blocks: { page, xMin, yMin, text }, where text is
//    the block's words joined by single spaces.
// 3. Segment: a class starts at the page whose first block matches
//    /^(.+) Abilities$/ minus its preceding cover page, and runs to the block
//    before the next such page. Section headings (PCCS / EXCLUSIVES /
//    ASPIRANT CLASSES) set prerelease_section for everything that follows.
// 4. Per class, assign blocks to fields by band and by the anchors below.
```

Field anchors, all verified present across all 19 classes:

| Field | Anchor |
|---|---|
| `name` | the all-caps title block on the cover page |
| `stat_line` | the block matching `/^\+{1,2}[A-Z]/` |
| `stat_note` | the block starting `*` |
| `quote` / `quote_source` | the quoted block and the `—`-prefixed block after it |
| `overview` / `conduit_notes` / `grounding` | the three body paragraphs, in printed order; `conduit_notes` starts "Conduits designing", `grounding` starts "Grounded in" |
| `examples_heading` | the block matching `/^Examples from .*:$/` |
| `examples` | the ❖ bullets after that heading |
| `tips_heading` | the block matching `/^(Quick Tips\|Tips on Playing .+)$/` |
| `tips` | the ❖ bullets after that heading |
| `challenge_level` | capture group of `/^Challenge Level:\s*(\S+)$/` |
| `designer` | capture group of `/^Design by (.+)$/`, else `null` |
| abilities | three groups on the `X Abilities` pages, split at each name-band block |
| gear | six groups on the `X Signatures` pages; `category` is `default` before the `Elective` divider block and `elective` after |

- [ ] **Step 3: Run the extraction**

```bash
mkdir -p docs/data
bun run scripts/extract-prerelease-classes.mjs \
  /home/dave/Downloads/Current_Pre-Release_Classes__Aug__2026_.pdf \
  docs/data/prerelease-classes-2026-08.json
```

Expected: `extracted 19 classes` and a JSON file.

- [ ] **Step 4: Assert the structural invariants**

```bash
bun -e '
const rows = require("./docs/data/prerelease-classes-2026-08.json");
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };
if (rows.length !== 19) fail(`expected 19 classes, got ${rows.length}`);
for (const r of rows) {
  if (r.abilities.length !== 3) fail(`${r.name}: ${r.abilities.length} abilities`);
  if (r.gear.length !== 6) fail(`${r.name}: ${r.gear.length} gear`);
  if (r.gear.filter(g => g.category === "default").length !== 3) fail(`${r.name}: default gear count`);
  if (r.gear.filter(g => g.category === "elective").length !== 3) fail(`${r.name}: elective gear count`);
  if (r.abilities.some(a => !a.paired_action)) fail(`${r.name}: missing paired action`);
  if (!["Low","Mid","High"].includes(r.challenge_level)) fail(`${r.name}: challenge ${r.challenge_level}`);
  if (!r.examples.length) fail(`${r.name}: no examples`);
  if (!r.tips.length) fail(`${r.name}: no tips`);
}
console.log("structure OK: 19 classes, 57 abilities, 114 signatures");
'
```

Expected: `structure OK: 19 classes, 57 abilities, 114 signatures`

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-prerelease-classes.mjs docs/data/prerelease-classes-2026-08.json
git commit -m "feat: extract pre-release class content from the bundle PDF"
```

---

### Task 7: Verification harness — the gate

**Files:**
- Create: `scripts/verify-prerelease-extract.mjs`

**Interfaces:**
- Consumes: `tokenize` from `util/prerelease-extract.js`; the artifact from Task 6.
- Produces: exit code 0 only when every class's token diff is empty. Writes `/tmp/prerelease-review/<Class>.txt` for human review.

This is the task that discharges the verbatim constraint. It must be genuinely adversarial: if it cannot fail, it is not a check.

- [ ] **Step 1: Write the harness**

```js
// scripts/verify-prerelease-extract.mjs
// Gates the load. For each class: the multiset of tokens on that class's PDF
// pages must equal the multiset of tokens across its extracted fields. A word
// dropped, duplicated, retyped, or re-punctuated shows up here as a diff.
import { execFileSync } from 'node:child_process';
const { tokenize } = require('../util/prerelease-extract.js');

const counts = (tokens) => tokens.reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map());

const diff = (expected, actual) => {
    const [e, a] = [counts(expected), counts(actual)];
    const missing = [], extra = [];
    for (const [t, n] of e) if ((a.get(t) || 0) < n) missing.push(`${t} x${n - (a.get(t) || 0)}`);
    for (const [t, n] of a) if ((e.get(t) || 0) < n) extra.push(`${t} x${n - (e.get(t) || 0)}`);
    return { missing, extra };
};
```

Per class: run `pdftotext -f <first> -l <last> -layout <pdf> -` for the class's `page_range`, strip page furniture (the running "Design by …" credit line is class data and is kept; the "Last Updated" and section-intro pages are outside every class's range), tokenize, and compare against the tokenized concatenation of every extracted field.

- [ ] **Step 2: Prove the harness can fail**

Corrupt one field and confirm the harness catches it:

```bash
bun -e '
const fs = require("fs");
const p = "/tmp/corrupt.json";
const rows = require("./docs/data/prerelease-classes-2026-08.json");
rows[0].overview = rows[0].overview.replace("You are", "You were");
fs.writeFileSync(p, JSON.stringify(rows));
' && bun run scripts/verify-prerelease-extract.mjs /home/dave/Downloads/Current_Pre-Release_Classes__Aug__2026_.pdf /tmp/corrupt.json; echo "exit=$?"
```

Expected: non-zero exit, reporting `missing: are x1` and `extra: were x1` for Beastmaster. **If this passes, the harness is broken — stop and fix it before continuing.**

- [ ] **Step 3: Run the harness for real**

```bash
bun run scripts/verify-prerelease-extract.mjs \
  /home/dave/Downloads/Current_Pre-Release_Classes__Aug__2026_.pdf \
  docs/data/prerelease-classes-2026-08.json
```

Expected: `19/19 classes verified, 0 token differences`. Any diff means the extractor lost or mangled text — fix the extractor, never the artifact by hand.

- [ ] **Step 4: Eyeball one class end to end**

Open `/tmp/prerelease-review/Beastmaster.txt` beside PDF pages 3-5 and confirm field assignment reads correctly (the harness proves no token was altered; this confirms tokens landed in the *right* fields).

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-prerelease-extract.mjs
git commit -m "feat: verify extracted class text matches the source PDF token for token"
```

---

## Part B — Schema

### Task 8: Structured content migration

**Files:**
- Create: `supabase/migrations/20260902000000_class_structured_content.sql`
- Test: `util/class-structured-columns.integration.test.js`
- Modify: `scripts/run-tests.mjs` (add to `integrationFiles`)

**Interfaces:**
- Produces: the columns named in the spec's data-model table, on `public.classes`.

- [ ] **Step 1: Write the failing integration test**

```js
// util/class-structured-columns.integration.test.js
// Requires the local Supabase stack: SUPABASE_URL=http://127.0.0.1:54321
const { test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

test('classes carries the structured pre-release columns', async () => {
  const { data, error } = await sb.from('classes')
    .select('challenge_level,stat_line,stat_note,quote,quote_source,overview,conduit_notes,grounding,examples_heading,examples,tips_heading,designer,prerelease_section')
    .limit(1);
  expect(error).toBeNull();
  expect(Array.isArray(data)).toBe(true);
});

test('challenge_level rejects a value outside Low/Mid/High', async () => {
  const { error } = await sb.from('classes')
    .update({ challenge_level: 'Extreme' })
    .eq('name', 'Beastmaster');
  expect(error).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:integration`
Expected: FAIL — PostgREST reports the columns do not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260902000000_class_structured_content.sql
-- The pre-release bundle carries far more per-class structure than three
-- markdown blobs can hold. These columns are the fields the document actually
-- prints; ability and signature metadata rides in the existing JSONB arrays.
ALTER TABLE public.classes
    ADD COLUMN IF NOT EXISTS challenge_level    text,
    ADD COLUMN IF NOT EXISTS stat_line          text,
    ADD COLUMN IF NOT EXISTS stat_note          text,
    ADD COLUMN IF NOT EXISTS quote              text,
    ADD COLUMN IF NOT EXISTS quote_source       text,
    ADD COLUMN IF NOT EXISTS overview           text,
    ADD COLUMN IF NOT EXISTS conduit_notes      text,
    ADD COLUMN IF NOT EXISTS grounding          text,
    ADD COLUMN IF NOT EXISTS examples_heading   text,
    ADD COLUMN IF NOT EXISTS examples           jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS tips_heading       text,
    ADD COLUMN IF NOT EXISTS designer           text,
    ADD COLUMN IF NOT EXISTS prerelease_section text;

ALTER TABLE public.classes
    DROP CONSTRAINT IF EXISTS classes_challenge_level_check;
ALTER TABLE public.classes
    ADD CONSTRAINT classes_challenge_level_check
    CHECK (challenge_level IS NULL OR challenge_level IN ('Low', 'Mid', 'High'));

ALTER TABLE public.classes
    DROP CONSTRAINT IF EXISTS classes_prerelease_section_check;
ALTER TABLE public.classes
    ADD CONSTRAINT classes_prerelease_section_check
    CHECK (prerelease_section IS NULL OR prerelease_section IN ('pcc', 'exclusive', 'aspirant'));

-- Per-character ability metadata that nothing has ever read or written: a grep
-- for essence_cost across routes/ models/ services/ util/ views/ public/
-- returns no hits. The class-level `meters` array supersedes it and carries all
-- 49 labels the document uses, not three.
ALTER TABLE public.class_abilities
    DROP COLUMN IF EXISTS essence_cost,
    DROP COLUMN IF EXISTS cooldown,
    DROP COLUMN IF EXISTS duration;
```

- [ ] **Step 4: Apply and verify**

```bash
supabase db reset && bun run scripts/seed-local.mjs
sed -i "s#'util/core-roster.integration.test.js'#'util/core-roster.integration.test.js',\n  'util/class-structured-columns.integration.test.js'#" scripts/run-tests.mjs
bun run test:integration
```

Expected: PASS. Then `bun run test:unit` — expected PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260902000000_class_structured_content.sql \
        util/class-structured-columns.integration.test.js scripts/run-tests.mjs
git commit -m "feat: add structured pre-release content columns to classes"
```

---

## Part C — Load

### Task 9: Witchhunter → Witchfinder rename in name-keyed code

**Files:**
- Modify: `util/enclave-consts.js:267-274` and its `classStatSpread` entry
- Modify: `util/starter-content.js:12-30`
- Test: `util/seed-classes.test.js`

The class UUID `79721ac8-378e-4b3e-b1e3-8266689da89e` does not change, so book grants and unlock families are unaffected. Two name-keyed lookups are.

**Interfaces:**
- Produces: `aspirantPreviewClassList` containing `'Witchfinder'`; `CORE_CLASS_UNLOCKS.aspirant.Witchfinder` holding the unchanged UUID.

- [ ] **Step 1: Write the failing test**

```js
// append to util/seed-classes.test.js
const { buildHardcodedClasses } = require('./seed-classes');
const { CORE_CLASS_UNLOCKS } = require('./starter-content');

test('the Aspirant roster names Witchfinder and keeps its class id', () => {
  expect(CORE_CLASS_UNLOCKS.aspirant.Witchfinder)
    .toBe('79721ac8-378e-4b3e-b1e3-8266689da89e');
  expect(CORE_CLASS_UNLOCKS.aspirant.Witchhunter).toBeUndefined();
});

test('the seeded Witchfinder row lands on the roster id', () => {
  const row = buildHardcodedClasses().find(c => c.name === 'Witchfinder');
  expect(row.id).toBe('79721ac8-378e-4b3e-b1e3-8266689da89e');
  expect(row.rules_edition).toBe('aspirant');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test util/seed-classes.test.js`
Expected: FAIL — `CORE_CLASS_UNLOCKS.aspirant.Witchfinder` is `undefined`.

- [ ] **Step 3: Rename**

```bash
sed -i "s/'Witchhunter'/'Witchfinder'/g; s/^  Witchhunter:/  Witchfinder:/" util/enclave-consts.js
sed -i "s/Witchhunter:/Witchfinder:/; s/-- Witchhunter/-- Witchfinder/" util/starter-content.js
grep -rn "Witchhunter" util/ models/ routes/ services/ views/ scripts/
```

Expected from the grep: only the historical comment in `supabase/migrations/20260818000000_retag_aspirant_classes.sql`, which is a record of what ran and is left alone.

- [ ] **Step 4: Run the tests**

Run: `bun test util/seed-classes.test.js && bun run test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add util/enclave-consts.js util/starter-content.js util/seed-classes.test.js
git commit -m "refactor: rename Witchhunter to Witchfinder across name-keyed lookups"
```

---

### Task 10: Loader script

**Files:**
- Create: `scripts/load-prerelease-classes.mjs`

**Interfaces:**
- Consumes: `docs/data/prerelease-classes-2026-08.json`.
- Produces: CLI `bun run scripts/load-prerelease-classes.mjs [--apply]`. Default is dry-run: prints a per-field diff and writes nothing.

Name resolution against the live DB, with the two spelling changes the document makes:

| Document name | DB match | Note |
|---|---|---|
| Shōnen | `Shonen` | match on diacritic-folded name; `name` is updated to the document's spelling |
| Zoologist | `Zoologist ` | **production stores it with a trailing space** — matching must trim, or this resolves as a spurious CREATE |
| Witchfinder | `Witchhunter` | explicit alias; the row keeps its UUID and `rules_edition = 'aspirant'` |
| Ardent, Offdriver, Squire | — | created; `is_public` left `false` |
| Drachentöter | `Drachentöter` | exists with stub content and `is_public = false`; content filled, flag untouched |
| the other 12 | exact | overwritten in place |

- [ ] **Step 1: Write the loader**

```js
// scripts/load-prerelease-classes.mjs
// Idempotent: re-running writes the same rows. Dry-run by default -- --apply
// is the only thing that writes.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const ALIASES = { 'Witchfinder': 'Witchhunter' };
const fold = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const FIELDS = ['name', 'challenge_level', 'stat_line', 'stat_note', 'quote', 'quote_source',
    'overview', 'conduit_notes', 'grounding', 'examples_heading', 'examples', 'tips_heading',
    'tips', 'designer', 'prerelease_section', 'stat_spread', 'abilities', 'gear'];
```

Per record: resolve the target row (alias first, then folded-name match), **abort the whole run if a name resolves to more than one row**, build the payload from `FIELDS`, diff against the current row, print the diff, and write only under `--apply`. `is_public`, `status`, `rules_edition`, `rules_version`, `teaser`, `image_url`, `image_crop` and `base_class_id` are never in the payload.

`tips` is written as the joined bullet list (one `- ` item per bullet) so the existing markdown renderer keeps working; `examples` is written as the JSON array.

- [ ] **Step 2: Dry-run against local**

```bash
bun run scripts/load-prerelease-classes.mjs
```

Expected: a per-class diff, `19 classes resolved (16 update, 3 create)`, `DRY RUN - nothing written`. Verified against a 2026-09-02 production copy: 16 update, 3 create (Ardent, Offdriver, Squire), 0 ambiguous, with three name corrections — `Shonen`→`Shōnen`, `Zoologist `→`Zoologist`, `Witchhunter`→`Witchfinder`.

- [ ] **Step 3: Apply to local**

```bash
bun run scripts/load-prerelease-classes.mjs --apply
```

Expected: `19 classes written`.

- [ ] **Step 4: Verify the round trip**

```bash
bun run scripts/load-prerelease-classes.mjs
```

Expected: `no changes` for all 19 — proving the loader is idempotent and that what was written reads back identically.

- [ ] **Step 5: Commit**

```bash
git add scripts/load-prerelease-classes.mjs
git commit -m "feat: load extracted pre-release classes into the classes table"
```

---

### Task 10a: Character-impact pre-flight report

**Files:**
- Create: `scripts/report-character-impact.mjs`

**Interfaces:**
- Consumes: `docs/data/prerelease-classes-2026-08.json`; the live `classes`, `class_abilities`, `class_gear` and `character_perks` tables.
- Produces: a report naming every item name that would exist in **no** class after the import, the character rows holding it, and the perks hanging off it. Exit code 1 while any unremapped name remains.

Why this exists: editing a class touches no character row, but the next save of an affected character runs `save_character_atomic`, which deletes and reinserts all its `class_abilities`/`class_gear` rows. Before that delete, `services/character/service.js:284-302` resolves each submitted name through `buildClassContentLookupMaps` (`models/class.js:457-504`) — a **global, name-only map over every public class**. A name in no class raises `Missing class_id for ability "X"` and the whole save fails. The edit form re-offers the stale name (`routes/characters.js:382-393`), so the user submits it in good faith and the save dies.

Measured against a 2026-09-02 production copy restored locally: **14 names vanish, 53 rows carry one (20 ability, 33 gear), 43 characters become unsaveable, 2 ability perks are attached.** The 14 are `Furor`, `Great Axe`, `Derive`, `Sportwear`, `Action Camera`, `Drink the Ichor:`, `Flask of Mead`, `Disassemblinator`, `Orbuclum`, `Animal Crackers`, `Toolbox`, `Alter Lights`, `A Good Cause`, `Unverwüstlich (OON - fer - VOOST - leek)`. Renames whose name still exists somewhere in the catalogue are survivable — the row still renders, it only loses the description merge at `services/character/repository.js:100-111`.

- [ ] **Step 1: Write the report script**

For each `class_abilities` / `class_gear` row whose `class_id` is one of the 19 imported classes, check whether `name` appears in the post-import catalogue — that is, in the incoming class's `abilities`/`gear`, or in any class the import does not touch (the map is global, so surviving elsewhere is enough). Group the misses by class and print rows, distinct characters, and attached perks.

- [ ] **Step 2: Run it against local**

```bash
bun run scripts/report-character-impact.mjs
```

Expected: the vanishing-name list. On a freshly seeded local DB with no characters this is empty — that is not a pass. Run it against a database that has characters (a restored production dump, or after `bun run scripts/seed-local.mjs` plus a few characters) so the query is genuinely exercised.

- [ ] **Step 3: Verify it fails loudly**

Confirm the script exits non-zero while any name is unmapped, and that the count matches a hand-check of one class:

```bash
bun run scripts/report-character-impact.mjs; echo "exit=$?"
```

Expected: `exit=1` with the list printed.

- [ ] **Step 4: CHECKPOINT — take the list to the owner**

For each vanishing name, print the incoming class's item that occupies the same slot, as a *proposed* pairing. **Do not apply these.** Which new ability replaces which old one is a content judgement, and the plan's verbatim rule means it is not the implementer's to make. The owner confirms or corrects each pairing before Task 10b.

Known from inspection: Berserker `Furor` → `Froth at the Mouth`, Berserker `Great Axe` → `Battle Axe`. The other twelve come out of this step.

- [ ] **Step 5: Commit**

```bash
git add scripts/report-character-impact.mjs
git commit -m "feat: report characters holding class items the import would remove"
```

---

### Task 10b: Name remap

**Files:**
- Create: `docs/data/prerelease-name-remap.json`
- Modify: `scripts/load-prerelease-classes.mjs`

**Interfaces:**
- Consumes: the owner-confirmed pairings from Task 10a Step 4.
- Produces: `docs/data/prerelease-name-remap.json` as `[{ class_id, kind: 'ability'|'gear', from, to }]`, and a loader that applies the matching `UPDATE`s under `--apply`.

- [ ] **Step 1: Write the failing check**

Add to `scripts/load-prerelease-classes.mjs` a pre-write assertion: every name reported by Task 10a must have a remap entry, or the run aborts before writing anything.

```bash
bun run scripts/load-prerelease-classes.mjs --apply
```

Expected: `refusing to load: 14 character-visible names have no remap entry`.

- [ ] **Step 2: Record the confirmed pairings**

Write `docs/data/prerelease-name-remap.json` from the owner's Step 4 confirmations. One entry per vanishing name. This file is committed — it is the audit trail for every character row the import rewrites.

- [ ] **Step 3: Apply class content and remaps together**

Under `--apply`, after writing the class rows, run one `UPDATE` per entry:

```sql
UPDATE class_abilities SET name = $to WHERE class_id = $class_id AND name = $from;
UPDATE class_gear      SET name = $to WHERE class_id = $class_id AND name = $from;
```

Row ids are preserved, so `character_perks.class_ability_id` keeps resolving and the two attached perks survive. Print the affected row count per entry.

- [ ] **Step 4: Verify the report is now clean**

```bash
bun run scripts/report-character-impact.mjs; echo "exit=$?"
```

Expected: an empty vanishing-names table. The exit code is still `1` — the
report also lists the pre-existing `Agent’s Fieldcoat` / `Neuralyzer` pair on
Fortean, which no remap touches — so read the tables, not the exit code. See
Task 18 Step 2c.

- [ ] **Step 5: Commit**

```bash
git add docs/data/prerelease-name-remap.json scripts/load-prerelease-classes.mjs
git commit -m "feat: remap character ability and gear names the import renames"
```

---

## Part D — Rendering

### Task 11: Meters and notes partials

**Files:**
- Create: `views/partials/class-meters.handlebars`
- Create: `views/partials/class-notes.handlebars`
- Test: `views/class-view.test.js`

**Interfaces:**
- Consumes: `meters` and `notes` as shaped in Task 6.
- Produces: partials invoked as `{{> class-meters meters=this.meters}}` and `{{> class-notes notes=this.notes}}`.

- [ ] **Step 1: Write the failing test**

```js
// append to views/class-view.test.js
test('renders meter labels and values as a definition list', async () => {
  const html = await renderClassView({
    abilities: [{ name: 'Collar', description: 'd', paired_action: 'p',
      meters: [{ label: 'Essence Cost', value: 'Low' }, { label: 'Duration', value: 'Low–High' }],
      notes: [] }],
    gear: [],
  });
  expect(html).toContain('Essence Cost');
  expect(html).toContain('Low–High');
});

test('renders sub-notes nested inside their parent note', async () => {
  const html = await renderClassView({
    abilities: [{ name: 'Collar', description: 'd', paired_action: 'p', meters: [],
      notes: [{ text: 'Parent note.', children: [{ text: 'Child note.', children: [] }] }] }],
    gear: [],
  });
  expect(html).toMatch(/Parent note\.[\s\S]*<ul>[\s\S]*Child note\./);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test views/class-view.test.js`
Expected: FAIL — the meter and note text is absent.

- [ ] **Step 3: Write the partials**

```handlebars
{{!-- views/partials/class-meters.handlebars --}}
{{#if meters.length}}
<dl class="class-meters">
  {{#each meters}}
  <div class="class-meters__row">
    <dt class="has-text-weight-semibold">{{this.label}}</dt>
    <dd><span class="tag is-light">{{this.value}}</span></dd>
  </div>
  {{/each}}
</dl>
{{/if}}
```

```handlebars
{{!-- views/partials/class-notes.handlebars --}}
{{#if notes.length}}
<ul>
  {{#each notes}}
  <li>
    {{this.text}}
    {{#if this.children.length}}
    <ul>
      {{#each this.children}}<li>{{this.text}}</li>{{/each}}
    </ul>
    {{/if}}
  </li>
  {{/each}}
</ul>
{{/if}}
```

Note both use `{{ }}`, not `{{{ }}}`: this text is transcribed prose, not markdown, and must be HTML-escaped.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test views/class-view.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add views/partials/class-meters.handlebars views/partials/class-notes.handlebars views/class-view.test.js
git commit -m "feat: add class meter and note partials"
```

---

### Task 12: Class view renders abilities and gear structurally

**Files:**
- Modify: `views/class-view.handlebars:183,200` (gear split) and `:223-232` (ability cards)
- Test: `views/class-view.test.js`

**Interfaces:**
- Consumes: the partials from Task 11.
- Produces: gear split by `category` rather than by array position.

- [ ] **Step 1: Write the failing test**

```js
test('splits gear by category, not by array position', async () => {
  const html = await renderClassView({
    abilities: [],
    gear: [
      { name: 'Elective First', description: 'e', category: 'elective', meters: [], notes: [] },
      { name: 'Base Second', description: 'b', category: 'default', meters: [], notes: [] },
    ],
  });
  const baseIdx = html.indexOf('Base Gear');
  const electiveIdx = html.indexOf('Elective Gear');
  expect(html.indexOf('Base Second')).toBeGreaterThan(baseIdx);
  expect(html.indexOf('Base Second')).toBeLessThan(electiveIdx);
});

test('renders an ability paired action', async () => {
  const html = await renderClassView({
    abilities: [{ name: 'Collar', description: 'd', paired_action: 'Call a cowed animal to heel.', meters: [], notes: [] }],
    gear: [],
  });
  expect(html).toContain('Paired Action');
  expect(html).toContain('Call a cowed animal to heel.');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test views/class-view.test.js`
Expected: FAIL — positional `first`/`last` puts `Elective First` in the Base column; no paired action is rendered.

- [ ] **Step 3: Update the template**

Replace `{{#each (first class.gear 3) as |gear|}}` with `{{#each (filterBy class.gear 'category' 'default') as |gear|}}` and the `last` variant with `'elective'`, register a `filterBy` helper in `util/handlebars.js`, and inside each gear card add:

```handlebars
{{> class-meters meters=gear.meters}}
{{> class-notes notes=gear.notes}}
```

Rewrite the ability card body:

```handlebars
<h4 class="title is-4">{{this.name}}</h4>
<p>{{this.description}}</p>
{{> class-meters meters=this.meters}}
{{#if this.paired_action}}
<p><strong>Paired Action:</strong> {{this.paired_action}}</p>
{{/if}}
{{> class-notes notes=this.notes}}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test views/class-view.test.js && bun run test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add views/class-view.handlebars util/handlebars.js views/class-view.test.js
git commit -m "feat: render class abilities and gear from structured metadata"
```

---

### Task 13: Class view renders structured prose; retire `description`

**Files:**
- Modify: `views/class-view.handlebars:106`
- Modify: `routes/classes.js:407-411` (OpenGraph), `routes/characters.js:204-206` (wizard payload)
- Modify: `util/class-export.js:158-176`, `util/class-import.js:12-34`, `models/class.js` (`serializeClassForAgent`)
- Create: `supabase/migrations/20260902000001_drop_class_description.sql`
- Test: `views/class-view.test.js`, `util/class-export.test.js`, `routes/open-graph.test.js`

**Interfaces:**
- Produces: no reader of `classes.description` remains; the column is dropped.

- [ ] **Step 1: Write the failing test**

```js
test('renders the structured prose parts instead of a description blob', async () => {
  const html = await renderClassView({
    stat_line: '+Sensory, +Skill, +Vitality*',
    quote: 'Better to have beasts that let themselves be killed than men who run away.',
    quote_source: 'Jean-Paul Sartre',
    overview: 'You are a domineering animal tamer.',
    conduit_notes: 'Conduits designing a mission for you should try to ensure there are some workable animals available.',
    grounding: 'Grounded in tropes surrounding animal handlers.',
    examples_heading: 'Examples from history and pop culture include:',
    examples: ['Siegfried & Roy', 'Rexxar (Warcraft)'],
    challenge_level: 'Mid',
    designer: 'Reece C. Downie',
    abilities: [], gear: [],
  });
  expect(html).toContain('+Sensory, +Skill, +Vitality*');
  expect(html).toContain('Jean-Paul Sartre');
  expect(html).toContain('Examples from history and pop culture include:');
  expect(html).toContain('Siegfried &amp; Roy');
  expect(html).toContain('Challenge Level');
  expect(html).toContain('Reece C. Downie');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test views/class-view.test.js`
Expected: FAIL — none of that text is rendered.

- [ ] **Step 3: Replace the description block**

At `views/class-view.handlebars:106`, swap `<p>{{{markdown class.description}}}</p>` for the parts, in printed order: stat line, stat note, quote + source, overview, conduit notes, grounding, examples heading + list, then a Challenge Level tag and the designer credit. Escape everything (`{{ }}`).

Then migrate the three remaining readers:
- `routes/classes.js:407-411` — OpenGraph description falls back `teaser` → `overview`.
- `routes/characters.js:204-206` — replace `description_html: renderMarkdown(c.description)` with the structured fields the wizard needs (`overview`, `tips_html`).
- `util/class-export.js` and `util/class-import.js` — swap `description` for the structured field list; `models/class.js` `serializeClassForAgent` likewise.

- [ ] **Step 4: Run tests, then drop the column**

```bash
bun run test:unit && bun run test:http
grep -rn "\.description" routes/ models/ services/ util/ views/ | grep -i class
```

Expected: no remaining `class.description` reads. Then:

```sql
-- supabase/migrations/20260902000001_drop_class_description.sql
-- The prose this held now lives in quote/overview/conduit_notes/grounding/
-- examples. Keeping an assembled copy beside them would drift the first time
-- an admin edited one and not the other.
ALTER TABLE public.classes DROP COLUMN IF EXISTS description;
```

```bash
supabase db reset && bun run scripts/seed-local.mjs && bun run scripts/load-prerelease-classes.mjs --apply
bun run test:unit && bun run test:http && bun run test:integration
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add views/class-view.handlebars routes/classes.js routes/characters.js \
        util/class-export.js util/class-import.js models/class.js \
        supabase/migrations/20260902000001_drop_class_description.sql \
        views/class-view.test.js util/class-export.test.js routes/open-graph.test.js
git commit -m "feat: render structured class prose and drop the description column"
```

---

## Part E — Admin editing UI

### Task 14: Form fields and parsing for the class-level scalars

**Files:**
- Modify: `views/class-form.handlebars` (replace the Description textarea block)
- Modify: `routes/classes.js` POST `:605` and PUT `:687`
- Test: `routes/classes-structured-fields.test.js`
- Modify: `scripts/run-tests.mjs` (`httpFiles`)

**Interfaces:**
- Produces: `parseExamples(body) => string[]` in `routes/classes.js`, splitting the `examples` textarea on newlines and dropping blank lines.

- [ ] **Step 1: Write the failing test**

Model it on `routes/classes-stat-spread.test.js` (real `isAuthenticated` + real handler over a mocked data layer), asserting that a POST carrying `challenge_level`, `stat_line`, `quote`, `quote_source`, `overview`, `conduit_notes`, `grounding`, `examples_heading`, `examples`, `tips_heading`, `designer` and `prerelease_section` reaches `createClass` with `examples` as an array of trimmed strings and every scalar passed through unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test routes/classes-structured-fields.test.js`
Expected: FAIL — `examples` arrives as a raw newline string.

- [ ] **Step 3: Add the fields and the parser**

Add `parseExamples` beside `parseStatSpread` at `routes/classes.js:57`, call it in both handlers, and add the inputs to the form: a `challenge_level` select (`Low`/`Mid`/`High`), a `prerelease_section` select, text inputs for `stat_line`, `stat_note`, `quote`, `quote_source`, `examples_heading`, `tips_heading`, `designer`, and textareas for `overview`, `conduit_notes`, `grounding`, `examples`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test routes/classes-structured-fields.test.js && bun run test:http`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add views/class-form.handlebars routes/classes.js routes/classes-structured-fields.test.js scripts/run-tests.mjs
git commit -m "feat: edit structured class fields from the admin form"
```

---

### Task 15: Repeatable ability editor

**Files:**
- Modify: `views/class-form.handlebars` (ability block)
- Modify: `public/js/alpine-components.js`
- Modify: `routes/classes.js` POST/PUT ability parsing
- Test: `routes/classes-structured-fields.test.js`

Express is configured with `express.urlencoded({ extended: true })` (`app.js:38`), so `qs` bracket notation arrives already nested. Field names are therefore `abilities[0][name]`, `abilities[0][meters][0][label]`, `abilities[0][notes][0][children][0][text]`, and the handler's job is normalization, not parsing.

**Interfaces:**
- Produces: `normalizeAbilities(body.abilities) => [{ name, description, paired_action, meters, notes }]` — object-with-numeric-keys or array input both accepted (qs switches shape past 20 entries), blank rows dropped, `children` always an array.

- [ ] **Step 1: Write the failing test**

```js
test('accepts nested ability metadata from the form', async () => {
  const res = await post('/classes', {
    name: 'Test', 'abilities[0][name]': 'Collar',
    'abilities[0][description]': 'Conjure a magical ring.',
    'abilities[0][paired_action]': 'Call a cowed animal to heel.',
    'abilities[0][meters][0][label]': 'Essence Cost',
    'abilities[0][meters][0][value]': 'Low',
    'abilities[0][notes][0][text]': 'Duration scales on intimidation.',
    'abilities[0][notes][0][children][0][text]': 'Ends early if the collar is destroyed.',
  });
  expect(res.status).toBe(200);
  expect(capturedCreate.abilities).toEqual([{
    name: 'Collar',
    description: 'Conjure a magical ring.',
    paired_action: 'Call a cowed animal to heel.',
    meters: [{ label: 'Essence Cost', value: 'Low' }],
    notes: [{ text: 'Duration scales on intimidation.',
             children: [{ text: 'Ends early if the collar is destroyed.', children: [] }] }],
  }]);
});

test('drops a meter row whose label is blank', async () => {
  await post('/classes', {
    name: 'Test', 'abilities[0][name]': 'Collar',
    'abilities[0][meters][0][label]': '', 'abilities[0][meters][0][value]': 'Low',
  });
  expect(capturedCreate.abilities[0].meters).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test routes/classes-structured-fields.test.js`
Expected: FAIL — the handler still builds abilities from `ability_name[]`.

- [ ] **Step 3: Replace the parsing and the form block**

Delete the `ability_name[]` / `ability_description[]` construction at `routes/classes.js:613-626` and its PUT twin, replacing both with `normalizeAbilities(req.body.abilities)`. Per the repo's no-dead-code rule the old flat path is removed, not kept alongside.

Register an `abilityEditor` Alpine component in `public/js/alpine-components.js` seeded from `{{json class.abilities}}`, with add/remove for abilities, meter rows and notes (and sub-notes), rendering the bracket-named inputs above via `x-for` with the index in the name.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test routes/classes-structured-fields.test.js && bun run test:http`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add views/class-form.handlebars public/js/alpine-components.js routes/classes.js routes/classes-structured-fields.test.js
git commit -m "feat: edit ability meters, paired actions and notes in the admin form"
```

---

### Task 16: Repeatable gear editor

**Files:**
- Modify: `views/class-form.handlebars` (gear block)
- Modify: `public/js/alpine-components.js`
- Modify: `routes/classes.js` POST/PUT gear parsing
- Test: `routes/classes-structured-fields.test.js`

**Interfaces:**
- Produces: `normalizeGear(body.gear) => [{ name, description, category, meters, notes }]`; `category` defaults to `'default'` for the first three entries and `'elective'` thereafter when absent, so a legacy row without categories still splits correctly.

- [ ] **Step 1: Write the failing test**

```js
test('accepts gear category and metadata from the form', async () => {
  await post('/classes', {
    name: 'Test',
    'gear[0][name]': 'Fearsome Visage', 'gear[0][category]': 'default',
    'gear[0][meters][0][label]': 'Accuracy Boost', 'gear[0][meters][0][value]': 'Mid',
  });
  expect(capturedCreate.gear[0].category).toBe('default');
  expect(capturedCreate.gear[0].meters).toEqual([{ label: 'Accuracy Boost', value: 'Mid' }]);
});

test('defaults the first three gear entries to default and the rest to elective', async () => {
  const body = { name: 'Test' };
  for (let i = 0; i < 6; i++) body[`gear[${i}][name]`] = `G${i}`;
  await post('/classes', body);
  expect(capturedCreate.gear.map(g => g.category))
    .toEqual(['default', 'default', 'default', 'elective', 'elective', 'elective']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test routes/classes-structured-fields.test.js`
Expected: FAIL — `category` is undefined.

- [ ] **Step 3: Replace the parsing and the form block**

Mirror Task 15: delete the `gear_name[]` / `gear_description[]` construction at `routes/classes.js:628-640` and its PUT twin, add `normalizeGear`, and add a `gearEditor` Alpine component with a category select per row.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test routes/classes-structured-fields.test.js && bun run test:http && bun run test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add views/class-form.handlebars public/js/alpine-components.js routes/classes.js routes/classes-structured-fields.test.js
git commit -m "feat: edit gear category, meters and notes in the admin form"
```

---

### Task 17: Round-trip guard

**Files:**
- Test: `routes/classes-structured-fields.test.js`
- Modify: `util/class-export.js`, `util/class-import.js` if the guard fails

The failure this prevents is the one identified in the spec: an admin opens a class, saves it unchanged, and the metadata is silently gone.

- [ ] **Step 1: Write the failing test**

```js
test('saving a class unchanged preserves every metadata field', async () => {
  const original = require('../docs/data/prerelease-classes-2026-08.json')
    .find(c => c.name === 'Beastmaster');
  const rendered = await renderClassForm({ class: original });
  const submitted = formValuesFrom(rendered);   // serialize the form as a browser would
  await put(`/classes/${original.id}`, submitted);
  expect(capturedUpdate.abilities).toEqual(original.abilities);
  expect(capturedUpdate.gear).toEqual(original.gear);
  expect(capturedUpdate.examples).toEqual(original.examples);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test routes/classes-structured-fields.test.js`
Expected: FAIL on whichever field the form does not yet round-trip.

- [ ] **Step 3: Fix the gaps**

Add any missing input to the form or missing key to the zod schemas in `util/class-import.js:12-34` and the projection in `util/class-export.js:158-176`.

- [ ] **Step 4: Run the full suite**

Run: `bun run test:unit && bun run test:http && bun run test:integration`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add routes/classes-structured-fields.test.js util/class-export.js util/class-import.js views/class-form.handlebars
git commit -m "test: guard class metadata against a no-op admin save"
```

---

### Task 17a: Character content integrity guard

**Files:**
- Create: `util/character-content-integrity.integration.test.js`
- Modify: `scripts/run-tests.mjs` (`integrationFiles`)

Nothing in the suite currently pins what happens when a class's item names change while characters reference the old ones — that is why this went unnoticed until now.

**Interfaces:**
- Consumes: the live local database after a load.

- [ ] **Step 1: Write the failing test**

```js
// util/character-content-integrity.integration.test.js
// Every character's stored ability and gear names must still resolve somewhere
// in the public catalogue. They are resolved by a GLOBAL name-only map at save
// time (models/class.js buildClassContentLookupMaps), and an unresolvable name
// makes save_character_atomic throw -- the character becomes unsaveable.
const { test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

test('no character references a class item name that no longer exists', async () => {
  const { data: classes } = await sb.from('classes').select('id,abilities,gear').eq('is_public', true);
  const known = new Set();
  for (const c of classes) {
    for (const a of c.abilities || []) known.add(String(a.name).trim());
    for (const g of c.gear || []) known.add(String(g.name).trim());
  }
  for (const table of ['class_abilities', 'class_gear']) {
    const { data: rows } = await sb.from(table).select('name,character_id');
    const orphans = rows.filter(r => !known.has(String(r.name).trim()));
    expect(orphans.map(o => o.name)).toEqual([]);
  }
});
```

- [ ] **Step 2: Run it before the remap to confirm it catches the problem**

Load class content without applying remaps, then:

Run: `bun run test:integration`
Expected: FAIL, listing the orphaned names. **A test that passes here is not testing anything** — confirm it fails first.

- [ ] **Step 3: Apply the remap**

```bash
bun run scripts/load-prerelease-classes.mjs --apply
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test:integration`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add util/character-content-integrity.integration.test.js scripts/run-tests.mjs
git commit -m "test: guard character item names against class content changes"
```

---

## Part F — Production

### Task 18: Production load

**Files:** none modified.

**Sequencing: Steps 2 to 4 are one maintenance window.** Three things have to
land -- the migrations, the code deploy, and the loader run -- and every gap
between them costs something. The order is: `db push` (Step 2), deploy
immediately (Step 2a), loader `--apply` (Step 4). Do not pause between them.

**Migrations before the deploy, and the deploy right behind them.** Both orders
have a bad window; this one's is shorter and self-limiting.

- *If you push and do not deploy:* the code still running is `main`, whose class
  form posts a `required` `description` field
  (`views/class-form.handlebars:87` on `main`) and whose write handler passes the
  body to the repository with no column allowlist. `20260904000002` has just
  dropped that column, so **every admin class save fails** until the deploy lands
  -- PostgREST rejects the insert on a column that no longer exists. The agent
  serializer (`models/class.js:345` on `main`) also starts sending an empty
  `description` for every class. The window is exactly as long as you take to
  deploy, which is why this is the order to use.
- *If you deploy and do not push:* the new code reads the structured columns.
  They do not exist yet, so **class saves fail against missing columns** and
  `/classes` pages render prose-blank -- the new view reads `overview`, and
  nothing has backfilled it. This window does not close on its own; it closes
  when somebody remembers to push, which is the failure mode the ordering above
  avoids.

**The loader in the same window (Witchhunter -> Witchfinder).** This rename
lands on both sides of the branch, but not at the same moment.
`util/enclave-consts.js` (`classGearList`, `classAbilityList`,
`aspirantPreviewClassList`, `classStatSpread`) and `util/starter-content.js`
(`CORE_CLASS_UNLOCKS.aspirant`) are already rekeyed to `Witchfinder` in the code;
production's `classes` row is still named `Witchhunter` until the loader renames
it at Step 4. In the gap between the deploy and that step:

- A character sheet that says **Witchfinder** fails to import at all --
  `resolveClassIdByName` (`util/character-import.js:53`) finds no row of that
  name and the import throws `Unknown class "Witchfinder"`.
- A sheet that says **Witchhunter** imports, but `util/character-import.js:124`
  reads `classAbilityList[characterData.class]`, misses, and the character
  arrives with no class abilities. The player has to add them by hand.
- The missions prompt offers a class name the database does not have.
- `/library` labels the unlock `Witchfinder` while `/classes` still shows
  `Witchhunter` -- one class under two names on two pages.

Nothing in that last group is destructive and all of it self-heals the moment
Step 4 applies, so its cost is exactly the length of the gap, paid by anyone
importing or reading a Witchhunter/Witchfinder in it. The migration/deploy gap
above is not so forgiving: it breaks writes outright. Push, deploy and load in
one sitting; do not push on a Friday and finish on Monday.

- [ ] **Step 1: Back up production**

Point `SUPABASE_URL`, `SUPABASE_DB_PASS` and `SUPABASE_DB_REGION` at the hosted project, then:

```bash
bun run db:backup
```

Expected: `Backup saved to backups/backup-<stamp>.dump` with a non-zero archive-entry count. **Do not continue without this.**

- [ ] **Step 2: Apply the migrations**

```bash
supabase link --project-ref=<ref>
supabase db push
```

Expected: these **four** migrations applied, in this order:

| Migration | What it does |
| --- | --- |
| `20260904000000_class_structured_content.sql` | Adds the 13 structured prose columns and drops the three dead `class_abilities` columns |
| `20260904000001_backfill_gear_category.sql` | Writes `gear[].category` positionally onto the pre-existing classes |
| `20260904000002_drop_class_description.sql` | Copies `description` into `overview` where `overview` is NULL, then drops `classes.description` and recreates `dup_class` without it |
| `20260904000003_repair_image_crop.sql` | Repairs `image_crop` values stored as a jsonb string on `classes`, `characters` and `profiles` |

The backfill in the third one is the step with a countable result: on a fresh
apply it writes **47 rows** -- every class that predates this branch, all of
which carry a non-empty `description` and no structured prose. 19 of those 47
are overwritten later, at Step 4, when the loader writes real structured prose
over them; the other 28 keep the backfilled text as their whole class page.
It skips any row that already has an `overview`, so re-running the migration
writes nothing.

`20260904000003` prints one NOTICE per table -- *"N cleared to NULL, N crops
recovered, N unreadable nulled, N left alone"*. **Read them.** Locally the
figures are 13/4/0/0 on `classes` and 113/10/2/0 on `characters`; production will
differ, and only the last number is a gate. Anything in *left alone* is an
`image_crop` holding something that is not JSON at all -- a shape nobody has
seen, which the migration deliberately refuses to guess at. It is not a rollout
blocker, but note the ids it prints and hand them back.

`db push` also carries any earlier migration production has not yet seen (the
two `20260903*` whitespace ones, if they have not gone up) -- those sort before
these and are not this branch's. **Read the applied list and confirm all four
`20260904*` names are in it.** A partial push leaves the code you are about to
deploy reading columns that are not there; stop and fix it before Step 2a rather
than deploying on top of it.

- [ ] **Step 2a: Deploy the code**

Immediately after the push, by whatever route this project deploys. See the
sequencing note at the top of this task: from the moment `20260904000002` lands
until this step completes, an admin saving a class on the old code gets a
failure, because the form it is serving still posts the `description` column the
migration just dropped. Nothing else is affected -- reads, characters, missions
and the character wizard all keep working -- but this is the one step whose delay
costs writes rather than appearance.

Expected: the deployed `/classes` list and a class page render, and one admin
class save round-trips without error.

- [ ] **Step 2b: Re-count uncategorised gear against production (R45)**

`20260904000001`'s predicate is deliberately fail-closed: it rewrites a class
only when `gear` is a six-item array in which *every* item is an object with no
`category` key. A class that has drifted from that shape -- five items, seven,
one item already categorised, gear that is not an array -- is skipped silently
and keeps items with no `category`. `views/class-view.handlebars` splits Base
from Elective by an exact match on that key, so a skipped class prints all of
its Signature Gear under Base and nothing under Elective.

Local is a restored copy and production has more classes, so the count only
means something when it is re-run **there, after `db push`**. In the Supabase SQL
editor, or through psql on the same pooler host Step 1's backup uses
(`<region>.pooler.supabase.com`, user `postgres.<ref>`):

```sql
-- Classes still holding a gear item with no `category` key.
SELECT c.name,
       jsonb_array_length(c.gear) AS items,
       count(*) FILTER (WHERE NOT jsonb_exists(e, 'category')) AS uncategorised
  FROM public.classes c, LATERAL jsonb_array_elements(c.gear) e
 WHERE jsonb_typeof(c.gear) = 'array'
 GROUP BY c.id, c.name, c.gear
HAVING count(*) FILTER (WHERE NOT jsonb_exists(e, 'category')) > 0
 ORDER BY c.name;

-- And the shape the query above cannot see at all: gear that is not an array.
SELECT id, name FROM public.classes
 WHERE gear IS NOT NULL AND jsonb_typeof(gear) <> 'array';
```

Expected: **0 rows from both**, which is what the restored local copy answers
after the backfill. Any row is a class whose gear will render in one column.
**Do not patch it with a hand-written UPDATE** -- the positional split is only
known to be correct for the six-item shape, which is precisely why the migration
refused to guess at anything else. Record the rows and hand them back for a
decision before continuing.

- [ ] **Step 2c: Run the character-impact report against production**

```bash
bun run scripts/report-character-impact.mjs; echo "exit=$?"
```

**Expected: `exit=1`, and that is not a failure.** The report knows nothing
of `docs/data/prerelease-name-remap.json` — it compares the live catalogue
against what characters hold and reports every name it cannot resolve — so
before the load it necessarily lists all 15 remapped names, and after the load
it still exits 1 on the baseline pair below. Gate on the **names it prints**,
never on the exit code.

The rollout proceeds only if the reported names are exactly:

- the 15 `from` names in `docs/data/prerelease-name-remap.json`, and
- the known baseline pair `Agent’s Fieldcoat` (U+2019 apostrophe) and
  `Neuralyzer` on Fortean, which already resolve to nothing on production today
  and strand Thaddeus and Agent Jack Hawthorne. This branch neither causes nor
  repairs them.

**Any name outside that set stops the rollout.** Production holds more
characters than local, so a name absent locally can still be held there; each
one goes back through Task 10a Step 4 for the owner's confirmation and into the
remap file before Step 3 runs.

Re-run this after Step 4. It should then print the baseline pair alone — still
`exit=1`, with an empty vanishing-names table. Anything more means the load left
a character holding a name the catalogue no longer has.

- [ ] **Step 3: Dry-run the loader against production**

```bash
bun run scripts/load-prerelease-classes.mjs
```

Expected: `19 classes resolved`. **Read the create/update split.** The Aug-15 dump showed Ardent, Offdriver and Squire absent; if production has gained them since, they resolve as updates instead — either is fine, but an unexpected *create* for one of the other 16 means name resolution missed a row, and the run stops there.

- [ ] **Step 4: Apply and verify**

```bash
bun run scripts/load-prerelease-classes.mjs --apply --force
bun run scripts/load-prerelease-classes.mjs   # expect: no changes
```

`--force` is required here and is not boilerplate.
`scripts/load-prerelease-classes.mjs:200` refuses to `--apply` against any target
that is not the local stack unless it is passed, because `dotenv` never
overrides an already-exported variable -- so a shell that ran
`eval "$(supabase status -o env)"` can still be pointed at production by `.env`,
and this write is irreversible against a database holding real characters. The
refusal is the safety net; `--force` is the deliberate act of taking it off for
this one command, and it belongs on this line and nowhere else. Note that
`--allow-unremapped` does **not** travel with it -- the loader rejects that
against a non-local target under any flag, because leaving live characters
unsaveable is a local rehearsal state and never a deployed one.

**The loader's four write phases are not atomic.** Class rows, abilities, gear
and the remap `UPDATE`s run in sequence with no enclosing transaction, so a
failure partway through leaves the load half-applied and the characters holding
a not-yet-remapped name unsaveable until it finishes. Every phase is idempotent
and resolution accepts both spellings, so **on a non-zero exit re-run it
immediately** rather than pausing to investigate — the half-applied state is the
one worth spending the least time in.

**It renames the `classes` row, not `characters.class`.** The 7 characters
created under the old name keep `class = 'Witchhunter'` in their own column.
Not save-blocking — all 7 carry a `class_id`, and the name lookup only runs when
that is absent — and not new: 212 `Warrior`, 12 `Shonen` and 3 `Ember`
characters are already desynced the same way. The one visible cost is that
`routes/missions.js` keys `classAbilityList` by that name, so those 7 see an
empty ability list on their missions page.

This is the step that renames production's `Witchhunter` row to `Witchfinder`.
See the sequencing note at the top of this task: it closes a window the deploy
opens, so it runs in the same sitting.

Then load `/classes` and three class pages in a browser — one PCC, one Exclusive, one Aspirant — and confirm prose, meters, paired actions, notes and the challenge level all render.

- [ ] **Step 5: Hand back the open flags**

Report which of Ardent, Offdriver, Squire and Drachentöter are sitting at `is_public = false`, for the owner to publish deliberately.

---

## Self-Review

**Spec coverage.** Verbatim constraint → Tasks 6-7 (extraction from the word stream, token-diff gate). Data model → Task 8 (columns), Tasks 15-16 (JSONB shape). `description` dropped → Task 13. Ability/signature metadata → Tasks 3-4, 11-12. Dead `class_abilities` columns → Task 8. Overwrite in place → Task 10. Aspirant six + Witchfinder rename → Tasks 9-10. Four unpublished classes → Tasks 10, 18. `teaser` untouched, other 28 rows untouched → Task 10 (`FIELDS` allowlist). Extraction bands → Tasks 2-3. Rollout → Tasks 10, 18. Full editing UI → Tasks 14-17. Character-side impact of renamed items → Tasks 10a, 10b, 17a; the root cause is specified separately in `docs/superpowers/specs/2026-09-02-class-item-resolution-design.md`.

**Placeholders.** Task 6's driver is described by stage and anchor table rather than as one code block, because it is a 200-line I/O script whose parsing logic is fully specified and tested in Tasks 1-5; the anchors are exact regexes and the invariant check in Step 4 is runnable as written. Tasks 15-16 describe the Alpine components rather than transcribing them; their contract is fixed by the tests, which are complete.

**Type consistency.** `meters` is `[{label, value}]` in Tasks 3, 6, 11, 12, 15, 16. `notes` is `[{text, children}]` with `children` always an array in Tasks 4, 6, 11, 12, 15. `category` is `'default'|'elective'` in Tasks 6, 12, 16. `challenge_level` is `'Low'|'Mid'|'High'` in Tasks 6, 8, 14. `parseStatLine` returns lowercase stat keys in Tasks 1 and 6, matching `stat_spread` as consumed by `routes/classes.js:57-70`.
