> Version semantics superseded by the [October 1 design](../specs/2026-10-01-edition-version-and-leveling-design.md): `rules_version` means version within the edition. Aspirant v1 uses Advent v2 mechanics.

# Convert to Aspirant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every Aspirant-format class on the v2 character rules (Part 1), then let an owner move their Advent character onto its class's Aspirant fork in one atomic, one-way save that keeps the whole build (Part 2).

**Architecture:** Part 1 is a data migration plus the three code paths that write or assume `classes.rules_version` for Aspirant-format classes (loader, class import, the two client-side Perk balances). Part 2 adds a pure planner, `util/aspirant-conversion.js`, which remaps a character's Signatures, Abilities and Ability Perks onto the Aspirant forks and judges the result with the validators that already exist. `CharacterService` loads the character and catalogue through the adapter, runs the planner, and either refuses with the blocker list or saves through `save_character_atomic`. The edit page shows the same plan as a panel with one htmx button.

**Tech Stack:** Bun, `bun:test`, Express 4, express-handlebars, htmx, jsdom (client tests), Supabase/Postgres (PostgREST, `supabase` CLI, `pg`).

**Spec:** `docs/superpowers/specs/2026-09-28-convert-to-aspirant-design.md` (read it in full before starting any task; every task argues from it).

## Global Constraints

- **Order.** Tasks 1-3 are Part 1 and land first; Tasks 4-9 are Part 2. Task 10 is the user's production rollout, not an agent task.
- **NEVER run `supabase db reset`.** The local database holds a restored production copy. Apply the migration with `supabase migration up` only.
- **`.env` may point at PRODUCTION**, and bun loads `.env` automatically. Before any step that writes to a database, run `grep '^SUPABASE_URL' .env`; it must print `SUPABASE_URL="http://127.0.0.1:54321"`. The commands below override the variables explicitly anyway; never drop the override.
- **Unit tier:** `bun run test:unit` (scrubs `SUPABASE_URL`). `scripts/run-tests.mjs` has no file filter. The single-file form copies the env the runner sets:
  ```bash
  env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test <file>
  ```
  Never plain `bun test <file>`.
- **HTTP tier:** `routes/characters.test.js` is in `httpFiles`; run the tier with `bun run test:http`, or the single-file form above.
- **Integration tier:** credentials come from the running local stack, never `.env`, in one shell invocation:
  ```bash
  eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test <file>
  eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun run test:integration
  ```
  Every new integration file `require`s `util/require-local-supabase` as its first statement and is added to `integrationFiles` in `scripts/run-tests.mjs`.
- **Local data may predate Aspirant content.** Before Task 1, check `psql "$DB_URL" -Atc "select count(*) from classes where content_format='aspirant'"` (after `eval "$(supabase status -o env)"`). At plan time it was 12, all at `v1`. Integration tests create their own class and character fixtures and never depend on restored rows; only Task 1's census test reads the real catalogue.
- **Known reds (compare by file and test name, never by count):** `test:unit` 0 failures; `test:http` exactly `routes/open-graph.test.js`; `test:integration` exactly `util/character-content-integrity` (1), `util/class-form-round-trip` (1 of 3), `util/image-crop-integrity` (2). Anything else red is yours.
- **Production is the user's.** `supabase db push --linked` and `scripts/reconcile-character-progress.js --apply` against production are Task 10, run by the user. No agent runs them.
- **No dead code.** When you replace something, delete what it replaced in the same change: no commented-out blocks, no fallbacks, no `_old` copies.
- **Comments** only where the code cannot carry the meaning; they explain a non-obvious why and describe the code as it is now. Never history ("was X, now Y", "no longer", "used to").
- **Match surrounding idiom:** `{ data, error }` returns, `{ status, message }` business errors, `ok(...)` adapter stubs in `services/character/service.test.js`.
- **TDD per task:** red (run it and see the stated failure), green (minimum code), refactor (tests stay green).
- **Commits:** one per task, staging only the files the task names (`git add <paths>`, never `-A` or `.`). Repo style (`feat: …`, `fix: …`, `test: …`, lower-case imperative). Every message ends with a blank line and then:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## Review Focus

The five inputs the spec implies but does not spell out that are most likely to hurt a real player, and the behavior a reasonable player expects. Each has a test in the task named.

1. **Duplicate-named items** (Caroline Denton really holds two `Revolver` rows): both convert and both survive the save, because `save_character_atomic` pairs rows by `(class_id, name, occurrence)`. Task 5 (unit: both remapped), Task 9 (integration: two fork rows after the RPC).
2. **A compound Perk whose parent is on a different Ability**: conversion is not refused and the Perk survives as a plain Perk; a same-Ability compound keeps its link. `getCharacterAdmin` already reads a cross-Ability link as `null`, so every ordinary save drops it too. Task 5 (unit: same-Ability link preserved), Task 9 (integration: cross-Ability link saved as a plain Perk).
3. **A cross-class item stored on an Advent v2 row versus a v1 row, or already on an Aspirant-format class**: v1 and v2 rows both reach their class's fork through the version family; an item already on an Aspirant-format class stays where it is. Task 4 (fork from v1 and v2), Task 5 (Satchel on Wanderer v2, Familiar Face on Wanderer v1, an item already on the Wanderer fork).
4. **A stale edit page posts Convert after the character was already converted**: 400 with the reason ("not on the Advent rules"), nothing saved. Task 7 (service), Task 9 (integration: a second conversion is refused).
5. **Name mismatch by whitespace or case** between a character row and the fork's catalogue (`" revolver "` against `Revolver`): it matches, and the fork's own spelling is written, so the next save resolves it. Task 5 (unit).

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `supabase/migrations/20260928000003_aspirant_classes_v2_rules.sql` (create) | Every aspirant-format class to `rules_version 'v2'`, `updated_at` untouched. | 1 |
| `util/aspirant-classes-v2.integration.test.js` (create) | Census: no aspirant-format class off `v2`. | 1 |
| `scripts/lib/books.mjs` (modify) | Aspirant V1 book inserts at `v2`. | 1 |
| `test/load-prerelease-classes.test.js` (modify) | Pins the loader's `v2` insert. | 1 |
| `util/class-import.js`, `util/class-import.test.js` (modify) | An aspirant-format import is `v2`. | 1 |
| `scripts/run-tests.mjs` (modify) | Registers the three new integration files. | 1, 3, 9 |
| `public/js/character-wizard.js`, `test/character-wizard-client.test.js` (modify) | `perksSpent` counts the attached Ability Perk. | 2 |
| `public/js/character-ability-purchases.js`, `test/character-ability-purchases.test.js` (modify) | The purchase balance counts the live Perk editor's rows. | 2 |
| `util/ability-purchase-data.js`, `util/ability-purchase-data.test.js` (modify) | Drops the page-load Ability-Perk snapshot. | 2 |
| `models/character-aspirant-rules.integration.test.js` (create) | An aspirant-format v2 character keeps its v2 fields and levels on the v2 curve. | 3 |
| `docs/superpowers/specs/2026-09-16-aspirant-v1-ingestion-design.md` (modify) | The `rules_version` paragraph restated. | 3 |
| `util/aspirant-conversion.js`, `util/aspirant-conversion.test.js` (create) | `findAspirantFork`, `planConversion`. | 4, 5, 6 |
| `services/character/repository.js` (modify) | `getConversionClasses`. | 7 |
| `services/character/service.js`, `services/character/service.test.js` (modify) | `convertToAspirant`, `planAspirantConversion`. | 7 |
| `test/character-wizard-client.test.js` (modify) | Its hand-built adapter lists the new required method. | 7 |
| `models/character.js` (modify) | `convertCharacterToAspirant`, `planCharacterAspirantConversion`. | 7 |
| `routes/characters.js`, `routes/characters.test.js` (modify) | `POST /:id/convert-aspirant`; the edit route computes the panel. | 8 |
| `views/character-form.handlebars` (modify) | The conversion panel. | 8 |
| `models/character-convert-aspirant.integration.test.js` (create) | End-to-end conversion against the real RPC. | 9 |

Not touched, and why:
- `supabase/migrations/*save_character_atomic*`: the latest definition (`20260921000001_save_character_atomic_aspiring_abilities.sql`) already does everything conversion needs. `p_character` is merged over the stored row (`jsonb_populate_record(saved, p_character)`), so a payload of `{ class_id, class, creator_mode }` leaves every other column alone; gear and abilities are paired by `(class_id, name, occurrence)`, so changing `class_id` deletes and re-inserts the row; a perk with `class_ability_id: null` and `ability_name` resolves to the re-inserted ability; a `compounds_with: 'position-<n>'` link is resolved on the same ability afterwards. One trap it sets: `p_traits` is read through `COALESCE(p_traits, '[]')`, so omitting traits deletes them. Task 7 resubmits them and pins it.
- `level_up_character_atomic`, `util/class-family.js`, `findUpgradeTargetsFor`: none read `rules_version` for the decisions this changes (spec, "Not affected").
- Merx: flat per-mission reward, grants keyed by economy (spec).

## Decisions this plan takes where the spec is silent or the code forced a choice

1. **The edit route calls `planCharacterAspirantConversion(actor, id)`** rather than calling `planConversion` on the data the route already loaded. The spec both names a service preview method "sharing the loading code" and says the route "computes the plan with the character data it already loads"; the two cannot both hold without either duplicating the eligibility/catalogue logic in the route or leaving the service method unused (dead code). Going through the service guarantees the preview is judged on exactly the inputs `convertToAspirant` judges the POST on. Cost: one extra admin character load on the edit page.
2. **`planConversion` also takes `realMissions` and `offscreenMissions`.** The spec's signature omits them, but its Merx breakdown ("the preview shows what the sheet will show afterwards") cannot be derived without them.
3. **Name matching is trimmed and case-insensitive**, and the fork's catalogue spelling is what gets written. The spec says "trimmed name"; case-folding is the Review Focus requirement and costs nothing.
4. **An item already on an Aspirant-format class is kept as it is**, not remapped and not blocked. It is already Aspirant content.
5. **The Signature Cap counts only the items that convert.** An item with no counterpart must be removed anyway, so counting it would state a cap overage that removing it fixes.
6. **`util/class-import.js` forces `v2` for an aspirant-format import**, even if the writeup says `v1`. The spec says "defaults … so a re-imported Aspirant class cannot land on v1"; only forcing makes "cannot" true, and under the new definition `v1` is not a valid value for that format.
7. **Ineligible is decided by economy and fork, then blockers.** A class-less character (`class_id` null) has no fork. The two ineligible messages are "`<name>` is not on the Advent rules, so there is nothing to convert." and "`<class>` has no Aspirant version."
8. **Two ability rows that remap to the same fork ability name** (for example Trickshot held from both Gunslinger v1 and v2) both convert; their Perks attach to the first row, exactly as the ordinary save path's by-name remap already does. Not a blocker; out of the spec's scope.

---

## Part 1 — Aspirant-format classes use the v2 character rules

### Task 1: Migration, loader and class import put Aspirant-format classes on v2

**Files:**
- Create: `supabase/migrations/20260928000003_aspirant_classes_v2_rules.sql`
- Create: `util/aspirant-classes-v2.integration.test.js`
- Modify: `scripts/run-tests.mjs:7-26` (`integrationFiles`)
- Modify: `scripts/lib/books.mjs:43-47`
- Modify: `test/load-prerelease-classes.test.js:699-731`
- Modify: `util/class-import.js:90` (schema description), `:240` (`rules_version`)
- Test: `util/class-import.test.js` (after `content_format defaults to advent`, `:261-264`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: every row with `content_format = 'aspirant'` has `rules_version = 'v2'` locally; `BOOKS['aspirant-v1'].rulesVersion === 'v2'`; `processClassImport` hands `createClass` `rules_version: 'v2'` whenever `content_format === 'aspirant'`.

- [ ] **Step 1: Write the failing unit tests**

In `test/load-prerelease-classes.test.js`, change the FORK-heading test (`:699-707`) to expect `v2`:

```js
test('reportPlan prints the FORK heading with the class name and parent id', () => {
  const plan = {
    payload: { name: 'Berserker' }, row: null, parent: { id: 'parent-id-1' },
    disposition: 'fork', changes: []
  };
  const lines = captureLog(() => reportPlan([plan], forkBook));
  expect(lines).toContain('\nFORK Berserker from parent-id-1');
  expect(lines).toContain('  + rules_version: "v2"');
});
```

Replace the comment and test at `:721-732` with:

```js
// `rules_version` has no column default, `status` defaults to 'alpha' and
// `is_player_created` to false, so the insert is where a book states all
// three. Both books' classes are released content built under the v2
// character rules, and only a pre-release PCC is player-created.
test.skipIf(!forkRecords)('an Aspirant V1 fork is inserted released, at v2, and not player-created', () => {
  const [plan] = planLoad([berserkerRecord], [parentRow('Berserker', { rules_edition: 'aspirant' })],
      forkBook);
  const inserted = insertRow(plan, forkBook);
  expect(inserted.status).toBe('release');
  expect(inserted.rules_version).toBe('v2');
  expect(inserted.is_player_created).toBe(false);
  expect(inserted.id).toBe(ASPIRANT_V1_CLASS_IDS.Berserker);
});
```

In `util/class-import.test.js`, directly after `test('content_format defaults to advent', …)`, add:

```js
// classes.rules_version names the character rules a class's characters are
// built under, and Aspirant V1 builds on Advent v2 -- so an Aspirant-format
// import is v2 whatever the writeup says, and cannot land on v1.
test('an aspirant-format import is built under the v2 character rules', async () => {
  const result = await importClass({ content_format: 'aspirant', gear: [{ name: 'One' }] });
  expect(result.rules_version).toBe('v2');
});

test('an aspirant-format import is v2 even when the writeup says v1', async () => {
  const result = await importClass({ content_format: 'aspirant', rules_version: 'v1', gear: [{ name: 'One' }] });
  expect(result.rules_version).toBe('v2');
});

test('an advent-format import still defaults to v1', async () => {
  const result = await importClass({ gear: [{ name: 'One' }] });
  expect(result.rules_version).toBe('v1');
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test test/load-prerelease-classes.test.js
env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/class-import.test.js
```

Expected: the FORK-heading test FAILS (the log holds `  + rules_version: "v1"`); the fork-insert test FAILS if `private-data/` holds the Aspirant extract (skipped otherwise); the two aspirant import tests FAIL with `expected "v2", received "v1"`; the advent import test passes.

- [ ] **Step 3: Write the failing census integration test**

Create `util/aspirant-classes-v2.integration.test.js`:

```js
// util/aspirant-classes-v2.integration.test.js
//
// Requires the local Supabase stack: SUPABASE_URL=http://127.0.0.1:54321
//
// classes.rules_version names the character rules a class's characters are
// built under. ENCLAVE: Aspirant V1 builds on Advent v2 -- Defining Quirk,
// Accessories, Ability Perks and the v2 level curve -- so an aspirant-format
// class off v2 would have its characters' v2 fields stripped on every save.

require('./require-local-supabase');

const { test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

test('every aspirant-format class is built under the v2 character rules', async () => {
  const { data, error } = await sb.from('classes')
    .select('id, name, rules_version')
    .eq('content_format', 'aspirant');
  expect(error).toBeNull();
  const off = data
    .filter((row) => row.rules_version !== 'v2')
    .map((row) => `${row.name} (${row.id}) is ${row.rules_version}`);
  expect(off).toEqual([]);
});
```

In `scripts/run-tests.mjs`, add `'util/aspirant-classes-v2.integration.test.js',` to `integrationFiles`, directly before `'util/class-ability-type.integration.test.js'`.

- [ ] **Step 4: Run it to verify it fails**

```bash
grep '^SUPABASE_URL' .env
eval "$(supabase status -o env)" && psql "$DB_URL" -Atc "select rules_version, count(*) from classes where content_format='aspirant' group by 1"
eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test util/aspirant-classes-v2.integration.test.js
```

Expected: the census query prints `v1|12` (or whatever the restore holds); the test FAILS listing those rows as `… is v1`. If the count is 0, the test passes vacuously: say so in your report and continue.

- [ ] **Step 5: Implement the loader and import changes**

In `scripts/lib/books.mjs`, replace `:43-47`:

```js
    // Released content, gated by owning the book rather than by status.
    status: 'release',
    // Aspirant V1 characters are built under the Advent v2 character rules.
    rulesVersion: 'v2',
    forks: true
```

In `util/class-import.js`, replace the schema line at `:90`:

```js
  rules_version: z.enum(["v1", "v2"]).optional().describe("Character rules version for an Advent-format class; defaults to v1. An Aspirant-format class is always v2"),
```

and the `rules_version` line in `classData` (`:240`):

```js
      // Aspirant V1 builds on the Advent v2 character rules, so an
      // aspirant-format class is v2 whatever the writeup says.
      rules_version: format === "aspirant" ? "v2" : (parsed.rules_version || "v1"),
```

- [ ] **Step 6: Write the migration**

Create `supabase/migrations/20260928000003_aspirant_classes_v2_rules.sql`:

```sql
-- classes.rules_version names the character-rules generation a class's
-- characters are built under. ENCLAVE: Aspirant V1 builds on Advent v2 -- its
-- characters carry a Defining Quirk, Accessories, Ability Perks and the v2
-- level curve -- so every aspirant-format class is 'v2'.
--
-- No unique index involves rules_version; the only constraint is the v1/v2
-- CHECK. save_character_atomic and level_up_character_atomic do not read it.
--
-- Matches only rows not already at 'v2', so a second run changes nothing.

-- updated_at is trigger-owned and services/home/recent-feed.js sorts the
-- homepage feeds by it. Recording which rules these classes follow is not an
-- edit to them, so it must not surface them as recent activity.
ALTER TABLE public.classes DISABLE TRIGGER update_classes_updated_at;

UPDATE public.classes
SET rules_version = 'v2'
WHERE content_format = 'aspirant'
  AND rules_version IS DISTINCT FROM 'v2';

ALTER TABLE public.classes ENABLE TRIGGER update_classes_updated_at;
```

- [ ] **Step 7: Apply it locally and prove `updated_at` did not move**

```bash
grep '^SUPABASE_URL' .env
eval "$(supabase status -o env)" && psql "$DB_URL" -Atc "select id, updated_at from classes where content_format='aspirant' order by id" > /tmp/claude-aspirant-updated-before.txt
supabase migration up
eval "$(supabase status -o env)" && psql "$DB_URL" -Atc "select id, updated_at from classes where content_format='aspirant' order by id" > /tmp/claude-aspirant-updated-after.txt
diff /tmp/claude-aspirant-updated-before.txt /tmp/claude-aspirant-updated-after.txt && echo "updated_at unchanged"
eval "$(supabase status -o env)" && psql "$DB_URL" -Atc "select rules_version, count(*) from classes where content_format='aspirant' group by 1"
```

Expected: `supabase migration up` applies `20260928000003_aspirant_classes_v2_rules.sql` only; `diff` prints nothing and `updated_at unchanged`; the census query prints `v2|12`.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test test/load-prerelease-classes.test.js
env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/class-import.test.js
eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test util/aspirant-classes-v2.integration.test.js
```

Expected: all PASS.

- [ ] **Step 9: Dry-run the level reconciliation locally (read-only)**

```bash
eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun scripts/reconcile-character-progress.js
```

Expected: first line `Target: 127.0.0.1:54321 (read-only)`, then a count. Do NOT pass `--apply`. Paste the output in your report (local data has no aspirant characters at plan time, so 0 affected by this change is expected); Task 10 repeats it against production.

- [ ] **Step 10: Run the unit tier**

Run: `bun run test:unit`
Expected: 0 failures.

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/20260928000003_aspirant_classes_v2_rules.sql util/aspirant-classes-v2.integration.test.js scripts/run-tests.mjs scripts/lib/books.mjs test/load-prerelease-classes.test.js util/class-import.js util/class-import.test.js
git commit -m "fix: build Aspirant-format classes under the v2 character rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Both client Perk balances count Ability Perks the way the server does

**Files:**
- Modify: `public/js/character-wizard.js:1923-1936` (`perksSpent` and its comment), `:4094-4097` (`perks` comment), `:4124-4137` (ability-perk payload)
- Modify: `public/js/character-ability-purchases.js:52-60`, `:110-131` (`getSpent`), `:271-273` (boot of the mount)
- Modify: `util/ability-purchase-data.js:11`, `:145-150`, `:165-175`
- Test: `test/character-wizard-client.test.js`, `test/character-ability-purchases.test.js`, `util/ability-purchase-data.test.js`

**Interfaces:**
- Consumes: `perkFigures().abilityPerkCost` (`util/perk-economy.js`), served to the wizard as `DATA.perks` and to the mount as `data.figures`.
- Produces: `wizard.perksSpent(state)` includes `PERKS.abilityPerkCost` when the aspirant wizard's step-3 Perk is attached to an Ability; the purchase mount's `getSpent()` counts `#perk-groups .perk-row` × `figures.abilityPerkCost` and re-renders when that count changes; the island no longer carries `abilityPerkSpend`.

- [ ] **Step 1: Write the failing wizard tests**

In `test/character-wizard-client.test.js`, add after the existing requires (`:26-28`):

```js
const { perkFigures } = require('../util/perk-economy');
```

and append at the end of the file:

```js
// util/perk-economy.js#perkSpend charges ABILITY_PERK_COST for every Ability
// Perk row the payload carries. The aspirant wizard ships its step-3 Perk as
// one such row once it is attached to an Ability, so the balance it shows has
// to charge for it, or it sells an unlock the server then refuses as a
// Perk deficit.
describe('the attached Ability Perk is part of the Perk spend', () => {
  test('an aspirant Perk attached to an Ability costs an Ability Perk', () => {
    const wizard = aspirantStateAtLevel(1);
    const state = wizard.getState();
    const before = wizard.perksSpent(state);
    state.perk = 'Never misses twice.';
    state.perkAbilityName = 'Own Core A';
    expect(wizard.perksSpent(state)).toBe(before + perkFigures().abilityPerkCost);
  });

  test('Perk text with no Ability chosen is not an Ability Perk and costs nothing', () => {
    const wizard = aspirantStateAtLevel(1);
    const state = wizard.getState();
    const before = wizard.perksSpent(state);
    state.perk = 'Never misses twice.';
    state.perkAbilityName = null;
    expect(wizard.perksSpent(state)).toBe(before);
  });

  test('the spend charges exactly the Ability Perk rows the payload submits', () => {
    const wizard = aspirantStateAtLevel(1);
    const state = wizard.getState();
    const before = wizard.perksSpent(state);
    state.perk = 'Never misses twice.';
    state.perkAbilityName = 'Own Core A';
    const payload = wizard.buildSubmitPayload();
    expect(payload.ability_perks).toHaveLength(1);
    expect(wizard.perksSpent(state) - before)
      .toBe(payload.ability_perks.length * perkFigures().abilityPerkCost);
  });
});
```

- [ ] **Step 2: Write the failing purchase-mount tests**

In `test/character-ability-purchases.test.js`:

Replace `fixtureIsland` (`:55-68`) with:

```js
const fixtureIsland = (overrides = {}) => ({
  economy: overrides.economy || 'aspirant',
  figures: FIGURES,
  entries: overrides.entries || baseEntries(),
  owned: overrides.owned || [],
  aspiringAbilities: overrides.aspiringAbilities || [],
  level: overrides.level != null ? overrides.level : 10
});
```

Replace `MOUNT_HTML` (`:70-82`) with:

```js
// `perkRows` stands in for the v2 Ability-Perk editor on the same form
// (views/partials/character-v2-fields.handlebars), one .perk-row per Perk.
const MOUNT_HTML = (islandJson, perkRows = 0) => `
  <form>
    <div id="abilityPurchases">
      <script type="application/json" id="ability-purchase-data">${islandJson}</script>
      <p id="abilityReadouts">
        <span data-perks-spent>0</span> <span data-perks-earned>0</span>
        <span data-abilities-used>0</span> <span data-abilities-cap>0</span>
      </p>
      <div id="abilityCatalogue"></div>
      <input type="hidden" name="abilities_json" id="abilityJson">
    </div>
    <div id="perk-groups">${'<div class="column is-full perk-row"></div>'.repeat(perkRows)}</div>
  </form>
`;
```

Change `mountAbilities` (`:88`) to take the rows:

```js
const mountAbilities = (data, { perkRows = 0 } = {}) => {
  const html = MOUNT_HTML(jsonHelper(data), perkRows);
```

(the rest of the function is unchanged).

Replace the test at `:163-176` with:

```js
  // util/perk-economy.js#perkSpend charges unlockSpend PLUS abilityPerkSpend,
  // and services/character/service.js ratchets a save against that combined
  // figure. A surface that only tallied unlockSpend would show a purchase
  // the server then refuses at save.
  test('a character with existing Ability-Perk spend cannot afford a purchase its unlock spend alone would allow', () => {
    // Level 3 earns three Perks -- enough for Last Word's own-Advanced price
    // of two by unlock spend alone, but not once two Perks are already spent
    // on Ability Perks.
    const form = mountAbilities(fixtureIsland({ owned: [], level: 3 }), { perkRows: 2 });
    expect(form.getEarned()).toBe(3);
    expect(form.getSpent()).toBe(2 * FIGURES.abilityPerkCost);
    expect(form.buyAbility('Last Word', CLASS_ID)).toBe(false);
    expect(form.serialize().abilities).toHaveLength(0);
  });

  // The Perk editor adds and removes rows after the page loads; the balance
  // follows it rather than the Perks the character had when the page loaded.
  test('an Ability Perk added on the same form is charged at once', async () => {
    const form = mountAbilities(fixtureIsland({ owned: [], level: 3 }), { perkRows: 1 });
    const row = document.createElement('div');
    row.className = 'column is-full perk-row';
    document.getElementById('perk-groups').appendChild(row);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(form.getSpent()).toBe(2 * FIGURES.abilityPerkCost);
    expect(document.querySelector('[data-perks-spent]').textContent)
      .toBe(String(2 * FIGURES.abilityPerkCost));
  });

  test('removing an Ability Perk on the same form refunds it', async () => {
    const form = mountAbilities(fixtureIsland({ owned: [], level: 3 }), { perkRows: 2 });
    document.querySelector('#perk-groups .perk-row').remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(form.getSpent()).toBe(FIGURES.abilityPerkCost);
    expect(document.querySelector('[data-perks-spent]').textContent)
      .toBe(String(FIGURES.abilityPerkCost));
  });
```

In `util/ability-purchase-data.test.js`, delete `const { abilityPerkSpend } = require('./perk-economy');` (`:4`) and replace the test at `:106-117` (comment included) with:

```js
// The Ability-Perk half of the Perk spend is counted in the browser from the
// Perk editor on the same form, which changes after the page loads; a served
// figure would be a snapshot that disagrees with it.
test('the island serves no Ability-Perk spend snapshot', () => {
  const data = buildAbilityPurchaseData({
    character: { class_id: 'a', abilities: [], ability_perks: [{ id: 'p1' }], level: 5 },
    characterClass: CLASS_A, allClasses: [CLASS_A], economy: 'aspirant'
  });
  expect(data).not.toHaveProperty('abilityPerkSpend');
});
```

- [ ] **Step 3: Run them to verify they fail**

```bash
env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test test/character-wizard-client.test.js
env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test test/character-ability-purchases.test.js
env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/ability-purchase-data.test.js
```

Expected: wizard tests 1 and 3 FAIL (spend unchanged); the three mount tests FAIL (`getSpent()` is 0, the island no longer carries a spend); the island test FAILS (`abilityPerkSpend` present).

- [ ] **Step 4: Implement the wizard change**

In `public/js/character-wizard.js`, replace `:1923-1936` (the "Ability unlocks only" comment through the end of `perksSpent`) with:

```js
  // Step 3's Perk, once attached to one of the class's Abilities, ships as an
  // Ability Perk row (buildSubmitPayload), and util/perk-economy.js#perkSpend
  // charges ABILITY_PERK_COST for it -- so one condition decides both.
  const attachesAbilityPerk = (s) => DATA.mode === 'aspirant'
    && !!(s && s.perkAbilityName) && !!((s && s.perk) || '').trim();

  // Both terms of util/perk-economy.js#perkSpend: Ability unlocks, and the
  // attached Ability Perk.
  const perksSpent = (s) => ownCoreSpend(s)
    + (s.acquiredAbilities || []).reduce((total, pick) => total + priceOfPick(pick), 0)
    + (attachesAbilityPerk(s) ? PERKS.abilityPerkCost : 0);
```

Replace the `perks` comment at `:4094-4096` with:

```js
      // The free-form Perk for a v1 class. services/character/input.js keeps
      // `perks` only on v1 characters, so it is safe to send unconditionally.
```

Replace the block at `:4124-4137` (from `// Aspirant perk attachment:` through the closing `}` of the `if`) with:

```js
    // The attached Perk as an Ability Perk row. class_ability_id is the
    // ability NAME: remapPerkAbilityIdsByName rewrites it to the freshly
    // inserted row id.
    if (attachesAbilityPerk(state)) {
      payload.ability_perks = [{
        class_ability_id: state.perkAbilityName,
        text: state.perk.trim(),
        position: 0
      }];
    }
```

- [ ] **Step 5: Implement the purchase-mount change**

In `public/js/character-ability-purchases.js`, replace `:52-60` (from the `// What the character has already spent on Ability Perks` comment through the `ABILITY_PERK_SPEND` line) with:

```js
    // The Ability Perks on the same form (views/partials/character-v2-fields.
    // handlebars). Each row is one abilityPerkCost at save
    // (util/perk-economy.js#abilityPerkSpend), and the editor adds and removes
    // rows after the page loads, so they are counted from the page.
    var perkGroups = document.getElementById('perk-groups');
    var countPerkRows = function () {
      return perkGroups ? perkGroups.querySelectorAll('.perk-row').length : 0;
    };
```

In `getSpent`, replace the comment sentence `ABILITY_PERK_SPEND is added on top, matching` … `charges both.` with `The Ability Perks on the form are added on top, matching util/perk-economy.js#perkSpend's unlockSpend + abilityPerkSpend: the save the server ratchets against charges both.` and its return line with:

```js
      return spend + countPerkRows() * FIGURES.abilityPerkCost;
```

Directly before `render();` at the bottom of `mount` (the call that precedes `return {`), add:

```js
    // Typing in a Perk rewrites its word counter, so only a change in the
    // number of rows re-renders.
    if (perkGroups && window.MutationObserver) {
      var renderedPerkRows = countPerkRows();
      new window.MutationObserver(function () {
        if (countPerkRows() === renderedPerkRows) return;
        renderedPerkRows = countPerkRows();
        render();
      }).observe(perkGroups, { childList: true, subtree: true });
    }
```

- [ ] **Step 6: Drop the snapshot from the island**

In `util/ability-purchase-data.js`:
- `:11` becomes `const { perkFigures, priceOfAbility } = require('./perk-economy');`
- Replace the paragraph at `:145-150` with:

```js
// The level is served through normalizeLevel rather than raw: it is an input
// to services/character/service.js's ratchet that a browser file must be told
// rather than re-derive, and a stored level past the ceiling would let the
// surface show an earned balance the server does not agree with. The
// Ability-Perk half of the spend is not served:
// public/js/character-ability-purchases.js counts it from the Perk editor on
// the same form, which changes after the page loads.
```

- Replace `:165-175` (from `level: normalizeLevel(...)` to the end of the object) with:

```js
    level: normalizeLevel(character && character.level)
  };
```

- [ ] **Step 7: Run the tests to verify they pass**

Re-run the three commands from Step 3.
Expected: all PASS.

- [ ] **Step 8: Run the unit tier**

Run: `bun run test:unit`
Expected: 0 failures. `grep -rn "abilityPerkSpend" public/ views/ routes/` prints nothing.

- [ ] **Step 9: Commit**

```bash
git add public/js/character-wizard.js test/character-wizard-client.test.js public/js/character-ability-purchases.js test/character-ability-purchases.test.js util/ability-purchase-data.js util/ability-purchase-data.test.js
git commit -m "fix: count Ability Perks in both client Perk balances

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pin the v2 contract for Aspirant-format characters; restate the ingestion spec

**Files:**
- Create: `models/character-aspirant-rules.integration.test.js`
- Modify: `scripts/run-tests.mjs` (`integrationFiles`)
- Modify: `docs/superpowers/specs/2026-09-16-aspirant-v1-ingestion-design.md:132-146`

**Interfaces:**
- Consumes: Task 1 (local catalogue at v2 is not needed: the test builds its own v2 aspirant-format class).
- Produces: a guard for Part 2's dependency: `updateCharacter` on an aspirant-format v2 class writes submitted `quirks`, `accessories` and `ability_perks`, and auto-calculates the level on the v2 curve.

- [ ] **Step 1: Write the test**

Create `models/character-aspirant-rules.integration.test.js`:

```js
// Local-Supabase integration coverage for an Aspirant-format character on the
// v2 character rules: an edit keeps its Defining Quirk, Accessories and
// Ability Perks, and an auto-calculated level follows the v2 curve.
require('../util/require-local-supabase');

const { test, expect, beforeAll, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('./_base');
const { updateCharacter } = require('./character');
const { statList } = require('../util/enclave-consts');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `aspirant-rules-${suffix}@example.test`;
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});

const STATS = Object.fromEntries(statList.map(stat => [stat, 1]));
const QUIRKS = [{ name: 'Night Owl', downside: 'Sleeps through mornings.', upside: 'Sees in the dark.' }];
const ACCESSORIES = [{ name: 'Pocket Watch' }];
// The edit changes all three: a class off v2 has them stripped from the
// submission, so the stored values would survive unchanged and a test that
// resubmitted them could not tell the difference.
const EDITED_QUIRKS = [{ name: 'Night Owl', downside: 'Sleeps through noon.', upside: 'Sees in the dark.' }];
const EDITED_ACCESSORIES = [{ name: 'Pocket Watch' }, { name: 'Lucky Coin' }];
const EDITED_PERK = 'Steadier hands.';
const TRAIT_FIELDS = {
  trait0: 'Brave', trait0_stat: 'might',
  trait1: 'Clever', trait1_stat: 'intelligence',
  trait2: 'Lucky', trait2_stat: 'luck'
};
// Four missions: level 3 on the v2 curve (2 + 2), level 2 on v1 (2 + 3).
const OFFSCREEN_MISSIONS = 4;

let authUserId;
let profile;
let aspirantClass;
let characterId;
let updateResult;

beforeAll(async () => {
  await db.connect();
  const { rows } = await db.query(
    `insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
     values (gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
     returning id`,
    [email]
  );
  authUserId = rows[0].id;
  ({ data: profile } = await supabaseAdmin.from('profiles')
    .insert({ user_id: authUserId, name: `Aspirant Rules ${suffix}`, is_public: true, timezone: 'UTC' })
    .select()
    .single());
  ({ data: aspirantClass } = await supabaseAdmin.from('classes')
    .insert({
      name: `Aspirant Rules Class ${suffix}`, is_public: true,
      rules_edition: 'aspirant', content_format: 'aspirant', rules_version: 'v2',
      gear: [{ name: 'Rifle' }], abilities: [{ name: 'Aim' }], advanced_abilities: []
    })
    .select()
    .single());

  const { data: created, error } = await supabaseAdmin.rpc('save_character_atomic', {
    p_character_id: null,
    p_creator_id: profile.id,
    p_character: {
      ...STATS,
      creator_id: profile.id, name: `Aspirant Rules ${suffix}`,
      class: aspirantClass.name, class_id: aspirantClass.id, creator_mode: 'aspirant',
      auto_calculate: true, level: 1, completed_missions: 0, commissary_reward: 0,
      quirks: QUIRKS, accessories: ACCESSORIES
    },
    p_traits: [{ name: 'Brave', stat: 'might' }, { name: 'Clever', stat: 'intelligence' }, { name: 'Lucky', stat: 'luck' }],
    p_gear: [{ name: 'Rifle', class_id: aspirantClass.id }],
    p_abilities: [{ name: 'Aim', class_id: aspirantClass.id, type: 'core' }],
    p_perks: [{ ability_name: 'Aim', text: 'Steady hands.', position: 0 }]
  });
  if (error) throw error;
  characterId = created.id;

  for (let i = 1; i <= OFFSCREEN_MISSIONS; i++) {
    await db.query(
      `insert into offscreen_missions (character_id, name, summary, merx_gained, source_mission_name, source_mission_date)
       values ($1, $2, 'Fixture', 0, 'Fixture source', $3)`,
      [characterId, `Offscreen ${i}`, `2026-01-0${i}`]
    );
  }

  const { rows: [aim] } = await db.query(
    'select id from class_abilities where character_id = $1 and name = $2', [characterId, 'Aim']
  );
  updateResult = await updateCharacter(characterId, {
    ...STATS,
    ...TRAIT_FIELDS,
    name: `Aspirant Rules Edited ${suffix}`,
    auto_calculate: 'on',
    quirks: EDITED_QUIRKS,
    accessories: EDITED_ACCESSORIES,
    ability_perks: [{ class_ability_id: aim.id, text: EDITED_PERK, position: 0 }]
  }, { id: profile.id });
});

afterAll(async () => {
  if (profile?.id) await db.query('delete from characters where creator_id = $1', [profile.id]);
  if (profile?.id) await db.query('delete from profiles where id = $1', [profile.id]);
  if (aspirantClass?.id) await db.query('delete from classes where id = $1', [aspirantClass.id]);
  if (authUserId) await db.query('delete from auth.users where id = $1', [authUserId]);
  await db.end();
});

test('an edit of an aspirant-format v2 character writes its Defining Quirk, Accessories and Ability Perks', async () => {
  expect(updateResult.error).toBeNull();
  const { rows: [row] } = await db.query('select name, quirks, accessories from characters where id = $1', [characterId]);
  expect(row.name).toBe(`Aspirant Rules Edited ${suffix}`);
  expect(row.quirks).toEqual(EDITED_QUIRKS);
  expect(row.accessories).toEqual(EDITED_ACCESSORIES);
  const { rows: perks } = await db.query(
    `select p.text, a.name as ability from character_perks p
     join class_abilities a on a.id = p.class_ability_id
     where p.character_id = $1`,
    [characterId]
  );
  expect(perks).toEqual([{ text: EDITED_PERK, ability: 'Aim' }]);
});

test('an auto-calculated aspirant-format v2 character levels on the v2 curve', async () => {
  const { rows: [row] } = await db.query('select level, completed_missions from characters where id = $1', [characterId]);
  expect(row.completed_missions).toBe(OFFSCREEN_MISSIONS);
  expect(row.level).toBe(3);
});
```

Add `'models/character-aspirant-rules.integration.test.js',` to `integrationFiles` in `scripts/run-tests.mjs`, directly before `'models/character-atomic.integration.test.js'`.

- [ ] **Step 2: Run it**

```bash
grep '^SUPABASE_URL' .env
eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test models/character-aspirant-rules.integration.test.js
```

Expected: PASS. This is a contract pin: it passes as soon as the class is v2, which Task 1 made true of every aspirant-format class.

- [ ] **Step 3: Prove the pin can fail**

Temporarily change the fixture's `rules_version: 'v2'` to `'v1'` and re-run the Step 2 command.
Expected: both tests FAIL: `updateCharacter` strips `V2_ONLY_FIELDS` from a v1 class's submission, so the stored Quirk, Accessories and Perk keep the fixture's original values, and the level is 2 on the v1 curve. Revert the fixture to `'v2'` and re-run: PASS.

- [ ] **Step 4: Restate the ingestion spec**

In `docs/superpowers/specs/2026-09-16-aspirant-v1-ingestion-design.md`, change the last two table rows (`:136-137`) to:

```markdown
| Berserker (V1) | aspirant | aspirant | v2 |
| Gunslinger (Aspirant V1) | aspirant | aspirant | v2 |
```

and replace the paragraph at `:139-146` with:

```markdown
`rules_version` is `CHECK (rules_version IN ('v1','v2'))`
(`supabase/migrations/20240101000000_baseline_schema.sql:132`) and names the
character-rules generation a class's characters are built under. A pre-release
class is Advent-format content at the latest Advent version, so every row with
`prerelease_section` set is `'v2'` and `status 'release'`
(`supabase/migrations/20260922000000_prerelease_classes_v2.sql`), and the
pre-release loader inserts at `'v2'`. Aspirant V1 builds on Advent v2 -- its
characters carry a Defining Quirk, Accessories, Ability Perks and the v2 level
curve -- so the twelve V1 rows are `'v2'` as well
(`supabase/migrations/20260928000003_aspirant_classes_v2_rules.sql`), and the
Aspirant V1 loader inserts at `'v2'`.
```

- [ ] **Step 5: Run the integration tier**

```bash
eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun run test:integration
```

Expected: only the known reds (Global Constraints) fail.

- [ ] **Step 6: Commit**

```bash
git add models/character-aspirant-rules.integration.test.js scripts/run-tests.mjs docs/superpowers/specs/2026-09-16-aspirant-v1-ingestion-design.md
git commit -m "test: pin v2 fields and level curve for Aspirant-format characters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part 2 — Convert to Aspirant

### Task 4: `findAspirantFork`

**Files:**
- Create: `util/aspirant-conversion.js`
- Test: `util/aspirant-conversion.test.js` (create)

**Interfaces:**
- Consumes: `computeVersionFamily(classes, classId)` from `util/class-family.js`.
- Produces: `findAspirantFork(classes, classId) -> classRow | null`, where `classes` are rows with at least `{ id, name, base_class_id, rules_edition, content_format }`. `null` for a null `classId`, for no fork, and for more than one fork (the last also `console.warn`s).

- [ ] **Step 1: Write the failing test**

Create `util/aspirant-conversion.test.js`:

```js
const { test, expect, describe, spyOn } = require('bun:test');
const { findAspirantFork } = require('./aspirant-conversion');

// The catalogue shapes conversion meets: an Advent class at v1 and v2 (one
// version family) with its Aspirant fork of the v1 row, a second such class
// for cross-class items, a pre-release class with its fork, and a class with
// no fork at all.
const advent = (id, name, extra = {}) => ({
  id, name, rules_edition: 'advent', content_format: 'advent', base_class_id: null,
  gear: [], abilities: [], advanced_abilities: [], ...extra
});
const fork = (id, name, baseClassId, extra = {}) => ({
  id, name, rules_edition: 'aspirant', content_format: 'aspirant', base_class_id: baseClassId,
  gear: [], abilities: [], advanced_abilities: [], ...extra
});

const GUNSLINGER_V1 = advent('gunslinger-v1', 'Gunslinger');
const GUNSLINGER_V2 = advent('gunslinger-v2', 'Gunslinger', { base_class_id: 'gunslinger-v1' });
const GUNSLINGER_FORK = fork('gunslinger-aspirant', 'Gunslinger', 'gunslinger-v1', {
  gear: [{ name: 'Revolver', description: 'A six-shooter.' }, { name: 'Duster', description: 'Long coat.' }],
  abilities: [{ name: 'Trickshot' }, { name: 'Standoff' }, { name: 'Shootout' }],
  advanced_abilities: [{ name: 'Last Word' }, { name: 'Dead Eye' }, { name: 'High Noon' }]
});
const WANDERER_V1 = advent('wanderer-v1', 'Wanderer');
const WANDERER_V2 = advent('wanderer-v2', 'Wanderer', { base_class_id: 'wanderer-v1' });
const WANDERER_FORK = fork('wanderer-aspirant', 'Wanderer', 'wanderer-v1', {
  gear: [{ name: 'Satchel' }], abilities: [{ name: 'Familiar Face' }]
});
const BERSERKER_PRERELEASE = {
  id: 'berserker-pre', name: 'Berserker', rules_edition: 'aspirant', content_format: 'advent',
  base_class_id: null, gear: [], abilities: [], advanced_abilities: []
};
const BERSERKER_FORK = fork('berserker-aspirant', 'Berserker', 'berserker-pre');
const HOMEBREW = advent('homebrew', 'Homebrew Class', { gear: [{ name: 'Hand Cannon' }] });

const CATALOGUE = [
  GUNSLINGER_V1, GUNSLINGER_V2, GUNSLINGER_FORK, WANDERER_V1, WANDERER_V2, WANDERER_FORK,
  BERSERKER_PRERELEASE, BERSERKER_FORK, HOMEBREW
];

describe('findAspirantFork', () => {
  test('the v1 member of a family finds the fork of the v1 row', () => {
    expect(findAspirantFork(CATALOGUE, 'gunslinger-v1')).toBe(GUNSLINGER_FORK);
  });

  test('the v2 member of the same family finds the same fork', () => {
    expect(findAspirantFork(CATALOGUE, 'gunslinger-v2')).toBe(GUNSLINGER_FORK);
  });

  test('a pre-release class finds its fork', () => {
    expect(findAspirantFork(CATALOGUE, 'berserker-pre')).toBe(BERSERKER_FORK);
  });

  test('a class with no fork has none', () => {
    expect(findAspirantFork(CATALOGUE, 'homebrew')).toBeNull();
  });

  test('a fork has no fork of its own', () => {
    expect(findAspirantFork(CATALOGUE, 'gunslinger-aspirant')).toBeNull();
  });

  test('a character with no class has no fork, even beside a parentless Aspirant class', () => {
    const parentless = fork('orphan-aspirant', 'Orphan', null);
    expect(findAspirantFork([...CATALOGUE, parentless], null)).toBeNull();
  });

  test('two forks of one family are ambiguous: none is offered and it is logged', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const second = fork('gunslinger-aspirant-2', 'Gunslinger', 'gunslinger-v2');
      expect(findAspirantFork([...CATALOGUE, second], 'gunslinger-v2')).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('gunslinger-aspirant-2');
    } finally {
      warn.mockRestore();
    }
  });
});
```

Keep the fixtures at the top of the file: Tasks 5 and 6 add tests below them.

- [ ] **Step 2: Run it to verify it fails**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/aspirant-conversion.test.js`
Expected: FAIL with `Cannot find module './aspirant-conversion'`.

- [ ] **Step 3: Write the minimal implementation**

Create `util/aspirant-conversion.js`:

```js
// Moves an Advent character onto its class's Aspirant fork, as a plan: what
// the build becomes, what must change before it may, and what it will show
// afterwards. Pure -- the caller loads everything and saves the result.
const { computeVersionFamily } = require('./class-family');

const ASPIRANT = 'aspirant';

// A class's fork is the aspirant-format class whose parent sits in that
// class's version family, so every version of an Advent class reaches the
// same fork. The fork starts a family of its own (util/class-family.js),
// which is what keeps conversion one-way. Two forks of one family is
// catalogue data this cannot choose between: neither is offered.
const findAspirantFork = (classes, classId) => {
  if (!classId) return null;
  const rows = (Array.isArray(classes) ? classes : []).filter(Boolean);
  const family = computeVersionFamily(rows, classId);
  const forks = rows.filter(row => row.content_format === ASPIRANT
    && !family.has(row.id) && family.has(row.base_class_id));
  if (forks.length > 1) {
    console.warn(`[findAspirantFork] class ${classId} has ${forks.length} Aspirant forks: `
      + forks.map(row => row.id).join(', '));
  }
  return forks.length === 1 ? forks[0] : null;
};

module.exports = { findAspirantFork };
```

- [ ] **Step 4: Run it to verify it passes**

Run the Step 2 command. Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add util/aspirant-conversion.js util/aspirant-conversion.test.js
git commit -m "feat: find the Aspirant fork of a character's class family

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `planConversion` remaps Signatures, Abilities and Ability Perks

**Files:**
- Modify: `util/aspirant-conversion.js`
- Test: `util/aspirant-conversion.test.js`

**Interfaces:**
- Consumes: `findAspirantFork` (Task 4).
- Produces:
  - `CONVERSION_RULES = { noFork: 'no-fork', noCounterpart: 'no-counterpart', traits: 'traits', statCap: 'stat-cap', signatureCap: 'signature-cap' }` (the last three are used from Task 6).
  - `planConversion({ character, classes, gear, abilities, abilityPerks, traits, realMissions, offscreenMissions }) -> { target, gear, abilities, abilityPerks, blockers }` (Task 6 adds `breaches`, `perkBreakdown`, `merxBreakdown`).
  - `gear[]`: `{ name, class_id, description, enchantment, mods }`; `abilities[]`: `{ name, class_id, description, type: 'core' | 'advanced' }`; `abilityPerks[]`: `{ class_ability_id: null, ability_name, text, position, compounds_with }` -- exactly the `p_gear`/`p_abilities`/`p_perks` shapes `save_character_atomic` reads.
  - `blockers[]`: `{ rule, detail }`.

- [ ] **Step 1: Write the failing tests**

In `util/aspirant-conversion.test.js`, change the require to:

```js
const { findAspirantFork, planConversion, CONVERSION_RULES } = require('./aspirant-conversion');
const { statList } = require('./enclave-consts');
```

and append:

```js
const TRAITS = [
  { name: 'Brave', stat: 'might' }, { name: 'Clever', stat: 'intelligence' }, { name: 'Lucky', stat: 'luck' }
];
const signature = (name, classId, extra = {}) => ({ name, class_id: classId, enchantment: null, mods: [], ...extra });
const ability = (id, name, classId, type = 'core') => ({ id, name, class_id: classId, type });

// Shaped like Caroline Denton (465f52ce-ee0d-4b0f-99bc-4baa4f9c8b7d): a
// Gunslinger v2 whose Abilities are stored on the v1 row of her own family,
// carrying Wanderer's Familiar Face cross-class, two Revolvers, and
// Ability Perks including a compound. Level 4.
const carolineDenton = (overrides = {}) => ({
  character: {
    id: 'caroline', name: 'Caroline Denton', class: 'Gunslinger', class_id: 'gunslinger-v2',
    creator_mode: null, level: 4, common_items: [], stat_cap_purchases: {},
    ...Object.fromEntries(statList.map(stat => [stat, 1])),
    ...overrides.character
  },
  classes: overrides.classes || CATALOGUE,
  gear: overrides.gear || [
    signature('Revolver', 'gunslinger-v1'),
    signature('Revolver', 'gunslinger-v1'),
    signature('Satchel', 'wanderer-v2')
  ],
  abilities: overrides.abilities || [
    ability('ab-trick', 'Trickshot', 'gunslinger-v1'),
    ability('ab-stand', 'Standoff', 'gunslinger-v1'),
    ability('ab-shoot', 'Shootout', 'gunslinger-v1'),
    ability('ab-face', 'Familiar Face', 'wanderer-v1')
  ],
  abilityPerks: overrides.abilityPerks || [
    { id: 'p0', class_ability_id: 'ab-trick', text: 'Off the wall.', position: 0, compounds_with: null },
    { id: 'p1', class_ability_id: 'ab-stand', text: 'Stare them down.', position: 1, compounds_with: null },
    { id: 'p2', class_ability_id: 'ab-stand', text: 'Twice as long.', position: 2, compounds_with: 'position-1' }
  ],
  traits: overrides.traits || TRAITS,
  realMissions: [],
  offscreenMissions: []
});

describe('planConversion: where each row goes', () => {
  test('the target is the fork of the character\'s own class', () => {
    expect(planConversion(carolineDenton()).target).toBe(GUNSLINGER_FORK);
  });

  test('own-class Signatures move to the fork, both copies of a duplicated one included', () => {
    const plan = planConversion(carolineDenton());
    expect(plan.gear.slice(0, 2)).toEqual([
      { name: 'Revolver', class_id: 'gunslinger-aspirant', description: 'A six-shooter.', enchantment: null, mods: [] },
      { name: 'Revolver', class_id: 'gunslinger-aspirant', description: 'A six-shooter.', enchantment: null, mods: [] }
    ]);
  });

  test('a cross-class Signature on a v2 row moves to its own class\'s fork', () => {
    const plan = planConversion(carolineDenton());
    expect(plan.gear[2]).toMatchObject({ name: 'Satchel', class_id: 'wanderer-aspirant' });
  });

  test('a cross-class Ability on a v1 row moves to its own class\'s fork', () => {
    const plan = planConversion(carolineDenton());
    expect(plan.abilities.find(row => row.name === 'Familiar Face'))
      .toEqual({ name: 'Familiar Face', class_id: 'wanderer-aspirant', description: null, type: 'core' });
    expect(plan.abilities.filter(row => row.class_id === 'gunslinger-aspirant').map(row => row.name))
      .toEqual(['Trickshot', 'Standoff', 'Shootout']);
  });

  test('an Ability found in the fork\'s Advanced list is typed advanced', () => {
    const plan = planConversion(carolineDenton({
      abilities: [ability('ab-last', 'Last Word', 'gunslinger-v2', 'core')], abilityPerks: []
    }));
    expect(plan.abilities).toEqual([
      { name: 'Last Word', class_id: 'gunslinger-aspirant', description: null, type: 'advanced' }
    ]);
  });

  test('Ability Perks follow their Ability by name and keep a same-Ability compound', () => {
    const plan = planConversion(carolineDenton());
    expect(plan.abilityPerks).toEqual([
      { class_ability_id: null, ability_name: 'Trickshot', text: 'Off the wall.', position: 0, compounds_with: null },
      { class_ability_id: null, ability_name: 'Standoff', text: 'Stare them down.', position: 1, compounds_with: null },
      { class_ability_id: null, ability_name: 'Standoff', text: 'Twice as long.', position: 2, compounds_with: 'position-1' }
    ]);
  });

  test('an Enchantment and Mods ride along unchanged', () => {
    const enchantment = { source: 'custom', text: 'Never jams.' };
    const mods = [{ text: 'Lined.' }];
    const plan = planConversion(carolineDenton({
      gear: [signature('Duster', 'gunslinger-v1', { enchantment, mods })]
    }));
    expect(plan.gear).toEqual([
      { name: 'Duster', class_id: 'gunslinger-aspirant', description: 'Long coat.', enchantment, mods }
    ]);
  });

  test('an item already on an Aspirant-format class stays where it is', () => {
    const plan = planConversion(carolineDenton({
      gear: [signature('Satchel', 'wanderer-aspirant', { description: 'Worn.' })],
      abilities: [ability('ab-face', 'Familiar Face', 'wanderer-aspirant')],
      abilityPerks: [{ id: 'p0', class_ability_id: 'ab-face', text: 'Known here.', position: 0, compounds_with: null }]
    }));
    expect(plan.gear).toEqual([
      { name: 'Satchel', class_id: 'wanderer-aspirant', description: 'Worn.', enchantment: null, mods: [] }
    ]);
    expect(plan.abilities).toEqual([
      { name: 'Familiar Face', class_id: 'wanderer-aspirant', description: null, type: 'core' }
    ]);
    expect(plan.abilityPerks[0].ability_name).toBe('Familiar Face');
    expect(plan.blockers).toEqual([]);
  });

  test('a name differing only by whitespace or case matches, and the fork\'s spelling is written', () => {
    const plan = planConversion(carolineDenton({
      gear: [signature(' revolver ', 'gunslinger-v1')],
      abilities: [ability('ab-trick', 'trickshot ', 'gunslinger-v1')],
      abilityPerks: [{ id: 'p0', class_ability_id: 'ab-trick', text: 'Off the wall.', position: 0, compounds_with: null }]
    }));
    expect(plan.gear[0]).toMatchObject({ name: 'Revolver', class_id: 'gunslinger-aspirant' });
    expect(plan.abilities[0]).toMatchObject({ name: 'Trickshot', class_id: 'gunslinger-aspirant' });
    expect(plan.abilityPerks[0].ability_name).toBe('Trickshot');
    expect(plan.blockers).toEqual([]);
  });
});

describe('planConversion: what has no Aspirant counterpart', () => {
  test('an item its fork does not carry is a blocker naming the item and its class', () => {
    const plan = planConversion(carolineDenton({
      gear: [signature('Grapple Gun', 'wanderer-v2')]
    }));
    expect(plan.blockers).toEqual([{
      rule: CONVERSION_RULES.noCounterpart,
      detail: 'Grapple Gun (Wanderer) has no Aspirant version. Remove it to convert.'
    }]);
    expect(plan.gear).toEqual([]);
  });

  test('an item whose class has no fork is a blocker naming that class', () => {
    const plan = planConversion(carolineDenton({
      gear: [signature('Hand Cannon', 'homebrew')]
    }));
    expect(plan.blockers).toEqual([{
      rule: CONVERSION_RULES.noFork,
      detail: 'Hand Cannon comes from Homebrew Class, which has no Aspirant version. Remove it to convert.'
    }]);
  });

  test('an item whose class is gone from the catalogue is a blocker', () => {
    const plan = planConversion(carolineDenton({
      gear: [signature('Mystery Box', 'deleted-class')]
    }));
    expect(plan.blockers).toEqual([{
      rule: CONVERSION_RULES.noFork,
      detail: 'Mystery Box comes from a class no longer in the catalogue. Remove it to convert.'
    }]);
  });

  test('a character whose own class has no fork has no target', () => {
    const plan = planConversion(carolineDenton({
      character: { class: 'Homebrew Class', class_id: 'homebrew' }
    }));
    expect(plan.target).toBeNull();
    expect(plan.blockers).toEqual([{
      rule: CONVERSION_RULES.noFork,
      detail: 'Homebrew Class has no Aspirant version.'
    }]);
    expect(plan.gear).toEqual([]);
    expect(plan.abilities).toEqual([]);
    expect(plan.abilityPerks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/aspirant-conversion.test.js`
Expected: the new tests FAIL with `planConversion is not a function`; Task 4's tests still pass.

- [ ] **Step 3: Implement**

In `util/aspirant-conversion.js`, add after `findAspirantFork`:

```js
const CONVERSION_RULES = {
  noFork: 'no-fork',
  noCounterpart: 'no-counterpart',
  traits: 'traits',
  statCap: 'stat-cap',
  signatureCap: 'signature-cap'
};

// A character row and a class's JSONB are written by different paths, so
// names are compared trimmed and case-folded; the fork's own spelling is what
// gets written, so the next save resolves it against the same catalogue.
const nameKey = (value) => String(value ?? '').trim().toLowerCase();

const GEAR_LISTS = [['gear', null]];
const ABILITY_LISTS = [['abilities', 'core'], ['advanced_abilities', 'advanced']];

const findInCatalogue = (cls, lists, name) => {
  const key = nameKey(name);
  for (const [listKey, type] of lists) {
    const entry = (Array.isArray(cls[listKey]) ? cls[listKey] : [])
      .find(item => item && nameKey(item.name) === key);
    if (entry) return { entry, type };
  }
  return null;
};

// Each row moves to the fork of ITS OWN class, so a cross-class item follows
// its donor class rather than the character. A row already on an
// aspirant-format class is Aspirant content and stays where it is.
const remapRows = (rows, { lists, classesById, forkOf, blockers }) => (Array.isArray(rows) ? rows : [])
  .filter(row => row && row.name)
  .map((row) => {
    const home = classesById.get(row.class_id) || null;
    if (home && home.content_format === ASPIRANT) {
      return { row, classId: row.class_id, name: row.name, description: row.description ?? null, type: row.type };
    }
    const itemName = String(row.name).trim();
    const fork = forkOf(row.class_id);
    if (!fork) {
      blockers.push({
        rule: CONVERSION_RULES.noFork,
        detail: home
          ? `${itemName} comes from ${home.name}, which has no Aspirant version. Remove it to convert.`
          : `${itemName} comes from a class no longer in the catalogue. Remove it to convert.`
      });
      return null;
    }
    const match = findInCatalogue(fork, lists, row.name);
    if (!match) {
      blockers.push({
        rule: CONVERSION_RULES.noCounterpart,
        detail: `${itemName} (${home.name}) has no Aspirant version. Remove it to convert.`
      });
      return null;
    }
    return {
      row,
      classId: fork.id,
      name: String(match.entry.name).trim(),
      description: match.entry.description ?? null,
      type: match.type
    };
  })
  .filter(Boolean);

const planConversion = ({ character, classes, gear, abilities, abilityPerks }) => {
  const rows = (Array.isArray(classes) ? classes : []).filter(Boolean);
  const classesById = new Map(rows.map(row => [row.id, row]));
  const target = findAspirantFork(rows, character.class_id);
  if (!target) {
    const own = classesById.get(character.class_id);
    return {
      target: null,
      gear: [],
      abilities: [],
      abilityPerks: [],
      blockers: [{
        rule: CONVERSION_RULES.noFork,
        detail: `${own ? own.name : character.class || 'This class'} has no Aspirant version.`
      }]
    };
  }

  const forks = new Map();
  const forkOf = (classId) => {
    if (!forks.has(classId)) forks.set(classId, findAspirantFork(rows, classId));
    return forks.get(classId);
  };
  const blockers = [];

  const convertedGear = remapRows(gear, { lists: GEAR_LISTS, classesById, forkOf, blockers })
    .map(({ row, classId, name, description }) => ({
      name,
      class_id: classId,
      description,
      enchantment: row.enchantment ?? null,
      mods: Array.isArray(row.mods) ? row.mods : []
    }));

  const abilityMoves = remapRows(abilities, { lists: ABILITY_LISTS, classesById, forkOf, blockers });
  const convertedAbilities = abilityMoves.map(({ classId, name, description, type }) => ({
    name, class_id: classId, description, type: type === 'advanced' ? 'advanced' : 'core'
  }));

  // Moving an Ability to a fork deletes and re-inserts its row, which
  // cascades its Perks away; save_character_atomic re-attaches a Perk
  // submitted by `ability_name` to the re-inserted row, and resolves its
  // `position-<n>` compound link on that same Ability afterwards -- the same
  // payload CharacterService#saveCharacterAtomic builds for a v2 edit.
  const abilityNameById = new Map(abilityMoves.map(({ row, name }) => [row.id, name]));
  const convertedPerks = (Array.isArray(abilityPerks) ? abilityPerks : [])
    .filter(perk => perk && abilityNameById.has(perk.class_ability_id))
    .map(perk => ({
      class_ability_id: null,
      ability_name: abilityNameById.get(perk.class_ability_id),
      text: perk.text,
      position: perk.position,
      compounds_with: perk.compounds_with ?? null
    }));

  return {
    target,
    gear: convertedGear,
    abilities: convertedAbilities,
    abilityPerks: convertedPerks,
    blockers
  };
};
```

and change the export to:

```js
module.exports = { findAspirantFork, planConversion, CONVERSION_RULES };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add util/aspirant-conversion.js util/aspirant-conversion.test.js
git commit -m "feat: plan a character's move onto the Aspirant forks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `planConversion` judges the converted build

**Files:**
- Modify: `util/aspirant-conversion.js`
- Test: `util/aspirant-conversion.test.js`

**Interfaces:**
- Consumes: Task 5's plan; `validateTraits`, `validateStatLimits`, `validateEconomyLimits` (`services/character/input.js`); `deriveBuildBreaches`, `derivePerkBreakdown`, `deriveMerxBreakdown` (`util/character-derived.js`); `statList` (`util/enclave-consts.js`).
- Produces: the plan gains `breaches` (the `buildBreaches` rows of the converted build under `'aspirant'`, `[]` without a target), `perkBreakdown` (`{ earned, spend, remaining, deficit }` or `null`), `merxBreakdown` (`{ earned, spend, reward, deficit }` or `null`), and blockers with `rule` `traits` / `stat-cap` / `signature-cap` carrying the validators' own messages.

- [ ] **Step 1: Write the failing tests**

In `util/aspirant-conversion.test.js`, add to the requires:

```js
const { capBreachMessage, BASE_STAT_CAP } = require('./stat-caps');
const { SIGNATURE_CAP, CREATION_GRANT, priceOfSignature } = require('./merx-economy');
const {
  ABILITY_CAP_RULE, PERK_DEFICIT_RULE, CROSS_CLASS_EDITION_RULE, perkAllotment
} = require('./perk-economy');
```

and append:

```js
describe('planConversion: the converted build is judged under Aspirant', () => {
  test('Caroline Denton converts with nothing blocking and no Ability-cap breach', () => {
    const plan = planConversion(carolineDenton());
    expect(plan.blockers).toEqual([]);
    expect(plan.breaches.map(b => b.rule)).not.toContain(ABILITY_CAP_RULE);
    expect(plan.breaches.map(b => b.rule)).not.toContain(CROSS_CLASS_EDITION_RULE);
  });

  // Level 4 earns 1 + 3 Perks; Familiar Face costs 3 cross-class and the
  // three Ability Perks 1 each.
  test('a Perk deficit is grandfathered: a breach, not a blocker', () => {
    const plan = planConversion(carolineDenton());
    expect(plan.perkBreakdown).toEqual({ earned: perkAllotment({ economy: 'aspirant', level: 4 }), spend: 6, remaining: 0, deficit: 2 });
    expect(plan.breaches.map(b => b.rule)).toContain(PERK_DEFICIT_RULE);
    expect(plan.blockers).toEqual([]);
  });

  test('an Ability count over the Aspirant cap is grandfathered: a breach, not a blocker', () => {
    const plan = planConversion(carolineDenton({
      abilities: [
        ability('a1', 'Trickshot', 'gunslinger-v1'), ability('a2', 'Standoff', 'gunslinger-v1'),
        ability('a3', 'Shootout', 'gunslinger-v1'), ability('a4', 'Last Word', 'gunslinger-v2'),
        ability('a5', 'Dead Eye', 'gunslinger-v2'), ability('a6', 'High Noon', 'gunslinger-v2'),
        ability('a7', 'Familiar Face', 'wanderer-v1')
      ],
      abilityPerks: []
    }));
    expect(plan.breaches.map(b => b.rule)).toContain(ABILITY_CAP_RULE);
    expect(plan.blockers).toEqual([]);
  });

  test('two Traits on one Stat block conversion with the validator\'s own message', () => {
    const plan = planConversion(carolineDenton({
      traits: [{ name: 'Brave', stat: 'might' }, { name: 'Bold', stat: 'might' }, { name: 'Lucky', stat: 'luck' }]
    }));
    expect(plan.blockers).toEqual([
      { rule: CONVERSION_RULES.traits, detail: 'Two Traits may not share a Stat (might).' }
    ]);
  });

  test('a Stat over its Cap blocks conversion', () => {
    const plan = planConversion(carolineDenton({ character: { reflex: BASE_STAT_CAP + 2 } }));
    expect(plan.blockers).toEqual([{
      rule: CONVERSION_RULES.statCap,
      detail: capBreachMessage({ stat: 'reflex', value: BASE_STAT_CAP + 2, cap: BASE_STAT_CAP })
    }]);
  });

  test('a Stat Cap purchase is honoured', () => {
    const plan = planConversion(carolineDenton({
      character: { reflex: BASE_STAT_CAP + 1, stat_cap_purchases: { reflex: 1 } }
    }));
    expect(plan.blockers).toEqual([]);
  });

  test('more Signatures than the Aspirant cap block conversion', () => {
    const count = SIGNATURE_CAP.aspirant + 1;
    const plan = planConversion(carolineDenton({
      gear: Array.from({ length: count }, () => signature('Revolver', 'gunslinger-v1'))
    }));
    expect(plan.blockers).toEqual([{
      rule: CONVERSION_RULES.signatureCap,
      detail: `Signature Cap is ${SIGNATURE_CAP.aspirant}; this character carries ${count} (an Enchantment counts as a Signature).`
    }]);
  });

  test('an Enchantment takes a Signature slot', () => {
    const gear = Array.from({ length: SIGNATURE_CAP.aspirant }, () => signature('Revolver', 'gunslinger-v1'));
    gear[0] = signature('Revolver', 'gunslinger-v1', { enchantment: { source: 'default' } });
    const plan = planConversion(carolineDenton({ gear }));
    expect(plan.blockers.map(b => b.rule)).toEqual([CONVERSION_RULES.signatureCap]);
  });

  test('the Signature Cap counts only the items that convert', () => {
    const gear = [
      ...Array.from({ length: SIGNATURE_CAP.aspirant }, () => signature('Revolver', 'gunslinger-v1')),
      signature('Hand Cannon', 'homebrew')
    ];
    const plan = planConversion(carolineDenton({ gear }));
    expect(plan.blockers.map(b => b.rule)).toEqual([CONVERSION_RULES.noFork]);
  });

  // Two own-class Revolvers and one cross-class Satchel, against the
  // Aspirant creation grant with no missions.
  test('the Merx breakdown prices the converted build under Aspirant', () => {
    const plan = planConversion(carolineDenton());
    const spend = 2 * priceOfSignature({ crossClass: false }) + priceOfSignature({ crossClass: true });
    expect(plan.merxBreakdown).toEqual({
      earned: CREATION_GRANT.aspirant,
      spend,
      reward: Math.max(0, CREATION_GRANT.aspirant - spend),
      deficit: Math.max(0, spend - CREATION_GRANT.aspirant)
    });
  });

  test('without a target there is nothing to judge', () => {
    const plan = planConversion(carolineDenton({ character: { class_id: 'homebrew' } }));
    expect(plan.breaches).toEqual([]);
    expect(plan.perkBreakdown).toBeNull();
    expect(plan.merxBreakdown).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/aspirant-conversion.test.js`
Expected: the new tests FAIL (`plan.breaches` / `plan.perkBreakdown` undefined, no validator blockers); Tasks 4-5 tests pass.

- [ ] **Step 3: Implement**

In `util/aspirant-conversion.js`, extend the requires:

```js
const { computeVersionFamily } = require('./class-family');
const { statList } = require('./enclave-consts');
const { deriveBuildBreaches, derivePerkBreakdown, deriveMerxBreakdown } = require('./character-derived');
const { validateTraits, validateStatLimits, validateEconomyLimits } = require('../services/character/input');
```

Change the destructuring of `planConversion`'s argument to:

```js
const planConversion = ({
  character, classes, gear, abilities, abilityPerks, traits, realMissions, offscreenMissions
}) => {
```

Replace the no-target `return { … }` with:

```js
    return {
      target: null,
      gear: [],
      abilities: [],
      abilityPerks: [],
      blockers: [{
        rule: CONVERSION_RULES.noFork,
        detail: `${own ? own.name : character.class || 'This class'} has no Aspirant version.`
      }],
      breaches: [],
      perkBreakdown: null,
      merxBreakdown: null
    };
```

Replace the final `return { target, gear: convertedGear, … }` with:

```js
  // The rules Aspirant enforces on every save, judged by the validators that
  // enforce them -- this module restates no figure. Stat Cap only: the
  // creation allotment and +++ ceiling are creation rules (validateStatLimits).
  const addBlockers = (rule, result) => {
    if (!result.ok) for (const detail of result.errors) blockers.push({ rule, detail });
  };
  addBlockers(CONVERSION_RULES.traits, validateTraits(traits, { economy: ASPIRANT }));
  addBlockers(CONVERSION_RULES.statCap, validateStatLimits({
    economy: ASPIRANT,
    stats: Object.fromEntries(statList.map(stat => [stat, character[stat]])),
    traits,
    capPurchases: character.stat_cap_purchases,
    enforceCreationAllotment: false
  }));
  addBlockers(CONVERSION_RULES.signatureCap, validateEconomyLimits({
    economy: ASPIRANT,
    gear: convertedGear,
    enforceMerxBudget: false,
    enforceAbilityLimits: false
  }));

  // Ability cap and Perk deficit are grandfathered by the ratchet after
  // conversion, so they are reported, not blocking.
  const family = computeVersionFamily(rows, target.id);
  const perkArgs = {
    economy: ASPIRANT,
    level: character.level,
    abilities: convertedAbilities,
    abilityPerks: convertedPerks,
    characterClassId: target.id,
    classFamilyOf: (classId) => (family.has(classId) ? target.id : classId)
  };

  return {
    target,
    gear: convertedGear,
    abilities: convertedAbilities,
    abilityPerks: convertedPerks,
    blockers,
    breaches: deriveBuildBreaches(perkArgs),
    perkBreakdown: derivePerkBreakdown(perkArgs),
    merxBreakdown: deriveMerxBreakdown({
      realMissions,
      offscreenMissions,
      gear: convertedGear,
      commonItems: character.common_items,
      characterClassId: target.id,
      economy: ASPIRANT
    })
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Run the unit tier** (the new `util → services/character/input` require must not introduce a cycle)

Run: `bun run test:unit`
Expected: 0 failures.

- [ ] **Step 6: Commit**

```bash
git add util/aspirant-conversion.js util/aspirant-conversion.test.js
git commit -m "feat: judge a planned Aspirant conversion with the existing validators

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `CharacterService.convertToAspirant` / `planAspirantConversion`, the catalogue read, the model wrappers

**Files:**
- Modify: `services/character/repository.js` (new `getConversionClasses` beside `getClassFamilyRows` `:201-211`; export beside `getClassFamilyRows` in `module.exports`)
- Modify: `services/character/service.js:1-19` (require), `:23-55` (`REQUIRED_ADAPTER_METHODS`), after `requireOwnedCharacterLean` (`:120-130`), beside `upgradeClass` (`:889`)
- Modify: `models/character.js:486-497` (wrappers), `module.exports`
- Test: `services/character/service.test.js`, `test/character-wizard-client.test.js:1142-1147`

**Interfaces:**
- Consumes: `planConversion` (Tasks 5-6); `economyFor`; the existing `requireOwnedCharacter`; adapter `getCharacter`, `getRealMissions`, `listOffscreenMissions`, `saveCharacterAtomic`.
- Produces:
  - adapter `getConversionClasses() -> { data: [{ id, name, base_class_id, rules_edition, content_format, gear, abilities, advanced_abilities }], error }` (required adapter method).
  - `service.planAspirantConversion(actor, id) -> { data: plan | null, error }` -- `null` when the character is not eligible.
  - `service.convertToAspirant(actor, id) -> { data: characterRow, error }`; ineligible or blocked -> `{ data: null, error: { status: 400, message } }`; throws `AuthorizationError` for a non-owner.
  - `models/character.js`: `planCharacterAspirantConversion(actor, id)`, `convertCharacterToAspirant(actor, id)`.

- [ ] **Step 1: Write the failing service tests**

In `services/character/service.test.js`:
- add `const { statList } = require('../../util/enclave-consts');` to the requires;
- add to `makeAdapter`'s defaults (after `getClassFamilyRows`): `getConversionClasses: async () => ok([]),`

and append:

```js
// --- convertToAspirant / planAspirantConversion -----------------------------

const CONVERSION_CLASSES = [
  { id: 'gunslinger-v1', name: 'Gunslinger', rules_edition: 'advent', content_format: 'advent', base_class_id: null, gear: [], abilities: [], advanced_abilities: [] },
  { id: 'gunslinger-v2', name: 'Gunslinger', rules_edition: 'advent', content_format: 'advent', base_class_id: 'gunslinger-v1', gear: [], abilities: [], advanced_abilities: [] },
  {
    id: 'gunslinger-aspirant', name: 'Gunslinger', rules_edition: 'aspirant', content_format: 'aspirant', base_class_id: 'gunslinger-v1',
    gear: [{ name: 'Revolver', description: 'A six-shooter.' }],
    abilities: [{ name: 'Trickshot', description: 'Bank it.' }],
    advanced_abilities: []
  },
  { id: 'wanderer-v1', name: 'Wanderer', rules_edition: 'advent', content_format: 'advent', base_class_id: null, gear: [{ name: 'Grapple Gun' }], abilities: [], advanced_abilities: [] }
];

const CONVERSION_TRAITS = [
  { name: 'Brave', stat: 'might' }, { name: 'Clever', stat: 'intelligence' }, { name: 'Lucky', stat: 'luck' }
];

const adventGunslinger = (overrides = {}) => ({
  id: 'character-1', creator_id: 'profile-1', name: 'Caroline', class: 'Gunslinger',
  class_id: 'gunslinger-v2', creator_mode: null, level: 3, common_items: [], stat_cap_purchases: {},
  ...Object.fromEntries(statList.map(stat => [stat, 1])),
  traits: CONVERSION_TRAITS,
  gear: [{ id: 'g1', name: 'Revolver', class_id: 'gunslinger-v1', enchantment: null, mods: [] }],
  abilities: [{ id: 'ab-1', name: 'Trickshot', class_id: 'gunslinger-v1', type: 'core' }],
  ability_perks: [{ id: 'p1', class_ability_id: 'ab-1', text: 'Off the wall.', position: 0, compounds_with: null }],
  ...overrides
});

const conversionAdapter = (calls, character = adventGunslinger()) => makeAdapter(calls, {
  getCharacter: async () => ok(character),
  getConversionClasses: async () => ok(CONVERSION_CLASSES),
  saveCharacterAtomic: async (args) => {
    calls.push(['saveCharacterAtomic', args]);
    return ok({ id: 'character-1', name: character.name, class_id: args.character.class_id });
  }
});

test('convertToAspirant throws for a non-owner and saves nothing', async () => {
  const calls = [];
  const service = new CharacterService(conversionAdapter(calls));
  await expect(service.convertToAspirant(STRANGER, 'character-1')).rejects.toBeInstanceOf(AuthorizationError);
  expect(calls).toEqual([]);
});

// p_character carries only the three columns conversion changes, so the RPC
// keeps every other column (Quirk, Accessories, level, story fields). Traits
// are resubmitted because save_character_atomic reads an absent list as
// "no Traits" and would delete them.
test('convertToAspirant saves the fork, the remapped rows and the Perks by Ability name', async () => {
  const calls = [];
  const service = new CharacterService(conversionAdapter(calls));
  const result = await service.convertToAspirant(CREATOR, 'character-1');
  expect(result.error).toBeNull();
  expect(result.data.class_id).toBe('gunslinger-aspirant');
  expect(calls).toEqual([['saveCharacterAtomic', {
    characterId: 'character-1',
    creatorId: 'profile-1',
    character: { class_id: 'gunslinger-aspirant', class: 'Gunslinger', creator_mode: 'aspirant' },
    traits: CONVERSION_TRAITS,
    gear: [{ name: 'Revolver', class_id: 'gunslinger-aspirant', description: 'A six-shooter.', enchantment: null, mods: [] }],
    abilities: [{ name: 'Trickshot', class_id: 'gunslinger-aspirant', description: 'Bank it.', type: 'core' }],
    perks: [{ class_ability_id: null, ability_name: 'Trickshot', text: 'Off the wall.', position: 0, compounds_with: null }]
  }]]);
});

test('an admin conversion keeps the owner as the row\'s creator', async () => {
  const calls = [];
  const service = new CharacterService(conversionAdapter(calls));
  const result = await service.convertToAspirant(ADMIN, 'character-1');
  expect(result.error).toBeNull();
  expect(calls[0][1].creatorId).toBe('profile-1');
});

test('convertToAspirant refuses a blocked build, listing every blocker, and saves nothing', async () => {
  const calls = [];
  const character = adventGunslinger({
    gear: [
      { id: 'g1', name: 'Revolver', class_id: 'gunslinger-v1', enchantment: null, mods: [] },
      { id: 'g2', name: 'Grapple Gun', class_id: 'wanderer-v1', enchantment: null, mods: [] }
    ],
    traits: [{ name: 'Brave', stat: 'might' }, { name: 'Bold', stat: 'might' }, { name: 'Lucky', stat: 'luck' }]
  });
  const service = new CharacterService(conversionAdapter(calls, character));
  const result = await service.convertToAspirant(CREATOR, 'character-1');
  expect(result.data).toBeNull();
  expect(result.error.status).toBe(400);
  expect(result.error.message).toContain('Caroline cannot convert to Aspirant yet.');
  expect(result.error.message).toContain('Grapple Gun comes from Wanderer, which has no Aspirant version. Remove it to convert.');
  expect(result.error.message).toContain('Two Traits may not share a Stat (might).');
  expect(calls).toEqual([]);
});

// A stale edit page can still show the Convert button after the character was
// converted in another tab; the POST must explain itself and change nothing.
test('convertToAspirant refuses a character already converted', async () => {
  const calls = [];
  const character = adventGunslinger({ class_id: 'gunslinger-aspirant', creator_mode: 'aspirant' });
  const service = new CharacterService(conversionAdapter(calls, character));
  const result = await service.convertToAspirant(CREATOR, 'character-1');
  expect(result).toEqual({
    data: null,
    error: { status: 400, message: 'Caroline is not on the Advent rules, so there is nothing to convert.' }
  });
  expect(calls).toEqual([]);
});

test('convertToAspirant refuses an aspirant creator_mode on an Advent class', async () => {
  const calls = [];
  const service = new CharacterService(conversionAdapter(calls, adventGunslinger({ creator_mode: 'aspirant' })));
  const result = await service.convertToAspirant(CREATOR, 'character-1');
  expect(result.error.status).toBe(400);
  expect(calls).toEqual([]);
});

test('convertToAspirant refuses a class with no Aspirant fork', async () => {
  const calls = [];
  const service = new CharacterService(conversionAdapter(calls, adventGunslinger({ class: 'Wanderer', class_id: 'wanderer-v1' })));
  const result = await service.convertToAspirant(CREATOR, 'character-1');
  expect(result).toEqual({ data: null, error: { status: 400, message: 'Wanderer has no Aspirant version.' } });
  expect(calls).toEqual([]);
});

test('planAspirantConversion returns the plan for an eligible character', async () => {
  const service = new CharacterService(conversionAdapter([]));
  const { data, error } = await service.planAspirantConversion(CREATOR, 'character-1');
  expect(error).toBeNull();
  expect(data.target.id).toBe('gunslinger-aspirant');
  expect(data.blockers).toEqual([]);
  expect(data.perkBreakdown).not.toBeNull();
});

test('planAspirantConversion returns no plan for an ineligible character', async () => {
  const service = new CharacterService(conversionAdapter([], adventGunslinger({ class_id: 'wanderer-v1' })));
  expect(await service.planAspirantConversion(CREATOR, 'character-1')).toEqual({ data: null, error: null });
});

test('planAspirantConversion throws for a non-owner', async () => {
  const service = new CharacterService(conversionAdapter([]));
  await expect(service.planAspirantConversion(STRANGER, 'character-1')).rejects.toBeInstanceOf(AuthorizationError);
});

test('a catalogue read failure is returned, not thrown', async () => {
  const service = new CharacterService(makeAdapter([], {
    getCharacter: async () => ok(adventGunslinger()),
    getConversionClasses: async () => ({ data: null, error: { message: 'boom' } })
  }));
  expect(await service.convertToAspirant(CREATOR, 'character-1')).toEqual({ data: null, error: { message: 'boom' } });
});
```

In `test/character-wizard-client.test.js`, add `'getConversionClasses'` to `UNREACHED_ADAPTER_METHODS` (`:1142-1147`), after `'getClassFamilyRows'`.

- [ ] **Step 2: Run them to verify they fail**

```bash
env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/character/service.test.js
```

Expected: the new tests FAIL with `service.convertToAspirant is not a function` (and `planAspirantConversion`); existing tests pass.

- [ ] **Step 3: Add the catalogue read to the repository**

In `services/character/repository.js`, after `getClassFamilyRows`:

```js
// Powers services/character/service.js's Aspirant conversion: family and
// fork lookup need the same three family columns getClassFamilyRows selects
// (util/class-family.js fails closed without them), and the remap needs each
// fork's name and catalogue lists. Every class, not only public ones: a
// character's cross-class item can come from any class it once unlocked.
const getConversionClasses = async () => {
  const { data, error } = await supabaseAdmin
    .from('classes')
    .select('id, name, base_class_id, rules_edition, content_format, gear, abilities, advanced_abilities');
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data: data || [], error: null };
};
```

and in `module.exports`, after `getClassFamilyRows,` add `getConversionClasses,`.

- [ ] **Step 4: Implement the service**

In `services/character/service.js`:

Add to the requires (after the `class-family` line):

```js
const { planConversion } = require('../../util/aspirant-conversion');
```

Add `'getConversionClasses',` to `REQUIRED_ADAPTER_METHODS` directly after `'getClassFamilyRows',`.

After `requireOwnedCharacterLean` add:

```js
// Everything a conversion is judged on, loaded once for both the preview and
// the POST so the two can never disagree. `ineligible` is why the character is
// not offered conversion at all; blockers stay on the plan.
const loadAspirantConversion = async (adapter, actor, id) => {
  const character = await requireOwnedCharacter(adapter, actor, id);
  const { data: classes, error: classesError } = await adapter.getConversionClasses();
  if (classesError) return { error: classesError };
  const ownClass = (classes || []).find(row => row.id === character.class_id);
  const economy = economyFor({
    contentFormat: ownClass && ownClass.content_format,
    creatorMode: character.creator_mode
  });
  if (economy !== 'advent') {
    return { ineligible: `${character.name} is not on the Advent rules, so there is nothing to convert.` };
  }
  const [missions, offscreenMissions] = await Promise.all([
    adapter.getRealMissions(id),
    adapter.listOffscreenMissions(id)
  ]);
  if (missions.error || offscreenMissions.error) return { error: missions.error || offscreenMissions.error };
  const plan = planConversion({
    character,
    classes: classes || [],
    gear: character.gear,
    abilities: character.abilities,
    abilityPerks: character.ability_perks,
    traits: character.traits,
    realMissions: missions.data || [],
    offscreenMissions: offscreenMissions.data || []
  });
  if (!plan.target) return { ineligible: plan.blockers.map(blocker => blocker.detail).join(' ') };
  return { character, plan };
};
```

After `upgradeClass` add:

```js
  async planAspirantConversion(actor, id) {
    const loaded = await loadAspirantConversion(this.adapter, actor, id);
    if (loaded.error) return { data: null, error: loaded.error };
    return { data: loaded.plan ?? null, error: null };
  }

  // One-way: the converted character is on the aspirant economy, which is
  // never eligible, and the fork is outside its Advent parent's family, so
  // Upgrade never offers the way back. The plan is recomputed here, never
  // taken from the client.
  async convertToAspirant(actor, id) {
    const loaded = await loadAspirantConversion(this.adapter, actor, id);
    if (loaded.error) return { data: null, error: loaded.error };
    if (loaded.ineligible) return { data: null, error: { status: 400, message: loaded.ineligible } };
    const { character, plan } = loaded;
    if (plan.blockers.length > 0) {
      return {
        data: null,
        error: {
          status: 400,
          message: `${character.name} cannot convert to Aspirant yet. ${plan.blockers.map(blocker => blocker.detail).join(' ')}`
        }
      };
    }
    // save_character_atomic reads an absent Trait list as "no Traits" and
    // deletes them, so the stored three are resubmitted.
    return this.adapter.saveCharacterAtomic({
      characterId: id,
      creatorId: character.creator_id,
      character: { class_id: plan.target.id, class: plan.target.name, creator_mode: 'aspirant' },
      traits: (character.traits || []).map(({ name, stat }) => ({ name, stat })),
      gear: plan.gear,
      abilities: plan.abilities,
      perks: plan.abilityPerks
    });
  }
```

- [ ] **Step 5: Add the model wrappers**

In `models/character.js`, after `const upgradeCharacterClass = …`:

```js
const planCharacterAspirantConversion = (actor, id) => characterService.planAspirantConversion(actor, id);
const convertCharacterToAspirant = (actor, id) => characterService.convertToAspirant(actor, id);
```

and in `module.exports`, after `upgradeCharacterClass,`:

```js
  planCharacterAspirantConversion,
  convertCharacterToAspirant,
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/character/service.test.js
env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test test/character-wizard-client.test.js
```

Expected: PASS.

- [ ] **Step 7: Run the unit tier**

Run: `bun run test:unit`
Expected: 0 failures.

- [ ] **Step 8: Commit**

```bash
git add services/character/repository.js services/character/service.js services/character/service.test.js test/character-wizard-client.test.js models/character.js
git commit -m "feat: convert an owned Advent character to its Aspirant fork

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `POST /characters/:id/convert-aspirant` and the edit-page panel

**Files:**
- Modify: `routes/characters.js:6-23` (require), `:595-598` (edit route, after `upgradeTargets`), `:615` (render locals), after `:1382` (new route)
- Modify: `views/character-form.handlebars` (after the Upgrade block, `:100-116`)
- Test: `routes/characters.test.js`

**Interfaces:**
- Consumes: `planCharacterAspirantConversion(actor, id)`, `convertCharacterToAspirant(actor, id)` (Task 7); the plan shape of Tasks 5-6.
- Produces: `POST /characters/:id/convert-aspirant` -> `HX-Location: /characters/<id>/<encoded name>` on success, the business error rendered through `sendRouteError` otherwise; the edit form renders `#aspirant-conversion` whenever `aspirantConversion` is set.

- [ ] **Step 1: Write the failing route tests**

In `routes/characters.test.js`:

Add to the `mock.module('../models/character', …)` object:

```js
  // GET /:id/edit asks for the conversion preview on every render; a test
  // offers one by setting pageState.conversionPlan.
  planCharacterAspirantConversion: async (actor, id) => {
    pageState.lastPlanArgs = { actor, id };
    return { data: pageState.conversionPlan || null, error: null };
  },
  convertCharacterToAspirant: async (actor, id) => {
    pageState.lastConvert = { actor, id };
    return pageState.conversionResult || { data: { id, name: 'Ash' }, error: null };
  },
```

Add to `beforeEach`:

```js
  pageState.conversionPlan = null;
  pageState.conversionResult = null;
  pageState.lastConvert = null;
  pageState.lastPlanArgs = null;
```

Append:

```js
// --- Convert to Aspirant ------------------------------------------------------

const conversionPlan = (blockers = []) => ({
  target: { id: 'class-fork', name: 'Gunslinger' },
  gear: [],
  abilities: [
    { name: 'Trickshot', class_id: 'class-fork', type: 'core' },
    { name: 'Familiar Face', class_id: 'class-wanderer-fork', type: 'core' }
  ],
  abilityPerks: [],
  blockers,
  breaches: [{ severity: 'hard', rule: 'perk-deficit', detail: '6 Perks spent of 4 earned.' }],
  perkBreakdown: { earned: 4, spend: 6, remaining: 0, deficit: 2 },
  merxBreakdown: { earned: 12, spend: 20, reward: 0, deficit: 8 }
});

const editPage = async () => {
  pageState.character = { ...makePageCharacter(3), creator_id: 'profile-1' };
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });
  expect(res.status).toBe(200);
  return res.text();
};

test('the edit form offers conversion with the after-conversion build and a live Convert button', async () => {
  pageState.conversionPlan = conversionPlan();
  const body = await editPage();
  expect(pageState.lastPlanArgs).toEqual({ actor: expect.objectContaining({ profileId: 'profile-1' }), id: CHAR_ID });
  expect(body).toContain('id="aspirant-conversion"');
  expect(body).toContain('Familiar Face');
  expect(body).toContain('<strong>Perks spent:</strong> 6');
  expect(body).toContain('<strong>Deficit:</strong> 8');
  expect(body).toContain('<strong>Illegal Build:</strong> 6 Perks spent of 4 earned.');
  expect(body).toContain(`hx-post="/characters/${CHAR_ID}/convert-aspirant"`);
  expect(body).toContain('hx-confirm="Convert Ash to Aspirant? This cannot be undone."');
});

test('the edit form lists blockers and disables the Convert button', async () => {
  pageState.conversionPlan = conversionPlan([
    { rule: 'no-counterpart', detail: 'Grapple Gun (Wanderer) has no Aspirant version. Remove it to convert.' }
  ]);
  const body = await editPage();
  expect(body).toContain('<li>Grapple Gun (Wanderer) has no Aspirant version. Remove it to convert.</li>');
  expect(body).toMatch(/<button type="button" class="button is-link" disabled>Convert to Aspirant<\/button>/);
  expect(body).not.toContain('/convert-aspirant"');
});

test('the edit form offers no conversion to an ineligible character', async () => {
  const body = await editPage();
  expect(body).not.toContain('aspirant-conversion');
  expect(body).not.toContain('Convert to Aspirant');
});

test('POST /characters/:id/convert-aspirant sends the player to the converted sheet', async () => {
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/convert-aspirant`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'HX-Request': 'true' },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('HX-Location')).toBe(`/characters/${CHAR_ID}/Ash`);
  expect(pageState.lastConvert).toEqual({ actor: expect.objectContaining({ profileId: 'profile-1' }), id: CHAR_ID });
});

test('POST /characters/:id/convert-aspirant renders a refusal with its reason', async () => {
  pageState.conversionResult = {
    data: null,
    error: { status: 400, message: 'Ash cannot convert to Aspirant yet. Grapple Gun (Wanderer) has no Aspirant version. Remove it to convert.' }
  };
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/convert-aspirant`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'HX-Request': 'true' },
  });
  expect(res.status).toBe(400);
  expect(res.headers.get('HX-Location')).toBeNull();
  expect(await res.text()).toContain('Grapple Gun (Wanderer) has no Aspirant version.');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/characters.test.js`
Expected: the first two panel tests FAIL (no `aspirant-conversion` in the body); the POST tests FAIL with 404; the ineligible test passes.

- [ ] **Step 3: Implement the route**

In `routes/characters.js`, add `planCharacterAspirantConversion,` and `convertCharacterToAspirant,` to the `require('../models/character')` destructuring (after `upgradeCharacterClass,`).

In `GET /:id/edit`, directly after the `upgradeTargets` block (`:595-598`):

```js
    // The plan convertToAspirant will judge the POST against. The panel is an
    // offer beside the form, so a preview that fails leaves it out rather
    // than failing the edit page.
    let aspirantConversion = null;
    try {
      ({ data: aspirantConversion } = await planCharacterAspirantConversion(actorFromLocals(res.locals), id));
    } catch (_) {
      aspirantConversion = null;
    }
```

and in the `res.render('character-form', { … })` locals, after `upgradeTargets,`:

```js
      aspirantConversion,
```

After the `POST /:id/upgrade` route:

```js
router.post('/:id/convert-aspirant', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { id } = req.params;
  const { data, error } = await convertCharacterToAspirant(actor, id);
  if (error) return sendRouteError(req, res, error);
  return res.header('HX-Location', `/characters/${id}/${encodeURIComponent(data.name)}`).send();
}));
```

- [ ] **Step 4: Implement the panel**

In `views/character-form.handlebars`, directly after the Upgrade block's closing `{{/if}}` (`:116`):

```handlebars
  {{#if aspirantConversion}}
  <div class="notification is-link is-light" id="aspirant-conversion">
    <p>This character can move to the Aspirant rules as <strong>{{aspirantConversion.target.name}}</strong>, keeping its whole build.</p>
    <p class="mt-2"><strong>Abilities after conversion:</strong>
      {{#each aspirantConversion.abilities}}{{this.name}}{{#unless @last}}, {{/unless}}{{/each}}</p>
    {{#if aspirantConversion.perkBreakdown}}
    <p><strong>Perks earned:</strong> {{aspirantConversion.perkBreakdown.earned}}</p>
    <p><strong>Perks spent:</strong> {{aspirantConversion.perkBreakdown.spend}}</p>
    {{/if}}
    {{#if aspirantConversion.merxBreakdown}}
    <p><strong>Merx earned:</strong> {{aspirantConversion.merxBreakdown.earned}}</p>
    <p><strong>Merx spent:</strong> {{aspirantConversion.merxBreakdown.spend}}</p>
    {{#if aspirantConversion.merxBreakdown.deficit}}
    <p class="has-text-danger"><strong>Deficit:</strong> {{aspirantConversion.merxBreakdown.deficit}}</p>
    {{/if}}
    {{/if}}
    {{#each aspirantConversion.breaches}}
      {{#if (eq this.severity "hard")}}
      <p class="has-text-danger"><strong>Illegal Build:</strong> {{this.detail}}</p>
      {{else}}
      <p class="has-text-warning"><strong>Not available in this edition:</strong> {{this.detail}}</p>
      {{/if}}
    {{/each}}
    {{#if aspirantConversion.blockers.length}}
    <p class="mt-2">Change these on this form before converting:</p>
    <ul>
      {{#each aspirantConversion.blockers}}
      <li>{{this.detail}}</li>
      {{/each}}
    </ul>
    <div class="buttons mt-2">
      <button type="button" class="button is-link" disabled>Convert to Aspirant</button>
    </div>
    {{else}}
    <div class="buttons mt-2">
      <button type="button" class="button is-link"
              hx-post="/characters/{{character.id}}/convert-aspirant"
              hx-confirm="Convert {{character.name}} to Aspirant? This cannot be undone."
              hx-swap="none">Convert to Aspirant</button>
    </div>
    {{/if}}
    <p class="is-size-7 has-text-grey mt-2">One-way. Illegal Build lines above carry over to the sheet and do not stop the conversion.</p>
  </div>
  {{/if}}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run the Step 2 command. Expected: PASS, including every pre-existing edit-form test (they get `data: null` from the mock and render no panel).

- [ ] **Step 6: Run the HTTP and unit tiers**

```bash
bun run test:http
bun run test:unit
```

Expected: `test:http` fails exactly `routes/open-graph.test.js`; `test:unit` 0 failures.

- [ ] **Step 7: Commit**

```bash
git add routes/characters.js routes/characters.test.js views/character-form.handlebars
git commit -m "feat: offer Convert to Aspirant on the character edit page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Conversion against the real RPC

**Files:**
- Create: `models/character-convert-aspirant.integration.test.js`
- Modify: `scripts/run-tests.mjs` (`integrationFiles`)

**Interfaces:**
- Consumes: `convertCharacterToAspirant`, `updateCharacter` (`models/character.js`); the Task 1 migration applied locally.
- Produces: proof that the payload Task 7 builds survives `save_character_atomic` end to end.

- [ ] **Step 1: Write the test**

Create `models/character-convert-aspirant.integration.test.js`:

```js
// Local-Supabase integration coverage for Convert to Aspirant: the payload
// CharacterService builds survives save_character_atomic -- rows move to the
// forks, Perks re-attach to their Abilities, and everything conversion does
// not name stays as it was.
require('../util/require-local-supabase');

const { test, expect, beforeAll, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('./_base');
const { convertCharacterToAspirant, updateCharacter } = require('./character');
const { statList } = require('../util/enclave-consts');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `convert-aspirant-${suffix}@example.test`;
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});

const STATS = Object.fromEntries(statList.map(stat => [stat, 1]));
const TRAITS = [{ name: 'Brave', stat: 'might' }, { name: 'Clever', stat: 'intelligence' }, { name: 'Lucky', stat: 'luck' }];
const QUIRKS = [{ name: 'Night Owl', downside: 'Sleeps through mornings.', upside: 'Sees in the dark.' }];
const ACCESSORIES = [{ name: 'Pocket Watch' }];

let authUserId;
let profile;
let characterId;
const classes = {};

const insertClass = async (row) => {
  const { data, error } = await supabaseAdmin.from('classes')
    .insert({ is_public: true, advanced_abilities: [], ...row })
    .select()
    .single();
  if (error) throw error;
  return data;
};

const perkRows = () => db.query(
  `select p.text, p.position, a.name as ability, a.class_id, target.text as compounds_with_text
   from character_perks p
   join class_abilities a on a.id = p.class_ability_id
   left join character_perks target on target.id = p.compounds_with
   where p.character_id = $1
   order by p.position`,
  [characterId]
);

beforeAll(async () => {
  await db.connect();
  const { rows } = await db.query(
    `insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
     values (gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
     returning id`,
    [email]
  );
  authUserId = rows[0].id;
  ({ data: profile } = await supabaseAdmin.from('profiles')
    .insert({ user_id: authUserId, name: `Convert ${suffix}`, is_public: true, timezone: 'UTC' })
    .select()
    .single());

  const gunslingerContent = {
    gear: [{ name: 'Revolver' }, { name: 'Duster' }],
    abilities: [{ name: 'Trickshot' }, { name: 'Standoff' }, { name: 'Shootout' }]
  };
  classes.gunslingerV1 = await insertClass({
    name: `Conv Gunslinger ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v1',
    ...gunslingerContent
  });
  classes.gunslingerV2 = await insertClass({
    name: `Conv Gunslinger ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v2',
    base_class_id: classes.gunslingerV1.id, ...gunslingerContent
  });
  classes.gunslingerFork = await insertClass({
    name: `Conv Gunslinger ${suffix}`, rules_edition: 'aspirant', content_format: 'aspirant', rules_version: 'v2',
    base_class_id: classes.gunslingerV1.id,
    gear: [{ name: 'Revolver', description: 'Aspirant six-shooter.' }, { name: 'Duster' }],
    abilities: [{ name: 'Trickshot' }, { name: 'Standoff' }, { name: 'Shootout' }],
    advanced_abilities: [{ name: 'Last Word' }]
  });
  classes.wandererV1 = await insertClass({
    name: `Conv Wanderer ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v1',
    gear: [{ name: 'Satchel' }], abilities: [{ name: 'Familiar Face' }]
  });
  classes.wandererFork = await insertClass({
    name: `Conv Wanderer ${suffix}`, rules_edition: 'aspirant', content_format: 'aspirant', rules_version: 'v2',
    base_class_id: classes.wandererV1.id,
    gear: [{ name: 'Satchel' }], abilities: [{ name: 'Familiar Face' }]
  });

  // An Advent Gunslinger v2 whose rows sit on the v1 row of its family,
  // carrying two Revolvers and Wanderer's Familiar Face, at level 4.
  const { data: created, error } = await supabaseAdmin.rpc('save_character_atomic', {
    p_character_id: null,
    p_creator_id: profile.id,
    p_character: {
      ...STATS,
      creator_id: profile.id, name: `Convert ${suffix}`,
      class: classes.gunslingerV2.name, class_id: classes.gunslingerV2.id, creator_mode: null,
      level: 4, completed_missions: 0, commissary_reward: 0,
      quirks: QUIRKS, accessories: ACCESSORIES
    },
    p_traits: TRAITS,
    p_gear: [
      { name: 'Revolver', class_id: classes.gunslingerV1.id },
      { name: 'Revolver', class_id: classes.gunslingerV1.id },
      { name: 'Satchel', class_id: classes.wandererV1.id }
    ],
    p_abilities: [
      { name: 'Trickshot', class_id: classes.gunslingerV1.id, type: 'core' },
      { name: 'Standoff', class_id: classes.gunslingerV1.id, type: 'core' },
      { name: 'Shootout', class_id: classes.gunslingerV1.id, type: 'core' },
      { name: 'Familiar Face', class_id: classes.wandererV1.id, type: 'core' }
    ],
    p_perks: [
      { ability_name: 'Trickshot', text: 'Off the wall.', position: 0 },
      { ability_name: 'Standoff', text: 'Stare them down.', position: 1 },
      { ability_name: 'Standoff', text: 'Twice as long.', position: 2, compounds_with: 'position-1' },
      { ability_name: 'Familiar Face', text: 'Known in every town.', position: 3 }
    ]
  });
  if (error) throw error;
  characterId = created.id;

  // A compound whose parent is on a DIFFERENT Ability. Nothing in the app
  // writes one, but nothing in the schema forbids it either.
  await db.query(
    `update character_perks set compounds_with =
       (select id from character_perks where character_id = $1 and position = 0)
     where character_id = $1 and position = 3`,
    [characterId]
  );
});

afterAll(async () => {
  if (profile?.id) await db.query('delete from characters where creator_id = $1', [profile.id]);
  if (profile?.id) await db.query('delete from profiles where id = $1', [profile.id]);
  for (const key of ['gunslingerFork', 'wandererFork', 'gunslingerV2', 'gunslingerV1', 'wandererV1']) {
    if (classes[key]?.id) await db.query('delete from classes where id = $1', [classes[key].id]);
  }
  if (authUserId) await db.query('delete from auth.users where id = $1', [authUserId]);
  await db.end();
});

test('conversion moves the character, its rows and its Perks onto the Aspirant forks', async () => {
  const { data, error } = await convertCharacterToAspirant({ profileId: profile.id }, characterId);
  expect(error).toBeNull();
  expect(data.class_id).toBe(classes.gunslingerFork.id);

  const { rows: [row] } = await db.query(
    'select class_id, class, creator_mode, level, quirks, accessories from characters where id = $1', [characterId]
  );
  expect(row).toEqual({
    class_id: classes.gunslingerFork.id,
    class: classes.gunslingerFork.name,
    creator_mode: 'aspirant',
    level: 4,
    quirks: QUIRKS,
    accessories: ACCESSORIES
  });

  const { rows: gear } = await db.query(
    'select name, class_id, description from class_gear where character_id = $1 order by name, id', [characterId]
  );
  expect(gear).toEqual([
    { name: 'Revolver', class_id: classes.gunslingerFork.id, description: 'Aspirant six-shooter.' },
    { name: 'Revolver', class_id: classes.gunslingerFork.id, description: 'Aspirant six-shooter.' },
    { name: 'Satchel', class_id: classes.wandererFork.id, description: null }
  ]);

  const { rows: abilities } = await db.query(
    'select name, class_id, type from class_abilities where character_id = $1 order by name', [characterId]
  );
  expect(abilities).toEqual([
    { name: 'Familiar Face', class_id: classes.wandererFork.id, type: 'core' },
    { name: 'Shootout', class_id: classes.gunslingerFork.id, type: 'core' },
    { name: 'Standoff', class_id: classes.gunslingerFork.id, type: 'core' },
    { name: 'Trickshot', class_id: classes.gunslingerFork.id, type: 'core' }
  ]);

  const { rows: traits } = await db.query(
    'select name, stat from traits where character_id = $1 order by name', [characterId]
  );
  expect(traits).toEqual(TRAITS);
});

test('every Perk stays on its Ability; a same-Ability compound keeps its link, a cross-Ability one becomes a plain Perk', async () => {
  const { rows } = await perkRows();
  expect(rows.map(({ text, position, ability, compounds_with_text }) => ({ text, position, ability, compounds_with_text }))).toEqual([
    { text: 'Off the wall.', position: 0, ability: 'Trickshot', compounds_with_text: null },
    { text: 'Stare them down.', position: 1, ability: 'Standoff', compounds_with_text: null },
    { text: 'Twice as long.', position: 2, ability: 'Standoff', compounds_with_text: 'Stare them down.' },
    { text: 'Known in every town.', position: 3, ability: 'Familiar Face', compounds_with_text: null }
  ]);
});

test('a second conversion is refused and changes nothing', async () => {
  const result = await convertCharacterToAspirant({ profileId: profile.id }, characterId);
  expect(result.data).toBeNull();
  expect(result.error).toEqual({
    status: 400,
    message: `Convert ${suffix} is not on the Advent rules, so there is nothing to convert.`
  });
  const { rows } = await perkRows();
  expect(rows).toHaveLength(4);
});

test('an ordinary edit of the converted character saves and keeps its v2 fields', async () => {
  const { rows: perks } = await db.query(
    `select p.class_ability_id, p.text, p.position, target.position as target_position
     from character_perks p left join character_perks target on target.id = p.compounds_with
     where p.character_id = $1 order by p.position`,
    [characterId]
  );
  const result = await updateCharacter(characterId, {
    ...STATS,
    name: `Converted ${suffix}`,
    level: 4,
    trait0: 'Brave', trait0_stat: 'might',
    trait1: 'Clever', trait1_stat: 'intelligence',
    trait2: 'Lucky', trait2_stat: 'luck',
    quirks: QUIRKS,
    accessories: ACCESSORIES,
    ability_perks: perks.map(perk => ({
      class_ability_id: perk.class_ability_id,
      text: perk.text,
      position: perk.position,
      compounds_with: perk.target_position == null ? null : `position-${perk.target_position}`
    }))
  }, { id: profile.id });
  expect(result.error).toBeNull();

  const { rows: [row] } = await db.query(
    'select name, creator_mode, class_id, quirks, accessories from characters where id = $1', [characterId]
  );
  expect(row).toEqual({
    name: `Converted ${suffix}`,
    creator_mode: 'aspirant',
    class_id: classes.gunslingerFork.id,
    quirks: QUIRKS,
    accessories: ACCESSORIES
  });
  const { rows } = await perkRows();
  expect(rows).toHaveLength(4);
});
```

Add `'models/character-convert-aspirant.integration.test.js',` to `integrationFiles` in `scripts/run-tests.mjs`, directly after `'models/character-atomic.integration.test.js'`.

- [ ] **Step 2: Run it**

```bash
grep '^SUPABASE_URL' .env
eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test models/character-convert-aspirant.integration.test.js
```

Expected: PASS (4 tests). This task is the end-to-end proof of Tasks 5-7 against the real RPC; if a test fails, the defect is in those tasks' code or in an assumption this plan states under "Not touched" -- fix the code (with a unit test in the owning task's file), not the assertion. To confirm the suite can fail, temporarily drop `traits` from the `saveCharacterAtomic` payload in `convertToAspirant`: the first test must FAIL with `traits` `[]`. Revert.

- [ ] **Step 3: Run the integration tier**

```bash
eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun run test:integration
```

Expected: only the known reds fail.

- [ ] **Step 4: Preview Caroline Denton locally (read-only)**

The restored copy holds her (`465f52ce-ee0d-4b0f-99bc-4baa4f9c8b7d`). Print her plan without saving:

```bash
eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun -e "
const { planCharacterAspirantConversion } = require('./models/character');
planCharacterAspirantConversion({ role: 'system' }, '465f52ce-ee0d-4b0f-99bc-4baa4f9c8b7d').then(({ data, error }) => {
  if (error) throw error;
  console.log(JSON.stringify({ target: data && data.target.name, blockers: data && data.blockers, breaches: data && data.breaches.map(b => b.detail) }, null, 2));
  process.exit(0);
});
"
```

Expected: a Gunslinger target and a blocker list (at plan time she held 18 Signatures, so a Signature Cap blocker is expected, plus a blocker for every item from a class with no fork such as Greybeard or Raubritter). Paste the output into your report; it is what the user checks before Task 10's step 3.

- [ ] **Step 5: Commit**

```bash
git add models/character-convert-aspirant.integration.test.js scripts/run-tests.mjs
git commit -m "test: convert a character to Aspirant through save_character_atomic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Production rollout (MANUAL — performed by the user, not by an agent)

**Files:** none.

- [ ] **Step 1: Merge Part 1 (Tasks 1-3) to `main`** per the repo's merging rule (no merge commits; Railway deploys `main` on push).
- [ ] **Step 2: Apply the migration to production:** `supabase db push --linked`. Confirm `select rules_version, count(*) from classes where content_format='aspirant' group by 1` returns only `v2` in the dashboard SQL editor.
- [ ] **Step 3: Reconcile levels.** With `.env` pointed at production, run `bun scripts/reconcile-character-progress.js` (dry run). Review the listed characters (auto-calculated Aspirant characters moving onto the v2 curve). Then `bun scripts/reconcile-character-progress.js --apply`. Point `.env` back at the local stack afterwards.
- [ ] **Step 4: Merge Part 2 (Tasks 4-9).** No migration.
- [ ] **Step 5: Caroline Denton.** Her owner opens her edit page and reads the Convert to Aspirant panel first: check the Signature count against the cap of 12 and each non-Gunslinger item (Grapple Gun, Earpiece, Hand Cannon, Knecht, Eye in the Sky, Catsuit) against its class's fork. Fix the listed blockers on the Advent form, then convert.

---

## Self-Review

**Spec coverage.**
- Part 1 change 1 (migration, trigger disabled) → Task 1 Steps 6-7. Change 2 (loader + comment) → Task 1 Step 5. Change 3 (class import) → Task 1 Steps 1, 5 (forced, Decision 6). Change 4 (wizard `perksSpent`; purchase island follows the live editor) → Task 2. Change 5 (reconcile, dry run first) → Task 1 Step 9 locally, Task 10 Step 3 in production. Change 6 (stale comments at `books.mjs:45`, `character-wizard.js:1930`, `:4128`, `ability-purchase-data.js:171`) → Tasks 1 and 2 (plus the `perks` comment at `character-wizard.js:4094`, stale for the same reason). Ingestion spec paragraph → Task 3 Step 4. Part 1 testing (import default, wizard, island, integration keeps v2 fields and v2 curve, `migration up`) → Tasks 1-3.
- Part 2 eligibility (owner, advent economy, exactly one fork; ambiguous logged) → Tasks 4, 7. What conversion does (fork, class name, creator_mode; per-row fork remap with type from the list; Perks by name with compounds; Enchantments/Mods ride along; everything else untouched) → Tasks 5, 7, 9. Blocking checklist (no counterpart, no fork, Traits, Stat Cap, Signature Cap, reused validators) → Tasks 5-6. Grandfathered (Ability cap, Perk deficit, Merx overspend shown) → Task 6, panel in Task 8. Units 1-5 → Tasks 4-8. Error handling (AuthorizationError; ineligible 400; blockers 400 listing all; RPC error propagated) → Task 7 (RPC errors are returned unchanged from `adapter.saveCharacterAtomic`). Testing list → Tasks 4-9; no E2E, per spec. Rollout → Task 10.

**Placeholder scan.** No TBD/TODO; every code step carries the code; every run step carries the command and the expected result.

**Type consistency.** `findAspirantFork(classes, classId)`, `planConversion({ character, classes, gear, abilities, abilityPerks, traits, realMissions, offscreenMissions })`, `CONVERSION_RULES.{noFork,noCounterpart,traits,statCap,signatureCap}`, adapter `getConversionClasses`, service `planAspirantConversion` / `convertToAspirant`, model `planCharacterAspirantConversion` / `convertCharacterToAspirant`, view local `aspirantConversion`: the same names in every task that uses them. The perk payload `{ class_ability_id: null, ability_name, text, position, compounds_with }` matches both the RPC and `CharacterService#saveCharacterAtomic`'s v2 remap.

**Review Focus.** Each of the five lines has a test in its owning task (listed on the line). Checked and not listed because a task already exercises them: traits deleted by an absent `p_traits` (Task 7 payload test, Task 9 traits assertion and its mutation check); a class-less character (Task 4); a catalogue read failure (Task 7).
