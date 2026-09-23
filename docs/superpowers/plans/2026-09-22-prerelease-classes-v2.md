# Pre-release Classes as Released v2 Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every pre-release class as released Advent content at `rules_version 'v2'`, list them in their own section of `/classes`, and give the characters on v2 classes a read-only, clear-only home for their stored v1-only text.

**Architecture:** The loader learns per-book insert values (status, rules version, player-created) and stops depending on a parent's `rules_version` to find a fork parent: it names the parent by roster id instead. A data migration then moves the twenty existing pre-release rows to v2/release. The catalog partition checks `prerelease_section` first. On the character side nothing is converted: a v2 save keeps `perks`/`additional_gear` untouched unless the edit form's new "Deprecated fields" section submits a clear flag, which sends a JSON null that `save_character_atomic` already writes through.

**Tech Stack:** Bun, `bun:test`, Express 4, express-handlebars, htmx, Supabase/Postgres (PostgREST, `supabase` CLI).

**Spec:** this document's Decisions section.

## Decisions

The owner's model, decided before this plan was written. Tasks argue from it; do not re-open it.

1. **What a pre-release class is.** A class with `classes.prerelease_section` set (`'pcc' | 'exclusive' | 'aspirant'`). The Enclave creator teases content from upcoming products as pre-release classes. They are always Advent format (`content_format 'advent'`), recorded as the latest Advent version (`rules_version 'v2'`), and are released content (`status 'release'`). Only unfinished player-created classes (PCCs) carry `alpha`/`beta`.
2. **Relation to Aspirant.** A pre-release class is effectively half of an Aspirant class; owning the Aspirant book unlocks the full Aspirant version. The exclusives (Ardent, Offdriver, Squire) also have an Aspirant form unlockable only by unlock code; that content is not extracted and is out of scope.
3. **Catalog sections** (`views/classes.handlebars`, `routes/classes.js` `GET /`, `util/class-filter.js` `partitionClassCatalog`), checked in this order per version-group primary:
   1. **Pre-release Classes:** `prerelease_section` set, regardless of status or book ownership. (The Aspirant book's grant, `CORE_CLASS_UNLOCKS.aspirant` in `util/starter-content.js`, includes the six pre-release aspirant-section ids, so without this check first they land in "Your Released" for book owners.)
   2. **PCCs:** `is_player_created && status !== 'release'` (the existing `isUnreleasedPcc`).
   3. **Your Released Classes:** id in the viewer's `bookIds`.
   4. **Other Released Classes:** everything else.

   For a user owning only the Advent book: Your Released = the six base Advent classes (latest version, v2 primary); Other Released = the twelve Aspirant classes; Pre-release = the twenty pre-release classes; PCCs = alpha/beta player-created classes only. `partitionProfileClasses`/`partitionClassGroups` (the profile page) stay unchanged.
4. **Characters on classes that become v2 are not converted.** Their v1-only fields (`characters.perks`, `characters.additional_gear`; `V1_ONLY_FIELDS` in `services/character/input.js`) stay stored. For every character whose class is v2 (all v2 characters, not only pre-release ones):
   - **Sheet:** those fields are hidden.
   - **Edit form:** a section titled exactly "Deprecated fields", rendered only when the character is v2 and at least one of `perks`/`additional_gear` is non-empty. Each non-empty field is shown read-only with a per-field control to clear it (`clear_perks`, `clear_additional_gear`). The fields cannot be edited, only cleared.
   - **Save:** a v2 save preserves both fields (the existing strip), except that a submitted clear flag sets that field to null. A v2 save can never write a non-null value into either.
5. **Loader** (`scripts/load-prerelease-classes.mjs`, `scripts/lib/books.mjs`): the prerelease book inserts with status `'release'`; each book has its own insert rules version (prerelease `'v2'`, aspirant-v1 `'v1'`); a pre-release insert in section `'pcc'` is `is_player_created true`; fork parents are resolved without reference to `rules_version`, by roster id, so a first production run (no forks yet, pre-release parents at v2) succeeds.
6. **Data migration:** every row with `prerelease_section` set becomes `rules_version 'v2'`, `status 'release'`; every `'pcc'` row becomes `is_player_created true`. Idempotent; `updated_at` untouched.

## Global Constraints

- **NEVER run `supabase db reset`.** The local database holds a restored production copy. Apply schema and data changes with `supabase migration up` only.
- Before any step that writes to a database (migration, loader `--apply`, integration test): `grep '^SUPABASE_URL' .env` must print `SUPABASE_URL="http://127.0.0.1:54321"`. If it prints anything else, stop.
- **Unit tier:** `bun run test:unit` (scrubs `SUPABASE_URL`). Never plain `bun test <file>` against `.env`. The single-file form is:
  ```bash
  env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test <file>
  ```
- **HTTP tier:** route tests that boot Express are listed in `httpFiles` in `scripts/run-tests.mjs` and run with `bun run test:http`. `routes/characters.test.js` is already listed. The single-file form above works for them too.
- **Integration tier:** derive credentials from the running stack, never from `.env`:
  ```bash
  eval "$(supabase status -o env)"
  export SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY"
  bun test <file>            # one file
  bun run test:integration   # the tier
  ```
  A new integration file must `require('./require-local-supabase')` (or `'../util/require-local-supabase'`) first and be added to `integrationFiles` in `scripts/run-tests.mjs`.
- **Known reds (compare by file and test name, never by count):** `test:unit` 0 failures; `test:http` exactly `routes/open-graph.test.js`; `test:integration` exactly `util/character-content-integrity` (1), `util/class-form-round-trip` (1 of 3), `util/image-crop-integrity` (2); `test:e2e` `22-classes-crud` (5) and `18-book-class-unlocks` (1). Anything else red is yours.
- **Starting point.** The plan builds on `1f345fb fix: load ENCLAVE: Aspirant V1 classes as released` (`insertRow`, `publishPatch`, per-book `status` with prerelease `null`) and `1fd0bd9 fix: let the class lists filter by the Aspirant edition`. Line numbers below are against that tree. Every commit stages only the files its task names (`git add <paths>`, never `git add -A` or `.`).
- **No dead code.** When you replace something, delete what it replaced in the same change: no commented-out blocks, no fallbacks, no `_old` copies.
- **Comments** only where the code cannot carry the meaning; they describe the code as it is now, never what it used to do. No "was X, now Y", no changelog notes.
- **TDD per task:** red (run it, see the stated failure), green (minimum code), refactor (tests stay green).
- **Commits:** one per task, in the repo's style (`feat: …`, `fix: …`, `test: …`, `docs: …`, lower-case imperative). Every commit message ends with a blank line and then:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  ```

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `scripts/lib/books.mjs` (modify) | Per-book `status` and `rulesVersion` for inserted rows. | 1 |
| `scripts/load-prerelease-classes.mjs` (modify) | Insert-only fields; dry-run report of them; fork parent resolved by roster id. | 1, 2 |
| `test/load-prerelease-classes.test.js` (modify) | Pins insert-only fields, publish patch, parent resolution. | 1, 2 |
| `README.md` (modify) | The `load:aspirant-v1` paragraph names how the parent is found. | 2 |
| `docs/superpowers/specs/2026-09-16-aspirant-v1-ingestion-design.md` (modify) | Fork-parent rule (Task 2); pre-release `rules_version` (Task 4). | 2, 4 |
| `util/class-filter.js` (modify) | `partitionClassCatalog`: pre-release first. | 3 |
| `util/class-filter.test.js` (modify) | Pins the section order and the Advent-owner outcome. | 3 |
| `docs/superpowers/specs/2026-08-17-class-list-partition-design.md` (rewrite) | The current four-section rule. | 3 |
| `supabase/migrations/20260922000000_prerelease_classes_v2.sql` (create) | Data fix for the twenty existing rows. | 4 |
| `util/prerelease-classes.integration.test.js` (create) | Census: every pre-release row is advent/v2/release, every pre-release PCC player-created. | 4 |
| `scripts/run-tests.mjs` (modify) | Registers the new integration file. | 4 |
| `services/character/input.js` (modify) | A v2 save turns a submitted clear flag into a null. | 5 |
| `services/character/input.test.js` (modify) | Unit cover for the clear flags. | 5 |
| `models/character-atomic.integration.test.js` (modify) | Proves the null reaches the column and a submitted value never does. | 5 |
| `views/partials/character-deprecated-fields.handlebars` (create) | The "Deprecated fields" section. | 6 |
| `views/partials/character-v1-perks-legacy.handlebars` (delete) | Replaced by the above. | 6 |
| `views/character-form.handlebars` (modify) | Renders the new partial for v2. | 6 |
| `views/character-form.test.js` (modify) | View cover for the section. | 6 |
| `views/character.test.js` (modify) | Pins the sheet hiding v1-only fields for v2. | 6 |
| `routes/characters.test.js` (modify) | HTTP cover: the edit route renders the section for a v2 character. | 6 |
| `docs/superpowers/specs/2026-09-20-aspirant-v1-perk-economy-design.md` (modify) | Points at the partial that exists. | 6 |

Not touched, and why:
- `routes/classes.js` and `views/classes.handlebars`: the route already selects `*` (so `prerelease_section` reaches the partition) and passes `access.bookIds`; the view already renders the four sections in the required order. Only the partition function is wrong.
- `util/class-filter.js` `partitionProfileClasses` / `partitionClassGroups`: unchanged by decision 3, and no test in this plan needs them to change.
- `supabase/migrations/*save_character_atomic*`: no new migration is needed. The latest definition (`20260921000001_save_character_atomic_aspiring_abilities.sql`) updates from `jsonb_populate_record(saved, p_character)` and assigns `perks = record.perks, additional_gear = record.additional_gear` with no `COALESCE`, so an absent key keeps the stored value and a present JSON `null` writes `NULL`. Verified read-only against the local database: `jsonb_populate_record(<row>, '{"perks": null}')` returns `perks IS NULL` and leaves `additional_gear` as stored. The service passes `characterInput` to the RPC untouched (`services/character/service.js` `saveCharacterAtomic` → `services/character/repository.js:270-274`, `p_character: character`). Task 5's integration test is the proof in the repo.
- `views/character.handlebars` and `views/partials/character-details.handlebars`: both already gate `perks` and `additional_gear` on `effectiveVersion 'v1'`. The details partial is already pinned (`views/partials/character-details.test.js` "v2 shows quirks, accessories and per-ability perks and never the v1 perks"); the full sheet is not, and Task 6 pins it.

## Not in this plan

- **The exclusives' Aspirant forms** (Ardent, Offdriver, Squire, unlock-code only). Not extracted.
- **`util/seed-classes.js`.** Confirmed by reading it: `buildRow` writes `name, is_public, status 'release', is_player_created, rules_edition, rules_version 'v1', stat_spread, gear, abilities, advanced_abilities, created_by` and never `prerelease_section`; `scripts/seed-local.mjs` runs `seed:classes` then `load:aspirant-v1` and never the pre-release loader; CI's integration workflow runs `supabase db reset` with no class seed. So a fresh stack has no row with `prerelease_section` set, the migration matches nothing there, and the census test in Task 4 passes vacuously. The seeded Aspirant-preview six (Berserker … Witchfinder) therefore list as released classes on a fresh stack, not pre-release; making seeds mirror production is a separate change.
- **Production rollout.** Deploying the code and running the migration and loaders against production is not a step here. Order matters when it happens: Task 2's loader must be in place before `load:aspirant-v1` runs anywhere the migration has already run.
- **`docs/superpowers/specs/2026-05-25-v2-character-support-design.md`** describes the original "Legacy perks (v1)" block. It is the design record of that earlier change and is left as written.

---

### Task 1: Loader — per-book status and rules version on insert; pre-release PCCs are player-created

**Files:**
- Modify: `scripts/lib/books.mjs:9-41`
- Modify: `scripts/load-prerelease-classes.mjs:14-17` (header comment), `:68-74` (delete `NEW_ROW_RULES_VERSION`), `:85-92` (descriptor comment), `:261-299` (`insertRow`, `publishPatch`, `reportInsert`, `reportPlan`), `:376` (`reportPlan` call)
- Test: `test/load-prerelease-classes.test.js:40-44` (`FORBIDDEN`), `:516-576` (1f345fb's insert/publish tests and the `reportPlan` test)

**Interfaces:**
- Consumes: 1f345fb's `insertRow(plan, book)` and `publishPatch(row, book)`.
- Produces:
  - `BOOKS.prerelease.status === 'release'`, `BOOKS.prerelease.rulesVersion === 'v2'`, `BOOKS['aspirant-v1'].status === 'release'`, `BOOKS['aspirant-v1'].rulesVersion === 'v1'`.
  - `insertRow(plan, book) -> { ...plan.payload, rules_version, status, is_player_created }` where `is_player_created === (plan.payload.prerelease_section === 'pcc')`.
  - `publishPatch(row, book) -> { is_public?: true, status?: string } | null`.
  - `reportPlan(plans, book)` (gains `book`), printing `  + rules_version: "…"`, `  + status: "…"`, `  + is_player_created: …` under every CREATE and FORK heading.

- [ ] **Step 1: Write the failing tests**

In `test/load-prerelease-classes.test.js`, widen `FORBIDDEN` (currently at `:40-43`) so no payload can carry the column the insert now owns:

```js
// Columns the owner controls: no payload may flip a row's visibility, its
// status, whether it is player-created, its marketing copy, or the
// `rules_version` an owner set -- the insert that creates a row is the only
// thing that writes those.
const FORBIDDEN = ['is_public', 'status', 'is_player_created', 'teaser', 'image_url', 'image_crop',
  'rules_version'];
```

Replace everything from the comment above `test('reportPlan prints the FORK heading with the class name and parent id', …)` (currently `:517`) to the end of the file with:

```js
const captureLog = (run) => {
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    run();
  } finally {
    console.log = originalLog;
  }
  return lines;
};

// The FORK heading is how a human running the dry run confirms the twelve
// parents before anything is written -- it names both the class and the parent
// id it is about to descend from.
test('reportPlan prints the FORK heading with the class name and parent id', () => {
  const plan = {
    payload: { name: 'Berserker' }, row: null, parent: { id: 'parent-id-1' },
    disposition: 'fork', changes: []
  };
  const lines = captureLog(() => reportPlan([plan], forkBook));
  expect(lines).toContain('\nFORK Berserker from parent-id-1');
  expect(lines).toContain('  + rules_version: "v1"');
});

test('the dry run reports the fields only an insert writes', () => {
  const charlatan = records.find((record) => displayName(record.name) === 'Charlatan');
  const [plan] = planLoad([charlatan], [], book);
  plan.changes = diffFields(plan.payload, plan.row);
  const lines = captureLog(() => reportPlan([plan], book));
  expect(lines).toContain('\nCREATE Charlatan');
  expect(lines).toContain('  + rules_version: "v2"');
  expect(lines).toContain('  + status: "release"');
  expect(lines).toContain('  + is_player_created: true');
});

// `rules_version` has no column default, `status` defaults to 'alpha' and
// `is_player_created` to false, so the insert is where a book states all
// three. Both books' classes are released content, each at its own rules
// version, and only a pre-release PCC is player-created.
test('an Aspirant V1 fork is inserted released, at v1, and not player-created', () => {
  const [plan] = planLoad([berserkerRecord], [row('Berserker', { rules_edition: 'aspirant' })], forkBook);
  const inserted = insertRow(plan, forkBook);
  expect(inserted.status).toBe('release');
  expect(inserted.rules_version).toBe('v1');
  expect(inserted.is_player_created).toBe(false);
  expect(inserted.id).toBe(ASPIRANT_V1_CLASS_IDS.Berserker);
});

test('a pre-release create is inserted released, at v2', () => {
  const charlatan = records.find((record) => displayName(record.name) === 'Charlatan');
  const [plan] = planLoad([charlatan], [], book);
  const inserted = insertRow(plan, book);
  expect(inserted.status).toBe('release');
  expect(inserted.rules_version).toBe('v2');
});

test('a pre-release PCC is inserted player-created and an exclusive is not', () => {
  const recordFor = (name) => records.find((record) => displayName(record.name) === name);
  const [charlatan, ardent] = planLoad([recordFor('Charlatan'), recordFor('Ardent')], [], book);
  expect(insertRow(charlatan, book).is_player_created).toBe(true);
  expect(insertRow(ardent, book).is_player_created).toBe(false);
});

// Re-running a load is what corrects rows an earlier load left at another
// status, so its publish step brings status along with visibility.
test('publishing an Aspirant V1 row already public brings its status to release', () => {
  expect(publishPatch({ id: 'x', is_public: true, status: 'alpha' }, forkBook))
      .toEqual({ status: 'release' });
});

test('publishing a private Aspirant V1 row sets both visibility and release status', () => {
  expect(publishPatch({ id: 'x', is_public: false, status: 'alpha' }, forkBook))
      .toEqual({ is_public: true, status: 'release' });
});

test('an Aspirant V1 row already public and released needs no publish write', () => {
  expect(publishPatch({ id: 'x', is_public: true, status: 'release' }, forkBook)).toBeNull();
});

test('publishing a pre-release row brings its status to release', () => {
  expect(publishPatch({ id: 'x', is_public: false, status: 'alpha' }, book))
      .toEqual({ is_public: true, status: 'release' });
  expect(publishPatch({ id: 'x', is_public: true, status: 'release' }, book)).toBeNull();
});
```

This deletes 1f345fb's `'a pre-release create is inserted without a status of its own'` and `'publishing a pre-release row flips visibility and never touches status'`, and the comment above them.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test test/load-prerelease-classes.test.js`
Expected: FAIL — `a pre-release create is inserted released, at v2` (status `undefined`, rules_version `"v1"`), `a pre-release PCC is inserted player-created…` (`undefined`), `an Aspirant V1 fork is inserted released, at v1, and not player-created` (`is_player_created` `undefined`), `the dry run reports the fields only an insert writes` (prints `+ rules_version: "v1"` and no status line), `publishing a pre-release row brings its status to release`. `reportPlan prints the FORK heading…` passes already (today's constant prints `"v1"`); it stays as the guard that a fork still reports v1 once the constant is gone.

- [ ] **Step 3: Implement**

`scripts/lib/books.mjs` — replace the `status` entries of both books (and their comments) so the two descriptors read:

```js
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
    // A pre-release class is released Advent-format content, recorded at the
    // latest Advent version.
    status: 'release',
    rulesVersion: 'v2',
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
    // Released content, gated by owning the book rather than by status.
    status: 'release',
    // Advent's v1/v2 are character-rules versions; a class in the Aspirant
    // format does not advance them.
    rulesVersion: 'v1',
    forks: true
  }
```

`scripts/load-prerelease-classes.mjs`:

1. Header comment, `:14-17`: replace

```js
// An --apply run does three things in order: writes the class rows, renames the
// character-held item rows this document renames, and publishes the
// classes the owner authorised -- making them visible and, where the book
// carries a status, setting it. The rename comes from
```

with

```js
// An --apply run does three things in order: writes the class rows, renames the
// character-held item rows this document renames, and publishes the classes
// the owner authorised -- making them visible and setting the book's status.
// The rename comes from
```

2. Delete `:68-74` entirely (the comment beginning `` // `rules_version` is NOT NULL with no column default`` and `const NEW_ROW_RULES_VERSION = 'v1';`).

3. Descriptor comment, `:85-92`: replace its last two sentences

```js
// general write path cannot. `book.status` is written the same way: on the
// rows this load inserts and the rows it publishes, never by the field diff.
// `classes.status` defaults to 'alpha', which lists a class as pre-release.
```

with

```js
// general write path cannot. `book.status` is written the same way: on the
// rows this load inserts and the rows it publishes, never by the field diff.
```

4. Replace `insertRow`, `publishPatch`, `reportInsert` and `reportPlan` (`:261-299`) with:

```js
// What only an insert writes. `rules_version` is NOT NULL with no column
// default, `status` defaults to 'alpha' and `is_player_created` to false, so a
// new row states all three. None is ever part of an update payload: an existing
// row keeps whatever the owner set.
const insertOnly = (plan, book) => ({
  rules_version: book.rulesVersion,
  status: book.status,
  is_player_created: plan.payload.prerelease_section === 'pcc'
});

export const insertRow = (plan, book) => ({ ...plan.payload, ...insertOnly(plan, book) });

export const publishPatch = (row, book) => {
  const patch = {};
  if (!row.is_public) patch.is_public = true;
  if (row.status !== book.status) patch.status = book.status;
  return Object.keys(patch).length ? patch : null;
};

const reportInsert = (plan, book, heading) => {
  console.log(`\n${heading}`);
  for (const { field, after } of plan.changes) console.log(`  + ${field}: ${preview(after)}`);
  for (const [field, value] of Object.entries(insertOnly(plan, book))) {
    console.log(`  + ${field}: ${JSON.stringify(value)}`);
  }
};

export const reportPlan = (plans, book) => {
  for (const plan of plans) {
    const { payload, row, parent, disposition } = plan;
    if (disposition === 'create') {
      reportInsert(plan, book, `CREATE ${payload.name}`);
      continue;
    }
    if (disposition === 'fork') {
      reportInsert(plan, book, `FORK ${payload.name} from ${parent.id}`);
      continue;
    }
    console.log(`\nUPDATE ${row.name} (${row.id})`);
    if (!plan.changes.length) console.log('  no changes');
    for (const { field, before, after } of plan.changes) {
      console.log(`  ~ ${field}`);
      console.log(`      - ${preview(before)}`);
      console.log(`      + ${preview(after)}`);
    }
  }
};
```

5. In `main`, `:376`: `reportPlan(plans);` becomes `reportPlan(plans, book);`.

Confirm nothing else names the deleted constant: `grep -n NEW_ROW_RULES_VERSION scripts test` prints nothing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test test/load-prerelease-classes.test.js`
Expected: PASS, 0 fail.

Then the read-only dry runs against the local stack (after the `.env` check in Global Constraints):

Run: `bun run scripts/load-prerelease-classes.mjs --book prerelease 2>&1 | tail -3`
Expected:
```
20 classes resolved (20 update, 0 create), 0 ambiguous
0 of 20 existing rows differ
DRY RUN - nothing written
```

Run: `bun run scripts/load-prerelease-classes.mjs --book aspirant-v1 2>&1 | tail -3`
Expected:
```
12 classes resolved (12 update, 0 create, 0 fork), 0 ambiguous
0 of 12 existing rows differ
DRY RUN - nothing written
```

- [ ] **Step 5: Run the unit tier**

Run: `bun run test:unit`
Expected: 0 failed files.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/books.mjs scripts/load-prerelease-classes.mjs test/load-prerelease-classes.test.js
git commit -m "feat: insert each book's classes released, at the book's own rules version

A pre-release insert is v2, and one in the PCC section is player-created.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Loader — name each fork parent by its roster id

**Files:**
- Modify: `scripts/load-prerelease-classes.mjs:8-12` (header), `:38` (import), `:59-66` (delete `FORK_PARENT`), `:191-241` (`mintedId`, `isParent`, `forkPlan`)
- Modify: `README.md:250-253`
- Modify: `docs/superpowers/specs/2026-09-16-aspirant-v1-ingestion-design.md:187-194`
- Test: `test/load-prerelease-classes.test.js:8-16` (imports), `:37-38` (fixtures), `:131-197`, `:273-274`, `:438-470`, and the Task 1 fork-insert test

**Interfaces:**
- Consumes: `CORE_CLASS_UNLOCKS`, `ASPIRANT_V1_CLASS_IDS` from `util/starter-content.js` (every roster value lists the id already in the catalogue first and its V1 fork's minted id after it).
- Produces: `export const forkParentId = (name: string) => string | null` — `(CORE_CLASS_UNLOCKS.advent[name] ?? CORE_CLASS_UNLOCKS.aspirant[name])[0]`, or `null` for a name neither roster lists. A fork plan's `matches` is always `[parent]`; `planLoad` throws `no minted class id for "<name>"` before `no fork parent for "<name>"`.

**Why by id.** After Task 4 the six aspirant-section parents are v2, so `FORK_PARENT`'s `rules_version: 'v1'` finds no parent on a first production run. Dropping that clause alone is worse: each Advent name then matches a v1 and a v2 row (e.g. Gunslinger `b6ce893b…` v1 and `1a49ae08…` v2, both `content_format 'advent'`, both official), and the run aborts as ambiguous. The roster ids are the one key that is unambiguous and the same in every environment (`util/core-roster.integration.test.js` holds them to real rows), and `util/seed-classes.js` assigns `roster[name][0]` to the row it seeds, so fresh stacks resolve too. An id match also subsumes the old `content_format`/`is_player_created` guards: a player's own class named Gunslinger never carries a roster id.

- [ ] **Step 1: Write the failing tests**

Imports, `:8-16`, become:

```js
import {
  buildPayload, diffFields, displayName, fieldsFor, fold, forkParentId, insertRow, isLocalTarget,
  planLoad, publishPatch, reportPlan, resolveTarget, sectionEnum, trimEnds, unremapped,
  unresolvableTargets
} from '../scripts/load-prerelease-classes.mjs';
import { bookFor } from '../scripts/lib/books.mjs';
import {
  catalogueNames, groupUnresolvable, projectImport
} from '../scripts/lib/character-impact.mjs';
import { ASPIRANT_V1_CLASS_IDS } from '../util/starter-content.js';
```

Directly below the `row` fixture (`:37-38`), add:

```js
// The rows the twelve V1 classes fork from, pinned to their values: the six
// Advent originals and the six pre-release aspirant-section rows.
const PARENT_IDS = {
  Gunslinger: 'b6ce893b-8207-4f89-abfc-a02ae0e9b65d',
  Illusionist: '018fcdba-39cf-4cc8-8f4d-92e2023719cf',
  Librarian: 'f0de4397-5e71-4ed6-a16a-26dc72c46801',
  Thane: 'aa0f9690-37a6-4784-9119-1b2117f798a7',
  Thunderbird: 'a605940b-f27f-45d8-af76-abda848b3e12',
  Wanderer: 'ebd55f52-9768-400a-94d6-392cd07e2b24',
  Berserker: '3c8f036f-06f0-4f72-9336-aa9c3fdd5541',
  Freerunner: '42d39b55-7db1-49a1-a53b-b1cd5fc9bc47',
  Infiltrator: 'c687840c-a781-4d46-9570-b344e1b9be04',
  Samaritan: 'f0726c9b-bfaf-4c22-9318-75c50c8e3cbf',
  Vessel: '3a863d9c-8454-4326-87ad-ed105fccbbd4',
  Witchfinder: '79721ac8-378e-4b3e-b1e3-8266689da89e'
};
const ADVENT_NAMES = ['Gunslinger', 'Illusionist', 'Librarian', 'Thane', 'Thunderbird', 'Wanderer'];
const parentRow = (name, over = {}) => row(name, { id: PARENT_IDS[name], ...over });
```

Replace the tests from `test('a class with an advent-format parent forks rather than updating it', …)` through `test('a forked class with no minted id stops the run', …)` (currently `:131-197`) with:

```js
test('each V1 class forks off the roster id already in the catalogue, not its own', () => {
  for (const record of forkRecords) {
    const name = displayName(record.name);
    expect(forkParentId(name)).toBe(PARENT_IDS[name]);
  }
  expect(forkParentId('Nobody')).toBeNull();
});

test('a class with an advent-format parent forks rather than updating it', () => {
  const rows = [parentRow('Berserker', { rules_edition: 'aspirant' })];
  const [plan] = planLoad([berserkerRecord], rows, forkBook);
  expect(plan.disposition).toBe('fork');
  expect(plan.row).toBeNull();
  expect(plan.parent.id).toBe(PARENT_IDS.Berserker);
});

test('the fork payload carries the parent pointer and both axes', () => {
  const [plan] = planLoad([berserkerRecord], [parentRow('Berserker', { rules_edition: 'aspirant' })],
      forkBook);
  expect(plan.payload.base_class_id).toBe(PARENT_IDS.Berserker);
  expect(plan.payload.rules_edition).toBe('aspirant');
  expect(plan.payload.content_format).toBe('aspirant');
  expect(plan.payload.id).toBe(ASPIRANT_V1_CLASS_IDS.Berserker);
});

// The production shape a first load has to survive: no fork exists yet, the
// pre-release parents are v2, and every Advent name also carries a v2 row of
// its own descending from the original.
test('a first load forks all twelve off their roster parents, whatever version the rows carry', () => {
  const names = forkRecords.map((record) => displayName(record.name));
  const rows = [
    ...names.map((name) => parentRow(name, { rules_version: 'v2' })),
    ...ADVENT_NAMES.map((name) =>
        row(name, { id: `id-${name}-v2`, rules_version: 'v2', base_class_id: PARENT_IDS[name] }))
  ];
  const plans = planLoad(forkRecords, rows, forkBook);
  expect(plans.map((plan) => [plan.payload.name, plan.disposition, plan.parent.id, plan.matches.length]))
      .toEqual(names.map((name) => [name, 'fork', PARENT_IDS[name], 1]));
});

test('the roster row is the parent when an Advent class has a v1 and a v2 row', () => {
  const rows = [parentRow('Gunslinger'),
    row('Gunslinger', { id: 'id-v2', rules_version: 'v2', base_class_id: PARENT_IDS.Gunslinger })];
  const [plan] = planLoad([gunslingerRecord], rows, forkBook);
  expect(plan.disposition).toBe('fork');
  expect(plan.parent.id).toBe(PARENT_IDS.Gunslinger);
});

test("a player's own class of the same name is not a fork parent", () => {
  const rows = [row('Gunslinger', { id: 'id-mine', is_player_created: true })];
  expect(() => planLoad([gunslingerRecord], rows, forkBook)).toThrow('no fork parent for "Gunslinger"');
});

test('re-running after a fork updates the fork and never creates a second one', () => {
  const rows = [parentRow('Berserker', { rules_edition: 'aspirant' }),
    row('Berserker', { id: 'id-v1fork', rules_edition: 'aspirant', content_format: 'aspirant' })];
  const [plan] = planLoad([berserkerRecord], rows, forkBook);
  expect(plan.disposition).toBe('update');
  expect(plan.row.id).toBe('id-v1fork');
});

// Both axes decide it: a row in this book's content format but another
// rules_edition is not this book's fork, and reading it as one would overwrite a
// class this book never described.
test("a row matching one axis only is neither this book's fork nor a parent", () => {
  const rows = [row('Berserker', { content_format: 'aspirant', rules_edition: 'advent' })];
  expect(() => planLoad([berserkerRecord], rows, forkBook)).toThrow('no fork parent for "Berserker"');
});

// A parent and its own fork share a name for good, so the name alone cannot
// decide the row. Two forks is the ambiguity, reported rather than picked from;
// a second row of the parent's name is simply not the parent.
test('two forks of one name are ambiguous, and a second row of the parent name is not a parent', () => {
  const [byParent] = planLoad([berserkerRecord],
      [parentRow('Berserker'), row('Berserker', { id: 'id-other' })], forkBook);
  expect(byParent.parent.id).toBe(PARENT_IDS.Berserker);
  expect(byParent.matches).toHaveLength(1);

  const fork = (id) => row('Berserker', { id, rules_edition: 'aspirant', content_format: 'aspirant' });
  const [byFork] = planLoad([berserkerRecord], [parentRow('Berserker'), fork('f1'), fork('f2')], forkBook);
  expect(byFork.matches).toHaveLength(2);
  expect(byFork.row).toBeNull();
});

// An id Postgres mints instead would differ between local and production, which
// is the one thing minting them by hand exists to prevent -- and a payload with
// no `id` key is exactly what makes Postgres mint one.
test('a forked class with no minted id stops the run', () => {
  const unnamed = { ...berserkerRecord, name: 'Nobody' };
  expect(() => planLoad([unnamed], [row('Nobody')], forkBook)).toThrow('no minted class id for "Nobody"');
});
```

`forkPlans` (currently `:273-274`) becomes:

```js
const forkPlans = () =>
    planLoad(forkRecords, forkRecords.map((record) => parentRow(displayName(record.name))), forkBook);
```

The four projection tests (currently `:438-470`) become:

```js
test('a fork leaves its parent untouched in the post-import projection', () => {
  const parent = parentRow('Berserker', { rules_edition: 'aspirant', gear: [{ name: 'Old Axe' }] });
  const [plan] = planLoad([berserkerRecord], [parent], forkBook);
  const after = projectImport([parent], [plan], forkBook);
  expect(after.find((c) => c.id === PARENT_IDS.Berserker).gear).toEqual([{ name: 'Old Axe' }]);
  expect(after).toHaveLength(2);
});

test("the parent's item names survive the fork, so nothing is orphaned", () => {
  const parent = parentRow('Berserker', { is_public: true, rules_edition: 'aspirant',
    gear: [{ name: 'Old Axe' }], abilities: [] });
  const [plan] = planLoad([berserkerRecord], [parent], forkBook);
  const names = catalogueNames(projectImport([parent], [plan], forkBook));
  expect(names.gear.has('Old Axe')).toBe(true);
});

test('the projected fork stands under the id the load will give it', () => {
  const parent = parentRow('Berserker', { rules_edition: 'aspirant' });
  const [plan] = planLoad([berserkerRecord], [parent], forkBook);
  expect(projectImport([parent], [plan], forkBook).map((cls) => cls.id))
      .toEqual([PARENT_IDS.Berserker, ASPIRANT_V1_CLASS_IDS.Berserker]);
});

// Both rows are named Berserker and the book publishes that name, but only the
// fork is this load's to publish: a projection that published by name would make
// a private parent public and count its item names as catalogued.
test('the projection publishes the fork and not the parent it descends from', () => {
  const parent = parentRow('Berserker', { rules_edition: 'aspirant', is_public: false });
  const [plan] = planLoad([berserkerRecord], [parent], forkBook);
  const projected = projectImport([parent], [plan], forkBook);
  const publicity = (id) => projected.find((cls) => cls.id === id).is_public;
  expect(publicity(PARENT_IDS.Berserker)).toBe(false);
  expect(publicity(ASPIRANT_V1_CLASS_IDS.Berserker)).toBe(true);
});
```

In Task 1's `'an Aspirant V1 fork is inserted released, at v1, and not player-created'`, change the fixture to the parent:

```js
  const [plan] = planLoad([berserkerRecord], [parentRow('Berserker', { rules_edition: 'aspirant' })],
      forkBook);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test test/load-prerelease-classes.test.js`
Expected: FAIL — the file does not load: `SyntaxError: Export named 'forkParentId' not found in module '…/scripts/load-prerelease-classes.mjs'`.

- [ ] **Step 3: Implement**

`scripts/load-prerelease-classes.mjs`:

1. Header, `:8-12`: replace

```js
// A book whose descriptor sets `forks` never writes over the class it shares a
// name with. It inserts a row of its own instead, carrying `base_class_id`, its
// own `content_format` and `rules_edition`, and an id minted in
// util/starter-content.js; the parent is left exactly as it stands. A second run
// finds that row and updates it, which is what keeps a repeated --apply a no-op.
```

with

```js
// A book whose descriptor sets `forks` never writes over the class it shares a
// name with. It inserts a row of its own instead, carrying `base_class_id`, its
// own `content_format` and `rules_edition`, and an id minted in
// util/starter-content.js; the parent -- the row that module's roster names --
// is left exactly as it stands. A second run finds that row and updates it,
// which is what keeps a repeated --apply a no-op.
```

2. Import, `:38`: `import { ASPIRANT_V1_CLASS_IDS } from '../util/starter-content.js';` becomes

```js
import { ASPIRANT_V1_CLASS_IDS, CORE_CLASS_UNLOCKS } from '../util/starter-content.js';
```

3. Delete `FORK_PARENT` and its comment (`:59-66`).

4. Delete `isParent` (`:200-201`). After `mintedId`, add:

```js
// The row a fork descends from, named by id: the first id the roster lists for
// the class, which is the row already in the catalogue before its V1 fork. The
// Advent roster is read first because the Aspirant roster lists only the fork
// under an Advent name. These ids are the same in every environment. No rule
// over name and columns picks the parent out -- an Advent class has a v1 and a
// v2 row of one name, and the pre-release parents carry v2 as well.
export const forkParentId = (name) =>
  (CORE_CLASS_UNLOCKS.advent[name] ?? CORE_CLASS_UNLOCKS.aspirant[name])?.[0] ?? null;
```

5. Replace `forkPlan` and the comment above it (`:203-241`) with:

```js
// A fork of this book already in the catalogue means the load has run before, so
// the second run updates the fork it made rather than making another. Otherwise
// the load descends from the parent, which it leaves untouched. Two forks of one
// name is a name the loader cannot resolve, reported through `matches`; the
// parent is a single row by construction.
const forkPlan = (payload, matches, book) => {
  const existing = matches.filter((row) => row.content_format === book.contentFormat
      && row.rules_edition === book.rulesEdition);
  if (existing.length) {
    return {
      payload, matches: existing, row: existing.length === 1 ? existing[0] : null,
      parent: null, disposition: 'update'
    };
  }
  const id = mintedId(payload.name);
  const parentId = forkParentId(payload.name);
  const parent = matches.find((row) => row.id === parentId);
  if (!parent) {
    throw new Error(`no fork parent for ${JSON.stringify(payload.name)}: the catalogue holds no ` +
        `row of that name with the roster id ${parentId ?? '(none)'}`);
  }
  // A fork states its own identity, its parent and the two axes that separate
  // it from that parent, because it must not inherit any of the four. The pair
  // that separates fork from parent is `content_format` always, and
  // `rules_edition` only for the six Advent parents (Gunslinger, Illusionist,
  // Librarian, Thane, Thunderbird, Wanderer) -- the other six already carry
  // 'aspirant'. A create takes the four from the row's column defaults; an
  // update leaves the columns alone entirely.
  return {
    payload: {
      ...payload, id, base_class_id: parent.id,
      rules_edition: book.rulesEdition, content_format: book.contentFormat
    },
    matches: [parent], row: null, parent, disposition: 'fork'
  };
};
```

6. The `planLoad` comment (`:243-249`) still says "forkPlan does its own two-way scoping, and a fork's parent is by definition in another format". Replace its last two sentences

```js
// report prints. A forking book is deliberately not scoped here: forkPlan does
// its own two-way scoping, and a fork's parent is by definition in another
// format.
```

with

```js
// report prints. A forking book is deliberately not scoped here: forkPlan picks
// its fork by both axes and its parent by id, and a fork's parent is by
// definition in another format.
```

`README.md:250-253`: replace

```
step by step. It loads the committed extraction artifact and forks each class off
the same-named row, which must therefore already exist, so it follows
`seed:classes`. It is idempotent: a second run resolves the same twelve rows as
updates and, finding nothing changed, issues no statement.
```

with

```
step by step. It loads the committed extraction artifact and forks each class off
the row `CORE_CLASS_UNLOCKS` names for it (`util/starter-content.js`) -- the id
`seed:classes` gives that row -- which must therefore already exist, so it follows
`seed:classes`. It is idempotent: a second run resolves the same twelve rows as
updates and, finding nothing changed, issues no statement.
```

`docs/superpowers/specs/2026-09-16-aspirant-v1-ingestion-design.md:187-194`: replace

```
- The six Aspirant-only classes fork their pre-release row. Same
  `rules_edition`, `content_format` advent → aspirant.
- The six Advent base classes fork their `rules_version = 'v1'` row.
  `rules_edition` advent → aspirant, `content_format` advent → aspirant.
```

with

```
- The six Aspirant-only classes fork their pre-release row. Same
  `rules_edition`, `content_format` advent → aspirant.
- The six Advent base classes fork their original row, the `rules_version =
  'v1'` one `seed:classes` creates. `rules_edition` advent → aspirant,
  `content_format` advent → aspirant.

The loader names each parent by id: `CORE_CLASS_UNLOCKS.advent[name][0]` for
the six Advent classes and `CORE_CLASS_UNLOCKS.aspirant[name][0]` for the six
Aspirant-only ones (`util/starter-content.js`). No rule over name and columns
picks it out: an Advent class has a v1 and a v2 row of one name, and the
pre-release parents are at `rules_version 'v2'`.
```

(The paragraph that follows, "Forking the v1 rather than the v2 row of an Advent class is deliberate…", stays.)

Confirm nothing else names the deleted symbols: `grep -rn "FORK_PARENT\|isParent" scripts test` prints nothing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test test/load-prerelease-classes.test.js`
Expected: PASS, 0 fail.

Teeth check (revert after): swap the roster order in `forkParentId` to `(CORE_CLASS_UNLOCKS.aspirant[name] ?? CORE_CLASS_UNLOCKS.advent[name])` and re-run — `each V1 class forks off the roster id…` must fail for Gunslinger (it would return the fork's own minted id `3311fb69…`). Restore.

Read-only dry run against local: `bun run scripts/load-prerelease-classes.mjs --book aspirant-v1 2>&1 | tail -3` — expected unchanged from Task 1 (`12 classes resolved (12 update, 0 create, 0 fork), 0 ambiguous`).

- [ ] **Step 5: Run the unit tier**

Run: `bun run test:unit`
Expected: 0 failed files.

- [ ] **Step 6: Commit**

```bash
git add scripts/load-prerelease-classes.mjs test/load-prerelease-classes.test.js README.md docs/superpowers/specs/2026-09-16-aspirant-v1-ingestion-design.md
git commit -m "fix: resolve each Aspirant V1 fork parent by its roster id

A parent's rules_version no longer decides it, so a first load still finds
the pre-release parents once they are v2, and an Advent name's v1 and v2 rows
are never ambiguous.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Catalog — pre-release classes get their own section, checked first

**Files:**
- Modify: `util/class-filter.js:47-64`
- Test: `util/class-filter.test.js:85-101`
- Rewrite: `docs/superpowers/specs/2026-08-17-class-list-partition-design.md`

**Interfaces:**
- Consumes: group shape `{ primary, previous }` from `util/class-list-grouping.js#groupClassVersions`; `primary.prerelease_section`, `primary.is_player_created`, `primary.status`, `primary.id`.
- Produces: `partitionClassCatalog(groups, bookClassIds = new Set()) -> { ownedReleases, otherReleases, prerelease, pcc }` (same signature and keys as today; `routes/classes.js:150-154` is unchanged).

- [ ] **Step 1: Write the failing tests**

Replace the `describe('partitionClassCatalog', …)` block (`util/class-filter.test.js:85-101`) with:

```js
describe('partitionClassCatalog', () => {
  const group = (id, { status = 'release', is_player_created = false, prerelease_section = null } = {}) => ({
    primary: { id, status, is_player_created, prerelease_section }, previous: []
  });

  test('places each group in the first section whose rule its primary meets', () => {
    const teaser = group('teaser', { prerelease_section: 'exclusive' });
    const pcc = group('pcc', { status: 'alpha', is_player_created: true });
    const owned = group('owned');
    const other = group('other');
    expect(partitionClassCatalog([teaser, pcc, owned, other], new Set(['owned']))).toEqual({
      ownedReleases: [owned],
      otherReleases: [other],
      prerelease: [teaser],
      pcc: [pcc]
    });
  });

  // The Aspirant book's roster grants the six pre-release aspirant-section
  // classes (util/starter-content.js), so ownership must not pull them out.
  test('a pre-release class stays pre-release when a book the viewer owns grants it', () => {
    const teaser = group('berserker-teaser', { prerelease_section: 'aspirant' });
    const out = partitionClassCatalog([teaser], new Set(['berserker-teaser']));
    expect(out.prerelease).toEqual([teaser]);
    expect(out.ownedReleases).toEqual([]);
  });

  test('a pre-release PCC is pre-release whatever its status', () => {
    const released = group('pcc-teaser', { prerelease_section: 'pcc', is_player_created: true });
    const alpha = group('pcc-alpha-teaser', {
      status: 'alpha', prerelease_section: 'pcc', is_player_created: true
    });
    const out = partitionClassCatalog([released, alpha]);
    expect(out.prerelease).toEqual([released, alpha]);
    expect(out.pcc).toEqual([]);
  });

  // Only an unfinished PCC carries alpha or beta; status alone never makes an
  // official class a teaser.
  test('an official class with no pre-release section is released whatever its status', () => {
    const beta = group('official-beta', { status: 'beta' });
    const out = partitionClassCatalog([beta]);
    expect(out.otherReleases).toEqual([beta]);
    expect(out.prerelease).toEqual([]);
  });

  test('a released PCC with no pre-release section is a released class', () => {
    const graduated = group('graduated', { is_player_created: true });
    const out = partitionClassCatalog([graduated], new Set(['graduated']));
    expect(out.ownedReleases).toEqual([graduated]);
    expect(out.pcc).toEqual([]);
  });

  test("an Advent-book owner's catalog: the Advent six theirs, the Aspirant twelve other", () => {
    const advent = ['gun', 'ill', 'lib', 'tha', 'thu', 'wan'].map((id) => group(`${id}-v2`));
    const aspirant = Array.from({ length: 12 }, (_, i) => group(`v1-${i}`));
    const teasers = Array.from({ length: 20 }, (_, i) => group(`pre-${i}`, {
      prerelease_section: i < 11 ? 'pcc' : i < 14 ? 'exclusive' : 'aspirant',
      is_player_created: i < 11
    }));
    const pccs = [group('alpha-pcc', { status: 'alpha', is_player_created: true }),
      group('beta-pcc', { status: 'beta', is_player_created: true })];
    const bookIds = new Set(advent.map((g) => g.primary.id));
    const out = partitionClassCatalog([...teasers, ...aspirant, ...pccs, ...advent], bookIds);
    expect(out).toEqual({ ownedReleases: advent, otherReleases: aspirant, prerelease: teasers, pcc: pccs });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/class-filter.test.js`
Expected: FAIL — `a pre-release class stays pre-release when a book the viewer owns grants it` (it lands in `ownedReleases`), `an official class with no pre-release section is released whatever its status` (it lands in `prerelease`), `places each group in the first section…` (the released-status teaser lands in `otherReleases`), and the Advent-owner test.

- [ ] **Step 3: Implement**

Replace `util/class-filter.js:47-64` (the comment and `partitionClassCatalog`) with:

```js
// The /classes catalog's four sections, decided per version group by its
// primary and checked in this order. Pre-release comes first because it must
// win over book ownership: the Aspirant book's roster grants the six
// pre-release aspirant-section classes (util/starter-content.js). Artwork is
// release content and appears only for released classes covered by a book the
// viewer owns; the other sections stay art-free (views/classes.handlebars).
const partitionClassCatalog = (groups, bookClassIds = new Set()) => {
  const list = Array.isArray(groups) ? groups : [];
  const ownedReleases = [];
  const otherReleases = [];
  const prerelease = [];
  const pcc = [];
  for (const group of list) {
    const cls = group && group.primary;
    if (cls?.prerelease_section) prerelease.push(group);
    else if (isUnreleasedPcc(cls)) pcc.push(group);
    else if (bookClassIds.has(cls?.id)) ownedReleases.push(group);
    else otherReleases.push(group);
  }
  return { ownedReleases, otherReleases, prerelease, pcc };
};
```

Replace the whole of `docs/superpowers/specs/2026-08-17-class-list-partition-design.md` with:

```markdown
# Class List Page: Catalog Sections — Design

**Date:** 2026-08-17
**Status:** Approved

## Goal

The public class list page (`GET /classes`) sorts every class into one of four
sections, so the released classes a viewer owns come first and teasers and
unfinished player-created classes (PCCs) are kept apart from released content.
Only the viewer's own released classes show thumbnail art.

## Partition Rule

Classes are grouped into version families first (`groupClassVersions`), and each
group is placed by its primary (latest) member. The rules are checked in this
order, and a group lands in the first section whose rule it meets:

1. **Pre-release Classes** — `prerelease_section` is set (`pcc`, `exclusive` or
   `aspirant`), whatever the class's `status` and whether or not a book the
   viewer owns grants it. A pre-release class is the Enclave creator's teaser of
   an upcoming product: released Advent-format content at `rules_version 'v2'`.
   This rule comes first because the Aspirant book's roster
   (`CORE_CLASS_UNLOCKS.aspirant` in `util/starter-content.js`) grants the six
   pre-release aspirant-section classes.
2. **Player-Created Classes (PCCs)** — `is_player_created` is true and
   `status !== 'release'`. Only an unfinished PCC carries `alpha` or `beta`; a
   released PCC has been incorporated into the game and is a released class.
3. **Your Released Classes** — the primary's id is one a book the viewer owns
   grants (`getEffectiveClassUnlocks(...).bookIds`).
4. **Other Released Classes** — everything else.

For a viewer who owns only the Advent book: the six Advent classes (each at its
latest version) are under Your Released, the twelve ENCLAVE: Aspirant V1 classes
under Other Released, the twenty pre-release classes under Pre-release, and the
alpha and beta PCCs under PCCs. A signed-out visitor owns no book, so Your
Released is absent and the Advent six are under Other Released.

The profile page keeps its own two-way split (`partitionProfileClasses`,
`partitionClassGroups`): unreleased PCCs in one section, everything else in the
other.

## Where it lives

- `util/class-filter.js` — `partitionClassCatalog(groups, bookClassIds)` returns
  `{ ownedReleases, otherReleases, prerelease, pcc }`, preserving group order
  within each section. `isUnreleasedPcc` is the shared PCC predicate.
- `routes/classes.js` — `GET /` applies the filters, groups by version family
  (or, when a `rules_version` filter is set, shows each match flat), and
  partitions with the viewer's `bookIds`. Filters apply before partitioning.
- `views/classes.handlebars` — renders the four sections in the order Your
  Released, Other Released, Pre-release, PCCs, each (heading and card grid) only
  when non-empty, through `views/partials/class-group-card.handlebars`.
  `showImage` is true only for Your Released Classes.

## Testing

- `util/class-filter.test.js` pins the rule order, pre-release winning over book
  ownership and over status, and the Advent-book owner's sections.
- `views/classes.test.js` pins that only owned released cards render art.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/class-filter.test.js`
Expected: PASS, 0 fail (the `partitionProfileClasses` and `partitionClassGroups` blocks are untouched and still pass).

- [ ] **Step 5: Run the unit tier**

Run: `bun run test:unit`
Expected: 0 failed files (`views/classes.test.js` renders from a hand-built context and is unaffected).

- [ ] **Step 6: Commit**

```bash
git add util/class-filter.js util/class-filter.test.js docs/superpowers/specs/2026-08-17-class-list-partition-design.md
git commit -m "fix: list every pre-release class under Pre-release, ahead of book ownership

A class's status no longer makes it a teaser; its prerelease_section does.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Data migration — the twenty pre-release classes become released v2, pre-release PCCs player-created

**Depends on Task 2**: once this migration runs, the six aspirant-section parents are v2, and only Task 2's loader can still fork from them.

**Files:**
- Create: `supabase/migrations/20260922000000_prerelease_classes_v2.sql`
- Create: `util/prerelease-classes.integration.test.js`
- Modify: `scripts/run-tests.mjs:7-24` (`integrationFiles`)
- Modify: `docs/superpowers/specs/2026-09-16-aspirant-v1-ingestion-design.md:132-143`

**Interfaces:**
- Consumes: `classes.prerelease_section`, `classes.rules_version` (`CHECK IN ('v1','v2')`), `classes.status` (`CHECK IN ('alpha','beta','release')`), `classes.is_player_created`, trigger `update_classes_updated_at`.
- Produces: every row with `prerelease_section` set is `rules_version 'v2'`, `status 'release'`; every `'pcc'` row is `is_player_created true`.

Measured locally before this task (read-only): 20 rows have `prerelease_section` set, all `content_format 'advent'`, all `rules_version 'v1'`; 19 are already `status 'release'` and Charlatan is `'alpha'`; of the 11 `'pcc'` rows, 10 are `is_player_created true` and Charlatan is `false`.

- [ ] **Step 1: Write the failing integration test**

Create `util/prerelease-classes.integration.test.js`:

```js
// util/prerelease-classes.integration.test.js
//
// Requires the local Supabase stack: SUPABASE_URL=http://127.0.0.1:54321
//
// A pre-release class (prerelease_section set) is released Advent-format
// content at the latest Advent version, and one the document files under its
// PCC section is player-created. The class list, the loader and the character
// pages all read these columns, so a row that drifts from them is listed or
// played under the wrong rules. A stack seeded by util/seed-classes.js holds no
// pre-release row, and there both tests pass on an empty list.

require('./require-local-supabase');

const { test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const prereleaseRows = async () => {
  const { data, error } = await sb.from('classes')
    .select('id, name, prerelease_section, content_format, rules_version, status, is_player_created')
    .not('prerelease_section', 'is', null);
  expect(error).toBeNull();
  return data;
};

test('every pre-release class is released Advent content at v2', async () => {
  const off = (await prereleaseRows())
    .filter((row) => row.content_format !== 'advent' || row.rules_version !== 'v2' || row.status !== 'release')
    .map((row) => `${row.name} (${row.id}) is ${row.content_format} ${row.rules_version} ${row.status}`);
  expect(off).toEqual([]);
});

test('every pre-release PCC is player-created', async () => {
  const off = (await prereleaseRows())
    .filter((row) => row.prerelease_section === 'pcc' && !row.is_player_created)
    .map((row) => `${row.name} (${row.id})`);
  expect(off).toEqual([]);
});
```

Register it in `scripts/run-tests.mjs`'s `integrationFiles`, keeping the list sorted — insert after `'util/image-crop-integrity.integration.test.js',`:

```js
  'util/prerelease-classes.integration.test.js',
```

- [ ] **Step 2: Run it to verify it fails**

```bash
grep '^SUPABASE_URL' .env
eval "$(supabase status -o env)"
export SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY"
bun test util/prerelease-classes.integration.test.js
```

Expected: FAIL — the first test lists all 20 classes (`… is advent v1 release`, and `Charlatan (142151f8-…) is advent v1 alpha`); the second lists `Charlatan (142151f8-8081-490b-825b-77f3430bd2ce)`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260922000000_prerelease_classes_v2.sql`:

```sql
-- supabase/migrations/20260922000000_prerelease_classes_v2.sql
-- A pre-release class (prerelease_section set) is the Enclave creator's teaser
-- of an upcoming product. It is released Advent-format content recorded at the
-- latest Advent version, so it carries rules_version 'v2' and status 'release';
-- alpha and beta belong only to unfinished player-created classes. A class the
-- pre-release document files under its PCC section is player-created.
--
-- Characters on these classes are not converted: their v1-only text
-- (characters.perks, characters.additional_gear) stays stored, hidden on the
-- sheet, and can only be cleared from the edit form.
--
-- Each UPDATE matches only rows not already in the target state, so a second
-- run changes nothing. A stack seeded by util/seed-classes.js carries no
-- prerelease_section, so there this matches no row at all.

-- updated_at is trigger-owned and services/home/recent-feed.js sorts the
-- homepage feeds by it. Recording what these classes already are is not an
-- edit to them, so it must not surface them as recent activity.
ALTER TABLE public.classes DISABLE TRIGGER update_classes_updated_at;

UPDATE public.classes
SET rules_version = 'v2', status = 'release'
WHERE prerelease_section IS NOT NULL
  AND (rules_version IS DISTINCT FROM 'v2' OR status IS DISTINCT FROM 'release');

UPDATE public.classes
SET is_player_created = true
WHERE prerelease_section = 'pcc'
  AND is_player_created IS NOT TRUE;

ALTER TABLE public.classes ENABLE TRIGGER update_classes_updated_at;
```

- [ ] **Step 4: Rehearse it against a scratch copy of the local database**

Run: `bash scripts/rehearse-migrations.sh --source local --with-data`
Expected: the script reports `20260922000000_prerelease_classes_v2.sql` applied in its own transaction with no failure, and no RLS policy diff. (It dumps the local database read-only into a throwaway container on port 55432 and destroys it afterwards; the local stack is not touched. It needs Docker and takes a few minutes.)

- [ ] **Step 5: Snapshot `updated_at`, then apply the migration**

```bash
grep '^SUPABASE_URL' .env   # must print SUPABASE_URL="http://127.0.0.1:54321"
SCRATCH=/tmp/claude-1000/-home-dave-code-agent-resources/scratch-prerelease-v2; mkdir -p "$SCRATCH"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select id, updated_at from classes where prerelease_section is not null order by id" > "$SCRATCH/updated_at.before"
supabase migration up
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select id, updated_at from classes where prerelease_section is not null order by id" > "$SCRATCH/updated_at.after"
diff "$SCRATCH/updated_at.before" "$SCRATCH/updated_at.after" && echo "updated_at untouched"
```

Expected: `supabase migration up` prints `Applying migration 20260922000000_prerelease_classes_v2.sql...`; the diff is empty and prints `updated_at untouched`.

- [ ] **Step 6: Run the integration test to verify it passes, and prove a second run is a no-op**

Run (same shell as Step 2): `bun test util/prerelease-classes.integration.test.js`
Expected: PASS, 2 pass, 0 fail.

The migration's two `WHERE` clauses, counted read-only — a second run updates exactly these rows:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc "
select
  (select count(*) from classes where prerelease_section is not null
     and (rules_version is distinct from 'v2' or status is distinct from 'release')),
  (select count(*) from classes where prerelease_section = 'pcc' and is_player_created is not true)"
```

Expected: `0|0`.

- [ ] **Step 7: Update the ingestion design to state the current rule**

`docs/superpowers/specs/2026-09-16-aspirant-v1-ingestion-design.md:132-143`: replace

```
| row | `rules_edition` | `content_format` | `rules_version` |
| --- | --- | --- | --- |
| Gunslinger (Advent) | advent | advent | v1 → v2 |
| Berserker (pre-release) | aspirant | advent | v1 |
| Berserker (V1) | aspirant | aspirant | v1 |
| Gunslinger (Aspirant V1) | aspirant | aspirant | v1 |

`rules_version` is left alone. It is `CHECK (rules_version IN ('v1','v2'))`
(`supabase/migrations/20240101000000_baseline_schema.sql:132`) and means Advent's
v1/v2 character rules. Forking within `rules_edition = 'aspirant'` would
otherwise have to call V1 content `'v2'`, which inverts the meaning of both
values.
```

with

```
| row | `rules_edition` | `content_format` | `rules_version` |
| --- | --- | --- | --- |
| Gunslinger (Advent) | advent | advent | v1 → v2 |
| Berserker (pre-release) | aspirant | advent | v2 |
| Berserker (V1) | aspirant | aspirant | v1 |
| Gunslinger (Aspirant V1) | aspirant | aspirant | v1 |

`rules_version` is `CHECK (rules_version IN ('v1','v2'))`
(`supabase/migrations/20240101000000_baseline_schema.sql:132`) and means Advent's
v1/v2 character rules. A pre-release class is Advent-format content at the
latest Advent version, so every row with `prerelease_section` set is `'v2'` and
`status 'release'` (`supabase/migrations/20260922000000_prerelease_classes_v2.sql`),
and the pre-release loader inserts at `'v2'`. The twelve V1 rows are inserted at
`'v1'`: a class in the Aspirant format does not advance Advent's rules version,
and calling V1 content `'v2'` would invert the meaning of both values.
```

- [ ] **Step 8: Run the integration tier**

Run (same shell): `bun run test:integration`
Expected: failures are exactly the known reds (`util/character-content-integrity`, `util/class-form-round-trip`, `util/image-crop-integrity`), compared by test name. `util/prerelease-classes.integration.test.js` passes.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260922000000_prerelease_classes_v2.sql util/prerelease-classes.integration.test.js scripts/run-tests.mjs docs/superpowers/specs/2026-09-16-aspirant-v1-ingestion-design.md
git commit -m "feat: record every pre-release class as released v2 content

Pre-release classes in the PCC section are player-created.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Save — a v2 save clears a deprecated field only on its clear flag

**Files:**
- Modify: `services/character/input.js:29-30` and `:535-540`
- Test: `services/character/input.test.js` (after the test at `:57-73`)
- Test: `models/character-atomic.integration.test.js` (append)

**Interfaces:**
- Consumes: `V1_ONLY_FIELDS = ['perks', 'additional_gear']`; `normalizeCharacterInput(input, { rulesVersion })`.
- Produces: form fields `clear_perks` and `clear_additional_gear` (value `'on'`, as an HTML checkbox submits). For `rulesVersion 'v2'`, a flag set to `'on'` puts `data[field] = null`; without it the key is absent. The flag keys never survive normalization, for any rules version. Task 6's partial submits these names.

- [ ] **Step 1: Write the failing unit tests**

In `services/character/input.test.js`, after `test('normalizes v2 fields and strips legacy free-text fields', …)`, add:

```js
// A v2 character keeps the v1-only text it carried before its class became v2.
// An absent key is what preserves it (save_character_atomic keeps the stored
// value); a null is what clears it, and only a clear flag produces one.
test('a v2 save turns a submitted clear flag into a null for that field only', () => {
  const result = normalizeCharacterInput({ clear_perks: 'on' }, { rulesVersion: 'v2' });

  expect(result.error).toBeNull();
  expect(result.data.perks).toBeNull();
  expect(result.data).not.toHaveProperty('additional_gear');
  expect(result.data).not.toHaveProperty('clear_perks');
});

test('a v2 save never carries a submitted value into a deprecated field', () => {
  const result = normalizeCharacterInput({
    perks: 'rewritten', additional_gear: 'rewritten', clear_additional_gear: 'on'
  }, { rulesVersion: 'v2' });

  expect(result.error).toBeNull();
  expect(result.data).not.toHaveProperty('perks');
  expect(result.data.additional_gear).toBeNull();
  expect(result.data).not.toHaveProperty('clear_additional_gear');
});

test('a v1 save ignores the clear flags and keeps its editable text', () => {
  const result = normalizeCharacterInput({
    perks: 'kept', additional_gear: 'kept gear', clear_perks: 'on', clear_additional_gear: 'on'
  }, { rulesVersion: 'v1' });

  expect(result.error).toBeNull();
  expect(result.data.perks).toBe('kept');
  expect(result.data.additional_gear).toBe('kept gear');
  expect(result.data).not.toHaveProperty('clear_perks');
  expect(result.data).not.toHaveProperty('clear_additional_gear');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/character/input.test.js`
Expected: FAIL — `a v2 save turns a submitted clear flag…` (`perks` is `undefined`, and `clear_perks` is present), `a v2 save never carries…` (`additional_gear` `undefined`), `a v1 save ignores the clear flags…` (`clear_perks` present).

- [ ] **Step 3: Implement**

`services/character/input.js`, after `const V1_ONLY_FIELDS = ['perks', 'additional_gear'];` (`:30`), add:

```js
const clearFlag = (field) => `clear_${field}`;
```

In `normalizeCharacterInput`, directly after the existing strip (`:540`,
`for (const field of rulesVersion === 'v2' ? V1_ONLY_FIELDS : V2_ONLY_FIELDS) delete data[field];`), add:

```js
  // A v2 character keeps the v1-only text it had before its class became v2:
  // the strip above leaves the key absent, which save_character_atomic reads as
  // "keep what is stored". A clear flag from the edit form's Deprecated fields
  // section is the one way to change it, and only to null.
  for (const field of V1_ONLY_FIELDS) {
    if (rulesVersion === 'v2' && data[clearFlag(field)] === 'on') data[field] = null;
    delete data[clearFlag(field)];
  }
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/character/input.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 5: Write the integration tests (the null must reach the column)**

Append to `models/character-atomic.integration.test.js`:

```js
// A class that becomes v2 does not convert its characters: their v1-only text
// stays stored, and the only change a v2 save may make to it is clearing it
// (services/character/input.js). Through the whole path -- updateCharacter,
// saveCharacterAtomic, save_character_atomic -- an absent key must keep the
// stored value and a JSON null must write NULL, because the RPC's UPDATE reads
// jsonb_populate_record(saved, p_character) with no COALESCE on either column.
// v2Class carries rules_version 'v2', so the service strips both fields.
const storeDeprecatedFields = async (characterId) => {
  await db.query('update characters set perks = $1, additional_gear = $2 where id = $3',
    ['Old perk prose', 'Old gear prose', characterId]);
};

const deprecatedFields = async (characterId) => {
  const { rows } = await db.query(
    'select perks, additional_gear from characters where id = $1', [characterId]
  );
  return rows[0];
};

test('a v2 save clears a deprecated field only when its clear flag is submitted', async () => {
  await setup();
  const name = `Atomic deprecated clear ${suffix}`;
  const { data: created, error: createError } = await createCharacter(v2Input(name), profile);
  expect(createError).toBeNull();
  await storeDeprecatedFields(created.id);

  const { error } = await updateCharacter(created.id, {
    ...v2Input(name), id: created.id, clear_perks: 'on'
  }, profile);
  expect(error).toBeFalsy();

  expect(await deprecatedFields(created.id))
    .toEqual({ perks: null, additional_gear: 'Old gear prose' });
});

test('a v2 save never writes a submitted deprecated field', async () => {
  await setup();
  const name = `Atomic deprecated keep ${suffix}`;
  const { data: created, error: createError } = await createCharacter(v2Input(name), profile);
  expect(createError).toBeNull();
  await storeDeprecatedFields(created.id);

  const { error } = await updateCharacter(created.id, {
    ...v2Input(name), id: created.id,
    perks: 'Rewritten perk prose', additional_gear: 'Rewritten gear prose'
  }, profile);
  expect(error).toBeFalsy();

  expect(await deprecatedFields(created.id))
    .toEqual({ perks: 'Old perk prose', additional_gear: 'Old gear prose' });
});
```

- [ ] **Step 6: Run the integration file**

```bash
grep '^SUPABASE_URL' .env
eval "$(supabase status -o env)"
export SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY"
bun test models/character-atomic.integration.test.js
```

Expected: PASS, 0 fail. Teeth check (revert after): temporarily delete the `if (rulesVersion === 'v2' …) data[field] = null;` line and re-run — `a v2 save clears a deprecated field only when its clear flag is submitted` must fail with `perks: "Old perk prose"`. Restore. (`a v2 save never writes a submitted deprecated field` pins behaviour that already holds; it passes before and after.)

- [ ] **Step 7: Run the unit tier**

Run: `bun run test:unit`
Expected: 0 failed files.

- [ ] **Step 8: Commit**

```bash
git add services/character/input.js services/character/input.test.js models/character-atomic.integration.test.js
git commit -m "feat: let a v2 save clear a character's deprecated perks or additional gear

A submitted clear flag is the only way a v2 save changes either field.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Edit form — the "Deprecated fields" section; the sheet pinned

**Files:**
- Create: `views/partials/character-deprecated-fields.handlebars`
- Delete: `views/partials/character-v1-perks-legacy.handlebars`
- Modify: `views/character-form.handlebars:352-357`
- Modify: `docs/superpowers/specs/2026-09-20-aspirant-v1-perk-economy-design.md:118-120`
- Test: `views/character-form.test.js:518-529` (`renderCharacterForm`) and append
- Test: `views/character.test.js` (append)
- Test: `routes/characters.test.js` (append)

**Interfaces:**
- Consumes: `clear_perks`, `clear_additional_gear` (Task 5); `effectiveVersion` from `GET /characters/:id/edit` (`routes/characters.js:432-439`, `'v2'` when the stored class's `rules_version` is `'v2'`).
- Produces: `{{> character-deprecated-fields character=character}}`, rendered by the form only in its v2 branch; the partial renders nothing unless `character.perks` or `character.additional_gear` is non-empty.

- [ ] **Step 1: Write the failing view tests**

`views/character-form.test.js`, in `renderCharacterForm` (`:518-529`), change the hard-coded `effectiveVersion: 'v1',` to:

```js
    effectiveVersion: overrides.effectiveVersion ?? 'v1',
```

Append to `views/character-form.test.js`:

```js
// --- Deprecated fields -------------------------------------------------------
//
// A character whose class became v2 keeps its v1-only text. The edit form shows
// each non-empty field read-only with a clear control, and nothing else can
// change it (services/character/input.js).

const DEPRECATED = { perks: 'Old perk prose', additional_gear: 'Old gear prose' };

test('a v2 character sees its stored v1-only text as read-only Deprecated fields', () => {
  const html = renderCharacterForm({ effectiveVersion: 'v2', character: DEPRECATED });

  expect(html).toContain('Deprecated fields');
  expect(html).toContain('Old perk prose');
  expect(html).toContain('Old gear prose');
  expect(html).toMatch(/<input type="checkbox" name="clear_perks"/);
  expect(html).toMatch(/<input type="checkbox" name="clear_additional_gear"/);
  expect(html).not.toMatch(/name="perks"/);
  expect(html).not.toMatch(/name="additional_gear"/);
});

test('a v2 character is offered a clear control only for a field it has', () => {
  const html = renderCharacterForm({ effectiveVersion: 'v2', character: { perks: 'Old perk prose' } });

  expect(html).toContain('name="clear_perks"');
  expect(html).not.toContain('name="clear_additional_gear"');
});

test('a v2 character with neither field sees no Deprecated fields section', () => {
  const html = renderCharacterForm({ effectiveVersion: 'v2', character: { perks: '', additional_gear: null } });

  expect(html).not.toContain('Deprecated fields');
});

test('a v1 character edits its perks as before and sees no Deprecated fields section', () => {
  const html = renderCharacterForm({ character: DEPRECATED });

  expect(html).not.toContain('Deprecated fields');
  expect(html).toMatch(/<textarea[^>]*name="perks"/);
  expect(html).toMatch(/<textarea[^>]*name="additional_gear"/);
});
```

Append to `views/character.test.js` (after the existing helpers, which it reuses: `CHARACTER_SRC`, `Handlebars`, `hbsHelpers`, `customHelpers`, `renderMarkdown`, `renderPowerRatings`, `registerSignatureEntryPartials`):

```js
// -- v1-only fields on a v2 character ---------------------------------------
//
// A character whose class became v2 keeps its v1-only text stored. The sheet
// shows none of it; views/partials/character-details.test.js pins the same for
// the /details fragment.
const renderFromPerksToAppearance = (locals) => {
  const section = CHARACTER_SRC.slice(
    CHARACTER_SRC.indexOf("{{#if (eq effectiveVersion 'v1')}}"),
    CHARACTER_SRC.indexOf('{{#if character.appearance}}')
  );
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('markdown', renderMarkdown);
  hb.registerHelper('powerRatings', renderPowerRatings);
  registerSignatureEntryPartials(hb);
  return hb.compile(section)(locals);
};

test('a v2 character sheet shows none of its stored v1-only text', () => {
  const character = {
    perks: 'Old perk prose', additional_gear: 'Old gear prose',
    gear: [], common_items: [], quirks: [], accessories: [], ability_perks: [], abilities: []
  };

  const v2 = renderFromPerksToAppearance({ character, effectiveVersion: 'v2' });
  expect(v2).not.toContain('Old perk prose');
  expect(v2).not.toContain('Old gear prose');

  // The same slice at v1 shows both, so the v2 assertions above are not
  // passing on a slice that simply misses the fields.
  const v1 = renderFromPerksToAppearance({ character, effectiveVersion: 'v1' });
  expect(v1).toContain('Old perk prose');
  expect(v1).toContain('Old gear prose');
});
```

- [ ] **Step 2: Run them to verify the new form tests fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test views/character-form.test.js views/character.test.js`
Expected: FAIL — `a v2 character sees its stored v1-only text as read-only Deprecated fields` and `a v2 character is offered a clear control only for a field it has` (no `Deprecated fields`, no `clear_*` inputs; the form renders the "Legacy perks (v1)" block instead). The two "no section" form tests and the sheet test PASS already: the sheet test pins existing behaviour (teeth check: temporarily change `{{#if (eq effectiveVersion 'v1')}}` above the sheet's Ability Perks box to `'v2'` and see it fail; restore).

- [ ] **Step 3: Write the failing HTTP test**

Append to `routes/characters.test.js`:

```js
// GET /characters/:id/edit resolves effectiveVersion from the character's
// stored class; a v2 class must reach the form's Deprecated fields section.
test('the edit form shows a v2 character its stored v1-only text as Deprecated fields', async () => {
  pageState.character = {
    ...makePageCharacter(0),
    class: V2_RULES_CLASS.name,
    class_id: V2_RULES_CLASS.id,
    creator_id: 'profile-1',
    perks: 'Old perk prose',
    additional_gear: 'Old gear prose',
  };

  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('Deprecated fields');
  expect(body).toContain('Old perk prose');
  expect(body).toContain('name="clear_perks"');
  expect(body).toContain('name="clear_additional_gear"');
  expect(body).not.toMatch(/<textarea[^>]*name="perks"/);
  expect(body).not.toMatch(/<textarea[^>]*name="additional_gear"/);
});
```

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/characters.test.js`
Expected: FAIL — that test only (`Deprecated fields` not found).

- [ ] **Step 4: Implement**

Create `views/partials/character-deprecated-fields.handlebars`:

```handlebars
{{!-- A v2 class has no free-text Ability Perks or Additional Gear. A character
      that had them before its class became v2 keeps them stored: each is shown
      here read-only, and its checkbox is the only change a save can make to it
      (services/character/input.js reads clear_<field>). --}}
{{#if (or character.perks character.additional_gear)}}
<hr />
<div class="box" id="deprecated-fields">
  <h3 class="title is-5">Deprecated fields</h3>
  <p class="help mb-3">These fields belong to this class's earlier rules. They can no longer be edited, only cleared.</p>
  {{#if character.perks}}
  <div class="field">
    <label class="label">Ability Perks</label>
    <div class="content">{{{markdown character.perks}}}</div>
    <label class="checkbox">
      <input type="checkbox" name="clear_perks" value="on">
      Clear Ability Perks when saving
    </label>
  </div>
  {{/if}}
  {{#if character.additional_gear}}
  <div class="field">
    <label class="label">Additional Gear</label>
    <div class="content">{{{markdown character.additional_gear}}}</div>
    <label class="checkbox">
      <input type="checkbox" name="clear_additional_gear" value="on">
      Clear Additional Gear when saving
    </label>
  </div>
  {{/if}}
</div>
{{/if}}
```

`views/character-form.handlebars:352-357`: replace

```handlebars
    {{#if (eq effectiveVersion 'v2')}}
      {{> character-v2-fields character=character perkFigures=perkFigures}}
      {{> character-v1-perks-legacy character=character}}
    {{else}}
```

with

```handlebars
    {{#if (eq effectiveVersion 'v2')}}
      {{> character-v2-fields character=character perkFigures=perkFigures}}
      {{> character-deprecated-fields character=character}}
    {{else}}
```

Delete the replaced partial:

```bash
git rm views/partials/character-v1-perks-legacy.handlebars
grep -rn "character-v1-perks-legacy" views routes util services public
```

The grep must print nothing.

`docs/superpowers/specs/2026-09-20-aspirant-v1-perk-economy-design.md:118-120`: replace

```
- **The legacy `characters.perks` TEXT field** is v1-only freeform prose,
  already read-only on v2 (`views/partials/character-v1-perks-legacy.handlebars`).
  It stays out of the economy entirely.
```

with

```
- **The legacy `characters.perks` TEXT field** is v1-only freeform prose,
  read-only and clear-only on v2 (`views/partials/character-deprecated-fields.handlebars`).
  It stays out of the economy entirely.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test views/character-form.test.js views/character.test.js routes/characters.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 6: Run the unit and HTTP tiers**

Run: `bun run test:unit`
Expected: 0 failed files.

Run: `bun run test:http`
Expected: exactly one failed file, `routes/open-graph.test.js` (known red).

- [ ] **Step 7: Commit**

```bash
git add views/partials/character-deprecated-fields.handlebars views/character-form.handlebars views/character-form.test.js views/character.test.js routes/characters.test.js docs/superpowers/specs/2026-09-20-aspirant-v1-perk-economy-design.md
git commit -m "feat: show a v2 character's stored v1 text as clear-only Deprecated fields

The character sheet keeps hiding both fields for v2, now pinned by test.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(`git rm` in Step 4 already staged the deleted partial.)

---

### Task 7: Local verification

No code changes. This task proves the whole plan on the local stack; nothing is committed unless a step fails and is fixed by returning to its task.

**Files:** none.

**Interfaces:**
- Consumes: every earlier task.
- Produces: evidence, pasted into the hand-off report.

- [ ] **Step 1: Confirm the target and the migration ledger**

```bash
grep '^SUPABASE_URL' .env    # must print SUPABASE_URL="http://127.0.0.1:54321"
supabase migration up
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select version from supabase_migrations.schema_migrations order by version desc limit 1"
```

Expected: `supabase migration up` reports the local database is up to date (Task 4 applied it); the query prints `20260922000000`.

- [ ] **Step 2: Prove the twenty pre-release rows are released v2 Advent content**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "
select content_format, rules_version, status, count(*) as classes,
       count(*) filter (where prerelease_section = 'pcc') as pcc,
       count(*) filter (where prerelease_section = 'pcc' and is_player_created) as pcc_player_created
from classes where prerelease_section is not null
group by 1, 2, 3"
```

Expected, exactly one row:
```
 content_format | rules_version | status  | classes | pcc | pcc_player_created
----------------+---------------+---------+---------+-----+--------------------
 advent         | v2            | release |      20 |  11 |                 11
```

- [ ] **Step 3: Re-run the pre-release load with --apply**

Run: `bun run scripts/load-prerelease-classes.mjs --book prerelease --apply 2>&1 | grep -v '^  \|^$' | tail -30`
Expected (the UPDATE headings above these are omitted by the grep):
```
20 classes resolved (20 update, 0 create), 0 ambiguous
0 of 20 existing rows differ
0 classes updated
0 classes written
```
followed by fifteen `remap … : 0 rows` lines, `15 remaps applied, 0 character rows renamed`, and five lines `already published: Ardent (…)`, `Offdriver`, `Squire`, `Drachentöter`, `Charlatan`. Exit status 0 (`echo $?` after running it unpiped).

- [ ] **Step 4: Re-run the Aspirant V1 load**

Run: `bun run load:aspirant-v1 2>&1 | grep -v '^  \|^$' | tail -20`
Expected:
```
12 classes resolved (12 update, 0 create, 0 fork), 0 ambiguous
0 of 12 existing rows differ
0 classes updated
0 classes written
0 remaps applied, 0 character rows renamed
```
then twelve `already published: …` lines. Exit status 0.

- [ ] **Step 5: Check /classes as a signed-out visitor**

If the dev server was started before these commits, restart it (`bun run dev`) so it serves the new code. Then:

```bash
SCRATCH=/tmp/claude-1000/-home-dave-code-agent-resources/scratch-prerelease-v2; mkdir -p "$SCRATCH"
curl -s http://localhost:3000/classes -o "$SCRATCH/classes.html"
grep -o 'id="\(owned-released-classes\|released-classes\|prerelease-classes\|player-created-classes\)"' "$SCRATCH/classes.html"
CLASSES_HTML="$SCRATCH/classes.html" bun -e '
const html = require("fs").readFileSync(process.env.CLASSES_HTML, "utf8");
const grids = ["classList", "otherClassList", "prereleaseClassList", "pccClassList"];
for (const grid of grids) {
  const start = html.indexOf(`id="${grid}"`);
  if (start === -1) { console.log(`${grid}: absent`); continue; }
  const ends = grids.map((g) => html.indexOf(`id="${g}"`, start + 1)).filter((i) => i > start);
  const section = html.slice(start, ends.length ? Math.min(...ends) : html.length);
  const names = [...section.matchAll(/<h5 class="title is-5"><a href="\/classes\/[0-9a-f-]{36}\/([^"]+)">/g)]
    .map((m) => m[1]);
  console.log(`${grid}: ${names.length} -> ${names.sort().join(", ")}`);
}'
```

Expected: the heading grep prints `id="released-classes"`, `id="prerelease-classes"`, `id="player-created-classes"` and not `id="owned-released-classes"` (a signed-out visitor owns no book). The section script prints:
```
classList: absent
otherClassList: 18 -> Berserker, Freerunner, Gunslinger, Gunslinger, Illusionist, Illusionist, Infiltrator, Librarian, Librarian, Samaritan, Thane, Thane, Thunderbird, Thunderbird, Vessel, Wanderer, Wanderer, Witchfinder
prereleaseClassList: 20 -> Ardent, Beastmaster, Berserker, Bogatyr, Brainiac, Charlatan, Drachentöter, Freerunner, Greybeard, Infiltrator, Lithomancer, Oddball, Offdriver, Raubritter, Samaritan, Shōnen, Squire, Vessel, Witchfinder, Zoologist
pccClassList: 17 -> Buccaneer, Demolitionist, Fortean, Guardian, Handler, Hotshot, Inventor, Jinx, Linguist, Mechanist, Onmyōji, Pursuer, Pyroclast, Ratcatcher, Swindler, The Pressure - Hydraulist, Vizier
```
`otherClassList` is the six Advent names twice (each Advent family at its v2 primary, and its Aspirant V1 fork) and the six Aspirant-only names once (their V1 forks). The PCC list was measured on 2026-09-22 and moves with the restored data; what must hold is 17 cards and none of the twenty pre-release names. Before this plan the same script printed `otherClassList: 37` (the twenty pre-release classes mixed in with the eighteen, less Charlatan) and `prereleaseClassList: 1 -> Charlatan`.

Cross-check the PCC count against the database (the public, unreleased, non-pre-release player-created family leaves):

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc "
select count(*) from classes c
where c.is_public and c.is_player_created and c.status <> 'release' and c.prerelease_section is null
  and not exists (select 1 from classes k where k.base_class_id = c.id and k.is_public
                  and k.rules_edition = c.rules_edition)"
```

Expected: `17`.

- [ ] **Step 6: Run every tier once more**

```bash
bun run test:unit
bun run test:http
eval "$(supabase status -o env)"
export SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY"
bun run test:integration
```

Expected: unit 0 failed files; http exactly `routes/open-graph.test.js`; integration exactly the three known-red files, by test name.

- [ ] **Step 7: Report**

Paste into the hand-off: the Step 2 row, the Step 3 and Step 4 summary lines, the Step 5 section script output and the Step 6 failure lists.

---

## Self-Review

**Decision coverage.**
1. Pre-release = released Advent v2 → Task 4 (data), Task 1 (future inserts), Task 4 integration test (census incl. `content_format 'advent'`).
2. Aspirant relation / exclusives → "Not in this plan".
3. Catalog order → Task 3 (pre-release first; PCC; owned; other), with the Advent-owner outcome pinned in a unit test and the signed-out outcome checked in Task 7. Profile partitions unchanged (stated in File Structure).
4. v2 characters → sheet pinned (Task 6), Deprecated fields section (Task 6), save semantics (Task 5), RPC traced and no migration needed (File Structure, proven by Task 5's integration test).
5. Loader → Task 1 (status, per-book rules version, PCC player-created, reversed tests), Task 2 (fork parent by roster id, fresh-production shape pinned in "a first load forks all twelve…").
6. Migration → Task 4 (idempotent predicates, trigger disabled, `updated_at` diff, rehearsal, `supabase migration up`, never `db reset`).
Docs → ingestion design (Tasks 2 and 4), partition design (Task 3), README (Task 2), perk-economy design path (Task 6).

**Placeholder scan.** No TBDs; every code step carries its code, every run step its command and expected output.

**Name consistency.** `insertRow(plan, book)`, `publishPatch(row, book)`, `reportPlan(plans, book)`, `forkParentId(name)`, `PARENT_IDS`, `parentRow`, `clear_perks`/`clear_additional_gear`, `character-deprecated-fields` are used with the same spelling in every task that names them. `book.rulesVersion` is defined in Task 1 and read only by `insertOnly`.
