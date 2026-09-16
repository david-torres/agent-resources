# Aspiring Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the aspiring wizard's pseudo-class and core/advanced ability tag somewhere to live, and unblock the aspiring submit, which cannot currently produce a row at all.

**Architecture:** The pseudo-class lives on the character, not in the `classes` catalog: `characters.class` carries its name (already `NOT NULL`, already the denormalized display name every render path reads) and two new nullable columns carry tagline and description. `class_abilities` gains a `type` column so the core/advanced distinction survives the write, backfilled correctively so existing aspirant characters are not mislabeled. The economy is derived from the persisted picks rather than stored.

**Tech Stack:** Bun, Express 4, express-handlebars, Alpine.js (CDN), Bulma, Supabase/Postgres, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-09-13-aspiring-persistence-design.md`

## Global Constraints

- **Branch:** `aspirant-v1-classes-and-characters`. Do not rebase onto `main`.
- **Contracts, exactly as the spec declares them:**
  ```
  characters.class                    := the pseudo-class name
  characters.pseudo_class_tagline     := text | null
  characters.pseudo_class_description := text | null
  characters.class_id                 := null (aspiring)
  class_abilities.type                := 'core' | 'advanced'
  ```
- **`type` is an attribute, never part of a row's identity.** The diff key stays `(class_id, name, occ)` in the RPC and `` `${row.class_id}:${row.name}` `` in `diffChildRows`. Do not add `type` to any `keyOf` or any `PARTITION BY`.
- **No column stores the Merx or Perk spend.** If a task seems to need one, stop — the spend is derived from the picks by design.
- Put schema changes in a **new** timestamped `supabase/migrations/` file. Never edit an applied migration. Latest applied is `20260912000001`; this plan's migrations are `20260913000000`, `20260913000001`, `20260913000002`.
- **Migrations and any integration run target LOCAL Supabase only.** Read the `SUPABASE_URL` line in `.env` before running anything that writes — it is hand-switched between the local stack and the live project. `bun run test:unit` scrubs it.
- **Apply migrations with `supabase migration up`. NEVER run `supabase db reset`.** The local database holds a restored production copy (hundreds of characters and auth users), not seed data; a reset destroys it and the restore needs a dump plus a privileged `auth.users` step. `migration up` applies pending migrations in place.
- Tests use `bun:test` (`const { test, expect } = require('bun:test');`). No `describe()` blocks — flat `test('lowercase sentence describing the rule', ...)`. Every non-obvious test carries a block comment above it saying **why the rule exists**, citing a file:line or migration where one applies. This is the strongest convention in the repo.
- A new test file lands in the unit bucket by default. If it boots Express add it to `httpFiles` in `scripts/run-tests.mjs`; if it needs Supabase add it to `integrationFiles` and start the file with `require('./require-local-supabase');`.
- Run `bun run check` and `bun run test` before every commit.
- Follow the repo's comment discipline: explain non-obvious *why*, never restate *what*, never narrate history. When you replace something, delete what it replaced.

## Known-red before you start

Task 1 Step 1 establishes the baseline. The `characters` column set and the `class_abilities` contract both widen in this plan, and both are asserted by exact key set in places. Record what is already failing before changing anything so a pre-existing red is never mistaken for one this work caused.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `supabase/migrations/20260913000000_class_abilities_type.sql` | `type` column, CHECK, corrective backfill | 1 |
| `services/character/service.js` | carry `type` through both write paths | 2 |
| `supabase/migrations/20260913000001_save_character_atomic_ability_type.sql` | RPC revision carrying `type` | 3 |
| `supabase/migrations/20260913000002_character_pseudo_class.sql` | the two pseudo-class columns | 4 |
| `services/character/input.js` | map `pseudo_class`; structural validation | 5, 6 |
| `routes/character-wizard-aspiring.test.js` | the aspiring submit end to end | 7 |
| `public/js/character-wizard.js` | trait selects, summary, dead code | 8, 9 |
| `views/character-new-selector.handlebars`, `views/character-wizard.handlebars` | draft label, copy fix | 9 |
| `e2e/specs/26-aspiring-wizard.spec.js` | e2e coverage | 10 |

---

### Task 1: `class_abilities.type` with a corrective backfill

**Files:**
- Create: `supabase/migrations/20260913000000_class_abilities_type.sql`
- Create: `util/class-ability-type.integration.test.js`
- Modify: `scripts/run-tests.mjs:7-21` (add to `integrationFiles`)

**Interfaces:**
- Produces: `class_abilities.type` — `text NOT NULL DEFAULT 'core' CHECK (type IN ('core','advanced'))`. Tasks 2 and 3 write it; Task 7 asserts it.

- [x] **Step 1: Record the pre-existing baseline**

Before touching anything, capture what is already red so later failures are attributable.

```bash
bun run test 2>&1 | tail -40
```

Write the failing test names (if any) into the commit message of Step 6. If everything passes, say so there instead.

- [x] **Step 2: Write the failing test**

Create `util/class-ability-type.integration.test.js`:

```js
// util/class-ability-type.integration.test.js
//
// Requires the local Supabase stack: SUPABASE_URL=http://127.0.0.1:54321

require('./require-local-supabase');

const { test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// The backfill must not be a blanket DEFAULT 'core'. Aspirant-mode characters
// draw their abilities from the class's advanced_abilities jsonb, so a blanket
// default would silently mislabel every one of them. See
// docs/superpowers/specs/2026-09-13-aspiring-persistence-design.md.
test('an ability named in its class advanced_abilities is tagged advanced', async () => {
  const { data, error } = await sb.from('class_abilities')
    .select('name, type, classes(advanced_abilities)');
  expect(error).toBeNull();

  const mislabeled = (data ?? []).filter((row) => {
    const advanced = Array.isArray(row.classes?.advanced_abilities)
      ? row.classes.advanced_abilities
      : [];
    return advanced.some((a) => a && a.name === row.name) && row.type !== 'advanced';
  });
  expect(mislabeled).toEqual([]);
});

// A CHECK constraint is the backstop for the structural validation in
// services/character/input.js -- the DB must refuse a bad tag even if a
// caller bypasses the service layer.
test('class_abilities rejects a type outside core and advanced', async () => {
  const { data: character } = await sb.from('characters').select('id').limit(1).single();
  // class_abilities.class_id is NOT NULL (baseline_schema.sql:174-186), so the
  // row needs a real class or the insert fails for the wrong reason.
  const { data: cls } = await sb.from('classes').select('id').limit(1).single();

  const { error } = await sb.from('class_abilities').insert({
    character_id: character.id, name: 'Bogus', class_id: cls.id, type: 'legendary'
  });
  expect(error).not.toBeNull();
});
```

- [x] **Step 3: Run the test to verify it fails**

Add `'util/class-ability-type.integration.test.js'` to the `integrationFiles` set in `scripts/run-tests.mjs:7-21`, then:

```bash
bun run test:integration
```

Expected: FAIL — `column "type" does not exist`.

- [x] **Step 4: Write the migration**

Create `supabase/migrations/20260913000000_class_abilities_type.sql`:

```sql
-- The wizard has always sent a core/advanced tag on every aspiring ability
-- (public/js/character-wizard.js:3225,3228) but all three write paths projected
-- it away, so the distinction -- and with it the 4-Perk economy -- was
-- unrecoverable from the database.
--
-- The backfill is corrective rather than a blanket default: aspirant-mode
-- characters draw their abilities from the class's advanced_abilities, so
-- DEFAULT 'core' alone would leave every one of them mislabeled.
ALTER TABLE public.class_abilities
    ADD COLUMN type text NOT NULL DEFAULT 'core'
    CHECK (type IN ('core', 'advanced'));

UPDATE public.class_abilities a
SET type = 'advanced'
FROM public.classes c
WHERE a.class_id = c.id
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(c.advanced_abilities) AS adv
    WHERE adv->>'name' = a.name
  );
```

- [x] **Step 5: Apply and re-run**

```bash
supabase migration up
bun run test:integration
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add supabase/migrations/20260913000000_class_abilities_type.sql util/class-ability-type.integration.test.js scripts/run-tests.mjs
git commit -m "feat: tag class abilities core or advanced"
```

---

### Task 2: Carry `type` through both JS write paths

**Files:**
- Modify: `services/character/service.js:328-331` (atomic), `services/character/service.js:411-425` (reconcile)
- Modify: `services/character/service.test.js`, `services/character/input.test.js`

**Interfaces:**
- Consumes: `class_abilities.type` from Task 1.
- Produces: ability row objects shaped `{ name, class_id, description, type }` on both paths. Task 3's RPC reads `type` off the same objects.

- [x] **Step 1: Write the failing tests**

Append to `services/character/service.test.js`:

```js
// The wizard sends type on every aspiring ability
// (public/js/character-wizard.js:3225,3228), but both write paths projected
// abilities down to {name, class_id, description}. A dropped tag makes an
// aspiring character's abilities indistinguishable from any other's.
test('reconcileAbilities persists the core/advanced tag', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls));
  await service.reconcileAbilities('character-1', [
    { name: 'Dodge', class_id: 'class-a', type: 'core' },
    { name: 'Overdrive', class_id: 'class-b', type: 'advanced' }
  ]);
  const inserted = calls.find(c => c[0] === 'insertChildRows' && c[1] === 'class_abilities');
  expect(inserted[3]).toEqual([
    { name: 'Dodge', class_id: 'class-a', description: null, type: 'core' },
    { name: 'Overdrive', class_id: 'class-b', description: null, type: 'advanced' }
  ]);
});

// An untagged ability is core. Advent characters submit no type at all, and a
// null would violate the NOT NULL added by 20260913000000.
test('an ability submitted without a type defaults to core', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls));
  await service.reconcileAbilities('character-1', [{ name: 'Dodge', class_id: 'class-a' }]);
  const inserted = calls.find(c => c[0] === 'insertChildRows' && c[1] === 'class_abilities');
  expect(inserted[3][0].type).toBe('core');
});

// type is an attribute, not identity: retagging an existing ability must update
// the row in place rather than delete and reinsert it, or character_perks
// (class_ability_id ON DELETE CASCADE) is destroyed.
test('retagging an ability updates the row instead of replacing it', async () => {
  const calls = [];
  const service = new CharacterService(makeAdapter(calls, {
    getChildRows: async (table, id) => {
      calls.push(['getChildRows', table, id]);
      return ok([{ id: 'row-1', name: 'Dodge', class_id: 'class-a', description: null, type: 'core' }]);
    }
  }));
  await service.reconcileAbilities('character-1', [{ name: 'Dodge', class_id: 'class-a', type: 'advanced' }]);
  expect(calls.some(c => c[0] === 'deleteChildRows' && c[3].length)).toBe(false);
  const updated = calls.find(c => c[0] === 'updateChildRow');
  expect(updated[3]).toEqual({ type: 'advanced' });
});
```

`makeAdapter(calls, overrides)` and the `ok()` helper are already defined at the
top of that file (`services/character/service.test.js:20-102`); the default
`getChildRows` returns an empty list, which is why only the third test overrides it.

Add this one to `services/character/input.test.js` instead — it guards the
normalizer the other two depend on:

```js
// normalizeAbilityItems is normalizeClassItems, which spreads the submitted
// object ({...item, name} at services/character/input.js:56). The tag survived
// this far all along and was lost further downstream, so this is the boundary
// worth pinning.
test('normalizeAbilityItems keeps the submitted type', () => {
  expect(normalizeAbilityItems([{ name: ' Overdrive ', type: 'advanced' }])).toEqual([
    { name: 'Overdrive', type: 'advanced' }
  ]);
});
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
bun test services/character/service.test.js
```

Expected: FAIL — inserted rows lack `type`.

- [x] **Step 3: Write the implementation**

Add near the other normalizers at the top of `services/character/service.js`:

```js
// An ability with no submitted tag is core: advent characters send no type at
// all, and class_abilities.type is NOT NULL (20260913000000).
const abilityType = (value) => (value === 'advanced' ? 'advanced' : 'core');
```

In the atomic path, replace `services/character/service.js:328-331`:

```js
    const abilities = childData.classAbilities == null ? null : normalizeAbilityItems(childData.classAbilities).map(item => ({
      name: item.name,
      type: abilityType(item.type),
      ...resolveClassItem('abilities', item, maps.abilityNameToClassId, maps.abilityNameToDescription)
    }));
```

In `reconcileAbilities`, replace the `desired.push` at `services/character/service.js:419` and the `rowFields` at `:423`:

```js
      desired.push({
        name: item.name,
        class_id: classId,
        description: item.description ?? abilityNameToDescription.get(item.name) ?? null,
        type: abilityType(item.type)
      });
    }
    const applied = await this.applyChildDiff('class_abilities', characterId, diffChildRows(existing.data, desired, {
      keyOf: row => `${row.class_id}:${row.name}`,
      rowFields: item => ({ name: item.name, class_id: item.class_id, description: item.description, type: item.type })
    }));
```

`keyOf` is unchanged on purpose — see Global Constraints. `diffChildRows` compares every key of `rowFields` against the matched row (`util/reconcile.js:48-53`), so adding `type` there is what makes retagging an update rather than a delete-plus-insert.

- [x] **Step 4: Run the tests to verify they pass**

```bash
bun test services/character/service.test.js && bun run test:unit
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add services/character/service.js services/character/service.test.js
git commit -m "feat: carry the ability type through both write paths"
```

---

### Task 3: `save_character_atomic` revision carrying `type`

**Files:**
- Create: `supabase/migrations/20260913000001_save_character_atomic_ability_type.sql`
- Modify: `models/character-atomic.integration.test.js`

**Interfaces:**
- Consumes: the `{ name, class_id, description, type }` ability objects from Task 2.

- [x] **Step 1: Write the failing test**

Append to `models/character-atomic.integration.test.js`, using the helpers already
defined there — `input()` (`:60`), `childRows()` (`:84`), `characterClass`, and
`createCharacter` / `updateCharacter` from `./character`:

```js
// The atomic path is the one the wizard uses on create. If the RPC drops type,
// every aspiring character is born untagged no matter what the service layer
// sends (services/character/service.js:328-331).
test('save_character_atomic persists and updates the ability type', async () => {
  const { data: created } = await createCharacter({
    ...input('Atomic Typed'),
    abilities: [{ name: 'Atomic Ability', class_id: characterClass.id, type: 'advanced' }]
  }, profile);
  const first = await childRows('class_abilities', created.id);
  expect(first[0].type).toBe('advanced');

  await updateCharacter(created.id, {
    ...input('Atomic Typed'),
    abilities: [{ name: 'Atomic Ability', class_id: characterClass.id, type: 'core' }]
  }, profile);
  const second = await childRows('class_abilities', created.id);

  // The id must survive the retag: character_perks.class_ability_id is
  // ON DELETE CASCADE, so a delete-and-reinsert would destroy the perks.
  expect(second[0].id).toBe(first[0].id);
  expect(second[0].type).toBe('core');
});
```

Match the `profile` argument and the create/update call signatures to the tests
already in that file (`models/character-atomic.integration.test.js:96-160`) —
`setup()` builds the fixtures those rely on.

- [x] **Step 2: Run the test to verify it fails**

```bash
bun run test:integration
```

Expected: FAIL — `type` is `'core'` on the first read.

- [x] **Step 3: Write the migration**

Create `supabase/migrations/20260913000001_save_character_atomic_ability_type.sql`. Copy the **entire** function body from `20260905000001_reconcile_character_child_rows.sql` — Postgres `CREATE OR REPLACE FUNCTION` has no partial form — and change only the `p_abilities` block. Head the file with:

```sql
-- Restates the whole function to carry class_abilities.type (20260913000000)
-- through the atomic path. Every block except the p_abilities one is
-- byte-identical to 20260905000001_reconcile_character_child_rows.sql.
--
-- type is an attribute, not identity: it stays out of the PARTITION BY so that
-- retagging an ability updates the row and character_perks (class_ability_id
-- ON DELETE CASCADE) survives.
```

The changed block:

```sql
  IF p_abilities IS NOT NULL THEN
    WITH desired AS (
      SELECT
        ability_item->>'name' AS name,
        (ability_item->>'class_id')::uuid AS class_id,
        ability_item->>'description' AS description,
        COALESCE(ability_item->>'type', 'core') AS type,
        row_number() OVER (PARTITION BY (ability_item->>'class_id')::uuid, ability_item->>'name' ORDER BY ord) AS occ
      FROM jsonb_array_elements(p_abilities) WITH ORDINALITY AS t(ability_item, ord)
    ),
    existing AS (
      SELECT id, name, class_id, row_number() OVER (PARTITION BY class_id, name ORDER BY id) AS occ
      FROM public.class_abilities WHERE character_id = saved.id
    ),
    matched AS (
      SELECT e.id, d.description, d.type FROM existing e JOIN desired d USING (class_id, name, occ)
    ),
    deleted AS (
      DELETE FROM public.class_abilities a
      WHERE a.character_id = saved.id
        AND NOT EXISTS (SELECT 1 FROM matched m WHERE m.id = a.id)
    ),
    updated AS (
      UPDATE public.class_abilities a SET description = m.description, type = m.type
      FROM matched m
      WHERE a.id = m.id
        AND (a.description IS DISTINCT FROM m.description OR a.type IS DISTINCT FROM m.type)
    )
    INSERT INTO public.class_abilities (character_id, name, class_id, description, type)
    SELECT saved.id, d.name, d.class_id, d.description, d.type FROM desired d
    WHERE NOT EXISTS (
      SELECT 1 FROM existing e WHERE e.class_id = d.class_id AND e.name = d.name AND e.occ = d.occ
    );
  END IF;
```

- [x] **Step 4: Apply and re-run**

```bash
supabase migration up
bun run test:integration
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add supabase/migrations/20260913000001_save_character_atomic_ability_type.sql models/character-atomic.integration.test.js
git commit -m "feat: carry the ability type through save_character_atomic"
```

---

### Task 4: The pseudo-class columns

**Files:**
- Create: `supabase/migrations/20260913000002_character_pseudo_class.sql`

**Interfaces:**
- Produces: `characters.pseudo_class_tagline`, `characters.pseudo_class_description` — both `text`, both nullable. Task 5 writes them.

- [x] **Step 1: Write the migration**

There is no test step here: the columns carry no behavior of their own, and Task 5's tests fail without them. Create `supabase/migrations/20260913000002_character_pseudo_class.sql`:

```sql
-- Aspiring is the class-less creator mode: the player invents a one-off
-- pseudo-class rather than picking from the catalog. Its name goes in
-- characters.class -- already NOT NULL, and already the denormalized display
-- name every render path reads -- so only the other two fields need columns.
--
-- Both are null for every advent and aspirant character; that nullability is
-- the signal, and creator_mode already records the mode.
ALTER TABLE public.characters
    ADD COLUMN pseudo_class_tagline text,
    ADD COLUMN pseudo_class_description text;
```

- [x] **Step 2: Apply and confirm nothing broke**

```bash
supabase migration up
bun run test
```

Expected: the same result as the Task 1 Step 1 baseline. If a column-census test now fails because the `characters` key set widened, fix that census here.

- [x] **Step 3: Commit**

```bash
git add supabase/migrations/20260913000002_character_pseudo_class.sql
git commit -m "feat: add the pseudo-class columns to characters"
```

---

### Task 5: Map `pseudo_class` onto the character

**Files:**
- Modify: `services/character/input.js:83-144`
- Modify: `services/character/input.test.js`

**Interfaces:**
- Consumes: the columns from Task 4.
- Produces: `normalizeCharacterInput` maps `pseudo_class` to `class` + `pseudo_class_tagline` + `pseudo_class_description` and deletes the nested key. Task 6 validates the same payload; Task 7 exercises it over HTTP.

- [x] **Step 1: Write the failing tests**

Append to `services/character/input.test.js`:

```js
// pseudo_class used to ride through normalizeWizardPayload (no allowlist) into
// jsonb_populate_record, which silently ignores keys that are not columns
// (20260905000001:33-49). No error, no data -- the wizard comment at
// public/js/character-wizard.js:3148-3156 described a server that never existed.
test('maps an aspiring pseudo_class onto class and the pseudo-class columns', () => {
  const result = normalizeCharacterInput({
    name: 'Vesper',
    creator_mode: 'aspiring',
    pseudo_class: { name: '  Ashwalker  ', tagline: ' Walks the ash ', description: ' A long tale. ' }
  }, { rulesVersion: 'v1' });

  expect(result.error).toBeNull();
  expect(result.data.class).toBe('Ashwalker');
  expect(result.data.pseudo_class_tagline).toBe('Walks the ash');
  expect(result.data.pseudo_class_description).toBe('A long tale.');
  expect(result.data).not.toHaveProperty('pseudo_class');
});

// characters.class is TEXT NOT NULL with no default
// (20240101000000_baseline_schema.sql:46) and resolveCharacterClassReference
// (models/character.js:24-45) only fills class FROM a class_id. Aspiring has no
// class_id, so without this mapping the insert fails outright.
test('an aspiring character keeps a null class_id', () => {
  const result = normalizeCharacterInput({
    name: 'Vesper', creator_mode: 'aspiring', class_id: null,
    pseudo_class: { name: 'Ashwalker', tagline: '', description: '' }
  }, { rulesVersion: 'v1' });

  expect(result.data.class_id).toBeNull();
  expect(result.data.class).toBe('Ashwalker');
});

// Blank tagline and description are stored as null, not empty string, so the
// column's nullability keeps meaning "this character has none".
test('blank pseudo-class prose becomes null', () => {
  const result = normalizeCharacterInput({
    name: 'Vesper', creator_mode: 'aspiring',
    pseudo_class: { name: 'Ashwalker', tagline: '   ', description: '' }
  }, { rulesVersion: 'v1' });

  expect(result.data.pseudo_class_tagline).toBeNull();
  expect(result.data.pseudo_class_description).toBeNull();
});

// Non-aspiring payloads must not grow the columns, or an advent character
// round-trips with keys it never had.
test('a non-aspiring payload is untouched by the pseudo-class mapping', () => {
  const result = normalizeCharacterInput({
    name: 'Kell', creator_mode: 'advent', class: 'Gunslinger'
  }, { rulesVersion: 'v1' });

  expect(result.data.class).toBe('Gunslinger');
  expect(result.data).not.toHaveProperty('pseudo_class_tagline');
  expect(result.data).not.toHaveProperty('pseudo_class_description');
});
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
bun test services/character/input.test.js
```

Expected: FAIL — `data.class` is undefined and `pseudo_class` is still present.

- [x] **Step 3: Write the implementation**

In `services/character/input.js`, add above `normalizeCharacterInput`:

```js
const blankToNull = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
};
```

Then inside `normalizeCharacterInput`, immediately after the `delete data.abilities;` line at `services/character/input.js:101`:

```js
  // Aspiring is class-less. The invented class name goes in `class` -- already
  // NOT NULL and already the display name every render path reads -- rather
  // than a pseudo_class_name column that would be a second copy of it.
  // Without this the nested object reaches jsonb_populate_record and vanishes.
  if (data.pseudo_class && typeof data.pseudo_class === 'object') {
    const pseudo = data.pseudo_class;
    const name = blankToNull(pseudo.name);
    if (name) data.class = name;
    data.pseudo_class_tagline = blankToNull(pseudo.tagline);
    data.pseudo_class_description = blankToNull(pseudo.description);
  }
  delete data.pseudo_class;
```

`trimStrings` at `:84` has already trimmed the nested strings; `blankToNull` exists to collapse the empties to null.

- [x] **Step 4: Run the tests to verify they pass**

```bash
bun test services/character/input.test.js && bun run test:unit
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add services/character/input.js services/character/input.test.js
git commit -m "feat: persist the aspiring pseudo-class"
```

---

### Task 6: Structural validation of an aspiring submit

**Files:**
- Modify: `services/character/input.js:162-188` (`normalizeWizardPayload`)
- Modify: `services/character/input.test.js`

**Interfaces:**
- Consumes: the mapping from Task 5.
- Produces: `normalizeWizardPayload` returns `{ data: null, error: <message> }` for a malformed aspiring submit.

Structural invariants only, per the spec. Budget arithmetic stays in the wizard — do not port the Merx or Perk maths here.

- [x] **Step 1: Write the failing tests**

Append to `services/character/input.test.js`:

```js
const aspiringBody = (overrides = {}) => ({
  name: 'Vesper',
  creator_mode: 'aspiring',
  pseudo_class: { name: 'Ashwalker', tagline: '', description: '' },
  gear: [
    { name: 'Knife', class_id: 'class-a' },
    { name: 'Rope', class_id: 'class-b' },
    { name: 'Lamp', class_id: 'class-c' }
  ],
  abilities: [
    { name: 'Dodge', class_id: 'class-a', type: 'core' },
    { name: 'Parry', class_id: 'class-b', type: 'core' },
    { name: 'Overdrive', class_id: 'class-c', type: 'advanced' }
  ],
  ...overrides
});

// The builder fills exactly six slots (public/js/character-wizard.js:1489-1510).
// POST /characters/wizard is otherwise mode-agnostic, so this is the only place
// a malformed aspiring build is stopped before the insert.
test('accepts a well-formed aspiring submit', () => {
  const result = normalizeWizardPayload(aspiringBody());
  expect(result.error).toBeNull();
});

test('rejects an aspiring submit without three gear picks', () => {
  const result = normalizeWizardPayload(aspiringBody({
    gear: [{ name: 'Knife', class_id: 'class-a' }]
  }));
  expect(result.data).toBeNull();
  expect(result.error).toMatch(/three gear/i);
});

test('rejects an aspiring submit without two core and one advanced ability', () => {
  const result = normalizeWizardPayload(aspiringBody({
    abilities: [
      { name: 'Dodge', class_id: 'class-a', type: 'core' },
      { name: 'Parry', class_id: 'class-b', type: 'core' },
      { name: 'Guard', class_id: 'class-c', type: 'core' }
    ]
  }));
  expect(result.data).toBeNull();
  expect(result.error).toMatch(/two core/i);
});

// Without a name there is nothing to put in characters.class, which is NOT NULL.
test('rejects an aspiring submit with a blank pseudo-class name', () => {
  const result = normalizeWizardPayload(aspiringBody({
    pseudo_class: { name: '   ', tagline: '', description: '' }
  }));
  expect(result.data).toBeNull();
  expect(result.error).toMatch(/class name/i);
});

// Advent and aspirant submits must not be held to the aspiring build rules.
test('leaves a non-aspiring submit unvalidated by the aspiring rules', () => {
  const result = normalizeWizardPayload({
    name: 'Kell', creator_mode: 'advent', class_id: 'class-a'
  });
  expect(result.error).toBeNull();
});
```

Import `normalizeWizardPayload` at the top of the file alongside the existing imports.

- [x] **Step 2: Run the tests to verify they fail**

```bash
bun test services/character/input.test.js
```

Expected: FAIL — every rejection case returns `error: null`.

- [x] **Step 3: Write the implementation**

Add above `normalizeWizardPayload` in `services/character/input.js`:

```js
// Structural invariants only. The 10-Merx and 4-Perk budgets stay client-side
// (public/js/character-wizard.js:1504-1510) -- mirroring the rules engine here
// would give the economy two sources of truth that can drift.
const validateAspiringBuild = (body) => {
  const name = typeof body.pseudo_class?.name === 'string' ? body.pseudo_class.name.trim() : '';
  if (!name) return 'An Aspiring character needs a class name.';

  const gear = Array.isArray(body.gear) ? body.gear : [];
  if (gear.length !== 3) return 'An Aspiring character needs exactly three gear picks.';

  const abilities = Array.isArray(body.abilities) ? body.abilities : [];
  const core = abilities.filter(a => a && a.type === 'core').length;
  const advanced = abilities.filter(a => a && a.type === 'advanced').length;
  if (abilities.length !== 3 || core !== 2 || advanced !== 1) {
    return 'An Aspiring character needs two core abilities and one advanced ability.';
  }
  return null;
};
```

Then inside `normalizeWizardPayload`, after the `creator_mode` check at `services/character/input.js:171-173`:

```js
  if (body.creator_mode === 'aspiring') {
    const invalid = validateAspiringBuild(body);
    if (invalid) return { data: null, error: invalid };
  }
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
bun test services/character/input.test.js && bun run test:unit
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add services/character/input.js services/character/input.test.js
git commit -m "feat: validate the structure of an aspiring submit"
```

---

### Task 7: The aspiring submit end to end

**Files:**
- Create: `routes/character-wizard-aspiring.test.js`
- Modify: `scripts/run-tests.mjs:22+` (add to `httpFiles`)

**Interfaces:**
- Consumes: Tasks 1–6.

**Scope warning — read before writing.** This harness mocks `models/character`,
so `createCharacter` never runs the service. The pseudo-class *mapping* therefore
cannot be asserted here; it lives inside `normalizeCharacterInput` and is covered
by Task 5. What this task proves is route-level: that a well-formed aspiring
submit reaches `createCharacter` with `pseudo_class` and the tags intact, and
that a malformed one is refused before any write. The full chain is proved by
Task 10's e2e.

Note the submit contract: the wizard POSTs a form-encoded `payload` field holding
a JSON string, and the handler replies with an `HX-Location` header and an
**empty body** — not a 302 (`routes/character-wizard.test.js:1-12,118`).

- [x] **Step 1: Write the failing test**

Create `routes/character-wizard-aspiring.test.js`. Copy the module-mock block,
`beforeAll`/`afterAll` and `startHttpServer` setup verbatim from
`routes/character-wizard.test.js:13-116`, with one change — the
`models/character` mock captures its payload:

```js
let captured = null;
mock.module('../models/character', () => ({
  createCharacter: async (payload) => {
    captured = payload;
    return { data: { id: CHAR_ID, name: payload.name }, error: null };
  },
}));
```

Then the helpers and tests:

```js
const CLASS_A = '22222222-2222-4222-8222-222222222222';
const CLASS_B = '33333333-3333-4333-8333-333333333333';
const CLASS_C = '44444444-4444-4444-8444-444444444444';

const aspiringPayload = (overrides = {}) => ({
  name: 'Vesper',
  creator_mode: 'aspiring',
  class_id: null,
  pseudo_class: { name: 'Ashwalker', tagline: 'Walks the ash', description: 'A long tale.' },
  gear: [
    { name: 'Knife', class_id: CLASS_A },
    { name: 'Rope', class_id: CLASS_B },
    { name: 'Lamp', class_id: CLASS_C }
  ],
  abilities: [
    { name: 'Dodge', class_id: CLASS_A, type: 'core' },
    { name: 'Parry', class_id: CLASS_B, type: 'core' },
    { name: 'Overdrive', class_id: CLASS_C, type: 'advanced' }
  ],
  trait0: null, trait1: null, trait2: null,
  ...overrides
});

const postWizard = (payload) => fetch(`${baseUrl}/characters/wizard`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer valid-jwt',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json'
  },
  body: new URLSearchParams({ payload: JSON.stringify(payload) })
});

// characters.class is TEXT NOT NULL (20240101000000_baseline_schema.sql:46) and
// aspiring sends class_id: null, so before this slice the submit could not
// produce a row at all. Nothing covered the path, which is why it went unnoticed.
test('an aspiring submit reaches createCharacter with its pseudo-class intact', async () => {
  captured = null;
  const res = await postWizard(aspiringPayload());

  expect(res.headers.get('HX-Location')).toBeTruthy();
  expect(await res.text()).toBe('');
  expect(captured.pseudo_class).toEqual({
    name: 'Ashwalker', tagline: 'Walks the ash', description: 'A long tale.'
  });
  expect(captured.class_id).toBeNull();
  expect(captured.creator_mode).toBe('aspiring');
});

// The Perk spend (core 1, advanced 2) is derived from the persisted picks
// rather than stored, so the tags have to survive the route.
test('an aspiring submit carries the core and advanced tags', async () => {
  captured = null;
  await postWizard(aspiringPayload());
  expect(captured.abilities.map(a => a.type).sort()).toEqual(['advanced', 'core', 'core']);
});

// normalizeWizardPayload is the only place a malformed aspiring build is
// stopped -- POST /characters/wizard is otherwise mode-agnostic
// (routes/characters.js:291-326).
test('a malformed aspiring submit is rejected before createCharacter runs', async () => {
  captured = null;
  const res = await postWizard(aspiringPayload({ abilities: [] }));

  expect(res.status).toBe(400);
  expect(captured).toBeNull();
});
```

- [x] **Step 2: Run the test**

Add `'routes/character-wizard-aspiring.test.js'` to `httpFiles` in `scripts/run-tests.mjs:22`, then:

```bash
bun run test:http
```

Expected: PASS. This task is coverage over behavior Tasks 5 and 6 already built,
not a red-green cycle of its own — so a failure here means a defect in those
tasks, and it gets fixed there rather than patched into this file. If you want to
see it go red first, stash Task 6's `validateAspiringBuild` call and re-run.

- [x] **Step 3: Commit**

```bash
git add routes/character-wizard-aspiring.test.js scripts/run-tests.mjs
git commit -m "test: cover the aspiring submit end to end"
```

---

### Task 8: Wake up the aspiring trait selects

**Files:**
- Modify: `public/js/character-wizard.js:845-862` (`statOptionsFor`)

**Interfaces:**
- Consumes: `state.classBuild` (`public/js/character-wizard.js:85-98`), `classesById` (`:229`).

`statOptionsFor` feeds trait slots 0 and 1 from `getClassSpreadStats()`, which returns `[]` with no selected class (`:708-712`); `fillStatSelect` then disables an empty select (`:892`). Aspiring players cannot set two of their three traits.

- [x] **Step 1: Add the union helper**

Insert directly above `statOptionsFor` in `public/js/character-wizard.js`:

```js
  // Aspiring is class-less, so trait slots 1 and 2 draw on the union of the
  // stat spreads of the classes the builder borrowed from. Without this they
  // get no options and fillStatSelect disables them outright (see :892).
  const getAspiringSpreadStats = () => {
    const build = state.classBuild || {};
    const slots = []
      .concat(build.classGear || [])
      .concat(build.coreAbilities || [])
      .concat(build.advancedAbility ? [build.advancedAbility] : []);
    const stats = [];
    slots.forEach((slot) => {
      const cls = slot && slot.classId ? classesById[slot.classId] : null;
      if (!cls || !cls.stat_spread) return;
      Object.keys(cls.stat_spread).forEach((stat) => {
        if (stats.indexOf(stat) === -1) stats.push(stat);
      });
    });
    return stats;
  };
```

- [x] **Step 2: Use it from `statOptionsFor`**

Replace the `const spreadStats = getClassSpreadStats();` line inside `statOptionsFor`:

```js
    const spreadStats = DATA.mode === 'aspiring'
      ? getAspiringSpreadStats()
      : getClassSpreadStats();
```

Leave the `idx === 2` early return and the previous-slot exclusion exactly as they are — the "two different class stats" rule applies to aspiring identically.

- [x] **Step 3: Verify in the browser**

```bash
bun run dev
```

Open `/characters/wizard?mode=aspiring&fresh=1`, complete the six builder slots on step 1, and confirm on step 2 that the trait 1 and trait 2 selects are enabled and list the union of the borrowed classes' spread stats. Confirm advent mode is unchanged.

- [x] **Step 4: Commit**

```bash
git add public/js/character-wizard.js
git commit -m "fix: offer trait stats to aspiring characters"
```

---

### Task 9: Summary panel, draft label, copy fix, dead code

**Files:**
- Modify: `public/js/character-wizard.js:439-441`, `:1414`, `:1482-1487`, `:2195`
- Modify: `views/character-new-selector.handlebars:80`
- Modify: `views/character-wizard.handlebars:59`

- [x] **Step 1: Show the pseudo-class in the running summary**

`public/js/character-wizard.js:439-441` falls back to "Step 1: pick a class to begin." for aspiring, so the summary stays empty for the whole wizard. Replace that `else` branch:

```js
    } else if (DATA.mode === 'aspiring' && (state.pseudoClass && state.pseudoClass.name || '').trim()) {
      const pc = state.pseudoClass;
      headerHtml += '<p class="is-size-7"><strong>' + esc(pc.name.trim()) + '</strong></p>';
      if ((pc.tagline || '').trim()) {
        headerHtml += '<p class="has-text-grey is-size-7">' + esc(pc.tagline.trim()) + '</p>';
      }
    } else {
      headerHtml += '<p class="has-text-grey is-size-7">Step 1: pick a class to begin.</p>';
    }
```

- [x] **Step 2: Name aspiring drafts in the restore modal**

`views/character-new-selector.handlebars:80` prints "class not yet chosen" for
every aspiring draft by construction, making saved drafts indistinguishable. The
draft is the wizard `state` read from `localStorage` under
`agentResources.characterWizard`, so it already carries `pseudoClass`. Replace
the `if (classEl)` block:

```js
      if (classEl) {
        // Aspiring drafts never have a classId, so without the pseudo-class
        // name every one of them reads "class not yet chosen".
        var pseudoName = draft.pseudoClass && (draft.pseudoClass.name || '').trim();
        classEl.textContent = pseudoName
          || (draft.classId ? 'class chosen' : 'class not yet chosen');
      }
```

- [x] **Step 3: Fix the step-1 copy**

`views/character-wizard.handlebars:59` opens "Aspirant is class-less…" — the wrong mode name. It is Aspiring that is class-less.

- [x] **Step 4: Delete the dead code**

- `public/js/character-wizard.js:1482-1487` — `refreshStep3Perk = () => {}`, an empty stub. Delete it and its call sites.
- `public/js/character-wizard.js:1414` — `const useAdvanced = DATA.mode === 'aspiring';` sits after the `if (DATA.mode === 'aspiring') return;` at `:1364`, so it is always false. Delete the constant and collapse whatever branches on it.
- `public/js/character-wizard.js:2195` — the stale "still used for the 3 ability slots for now" comment.

- [x] **Step 5: Verify**

```bash
bun run check && bun run test
```

Then in the browser: confirm the summary names the pseudo-class from step 1 onward, that two aspiring drafts are distinguishable in the restore modal, and that the step-1 blurb reads "Aspiring".

- [x] **Step 6: Commit**

```bash
git add public/js/character-wizard.js views/character-new-selector.handlebars views/character-wizard.handlebars
git commit -m "fix: describe the aspiring pseudo-class in the wizard"
```

---

### Task 10: End-to-end aspiring happy path

**Files:**
- Create: `e2e/specs/26-aspiring-wizard.spec.js`

**Interfaces:**
- Consumes: every prior task.

There is no e2e coverage of aspiring today. This is the only test that proves the
whole chain — wizard state through the route, the service mapping, and the RPC —
since Task 7's harness mocks the model layer.

Model the file on `e2e/specs/19-character-wizard-crud.spec.js`, which already
drives the wizard end to end; read it first and reuse its login, navigation and
cleanup helpers rather than writing new ones. Numbering follows the existing
sequence (latest is `25-history-restore-blank.spec.js`).

- [x] **Step 1: Write the spec**

One full pass, asserting at each point the slice changed something:

1. Open `/characters/wizard?mode=aspiring&fresh=1`.
2. Step 1 — type a pseudo-class name, tagline and description. **Assert the
   running summary panel shows the name** (Task 9 Step 1).
3. Step 1 — fill the three gear slots from three distinct classes and the three
   ability slots (two core, one advanced) from three distinct classes.
4. Step 2 — **assert the trait 1 and trait 2 selects are enabled and non-empty**
   (Task 8), then set all three traits.
5. Step 4 — spend the 10 Merx.
6. Submit.
7. On the rendered character page, assert the pseudo-class name appears as the
   character's class and that three abilities are listed.

- [x] **Step 2: Run it**

```bash
bun run test:e2e
```

Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add e2e/specs/26-aspiring-wizard.spec.js
git commit -m "test: e2e coverage for the aspiring wizard"
```

---

## Final verification

- [x] `bun run check` — exit 0
- [x] `bun run test` — unit 1617 pass / 0 fail, exit 0
- [x] `bun run test:http` — 149 pass / 1 fail (pre-existing `open-graph`)
- [~] `bun run test:integration` (local Supabase only) — NOT run as a suite: it halts on two
  pre-existing reds (`character-content-integrity`, `image-crop-integrity`) that predate this
  slice. The files this slice touches were run individually and pass:
  `models/character-atomic` 15 pass, `util/class-ability-type` 2 pass.
- [x] `bun run test:e2e` — 111 passed / 6 failed (the same six pre-existing)
- [x] Compare against the Task 1 Step 1 baseline: no test failing now that was passing then.
  Nine reds exist on this branch; all nine were verified pre-existing (1 http, 2 integration,
  6 e2e). None was caused by this slice.
- [x] Tick this plan's checkboxes as they complete — slice 1's plan shipped with all 76 unticked, which made its state unreadable from the file.

## Out of scope — do not add

- Server-side enforcement of the Merx or Perk budgets. Slice 4.
- Any column storing the spend. It is derived from the picks.
- An edit-form surface for the pseudo-class.
- Player-created `classes` rows. The dormant `is_player_created` machinery stays dormant.
- `getClassPoints()` returning zero class stat points in aspiring mode
  (`public/js/character-wizard.js:738-747`). Recorded as an open question in the
  spec; it is a rules decision, not a defect to fix here.
