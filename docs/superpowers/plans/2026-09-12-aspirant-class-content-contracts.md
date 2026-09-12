# Aspirant Class-Content Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ENCLAVE: Aspirant's three new pieces of class content — Default Enchantments on Signature Items, Sample Perks on Abilities, and Advanced Abilities — a home in the class-content contracts, with a complete authoring, import, export and fork path.

**Architecture:** The three pieces nest inside the jsonb columns that already hold class content. `classes.gear[i]` gains a nullable `default_enchantment` object, `classes.abilities[i]` gains a `sample_perks` array, and the existing-but-empty `classes.advanced_abilities` column reuses the ability contract verbatim so one normalizer serves both columns. Everything downstream — admin form, class page, AI import, export, prerelease loader, `dup_class` — is then widened to carry the new keys.

**Tech Stack:** Bun, Express 4, express-handlebars, Alpine.js (CDN; registrations in `public/js/alpine-components.js`), Bulma, Supabase/Postgres, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-09-12-aspirant-class-content-contracts-design.md`

## Global Constraints

- **Branch:** `aspirant-v1-classes-and-characters`, stacked on `144-character-wizard-aspirant-and-aspiring`. Do not rebase onto `main`.
- **Contracts, exactly as the spec declares them.** No key may be added, renamed or made conditional beyond these:
  ```
  classes.gear[i].default_enchantment := { name, description, dedication } | null
  classes.abilities[i].sample_perks   := [ { name, text, dedication, compound_text } ]
  classes.advanced_abilities[i]       := same shape as classes.abilities[i]
  ```
- `default_enchantment` is **always present** as a key, `null` where the item has none. `sample_perks` is **always an array**, empty where the ability has none. Neither is conditional the way `pronunciation` is.
- **The repeaters are server-rendered, never `<template x-for>`.** `views/layouts/main.handlebars` puts `hx-boost="true"` on `<body>`, and htmx snapshots the live DOM into its history cache — `x-for` output restores from the snapshot *and* gets regenerated, doubling rows on every Back. Row markup lives in Handlebars inline partials so the server rows and the Alpine prototype cannot drift. See `views/class-form.handlebars:272-313`.
- **In the round-trip integration test, restate defaulting rules by hand — never import them.** `util/class-form-round-trip.integration.test.js:164-171` records why (R84): building the expected value by calling the function under test lets a change to that function cancel itself out.
- Put schema changes in a **new** timestamped `supabase/migrations/` file. Never edit an applied migration. Latest applied is `20260905000001`; this plan's migrations start at `20260912000000`.
- **Migrations and any loader run target LOCAL Supabase only.** The checked-in `.env` points at the **production** project. `bun run test:unit` scrubs it; `supabase start` + `supabase db reset` is the local path.
- Tests use `bun:test` (`const { test, expect } = require('bun:test');`). No `describe()` blocks — flat `test('lowercase sentence describing the rule', ...)`. Every non-obvious test carries a block comment above it saying **why the rule exists**, citing a file:line or migration where one applies. This is the strongest convention in the repo.
- A new test file lands in the unit bucket by default. If it boots Express add it to `httpFiles` in `scripts/run-tests.mjs`; if it needs Supabase add it to `integrationFiles` and start the file with `require('./require-local-supabase');`.
- Run `bun run check` and `bun run test` before every commit; `bun run test:http` for Task 4 and 7; `bun run test:integration` for Tasks 1 and 13.
- Follow the repo's comment discipline (`~/.claude/CLAUDE.md`): explain non-obvious *why*, never restate *what*, never narrate history. When you replace something, delete what it replaced.

## Known-red before you start

`util/class-form-round-trip.integration.test.js:399-407` asserts every `classes` column appears in either `COMPARED` or `NOT_ROUND_TRIPPED`. Neither list contains `advanced_abilities` (added by `20260817000000`) or `free_play_access` (added by `20260905000000`). Against a fully-migrated local stack this is **probably already failing**. Task 1 Step 1 establishes that baseline before anything is changed, so a pre-existing red is never mistaken for one this work caused.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `supabase/migrations/20260912000000_advanced_abilities_not_null.sql` | tighten the column | 1 |
| `util/class-abilities.js` | `sample_perks` normalization; serves both ability columns | 2 |
| `util/class-gear.js` | `default_enchantment` normalization | 3 |
| `routes/classes.js` | persist `advanced_abilities` on create and update | 4 |
| `views/class-form.handlebars` | enchantment fieldset, perk repeater, advanced-ability editor | 5 |
| `public/js/alpine-components.js` | renumbering for the new nested names | 5 |
| `views/class-view.handlebars` | render the three new pieces | 6 |
| `util/class-import.js` | zod schema, normalizers, edition-aware item caps | 7 |
| `util/class-export.js` | JSON and markdown emit the new keys | 8 |
| `util/seed-classes.js`, `scripts/load-prerelease-classes.mjs` | seeding and bundle load | 9 |
| `supabase/migrations/20260912000001_dup_class_advanced_abilities.sql` | fork no longer drops columns | 10 |
| `docs/custom-gpt-openapi.json` | agent contract item shapes | 11 |
| *(deletions)* | dead placeholder scripts and the empty const | 12 |
| `util/class-form-round-trip.integration.test.js` | column census and expected-shape builders | 13 |

---

### Task 1: Tighten `advanced_abilities` to NOT NULL

**Files:**
- Create: `supabase/migrations/20260912000000_advanced_abilities_not_null.sql`
- Test: `util/class-structured-columns.integration.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `classes.advanced_abilities jsonb NOT NULL DEFAULT '[]'::jsonb`. Every later task may assume the column is never null.

- [ ] **Step 1: Record the pre-existing baseline**

```bash
supabase start
supabase db reset
bun run test:integration 2>&1 | tee /tmp/baseline-integration.txt
```

Read the output and write down which tests are already failing. `util/class-form-round-trip.integration.test.js`'s column-census test is expected to be among them (see "Known-red before you start"). Task 13 fixes it. Do not fix it here, and do not let it block this task.

- [ ] **Step 2: Write the failing test**

Append to `util/class-structured-columns.integration.test.js`, following the file's existing pattern — a column-existence select plus a constraint probe:

```js
// 20260817000000 added the column nullable, which no other class-content
// column is: `examples` and `stat_spread` are both NOT NULL with a default.
// A null here reaches util/class-abilities.js as a non-array and normalizes to
// [], so the null never surfaces -- which is exactly why nothing caught it.
test('advanced_abilities is not null on any class', async () => {
  const { data, error } = await supabase
    .from('classes')
    .select('id')
    .is('advanced_abilities', null);

  expect(error).toBeNull();
  expect(data).toEqual([]);
});

test('advanced_abilities rejects an explicit null', async () => {
  const { data: existing } = await supabase.from('classes').select('id').limit(1);
  // PostgREST reports no error when an UPDATE matches no row.
  expect(existing).toHaveLength(1);

  const { error } = await supabase
    .from('classes')
    .update({ advanced_abilities: null })
    .eq('id', existing[0].id);

  expect(error?.code).toBe('23502');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun run test:integration 2>&1 | grep -A5 advanced_abilities`
Expected: the second test FAILS — the update succeeds and `error` is `undefined`, not `'23502'`.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260912000000_advanced_abilities_not_null.sql`:

```sql
-- 20260817000000 added advanced_abilities nullable. Every other class-content
-- column (`examples`, `stat_spread`, `gear`, `abilities`) is NOT NULL with an
-- empty default, and the divergence is invisible at runtime because a null
-- normalizes to [] on the way out -- so it can only be caught here.
--
-- The column now holds the same contract as `abilities`, not the
-- {name, description}[] the original comment described: an Aspirant class's
-- three Advanced Abilities carry paired actions, meters, notes and sample
-- perks exactly as its Core Abilities do.
UPDATE public.classes
SET advanced_abilities = '[]'::jsonb
WHERE advanced_abilities IS NULL;

ALTER TABLE public.classes
    ALTER COLUMN advanced_abilities SET DEFAULT '[]'::jsonb,
    ALTER COLUMN advanced_abilities SET NOT NULL;
```

- [ ] **Step 5: Apply and re-run**

Run: `supabase db reset && bun run test:integration 2>&1 | grep -A5 advanced_abilities`
Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260912000000_advanced_abilities_not_null.sql util/class-structured-columns.integration.test.js
git commit -m "fix: make classes.advanced_abilities NOT NULL like its sibling columns"
```

---

### Task 2: `sample_perks` on the ability contract

**Files:**
- Modify: `util/class-abilities.js:33-47`
- Test: `util/class-abilities.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeAbilities(value)` now returns objects with a sixth key, `sample_perks: Array<{ name: string, text: string, dedication: string|null, compound_text: string|null }>`, always present and possibly empty. Exported shape is unchanged otherwise. Tasks 4, 5, 7, 8 and 13 depend on this key name and shape.

- [ ] **Step 1: Write the failing tests**

Add to `util/class-abilities.test.js`. The existing `named` helper at `:24` stays as-is.

```js
// Every Aspirant ability prints two Sample Perks, one of which has a
// Compounded variant printed as a complete restatement rather than a delta
// (ENCLAVE: Aspirant, pg. 7). The book's own wording is what is being quoted,
// so compound_text holds the whole compounded text and nothing recombines it
// at render time.
test('a sample perk keeps its four fields', () => {
  const [ability] = normalizeAbilities([{
    name: 'Trickshot',
    sample_perks: [{
      name: 'Smoke Off the Barrel',
      text: 'Jauntily blowing smoke from the gun right after using this Ability will refund its Essence Cost.',
      dedication: 'In Honor of Caroline',
      compound_text: 'Refunds the Essence Cost and shortens the Cooldown.'
    }]
  }]);

  expect(ability.sample_perks).toEqual([{
    name: 'Smoke Off the Barrel',
    text: 'Jauntily blowing smoke from the gun right after using this Ability will refund its Essence Cost.',
    dedication: 'In Honor of Caroline',
    compound_text: 'Refunds the Essence Cost and shortens the Cooldown.'
  }]);
});

// dedication and compound_text are the two optional halves: most perks carry
// neither. They are stored as null rather than omitted so that every perk has
// the same shape, the rule the gear and ability contracts already follow.
test('a sample perk with no dedication or compound stores nulls', () => {
  const [ability] = normalizeAbilities([{
    name: 'Trickshot',
    sample_perks: [{ name: 'Waco Kid', text: 'Improves hand speed.' }]
  }]);

  expect(ability.sample_perks).toEqual([
    { name: 'Waco Kid', text: 'Improves hand speed.', dedication: null, compound_text: null }
  ]);
});

// The same rule every other row in this file follows: a blank row is a normal
// intermediate state in a repeater, so the name is what decides whether it survives.
test('a sample perk with no name is dropped', () => {
  const [ability] = normalizeAbilities([{
    name: 'Trickshot',
    sample_perks: [{ name: '  ', text: 'Orphaned.' }, { name: 'Waco Kid', text: 'Kept.' }]
  }]);

  expect(ability.sample_perks.map((perk) => perk.name)).toEqual(['Waco Kid']);
});

// The shape qs produces past its arrayLimit, for the reason this file's header
// records. Array order IS the print order.
test('sample perks are ordered numerically when object-shaped', () => {
  const sample_perks = {};
  sample_perks['21'] = { name: 'TwentyOne', text: 't' };
  sample_perks['9'] = { name: 'Nine', text: 't' };

  const [ability] = normalizeAbilities({ 0: { name: 'Trickshot', sample_perks } });

  expect(ability.sample_perks.map((perk) => perk.name)).toEqual(['Nine', 'TwentyOne']);
});

test('an ability with no sample perks gets an empty array', () => {
  expect(normalizeAbilities([named('Collar')])[0].sample_perks).toEqual([]);
});
```

Then update the one existing exact-key assertion at `util/class-abilities.test.js:105-106`:

```js
  expect(normalizeAbilities([{ name: 'Collar', description: ['a', 'b'] }]))
    .toEqual([{ name: 'Collar', description: '', paired_action: '', meters: [], notes: [], sample_perks: [] }]);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test util/class-abilities.test.js`
Expected: the five new tests FAIL (`ability.sample_perks` is `undefined`), and the amended existing test FAILS on the missing key.

- [ ] **Step 3: Write the implementation**

In `util/class-abilities.js`, add above `normalizeAbilities`:

```js
// A Sample Perk is a named piece of text with two optional halves: a
// dedication ("In Honor of Crow") printed under the name, and the Compounded
// variant. Both are stored as null rather than omitted so every perk has one
// shape -- `pronunciation` is the only key in this file that is conditional,
// and only because two live abilities carry one and nothing else may fabricate it.
//
// The name decides survival, matching the drop rule for abilities, gear items
// and notes: a blank row is a normal intermediate state in the repeater.
const normalizePerk = (row) => {
    const name = trimField(row.name);
    if (!name) return null;
    return {
        name,
        text: trimField(row.text),
        dedication: trimField(row.dedication) || null,
        compound_text: trimField(row.compound_text) || null
    };
};
```

and add the key inside the `ability` object literal at `:35-41`, after `notes`:

```js
            notes: indexedRows(row.notes).map(normalizeNote).filter(Boolean),
            sample_perks: indexedRows(row.sample_perks).map(normalizePerk).filter(Boolean)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test util/class-abilities.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add util/class-abilities.js util/class-abilities.test.js
git commit -m "feat: add sample_perks to the class ability contract"
```

---

### Task 3: `default_enchantment` on the gear contract

**Files:**
- Modify: `util/class-gear.js:154-173`
- Test: `util/class-gear.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeGear(value)` now returns objects with a sixth key, `default_enchantment: { name: string, description: string, dedication: string|null } | null`, always present. `gearCategory` is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `util/class-gear.test.js` (the file's `named` helper is at `:25`):

```js
// Each of an Aspirant class's twelve Signature Items comes with a unique
// Default Enchantment, unlocked with Merx (ENCLAVE: Aspirant, pg. 86). It is
// one object, not a list -- a Signature may hold no more than one Enchantment.
test('a default enchantment keeps its three fields', () => {
  const [item] = normalizeGear([{
    name: 'Cowboy Hat',
    default_enchantment: {
      name: 'Hats Off to You',
      description: 'Instantly share an Expertise with an ally.',
      dedication: 'In Honor of Cowboy Will'
    }
  }]);

  expect(item.default_enchantment).toEqual({
    name: 'Hats Off to You',
    description: 'Instantly share an Expertise with an ally.',
    dedication: 'In Honor of Cowboy Will'
  });
});

test('a default enchantment with no dedication stores null', () => {
  const [item] = normalizeGear([{
    name: 'Revolver',
    default_enchantment: { name: 'Big Iron', description: 'Project a Vision of past feats.' }
  }]);

  expect(item.default_enchantment)
    .toEqual({ name: 'Big Iron', description: 'Project a Vision of past feats.', dedication: null });
});

// Every one of the fifty live Advent classes has gear with no enchantment, so
// this is the overwhelmingly common case. It is a present null rather than an
// absent key so that every item has one shape.
test('an item with no enchantment gets a null', () => {
  expect(normalizeGear([named('Visor')])[0].default_enchantment).toBeNull();
});

// The enchantment's name decides whether it survives, the same rule the item
// itself follows -- an enchantment is not printable without one.
test('an unnamed enchantment is dropped', () => {
  for (const enchantment of [{ description: 'Orphaned.' }, { name: '   ' }, 'Big Iron', 42, null]) {
    expect(normalizeGear([{ name: 'Visor', default_enchantment: enchantment }])[0].default_enchantment)
      .toBeNull();
  }
});
```

Then update the one existing exact-key assertion at `util/class-gear.test.js:124-125`:

```js
  expect(normalizeGear([{ name: 'Visor', description: ['a', 'b'], category: ['default'] }]))
    .toEqual([{ name: 'Visor', description: '', category: 'default', meters: [], notes: [], default_enchantment: null }]);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test util/class-gear.test.js`
Expected: the four new tests FAIL (`default_enchantment` is `undefined`, and `toBeNull()` fails on undefined), and the amended existing test FAILS on the missing key.

- [ ] **Step 3: Write the implementation**

In `util/class-gear.js`, add above `normalizeGear`:

```js
// A Signature may hold no more than one Enchantment (ENCLAVE: Aspirant,
// pg. 86), so this is one object rather than a list. The dedication is the
// "In Honor of ..." line the book prints under some enchantment names.
//
// The name decides survival, the same rule the item itself follows: an
// enchantment with no name cannot be referred to during play, and a
// description with nothing to call it is not worth keeping the item's key for.
const normalizeEnchantment = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const name = trimField(value.name);
    if (!name) return null;
    return {
        name,
        description: trimField(value.description),
        dedication: trimField(value.dedication) || null
    };
};
```

and add the key inside the `normalizeGear` object literal at `:167-173`, after `notes`:

```js
        notes: indexedRows(row.notes).map(normalizeNote).filter(Boolean),
        default_enchantment: normalizeEnchantment(row.default_enchantment)
    }));
```

Then amend the stale census comment at `util/class-gear.js:154-160`. It currently claims "there is no gear key outside the contract to preserve" and states the live key census. Replace the census sentence with:

```js
// `name`, `description`, `category`, `meters`, `notes` and
// `default_enchantment` are this branch's declared gear contract, so every item
// gets all six: a legacy item that only ever had a name and a description picks
// up the rest on save. The pre-Aspirant census of jsonb_object_keys over the 300
// live gear items answered {category, description, name} and
// {category, description, meters, name, notes}; every one of them now also
// carries `default_enchantment: null`, which is what an Advent Signature has.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test util/class-gear.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add util/class-gear.js util/class-gear.test.js
git commit -m "feat: add default_enchantment to the class gear contract"
```

---

### Task 4: Persist `advanced_abilities` through the write handlers

**Files:**
- Modify: `routes/classes.js:670-674` (POST), `routes/classes.js:737-741` (PUT)
- Test: `routes/classes-structured-fields.test.js`

**Interfaces:**
- Consumes: `normalizeAbilities` from Task 2 (already imported at `routes/classes.js:34`), `normalizeGear` from Task 3.
- Produces: `req.body.advanced_abilities` is always a normalized array on both the create and update payloads. Tasks 5 and 13 depend on this.

- [ ] **Step 1: Repair the fixtures the widened contracts break**

Before adding behaviour, make the existing file green against Tasks 2 and 3. Six literals need the new keys:

`routes/classes-structured-fields.test.js:380-389` — add `sample_perks: []` to `expectedNestedAbility` (fixes the three tests at `:395`, `:402`, `:712`).
`:421-430` — add `sample_perks: []` to the ability ends-only-trim literal.
`:518-520` — becomes `{ name: 'Collar', description: '', paired_action: '', meters: [], notes: [], sample_perks: [] }`.
`:684-690` — add `sample_perks: []`.
`:741-750` — add `default_enchantment: null` to `expectedNestedGear` (fixes `:756`, `:763`, `:1046`).
`:779-788` — add `default_enchantment: null` to the gear ends-only-trim literal.
`:996-1002` — add `default_enchantment: null`.

Also amend the census comment at `:980-987` the same way Task 3 amended `util/class-gear.js`.

Run: `bun run test:http 2>&1 | tail -20`
Expected: `routes/classes-structured-fields.test.js` PASSES.

- [ ] **Step 2: Write the failing test**

Add to `routes/classes-structured-fields.test.js`:

```js
// An Aspirant class's three Advanced Abilities use the Core Ability contract
// unchanged, so they run through the same normalizer rather than a second copy
// of it. The column is written on every save for the same reason `gear` and
// `abilities` are: the form posts the full list, so an omitted list means an
// emptied one.
test('POST /classes normalizes advanced_abilities with the ability contract', async () => {
  await post({
    name: 'Gunslinger',
    'advanced_abilities[0][name]': 'High Noon',
    'advanced_abilities[0][description]': 'Pitch a combat action made by an enemy under pressure.',
    'advanced_abilities[0][meters][0][label]': 'Essence Cost',
    'advanced_abilities[0][meters][0][value]': 'Mid',
    'advanced_abilities[0][sample_perks][0][name]': 'Ecstasy of Gold',
    'advanced_abilities[0][sample_perks][0][text]': 'Untraceable music plays during the Paired Action.'
  });

  expect(capturedCreate.advanced_abilities).toEqual([{
    name: 'High Noon',
    description: 'Pitch a combat action made by an enemy under pressure.',
    paired_action: '',
    meters: [{ label: 'Essence Cost', value: 'Mid' }],
    notes: [],
    sample_perks: [
      { name: 'Ecstasy of Gold', text: 'Untraceable music plays during the Paired Action.', dedication: null, compound_text: null }
    ]
  }]);
});

test('PUT /classes/:id normalizes advanced_abilities with the ability contract', async () => {
  await put(CLASS_ID, {
    name: 'Gunslinger',
    'advanced_abilities[0][name]': 'Surefire'
  });

  expect(capturedUpdate.advanced_abilities).toEqual([{
    name: 'Surefire', description: '', paired_action: '', meters: [], notes: [], sample_perks: []
  }]);
});

test('a save that posts no advanced_abilities empties the column', async () => {
  await post({ name: 'Gunslinger' });

  expect(capturedCreate.advanced_abilities).toEqual([]);
});
```

Use whatever `CLASS_ID` constant the file's existing `put(...)` tests use; read `:398-403` for the shape of an update call.

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun run test:http 2>&1 | grep -A8 advanced_abilities`
Expected: FAIL — `capturedCreate.advanced_abilities` is `undefined`.

- [ ] **Step 4: Write the implementation**

In `routes/classes.js`, in **both** handlers, immediately after the existing `normalizeAbilities` line (`:670` and `:737`):

```js
    req.body.abilities = normalizeAbilities(req.body.abilities);
    // Aspirant's three Advanced Abilities carry the Core Ability contract
    // unchanged (ENCLAVE: Aspirant, pg. 7), so one normalizer serves both
    // columns. Like `gear` and `abilities`, the column is rewritten on every
    // save: the form posts the whole list, so an absent list is an emptied one.
    req.body.advanced_abilities = normalizeAbilities(req.body.advanced_abilities);
    dropRetiredAbilityFields(req.body);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run test:http`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add routes/classes.js routes/classes-structured-fields.test.js
git commit -m "feat: persist advanced_abilities through the class write handlers"
```

---

### Task 5: Admin form authoring UI

**Files:**
- Modify: `views/class-form.handlebars:12` (edition option), `:272-421` (ability editor), `:422-541` (gear editor)
- Modify: `public/js/alpine-components.js:94-130` (`renumberAbilityFields`), `:140-175` (`renumberGearFields`), `:484-535` (`abilityEditor`)
- Test: `views/class-form.test.js`

**Interfaces:**
- Consumes: the contracts from Tasks 2–3 and the write handlers from Task 4.
- Produces: form fields named `gear[gi][default_enchantment][name|description|dedication]`, `abilities[ai][sample_perks][pi][name|text|dedication|compound_text]`, and a full `advanced_abilities[ai][...]` editor. No later task depends on these names except through the handlers already wired in Task 4.

**Read first:** `views/class-form.handlebars:272-313`. It is the contract for this editor — server-rendered rows, no `x-model`, nothing `required`, row markup in inline partials, inert `<template data-prototype>` clones. Every addition below obeys it.

- [ ] **Step 1: Write the failing tests**

Add to `views/class-form.test.js`, matching the file's existing render-and-assert style:

```js
// The admin form is the only authoring path for class content, so a key the
// contract declares but the form cannot edit is a key that can only ever be
// set by an import. Task 4 wired the write handlers; these pin the inputs.
test('the gear editor offers a default enchantment on every item', () => {
  const html = render({ class: { gear: [{ name: 'Cowboy Hat' }] } });

  expect(html).toContain('name="gear[0][default_enchantment][name]"');
  expect(html).toContain('name="gear[0][default_enchantment][description]"');
  expect(html).toContain('name="gear[0][default_enchantment][dedication]"');
});

test('the gear editor prefills an existing default enchantment', () => {
  const html = render({ class: { gear: [{
    name: 'Cowboy Hat',
    default_enchantment: { name: 'Hats Off to You', description: 'Share an Expertise.', dedication: null }
  }] } });

  expect(html).toContain('value="Hats Off to You"');
});

test('the ability editor offers a sample perk repeater', () => {
  const html = render({ class: { abilities: [{ name: 'Trickshot', sample_perks: [{ name: 'Waco Kid' }] }] } });

  expect(html).toContain('name="abilities[0][sample_perks][0][name]"');
  expect(html).toContain('name="abilities[0][sample_perks][0][text]"');
  expect(html).toContain('name="abilities[0][sample_perks][0][compound_text]"');
  expect(html).toContain('data-prototype="perk"');
});

test('the form has an advanced ability editor', () => {
  const html = render({ class: { advanced_abilities: [{ name: 'High Noon' }] } });

  expect(html).toContain('name="advanced_abilities[0][name]"');
  expect(html).toContain('value="High Noon"');
});

// An Aspirant class could not be authored at all while this option was
// disabled: the form is the only path that sets rules_edition by hand.
test('the Aspirant edition option is selectable', () => {
  const html = render({ class: {} });

  expect(html).not.toMatch(/value="aspirant"[^>]*disabled/);
});
```

Read the top of `views/class-form.test.js` for the actual `render(...)` helper name and signature and use that; do not invent one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/class-form.test.js`
Expected: all five FAIL.

- [ ] **Step 3: Enable the Aspirant edition option**

`views/class-form.handlebars:12` — delete the `disabled` attribute:

```handlebars
              <option value="aspirant" {{#if (eq class.rules_edition "aspirant")}}selected{{/if}}>Aspirant</option>
```

- [ ] **Step 4: Add the enchantment fields to the gear row partial**

In `views/class-form.handlebars`, inside `{{#*inline "gearRow"}}` (`:479-523`), after the Notes field block that ends at `:521`:

```handlebars
      <div class="field">
        <label class="label is-small">Default Enchantment</label>
        <p class="help mb-2">A Signature may hold only one Enchantment. Leave the name blank if this item has none.</p>
        <div class="control mb-2">
          <input class="input" type="text" data-enchantment-field="name" name="gear[{{gi}}][default_enchantment][name]" value="{{gear.default_enchantment.name}}" placeholder="Enchantment name, e.g. Hats Off to You" aria-label="Enchantment name">
        </div>
        <div class="control mb-2">
          <textarea class="textarea" rows="3" data-enchantment-field="description" name="gear[{{gi}}][default_enchantment][description]" placeholder="What the enchantment does" aria-label="Enchantment description">{{gear.default_enchantment.description}}</textarea>
        </div>
        <div class="control">
          <input class="input is-small" type="text" data-enchantment-field="dedication" name="gear[{{gi}}][default_enchantment][dedication]" value="{{gear.default_enchantment.dedication}}" placeholder="Dedication, e.g. In Honor of Crow" aria-label="Enchantment dedication">
        </div>
      </div>
```

These use `data-enchantment-field` rather than `data-field`: the `[data-field]` loop in `renumberGearFields` emits flat `gear[gi][key]` names, which would flatten the nested object. They carry no `id`, so no `[data-label-for]` pairing is needed.

- [ ] **Step 5: Add the sample-perk sub-repeater to the ability editor**

In `views/class-form.handlebars`, add a new inline partial before `{{#*inline "abilityRow"}}` (i.e. before `:356`):

```handlebars
    {{#*inline "abilityPerkRow"}}
    <div class="box is-shadowless has-background-light mb-2" data-perk-row>
      <div class="field is-grouped mb-2">
        <div class="control is-expanded">
          <input class="input is-small" type="text" data-perk-field="name" name="abilities[{{ai}}][sample_perks][{{pi}}][name]" value="{{perk.name}}" placeholder="Perk name" aria-label="Sample perk name">
        </div>
        <div class="control is-expanded">
          <input class="input is-small" type="text" data-perk-field="dedication" name="abilities[{{ai}}][sample_perks][{{pi}}][dedication]" value="{{perk.dedication}}" placeholder="Dedication (optional)" aria-label="Sample perk dedication">
        </div>
        <div class="control">
          <button type="button" class="button is-small is-light" @click="removePerk($el)">Remove perk</button>
        </div>
      </div>
      <div class="control mb-2">
        <textarea class="textarea is-small" rows="2" data-perk-field="text" name="abilities[{{ai}}][sample_perks][{{pi}}][text]" placeholder="Perk text" aria-label="Sample perk text">{{perk.text}}</textarea>
      </div>
      <div class="control">
        <textarea class="textarea is-small" rows="2" data-perk-field="compound_text" name="abilities[{{ai}}][sample_perks][{{pi}}][compound_text]" placeholder="Compounded variant (optional) — the full restated text, not just the addition" aria-label="Compounded perk text">{{perk.compound_text}}</textarea>
      </div>
    </div>
    {{/inline}}
```

Then inside `{{#*inline "abilityRow"}}`, after the Notes field block that ends at `:399`:

```handlebars
      <div class="field">
        <label class="label is-small">Sample Perks</label>
        <div data-perk-list>
          {{#each ability.sample_perks}}{{> abilityPerkRow perk=this ai=../ai pi=@index}}{{/each}}
        </div>
        <button type="button" class="button is-small" @click="addPerk($el)">Add sample perk</button>
      </div>
```

And add the prototype alongside the others at `:417-420`:

```handlebars
    <template data-prototype="perk">{{> abilityPerkRow ai=0 pi=0}}</template>
```

- [ ] **Step 6: Add the advanced-ability editor**

The ability editor's inline partials hard-code the `abilities[...]` prefix, so the advanced editor cannot reuse them without parameterising every name. Rather than parameterise a settled partial, give the advanced editor its own `x-data="advancedAbilityEditor()"` root with partials named `advancedAbilityRow` / `advancedAbilityMeterRow` / `advancedAbilityNoteRow` / `advancedAbilityNoteChildRow` / `advancedAbilityPerkRow`, identical to the ability set with `advanced_abilities[{{ai}}]` in place of `abilities[{{ai}}]` and `data-advanced-row` / `data-advanced-list` in place of `data-ability-row` / `data-ability-list`. Inner attribute names (`data-meter-row`, `data-note-row`, `data-child-row`, `data-perk-row`) stay the same — the two editors are separate `x-data` roots, so as `renumberGearFields`' comment at `public/js/alpine-components.js:136-139` records, a query starting at one root can never reach across into the other.

Place the block immediately after the ability editor's closing `</div>` at `:421`, with its list defaulting to three empty rows:

```handlebars
    <label class="label">Advanced Abilities</label>
    <p class="help mb-3">Aspirant classes have three. Unlocked with Perks rather than started with, so an Advent class leaves these blank.</p>
    <div data-advanced-list>
      {{#if class.advanced_abilities.length}}
        {{#each class.advanced_abilities}}{{> advancedAbilityRow ability=this ai=@index}}{{/each}}
      {{else}}
        {{#times 3}}{{> advancedAbilityRow ai=@index}}{{/times}}
      {{/if}}
    </div>
```

- [ ] **Step 7: Teach the renumberers the new nested names**

In `public/js/alpine-components.js`, inside `renumberAbilityFields`'s per-ability loop (after the `[data-note-row]` block that ends at `:128`):

```js
    abilityRow.querySelectorAll('[data-perk-row]').forEach((perkRow, pi) => {
      perkRow.querySelectorAll('[data-perk-field]').forEach((field) => {
        field.name = `abilities[${ai}][sample_perks][${pi}][${field.dataset.perkField}]`;
      });
    });
```

Inside `renumberGearFields`'s per-item loop (after the `[data-note-row]` block that ends at `:173`):

```js
    // The enchantment is one object, not a list, so there is no index to
    // renumber -- only the item's own. It is kept out of the [data-field] loop
    // above because that loop emits flat `gear[gi][key]` names, which would
    // collapse the nesting.
    gearRow.querySelectorAll('[data-enchantment-field]').forEach((field) => {
      field.name = `gear[${gi}][default_enchantment][${field.dataset.enchantmentField}]`;
    });
```

Add `addPerk` / `removePerk` to `abilityEditor` (`:484-535`), alongside the existing pairs:

```js
    addPerk($el) {
      this.appendRow($el.closest('[data-ability-row]'), 'perk', '[data-perk-list]');
    },

    removePerk($el) {
      this.removeRow($el, '[data-perk-row]');
    },
```

Then add `renumberAdvancedAbilityFields` — a copy of `renumberAbilityFields` over `[data-advanced-row]` emitting `advanced_abilities[...]` names and ids prefixed `advanced-ability-` — and an `advancedAbilityEditor` Alpine component that is `abilityEditor` with `addAbility`/`removeAbility` renamed to `addAdvanced`/`removeAdvanced`, `[data-ability-row]` replaced by `[data-advanced-row]`, `[data-ability-list]` by `[data-advanced-list]`, and both `appendRow`/`removeRow` calling `renumberAdvancedAbilityFields`. Keep the `$root`-read-before-removal ordering and the comment explaining it (`:527-529`).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test views/class-form.test.js && bun run check`
Expected: PASS.

- [ ] **Step 9: Verify the repeaters by hand**

Run: `supabase start && bun run seed:local && bun run dev`, open a class in the admin editor, and confirm: adding and removing a sample perk renumbers the remaining rows contiguously; adding and removing an ability renumbers its nested perks; the enchantment fields renumber when a gear row above them is removed; a Back navigation does not double any rows.

- [ ] **Step 10: Commit**

```bash
git add views/class-form.handlebars public/js/alpine-components.js views/class-form.test.js
git commit -m "feat: author enchantments, sample perks and advanced abilities in the class form"
```

---

### Task 6: Render the new content on the class page

**Files:**
- Modify: `views/class-view.handlebars:242-308`
- Test: `views/class-view.test.js`

**Interfaces:**
- Consumes: the contracts from Tasks 2–3.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing tests**

Add to `views/class-view.test.js`, using whatever render helper the file already defines:

```js
// Nothing on this page is gated on rules_edition today (the only other
// reference is the Duplicate modal's <option> at :334-335), and nothing needs
// to be: an Advent item carries default_enchantment: null and an Advent
// ability carries sample_perks: [], so both sections simply do not print.
test('a gear item prints its default enchantment', () => {
  const html = render({ class: { gear: [{
    name: 'Cowboy Hat',
    category: 'default',
    default_enchantment: { name: 'Hats Off to You', description: 'Share an Expertise.', dedication: 'In Honor of Cowboy Will' }
  }] } });

  expect(html).toContain('Hats Off to You');
  expect(html).toContain('Share an Expertise.');
  expect(html).toContain('In Honor of Cowboy Will');
});

test('a gear item with no enchantment prints no enchantment block', () => {
  const html = render({ class: { gear: [{ name: 'Visor', category: 'default', default_enchantment: null }] } });

  expect(html).not.toContain('Default Enchantment');
});

test('an ability prints its sample perks and the compounded variant', () => {
  const html = render({ class: { abilities: [{
    name: 'Trickshot',
    sample_perks: [{ name: 'Waco Kid', text: 'Improves hand speed.', dedication: null, compound_text: 'Improves hand speed and teleports the weapon back.' }]
  }] } });

  expect(html).toContain('Waco Kid');
  expect(html).toContain('Improves hand speed.');
  expect(html).toContain('Improves hand speed and teleports the weapon back.');
});

test('advanced abilities print in their own section', () => {
  const html = render({ class: { advanced_abilities: [{ name: 'High Noon', description: 'Pitch a Fizzle.' }] } });

  expect(html).toContain('Advanced Abilities');
  expect(html).toContain('High Noon');
});

test('a class with no advanced abilities prints no Advanced Abilities heading', () => {
  const html = render({ class: { advanced_abilities: [] } });

  expect(html).not.toContain('Advanced Abilities');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/class-view.test.js`
Expected: the four positive tests FAIL.

- [ ] **Step 3: Write a shared enchantment partial**

Create `views/partials/class-enchantment.handlebars`, following the guard-on-presence style of `class-meters.handlebars` and `class-notes.handlebars`:

```handlebars
{{#if enchantment.name}}
<div class="class-enchantment mt-3">
  <p class="has-text-weight-semibold has-text-grey is-size-7 mb-1">Default Enchantment</p>
  <p class="mb-1"><strong>{{enchantment.name}}</strong>{{#if enchantment.dedication}} <span class="has-text-grey is-size-7">{{enchantment.dedication}}</span>{{/if}}</p>
  <p>{{enchantment.description}}</p>
</div>
{{/if}}
```

And `views/partials/class-sample-perks.handlebars`:

```handlebars
{{#if perks.length}}
<div class="class-sample-perks mt-3">
  <p class="has-text-weight-semibold has-text-grey is-size-7 mb-1">Sample Perks</p>
  {{#each perks}}
  <div class="mb-2">
    <p class="mb-1"><strong>{{this.name}}</strong>{{#if this.dedication}} <span class="has-text-grey is-size-7">{{this.dedication}}</span>{{/if}}</p>
    <p class="mb-1">{{this.text}}</p>
    {{#if this.compound_text}}
    <p class="pl-4 has-text-grey"><em>Compounded:</em> {{this.compound_text}}</p>
    {{/if}}
  </div>
  {{/each}}
</div>
{{/if}}
```

- [ ] **Step 4: Wire the partials into the page**

In `views/class-view.handlebars`, in **both** gear columns — after `{{> class-notes notes=gear.notes}}` at `:257` and again at `:276`:

```handlebars
                    {{> class-enchantment enchantment=gear.default_enchantment}}
```

In the abilities `{{#each}}`, after `{{> class-notes notes=this.notes}}` at `:301`:

```handlebars
                {{> class-sample-perks perks=this.sample_perks}}
```

Then add an Advanced Abilities card after the Abilities card closes at `:308`, guarded on length the way the Gear and Abilities sections are:

```handlebars
    {{#if class.advanced_abilities.length}}
    <div class="card">
      <div class="card-content">
        <div class="content">
          <h3 class="title is-3">Advanced Abilities</h3>
          {{#each class.advanced_abilities}}
          <div class="card">
            <div class="card-content">
              <div class="content">
                <h4 class="title is-4">{{this.name}}</h4>
                {{{markdown this.description}}}
                {{> class-meters meters=this.meters}}
                {{#if this.paired_action}}
                <p><strong>Paired Action:</strong> {{this.paired_action}}</p>
                {{/if}}
                {{> class-notes notes=this.notes}}
                {{> class-sample-perks perks=this.sample_perks}}
              </div>
            </div>
          </div>
          {{/each}}
        </div>
      </div>
    </div>
    {{/if}}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test views/class-view.test.js && bun run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add views/class-view.handlebars views/partials/class-enchantment.handlebars views/partials/class-sample-perks.handlebars views/class-view.test.js
git commit -m "feat: render enchantments, sample perks and advanced abilities on the class page"
```

---

### Task 7: AI import path

**Files:**
- Modify: `util/class-import.js:27-74` (zod), `:104-144` (normalizers), `:150-190` (`processClassImport`)
- Test: `util/class-import.test.js`

**Interfaces:**
- Consumes: the contracts from Tasks 2–3.
- Produces: `classImportSchema.shape` gains `advanced_abilities`; `classImportSchema.shape.abilities.element.shape` gains `sample_perks`; `classImportSchema.shape.gear.element.shape` gains `default_enchantment`. Task 8's two set-comparison tests read these directly.

- [ ] **Step 1: Write the failing tests**

Add to `util/class-import.test.js`, and update the three existing exact-item `toEqual`s at `:113-120`, `:129-131` and `:166-172` to carry `sample_perks: []` / `default_enchantment: null`.

```js
// An Aspirant class has twelve Signature Items, not six, and three Advanced
// Abilities on top of its three Core (ENCLAVE: Aspirant, pg. 11). The caps are
// per-edition because an Advent writeup that yields twelve items is a
// hallucination, while an Aspirant one that yields six is a truncation.
test('an aspirant import keeps all twelve gear items', async () => {
  const created = await importClass({ rules_edition: 'aspirant', gear: twelveItems() });

  expect(created.gear).toHaveLength(12);
});

test('an advent import is still capped at six gear items', async () => {
  const created = await importClass({ rules_edition: 'advent', gear: twelveItems() });

  expect(created.gear).toHaveLength(6);
});

test('an import carries advanced abilities through in the ability contract', async () => {
  const created = await importClass({
    rules_edition: 'aspirant',
    advanced_abilities: [{ name: 'High Noon', description: 'Pitch a Fizzle.' }]
  });

  expect(created.advanced_abilities).toEqual([
    { name: 'High Noon', description: 'Pitch a Fizzle.', paired_action: '', meters: [], notes: [], sample_perks: [] }
  ]);
});

test('an import carries sample perks and a default enchantment', async () => {
  const created = await importClass({
    abilities: [{ name: 'Trickshot', sample_perks: [{ name: 'Waco Kid', text: 'Improves hand speed.' }] }],
    gear: [{ name: 'Cowboy Hat', default_enchantment: { name: 'Hats Off to You', description: 'Share an Expertise.' } }]
  });

  expect(created.abilities[0].sample_perks).toEqual([
    { name: 'Waco Kid', text: 'Improves hand speed.', dedication: null, compound_text: null }
  ]);
  expect(created.gear[0].default_enchantment).toEqual({
    name: 'Hats Off to You', description: 'Share an Expertise.', dedication: null
  });
});
```

Read the top of `util/class-import.test.js` for how it stubs the LLM `completion` call and what its create-capture helper is called; reuse those rather than inventing `importClass`, and add a local `twelveItems()` builder returning twelve `{ name: \`Item ${i}\` }` objects.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test util/class-import.test.js`
Expected: the four new tests FAIL; the three amended ones FAIL on the missing keys.

- [ ] **Step 3: Extend the zod schema**

In `util/class-import.js`, after `noteSchema` (`:21-25`):

```js
const perkSchema = z.object({
  name: z.string().describe("Sample perk name"),
  text: z.string().nullable().optional().describe("The perk's effect text"),
  dedication: z.string().nullable().optional().describe("An 'In Honor of ...' line printed under the perk name, only if the writeup gives one"),
  compound_text: z.string().nullable().optional().describe("The full text of the Compounded variant, restated in full rather than as a delta; only if the writeup prints one"),
});

const enchantmentSchema = z.object({
  name: z.string().describe("Enchantment name"),
  description: z.string().nullable().optional().describe("What the enchantment does"),
  dedication: z.string().nullable().optional().describe("An 'In Honor of ...' line printed under the enchantment name, only if the writeup gives one"),
});
```

Add to `abilitySchema` (`:27-34`):

```js
  sample_perks: z.array(perkSchema).nullable().optional().describe("The two Sample Perks printed under the ability, if any"),
```

Add to `gearSchema` (`:36-42`):

```js
  default_enchantment: enchantmentSchema.nullable().optional().describe("The item's Default Enchantment, if the writeup prints one"),
```

Add to the top-level `schema` (`:52-74`), immediately after `abilities`:

```js
  advanced_abilities: z.array(abilitySchema).nullable().optional().describe("The three Advanced Abilities of an Aspirant class, unlocked with Perks rather than started with"),
```

- [ ] **Step 4: Extend the normalizers**

Mirror Tasks 2 and 3 in this file's module-local normalizers. After `normalizeNotes` (`:94-102`):

```js
// The form's rule, restated for the model's output: the name decides survival,
// and the two optional halves are stored as null rather than omitted.
const normalizePerks = (perks) => (Array.isArray(perks) ? perks : [])
  .filter((perk) => perk && text(perk.name))
  .map((perk) => ({
    name: text(perk.name),
    text: text(perk.text),
    dedication: optionalText(perk.dedication),
    compound_text: optionalText(perk.compound_text),
  }));

const normalizeEnchantment = (enchantment) => {
  if (!enchantment || typeof enchantment !== "object" || !text(enchantment.name)) return null;
  return {
    name: text(enchantment.name),
    description: text(enchantment.description),
    dedication: optionalText(enchantment.dedication),
  };
};
```

Add `sample_perks: normalizePerks(ability.sample_perks),` to the `normalized` object in `normalizeAbilities` (`:109-114`), and `default_enchantment: normalizeEnchantment(item.default_enchantment),` to the object in `normalizeGear` (`:135-143`).

- [ ] **Step 5: Make the caps edition-aware**

Replace the two call sites in `processClassImport` (`:177-178`):

```js
      abilities: normalizeAbilities(parsed.abilities),
      advanced_abilities: normalizeAbilities(parsed.advanced_abilities, ADVANCED_ABILITY_LIMIT),
      gear: normalizeGear(parsed.gear, edition === "aspirant" ? ASPIRANT_GEAR_LIMIT : ADVENT_GEAR_LIMIT),
```

with `const edition = parsed.rules_edition || "advent";` declared above the `classData` literal, and these constants beside `BASE_GEAR_COUNT` (`:131`):

```js
// Advent classes print six Signature Items; Aspirant classes print twelve
// (ENCLAVE: Aspirant, pg. 8). The cap is per-edition because it is the only
// guard against a model padding a six-item writeup out to twelve.
const ADVENT_GEAR_LIMIT = 6;
const ASPIRANT_GEAR_LIMIT = 12;
const ADVANCED_ABILITY_LIMIT = 3;
```

Note that `rules_edition` is resolved before `classData` is built, so it must be read from `parsed`, not from the half-built literal.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test util/class-import.test.js && bun run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add util/class-import.js util/class-import.test.js
git commit -m "feat: import enchantments, sample perks and advanced abilities"
```

---

### Task 8: Export path

**Files:**
- Modify: `util/class-export.js:159-198` (markdown), `:205-231` (item exporters), `:232-252` (`exportToJson`)
- Test: `util/class-export.test.js`

**Interfaces:**
- Consumes: the zod schema from Task 7 — two tests in this file compare the exporter's key set against `classImportSchema` directly.
- Produces: nothing later tasks depend on.

**Read first:** `util/class-export.test.js:136-162`. Those two tests are a vice — "every importable key is exported" and "the export emits nothing beyond the importable keys but `EXPORT_ONLY_KEYS`". Because Task 7 put `advanced_abilities` in the zod schema, adding it to the exporter here keeps both green with **no change to `EXPORT_ONLY_KEYS`**. If you find yourself wanting to append to that list, you have wired something asymmetrically.

- [ ] **Step 1: Write the failing tests**

First widen the `BEASTMASTER` fixture at `util/class-export.test.js:11-47` so the per-item tests at `:164-176` exercise the new keys: give the ability at `:37-44` a `sample_perks` array with one fully-populated perk, and give one gear item at `:33-36` a `default_enchantment` object while leaving another at `null`. Add an `advanced_abilities` array with one ability.

Then amend the three existing literal assertions:

`:54-59` — the markdown section list becomes five entries:
```js
  expect(sectionsOf(content)).toEqual([
    '## 📖 Overview',
    '## 💡 Tips',
    '## 🎒 Gear',
    '## ⚔️ Abilities',
    '## ✨ Advanced Abilities',
  ]);
```

`:94-120` — insert `'advanced_abilities',` immediately after `'abilities',` in the sorted top-level key list.

`:180-188` — the legacy-item test becomes the literal statement of the spec's success criterion:
```js
// The spec's success criterion, stated as a test: an Advent class round-trips
// unchanged apart from picking up the two new keys at their absent values.
  expect(parsed.abilities[0]).toEqual({ name: 'Swing', description: 'Hits.', paired_action: '', meters: [], notes: [], sample_perks: [] });
  expect(parsed.gear[0]).toEqual({ name: 'Sword', description: 'Sharp.', category: 'default', meters: [], notes: [], default_enchantment: null });
```

Note `:82-88` — the bare-class test asserting `sectionsOf(content)).toEqual([])` — must stay green, which means the Advanced Abilities heading has to be guarded on a non-empty array exactly as Gear (`class-export.js:161`) and Abilities (`:183`) are.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test util/class-export.test.js`
Expected: the amended literals FAIL, and the per-item tests at `:164-176` FAIL on `toEqual(BEASTMASTER.abilities[0])` because the exporter drops the new keys.

- [ ] **Step 3: Widen the item exporters**

In `util/class-export.js`, add to the `exported` object in `exportAbility` (`:207-212`):

```js
    sample_perks: ability.sample_perks ?? [],
```

and to the object returned by `exportGearItem` (`:224-230`):

```js
    default_enchantment: item.default_enchantment ?? null,
```

- [ ] **Step 4: Add `advanced_abilities` to the JSON export**

In `exportToJson` (`:236-251`), immediately after the `abilities` line at `:246`:

```js
    advanced_abilities: (classData.advanced_abilities || []).map(exportAbility),
```

- [ ] **Step 5: Add the markdown section**

In the markdown builder, after the Abilities block that starts at `:183`, add a section guarded the same way:

```js
  if (classData.advanced_abilities && classData.advanced_abilities.length > 0) {
```

emitting `## ✨ Advanced Abilities` and then each entry through whatever per-ability markdown helper the Abilities block already uses at `:186`. Read `:183-198` and mirror it exactly rather than writing a second formatter.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test util/class-export.test.js && bun run check`
Expected: PASS, including the two set-comparison tests at `:148-162` with `EXPORT_ONLY_KEYS` untouched.

- [ ] **Step 7: Commit**

```bash
git add util/class-export.js util/class-export.test.js
git commit -m "feat: export enchantments, sample perks and advanced abilities"
```

---

### Task 9: Seeding and the prerelease loader

**Files:**
- Modify: `scripts/load-prerelease-classes.mjs:50-52` (`FIELDS`) and its `buildPayload`
- Test: `test/load-prerelease-classes.test.js`, `util/seed-classes.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `FIELDS` includes `'advanced_abilities'`; `buildPayload(record)` emits the key for every record.

**Deliberate non-change:** `util/seed-classes.js`'s `buildRow` emits gear and abilities as `{ name, description: '' }` — already narrower than the five-key contract, and has been since long before this work. Widening it would rewrite the four expected-literal builders in `util/seed-classes.test.js:44-64` for no behavioural gain: the admin form normalizes on first save, and the exporter fills the absent keys with `?? ''` / `?? null`. `buildRow` already emits `advanced_abilities: []` (`util/seed-classes.js:67`) and no test pins it — that gap is closed below. The spec's wiring table listed `buildRow` as emitting the new keys; this is the one place this plan narrows it, and this is the reason.

- [ ] **Step 1: Write the failing tests**

Add to `util/seed-classes.test.js`:

```js
// buildRow has emitted this since 8d5edaa and nothing pinned it, so a seed
// that stopped emitting it would only surface as a NOT NULL violation from
// 20260912000000 at insert time, long after the change.
test('every seeded class row carries an empty advanced_abilities array', () => {
  for (const row of buildHardcodedClasses()) {
    expect(row.advanced_abilities).toEqual([]);
  }
});
```

The allowlist test at `test/load-prerelease-classes.test.js:114-122` self-compares against the imported `FIELDS`, so it will not fail on its own. Pin the emission explicitly instead:

```js
// FIELDS and buildPayload are compared against each other above, so widening
// FIELDS alone stays green while buildPayload silently omits the key for every
// record. The column is NOT NULL as of 20260912000000, so an omitted key is an
// insert failure rather than a null row.
test('every payload carries an advanced_abilities array', () => {
  for (const record of records) {
    expect(Array.isArray(buildPayload(record).advanced_abilities)).toBe(true);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test util/seed-classes.test.js test/load-prerelease-classes.test.js`
Expected: the seed test PASSES already (buildRow emits it); the loader test FAILS.

- [ ] **Step 3: Write the implementation**

In `scripts/load-prerelease-classes.mjs`, append `'advanced_abilities'` to `FIELDS` (`:50-52`), and in `buildPayload` emit it unconditionally:

```js
    // The August 2026 artifact predates Aspirant V1 and carries no advanced
    // abilities, so every record loads []. The key is emitted unconditionally
    // because the column is NOT NULL (20260912000000) and because the
    // allowlist test compares the payload's key set against FIELDS exactly.
    advanced_abilities: record.advanced_abilities ?? [],
```

`RICH_TEXT_KEYS` (`:63-65`) stays `new Set(['notes'])`: a sample perk's `text` and `compound_text` are whole-line strings, not the run-per-leaf trees that `notes` holds, so they take the ordinary `trimEnds` path.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test util/seed-classes.test.js test/load-prerelease-classes.test.js`
Expected: PASS, including the existing allowlist test at `:114-122`.

- [ ] **Step 5: Commit**

```bash
git add scripts/load-prerelease-classes.mjs test/load-prerelease-classes.test.js util/seed-classes.test.js
git commit -m "feat: carry advanced_abilities through the prerelease loader"
```

---

### Task 10: Stop `dup_class` dropping columns

**Files:**
- Create: `supabase/migrations/20260912000001_dup_class_advanced_abilities.sql`
- Test: `models/class-duplicate.test.js` or a new integration test — see Step 1

**Interfaces:**
- Consumes: Task 1's NOT NULL column.
- Produces: `dup_class(new_id, base_id, new_version, new_edition)` copies `advanced_abilities` and `free_play_access`.

`dup_class`'s explicit column list at `supabase/migrations/20260904000002_drop_class_description.sql:87-118` (INSERT) and `:119-149` (SELECT) omits both columns, so a fork silently drops them. This is a pre-existing bug; it is fixed here because the fork path is about to start carrying content that matters.

- [ ] **Step 1: Write the failing test**

`models/class-duplicate.test.js` is a unit test over a mocked repository and cannot reach the RPC. Add an integration test instead — create `util/class-duplicate.integration.test.js`, add it to `integrationFiles` in `scripts/run-tests.mjs`, and start it with `require('./require-local-supabase');` following `util/class-structured-columns.integration.test.js`'s setup:

```js
// dup_class lists its columns explicitly, so a column added after it was last
// written is dropped by every fork without a word. That is how
// advanced_abilities (20260817000000) and free_play_access (20260905000000)
// both came to be lost.
test('a forked class keeps its advanced abilities and free play access', async () => {
  const advanced = [{
    name: 'High Noon', description: 'Pitch a Fizzle.', paired_action: '',
    meters: [], notes: [], sample_perks: []
  }];

  const { data: base } = await supabase.from('classes')
    .insert({
      name: `Fork Source ${Date.now()}`, rules_edition: 'aspirant', rules_version: 'v1',
      status: 'alpha', is_public: false, is_player_created: true,
      stat_spread: {}, gear: [], abilities: [],
      advanced_abilities: advanced, free_play_access: true
    })
    .select('id').single();

  const newId = crypto.randomUUID();
  const { error } = await supabase.rpc('dup_class', {
    new_id: newId, base_id: base.id, new_version: 'v1', new_edition: null
  });
  expect(error).toBeNull();

  const { data: fork } = await supabase.from('classes')
    .select('advanced_abilities,free_play_access').eq('id', newId).single();

  expect(fork.advanced_abilities).toEqual(advanced);
  expect(fork.free_play_access).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:integration 2>&1 | grep -A10 "forked class"`
Expected: FAIL — `advanced_abilities` comes back `[]` and `free_play_access` comes back `false`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260912000001_dup_class_advanced_abilities.sql`. Copy the whole `CREATE OR REPLACE FUNCTION dup_class ...` body verbatim from `20260904000002_drop_class_description.sql:76-155`, then make exactly two edits: add `advanced_abilities,` and `free_play_access` after `prerelease_section` in the INSERT column list, and add the same two names in the same position in the SELECT list. Head the file with:

```sql
-- dup_class names its columns explicitly, so every column added after it was
-- last rewritten is dropped by the fork. advanced_abilities (20260817000000)
-- and free_play_access (20260905000000) were both lost this way. Adding
-- content to advanced_abilities is what makes the loss visible, so both are
-- repaired together.
--
-- free_play_access is copied rather than reset: it is a property of the class
-- the creator published, and 20260905000000 set it per-row precisely so that a
-- fork would not inherit it through its version family. A fork of a free class
-- is still that class's content.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && bun run test:integration 2>&1 | grep -A10 "forked class"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260912000001_dup_class_advanced_abilities.sql util/class-duplicate.integration.test.js scripts/run-tests.mjs
git commit -m "fix: stop dup_class dropping advanced_abilities and free_play_access"
```

---

### Task 11: Tighten the agent contract's item schemas

**Files:**
- Modify: `docs/custom-gpt-openapi.json:194-196`
- Test: `models/class-agent.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

`models/class-agent.test.js:148-166` compares **top-level property names only**, and `advanced_abilities` is already on both sides. Nothing here can break it — but `signature_gear`, `abilities` and `advanced_abilities` are all declared as bare `{"type": "object"}`, which tells the Custom GPT nothing about what it is receiving.

- [ ] **Step 1: Add the shared item schemas**

In `docs/custom-gpt-openapi.json`, under `components.schemas`, add these four alongside `ClassSummary` and `ClassDetail`:

```json
      "Meter": {
        "type": "object",
        "description": "A label/value pair printed beside an ability or item, e.g. Essence Cost / Mid.",
        "properties": {
          "label": { "type": "string" },
          "value": { "type": "string" }
        }
      },
      "Note": {
        "type": "object",
        "description": "A bulleted note. Nests exactly two levels: a note and its sub-bullets, no grandchildren.",
        "properties": {
          "text": { "type": "string" },
          "children": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "text": { "type": "string" },
                "children": { "type": "array", "items": {}, "description": "Always empty; the nesting stops here." }
              }
            }
          }
        }
      },
      "SignatureItem": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "description": { "type": "string" },
          "category": { "type": "string", "enum": ["default", "elective"], "description": "Base or Elective roster. Advent only; Aspirant abolished the split." },
          "meters": { "type": "array", "items": { "$ref": "#/components/schemas/Meter" } },
          "notes": { "type": "array", "items": { "$ref": "#/components/schemas/Note" } },
          "default_enchantment": {
            "type": ["object", "null"],
            "description": "The item's Default Enchantment, unlocked with Merx. Null on every Advent item; a Signature may hold only one.",
            "properties": {
              "name": { "type": "string" },
              "description": { "type": "string" },
              "dedication": { "type": ["string", "null"], "description": "An 'In Honor of ...' line printed under the name." }
            }
          }
        }
      },
      "Ability": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "description": { "type": "string" },
          "paired_action": { "type": "string" },
          "pronunciation": { "type": "string", "description": "Present only on the few abilities whose writeup gives one." },
          "meters": { "type": "array", "items": { "$ref": "#/components/schemas/Meter" } },
          "notes": { "type": "array", "items": { "$ref": "#/components/schemas/Note" } },
          "sample_perks": {
            "type": "array",
            "description": "The two Sample Perks printed under an Aspirant ability. Empty on every Advent ability.",
            "items": {
              "type": "object",
              "properties": {
                "name": { "type": "string" },
                "text": { "type": "string" },
                "dedication": { "type": ["string", "null"] },
                "compound_text": { "type": ["string", "null"], "description": "The Compounded variant, restated in full rather than as a delta. Null on the perk that has none." }
              }
            }
          }
        }
      },
```

- [ ] **Step 2: Point the three arrays at them**

Replace `:194-196` with `$ref`s:

```json
              "signature_gear": { "type": "array", "items": { "$ref": "#/components/schemas/SignatureItem" } },
              "abilities": { "type": "array", "items": { "$ref": "#/components/schemas/Ability" } },
              "advanced_abilities": { "type": "array", "items": { "$ref": "#/components/schemas/Ability" } }
```

- [ ] **Step 3: Run the contract test**

Run: `bun test models/class-agent.test.js`
Expected: PASS — the test reads `Object.keys(...properties)`, which is unchanged.

- [ ] **Step 4: Commit**

```bash
git add docs/custom-gpt-openapi.json
git commit -m "docs: describe class item shapes in the Custom GPT contract"
```

---

### Task 12: Delete the placeholder scripts

**Files:**
- Delete: `scripts/seed-test-advanced-abilities.js`, `scripts/backfill-class-advanced-abilities.js`
- Modify: `package.json` (remove `seed:test:advanced-abilities`), `util/enclave-consts.js:170-176`

**Interfaces:**
- Consumes: Tasks 5 and 7 — the authoring and import paths these scripts stood in for.
- Produces: nothing.

`scripts/seed-test-advanced-abilities.js` writes abilities literally named `"Test: <Verb> <Noun>"`. `scripts/backfill-class-advanced-abilities.js` reads `classAdvancedAbilityList`, which is `{}` — a guaranteed no-op, as its own comment admits. Both exist only because there was no authoring path. There is one now, so they go rather than remain a second, divergent way to populate the column.

- [ ] **Step 1: Confirm nothing else reads them**

```bash
grep -rn "classAdvancedAbilityList\|seed-test-advanced-abilities\|backfill-class-advanced-abilities" \
  --include='*.js' --include='*.mjs' --include='*.json' --include='*.handlebars' . \
  | grep -v node_modules
```

Expected: hits only in the three files being changed. If `public/js/character-wizard.js` or any view turns up, stop — that is a live consumer and this task needs rescoping.

- [ ] **Step 2: Delete**

```bash
git rm scripts/seed-test-advanced-abilities.js scripts/backfill-class-advanced-abilities.js
```

Remove the `"seed:test:advanced-abilities"` line from `package.json:22`, and delete the `classAdvancedAbilityList` declaration at `util/enclave-consts.js:170-176` together with its entry in that file's `module.exports`.

- [ ] **Step 3: Verify**

Run: `bun run check && bun run test && bun run test:http`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete the advanced-ability placeholder scripts"
```

---

### Task 13: Round-trip integration test

**Files:**
- Modify: `util/class-form-round-trip.integration.test.js:113-157` (the two column lists), `:216-223` and `:300-331` (counters), `:255-298` (expected-shape builders), `:443-449` (guards)
- Test: itself

**Interfaces:**
- Consumes: every preceding task.
- Produces: the proof of the spec's success criteria.

This test is the widest blast radius in the slice, and it is last because it can only be made honest once every write path is widened.

- [ ] **Step 1: Account for both unlisted columns**

`:399-407` asserts every `classes` column is in `COMPARED` or `NOT_ROUND_TRIPPED`. Add `'advanced_abilities'` to `STRUCTURED_FIELDS` at `:149` — the admin form now round-trips it, as of Task 5. Add `free_play_access` to `NOT_ROUND_TRIPPED` at `:116-126` with the reason: it is set by the prerelease loader and by migration `20260905000000`, never by the form, so a form save neither reads nor writes it.

- [ ] **Step 2: Restate the new defaulting rules by hand**

Extend `expectedAbilities` (`:255-273`) with a `sample_perks` key and `expectedGear` (`:286-298`) with a `default_enchantment` key. **Write the defaulting rules out literally** — do not import `normalizePerk` or `normalizeEnchantment`. The comment at `:164-171` records why (R84): building the expected value by calling the function under test lets a change to that function cancel itself out. `expectedCategory` at `:279-284` is the pattern to copy.

Add a third builder, `expectedAdvancedAbilities`, that is `expectedAbilities` over `row.advanced_abilities` with `column: 'advanced_abilities'` in its context, and compare it in the same loop at `:423-427`.

Amend the prose statement of allowlist rules A and B in the header at `:36-40` to name the new keys.

- [ ] **Step 3: Add the coverage guards**

Add `sample_perks`, `default_enchantment` and `advanced_abilities` counters to the `counts` object at `:216-223` and to `tally()` at `:300-331`, and add each to the `toBeGreaterThan(0)` guards at `:443-449`. Without these the new keys are compared as empty on every row and the guard proves nothing — which is exactly what the existing guards exist to prevent.

Note this means the local database must hold at least one class with an enchantment, a sample perk and an advanced ability. The seed does not produce one (Task 9). Insert one in the test's setup, or seed it through the admin form during Step 5.

- [ ] **Step 4: Run the test**

Run: `supabase db reset && bun run test:integration`
Expected: PASS, and `/tmp/baseline-integration.txt` from Task 1 Step 1 shows no test that was green then is red now.

- [ ] **Step 5: Prove the success criteria end to end**

Author a class through the running admin form with twelve enchanted signatures, three core and three advanced abilities, two sample perks each. Export it to JSON, re-import it, fork it with the Duplicate modal, and diff:

```bash
bun run dev   # author at /classes/new, then:
# export via the class page's Export JSON control to /tmp/authored.json
# re-import via /classes/import, export the result to /tmp/reimported.json
diff /tmp/authored.json /tmp/reimported.json
```

Expected: empty diff, and the fork's `advanced_abilities` matches the source's.

- [ ] **Step 6: Commit**

```bash
git add util/class-form-round-trip.integration.test.js
git commit -m "test: round-trip enchantments, sample perks and advanced abilities"
```

---

## Final verification

```bash
bun run check
bun run test
bun run test:http
supabase db reset && bun run test:integration
```

All four green, and every claim in the spec's "Success criteria" section demonstrated by Task 13 Step 5.
