# v2 Character & Class Variant Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support Advent v2 characters alongside v1, with the character's effective version inherited from its linked class. v1 paths stay byte-identical; v2 adds typed columns (`conduit_credits`, `quirks`, `accessories`) plus a new structured `character_perks` table with optional compounding links between perks on the same ability.

**Architecture:** Additive schema; no backfill. Form, view, model, and agent serializer all branch on `effective_version = linked_class.rules_version` (defaulting to `'v1'` when no class is linked). v1 surface is untouched. v2-only fields are read/written/serialized only when the linked class is v2; server-side validation enforces per-perk word-count and per-ability perk-count caps.

**Tech Stack:** Node.js (Express), Bun (runtime + test runner), Supabase Postgres, Handlebars, htmx.

**Spec:** `docs/superpowers/specs/2026-05-25-v2-character-support-design.md`

---

## File map

**Create:**
- `supabase/migrations/20260525_v2_character_columns.sql` — adds `conduit_credits`, `quirks`, `accessories` to `characters`.
- `supabase/migrations/20260525_character_perks_table.sql` — new `character_perks` table + RLS policies.
- `views/partials/character-quirk.handlebars` — one-quirk row.
- `views/partials/character-accessory.handlebars` — one-accessory row.
- `views/partials/character-ability-perk.handlebars` — one-perk row scoped to an ability.
- `views/partials/character-v2-fields.handlebars` — container for all v2-gated form sections.
- `views/partials/character-v1-perks-legacy.handlebars` — read-only legacy v1 perks block on a v2 character.

**Modify:**
- `schema.sql` — mirror the two migrations.
- `util/validate.js` — add `countWords`, `validateAbilityPerks`.
- `util/handlebars.js` — add `effectiveRulesVersion` helper and `wordCount` helper.
- `models/character.js` — load `character_perks`, normalize/persist v2 fields, update serializer.
- `models/character.test.js` — new tests for v2 paths.
- `util/validate.test.js` — new tests for validators (create file if it doesn't exist).
- `routes/characters.js` — new htmx partial endpoints; load + pass effectiveVersion.
- `views/character-form.handlebars` — gate `Additional Gear`, v1 perks textarea, and stat help by version; include v2-fields partial.
- `views/character.handlebars` — version branching + version badge.
- `docs/custom-gpt-openapi.json` — document new v2 fields on the character payload.

**Not touched:**
- `models/class.js`, `views/class-form.handlebars` — no class-side changes.

---

## Task 1: DB migration — add v2 columns to `characters`

**Files:**
- Create: `supabase/migrations/20260525_v2_character_columns.sql`

- [ ] **Step 1: Create the migration**

```sql
-- v2 character extensions. Additive: v1 characters leave these at defaults
-- (0 and []) and the v1 form/view never reads or writes them.

ALTER TABLE public.characters
    ADD COLUMN IF NOT EXISTS conduit_credits INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quirks      JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS accessories JSONB NOT NULL DEFAULT '[]'::jsonb;
```

- [ ] **Step 2: Apply against your local Supabase**

Run: `psql "$SUPABASE_DB_URL" -f supabase/migrations/20260525_v2_character_columns.sql`
Expected: `ALTER TABLE` (no errors). If you don't have a local DB, skip and rely on CI / staging apply.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525_v2_character_columns.sql
git commit -m "Add v2 character columns: conduit_credits, quirks, accessories"
```

---

## Task 2: DB migration — `character_perks` table

**Files:**
- Create: `supabase/migrations/20260525_character_perks_table.sql`

- [ ] **Step 1: Create the migration**

```sql
-- Structured Ability Perks for v2 characters. v1 characters never write
-- here; they keep using the freeform characters.perks TEXT field.

CREATE TABLE IF NOT EXISTS public.character_perks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
    class_ability_id UUID NOT NULL REFERENCES public.class_abilities(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    compounds_with UUID REFERENCES public.character_perks(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_character_perks_character ON public.character_perks(character_id);
CREATE INDEX IF NOT EXISTS idx_character_perks_ability   ON public.character_perks(class_ability_id);

ALTER TABLE public.character_perks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "character_perks_select" ON public.character_perks;
DROP POLICY IF EXISTS "character_perks_mutate" ON public.character_perks;

-- Mirror class_abilities visibility: a perk is visible when its owning
-- character is visible (public, owner, or admin).
CREATE POLICY "character_perks_select"
    ON public.character_perks FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.characters c
            JOIN public.profiles p ON p.id = c.creator_id
            WHERE c.id = character_perks.character_id
              AND (c.is_public = true OR p.user_id = auth.uid() OR is_admin())
        )
    );

-- Mutation requires character ownership or admin.
CREATE POLICY "character_perks_mutate"
    ON public.character_perks FOR ALL
    USING (
        EXISTS (
            SELECT 1
            FROM public.characters c
            JOIN public.profiles p ON p.id = c.creator_id
            WHERE c.id = character_perks.character_id
              AND (p.user_id = auth.uid() OR is_admin())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.characters c
            JOIN public.profiles p ON p.id = c.creator_id
            WHERE c.id = character_perks.character_id
              AND (p.user_id = auth.uid() OR is_admin())
        )
    );
```

- [ ] **Step 2: Apply locally**

Run: `psql "$SUPABASE_DB_URL" -f supabase/migrations/20260525_character_perks_table.sql`
Expected: `CREATE TABLE`, `CREATE INDEX` (x2), `ALTER TABLE`, `CREATE POLICY` (x2). Re-running the file is a no-op.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525_character_perks_table.sql
git commit -m "Add character_perks table with RLS for v2 structured perks"
```

---

## Task 3: Mirror migrations in `schema.sql`

**Files:**
- Modify: `schema.sql`

- [ ] **Step 1: Add the new columns to the `characters` CREATE statement**

In `schema.sql`, find the `CREATE TABLE characters` block (around line 30) and add three new lines just before the closing `);`:

```sql
  common_items JSONB DEFAULT '[]'::jsonb,
  conduit_credits INTEGER NOT NULL DEFAULT 0,
  quirks JSONB NOT NULL DEFAULT '[]'::jsonb,
  accessories JSONB NOT NULL DEFAULT '[]'::jsonb
);
```

- [ ] **Step 2: Add backfill `ALTER` lines next to the existing backfill block**

The file already has a "Backfill for existing deployments" section (around line 273). Append:

```sql
ALTER TABLE characters ADD COLUMN IF NOT EXISTS conduit_credits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS quirks JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS accessories JSONB NOT NULL DEFAULT '[]'::jsonb;
```

- [ ] **Step 3: Add the `character_perks` table near the other character-related tables**

Add this block after the `class_abilities` table definition in `schema.sql` (around line 171):

```sql
-- character_perks: structured Ability Perks for v2 characters
CREATE TABLE IF NOT EXISTS character_perks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    class_ability_id UUID NOT NULL REFERENCES class_abilities(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    compounds_with UUID REFERENCES character_perks(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_character_perks_character ON character_perks(character_id);
CREATE INDEX IF NOT EXISTS idx_character_perks_ability   ON character_perks(class_ability_id);

ALTER TABLE character_perks ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 4: Add the RLS policies for `character_perks` near the other policy blocks**

Place these after the existing `class_abilities` policy block in `schema.sql`:

```sql
-- character_perks policies
DROP POLICY IF EXISTS "character_perks_select" ON character_perks;
DROP POLICY IF EXISTS "character_perks_mutate" ON character_perks;

CREATE POLICY "character_perks_select"
    ON character_perks FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM characters c
            JOIN profiles p ON p.id = c.creator_id
            WHERE c.id = character_perks.character_id
              AND (c.is_public = true OR p.user_id = auth.uid() OR is_admin())
        )
    );

CREATE POLICY "character_perks_mutate"
    ON character_perks FOR ALL
    USING (
        EXISTS (
            SELECT 1
            FROM characters c
            JOIN profiles p ON p.id = c.creator_id
            WHERE c.id = character_perks.character_id
              AND (p.user_id = auth.uid() OR is_admin())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM characters c
            JOIN profiles p ON p.id = c.creator_id
            WHERE c.id = character_perks.character_id
              AND (p.user_id = auth.uid() OR is_admin())
        )
    );
```

- [ ] **Step 5: Commit**

```bash
git add schema.sql
git commit -m "schema.sql: mirror v2 character columns and character_perks table"
```

---

## Task 4: Add `countWords` validator (RED)

**Files:**
- Test: `util/validate.test.js`

- [ ] **Step 1: Write the failing test**

Create `util/validate.test.js`. (If a file already exists, append these tests.)

```js
const { test, expect } = require('bun:test');
const { countWords } = require('./validate');

test('countWords splits on whitespace and trims', () => {
  expect(countWords('one two three')).toBe(3);
  expect(countWords('  leading and trailing  ')).toBe(3);
  expect(countWords('multi   space   words')).toBe(3);
});

test('countWords returns 0 for empty / whitespace / non-strings', () => {
  expect(countWords('')).toBe(0);
  expect(countWords('   ')).toBe(0);
  expect(countWords(null)).toBe(0);
  expect(countWords(undefined)).toBe(0);
  expect(countWords(42)).toBe(0);
});

test('countWords handles newlines and tabs', () => {
  expect(countWords('a\nb\tc')).toBe(3);
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `bun test util/validate.test.js`
Expected: FAIL — `countWords is not a function` or similar.

---

## Task 5: Implement `countWords` (GREEN)

**Files:**
- Modify: `util/validate.js`

- [ ] **Step 1: Add the function and export**

In `util/validate.js`, add:

```js
function countWords(value) {
  if (typeof value !== 'string') return 0;
  const trimmed = value.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}
```

And update the export at the bottom:

```js
module.exports = { isValidUuid, validateIdParam, escapeLikePattern, registerUuidParams, countWords };
```

- [ ] **Step 2: Run tests to verify pass**

Run: `bun test util/validate.test.js`
Expected: PASS for all three `countWords` tests.

- [ ] **Step 3: Commit**

```bash
git add util/validate.js util/validate.test.js
git commit -m "Add countWords helper for v2 perk validation"
```

---

## Task 6: Add `validateAbilityPerks` validator (RED)

**Files:**
- Test: `util/validate.test.js`

- [ ] **Step 1: Append failing tests**

```js
const { validateAbilityPerks } = require('./validate');

test('validateAbilityPerks accepts empty input', () => {
  const res = validateAbilityPerks([]);
  expect(res.ok).toBe(true);
});

test('validateAbilityPerks rejects perks over 25 words', () => {
  const longText = Array.from({ length: 26 }, (_, i) => `w${i}`).join(' ');
  const res = validateAbilityPerks([
    { class_ability_id: 'a1', text: longText }
  ]);
  expect(res.ok).toBe(false);
  expect(res.errors[0]).toMatch(/25 words/);
});

test('validateAbilityPerks rejects more than 5 perks for the same ability', () => {
  const perks = Array.from({ length: 6 }, () => ({ class_ability_id: 'a1', text: 'ok' }));
  const res = validateAbilityPerks(perks);
  expect(res.ok).toBe(false);
  expect(res.errors[0]).toMatch(/per ability/);
});

test('validateAbilityPerks allows 5 perks on one ability and 5 on another', () => {
  const perks = [
    ...Array.from({ length: 5 }, () => ({ class_ability_id: 'a1', text: 'ok' })),
    ...Array.from({ length: 5 }, () => ({ class_ability_id: 'a2', text: 'ok' }))
  ];
  const res = validateAbilityPerks(perks);
  expect(res.ok).toBe(true);
});

test('validateAbilityPerks accepts custom limits', () => {
  const perks = [
    { class_ability_id: 'a1', text: 'one two three' }
  ];
  const res = validateAbilityPerks(perks, { wordLimit: 2, perAbility: 5 });
  expect(res.ok).toBe(false);
  expect(res.errors[0]).toMatch(/2 words/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `bun test util/validate.test.js`
Expected: FAIL — `validateAbilityPerks is not a function`.

---

## Task 7: Implement `validateAbilityPerks` (GREEN)

**Files:**
- Modify: `util/validate.js`

- [ ] **Step 1: Add the function and export**

```js
function validateAbilityPerks(perks, { wordLimit = 25, perAbility = 5 } = {}) {
  if (!Array.isArray(perks)) return { ok: true };

  const errors = [];
  const countsByAbility = new Map();

  for (let i = 0; i < perks.length; i++) {
    const perk = perks[i];
    if (!perk || typeof perk !== 'object') continue;

    const abilityId = perk.class_ability_id;
    const text = typeof perk.text === 'string' ? perk.text : '';
    const words = countWords(text);
    if (words > wordLimit) {
      errors.push(`Perk #${i + 1}: must be at most ${wordLimit} words (was ${words}).`);
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

module.exports = {
  isValidUuid, validateIdParam, escapeLikePattern, registerUuidParams,
  countWords, validateAbilityPerks
};
```

(Replace the existing single `module.exports = {...}` line — don't leave two.)

- [ ] **Step 2: Run tests**

Run: `bun test util/validate.test.js`
Expected: PASS for all validator tests.

- [ ] **Step 3: Commit**

```bash
git add util/validate.js util/validate.test.js
git commit -m "Add validateAbilityPerks: 25-word and 5-per-ability v2 limits"
```

---

## Task 8: Add `effectiveRulesVersion` helper to `models/character.js`

**Files:**
- Modify: `models/character.js`

- [ ] **Step 1: Append a small helper near the top of the file (just after the imports)**

```js
// Resolve the rules version a character should be rendered/validated against.
// Inherits from the linked class; falls back to 'v1' when no class is linked
// (preserves legacy behavior for old characters that predate class_id).
const effectiveRulesVersion = async (classId, client = supabase) => {
  if (!classId) return 'v1';
  try {
    const { data: cls } = await getClass(classId, client);
    return cls?.rules_version === 'v2' ? 'v2' : 'v1';
  } catch (_) {
    return 'v1';
  }
};
```

- [ ] **Step 2: Export the helper**

In the existing `module.exports = { ... }` block at the bottom of `models/character.js`, add `effectiveRulesVersion` to the list of exports.

- [ ] **Step 3: Commit**

```bash
git add models/character.js
git commit -m "Add effectiveRulesVersion helper deriving version from linked class"
```

---

## Task 9: Drop v2 fields server-side on v1 characters (TDD)

**Files:**
- Test: `models/character.test.js`
- Modify: `models/character.js`

- [ ] **Step 1: Write the failing test**

Append to `models/character.test.js`:

```js
test('createCharacter drops v2-only fields when linked class is v1', async () => {
  const { createCharacter } = require('./character');
  const payload = {
    name: 'Versionless',
    class_id: 'class-1',          // class is v1 in fakeAnon
    class: 'Soldier',
    level: 1,
    vitality: 1, might: 1, resilience: 1, spirit: 1, arcane: 1, will: 1,
    sensory: 1, reflex: 1, vigor: 1, skill: 1, intelligence: 1, luck: 1,
    completed_missions: 0, commissary_reward: 0,
    conduit_credits: 7,
    quirks: [{ name: 'Synthetic', description: 'Built, not born' }],
    accessories: [{ name: 'Monocle' }]
  };
  const { data, error } = await createCharacter(payload, { id: 'profile-1' });
  expect(error).toBeFalsy();
  // Inserted row should not carry v2 fields when class is v1.
  expect(data).toBeTruthy();
  // The fake admin client always echoes characterRowBase, so we check
  // that the payload mutation happened (the function deletes keys before insert).
  expect(payload.conduit_credits).toBeUndefined();
  expect(payload.quirks).toBeUndefined();
  expect(payload.accessories).toBeUndefined();
});
```

(Note: `fakeAnon` already has `classes: []` — to make this test meaningful, ensure `getClass` returns a v1 class. See Step 2.)

- [ ] **Step 2: Adjust the test fixture so the linked class is resolvable**

In `models/character.test.js`, find the `fakeAnon = makeClient({ ... })` call (around line 71) and add a `classes` entry with the v1 fixture:

```js
const fakeAnon = makeClient({
  characters: [{
    ...characterRowBase,
    personality: [],
    abilities: [],
    gear: []
  }],
  traits: [],
  class_gear: [],
  class_abilities: [],
  classes: [{ id: 'class-1', name: 'Soldier', rules_version: 'v1' }]
});
```

Also update `fakeAdmin`'s `classes: []` to the same value:

```js
classes: [{ id: 'class-1', name: 'Soldier', rules_version: 'v1' }]
```

- [ ] **Step 3: Run and verify it fails**

Run: `bun test models/character.test.js`
Expected: FAIL — `payload.conduit_credits` is still `7` (the model hasn't been taught to drop v2 fields).

- [ ] **Step 4: Implement the drop logic**

In `models/character.js`, inside `createCharacter` (just after `characterReq.creator_id = profile.id`), insert:

```js
  const v2OnlyFields = ['conduit_credits', 'quirks', 'accessories', 'ability_perks'];
  const linkedVersion = await effectiveRulesVersion(characterReq.class_id);
  if (linkedVersion !== 'v2') {
    for (const k of v2OnlyFields) delete characterReq[k];
  }
```

Apply the same block at the same logical position inside `updateCharacter`.

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test models/character.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add models/character.js models/character.test.js
git commit -m "Drop v2-only fields server-side when linked class is v1"
```

---

## Task 10: Persist `quirks`, `accessories`, `conduit_credits` for v2 characters (TDD)

**Files:**
- Test: `models/character.test.js`
- Modify: `models/character.js`

- [ ] **Step 1: Add a v2 fixture row and test**

In `models/character.test.js`, after the existing `fakeAdmin`, add a second admin client used by this test:

```js
const fakeAdminV2 = makeClient({
  characters: [{
    ...characterRowBase,
    class_id: 'class-v2',
    class: 'Thane-v2',
    conduit_credits: 0,
    quirks: [],
    accessories: [],
    personality: [{ name: 'Brave' }],
    abilities: [],
    gear: []
  }],
  traits: [],
  class_gear: [],
  class_abilities: [],
  character_perks: [],
  classes: [{ id: 'class-v2', name: 'Thane-v2', rules_version: 'v2' }]
});
```

Then append the test (uses `mock.module` to swap `_base` for just this test):

```js
test('createCharacter preserves v2 fields when linked class is v2', async () => {
  mock.module('./_base', () => ({
    supabase: fakeAdminV2,
    supabaseAdmin: fakeAdminV2,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeAdminV2
  }));
  delete require.cache[require.resolve('./character')];
  const { createCharacter } = require('./character');

  const payload = {
    name: 'V2',
    class_id: 'class-v2',
    class: 'Thane-v2',
    level: 1,
    vitality: 1, might: 1, resilience: 1, spirit: 1, arcane: 1, will: 1,
    sensory: 1, reflex: 1, vigor: 1, skill: 1, intelligence: 1, luck: 1,
    completed_missions: 0, commissary_reward: 0,
    conduit_credits: 3,
    quirks: [{ name: 'Synthetic', description: 'Built, not born' }],
    accessories: [{ name: 'Monocle' }]
  };
  const { data, error } = await createCharacter(payload, { id: 'profile-1' });
  expect(error).toBeFalsy();
  expect(payload.conduit_credits).toBe(3);
  expect(Array.isArray(payload.quirks)).toBe(true);
  expect(payload.quirks.length).toBe(1);
  expect(payload.accessories[0].name).toBe('Monocle');

  // Restore the original module mock for subsequent tests.
  mock.module('./_base', () => ({
    supabase: fakeAnon,
    supabaseAdmin: fakeAdmin,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeAnon
  }));
  delete require.cache[require.resolve('./character')];
});
```

- [ ] **Step 2: Run and watch it fail (no normalizer yet)**

Run: `bun test models/character.test.js`
Expected: PASS for the assertion that the values are preserved on `payload` — but the goal here is to also normalize them. If the test happens to pass without code changes, still add normalizers in Step 3 for safety.

- [ ] **Step 3: Add normalizers in `models/character.js`**

Near `normalizeGearItems` add:

```js
const normalizeNamedJsonbList = (input) => {
  if (!Array.isArray(input)) return [];
  return input
    .map(item => {
      if (!item) return null;
      if (typeof item === 'string') {
        const trimmed = item.trim();
        return trimmed ? { name: trimmed } : null;
      }
      if (typeof item === 'object' && typeof item.name === 'string') {
        const name = item.name.trim();
        if (!name) return null;
        const out = { name };
        if (typeof item.description === 'string' && item.description.trim()) {
          out.description = item.description.trim();
        }
        return out;
      }
      return null;
    })
    .filter(Boolean);
};
```

- [ ] **Step 4: Wire normalizers into create and update**

In `createCharacter` (and the parallel block in `updateCharacter`), after the v1-drop block from Task 9 but before the `supabaseAdmin.from('characters').insert(...)` call:

```js
  if (linkedVersion === 'v2') {
    characterReq.quirks = normalizeNamedJsonbList(characterReq.quirks);
    characterReq.accessories = normalizeNamedJsonbList(characterReq.accessories);
    const cc = Number(characterReq.conduit_credits);
    characterReq.conduit_credits = Number.isFinite(cc) && cc >= 0 ? Math.floor(cc) : 0;
  }
```

- [ ] **Step 5: Run tests**

Run: `bun test models/character.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add models/character.js models/character.test.js
git commit -m "Normalize and persist quirks/accessories/conduit_credits on v2 characters"
```

---

## Task 11: Add `setCharacterPerks` helper + validation wiring (TDD)

**Files:**
- Test: `models/character.test.js`
- Modify: `models/character.js`

- [ ] **Step 1: Failing test for validation rejection**

Append:

```js
test('createCharacter rejects v2 perks that violate validation', async () => {
  mock.module('./_base', () => ({
    supabase: fakeAdminV2,
    supabaseAdmin: fakeAdminV2,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeAdminV2
  }));
  delete require.cache[require.resolve('./character')];
  const { createCharacter } = require('./character');

  const longText = Array.from({ length: 26 }, (_, i) => `w${i}`).join(' ');
  const payload = {
    name: 'V2', class_id: 'class-v2', class: 'Thane-v2', level: 1,
    vitality: 1, might: 1, resilience: 1, spirit: 1, arcane: 1, will: 1,
    sensory: 1, reflex: 1, vigor: 1, skill: 1, intelligence: 1, luck: 1,
    completed_missions: 0, commissary_reward: 0,
    ability_perks: [{ class_ability_id: 'a1', text: longText }]
  };
  const { error } = await createCharacter(payload, { id: 'profile-1' });
  expect(error).toBeTruthy();
  expect(String(error)).toMatch(/25 words/);

  mock.module('./_base', () => ({
    supabase: fakeAnon, supabaseAdmin: fakeAdmin,
    anonKey: 'test-anon-key', createUserClient: () => fakeAnon
  }));
  delete require.cache[require.resolve('./character')];
});
```

- [ ] **Step 2: Run, watch it fail**

Run: `bun test models/character.test.js`
Expected: FAIL — error is falsy because no validation is wired yet.

- [ ] **Step 3: Add the helper and wire validation**

Near the top of `models/character.js`, add to the imports:

```js
const { validateAbilityPerks } = require('../util/validate');
```

After `normalizeAbilityItems`, add:

```js
const normalizeAbilityPerks = (perks) => {
  if (!Array.isArray(perks)) return [];
  return perks
    .map((p, i) => {
      if (!p || typeof p !== 'object') return null;
      const text = typeof p.text === 'string' ? p.text.trim() : '';
      const classAbilityId = p.class_ability_id || null;
      if (!text || !classAbilityId) return null;
      const position = Number.isFinite(Number(p.position)) ? Number(p.position) : i;
      const compoundsWith = p.compounds_with_id || p.compounds_with || null;
      return {
        class_ability_id: classAbilityId,
        text,
        position,
        compounds_with: compoundsWith
      };
    })
    .filter(Boolean);
};

const setCharacterPerks = async (characterId, perks) => {
  const normalized = normalizeAbilityPerks(perks);

  // delete-then-insert, mirroring setCharacterGear/setCharacterAbilities
  const { error: delError } = await supabaseAdmin
    .from('character_perks')
    .delete()
    .eq('character_id', characterId);
  if (delError) return { data: null, error: delError };

  if (normalized.length === 0) return { data: [], error: null };

  // Two-pass insert so we can resolve compounds_with references that point
  // to perks created in the same submission (referenced by their position).
  const rowsWithoutLinks = normalized.map(p => ({
    character_id: characterId,
    class_ability_id: p.class_ability_id,
    text: p.text,
    position: p.position
  }));
  const { data: inserted, error: insError } = await supabaseAdmin
    .from('character_perks')
    .insert(rowsWithoutLinks)
    .select();
  if (insError) return { data: null, error: insError };

  // Map by position+ability so we can resolve symbolic compounds_with
  // references the form submits (the form references peers by their
  // position within the same ability — see Task 19).
  const byKey = new Map();
  for (const row of inserted) {
    byKey.set(`${row.class_ability_id}:${row.position}`, row.id);
  }

  const updates = normalized
    .map((p, i) => {
      const id = inserted[i]?.id;
      if (!id || !p.compounds_with) return null;
      // compounds_with may already be a UUID (existing row) or a
      // "position-{n}" sentinel from a fresh form submission.
      let target = null;
      if (typeof p.compounds_with === 'string' && p.compounds_with.startsWith('position-')) {
        const targetPos = Number(p.compounds_with.slice('position-'.length));
        target = byKey.get(`${p.class_ability_id}:${targetPos}`);
      } else {
        // Verify it points to a perk we just inserted on the same ability
        const candidate = inserted.find(r => r.id === p.compounds_with);
        if (candidate && candidate.class_ability_id === p.class_ability_id) {
          target = candidate.id;
        }
      }
      if (!target || target === id) return null;
      return { id, compounds_with: target };
    })
    .filter(Boolean);

  for (const u of updates) {
    const { error: updError } = await supabaseAdmin
      .from('character_perks')
      .update({ compounds_with: u.compounds_with })
      .eq('id', u.id);
    if (updError) return { data: null, error: updError };
  }

  return { data: inserted, error: null };
};
```

In `createCharacter`, just before the existing `class gear` extraction block, add:

```js
  // Extract v2 ability_perks before insert; we persist them after the row exists.
  const abilityPerks = characterReq.ability_perks;
  delete characterReq.ability_perks;

  if (linkedVersion === 'v2') {
    const v = validateAbilityPerks(normalizeAbilityPerks(abilityPerks));
    if (!v.ok) {
      return { data: null, error: v.errors.join(' ') };
    }
  }
```

After the `setCharacterAbilities` block at the bottom of `createCharacter`, add:

```js
  if (linkedVersion === 'v2') {
    const { error: perksError } = await setCharacterPerks(character.id, abilityPerks);
    if (perksError) {
      return { data: null, error: perksError };
    }
  }
```

Apply the symmetric edits to `updateCharacter`.

- [ ] **Step 4: Run tests**

Run: `bun test models/character.test.js`
Expected: PASS, including the validation-rejection test.

- [ ] **Step 5: Commit**

```bash
git add models/character.js models/character.test.js
git commit -m "Persist structured ability perks for v2 characters with validation"
```

---

## Task 12: Load `ability_perks` in `getCharacter` (TDD)

**Files:**
- Test: `models/character.test.js`
- Modify: `models/character.js`

- [ ] **Step 1: Failing test**

```js
test('getCharacter attaches ability_perks for v2 characters', async () => {
  mock.module('./_base', () => {
    const v2Admin = makeClient({
      characters: [{
        ...characterRowBase,
        class_id: 'class-v2',
        class: 'Thane-v2',
        personality: [],
        abilities: [],
        gear: []
      }],
      traits: [],
      class_gear: [],
      class_abilities: [],
      classes: [{ id: 'class-v2', name: 'Thane-v2', rules_version: 'v2' }],
      character_perks: [
        { id: 'p1', character_id: 'char-uuid-1', class_ability_id: 'a1', text: 'Bigger sword', position: 0, compounds_with: null },
        { id: 'p2', character_id: 'char-uuid-1', class_ability_id: 'a1', text: 'Even bigger',  position: 1, compounds_with: 'p1' }
      ]
    });
    return {
      supabase: v2Admin, supabaseAdmin: v2Admin,
      anonKey: 'test-anon-key', createUserClient: () => v2Admin
    };
  });
  delete require.cache[require.resolve('./character')];
  const { getCharacter } = require('./character');
  const { data, error } = await getCharacter('char-uuid-1');
  expect(error).toBeFalsy();
  expect(Array.isArray(data.ability_perks)).toBe(true);
  expect(data.ability_perks.length).toBe(2);
  expect(data.ability_perks[0].text).toBe('Bigger sword');

  // restore
  mock.module('./_base', () => ({
    supabase: fakeAnon, supabaseAdmin: fakeAdmin,
    anonKey: 'test-anon-key', createUserClient: () => fakeAnon
  }));
  delete require.cache[require.resolve('./character')];
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `bun test models/character.test.js`
Expected: FAIL — `data.ability_perks` is undefined.

- [ ] **Step 3: Implement the load**

In `models/character.js`, add a helper next to `getCharacterAbilities`:

```js
const getCharacterAbilityPerks = async (id) => {
  const { data, error } = await supabaseAdmin
    .from('character_perks')
    .select('*')
    .eq('character_id', id)
    .order('position', { ascending: true });
  if (error) return { data: null, error };
  return { data: Array.isArray(data) ? data : [], error: null };
};
```

In `getCharacter`, after the abilities fetch:

```js
  const { data: abilityPerks, error: perksError } = await getCharacterAbilityPerks(id);
  if (perksError) {
    console.error(perksError);
    return { data: null, error: perksError };
  }
  data.ability_perks = abilityPerks;
```

- [ ] **Step 4: Run tests**

Run: `bun test models/character.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add models/character.js models/character.test.js
git commit -m "Load character_perks rows as ability_perks on getCharacter"
```

---

## Task 13: Serialize v2 fields for agent API (TDD)

**Files:**
- Test: `models/character.test.js`
- Modify: `models/character.js`

- [ ] **Step 1: Failing test**

```js
test('serializeCharacterForAgent omits v2 fields on v1 characters', () => {
  const { serializeCharacterForAgent } = require('./character');
  const row = {
    id: 'c1', creator_id: 'p1', name: 'V1', class: 'Soldier', level: 1,
    is_public: true, is_deceased: false,
    // version is resolved externally; the serializer receives it as a hint:
    rules_version: 'v1',
    conduit_credits: 0, quirks: [], accessories: [], ability_perks: []
  };
  const out = serializeCharacterForAgent(row, { profileId: 'p1', role: 'admin' });
  expect(out.rules_version).toBe('v1');
  expect(out).not.toHaveProperty('conduit_credits');
  expect(out).not.toHaveProperty('quirks');
  expect(out).not.toHaveProperty('accessories');
  expect(out).not.toHaveProperty('ability_perks');
});

test('serializeCharacterForAgent includes v2 fields on v2 characters', () => {
  const { serializeCharacterForAgent } = require('./character');
  const row = {
    id: 'c2', creator_id: 'p1', name: 'V2', class: 'Thane-v2', level: 1,
    is_public: true, is_deceased: false,
    rules_version: 'v2',
    conduit_credits: 4,
    quirks: [{ name: 'Synthetic' }],
    accessories: [{ name: 'Monocle' }],
    ability_perks: [{ class_ability_id: 'a1', text: 'Bigger sword', position: 0 }]
  };
  const out = serializeCharacterForAgent(row, { profileId: 'p1', role: 'admin' });
  expect(out.rules_version).toBe('v2');
  expect(out.conduit_credits).toBe(4);
  expect(out.quirks[0].name).toBe('Synthetic');
  expect(out.accessories[0].name).toBe('Monocle');
  expect(out.ability_perks[0].text).toBe('Bigger sword');
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `bun test models/character.test.js`
Expected: FAIL — `rules_version` is undefined on the output.

- [ ] **Step 3: Update the serializer**

In `models/character.js`, edit `serializeCharacterForAgent`. After the existing block that builds `stats`, `traits`, `abilities`, `signature_gear`, add:

```js
  const out = {
    ...serializeCharacterSummaryForAgent(row),
    rules_version: row.rules_version === 'v2' ? 'v2' : 'v1',
    stats,
    traits: Array.isArray(row.personality) ? row.personality.map((t) => t.name) : [],
    abilities: Array.isArray(row.abilities)
      ? row.abilities.map((a) => ({ name: a.name, description: a.description }))
      : [],
    signature_gear: Array.isArray(row.gear)
      ? row.gear.map((g) => ({ name: g.name, description: g.description }))
      : []
  };

  if (out.rules_version === 'v2') {
    out.conduit_credits = Number(row.conduit_credits) || 0;
    out.quirks = Array.isArray(row.quirks) ? row.quirks : [];
    out.accessories = Array.isArray(row.accessories) ? row.accessories : [];
    out.ability_perks = Array.isArray(row.ability_perks)
      ? row.ability_perks.map((p) => ({
          class_ability_id: p.class_ability_id,
          text: p.text,
          position: p.position,
          compounds_with: p.compounds_with || null
        }))
      : [];
  }

  return out;
```

(Replace the existing `return { ... }` at the end of `serializeCharacterForAgent` with this block — don't keep both.)

- [ ] **Step 4: Pass `rules_version` through `getCharacterForAgent`**

Find `getCharacterForAgent` near the bottom of `models/character.js`. It already runs a `select` that joins `personality`, `abilities`, `gear`. After the select, also resolve the version:

```js
  const rulesVersion = await effectiveRulesVersion(data.class_id);
```

Then pass it into the serializer:

```js
  const serialized = serializeCharacterForAgent(
    { ...data, owner_name: data.profile?.name || null, rules_version: rulesVersion },
    actor
  );
```

If the character is v2, also fetch its perks and attach as `ability_perks`:

```js
  if (rulesVersion === 'v2') {
    const { data: perks } = await getCharacterAbilityPerks(data.id);
    data.ability_perks = perks || [];
  }
```

(Place this fetch before the `serializeCharacterForAgent` call; pass `ability_perks: data.ability_perks` into the spread.)

- [ ] **Step 5: Run tests**

Run: `bun test models/character.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add models/character.js models/character.test.js
git commit -m "Serialize v2 fields (rules_version, conduit_credits, quirks, accessories, ability_perks) for agent API"
```

---

## Task 14: Handlebars helper for effective version + word count

**Files:**
- Modify: `util/handlebars.js`

- [ ] **Step 1: Add helpers**

In `util/handlebars.js`, just before `module.exports`:

```js
const effectiveRulesVersionH = function (character, characterClass) {
  if (characterClass && characterClass.rules_version === 'v2') return 'v2';
  if (character && character.linked_class && character.linked_class.rules_version === 'v2') return 'v2';
  return 'v1';
};

const wordCountH = function (text) {
  if (typeof text !== 'string') return 0;
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
};
```

Add them to the exports:

```js
module.exports = {
  // ... existing exports ...
  effectiveRulesVersion: effectiveRulesVersionH,
  wordCount: wordCountH
};
```

(Don't duplicate `effectiveRulesVersion` — the model has a different one with the same name. The Handlebars helper is registered by name in whatever wires helpers up; keep the JS export name distinct from the helper-registered name only if necessary. Verify the helper-registration spot below.)

- [ ] **Step 2: Confirm the helper-registration site**

Run: `grep -n "effectiveRulesVersion\|registerHelper\|require.*handlebars" index.js | head -10`
If `index.js` (or wherever Handlebars is set up — search for `registerHelper`) iterates over the exports of `util/handlebars.js`, then nothing further is needed. Otherwise, add an explicit `registerHelper('effectiveRulesVersion', effectiveRulesVersion)` call there.

- [ ] **Step 3: Commit**

```bash
git add util/handlebars.js
git commit -m "Add Handlebars helpers: effectiveRulesVersion, wordCount"
```

---

## Task 15: Pass `effectiveVersion` and `characterClass` into the form

**Files:**
- Modify: `routes/characters.js`

- [ ] **Step 1: Resolve the class on `/new`**

In `router.get('/new', ...)` (around line 77 of `routes/characters.js`), after `filterClassDataForUser` resolves, no class is selected yet. Pass `effectiveVersion: 'v1'` as a default along with the existing render values:

```js
  res.render('character-form', {
    profile,
    isNew: true,
    statList,
    adventClasses: filteredAdvent,
    aspirantPreviewClasses: filteredAspirant,
    playerCreatedClasses: filteredPCC,
    personalityMap,
    classGearList: filteredGear,
    classAbilityList: filteredAbilities,
    effectiveVersion: 'v1',
    activeNav: 'characters',
    breadcrumbs: [
      { label: 'Characters', href: '/characters' },
      { label: 'New Character', href: '/characters/new' }
    ]
  });
```

- [ ] **Step 2: Resolve the class on `/:id/edit`**

In `router.get('/:id/edit', ...)`, just before the `res.render('character-form', { ... })` call, fetch the linked class and resolve version:

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

Add `effectiveVersion, characterClass` to the `res.render('character-form', { ... })` options bag.

- [ ] **Step 3: Sanity check — run the dev server**

Run: `bun run dev`
Open `/characters/new` and `/characters/<id>/edit` for an existing v1 character. Confirm pages render unchanged. (No v2 UI exists yet, so this is just a no-regression check.)

- [ ] **Step 4: Commit**

```bash
git add routes/characters.js
git commit -m "Resolve effectiveVersion + linked class for character-form render"
```

---

## Task 16: New partial — `character-quirk`

**Files:**
- Create: `views/partials/character-quirk.handlebars`

- [ ] **Step 1: Write the partial**

```handlebars
<div class="column is-full">
  <div class="field has-addons">
    <div class="control is-expanded">
      <input class="input" type="text" name="quirk_name[]" placeholder="Quirk name (e.g. Synthetic)" value="{{quirk.name}}" required>
    </div>
    <div class="control is-expanded ml-2">
      <input class="input" type="text" name="quirk_description[]" placeholder="Short description (optional)" value="{{quirk.description}}">
    </div>
    <div class="control ml-2 mt-2">
      <button type="button" class="delete" hx-on:click="htmx.remove(htmx.closest(this, '.is-full'));"></button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add views/partials/character-quirk.handlebars
git commit -m "Add character-quirk partial"
```

---

## Task 17: New partial — `character-accessory`

**Files:**
- Create: `views/partials/character-accessory.handlebars`

- [ ] **Step 1: Write the partial**

```handlebars
<div class="column is-full">
  <div class="field has-addons">
    <div class="control is-expanded">
      <input class="input" type="text" name="accessory_name[]" placeholder="Accessory name" value="{{accessory.name}}" required>
    </div>
    <div class="control is-expanded ml-2">
      <input class="input" type="text" name="accessory_description[]" placeholder="Short description (optional)" value="{{accessory.description}}">
    </div>
    <div class="control ml-2 mt-2">
      <button type="button" class="delete" hx-on:click="htmx.remove(htmx.closest(this, '.is-full'));"></button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add views/partials/character-accessory.handlebars
git commit -m "Add character-accessory partial"
```

---

## Task 18: New partial — `character-ability-perk`

**Files:**
- Create: `views/partials/character-ability-perk.handlebars`

- [ ] **Step 1: Write the partial**

Each perk row submits hidden `ability_perk_class_ability_id[]`, `ability_perk_text[]`, `ability_perk_position[]`, `ability_perk_compounds_with[]`. The form code (Task 19) maps these into the `ability_perks` array the model expects.

```handlebars
<div class="column is-full perk-row" data-ability-id="{{abilityId}}" data-position="{{position}}">
  <input type="hidden" name="ability_perk_class_ability_id[]" value="{{abilityId}}">
  <input type="hidden" name="ability_perk_position[]" value="{{position}}">
  <div class="field has-addons">
    <div class="control is-expanded">
      <input class="input perk-text" type="text" name="ability_perk_text[]"
             placeholder="Perk text (≤25 words)" value="{{perk.text}}"
             maxlength="500" required
             oninput="this.nextElementSibling.querySelector('.word-count').textContent = (this.value.trim() ? this.value.trim().split(/\s+/).length : 0) + ' / 25 words';">
      <p class="help"><span class="word-count">{{wordCount perk.text}} / 25 words</span></p>
    </div>
    <div class="control ml-2">
      <div class="select">
        <select name="ability_perk_compounds_with[]">
          <option value="">(no compound)</option>
          {{#each siblingPerks}}
            {{#unless (eq this.position ../position)}}
            <option value="position-{{this.position}}" {{#if (eq (or ../perk.compounds_with '') (concat 'position-' this.position))}}selected{{/if}}>
              Compounds with #{{add this.position 1}}: {{this.text}}
            </option>
            {{/unless}}
          {{/each}}
        </select>
      </div>
    </div>
    <div class="control ml-2 mt-2">
      <button type="button" class="delete" hx-on:click="htmx.remove(htmx.closest(this, '.perk-row'));"></button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Register `concat` and `or` Handlebars helpers if missing**

Run: `grep -n "'or'\|'concat'\|registerHelper" index.js util/handlebars.js | head`

If `or` and `concat` are not already registered Handlebars helpers in this project, add them in `util/handlebars.js`:

```js
const orH = function (...args) {
  // last arg is the Handlebars options object
  const values = args.slice(0, -1);
  return values.some(Boolean);
};

const concatH = function (...args) {
  return args.slice(0, -1).map(v => v == null ? '' : String(v)).join('');
};
```

Add `or: orH, concat: concatH` to the `module.exports`. Skip this step entirely if those helpers already exist.

- [ ] **Step 3: Commit**

```bash
git add views/partials/character-ability-perk.handlebars util/handlebars.js
git commit -m "Add character-ability-perk partial with compounding selector"
```

---

## Task 19: New container partial — `character-v2-fields`

**Files:**
- Create: `views/partials/character-v2-fields.handlebars`

- [ ] **Step 1: Write the partial**

The container holds all v2-only sections so the form can swap the whole block when the class selection changes (Task 23).

```handlebars
<div id="v2-fields-container">
  <hr />

  <div class="field">
    <label class="label" for="char-conduit-credits">Conduit Credits</label>
    <div class="control">
      <input class="input" type="number" name="conduit_credits" id="char-conduit-credits"
             value="{{#if character.conduit_credits}}{{character.conduit_credits}}{{else}}0{{/if}}" min="0">
    </div>
  </div>

  <hr />

  <div class="block">
    <label class="label">Quirks</label>
    <p class="help mb-2">Use these to describe non-human or otherwise atypical aspects of your character.</p>
    <div class="columns is-multiline" id="quirks-list">
      {{#if character.quirks}}
        {{#each character.quirks}}
          {{> character-quirk quirk=this}}
        {{/each}}
      {{/if}}
    </div>
    <button type="button" class="button is-primary"
            hx-get="/characters/quirk" hx-target="#quirks-list" hx-swap="beforeend">Add Quirk</button>
  </div>

  <hr />

  <div class="block">
    <label class="label">Accessories</label>
    <div class="columns is-multiline" id="accessories-list">
      {{#if character.accessories}}
        {{#each character.accessories}}
          {{> character-accessory accessory=this}}
        {{/each}}
      {{/if}}
    </div>
    <button type="button" class="button is-primary"
            hx-get="/characters/accessory" hx-target="#accessories-list" hx-swap="beforeend">Add Accessory</button>
  </div>

  <hr />

  <div class="block">
    <label class="label">Ability Perks</label>
    <p class="help mb-2">Each perk is at most 25 words; max five per ability. Use the "Compounds with" picker to stack a perk onto another perk for the same ability.</p>
    {{#if character.abilities}}
      {{#each character.abilities}}
        <div class="box perk-group" data-ability-id="{{this.id}}">
          <h4 class="title is-5">{{capitalize this.name}}</h4>
          <div class="columns is-multiline" id="perks-list-{{this.id}}">
            {{#each (perksForAbility ../character.ability_perks this.id) }}
              {{> character-ability-perk perk=this abilityId=../this.id position=this.position siblingPerks=(perksForAbility ../../character.ability_perks ../this.id) }}
            {{/each}}
          </div>
          <button type="button" class="button is-primary is-small"
                  hx-get="/characters/ability-perk?ability_id={{this.id}}&position={{nextPerkPosition ../character.ability_perks this.id}}"
                  hx-target="#perks-list-{{this.id}}" hx-swap="beforeend">
            Add Perk
          </button>
        </div>
      {{/each}}
    {{else}}
      <p class="has-text-grey">Add at least one Class Ability above before authoring perks.</p>
    {{/if}}
  </div>
</div>
```

- [ ] **Step 2: Register two small Handlebars helpers**

In `util/handlebars.js`, add:

```js
const perksForAbilityH = function (perks, abilityId) {
  if (!Array.isArray(perks)) return [];
  return perks.filter(p => p && p.class_ability_id === abilityId);
};

const nextPerkPositionH = function (perks, abilityId) {
  const peers = (Array.isArray(perks) ? perks : []).filter(p => p && p.class_ability_id === abilityId);
  if (peers.length === 0) return 0;
  return Math.max(...peers.map(p => Number(p.position) || 0)) + 1;
};
```

Add `perksForAbility: perksForAbilityH, nextPerkPosition: nextPerkPositionH` to the `module.exports`.

- [ ] **Step 3: Commit**

```bash
git add views/partials/character-v2-fields.handlebars util/handlebars.js
git commit -m "Add character-v2-fields container partial with perks/quirks/accessories sections"
```

---

## Task 20: Legacy-perks partial for v2 characters that still have v1 perks text

**Files:**
- Create: `views/partials/character-v1-perks-legacy.handlebars`

- [ ] **Step 1: Write the partial**

```handlebars
{{#if character.perks}}
<hr />
<div class="notification is-warning is-light">
  <p><strong>Legacy perks (v1)</strong> — your character is now on a v2 class; new perks should use the structured Ability Perks editor above. This block is read-only and your old text is preserved.</p>
  <div class="content mt-2">
    {{{markdown character.perks}}}
  </div>
</div>
{{/if}}
```

- [ ] **Step 2: Commit**

```bash
git add views/partials/character-v1-perks-legacy.handlebars
git commit -m "Add legacy v1-perks read-only partial for v2 characters"
```

---

## Task 21: Branch `character-form.handlebars` on `effectiveVersion`

**Files:**
- Modify: `views/character-form.handlebars`

- [ ] **Step 1: Gate the v1 perks textarea**

Find the existing `<div class="field">` block that renders `name="perks"` (around line 176). Wrap it so it only renders on v1:

```handlebars
  {{#if (eq effectiveVersion 'v1')}}
  <div class="field">
    <label class="label" for="char-perks">Ability Perks</label>
    <div class="control">
      <textarea class="textarea" name="perks" id="char-perks" placeholder="Ability Perks" data-toast-editor>{{character.perks}}</textarea>
    </div>
  </div>
  {{/if}}
```

- [ ] **Step 2: Gate `Additional Gear` to v1 only**

Find the existing `{{#if character.additional_gear}}` block (around line 183). Change it to:

```handlebars
  {{#if (and (eq effectiveVersion 'v1') character.additional_gear)}}
  <hr />
  <div class="field">
    <label class="label">
      Additional Gear
      <span class="tag is-warning is-light ml-2">Deprecated</span>
    </label>
    <p class="help mb-2">This field is deprecated. Please use Common Items above instead.</p>
    <div class="control">
      <textarea class="textarea" name="additional_gear"
        placeholder="Additional Gear" data-toast-editor>{{character.additional_gear}}</textarea>
    </div>
  </div>
  {{/if}}
```

- [ ] **Step 3: Confirm `and` helper exists**

Run: `grep -n "'and'\|registerHelper\.\\\?\.and" util/handlebars.js index.js`
If `and` is not registered, add:

```js
const andH = function (...args) {
  const values = args.slice(0, -1);
  return values.every(Boolean);
};
```

And add `and: andH` to exports. Skip if already present.

- [ ] **Step 4: Simplify the level-up help text for v2 characters**

Find the existing block that shows both `V1: Need ...` and `V2: Need ...` (around line 50–55). Replace with a conditional:

```handlebars
        {{#if (lt character.level 10)}}
        <p class="help">
          {{#if (eq effectiveVersion 'v2')}}
          V2: Need {{subtract (getTotalV2MissionsNeeded (add character.level 1)) character.completed_missions}} more
          missions to reach level {{add character.level 1}}
          {{else}}
          V1: Need {{subtract (getTotalV1MissionsNeeded (add character.level 1)) character.completed_missions}} more
          missions to reach level {{add character.level 1}}
          {{/if}}
        </p>
        {{/if}}
```

- [ ] **Step 5: Insert the v2-fields container**

After the existing `Class Abilities` block (around line 159 today) and before the `Ability Perks` (now v1-only) block, insert:

```handlebars
  {{#if (eq effectiveVersion 'v2')}}
    {{> character-v2-fields character=character}}
    {{> character-v1-perks-legacy character=character}}
  {{/if}}
```

- [ ] **Step 6: Add a re-render-on-class-change trigger to the class `<select>`**

Find the existing class `<select name="class_id" ...>` block. Replace its opening tag with:

```handlebars
        <select name="class_id" id="char-class-id" required
                hx-get="/characters/version-fields"
                hx-trigger="change"
                hx-target="#v2-fields-container"
                hx-swap="outerHTML"
                hx-include="this">
```

(The endpoint is implemented in Task 23. If `#v2-fields-container` does not exist in the DOM yet — e.g., for v1 selections — the swap will be a no-op; that's fine.)

To ensure the container is present even on v1 (so the swap from v1 → v2 has a target), wrap the `{{#if (eq effectiveVersion 'v2')}}` insertion from Step 5 so an empty container exists on v1:

```handlebars
  {{#if (eq effectiveVersion 'v2')}}
    {{> character-v2-fields character=character}}
    {{> character-v1-perks-legacy character=character}}
  {{else}}
    <div id="v2-fields-container"></div>
  {{/if}}
```

- [ ] **Step 7: Manually verify in the browser**

Run: `bun run dev`
1. Open `/characters/new`. Confirm everything renders as before (no v2 sections, no errors).
2. Open `/characters/<id>/edit` for a v1 character. Confirm unchanged.
3. (Skip v2 verification until Tasks 22–23 land.)

- [ ] **Step 8: Commit**

```bash
git add views/character-form.handlebars util/handlebars.js
git commit -m "character-form: gate v1 fields and inject v2-fields container by effective version"
```

---

## Task 22: Routes — htmx partial endpoints for v2 rows

**Files:**
- Modify: `routes/characters.js`

- [ ] **Step 1: Add the four new endpoints**

Add these next to the existing `/class-gear`, `/class-abilities`, `/common-item` route handlers (around line 174–186):

```js
router.get('/quirk', authOptional, (req, res) => {
  res.render('partials/character-quirk', { layout: false, quirk: {} });
});

router.get('/accessory', authOptional, (req, res) => {
  res.render('partials/character-accessory', { layout: false, accessory: {} });
});

router.get('/ability-perk', authOptional, (req, res) => {
  const abilityId = req.query.ability_id;
  const position = Number(req.query.position) || 0;
  if (!abilityId) return res.status(400).send('ability_id required');
  res.render('partials/character-ability-perk', {
    layout: false,
    perk: { text: '', compounds_with: null },
    abilityId,
    position,
    siblingPerks: []
  });
});
```

- [ ] **Step 2: Verify in the browser**

Run: `bun run dev`
1. From the character form, paste `/characters/quirk` directly into the address bar — confirm it returns a small chunk of HTML (one row), not an error page.
2. Same for `/characters/accessory`.
3. `/characters/ability-perk?ability_id=any-uuid&position=0` — confirm it returns one perk row.

- [ ] **Step 3: Commit**

```bash
git add routes/characters.js
git commit -m "Add htmx partial endpoints for v2 quirk/accessory/perk rows"
```

---

## Task 23: Routes — `/characters/version-fields` fragment endpoint

**Files:**
- Modify: `routes/characters.js`

- [ ] **Step 1: Add the endpoint**

```js
router.get('/version-fields', authOptional, async (req, res) => {
  const classId = req.query.class_id;
  let effectiveVersion = 'v1';
  if (classId) {
    try {
      const { data: cls } = await getClass(classId, res.locals.supabase);
      if (cls && cls.rules_version === 'v2') effectiveVersion = 'v2';
    } catch (_) {}
  }

  if (effectiveVersion !== 'v2') {
    // Return an empty container so the swap target stays present for future
    // version changes within the same form session.
    return res.send('<div id="v2-fields-container"></div>');
  }

  res.render('partials/character-v2-fields', {
    layout: false,
    // No existing character context yet (this is the change-on-select path);
    // render with an empty character so the v2 fields show as blank rows.
    character: { quirks: [], accessories: [], conduit_credits: 0, ability_perks: [], abilities: [] }
  });
});
```

- [ ] **Step 2: Verify in the browser**

Run: `bun run dev`
1. Open `/characters/new`. Open dev tools network tab.
2. Change the class select to a v1 class — confirm a request hits `/characters/version-fields?class_id=...` and the response is the empty container.
3. (Defer the v2 selection test until at least one v2 class exists in your DB; an admin can fork a class via the existing `dup_class` flow to set this up.)

- [ ] **Step 3: Commit**

```bash
git add routes/characters.js
git commit -m "Add /characters/version-fields endpoint for class-change form swap"
```

---

## Task 24: Routes — map form payload into the `ability_perks` array

**Files:**
- Modify: `routes/characters.js`

The form submits parallel arrays (`ability_perk_class_ability_id[]`, `ability_perk_text[]`, …); the model expects a single `ability_perks: [{...}]` array.

- [ ] **Step 1: Add a small helper in `routes/characters.js`**

Near the top of the file, after imports:

```js
const asArray = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));

const collectAbilityPerks = (body) => {
  const ids   = asArray(body.ability_perk_class_ability_id);
  const texts = asArray(body.ability_perk_text);
  const pos   = asArray(body.ability_perk_position);
  const cw    = asArray(body.ability_perk_compounds_with);
  const n = Math.max(ids.length, texts.length, pos.length, cw.length);
  const perks = [];
  for (let i = 0; i < n; i++) {
    const id = ids[i]; const text = texts[i];
    if (!id || !text) continue;
    perks.push({
      class_ability_id: id,
      text: String(text),
      position: Number(pos[i]) || i,
      compounds_with: cw[i] || null
    });
  }
  return perks;
};

const collectNamed = (body, nameKey, descKey) => {
  const names = asArray(body[nameKey]);
  const descs = asArray(body[descKey]);
  const out = [];
  for (let i = 0; i < names.length; i++) {
    const name = (names[i] || '').toString().trim();
    if (!name) continue;
    const desc = (descs[i] || '').toString().trim();
    out.push(desc ? { name, description: desc } : { name });
  }
  return out;
};
```

- [ ] **Step 2: Massage the body in both POST and PUT handlers**

In `router.post('/', ...)` (around line 156) and `router.put('/:id/:name?', ...)` (around line 465), just after `parseImageCrop` and before the model call, add:

```js
  req.body.ability_perks = collectAbilityPerks(req.body);
  req.body.quirks = collectNamed(req.body, 'quirk_name', 'quirk_description');
  req.body.accessories = collectNamed(req.body, 'accessory_name', 'accessory_description');
  // Strip the parallel arrays so they don't reach Supabase as unknown columns.
  delete req.body.ability_perk_class_ability_id;
  delete req.body.ability_perk_text;
  delete req.body.ability_perk_position;
  delete req.body.ability_perk_compounds_with;
  delete req.body.quirk_name;
  delete req.body.quirk_description;
  delete req.body.accessory_name;
  delete req.body.accessory_description;
```

- [ ] **Step 3: Verify the full create-edit loop in the browser**

Run: `bun run dev` and (with at least one v2 class in your DB):
1. Create a new character, pick a v2 class. Confirm the v2 sections appear.
2. Add a quirk, an accessory, set conduit credits, add two perks on one ability, mark the second as compounding the first.
3. Submit. Confirm the character page renders without errors (the read view is updated in Task 25).
4. Re-open the edit page; confirm all v2 values are present and the compounds-with selection is preserved.

- [ ] **Step 4: Commit**

```bash
git add routes/characters.js
git commit -m "Map form's parallel v2 inputs into model's ability_perks/quirks/accessories"
```

---

## Task 25: Branch `character.handlebars` read view on version

**Files:**
- Modify: `views/character.handlebars`
- Modify: `routes/characters.js` (pass `effectiveVersion` into the view render)

- [ ] **Step 1: Resolve and pass `effectiveVersion` to the view**

In `router.get('/:id/:name?', ...)` (around line 334), where `characterClass` is already fetched, derive `effectiveVersion` from it (defaulting to `'v1'`). In the `res.render('character', { ... })` call, add `effectiveVersion`.

```js
      const effectiveVersion = (characterClass && characterClass.rules_version === 'v2') ? 'v2' : 'v1';

      res.render('character', {
        title: character.name,
        profile,
        character,
        characterClass,
        ownerProfile,
        recentMissions,
        statList,
        authOptional: true,
        effectiveVersion,
        activeNav: 'characters',
        breadcrumbs: [
          { label: 'Characters', href: '/characters' },
          { label: character.name, href: `/characters/${id}/${encodeURIComponent(character.name)}` }
        ]
      });
```

- [ ] **Step 2: Add the version badge in the header**

In `views/character.handlebars`, just after the existing `<h1>` (which already renders the name + deceased tag), add:

```handlebars
{{#if characterClass}}
<p class="subtitle is-6 has-text-grey">
  <span class="tag is-light">{{capitalize characterClass.rules_edition}} {{characterClass.rules_version}}</span>
</p>
{{/if}}
```

- [ ] **Step 3: Gate the v1 perks markdown block on v1 only**

Find the existing `{{#if character.perks}}` block (around line 179). Wrap it:

```handlebars
{{#if (eq effectiveVersion 'v1')}}
  {{#if character.perks}}
  ... existing block ...
  {{/if}}
{{/if}}
```

- [ ] **Step 4: Add v2 sections**

After the existing `Common Items` block and before `Additional Gear`, add:

```handlebars
{{#if (eq effectiveVersion 'v2')}}
  {{#if character.quirks.length}}
  <div class="box">
    <h3 class="title is-4">Quirks</h3>
    <ul>
      {{#each character.quirks}}
      <li><strong>{{this.name}}</strong>{{#if this.description}} — {{this.description}}{{/if}}</li>
      {{/each}}
    </ul>
  </div>
  {{/if}}

  {{#if character.accessories.length}}
  <div class="box">
    <h3 class="title is-4">Accessories</h3>
    <ul>
      {{#each character.accessories}}
      <li><strong>{{this.name}}</strong>{{#if this.description}} — {{this.description}}{{/if}}</li>
      {{/each}}
    </ul>
  </div>
  {{/if}}

  {{#if character.ability_perks.length}}
  <div class="box">
    <h3 class="title is-4">Ability Perks</h3>
    {{#each character.abilities}}
      {{#with (perksForAbility ../character.ability_perks this.id) as |perks|}}
        {{#if perks.length}}
        <h4 class="title is-5">{{capitalize ../this.name}}</h4>
        <ol>
          {{#each perks}}
            <li>
              {{this.text}}
              {{#if this.compounds_with}}<span class="tag is-info is-light ml-2">compounding</span>{{/if}}
            </li>
          {{/each}}
        </ol>
        {{/if}}
      {{/with}}
    {{/each}}
  </div>
  {{/if}}

  {{#if character.conduit_credits}}
  <p class="has-text-grey"><strong>Conduit Credits:</strong> {{character.conduit_credits}}</p>
  {{/if}}
{{/if}}
```

- [ ] **Step 5: Gate `Additional Gear` on v1 only**

Find the existing `{{#if character.additional_gear}}` block (around line 221). Change to:

```handlebars
{{#if (and (eq effectiveVersion 'v1') character.additional_gear)}}
  ... existing block ...
{{/if}}
```

- [ ] **Step 6: Replace the dual V1/V2 level-up hint with single-version copy**

Same pattern as Task 21 Step 4, but in `character.handlebars` around line 47–52.

- [ ] **Step 7: Verify in the browser**

Run: `bun run dev`
1. View a v1 character — confirm no v2 sections appear and the page is unchanged.
2. View a v2 character — confirm the version badge, quirks, accessories, perks, and conduit credits render.

- [ ] **Step 8: Commit**

```bash
git add views/character.handlebars routes/characters.js
git commit -m "character read view: version badge + v2 sections gated by effectiveVersion"
```

---

## Task 26: Update OpenAPI doc for the agent API

**Files:**
- Modify: `docs/custom-gpt-openapi.json`

- [ ] **Step 1: Find the character schema**

Run: `grep -n "\"Character\"\|signature_gear\|ability_perks\|conduit_credits" docs/custom-gpt-openapi.json`
Locate the character response schema (likely `components.schemas.Character` or similar) — confirm which object literal holds `signature_gear` today; new fields belong as siblings of it.

- [ ] **Step 2: Add new fields**

Add these properties to the character schema:

```json
"rules_version": { "type": "string", "enum": ["v1", "v2"] },
"conduit_credits": { "type": "integer", "description": "v2 only" },
"quirks": {
  "type": "array",
  "description": "v2 only",
  "items": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "description": { "type": "string" }
    },
    "required": ["name"]
  }
},
"accessories": {
  "type": "array",
  "description": "v2 only",
  "items": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "description": { "type": "string" }
    },
    "required": ["name"]
  }
},
"ability_perks": {
  "type": "array",
  "description": "v2 only. Each item is at most 25 words, up to 5 per class_ability_id.",
  "items": {
    "type": "object",
    "properties": {
      "class_ability_id": { "type": "string", "format": "uuid" },
      "text": { "type": "string" },
      "position": { "type": "integer" },
      "compounds_with": { "type": "string", "format": "uuid", "nullable": true }
    },
    "required": ["class_ability_id", "text"]
  }
}
```

- [ ] **Step 3: Sanity-check valid JSON**

Run: `bun -e "JSON.parse(require('fs').readFileSync('docs/custom-gpt-openapi.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add docs/custom-gpt-openapi.json
git commit -m "OpenAPI: document v2 character fields (rules_version, conduit_credits, quirks, accessories, ability_perks)"
```

---

## Task 27: Full test suite + manual smoke

**Files:**
- (none)

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: 0 failures. If any unrelated tests fail, surface them to the user before continuing.

- [ ] **Step 2: Manual smoke test in the browser**

Run: `bun run dev` and walk through:
1. **v1 character (existing)**: open `/characters/<v1-id>` and `/characters/<v1-id>/edit`. Confirm zero visible change vs. before this work (no v2 sections, no badge change).
2. **v1 character (new)**: create one with a v1 class; same expectation.
3. **v2 character**: create one with a v2 class. Add quirks, accessory, conduit credits, perks (including a compounding one), submit.
4. Re-open and confirm round-trip.
5. Edit the v2 character to point at a v1 class — confirm the v2 sections disappear and v1 perks textarea appears. (Hidden v2 data stays in the DB.)
6. Edit it back to v2 — confirm v2 sections re-appear with the previously stored data.
7. Hit `/api/agent/characters/<v1-id>` and confirm the payload has `rules_version: "v1"` and no v2 keys.
8. Hit `/api/agent/characters/<v2-id>` and confirm the v2 keys are present.

- [ ] **Step 3: Final commit if any cleanup was needed**

```bash
git status
# If anything is dirty, commit with a "Misc cleanup" message.
```

---

## Self-review notes

- **Spec coverage:** every decision in the spec maps to a task (migrations 1–3, version helper 8, drop-on-v1 9, persist v2 fields 10, perks 11–12, serializer 13, form helpers 14, route wiring 15+22+23+24, form templates 16–21, read view 25, OpenAPI 26, smoke 27).
- **No placeholders:** every step has concrete code or commands.
- **Type consistency:** the form submits `ability_perk_*[]` parallel arrays → `collectAbilityPerks` → `ability_perks: [{class_ability_id, text, position, compounds_with}]` → `normalizeAbilityPerks` (same shape) → `setCharacterPerks` (writes `character_perks` rows with the same column names). `compounds_with` on the wire can be either a UUID (existing) or `position-N` sentinel (new), and `setCharacterPerks` resolves both. `effectiveVersion` is the string the templates and routes pass around; `effectiveRulesVersion` is the helper that produces it (model-side function name, Handlebars helper name `effectiveRulesVersion` — same name in two registries, doesn't collide).
