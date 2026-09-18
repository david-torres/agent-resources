# Aspirant V1 Merx Economy — Foundation (plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Merx equipment economy real on the server — one module owning every price, a balance derived from what a character owns, storage for Enchantments and Mods, and enforcement — without changing any purchase UI.

**Architecture:** `util/merx-economy.js` becomes the single definition of every figure ENCLAVE: Aspirant V1 prints, replacing copies currently spread across the wizard client, `util/character-derived.js`, `util/enclave-consts.js` and the wizard view. `deriveMerxBreakdown` gains an `economy` argument resolved by one named function from the character's class `content_format` and its `creator_mode`, and branches three ways. Two jsonb columns on `class_gear` hold a character's Enchantment and Mods, carried through both reconciliation paths with preserve-on-absent semantics. Plan 2 builds the purchase surfaces on top.

**Tech Stack:** Bun, `bun:test`, Express 4, express-handlebars, Supabase/Postgres (local only), poppler for book quotes. `util/` is CommonJS; `scripts/` is ESM; `public/js/` is browser IIFEs.

**Spec:** `docs/superpowers/specs/2026-09-18-aspirant-v1-merx-equipment-economy-design.md`

## Global Constraints

- **Prices come from the book, verbatim (pg. 85).** Common Item 1. Signature 2 own / 3 cross. Unlock the Default Enchantment 2 own / 3 cross. Create a Custom Enchantment 3 own / 4 cross. Create a Mod 1-then-2 own / 2-then-3 cross. Cross-Class is uniformly +1 at every tier.
- **Grants and caps (pp. 3, 8, 85, 90, 92).** Grant 12 Merx aspirant / 10 aspiring. Signature Cap 12 aspirant / 8 aspiring. Ability cap 6 aspirant / 4 aspiring. One Enchantment per Signature; at most 2 Mods per Signature; Mods do not count against the Signature Cap; an Enchantment does.
- **Word limits.** Custom Enchantment ≤ 40 words "minus Power Rating Superscripts" (pg. 86); Mod ≤ 10 words (pg. 87). A rating is a `<sup>…</sup>` span in stored content and is stripped before counting.
- **Every constant and rule must be mutation-pinned.** Moving any price, grant, cap or limit must fail a named test. A test that passes with the constant changed is not a test.
- **No second copy of any figure.** When this plan moves a constant into `util/merx-economy.js`, the old definition is **deleted** in the same commit. No fallbacks, no shadowing, no deprecation path.
- **Comments describe the code as it is now.** No history, no "was X now Y". A comment that states a number or a census must be true of the code beside it — three rounds of slice 3 shipped false comments, so verify each claim before writing it.
- **Database safety.** `.env` is hand-switched between the local stack and **LIVE PRODUCTION**. Before anything that writes, run `eval "$(supabase status -o env)"` and assert `http://127.0.0.1:54321`. **Never run `supabase db reset`** — the local database holds a restored production copy. Apply migrations with `supabase migration up` only.
- **`bun run test:unit` is always safe** (it scrubs `SUPABASE_URL`). `bun test <file>` directly does not get those overrides.
- **A new `*.integration.test.js` file is invisible until registered** in the `integrationFiles` set at `scripts/run-tests.mjs:7-22`. Adding the file without the registration silently runs it in the unit tier against no database.
- **Advent characters do not change.** All 327 existing characters are in the `advent` branch: 318 with `creator_mode` NULL, 9 `advent`, zero `aspirant`, zero `aspiring`. Any change to their derived figures is a defect.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `util/merx-economy.js` | **New.** Every price, grant, cap and word limit; `economyFor`, `priceOfSignature`, `priceOfEnchantment`, `priceOfMod`, `equipmentSpend`, `signatureSlotsUsed`, `countWordsExcludingRatings`. Pure, no requires. |
| `util/merx-economy.test.js` | **New.** The price table as data, every figure mutation-pinned. |
| `util/character-derived.js` | Consumes the module; `deriveMerxBreakdown` branches on `economy`; local cost constants deleted. |
| `util/character-derived.test.js` | Extended: the deficit regression, the advent-unchanged guard, the aspiring branch. |
| `util/enclave-consts.js` | `STARTING_ON_CLASS_GEAR_ALLOTMENT` moves out; `MERX_PER_MISSION_SUCCESS` stays. |
| `util/reconcile.js` | `diffChildRows` compares object-valued fields by value, not identity. |
| `util/reconcile.test.js` | Extended: a jsonb field that is deep-equal produces no update. |
| `services/character/service.js` | `reconcileGear` carries `enchantment`/`mods`; the two `deriveCharacterTotals` call sites pass the economy. |
| `services/character/input.js` | Normalises and validates a character's enchantment/mod payload; enforces budget and caps. |
| `services/character/input.test.js` | Extended: every rejection case. |
| `routes/characters.js` | The two auto-calc call sites pass the economy. |
| `public/js/character-wizard.js` | Grants Core abilities, not Advanced. |
| `views/character-wizard.handlebars` | The false cross-class price copy corrected. |
| `supabase/migrations/20260918000000_class_gear_enchantment_mods.sql` | **New.** The two columns. |
| `supabase/migrations/20260918000001_save_character_atomic_gear_equipment.sql` | **New.** The RPC carries both columns, preserve-on-absent. |
| `util/character-equipment.integration.test.js` | **New.** The columns exist with the right constraints, against real rows. |
| `models/character-atomic.integration.test.js` | Extended: the columns survive an omitting save; a renamed Signature keeps its Enchantment. |

---

### Task 1: Stop granting Advanced Abilities in place of Core ones

The highest-severity item in the spec and independent of everything else: a character created in aspirant mode on a V1 class today receives that class's three **Advanced** Abilities, tagged `advanced`, and none of its Core ones. The branch was unreachable until slice 3's load — no class had a non-empty `advanced_abilities` — and the twelve V1 forks are the only classes that do.

The book: "In addition to their three Core Abilities, ... unlocking an Advanced Ability from your own Class costs 2 Perks" (pg. 7). A character starts with one Perk, so nothing is lost by not granting them here; buying them is plan 4b's job.

**Files:**
- Modify: `public/js/character-wizard.js:3228-3258`
- Modify: `routes/character-wizard-classes.test.js` (add a source assertion beside the existing ones)
- Test: `routes/character-wizard.test.js` (add a behavioural http-tier case)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks consume. The payload shape is unchanged — `abilities: [{ name, class_id, type }]` — only which list fills it.

- [ ] **Step 1: Read the two blocks you are changing**

```bash
sed -n '3228,3260p' public/js/character-wizard.js
```

You will see a comment block ending `Aspiring is class-less: ...`, then an `if (DATA.mode === 'aspiring') { ... } else { ... }`. The `else` branch is the one to fix. The comment block is part of the defect: it states the aspirant behaviour this task removes, so it becomes false the moment the code changes.

- [ ] **Step 2: Write the failing behavioural test**

Add to `routes/character-wizard.test.js`. This test asserts the server contract the fixed client must satisfy: a wizard submit for a V1 class stores three abilities, all `core`, drawn from the class's `abilities` list — not its `advanced_abilities`.

Match the file's existing harness (mocked data layer, real Express app, a captured create call). Read the top 60 lines of that file first and follow its `makeClient`/`capture` conventions rather than inventing new ones.

```js
test('a wizard submit for an Aspirant V1 class stores its three Core abilities as core', async () => {
  const res = await postWizard({
    name: 'Core Only',
    class_id: V1_CLASS_ID,
    creator_mode: 'aspirant',
    abilities: [
      { name: 'Phantasm', class_id: V1_CLASS_ID, type: 'core' },
      { name: 'Mirror Walk', class_id: V1_CLASS_ID, type: 'core' },
      { name: 'Veil', class_id: V1_CLASS_ID, type: 'core' }
    ]
  });
  expect(res.status).toBe(200);
  expect(captured.abilities.map((a) => a.name).sort())
    .toEqual(['Mirror Walk', 'Phantasm', 'Veil']);
  expect(captured.abilities.every((a) => a.type === 'core')).toBe(true);
});
```

Then add the client-side guard to `routes/character-wizard-classes.test.js`, beside the existing `wizardPanelSource()` assertions — that file already reads the wizard source as text for exactly this kind of check (`:190-192`):

```js
test('the wizard grants a class its Core abilities, never its Advanced ones', () => {
  const src = wizardPanelSource();
  // The payload builder must not choose between the two lists: an Advanced
  // Ability costs 2 Perks (ENCLAVE: Aspirant V1, pg. 7) and is never free.
  expect(src).not.toContain('useAdvanced');
  expect(src).toContain("type: 'core'");
});
```

- [ ] **Step 3: Run both tests to verify they fail**

```bash
bun run test:unit 2>&1 | grep -A3 "character-wizard"
```

Expected: the source assertion FAILS on `not.toContain('useAdvanced')` (the identifier is present at `public/js/character-wizard.js:3250`). The http-tier test may pass already if the harness lets you post an explicit ability list — that is fine and expected; it is a contract guard, not a red. **Say so in your report if it passes on first run** rather than claiming a red you did not see.

- [ ] **Step 4: Fix the code**

Replace the `else` branch. The exact current text:

```js
    } else {
      const useAdvanced = !!(c && DATA.mode === 'aspirant' && Array.isArray(c.advanced_abilities));
      const abilityList = useAdvanced ? c.advanced_abilities : (c && c.abilities);
      if (c && Array.isArray(abilityList) && abilityList.length) {
        payload.abilities = abilityList
          .map((a) => (a && a.name
            ? { name: a.name, class_id: state.classId, type: useAdvanced ? 'advanced' : 'core' }
            : null))
          .filter(Boolean);
      }
    }
```

with:

```js
    } else {
      const abilityList = c && c.abilities;
      if (c && Array.isArray(abilityList) && abilityList.length) {
        payload.abilities = abilityList
          .map((a) => (a && a.name
            ? { name: a.name, class_id: state.classId, type: 'core' }
            : null))
          .filter(Boolean);
      }
    }
```

- [ ] **Step 5: Correct the comment above it**

The existing comment block says advent and aspiring use `abilities` while "aspirant uses `advanced_abilities` (the same list shown in step 3)". Replace that sentence — and only that sentence — so the block reads:

```js
    // Class abilities: the chosen class's three Core Abilities are auto-granted
    // to the character. Advanced Abilities are not: one costs 2 Perks
    // (ENCLAVE: Aspirant V1, pg. 7), and a new character has a single Perk.
    // Step 3 shows a class's Advanced roster as a primer; showing it is not
    // granting it. We send them as {name, class_id, type} so the server's
    // normalizeAbilityItems + setCharacterAbilities writes rows into
    // public.class_abilities. `type` must be explicit on every row: an absent
    // one means "keep whatever is stored" to the reconcile path, not 'core'.
    // Aspiring is class-less: abilities come from state.classBuild.coreAbilities
    // + .advancedAbility, each potentially from a different unlocked class.
```

Leave the aspiring paragraph and the `type`-must-be-explicit paragraph exactly as they are — both are still true.

- [ ] **Step 6: Confirm nothing else reads the removed identifier**

```bash
grep -n "useAdvanced" public/js/character-wizard.js
```

Expected: no output. If the identifier appears elsewhere, stop and report it — it means the primer at `:1413` shares the flag and this task's scope was wrong.

- [ ] **Step 7: Run the suites**

```bash
bun run test:unit
bun run check
```

Expected: unit green (174 files at last count), `check` exit 0.

- [ ] **Step 8: Commit**

```bash
git add public/js/character-wizard.js routes/character-wizard.test.js routes/character-wizard-classes.test.js
git commit -m "fix: grant a class's Core abilities, never its Advanced ones"
```

---

### Task 2: The economy module

One file holding every figure the book prints, so the wizard, the derivation and the view stop each keeping their own copy. Pure: no `require`, no I/O, no database.

**Files:**
- Create: `util/merx-economy.js`
- Test: `util/merx-economy.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces, all named exports:
  - `economyFor({ contentFormat, creatorMode }) -> 'advent' | 'aspirant' | 'aspiring'`
  - `priceOfSignature({ crossClass }) -> number`
  - `priceOfEnchantment({ source, crossClass }) -> number` — `source` is `'default' | 'custom' | null`
  - `priceOfMod({ index, crossClass }) -> number` — `index` is **0-based**: the first Mod on a Signature is `index: 0`
  - `equipmentSpend(gear, { economy, characterClassId }) -> number`
  - `signatureSlotsUsed(gear) -> number`
  - `countWordsExcludingRatings(text) -> number`
  - `COMMON_ITEM_PRICE`, `CREATION_GRANT`, `SIGNATURE_CAP`, `ABILITY_CAP`, `MODS_PER_SIGNATURE`, `ENCHANTMENT_WORD_LIMIT`, `MOD_WORD_LIMIT`

- [ ] **Step 1: Write the failing test**

Create `util/merx-economy.test.js`. The price table is data so a reviewer can compare it against the book at a glance, and so a changed price fails one named case rather than a heap of them.

```js
// Every figure here is quoted from ENCLAVE: Aspirant V1 at the printed page
// named. The book is the authority; this file is the fixture that holds the
// implementation to it. util/merx-economy.js must never be the only place a
// number appears -- if these two disagree, the book decides.
const { test, expect } = require('bun:test');
const {
  economyFor,
  priceOfSignature,
  priceOfEnchantment,
  priceOfMod,
  equipmentSpend,
  signatureSlotsUsed,
  countWordsExcludingRatings,
  COMMON_ITEM_PRICE,
  CREATION_GRANT,
  SIGNATURE_CAP,
  ABILITY_CAP,
  MODS_PER_SIGNATURE,
  ENCHANTMENT_WORD_LIMIT,
  MOD_WORD_LIMIT
} = require('./merx-economy');

// pg. 85, "Spending Merx". Cross-Class is uniformly +1 at every tier.
const PRICES = [
  ['own Signature',              () => priceOfSignature({ crossClass: false }),                        2],
  ['cross-class Signature',      () => priceOfSignature({ crossClass: true }),                         3],
  ['own Default Enchantment',    () => priceOfEnchantment({ source: 'default', crossClass: false }),   2],
  ['cross Default Enchantment',  () => priceOfEnchantment({ source: 'default', crossClass: true }),    3],
  ['own Custom Enchantment',     () => priceOfEnchantment({ source: 'custom', crossClass: false }),    3],
  ['cross Custom Enchantment',   () => priceOfEnchantment({ source: 'custom', crossClass: true }),     4],
  ['own first Mod',              () => priceOfMod({ index: 0, crossClass: false }),                    1],
  ['own second Mod',             () => priceOfMod({ index: 1, crossClass: false }),                    2],
  ['cross first Mod',            () => priceOfMod({ index: 0, crossClass: true }),                     2],
  ['cross second Mod',           () => priceOfMod({ index: 1, crossClass: true }),                     3]
];

for (const [label, priced, expected] of PRICES) {
  test(`pg. 85 prices a ${label} at ${expected} Merx`, () => {
    expect(priced()).toBe(expected);
  });
}

test('a Common Item costs 1 Merx (pg. 85)', () => {
  expect(COMMON_ITEM_PRICE).toBe(1);
});

test('an unenchanted Signature is priced with no enchantment component', () => {
  expect(priceOfEnchantment({ source: null, crossClass: false })).toBe(0);
});

test('grants are 12 Merx for a V1 class and 10 for aspiring (pp. 3, 90)', () => {
  expect(CREATION_GRANT.aspirant).toBe(12);
  expect(CREATION_GRANT.aspiring).toBe(10);
  expect(CREATION_GRANT.advent).toBe(0);
});

test('caps are 12/8 Signatures and 6/4 Abilities (pp. 85, 92)', () => {
  expect(SIGNATURE_CAP.aspirant).toBe(12);
  expect(SIGNATURE_CAP.aspiring).toBe(8);
  expect(ABILITY_CAP.aspirant).toBe(6);
  expect(ABILITY_CAP.aspiring).toBe(4);
});

test('a Signature holds at most two Mods (pg. 87)', () => {
  expect(MODS_PER_SIGNATURE).toBe(2);
});

test('word limits are 40 for a Custom Enchantment and 10 for a Mod (pp. 86, 87)', () => {
  expect(ENCHANTMENT_WORD_LIMIT).toBe(40);
  expect(MOD_WORD_LIMIT).toBe(10);
});

// pg. 8: "they count towards the Signature Cap of 12. This means that a
// character with six Enchanted Signatures could not bring any other
// Signatures onto a given mission." Mods "do not count towards the
// Signature cap."
test('an enchanted Signature uses two cap slots and an unenchanted one uses one', () => {
  expect(signatureSlotsUsed([{ name: 'A' }])).toBe(1);
  expect(signatureSlotsUsed([{ name: 'A', enchantment: { source: 'default' } }])).toBe(2);
});

test('six enchanted Signatures fill the cap of twelve exactly', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({
    name: `S${i}`, enchantment: { source: 'default' }
  }));
  expect(signatureSlotsUsed(six)).toBe(SIGNATURE_CAP.aspirant);
});

test('Mods never consume a cap slot', () => {
  expect(signatureSlotsUsed([{ name: 'A', mods: [{ name: 'm1' }, { name: 'm2' }] }])).toBe(1);
});

// pg. 86: "no more than 40 words long, minus Power Rating Superscripts".
test('a Power Rating superscript is not a word', () => {
  expect(countWordsExcludingRatings('Boosted <sup>L–H</sup> against magic')).toBe(3);
});

test('an empty or absent description counts zero words', () => {
  expect(countWordsExcludingRatings('')).toBe(0);
  expect(countWordsExcludingRatings(null)).toBe(0);
});

// pg. 90: an aspiring character's picks "are treated as belonging to your
// Class for the purposes of acquisition and improvement", so no surcharge.
test('aspiring prices every Signature own-class regardless of its class_id', () => {
  const gear = [
    { name: 'A', class_id: 'class-a' },
    { name: 'B', class_id: 'class-b' },
    { name: 'C', class_id: 'class-c' }
  ];
  expect(equipmentSpend(gear, { economy: 'aspiring', characterClassId: null })).toBe(6);
});

test('aspirant charges the cross-class surcharge on another class Signature', () => {
  const gear = [
    { name: 'A', class_id: 'mine' },
    { name: 'B', class_id: 'theirs' }
  ];
  expect(equipmentSpend(gear, { economy: 'aspirant', characterClassId: 'mine' })).toBe(5);
});

test('equipmentSpend adds a Signature, its Enchantment and both its Mods', () => {
  const gear = [{
    name: 'Wizarding Hat',
    class_id: 'mine',
    enchantment: { source: 'custom' },
    mods: [{ name: 'Lined' }, { name: 'Weighted' }]
  }];
  // 2 Signature + 3 Custom Enchantment + 1 first Mod + 2 second Mod
  expect(equipmentSpend(gear, { economy: 'aspirant', characterClassId: 'mine' })).toBe(8);
});

// The axis is content_format, not rules_edition: the six pre-release Aspirant
// classes are rules_edition 'aspirant' with content_format 'advent'.
test('economyFor reads content_format, and creator_mode only for aspiring', () => {
  expect(economyFor({ contentFormat: 'aspirant', creatorMode: 'aspirant' })).toBe('aspirant');
  expect(economyFor({ contentFormat: 'aspirant', creatorMode: null })).toBe('aspirant');
  expect(economyFor({ contentFormat: 'advent', creatorMode: 'aspirant' })).toBe('advent');
  expect(economyFor({ contentFormat: 'advent', creatorMode: 'advent' })).toBe('advent');
  expect(economyFor({})).toBe('advent');
});

test('an aspiring character has no class to read, so creator_mode decides', () => {
  expect(economyFor({ contentFormat: null, creatorMode: 'aspiring' })).toBe('aspiring');
  expect(economyFor({ contentFormat: undefined, creatorMode: 'aspiring' })).toBe('aspiring');
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
bun test util/merx-economy.test.js
```
Expected: FAIL — `Cannot find module './merx-economy'`.

- [ ] **Step 3: Write the module**

Create `util/merx-economy.js`:

```js
// The Merx economy ENCLAVE: Aspirant V1 prints on page 85, with the grants,
// caps and word limits from pages 3, 8, 86, 87, 90 and 92.
//
// This is the only place these figures are written down. util/character-derived.js
// derives a character's spend from it and routes/characters.js serialises it into
// wizardData so the browser reads the same numbers instead of its own copy. The
// previous arrangement kept three copies -- the wizard's constants, the
// derivation's, and prose in the wizard view -- and one of them was already
// wrong about the cross-class price.
//
// Pure by design: no requires, no I/O. Every consumer passes what it knows.

// pg. 85. Cross-Class is uniformly +1 at every tier, but it is written out
// rather than expressed as `own + 1` so a future edition can break the pattern
// without a rewrite.
const SIGNATURE_PRICE = { own: 2, cross: 3 };
const DEFAULT_ENCHANTMENT_PRICE = { own: 2, cross: 3 };
const CUSTOM_ENCHANTMENT_PRICE = { own: 3, cross: 4 };
// "the second costing more" -- indexed by how many Mods the Signature already
// holds, so the first Mod reads index 0.
const MOD_PRICE = { own: [1, 2], cross: [2, 3] };
const COMMON_ITEM_PRICE = 1;

// pg. 3: "Instead of four Signature Items (three Default and one Elective),
// characters start with 12 Merx". pg. 90: aspiring starts with 10.
// Advent grants no Merx -- it grants the four Signatures the Aspirant rule
// replaces, which util/character-derived.js still honours for its own branch.
const CREATION_GRANT = { advent: 0, aspirant: 12, aspiring: 10 };

// pg. 85: "you can never bring more than 12 Signature Items on a mission".
// pg. 92: aspiring "Signature Cap is set at 8, and they may never have more
// than four total Abilities". Advent has no cap in the rules the app models,
// so null means "not capped" rather than zero.
const SIGNATURE_CAP = { advent: null, aspirant: 12, aspiring: 8 };
// pg. 7: "A character may never have more than six total Abilities, and this
// cap cannot be increased". Recorded here; enforced by the Perk slice, which
// is what can actually add an Ability.
const ABILITY_CAP = { advent: null, aspirant: 6, aspiring: 4 };

// pg. 87: "A given Signature may hold up to two Mods".
const MODS_PER_SIGNATURE = 2;
// pg. 86 and pg. 87.
const ENCHANTMENT_WORD_LIMIT = 40;
const MOD_WORD_LIMIT = 10;

const tier = (crossClass) => (crossClass ? 'cross' : 'own');

const priceOfSignature = ({ crossClass } = {}) => SIGNATURE_PRICE[tier(crossClass)];

const priceOfEnchantment = ({ source, crossClass } = {}) => {
    if (source === 'custom') return CUSTOM_ENCHANTMENT_PRICE[tier(crossClass)];
    if (source === 'default') return DEFAULT_ENCHANTMENT_PRICE[tier(crossClass)];
    return 0;
};

// `index` is 0-based: a Signature's first Mod is index 0. A Signature cannot
// hold more than MODS_PER_SIGNATURE, so an index past the table is priced 0
// rather than throwing -- the count is rejected by validation, and a pricing
// function that throws would turn a validation error into a 500.
const priceOfMod = ({ index, crossClass } = {}) => MOD_PRICE[tier(crossClass)][index] ?? 0;

// pg. 90: an aspiring character's chosen Signatures "are treated as belonging
// to your Class for the purposes of acquisition and improvement", so it never
// pays the surcharge. It also has no class_id to compare against, which would
// otherwise make every one of its items read as cross-class.
const isCrossClass = (item, { economy, characterClassId }) => {
    if (economy === 'aspiring') return false;
    return !!characterClassId && !!item.class_id && item.class_id !== characterClassId;
};

const modsOf = (item) => (Array.isArray(item.mods) ? item.mods : []);

const equipmentSpend = (gear, { economy, characterClassId } = {}) => {
    const items = Array.isArray(gear) ? gear.filter(Boolean) : [];
    return items.reduce((total, item) => {
        const crossClass = isCrossClass(item, { economy, characterClassId });
        const enchantment = item.enchantment || null;
        const mods = modsOf(item);
        const modSpend = mods.reduce(
            (sum, _mod, index) => sum + priceOfMod({ index, crossClass }), 0
        );
        return total
            + priceOfSignature({ crossClass })
            + priceOfEnchantment({ source: enchantment && enchantment.source, crossClass })
            + modSpend;
    }, 0);
};

// pg. 8: an Enchantment "counts towards the Signature Cap of 12", so an
// enchanted Signature occupies two slots; Mods "do not count towards the
// Signature cap" and occupy none.
const signatureSlotsUsed = (gear) => {
    const items = Array.isArray(gear) ? gear.filter(Boolean) : [];
    return items.reduce((slots, item) => slots + 1 + (item.enchantment ? 1 : 0), 0);
};

// pg. 86: a Custom Enchantment is "no more than 40 words long, minus Power
// Rating Superscripts". A rating is stored as a <sup> span -- the one tag
// util/markdown.js renderPowerRatings permits through -- so the spans come out
// before the words are counted.
const RATING_SPAN = /<sup>[\s\S]*?<\/sup>/g;

const countWordsExcludingRatings = (text) => {
    const stripped = String(text ?? '').replace(RATING_SPAN, ' ').trim();
    return stripped ? stripped.split(/\s+/).length : 0;
};

// Which economy a character is under. An aspiring character is class-less --
// services/character/input.js maps its pseudo_class onto characters.class --
// so there is no content_format to read and creator_mode is the only signal.
// Everything else reads content_format, which is the shape of the class's
// content. rules_edition is deliberately NOT consulted: the six pre-release
// Aspirant classes are rules_edition 'aspirant' with content_format 'advent'
// and are priced as Advent content, because that is the shape they carry.
const economyFor = ({ contentFormat, creatorMode } = {}) => {
    if (creatorMode === 'aspiring') return 'aspiring';
    return contentFormat === 'aspirant' ? 'aspirant' : 'advent';
};

module.exports = {
    economyFor,
    priceOfSignature,
    priceOfEnchantment,
    priceOfMod,
    equipmentSpend,
    signatureSlotsUsed,
    countWordsExcludingRatings,
    COMMON_ITEM_PRICE,
    CREATION_GRANT,
    SIGNATURE_CAP,
    ABILITY_CAP,
    MODS_PER_SIGNATURE,
    ENCHANTMENT_WORD_LIMIT,
    MOD_WORD_LIMIT
};
```

- [ ] **Step 4: Run it to verify it passes**

```bash
bun test util/merx-economy.test.js
```
Expected: PASS, 25 tests.

- [ ] **Step 5: Prove the tests have teeth**

Mutation-pin the figures. For each of the four mutations below, make the change, run the file, confirm the named failure, then revert:

| Mutation | Must fail |
| --- | --- |
| `SIGNATURE_PRICE.cross` 3 → 2 | `pg. 85 prices a cross-class Signature at 3 Merx` |
| `MOD_PRICE.own` `[1, 2]` → `[2, 2]` | `pg. 85 prices a own first Mod at 1 Merx` |
| `CREATION_GRANT.aspiring` 10 → 12 | `grants are 12 Merx for a V1 class and 10 for aspiring` |
| `signatureSlotsUsed` drops the `+ (item.enchantment ? 1 : 0)` term | `an enchanted Signature uses two cap slots…` **and** `six enchanted Signatures fill the cap of twelve exactly` |

Record the observed failure names in your report. A mutation that leaves the file green is a test to fix, not a mutation to skip.

- [ ] **Step 6: Commit**

```bash
git add util/merx-economy.js util/merx-economy.test.js
git commit -m "feat: express the Aspirant Merx economy once"
```

---

### Task 3: Derive a V1 character's balance from what it owns

`deriveMerxBreakdown` has no concept of a creation grant, so a V1 character holding its twelve own-class Signatures with no missions reports `spend: 16, deficit: 16` — eight Signatures past the four-item Advent allotment at 2 Merx each. This task gives it the three branches and deletes its local price constants in favour of Task 2's module.

**Files:**
- Modify: `util/character-derived.js:1-6,34-37,44-96`
- Modify: `util/enclave-consts.js` (remove `STARTING_ON_CLASS_GEAR_ALLOTMENT`'s export only if nothing else reads it — check first)
- Test: `util/character-derived.test.js`

**Interfaces:**
- Consumes: `equipmentSpend`, `COMMON_ITEM_PRICE`, `CREATION_GRANT` from `util/merx-economy.js` (Task 2).
- Produces:
  - `deriveMerxBreakdown({ realMissions, offscreenMissions, gear, commonItems, characterClassId, economy }) -> { earned, spend, reward, deficit }` — `economy` defaults to `'advent'`.
  - `deriveCharacterTotals({ character, realMissions, offscreenMissions, rulesVersion, economy })` — passes `economy` straight through.

- [ ] **Step 1: Check what else reads the allotment**

```bash
grep -rn "STARTING_ON_CLASS_GEAR_ALLOTMENT" --include="*.js" . | grep -v node_modules
```

The advent branch still needs it, so it stays defined. It stays in `util/enclave-consts.js` if anything outside `util/character-derived.js` reads it, and moves into `util/character-derived.js` beside the advent branch if nothing does. Decide from the grep output and say which in your report — do not leave it exported from two places.

- [ ] **Step 2: Write the failing tests**

Add to `util/character-derived.test.js`. Read its existing cases first and match their style. Three of these are regressions, and the first is the defect this task exists for.

```js
const { CREATION_GRANT } = require('./merx-economy');

const twelveOwn = (classId) => Array.from({ length: 12 }, (_, i) => ({
  name: `Signature ${i}`, class_id: classId
}));

// The defect: before the aspirant branch existed, this returned
// { spend: 16, deficit: 16 } -- eight Signatures past the Advent four-item
// allotment at 2 Merx each -- and any player who ticked auto-calculate on a
// freshly created V1 character was shown a 16-Merx debt.
test('a V1 character owning twelve own-class Signatures is charged 24 against a grant of 12', () => {
  const parts = deriveMerxBreakdown({
    realMissions: [], offscreenMissions: [],
    gear: twelveOwn('v1-class'), commonItems: [],
    characterClassId: 'v1-class', economy: 'aspirant'
  });
  expect(parts.earned).toBe(12);
  expect(parts.spend).toBe(24);
  expect(parts.deficit).toBe(12);
});

// 12 Merx at 2 Merx each. The Signature Cap of 12 is a carry limit reached
// over a campaign, not a creation target.
test('the 12-Merx grant buys exactly six own-class Signatures', () => {
  const six = twelveOwn('v1-class').slice(0, 6);
  const parts = deriveMerxBreakdown({
    realMissions: [], offscreenMissions: [],
    gear: six, commonItems: [],
    characterClassId: 'v1-class', economy: 'aspirant'
  });
  expect(parts.spend).toBe(CREATION_GRANT.aspirant);
  expect(parts.deficit).toBe(0);
  expect(parts.reward).toBe(0);
});

test('an Enchantment and two Mods are charged on top of the Signature', () => {
  const parts = deriveMerxBreakdown({
    realMissions: [], offscreenMissions: [],
    gear: [{
      name: 'Wizarding Hat', class_id: 'v1-class',
      enchantment: { source: 'default' },
      mods: [{ name: 'Lined' }, { name: 'Weighted' }]
    }],
    commonItems: [], characterClassId: 'v1-class', economy: 'aspirant'
  });
  // 2 Signature + 2 Default Enchantment + 1 first Mod + 2 second Mod
  expect(parts.spend).toBe(7);
});

// pg. 90 treats an aspiring character's three picks as its own Class's, and it
// has no class_id at all -- without the rule every pick would read as
// cross-class and cost 3, overcharging a 10-Merx grant by 3.
test('an aspiring character pays own-class price for picks from three classes', () => {
  const parts = deriveMerxBreakdown({
    realMissions: [], offscreenMissions: [],
    gear: [
      { name: 'A', class_id: 'class-a' },
      { name: 'B', class_id: 'class-b' },
      { name: 'C', class_id: 'class-c' }
    ],
    commonItems: [], characterClassId: null, economy: 'aspiring'
  });
  expect(parts.earned).toBe(10);
  expect(parts.spend).toBe(6);
  expect(parts.reward).toBe(4);
});

// All 327 existing characters are in this branch. Any movement here is a
// defect, not an improvement.
test('the advent branch is unchanged: four on-class Signatures are free', () => {
  const parts = deriveMerxBreakdown({
    realMissions: [], offscreenMissions: [],
    gear: twelveOwn('advent-class').slice(0, 4), commonItems: [],
    characterClassId: 'advent-class'
  });
  expect(parts.earned).toBe(0);
  expect(parts.spend).toBe(0);
  expect(parts.deficit).toBe(0);
});

test('the advent branch still charges the fifth on-class Signature 2 Merx', () => {
  const parts = deriveMerxBreakdown({
    realMissions: [], offscreenMissions: [],
    gear: twelveOwn('advent-class').slice(0, 5), commonItems: [],
    characterClassId: 'advent-class'
  });
  expect(parts.spend).toBe(2);
});

test('an omitted economy is advent, so existing callers keep their answer', () => {
  const args = {
    realMissions: [], offscreenMissions: [],
    gear: twelveOwn('advent-class').slice(0, 4), commonItems: [],
    characterClassId: 'advent-class'
  };
  expect(deriveMerxBreakdown(args)).toEqual(
    deriveMerxBreakdown({ ...args, economy: 'advent' })
  );
});

test('a V1 character still earns Merx from missions on top of the grant', () => {
  const parts = deriveMerxBreakdown({
    realMissions: [{ outcome: 'success' }, { outcome: 'success' }],
    offscreenMissions: [{ merx_gained: 3 }],
    gear: [], commonItems: [],
    characterClassId: 'v1-class', economy: 'aspirant'
  });
  expect(parts.earned).toBe(12 + 2 + 3);
});
```

- [ ] **Step 3: Run to verify they fail**

```bash
bun test util/character-derived.test.js
```
Expected: the four aspirant/aspiring cases FAIL (`earned` 0 not 12, `spend` 16 not 24). The three advent cases PASS already — they are the guard, and you should say in your report that they were green from the start.

- [ ] **Step 4: Rewrite the spend calculation**

In `util/character-derived.js`, delete the three local constants:

```js
const COMMON_ITEM_COST = 1;
const GEAR_ON_CLASS_COST = 2;
const GEAR_OFF_CLASS_COST = 3;
```

and require the module instead:

```js
const {
    equipmentSpend,
    COMMON_ITEM_PRICE,
    CREATION_GRANT
} = require('./merx-economy');
```

Replace the body of `deriveMerxBreakdown` from `const itemSpend = ...` through `const spend = ...` with:

```js
    const itemSpend = itemList.length * COMMON_ITEM_PRICE;
    const spend = itemSpend + gearSpendFor(economy, gearList, characterClassId);
```

and add above it:

```js
// Advent grants four on-class Signatures at creation and charges for the rest;
// the Aspirant editions replaced that gift with a Merx grant (pg. 3), so every
// Signature is bought and the grant is income rather than a discount.
//
// It reads its two prices from the same table as the Aspirant branch because
// they are the same two numbers (2 on-class, 3 off-class) and always have been.
// If a future edition moves the Aspirant prices and Advent's must not follow,
// that is the moment to give Advent its own entries -- not now, when a second
// copy would only be a copy that can drift.
const adventGearSpend = (gearList, characterClassId) => {
    let onClassCount = 0;
    let offClassCount = 0;
    for (const g of gearList) {
        if (!g) continue;
        const onClass = !!characterClassId && !!g.class_id && g.class_id === characterClassId;
        if (onClass) onClassCount++;
        else offClassCount++;
    }
    const chargedOnClass = Math.max(0, onClassCount - STARTING_ON_CLASS_GEAR_ALLOTMENT);
    return chargedOnClass * priceOfSignature({ crossClass: false })
        + offClassCount * priceOfSignature({ crossClass: true });
};

const gearSpendFor = (economy, gearList, characterClassId) => (economy === 'advent'
    ? adventGearSpend(gearList, characterClassId)
    : equipmentSpend(gearList, { economy, characterClassId }));
```

Add `priceOfSignature` to the require list. Change the signature to accept and apply the grant:

```js
const deriveMerxBreakdown = ({
    realMissions, offscreenMissions, gear, commonItems, characterClassId, economy = 'advent'
}) => {
```

and add the grant to `earned`:

```js
    const earned = CREATION_GRANT[economy] + earnedFromReal + earnedFromOffscreen;
```

Finally thread `economy` through `deriveCharacterTotals`:

```js
const deriveCharacterTotals = ({ character, realMissions, offscreenMissions, rulesVersion, economy }) => {
```
and add `economy` to the `deriveMerxBreakdown` call inside it.

- [ ] **Step 5: Run to verify they pass**

```bash
bun test util/character-derived.test.js
bun test util/merx-economy.test.js
```
Expected: both PASS, no test removed or weakened.

- [ ] **Step 6: Confirm the advent branch really did not move**

Do not compare pass counts across a `git stash` — that runs the old tests against the old code and proves nothing. Prove it from the diff instead:

```bash
git diff -U0 util/character-derived.test.js | grep '^-' | grep -v '^---'
```

Expected: no output. Every line in that file is an **addition**; a deleted or edited line means an existing expectation had to change, which is a behaviour change to the advent branch. If you see any, stop and report it rather than editing the test to match new behaviour.

- [ ] **Step 7: Commit**

```bash
git add util/character-derived.js util/character-derived.test.js util/enclave-consts.js
git commit -m "feat: derive a V1 character's Merx from what it owns"
```

---

### Task 4: Pass the economy at every call site

`deriveCharacterTotals` now takes an `economy`, and four call sites must supply it. They must not each work it out: one named resolver, called by all four, or they will drift the way the prices did.

**Files:**
- Modify: `services/character/service.js:226-250` and the level-up path around `:606`
- Modify: `routes/characters.js` (the two auto-calc sites — find with the grep in Step 1)
- Test: `services/character/service.test.js`

**Interfaces:**
- Consumes: `economyFor` from `util/merx-economy.js`; `deriveCharacterTotals` from Task 3.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Find all four call sites**

```bash
grep -rn "deriveCharacterTotals\|deriveMerxBreakdown\|deriveMerx\b" --include="*.js" services routes models util | grep -v "\.test\.js" | grep -v "util/character-derived.js"
```

Expected: two in `services/character/service.js`, two in `routes/characters.js`. If the grep finds a fifth, it is in scope — say so in your report.

- [ ] **Step 2: Write the failing test**

Add to `services/character/service.test.js`, matching the file's existing fake-adapter style:

```js
test('auto-calculate prices a V1 character under the aspirant economy', async () => {
  // Six own-class Signatures cost 12 and the grant is 12, so the reward is 0
  // and nothing is in deficit. Under the advent economy the same character
  // would be charged for only two of them and show a reward.
  const { service, saved } = makeServiceOnAspirantClass({
    gear: Array.from({ length: 6 }, (_, i) => ({ name: `S${i}`, class_id: ASPIRANT_CLASS_ID })),
    auto_calculate: true
  });
  await service.updateCharacter(ACTOR, CHARACTER_ID, { auto_calculate: true });
  expect(saved.commissary_reward).toBe(0);
});

test('auto-calculate leaves an Advent character on the advent economy', async () => {
  const { service, saved } = makeServiceOnAdventClass({
    gear: Array.from({ length: 4 }, (_, i) => ({ name: `S${i}`, class_id: ADVENT_CLASS_ID })),
    auto_calculate: true
  });
  await service.updateCharacter(ACTOR, CHARACTER_ID, { auto_calculate: true });
  expect(saved.commissary_reward).toBe(0);
});
```

Build `makeServiceOnAspirantClass` / `makeServiceOnAdventClass` as thin wrappers over whatever factory the file already uses, differing only in the class row's `content_format`. Do not duplicate the harness.

- [ ] **Step 3: Run to verify it fails**

```bash
bun test services/character/service.test.js
```
Expected: the aspirant case FAILS — without an `economy` the derivation defaults to advent and charges two of the six Signatures, producing a non-zero reward.

- [ ] **Step 4: Resolve the economy once**

The adapter must supply the class's `content_format`. Check whether the class row the service already fetches carries it:

```bash
grep -n "content_format" services/character/*.js models/class.js | head
```

If the service's class lookup does not select `content_format`, add it to that select — do not add a second query.

Then at each call site, replace the bare call with one that names the economy:

```js
const { economyFor } = require('../../util/merx-economy');
...
        economy: economyFor({
            contentFormat: classRow && classRow.content_format,
            creatorMode: characterInput.creator_mode
        }),
```

Use the same two-line expression at all four sites. If the surrounding code makes that awkward at one of them, extract a single helper next to the service's other private helpers and call it from all four — one definition either way.

- [ ] **Step 5: Run the suites**

```bash
bun test services/character/service.test.js
bun run test:unit
bun run check
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add services/character/service.js routes/characters.js services/character/service.test.js
git commit -m "feat: resolve a character's economy from its class content format"
```

---

### Task 5: Storage for a character's Enchantment and Mods

Two jsonb columns on `class_gear`, the table holding a character's owned Signatures. Constraints do the shape work the database can do; the word limits belong to Task 8 because they are a rules question, not a type question.

**Files:**
- Create: `supabase/migrations/20260918000000_class_gear_enchantment_mods.sql`
- Create: `util/character-equipment.integration.test.js`
- Modify: `scripts/run-tests.mjs:7-22` (register the new integration file)

**Interfaces:**
- Consumes: nothing.
- Produces: `class_gear.enchantment` — `jsonb NULL`, either `null`, `{"source":"default"}`, or `{"source":"custom","name":…,"description":…}`; and `class_gear.mods` — `jsonb NOT NULL DEFAULT '[]'`, an array of at most two `{"name":…,"description":…}`.

- [ ] **Step 1: Confirm the target is local**

```bash
eval "$(supabase status -o env)"
echo "$SUPABASE_URL"
```
This **must** print `http://127.0.0.1:54321`. If it does not, stop. **Never run `supabase db reset`.**

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260918000000_class_gear_enchantment_mods.sql`:

```sql
-- A character's Enchantment and Mods on a Signature it owns
-- (ENCLAVE: Aspirant V1, pp. 8, 86, 87).
--
-- Columns rather than a child table because the book caps both: "A Signature
-- may only hold one Enchantment" (pg. 8) and "up to two Mods" (pg. 87).
-- Reconciliation matches a class_gear row by class_id + name, so a rename is a
-- delete plus an insert; a child table keyed on class_gear.id would lose a
-- paid-for Enchantment to a rename.
--
-- `enchantment` stores its source, not the Default's text. The text lives on
-- the class (classes.gear[].default_enchantment) and
-- services/character/repository.js mergeClassItems already merges class content
-- onto character rows at read time, so an errata to a class's Default reaches
-- every character who unlocked it. It also makes "Default or Custom?" -- a
-- pricing input -- a stored fact rather than a text comparison.
ALTER TABLE public.class_gear
  ADD COLUMN enchantment jsonb,
  ADD COLUMN mods jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Only the two sources are priced (pg. 85), so a third would be a silent 0.
ALTER TABLE public.class_gear
  ADD CONSTRAINT class_gear_enchantment_source_check
  CHECK (
    enchantment IS NULL
    OR (
      jsonb_typeof(enchantment) = 'object'
      AND enchantment->>'source' IN ('default', 'custom')
    )
  );

-- A Custom Enchantment "should be given a thematic name for easy reference
-- during play" (pg. 86), and an unnamed one cannot be referred to at the table.
-- A Default needs no name of its own: it inherits the class's.
ALTER TABLE public.class_gear
  ADD CONSTRAINT class_gear_custom_enchantment_named_check
  CHECK (
    enchantment IS NULL
    OR enchantment->>'source' <> 'custom'
    OR length(btrim(coalesce(enchantment->>'name', ''))) > 0
  );

ALTER TABLE public.class_gear
  ADD CONSTRAINT class_gear_mods_shape_check
  CHECK (
    jsonb_typeof(mods) = 'array'
    AND jsonb_array_length(mods) <= 2
  );
```

- [ ] **Step 3: Apply it**

```bash
supabase migration up
```
Expected: the migration applies. It is `ADD COLUMN` with a default on an existing table — Postgres 11+ does this without rewriting, so the 1492 existing rows take the `'[]'` default without a scan.

- [ ] **Step 4: Confirm the existing rows are intact and defaulted**

```bash
eval "$(supabase status -o env)"
psql "$DB_URL" -At -c "select count(*) as rows, count(enchantment) as enchanted, count(*) filter (where mods = '[]'::jsonb) as empty_mods from public.class_gear;"
```
Expected: the row count unchanged from before the migration, `enchanted` = 0, `empty_mods` = the full count. Record the row count in your report — a changed count means the migration did something it should not have.

- [ ] **Step 5: Write the integration test**

Create `util/character-equipment.integration.test.js`. It asserts the constraints by attempting updates that must be **rejected** — a rejected update writes nothing, which is what makes this safe to run against a restored production copy. Follow the pattern in `util/class-structured-columns.integration.test.js`, including its "assert the target exists first" guard: PostgREST reports no error when an update matches no row, so without that guard a missing table would pass.

```js
// util/character-equipment.integration.test.js
//
// Requires the local Supabase stack: SUPABASE_URL=http://127.0.0.1:54321
//
// A character's Enchantment and Mods are priced from their stored shape
// (util/merx-economy.js), so a shape the pricing functions cannot read must not
// be storable. Every write here is expected to be REJECTED -- the test changes
// no data, which is what makes it safe against a restored production copy.

require('./require-local-supabase');

const { test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const anyGearRow = async () => {
  const { data, error } = await sb.from('class_gear').select('id').limit(1);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  return data[0].id;
};

test('class_gear carries the equipment columns', async () => {
  const { error } = await sb.from('class_gear').select('id,enchantment,mods').limit(1);
  expect(error).toBeNull();
});

test('mods defaults to an empty array rather than null', async () => {
  const { data, error } = await sb.from('class_gear').select('mods').limit(50);
  expect(error).toBeNull();
  expect(data.every((row) => Array.isArray(row.mods))).toBe(true);
});

test('an enchantment source outside default/custom is rejected', async () => {
  const id = await anyGearRow();
  const { error } = await sb.from('class_gear')
    .update({ enchantment: { source: 'legendary' } })
    .eq('id', id);
  // 23514 is check_violation. Asserting the code keeps a missing column from
  // standing in for a working constraint.
  expect(error?.code).toBe('23514');
});

test('a custom enchantment with no name is rejected', async () => {
  const id = await anyGearRow();
  const { error } = await sb.from('class_gear')
    .update({ enchantment: { source: 'custom', name: '   ', description: 'x' } })
    .eq('id', id);
  expect(error?.code).toBe('23514');
});

test('a third Mod on one Signature is rejected', async () => {
  const id = await anyGearRow();
  const { error } = await sb.from('class_gear')
    .update({ mods: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] })
    .eq('id', id);
  expect(error?.code).toBe('23514');
});

test('mods must be an array, not an object', async () => {
  const id = await anyGearRow();
  const { error } = await sb.from('class_gear')
    .update({ mods: { name: 'a' } })
    .eq('id', id);
  expect(error?.code).toBe('23514');
});
```

- [ ] **Step 6: Register it in the runner**

A new `*.integration.test.js` is invisible to `bun run test:integration` and runs in the **unit** tier against no database until it is listed. Add one line to the `integrationFiles` set at `scripts/run-tests.mjs:7-22`, in its existing alphabetical position among the `util/` entries:

```js
  'util/character-equipment.integration.test.js',
```

- [ ] **Step 7: Run it**

```bash
SUPABASE_URL=http://127.0.0.1:54321 bun run test:integration 2>&1 | tail -20
bun run test:unit
```
Expected: the new file's 6 tests pass; the unit tier does not pick it up. `class-form-round-trip` stays at its known 2 pass / 1 fail.

- [ ] **Step 8: Confirm nothing was written**

```bash
eval "$(supabase status -o env)"
psql "$DB_URL" -At -c "select count(*) filter (where enchantment is not null) as enchanted, count(*) filter (where mods <> '[]'::jsonb) as modded from public.class_gear;"
```
Expected: `0|0`. Every write the test attempts is rejected; if either number moved, a constraint is missing.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260918000000_class_gear_enchantment_mods.sql util/character-equipment.integration.test.js scripts/run-tests.mjs
git commit -m "feat: store a character's Enchantment and Mods on its Signature"
```

---

### Task 6: The atomic save carries the two columns

`save_character_atomic` is the path production actually uses (`services/character/repository.js:246-258` prefers it whenever `supabaseAdmin.rpc` exists). Its gear block currently reconciles `name`, `class_id` and `description` only, so a save through the RPC would silently drop an Enchantment.

The rule to copy is the one `class_abilities.type` already follows: **absent means keep what is stored**, never "reset to default". The edit form submits gear as bare `"Class::Item"` strings with no equipment fields, and that save must not wipe a purchase.

**Files:**
- Create: `supabase/migrations/20260918000001_save_character_atomic_gear_equipment.sql`
- Modify: `models/character-atomic.integration.test.js`

**Interfaces:**
- Consumes: the columns from Task 5.
- Produces: an RPC whose `p_gear` elements may carry `enchantment` (object or absent) and `mods` (array or absent).

- [ ] **Step 1: Read the function you are restating**

```bash
sed -n '1,20p' supabase/migrations/20260913000004_save_character_atomic_preserve_ability_type.sql
sed -n '112,145p' supabase/migrations/20260913000004_save_character_atomic_preserve_ability_type.sql
sed -n '146,180p' supabase/migrations/20260913000004_save_character_atomic_preserve_ability_type.sql
```

The file's convention is a `CREATE OR REPLACE` restating the **whole** function, with a header comment naming which block differs from the previous migration and asserting the rest is byte-identical. Follow it exactly: copy the previous file, change only the `p_gear` block, and write a header that says so.

- [ ] **Step 2: Write the failing test**

Add to `models/character-atomic.integration.test.js`, following its existing create-a-character harness:

```js
test('a gear row keeps its Enchantment and Mods across a save that omits them', async () => {
  const created = await saveCharacter({
    gear: [{
      name: GEAR_NAME, class_id: CLASS_ID,
      enchantment: { source: 'custom', name: 'Sorcerer’s Apprentice', description: 'Boosts an ally.' },
      mods: [{ name: 'Lined', description: 'Warm.' }]
    }]
  });
  const before = await gearRows(created.id);
  expect(before[0].enchantment.source).toBe('custom');
  expect(before[0].mods).toHaveLength(1);

  // The edit form submits gear as "Class::Item" strings with no equipment
  // fields at all. That save must not spend the player's Merx for them.
  await saveCharacter({ id: created.id, gear: [{ name: GEAR_NAME, class_id: CLASS_ID }] });
  const after = await gearRows(created.id);
  expect(after[0].id).toBe(before[0].id);
  expect(after[0].enchantment).toEqual(before[0].enchantment);
  expect(after[0].mods).toEqual(before[0].mods);
});

test('a submitted Enchantment replaces the stored one', async () => {
  const created = await saveCharacter({
    gear: [{ name: GEAR_NAME, class_id: CLASS_ID, enchantment: { source: 'default' } }]
  });
  await saveCharacter({
    id: created.id,
    gear: [{
      name: GEAR_NAME, class_id: CLASS_ID,
      enchantment: { source: 'custom', name: 'Ported', description: 'Retooled.' }
    }]
  });
  const rows = await gearRows(created.id);
  expect(rows[0].enchantment.source).toBe('custom');
  expect(rows[0].enchantment.name).toBe('Ported');
});

test('a renamed Signature does not carry its Enchantment to the new name', async () => {
  // Reconciliation keys on class_id + name, so a rename is a delete plus an
  // insert. The new Signature is a different purchase and starts unenchanted.
  const created = await saveCharacter({
    gear: [{ name: GEAR_NAME, class_id: CLASS_ID, enchantment: { source: 'default' } }]
  });
  await saveCharacter({ id: created.id, gear: [{ name: OTHER_GEAR_NAME, class_id: CLASS_ID }] });
  const rows = await gearRows(created.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe(OTHER_GEAR_NAME);
  expect(rows[0].enchantment).toBeNull();
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
SUPABASE_URL=http://127.0.0.1:54321 bun test models/character-atomic.integration.test.js
```
Expected: the first two FAIL — the RPC ignores the fields, so `before[0].enchantment` is `null`. The third may pass already (a delete-plus-insert leaves the new row at its column default); say so if it does.

- [ ] **Step 4: Write the migration**

Copy `20260913000004_save_character_atomic_preserve_ability_type.sql` to `supabase/migrations/20260918000001_save_character_atomic_gear_equipment.sql` and change **only** the `p_gear` block. The four edits, against the block at `:113-143` of the source file:

`desired` gains the two fields:

```sql
        gear_item->>'description' AS description,
        gear_item->'enchantment' AS enchantment,
        gear_item->'mods' AS mods,
```

Note `->` not `->>`: these are jsonb values, not text. An absent key yields SQL `NULL`, which is exactly the "keep what is stored" signal.

`matched` carries them:

```sql
    matched AS (
      SELECT e.id, d.description, d.enchantment, d.mods
      FROM existing e JOIN desired d USING (class_id, name, occ)
    ),
```

`updated` applies them with the preserve-on-absent rule, mirroring `type = COALESCE(m.type, a.type)`:

```sql
    updated AS (
      UPDATE public.class_gear g SET
        description = m.description,
        enchantment = CASE WHEN m.enchantment IS NULL THEN g.enchantment ELSE NULLIF(m.enchantment, 'null'::jsonb) END,
        mods = COALESCE(m.mods, g.mods)
      FROM matched m
      WHERE g.id = m.id
        AND (g.description IS DISTINCT FROM m.description
          OR (m.enchantment IS NOT NULL AND g.enchantment IS DISTINCT FROM NULLIF(m.enchantment, 'null'::jsonb))
          OR (m.mods IS NOT NULL AND g.mods IS DISTINCT FROM m.mods))
    )
```

The `NULLIF(..., 'null'::jsonb)` is the difference between "I did not mention the enchantment" (absent key → SQL NULL → keep) and "remove the enchantment" (explicit JSON `null` → SQL NULL column). Without it there is no way to un-enchant a Signature through the RPC.

`INSERT` takes both columns, defaulting a new row to unenchanted with no mods:

```sql
    INSERT INTO public.class_gear (character_id, name, class_id, description, enchantment, mods)
    SELECT saved.id, d.name, d.class_id, d.description,
           NULLIF(d.enchantment, 'null'::jsonb),
           COALESCE(d.mods, '[]'::jsonb)
    FROM desired d
    WHERE NOT EXISTS (
      SELECT 1 FROM existing e WHERE e.class_id = d.class_id AND e.name = d.name AND e.occ = d.occ
    );
```

Header comment for the file:

```sql
-- Restates the whole function so the gear block carries a character's
-- Enchantment and Mods (ENCLAVE: Aspirant V1, pp. 8, 86, 87). An absent
-- `enchantment` or `mods` key means "leave the stored value alone" -- the edit
-- form submits gear as bare "Class::Item" strings, and a save through that form
-- must not spend a player's Merx for them. An explicit JSON null removes an
-- Enchantment, which is the only way to un-enchant a Signature.
--
-- Every block except the p_gear one is byte-identical to
-- 20260913000004_save_character_atomic_preserve_ability_type.sql.
```

- [ ] **Step 5: Prove the claim in your own header**

```bash
diff <(sed -n '/IF p_abilities IS NOT NULL THEN/,$p' supabase/migrations/20260913000004_save_character_atomic_preserve_ability_type.sql) \
     <(sed -n '/IF p_abilities IS NOT NULL THEN/,$p' supabase/migrations/20260918000001_save_character_atomic_gear_equipment.sql)
```
Expected: no output. Do the same for everything before the gear block. If the diff is non-empty, your header comment is false — fix the file, not the comment.

- [ ] **Step 6: Apply and re-run**

```bash
supabase migration up
SUPABASE_URL=http://127.0.0.1:54321 bun test models/character-atomic.integration.test.js
```
Expected: all tests pass, including every one that existed before.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260918000001_save_character_atomic_gear_equipment.sql models/character-atomic.integration.test.js
git commit -m "feat: carry a Signature's Enchantment and Mods through the atomic save"
```

---

### Task 7: The JS reconciliation path carries them too

`util/reconcile.js` is the fallback the fake-client unit tests exercise (`services/character/repository.js:257-259`). It has a defect the new columns expose: `fieldEqual` is `(a ?? null) === (b ?? null)`, a strict comparison. Two deep-equal jsonb values are different objects, so every save of an enchanted Signature would produce a pointless `UPDATE` — and a diff that always reports a change makes `toUpdate` useless as a signal.

**Files:**
- Modify: `util/reconcile.js:8`
- Modify: `services/character/service.js` (`reconcileGear`, around `:402-416`)
- Test: `util/reconcile.test.js`, `services/character/service.test.js`

**Interfaces:**
- Consumes: the columns from Task 5.
- Produces: `reconcileGear` desired rows of `{ name, class_id, description, enchantment, mods }`.

- [ ] **Step 1: Write the failing tests**

Add to `util/reconcile.test.js`:

```js
test('an object-valued field that is deep-equal produces no update', () => {
  const existing = [{ id: 'row-1', name: 'Hat', enchantment: { source: 'default' } }];
  const desired = [{ name: 'Hat', enchantment: { source: 'default' } }];
  const diff = diffChildRows(existing, desired, {
    keyOf: (r) => r.name,
    rowFields: (i) => ({ name: i.name, enchantment: i.enchantment })
  });
  expect(diff.toUpdate).toEqual([]);
  expect(diff.toInsert).toEqual([]);
  expect(diff.toDelete).toEqual([]);
});

test('an object-valued field that differs produces one update', () => {
  const existing = [{ id: 'row-1', name: 'Hat', enchantment: { source: 'default' } }];
  const desired = [{ name: 'Hat', enchantment: { source: 'custom', name: 'Ported' } }];
  const diff = diffChildRows(existing, desired, {
    keyOf: (r) => r.name,
    rowFields: (i) => ({ name: i.name, enchantment: i.enchantment })
  });
  expect(diff.toUpdate).toEqual([
    { id: 'row-1', enchantment: { source: 'custom', name: 'Ported' } }
  ]);
});

test('an array-valued field compares by contents and by order', () => {
  const existing = [{ id: 'row-1', name: 'Hat', mods: [{ name: 'a' }, { name: 'b' }] }];
  const same = diffChildRows(existing, [{ name: 'Hat', mods: [{ name: 'a' }, { name: 'b' }] }], {
    keyOf: (r) => r.name, rowFields: (i) => ({ name: i.name, mods: i.mods })
  });
  expect(same.toUpdate).toEqual([]);
  const reordered = diffChildRows(existing, [{ name: 'Hat', mods: [{ name: 'b' }, { name: 'a' }] }], {
    keyOf: (r) => r.name, rowFields: (i) => ({ name: i.name, mods: i.mods })
  });
  // Order is priced: pg. 85 charges more for the second Mod, so a reorder is a
  // real change.
  expect(reordered.toUpdate).toHaveLength(1);
});

test('a scalar field still compares undefined and null as equal', () => {
  const existing = [{ id: 'row-1', name: 'Hat', description: null }];
  const diff = diffChildRows(existing, [{ name: 'Hat' }], {
    keyOf: (r) => r.name,
    rowFields: (i) => ({ name: i.name, description: i.description })
  });
  expect(diff.toUpdate).toEqual([]);
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
bun test util/reconcile.test.js
```
Expected: the two deep-equal cases FAIL with a spurious `toUpdate` entry. The differing-value and scalar cases pass already.

- [ ] **Step 3: Compare object-valued fields by value**

In `util/reconcile.js`, replace `fieldEqual`:

```js
// Desired items omit optional fields (undefined); the persisted value for an
// omitted field is null -- treat them as equal.
//
// A jsonb column arrives as a fresh object on every read, so identity would
// report a change on every save. Compare those by serialization: key order is
// stable because both sides are built by this codebase, and a false "changed"
// here costs a needless UPDATE while a false "same" would lose a write.
const isStructured = (value) => value !== null && typeof value === 'object';

const fieldEqual = (a, b) => {
    if (isStructured(a) || isStructured(b)) {
        return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    }
    return (a ?? null) === (b ?? null);
};
```

- [ ] **Step 4: Carry the fields through `reconcileGear`**

In `services/character/service.js`, the `desired.push` and `rowFields` in `reconcileGear` both name their columns explicitly, so both need the two fields. Change the push to:

```js
      desired.push({
        name: item.name,
        class_id: classId,
        description: item.description ?? gearNameToDescription.get(item.name) ?? null,
        enchantment: item.enchantment ?? null,
        mods: Array.isArray(item.mods) ? item.mods : []
      });
```

and the `rowFields`:

```js
      rowFields: item => ({
        name: item.name,
        class_id: item.class_id,
        description: item.description,
        enchantment: item.enchantment,
        mods: item.mods
      })
```

Note the asymmetry with the RPC and say why in a comment: this path receives already-normalised items from `normalizeGearItems`, which spreads unknown keys through, so an absent `enchantment` here genuinely means "none" rather than "keep". Task 8's normaliser is what makes that true, so the comment must point at it.

- [ ] **Step 5: Run the suites**

```bash
bun test util/reconcile.test.js
bun test services/character/service.test.js
bun run test:unit
```
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add util/reconcile.js util/reconcile.test.js services/character/service.js services/character/service.test.js
git commit -m "fix: compare jsonb child-row fields by value, not identity"
```

---

### Task 8: Normalise and bound a submitted Enchantment or Mod

The payload's equipment fields are player-authored, so they get the same treatment every other authored field in this codebase gets: trimmed, shape-checked, bounded, and never trusted. The book's power-balance judgment ("may never be stronger than the Default") is the playgroup's and is deliberately **not** enforced.

**Files:**
- Modify: `services/character/input.js`
- Test: `services/character/input.test.js`

**Interfaces:**
- Consumes: `countWordsExcludingRatings`, `ENCHANTMENT_WORD_LIMIT`, `MOD_WORD_LIMIT`, `MODS_PER_SIGNATURE` from Task 2.
- Produces: `normalizeGearEquipment(item) -> { enchantment, mods }`, exported from `services/character/input.js`, and used by `normalizeClassItems` so every gear item reaching `reconcileGear` already carries normalised fields. Throws `Error` with a player-readable message on a violation, matching how `validateAbilityPerks` reports.

- [ ] **Step 1: Read how the file reports a rejection**

```bash
sed -n '/const validateAbilityPerks/,/^};/p' util/validate.js
```

Match its error style — message text a player can act on, thrown rather than returned — so the route's existing error handling (`routes/characters.js:333` wraps these) surfaces it unchanged.

- [ ] **Step 2: Write the failing tests**

Add to `services/character/input.test.js`:

```js
const { ENCHANTMENT_WORD_LIMIT, MOD_WORD_LIMIT } = require('../../util/merx-economy');

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

test('a default enchantment normalizes to its source alone', () => {
  expect(normalizeGearEquipment({ name: 'Hat', enchantment: { source: 'default' } }).enchantment)
    .toEqual({ source: 'default' });
});

test('a default enchantment does not keep a submitted name or description', () => {
  // The text lives on the class; storing a copy would let it drift from the
  // class page and would make an errata invisible to the character.
  const { enchantment } = normalizeGearEquipment({
    name: 'Hat',
    enchantment: { source: 'default', name: 'Whatever', description: 'Made up.' }
  });
  expect(enchantment).toEqual({ source: 'default' });
});

test('a custom enchantment keeps its trimmed name and description', () => {
  const { enchantment } = normalizeGearEquipment({
    name: 'Hat',
    enchantment: { source: 'custom', name: '  Ported  ', description: '  Retooled.  ' }
  });
  expect(enchantment).toEqual({ source: 'custom', name: 'Ported', description: 'Retooled.' });
});

test('an absent enchantment is null and absent mods are an empty array', () => {
  expect(normalizeGearEquipment({ name: 'Hat' })).toEqual({ enchantment: null, mods: [] });
});

test('a custom enchantment at the 40-word limit is accepted', () => {
  expect(() => normalizeGearEquipment({
    name: 'Hat',
    enchantment: { source: 'custom', name: 'Long', description: words(ENCHANTMENT_WORD_LIMIT) }
  })).not.toThrow();
});

test('a custom enchantment over 40 words is rejected', () => {
  expect(() => normalizeGearEquipment({
    name: 'Hat',
    enchantment: { source: 'custom', name: 'Long', description: words(ENCHANTMENT_WORD_LIMIT + 1) }
  })).toThrow(/40 words/);
});

test('Power Rating superscripts do not count against the 40 words', () => {
  const description = `${words(ENCHANTMENT_WORD_LIMIT)} <sup>L–H</sup> <sup>M</sup>`;
  expect(() => normalizeGearEquipment({
    name: 'Hat', enchantment: { source: 'custom', name: 'Rated', description }
  })).not.toThrow();
});

test('a custom enchantment with no name is rejected', () => {
  expect(() => normalizeGearEquipment({
    name: 'Hat', enchantment: { source: 'custom', name: '  ', description: 'x' }
  })).toThrow(/name/i);
});

test('an unknown enchantment source is rejected', () => {
  expect(() => normalizeGearEquipment({
    name: 'Hat', enchantment: { source: 'legendary' }
  })).toThrow(/default|custom/);
});

test('a mod over 10 words is rejected', () => {
  expect(() => normalizeGearEquipment({
    name: 'Hat', mods: [{ name: 'Big', description: words(MOD_WORD_LIMIT + 1) }]
  })).toThrow(/10 words/);
});

test('a third mod on one Signature is rejected', () => {
  expect(() => normalizeGearEquipment({
    name: 'Hat', mods: [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
  })).toThrow(/two Mods/i);
});

test('an unnamed mod is dropped rather than stored nameless', () => {
  // A Mod "should be named for easy reference during play" (pg. 87), and a
  // blank row is a UI artifact, not a purchase -- the same treatment
  // util/class-gear.js gives a blank note.
  expect(normalizeGearEquipment({ name: 'Hat', mods: [{ name: '  ' }, { name: 'Lined' }] }).mods)
    .toEqual([{ name: 'Lined', description: '' }]);
});
```

- [ ] **Step 3: Run to verify they fail**

```bash
bun test services/character/input.test.js
```
Expected: FAIL — `normalizeGearEquipment is not a function`.

- [ ] **Step 4: Implement it**

Add to `services/character/input.js`, beside the other normalisers:

```js
const {
  countWordsExcludingRatings,
  ENCHANTMENT_WORD_LIMIT,
  MOD_WORD_LIMIT,
  MODS_PER_SIGNATURE
} = require('../../util/merx-economy');

const ENCHANTMENT_SOURCES = ['default', 'custom'];

// A Default Enchantment stores only its source: its text belongs to the class
// (classes.gear[].default_enchantment) and is merged in at read time, so a copy
// here could drift from the class page.
//
// A Custom Enchantment is Self-Made Content, so it is bounded but not judged:
// the book's "may never be stronger than the Default" (pg. 86) is the
// playgroup's call, and nothing here can measure it.
const normalizeEnchantment = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = typeof value.source === 'string' ? value.source.trim() : '';
  if (!source) return null;
  if (!ENCHANTMENT_SOURCES.includes(source)) {
    throw new Error(`Enchantment source must be default or custom, not "${source}".`);
  }
  if (source === 'default') return { source };
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) throw new Error('A Custom Enchantment needs a name.');
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  if (countWordsExcludingRatings(description) > ENCHANTMENT_WORD_LIMIT) {
    throw new Error(`A Custom Enchantment may be no more than ${ENCHANTMENT_WORD_LIMIT} words.`);
  }
  return { source, name, description };
};

const normalizeMods = (value) => {
  const rows = Array.isArray(value) ? value : [];
  const mods = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) continue;
    const description = typeof row.description === 'string' ? row.description.trim() : '';
    if (countWordsExcludingRatings(description) > MOD_WORD_LIMIT) {
      throw new Error(`A Mod may be no more than ${MOD_WORD_LIMIT} words.`);
    }
    mods.push({ name, description });
  }
  if (mods.length > MODS_PER_SIGNATURE) {
    throw new Error(`A Signature may hold no more than two Mods.`);
  }
  return mods;
};

const normalizeGearEquipment = (item) => ({
  enchantment: normalizeEnchantment(item && item.enchantment),
  mods: normalizeMods(item && item.mods)
});
```

Then apply it in `normalizeClassItems`' object branch, which currently spreads the item through unchanged:

```js
    if (typeof item === 'object' && typeof item.name === 'string') {
      const name = item.name.trim();
      if (!name) return null;
      // Gear items may carry equipment; abilities never do, and for them both
      // fields normalize to the empty case and are ignored by reconcileAbilities.
      return { ...item, name, ...normalizeGearEquipment(item) };
    }
```

Export `normalizeGearEquipment` from the module.

- [ ] **Step 5: Measure the counter against the book's own content**

The synthetic cases above prove the arithmetic. This one proves the *rule*, and it is the strongest evidence in the plan that "minus Power Rating Superscripts" is read correctly: **five of the book's own Default Enchantments breach its own 40-word limit if ratings count as words, and none breach it when they do not.**

Add to `services/character/input.test.js` (or `util/merx-economy.test.js` — it tests the counter, so either is defensible; put it beside the counter's other cases):

```js
const V1_ARTIFACT = require('../../docs/data/aspirant-v1-classes-2026-09.json');

const everyDefaultEnchantment = () => {
  const classes = Array.isArray(V1_ARTIFACT) ? V1_ARTIFACT : V1_ARTIFACT.classes;
  return classes.flatMap((cls) => (cls.gear || [])
    .map((item) => item.default_enchantment)
    .filter(Boolean));
};

// The 40-word limit governs a player's Custom Enchantment, not the book's
// printed Defaults -- but the Defaults are the only rated prose of this kind
// that exists, so they are what the counter can be measured against.
test('every printed Default Enchantment counts within 40 words once ratings are excluded', () => {
  const enchantments = everyDefaultEnchantment();
  expect(enchantments).toHaveLength(144);
  const over = enchantments.filter(
    (e) => countWordsExcludingRatings(e.description) > ENCHANTMENT_WORD_LIMIT
  );
  expect(over).toEqual([]);
});

// This is the case that makes the exclusion rule load-bearing rather than
// decorative. Counting a <sup>L–H</sup> as a word puts five of the book's own
// Enchantments over the book's own limit -- Thane's Billhook at 41 against 40.
test('counting Power Rating superscripts as words would breach the limit five times', () => {
  const naiveCount = (text) => String(text ?? '').trim().split(/\s+/).length;
  const breaches = everyDefaultEnchantment()
    .filter((e) => naiveCount(e.description) > ENCHANTMENT_WORD_LIMIT);
  expect(breaches).toHaveLength(5);
});
```

If the artifact's enchantment count is not 144, stop and report it — the artifact is committed and `md5` pinned, so a different number means something replaced it.

- [ ] **Step 6: Run to verify they pass**

```bash
bun test services/character/input.test.js
bun test util/merx-economy.test.js
bun run test:unit
```
Expected: green. If an existing ability test now fails because abilities gained `enchantment: null`/`mods: []`, that is real — `reconcileAbilities` names its columns explicitly so the extra keys are dropped before the write, but any test asserting a whole normalised object needs its expectation widened. Widen the expectation; do not narrow the normaliser.

- [ ] **Step 7: Commit**

```bash
git add services/character/input.js services/character/input.test.js util/merx-economy.test.js
git commit -m "feat: bound a submitted Enchantment and its Mods"
```

---

### Task 9: Enforce the budget and the Signature Cap

Today the server checks that a submitted gear name resolves to some catalogue row and nothing else — no budget, no cap, no provenance. This task makes the two V1 populations enforced and leaves Advent exactly as it is, because all 327 existing characters are Advent and no measurement says they would pass.

**Files:**
- Modify: `services/character/input.js` (`normalizeWizardPayload`) and `services/character/service.js` (the create path)
- Test: `services/character/input.test.js`, `services/character/service.test.js`

**Interfaces:**
- Consumes: `economyFor`, `equipmentSpend`, `signatureSlotsUsed`, `CREATION_GRANT`, `SIGNATURE_CAP`, `COMMON_ITEM_PRICE` from Task 2.
- Produces: `assertWithinEconomy({ economy, gear, commonItems, characterClassId, earnedMerx })`, exported from `services/character/input.js`; throws on a violation, returns undefined on success.

- [ ] **Step 1: Write the failing tests**

Add to `services/character/input.test.js`:

```js
const ASPIRANT = { economy: 'aspirant', characterClassId: 'v1', earnedMerx: 0 };
const own = (n) => Array.from({ length: n }, (_, i) => ({ name: `S${i}`, class_id: 'v1' }));

test('six own-class Signatures fit the 12-Merx grant', () => {
  expect(() => assertWithinEconomy({ ...ASPIRANT, gear: own(6), commonItems: [] })).not.toThrow();
});

test('a seventh own-class Signature is over budget', () => {
  expect(() => assertWithinEconomy({ ...ASPIRANT, gear: own(7), commonItems: [] }))
    .toThrow(/Merx/);
});

test('mission earnings raise the budget', () => {
  expect(() => assertWithinEconomy({
    ...ASPIRANT, gear: own(7), commonItems: [], earnedMerx: 2
  })).not.toThrow();
});

test('an Enchantment is charged against the budget', () => {
  const gear = own(5);
  gear[0].enchantment = { source: 'default' };
  // 5 Signatures (10) + one Default Enchantment (2) = 12, exactly the grant.
  expect(() => assertWithinEconomy({ ...ASPIRANT, gear, commonItems: [] })).not.toThrow();
  gear[1].enchantment = { source: 'default' };
  expect(() => assertWithinEconomy({ ...ASPIRANT, gear, commonItems: [] })).toThrow(/Merx/);
});

test('common items are charged against the budget', () => {
  expect(() => assertWithinEconomy({
    ...ASPIRANT, gear: own(6), commonItems: ['Bedroll']
  })).toThrow(/Merx/);
});

// pg. 8: six enchanted Signatures fill the cap of twelve, so a seventh
// Signature cannot be carried at all -- independent of Merx.
test('the Signature Cap counts an Enchantment as a slot', () => {
  const gear = own(6).map((g) => ({ ...g, enchantment: { source: 'default' } }));
  expect(() => assertWithinEconomy({
    ...ASPIRANT, gear, commonItems: [], earnedMerx: 100
  })).not.toThrow();
  expect(() => assertWithinEconomy({
    ...ASPIRANT, gear: [...gear, { name: 'One More', class_id: 'v1' }],
    commonItems: [], earnedMerx: 100
  })).toThrow(/Signature Cap|12/);
});

test('aspiring is capped at eight slots and granted ten Merx', () => {
  const picks = [
    { name: 'A', class_id: 'class-a' },
    { name: 'B', class_id: 'class-b' },
    { name: 'C', class_id: 'class-c' }
  ];
  expect(() => assertWithinEconomy({
    economy: 'aspiring', characterClassId: null, earnedMerx: 0, gear: picks, commonItems: []
  })).not.toThrow();
  const nine = Array.from({ length: 9 }, (_, i) => ({ name: `S${i}`, class_id: 'class-a' }));
  expect(() => assertWithinEconomy({
    economy: 'aspiring', characterClassId: null, earnedMerx: 100, gear: nine, commonItems: []
  })).toThrow(/Signature Cap|8/);
});

// 327 characters were built with no budget and no measurement says they pass.
test('the advent economy enforces nothing', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, class_id: 'advent' }));
  expect(() => assertWithinEconomy({
    economy: 'advent', characterClassId: 'advent', earnedMerx: 0, gear: twenty, commonItems: []
  })).not.toThrow();
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
bun test services/character/input.test.js
```
Expected: FAIL — `assertWithinEconomy is not a function`.

- [ ] **Step 3: Implement it**

Add to `services/character/input.js`, extending the require Task 8 added rather than writing a second one:

```js
const {
  economyFor,
  equipmentSpend,
  signatureSlotsUsed,
  countWordsExcludingRatings,
  CREATION_GRANT,
  SIGNATURE_CAP,
  COMMON_ITEM_PRICE,
  ENCHANTMENT_WORD_LIMIT,
  MOD_WORD_LIMIT,
  MODS_PER_SIGNATURE
} = require('../../util/merx-economy');

// The Advent economy is deliberately unenforced. All 327 characters that exist
// predate any budget -- 318 with creator_mode NULL and 9 'advent' -- and no
// measurement says they would pass one, so enforcing it would retroactively
// invalidate real data. The two V1 populations are both empty, which is what
// makes hard rejection safe for them.
const assertWithinEconomy = ({ economy, gear, commonItems, characterClassId, earnedMerx = 0 }) => {
  if (economy === 'advent') return;

  const items = Array.isArray(gear) ? gear.filter(Boolean) : [];
  const cap = SIGNATURE_CAP[economy];
  const slots = signatureSlotsUsed(items);
  if (cap !== null && slots > cap) {
    throw new Error(
      `Signature Cap is ${cap}; this character carries ${slots} `
      + '(an Enchantment counts as a Signature).'
    );
  }

  const budget = CREATION_GRANT[economy] + Math.max(0, Number(earnedMerx) || 0);
  const itemCount = Array.isArray(commonItems) ? commonItems.length : 0;
  const spend = equipmentSpend(items, { economy, characterClassId })
    + itemCount * COMMON_ITEM_PRICE;
  if (spend > budget) {
    throw new Error(`This character spends ${spend} Merx of ${budget}.`);
  }
};
```

Call it from `normalizeWizardPayload`, after `validateAspiringBuild` and before the return, resolving the economy the same way Task 4 does. The wizard payload carries `class_id` but not `content_format`, so the caller must supply it — thread the class row's `content_format` in from `CharacterService.createCharacter`, which already resolves the class, rather than adding a query inside the normaliser.

Replace the comment at `services/character/input.js:184-186`. It currently says the budgets stay client-side because mirroring them "would give the economy two sources of truth that can drift." That is no longer the arrangement and the comment would be false:

```js
// Structural invariants, plus the Merx budget and Signature Cap for the two
// V1 economies. The figures are not restated here -- util/merx-economy.js is
// the single definition, and routes/characters.js serves the same module to the
// wizard -- so there is one source of truth rather than a mirror of one.
```

- [ ] **Step 4: Derive `commissary_reward` at creation**

The wizard hardcodes `commissary_reward: 0` in its payload. For the two V1 economies the server now knows the right answer, so compute it rather than storing the client's number. In `CharacterService.createCharacter`, for a non-advent economy, set `characterInput.commissary_reward` from `deriveCharacterTotals`' reward using the same arguments the update path already passes at `services/character/service.js:237-247`. Add to `services/character/service.test.js`:

```js
test('a created V1 character keeps the Merx it did not spend', async () => {
  // Four own-class Signatures cost 8 of the 12-Merx grant.
  const { service, saved } = makeServiceOnAspirantClass({});
  await service.createCharacter(ACTOR, {
    name: 'Thrifty', class_id: ASPIRANT_CLASS_ID, creator_mode: 'aspirant',
    gear: Array.from({ length: 4 }, (_, i) => ({ name: `S${i}`, class_id: ASPIRANT_CLASS_ID })),
    commissary_reward: 0
  });
  expect(saved.commissary_reward).toBe(4);
});

test('a created Advent character keeps the reward it submitted', async () => {
  const { service, saved } = makeServiceOnAdventClass({});
  await service.createCharacter(ACTOR, {
    name: 'Legacy', class_id: ADVENT_CLASS_ID, creator_mode: 'advent',
    gear: [], commissary_reward: 7
  });
  expect(saved.commissary_reward).toBe(7);
});
```

- [ ] **Step 5: Run everything**

```bash
bun test services/character/input.test.js
bun test services/character/service.test.js
bun run test:unit
bun run check
```
Expected: green, and the Advent cases must be untouched.

- [ ] **Step 6: Confirm no existing character would now be rejected**

The enforcement only runs for non-advent economies, and both are empty — but prove it rather than asserting it:

```bash
eval "$(supabase status -o env)"
psql "$DB_URL" -At -c "select count(*) from characters c join classes cl on cl.id = c.class_id where cl.content_format = 'aspirant' or c.creator_mode = 'aspiring';"
```
Expected: `0`. If it is not 0, stop: a stored character would now fail to save, and this task needs a migration or a grandfather clause that this plan does not have.

- [ ] **Step 7: Commit**

```bash
git add services/character/input.js services/character/service.js services/character/input.test.js services/character/service.test.js
git commit -m "feat: enforce the Merx budget and Signature Cap for V1 characters"
```

---

### Task 10: Correct the false price in the wizard copy

`views/character-wizard.handlebars:282` tells an Aspirant player they may spend on "signature items from any class (2 Merx)". The code charges 3 for another class's item (`public/js/character-wizard.js:2423`) and the book agrees with the code: "3 Merx — Acquire a Cross-Class Signature Item" (pg. 85). The copy is the only one of the three price sources that is wrong, and a player reading it plans a build they cannot afford.

Plan 2 replaces this prose with figures read from the shared module. This task fixes the falsehood now, because it is one line and a player can read it today.

**Files:**
- Modify: `views/character-wizard.handlebars:282`
- Test: `routes/character-wizard.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add to `routes/character-wizard.test.js`, which already renders the wizard and asserts against its HTML:

```js
test('the aspirant gear step names both Signature prices', async () => {
  const body = await getWizard('?mode=aspirant');
  // pg. 85: 2 Merx for your own Class's Signature, 3 for a Cross-Class one.
  // public/js/character-wizard.js charges both; the copy has to say both.
  expect(body).toContain('3 Merx');
  expect(body).not.toMatch(/signature items from any class \(2 Merx\)/i);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test routes/character-wizard.test.js
```
Expected: FAIL on the `not.toMatch` — the copy is present.

- [ ] **Step 3: Fix the copy**

The current text at `:282`:

```
      Aspirant mode: no starting gear. You have <strong>12 Merx</strong> to spend on any combination of common items (1 Merx) or signature items from any class (2 Merx). Duplicates are allowed.
```

Replace with:

```
      Aspirant mode: no starting gear. You have <strong>12 Merx</strong> to spend on any combination of common items (1 Merx), your own class's signature items (2 Merx), or another class's (3 Merx). Duplicates are allowed.
```

- [ ] **Step 4: Run and commit**

```bash
bun test routes/character-wizard.test.js
bun run test:unit
git add views/character-wizard.handlebars routes/character-wizard.test.js
git commit -m "fix: name the cross-class Signature price in the wizard copy"
```

---

## Success criteria

Checked at the end, measured rather than asserted:

- [ ] No **server-side** module defines a price any more. Proved by grep: `GEAR_ON_CLASS_COST`, `GEAR_OFF_CLASS_COST` and `COMMON_ITEM_COST` appear nowhere outside `util/merx-economy.js` and its test. The wizard client's own constants (`CLASS_GEAR_COST`, `CROSS_CLASS_GEAR_COST`, `ADVENT_MERX_BUDGET`, `ASPIRANT_MERX_BUDGET`, `ASPIRING_MERX_BUDGET`, `FREE_BASE_GEAR_COUNT`) are **still present** after this plan and are deleted by plan 2, which is what gives the browser the module's figures to read instead. Until then the client keeps its own copy of prices that agree with the module — verify they agree, and record any that do not.
- [ ] Every figure is mutation-pinned: each of the four mutations in Task 2 Step 5 fails a named test.
- [ ] A V1 character holding twelve own-class Signatures with no missions is **not** reported in deficit by the old arithmetic — `spend` is 24 against an `earned` of 12, not 16 against 0.
- [ ] The advent branch is unchanged to the digit: every `util/character-derived.test.js` case that existed before this plan still passes unedited.
- [ ] `class_gear.enchantment` and `class_gear.mods` exist with their four CHECK constraints, and the 1492 pre-existing rows are unchanged — `enchantment` null and `mods` `'[]'` for all of them.
- [ ] A save that omits both fields preserves them, through the RPC and through the JS fallback.
- [ ] A save that exceeds the budget or the Signature Cap is refused for `aspirant` and `aspiring`, and refused for nothing else.
- [ ] Zero characters are rejected that could previously be saved: the query in Task 9 Step 6 returns 0.
- [ ] `bun run test:unit` green, `bun run check` exit 0, `bun run test:e2e` at the known 6 pre-existing failures, `bun run test:integration` with `class-form-round-trip` at its known 2 pass / 1 fail.
- [ ] The word counter is measured against the book's own content, not only fixtures: all 144 printed Default Enchantments count within 40 words with ratings excluded, and exactly 5 would breach the limit without the exclusion.
- [ ] No comment added by this plan states anything untrue of the code beside it.

## Deliberately not in this plan

- **Every purchase surface.** The wizard's twelve-Signature chooser, the Enchantment and Mod controls, the edit-form purchase path and the character page's display of what was bought are plan 2. This plan makes the economy real and enforced; nothing in the UI offers the new purchases yet, so the enforcement has nothing to reject in practice until plan 2 lands.
- **The Perk economy** — Advanced Ability unlocks at 2 Perks, Cross-Classing at 3 and 4, the six-Ability cap, and the Compounded mechanic Aspirant defers to Advent (pg. 7). Slice 4b. Task 1 stops the wizard granting Advanced Abilities wrongly; it does not build the way to buy them.
- **Stat Training** (pg. 87), **Flavor refunds** (pp. 104–110), **Loadout and encumbrance** (pg. 88), **Companions as a Signature subtype** (pp. 8, 89), **High-Stakes mission Merx** (pg. 97), and the **pg. 2 Advent conversion**.
- **Budget enforcement for Advent characters**, for the reason in Task 9's comment.
- **"A Custom Enchantment may never be stronger than the Default"** (pg. 86) — a judgment the book gives the playgroup, with no approval machinery in the app to hang it on.
