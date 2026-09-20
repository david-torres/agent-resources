# Perk Economy Surfaces Implementation Plan (slice 4b, plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player actually spend Perks — unlocking Advanced and Cross-Class Abilities on both the wizard and the edit form — and give both purchase catalogues class grouping and search.

**Architecture:** Every Perk figure already exists in `util/perk-economy.js` and every rule is already enforced server-side (plan 1). This plan serves those figures to the browser through the established JSON-island pattern, builds the two purchase surfaces on top of them, and extracts the catalogue's grouping and search into one control both surfaces use.

**Tech Stack:** Bun, `bun:test`, Express 4, express-handlebars, htmx, Alpine, Playwright. `public/js/` files are browser IIFEs in ES5 — no `const`/`let`/arrow functions/template literals, no `require`.

**Spec:** `docs/superpowers/specs/2026-09-20-aspirant-v1-perk-economy-design.md`

**Depends on:** `docs/superpowers/plans/2026-09-20-aspirant-v1-perk-economy-engine.md` must be complete. Task 1 of this plan repairs a gap plan 1 knowingly leaves: after plan 1, the wizard does not send `aspiring_abilities`, so an aspiring creation fails plan 1's validation.

## Global Constraints

- **NEVER run `supabase db reset`.** Apply migrations with `supabase migration up` only. **Never read or restore anything under `backups/`.**
- Before any database-touching step: `eval "$(supabase status -o env)"; echo "API_URL=$API_URL"; grep -E '^SUPABASE_URL=' .env` — `API_URL` **must** print `http://127.0.0.1:54321`, or stop.
- `bun test <file>` does **NOT** get the `SUPABASE_URL` override. Only ever use `bun run test:unit`, `bun run test:http`, `bun run test:integration`, `bun run test:e2e`.
- **Baseline, measured 2026-09-20 before plan 1:** `bun run test:unit` is 185 files, 2292 pass, 0 fail. Plan 1 adds files; re-measure at this plan's start and record the number before changing anything.
- Row counts must not change: characters 327, traits 981, class_gear 1492, class_abilities 916, classes 62, character_perks 45.
- **No Perk number may appear in a browser file, a view or a route.** Every price, grant, cap and word limit comes from the served figures. This is the constraint plan 2 exists to honour — `ASPIRING_PERKS_BUDGET = 4` is exactly the defect being removed.
- `public/js/` is ES5: `var`, `function`, string concatenation. No `const`, `let`, arrow functions, template literals, spread, or `require`.
- Comments describe the code as it is now. No "was X, now Y", no changelog notes.
- When you replace something, delete what it replaced in the same change.
- Every commit message ends with a blank line, then:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
  ```

---

## File Structure

| File | Responsibility |
| --- | --- |
| `routes/characters.js` (modify) | Serves `perkFigures()` to the wizard; offers Advanced Abilities to the classic picker; builds the ability island. |
| `util/ability-purchase-data.js` (create) | Assembles the edit form's ability catalogue and figures, as `util/gear-purchase-data.js` does for Signatures. |
| `public/js/character-ability-purchases.js` (create) | The edit form's ability purchase surface. |
| `public/js/catalogue-controls.js` (create) | Class grouping and search, shared by both catalogues. |
| `public/js/character-gear-purchases.js` (modify) | Adopts the shared control. |
| `public/js/character-wizard.js` (modify) | Reads served Perk figures; aspiring pools; ability acquisition. |
| `views/character-form.handlebars` (modify) | Mounts the ability island and its surface. |
| `views/character-wizard.handlebars` (modify) | Carries the Perk figures. |
| `e2e/specs/30-perk-economy.spec.js` (create) | The journeys. |

---

### Task 1: Serve the Perk figures, and make the aspiring wizard submit its pools

**Files:**
- Modify: `routes/characters.js` (the `GET /characters/wizard` handler that builds `wizardData`)
- Modify: `public/js/character-wizard.js:1640-1645` and `:3874-3906`
- Modify: `test/character-wizard-client.test.js`, `routes/character-wizard-aspiring.test.js`

**Interfaces:**
- Consumes: `perkFigures()` from `util/perk-economy.js`.
- Produces: `DATA.perks` in the wizard island; `aspiring_abilities` in the wizard's submit payload.

**Why this is first.** Plan 1's Task 6 gates `aspiring_abilities` to creation and Task 7 requires three picks. The wizard does not send them yet, so aspiring creation is broken between the plans. This task closes that.

- [ ] **Step 1: Write the failing test**

Append to `test/character-wizard-client.test.js`:

```js
test('the wizard submits an aspiring character two Core and one Advanced pick', () => {
  const state = aspiringStateWithBuild({
    coreAbilities: [
      { classId: 'c1', abilityName: 'Standoff' },
      { classId: 'c2', abilityName: 'Viewpoint' }
    ],
    advancedAbility: { classId: 'c1', abilityName: 'Last Word' }
  });
  const payload = buildSubmitPayload(state);
  expect(payload.aspiring_abilities).toEqual([
    { class_id: 'c1', name: 'Standoff', type: 'core' },
    { class_id: 'c2', name: 'Viewpoint', type: 'core' },
    { class_id: 'c1', name: 'Last Word', type: 'advanced' }
  ]);
});

test('an unbought pick is not submitted as an owned ability', () => {
  // pg. 90 step 3b: the picks need not be acquired "immediately (or at all)".
  const state = aspiringStateWithBuild({
    coreAbilities: [
      { classId: 'c1', abilityName: 'Standoff' },
      { classId: 'c2', abilityName: 'Viewpoint' }
    ],
    advancedAbility: { classId: 'c1', abilityName: 'Last Word' },
    acquired: []
  });
  expect(buildSubmitPayload(state).abilities).toEqual([]);
});

test('a bought pick is submitted as an owned ability as well as a pick', () => {
  const state = aspiringStateWithBuild({
    coreAbilities: [
      { classId: 'c1', abilityName: 'Standoff' },
      { classId: 'c2', abilityName: 'Viewpoint' }
    ],
    advancedAbility: { classId: 'c1', abilityName: 'Last Word' },
    acquired: [{ classId: 'c1', abilityName: 'Standoff', type: 'core' }]
  });
  const payload = buildSubmitPayload(state);
  expect(payload.aspiring_abilities).toHaveLength(3);
  expect(payload.abilities).toEqual([
    { class_id: 'c1', name: 'Standoff', type: 'core' }
  ]);
});

test('the wizard holds no Perk figure of its own', () => {
  const source = require('fs').readFileSync(
    require.resolve('../public/js/character-wizard.js'), 'utf8'
  );
  expect(source).not.toContain('ASPIRING_PERKS_BUDGET');
  expect(source).not.toContain('ASPIRING_CORE_PERKS');
  expect(source).not.toContain('ASPIRING_ADVANCED_PERKS');
});
```

`aspiringStateWithBuild` does not exist. Build it in `test/wizard-fixture.js` if that file already exports similar helpers — check with `grep -n "module.exports" test/wizard-fixture.js` — otherwise define it locally at the top of the new block. It must produce whatever shape `buildSubmitPayload` already reads for `state.classBuild`, plus an `acquired` list the new code consults.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:unit`
Expected: FAIL — `payload.aspiring_abilities` is `undefined`.

- [ ] **Step 3: Serve the figures**

In `routes/characters.js`, in the handler that builds `wizardData`, beside the existing `economy: economyFigures()` and `statCaps: statCapFigures()` entries, add:

```js
        perks: perkFigures(),
```

and import `perkFigures` from `../util/perk-economy` at the top of the file.

- [ ] **Step 4: Read the figures in the client**

In `public/js/character-wizard.js`, beside the existing `var ECONOMY = DATA.economy;` (around `:23`), add:

```js
  var PERKS = DATA.perks;
```

Delete these lines entirely (`:1640-1645`):

```js
  const ASPIRING_CORE_PERKS = 1;
  const ASPIRING_ADVANCED_PERKS = 2;
  // Perk budget = 2 cores (1 each) + 1 advanced (2) = 4. Don't try to make
  // this smaller without also dropping a slot — the user has to pick all
  // three abilities, and the costs are what they are.
  const ASPIRING_PERKS_BUDGET = 4;
```

Replace every use of them with the served figures:

- `ASPIRING_CORE_PERKS` → `PERKS.prices.ability.own.core`
- `ASPIRING_ADVANCED_PERKS` → `PERKS.prices.ability.own.advanced`
- `ASPIRING_PERKS_BUDGET` → `PERKS.grants.aspiring`

**That last substitution changes the number from 4 to 3, and that is the point.** pg. 90 step 5 grants 3 Perks for picks costing 1 + 1 + 2 = 4. The shortfall is deliberate: step 3b says the picks need not be acquired "immediately (or at all)". Task 3 of this plan makes the surface express that; this task only stops the wizard inventing the grant.

Also fix the comment block above the deleted constants (`:1630-1639`): it describes a 4-Perk budget and says "the user has to pick all three abilities". Rewrite it to state the rule as it now is — three picks are chosen, the grant is 3 Perks, and acquisition is separate and optional.

- [ ] **Step 5: Submit the pool**

In `buildSubmitPayload` (`:3874-3906`), the aspiring branch currently sends `state.classBuild.coreAbilities` and `.advancedAbility` as owned `abilities`. Change it to send both:

```js
    if (mode === 'aspiring') {
      var build = state.classBuild || {};
      var picks = [];
      (build.coreAbilities || []).forEach(function (slot) {
        if (slot && slot.classId && slot.abilityName) {
          picks.push({ class_id: slot.classId, name: slot.abilityName, type: 'core' });
        }
      });
      if (build.advancedAbility && build.advancedAbility.classId && build.advancedAbility.abilityName) {
        picks.push({
          class_id: build.advancedAbility.classId,
          name: build.advancedAbility.abilityName,
          type: 'advanced'
        });
      }
      // The picks are the character's Class (pg. 90 steps 3a and 4b). What it
      // OWNS is only what it paid for -- the two are separate, which is why
      // they go into separate keys.
      payload.aspiring_abilities = picks;
      payload.abilities = (state.acquiredAbilities || []).map(function (a) {
        return { class_id: a.classId, name: a.abilityName, type: a.type === 'advanced' ? 'advanced' : 'core' };
      });
    }
```

Introduce `state.acquiredAbilities` as an empty array in the wizard's initial state. Task 3 gives the player a way to add to it; until then an aspiring character is created owning none of its picks, which is legal.

- [ ] **Step 6: Relax the distinct-class rule to the Cores only**

The aspiring builder's validation requires unique classes "within the abilities list". pg. 90 step 4a is explicit that the Advanced pick may repeat: *"You may repeat Classes from those your Signature Items and/or Core Abilities were sourced from."* Find the rule with `grep -n "unique\|distinct" public/js/character-wizard.js | head` and narrow it so only the two Core picks must come from different classes. This matches plan 1's `validateAspiringBuild`, which checks `corePicks` alone — leaving the client stricter than the server would reject builds the book allows.

- [ ] **Step 7: Run the tests**

Run: `bun run test:unit && bun run test:http`
Expected: unit 0 fail; http only `routes/open-graph.test.js`.

`routes/character-wizard-aspiring.test.js` constructs an aspiring submission by hand and will need `aspiring_abilities` added to its fixture. That is this task's work, not a later one's.

- [ ] **Step 8: Commit**

```bash
git add routes/characters.js public/js/character-wizard.js test/character-wizard-client.test.js routes/character-wizard-aspiring.test.js views/character-wizard.handlebars
git commit -m "$(cat <<'EOF'
feat: serve the Perk figures and submit an aspiring character's picks

The wizard's own ASPIRING_PERKS_BUDGET of 4 is deleted: pg. 90 grants 3,
and the shortfall is the rule, not an error.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 2: The aspiring primer becomes a purchase surface

**Files:**
- Modify: `public/js/character-wizard.js:1512-1560` (`renderAbilityPrimer`)
- Modify: `test/character-wizard-client.test.js`

**Interfaces:**
- Consumes: `PERKS` (Task 1), `state.acquiredAbilities`.
- Produces: an aspiring player can buy none, some or all of their three picks at creation.

**The current surface is a confirmation of a forced spend.** Its own comment says so: *"this page is a confirmation of the spend rather than a picker"*. pg. 90 makes it a choice, and a 3-Perk grant cannot buy 4 Perks of picks, so forcing the spend makes every legal aspiring character over-budget.

- [ ] **Step 1: Write the failing test**

Append to `test/character-wizard-client.test.js`:

```js
test('an aspiring character starts owning none of its picks', () => {
  const state = aspiringStateWithBuild({ /* three picks, as Task 1 */ });
  expect(state.acquiredAbilities).toEqual([]);
});

test('buying a Core pick spends one Perk', () => {
  const state = aspiringStateWithBuild({ /* three picks */ });
  acquireAbility(state, { classId: 'c1', abilityName: 'Standoff', type: 'core' });
  expect(perksSpent(state)).toBe(1);
  expect(perksRemaining(state)).toBe(2);
});

test('buying two Cores and the Advanced overspends the three-Perk grant', () => {
  const state = aspiringStateWithBuild({ /* three picks */ });
  acquireAbility(state, { classId: 'c1', abilityName: 'Standoff', type: 'core' });
  acquireAbility(state, { classId: 'c2', abilityName: 'Viewpoint', type: 'core' });
  expect(canAcquire(state, { classId: 'c1', abilityName: 'Last Word', type: 'advanced' })).toBe(false);
});

test('two of the three picks are affordable, which is the book intent', () => {
  const state = aspiringStateWithBuild({ /* three picks */ });
  acquireAbility(state, { classId: 'c1', abilityName: 'Standoff', type: 'core' });
  expect(canAcquire(state, { classId: 'c1', abilityName: 'Last Word', type: 'advanced' })).toBe(true);
  acquireAbility(state, { classId: 'c1', abilityName: 'Last Word', type: 'advanced' });
  expect(perksSpent(state)).toBe(3);
  expect(perksRemaining(state)).toBe(0);
});

test('a pick can be dropped and its Perk refunded before the character exists', () => {
  const state = aspiringStateWithBuild({ /* three picks */ });
  acquireAbility(state, { classId: 'c1', abilityName: 'Standoff', type: 'core' });
  dropAbility(state, { classId: 'c1', abilityName: 'Standoff' });
  expect(perksSpent(state)).toBe(0);
  expect(state.acquiredAbilities).toEqual([]);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:unit`
Expected: FAIL — `acquireAbility is not defined`.

- [ ] **Step 3: Implement the spend helpers**

Add to `public/js/character-wizard.js`, near the other aspiring helpers:

```js
  // pg. 90 step 3b: the picks are the character's Class, and it pays for them
  // "though you do not need to acquire them immediately (or at all)". So the
  // grant deliberately cannot cover all three -- 1 + 1 + 2 against a grant of
  // 3 -- and a player choosing two of the three is the expected outcome, not
  // an under-spend to warn about.
  var priceOfPick = function (pick) {
    return pick && pick.type === 'advanced'
      ? PERKS.prices.ability.own.advanced
      : PERKS.prices.ability.own.core;
  };

  var samePick = function (a, b) {
    return a && b && a.classId === b.classId && a.abilityName === b.abilityName;
  };

  var perksSpent = function (state) {
    return (state.acquiredAbilities || []).reduce(function (total, pick) {
      return total + priceOfPick(pick);
    }, 0);
  };

  var perksGrant = function () { return PERKS.grants.aspiring; };

  var perksRemaining = function (state) {
    return Math.max(0, perksGrant() - perksSpent(state));
  };

  var canAcquire = function (state, pick) {
    if ((state.acquiredAbilities || []).some(function (a) { return samePick(a, pick); })) return false;
    return perksSpent(state) + priceOfPick(pick) <= perksGrant();
  };

  var acquireAbility = function (state, pick) {
    if (!canAcquire(state, pick)) return false;
    state.acquiredAbilities = (state.acquiredAbilities || []).concat([pick]);
    return true;
  };

  var dropAbility = function (state, pick) {
    state.acquiredAbilities = (state.acquiredAbilities || []).filter(function (a) {
      return !samePick(a, pick);
    });
  };
```

Export them on whatever object `test/character-wizard-client.test.js` already reaches into for `buildSubmitPayload` — check how that test imports it and follow the same route rather than inventing a second one.

- [ ] **Step 4: Rewrite `renderAbilityPrimer`'s aspiring branch**

Each of the three picks gets a Buy or Drop button, disabled when unaffordable. The summary box replaces its current sentence with a readout of the form `Perks spent X / Y`, both numbers from `perksSpent(state)` and `perksGrant()`, plus a sentence stating that picks may be acquired later. Keep the existing card markup, the class tag, the `advanced` tag and the per-pick cost tag — only the buttons and the summary change.

Do not write `3`, `4`, `1` or `2` anywhere in this function. Every number comes from `PERKS`.

- [ ] **Step 5: Run the tests**

Run: `bun run test:unit`
Expected: PASS, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add public/js/character-wizard.js test/character-wizard-client.test.js
git commit -m "$(cat <<'EOF'
feat: let an aspiring character buy its picks, or none of them

pg. 90 grants 3 Perks against picks costing 4, so two of three is the
expected build rather than an under-spend.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 3: Advanced Abilities reach the classic picker

**Files:**
- Modify: `routes/characters.js:113` and `:129-131`
- Modify: `views/partials/character-class-abilities.handlebars`
- Modify: `routes/characters.test.js`

**Interfaces:**
- Produces: `classAbilityList` entries carry a type, and include each class's `advanced_abilities`.

**Why.** `filteredAbilities` is built from `c.abilities` alone, so an Advanced Ability is unreachable from the one form that can otherwise add any ability in the game — the thing this whole slice exists to unlock. The options post as `"ClassName::AbilityName"` strings and no `type` is submitted, so an Advanced pick would be stored as `core` and priced at the wrong rate.

- [ ] **Step 1: Write the failing test**

Append to `routes/characters.test.js`:

```js
test('the classic ability picker offers a class Advanced Abilities', () => {
  // A V1 class carries three Core and three Advanced; both must be offerable.
});

test('an Advanced option carries its type, so it is not stored as core', () => {
  // The option value must encode the type, or the ability is mispriced at
  // 2 Perks instead of being recognised as Advanced at all.
});
```

Fill both from the nearest existing test in that file that exercises `filterClassDataForUser` or renders the form.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:http`
Expected: FAIL — no Advanced Ability appears.

- [ ] **Step 3: Include the Advanced roster**

In `routes/characters.js`, replace line 113:

```js
  let filteredAbilities = Object.fromEntries(allClasses.map(c => [c.name, Array.isArray(c.abilities) ? c.abilities.map(a => a.name) : []]));
```

with a version that carries both rosters and each entry's type:

```js
  // A V1 class carries three Core Abilities and three Advanced ones, and an
  // Advanced Ability costs Perks to unlock (pg. 7). The type travels with the
  // name because the option posts as a single string: without it an Advanced
  // pick is stored as core and priced as though it were free.
  const abilityOptions = (c) => [
    ...(Array.isArray(c.abilities) ? c.abilities.map(a => ({ name: a.name, type: 'core' })) : []),
    ...(Array.isArray(c.advanced_abilities) ? c.advanced_abilities.map(a => ({ name: a.name, type: 'advanced' })) : [])
  ];
  let filteredAbilities = Object.fromEntries(allClasses.map(c => [c.name, abilityOptions(c)]));
```

Every consumer of `filteredAbilities` now receives objects rather than strings. Find them all before editing:

`grep -rn "classAbilityList" --include='*.js' --include='*.handlebars' . | grep -v node_modules`

and update each. `views/partials/character-class-abilities.handlebars` renders the `<select>`; its option value must encode the type, e.g. `ClassName::AbilityName::advanced`, and the submitted-value parser in `services/character/input.js` must learn the third segment. Find that parser with `grep -n '"::"\|::' services/character/input.js | head`.

- [ ] **Step 4: Run every tier**

Run: `bun run test:unit && bun run test:http`
Expected: unit 0 fail; http only `routes/open-graph.test.js`.

The two-segment format is used by saved data and possibly by the agent API — search for it before changing the separator, and keep the parser tolerant of a two-segment value, which means "core" exactly as it does today.

- [ ] **Step 5: Commit**

```bash
git add routes/characters.js views/partials/character-class-abilities.handlebars services/character/input.js routes/characters.test.js
git commit -m "$(cat <<'EOF'
feat: offer a class's Advanced Abilities on the classic form

The type travels with the option, because a single string that omits it
stores an Advanced Ability as core and prices it as free.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 4: The ability island

**Files:**
- Create: `util/ability-purchase-data.js`
- Create: `util/ability-purchase-data.test.js`
- Modify: `routes/characters.js` (the edit-form handler), `views/character-form.handlebars`

**Interfaces:**
- Consumes: `perkFigures()`, `tagAbilities` (plan 1).
- Produces: `buildAbilityPurchaseData({ character, characterClass, allClasses, economy, classFamilyOf }) -> { figures, economy, entries, owned, aspiringAbilities, level }`.

Model this file closely on `util/gear-purchase-data.js` — same shape, same responsibilities, same naming. An `entry` is a purchasable ability: `{ name, class_id, class_name, type, crossClass, price }`.

- [ ] **Step 1: Write the failing test**

Create `util/ability-purchase-data.test.js`:

```js
const { test, expect } = require('bun:test');
const { buildAbilityPurchaseData } = require('./ability-purchase-data');

const CLASS_A = { id: 'a', name: 'Gunslinger', abilities: [{ name: 'Standoff' }], advanced_abilities: [{ name: 'Last Word' }] };
const CLASS_B = { id: 'b', name: 'Illusionist', abilities: [{ name: 'Viewpoint' }], advanced_abilities: [] };

test('an own-class Advanced ability is offered at 2 Perks', () => {
  const data = buildAbilityPurchaseData({
    character: { class_id: 'a', abilities: [], ability_perks: [], level: 5 },
    characterClass: CLASS_A, allClasses: [CLASS_A, CLASS_B], economy: 'aspirant'
  });
  const entry = data.entries.find(e => e.name === 'Last Word');
  expect(entry.type).toBe('advanced');
  expect(entry.crossClass).toBe(false);
  expect(entry.price).toBe(2);
});

test('a cross-class Core ability is offered at 3 and an Advanced at 4', () => {
  const data = buildAbilityPurchaseData({
    character: { class_id: 'a', abilities: [], ability_perks: [], level: 5 },
    characterClass: CLASS_A, allClasses: [CLASS_A, CLASS_B], economy: 'aspirant'
  });
  expect(data.entries.find(e => e.name === 'Viewpoint').price).toBe(3);
});

test('the catalogue carries every unlocked class, not only the character own', () => {
  const data = buildAbilityPurchaseData({
    character: { class_id: 'a', abilities: [], ability_perks: [], level: 5 },
    characterClass: CLASS_A, allClasses: [CLASS_A, CLASS_B], economy: 'aspirant'
  });
  expect(new Set(data.entries.map(e => e.class_name))).toEqual(new Set(['Gunslinger', 'Illusionist']));
});

test('an aspiring character pool ability is own-class and its price is 1 or 2', () => {
  const data = buildAbilityPurchaseData({
    character: {
      class_id: null, abilities: [], ability_perks: [], level: 1,
      aspiring_abilities: [{ class_id: 'a', name: 'Standoff', type: 'core' }]
    },
    characterClass: null, allClasses: [CLASS_A, CLASS_B], economy: 'aspiring'
  });
  const pooled = data.entries.find(e => e.name === 'Standoff');
  expect(pooled.crossClass).toBe(false);
  expect(pooled.price).toBe(1);
});

test('an aspiring character unbought pick is still in the catalogue', () => {
  // The defect this mirrors: a pick that was selected but never bought fell
  // out of the Signature catalogue and became unbuyable.
  const data = buildAbilityPurchaseData({
    character: {
      class_id: null, abilities: [], ability_perks: [], level: 1,
      aspiring_abilities: [{ class_id: 'a', name: 'Standoff', type: 'core' }]
    },
    characterClass: null, allClasses: [CLASS_A, CLASS_B], economy: 'aspiring'
  });
  expect(data.entries.some(e => e.name === 'Standoff')).toBe(true);
});

test('the island carries the served figures, not its own numbers', () => {
  const data = buildAbilityPurchaseData({
    character: { class_id: 'a', abilities: [], ability_perks: [], level: 1 },
    characterClass: CLASS_A, allClasses: [CLASS_A], economy: 'aspirant'
  });
  expect(data.figures.prices.ability.cross.advanced).toBe(4);
  expect(data.figures.abilityCap.aspirant).toBe(6);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Follow `util/gear-purchase-data.js`'s structure. Key rules, each mirroring a defect slice 4 plan 3 had to fix:

- The catalogue collapses to the latest version of each class family, so a class does not appear three times.
- The aspiring pool is injected **unconditionally**, whether or not the pick has been bought — an unbought pick must remain purchasable.
- Cross-class is a version-family comparison, via the `classFamilyOf` the caller supplies.
- Prices come from `perkFigures()`; no number is written in this file.

- [ ] **Step 4: Mount it**

In `routes/characters.js`'s edit-form handler, build `abilityPurchaseData` beside the existing `gearPurchaseData` and pass it to the view. In `views/character-form.handlebars`, replace the Class Abilities block (`:298-310`) with an island mount modelled exactly on the `signaturePurchases` block at `:254-264`:

```handlebars
    <div id="abilityPurchases">
      <script type="application/json" id="ability-purchase-data">{{{json abilityPurchaseData}}}</script>
      <p class="help mb-3" id="abilityReadouts">
        Perks <span data-perks-spent>0</span> / <span data-perks-earned>0</span>
        &middot; Abilities <span data-abilities-used>0</span> / <span data-abilities-cap>0</span>
      </p>
      <div id="abilityCatalogue"></div>
      <input type="hidden" name="abilities_json" id="abilityJson">
    </div>
```

Keep the existing `character-perk-group` Ability-Perk editor exactly where it is — this task replaces the ability *picker*, not the perk editor.

- [ ] **Step 5: Run the tiers**

Run: `bun run test:unit && bun run test:http`
Expected: unit 0 fail; http only `routes/open-graph.test.js`.

- [ ] **Step 6: Commit**

```bash
git add util/ability-purchase-data.js util/ability-purchase-data.test.js routes/characters.js views/character-form.handlebars
git commit -m "$(cat <<'EOF'
feat: serve the edit form an ability catalogue and its Perk figures

An aspiring character's unbought pick stays in the catalogue: a pick that
falls out of it is a pick that can never be acquired.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 5: The edit form's ability purchase surface

**Files:**
- Create: `public/js/character-ability-purchases.js`
- Create: `test/character-ability-purchases.test.js`

**Interfaces:**
- Consumes: the `ability-purchase-data` island (Task 4).
- Produces: a mounted surface that buys and drops abilities, shows prices and cross-class badges, and writes `abilities_json`.

Model it on `public/js/character-gear-purchases.js`, whose own header states the contract to follow: *"This file reads the page (its JSON island, its common-item rows); the component it mounts reads nothing at all. Every price, grant and cap comes from the served figures — no economy number is written down here."*

- [ ] **Step 1: Write the failing test**

Create `test/character-ability-purchases.test.js` covering, at minimum:

```js
test('buying an own-class Advanced ability spends two Perks', () => {});
test('buying a cross-class Core ability spends three', () => {});
test('an ability that would breach the cap cannot be bought', () => {});
test('an ability that would overspend the balance cannot be bought', () => {});
test('a cross-class ability carries an origin badge naming its class', () => {});
test('dropping an ability refunds its Perks', () => {});
test('the serialized payload carries each ability class_id and type', () => {});
test('no Perk number is written down in this file', () => {
  const source = require('fs').readFileSync(
    require.resolve('../public/js/character-ability-purchases.js'), 'utf8'
  );
  // Every price must come from FIGURES. A bare 1/2/3/4 beside the word Perk
  // is the defect this whole slice exists to remove.
  expect(source).not.toMatch(/=\s*[1-6];\s*\/\/.*Perk/i);
});
```

Use `test/character-gear-purchases.test.js`'s jsdom setup verbatim — read it first; it already builds the document, the island and the mount.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the surface**

ES5 IIFE. It renders the catalogue, a Buy/Drop control per entry, the two readouts, and the hidden field. Cross-class entries carry an origin badge naming the class, exactly as `public/js/character-gear-purchases.js:99,358` does for Signatures.

The affordability check must consult **both** the balance and the cap — a character with Perks in hand but six abilities cannot buy a seventh.

- [ ] **Step 4: Run the tests**

Run: `bun run test:unit`
Expected: PASS.

- [ ] **Step 5: Client/server parity test**

Add one test that sweeps every `(economy, crossClass, type)` combination, comparing this file's price against `util/perk-economy.js`'s `priceOfAbility`. `test/signature-entry.test.js` does exactly this for Signatures — copy its approach. Without it, the two sides can drift while both stay green.

- [ ] **Step 6: Commit**

```bash
git add public/js/character-ability-purchases.js test/character-ability-purchases.test.js
git commit -m "$(cat <<'EOF'
feat: let a character spend Perks on Abilities from the edit form

Affordability consults the cap as well as the balance: Perks in hand do
not buy a seventh Ability.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 6: Grouping and search, once, for both catalogues

**Files:**
- Create: `public/js/catalogue-controls.js`
- Create: `test/catalogue-controls.test.js`
- Modify: `public/js/character-ability-purchases.js`, `public/js/character-gear-purchases.js:359-375`
- Modify: `views/character-form.handlebars`

**Interfaces:**
- Produces: `window.CatalogueControls.mount(root, { entries, groupBy, searchOf, renderEntry })` returning `{ render, setSearch }`.

**This closes slice 4's Ruling 20.** The Signature catalogue shipped on the edit form with no grouping, search or filter, and this plan adds a second catalogue of the same kind. One control, designed once, used by both.

**The design decision:** group by class at the top level, and search by entry name across every group. Grouping by class replaces the wizard shop's separate class-filter dropdown rather than joining it — two controls that partition the same axis is a worse surface than one. The Signature catalogue's existing column layout (`renderGrid`, which sorts entries into the book's four Signature columns) is kept *inside* each class group, because the columns are a rule of the book, not a UI convenience.

- [ ] **Step 1: Write the failing test**

Create `test/catalogue-controls.test.js`:

```js
test('entries are grouped by class, in stable order', () => {});
test('a search term filters entries by name across every group', () => {});
test('a group with no matching entry is hidden entirely', () => {});
test('clearing the search restores every group', () => {});
test('search is case-insensitive and ignores surrounding whitespace', () => {});
test('an entry with no class falls into a single unnamed group rather than vanishing', () => {});
```

Fill each from the jsdom setup `test/character-gear-purchases.test.js` uses.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the control**

ES5 IIFE exposing `window.CatalogueControls`. It owns the search input, the group headings and the show/hide logic; it renders no entry itself, delegating to the `renderEntry` its caller supplies. It knows nothing about Perks, Merx, abilities or Signatures.

- [ ] **Step 4: Adopt it in the ability surface**

Replace the ability catalogue's flat rendering with a `CatalogueControls.mount` call.

- [ ] **Step 5: Adopt it in the Signature surface**

In `public/js/character-gear-purchases.js`, `renderGrid` (`:359-375`) currently sorts entries into columns and emits one `columns is-multiline` block. Wrap it: `CatalogueControls` groups by class, and each group's body is the existing column grid for that class's entries. The existing `renderCell` is untouched.

Add the search input to `views/character-form.handlebars`'s `signaturePurchases` block, matching the ability block's markup.

- [ ] **Step 6: Run the tiers**

Run: `bun run test:unit && bun run test:http`
Expected: unit 0 fail; http only `routes/open-graph.test.js`.

`test/character-gear-purchases.test.js` asserts against the grid's DOM shape and will need updating for the new group wrapper. Update the assertions to the new structure; do not weaken them to pass.

- [ ] **Step 7: Commit**

```bash
git add public/js/catalogue-controls.js test/catalogue-controls.test.js public/js/character-ability-purchases.js public/js/character-gear-purchases.js test/character-gear-purchases.test.js views/character-form.handlebars
git commit -m "$(cat <<'EOF'
feat: group both purchase catalogues by class, and make them searchable

Closes the open question from the Signature catalogue: one control, used
by both surfaces, rather than a second ungrouped list.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 7: Ability acquisition in the wizard

**Files:**
- Modify: `public/js/character-wizard.js`
- Modify: `test/character-wizard-client.test.js`

**Interfaces:**
- Consumes: `PERKS`, `CatalogueControls`.
- Produces: an aspirant character can unlock an Advanced or Cross-Class ability during creation.

An aspirant character starts with 1 Perk (pg. 3) and the cheapest unlock is 2, so **no aspirant character can buy anything at creation.** The surface must therefore say so rather than present an empty shop: show the roster with its prices, the balance, and a line explaining that Perks accrue one per level.

- [ ] **Step 1: Write the failing test**

```js
test('an aspirant character cannot afford any unlock at creation', () => {
  // Grant 1, cheapest unlock 2.
  const state = aspirantStateAtLevel(1);
  expect(canAcquire(state, { type: 'advanced', crossClass: false })).toBe(false);
});

test('the wizard explains why, rather than showing an empty shop', () => {
  expect(renderAbilityShop(aspirantStateAtLevel(1))).toContain('one Perk per level');
});

test('an advent character is offered no ability shop at all', () => {
  // Advent has no unlock path; its three Core Abilities are the whole roster.
  expect(renderAbilityShop(adventState())).toBe('');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test:unit`

- [ ] **Step 3: Implement**

Reuse `canAcquire`/`acquireAbility` from Task 2 — they are economy-agnostic once the price comes from the entry rather than from a pick's type. Generalise `priceOfPick` to take `crossClass` as well, reading `PERKS.prices.ability[crossClass ? 'cross' : 'own'][type]`.

**Reuse the wizard's existing unlock filtering.** The shop must offer only classes the player has unlocked — the same filter the Signature shop uses. Find it with `grep -n "unlock" public/js/character-wizard.js | head` and call it rather than re-deriving; offering locked content for sale is the failure mode here.

- [ ] **Step 4: Run the tests**

Run: `bun run test:unit`

- [ ] **Step 5: Commit**

```bash
git add public/js/character-wizard.js test/character-wizard-client.test.js
git commit -m "$(cat <<'EOF'
feat: show the wizard's ability shop and what it costs

An aspirant character starts with 1 Perk against a cheapest unlock of 2,
so the shop explains the accrual rather than appearing broken.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

### Task 8: End to end

**Files:**
- Create: `e2e/specs/30-perk-economy.spec.js`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the spec**

Five journeys, each proving something no unit test can:

1. **An aspirant character buys an Advanced Ability from its own class for 2 Perks** on the edit form, and the character page shows the balance fall.
2. **An aspirant character buys a Cross-Class Core ability for 3 Perks**, and the page shows the origin badge naming the donor class.
3. **An aspiring character is created selecting three picks and buying none**, then buys two of the three later. This is the rule the whole slice turns on, and it must be proved end to end — three DONOR classes, not one.
4. **A grandfathered character still saves.** Create a character at the ability cap, then rename it and save; the save succeeds and the Illegal Build notice persists.
5. **The catalogue's search finds an ability in a class that is not the character's own**, proving the grouping and search work over the whole roster.

Model the file on `e2e/specs/29-aspiring-signature-acquisition.spec.js`, which proves the equivalent five points for Signatures.

- [ ] **Step 2: Run the e2e tier**

Run: `bun run test:e2e`
Expected: the new spec passes; the pre-existing failures (7 at last measurement) are unchanged in both count and identity. Record both before and after.

- [ ] **Step 3: Full sweep and row counts**

```bash
bun run test:unit && bun run test:http && bun run test:integration
eval "$(supabase status -o env)"
psql "$DB_URL" -t -A -F'|' -c "select (select count(*) from characters), (select count(*) from traits), (select count(*) from class_gear), (select count(*) from class_abilities), (select count(*) from classes), (select count(*) from character_perks);"
```
Expected: `327|981|1492|916|62|45`.

- [ ] **Step 4: Prove the constraint holds**

```bash
grep -rn "ASPIRING_PERKS_BUDGET\|ASPIRING_CORE_PERKS\|ASPIRING_ADVANCED_PERKS" public/ views/ routes/ || echo "none"
```
Expected: `none`.

- [ ] **Step 5: Commit**

```bash
git add e2e/specs/30-perk-economy.spec.js
git commit -m "$(cat <<'EOF'
test: walk the Perk economy end to end

Including the rule the slice turns on: an aspiring character selects
three picks, buys none, and buys two of them later.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0173Qx41prNZ9XUyi9htMkyx
EOF
)"
```

---

## Success criteria

1. An aspirant character unlocks an own-class Advanced Ability at 2 Perks and a Cross-Class ability at 3 or 4, on both the wizard and the edit form, and cannot exceed six Abilities.
2. An aspiring character selects two Core and one Advanced pick, receives 3 Perks, and may buy none, some or all of them later at 1/1/2.
3. Both catalogues group by class and offer a search box.
4. `grep` finds no Perk price, grant, cap or word limit outside `util/perk-economy.js`.
5. Row counts unchanged; the pre-existing failing files in every tier unchanged in count and identity.
