> Version semantics superseded by the [October 1 design](../specs/2026-10-01-edition-version-and-leveling-design.md): `rules_version` means version within the edition. Aspirant v1 uses Advent v2 mechanics.

# Aspirant Mode Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Convert to Aspirant on the correct domain model. Converting a character changes only its mode. An Aspirant character gets the v2 character rules whatever its class. The Signature Cap no longer limits what a character owns.

**Architecture:** One pure helper, `util/character-rules.js#characterRulesVersion`, becomes the only place that decides a character's rules generation, and every site that read `classes.rules_version` as a character rule goes through it. `util/aspirant-conversion.js` shrinks to a judge: it takes the character's own build and version family and reports blockers (Traits, Stat Cap), grandfathered breaches and the Aspirant Perk/Merx totals. `CharacterService.convertToAspirant` then saves `{ creator_mode: 'aspirant' }` alone through `save_character_atomic`. The Signature Cap is a mission-loadout rule, and nothing in the app models a loadout, so its ownership enforcement is removed from the server, the wizard and the edit form, together with the figure, the slot counter and the readouts.

**Tech Stack:** Bun, `bun:test`, Express 4, express-handlebars, htmx, jsdom (client tests), Supabase/Postgres (`save_character_atomic` RPC, `pg`), Playwright (one e2e spec edited).

**Spec:** `docs/superpowers/specs/2026-09-28-convert-to-aspirant-design.md`. Task 6 rewrites its Part 2 to the model below. Until then, **this plan's Decisions section overrides the spec wherever they differ.** Read both before starting any task.

## The binding model (from the user)

- Class format (`content_format` advent/aspirant) and character mode (`creator_mode`) are independent.
- An Advent character may use only Advent classes.
- An Aspirant character may freely use Aspirant **or** Advent classes, and their Signatures and Abilities.
- The Signature Cap (12 Aspirant, 8 Aspiring) limits what a character may **bring on a mission**, not what it may **own**.

## Global Constraints

- **Branch:** work on `fix/aspirant-mode-conversion`. Do not switch branches, push or touch `.env`.
- **`.env` may point at PRODUCTION**, and bun loads `.env` automatically. Before any step that writes to a database, run `grep '^SUPABASE_URL' .env`. It must print `http://127.0.0.1:54321`. If it doesn't, stop and tell the user.
- **Unit tier:** `bun run test:unit` is always safe, because it scrubs the Supabase variables. For a single file, copy the env `scripts/run-tests.mjs` sets:
  ```bash
  env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test <file>
  ```
  **Never run plain `bun test <file>`.**
- **HTTP tier:** `bun run test:http`. `routes/characters.test.js` and `routes/character-details.test.js` are in `httpFiles`. The single-file form above works for them too.
- **Integration tier:** credentials come from the running local stack, never from `.env`, in one shell invocation:
  ```bash
  eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test <file>
  eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun run test:integration
  ```
- **NEVER run `supabase db reset`.** The local database holds a restored production copy.
- **Known reds (compare by file and test name, never by count):**
  - `test:unit`: 0 failures.
  - `test:http`: exactly `routes/open-graph.test.js`.
  - `test:integration`: exactly `util/character-content-integrity` (1), `util/class-form-round-trip` (2 of 3) and `util/image-crop-integrity` (2).
  - Anything else red is yours.
- **No migration is expected.** If one turns out to be necessary, applying it to production is the user's job (`supabase db push --linked`), never an agent's.
- **No dead code.** When you replace something, delete what it replaced in the same change: no commented-out blocks, no fallbacks, no `_old` copies. Before committing, grep for every symbol you removed and confirm nothing references it.
- **Comments** go only where the code cannot carry the meaning. They explain a non-obvious why and describe the code as it is now. Never write history ("was X, now Y", "no longer", "used to").
- **Match the surrounding idiom:**
  - `{ data, error }` returns.
  - `{ status, message }` business errors.
  - `ok(...)` adapter stubs in `services/character/service.test.js`.
  - 4-space indent in `util/merx-economy.js` and `util/perk-economy.js`, 2-space elsewhere.
- **TDD per task:**
  1. Red: run the test and see the stated failure.
  2. Green: write the minimum code.
  3. Refactor: the tests stay green.
- **Commits:**
  - One commit per task, staging only the files the task names (`git add <paths>`, never `-A` or `.`).
  - Follow repo style: lower-case imperative with `feat:`, `fix:`, `test:` or `docs:`.
  - End every message with a blank line and then your harness's Co-Authored-By trailer, e.g. `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Test helper:** `test/helpers/auth-user-fixture.js` exports `createAuthUserAndProfile(db, { email, profileName })` and returns `{ authUserId, profile }`.

## Review Focus

These are the five inputs the model implies but no spec line spells out, most likely first. Each one has a test in the task named.

1. **An Aspirant or Aspiring character with stored v1 free text (`perks`, `additional_gear`) gets an ordinary save under v2.** The text must be kept: a v2 save strips the v1-only keys, which the RPC reads as "keep". It then shows under Deprecated fields, not erased. Tested in Task 1 (service: the saved payload carries no `perks` key).
2. **The Class select changes on the edit form of an Aspirant character whose class is Advent v1.** The `/version-fields` swap must keep the v2 block (Defining Quirk, Accessories, Ability Perks) instead of blanking it. Tested in Task 1 (route: `creator_mode=aspirant` returns the v2 block; the form sends it).
3. **A class-less Advent character (`class_id` null) converts.** There is no family read, every Ability counts as own-class, and the save succeeds. Tested in Task 2 (planner and service).
4. **A stale edit page posts Convert after the character already converted in another tab.** Expect a 400 with the reason, and nothing written. Tested in Task 2 (service) and Task 6 (integration, DB snapshot unchanged).
5. **A player owns Signatures and Enchantments well past 12 slots.** The wizard and the edit form are limited only by Merx, and a save that raises the count past the mission cap is accepted and stored. Tested in Task 3 (both client surfaces), Task 4 (validator and service) and Task 6 (a converted 13-Signature character saves a 14th).

## Decisions (approved, plus the code realities that forced a choice)

1. **Conversion changes only the mode.** `convertToAspirant` saves `{ creator_mode: 'aspirant' }` with `p_gear`, `p_abilities` and `p_perks` null.
   - `save_character_atomic` (latest definition: `supabase/migrations/20260921000001_save_character_atomic_aspiring_abilities.sql`) guards each of those blocks with `IF p_x IS NOT NULL`, so null leaves the rows untouched, ids and compound links included.
   - It reads traits through `COALESCE(p_traits, '[]')`, so omitting them deletes them. The stored Traits are resubmitted. They pair by `(name, occurrence)`, so their rows are kept as they are.
   - The UPDATE merges `p_character` over the stored row (`jsonb_populate_record(saved, p_character)`), so every other column keeps its value.
   - The fork lookup, the name remapping and the `no-fork`/`no-counterpart` blockers are deleted, along with `findAspirantFork` (nothing else uses it) and `repository.getConversionClasses`. `getClassFamilyRows` replaces the latter, because conversion only needs the character's own family now.
2. **The Signature Cap is a mission-loadout rule, and nothing enforces it.**
   - Nothing in the app records a mission loadout. Mission sign-up and LFG selection pick a character and never its gear. `models/mission.js`, `routes/missions.js` and `routes/lfg.js` never touch `class_gear`, so the cap is enforced nowhere.
   - Removed:
     - the refusal in `validateEconomyLimits`, on creation and on update;
     - the conversion `signature-cap` blocker;
     - the wizard's and the edit form's slot gate and slot readouts;
     - `SignatureEntry.slotsOf`, `signatureSlotsUsed`, `SIGNATURE_CAP` and `economyFigures().signatureCap`. Nothing legitimate reads them afterwards.
   - `ASPIRING_SIGNATURE_PICKS` (the three creation picks) stays; it is a creation rule. The creation Merx budget is untouched.
   - **Recorded for the user:** if a mission-loadout feature is built later, the figure (pg. 85: 12; pg. 92: 8) and the Enchantment-takes-a-slot rule (pg. 8) belong there.
3. **An Aspirant character (`creator_mode` `'aspirant'`) and an Aspiring character get the v2 character rules whatever their class's `rules_version`.**
   - The only place this is decided is `characterRulesVersion` in `util/character-rules.js`. The Aspiring part sits in the same `V2_MODES` set, so the user can drop it in one line if they object.
   - Sites routed through it: `CharacterService.createCharacter`, `updateCharacter` and `levelUp`; `services/character/progress.js#calculateCharacterProgress`; the edit, auto-calc-fields, version-fields, details and sheet routes; the `effectiveRulesVersion` Handlebars helper; and `getCharacterForAgent`.
   - Class-level display and filter uses of `rules_version` (labels, catalogue filters, the edit form's class grouping, `findUpgradeTargetsFor`) are class facts and stay.
   - The Part 1 migration (aspirant-format classes at v2) stays.
4. **Only two rules block conversion:** Traits (`validateTraits` under `'aspirant'`) and the Stat Cap (`validateStatLimits` with `enforceCreationAllotment: false`).
5. **The edit-page panel** has no target-class line. It says the character keeps its class and build and switches to the Aspirant rules. It shows the after-conversion Perk and Merx totals, hard breaches in the sheet's own wording, and blockers. The button stays disabled while blockers exist, and `hx-confirm` is unchanged.
6. **`planConversion` takes `classFamilyOf`, not class rows.** The service already owns `familyResolver`, the one version-family resolver used for pricing, and it hands that function in. There is then one definition of "own-class" shared by the sheet, the ratchet and the preview.
7. **`/characters/version-fields` accepts `creator_mode`.** The edit form's Class select sends it with `hx-vals`, which is the only way that route can know the character's mode.
8. **The `effectiveRulesVersion` Handlebars helper is registered, but no template calls it.** It is routed through `characterRulesVersion` as instructed rather than deleted, because deleting it touches eight route tests that list it by name. That deletion is a follow-up the user may want.
9. **Conversion does not recalculate the stored `level`.**
   - Decision 1 says only the mode changes.
   - An auto-calculated character converted from a v1 class moves onto the v2 curve at its next auto-calculated save, level-up or mission write (`recalculateCharacterProgress`).
   - The preview judges Perks at the stored level.
   - Flagged for the user.
10. **No change is needed in two places:**
    - The client level-up modal already uses the v2 curve for everyone (`public/js/character-common.js`).
    - `scripts/reconcile-character-progress.js` already selects `creator_mode` and goes through `calculateCharacterProgress`, so Task 1 covers it.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `util/character-rules.js` (create), `util/character-rules.test.js` (create) | `characterRulesVersion`, the one decision of a character's rules generation. | 1 |
| `services/character/service.js`, `services/character/service.test.js` | Routes create/update/level-up through the helper (1). Mode-only conversion (2). Cap comments/tests (4). | 1, 2, 4 |
| `services/character/progress.js`, `services/character/progress.test.js` | Level derivation through the helper. | 1 |
| `routes/characters.js`, `routes/characters.test.js` | Five routes through the helper (1). The panel's route tests (5). | 1, 5 |
| `routes/character-details.test.js` | The details fragment under v2 by mode. | 1 |
| `views/character-form.handlebars` | Class select sends `creator_mode` (1). Purchase readout loses slots (3). Conversion panel (5). | 1, 3, 5 |
| `util/handlebars.js`, `util/handlebars.test.js` | `effectiveRulesVersion` helper through the rule. | 1 |
| `models/character.js`, `models/character.test.js`, `services/character/repository.js` | Agent read reports the character's rules. `getConversionClasses` removed. | 1, 2 |
| `util/aspirant-conversion.js`, `util/aspirant-conversion.test.js` | The judge: blockers, breaches, totals. No remap. | 2 |
| `routes/character-level-up.test.js`, `test/character-wizard-client.test.js` | Drop `getConversionClasses` stubs (2). Wizard cap tests (3). | 2, 3 |
| `public/js/character-wizard.js`, `public/js/character-gear-purchases.js`, `public/js/signature-entry.js` | Purchases gated by Merx only. No slot counting. | 3 |
| `views/character-wizard.handlebars`, `public/css/styles.css` | Slot readout removed. | 3 |
| `test/character-gear-purchases.test.js`, `test/signature-entry.test.js`, `test/helpers/wizard-fixture.js`, `test/helpers/gear-purchase-fixture.js` | Client tests and fixtures. | 3 |
| `e2e/specs/28-aspirant-v1-merx-purchases.spec.js` | Slot assertions removed. | 3 |
| `services/character/input.js`, `services/character/input.test.js` | `validateEconomyLimits` loses the cap and `storedGear`. | 4 |
| `util/merx-economy.js`, `util/merx-economy.test.js` | `SIGNATURE_CAP`, `signatureSlotsUsed`, `economyFigures().signatureCap` removed. | 4 |
| `util/stat-caps.js`, `util/perk-economy.js`, `util/character-import.js` | Comments that named the cap. | 4 |
| `models/character-convert-aspirant.integration.test.js` | End-to-end against the real RPC. | 6 |
| `docs/superpowers/specs/2026-09-28-convert-to-aspirant-design.md` | Part 2 and Intent restated to the model. | 6 |

Task order: 1 and 2 are independent. 3 comes before 4, because the client must stop reading `figures.signatureCap` before the server stops serving it. 4 comes after 2, because the old planner called `validateEconomyLimits` for its cap blocker. 5 comes after 2, and 6 comes last.

---

### Task 1: One rule for a character's rules generation

**Files:**
- Create: `util/character-rules.js`, `util/character-rules.test.js`
- Modify: `services/character/service.js` (`createCharacter`, `updateCharacter`, `levelUp`), `services/character/service.test.js`
- Modify: `services/character/progress.js`, `services/character/progress.test.js`
- Modify: `routes/characters.js` (`GET /:id/edit`, `GET /:id/auto-calc-fields`, `GET /version-fields`, `GET /:id/details`, `GET /:id/:name?`), `routes/characters.test.js`, `routes/character-details.test.js`
- Modify: `views/character-form.handlebars` (Class `<select>`)
- Modify: `util/handlebars.js`, `util/handlebars.test.js`
- Modify: `models/character.js` (`getCharacterForAgent`), `services/character/repository.js` (`getCharacterForAgentRow`), `models/character.test.js`

**Interfaces:**
- Produces: `characterRulesVersion({ classRulesVersion, creatorMode } = {}) → 'v1' | 'v2'` from `util/character-rules.js`. It returns `'v2'` when `creatorMode` is `'aspirant'` or `'aspiring'` or when `classRulesVersion === 'v2'`, and `'v1'` otherwise.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing helper test.** Create `util/character-rules.test.js`:

```js
const { test, expect } = require('bun:test');
const { characterRulesVersion } = require('./character-rules');

const CASES = [
  ['an Advent character follows a v1 class', { classRulesVersion: 'v1', creatorMode: null }, 'v1'],
  ['an Advent character follows a v2 class', { classRulesVersion: 'v2', creatorMode: 'advent' }, 'v2'],
  ['an Aspirant character on a v1 class is on v2', { classRulesVersion: 'v1', creatorMode: 'aspirant' }, 'v2'],
  ['an Aspirant character on a v2 class is on v2', { classRulesVersion: 'v2', creatorMode: 'aspirant' }, 'v2'],
  ['an Aspiring character, which has no class, is on v2', { classRulesVersion: undefined, creatorMode: 'aspiring' }, 'v2'],
  ['a character with no class and no mode is on v1', { classRulesVersion: null, creatorMode: null }, 'v1'],
  ['an unrecognised class version is v1', { classRulesVersion: 'v3', creatorMode: '' }, 'v1']
];

for (const [name, args, expected] of CASES) {
  test(name, () => {
    expect(characterRulesVersion(args)).toBe(expected);
  });
}

test('no arguments is v1', () => {
  expect(characterRulesVersion()).toBe('v1');
});
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/character-rules.test.js`
Expected: FAIL with `Cannot find module './character-rules'`.

- [ ] **Step 3: Write the helper.** Create `util/character-rules.js`:

```js
// Which generation of the character rules -- Advent 'v1' or 'v2' -- a
// character is built under. A class's rules_version answers it for an Advent
// character. Aspirant V1 builds on Advent v2, and a character on the Aspirant
// rules may use Aspirant or Advent classes alike, so its rules come from its
// mode, not its class. Aspiring characters are Aspirant-book characters too.
const V2_MODES = new Set(['aspirant', 'aspiring']);

const characterRulesVersion = ({ classRulesVersion, creatorMode } = {}) =>
  (V2_MODES.has(creatorMode) || classRulesVersion === 'v2' ? 'v2' : 'v1');

module.exports = { characterRulesVersion };
```

- [ ] **Step 4: Run the helper test.** Same command as Step 2. Expected: 8 pass.

- [ ] **Step 5: Write the failing service tests.** Append to `services/character/service.test.js`. `ADVENT_CLASS_ID`, `OWNED_CHARACTER`, `CREATOR`, `makeServiceOnClass` and `aspirantCreatePayload` already exist in that file.

```js
// --- An Aspirant character is on the v2 character rules whatever its class --

const NIGHT_OWL = { name: 'Night Owl', downside: 'Sleeps through mornings.', upside: 'Sees in the dark.' };

const onAdventV1Class = (creatorMode) => {
  let saved = null;
  const service = new CharacterService(makeAdapter([], {
    getCharacter: async () => ok({
      id: 'character-1', creator_id: 'profile-1', class_id: ADVENT_CLASS_ID, creator_mode: creatorMode,
      level: 1, gear: [], ability_perks: [],
      abilities: [{ id: 'ab-1', name: 'Quickdraw', class_id: ADVENT_CLASS_ID, type: 'core' }]
    }),
    getClassRulesVersion: async () => ({ data: 'v1', contentFormat: 'advent', error: null }),
    saveCharacterAtomic: async (args) => {
      saved = args;
      return ok({ id: 'character-1' });
    }
  }));
  const save = () => service.updateCharacter('character-1', {
    name: 'Hero', level: 1, trait0: 'brave', trait1: 'calm', trait2: 'alert',
    perks: 'Old v1 prose',
    quirks: [NIGHT_OWL],
    accessories: [{ name: 'Pocket Watch' }],
    ability_perks: [{ class_ability_id: 'ab-1', text: 'Steady hands.', position: 0 }]
  }, { id: 'profile-1' });
  return { save, saved: () => saved };
};

test('an Aspirant character on an Advent v1 class keeps its Quirk, Accessories and Ability Perks', async () => {
  const { save, saved } = onAdventV1Class('aspirant');
  expect((await save()).error).toBeNull();
  expect(saved().character.quirks).toEqual([NIGHT_OWL]);
  expect(saved().character.accessories).toEqual([{ name: 'Pocket Watch' }]);
  expect(saved().perks).toEqual([expect.objectContaining({ ability_name: 'Quickdraw', text: 'Steady hands.' })]);
});

// The v1 free-text Perk is left out of the payload, which save_character_atomic
// reads as "keep what is stored": the text survives, shown as a Deprecated field.
test('an Aspirant character\'s save leaves its stored v1 free text alone', async () => {
  const { save, saved } = onAdventV1Class('aspirant');
  await save();
  expect(saved().character).not.toHaveProperty('perks');
});

test('an Advent character on the same class still saves under v1', async () => {
  const { save, saved } = onAdventV1Class(null);
  expect((await save()).error).toBeNull();
  expect(saved().character).not.toHaveProperty('quirks');
  expect(saved().perks).toBeNull();
});

// Four missions: level 3 on the v2 curve (2 + 2), level 2 on the v1 curve (2 + 3).
test('levelUp puts an Aspirant character on an Advent v1 class on the v2 curve', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter([], {
    getCharacter: async () => ok({ ...OWNED_CHARACTER, class_id: ADVENT_CLASS_ID, creator_mode: 'aspirant' }),
    listOffscreenMissions: async () => ok(Array.from({ length: 4 }, () => ({ merx_gained: 0 }))),
    getClassRulesVersion: async () => ({ data: 'v1', contentFormat: 'advent', error: null }),
    levelUpAtomic: async (args) => {
      calls.push(args);
      return ok({ id: 'character-1', ...args.fields });
    }
  }));
  const result = await service.levelUp(CREATOR, 'character-1', { level: 2 });
  expect(result.error).toBeNull();
  expect(calls[0].fields.level).toBe(3);
});

test('a created Aspirant character on an Advent v1 class keeps its Defining Quirk', async () => {
  const { service, saved } = makeServiceOnClass();
  const result = await service.createCharacter(
    aspirantCreatePayload({ class_id: ADVENT_CLASS_ID, quirks: [NIGHT_OWL] }),
    { id: 'profile-1' }
  );
  expect(result.error).toBeNull();
  expect(saved.quirks).toEqual([NIGHT_OWL]);
});
```

Append to `services/character/progress.test.js`, and add `calculateCharacterProgress` to its existing `require('./progress')` destructuring:

```js
test('an Aspirant character on an Advent v1 class levels on the v2 curve', () => {
  const levelFor = (creatorMode) => calculateCharacterProgress({
    character: { class_id: 'advent-v1', creator_mode: creatorMode, gear: [], common_items: [] },
    realMissions: [],
    offscreenMissions: Array.from({ length: 4 }, () => ({ merx_gained: 0 })),
    classRules: { data: 'v1', contentFormat: 'advent' }
  }).level;
  expect(levelFor('aspirant')).toBe(3);
  expect(levelFor(null)).toBe(2);
});
```

- [ ] **Step 6: Run them and watch them fail.**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/character/service.test.js services/character/progress.test.js`
Expected: FAIL.
- The Quirk test: `saved().character.quirks` is `undefined`.
- The levelUp test: `2`, not `3`.
- The create test: `saved.quirks` is `undefined`.
- The progress test: `2`, not `3`.
- The v1 free-text test: the payload still carries `perks`, because a v1 save keeps it.
- The Advent test already passes. It pins the other edge.

- [ ] **Step 7: Route the service and progress through the helper.**

In `services/character/service.js`, add after the `canMutateCharacter` require:

```js
const { characterRulesVersion } = require('../../util/character-rules');
```

In `createCharacter`, replace `const rulesVersion = await this.adapter.getRulesVersion(input.class_id);` with:

```js
    const rulesVersion = characterRulesVersion({
      classRulesVersion: await this.adapter.getRulesVersion(input.class_id),
      creatorMode: input.creator_mode
    });
```

In `updateCharacter`, replace the comment's first sentence ("Resolved from the stored class, never the submitted one: this gates both the v2-only field strip below and the perk rebuild in saveCharacterAtomic.") with: "Resolved from the stored class and the stored creator_mode, never the submitted ones (util/character-rules.js): this gates both the v2-only field strip below and the perk rebuild in saveCharacterAtomic." Keep the rest of that comment. Then replace `const rulesVersion = rulesVersionResult.data || 'v1';` (the one just after `getClassRulesVersion(storedClassId)`) with:

```js
    const rulesVersion = characterRulesVersion({
      classRulesVersion: rulesVersionResult.data,
      creatorMode: prepared.creator_mode
    });
```

`prepared.creator_mode` is pinned to the stored value a few lines above. That is why this line must stay below the pin.

In `levelUp`, replace `const rulesVersion = rulesVersionResult.data || 'v1';` with:

```js
    const rulesVersion = characterRulesVersion({
      classRulesVersion: rulesVersionResult.data,
      creatorMode: character.creator_mode
    });
```

In `services/character/progress.js`, add `const { characterRulesVersion } = require('../../util/character-rules');` under the existing requires, and replace `rulesVersion: classRules.data || 'v1',` with:

```js
    rulesVersion: characterRulesVersion({ classRulesVersion: classRules.data, creatorMode: character.creator_mode }),
```

- [ ] **Step 8: Run the service and progress tests.** Same command as Step 6. Expected: all pass.

- [ ] **Step 9: Write the failing route, view, helper and agent tests.**

In `routes/characters.test.js`, add a class fixture beside `V2_RULES_CLASS`:

```js
// An Advent class on the v1 rules, for characters whose mode, not their
// class, decides their rules.
const ADVENT_V1_CLASS = {
  id: 'class-advent-v1',
  name: 'Vanguard',
  is_public: true,
  is_player_created: false,
  rules_edition: 'advent',
  rules_version: 'v1',
  content_format: 'advent',
  gear: [],
  abilities: [],
  advanced_abilities: [],
  created_at: '2024-01-01T00:00:00Z',
};
```

Then add `[ADVENT_V1_CLASS.id]: ADVENT_V1_CLASS` to `CLASS_BY_ID`, and append these tests:

```js
// An Aspirant character is on the v2 character rules whatever its class's
// rules_version (util/character-rules.js).
const aspirantOnAdventV1 = (extra = {}) => ({
  ...makePageCharacter(0),
  class: ADVENT_V1_CLASS.name,
  class_id: ADVENT_V1_CLASS.id,
  creator_mode: 'aspirant',
  quirks: [{ name: 'Monochromia', downside: 'Sees only red', upside: 'Spots blood instantly' }],
  ...extra,
});

test('the edit form gives an Aspirant character on a v1 class the v2 fields', async () => {
  pageState.character = aspirantOnAdventV1({ creator_id: 'profile-1' });
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(countMatches(body, /Defining Quirk<\/label>/g)).toBe(1);
  expect(body).toMatch(/name="quirk_name"[^>]*value="Monochromia"/);
});

test('the edit form\'s Class select tells /version-fields the character\'s mode', async () => {
  pageState.character = aspirantOnAdventV1({ creator_id: 'profile-1' });
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });
  const body = await res.text();
  expect(body).toContain('hx-vals=\'{"creator_mode": "aspirant"}\'');
});

test('GET /characters/version-fields serves the v2 block to an Aspirant character on a v1 class', async () => {
  const aspirant = await fetch(
    `${baseUrl}/characters/version-fields?class_id=${ADVENT_V1_CLASS.id}&creator_mode=aspirant`,
    { headers: { Accept: 'text/html' } }
  );
  expect(countMatches(await aspirant.text(), /Defining Quirk<\/label>/g)).toBe(1);

  const advent = await fetch(
    `${baseUrl}/characters/version-fields?class_id=${ADVENT_V1_CLASS.id}`,
    { headers: { Accept: 'text/html' } }
  );
  expect(await advent.text()).toBe('<div id="v2-fields-container"></div>');
});

test('the auto-calc fields count an Aspirant character\'s missions on the v2 curve', async () => {
  pageState.character = aspirantOnAdventV1({ creator_id: 'profile-1' });
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/auto-calc-fields`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('V2: Need');
});

test('the sheet shows an Aspirant character on a v1 class its v2 fields and curve', async () => {
  pageState.character = aspirantOnAdventV1();
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/Ash`, { headers: { Accept: 'text/html' } });
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('<h3 class="title is-4">Defining Quirk</h3>');
  expect(body).toContain('V2: Need');
});
```

`countMatches` is already defined in that file. Declare `aspirantOnAdventV1` after it.

In `routes/character-details.test.js`, append:

```js
test('an Aspirant character on a v1 class shows its v2 fields', async () => {
  state.character.creator_mode = 'aspirant';
  state.character.quirks = [{ name: 'Night Owl', downside: 'Sleeps through mornings.' }];
  const res = await get(`/characters/${CHAR_ID}/details`);
  const html = await res.text();
  expect(html).toContain('Defining Quirk');
  expect(html).toContain('Night Owl');
});
```

In `util/handlebars.test.js`, add `effectiveRulesVersion` to the `require('./handlebars')` destructuring and append:

```js
test('effectiveRulesVersion puts an Aspirant character on v2 whatever its class', () => {
  expect(effectiveRulesVersion({ creator_mode: 'aspirant' }, { rules_version: 'v1' })).toBe('v2');
  expect(effectiveRulesVersion({ creator_mode: null }, { rules_version: 'v1' })).toBe('v1');
  expect(effectiveRulesVersion({ creator_mode: null, linked_class: { rules_version: 'v2' } }, null)).toBe('v2');
});
```

In `models/character.test.js`, append this. It follows the file's own module-swap pattern from `getCharacter attaches ability_perks for v2 characters`:

```js
test('getCharacterForAgent reports an Aspirant character on a v1 class under the v2 rules', async () => {
  mock.module('./_base', () => {
    const client = makeClient({
      characters: [{ ...characterRowBase, creator_mode: 'aspirant', personality: [], abilities: [], gear: [] }],
      classes: [{ id: 'class-1', name: 'Soldier', rules_version: 'v1' }],
      character_perks: [
        { id: 'p1', character_id: 'char-uuid-1', class_ability_id: 'a1', text: 'Bigger sword', position: 0, compounds_with: null }
      ]
    }, { singleTables: new Set(['characters', 'classes']) });
    return { supabase: client, supabaseAdmin: client, anonKey: 'test-anon-key', createUserClient: () => client };
  });
  delete require.cache[require.resolve('./character')];
  delete require.cache[require.resolve('../services/character/repository')];
  const { getCharacterForAgent } = require('./character');
  const { data, error } = await getCharacterForAgent('char-uuid-1', { profileId: 'profile-1', role: 'admin' });
  expect(error).toBeFalsy();
  expect(data.rules_version).toBe('v2');
  expect(data.ability_perks.map(perk => perk.text)).toEqual(['Bigger sword']);

  mock.module('./_base', () => ({
    supabase: fakeAnon, supabaseAdmin: fakeAdmin,
    anonKey: 'test-anon-key', createUserClient: () => fakeAnon
  }));
  delete require.cache[require.resolve('./character')];
  delete require.cache[require.resolve('../services/character/repository')];
});
```

- [ ] **Step 10: Run them and watch them fail.**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/characters.test.js routes/character-details.test.js util/handlebars.test.js models/character.test.js`
Expected: FAIL.
- Each new route test: no `Defining Quirk`, `V1: Need` instead of `V2: Need`, no `hx-vals`.
- The details test: no `Defining Quirk`.
- The helper test: `'v1'` for the Aspirant case.
- The agent test: `rules_version` `'v1'`.

- [ ] **Step 11: Route every render site and the agent read through the helper.**

In `routes/characters.js`, add `const { characterRulesVersion } = require('../util/character-rules');` beside the other `../util/` requires. Then make these replacements.

**`GET /:id/edit`:** replace

```js
    let characterClass = null;
    let effectiveVersion = 'v1';
    if (character.class_id) {
      try {
        const { data: cls } = await getClass(character.class_id, res.locals.supabase);
        if (cls) {
          characterClass = cls;
          if (cls.rules_version === 'v2') effectiveVersion = 'v2';
        }
      } catch (_) {}
    }
```

with

```js
    let characterClass = null;
    if (character.class_id) {
      try {
        const { data: cls } = await getClass(character.class_id, res.locals.supabase);
        if (cls) characterClass = cls;
      } catch (_) {}
    }
    const effectiveVersion = characterRulesVersion({
      classRulesVersion: characterClass && characterClass.rules_version,
      creatorMode: character.creator_mode
    });
```

**`GET /:id/auto-calc-fields`:** replace

```js
  let classRow = null;
  let effectiveVersion = 'v1';
  if (character.class_id) {
    try {
      const { data: cls } = await getClass(character.class_id, res.locals.supabase);
      if (cls) {
        classRow = cls;
        if (cls.rules_version === 'v2') effectiveVersion = 'v2';
      }
    } catch (_) {}
  }
```

with

```js
  let classRow = null;
  if (character.class_id) {
    try {
      const { data: cls } = await getClass(character.class_id, res.locals.supabase);
      if (cls) classRow = cls;
    } catch (_) {}
  }
  const effectiveVersion = characterRulesVersion({
    classRulesVersion: classRow && classRow.rules_version,
    creatorMode: character.creator_mode
  });
```

**`GET /version-fields`:** replace

```js
  const classId = req.query.class_id;
  let effectiveVersion = 'v1';
  if (classId) {
    try {
      const { data: cls } = await getClass(classId, res.locals.supabase);
      if (cls && cls.rules_version === 'v2') effectiveVersion = 'v2';
    } catch (_) {}
  }
```

with

```js
  const classId = req.query.class_id;
  let classRulesVersion = null;
  if (classId) {
    try {
      const { data: cls } = await getClass(classId, res.locals.supabase);
      classRulesVersion = cls && cls.rules_version;
    } catch (_) {}
  }
  const effectiveVersion = characterRulesVersion({ classRulesVersion, creatorMode: req.query.creator_mode });
```

**`GET /:id/details`:** replace

```js
  const effectiveVersion = (characterClass && characterClass.rules_version === 'v2') ? 'v2' : 'v1';
```

with

```js
  const effectiveVersion = characterRulesVersion({
    classRulesVersion: characterClass && characterClass.rules_version,
    creatorMode: character.creator_mode
  });
```

**`GET /:id/:name?` (the sheet):** make the same replacement for its identical `const effectiveVersion = ...` line.

In `views/character-form.handlebars`, on the Class `<select>`, add `hx-vals` inside the existing `{{#unless isNew}}` so that the attributes read:

```handlebars
                {{#unless isNew}}hx-get="/characters/version-fields"
                hx-trigger="change"
                hx-target="#v2-fields-container"
                hx-swap="outerHTML"
                hx-include="this"
                hx-vals='{"creator_mode": "{{character.creator_mode}}"}'{{/unless}}>
```

In `util/handlebars.js`, add `const { characterRulesVersion } = require('./character-rules');` beside the other requires, and replace `effectiveRulesVersionH` with:

```js
const effectiveRulesVersionH = function (character, characterClass) {
  const classRulesVersion = [characterClass, character && character.linked_class]
    .some(cls => cls && cls.rules_version === 'v2') ? 'v2' : 'v1';
  return characterRulesVersion({ classRulesVersion, creatorMode: character && character.creator_mode });
};
```

In `services/character/repository.js#getCharacterForAgentRow`, change the select's first line to `id, name, class, class_id, creator_mode, level, is_public, is_deceased, creator_id,`.

In `models/character.js#getCharacterForAgent`, add `const { characterRulesVersion } = require('../util/character-rules');` to the top requires, and replace `const rulesVersion = await effectiveRulesVersion(data.class_id);` with:

```js
  const rulesVersion = characterRulesVersion({
    classRulesVersion: await effectiveRulesVersion(data.class_id),
    creatorMode: data.creator_mode
  });
```

`effectiveRulesVersion` in `models/character.js` stays as the class-version lookup. It also backs the adapter's `getRulesVersion`.

- [ ] **Step 12: Run Step 10's command.** Expected: all pass.

- [ ] **Step 13: Confirm no character-rules site still reads `rules_version` directly.**

Run: `grep -n "rules_version === 'v2'\|rulesVersionResult.data || 'v1'\|classRules.data || 'v1'" routes/characters.js services/character/*.js models/character.js util/handlebars.js`
Expected: only the `effectiveRulesVersionH` line in `util/handlebars.js` (its class half) and `models/character.js`'s `effectiveRulesVersion` / `serializeCharacterForAgent` (the class lookup and the serializer's hint). The `rules_version` uses that remain in `routes/characters.js` are class grouping (`isV2` in the edit route's option injection and `filterClassDataForUser`) and the wizard's class data. They are class facts, so leave them.

- [ ] **Step 14: Run the unit and HTTP tiers.** Run `bun run test:unit` and `bun run test:http`. Expected: the known reds only.

- [ ] **Step 15: Commit.**

```bash
git add util/character-rules.js util/character-rules.test.js services/character/service.js services/character/service.test.js services/character/progress.js services/character/progress.test.js routes/characters.js routes/characters.test.js routes/character-details.test.js views/character-form.handlebars util/handlebars.js util/handlebars.test.js models/character.js models/character.test.js services/character/repository.js
git commit -m "fix: put Aspirant characters on the v2 character rules whatever their class

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Conversion changes only the mode

**Files:**
- Modify (rewrite): `util/aspirant-conversion.js`, `util/aspirant-conversion.test.js`
- Modify: `services/character/service.js` (`loadAspirantConversion`, `convertToAspirant`, `REQUIRED_ADAPTER_METHODS`), `services/character/service.test.js` (the `convertToAspirant / planAspirantConversion` section and `makeAdapter`)
- Modify: `services/character/repository.js` (delete `getConversionClasses`)
- Modify: `routes/character-level-up.test.js`, `test/character-wizard-client.test.js` (drop the `getConversionClasses` stub and list entry)

**Interfaces:**
- Produces: `planConversion({ character, classFamilyOf, gear, abilities, abilityPerks, traits, realMissions, offscreenMissions }) → { blockers: [{ rule, detail }], breaches, perkBreakdown, merxBreakdown }` and `CONVERSION_RULES = { traits: 'traits', statCap: 'stat-cap' }` from `util/aspirant-conversion.js`.
- Produces: `CharacterService.planAspirantConversion(actor, id) → { data: plan | null, error }` and `convertToAspirant(actor, id) → { data: savedRow, error }`. Their signatures are unchanged; the plan has no `target`, `gear`, `abilities` or `abilityPerks` keys.
- Consumes: `familyResolver` (already in `services/character/service.js`) and `deriveBuildBreaches`, `derivePerkBreakdown` and `deriveMerxBreakdown` (`util/character-derived.js`).

- [ ] **Step 1: Rewrite the planner's tests.** Replace the whole of `util/aspirant-conversion.test.js` with:

```js
const { test, expect, describe } = require('bun:test');
const { planConversion, CONVERSION_RULES } = require('./aspirant-conversion');
const { statList } = require('./enclave-consts');
const { capBreachMessage, BASE_STAT_CAP } = require('./stat-caps');
const { CREATION_GRANT, priceOfSignature } = require('./merx-economy');
const {
  ABILITY_CAP_RULE, PERK_DEFICIT_RULE, CROSS_CLASS_EDITION_RULE, perkAllotment
} = require('./perk-economy');

// Gunslinger v1 and v2 are one version family; Wanderer is another class.
// This is what CharacterService's familyResolver hands the planner.
const GUNSLINGER_FAMILY = new Set(['gunslinger-v1', 'gunslinger-v2']);
const classFamilyOf = (classId) => (GUNSLINGER_FAMILY.has(classId) ? 'gunslinger-v2' : classId);

const TRAITS = [
  { name: 'Brave', stat: 'might' }, { name: 'Clever', stat: 'intelligence' }, { name: 'Lucky', stat: 'luck' }
];
const signature = (name, classId, extra = {}) => ({ name, class_id: classId, enchantment: null, mods: [], ...extra });
const ability = (id, name, classId, type = 'core') => ({ id, name, class_id: classId, type });

// Shaped like Caroline Denton (465f52ce-ee0d-4b0f-99bc-4baa4f9c8b7d): a
// Gunslinger v2 whose Abilities are stored on the v1 row of her own family,
// carrying Wanderer's Familiar Face cross-class, two Revolvers, Wanderer's
// Satchel, and three Ability Perks including a compound. Level 4.
const carolineDenton = (overrides = {}) => ({
  character: {
    id: 'caroline', name: 'Caroline Denton', class: 'Gunslinger', class_id: 'gunslinger-v2',
    creator_mode: null, level: 4, common_items: [], stat_cap_purchases: {},
    ...Object.fromEntries(statList.map(stat => [stat, 1])),
    ...overrides.character
  },
  classFamilyOf: 'classFamilyOf' in overrides ? overrides.classFamilyOf : classFamilyOf,
  gear: overrides.gear || [
    signature('Revolver', 'gunslinger-v2'),
    signature('Revolver', 'gunslinger-v2'),
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

describe('planConversion: the build stays as it is', () => {
  test('the plan names no rows to write: conversion changes only the mode', () => {
    expect(Object.keys(planConversion(carolineDenton())).sort())
      .toEqual(['blockers', 'breaches', 'merxBreakdown', 'perkBreakdown']);
  });

  test('Caroline Denton converts with nothing blocking and no Ability-cap breach', () => {
    const plan = planConversion(carolineDenton());
    expect(plan.blockers).toEqual([]);
    expect(plan.breaches.map(b => b.rule)).not.toContain(ABILITY_CAP_RULE);
    expect(plan.breaches.map(b => b.rule)).not.toContain(CROSS_CLASS_EDITION_RULE);
  });
});

describe('planConversion: judged as an Aspirant character on its own class', () => {
  // Level 4 earns 1 + 3 Perks. Trickshot, Standoff and Shootout sit on the v1
  // row of the character's own family, so they are its three free own-class
  // Cores; Familiar Face costs 3 cross-class and the three Ability Perks 1 each.
  test('own- and cross-class are judged against the character\'s own version family', () => {
    expect(planConversion(carolineDenton()).perkBreakdown).toEqual({
      earned: perkAllotment({ economy: 'aspirant', level: 4 }), spend: 6, remaining: 0, deficit: 2
    });
  });

  // Without the family, the three Cores on the v1 row would each be a
  // cross-class unlock at 3: 9 + 3 + 3 Perks.
  test('the family comes from classFamilyOf', () => {
    expect(planConversion(carolineDenton({ classFamilyOf: null })).perkBreakdown.spend).toBe(15);
  });

  test('a Perk deficit is grandfathered: a breach, not a blocker', () => {
    const plan = planConversion(carolineDenton());
    expect(plan.breaches.map(b => b.rule)).toEqual([PERK_DEFICIT_RULE]);
    expect(plan.blockers).toEqual([]);
  });

  test('an Ability count over the Aspirant cap is grandfathered: a breach, not a blocker', () => {
    const plan = planConversion(carolineDenton({
      abilities: [
        ability('a1', 'Trickshot', 'gunslinger-v1'), ability('a2', 'Standoff', 'gunslinger-v1'),
        ability('a3', 'Shootout', 'gunslinger-v1'), ability('a4', 'Last Word', 'gunslinger-v2', 'advanced'),
        ability('a5', 'Dead Eye', 'gunslinger-v2', 'advanced'), ability('a6', 'High Noon', 'gunslinger-v2', 'advanced'),
        ability('a7', 'Familiar Face', 'wanderer-v1')
      ],
      abilityPerks: []
    }));
    expect(plan.breaches.map(b => b.rule)).toContain(ABILITY_CAP_RULE);
    expect(plan.blockers).toEqual([]);
  });

  // pg. 85: the Signature Cap limits what a character brings on a mission, not
  // what it owns.
  test('Signatures past what a mission allows neither block nor breach', () => {
    const gear = Array.from({ length: 15 }, () => signature('Revolver', 'gunslinger-v2', { enchantment: { source: 'default' } }));
    const plan = planConversion(carolineDenton({ gear }));
    expect(plan.blockers).toEqual([]);
    expect(plan.breaches.map(b => b.rule)).toEqual([PERK_DEFICIT_RULE]);
  });

  // Two own-class Revolvers and one cross-class Satchel, against the Aspirant
  // creation grant with no missions.
  test('the Merx breakdown prices the build under Aspirant', () => {
    const spend = 2 * priceOfSignature({ crossClass: false }) + priceOfSignature({ crossClass: true });
    expect(planConversion(carolineDenton()).merxBreakdown).toEqual({
      earned: CREATION_GRANT.aspirant,
      spend,
      reward: Math.max(0, CREATION_GRANT.aspirant - spend),
      deficit: Math.max(0, spend - CREATION_GRANT.aspirant)
    });
  });

  // No class means no family: every Ability is own-class. Four own Cores are
  // three free and one at 1, plus three Ability Perks, against 4 earned.
  test('a character with no class is judged with every Ability own-class', () => {
    const plan = planConversion(carolineDenton({ character: { class: 'Drifter', class_id: null }, classFamilyOf: null }));
    expect(plan.blockers).toEqual([]);
    expect(plan.perkBreakdown.spend).toBe(4);
  });
});

describe('planConversion: what blocks conversion', () => {
  test('only Traits and the Stat Cap can block', () => {
    expect(Object.values(CONVERSION_RULES).sort()).toEqual(['stat-cap', 'traits']);
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
});
```

- [ ] **Step 2: Rewrite the service's conversion tests.** In `services/character/service.test.js`:
  - Delete the `getConversionClasses: async () => ok([]),` line from `makeAdapter`.
  - Add `BASE_STAT_CAP` to the existing `require('../../util/stat-caps')` destructuring.
  - Replace everything from the `// --- convertToAspirant / planAspirantConversion ---` heading to the end of the file with:

```js
// --- convertToAspirant / planAspirantConversion -----------------------------

const CONVERSION_FAMILY = [
  { id: 'gunslinger-v1', rules_edition: 'advent', content_format: 'advent', base_class_id: null },
  { id: 'gunslinger-v2', rules_edition: 'advent', content_format: 'advent', base_class_id: 'gunslinger-v1' },
  { id: 'gunslinger-aspirant', rules_edition: 'aspirant', content_format: 'aspirant', base_class_id: 'gunslinger-v1' },
  { id: 'wanderer-v1', rules_edition: 'advent', content_format: 'advent', base_class_id: null }
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
  getClassFamilyRows: async () => ok(CONVERSION_FAMILY),
  getClassRulesVersion: async (classId) => ({
    data: 'v1',
    contentFormat: (CONVERSION_FAMILY.find(row => row.id === classId) || {}).content_format,
    error: null
  }),
  saveCharacterAtomic: async (args) => {
    calls.push(['saveCharacterAtomic', args]);
    return ok({ id: 'character-1', name: character.name, class_id: character.class_id, creator_mode: args.character.creator_mode });
  }
});

// p_character names creator_mode alone, so the RPC keeps every other column;
// a null gear, ability or Perk list leaves those rows as they are. Traits are
// resubmitted because save_character_atomic reads an absent list as "no
// Traits" and would delete them.
const MODE_ONLY_SAVE = {
  characterId: 'character-1',
  creatorId: 'profile-1',
  character: { creator_mode: 'aspirant' },
  traits: CONVERSION_TRAITS,
  gear: null,
  abilities: null,
  perks: null
};

test('convertToAspirant throws for a non-owner and saves nothing', async () => {
  const calls = [];
  const service = new CharacterService(conversionAdapter(calls));
  await expect(service.convertToAspirant(STRANGER, 'character-1')).rejects.toBeInstanceOf(AuthorizationError);
  expect(calls).toEqual([]);
});

test('convertToAspirant changes only the mode', async () => {
  const calls = [];
  const result = await new CharacterService(conversionAdapter(calls)).convertToAspirant(CREATOR, 'character-1');
  expect(result.error).toBeNull();
  expect(calls).toEqual([['saveCharacterAtomic', MODE_ONLY_SAVE]]);
});

test('an admin conversion keeps the owner as the row\'s creator', async () => {
  const calls = [];
  const result = await new CharacterService(conversionAdapter(calls)).convertToAspirant(ADMIN, 'character-1');
  expect(result.error).toBeNull();
  expect(calls[0][1].creatorId).toBe('profile-1');
});

test('a class with no Aspirant version converts all the same', async () => {
  const calls = [];
  const service = new CharacterService(conversionAdapter(calls, adventGunslinger({ class: 'Wanderer', class_id: 'wanderer-v1' })));
  expect((await service.convertToAspirant(CREATOR, 'character-1')).error).toBeNull();
  expect(calls).toEqual([['saveCharacterAtomic', MODE_ONLY_SAVE]]);
});

test('a character with no class converts without reading a version family', async () => {
  const calls = [];
  const service = new CharacterService({
    ...conversionAdapter(calls, adventGunslinger({ class: 'Drifter', class_id: null })),
    getClassFamilyRows: async () => { throw new Error('a class-less character has no family to read'); }
  });
  expect((await service.convertToAspirant(CREATOR, 'character-1')).error).toBeNull();
  expect(calls).toEqual([['saveCharacterAtomic', MODE_ONLY_SAVE]]);
});

// pg. 85: the Signature Cap limits what a character brings on a mission.
test('Signatures past what a mission allows do not block conversion', async () => {
  const calls = [];
  const gear = Array.from({ length: 15 }, (_, i) => ({ id: `g${i}`, name: 'Revolver', class_id: 'gunslinger-v1', enchantment: null, mods: [] }));
  const service = new CharacterService(conversionAdapter(calls, adventGunslinger({ gear })));
  expect((await service.convertToAspirant(CREATOR, 'character-1')).error).toBeNull();
  expect(calls).toHaveLength(1);
});

test('convertToAspirant refuses a blocked build, listing every blocker, and saves nothing', async () => {
  const calls = [];
  const character = adventGunslinger({
    reflex: BASE_STAT_CAP + 2,
    traits: [{ name: 'Brave', stat: 'might' }, { name: 'Bold', stat: 'might' }, { name: 'Lucky', stat: 'luck' }]
  });
  const result = await new CharacterService(conversionAdapter(calls, character)).convertToAspirant(CREATOR, 'character-1');
  expect(result.data).toBeNull();
  expect(result.error.status).toBe(400);
  expect(result.error.message).toContain('Caroline cannot convert to Aspirant yet.');
  expect(result.error.message).toContain('Two Traits may not share a Stat (might).');
  expect(result.error.message).toContain(capBreachMessage({ stat: 'reflex', value: BASE_STAT_CAP + 2, cap: BASE_STAT_CAP }));
  expect(calls).toEqual([]);
});

// A stale edit page can still show the Convert button after the character was
// converted in another tab; the POST must explain itself and change nothing.
test('convertToAspirant refuses a character already converted', async () => {
  const calls = [];
  const service = new CharacterService(conversionAdapter(calls, adventGunslinger({ creator_mode: 'aspirant' })));
  expect(await service.convertToAspirant(CREATOR, 'character-1')).toEqual({
    data: null,
    error: { status: 400, message: 'Caroline is not on the Advent rules, so there is nothing to convert.' }
  });
  expect(calls).toEqual([]);
});

test('convertToAspirant refuses an Advent-mode character on an Aspirant-format class', async () => {
  const calls = [];
  const service = new CharacterService(conversionAdapter(calls, adventGunslinger({ class_id: 'gunslinger-aspirant' })));
  expect((await service.convertToAspirant(CREATOR, 'character-1')).error.status).toBe(400);
  expect(calls).toEqual([]);
});

test('planAspirantConversion returns the plan for an eligible character', async () => {
  const { data, error } = await new CharacterService(conversionAdapter([])).planAspirantConversion(CREATOR, 'character-1');
  expect(error).toBeNull();
  expect(Object.keys(data).sort()).toEqual(['blockers', 'breaches', 'merxBreakdown', 'perkBreakdown']);
  expect(data.blockers).toEqual([]);
  expect(data.perkBreakdown).not.toBeNull();
});

test('planAspirantConversion returns no plan for an ineligible character', async () => {
  const service = new CharacterService(conversionAdapter([], adventGunslinger({ creator_mode: 'aspirant' })));
  expect(await service.planAspirantConversion(CREATOR, 'character-1')).toEqual({ data: null, error: null });
});

test('planAspirantConversion throws for a non-owner', async () => {
  const service = new CharacterService(conversionAdapter([]));
  await expect(service.planAspirantConversion(STRANGER, 'character-1')).rejects.toBeInstanceOf(AuthorizationError);
});

test('a version-family read failure is returned, not thrown', async () => {
  const service = new CharacterService({
    ...conversionAdapter([]),
    getClassFamilyRows: async () => ({ data: [], error: { message: 'boom' } })
  });
  expect(await service.convertToAspirant(CREATOR, 'character-1')).toEqual({ data: null, error: { message: 'boom' } });
});
```

In `routes/character-level-up.test.js`, delete the line `getConversionClasses: async () => ({ data: [], error: null }),`. In `test/character-wizard-client.test.js`, remove `'getConversionClasses'` from `UNREACHED_ADAPTER_METHODS`, keeping the array's other entries and its closing bracket.

- [ ] **Step 3: Run them and watch them fail.**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/aspirant-conversion.test.js services/character/service.test.js`
Expected: FAIL.
- The planner: plan keys include `target`; `CONVERSION_RULES` has four rules; the Perk spend is judged against the fork.
- The service: `CharacterService requires adapter methods: getConversionClasses` for every test that builds a service. Once that is out of the way, the saved payload carries `class_id` and remapped rows.

- [ ] **Step 4: Rewrite the planner.** Replace the whole of `util/aspirant-conversion.js` with:

```js
// Judges an Advent character as it would stand on the Aspirant rules: the
// same class and the same build, under the aspirant economy. Pure -- the
// caller loads everything, and conversion itself changes only the mode.
const { statList } = require('./enclave-consts');
const { deriveBuildBreaches, derivePerkBreakdown, deriveMerxBreakdown } = require('./character-derived');
const { validateTraits, validateStatLimits } = require('../services/character/input');

const ASPIRANT = 'aspirant';

const CONVERSION_RULES = {
  traits: 'traits',
  statCap: 'stat-cap'
};

// `classFamilyOf` maps every class in the character's own version family onto
// its class (CharacterService's familyResolver), so an Ability carried over
// from another version of that class is own-class, as it is on the sheet.
const planConversion = ({
  character, classFamilyOf, gear, abilities, abilityPerks, traits, realMissions, offscreenMissions
}) => {
  // The rules Aspirant enforces on every save, judged by the validators that
  // enforce them. Stat Cap only: the creation allotment and +++ ceiling are
  // creation rules (validateStatLimits).
  const blockers = [];
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

  // The Ability cap and Perk deficit are grandfathered by the ratchet after
  // conversion, so they are reported, not blocking.
  const characterClassId = character.class_id ?? null;
  const perkArgs = {
    economy: ASPIRANT,
    level: character.level,
    abilities,
    abilityPerks,
    characterClassId,
    classFamilyOf
  };

  return {
    blockers,
    breaches: deriveBuildBreaches(perkArgs),
    perkBreakdown: derivePerkBreakdown(perkArgs),
    merxBreakdown: deriveMerxBreakdown({
      realMissions,
      offscreenMissions,
      gear,
      commonItems: character.common_items,
      characterClassId,
      economy: ASPIRANT
    })
  };
};

module.exports = { planConversion, CONVERSION_RULES };
```

- [ ] **Step 5: Make the service save the mode alone.** In `services/character/service.js`:

(a) Remove `'getConversionClasses',` from `REQUIRED_ADAPTER_METHODS`.

(b) Replace `loadAspirantConversion` with the code below. `familyResolver` is a module-level `const` declared further down the file; it is initialised at module load, before any call reaches this function.

```js
// Everything a conversion is judged on, loaded once for both the preview and
// the POST so the two can never disagree. `ineligible` is why the character is
// not offered conversion at all; blockers stay on the plan.
const loadAspirantConversion = async (adapter, actor, id) => {
  const character = await requireOwnedCharacter(adapter, actor, id);
  const economy = await resolveMutationEconomy(adapter, character);
  if (economy !== 'advent') {
    return { ineligible: `${character.name} is not on the Advent rules, so there is nothing to convert.` };
  }
  let classFamilyOf = null;
  if (character.class_id) {
    const { data: classFamilyRows, error: familyError } = await adapter.getClassFamilyRows();
    if (familyError) return { error: familyError };
    classFamilyOf = familyResolver(classFamilyRows, character.class_id);
  }
  const [missions, offscreenMissions] = await Promise.all([
    adapter.getRealMissions(id),
    adapter.listOffscreenMissions(id)
  ]);
  if (missions.error || offscreenMissions.error) return { error: missions.error || offscreenMissions.error };
  const plan = planConversion({
    character,
    classFamilyOf,
    gear: character.gear,
    abilities: character.abilities,
    abilityPerks: character.ability_perks,
    traits: character.traits,
    realMissions: missions.data || [],
    offscreenMissions: offscreenMissions.data || []
  });
  return { character, plan };
};
```

(c) Replace the comment above `convertToAspirant` and its final `return this.adapter.saveCharacterAtomic({...})` so the method reads:

```js
  // One-way: a converted character is on the aspirant economy, which is never
  // eligible. The plan is recomputed here, never taken from the client.
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
    // p_character names creator_mode alone, so every other column keeps its
    // stored value, and a null gear, ability or Perk list leaves those rows as
    // they are. Traits are the exception: save_character_atomic reads an
    // absent Trait list as "no Traits", so the stored three are resubmitted.
    return this.adapter.saveCharacterAtomic({
      characterId: id,
      creatorId: character.creator_id,
      character: { creator_mode: 'aspirant' },
      traits: (character.traits || []).map(({ name, stat }) => ({ name, stat })),
      gear: null,
      abilities: null,
      perks: null
    });
  }
```

(d) `planAspirantConversion` keeps its body (`return { data: loaded.plan ?? null, error: null };`).

- [ ] **Step 6: Delete `getConversionClasses`.** In `services/character/repository.js`, delete the `getConversionClasses` function, its comment block ("Powers services/character/service.js's Aspirant conversion …") and its `getConversionClasses,` export line.

- [ ] **Step 7: Run Step 3's command, then confirm nothing references the deleted names.**

Run Step 3's command. Expected: all pass.

Run: `grep -rn "findAspirantFork\|getConversionClasses\|noFork\|noCounterpart\|no-fork\|no-counterpart\|remapRows\|findInCatalogue\|signatureCap: 'signature-cap'" --include='*.js' --include='*.handlebars' --exclude-dir=node_modules . | grep -v '^./docs'`
Expected: one hit only, the `'no-counterpart'` blocker fixture in `routes/characters.test.js`. Task 5 rewrites it; leave it here.

- [ ] **Step 8: Run the unit and HTTP tiers.** Run `bun run test:unit` and `bun run test:http`. Expected: the known reds only. `routes/characters.test.js`'s panel tests still pass on their mocked plan; Task 5 updates them.

- [ ] **Step 9: Commit.**

```bash
git add util/aspirant-conversion.js util/aspirant-conversion.test.js services/character/service.js services/character/service.test.js services/character/repository.js routes/character-level-up.test.js test/character-wizard-client.test.js
git commit -m "fix: convert a character to Aspirant by changing its mode alone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Purchase surfaces stop counting Signature slots

**Files:**
- Modify: `public/js/character-wizard.js`, `public/js/character-gear-purchases.js`, `public/js/signature-entry.js`
- Modify: `views/character-wizard.handlebars`, `views/character-form.handlebars` (purchase readout), `public/css/styles.css`
- Modify: `test/character-wizard-client.test.js`, `test/character-gear-purchases.test.js`, `test/signature-entry.test.js`, `test/helpers/wizard-fixture.js`, `test/helpers/gear-purchase-fixture.js`
- Modify: `e2e/specs/28-aspirant-v1-merx-purchases.spec.js`

**Interfaces:**
- Produces: a client that never reads `figures.signatureCap`. Task 4 removes that figure from `economyFigures()`.
- Removes: `SignatureEntry.slotsOf`, the wizard handle's `getSlotsUsed`, and the edit-form handle's `getSlotsUsed`.

- [ ] **Step 1: Write the failing client tests.**

In `test/character-wizard-client.test.js`, replace the test `an Enchantment that would breach the Signature Cap is refused, Merx in hand` together with the comment block above it ("pg. 8: the cap is counted in slots …") with:

```js
  // pg. 85: the Signature Cap limits what a character brings on a mission,
  // not what it owns, so only Merx limits a purchase. The served grant is
  // raised so the purchases run past the twelve slots a mission allows.
  test('Signatures and Enchantments past the mission cap are bought while Merx allows', () => {
    const wizard = bootWizard(fixture({
      mode: 'aspirant',
      classes: [v1Class()],
      economy: { ...FIGURES, grants: { ...FIGURES.grants, aspirant: 100 } }
    }));
    wizard.getState().classId = 'c-v1';
    const names = twelveNames();
    for (const name of names) wizard.buySignature(name);
    expect(wizard.getState().gear).toHaveLength(12);
    expect(wizard.setEnchantment(names[0], { source: 'default' })).toBe(true);
    expect(wizard.getState().gear[0].enchantment).toEqual({ source: 'default' });
  });
```

In `test/character-gear-purchases.test.js`, append:

```js
// pg. 85: the Signature Cap limits what a character brings on a mission, not
// what it owns. Six enchanted Signatures are twelve mission slots; a seventh
// Signature is still a purchase the character may make.
describe('owning Signatures is limited by Merx alone', () => {
  test('a Signature past twelve mission slots is bought when Merx allows', () => {
    const stored = ['Cowboy Hat', 'Sharps Rifle', 'Bandolier', 'Bowie Knife', 'Wild Rag', 'Duster'].map(enchanted);
    const form = mountPurchases(fixtureCharacter({ gear: stored, earnedMerx: 100 }));
    expect(form.buySignature('Rollups')).toBe(true);
    expect(form.serialize().gear).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test test/character-wizard-client.test.js test/character-gear-purchases.test.js`
Expected: FAIL.
- The wizard: `setEnchantment` returns `false` (13 slots over 12).
- The edit form: `buySignature('Rollups')` returns `false`.

- [ ] **Step 3: Gate the edit form's purchases on Merx alone.** In `public/js/character-gear-purchases.js`:

(a) In the header comment, change "Every price, grant and cap comes" to "Every price and grant comes".

(b) Delete `var slotsUsedEl = root.querySelector('[data-slots-used]');` and `var slotsCapEl = root.querySelector('[data-slots-cap]');`.

(c) Replace the block from `var getSlotsUsed = function () {` through the end of `affordsChange` (including `signatureCap` and the "Both limits the save enforces" comment) with:

```js
    // A purchase the character cannot pay for is refused. Merx is the only
    // limit on what a character owns: the Signature Cap limits what it brings
    // on a mission.
    var affordsChange = function (merxDelta) {
      return getSpent() + merxDelta <= getBudget();
    };
```

(d) Make these line replacements:
- In `buySignature`: `if (!affordsChange(priceOfPurchase(purchase), SignatureEntry.slotsOf(purchase))) return false;` → `if (!affordsChange(priceOfPurchase(purchase))) return false;`
- Above `applyEnchantment`: replace the comment's first two lines ("pg. 8: an Enchantment is bought onto a Signature the character owns, and / takes a Signature slot as well as its price, so both gates apply.") with `// An Enchantment is bought onto a Signature the character owns, at its price.` Keep the rest of that comment.
- In `applyEnchantment`: replace the two-line `affordsChange(...)` condition with `if (!affordsChange(priceOfPurchase(after) - priceOfPurchase(purchase))) return false;`
- Above `applyMods`: remove the sentence "Mods take no slot." from the comment.
- In `applyMods`: `affordsChange(priceOfPurchase(after) - priceOfPurchase(purchase), 0)` → `affordsChange(priceOfPurchase(after) - priceOfPurchase(purchase))`.
- In `renderPurchaseControls`: `var affordable = affordsChange(price, 1);` → `var affordable = affordsChange(price);`
- In `renderReadouts`: delete the three lines that write `slotsUsedEl` and `slotsCapEl` and the `var cap = signatureCap();` between them.
- In the returned handle: delete `getSlotsUsed: getSlotsUsed,`.

- [ ] **Step 4: Gate the wizard's purchases on Merx alone.** In `public/js/character-wizard.js`:

(a) Delete `const slotsReadout = document.getElementById('slotsReadout');`, `const slotsUsedEl = document.getElementById('slotsUsed');` and `const slotsCapEl = document.getElementById('slotsCap');`.

(b) Delete `signatureCap` and its comment ("pg. 85 and pg. 92: how many Signature slots this economy allows …").

(c) Replace the block from the comment "pg. 8: an Enchantment occupies a Signature slot of its own. The whole" through the end of `affordsChange` with:

```js
  // A purchase the character cannot pay for is refused. Merx is the only
  // limit on what a character owns: the Signature Cap limits what it brings
  // on a mission.
  const affordsChange = (merxDelta) => getMerxSpent() + merxDelta <= getMerxBudget();
```

(d) Make these line replacements:
- In `addSignature`: `if (!affordsChange(priceOfPurchase(purchase), SignatureEntry.slotsOf(purchase))) return false;` → `if (!affordsChange(priceOfPurchase(purchase))) return false;`
- Above `setEnchantment`: replace the comment ("pg. 8: an Enchantment is bought onto a Signature the character owns, and / takes a slot as well as its price, so both gates apply to the change.") with `// An Enchantment is bought onto a Signature the character owns, at its price.`
- In `setEnchantment`: replace the two-line `affordsChange(...)` condition with `if (!affordsChange(priceOfPurchase(after) - priceOfPurchase(purchase))) return false;`
- In `setMods`: `affordsChange(priceOfPurchase(after) - priceOfPurchase(purchase), 0)` → `affordsChange(priceOfPurchase(after) - priceOfPurchase(purchase))`.
- In `renderPurchaseControls`: `const affordable = affordsChange(price, 1);` → `const affordable = affordsChange(price);`
- In the shop's `renderCard`, replace

  ```js
        // A Signature takes a cap slot as well as Merx, so both gates decide
        // whether this card can still be clicked -- the same pair
        // pickShopItem enforces.
        const canAfford = affordsChange(it.cost, it.kind === 'class' ? 1 : 0);
  ```

  with

  ```js
        // The same Merx gate pickShopItem enforces decides whether this card
        // can still be clicked.
        const canAfford = affordsChange(it.cost);
  ```

- In `renderGearReadouts`: delete the block from `// The cap readout is meaningless where the economy sets no cap.` through its closing `}`.
- Rename the section heading `// ----- Merx and Signature Cap readouts, and what they gate -----` to `// ----- Merx readouts, and what they gate -----`.
- In the returned handle: delete `getSlotsUsed,`.

- [ ] **Step 5: Delete `slotsOf`.** In `public/js/signature-entry.js`, delete `slotsOf` with its comment ("pg. 8: an Enchantment occupies a Signature slot of its own; Mods occupy none."), and delete `slotsOf: slotsOf,` from `window.SignatureEntry`.

- [ ] **Step 6: Remove the slot readouts from the views and the stylesheet.**
- `views/character-wizard.handlebars`: delete the whole `<div class="level-item" id="slotsReadout" hidden>…</div>` block (its `<span class="tag …">` and the "Signature slots" text included).
- `views/character-form.handlebars`:
  - Delete the line `&middot; Signature slots <span data-slots-used>0</span> / <span data-slots-cap>0</span>`.
  - In the comment above it, change "both readouts" to "the Merx readout" and "No price, grant or cap is" to "No price or grant is".
- `public/css/styles.css`: delete the `#slotsReadout[hidden],` selector line. The rule keeps `#signatureDrawer[hidden],` and `#baseGearColumn[hidden] { display: none !important; }`.

- [ ] **Step 7: Bring the remaining tests and fixtures in line.**
- `test/character-wizard-client.test.js`:
  - Delete the test `an enchanted Signature uses two of the twelve slots`.
  - Delete the test `the slot readout appears only where the economy caps Signatures` with its comment ("pg. 85: an economy with no cap has no readout to show.").
  - In `step 4's hidden toggles are backed by the stylesheet`, change the id list to `['signatureDrawer', 'baseGearColumn']`.
  - Delete the test `a purchase that would breach the Signature Cap is refused (aspiring)` with its comment ("Mission income lifts the budget …").
- `test/character-gear-purchases.test.js`: in `no economy figure is written down in the mount`, delete `expect(code).toContain('FIGURES.signatureCap');`.
- `test/signature-entry.test.js`: delete the whole `describe('slotsOf (pg. 8)', …)` block.
- `test/helpers/wizard-fixture.js`: delete the line `<span id="slotsReadout" hidden><span id="slotsUsed">0</span> / <span id="slotsCap">0</span></span>`.
- `test/helpers/gear-purchase-fixture.js`: delete the line `<span data-slots-used>0</span> <span data-slots-cap>0</span>`.
- `e2e/specs/28-aspirant-v1-merx-purchases.spec.js`:
  - Delete every `await expect(page.locator('#slotsUsed'))…` line (five of them).
  - Delete the comment "pg. 8: a Default Enchantment takes a Signature slot of its own, so / buying one raises slotsUsed as well as merxSpent -- the "cap arithmetic" / the plan is about."
  - Change the Custom-swap comment to "Swapping the Default for a Custom changes only the Merx spent."
  - In the header comment, change "watch the served spend/slot readouts move" to "watch the served spend readout move".

- [ ] **Step 8: Run Step 2's command plus the other client files.**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test test/character-wizard-client.test.js test/character-gear-purchases.test.js test/signature-entry.test.js views/character-form.test.js`
Expected: all pass.

- [ ] **Step 9: Confirm no client code reads the slot machinery.**

Run: `grep -rn "slotsOf\|getSlotsUsed\|signatureCap\|slotsUsed\|slotsCap\|slotsReadout\|data-slots" public/ views/ test/ e2e/`
Expected: no output.

- [ ] **Step 10: Run the e2e spec if the stack allows it.**

Run: `grep '^SUPABASE_URL' .env` and confirm `http://127.0.0.1:54321`. Then run `bunx playwright test e2e/specs/28-aspirant-v1-merx-purchases.spec.js`. `playwright.config.js` refuses a non-local `SUPABASE_URL`, and the stack must have been seeded with `bun run seed:local`.
Expected: pass. If the e2e tier cannot start here (no seeded stack, no browser), do not claim it passed; say so in your report.

- [ ] **Step 11: Run the unit tier.** Run `bun run test:unit`. Expected: 0 failures.

- [ ] **Step 12: Commit.**

```bash
git add public/js/character-wizard.js public/js/character-gear-purchases.js public/js/signature-entry.js views/character-wizard.handlebars views/character-form.handlebars public/css/styles.css test/character-wizard-client.test.js test/character-gear-purchases.test.js test/signature-entry.test.js test/helpers/wizard-fixture.js test/helpers/gear-purchase-fixture.js e2e/specs/28-aspirant-v1-merx-purchases.spec.js
git commit -m "fix: limit Signature purchases by Merx alone, not the mission cap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The server stops enforcing the Signature Cap on ownership

**Files:**
- Modify: `services/character/input.js` (`validateEconomyLimits`, its imports and comment, `normalizeCharacterInput`'s call and comment), `services/character/input.test.js`
- Modify: `services/character/service.js` (`updateCharacter`'s normalize call and comment), `services/character/service.test.js`
- Modify: `util/merx-economy.js`, `util/merx-economy.test.js`
- Modify (comments only): `util/stat-caps.js`, `util/perk-economy.js`, `util/character-import.js`

**Interfaces:**
- Produces: `validateEconomyLimits({ economy, gear, commonItems, characterClassId, aspiringSignatures, abilities, abilityPerks, level, enforceMerxBudget = true, enforceAbilityLimits = true })`, with no `storedGear` parameter and no Signature Cap.
- Removes: `SIGNATURE_CAP`, `signatureSlotsUsed` and `economyFigures().signatureCap` from `util/merx-economy.js`. `ASPIRING_SIGNATURE_PICKS` stays.
- Consumes: Task 2 (the planner no longer calls `validateEconomyLimits`) and Task 3 (no client reads `figures.signatureCap`).

- [ ] **Step 1: Write the failing tests.**

In `services/character/input.test.js`:

Replace the test `the Signature Cap counts an Enchantment as a slot`, and the comment above it, with:

```js
// pg. 85: the Signature Cap limits what a character brings on a mission, not
// what it owns, so nothing here counts Signature slots.
test('owning more Signature slots than a mission allows is no error', () => {
  const gear = own(7).map((g) => ({ ...g, enchantment: { source: 'default' } }));
  expect(validateEconomyLimits({
    ...ASPIRANT, gear, commonItems: [], enforceMerxBudget: false
  })).toEqual({ ok: true });
});
```

Replace `aspiring is capped at eight slots and granted ten Merx` with:

```js
test('aspiring is granted ten Merx and may own more Signatures than it brings on a mission', () => {
  const picks = [
    { name: 'A', class_id: 'class-a' },
    { name: 'B', class_id: 'class-b' },
    { name: 'C', class_id: 'class-c' }
  ];
  expect(validateEconomyLimits({
    economy: 'aspiring', characterClassId: null, gear: picks, commonItems: []
  })).toEqual({ ok: true });
  const nine = Array.from({ length: 9 }, (_, i) => ({ name: `S${i}`, class_id: 'class-a' }));
  expect(validateEconomyLimits({
    economy: 'aspiring', characterClassId: null, gear: nine, commonItems: [],
    enforceMerxBudget: false
  })).toEqual({ ok: true });
});
```

Then make these changes:
- Delete `exactly eight Signatures fit the aspiring cap` and its "Review round 1, Finding 3" comment.
- Replace `an Enchantment that normalizes to nothing costs no Signature Cap slot` with:

```js
test('an Enchantment that normalizes to nothing is not charged Merx', () => {
  // `enchantment: {}` carries no source, so shapeEnchantment stores null --
  // nothing is stored, so nothing may be charged. Six such Signatures spend
  // exactly the 12-Merx grant.
  const gear = own(6).map((g) => ({ ...g, enchantment: {} }));
  const result = normalizeCharacterInput({
    name: 'Vex', creator_mode: 'aspirant', class_id: 'v1', gear,
    trait0: 'brave', trait1: 'calm', trait2: 'alert'
  }, { rulesVersion: 'v1', contentFormat: 'aspirant' });
  expect(result.error).toBeNull();
});
```

- Replace `a real Enchantment still costs a Signature Cap slot` with:

```js
test('a real Enchantment is still charged Merx', () => {
  const gear = own(6).map((g) => ({ ...g, enchantment: { source: 'default' } }));
  const result = normalizeCharacterInput({
    name: 'Vex', creator_mode: 'aspirant', class_id: 'v1', gear
  }, { rulesVersion: 'v1', contentFormat: 'aspirant' });
  expect(result.error).toMatch(/Merx/);
});
```

- Delete `the gate counts a bare "Class::Item" submission as one slot each`.
- Delete the whole `// --- the Signature Cap counts preserved equipment too ---` section: its comment, the `enchanted` helper, and its five tests (`six stored Enchantments plus twelve bare Signatures breaches the cap`, `a legitimate twelve-slot update is still accepted`, `removing a stored Enchantment frees its slot`, `an advent update pays nothing for stored equipment`, `normalizeCharacterInput threads context.storedGear into the cap`).

In `services/character/service.test.js`, replace the comment block above `aspirantUpdateAdapter` (from "Review round 1, Finding 2" through "…costs an advent update nothing it did not already pay.") with:

```js
// updateCharacter threads the stored class's content_format into
// normalizeCharacterInput, on the one getClassRulesVersion query it already
// makes, so an aspirant-content character's edit is judged under the aspirant
// economy. An edit enforces no Merx budget: a played character owns mission
// rows this call cannot fetch, so a check against the bare grant would refuse
// a purchase its mission income could fund. Nor does anything enforce the
// Signature Cap, which limits what a character brings on a mission, not what
// it owns.
```

Then make these changes:
- Replace the test `an aspirant-content character edited past the Signature Cap is rejected` with:

```js
test('an aspirant-content character may own more Signatures than a mission allows', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getCharacter: async () => ok({ id: 'character-1', creator_id: 'profile-1', class_id: ASPIRANT_CLASS_ID, abilities: [] }),
    getClassRulesVersion: async () => ({ data: 'v1', contentFormat: 'aspirant', error: null }),
    saveCharacterAtomic: async () => ok({ id: 'character-1' })
  }));
  const gear = Array.from({ length: 13 }, (_, i) => ({ name: `S${i}`, class_id: ASPIRANT_CLASS_ID }));
  const result = await service.updateCharacter('character-1', {
    name: 'Hero', class_id: ASPIRANT_CLASS_ID, gear,
    trait0: 'brave', trait1: 'calm', trait2: 'alert'
  }, { id: 'profile-1' });
  expect(result.error).toBeNull();
});
```

- Delete these three tests and the comments above them:
  - `an update cannot breach the Signature Cap with preserved Enchantments` (with its "Whole-plan review, Important 1" comment);
  - `re-saving the same enchanted Signatures is not a breach`;
  - `an advent update is unaffected by stored Enchantments`.
- In `an update does not refuse a purchase earned Merx could fund`, replace its comment with: "7 own-class Signatures spend 14 Merx -- over the bare 12-Merx grant, which would fail if the budget were enforced here -- so the save must go through: a character only reaches 7 Signatures by having earned Merx from missions, and refusing this save would refuse a purchase that Merx paid for."
- In the comment above `expectExactlyOneCatalogueFetch`, replace its first sentence ("An update's cap check needs no gear resolution and no catalogue lookup: it counts entries and Enchantment presence (signatureSlotsUsed) and pairs the submission against the stored rows getCharacter already returned, using the class_id each side carries rather than resolving a name to one -- see the comment on updateCharacter in service.js.") with "An update resolves no gear before it saves." Keep the rest.
- In the `// --- Task 9: the ability cap and Perk balance wired into both save paths ---` comment, replace "Mirrors the Signature Cap split just above: a new character must be legal outright" with "A new character must be legal outright".
- Append:

```js
// pg. 85: the Signature Cap limits what a character brings on a mission. A
// creation is held to its Merx grant alone.
test('a creation over its Merx is refused on Merx alone, with no Signature Cap', async () => {
  const service = new CharacterService(aspirantCreateAdapter([]));
  const result = await service.createCharacter(aspirantCreatePayload({
    gear: Array.from({ length: 13 }, (_, i) => ({ name: `S${i}`, class_id: ASPIRANT_CLASS_ID }))
  }), { id: 'profile-1' });
  expect(result.data).toBeNull();
  expect(result.error).toBe('This character spends 26 Merx of 12.');
});
```

In `util/merx-economy.test.js`:
- Remove `signatureSlotsUsed` and `SIGNATURE_CAP` from the import list.
- Delete `caps are 12/8 Signatures (pp. 85, 92)`.
- Delete the pg. 8 comment and the three tests `an enchanted Signature uses two cap slots and an unenchanted one uses one`, `six enchanted Signatures fill the cap of twelve exactly` and `Mods never consume a cap slot`.
- In `economyFigures`' test, delete the `signatureCap: SIGNATURE_CAP,` line.
- Replace the `--- withPreservedEquipment: limits judge what a save LEAVES ---` comment with:

```js
// --- withPreservedEquipment: the spend judges what a save LEAVES ----------
//
// Every Enchantment and Mod costs Merx, so the spend is taken against the
// equipment a save leaves on the character, not the equipment the submission
// happens to mention. A submitted item that omits `enchantment` and `mods`
// keeps whatever is stored (services/character/input.js normalizeGearEquipment
// and the save_character_atomic RPC), so reading the submission alone would
// let an auto-calculated edit refund Merx that is still spent.
```

  and replace each `signatureSlotsUsed(...)` assertion in that section as follows:
  - `an item that omits enchantment inherits the stored one`: delete `expect(signatureSlotsUsed(effective)).toBe(2);`.
  - Rename `an explicit null removes the stored Enchantment, so it costs no slot` to `an explicit null removes the stored Enchantment`, and replace its assertion with `expect(effective[0].enchantment).toBeNull();`.
  - Rename `an item with its own Enchantment replaces the stored one, costing one slot` to `an item with its own Enchantment replaces the stored one`, and delete its `signatureSlotsUsed` line.
  - `an unenchanted stored row leaves an omitting item unenchanted`: `expect(effective[0].enchantment).toBeNull();`.
  - `a class_id on the submitted item discriminates between same-named rows`: `expect(effective[0].enchantment).toBeNull();`.
  - `a name-only item pairs with a same-named row of any class`: `expect(effective[0].enchantment).toEqual({ source: 'default' });`.
  - `each stored row is claimed once`: `expect(effective.map(item => item.enchantment)).toEqual([{ source: 'default' }, null]);`.
  - `no stored rows leaves the submitted list alone`: delete its third `expect`.
  - `an unmatched submitted item inherits nothing`: `expect(effective[0].enchantment).toBeNull();`.

- [ ] **Step 2: Run them and watch them fail.**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/character/input.test.js services/character/service.test.js util/merx-economy.test.js`
Expected: FAIL.
- `owning more Signature slots than a mission allows is no error` and the aspiring test: `Signature Cap is 12; …` / `… is 8; …`.
- The service tests: an update refused with `Signature Cap is 12; this character carries 13 …`; the creation message carries the cap sentence before the Merx one.
- `economyFigures`: the served figures still carry `signatureCap`.

- [ ] **Step 3: Remove the cap from `validateEconomyLimits` and its callers.** In `services/character/input.js`:

(a) In the `require('../../util/merx-economy')` list, delete `signatureSlotsUsed,`, `withPreservedEquipment,` and `SIGNATURE_CAP,`.

(b) Replace the comment above `validateEconomyLimits` and the function itself (up to the comment "Validates the Enchantment/Mods a submitted gear") with:

```js
// Judges a character's Ability cap, Perk balance and Merx spend against
// util/perk-economy.js and util/merx-economy.js -- the single definitions of
// every figure -- and reports them the same way validateGearEquipment does:
// `{ ok: true }` or `{ ok: false, errors }`, never a throw. A throw here would
// reach `POST /characters/wizard` and `POST /characters` as an unhandled
// promise rejection (neither route has an asyncHandler wrapper, so the request
// just hangs) and `PUT /characters/:id` as a generic "unexpected error" (a bare
// Error has no `.code`, so util/http-error.js classifyError drops the message
// in production).
//
// No Signature count is judged: the Signature Cap (pg. 85) limits what a
// character brings on a mission, not what it owns.
//
// `enforceMerxBudget` (default true) is off on an edit. A character's real
// budget is CREATION_GRANT plus whatever Merx its mission ROWS have earned,
// and updateCharacter has no mission data in hand outside its auto_calculate
// branch, so the bare grant would refuse a purchase its real (unfetched)
// earnings could afford. A creation owns no mission rows, so the grant alone
// is its whole budget. The Advent economy has no budget at all: every
// character that exists today predates one, and no measurement says it would
// pass one.
//
// `abilities` arrive already tagged `{crossClass, type}` by the caller -- this
// function does not resolve classes or pools -- and `level` is needed because
// the Perk grant buildBreaches checks against scales with it.
const validateEconomyLimits = ({
  economy, gear, commonItems, characterClassId, aspiringSignatures,
  abilities, abilityPerks, level,
  enforceMerxBudget = true, enforceAbilityLimits = true
}) => {
  const errors = [];

  // Every economy answers to the ability cap and the Perk balance: Advent has
  // no unlock path, so its three Core Abilities are the whole roster
  // (util/perk-economy.js). Only SOFT breaches are excluded -- an edition
  // notice is information for the player, not a reason to refuse a save.
  //
  // enforceAbilityLimits is false on the update path, which delegates to the
  // ratchet (services/character/service.js): an absolute check here would
  // refuse every save by a character that is already breaching, and the whole
  // point of grandfathering is that those characters stay editable.
  if (enforceAbilityLimits) {
    for (const breach of buildBreaches({ economy, level, abilities, abilityPerks })) {
      if (breach.severity !== 'hard') continue;
      errors.push(breach.detail);
    }
  }

  if (economy !== 'advent' && enforceMerxBudget) {
    const items = Array.isArray(gear) ? gear.filter(Boolean) : [];
    const budget = CREATION_GRANT[economy];
    const itemCount = Array.isArray(commonItems) ? commonItems.length : 0;
    const spend = equipmentSpend(items, { economy, characterClassId, aspiringSignatures })
      + itemCount * COMMON_ITEM_PRICE;
    if (spend > budget) {
      errors.push(`This character spends ${spend} Merx of ${budget}.`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
};
```

(c) In `normalizeCharacterInput`:
- Delete `storedGear: context.storedGear,` from the `validateEconomyLimits` call.
- In the comment above that call, change "charging Merx or a Signature Cap slot for equipment the save will not store" to "charging Merx for equipment the save will not store".
- Delete the sentence "The Signature Cap needs no such data and always runs for a non-advent economy either way."

(d) In `services/character/service.js#updateCharacter`, delete `storedGear: existing.data.gear,` from the `normalizeCharacterInput` call. Then replace the comment above that call, from "The Signature Cap is enforced on every save, including an edit;" through "check validateStatLimits runs.", with:

```js
    // The Merx budget is NOT enforced on an edit -- see validateEconomyLimits's
    // own comment (an edit's real budget needs mission-earned Merx this path
    // does not fetch outside auto_calculate). The Stat Cap is enforced on every
    // edit; capPurchases comes from the row this call already fetched
    // (existing.data.stat_cap_purchases), not a second lookup. The creation
    // allotment and +++ ceiling are NOT enforced here -- see
    // validateStatLimits's own comment -- so this path fetches no class data
    // for the Stat Cap at all; a class's stat_spread plays no part in either
    // check validateStatLimits runs.
```

- [ ] **Step 4: Delete the figure and the slot counter.** In `util/merx-economy.js`:

(a) Header: change "with the grants, caps and word limits from pages 3, 8, 86, 87, 90 and 92." to "with the grants, the Mod limit and the word limits from pages 3, 86, 87 and 90."

(b) Delete the `SIGNATURE_CAP` constant with its comment ("pg. 85: "you can never bring more than 12 Signature Items on a mission" …").

(c) Delete `signatureSlotsUsed` with its comment ("pg. 8: an Enchantment "counts towards the Signature Cap of 12" …").

(d) Replace the comment above `withPreservedEquipment` with:

```js
// Every Enchantment and Mod costs Merx, so a spend has to be judged against the
// equipment a save LEAVES on a character, not only the equipment its payload
// mentions. A submitted item that omits `enchantment` and `mods` keeps
// whatever is stored -- the three-state model services/character/input.js
// normalizeGearEquipment and the save_character_atomic RPC share, and the
// contract the edit form's purchase surface serialises to for any row the
// player did not touch. Pricing the submission alone would let an
// auto-calculated edit hand back Merx that is still spent.
//
// Pairing mirrors the RPC's (class_id, name, occurrence) matching, with one
// concession: a bare "ClassName::ItemName" submission carries a class NAME,
// not a class_id, and the update path resolves no gear. So a submitted item
// must match a stored row's name, and its class_id as well only when it
// carries one. Claiming each row at most once is the occurrence index.
//
// Where several stored rows share a name, the dearest is claimed first -- an
// enchanted row over a bare one, and more Mods over fewer -- and an item that
// submits its own equipment claims nothing. Both choices make the imprecision
// one-sided: the RPC resolves every bare copy of a name to the ONE class_id
// the catalogue maps it to and deletes the same-named rows of other classes,
// so the equipment it preserves may not be the one claimed here. Claiming the
// dearest row first means this can report MORE spend than the save will
// produce, never less.
```

(e) In `economyFigures`, delete `signatureCap: { ...SIGNATURE_CAP },`.

(f) In `module.exports`, delete `signatureSlotsUsed,` and `SIGNATURE_CAP,`.

- [ ] **Step 5: Fix the comments that named the figure.**
- `util/stat-caps.js`: in the `CREATION_PLUSES` comment, delete the last sentence ("SIGNATURE_CAP.advent in util/merx-economy.js is null for a different reason that looks similar: Advent has no such cap at all, so null is the true figure there."). The comment then ends at "…the one place that exists to be authoritative."
- `util/perk-economy.js`: in the `ABILITY_CAP` comment, replace the paragraph starting "Advent reads 3, not null." with:

  ```js
  // Advent reads 3, not null: Advent has no unlock path whatsoever, so its three
  // Core Abilities are the entire roster a character can hold. Three is the true
  // figure, not an absent one.
  ```

- `util/character-import.js`: change "(the / Merx budget and Signature Cap among them)" to "(the / Merx budget among them)".

- [ ] **Step 6: Run Step 2's command.** Expected: all pass.

- [ ] **Step 7: Confirm the figure is gone everywhere.**

Run: `grep -rn "SIGNATURE_CAP\|signatureSlotsUsed\|signatureCap\|Signature Cap is" --include='*.js' --include='*.mjs' --include='*.handlebars' --exclude-dir=node_modules . | grep -v '^./docs'`
Expected: no output.

Run: `grep -n "storedGear" services/character/input.js services/character/service.js`
Expected: no output. `services/character/service.test.js` keeps its own `storedGear` locals in the auto-calculate Merx tests; those price preserved equipment and stay.

Run: `grep -rn "ASPIRING_SIGNATURE_PICKS" util/merx-economy.js`
Expected: still defined and exported.

- [ ] **Step 8: Run the unit and HTTP tiers.** Run `bun run test:unit` and `bun run test:http`. Expected: the known reds only.

- [ ] **Step 9: Commit.**

```bash
git add services/character/input.js services/character/input.test.js services/character/service.js services/character/service.test.js util/merx-economy.js util/merx-economy.test.js util/stat-caps.js util/perk-economy.js util/character-import.js
git commit -m "fix: stop enforcing the mission Signature Cap on what a character owns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The edit-page panel says what conversion does

**Files:**
- Modify: `views/character-form.handlebars` (the `{{#if aspirantConversion}}` block)
- Modify: `routes/characters.test.js` (the conversion panel tests and fixture)

**Interfaces:**
- Consumes: Task 2's plan shape, `{ blockers, breaches, perkBreakdown, merxBreakdown }`. The route and `planCharacterAspirantConversion` are unchanged.

- [ ] **Step 1: Rewrite the panel tests.** In `routes/characters.test.js`:

(a) Replace the `conversionPlan` fixture (the function returning `{ target, gear, abilities, abilityPerks, blockers, breaches, perkBreakdown, merxBreakdown }`) with:

```js
const conversionPlan = (blockers = []) => ({
  blockers,
  breaches: [{ severity: 'hard', rule: 'perk-deficit', detail: '6 Perks spent of 4 earned.' }],
  perkBreakdown: { earned: 4, spend: 6, remaining: 0, deficit: 2 },
  merxBreakdown: { earned: 12, spend: 20, reward: 0, deficit: 8 }
});
```

(b) Replace the tests `the edit form offers conversion with the after-conversion build and a live Convert button` and `the edit form lists blockers and disables the Convert button` with:

```js
test('the edit form offers conversion: same class and build, Aspirant totals, a live Convert button', async () => {
  pageState.conversionPlan = conversionPlan();
  const body = await editPage();
  expect(pageState.lastPlanArgs).toEqual({ actor: expect.objectContaining({ profileId: 'profile-1' }), id: CHAR_ID });
  expect(body).toContain('id="aspirant-conversion"');
  expect(body).toContain('Ash can switch to the Aspirant rules. It keeps its class and its whole build');
  expect(body).not.toContain('Abilities after conversion');
  expect(body).toContain('<strong>Perks spent:</strong> 6');
  expect(body).toContain('<strong>Deficit:</strong> 8');
  expect(body).toContain('<strong>Illegal Build:</strong> 6 Perks spent of 4 earned.');
  expect(body).toContain(`hx-post="/characters/${CHAR_ID}/convert-aspirant"`);
  expect(body).toContain('hx-confirm="Convert Ash to Aspirant? This cannot be undone."');
});

test('the edit form lists blockers and disables the Convert button', async () => {
  pageState.conversionPlan = conversionPlan([
    { rule: 'traits', detail: 'Two Traits may not share a Stat (might).' }
  ]);
  const body = await editPage();
  expect(body).toContain('<li>Two Traits may not share a Stat (might).</li>');
  expect(body).toMatch(/<button type="button" class="button is-link" disabled>Convert to Aspirant<\/button>/);
  expect(body).not.toContain('/convert-aspirant"');
});
```

The ineligible-character test and the two POST tests stay as they are.

- [ ] **Step 2: Run them and watch them fail.**

Run: `env SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/characters.test.js`
Expected: FAIL on the first test. The body lacks "Ash can switch to the Aspirant rules. It keeps its class and its whole build" and still contains "Abilities after conversion".

- [ ] **Step 3: Rewrite the panel.** In `views/character-form.handlebars`, replace the whole `{{#if aspirantConversion}}…{{/if}}` block with:

```handlebars
  {{#if aspirantConversion}}
  <div class="notification is-link is-light" id="aspirant-conversion">
    <p>{{character.name}} can switch to the Aspirant rules. It keeps its class and its whole build: every Signature, Ability and Ability Perk stays as it is.</p>
    <p class="mt-2">Under the Aspirant rules:</p>
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

- [ ] **Step 4: Run Step 2's command.** Expected: all pass.

- [ ] **Step 5: Confirm no stale blocker strings remain.**

Run: `grep -rn "no-counterpart\|no-fork\|has no Aspirant version\|aspirantConversion.target\|aspirantConversion.abilities" routes/ views/ services/ util/ models/`
Expected: no output.

- [ ] **Step 6: Run the HTTP tier.** Run `bun run test:http`. Expected: only `routes/open-graph.test.js` red.

- [ ] **Step 7: Commit.**

```bash
git add views/character-form.handlebars routes/characters.test.js
git commit -m "fix: tell the player conversion keeps their class and build

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Prove it against the real RPC, and correct the spec

**Files:**
- Modify (rewrite): `models/character-convert-aspirant.integration.test.js`. It is already registered in `integrationFiles` in `scripts/run-tests.mjs`.
- Modify: `docs/superpowers/specs/2026-09-28-convert-to-aspirant-design.md`

**Interfaces:**
- Consumes: Tasks 1–5 as shipped. `convertCharacterToAspirant(actor, id)` and `updateCharacter(id, input, { id: profileId })` come from `models/character.js`, and `createAuthUserAndProfile` from `test/helpers/auth-user-fixture.js`.

- [ ] **Step 1: Check the target database.**

Run: `grep '^SUPABASE_URL' .env && supabase status -o env | grep '^API_URL'`
Expected: both print `http://127.0.0.1:54321`. If either doesn't, stop.

- [ ] **Step 2: Rewrite the integration test.** Replace the whole of `models/character-convert-aspirant.integration.test.js` with:

```js
// Local-Supabase integration coverage for Convert to Aspirant: conversion
// switches only the character's mode through save_character_atomic, and the
// Aspirant rules then apply to the same class and the same build.
require('../util/require-local-supabase');

const { test, expect, beforeAll, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('./_base');
const { convertCharacterToAspirant, updateCharacter } = require('./character');
const { statList } = require('../util/enclave-consts');
const { createAuthUserAndProfile } = require('../test/helpers/auth-user-fixture');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `convert-aspirant-${suffix}@example.test`;
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});

const STATS = Object.fromEntries(statList.map(stat => [stat, 1]));
const TRAITS = [{ name: 'Brave', stat: 'might' }, { name: 'Clever', stat: 'intelligence' }, { name: 'Lucky', stat: 'luck' }];
const TRAIT_FIELDS = {
  trait0: 'Brave', trait0_stat: 'might',
  trait1: 'Clever', trait1_stat: 'intelligence',
  trait2: 'Lucky', trait2_stat: 'luck'
};
const QUIRKS = [{ name: 'Night Owl', downside: 'Sleeps through mornings.', upside: 'Sees in the dark.' }];
const ACCESSORIES = [{ name: 'Pocket Watch' }];
// The follow-up edit changes all three: a class on v1 would have them stripped
// from the submission, leaving the stored values in place, so resubmitting
// them unchanged could not tell the difference.
const EDITED_QUIRKS = [{ name: 'Night Owl', downside: 'Sleeps through noon.', upside: 'Sees in the dark.' }];
const EDITED_ACCESSORIES = [{ name: 'Pocket Watch' }, { name: 'Lucky Coin' }];
const EDITED_PERK = 'Off every wall.';

let authUserId;
let profile;
const classes = {};
const characters = {};

const insertClass = async (row) => {
  const { data, error } = await supabaseAdmin.from('classes')
    .insert({ is_public: true, advanced_abilities: [], ...row })
    .select()
    .single();
  if (error) throw error;
  return data;
};

const createAdventCharacter = async ({ name, level, quirks, accessories, gear, abilities, perks }) => {
  const { data, error } = await supabaseAdmin.rpc('save_character_atomic', {
    p_character_id: null,
    p_creator_id: profile.id,
    p_character: {
      ...STATS,
      creator_id: profile.id, name,
      class: classes.gunslinger.name, class_id: classes.gunslinger.id, creator_mode: null,
      level, completed_missions: 0, commissary_reward: 0, quirks, accessories
    },
    p_traits: TRAITS,
    p_gear: gear,
    p_abilities: abilities,
    p_perks: perks
  });
  if (error) throw error;
  return data.id;
};

const characterRow = async (id) => (await db.query(
  'select class_id, class, creator_mode, level, quirks, accessories, perks, updated_at from characters where id = $1', [id]
)).rows[0];

const storedRows = async (id) => {
  const query = async (sql) => (await db.query(sql, [id])).rows;
  return {
    gear: await query('select id, class_id, name, description, enchantment, mods from class_gear where character_id = $1 order by id'),
    abilities: await query('select id, class_id, name, type, description from class_abilities where character_id = $1 order by id'),
    perks: await query('select id, class_ability_id, text, position, compounds_with from character_perks where character_id = $1 order by id'),
    traits: await query('select id, name, stat from traits where character_id = $1 order by id')
  };
};

const gearCount = async (id) => (await db.query(
  'select count(*)::int as count from class_gear where character_id = $1', [id]
)).rows[0].count;

beforeAll(async () => {
  await db.connect();
  ({ authUserId, profile } = await createAuthUserAndProfile(db, { email, profileName: `Convert ${suffix}` }));

  const gunslingerContent = {
    gear: [{ name: 'Revolver' }, { name: 'Duster' }],
    abilities: [{ name: 'Trickshot' }, { name: 'Standoff' }, { name: 'Shootout' }]
  };
  classes.gunslinger = await insertClass({
    name: `Conv Gunslinger ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v1',
    ...gunslingerContent
  });
  // The class's Aspirant fork exists, and conversion must leave the character
  // on its own class all the same.
  classes.gunslingerFork = await insertClass({
    name: `Conv Gunslinger ${suffix}`, rules_edition: 'aspirant', content_format: 'aspirant', rules_version: 'v2',
    base_class_id: classes.gunslinger.id, ...gunslingerContent
  });
  classes.wanderer = await insertClass({
    name: `Conv Wanderer ${suffix}`, rules_edition: 'advent', content_format: 'advent', rules_version: 'v1',
    gear: [{ name: 'Satchel' }], abilities: [{ name: 'Familiar Face' }]
  });

  // An Advent Gunslinger on the v1 rules at level 4, carrying two Revolvers,
  // Wanderer's Satchel and Familiar Face, four Ability Perks (one a compound),
  // a Defining Quirk and Accessories.
  characters.caroline = await createAdventCharacter({
    name: `Convert ${suffix}`, level: 4, quirks: QUIRKS, accessories: ACCESSORIES,
    gear: [
      { name: 'Revolver', class_id: classes.gunslinger.id },
      { name: 'Revolver', class_id: classes.gunslinger.id },
      { name: 'Satchel', class_id: classes.wanderer.id }
    ],
    abilities: [
      { name: 'Trickshot', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Standoff', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Shootout', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Familiar Face', class_id: classes.wanderer.id, type: 'core' }
    ],
    perks: [
      { ability_name: 'Trickshot', text: 'Off the wall.', position: 0 },
      { ability_name: 'Standoff', text: 'Stare them down.', position: 1 },
      { ability_name: 'Standoff', text: 'Twice as long.', position: 2, compounds_with: 'position-1' },
      { ability_name: 'Familiar Face', text: 'Known in every town.', position: 3 }
    ]
  });

  // Thirteen Signatures: more than an Aspirant character may bring on a mission.
  characters.hoarder = await createAdventCharacter({
    name: `Hoarder ${suffix}`, level: 1, quirks: [], accessories: [],
    gear: Array.from({ length: 13 }, () => ({ name: 'Revolver', class_id: classes.gunslinger.id })),
    abilities: [
      { name: 'Trickshot', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Standoff', class_id: classes.gunslinger.id, type: 'core' },
      { name: 'Shootout', class_id: classes.gunslinger.id, type: 'core' }
    ],
    perks: []
  });
});

afterAll(async () => {
  if (profile?.id) await db.query('delete from characters where creator_id = $1', [profile.id]);
  if (profile?.id) await db.query('delete from profiles where id = $1', [profile.id]);
  for (const key of ['gunslingerFork', 'gunslinger', 'wanderer']) {
    if (classes[key]?.id) await db.query('delete from classes where id = $1', [classes[key].id]);
  }
  if (authUserId) await db.query('delete from auth.users where id = $1', [authUserId]);
  await db.end();
});

test('conversion switches the mode and leaves the class and every row as they were', async () => {
  const id = characters.caroline;
  const rowsBefore = await storedRows(id);
  const before = await characterRow(id);
  expect(rowsBefore.perks.filter(perk => perk.compounds_with)).toHaveLength(1);

  const { data, error } = await convertCharacterToAspirant({ profileId: profile.id }, id);
  expect(error).toBeNull();
  expect(data.creator_mode).toBe('aspirant');

  const after = await characterRow(id);
  expect(after).toEqual({ ...before, creator_mode: 'aspirant', updated_at: after.updated_at });
  expect(after.class_id).toBe(classes.gunslinger.id);
  expect(await storedRows(id)).toEqual(rowsBefore);
  expect(rowsBefore.traits.map(({ name, stat }) => ({ name, stat }))).toEqual(TRAITS);
});

test('a second conversion is refused and writes nothing', async () => {
  const id = characters.caroline;
  const before = { row: await characterRow(id), rows: await storedRows(id) };
  const result = await convertCharacterToAspirant({ profileId: profile.id }, id);
  expect(result).toEqual({
    data: null,
    error: { status: 400, message: `Convert ${suffix} is not on the Advent rules, so there is nothing to convert.` }
  });
  expect({ row: await characterRow(id), rows: await storedRows(id) }).toEqual(before);
});

test('an ordinary edit on the Advent v1 class saves the Quirk, Accessories and Ability Perks', async () => {
  const id = characters.caroline;
  const { rows: perks } = await db.query(
    `select p.class_ability_id, p.text, p.position, target.position as target_position
     from character_perks p left join character_perks target on target.id = p.compounds_with
     where p.character_id = $1 order by p.position`,
    [id]
  );
  const result = await updateCharacter(id, {
    ...STATS,
    ...TRAIT_FIELDS,
    name: `Converted ${suffix}`,
    level: 4,
    quirks: EDITED_QUIRKS,
    accessories: EDITED_ACCESSORIES,
    ability_perks: perks.map((perk, index) => ({
      class_ability_id: perk.class_ability_id,
      text: index === 0 ? EDITED_PERK : perk.text,
      position: perk.position,
      compounds_with: perk.target_position == null ? null : `position-${perk.target_position}`
    }))
  }, { id: profile.id });
  expect(result.error).toBeNull();

  const row = await characterRow(id);
  expect({ class_id: row.class_id, creator_mode: row.creator_mode, quirks: row.quirks, accessories: row.accessories })
    .toEqual({ class_id: classes.gunslinger.id, creator_mode: 'aspirant', quirks: EDITED_QUIRKS, accessories: EDITED_ACCESSORIES });
  const { rows: texts } = await db.query(
    'select text from character_perks where character_id = $1 order by position', [id]
  );
  expect(texts.map(perk => perk.text)).toEqual([EDITED_PERK, 'Stare them down.', 'Twice as long.', 'Known in every town.']);
});

test('Signatures past what a mission allows convert and keep growing while Merx is not judged', async () => {
  const id = characters.hoarder;
  expect((await convertCharacterToAspirant({ profileId: profile.id }, id)).error).toBeNull();
  expect(await gearCount(id)).toBe(13);

  const result = await updateCharacter(id, {
    ...STATS,
    ...TRAIT_FIELDS,
    name: `Hoarder ${suffix}`,
    level: 1,
    gear: Array.from({ length: 14 }, () => ({ name: 'Revolver', class_id: classes.gunslinger.id }))
  }, { id: profile.id });
  expect(result.error).toBeNull();
  expect(await gearCount(id)).toBe(14);
});
```

- [ ] **Step 3: Run it.** Tasks 1–5 are already in, so it should pass on the first run. Its red phase was each earlier task's own unit tests. If a test fails, treat it as a real finding: read the failure, and fix the code (not the test) unless the test contradicts this plan's Decisions.

Run: `eval "$(supabase status -o env)" && SUPABASE_URL="$API_URL" SUPABASE_DB_URL="$DB_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY" bun test models/character-convert-aspirant.integration.test.js`
Expected: 4 pass.

To see it discriminate, temporarily change `character: { creator_mode: 'aspirant' }` in `convertToAspirant` to `character: { creator_mode: 'aspirant', class_id: null }`. The first test must then fail on `class_id`. Revert the change before continuing.

- [ ] **Step 4: Run the integration tier.** Same env prefix with `bun run test:integration`. Expected: exactly the known reds.

- [ ] **Step 5: Correct the spec.** In `docs/superpowers/specs/2026-09-28-convert-to-aspirant-design.md`:

(a) Replace everything from `## Intent` down to (not including) the `---` line above `## Part 1` with:

```markdown
## Intent

A player can move their own Advent character onto the Aspirant rules without
rebuilding it. The trigger case is Caroline Denton
(`465f52ce-ee0d-4b0f-99bc-4baa4f9c8b7d`): an Advent v2 Gunslinger carrying a
fourth, cross-class Ability (Wanderer's Familiar Face), flagged
"Illegal Build: 4 Abilities, and the cap is 3." Under Aspirant the same build
is within the 6-Ability cap and Cross-Classing is a rule, not a breach.

The model:

- **Class format and character mode are independent.** A class is
  Advent-format or Aspirant-format (`content_format`); a character is on the
  Advent or the Aspirant rules (`creator_mode`).
- An Advent character may use only Advent classes. An Aspirant character may
  use Aspirant or Advent classes, and their Signatures and Abilities, freely.
- **Conversion changes the character's mode and nothing else.** Its class and
  every Signature, Ability and Ability Perk stay exactly as they are.
- **Aspirant V1 builds on Advent v2.** A character on the Aspirant rules has
  everything an Advent v2 character has -- Defining Quirk, Accessories,
  Ability Perks, the v2 level curve, Conduit Credit offscreen missions -- plus
  Enchantments and Mods, whatever its class's `rules_version`.
- **The Signature Cap limits what a character brings on a mission, not what
  it owns.** Nothing in the app records a mission loadout, so nothing enforces
  it.

Decisions taken with the user:

- **Owner self-service**, one-way, no admin step.
- **Keep the whole build.** An Ability-cap breach, Perk deficit or Merx
  overspend the Aspirant rules would find is grandfathered by the existing
  ratchet.
- **Block only on the rules Aspirant enforces on every save:** Traits and the
  Stat Cap.

The work is two parts. Part 1 puts Aspirant-format classes on the v2
character rules; Part 2 is the conversion, and it relies on every Aspirant
character getting the v2 rules by mode.
```

(b) In Part 1's "Definition change" subsection, append this paragraph after the one ending "The ingestion spec's paragraph is corrected to say so.":

```markdown
That answers the question for an Advent character. A character on the
Aspirant rules -- `creator_mode` `'aspirant'`, and Aspiring characters, which
are Aspirant-book characters -- is built under v2 whatever its class's
`rules_version`, decided in one place (`util/character-rules.js`
`characterRulesVersion`) and read by every site that picks a character's
rules: create, update, level-up, progress recalculation, the edit form, the
sheet, the details fragment, and the agent API.
```

(c) Replace everything from `## Part 2 — Convert to Aspirant` to the end of the file with:

````markdown
## Part 2 — Convert to Aspirant

### Eligibility

Offered on the edit page when both hold:

- the actor may mutate the character (`requireOwnedCharacter`);
- the character is on the **advent** economy (`economyFor` → `'advent'`:
  `creator_mode` null or `'advent'` on an advent-format class, or no class).

Every such character is eligible, whatever its class: an Aspirant character
may use Advent classes.

### What conversion does

One atomic save through `save_character_atomic` with
`p_character = { creator_mode: 'aspirant' }`:

- `class`, `class_id`, and every Signature (`class_gear`), Ability
  (`class_abilities`) and Ability Perk (`character_perks`) row are left exactly
  as they are, ids and compound links included: `p_gear`, `p_abilities` and
  `p_perks` are null, which the RPC reads as "leave these rows alone".
- Traits are resubmitted from the stored rows, because the RPC reads an absent
  Trait list as "no Traits" (`COALESCE(p_traits, '[]')`). They pair by
  `(name, occurrence)`, so the rows are kept.
- Every other column keeps its stored value: the UPDATE merges `p_character`
  over the stored row (`jsonb_populate_record(saved, p_character)`).

One-way: a converted character is on the aspirant economy and is never
eligible again. The stored `level` is not recalculated by the conversion; an
auto-calculated character moves onto the v2 curve at its next auto-calculated
save, level-up or mission write.

### After conversion

- **Aspirant economy.** Cross-Classing is judged against the character's own
  class version family (`computeVersionFamily`, via `familyResolver`), so its
  own class's Abilities and Signatures are own-class and another class's are
  cross-class, exactly as for any Aspirant character.
- **v2 character rules** by mode (Part 1): Defining Quirk, Accessories and
  Ability Perks are kept on every save, the edit form shows the v2 fields, the
  level follows the v2 curve, and the sheet offers Spend Conduit Credit.

### Blocking checklist

Computed from the character's own build under the aspirant economy. Each item
is fixable on the Advent edit form today.

| Rule | Source | Example message |
| --- | --- | --- |
| Traits | `validateTraits` (`services/character/input.js`) under `'aspirant'` | "Two Traits may not share a Stat (might)." |
| Stat Cap | `validateStatLimits` with `enforceCreationAllotment: false` (the per-Stat Cap with Traits and `stat_cap_purchases`) | `capBreachMessage` for the Stat |

The creation allotment and +++ ceiling are creation rules and are not judged.

### Grandfathered, not blocking

The Ability cap and Perk deficit (`buildBreaches`) and Merx overspend are
shown in the preview and allowed. After conversion they behave like any
existing breach: `updateCharacter` and `levelUp` refuse only a save that makes
a hard breach worse (the ratchet, `worsenedBreaches`), and the sheet shows the
Illegal Build line. Merx overspend shows as the Deficit line and is not
enforced on an edit.

### The Signature Cap

The Signature Cap (pg. 85: 12 for an Aspirant character; pg. 92: 8 for an
Aspiring one; pg. 8: an Enchantment takes a slot) limits what a character
brings on a mission. Nothing in the app records a mission loadout -- mission
sign-up and LFG selection choose a character, never its gear -- so the cap is
enforced nowhere: not at creation, not on an edit, not at conversion, and no
purchase surface counts Signature slots. What limits owning Signatures is Merx:
the creation grant at creation, and on the edit form the grant plus mission
income. If a loadout feature is built, the cap belongs there.

### Units

1. **`util/aspirant-conversion.js`** (pure, no I/O)
   `planConversion({ character, classFamilyOf, gear, abilities, abilityPerks, traits, realMissions, offscreenMissions })`
   → `{ blockers, breaches, perkBreakdown, merxBreakdown }`
   - `classFamilyOf`: the character's own version-family resolver, handed in
     by the service.
   - `blockers`: `[{ rule, detail }]` with `rule` `'traits'` or `'stat-cap'`;
     empty means convertible.
   - `breaches`, `perkBreakdown`, `merxBreakdown`: the existing derivations
     under `'aspirant'`, so the preview shows what the sheet will show
     afterwards.
2. **`CharacterService.convertToAspirant(actor, id)`** and
   **`planAspirantConversion(actor, id)`** (`services/character/service.js`):
   ownership gate (throws `AuthorizationError`), loads the character, its
   class family (`getClassFamilyRows`, skipped for a class-less character) and
   its missions through the adapter, calls `planConversion`, returns
   `{ status: 400, message }` listing blockers if any, otherwise saves the mode
   as above. Never trusts a client-sent plan.
3. **Wrappers** in `models/character.js` (`convertCharacterToAspirant`,
   `planCharacterAspirantConversion`).
4. **Route** `POST /characters/:id/convert-aspirant` (`routes/characters.js`):
   `sendRouteError` on a business error, else `HX-Location` to the character
   sheet.
5. **Edit-page panel** in `views/character-form.handlebars`, next to the
   Upgrade block, rendered only when eligible. It says the character keeps its
   class and whole build and switches to the Aspirant rules, and shows the
   Perks earned/spent, Merx earned/spent (and any Deficit), the hard breaches
   worded as the sheet words them, and the blocker checklist. The Convert
   button is disabled while blockers exist, and otherwise `hx-post`s with
   `hx-confirm` ("Convert <name> to Aspirant? This cannot be undone.").

### Error handling

- Not owner → `AuthorizationError` (existing handling).
- Not eligible (already aspirant or aspiring, or an Advent-mode character on
  an aspirant-format class) → 400 "<name> is not on the Advent rules, so there
  is nothing to convert."
- Blockers → 400 whose message lists every blocker, so a stale page still
  explains why.
- A version-family or mission read failure → returned as `{ data: null, error }`.
- RPC failure → propagated as today's saves do; the RPC is transactional, so a
  failed conversion changes nothing.

### Testing

- `planConversion` unit tests: the plan names no rows; own/cross-class against
  the character's own family; grandfathered Ability cap and Perk deficit in
  `breaches`, not `blockers`; Signatures past the mission cap neither block nor
  breach; Traits and Stat Cap blockers; a class-less character.
- Service tests (adapter stubs): ownership; the mode-only save payload; a
  class with no Aspirant fork converts; ineligible economies; blocker refusal;
  a family read failure.
- Integration (local stack): conversion leaves `class_id` and every
  gear/ability/perk/trait row unchanged (ids and compound links included),
  sets `creator_mode = 'aspirant'`, keeps Quirk and Accessories; a second
  conversion is refused and writes nothing; a follow-up edit on an Advent v1
  class saves Quirk, Accessories and Ability Perks; a 13-Signature character
  converts and then saves a 14th.

## Rollout

1. Merge Part 1; the user runs `supabase db push --linked` for the migration,
   then the reconcile script dry-run, review, `--apply`.
2. Merge Part 2 (no migration).
3. Caroline Denton's owner can then convert her. The only possible blockers
   are her Traits and her Stats against their Caps; the preview lists them
   first.
````

- [ ] **Step 6: Proofread the spec.** Re-read the rewritten file.
- Nothing may describe a fork remap, `no-fork`/`no-counterpart`, a Signature Cap blocker, or an ownership cap.
- Nothing may be written as history.

Run: `grep -n "fork\|counterpart\|Signature Cap" docs/superpowers/specs/2026-09-28-convert-to-aspirant-design.md`
Expected: only these hits:
- Part 1's existing lines about fork hiding and upgrade targets;
- the Intent's own mention of forks, if any;
- the "The Signature Cap" subsection and the Intent line stating what the cap limits.

- [ ] **Step 7: Commit.**

```bash
git add models/character-convert-aspirant.integration.test.js docs/superpowers/specs/2026-09-28-convert-to-aspirant-design.md
git commit -m "test: prove mode-only conversion against save_character_atomic; restate the spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

- **Coverage of the decisions:**
  - Decision 1 (mode-only conversion) is Task 2, plus Task 6's integration test.
  - Decision 2 (Signature Cap removed from ownership) is Tasks 2 (the conversion blocker), 3 (client), 4 (server) and 6 (integration).
  - Decision 3 (v2 by mode) is Task 1 at every audited site. The level-up modal and the reconcile script are verified in Decisions 10a and 10b.
  - Decision 4 (Traits and Stat Cap only) is Task 2.
  - Decision 5 (panel) is Task 5.
  - Decision 6 (spec) is Task 6.
  - Decision 7 (integration rewrite) is Task 6.
- **Placeholders:** none. Every code step shows the code, and every run step names the command and the expected result.
- **Names used across tasks:**
  - `characterRulesVersion({ classRulesVersion, creatorMode })`: defined in Task 1 and used only there.
  - `planConversion({ character, classFamilyOf, gear, abilities, abilityPerks, traits, realMissions, offscreenMissions })` and its return keys `blockers`, `breaches`, `perkBreakdown` and `merxBreakdown`: defined in Task 2 and read by Task 5's panel under those names.
  - `CONVERSION_RULES` has `traits` and `statCap`.
  - `validateEconomyLimits` keeps `enforceAbilityLimits` and loses `storedGear` in Task 4.
- **Review Focus:** each of the five lines has a test:
  1. Task 1, "leaves its stored v1 free text alone".
  2. Task 1, the `version-fields` and `hx-vals` tests.
  3. Task 2, the class-less planner and service tests.
  4. Task 2, "refuses a character already converted", and Task 6, "a second conversion".
  5. Task 3 (both client tests), Task 4 (validator and service), and Task 6 (the 14th Signature).
