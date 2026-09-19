# ENCLAVE: Aspirant V1 — Merx Purchase Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a V1 character actually spend its Merx — choose among its class's twelve Signatures, unlock a Default Enchantment or author a Custom one, add up to two Mods — in the wizard and on the edit form, with every figure read from the server's module instead of a second copy in the browser.

**Architecture:** Plan 1 made the economy real and enforced on the server and deliberately shipped no UI. This plan builds the UI on top of it. One new browser component (`public/js/signature-entry.js`) renders a printed Signature entry and its purchase controls, and both surfaces mount it. Every price, grant, cap and limit reaches the browser through the JSON island the wizard already has, and every client constant it replaces is deleted in the same commit. The economy a surface believes in is computed **on the server** and served per class id, so no rule is mirrored.

**Tech Stack:** Bun, `bun:test`, Express 4, express-handlebars, htmx, Alpine, Supabase/Postgres. `util/` is CommonJS, `public/js/` is browser IIFEs, `scripts/` is ESM.

**Spec:** `docs/superpowers/specs/2026-09-18-aspirant-v1-merx-equipment-economy-design.md` — read its "Plan 2 rulings" section before Task 1.

**Plan 1 (landed):** `docs/superpowers/plans/2026-09-18-aspirant-v1-merx-economy-foundation.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Figures appear exactly once.** `util/merx-economy.js` owns every price, grant and cap; `util/stat-caps.js` owns every stat figure. This plan's job is to make the browser read them rather than keep its own. A figure typed into `public/js/`, a `.handlebars` view, or a route is a defect.
- **Delete, never shadow.** When a client constant is replaced, it is removed in the same commit. No fallbacks, no `_old`, no deprecation path.
- **Plan 1's shipped API differs from plan 1's prose.** Read the source, not that document. In particular `validateEconomyLimits({ economy, gear, storedGear, commonItems, characterClassId, earnedMerx, enforceMerxBudget })` **returns `{ ok }` / `{ ok: false, errors }` and does not throw** (`services/character/input.js:338`), and `normalizeGearEquipment(item)` returns a **partial** object — a key absent from the submission stays absent (`services/character/input.js:400-409`).
- **Nothing throws in a validator.** The POST handlers in `routes/characters.js` are unwrapped `async` functions, so a throw becomes an unhandled rejection and **the request hangs** rather than erroring.
- **Absent means "keep what is stored"; explicit `null` means "remove".** This is the RPC's contract (`supabase/migrations/20260918000001_save_character_atomic_gear_equipment.sql`) and exists precisely so the edit form's bare `"Class::Item"` strings cannot wipe a purchase. The JS reconcile fallback is the opposite — absent means "none" — because it receives already-normalised items. Both paths must be exercised.
- **`save_character_atomic` is what runs on every real save.** `reconcileGear`/`reconcileTraits` in `services/character/service.js` run **only** when `adapter.saveCharacterAtomic` is not a function, and with the real client it always is (`services/character/repository.js:249-250`). A change to the JS reconciler alone passes its unit tests and drops the data in production. Change both.
- **The surfaces appear only for the two V1 populations** — a class with `content_format = 'aspirant'`, or `creator_mode = 'aspiring'`. Every other character sees today's form, except for Task 1's derivation correction and Task 9's gate removal, which are deliberate and scoped.
- **A comment stating a fact must be TRUE.** Check every claim against the code beside it. Three rounds of slice 3 and nine of slice 5's ten tasks shipped a false comment that originated in plan text.
- **Row counts must not change**: characters 327, traits 981, class_gear 1492, class_abilities 916, classes 62.

### Local stack safety — read before any task that touches the database

```bash
eval "$(supabase status -o env)"
echo "API_URL=$API_URL"
grep -E '^SUPABASE_URL=' .env
```

`API_URL` **must** print `http://127.0.0.1:54321`, and the `.env` line must name the same host. If either does not, stop.

`supabase status -o env` exports `API_URL`, `DB_URL` and `SERVICE_ROLE_KEY` — it does **not** export `SUPABASE_URL`, so checking `$SUPABASE_URL` after that eval confirms nothing. `.env` is the file the app reads and is hand-switched between this local stack and a **live production** project.

**NEVER run `supabase db reset`** — the local database holds a restored copy of production data. Apply migrations with `supabase migration up` only. Never read or restore anything under `backups/`.

`bun run test:unit` is always safe (it overrides `SUPABASE_URL` to `https://test.invalid`). `bun test <file>` directly does **not** get that override. An integration test file must be registered in the `integrationFiles` allowlist at `scripts/run-tests.mjs:7-22` or it silently runs in the unit tier against no database.

### Known-red before you start

Establish this baseline in Task 1 Step 1 and do not let it be mistaken for damage this plan caused.

- `bun run test:unit` — clean, exit 0.
- `bun run test:http` — **1 fail**: `routes/open-graph.test.js`, "a class page describes the edition, version and teaser" (`tags.image` undefined).
- `bun run test:integration` — **3 files red**: `util/character-content-integrity.integration.test.js` (1), `util/class-form-round-trip.integration.test.js` (1 of 3), `util/image-crop-integrity.integration.test.js` (2).

### Browser code cannot be tested where it lives

`scripts/run-tests.mjs:134` scans only `['models', 'routes', 'services', 'test', 'util', 'views']`. **`public/` is not scanned**, so `public/js/whatever.test.js` never runs. Every browser-IIFE test in this plan lives under `test/` and boots the IIFE with jsdom + `new Function`, the recipe in `test/character-wizard-client.test.js:105-129`.

---

## File Structure

**Created**
- `public/js/signature-entry.js` — browser IIFE, `window.SignatureEntry`. Renders one printed Signature entry plus its purchase controls, and prices a purchase from served figures. Mounted by both surfaces. No DOM ownership beyond the element it is handed.
- `test/signature-entry.test.js` — the component's rendering and arithmetic, including a drift test that pins its totals to `util/merx-economy.js`'s `equipmentSpend`.
- `views/partials/signature-entry.handlebars` — the server-rendered read-only twin used by the character page.

**Modified**
- `util/merx-economy.js` — `CREATION_GRANT.advent` becomes 2; new `economyFigures()` export describing the whole economy as data.
- `util/stat-caps.js` — new `statCapFigures()` export; the note naming the client mirror is deleted once the mirror is.
- `util/character-derived.js` — `STARTING_ON_CLASS_GEAR_ALLOTMENT` (4) becomes `ADVENT_DEFAULT_SIGNATURES` (3).
- `routes/characters.js` — serve the figures and a server-computed economy per class id; stop slicing the class's gear to six; mount the drawer's data on the edit form and the character page.
- `public/js/character-wizard.js` — delete seven constants and both stat-cap mirrors; resolve the economy from the served map; mount the component; submit equipment and a real `commissary_reward`.
- `views/character-wizard.handlebars` — delete every literal Merx figure (`:59`, `:282`, `:284`, `:286`, `:303`, `:329`).
- `views/character-form.handlebars`, `views/partials/character-class-gear.handlebars` — mount the drawer for V1 economies.
- `views/character.handlebars`, `views/partials/character-details.handlebars` — render Enchantments, Mods, and the Merx breakdown.
- `e2e/specs/` — one new spec for the purchase journey.

---

## Test fixtures

Every task's tests call these. Write them **once**, in Task 3 and Task 5
respectively, and import them rather than redefining them — a second copy of
`v1Class()` that drifts from the first will make two tasks disagree about what
a class looks like.

**`test/helpers/wizard-fixture.js`** (new; created in Task 3, used from Task 3
onward). `bootWizard` is the existing recipe at
`test/character-wizard-client.test.js:105-129` — move it here rather than
writing a second one, and re-point that file's own tests at it in the same
commit.

```js
const { economyFigures } = require('../../util/merx-economy');
const { statCapFigures } = require('../../util/stat-caps');
const { MERX_PER_MISSION_SUCCESS } = require('../../util/enclave-consts');
const { ADVENT_DEFAULT_SIGNATURES } = require('../../util/character-derived');

const item = (name, column, position) => ({
  name,
  description: `${name} description.`,
  meters: [],
  column,
  position,
  default_enchantment: { name: `${name} Enchantment`, description: 'Does a thing.' }
});

const TWELVE = [
  'Cowboy Hat', 'Sharps Rifle', 'Bandolier', 'Bowie Knife', 'Wild Rag', 'Duster',
  'Rollups', 'Lasso', 'Spurs', 'Canteen', 'Saddlebag', 'Tin Star'
];

const twelveNames = () => [...TWELVE];
const twelveItems = () => TWELVE.map((name, i) =>
  item(name, Math.floor(i / 3) + 1, (i % 3) + 1));
const sixItems = () => twelveItems().slice(0, 6);

const v1Class = () => ({
  id: 'c-v1', name: 'Gunslinger', content_format: 'aspirant',
  gear: twelveItems(), abilities: [], stat_spread: {}
});
const otherV1Class = () => ({
  id: 'c-other', name: 'Illusionist', content_format: 'aspirant',
  gear: twelveItems(), abilities: [], stat_spread: {}
});
const adventClass = () => ({
  id: 'c-advent', name: 'Vizier', content_format: 'advent',
  gear: sixItems().map((g) => ({ ...g, default_enchantment: null })),
  abilities: [], stat_spread: {}
});
const classFor = (mode) => (mode === 'advent' ? adventClass() : v1Class());

// The wizardData object the route serves, with every key Task 2 added. A test
// overrides only what it cares about.
const fixture = (overrides = {}) => {
  const classes = overrides.classes || [v1Class()];
  const mode = overrides.mode || 'aspirant';
  return {
    mode,
    preselectedClassId: null,
    classes,
    statList: ['Might', 'Grace', 'Wits', 'Spirit'],
    personalityMap: {},
    commonItems: [{ name: 'Rope', description_html: '<p>Rope.</p>' }],
    economy: economyFigures(),
    statCaps: statCapFigures(),
    merxPerMissionSuccess: MERX_PER_MISSION_SUCCESS,
    adventDefaultSignatures: ADVENT_DEFAULT_SIGNATURES,
    economyByClassId: Object.fromEntries(classes.map((c) => [
      c.id, mode === 'aspiring' ? 'aspiring'
        : (c.content_format === 'aspirant' ? 'aspirant' : 'advent')
    ])),
    economyWhenClassless: mode === 'aspiring' ? 'aspiring' : 'advent',
    ...overrides
  };
};

// Seeds the aspiring builder's three step-1 picks, which are its whole step-4
// pool (public/js/character-wizard.js:2502-2524).
const seedAspiringPicks = (wizard, names) => {
  wizard.getState().classBuild.classGear = names.slice(0, 3)
    .map((itemName) => ({ classId: 'c-v1', itemName }));
};

module.exports = {
  fixture, v1Class, otherV1Class, adventClass, classFor,
  twelveNames, twelveItems, sixItems, seedAspiringPicks, item
};
```

The `economyByClassId` line above deliberately restates the rule instead of
calling `economyFor`. That is the point: if the fixture and the route ever
disagree, Task 2's route test — which compares against the real `economyFor` —
fails and says so.

**`boot()`** in `test/signature-entry.test.js` is given in full in Task 5 Step 1.

**Route and view render helpers** — `renderWizardData`, `renderCharacterForm`,
`renderCharacterPage`, `renderDetailsFragment`, `mountPurchases`,
`fixtureCharacter`, `enchantedItem`. Each task that first needs one says so;
build it by matching the nearest existing test of the same kind rather than
inventing a harness:

| Helper | Model it on | First used |
| --- | --- | --- |
| `renderWizardData` | the nearest `routes/*.test.js` that exercises a render | Task 2 |
| `renderCharacterForm` | `views/character-form.test.js` | Task 10 |
| `renderCharacterPage`, `renderDetailsFragment`, `enchantedItem` | `views/character-form.test.js` and the existing character-page view test | Task 11 |
| `mountPurchases`, `fixtureCharacter` | `test/character-wizard-client.test.js`'s jsdom recipe | Task 10 |

---

## Task 1: Advent's Elective

The spec's "Plan 2 rulings" ruling 1. Advent is three Default Signatures and one Elective worth 2 Merx, not four free items. Today a character who spends the Elective on two common items is reported 2 Merx in deficit for a legal build.

**Files:**
- Modify: `util/merx-economy.js:20-25` (the `CREATION_GRANT` block and its comment)
- Modify: `util/character-derived.js:16` and `:59-71` (`adventGearSpend`)
- Test: `util/character-derived.test.js`, `util/merx-economy.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CREATION_GRANT.advent === 2`; `ADVENT_DEFAULT_SIGNATURES === 3` (renamed from `STARTING_ON_CLASS_GEAR_ALLOTMENT`). It stays private to `util/character-derived.js` here and is **exported in Task 3**, which is when a second consumer appears; Task 4 and the test fixtures then import it. Every later task reads the grant through `economyFigures()`, never directly.

- [ ] **Step 1: Record the baseline**

Run all three tiers and write down exactly what fails, so a later red is attributable.

```bash
bun run test:unit
bun run test:http
bun run test:integration
```

Expected: the three results under "Known-red before you start". If you see anything else, stop and report it before changing a line.

- [ ] **Step 2: Write the failing tests**

Add to `util/character-derived.test.js`. The three routes are pg. 3's Elective, spent three ways; Advent V2 pg. 16 is what makes the third legal.

```js
const { deriveMerxBreakdown } = require('./character-derived');

describe('advent: three Defaults and one Elective (pg. 3)', () => {
  const CLASS_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
  const own = (name) => ({ name, class_id: CLASS_ID });
  const threeDefaults = [own('Alpha'), own('Bravo'), own('Charlie')];
  const base = {
    realMissions: [], offscreenMissions: [],
    characterClassId: CLASS_ID, economy: 'advent'
  };

  test('the Elective spent on a fourth class item costs exactly 2', () => {
    const result = deriveMerxBreakdown({
      ...base, gear: [...threeDefaults, own('Delta')], commonItems: []
    });
    expect(result).toMatchObject({ earned: 2, spend: 2, reward: 0, deficit: 0 });
  });

  test('the Elective spent on two common items costs exactly 2', () => {
    const result = deriveMerxBreakdown({
      ...base, gear: threeDefaults, commonItems: ['Rope', 'Lantern']
    });
    expect(result).toMatchObject({ earned: 2, spend: 2, reward: 0, deficit: 0 });
  });

  test('the Elective doubling up on a Default costs exactly 2 (Advent V2 pg. 16)', () => {
    const result = deriveMerxBreakdown({
      ...base, gear: [...threeDefaults, own('Alpha')], commonItems: []
    });
    expect(result).toMatchObject({ earned: 2, spend: 2, reward: 0, deficit: 0 });
  });

  test('an unspent Elective is carried, not forfeited', () => {
    const result = deriveMerxBreakdown({ ...base, gear: threeDefaults, commonItems: [] });
    expect(result).toMatchObject({ earned: 2, spend: 0, reward: 2, deficit: 0 });
  });

  test('a fifth on-class Signature is charged on top of the Elective', () => {
    const result = deriveMerxBreakdown({
      ...base, gear: [...threeDefaults, own('Delta'), own('Echo')], commonItems: []
    });
    expect(result).toMatchObject({ earned: 2, spend: 4, deficit: 2 });
  });

  test('mission income still stacks on the grant', () => {
    const result = deriveMerxBreakdown({
      ...base,
      realMissions: [{ outcome: 'success' }, { outcome: 'success' }],
      gear: threeDefaults, commonItems: []
    });
    expect(result).toMatchObject({ earned: 4 });
  });
});
```

Add to `util/merx-economy.test.js`, beside the existing grant pinning:

```js
test('advent grants the Elective, aspirant and aspiring their book figures', () => {
  expect(CREATION_GRANT).toEqual({ advent: 2, aspirant: 12, aspiring: 10 });
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `bun run test:unit`
Expected: FAIL. The common-items test should report `deficit: 2` where 0 was expected — that is the bug this task fixes, seen from the outside.

- [ ] **Step 4: Change the grant**

In `util/merx-economy.js`, replace the `CREATION_GRANT` block and its comment. The old comment claims advent grants no Merx; that claim is what was wrong.

```js
// pg. 3: "Instead of four Signature Items (three Default and one Elective),
// characters start with 12 Merx". pg. 90: aspiring starts with 10.
//
// Advent keeps the arrangement Aspirant replaces: three Default Signatures,
// free, plus one Elective. The Elective is a choice rather than a fixed item --
// Advent V2 pg. 16 lets it double up on a Default instead of taking a new one --
// so it is granted as its 2-Merx value and spends like any other Merx: one
// class item, or two common items, or a duplicated Default. Granting four free
// items instead priced only the first of those routes and reported a deficit
// for the other two.
const CREATION_GRANT = { advent: 2, aspirant: 12, aspiring: 10 };
```

- [ ] **Step 5: Change the allotment, and give it a name that says what it is**

In `util/character-derived.js`, rename the constant and correct its value. `STARTING_ON_CLASS_GEAR_ALLOTMENT` described four items that were never all free; `ADVENT_DEFAULT_SIGNATURES` describes the three that are.

```js
// pg. 3's "three Default" Signatures, which an Advent character has without
// paying. The fourth item is the Elective, and it is paid for out of
// CREATION_GRANT.advent like anything else -- see util/merx-economy.js.
const ADVENT_DEFAULT_SIGNATURES = 3;
```

Update the single arithmetic site in `adventGearSpend`:

```js
  const chargedOnClass = Math.max(0, onClassCount - ADVENT_DEFAULT_SIGNATURES);
```

Then grep for the old name and remove every survivor, including the three comment references in `public/js/character-wizard.js` (`:2454`, `:2460`, `:2549`) — those comments are rewritten wholesale in Task 5, so for now just make sure they do not name a constant that no longer exists.

```bash
grep -rn "STARTING_ON_CLASS_GEAR_ALLOTMENT" --include='*.js' . | grep -v node_modules
```

Expected after the change: no hits.

- [ ] **Step 6: Run the tests**

Run: `bun run test:unit`
Expected: PASS, exit 0.

- [ ] **Step 7: Measure the change against real data**

This is the evidence the spec cites. Confirm it still holds rather than trusting the number.

```bash
eval "$(supabase status -o env)"
psql "$DB_URL" -At -F'|' -c "
with adv as (
  select ch.id, ch.class_id, ch.auto_calculate
  from characters ch
  left join classes cl on cl.id = ch.class_id
  where coalesce(ch.creator_mode,'') <> 'aspiring'
    and coalesce(cl.content_format,'advent') <> 'aspirant'
),
g as (
  select a.id, a.auto_calculate,
         count(*) filter (where cg.class_id = a.class_id) as on_class
  from adv a left join class_gear cg on cg.character_id = a.id
  group by a.id, a.auto_calculate
)
select auto_calculate,
       case when on_class >= 4 then 'unchanged' else 'earned +2' end,
       count(*)
from g group by 1,2 order by 1,2;"
```

Expected: `f|earned +2|66`, `f|unchanged|255`, `t|earned +2|3`, `t|unchanged|3` — 327 in total. If the split differs, say so in your report and do **not** adjust the spec to match without flagging it.

- [ ] **Step 8: Commit**

```bash
git add util/merx-economy.js util/character-derived.js util/character-derived.test.js util/merx-economy.test.js
git commit -m "fix: price advent's Elective at 2 whichever way it is spent"
```

---

## Task 2: the module describes itself, and the route serves it

Nothing reaches the browser yet. This task gives both modules a way to hand over every figure as data, and puts that data plus a **server-computed** economy per class id onto `wizardData`. Computing the economy server-side is ruling 2: it means no client ever mirrors `economyFor`.

**Files:**
- Modify: `util/merx-economy.js` (new `economyFigures` export)
- Modify: `util/stat-caps.js` (new `statCapFigures` export)
- Modify: `routes/characters.js:202-311` (the wizard GET)
- Test: `util/merx-economy.test.js`, `util/stat-caps.test.js`, `routes/characters-wizard-data.test.js` (create)

**Interfaces:**
- Consumes: Task 1's `CREATION_GRANT`.
- Produces: `economyFigures()` and `statCapFigures()`, and the `wizardData.economy`, `wizardData.statCaps`, `wizardData.economyByClassId`, `wizardData.economyWhenClassless` payload every later task reads.

- [ ] **Step 1: Write the failing tests**

In `util/merx-economy.test.js`:

```js
const {
  economyFigures, priceOfSignature, priceOfEnchantment, priceOfMod,
  CREATION_GRANT, SIGNATURE_CAP, MODS_PER_SIGNATURE,
  ENCHANTMENT_WORD_LIMIT, MOD_WORD_LIMIT, COMMON_ITEM_PRICE
} = require('./merx-economy');

describe('economyFigures', () => {
  test('carries every figure a surface needs, and no function', () => {
    const figures = economyFigures();
    expect(figures).toEqual({
      grants: CREATION_GRANT,
      signatureCap: SIGNATURE_CAP,
      modsPerSignature: MODS_PER_SIGNATURE,
      enchantmentWordLimit: ENCHANTMENT_WORD_LIMIT,
      modWordLimit: MOD_WORD_LIMIT,
      prices: {
        commonItem: COMMON_ITEM_PRICE,
        signature: { own: 2, cross: 3 },
        defaultEnchantment: { own: 2, cross: 3 },
        customEnchantment: { own: 3, cross: 4 },
        mod: { own: [1, 2], cross: [2, 3] }
      }
    });
  });

  test('survives JSON, because that is how it reaches a browser', () => {
    expect(JSON.parse(JSON.stringify(economyFigures()))).toEqual(economyFigures());
  });

  test('is built from the pricing functions, not retyped', () => {
    const { prices } = economyFigures();
    expect(prices.signature.cross).toBe(priceOfSignature({ crossClass: true }));
    expect(prices.customEnchantment.own).toBe(priceOfEnchantment({ source: 'custom' }));
    expect(prices.mod.cross[1]).toBe(priceOfMod({ index: 1, crossClass: true }));
  });

  test('hands back a fresh object, so a caller cannot mutate the module', () => {
    economyFigures().grants.advent = 99;
    expect(CREATION_GRANT.advent).toBe(2);
  });
});
```

In `util/stat-caps.test.js`:

```js
const { statCapFigures, BASE_STAT_CAP, CREATION_STAT_CAP, CREATION_PLUSES,
        LEVEL_PLUSES_PER_LEVEL, CAP_INCREASE_PLUS_COST, TRAIT_COUNT } = require('./stat-caps');

test('statCapFigures carries every stat figure a surface needs', () => {
  expect(statCapFigures()).toEqual({
    baseStatCap: BASE_STAT_CAP,
    creationStatCap: CREATION_STAT_CAP,
    creationPluses: CREATION_PLUSES,
    levelPlusesPerLevel: LEVEL_PLUSES_PER_LEVEL,
    capIncreasePlusCost: CAP_INCREASE_PLUS_COST,
    traitCount: TRAIT_COUNT
  });
});
```

Create `routes/characters-wizard-data.test.js`. Follow the fixture style of the nearest existing route test — find it with `ls routes/*.test.js` and match its Express/stub setup rather than inventing one.

```js
test('wizardData carries the economy figures, not a copy of them', async () => {
  const data = await renderWizardData({ mode: 'advent' });
  expect(data.economy).toEqual(require('../util/merx-economy').economyFigures());
  expect(data.statCaps).toEqual(require('../util/stat-caps').statCapFigures());
});

test('wizardData resolves each class to an economy on the server', async () => {
  const data = await renderWizardData({
    mode: 'advent',
    classes: [
      { id: 'c-advent', content_format: 'advent' },
      { id: 'c-v1', content_format: 'aspirant' }
    ]
  });
  expect(data.economyByClassId).toEqual({ 'c-advent': 'advent', 'c-v1': 'aspirant' });
});

test('aspiring mode is aspiring whatever class is picked', async () => {
  const data = await renderWizardData({
    mode: 'aspiring',
    classes: [{ id: 'c-v1', content_format: 'aspirant' }]
  });
  expect(data.economyByClassId['c-v1']).toBe('aspiring');
  expect(data.economyWhenClassless).toBe('aspiring');
});

test('mission income is served from enclave-consts, not retyped', async () => {
  const data = await renderWizardData({ mode: 'advent' });
  expect(data.merxPerMissionSuccess)
    .toBe(require('../util/enclave-consts').MERX_PER_MISSION_SUCCESS);
});

test('a class-less advent wizard falls back to advent', async () => {
  const data = await renderWizardData({ mode: 'advent', classes: [] });
  expect(data.economyWhenClassless).toBe('advent');
});

test('each served class carries its content_format', async () => {
  const data = await renderWizardData({
    mode: 'aspirant', classes: [{ id: 'c-v1', content_format: 'aspirant' }]
  });
  expect(data.classes[0].content_format).toBe('aspirant');
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun run test:unit` and `bun run test:http`
Expected: FAIL — `economyFigures is not a function`, and the route test cannot find the new keys.

- [ ] **Step 3: Add `economyFigures()`**

In `util/merx-economy.js`, above `module.exports`. It calls the pricing functions rather than restating the tables, so a price can only be written once even here.

```js
// The whole economy as plain data, for a consumer that cannot require this
// module -- a browser IIFE reading the wizard's JSON island. Built by calling
// the pricing functions rather than restating the tables, so there is still
// exactly one place a price is written down. Returns a fresh object each call:
// it is handed to JSON.stringify and to callers who have no reason to expect
// the module's own constants back.
const economyFigures = () => ({
    grants: { ...CREATION_GRANT },
    signatureCap: { ...SIGNATURE_CAP },
    modsPerSignature: MODS_PER_SIGNATURE,
    enchantmentWordLimit: ENCHANTMENT_WORD_LIMIT,
    modWordLimit: MOD_WORD_LIMIT,
    prices: {
        commonItem: COMMON_ITEM_PRICE,
        signature: {
            own: priceOfSignature({ crossClass: false }),
            cross: priceOfSignature({ crossClass: true })
        },
        defaultEnchantment: {
            own: priceOfEnchantment({ source: 'default', crossClass: false }),
            cross: priceOfEnchantment({ source: 'default', crossClass: true })
        },
        customEnchantment: {
            own: priceOfEnchantment({ source: 'custom', crossClass: false }),
            cross: priceOfEnchantment({ source: 'custom', crossClass: true })
        },
        mod: {
            own: [priceOfMod({ index: 0 }), priceOfMod({ index: 1 })],
            cross: [
                priceOfMod({ index: 0, crossClass: true }),
                priceOfMod({ index: 1, crossClass: true })
            ]
        }
    }
});
```

Add `economyFigures` to `module.exports`.

Note `MODS_PER_SIGNATURE` is served as the count, and `prices.mod.own` has exactly that many entries. If a future edition allows three Mods, the array and the count must grow together; a test in Task 6 pins that they agree.

- [ ] **Step 4: Add `statCapFigures()`**

In `util/stat-caps.js`, the same shape and the same reasoning. Add it to `module.exports`.

```js
// Every stat figure as plain data, for the browser surfaces that cannot
// require this module. See economyFigures in util/merx-economy.js.
const statCapFigures = () => ({
    baseStatCap: BASE_STAT_CAP,
    creationStatCap: CREATION_STAT_CAP,
    creationPluses: { ...CREATION_PLUSES },
    levelPlusesPerLevel: LEVEL_PLUSES_PER_LEVEL,
    capIncreasePlusCost: CAP_INCREASE_PLUS_COST,
    traitCount: TRAIT_COUNT
});
```

- [ ] **Step 5: Serve it**

In `routes/characters.js`, require the two new functions alongside the existing `economyFor` (`:34`) and `statCapMap` (`:35`) imports, plus `MERX_PER_MISSION_SUCCESS` from `util/enclave-consts.js`.

In the `wizardClasses` map (`:206-...`), add `content_format` beside `rules_edition`:

```js
      rules_edition: c.rules_edition || 'advent',
      // The shape of the class's content, and therefore which economy prices
      // its gear. Served because the client must not re-derive the rule --
      // economyByClassId below is computed with the real economyFor.
      content_format: c.content_format || 'advent',
```

Then extend the `wizardData` object (`:299-306`):

```js
    wizardData: {
      mode,
      preselectedClassId,
      classes: wizardClasses,
      statList,
      personalityMap,
      commonItems: commonItemsHtml,
      economy: economyFigures(),
      statCaps: statCapFigures(),
      // Mission income is not the economy module's to hold -- that module is
      // require-free and this figure lives in util/enclave-consts.js, where
      // the derivation reads it. Served alongside rather than copied into it.
      merxPerMissionSuccess: MERX_PER_MISSION_SUCCESS,
      // Which economy each class puts a character under, decided here by the
      // same economyFor every save path calls. The client looks the answer up
      // rather than working it out, so the two can never disagree -- they did
      // before this, for `?mode=advent` on a V1 class.
      economyByClassId: Object.fromEntries(wizardClasses.map((c) => [
        c.id,
        economyFor({ contentFormat: c.content_format, creatorMode: mode })
      ])),
      // The aspiring wizard has no class to look up until its pseudo-class is
      // built, and an advent wizard has none before step 1 is answered.
      economyWhenClassless: economyFor({ contentFormat: null, creatorMode: mode })
    },
```

- [ ] **Step 6: Run the tests**

Run: `bun run test:unit`, `bun run test:http`
Expected: `test:unit` exit 0; `test:http` down to its one known `open-graph` failure.

- [ ] **Step 7: Commit**

```bash
git add util/merx-economy.js util/stat-caps.js routes/characters.js util/merx-economy.test.js util/stat-caps.test.js routes/characters-wizard-data.test.js
git commit -m "feat: serve the economy and stat figures to the wizard"
```

---

## Task 3: the wizard reads the served figures, and its own are deleted

Ruling 3. Seven economy constants and four stat figures live in `public/js/character-wizard.js`; two of them disagree with the server. After this task the file holds no economy figure at all.

**Files:**
- Modify: `public/js/character-wizard.js` — `:16-17`, `:23`, `:27`, `:30`, `:34`, `:36-46`, `:229-232`, `:736-743`, `:827-833`, `:849-852`, `:1589`
- Modify: `util/stat-caps.js:145-150` (the note naming the mirror stops being true)
- Test: `test/character-wizard-client.test.js`

**Interfaces:**
- Consumes: Task 2's `DATA.economy`, `DATA.statCaps`, `DATA.economyByClassId`, `DATA.economyWhenClassless`, `DATA.merxPerMissionSuccess`.
- Produces: `economyForState()` returning `'advent' | 'aspirant' | 'aspiring'` for the wizard's current class selection; `getMerxBudget()` reading the served grant. Tasks 5-9 call both.

- [ ] **Step 1: Write the failing tests**

Add to `test/character-wizard-client.test.js`. The fixture builder there takes the `wizardData` object wholesale, so extend the fixture it seeds with the new keys — read `:105-129` before writing, and add the keys to whatever helper builds that object rather than duplicating it.

```js
const { economyFigures } = require('../util/merx-economy');
const { statCapFigures } = require('../util/stat-caps');

describe('the wizard reads its economy from the server', () => {
  test('an advent wizard on a V1 class uses the aspirant budget', () => {
    const wizard = bootWizard(fixture({
      mode: 'advent',
      classes: [{ id: 'c-v1', name: 'Gunslinger', content_format: 'aspirant', gear: [] }],
      economyByClassId: { 'c-v1': 'aspirant' }
    }));
    wizard.getState().classId = 'c-v1';
    expect(wizard.getMerxBudget()).toBe(economyFigures().grants.aspirant);
  });

  test('the budget follows a change of class', () => {
    const wizard = bootWizard(fixture({
      mode: 'advent',
      classes: [
        { id: 'c-advent', name: 'Vizier', content_format: 'advent', gear: [] },
        { id: 'c-v1', name: 'Gunslinger', content_format: 'aspirant', gear: [] }
      ],
      economyByClassId: { 'c-advent': 'advent', 'c-v1': 'aspirant' }
    }));
    wizard.getState().classId = 'c-advent';
    expect(wizard.getMerxBudget()).toBe(economyFigures().grants.advent);
    wizard.getState().classId = 'c-v1';
    expect(wizard.getMerxBudget()).toBe(economyFigures().grants.aspirant);
  });

  test('advent still earns per successful mission, from the served figure', () => {
    const wizard = bootWizard(fixture({ mode: 'advent', economyWhenClassless: 'advent' }));
    wizard.getState().successfulMissions = 3;
    expect(wizard.getMerxBudget())
      .toBe(economyFigures().grants.advent + 3 * require('../util/enclave-consts').MERX_PER_MISSION_SUCCESS);
  });

  test('a class-less wizard uses the served fallback', () => {
    const wizard = bootWizard(fixture({ mode: 'aspiring', economyWhenClassless: 'aspiring' }));
    expect(wizard.getMerxBudget()).toBe(economyFigures().grants.aspiring);
  });

  test('the plus allotment comes from the served stat figures', () => {
    const wizard = bootWizard(fixture({ mode: 'aspiring', statCaps: statCapFigures() }));
    wizard.getState().level = 1;
    expect(wizard.getTotalPoints()).toBe(statCapFigures().creationPluses.aspiring);
    wizard.getState().level = 3;
    expect(wizard.getTotalPoints())
      .toBe(statCapFigures().creationPluses.aspiring + 2 * statCapFigures().levelPlusesPerLevel);
  });
});

test('no economy or stat figure is written down in the wizard client', () => {
  const source = require('fs').readFileSync('public/js/character-wizard.js', 'utf8');
  for (const name of [
    'CLASS_GEAR_COST', 'CROSS_CLASS_GEAR_COST', 'ADVENT_MERX_BUDGET',
    'ASPIRANT_MERX_BUDGET', 'ASPIRING_MERX_BUDGET', 'FREE_BASE_GEAR_COUNT',
    'BONUS_MERX_PER_SUCCESSFUL', 'COMMON_ITEM_COST',
    'CREATION_PLUSES', 'LEVEL_PLUSES_PER_LEVEL', 'BASE_STAT_CAP', 'CREATION_STAT_CAP'
  ]) {
    expect(source).not.toContain(name);
  }
});
```

`bootWizard` currently returns only `{ buildSubmitPayload, onSubmitSuccess, getState }`. Add `getMerxBudget` and `getTotalPoints` to the handle the IIFE returns (`public/js/character-wizard.js:3452`) so these are reachable; they are pure reads and exposing them costs nothing.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun run test:unit`
Expected: FAIL — `wizard.getMerxBudget is not a function`, and the grep test fails on every name.

- [ ] **Step 3: Replace the constants with reads**

Delete the constant block at `:16-46`, the single line `:1589`, and the `FREE_BASE_GEAR_COUNT` pair at `:229-232`.

**`:1589` is one line, not a block.** `ASPIRING_MERX_BUDGET` sits between `ASPIRING_CORE_PERKS` (`:1587`), `ASPIRING_ADVANCED_PERKS` (`:1588`) and `ASPIRING_PERKS_BUDGET` (`:1593`). Those three are **Perk** figures; no server module defines them, slice 4b owns them, and there is nothing to read them from. Delete `ASPIRING_MERX_BUDGET` alone and leave its three neighbours untouched. In their place, near the `DATA` parse at `:48-51`:

```js
  // Every price, grant, cap and limit comes from the server. util/merx-economy.js
  // and util/stat-caps.js are the only places these are written down; the route
  // serves them through the JSON island above. Nothing here may hold its own copy.
  const ECONOMY = DATA.economy;
  const STAT_FIGURES = DATA.statCaps;

  // Which economy the character being built is under. Resolved on the server by
  // economyFor and served per class id, so this cannot drift from the save path
  // the way a mirrored rule did: `?mode=advent` on a V1 class priced at 2 here
  // and 12 there.
  const economyForState = () => (
    (state.classId && DATA.economyByClassId[state.classId]) || DATA.economyWhenClassless
  );
```

Rewrite `getMerxBudget` (`:736-743`). Advent's per-mission bonus is the same mission income the server derives, so it applies to every economy rather than to advent alone — a V1 character created with mission history has earned that Merx too, and `validateEconomyLimits` will price it that way.

```js
  // Budget = the economy's creation grant plus mission income, the same two
  // terms deriveMerxBreakdown adds (util/character-derived.js). The server
  // enforces this number for V1 economies, so a disagreement here is a build
  // the player can assemble and not save.
  const getMerxBudget = () => {
    const economy = economyForState();
    let successful = parseInt(state.successfulMissions, 10) || 0;
    if (successful < 0) successful = 0;
    return ECONOMY.grants[economy] + (successful * DATA.merxPerMissionSuccess);
  };
```

Replace every use of the deleted cost constants in `getShopPool` (`:2467-2545`) and `addCustomCommonItem` (`:2693-2710`) with `ECONOMY.prices.signature.own`, `.cross` and `ECONOMY.prices.commonItem`, selecting the tier by whether the item's `origin_class_id` matches `state.classId` — except under `aspiring`, which is always own-class per pg. 90.

Replace `effectiveFreeBaseCount()` with a read of the served grant's shape: an economy has free base gear only when the server gives it free items, which after Task 1 is advent alone with three.

```js
  // Advent's three Default Signatures (pg. 3), which arrive free. Every other
  // economy replaced them with a Merx grant, so there is nothing free to load.
  // The figure is the server's: util/character-derived.js ADVENT_DEFAULT_SIGNATURES
  // decides the same count when it prices a saved character.
  const freeBaseCount = () => (economyForState() === 'advent' ? DATA.adventDefaultSignatures : 0);
```

This needs one more served figure. Add `adventDefaultSignatures` to `wizardData` in `routes/characters.js`, exported from `util/character-derived.js` for the purpose, and extend Task 2's route test to pin it:

```js
test('the advent Default count is served, not retyped', async () => {
  const data = await renderWizardData({ mode: 'advent' });
  expect(data.adventDefaultSignatures)
    .toBe(require('../util/character-derived').ADVENT_DEFAULT_SIGNATURES);
});
```

- [ ] **Step 4: Point the stat figures at the served copy**

`getStatCap` (`:827-833`) and `getTotalPoints` (`:849-852`) keep their arithmetic — the client has to compute a cap interactively and `util/stat-caps.js` is CommonJS — but read `STAT_FIGURES` instead of local constants. The rule stays mirrored; the figures no longer are.

Then correct `util/stat-caps.js:145-150`, which currently says nothing serves this module to the browser. That stops being true here, and a false comment is a defect under Global Constraints:

```js
// getStatCap in public/js/character-wizard.js mirrors this function's
// arithmetic, because a wizard recomputes a cap as the player types and this
// module is CommonJS. It no longer mirrors the figures: routes/characters.js
// serves statCapFigures() on wizardData and the client reads them. What is
// still unpinned is the rule itself -- the client's copy ignores capPurchases,
// which is correct only because no creation surface can buy one.
```

- [ ] **Step 5: Run the tests**

Run: `bun run test:unit`, `bun run test:http`
Expected: `test:unit` exit 0, including the grep test; `test:http` at its one known failure.

- [ ] **Step 6: Commit**

```bash
git add public/js/character-wizard.js routes/characters.js util/character-derived.js util/stat-caps.js test/character-wizard-client.test.js routes/characters-wizard-data.test.js
git commit -m "fix: read every wizard figure from the server and delete the copies"
```

---

## Task 4: all twelve Signatures reach the wizard

`routes/characters.js` slices each class's gear to six before serving it, and takes the *first* six. The grant affords six, which is why the cap never looked wrong; choosing which six is the player's to make.

**Files:**
- Modify: `routes/characters.js:251-283` (the `class_gear` / `base_gear` slices in the `wizardClasses` map)
- Test: `routes/characters-wizard-data.test.js`

`ADVENT_DEFAULT_SIGNATURES` is already required in this file — Task 3 exported it and added it to `wizardData`. If it is not, that task was left incomplete; finish it rather than adding a literal `3` here.

**Interfaces:**
- Consumes: Task 2's `wizardClasses` shape.
- Produces: `wizardData.classes[].class_gear` carrying every item the class has, each with `column`, `position`, `default_enchantment` and `subtype`. Tasks 5-7 render from it.

- [ ] **Step 1: Write the failing tests**

```js
test('a V1 class serves all twelve of its Signatures', async () => {
  const data = await renderWizardData({
    mode: 'aspirant',
    classes: [{ id: 'c-v1', content_format: 'aspirant', gear: twelveItems() }]
  });
  expect(data.classes[0].class_gear).toHaveLength(12);
});

test('each served Signature keeps its printed position and its Default', async () => {
  const data = await renderWizardData({
    mode: 'aspirant',
    classes: [{ id: 'c-v1', content_format: 'aspirant', gear: twelveItems() }]
  });
  const first = data.classes[0].class_gear[0];
  expect(first).toMatchObject({ column: 1, position: 1 });
  expect(first.default_enchantment).toMatchObject({ name: expect.any(String) });
});

test('the served order is the printed order', async () => {
  const data = await renderWizardData({
    mode: 'aspirant',
    classes: [{ id: 'c-v1', content_format: 'aspirant', gear: twelveItems() }]
  });
  const keys = data.classes[0].class_gear.map((g) => `${g.column}.${g.position}`);
  expect(keys).toEqual([...keys].sort((a, b) => {
    const [ac, ap] = a.split('.').map(Number);
    const [bc, bp] = b.split('.').map(Number);
    return ac - bc || ap - bp;
  }));
});

test('advent still gets exactly three free Default Signatures', async () => {
  const data = await renderWizardData({
    mode: 'advent',
    classes: [{ id: 'c-advent', content_format: 'advent', gear: sixItems() }]
  });
  expect(data.classes[0].base_gear).toHaveLength(3);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun run test:http`
Expected: FAIL — `class_gear` has 6 entries, and `column`/`position`/`default_enchantment` are absent from the served shape.

- [ ] **Step 3: Serve the whole list**

Replace the `class_gear` mapping. The old comment explaining the six-item slice describes behaviour that is being removed, so it goes with it.

```js
      // Every Signature the class carries, in printed order. A V1 class has
      // twelve across four columns; an Advent class has six. The player chooses
      // which to buy, so the route no longer decides for them by taking the
      // first six. `column` and `position` come from the class contract
      // (util/class-gear.js) and are layout facts, not economy ones -- nothing
      // gates a purchase on a column (see the spec, "Two things the book does
      // not say").
      class_gear: Array.isArray(c.gear)
        ? c.gear.map((g, idx) => ({
            name: g.name || '',
            description_html: renderMarkdown(g.description || ''),
            meters: Array.isArray(g.meters) ? g.meters : [],
            column: g.column || null,
            position: g.position || null,
            default_enchantment: g.default_enchantment || null,
            subtype: idx < ADVENT_DEFAULT_SIGNATURES ? 'base' : 'elective'
          }))
        : [],
```

`base_gear` keeps its three-item slice — it is advent's free Defaults and Task 1 fixed the figure — but reads the constant rather than a literal:

```js
      base_gear: Array.isArray(c.gear)
        ? c.gear.slice(0, ADVENT_DEFAULT_SIGNATURES).map((g) => ({
            name: g.name || '',
            description_html: renderMarkdown(g.description || '')
          }))
        : [],
```

- [ ] **Step 4: Check the classic form's copy of the same rule**

`views/partials/character-class-gear.handlebars` labels rows `{{#if (lt @index 3)}}Base{{else}}Elective{{/if}}` — a fourth copy of the Default count. Pass `adventDefaultSignatures` into that partial's context and compare against it, or, if the partial has no route context to reach, record the deferral in your report and name this line. Do not leave a bare `3` without saying so.

- [ ] **Step 5: Run the tests**

Run: `bun run test:unit`, `bun run test:http`
Expected: `test:unit` exit 0; `test:http` at its one known failure.

- [ ] **Step 6: Commit**

```bash
git add routes/characters.js routes/characters-wizard-data.test.js views/partials/character-class-gear.handlebars
git commit -m "feat: serve every Signature a class carries, in printed order"
```

---

## Task 5: the Signature entry component

One component, mounted by the wizard, the edit form and (read-only) the character page. It owns rendering a printed entry and pricing a purchase; it owns no application state and performs no I/O.

`public/js/character-wizard.js` is 3,453 lines. Putting this there would make the largest file in the project larger and make the edit form unable to reach it. A separate IIFE is the codebase's established shape for shared browser code (`public/js/character-common.js`).

**Files:**
- Create: `public/js/signature-entry.js`
- Test: `test/signature-entry.test.js`

**Interfaces:**
- Consumes: `DATA.economy` from Task 2 (passed in as `figures`; the component never reads a global).
- Produces: `window.SignatureEntry` with

```js
SignatureEntry.render(entry, purchase, { figures, crossClass, economy, readOnly }) // -> HTML string
SignatureEntry.priceOf(purchase, { figures, crossClass })                          // -> number
SignatureEntry.slotsOf(purchase)                                                   // -> number
SignatureEntry.totalOf(purchases, { figures, economy, characterClassId })          // -> number
```

where `entry` is a served `class_gear` element (`{ name, description_html, meters, column, position, default_enchantment }`) and `purchase` is `{ owned, class_id, enchantment, mods }` with `enchantment` one of `null`, `{ source: 'default' }`, `{ source: 'custom', name, description }` and `mods` an array of `{ name, description }`.

- [ ] **Step 1: Write the failing tests**

Create `test/signature-entry.test.js`. Boot the IIFE the way `test/character-wizard-client.test.js:105-129` does — read that file first and match its recipe.

```js
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { economyFigures, equipmentSpend } = require('../util/merx-economy');

const SOURCE = fs.readFileSync('public/js/signature-entry.js', 'utf8');
const boot = () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  new Function(SOURCE)();
  return dom.window.SignatureEntry;
};

const FIGURES = economyFigures();
const entry = {
  name: 'Cowboy Hat',
  description_html: '<p>Provides Ward against sun and glare <sup>M</sup></p>',
  meters: [{ label: 'Ammunition', value: 'Mid' }],
  column: 1,
  position: 1,
  default_enchantment: { name: 'Hats Off to You', description: 'Portray a Turning Point.' }
};

describe('priceOf', () => {
  const SE = boot();
  test('a bare Signature costs its own-class price', () => {
    expect(SE.priceOf({ owned: true, enchantment: null, mods: [] }, { figures: FIGURES }))
      .toBe(FIGURES.prices.signature.own);
  });
  test('cross-class is the +1 tier throughout', () => {
    const purchase = {
      owned: true,
      enchantment: { source: 'custom', name: 'X', description: 'y' },
      mods: [{ name: 'Scope', description: 'z' }, { name: 'Sling', description: 'w' }]
    };
    expect(SE.priceOf(purchase, { figures: FIGURES, crossClass: true }))
      .toBe(FIGURES.prices.signature.cross
          + FIGURES.prices.customEnchantment.cross
          + FIGURES.prices.mod.cross[0] + FIGURES.prices.mod.cross[1]);
  });
  test('an unowned Signature costs nothing', () => {
    expect(SE.priceOf({ owned: false, enchantment: { source: 'default' }, mods: [] },
                      { figures: FIGURES })).toBe(0);
  });
  test('the second Mod costs more than the first', () => {
    expect(FIGURES.prices.mod.own[1]).toBeGreaterThan(FIGURES.prices.mod.own[0]);
  });
});

describe('slotsOf (pg. 8)', () => {
  const SE = boot();
  test('a bare Signature is one slot', () => {
    expect(SE.slotsOf({ owned: true, enchantment: null, mods: [] })).toBe(1);
  });
  test('an Enchantment costs a slot of its own', () => {
    expect(SE.slotsOf({ owned: true, enchantment: { source: 'default' }, mods: [] })).toBe(2);
  });
  test('Mods cost no slots', () => {
    expect(SE.slotsOf({ owned: true, enchantment: null, mods: [{ name: 'a' }, { name: 'b' }] }))
      .toBe(1);
  });
});

// The one test that stops the client and the server drifting apart. The
// component prices a list; util/merx-economy.js prices the same list; they
// must agree for every shape the UI can produce.
describe('the component agrees with the server it cannot require', () => {
  const SE = boot();
  const CLASS_ID = 'own-class';
  const shapes = [
    { name: 'A', class_id: CLASS_ID, enchantment: null, mods: [] },
    { name: 'B', class_id: CLASS_ID, enchantment: { source: 'default' }, mods: [] },
    { name: 'C', class_id: CLASS_ID, enchantment: { source: 'custom', name: 'n', description: 'd' }, mods: [] },
    { name: 'D', class_id: CLASS_ID, enchantment: null, mods: [{ name: 'm1' }] },
    { name: 'E', class_id: CLASS_ID, enchantment: { source: 'default' }, mods: [{ name: 'm1' }, { name: 'm2' }] },
    { name: 'F', class_id: 'other-class', enchantment: { source: 'custom', name: 'n', description: 'd' }, mods: [{ name: 'm1' }, { name: 'm2' }] }
  ];

  for (const economy of ['aspirant', 'aspiring']) {
    test(`${economy}: every subset prices identically on both sides`, () => {
      for (let mask = 1; mask < (1 << shapes.length); mask++) {
        const list = shapes.filter((_, i) => mask & (1 << i));
        const purchases = list.map((g) => ({ ...g, owned: true }));
        expect(SE.totalOf(purchases, { figures: FIGURES, economy, characterClassId: CLASS_ID }))
          .toBe(equipmentSpend(list, { economy, characterClassId: CLASS_ID }));
      }
    });
  }

  test('the served Mod price table is as long as the served Mod limit', () => {
    expect(FIGURES.prices.mod.own).toHaveLength(FIGURES.modsPerSignature);
    expect(FIGURES.prices.mod.cross).toHaveLength(FIGURES.modsPerSignature);
  });
});

describe('render', () => {
  const SE = boot();
  test('shows the printed entry: name, description, meters, Default and its text', () => {
    const html = SE.render(entry, { owned: false, enchantment: null, mods: [] },
                           { figures: FIGURES, economy: 'aspirant' });
    expect(html).toContain('Cowboy Hat');
    expect(html).toContain('Provides Ward');
    expect(html).toContain('Ammunition');
    expect(html).toContain('Default Enchantment');
    expect(html).toContain('Hats Off to You');
    expect(html).toContain('Portray a Turning Point.');
  });

  test('a Signature with no Default offers only Custom', () => {
    const html = SE.render({ ...entry, default_enchantment: null },
                           { owned: true, enchantment: null, mods: [] },
                           { figures: FIGURES, economy: 'aspirant' });
    expect(html).not.toContain('Default Enchantment');
    expect(html).toContain('Custom');
  });

  test('prices come from the figures, never from the markup', () => {
    const html = SE.render(entry, { owned: false, enchantment: null, mods: [] },
                           { figures: { ...FIGURES, prices: { ...FIGURES.prices, signature: { own: 99, cross: 100 } } },
                             economy: 'aspirant' });
    expect(html).toContain('99');
  });

  test('readOnly renders what was bought and no controls', () => {
    const html = SE.render(entry, { owned: true, enchantment: { source: 'default' }, mods: [{ name: 'Scope' }] },
                           { figures: FIGURES, economy: 'aspirant', readOnly: true });
    expect(html).toContain('Hats Off to You');
    expect(html).toContain('Scope');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<button');
  });

  test('player-authored text is escaped, class-authored HTML is not', () => {
    const html = SE.render(entry,
      { owned: true, enchantment: { source: 'custom', name: '<img src=x onerror=alert(1)>', description: 'd' }, mods: [] },
      { figures: FIGURES, economy: 'aspirant' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
    expect(html).toContain('<p>Provides Ward');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun run test:unit`
Expected: FAIL — the file does not exist.

- [ ] **Step 3: Write the component**

Create `public/js/signature-entry.js`. Model the markup on the book's entry: name, description, meters right-packed, the Default Enchantment divider, then the enchantment's name and text, then the controls.

Two rules the tests pin and the implementation must respect:

- **`description_html` and the Default Enchantment's text are class-authored** and already rendered by `renderMarkdown` on the server, so they are inserted as HTML. **Everything the player typed** — a Custom Enchantment's name and description, a Mod's name and description — is escaped. Mixing these up is a stored-XSS bug.
- **No figure is written into the markup.** Every price shown comes from `figures`.

```js
(function () {
  'use strict';

  var escapeHtml = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  var tier = function (crossClass) { return crossClass ? 'cross' : 'own'; };

  // Mirrors util/merx-economy.js equipmentSpend for one item. The two are
  // pinned to each other by test/signature-entry.test.js, which prices every
  // shape on both sides; the arithmetic lives twice because a browser cannot
  // require CommonJS and a wizard must reprice as the player clicks.
  var priceOf = function (purchase, opts) {
    if (!purchase || !purchase.owned) return 0;
    var figures = opts.figures;
    var t = tier(opts.crossClass);
    var total = figures.prices.signature[t];
    var enchantment = purchase.enchantment || null;
    if (enchantment && enchantment.source === 'default') total += figures.prices.defaultEnchantment[t];
    if (enchantment && enchantment.source === 'custom') total += figures.prices.customEnchantment[t];
    var mods = Array.isArray(purchase.mods) ? purchase.mods : [];
    for (var i = 0; i < mods.length; i++) {
      var price = figures.prices.mod[t][i];
      total += (typeof price === 'number' ? price : 0);
    }
    return total;
  };

  // pg. 8: an Enchantment occupies a Signature slot of its own; Mods occupy none.
  var slotsOf = function (purchase) {
    if (!purchase || !purchase.owned) return 0;
    return 1 + (purchase.enchantment ? 1 : 0);
  };

  // pg. 90: an aspiring character's picks are treated as its own Class's, so it
  // never pays the surcharge. Same rule as util/merx-economy.js isCrossClass.
  var isCrossClass = function (purchase, opts) {
    if (opts.economy === 'aspiring') return false;
    return !!opts.characterClassId && !!purchase.class_id
      && purchase.class_id !== opts.characterClassId;
  };

  var totalOf = function (purchases, opts) {
    var list = Array.isArray(purchases) ? purchases : [];
    var total = 0;
    for (var i = 0; i < list.length; i++) {
      total += priceOf(list[i], {
        figures: opts.figures,
        crossClass: isCrossClass(list[i], opts)
      });
    }
    return total;
  };

  var render = function (entry, purchase, opts) { /* defined in Step 4 below */ };

  window.SignatureEntry = {
    render: render, priceOf: priceOf, slotsOf: slotsOf, totalOf: totalOf, isCrossClass: isCrossClass
  };
})();
```

- [ ] **Step 4: Write `render`**

Build the string in the order the book prints it. Keep it a pure function of its three arguments — it must not read `DATA`, `document`, or any global, because the character page mounts it server-side-rendered and the tests mount it with no wizard present.

```js
  var metersHtml = function (meters) {
    var list = Array.isArray(meters) ? meters : [];
    if (!list.length) return '';
    var rows = list.map(function (m) {
      return '<div class="entry-meter"><span class="entry-meter-label">' + escapeHtml(m.label)
        + '</span> <span class="entry-meter-value">' + escapeHtml(m.value) + '</span></div>';
    }).join('');
    return '<div class="entry-meters">' + rows + '</div>';
  };

  var enchantmentSection = function (entry, purchase, opts) {
    var figures = opts.figures;
    var t = tier(opts.crossClass);
    var hasDefault = !!(entry.default_enchantment && entry.default_enchantment.name);
    var chosen = (purchase && purchase.enchantment) || null;
    var parts = [];

    if (hasDefault) {
      parts.push('<div class="entry-divider">Default Enchantment</div>');
      parts.push('<div class="entry-enchantment-name">'
        + escapeHtml(entry.default_enchantment.name) + '</div>');
      parts.push('<div class="entry-enchantment-text">'
        + (entry.default_enchantment.description_html
           || escapeHtml(entry.default_enchantment.description || '')) + '</div>');
    }
    if (opts.readOnly) {
      if (chosen && chosen.source === 'custom') {
        parts.push('<div class="entry-divider">Custom Enchantment</div>');
        parts.push('<div class="entry-enchantment-name">' + escapeHtml(chosen.name) + '</div>');
        parts.push('<div class="entry-enchantment-text">' + escapeHtml(chosen.description) + '</div>');
      }
      return parts.join('');
    }

    parts.push('<div class="entry-controls">');
    parts.push(radio('none', 'None', !chosen, null));
    if (hasDefault) {
      parts.push(radio('default', 'Default', chosen && chosen.source === 'default',
                       figures.prices.defaultEnchantment[t]));
    }
    parts.push(radio('custom', 'Custom', chosen && chosen.source === 'custom',
                     figures.prices.customEnchantment[t]));
    if (chosen && chosen.source === 'custom') {
      parts.push(customFields(chosen, figures));
    }
    parts.push('</div>');
    return parts.join('');
  };
```

The three helpers `enchantmentSection` leans on. Note `priceTag` is the only
place a price becomes text, so there is one thing to audit:

```js
  var priceTag = function (price) {
    return price == null ? '' : ' <span class="entry-price">' + price + 'm</span>';
  };

  var radio = function (value, label, checked, price) {
    return '<label class="entry-option">'
      + '<input type="radio" name="enchantment" value="' + value + '"'
      + (checked ? ' checked' : '') + '>'
      + ' ' + escapeHtml(label) + priceTag(price)
      + '</label>';
  };

  // The word counter is an aid, not a gate: util/merx-economy.js
  // countWordsExcludingRatings is the authority and the save rejects an
  // over-long Custom. Counting here too means the player finds out while
  // typing rather than at submit.
  var countWords = function (text) {
    var stripped = String(text || '').replace(/<sup>[\s\S]*?<\/sup>/g, ' ');
    return stripped.split(/\s+/).filter(function (token) {
      return /[A-Za-z0-9]/.test(token);
    }).length;
  };

  var customFields = function (chosen, figures) {
    var used = countWords(chosen.description);
    var over = used > figures.enchantmentWordLimit;
    return '<div class="entry-custom">'
      + '<input type="text" data-custom-name value="' + escapeHtml(chosen.name) + '"'
      + ' placeholder="Name it, for easy reference during play">'
      + '<textarea data-custom-description>' + escapeHtml(chosen.description) + '</textarea>'
      + '<div class="entry-wordcount' + (over ? ' is-over' : '') + '">'
      + used + ' / ' + figures.enchantmentWordLimit + ' words</div>'
      + '</div>';
  };

  // pg. 87: up to two Mods, the second costing more. The slot count and the
  // price table both come from the figures and are pinned to each other by
  // test/signature-entry.test.js.
  var modRows = function (purchase, opts) {
    var figures = opts.figures;
    var t = tier(opts.crossClass);
    var mods = Array.isArray(purchase.mods) ? purchase.mods : [];
    var rows = [];
    for (var i = 0; i < figures.modsPerSignature; i++) {
      var mod = mods[i] || null;
      rows.push('<div class="entry-mod" data-mod-index="' + i + '">'
        + '<input type="text" data-mod-name value="' + escapeHtml(mod && mod.name) + '"'
        + ' placeholder="Mod ' + (i + 1) + '">'
        + '<input type="text" data-mod-description value="'
        + escapeHtml(mod && mod.description) + '"'
        + ' placeholder="' + figures.modWordLimit + ' words or fewer">'
        + priceTag(figures.prices.mod[t][i])
        + '</div>');
    }
    return '<div class="entry-mods">' + rows.join('') + '</div>';
  };
```

`render` itself is then the book's order: name, description, meters,
`enchantmentSection(...)`, `modRows(...)` when the Signature is owned and the
surface is not `readOnly`.

- [ ] **Step 5: Run the tests**

Run: `bun run test:unit`
Expected: PASS, exit 0. The cross-check block runs 63 subsets × 2 economies; if any disagree, fix the component, never the expectation.

- [ ] **Step 6: Commit**

```bash
git add public/js/signature-entry.js test/signature-entry.test.js
git commit -m "feat: add the Signature entry component and pin it to the server's pricing"
```

---

## Task 6: the wizard mounts the drawer

Step 4 becomes the printed grid plus the entry drawer. The grid lists the character's own class's Signatures in printed order; opening one reveals the entry and its controls. Cross-class Signatures keep the existing search and class filter, at the +1 tier.

**Files:**
- Modify: `public/js/character-wizard.js:2443-2971` (the step 4 section)
- Modify: `views/character-wizard.handlebars:278-345` (step 4 panel), `:404-405` (script tags)
- Test: `test/character-wizard-client.test.js`

**Interfaces:**
- Consumes: `window.SignatureEntry` from Task 5; `ECONOMY`, `economyForState()` from Task 3; `class_gear` from Task 4.
- Produces: `state.gear` entries carrying `{ name, class_id, enchantment, mods }`. Task 7 serialises them.

- [ ] **Step 1: Load the component before the wizard**

In `views/character-wizard.handlebars`, add `<script defer src="/js/signature-entry.js"></script>` **above** the wizard's own tag, matching how `character-common.js` is loaded. The wizard's IIFE reads `window.SignatureEntry` at mount time, not at parse time, but load order should still be obvious to a reader.

- [ ] **Step 2: Write the failing tests**

```js
describe('step 4 offers the whole class and its purchases', () => {
  test('the grid lists every Signature the class carries, in printed order', () => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    wizard.renderGearStep();
    const names = [...document.querySelectorAll('[data-signature-name]')]
      .map((el) => el.getAttribute('data-signature-name'));
    expect(names).toHaveLength(12);
    expect(names[0]).toBe('Cowboy Hat');
  });

  test('buying a Signature and its Default spends both prices', () => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    wizard.buySignature('Cowboy Hat');
    wizard.setEnchantment('Cowboy Hat', { source: 'default' });
    const figures = require('../util/merx-economy').economyFigures();
    expect(wizard.getMerxSpent())
      .toBe(figures.prices.signature.own + figures.prices.defaultEnchantment.own);
  });

  test('an enchanted Signature uses two of the twelve slots', () => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    wizard.buySignature('Cowboy Hat');
    wizard.setEnchantment('Cowboy Hat', { source: 'default' });
    expect(wizard.getSlotsUsed()).toBe(2);
  });

  test('a purchase that would breach the budget is refused', () => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    for (const name of twelveNames()) wizard.buySignature(name);
    expect(wizard.getMerxSpent()).toBeLessThanOrEqual(wizard.getMerxBudget());
  });

  test('a cross-class Signature is priced at the +1 tier', () => {
    const wizard = bootWizard(fixture({
      mode: 'aspirant', classes: [v1Class(), otherV1Class()]
    }));
    wizard.getState().classId = 'c-v1';
    wizard.buySignature('Sharps Rifle', 'c-other');
    expect(wizard.getMerxSpent())
      .toBe(require('../util/merx-economy').economyFigures().prices.signature.cross);
  });

  test('an aspiring pick is own-class priced despite its origin (pg. 90)', () => {
    const wizard = bootWizard(fixture({ mode: 'aspiring', economyWhenClassless: 'aspiring' }));
    seedAspiringPicks(wizard, ['Cowboy Hat']);
    wizard.buySignature('Cowboy Hat', 'c-v1');
    expect(wizard.getMerxSpent())
      .toBe(require('../util/merx-economy').economyFigures().prices.signature.own);
  });

  test('an advent character sees no Enchantment controls', () => {
    const wizard = bootWizard(fixture({ mode: 'advent', classes: [adventClass()] }));
    wizard.getState().classId = 'c-advent';
    wizard.renderGearStep();
    expect(document.body.innerHTML).not.toContain('Default Enchantment');
  });
});
```

Expose `renderGearStep`, `buySignature`, `setEnchantment`, `getMerxSpent` and `getSlotsUsed` on the returned handle so these are reachable.

- [ ] **Step 3: Run them and confirm they fail**

Run: `bun run test:unit`
Expected: FAIL.

- [ ] **Step 4: Rebuild the step 4 render**

`renderGearStep` (`:2716-2930`) keeps its structure — string concatenation into `innerHTML`, tab filtering, the search box — and changes what it lists:

- For a V1 economy, the own-class pool is the served `class_gear` in printed order, rendered as the grid; each grid cell opens `SignatureEntry.render(...)` into the drawer element.
- `getShopPool` (`:2467-2545`) keeps serving the cross-class and common-item tabs, with `cost` read from `ECONOMY.prices` rather than the deleted constants (done in Task 3).
- The budget readout writes `getMerxSpent()` / `getMerxBudget()` into `#merxSpent` / `#merxBudget`, and a new `#slotsUsed` / `#slotsCap` pair, hidden when `ECONOMY.signatureCap[economy]` is `null`.
- `syncBaseGear` (`:2932-2968`) keeps loading advent's free Defaults, now via `freeBaseCount()`.

`getMerxSpent` replaces `computeMerxSpent` (`:2553-2570`) and delegates:

```js
  // Priced by the shared component, which test/signature-entry.test.js pins to
  // util/merx-economy.js equipmentSpend for every shape this can produce.
  const getMerxSpent = () => SignatureEntry.totalOf(state.gear, {
    figures: ECONOMY,
    economy: economyForState(),
    characterClassId: state.classId
  }) + (state.commonItems.length * ECONOMY.prices.commonItem);
```

- [ ] **Step 5: Run the tests**

Run: `bun run test:unit`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add public/js/character-wizard.js views/character-wizard.handlebars test/character-wizard-client.test.js
git commit -m "feat: offer every Signature and its Enchantment and Mods in the wizard"
```

---

## Task 7: the payload carries the purchases

`serializePayload` sends `gear: [{ name, class_id }]` and `commissary_reward: 0`. Everything bought in Task 6 is currently discarded at submit.

**Files:**
- Modify: `public/js/character-wizard.js:3228-3337` (`serializePayload`), `:3253` (`commissary_reward`), `:3292-3299` (gear)
- Test: `test/character-wizard-client.test.js`, `services/character/input.test.js`

**Interfaces:**
- Consumes: `state.gear` from Task 6.
- Produces: gear payload entries `{ name, class_id, enchantment, mods }` — the shape `normalizeGearEquipment` (`services/character/input.js:400-409`) already reads.

- [ ] **Step 1: Write the failing tests**

```js
test('the payload carries each Signature\'s Enchantment and Mods', () => {
  const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
  wizard.getState().classId = 'c-v1';
  wizard.buySignature('Cowboy Hat');
  wizard.setEnchantment('Cowboy Hat', { source: 'default' });
  wizard.addMod('Cowboy Hat', { name: 'Scope', description: 'Sees far' });
  const [item] = wizard.buildSubmitPayload().gear;
  expect(item).toMatchObject({
    name: 'Cowboy Hat',
    class_id: 'c-v1',
    enchantment: { source: 'default' },
    mods: [{ name: 'Scope', description: 'Sees far' }]
  });
});

test('a Default Enchantment submits no copy of the class\'s text', () => {
  const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
  wizard.getState().classId = 'c-v1';
  wizard.buySignature('Cowboy Hat');
  wizard.setEnchantment('Cowboy Hat', { source: 'default' });
  const [item] = wizard.buildSubmitPayload().gear;
  expect(item.enchantment).toEqual({ source: 'default' });
  expect(item.enchantment.name).toBeUndefined();
  expect(item.enchantment.description).toBeUndefined();
});

test('an unenchanted Signature submits an explicit null, not an absent key', () => {
  const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
  wizard.getState().classId = 'c-v1';
  wizard.buySignature('Cowboy Hat');
  const [item] = wizard.buildSubmitPayload().gear;
  expect('enchantment' in item).toBe(true);
  expect(item.enchantment).toBeNull();
});

test('commissary_reward is no longer hardcoded to zero', () => {
  const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
  wizard.getState().classId = 'c-v1';
  wizard.buySignature('Cowboy Hat');
  const payload = wizard.buildSubmitPayload();
  expect(payload.commissary_reward).toBe(wizard.getMerxBudget() - wizard.getMerxSpent());
});

test('an advent payload is unchanged in shape', () => {
  const wizard = bootWizard(fixture({ mode: 'advent', classes: [adventClass()] }));
  wizard.getState().classId = 'c-advent';
  const [item] = wizard.buildSubmitPayload().gear;
  expect(item.enchantment).toBeNull();
  expect(item.mods).toEqual([]);
});
```

The explicit-`null` assertion matters: the wizard creates a character, so there is nothing stored to keep, and sending `null` states the intent the RPC understands. The edit form in Task 10 is where absence means "keep".

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun run test:unit`
Expected: FAIL.

- [ ] **Step 3: Serialise the purchases**

```js
      // Each Signature carries what was bought on it. `enchantment: null` is
      // explicit rather than omitted: absence means "keep what is stored" to
      // save_character_atomic, and a character being created has nothing
      // stored to keep, so saying null states the intent rather than relying
      // on an empty row. A Default submits only its source -- the name and
      // description live on the class and mergeClassItems attaches them at
      // read time (services/character/repository.js:31-36), so copying them
      // here would store a second copy that a class edit could not reach.
      gear: state.gear.map((g) => ({
        name: g.name,
        class_id: g.origin_class_id || state.classId,
        enchantment: g.enchantment || null,
        mods: Array.isArray(g.mods) ? g.mods : []
      })),
```

And the reward (`:3253`):

```js
      // What the character did not spend. The server recomputes this for V1
      // economies in CharacterService.createCharacter, so this is the client's
      // agreeing figure rather than the authority -- but it must agree, or the
      // player is shown one number and stored another.
      commissary_reward: Math.max(0, getMerxBudget() - getMerxSpent()),
```

- [ ] **Step 4: Prove the server accepts it end to end**

Add to `services/character/input.test.js` a case that runs a wizard-shaped payload with equipment through `normalizeWizardPayload` and asserts the equipment survives normalisation, and one over-budget payload that `validateEconomyLimits` refuses with an error naming the spend and the budget.

- [ ] **Step 5: Run everything**

Run: `bun run test:unit`, `bun run test:http`
Expected: `test:unit` exit 0; `test:http` at its one known failure.

- [ ] **Step 6: Commit**

```bash
git add public/js/character-wizard.js test/character-wizard-client.test.js services/character/input.test.js
git commit -m "feat: submit each Signature's Enchantment, Mods and the unspent Merx"
```

---

## Task 8: Merx may be saved for later

Ruling 4. `renderGearStep:2917-2923` disables Next until the whole budget is spent, for advent and aspiring. pg. 3 says the opposite.

**Files:**
- Modify: `public/js/character-wizard.js:2902-2923`
- Test: `test/character-wizard-client.test.js`

**Interfaces:**
- Consumes: `getMerxSpent`, `getMerxBudget`.
- Produces: no new interface; the Next button's enablement rule changes.

- [ ] **Step 1: Write the failing tests**

```js
test.each(['advent', 'aspirant', 'aspiring'])(
  '%s may leave step 4 with Merx unspent (pg. 3)', (mode) => {
    const wizard = bootWizard(fixture({ mode, classes: [classFor(mode)] }));
    wizard.getState().classId = classFor(mode).id;
    wizard.renderGearStep();
    expect(document.querySelector('[data-wizard-next]').disabled).toBe(false);
  }
);

test('the remainder is shown as saved, not as an error', () => {
  const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
  wizard.getState().classId = 'c-v1';
  wizard.renderGearStep();
  expect(document.body.textContent).toContain('saved');
});

test('over-budget is still impossible: the purchase is refused', () => {
  const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
  wizard.getState().classId = 'c-v1';
  for (const name of twelveNames()) {
    wizard.buySignature(name);
    wizard.setEnchantment(name, { source: 'custom', name: 'x', description: 'y' });
  }
  expect(wizard.getMerxSpent()).toBeLessThanOrEqual(wizard.getMerxBudget());
});

test('a purchase that would breach the Signature Cap is refused', () => {
  const wizard = bootWizard(fixture({ mode: 'aspiring', economyWhenClassless: 'aspiring' }));
  const cap = require('../util/merx-economy').economyFigures().signatureCap.aspiring;
  seedAspiringPicks(wizard, twelveNames());
  for (const name of twelveNames()) wizard.buySignature(name, 'c-v1');
  expect(wizard.getSlotsUsed()).toBeLessThanOrEqual(cap);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun run test:unit`
Expected: FAIL on the advent and aspiring cases — Next is disabled.

- [ ] **Step 3: Delete the gate and say where the Merx goes**

Remove the spend-it-all condition. Replace it with the remainder line, and keep the two refusals — budget and cap — on the *add*, where they already live.

```js
    // pg. 3: 12 Merx "may be spent however they like or save for later". The
    // wizard used to block Next until the budget was exhausted, which made
    // commissary_reward always zero at creation and contradicted the book.
    // Over-budget is prevented where a purchase is made, not here.
```

- [ ] **Step 4: Run the tests**

Run: `bun run test:unit`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add public/js/character-wizard.js test/character-wizard-client.test.js
git commit -m "fix: let a character finish creation with Merx in hand"
```

---

## Task 9: replacing a purchased Signature warns first

Ruling 5. A rename is a delete plus an insert (see the spec's "Storage"), so changing a Signature that carries an Enchantment or Mods destroys them. The destruction is inherent; the guard is a warning.

**Files:**
- Modify: `public/js/character-wizard.js` (the grid's deselect path), `public/js/signature-entry.js` (the summary of what is at stake)
- Test: `test/signature-entry.test.js`, `test/character-wizard-client.test.js`

**Interfaces:**
- Consumes: `SignatureEntry.priceOf`.
- Produces: `SignatureEntry.describePurchase(purchase, { figures, crossClass })` returning `{ total, lines }` — `lines` being human-readable strings like `'Default Enchantment  2m'`. The edit form reuses it in Task 10.

- [ ] **Step 1: Write the failing tests**

```js
test('describePurchase names what a replacement would destroy', () => {
  const SE = boot();
  const described = SE.describePurchase({
    owned: true,
    enchantment: { source: 'default' },
    mods: [{ name: 'Scope', description: 'Sees far' }]
  }, { figures: FIGURES });
  expect(described.total)
    .toBe(FIGURES.prices.defaultEnchantment.own + FIGURES.prices.mod.own[0]);
  expect(described.lines).toEqual([
    'Default Enchantment  ' + FIGURES.prices.defaultEnchantment.own + 'm',
    'Mod: Scope  ' + FIGURES.prices.mod.own[0] + 'm'
  ]);
});

test('a bare Signature has nothing to lose', () => {
  const SE = boot();
  expect(SE.describePurchase({ owned: true, enchantment: null, mods: [] }, { figures: FIGURES }))
    .toEqual({ total: 0, lines: [] });
});

test('removing a bare Signature asks nothing', () => {
  const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
  wizard.getState().classId = 'c-v1';
  wizard.buySignature('Cowboy Hat');
  wizard.removeSignature('Cowboy Hat');
  expect(wizard.getPendingConfirmation()).toBeNull();
  expect(wizard.getState().gear).toHaveLength(0);
});

test('removing a purchased Signature asks first and keeps it until confirmed', () => {
  const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
  wizard.getState().classId = 'c-v1';
  wizard.buySignature('Cowboy Hat');
  wizard.setEnchantment('Cowboy Hat', { source: 'default' });
  wizard.removeSignature('Cowboy Hat');
  expect(wizard.getPendingConfirmation().lines).toContain(
    'Default Enchantment  ' + FIGURES.prices.defaultEnchantment.own + 'm');
  expect(wizard.getState().gear).toHaveLength(1);
  wizard.confirmPending();
  expect(wizard.getState().gear).toHaveLength(0);
});

test('cancelling leaves the purchase intact', () => {
  const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
  wizard.getState().classId = 'c-v1';
  wizard.buySignature('Cowboy Hat');
  wizard.setEnchantment('Cowboy Hat', { source: 'default' });
  wizard.removeSignature('Cowboy Hat');
  wizard.cancelPending();
  expect(wizard.getState().gear[0].enchantment).toEqual({ source: 'default' });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun run test:unit`
Expected: FAIL — neither function exists.

- [ ] **Step 3: Implement both halves**

`describePurchase` in the component, built from the same figures as `priceOf` so the sum it reports and the Merx returned to the budget cannot disagree. The confirmation itself is wizard state — `state.pendingRemoval` — rendered as a dialog and resolved by `confirmPending` / `cancelPending`. The removal is applied only on confirm.

- [ ] **Step 4: Run the tests**

Run: `bun run test:unit`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add public/js/signature-entry.js public/js/character-wizard.js test/signature-entry.test.js test/character-wizard-client.test.js
git commit -m "feat: confirm before a replacement discards a paid Enchantment"
```

---

## Task 10: the edit form buys too

The same component, mounted post-creation, against the real budget of grant plus mission income. This is the surface the spec requires because the book puts these purchases "including during character creation" — creation being one occasion among others.

**Files:**
- Modify: `views/character-form.handlebars:238-249`, `views/partials/character-class-gear.handlebars`
- Modify: `routes/characters.js:454-497` (the edit GET render), `:1056` (the PUT)
- Create: `public/js/character-gear-purchases.js` — the edit form's thin mount for `SignatureEntry`
- Test: `test/character-gear-purchases.test.js`, `views/character-form.test.js`, `routes/characters.js`'s existing route tests

**Interfaces:**
- Consumes: `window.SignatureEntry`; `validateEconomyLimits({ ..., storedGear, enforceMerxBudget })`.
- Produces: form submission carrying the same gear shape as Task 7, with one difference stated below.

- [ ] **Step 1: Decide and record what an untouched row submits**

On this surface **absence means keep**. A row the player did not open must submit no `enchantment` key at all, so `save_character_atomic` preserves what is stored — that contract exists for exactly this form (plan 1, Task 6). A row the player *did* edit submits its key, including an explicit `null` to un-enchant.

Write this down as a comment beside the serialiser before writing it, and as the first test:

```js
test('an untouched row submits no enchantment key, so the save keeps it', () => {
  const form = mountPurchases(fixtureCharacter({
    gear: [{ name: 'Cowboy Hat', class_id: 'c-v1', enchantment: { source: 'default' }, mods: [] }]
  }));
  const [item] = form.serialize().gear;
  expect('enchantment' in item).toBe(false);
});

test('un-enchanting submits an explicit null', () => {
  const form = mountPurchases(fixtureCharacter({
    gear: [{ name: 'Cowboy Hat', class_id: 'c-v1', enchantment: { source: 'default' }, mods: [] }]
  }));
  form.setEnchantment('Cowboy Hat', null);
  const [item] = form.serialize().gear;
  expect(item.enchantment).toBeNull();
});
```

- [ ] **Step 2: Write the rest of the failing tests**

```js
test('the budget is the grant plus mission income', () => {
  const form = mountPurchases(fixtureCharacter({ successfulMissions: 2 }));
  const figures = require('../util/merx-economy').economyFigures();
  expect(form.getBudget()).toBe(figures.grants.aspirant + 2);
});

test('an advent character sees today\'s form, with no purchase controls', () => {
  const html = renderCharacterForm(fixtureCharacter({ contentFormat: 'advent' }));
  expect(html).not.toContain('data-signature-name');
  expect(html).toContain('name="gear[]"');
});

test('a V1 character sees the grid', () => {
  const html = renderCharacterForm(fixtureCharacter({ contentFormat: 'aspirant' }));
  expect(html).toContain('data-signature-name');
});

test('replacing a purchased Signature warns here too', () => {
  const form = mountPurchases(fixtureCharacter({
    gear: [{ name: 'Cowboy Hat', class_id: 'c-v1', enchantment: { source: 'default' }, mods: [] }]
  }));
  form.removeSignature('Cowboy Hat');
  expect(form.getPendingConfirmation().lines.length).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `bun run test:unit`, `bun run test:http`
Expected: FAIL.

- [ ] **Step 4: Serve the drawer's data to the edit form**

The edit GET (`routes/characters.js:454-497`) already loads the character and its class. Add the same JSON island the wizard uses — `economyFigures()`, the resolved economy for **this** character (computed with `economyFor`, not guessed), the class's `class_gear`, and the character's current purchases — and render it only for V1 economies. Keep the existing `gear[]` selects for everything else; they are what 327 advent characters use.

- [ ] **Step 5: Mount, and enforce on the way back in**

`public/js/character-gear-purchases.js` is a thin IIFE: read the island, render the grid and drawer with `SignatureEntry`, keep the absent/null distinction from Step 1, and write the result into the form before submit.

On the PUT path, confirm the existing `validateEconomyLimits` call passes `storedGear` and the character's earned Merx so the cap is counted against what the save will leave. If `enforceMerxBudget` is currently `false` on that path, it must become `true` now that a surface can spend — check `routes/characters.js:1056` and `services/character/service.js` before changing it, and say in your report which you found.

- [ ] **Step 6: Run everything**

Run: `bun run test:unit`, `bun run test:http`, `bun run test:integration`
Expected: unit exit 0; http and integration at their known baselines and no worse.

- [ ] **Step 7: Commit**

```bash
git add views/character-form.handlebars views/partials/character-class-gear.handlebars routes/characters.js public/js/character-gear-purchases.js test/character-gear-purchases.test.js views/character-form.test.js
git commit -m "feat: let a character spend earned Merx from the edit form"
```

---

## Task 11: the character page shows what was bought

**Files:**
- Create: `views/partials/signature-entry.handlebars` (read-only twin of the component)
- Modify: `views/character.handlebars:76` (the Commissary Reward line), `:258-267` (gear), `views/partials/character-details.handlebars:36-42`
- Modify: `routes/characters.js:984-1023`, `:886` (the details fragment)
- Test: `views/character.test.js` or the nearest existing view test, `routes/characters.js`'s detail route tests

**Interfaces:**
- Consumes: `deriveMerxBreakdown`'s `{ earned, spend, reward, deficit }`.
- Produces: no JS interface; this surface is server-rendered.

- [ ] **Step 1: Write the failing tests**

```js
test('a Signature shows its Enchantment and Mods', () => {
  const html = renderCharacterPage(fixtureCharacter({
    gear: [{ name: 'Cowboy Hat', enchantment: { source: 'default' },
             mods: [{ name: 'Scope', description: 'Sees far' }] }]
  }));
  expect(html).toContain('Hats Off to You');
  expect(html).toContain('Scope');
});

test('a V1 character shows the Merx breakdown, not one bare number', () => {
  const html = renderCharacterPage(fixtureCharacter({ contentFormat: 'aspirant' }));
  expect(html).toContain('Earned');
  expect(html).toContain('Spent');
  expect(html).toContain('Remaining');
});

test('an advent character keeps its single Commissary Reward line', () => {
  const html = renderCharacterPage(fixtureCharacter({ contentFormat: 'advent' }));
  expect(html).toContain('Commissary Reward');
  expect(html).not.toContain('Earned');
});

test('a player-authored Custom Enchantment is escaped', () => {
  const html = renderCharacterPage(fixtureCharacter({
    gear: [{ name: 'Cowboy Hat',
             enchantment: { source: 'custom', name: '<script>x</script>', description: 'd' },
             mods: [] }]
  }));
  expect(html).not.toContain('<script>x');
});

test('the details fragment matches the full page', () => {
  const character = fixtureCharacter({ gear: [enchantedItem()] });
  expect(renderDetailsFragment(character)).toContain('Hats Off to You');
});
```

The last one matters: `views/partials/character-details.handlebars` is a second render of the same data and slice 5 shipped a fix for exactly this kind of divergence (`ad019e3`).

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun run test:unit`
Expected: FAIL.

- [ ] **Step 3: Render it**

`mergeClassItems` (`services/character/repository.js:31-36`) already attaches the class's Default Enchantment text at read time, so a `{ source: 'default' }` row has its name and description available without a second query. Confirm that before writing the template; if it does not, say so rather than adding a query.

Both the page and the fragment use the new partial, so the two cannot drift.

- [ ] **Step 4: Run the tests**

Run: `bun run test:unit`, `bun run test:http`
Expected: unit exit 0; http at its one known failure.

- [ ] **Step 5: Commit**

```bash
git add views/partials/signature-entry.handlebars views/character.handlebars views/partials/character-details.handlebars routes/characters.js views/character.test.js
git commit -m "feat: show a character's Enchantments, Mods and Merx breakdown"
```

---

## Task 12: the last copies of the figures

Six literal Merx figures survive in the wizard view as prose, and `#merxBudget` holds a Handlebars ternary of the three budgets that JS immediately overwrites.

**Files:**
- Modify: `views/character-wizard.handlebars:59`, `:282`, `:284`, `:286`, `:303`, `:329`
- Test: `views/character-wizard.test.js` (create if absent)

**Interfaces:** none.

- [ ] **Step 1: Write the failing test**

A figure printed to a player only exists after the template renders, so assert
against the rendered output. Compile the template with the project's real
helpers the way `views/character-form.test.js` does — read that file first and
match its setup.

```js
const fs = require('fs');

test('the wizard view source writes down no Merx price', () => {
  const source = fs.readFileSync('views/character-wizard.handlebars', 'utf8');
  const prose = source.replace(/<script[\s\S]*?<\/script>/g, '');
  expect(prose).not.toMatch(/\d+\s*Merx/i);
});

test.each(['advent', 'aspirant', 'aspiring'])(
  'the rendered %s wizard prints no budget of its own', (mode) => {
    const html = renderWizardView({ mode, wizardData: fixture({ mode }) });
    const body = html.replace(/<script[\s\S]*?<\/script>/g, '');
    expect(body).not.toMatch(/\d+\s*Merx/i);
    // The client fills this on first render from the served grant. An empty
    // span is honest about where the figure comes from; a hardcoded one is a
    // second copy that can disagree with the server.
    expect(body).toMatch(/<span id="merxBudget">\s*<\/span>/);
  }
);
```

The old form of this test scanned raw Handlebars for `>2<` and could neither
see the ternary it was aimed at — which reads `{{else}}2{{/if}}</span>` in
source — nor avoid matching unrelated markup. Do not reinstate it.

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test:unit`
Expected: FAIL, naming the prose figures.

- [ ] **Step 3: Remove them**

Each price in prose becomes a span the client fills from `ECONOMY`, or the sentence is rewritten to name no number. `#merxBudget`'s ternary default becomes empty — the client writes it on first render, and an empty span is honest about where the figure comes from where a wrong hardcoded one is not.

- [ ] **Step 4: Run the tests**

Run: `bun run test:unit`, `bun run test:http`
Expected: unit exit 0; http at its one known failure.

- [ ] **Step 5: Commit**

```bash
git add views/character-wizard.handlebars views/character-wizard.test.js
git commit -m "fix: stop printing Merx prices in the wizard's prose"
```

---

## Task 13: the journey, end to end

The spec's e2e: "buy a Default Enchantment, replace it with a Custom, add two Mods, and watch the cap arithmetic; then assert an over-budget save is refused."

**Files:**
- Create: `e2e/specs/28-aspirant-v1-merx-purchases.spec.js`
- Test: itself

**Interfaces:** none.

- [ ] **Step 1: Read the two nearest specs first**

`e2e/specs/19-character-wizard-crud.spec.js` and `e2e/specs/26-aspiring-wizard.spec.js`. Match their fixture and auth setup; do not invent a new one.

- [ ] **Step 2: Write the spec**

One test walking the journey: create a V1 character, open a Signature, buy it, unlock its Default, watch spend and slots rise by the served figures, swap the Default for a Custom and watch the price change, add two Mods and watch the second cost more than the first, then assemble a build that exceeds the budget and assert the save is refused with the server's message.

A second test: replace a purchased Signature and assert the confirmation names the Enchantment before it is destroyed.

- [ ] **Step 3: Run it**

Run: `bun run test:e2e -- 28-aspirant-v1-merx-purchases`
Expected: PASS. `e2e/specs/27-aspirant-v1-class-page.spec.js` must keep passing untouched — this slice changes characters, not class pages.

- [ ] **Step 4: Run every tier one last time**

```bash
bun run test:unit && bun run test:http; bun run test:integration; bun run test:e2e
```

Expected: unit exit 0; http at its single known `open-graph` failure; integration at its three known red files; e2e green apart from any pre-existing failures you recorded in Task 1 Step 1.

- [ ] **Step 5: Commit**

```bash
git add e2e/specs/28-aspirant-v1-merx-purchases.spec.js
git commit -m "test: walk the Merx purchase journey end to end"
```

---

## Success criteria

Check each against the code, not against a report.

1. No economy or stat figure appears in `public/js/`, in any `.handlebars` file, or in a route — verified by grep for each name and for `/\d+\s*Merx/`.
2. `util/merx-economy.js` and `util/stat-caps.js` are the only definitions, and `economyFigures()` / `statCapFigures()` are built by calling their own functions rather than restating tables.
3. The client's pricing agrees with `equipmentSpend` for every shape the UI can produce — pinned by the subset cross-check in `test/signature-entry.test.js`.
4. Advent's Elective costs exactly 2 whichever of its three routes it takes, and no fresh advent character is reported in deficit.
5. The wizard's economy follows the selected class, and `?mode=advent` on a V1 class offers the aspirant budget, cap and prices.
6. All twelve of a V1 class's Signatures are offerable, in printed order, and the player chooses which.
7. A Default Enchantment stores `{ source: 'default' }` and no copy of the class's text.
8. An untouched gear row on the edit form submits no `enchantment` key and the stored purchase survives the save — proven against the RPC, not only the JS reconciler.
9. Replacing a Signature carrying purchases confirms first and names them.
10. A character may finish creation with Merx unspent, and that remainder is its `commissary_reward`.
11. Over-budget and over-cap builds are refused by the client at purchase time and by the server at save time.
12. All 327 existing characters still load, render and save. Row counts: characters 327, traits 981, class_gear 1492, class_abilities 916, classes 62.

## Deliberately not in this plan

- **The Perk economy** — Advanced Ability unlocks at 2 Perks, Cross-Classing at 3 and 4, the six-Ability cap, and the Compounded mechanic Aspirant defers to Advent (pg. 7). Slice 4b, which has no spec yet and must not invent them.
- **Stat Training's purchase surface** (pg. 87). Slice 5 modelled and derived it; the buy surface needs this plan's budget plumbing, so it becomes possible after this lands but is not built here.
- **Flavor** (pp. 104-110) and therefore refunds and Trait swapping. The book's only refund path, needing a purchase history this design deliberately does not keep.
- **Verifying that a purchased Stat Cap was paid for** — slice 5's recorded hole. It belongs with Stat Training's surface.
- **Loadout and encumbrance** (pg. 88), **Companions as a Signature subtype** (pp. 8, 89), **High-Stakes mission Merx** (pg. 97), the **pg. 2 Advent conversion**.
- **Budget enforcement for Advent characters.** Task 1 corrects advent's derivation; it does not start validating advent, and 327 rows were built with no budget applied.
- **"Never stronger than the Default"** (pg. 86) — a judgment the book gives the playgroup, with no approval machinery in the app to hang it on.
