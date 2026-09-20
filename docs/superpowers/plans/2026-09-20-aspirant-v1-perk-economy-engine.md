# Perk Economy Engine Implementation Plan (slice 4b, plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ENCLAVE a Perk currency — one definition module, a derived balance, an ability cap, and a grandfathering ratchet — so that every character's Perk spending is counted and every illegal build says which rule it is outside.

**Architecture:** A third pure currency module, `util/perk-economy.js`, beside `util/merx-economy.js` (Merx) and `util/stat-caps.js` (Pluses), holding every Perk figure and all arithmetic over them. One new column, `characters.aspiring_abilities`, because an aspiring character's ability picks are selected at creation but bought later or never. The balance derives on read; enforcement compares a stored build against a submitted one so existing breaches are grandfathered without a stored allowance.

**Tech Stack:** Bun, `bun:test`, Express 4, express-handlebars, Supabase/Postgres (plpgsql RPC). `util/` and `services/` are CommonJS.

**Spec:** `docs/superpowers/specs/2026-09-20-aspirant-v1-perk-economy-design.md`

## Global Constraints

- **NEVER run `supabase db reset`.** The local database holds a restored copy of production data, not seed data. Apply migrations with `supabase migration up` only. **Never read or restore anything under `backups/`.**
- Before any database-touching step, run `eval "$(supabase status -o env)"; echo "API_URL=$API_URL"; grep -E '^SUPABASE_URL=' .env` — `API_URL` **must** print `http://127.0.0.1:54321` and `.env` must name the same host, or stop and report.
- `bun run test:unit` is always safe (it overrides `SUPABASE_URL` to `https://test.invalid`). `bun test <file>` directly does **NOT** get that override — never use it, even for a browser-only file. Use `bun run test:unit`, `bun run test:http`, `bun run test:integration`, `bun run test:e2e`.
- **Baseline, measured 2026-09-20:** `bun run test:unit` is 185 files, 2292 pass, 0 fail, exit 0. Any task that ends with a different failure count has introduced a regression.
- Row counts must not change: characters 327, traits 981, class_gear 1492, class_abilities 916, classes 62, **character_perks 45**.
- Prices, grants, caps and word limits are written down in exactly one place: `util/perk-economy.js`. No browser file, view, route or service may contain a Perk number as a literal.
- Comments describe the code as it is now. Never "was X, now Y", never "new implementation", never a changelog note. That history belongs in git.
- When you replace something, delete the thing it replaced in the same change. No `_old` copies, no fallbacks, no deprecation paths.
- Page references are PRINTED pages of ENCLAVE: Aspirant V1 (PDF page = printed + 5) unless marked Advent.
- Every commit message ends with a blank line, then:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
  ```
  The blank line matters: without it the subject line absorbs the trailers.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `util/perk-economy.js` (create) | Every Perk figure and all arithmetic over them. Pure; one `require`. |
| `util/perk-economy.test.js` (create) | Unit coverage for the whole table and every branch. |
| `util/merx-economy.js` (modify) | Loses `ABILITY_CAP` entirely. |
| `util/validate.js` (modify) | Reads its perk limits from `perk-economy`; grants a compound +5 words. |
| `util/character-derived.js` (modify) | Gains `derivePerkBreakdown`, wired into `deriveCharacterTotals`. |
| `supabase/migrations/20260921000000_characters_aspiring_abilities.sql` (create) | The column and its CHECK. |
| `supabase/migrations/20260921000001_save_character_atomic_aspiring_abilities.sql` (create) | The RPC carries the new column. |
| `services/character/input.js` (modify) | Shapes and validates the pool; adds ability terms to the economy gate. |
| `services/character/service.js` (modify) | The ratchet; feeds abilities to the derivation; fixes the compound ordering trap. |
| `routes/characters.js` (modify) | Serves the Perk breakdown and breaches to the character page; closes the classic-POST bypass. |
| `views/character.handlebars` (modify) | Renders the breakdown and the two notices. |

---

### Task 1: The Perk figures

**Files:**
- Create: `util/perk-economy.js`
- Create: `util/perk-economy.test.js`
- Modify: `util/merx-economy.js:38-40` and its export list

**Interfaces:**
- Consumes: `normalizeLevel` from `util/stat-caps.js` (exported there; clamps to a whole number in `[1, 20]`).
- Produces: `ABILITY_PRICE`, `FREE_CORE_ABILITIES`, `PERK_GRANT`, `PERKS_PER_LEVEL`, `ABILITY_PERK_COST`, `PERK_WORD_LIMIT`, `COMPOUND_WORD_BONUS`, `PERKS_PER_ABILITY`, `ABILITY_CAP`, `priceOfAbility({crossClass, type}) -> number`, `perkAllotment({economy, level}) -> number|null`, `perkWordLimitFor({compound}) -> number`, `perkFigures() -> object`.

- [ ] **Step 1: Write the failing test**

Create `util/perk-economy.test.js`:

```js
const { test, expect } = require('bun:test');
const {
  priceOfAbility,
  perkAllotment,
  perkWordLimitFor,
  perkFigures,
  ABILITY_CAP,
  FREE_CORE_ABILITIES,
  PERK_GRANT,
  PERKS_PER_LEVEL,
  ABILITY_PERK_COST,
  PERK_WORD_LIMIT,
  COMPOUND_WORD_BONUS,
  PERKS_PER_ABILITY
} = require('./perk-economy');

test('every cell of the ability price table matches the book', () => {
  // pg. 90 step 3b: an aspiring character's own-pool Core costs 1 Perk.
  expect(priceOfAbility({ crossClass: false, type: 'core' })).toBe(1);
  // pg. 7: "Unlocking an Advanced Ability from your own Class costs 2 Perks".
  expect(priceOfAbility({ crossClass: false, type: 'advanced' })).toBe(2);
  // pg. 7: "Cross-Classing a Core Ability costs 3 Perks, and an Advanced
  // Ability costs 4 Perks".
  expect(priceOfAbility({ crossClass: true, type: 'core' })).toBe(3);
  expect(priceOfAbility({ crossClass: true, type: 'advanced' })).toBe(4);
});

test('cross-class is uniformly +2 over own at every tier', () => {
  for (const type of ['core', 'advanced']) {
    expect(priceOfAbility({ crossClass: true, type })
      - priceOfAbility({ crossClass: false, type })).toBe(2);
  }
});

test('an unknown ability type is priced as core, never as undefined', () => {
  expect(priceOfAbility({ crossClass: false, type: undefined })).toBe(1);
  expect(priceOfAbility({ crossClass: false, type: 'nonsense' })).toBe(1);
  expect(priceOfAbility({})).toBe(1);
});

test('the figures match the book and the supplied Advent rates', () => {
  expect(PERK_GRANT).toEqual({ advent: 0, aspirant: 1, aspiring: 3 });
  expect(FREE_CORE_ABILITIES).toEqual({ advent: 3, aspirant: 3, aspiring: 0 });
  expect(ABILITY_CAP).toEqual({ advent: 3, aspirant: 6, aspiring: 4 });
  expect(PERKS_PER_LEVEL).toBe(1);
  expect(ABILITY_PERK_COST).toBe(1);
  expect(PERK_WORD_LIMIT).toBe(25);
  expect(COMPOUND_WORD_BONUS).toBe(5);
  expect(PERKS_PER_ABILITY).toBe(5);
});

test('a level-1 character holds only its creation grant', () => {
  expect(perkAllotment({ economy: 'advent', level: 1 })).toBe(0);
  expect(perkAllotment({ economy: 'aspirant', level: 1 })).toBe(1);
  expect(perkAllotment({ economy: 'aspiring', level: 1 })).toBe(3);
});

test('each level past the first grants one more Perk', () => {
  expect(perkAllotment({ economy: 'advent', level: 10 })).toBe(9);
  expect(perkAllotment({ economy: 'aspirant', level: 10 })).toBe(10);
  expect(perkAllotment({ economy: 'aspiring', level: 4 })).toBe(6);
});

test('perkAllotment counts levels exactly as plusAllotment does', () => {
  const { plusAllotment, CREATION_PLUSES, LEVEL_PLUSES_PER_LEVEL } = require('./stat-caps');
  // Same shape, different table: grant + perLevel * (level - 1). A Perk table
  // that counted levels differently from the Pluses table would be a bug
  // waiting for someone to notice.
  for (const level of [1, 2, 7, 20]) {
    expect(plusAllotment({ economy: 'aspirant', level })).toBe(
      CREATION_PLUSES.aspirant + LEVEL_PLUSES_PER_LEVEL * (level - 1)
    );
    expect(perkAllotment({ economy: 'aspirant', level })).toBe(
      PERK_GRANT.aspirant + PERKS_PER_LEVEL * (level - 1)
    );
  }
});

test('perkAllotment clamps a junk level rather than trusting it', () => {
  expect(perkAllotment({ economy: 'advent', level: 0 })).toBe(0);
  expect(perkAllotment({ economy: 'advent', level: -5 })).toBe(0);
  expect(perkAllotment({ economy: 'advent', level: Infinity })).toBe(19);
  expect(perkAllotment({ economy: 'advent', level: 'seven' })).toBe(0);
});

test('perkAllotment returns null for an economy it has no figure for', () => {
  expect(perkAllotment({ economy: 'nonsense', level: 3 })).toBeNull();
  expect(perkAllotment({})).toBeNull();
});

test('a compound gets five more words than a baseline perk', () => {
  expect(perkWordLimitFor({ compound: false })).toBe(25);
  expect(perkWordLimitFor({ compound: true })).toBe(30);
  expect(perkWordLimitFor()).toBe(25);
});

test('perkFigures is plain data and a fresh object each call', () => {
  const a = perkFigures();
  const b = perkFigures();
  expect(a).toEqual(b);
  expect(a).not.toBe(b);
  a.grants.advent = 99;
  expect(perkFigures().grants.advent).toBe(0);
  expect(a.prices.ability.cross.advanced).toBe(4);
  expect(a.abilityCap.aspiring).toBe(4);
});

test('perk-economy requires nothing but stat-caps', () => {
  const source = require('fs').readFileSync(require.resolve('./perk-economy'), 'utf8');
  const requires = [...source.matchAll(/require\((['"])(.*?)\1\)/g)].map(m => m[2]);
  expect(requires).toEqual(['./stat-caps']);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:unit`
Expected: FAIL — `Cannot find module './perk-economy'`.

- [ ] **Step 3: Write the module**

Create `util/perk-economy.js`:

```js
// The Perk economy ENCLAVE: Aspirant V1 prints on page 7, with the grants and
// caps from pages 3, 90 and 92, and the three figures Aspirant defers to
// Advent -- the earn rate, the Ability Perk cost and the Compound rule --
// supplied by the project owner and recorded in the spec under "Rules supplied
// outside the book".
//
// This is the only place these figures are written down, so that every
// consumer -- a derivation, a validator, a browser view -- reads the same
// numbers instead of keeping its own copy. The third currency module, beside
// util/merx-economy.js (Merx) and util/stat-caps.js (Pluses).
//
// Both siblings are require-free. This module takes exactly one require, and
// only because util/stat-caps.js asks for it: normalizeLevel is exported there
// expressly so callers read the level clamp rather than re-deriving it, since
// two independent copies is how a level-gated rule silently desyncs. Nothing
// else is imported, and no class, pool or economy is resolved here -- every
// consumer passes what it knows.
const { normalizeLevel } = require('./stat-caps');

// pg. 7: "Unlocking an Advanced Ability from your own Class costs 2 Perks";
// "Cross-Classing a Core Ability costs 3 Perks, and an Advanced Ability costs
// 4 Perks". pg. 90 step 3b prices an aspiring character's own-pool Core at 1.
//
// Cross-Class is uniformly +2 over own at every tier, written out rather than
// expressed as `own + 2` for the same reason SIGNATURE_PRICE is
// (util/merx-economy.js): a future edition can break the pattern without a
// rewrite here.
const ABILITY_PRICE = {
    own: { core: 1, advanced: 2 },
    cross: { core: 3, advanced: 4 }
};

// pg. 7: "In addition to their three Core Abilities". Those three are free,
// which is exactly why the book never prints an own-Core price: for advent and
// aspirant that cell can never be charged, because a character's own Core
// roster IS the allowance. pg. 90 gives an aspiring character no allowance at
// all -- its two Core picks cost 1 Perk each -- which is the only way the
// own/core cell is ever reached.
const FREE_CORE_ABILITIES = { advent: 3, aspirant: 3, aspiring: 0 };

// pg. 3: "Characters start with a Perk, which they may use immediately or save
// for later", listed under "Changes to Character Creation" beside the 12-Merx
// change -- so the starting Perk is Aspirant's addition and Advent grants none.
// pg. 90 step 5: an aspiring character starts with 3.
const PERK_GRANT = { advent: 0, aspirant: 1, aspiring: 3 };

// Advent's rate. ENCLAVE: Aspirant V1 says progression works "exactly as
// outlined in Advent" (pg. 3) and does not restate it; supplied by the project
// owner.
const PERKS_PER_LEVEL = 1;

// Advent's rate, supplied with it: applying a Perk to an Ability costs one
// Perk. A Compound is a separate character_perks row, so it costs one more
// simply by being a row -- which is why perkSpend has no compound term.
const ABILITY_PERK_COST = 1;

// Advent pg. 30 by way of pg. 7's cross-reference, supplied verbatim:
// "Compounding an existing Perk, strengthening what that Perk already does and
// increasing its maximum length by +5 words (still counts towards Perk cap)."
// The parenthetical is already true without code: a compound is its own row,
// so it already occupies one of the PERKS_PER_ABILITY slots.
const PERK_WORD_LIMIT = 25;
const COMPOUND_WORD_BONUS = 5;
const PERKS_PER_ABILITY = 5;

// pg. 7: "A character may never have more than six total Abilities, and this
// cap cannot be increased, even via Flavor". pg. 92: aspiring "may never have
// more than four total Abilities".
//
// Advent reads 3, not null. Its siblings use null for "the rules this app
// models state no cap" (SIGNATURE_CAP.advent, util/merx-economy.js), and that
// is not the case here: Advent has no unlock path whatsoever, so its three
// Core Abilities are the entire roster a character can hold. Three is the true
// figure, not an absent one.
const ABILITY_CAP = { advent: 3, aspirant: 6, aspiring: 4 };

const tier = (crossClass) => (crossClass ? 'cross' : 'own');

// Anything that is not the literal 'advanced' is a Core ability. The database
// CHECK on class_abilities.type already admits only 'core' and 'advanced', so
// this only ever absorbs an unset field on an unsaved submission.
const rank = (type) => (type === 'advanced' ? 'advanced' : 'core');

const priceOfAbility = ({ crossClass, type } = {}) => ABILITY_PRICE[tier(crossClass)][rank(type)];

// grant + perLevel * (level - 1), identical in shape to plusAllotment
// (util/stat-caps.js), so a level-1 character holds only its creation grant.
// null for an economy this module has no figure for, so a caller must decide
// what to do rather than silently enforcing zero.
const perkAllotment = ({ economy, level } = {}) => {
    const base = PERK_GRANT[economy];
    if (base == null) return null;
    return base + PERKS_PER_LEVEL * (normalizeLevel(level) - 1);
};

const perkWordLimitFor = ({ compound } = {}) =>
    PERK_WORD_LIMIT + (compound ? COMPOUND_WORD_BONUS : 0);

// The whole economy as plain data, for a consumer that cannot require this
// module -- a browser IIFE reading a JSON island. Built by calling the pricing
// function rather than restating the table, so there is still exactly one
// place a price is written down. Returns a fresh object each call.
const perkFigures = () => ({
    grants: { ...PERK_GRANT },
    perksPerLevel: PERKS_PER_LEVEL,
    abilityCap: { ...ABILITY_CAP },
    freeCoreAbilities: { ...FREE_CORE_ABILITIES },
    abilityPerkCost: ABILITY_PERK_COST,
    perkWordLimit: PERK_WORD_LIMIT,
    compoundWordBonus: COMPOUND_WORD_BONUS,
    perksPerAbility: PERKS_PER_ABILITY,
    prices: {
        ability: {
            own: {
                core: priceOfAbility({ crossClass: false, type: 'core' }),
                advanced: priceOfAbility({ crossClass: false, type: 'advanced' })
            },
            cross: {
                core: priceOfAbility({ crossClass: true, type: 'core' }),
                advanced: priceOfAbility({ crossClass: true, type: 'advanced' })
            }
        }
    }
});

module.exports = {
    priceOfAbility,
    perkAllotment,
    perkWordLimitFor,
    perkFigures,
    ABILITY_PRICE,
    FREE_CORE_ABILITIES,
    PERK_GRANT,
    PERKS_PER_LEVEL,
    ABILITY_PERK_COST,
    PERK_WORD_LIMIT,
    COMPOUND_WORD_BONUS,
    PERKS_PER_ABILITY,
    ABILITY_CAP
};
```

- [ ] **Step 4: Delete `ABILITY_CAP` from `util/merx-economy.js`**

Remove these three lines (currently `util/merx-economy.js:38-40`):

```js
// pg. 7: "A character may never have more than six total Abilities, and this
// cap cannot be increased". pg. 92: aspiring may never have more than four.
const ABILITY_CAP = { advent: null, aspirant: 6, aspiring: 4 };
```

and remove `ABILITY_CAP,` from the `module.exports` list at the bottom of that file. Leave `SIGNATURE_CAP` and every other export untouched.

The comment above `SIGNATURE_CAP` cites pg. 92 for both the Signature Cap and the four-ability limit. Leave that comment exactly as it is — it is correct about the Signature Cap, which is what it now sits above.

- [ ] **Step 5: Delete the orphaned assertions in `util/merx-economy.test.js`**

That file asserts `ABILITY_CAP`'s raw values at roughly lines 19 and 66-67. Delete those assertions and the import of `ABILITY_CAP`. Do not move them to `perk-economy.test.js` — Step 1 already covers the same values there.

- [ ] **Step 6: Prove nothing else referenced it**

Run: `grep -rn "ABILITY_CAP" --include='*.js' --include='*.handlebars' . | grep -v node_modules`
Expected: hits only in `util/perk-economy.js` and `util/perk-economy.test.js`.

- [ ] **Step 7: Run the suite**

Run: `bun run test:unit`
Expected: 186 files, 0 fail, exit 0. The file count rises by one because this task adds a test file.

- [ ] **Step 8: Commit**

```bash
git add util/perk-economy.js util/perk-economy.test.js util/merx-economy.js util/merx-economy.test.js
git commit -m "$(cat <<'EOF'
feat: express the Aspirant Perk economy once

ABILITY_CAP moves here from merx-economy, where nothing but its own test
read it, and advent becomes 3: Advent has no unlock path, so its three
Core Abilities are the whole roster.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 2: Spend, balance and breaches

**Files:**
- Modify: `util/perk-economy.js` (append; do not restructure Task 1's code)
- Modify: `util/perk-economy.test.js` (append)

**Interfaces:**
- Consumes: Task 1's `priceOfAbility`, `perkAllotment`, `FREE_CORE_ABILITIES`, `ABILITY_CAP`, `ABILITY_PERK_COST`.
- Produces:
  - `unlockSpend(abilities, economy) -> number`
  - `perkSpend({economy, abilities, abilityPerks}) -> number`
  - `perkBreakdown({economy, level, abilities, abilityPerks}) -> {earned, spend, remaining, deficit} | null`
  - `buildBreaches({economy, level, abilities, abilityPerks}) -> Array<{severity, rule, count, limit, overage, detail}>`
  - `worsenedBreaches(storedBreaches, submittedBreaches) -> Array<breach>`
  - Rule name constants `ABILITY_CAP_RULE`, `PERK_DEFICIT_RULE`, `CROSS_CLASS_EDITION_RULE`.

**Ability shape.** Every function here takes abilities as `[{ crossClass: boolean, type: 'core'|'advanced' }]` — already tagged by the caller. This module resolves no class and no pool, exactly like its siblings. Callers build that shape in Task 9.

- [ ] **Step 1: Write the failing test**

Append to `util/perk-economy.test.js`:

```js
const {
  unlockSpend,
  perkSpend,
  perkBreakdown,
  buildBreaches,
  worsenedBreaches,
  ABILITY_CAP_RULE,
  PERK_DEFICIT_RULE,
  CROSS_CLASS_EDITION_RULE
} = require('./perk-economy');

const own = (type) => ({ crossClass: false, type });
const cross = (type) => ({ crossClass: true, type });

test('an aspirant character pays nothing for its three own Core abilities', () => {
  expect(unlockSpend([own('core'), own('core'), own('core')], 'aspirant')).toBe(0);
});

test('an aspirant character pays 2 for its own Advanced ability', () => {
  expect(unlockSpend(
    [own('core'), own('core'), own('core'), own('advanced')], 'aspirant'
  )).toBe(2);
});

test('cross-class abilities are charged at 3 and 4 regardless of the allowance', () => {
  expect(unlockSpend(
    [own('core'), own('core'), own('core'), cross('core'), cross('advanced')], 'aspirant'
  )).toBe(7);
});

test('a fourth own Core ability is charged, because the allowance is three', () => {
  expect(unlockSpend(
    [own('core'), own('core'), own('core'), own('core')], 'aspirant'
  )).toBe(1);
});

test('the allowance is order-independent', () => {
  const list = [cross('advanced'), own('core'), own('core'), own('advanced'), own('core')];
  const reversed = [...list].reverse();
  expect(unlockSpend(list, 'aspirant')).toBe(unlockSpend(reversed, 'aspirant'));
});

test('an aspiring character has no allowance and pays 1/1/2 for its picks', () => {
  expect(unlockSpend([own('core'), own('core'), own('advanced')], 'aspiring')).toBe(4);
});

test('an aspiring character pays 3 or 4 for anything outside its pool', () => {
  expect(unlockSpend([cross('core')], 'aspiring')).toBe(3);
  expect(unlockSpend([cross('advanced')], 'aspiring')).toBe(4);
});

test('an advent character pays nothing for three own Core abilities', () => {
  expect(unlockSpend([own('core'), own('core'), own('core')], 'advent')).toBe(0);
});

test('unlockSpend tolerates junk entries and a non-array', () => {
  expect(unlockSpend(null, 'aspirant')).toBe(0);
  expect(unlockSpend([null, undefined, false], 'aspirant')).toBe(0);
  expect(unlockSpend([own('core')], 'nonsense')).toBe(1);
});

test('every Ability Perk costs one, and a compound costs one more by being a row', () => {
  // A compound is a SEPARATE character_perks row pointing at the perk it
  // improves, so counting rows already charges 2 Perks for a compounded perk.
  const base = { id: 'p1', compounds_with: null };
  const compound = { id: 'p2', compounds_with: 'p1' };
  expect(perkSpend({ economy: 'aspirant', abilities: [], abilityPerks: [base] })).toBe(1);
  expect(perkSpend({ economy: 'aspirant', abilities: [], abilityPerks: [base, compound] })).toBe(2);
});

test('perkSpend adds unlocks to Ability Perks', () => {
  expect(perkSpend({
    economy: 'aspirant',
    abilities: [own('core'), own('core'), own('core'), own('advanced')],
    abilityPerks: [{ id: 'p1' }, { id: 'p2' }]
  })).toBe(4);
});

test('perkBreakdown reports earned, spend, remaining and deficit', () => {
  expect(perkBreakdown({
    economy: 'aspiring',
    level: 1,
    abilities: [own('core'), own('core')],
    abilityPerks: []
  })).toEqual({ earned: 3, spend: 2, remaining: 1, deficit: 0 });
});

test('perkBreakdown never reports a negative remaining', () => {
  const result = perkBreakdown({
    economy: 'aspiring',
    level: 1,
    abilities: [own('core'), own('core'), own('advanced')],
    abilityPerks: []
  });
  expect(result).toEqual({ earned: 3, spend: 4, remaining: 0, deficit: 1 });
});

test('an aspiring character cannot buy all three picks at creation, by design', () => {
  // pg. 90 grants 3 Perks for picks costing 1 + 1 + 2 = 4, and step 3b says
  // the picks need not be acquired "immediately (or at all)".
  const all = perkBreakdown({
    economy: 'aspiring', level: 1,
    abilities: [own('core'), own('core'), own('advanced')], abilityPerks: []
  });
  expect(all.deficit).toBe(1);
  const two = perkBreakdown({
    economy: 'aspiring', level: 1,
    abilities: [own('core'), own('advanced')], abilityPerks: []
  });
  expect(two.deficit).toBe(0);
  expect(two.remaining).toBe(0);
});

test('perkBreakdown returns null for an unknown economy', () => {
  expect(perkBreakdown({ economy: 'nonsense', level: 1, abilities: [], abilityPerks: [] })).toBeNull();
});

test('a clean build produces no breaches', () => {
  expect(buildBreaches({
    economy: 'aspirant', level: 5,
    abilities: [own('core'), own('core'), own('core')], abilityPerks: []
  })).toEqual([]);
});

test('over the ability cap is a hard breach carrying its overage', () => {
  const breaches = buildBreaches({
    economy: 'advent', level: 1,
    abilities: [own('core'), own('core'), own('core'), own('core'), own('core'), own('core')],
    abilityPerks: []
  });
  const cap = breaches.find(b => b.rule === ABILITY_CAP_RULE);
  expect(cap.severity).toBe('hard');
  expect(cap.count).toBe(6);
  expect(cap.limit).toBe(3);
  expect(cap.overage).toBe(3);
  expect(cap.detail).toBe('6 Abilities, and the cap is 3.');
});

test('spending more Perks than earned is a hard breach whose overage is the deficit', () => {
  const breaches = buildBreaches({
    economy: 'advent', level: 3,
    abilities: [own('core')],
    abilityPerks: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
  });
  const deficit = breaches.find(b => b.rule === PERK_DEFICIT_RULE);
  expect(deficit.severity).toBe('hard');
  expect(deficit.count).toBe(4);
  expect(deficit.limit).toBe(2);
  expect(deficit.overage).toBe(2);
});

test('an advent character holding a cross-class ability gets the softer notice', () => {
  const breaches = buildBreaches({
    economy: 'advent', level: 5,
    abilities: [own('core'), own('core'), cross('core')], abilityPerks: []
  });
  const edition = breaches.find(b => b.rule === CROSS_CLASS_EDITION_RULE);
  expect(edition.severity).toBe('soft');
  expect(edition.count).toBe(1);
  expect(edition.detail).toContain('Cross-Classing is an Aspirant rule');
});

test('an aspirant character holding a cross-class ability gets no edition notice', () => {
  // Cross-Classing is legal there and priced, not flagged.
  const breaches = buildBreaches({
    economy: 'aspirant', level: 10,
    abilities: [own('core'), own('core'), own('core'), cross('core')], abilityPerks: []
  });
  expect(breaches.find(b => b.rule === CROSS_CLASS_EDITION_RULE)).toBeUndefined();
});

test('the ratchet passes a stored breach through unchanged', () => {
  // Aisuna Kor-Ragna: 6 abilities at level 1, advent. Must stay saveable.
  const six = Array(6).fill(null).map(() => own('core'));
  const args = { economy: 'advent', level: 1, abilities: six, abilityPerks: [] };
  const stored = buildBreaches(args);
  const submitted = buildBreaches(args);
  expect(worsenedBreaches(stored, submitted)).toEqual([]);
});

test('the ratchet refuses a save that makes a stored breach worse', () => {
  const six = Array(6).fill(null).map(() => own('core'));
  const stored = buildBreaches({ economy: 'advent', level: 1, abilities: six, abilityPerks: [] });
  const submitted = buildBreaches({
    economy: 'advent', level: 1, abilities: [...six, own('core')], abilityPerks: []
  });
  const worsened = worsenedBreaches(stored, submitted);
  expect(worsened).toHaveLength(1);
  expect(worsened[0].rule).toBe(ABILITY_CAP_RULE);
});

test('the ratchet lets a breached character improve toward legality', () => {
  const six = Array(6).fill(null).map(() => own('core'));
  const stored = buildBreaches({ economy: 'advent', level: 1, abilities: six, abilityPerks: [] });
  const submitted = buildBreaches({
    economy: 'advent', level: 1, abilities: six.slice(0, 4), abilityPerks: []
  });
  expect(worsenedBreaches(stored, submitted)).toEqual([]);
});

test('the ratchet refuses a brand-new breach on a previously clean character', () => {
  const stored = buildBreaches({
    economy: 'advent', level: 1,
    abilities: [own('core'), own('core'), own('core')], abilityPerks: []
  });
  expect(stored).toEqual([]);
  const submitted = buildBreaches({
    economy: 'advent', level: 1,
    abilities: [own('core'), own('core'), own('core'), own('core')], abilityPerks: []
  });
  expect(worsenedBreaches(stored, submitted)).toHaveLength(1);
});

test('the ratchet compares overage, so levelling up and spending the Perk is allowed', () => {
  // Khan Zahak Barzikani: 7 Ability Perks at level 7 (earned 6), deficit 1.
  // At level 8 he earns 7, and spending the new Perk keeps the deficit at 1.
  // Comparing raw spend would refuse that save; comparing overage allows it.
  const stored = buildBreaches({
    economy: 'advent', level: 7, abilities: [], abilityPerks: Array(7).fill({ id: 1 })
  });
  const submitted = buildBreaches({
    economy: 'advent', level: 8, abilities: [], abilityPerks: Array(8).fill({ id: 1 })
  });
  expect(stored.find(b => b.rule === PERK_DEFICIT_RULE).overage).toBe(1);
  expect(submitted.find(b => b.rule === PERK_DEFICIT_RULE).overage).toBe(1);
  expect(worsenedBreaches(stored, submitted)).toEqual([]);
});

test('the ratchet ignores soft breaches entirely', () => {
  // A soft notice is information, not a limit: an advent character swapping a
  // Core ability for a cross-class one stays saveable.
  const stored = buildBreaches({
    economy: 'advent', level: 5,
    abilities: [own('core'), own('core'), own('core')], abilityPerks: []
  });
  const submitted = buildBreaches({
    economy: 'advent', level: 5,
    abilities: [own('core'), own('core'), cross('core')], abilityPerks: []
  });
  expect(submitted.some(b => b.severity === 'soft')).toBe(true);
  expect(worsenedBreaches(stored, submitted)).toEqual([]);
});

test('worsenedBreaches tolerates a missing or non-array side', () => {
  expect(worsenedBreaches(null, null)).toEqual([]);
  expect(worsenedBreaches(undefined, [])).toEqual([]);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:unit`
Expected: FAIL — `unlockSpend is not a function`.

- [ ] **Step 3: Append the implementation**

Append to `util/perk-economy.js`, above `module.exports`:

```js
// An ability list is priced by waiving the first FREE_CORE_ABILITIES own-class
// Core abilities and charging everything else at its cell. Each entry arrives
// already tagged { crossClass, type }; resolving which class an ability
// belongs to, or whether it sits in an aspiring character's pool, is the
// caller's job.
//
// The waiver is order-independent: every waivable entry costs the same 1, so
// which three of four own Cores are waived cannot change the total.
const unlockSpend = (abilities, economy) => {
    const list = (Array.isArray(abilities) ? abilities : []).filter(Boolean);
    const free = FREE_CORE_ABILITIES[economy] ?? 0;
    let waived = 0;
    let spend = 0;
    for (const ability of list) {
        const crossClass = !!ability.crossClass;
        const type = rank(ability.type);
        if (!crossClass && type === 'core' && waived < free) {
            waived += 1;
            continue;
        }
        spend += priceOfAbility({ crossClass, type });
    }
    return spend;
};

// Deliberately no compound term. A Compound is its own character_perks row
// pointing at the perk it improves, so counting rows already charges 2 Perks
// for a compounded perk; adding a term for compounds_with would double-charge
// it.
const abilityPerkSpend = (abilityPerks) =>
    (Array.isArray(abilityPerks) ? abilityPerks.filter(Boolean) : []).length * ABILITY_PERK_COST;

const perkSpend = ({ economy, abilities, abilityPerks } = {}) =>
    unlockSpend(abilities, economy) + abilityPerkSpend(abilityPerks);

// null for an economy with no grant figure, mirroring perkAllotment, so a
// caller decides rather than being handed a zero that looks like an answer.
const perkBreakdown = ({ economy, level, abilities, abilityPerks } = {}) => {
    const earned = perkAllotment({ economy, level });
    if (earned == null) return null;
    const spend = perkSpend({ economy, abilities, abilityPerks });
    return {
        earned,
        spend,
        remaining: Math.max(0, earned - spend),
        deficit: Math.max(0, spend - earned)
    };
};

// Two severities.
//
// `hard` is a rule the book states as absolute -- pg. 7's cap "cannot be
// increased, even via Flavor" -- or a spend the character cannot pay for.
// `soft` is content legal in another edition but not in this character's:
// Advent has no Cross-Classing rule (pg. 3 lists it among Aspirant's
// additions), so an Advent character holding another class's Ability is
// outside its edition rather than over a limit.
//
// Every breach carries `overage`, the amount by which the rule is broken.
// That, not the raw count, is what the ratchet compares: a character who
// levels up and spends the new Perk has the same overage and is no worse off,
// while comparing raw spend would refuse that save.
const ABILITY_CAP_RULE = 'ability-cap';
const PERK_DEFICIT_RULE = 'perk-deficit';
const CROSS_CLASS_EDITION_RULE = 'cross-class-edition';

const buildBreaches = ({ economy, level, abilities, abilityPerks } = {}) => {
    const list = (Array.isArray(abilities) ? abilities : []).filter(Boolean);
    const breaches = [];

    const cap = ABILITY_CAP[economy];
    if (cap != null && list.length > cap) {
        breaches.push({
            severity: 'hard',
            rule: ABILITY_CAP_RULE,
            count: list.length,
            limit: cap,
            overage: list.length - cap,
            detail: `${list.length} Abilities, and the cap is ${cap}.`
        });
    }

    const breakdown = perkBreakdown({ economy, level, abilities, abilityPerks });
    if (breakdown && breakdown.deficit > 0) {
        breaches.push({
            severity: 'hard',
            rule: PERK_DEFICIT_RULE,
            count: breakdown.spend,
            limit: breakdown.earned,
            overage: breakdown.deficit,
            detail: `${breakdown.spend} Perks spent of ${breakdown.earned} earned.`
        });
    }

    if (economy === 'advent') {
        const crossCount = list.filter((ability) => ability.crossClass).length;
        if (crossCount > 0) {
            breaches.push({
                severity: 'soft',
                rule: CROSS_CLASS_EDITION_RULE,
                count: crossCount,
                limit: 0,
                overage: crossCount,
                detail: `${crossCount} Cross-Class ${crossCount === 1 ? 'Ability' : 'Abilities'}; `
                    + 'Cross-Classing is an Aspirant rule (pg. 3).'
            });
        }
    }

    return breaches;
};

// The ratchet. An existing breach is grandfathered: a save that leaves it as
// it stands goes through, and only one that makes it WORSE is refused. This
// is what lets 13 already-breaching characters stay editable without a stored
// per-character allowance -- the allowance IS the stored row.
//
// Soft breaches are excluded: a notice is information, not a limit.
const worsenedBreaches = (storedBreaches, submittedBreaches) => {
    const storedOverage = new Map(
        (Array.isArray(storedBreaches) ? storedBreaches : [])
            .map((breach) => [breach.rule, breach.overage])
    );
    return (Array.isArray(submittedBreaches) ? submittedBreaches : [])
        .filter((breach) => breach.severity === 'hard')
        .filter((breach) => breach.overage > (storedOverage.get(breach.rule) ?? 0));
};
```

Add to `module.exports`: `unlockSpend`, `perkSpend`, `perkBreakdown`, `buildBreaches`, `worsenedBreaches`, `ABILITY_CAP_RULE`, `PERK_DEFICIT_RULE`, `CROSS_CLASS_EDITION_RULE`.

- [ ] **Step 4: Run the tests**

Run: `bun run test:unit`
Expected: PASS, 186 files, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add util/perk-economy.js util/perk-economy.test.js
git commit -m "$(cat <<'EOF'
feat: derive a character's Perk balance and its rule breaches

The ratchet compares overage rather than raw spend, so a character who
levels up and spends the new Perk is no worse off and saves cleanly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 3: The Compound word bonus, and the ordering trap

**Files:**
- Modify: `util/validate.js:48-78`
- Modify: `services/character/service.js:905-928`
- Modify: `util/validate.test.js`

**Interfaces:**
- Consumes: `perkWordLimitFor`, `PERK_WORD_LIMIT`, `PERKS_PER_ABILITY` from `util/perk-economy.js` (Task 1).
- Produces: `validateAbilityPerks(perks, { wordLimit, perAbility })` unchanged in signature; a perk whose `compounds_with` is set is now allowed 30 words.

**The trap.** `services/character/service.js:905-924` builds its rows with `compounds_with: null` hardcoded and carries the real link in a parallel `meta` array, resolved *after* validation. So at the moment `validateAbilityPerks` sees them a compound is indistinguishable from a baseline perk and silently gets 25 words. Read that whole block before editing.

- [ ] **Step 1: Write the failing test**

Append to `util/validate.test.js`:

```js
const { PERK_WORD_LIMIT, COMPOUND_WORD_BONUS } = require('./perk-economy');

const words = (n) => Array(n).fill('word').join(' ');

test('a baseline perk is still held to 25 words', () => {
  const res = validateAbilityPerks([
    { class_ability_id: 'a1', text: words(26), compounds_with: null }
  ]);
  expect(res.ok).toBe(false);
  expect(res.errors[0]).toContain('at most 25 words');
});

test('a compound is allowed five more words than a baseline perk', () => {
  // Advent pg. 30: "increasing its maximum length by +5 words".
  const res = validateAbilityPerks([
    { class_ability_id: 'a1', text: words(30), compounds_with: 'p1' }
  ]);
  expect(res.ok).toBe(true);
});

test('a compound is still held to a limit, just a higher one', () => {
  const res = validateAbilityPerks([
    { class_ability_id: 'a1', text: words(31), compounds_with: 'p1' }
  ]);
  expect(res.ok).toBe(false);
  expect(res.errors[0]).toContain('at most 30 words');
});

test('the word limits come from perk-economy, not from literals here', () => {
  expect(PERK_WORD_LIMIT).toBe(25);
  expect(PERK_WORD_LIMIT + COMPOUND_WORD_BONUS).toBe(30);
});

test('a compound still counts toward the per-ability Perk cap', () => {
  // Advent pg. 30: "(still counts towards Perk cap)". True without special
  // handling, because a compound is its own row -- this test pins it so a
  // future refactor cannot quietly exempt it.
  const perks = Array(5).fill(null).map((_, i) => ({
    class_ability_id: 'a1', text: 'short', compounds_with: i === 4 ? 'p1' : null
  }));
  expect(validateAbilityPerks(perks).ok).toBe(true);
  perks.push({ class_ability_id: 'a1', text: 'short', compounds_with: 'p1' });
  const res = validateAbilityPerks(perks);
  expect(res.ok).toBe(false);
  expect(res.errors[0]).toContain('at most 5 perks per ability');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:unit`
Expected: FAIL — "a compound is allowed five more words" fails, because a 30-word compound is rejected at the flat 25-word limit.

- [ ] **Step 3: Teach `validateAbilityPerks` the compound bonus**

Replace the body of `validateAbilityPerks` in `util/validate.js`. Add at the top of the file, beside the existing requires:

```js
const { perkWordLimitFor, PERK_WORD_LIMIT, PERKS_PER_ABILITY } = require('./perk-economy');
```

Then:

```js
// `wordLimit` is the BASELINE limit; a perk that compounds another gets
// COMPOUND_WORD_BONUS more (Advent pg. 30, via util/perk-economy.js). Callers
// that pass an explicit wordLimit still get the bonus applied on top of it,
// which is what the custom-limit test expects.
function validateAbilityPerks(perks, { wordLimit = PERK_WORD_LIMIT, perAbility = PERKS_PER_ABILITY } = {}) {
  if (!Array.isArray(perks)) return { ok: true };

  const errors = [];
  const countsByAbility = new Map();

  for (let i = 0; i < perks.length; i++) {
    const perk = perks[i];
    if (!perk || typeof perk !== 'object') continue;

    const abilityId = perk.class_ability_id;
    const text = typeof perk.text === 'string' ? perk.text : '';
    const words = countWords(text);
    const limit = wordLimit + (perkWordLimitFor({ compound: !!perk.compounds_with }) - PERK_WORD_LIMIT);
    if (words > limit) {
      errors.push(`Perk #${i + 1}: must be at most ${limit} words (was ${words}).`);
    }

    if (abilityId) {
      const next = (countsByAbility.get(abilityId) || 0) + 1;
      countsByAbility.set(abilityId, next);
    }
  }

  for (const [abilityId, count] of countsByAbility.entries()) {
    if (count > perAbility) {
      errors.push(`Ability ${abilityId}: at most ${perAbility} perks per ability (had ${count}).`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun run test:unit`
Expected: PASS. The pre-existing test `validateAbilityPerks accepts custom limits` (`util/validate.test.js:107-112`) passes `{ wordLimit: 2 }` with no `compounds_with`, so its limit stays 2.

- [ ] **Step 5: Write the failing test for the ordering trap**

Append to `services/character/service.test.js` a test that saves a compound whose text is 28 words through the same path `services/character/service.js:924` validates, and asserts it is accepted. Model it on the nearest existing ability-perk save test in that file — find it with:

`grep -n "ability_perk\|abilityPerks" services/character/service.test.js | head -20`

Use that test's fixture construction verbatim rather than inventing one; it already builds the adapter stubs this path needs. The new test differs from it in exactly two ways: the perk's `text` is 28 words, and its `compounds_with` names the `ref` of a sibling perk in the same batch.

- [ ] **Step 6: Run it to make sure it fails**

Run: `bun run test:unit`
Expected: FAIL — the 28-word compound is rejected as over 25 words, because validation runs before the link is resolved.

- [ ] **Step 7: Fix the ordering**

In `services/character/service.js`, the block that currently reads:

```js
      rows.push({
        class_ability_id: classAbilityId,
        text,
        position: nextPosition,
        compounds_with: null
      });
      meta.push({
        ref: typeof p.ref === 'string' ? p.ref : null,
        compoundsWith: p.compounds_with == null ? null : String(p.compounds_with)
      });
```

keeps writing `compounds_with: null` into `rows` — that is correct, because the real id is not known until the batch is assigned positions. Change only the validation call so it sees which rows are compounds:

```js
    if (rows.length === 0) return { data: [], error: null };

    // Validation must know which rows are compounds: a compound is allowed
    // five more words (util/perk-economy.js). The rows carry compounds_with:
    // null until the batch's refs are resolved below, so the flag is read from
    // the parallel meta array instead.
    const rowsForValidation = rows.map((row, index) => (
      meta[index] && meta[index].compoundsWith
        ? { ...row, compounds_with: meta[index].compoundsWith }
        : row
    ));
    const validation = validateAbilityPerks(existingForValidation.concat(rowsForValidation));
```

Leave everything after this point unchanged.

- [ ] **Step 8: Run the tests**

Run: `bun run test:unit`
Expected: PASS, 0 fail.

- [ ] **Step 9: Commit**

```bash
git add util/validate.js util/validate.test.js services/character/service.js services/character/service.test.js
git commit -m "$(cat <<'EOF'
feat: give a compounded Perk its five extra words

Validation reads the compound flag from the batch's meta array, because
the rows carry compounds_with: null until their refs resolve -- so a
compound was being held to the baseline limit on the save path.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 4: The `aspiring_abilities` column

**Files:**
- Create: `supabase/migrations/20260921000000_characters_aspiring_abilities.sql`
- Modify: `models/character-atomic.integration.test.js`

**Interfaces:**
- Produces: `characters.aspiring_abilities jsonb NOT NULL DEFAULT '[]'`, entries `{class_id, name, type}`.

**Before anything:** run the local-database check from Global Constraints. If `API_URL` is not `http://127.0.0.1:54321`, stop.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260921000000_characters_aspiring_abilities.sql`:

```sql
-- An aspiring character lists two Core Abilities and one Advanced Ability at
-- creation (ENCLAVE: Aspirant V1 pg. 90 steps 3 and 4). Those three "are
-- treated as belonging to your Class" for pricing, but the character "does not
-- start with them, instead paying 1 Perk each, though you do not need to
-- acquire them immediately (or at all)".
--
-- So the picks must persist WITHOUT being owned abilities, exactly as
-- aspiring_signatures does for Signature Items. class_abilities rows record
-- what the character owns; this column records what counts as its Class.
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS aspiring_abilities jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_aspiring_abilities_check;

-- Three things this predicate is careful about, each learned from the
-- aspiring_signatures constraint:
--
-- 1. `.type() == "string"` guards precede every like_regex. In lax mode
--    like_regex on a non-string raises internally, the error is suppressed and
--    the element is DROPPED from the result -- so an unguarded predicate
--    accepts class_id: 123 rather than rejecting it.
-- 2. `NOT (creator_mode IS DISTINCT FROM 'aspiring')` rather than
--    `creator_mode = 'aspiring' OR ...`. A CHECK is satisfied by NULL as well
--    as TRUE, and 318 of 327 rows have a NULL creator_mode, so the naive form
--    evaporates for almost the whole table.
-- 3. `@."type"` is quoted. Unquoted, `type` collides with jsonpath's own
--    .type() method.
--
-- The exact 2-core-plus-1-advanced shape is a validator rule, not a
-- constraint: the column must tolerate an in-progress payload that the
-- validator rejects with a message a player can read.
ALTER TABLE characters ADD CONSTRAINT characters_aspiring_abilities_check CHECK (
  jsonb_typeof(aspiring_abilities) = 'array'
  AND jsonb_array_length(aspiring_abilities) <= 3
  AND ((NOT (creator_mode IS DISTINCT FROM 'aspiring')) OR jsonb_array_length(aspiring_abilities) = 0)
  AND NOT jsonb_path_exists(aspiring_abilities,
    '$[*] ? (!(@.class_id.type() == "string" && @.class_id like_regex "\\S"
           && @.name.type() == "string" && @.name like_regex "\\S"
           && @."type".type() == "string"
           && (@."type" == "core" || @."type" == "advanced")))')
);

COMMENT ON COLUMN characters.aspiring_abilities IS
  'An aspiring character''s two Core and one Advanced Ability picks (pg. 90). Selected at creation, acquired later or never; owned abilities live in class_abilities.';
```

- [ ] **Step 2: Apply it**

```bash
eval "$(supabase status -o env)"; echo "API_URL=$API_URL"; grep -E '^SUPABASE_URL=' .env
supabase migration up
```

Expected: applies cleanly. If it fails on existing rows, STOP — every existing row has `aspiring_abilities = '[]'` by default and a non-aspiring `creator_mode`, so a failure means the predicate is wrong, not the data.

- [ ] **Step 3: Probe the constraint by hand, all eight cases**

Run each against the local database and record the result. The aspiring_signatures constraint passed review with a hole that only a probe like this found.

```bash
eval "$(supabase status -o env)"
psql "$DB_URL" -v ON_ERROR_STOP=0 <<'SQL'
BEGIN;
CREATE TEMP TABLE probe (label text, ok boolean);
-- Replace <ID> with any real character id that has creator_mode IS NULL:
--   SELECT id FROM characters WHERE creator_mode IS NULL LIMIT 1;
SQL
```

Then, for a scratch row you insert and roll back, assert:

| # | Value | Must be |
| --- | --- | --- |
| 1 | `'[]'` on a NULL-`creator_mode` row | accepted |
| 2 | `'[{"class_id":"c","name":"n","type":"core"}]'` on a NULL-`creator_mode` row | **rejected** |
| 3 | the same on a `creator_mode = 'aspiring'` row | accepted |
| 4 | `'[{"class_id":123,"name":"n","type":"core"}]'` (non-string class_id) | **rejected** |
| 5 | `'[{"class_id":"c","name":"  ","type":"core"}]'` (blank name) | **rejected** |
| 6 | `'[{"class_id":"c","name":"n","type":"elite"}]'` (bad type) | **rejected** |
| 7 | `'[{"class_id":"c","name":"n"}]'` (missing type) | **rejected** |
| 8 | four entries on an aspiring row | **rejected** |
| 9 | `'"notanarray"'` and `'42'` | **rejected** |

Every row of that table must hold. If case 4, 6 or 7 is *accepted*, the type guards are wrong — fix the predicate and re-probe before continuing. Roll back; do not leave scratch rows behind.

- [ ] **Step 4: Verify the live definition matches the file**

```bash
psql "$DB_URL" -c "\d characters" | grep aspiring_abilities
```
Expected: the CHECK text contains `NOT (creator_mode IS DISTINCT FROM 'aspiring')`, not `creator_mode = 'aspiring' OR`.

- [ ] **Step 5: Confirm the row count is unchanged**

```bash
psql "$DB_URL" -t -A -c "select count(*) from characters;"
```
Expected: `327`.

- [ ] **Step 6: Add an integration test**

Append to `models/character-atomic.integration.test.js` a test that inserting a character with a non-string `class_id` inside `aspiring_abilities` is rejected. Assert on the constraint NAME, not a bare `.rejects.toThrow()`:

```js
await expect(insertWithAspiringAbilities([{ class_id: 123, name: 'X', type: 'core' }]))
  .rejects.toThrow(/characters_aspiring_abilities_check/);
```

Build `insertWithAspiringAbilities` from the fixture helpers already in that file — read it first and reuse whatever it uses for the `aspiring_signatures` rejection test.

- [ ] **Step 7: Run the integration tier**

Run: `bun run test:integration`
Expected: the three pre-existing red files stay red and nothing else changes. Record the exact failing file names before and after so the comparison is real.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260921000000_characters_aspiring_abilities.sql models/character-atomic.integration.test.js
git commit -m "$(cat <<'EOF'
feat: store an aspiring character's Ability picks

Selected at creation, acquired later or never (pg. 90 step 3b), so the
picks cannot live in class_abilities -- that table records what the
character owns.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 5: The RPC carries the column

**Files:**
- Create: `supabase/migrations/20260921000001_save_character_atomic_aspiring_abilities.sql`

**Interfaces:**
- Consumes: Task 4's column.
- Produces: `save_character_atomic` writes `aspiring_abilities` on insert and preserves it on update when the key is absent.

**Method.** Postgres has no "add a column to a function"; the whole function is restated. Copy `supabase/migrations/20260920000001_save_character_atomic_aspiring_signatures.sql` **verbatim** and make exactly three line-level changes. Do not retype it. Do not improve anything you see while you are in there.

- [ ] **Step 1: Copy the previous migration**

```bash
cp supabase/migrations/20260920000001_save_character_atomic_aspiring_signatures.sql \
   supabase/migrations/20260921000001_save_character_atomic_aspiring_abilities.sql
```

- [ ] **Step 2: Make exactly three changes**

In the new file only:

1. The INSERT column list (around line 47) currently ends `..., pseudo_class_tagline, pseudo_class_description, aspiring_signatures`. Append `, aspiring_abilities`.
2. The INSERT values list (around line 56) currently ends `..., COALESCE(record.aspiring_signatures, '[]'::jsonb)`. Append `, COALESCE(record.aspiring_abilities, '[]'::jsonb)`.
3. The UPDATE SET list (around line 86) currently contains `aspiring_signatures = record.aspiring_signatures`. Add a sibling line `aspiring_abilities = record.aspiring_abilities`.

Then rewrite the header comment at the top of the file to describe THIS migration — it currently describes the aspiring_signatures one. It must say which column is being added and that every other block is byte-identical to the previous definition.

`record` comes from `jsonb_populate_record(saved, p_character)`, so an absent key in the payload yields the stored value — which is what makes the UPDATE line preserve rather than clobber.

- [ ] **Step 3: Prove it is a three-change diff**

```bash
diff supabase/migrations/20260920000001_save_character_atomic_aspiring_signatures.sql \
     supabase/migrations/20260921000001_save_character_atomic_aspiring_abilities.sql
```
Expected: the three changes above, plus the header comment. Nothing else. If the diff shows anything else, revert and redo from Step 1.

- [ ] **Step 4: Apply and verify**

```bash
eval "$(supabase status -o env)"; echo "API_URL=$API_URL"
supabase migration up
psql "$DB_URL" -t -A -c "select prosrc from pg_proc where proname='save_character_atomic';" | grep -c aspiring_abilities
```
Expected: `3`.

- [ ] **Step 5: Row counts**

```bash
psql "$DB_URL" -t -A -c "select (select count(*) from characters), (select count(*) from class_abilities), (select count(*) from character_perks);"
```
Expected: `327|916|45`.

- [ ] **Step 6: Run the integration tier**

Run: `bun run test:integration`
Expected: same three pre-existing red files, nothing new.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260921000001_save_character_atomic_aspiring_abilities.sql
git commit -m "$(cat <<'EOF'
feat: carry aspiring_abilities through save_character_atomic

Full restatement, three line-level changes against the previous
definition; an absent key still preserves the stored value through
jsonb_populate_record.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 6: Shape and gate the pool on the way in

**Files:**
- Modify: `services/character/input.js:440-446` (beside `normalizeAspiringSignatures`), `:533-546` (the creation gate)
- Modify: `services/character/input.test.js`

**Interfaces:**
- Consumes: Task 4's column.
- Produces: `normalizeAspiringAbilities(value) -> [{class_id, name, type}]`, capped at 3; `data.aspiring_abilities` present only on an aspiring creation.

**The absent-key contract.** Three states: key absent means keep what is stored; explicit `null` means remove; an object or array means set. `save_character_atomic` treats a present key as authoritative, so sending `[]` on an update would **delete the character's Class**. The pool is written once, by the creation that invents the Class.

- [ ] **Step 1: Write the failing test**

Append to `services/character/input.test.js`:

```js
test('the aspiring ability shaper keeps only well-formed picks', () => {
  expect(normalizeAspiringAbilities([
    { class_id: 'c1', name: 'Standoff', type: 'core' },
    null,
    { class_id: '', name: 'Blank', type: 'core' },
    { class_id: 'c2', name: '   ', type: 'core' },
    { class_id: 'c3', name: 'Viewpoint', type: 'advanced' },
    'not an object'
  ])).toEqual([
    { class_id: 'c1', name: 'Standoff', type: 'core' },
    { class_id: 'c3', name: 'Viewpoint', type: 'advanced' }
  ]);
});

test('an unknown ability type is shaped to core rather than passed through', () => {
  expect(normalizeAspiringAbilities([{ class_id: 'c1', name: 'X', type: 'elite' }]))
    .toEqual([{ class_id: 'c1', name: 'X', type: 'core' }]);
});

test('the aspiring ability shaper truncates a payload over three', () => {
  const four = Array(4).fill(null).map((_, i) => ({ class_id: `c${i}`, name: `N${i}`, type: 'core' }));
  expect(normalizeAspiringAbilities(four)).toHaveLength(3);
});

test('the aspiring ability shaper tolerates a non-array', () => {
  expect(normalizeAspiringAbilities(null)).toEqual([]);
  expect(normalizeAspiringAbilities('nope')).toEqual([]);
});
```

Plus two tests at the `normalizeCharacterInput` level, modelled on whatever the existing `aspiring_signatures` creation-gate tests do — find them with `grep -n "aspiring_signatures" services/character/input.test.js`:

```js
test('an aspiring creation carries the ability pool', () => {
  // ... same fixture shape as the aspiring_signatures creation test
  expect(result.data.aspiring_abilities).toHaveLength(3);
});

test('an update never sends the ability pool key at all', () => {
  // A present empty key would delete the character's Class.
  expect('aspiring_abilities' in result.data).toBe(false);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:unit`
Expected: FAIL — `normalizeAspiringAbilities is not defined`.

- [ ] **Step 3: Add the shaper**

In `services/character/input.js`, directly below `normalizeAspiringSignatures` (currently ending at line 445):

```js
// pg. 90 steps 3 and 4: two Core picks and one Advanced. The type is narrowed
// here rather than trusted, because the database CHECK admits only 'core' and
// 'advanced' and a rejected save is a worse error message than a corrected
// one. The 2-and-1 split is validateAspiringBuild's rule, not this shaper's:
// shaping and validating are separate so a malformed payload still reaches the
// validator that can explain it.
const normalizeAspiringAbilities = (value) => (Array.isArray(value) ? value : [])
  .map((pick) => (pick && typeof pick === 'object'
    ? {
        class_id: blankToNull(pick.class_id),
        name: blankToNull(pick.name),
        type: pick.type === 'advanced' ? 'advanced' : 'core'
      }
    : null))
  .filter((pick) => pick && pick.class_id && pick.name)
  .slice(0, ASPIRING_ABILITY_PICKS);
```

`ASPIRING_ABILITY_PICKS` is a rules figure, so it is imported rather than written here. Add it to `util/perk-economy.js` in this same change, beside `FREE_CORE_ABILITIES`:

```js
// pg. 90 steps 3 and 4: two Core Abilities and one Advanced, three picks in
// all, and those three are the aspiring character's Class. A count rather than
// a price, but a rules figure all the same.
const ASPIRING_ABILITY_PICKS = 3;
const ASPIRING_CORE_PICKS = 2;
const ASPIRING_ADVANCED_PICKS = 1;
```

Export all three, add them to `perkFigures()` as `aspiringAbilityPicks`, `aspiringCorePicks`, `aspiringAdvancedPicks`, and import `ASPIRING_ABILITY_PICKS` into `services/character/input.js`.

- [ ] **Step 4: Gate it to creation**

In `services/character/input.js`, extend the existing block at lines 542-546 so the new pool follows the same rule:

```js
  if (context.isCreation && data.creator_mode === 'aspiring') {
    data.aspiring_signatures = normalizeAspiringSignatures(data.aspiring_signatures);
    data.aspiring_abilities = normalizeAspiringAbilities(data.aspiring_abilities);
  } else {
    delete data.aspiring_signatures;
    delete data.aspiring_abilities;
  }
```

Leave the comment above that block as it is; it already describes the rule, and it now governs two pools rather than one. Change the word "pool" to "pools" in it and nothing else.

- [ ] **Step 5: Run the tests**

Run: `bun run test:unit`
Expected: PASS, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add services/character/input.js services/character/input.test.js util/perk-economy.js util/perk-economy.test.js
git commit -m "$(cat <<'EOF'
feat: shape an aspiring character's Ability picks on the way in

Written once by the creation that invents the Class; on an update the key
is absent, because a present empty key would delete it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 7: The aspiring build check moves to the pool

**Files:**
- Modify: `services/character/input.js:688-708` (`validateAspiringBuild`)
- Modify: `services/character/input.test.js`

**Interfaces:**
- Consumes: Task 6's `normalizeAspiringAbilities`, `ASPIRING_ABILITY_PICKS`, `ASPIRING_CORE_PICKS`, `ASPIRING_ADVANCED_PICKS`.
- Produces: `validateAspiringBuild(body)` unchanged in signature; its ability rule now reads `body.aspiring_abilities` rather than `body.abilities`.

**Why.** The three-ness is a property of the Class being invented, not of what the character walked out with. Today the function counts `body.abilities` — the abilities the character OWNS — which forces an aspiring character to buy all three picks at creation, contradicting pg. 90 step 3b. This is the identical correction slice 4 plan 3 made for Signatures, where the count moved from `gear` to the pool.

- [ ] **Step 1: Write the failing test**

Append to `services/character/input.test.js`:

```js
test('an aspiring character may be created owning none of its picks', () => {
  // pg. 90 step 3b: "you do not need to acquire them immediately (or at all)".
  const body = aspiringBodyWithPools({
    aspiring_abilities: [
      { class_id: 'c1', name: 'A', type: 'core' },
      { class_id: 'c2', name: 'B', type: 'core' },
      { class_id: 'c3', name: 'C', type: 'advanced' }
    ],
    abilities: []
  });
  expect(validateAspiringBuild(body)).toBeNull();
});

test('an aspiring character needs exactly three Ability picks', () => {
  const body = aspiringBodyWithPools({
    aspiring_abilities: [{ class_id: 'c1', name: 'A', type: 'core' }],
    abilities: []
  });
  expect(validateAspiringBuild(body)).toBe('An Aspiring character needs exactly three Ability picks.');
});

test('the three picks must be two Core and one Advanced', () => {
  const body = aspiringBodyWithPools({
    aspiring_abilities: [
      { class_id: 'c1', name: 'A', type: 'core' },
      { class_id: 'c2', name: 'B', type: 'core' },
      { class_id: 'c3', name: 'C', type: 'core' }
    ],
    abilities: []
  });
  expect(validateAspiringBuild(body))
    .toBe('An Aspiring character needs two Core Ability picks and one Advanced.');
});

test('the two Core picks must come from two different classes', () => {
  // pg. 90 step 3: "two Core Abilities from two different Classes".
  const body = aspiringBodyWithPools({
    aspiring_abilities: [
      { class_id: 'c1', name: 'A', type: 'core' },
      { class_id: 'c1', name: 'B', type: 'core' },
      { class_id: 'c3', name: 'C', type: 'advanced' }
    ],
    abilities: []
  });
  expect(validateAspiringBuild(body))
    .toBe("An Aspiring character's two Core Abilities must come from two different classes.");
});

test('the Advanced pick may repeat a class the Core picks used', () => {
  // pg. 90 step 4a: "You may repeat Classes from those your Signature Items
  // and/or Core Abilities were sourced from."
  const body = aspiringBodyWithPools({
    aspiring_abilities: [
      { class_id: 'c1', name: 'A', type: 'core' },
      { class_id: 'c2', name: 'B', type: 'core' },
      { class_id: 'c1', name: 'C', type: 'advanced' }
    ],
    abilities: []
  });
  expect(validateAspiringBuild(body)).toBeNull();
});
```

**`aspiringBodyWithPools` does not exist.** Write it at the top of the new block, building on whatever fixture the existing `validateAspiringBuild` tests use — find them with `grep -n "validateAspiringBuild" services/character/input.test.js`. It must supply a valid `pseudo_class.name` and three `aspiring_signatures` from three distinct classes, or the function returns an earlier error and these tests pass for the wrong reason.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:unit`
Expected: FAIL — the first test returns the old `'An Aspiring character needs two core abilities and one advanced ability.'`.

- [ ] **Step 3: Rewrite the ability half of `validateAspiringBuild`**

Replace this block:

```js
  const abilities = Array.isArray(body.abilities) ? body.abilities : [];
  const core = abilities.filter(a => a && a.type === 'core').length;
  const advanced = abilities.filter(a => a && a.type === 'advanced').length;
  if (abilities.length !== 3 || core !== 2 || advanced !== 1) {
    return 'An Aspiring character needs two core abilities and one advanced ability.';
  }
  return null;
```

with:

```js
  // The three-ness is a property of the Class being invented, not of what the
  // character walked out with. pg. 90 step 3b prices the Core picks at 1 Perk
  // each "though you do not need to acquire them immediately (or at all)", so
  // a legal aspiring character may own none of them -- what must be three is
  // the pool.
  const abilityPicks = normalizeAspiringAbilities(body.aspiring_abilities);
  if (abilityPicks.length !== ASPIRING_ABILITY_PICKS) {
    return 'An Aspiring character needs exactly three Ability picks.';
  }
  const corePicks = abilityPicks.filter((pick) => pick.type === 'core');
  if (corePicks.length !== ASPIRING_CORE_PICKS
      || abilityPicks.length - corePicks.length !== ASPIRING_ADVANCED_PICKS) {
    return 'An Aspiring character needs two Core Ability picks and one Advanced.';
  }
  // pg. 90 step 3: "two Core Abilities from two different Classes". Step 4a
  // then lets the Advanced pick repeat either of them, so only the Cores are
  // checked for distinctness.
  if (new Set(corePicks.map((pick) => pick.class_id)).size !== ASPIRING_CORE_PICKS) {
    return "An Aspiring character's two Core Abilities must come from two different classes.";
  }
  return null;
```

Also update the function's leading comment: it currently says "The Perk budget this function does not check stays client-side only (`public/js/character-wizard.js:1525` hardcodes its own ASPIRING_PERKS_BUDGET; this task does not give it a server-side counterpart)." That becomes false in Task 8. Replace that sentence with one describing what is true after Task 8 — that the Perk balance and ability cap are enforced by `validateEconomyLimits`, which runs on every submission after this structural check passes.

- [ ] **Step 4: Run the tests**

Run: `bun run test:unit`
Expected: PASS. Existing tests asserting the OLD message will fail — update them to the new rule rather than keeping both, since the old rule is gone.

- [ ] **Step 5: Run the http tier**

Run: `bun run test:http`
Expected: only the pre-existing `routes/open-graph.test.js` failure.

**This step is not optional.** In slice 4 plan 3, an identical change to the Signature half of this same function left `routes/character-wizard-aspiring.test.js` red for four tasks, because the task that made the change ran only the unit tier. That file constructs an aspiring submission by hand; if it does not send `aspiring_abilities`, it will now fail, and fixing it belongs to this task.

- [ ] **Step 6: Commit**

```bash
git add services/character/input.js services/character/input.test.js routes/character-wizard-aspiring.test.js
git commit -m "$(cat <<'EOF'
fix: count an aspiring character's Ability picks, not its purchases

pg. 90 step 3b: the picks need not be acquired "immediately (or at all)",
so the three-ness belongs to the pool, as it already does for Signatures.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 8: Ability terms in the economy gate

**Files:**
- Modify: `services/character/input.js:340-372` (`validateEconomyLimits`)
- Modify: `services/character/input.test.js`

**Interfaces:**
- Consumes: `buildBreaches` from `util/perk-economy.js` (Task 2).
- Produces: `validateEconomyLimits({..., abilities, abilityPerks, level, enforceAbilityLimits})` — three new inputs and one new flag, defaulting `enforceAbilityLimits = true`.

**The flag is load-bearing, and Task 10 depends on it.** `enforceAbilityLimits` governs **both** hard rules — the ability cap and the Perk balance — not just the balance. Creation passes it `true`: a new character must be legal outright. `updateCharacter` passes it `false` and delegates to the ratchet instead, because an absolute check here would refuse every save by the 13 already-breaching characters and make them uneditable, which is exactly what Task 10 exists to prevent. Splitting the flag so that the cap stayed absolute would break the ratchet while every unit test still passed.

**The advent guard must go.** The function's first line is `if (economy === 'advent') return { ok: true };`. The Perk economy covers all three economies, so that early return now suppresses the ability cap for the 327 characters it applies to. Remove it, and gate only the *Merx* half on `economy !== 'advent'` so the Signature and Merx behaviour is byte-for-byte unchanged.

- [ ] **Step 1: Write the failing test**

Append to `services/character/input.test.js`:

```js
const own = (type) => ({ crossClass: false, type });

test('the ability cap is enforced for an advent character', () => {
  const res = validateEconomyLimits({
    economy: 'advent', gear: [], commonItems: [], level: 1,
    abilities: Array(4).fill(null).map(() => own('core')), abilityPerks: []
  });
  expect(res.ok).toBe(false);
  expect(res.errors.join(' ')).toContain('4 Abilities, and the cap is 3.');
});

test('an advent character within the cap still passes', () => {
  const res = validateEconomyLimits({
    economy: 'advent', gear: [], commonItems: [], level: 1,
    abilities: [own('core'), own('core'), own('core')], abilityPerks: []
  });
  expect(res.ok).toBe(true);
});

test('the Merx budget is still not enforced for an advent character', () => {
  // 327 existing characters were built with no Merx budget; slice 4 decided
  // deliberately not to start enforcing one, and this task does not change it.
  const res = validateEconomyLimits({
    economy: 'advent', level: 1, abilities: [], abilityPerks: [],
    gear: Array(20).fill({ name: 'X', class_id: 'c1' }), commonItems: []
  });
  expect(res.ok).toBe(true);
});

test('a Perk deficit is an error a player can read', () => {
  const res = validateEconomyLimits({
    economy: 'aspirant', gear: [], commonItems: [], level: 1,
    abilities: [own('core'), own('core'), own('core'), own('advanced')], abilityPerks: []
  });
  expect(res.ok).toBe(false);
  expect(res.errors.join(' ')).toContain('2 Perks spent of 1 earned.');
});

test('a soft breach is never an error', () => {
  const res = validateEconomyLimits({
    economy: 'advent', gear: [], commonItems: [], level: 5, abilityPerks: [],
    abilities: [own('core'), { crossClass: true, type: 'core' }]
  });
  expect(res.ok).toBe(true);
});

test('enforceAbilityLimits false drops BOTH the cap and the balance', () => {
  // The update path passes false and delegates to the ratchet. If the cap
  // still fired here, every grandfathered character would be unsaveable.
  const overBalance = validateEconomyLimits({
    economy: 'aspirant', gear: [], commonItems: [], level: 1, enforceAbilityLimits: false,
    abilities: [own('core'), own('core'), own('core'), own('advanced')], abilityPerks: []
  });
  expect(overBalance.ok).toBe(true);

  const overCap = validateEconomyLimits({
    economy: 'advent', gear: [], commonItems: [], level: 1, enforceAbilityLimits: false,
    abilities: Array(6).fill(null).map(() => own('core')), abilityPerks: []
  });
  expect(overCap.ok).toBe(true);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:unit`
Expected: FAIL — the advent cases return `{ ok: true }` from the early return.

- [ ] **Step 3: Rewrite the function**

```js
const validateEconomyLimits = ({
  economy, gear, storedGear, commonItems, characterClassId, aspiringSignatures,
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

  // The Merx half is unchanged, and stays off for advent: 327 existing
  // characters were built with no Merx budget and no measurement says they
  // would pass one.
  if (economy !== 'advent') {
    const items = Array.isArray(gear) ? gear.filter(Boolean) : [];

    // pg. 8: an Enchantment counts as a second slot toward the Signature Cap.
    // This is checked independently of Merx -- a character who can afford a
    // seventh enchanted Signature may still not carry it if the slots are full.
    const cap = SIGNATURE_CAP[economy];
    const slots = signatureSlotsUsed(withPreservedEquipment(items, storedGear));
    if (cap !== null && slots > cap) {
      errors.push(
        `Signature Cap is ${cap}; this character carries ${slots} `
        + '(an Enchantment counts as a Signature).'
      );
    }

    if (enforceMerxBudget) {
      const budget = CREATION_GRANT[economy];
      const itemCount = Array.isArray(commonItems) ? commonItems.length : 0;
      const spend = equipmentSpend(items, { economy, characterClassId, aspiringSignatures })
        + itemCount * COMMON_ITEM_PRICE;
      if (spend > budget) {
        errors.push(`This character spends ${spend} Merx of ${budget}.`);
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
};
```

Keep the existing `storedGear` comment block above the function verbatim — it is still true — and add a sentence to it explaining that `abilities` arrive already tagged `{crossClass, type}` and `level` is needed because the Perk grant scales with it.

Import `buildBreaches` from `util/perk-economy.js` at the top of `services/character/input.js`.

- [ ] **Step 4: Run the tests**

Run: `bun run test:unit`
Expected: PASS. Callers that do not yet pass `abilities` get `undefined`, which `buildBreaches` treats as an empty list — so no existing caller starts failing before Task 9 wires them.

- [ ] **Step 5: Run the http tier**

Run: `bun run test:http`
Expected: only the pre-existing `routes/open-graph.test.js` failure.

- [ ] **Step 6: Commit**

```bash
git add services/character/input.js services/character/input.test.js
git commit -m "$(cat <<'EOF'
feat: enforce the ability cap and Perk balance in every economy

The advent early return went with it: Advent has no unlock path, so its
three Core Abilities are the whole roster. The Merx half stays off for
advent, unchanged.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 9: Tag abilities and feed the derivation

**Files:**
- Modify: `util/character-derived.js`
- Modify: `services/character/service.js` (three `deriveCharacterTotals` call sites at roughly `:217`, `:398`, `:820`, plus the two `validateEconomyLimits` callers)
- Modify: `util/character-derived.test.js`, `services/character/service.test.js`

**Interfaces:**
- Consumes: `perkBreakdown`, `buildBreaches` from `util/perk-economy.js`.
- Produces:
  - `tagAbilities(abilities, {economy, characterClassId, aspiringAbilities, classFamilyOf}) -> [{crossClass, type}]` in `util/character-derived.js`
  - `derivePerkBreakdown({economy, level, abilities, abilityPerks, characterClassId, aspiringAbilities, classFamilyOf})`
  - `deriveCharacterTotals` gains a `perks` key on its return value.

**The family rule.** An ability is cross-class when its class belongs to a different **version family** than the character's class. Measured: 64 of the 88 differing-`class_id` rows are the same class at another version — naming those would be 73% false positives. `classFamilyOf` is a caller-supplied function `(classId) -> familyId`; `util/character-derived.js` resolves no families itself, because it has no database. When the caller cannot supply one, it defaults to identity and the comparison falls back to raw `class_id`.

For an aspiring character, "own" means membership of `aspiring_abilities`, matched on `class_id` **and** `name` — the same pair `inAspiringPool` uses for Signatures in `util/merx-economy.js`.

- [ ] **Step 1: Write the failing test**

Append to `util/character-derived.test.js`:

```js
const { tagAbilities, derivePerkBreakdown } = require('./character-derived');

test('an ability from the character own class is not cross-class', () => {
  expect(tagAbilities(
    [{ class_id: 'c1', name: 'A', type: 'core' }],
    { economy: 'aspirant', characterClassId: 'c1' }
  )).toEqual([{ crossClass: false, type: 'core' }]);
});

test('an ability from another version of the same class is not cross-class', () => {
  // 64 of 88 differing-class_id rows are exactly this: version drift.
  const classFamilyOf = (id) => (id === 'c1-v2' || id === 'c1' ? 'fam1' : id);
  expect(tagAbilities(
    [{ class_id: 'c1-v2', name: 'A', type: 'core' }],
    { economy: 'aspirant', characterClassId: 'c1', classFamilyOf }
  )).toEqual([{ crossClass: false, type: 'core' }]);
});

test('an ability from a genuinely different family is cross-class', () => {
  const classFamilyOf = (id) => (id === 'c1' ? 'fam1' : 'fam2');
  expect(tagAbilities(
    [{ class_id: 'c9', name: 'A', type: 'advanced' }],
    { economy: 'aspirant', characterClassId: 'c1', classFamilyOf }
  )).toEqual([{ crossClass: true, type: 'advanced' }]);
});

test('an aspiring ability in the pool is own-class', () => {
  const pool = [{ class_id: 'c1', name: 'Standoff', type: 'core' }];
  expect(tagAbilities(
    [{ class_id: 'c1', name: 'Standoff', type: 'core' }],
    { economy: 'aspiring', aspiringAbilities: pool }
  )).toEqual([{ crossClass: false, type: 'core' }]);
});

test('an aspiring ability outside the pool is cross-class', () => {
  const pool = [{ class_id: 'c1', name: 'Standoff', type: 'core' }];
  expect(tagAbilities(
    [{ class_id: 'c1', name: 'Other', type: 'core' }],
    { economy: 'aspiring', aspiringAbilities: pool }
  )).toEqual([{ crossClass: true, type: 'core' }]);
});

test('an aspiring character with an empty pool is not charged cross-class for everything', () => {
  // Mirrors isCrossClass in util/merx-economy.js: an empty pool prices
  // own-class, because a character mid-creation has no pool yet and must not
  // be told it owes 3 Perks for its first pick.
  expect(tagAbilities(
    [{ class_id: 'c1', name: 'A', type: 'core' }],
    { economy: 'aspiring', aspiringAbilities: [] }
  )).toEqual([{ crossClass: false, type: 'core' }]);
});

test('a null entry in the pool cannot make a real ability cross-class', () => {
  // The client/server divergence slice 4 plan 3 found: one side checked
  // length before filtering, the other after.
  expect(tagAbilities(
    [{ class_id: 'c1', name: 'A', type: 'core' }],
    { economy: 'aspiring', aspiringAbilities: [null, null] }
  )).toEqual([{ crossClass: false, type: 'core' }]);
});

test('derivePerkBreakdown prices an aspirant advanced ability at 2', () => {
  expect(derivePerkBreakdown({
    economy: 'aspirant', level: 3, characterClassId: 'c1',
    abilities: [
      { class_id: 'c1', name: 'A', type: 'core' },
      { class_id: 'c1', name: 'B', type: 'core' },
      { class_id: 'c1', name: 'C', type: 'core' },
      { class_id: 'c1', name: 'D', type: 'advanced' }
    ],
    abilityPerks: []
  })).toEqual({ earned: 3, spend: 2, remaining: 1, deficit: 0 });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:unit`
Expected: FAIL — `tagAbilities is not a function`.

- [ ] **Step 3: Implement in `util/character-derived.js`**

```js
const {
  perkBreakdown,
  buildBreaches
} = require('./perk-economy');

const sameFamily = (a, b, classFamilyOf) => {
  const of = typeof classFamilyOf === 'function' ? classFamilyOf : (id) => id;
  return !!a && !!b && of(a) === of(b);
};

// An aspiring character's pool is matched on class_id AND name, the same pair
// util/merx-economy.js's inAspiringPool uses for Signatures.
const inAbilityPool = (ability, pool) => pool.some(
  (pick) => pick.class_id === ability.class_id && pick.name === ability.name
);

// Each ability reduced to what util/perk-economy.js prices: whether it is
// cross-class, and whether it is Core or Advanced. Resolving that is this
// module's job, not the economy module's -- the economy resolves no class and
// no pool.
//
// Cross-class is a VERSION FAMILY comparison, not a class_id one: an ability
// carried over from an earlier version of the character's own class is the
// same class, and 64 of the 88 differing-class_id rows in the live data are
// exactly that.
const tagAbilities = (abilities, { economy, characterClassId, aspiringAbilities, classFamilyOf } = {}) => {
  const list = (Array.isArray(abilities) ? abilities : []).filter(Boolean);
  if (economy === 'aspiring') {
    // An empty pool prices own-class rather than cross-class: a character
    // mid-creation has no pool yet and must not be told its first pick costs
    // the cross-class rate. Filter BEFORE measuring length -- checking an
    // unfiltered array is how the client and server disagreed about this rule
    // for Signatures.
    const pool = (Array.isArray(aspiringAbilities) ? aspiringAbilities : []).filter(Boolean);
    return list.map((ability) => ({
      crossClass: pool.length > 0 && !inAbilityPool(ability, pool),
      type: ability.type === 'advanced' ? 'advanced' : 'core'
    }));
  }
  return list.map((ability) => ({
    crossClass: !!characterClassId && !!ability.class_id
      && !sameFamily(ability.class_id, characterClassId, classFamilyOf),
    type: ability.type === 'advanced' ? 'advanced' : 'core'
  }));
};

const derivePerkBreakdown = ({
  economy, level, abilities, abilityPerks, characterClassId, aspiringAbilities, classFamilyOf
}) => perkBreakdown({
  economy,
  level,
  abilities: tagAbilities(abilities, { economy, characterClassId, aspiringAbilities, classFamilyOf }),
  abilityPerks
});

const deriveBuildBreaches = ({
  economy, level, abilities, abilityPerks, characterClassId, aspiringAbilities, classFamilyOf
}) => buildBreaches({
  economy,
  level,
  abilities: tagAbilities(abilities, { economy, characterClassId, aspiringAbilities, classFamilyOf }),
  abilityPerks
});
```

Then extend `deriveCharacterTotals` to include the Perk breakdown on its return value:

```js
const deriveCharacterTotals = ({ character, realMissions, offscreenMissions, rulesVersion, economy, classFamilyOf }) => {
  const completed_missions = deriveCompletedMissions(realMissions, offscreenMissions);
  const merxParts = deriveMerxBreakdown({ /* ...unchanged... */ });
  const level = deriveLevel(completed_missions, rulesVersion);
  return {
    completed_missions,
    commissary_reward: merxParts.reward,
    merx_deficit: merxParts.deficit,
    level,
    // Derived for display, never persisted -- there is no perks column, by
    // design: a stored total can disagree with the rows it summarises.
    perks: derivePerkBreakdown({
      economy,
      level,
      abilities: character && character.abilities,
      abilityPerks: character && character.ability_perks,
      characterClassId: character && character.class_id,
      aspiringAbilities: character && character.aspiring_abilities,
      classFamilyOf
    })
  };
};
```

Export `tagAbilities`, `derivePerkBreakdown` and `deriveBuildBreaches`.

- [ ] **Step 4: Feed abilities at the three call sites**

In `services/character/service.js`, each `deriveCharacterTotals` call builds a synthetic `character` object. Each must now also carry `abilities`, `ability_perks` and `aspiring_abilities` — from the correct source, which differs per site:

| Site | `abilities` / `ability_perks` | `aspiring_abilities` |
| --- | --- | --- |
| create (~`:217`) | `childData.classAbilities`, `childData.abilityPerks` | `characterInput.aspiring_abilities` |
| update (~`:398`) | submitted abilities, `childData.abilityPerks` | `existing.data.aspiring_abilities` |
| auto-calculate / levelUp (~`:820`) | `character.abilities`, `character.ability_perks` | `character.aspiring_abilities` |

**The pool source differs between create and update and that is not an oversight.** On create the pool is in the submitted input, because the character does not exist yet. On update the key is deliberately absent from the submission (Task 6), so the stored value is the only truth. Reading `characterInput.aspiring_abilities` on the update path would price every ability cross-class. This exact mistake, on the Signature pool, would have banked a free Merx on every create — write both sources explicitly and do not factor them into a shared helper.

Also pass `abilities`, `abilityPerks` and `level` to both `validateEconomyLimits` callers, so Task 8's terms actually fire — and pass the flag explicitly at each:

- **creation** passes `enforceAbilityLimits: true` (the default, but write it out beside the existing `enforceMerxBudget` so the pair reads as one decision). A new character must be legal outright.
- **update** passes `enforceAbilityLimits: false`. Task 10 installs the ratchet on this path; leaving the absolute check on would refuse every save by an already-breaching character, and Task 10's tests would fail with a message from this function rather than from the ratchet — a confusing failure to debug.

- [ ] **Step 5: Run every tier**

```bash
bun run test:unit && bun run test:http && bun run test:integration
```
Expected: unit 0 fail; http only `routes/open-graph.test.js`; integration only the three pre-existing red files.

- [ ] **Step 6: Commit**

```bash
git add util/character-derived.js util/character-derived.test.js services/character/service.js services/character/service.test.js
git commit -m "$(cat <<'EOF'
feat: derive a character's Perk balance from what it owns

Cross-class is a version-family comparison: 64 of 88 differing-class_id
ability rows are the same class at another version.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 10: The ratchet on the update path

**Files:**
- Modify: `services/character/service.js` (`updateCharacter`)
- Modify: `services/character/service.test.js`

**Interfaces:**
- Consumes: `deriveBuildBreaches` (Task 9), `worsenedBreaches` (Task 2).
- Produces: an update that would worsen a hard breach returns `{ status: 400, message }`.

**The rule.** Creation is never grandfathered — a new character must be legal outright, which Task 8 already enforces. Update compares the stored build against the submitted one and refuses only a save that makes a hard breach worse.

**Check this before writing anything:** the update path must already be passing `enforceAbilityLimits: false` to `validateEconomyLimits` (Task 9, Step 4). If it is not, the absolute check fires first and every test below fails with that function's message rather than the ratchet's. Verify with `grep -n "enforceAbilityLimits" services/character/service.js` — you should see it on the update call site only.

- [ ] **Step 1: Write the failing test**

Append to `services/character/service.test.js` three tests, built on the file's existing `updateCharacter` fixture (find it with `grep -n "updateCharacter" services/character/service.test.js | head`):

```js
test('a grandfathered over-cap character still saves unchanged', () => {
  // Aisuna Kor-Ragna: 6 abilities, advent, level 1. Must stay renameable.
});

test('a grandfathered character cannot add a seventh ability', () => {
  // Expect { status: 400 } and a message naming the ability cap.
});

test('a grandfathered character may drop an ability', () => {
  // Improving toward legality is always allowed.
});
```

Fill each body from the existing fixture. The stored character must have six `class_abilities` rows; the submission differs only in the ability list.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:unit`
Expected: FAIL — the seventh ability is accepted.

- [ ] **Step 3: Implement the ratchet**

In `updateCharacter`, after `existing` is loaded and the submitted abilities are resolved, and before the write:

```js
    // The ratchet. An existing breach is grandfathered -- 13 of 327 live
    // characters are outside a rule this slice introduced, and none of them
    // becomes unsaveable. What is refused is a save that makes a hard breach
    // WORSE. The allowance is the stored row itself, which is why no
    // per-character exemption is stored anywhere.
    const ratchetArgs = {
      economy,
      level: existing.data.level,
      abilityPerks: childData.abilityPerks,
      characterClassId: characterInput.class_id,
      aspiringAbilities: existing.data.aspiring_abilities,
      classFamilyOf
    };
    const worsened = worsenedBreaches(
      deriveBuildBreaches({ ...ratchetArgs, abilities: existing.data.abilities, abilityPerks: existing.data.ability_perks }),
      deriveBuildBreaches({ ...ratchetArgs, abilities: submittedAbilities })
    );
    if (worsened.length > 0) {
      return {
        data: null,
        error: {
          status: 400,
          message: `This change is not allowed while the build is illegal: ${worsened.map(b => b.detail).join(' ')}`
        }
      };
    }
```

`submittedAbilities` is whatever the surrounding code already resolved for the write — reuse that variable rather than re-resolving. `classFamilyOf` comes from the same lookup Task 9 introduced at this call site.

- [ ] **Step 4: Run the tests**

Run: `bun run test:unit && bun run test:http`
Expected: PASS; http shows only `routes/open-graph.test.js`.

- [ ] **Step 5: Prove it against real data**

With the local-database check done, confirm the eight hard-flagged characters are still readable and that their breach counts match the spec's table:

```bash
eval "$(supabase status -o env)"
psql "$DB_URL" -t -A -F'|' -c "
with ab as (select character_id, count(*) n from class_abilities group by 1),
pk as (select character_id, count(*) n from character_perks group by 1)
select c.name, c.level, coalesce(ab.n,0), coalesce(pk.n,0)
from characters c left join ab on ab.character_id=c.id left join pk on pk.character_id=c.id
where coalesce(ab.n,0) > 3 or coalesce(pk.n,0) > greatest(c.level-1,0)
order by coalesce(ab.n,0) desc;"
```
Expected: exactly the eight rows in the spec's Measurements table. If the set differs, the derivation disagrees with the spec and that must be resolved before continuing.

- [ ] **Step 6: Commit**

```bash
git add services/character/service.js services/character/service.test.js
git commit -m "$(cat <<'EOF'
feat: grandfather an illegal build, and refuse to let it worsen

13 of 327 live characters are outside a rule this slice introduces; none
becomes unsaveable, and none can get further out.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 11: Say so on the character page

**Files:**
- Modify: `routes/characters.js:1070-1120`
- Modify: `views/character.handlebars:76-85`
- Modify: `routes/characters.test.js`

**Interfaces:**
- Consumes: `derivePerkBreakdown`, `deriveBuildBreaches` (Task 9).
- Produces: `perkBreakdown` and `buildBreaches` in the character page's render context.

- [ ] **Step 1: Write the failing test**

Append to `routes/characters.test.js` a test asserting that a character page for a character with four abilities in an advent economy renders the text `Illegal Build`, and that a clean character's page does not. Model the request setup on the nearest existing character-page test in that file.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:http`
Expected: FAIL — the page renders no such text.

- [ ] **Step 3: Build the figures in the route**

In `routes/characters.js`, beside the existing `merxBreakdown` block (`:1075-1091`), add:

```js
      // Unlike merxBreakdown this is NOT gated on showGearPurchases: the Perk
      // economy covers all three economies, and the 13 live characters outside
      // one of its rules are every one of them advent.
      const perkBreakdown = derivePerkBreakdown({
        economy,
        level: character.level,
        abilities: character.abilities,
        abilityPerks: character.ability_perks,
        characterClassId: character.class_id,
        aspiringAbilities: character.aspiring_abilities,
        classFamilyOf
      });
      const buildBreaches = deriveBuildBreaches({
        economy,
        level: character.level,
        abilities: character.abilities,
        abilityPerks: character.ability_perks,
        characterClassId: character.class_id,
        aspiringAbilities: character.aspiring_abilities,
        classFamilyOf
      });
```

`classFamilyOf` must map a class id to `base_class_id ?? id`. The page already loads `characterClass`; build the map from whatever class lookup this route already performs rather than issuing a new query. If no lookup covers the ability rows' classes, add one that selects `id, base_class_id` for the distinct `class_id` values on `character.abilities` — a single indexed query.

Pass both into `res.render('character', { ... })`.

- [ ] **Step 4: Render them**

In `views/character.handlebars`, after the existing `merxBreakdown` block (`:76-85`), add:

```handlebars
      {{#if perkBreakdown}}
      <p><strong>Perks earned:</strong> {{perkBreakdown.earned}}</p>
      <p><strong>Perks spent:</strong> {{perkBreakdown.spend}}</p>
      <p><strong>Perks remaining:</strong> {{perkBreakdown.remaining}}</p>
      {{/if}}
      {{#each buildBreaches}}
        {{#if (eq this.severity "hard")}}
        <p class="has-text-danger"><strong>Illegal Build:</strong> {{this.detail}}</p>
        {{else}}
        <p class="has-text-warning"><strong>Not available in this edition:</strong> {{this.detail}}</p>
        {{/if}}
      {{/each}}
```

Check that an `eq` helper is registered before using it — `grep -rn "'eq'" app.js util/*.js views/`. If none exists, split the loop into two `{{#each}}` blocks over pre-partitioned arrays built in the route instead of registering a new helper for one view.

- [ ] **Step 5: Run the http tier**

Run: `bun run test:http`
Expected: PASS; only `routes/open-graph.test.js` still red.

- [ ] **Step 6: Commit**

```bash
git add routes/characters.js views/character.handlebars routes/characters.test.js
git commit -m "$(cat <<'EOF'
feat: show a character's Perk balance and name any broken rule

Two severities: a hard cap or balance breach reads Illegal Build, an
Advent character's Cross-Class ability reads as outside its edition.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 12: Close the classic-POST bypass

**Files:**
- Modify: `routes/characters.js` (the classic/expert `POST /characters` handler)
- Modify: `routes/characters.test.js`

**Interfaces:**
- Consumes: `validateAspiringBuild` (Task 7).

**Why.** The wizard's create path runs `validateAspiringBuild`; the classic/expert `POST /characters` route does not. A hand-crafted aspiring payload there reaches storage with no count or distinct-class gate on either pool. Slice 4 plan 3 recorded this and deferred it; with Task 7 moving the ability rule into that same function, the bypass now skips two rules instead of one.

- [ ] **Step 1: Write the failing test**

Append to `routes/characters.test.js` a test POSTing an aspiring payload with only one `aspiring_abilities` pick to the classic route, expecting a 400 whose body names the three-picks rule.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:http`
Expected: FAIL — the response is a success.

- [ ] **Step 3: Call the validator**

In the classic `POST /characters` handler, before it calls into the service, add the same guard the wizard path uses:

```js
    if (req.body.creator_mode === 'aspiring') {
      const buildError = validateAspiringBuild(req.body);
      if (buildError) return sendRouteError(res, { status: 400, message: buildError });
    }
```

Use whatever error helper this route already uses for a 400; `grep -n "sendRouteError" routes/characters.js | head -3` will show the convention.

- [ ] **Step 4: Run the http tier**

Run: `bun run test:http`
Expected: PASS; only `routes/open-graph.test.js` red.

- [ ] **Step 5: Full sweep**

```bash
bun run test:unit && bun run test:http && bun run test:integration
```
Expected: unit 0 fail across 186+ files; http only `routes/open-graph.test.js`; integration only the three pre-existing red files.

Then confirm the row counts one last time:

```bash
eval "$(supabase status -o env)"
psql "$DB_URL" -t -A -F'|' -c "select (select count(*) from characters), (select count(*) from traits), (select count(*) from class_gear), (select count(*) from class_abilities), (select count(*) from classes), (select count(*) from character_perks);"
```
Expected: `327|981|1492|916|62|45`.

- [ ] **Step 6: Commit**

```bash
git add routes/characters.js routes/characters.test.js
git commit -m "$(cat <<'EOF'
fix: gate an aspiring build on the classic create route too

The wizard path validated it and this one did not, so a hand-crafted
payload reached storage with neither pool checked.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

## What this plan deliberately leaves to plan 2

Plan 1 makes the rules right; plan 2 makes the buying work. After plan 1:

- The wizard still hardcodes `ASPIRING_PERKS_BUDGET = 4` at `public/js/character-wizard.js:1640-1645` and still writes an aspiring character's three picks straight into `class_abilities`. **Plan 1 must not touch it.** Task 6's gate means the wizard's payload will simply not carry `aspiring_abilities` yet, so an aspiring creation through the wizard will fail Task 7's new validation — that is expected, and plan 2's first task fixes it. If that gap is intolerable between the two plans, run them back to back.
- No surface can buy an Advanced Ability or a Cross-Class ability yet.
- The classic form's ability picker still offers `c.abilities` only.
- Neither catalogue has grouping or search.
