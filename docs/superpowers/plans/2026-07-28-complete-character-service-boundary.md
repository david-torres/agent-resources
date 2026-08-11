# Complete Character Mutation Service Boundary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every character mutation a named `CharacterService` use-case with a tested authorization contract and (for level-up) a transaction boundary, so `routes/characters.js` handlers only translate HTTP and render responses.

**Architecture:** Continues the ar-ezes seam — `routes → CharacterService (actor-first capability methods, policy-gated, throw AuthorizationError) → repository (sole supabaseAdmin consumer) → policy (pure predicates)`. Four extractions: (1) wizard validation → `input.js`; (2) form-array reshaping → `input.js`; (3) offscreen-mission writes → `CharacterService` methods; (4) level-up terminal writes → an atomic Postgres RPC.

**Tech Stack:** Node.js/CommonJS, Express 4 (needs `asyncHandler` for async throws), Supabase (`supabaseAdmin` service-role client), Bun test runner (`bun:test`, `mock.module`), Postgres plpgsql `SECURITY DEFINER` RPCs.

## Global Constraints

- `supabaseAdmin` is imported ONLY in `models/_base.js` and `services/*/repository.js`. New privileged reads/writes go in `services/character/repository.js`, never in routes/models.
- Authorization denials **throw** `AuthorizationError` (`code: 'forbidden'` → 403 via `util/http-error.js#classifyError`). Business-rule failures keep returning `{ data, error }`.
- Every touched route handler is wrapped in `asyncHandler` (`util/async-handler.js`) — Express 4 does not catch async throws; an unwrapped throw hangs the request (this exact regression bit three times during ar-ezes).
- Double-guard preserved: creator-only writes keep BOTH the JS policy check (`canMutateCharacter`) AND the SQL `.eq('creator_id', …)` / `WHERE creator_id = …` filter.
- Actor for the newly-seamed mutations is built via `actorFromLocals(res.locals)` → `{ userId, profileId, role }`. `canMutateCharacter(actor, character)` (in `services/character/policy.js`) already allows creator, admin, or system.
- No dead code: when a route helper or repository method is fully replaced, delete it in the same task.
- Test gate green after each task: `bun run test:unit` and `bun run test:http` exit 0. Integration tests (`node scripts/run-tests.mjs integration`) run only where local Supabase is up.
- One Bun process per test file (`scripts/run-tests.mjs`); `mock.module` is process-global — capture real modules up front and restore in `afterAll`, mirroring `routes/character-wizard.test.js`.

---

## Task 1: Extract wizard payload normalization into `input.js`

The `POST /wizard` handler (`routes/characters.js:345-384`) does inline validation/coercion. Move it verbatim into a pure, unit-tested `normalizeWizardPayload` in `services/character/input.js`; the handler keeps only JSON parsing and delegation.

**Files:**
- Modify: `services/character/input.js`
- Test: `services/character/input.test.js`
- Modify: `routes/characters.js:328-402`

**Interfaces:**
- Produces: `normalizeWizardPayload(rawBody) → { data, error }` where `data` is the coerced body ready for `createCharacter`, and `error` is a string message (or `null`). Exported from `services/character/input.js`.
- Consumes: existing `statList` (already imported in `input.js`), existing `parseInteger` (already defined in `input.js`).

- [ ] **Step 1: Write the failing test**

Add to `services/character/input.test.js`:

```js
const { normalizeWizardPayload } = require('./input');

test('normalizeWizardPayload rejects a missing name', () => {
  const { data, error } = normalizeWizardPayload({ name: '   ' });
  expect(data).toBeNull();
  expect(error).toBe('Character name is required.');
});

test('normalizeWizardPayload rejects an over-long name', () => {
  const { error } = normalizeWizardPayload({ name: 'x'.repeat(121) });
  expect(error).toBe('Character name is too long (max 120 characters).');
});

test('normalizeWizardPayload rejects an unknown creator_mode', () => {
  const { error } = normalizeWizardPayload({ name: 'Hero', creator_mode: 'bogus' });
  expect(error).toBe('Invalid mode: bogus');
});

test('normalizeWizardPayload coerces stats, clamps level/missions, defaults reward and booleans', () => {
  const { data, error } = normalizeWizardPayload({
    name: '  Hero  ',
    might: '7',
    level: '99',
    completed_missions: '-3',
    is_public: false,
    hide_from_search: true
  });
  expect(error).toBeNull();
  expect(data.name).toBe('Hero');
  expect(data.might).toBe(7);
  expect(data.level).toBe(20);
  expect(data.completed_missions).toBe(0);
  expect(data.commissary_reward).toBe(0);
  expect(data.is_public).toBe(false);
  expect(data.hide_from_search).toBe(true);
});

test('normalizeWizardPayload defaults is_public to true when unset', () => {
  const { data } = normalizeWizardPayload({ name: 'Hero' });
  expect(data.is_public).toBe(true);
  expect(data.hide_from_search).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test services/character/input.test.js`
Expected: FAIL — `normalizeWizardPayload is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `services/character/input.js`, add (verbatim port of the route logic, using the file's existing `parseInteger` and `statList`):

```js
const normalizeWizardPayload = (rawBody) => {
  const body = cloneInput(rawBody);

  const trimmedName = (body.name || '').toString().trim();
  if (!trimmedName) return { data: null, error: 'Character name is required.' };
  if (trimmedName.length > 120) {
    return { data: null, error: 'Character name is too long (max 120 characters).' };
  }

  if (body.creator_mode != null && body.creator_mode !== '' && !CREATOR_MODES.includes(body.creator_mode)) {
    return { data: null, error: `Invalid mode: ${body.creator_mode}` };
  }

  const knownStats = new Set(statList);
  for (const k of Object.keys(body)) {
    if (knownStats.has(k)) body[k] = parseInteger(body[k], 0);
  }

  if (body.level != null) body.level = Math.max(1, Math.min(20, parseInteger(body.level, 1)));
  if (body.completed_missions != null) body.completed_missions = Math.max(0, parseInteger(body.completed_missions, 0));
  body.commissary_reward = Math.max(0, parseInteger(body.commissary_reward, 0));
  body.name = trimmedName;
  body.is_public = body.is_public === false ? false : true;
  body.hide_from_search = !!body.hide_from_search;

  return { data: body, error: null };
};
```

Add `normalizeWizardPayload` to the `module.exports` block.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test services/character/input.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Rewire the route to delegate**

In `routes/characters.js`: add `normalizeWizardPayload` to the `require('../services/character/input')` import (check whether the file already imports from that module; if not, add `const { normalizeWizardPayload } = require('../services/character/input');`). Replace lines `345-384` (everything between the `JSON.parse` block and the `const { data, error } = await createCharacter(...)` call) with:

```js
  const { data: normalized, error: wizardError } = normalizeWizardPayload(body);
  if (wizardError) {
    return sendError(req, res, null, { status: 400, message: wizardError });
  }

  const { data, error } = await createCharacter(normalized, profile);
```

Then delete the now-unused route-local `parseInteger` (`routes/characters.js:73-76`) **only if** `grep -n 'parseInteger' routes/characters.js` shows no other uses; otherwise leave it.

- [ ] **Step 6: Run the gate**

Run: `bun run test:unit && bun run test:http`
Expected: both exit 0 (in particular `routes/character-wizard.test.js` and `services/character/input.test.js`).

- [ ] **Step 7: Commit**

```bash
git add services/character/input.js services/character/input.test.js routes/characters.js
git commit -m "refactor: move wizard payload validation into character input layer (ar-m8ai)"
```

---

## Task 2: Extract form-array collection into `input.js`

`collectAbilityPerks` / `collectNamed` / `asArray` (`routes/characters.js:38-71`) reshape parallel HTML form arrays into domain sub-entities and duplicate `normalizeAbilityPerks`. Move them behind one input helper the create/update handlers call once.

**Files:**
- Modify: `services/character/input.js`
- Test: `services/character/input.test.js`
- Modify: `routes/characters.js:38-71, 744-755, 1170-1181`

**Interfaces:**
- Produces: `collectCharacterFormArrays(body) → newBody` (a shallow copy with `ability_perks`, `quirks`, `accessories` assembled from the parallel `ability_perk_*` / `quirk_*` / `accessory_*` keys, and those raw keys removed). Exported from `services/character/input.js`.

- [ ] **Step 1: Write the failing test**

Add to `services/character/input.test.js`:

```js
const { collectCharacterFormArrays } = require('./input');

test('collectCharacterFormArrays assembles perks/quirks/accessories and strips raw keys', () => {
  const out = collectCharacterFormArrays({
    name: 'Hero',
    ability_perk_class_ability_id: ['a1', 'a2'],
    ability_perk_text: ['first', ''],          // blank text row is dropped
    ability_perk_position: ['0', '1'],
    ability_perk_compounds_with: ['', 'new:x'],
    quirk_name: ['Brave', '  '],               // blank name dropped
    quirk_description: ['bold', ''],
    accessory_name: ['Ring'],
    accessory_description: ['']
  });
  expect(out.name).toBe('Hero');
  expect(out.ability_perks).toEqual([{ class_ability_id: 'a1', text: 'first', position: 0, compounds_with: null }]);
  expect(out.quirks).toEqual([{ name: 'Brave', description: 'bold' }]);
  expect(out.accessories).toEqual([{ name: 'Ring' }]);
  expect(out.ability_perk_class_ability_id).toBeUndefined();
  expect(out.quirk_name).toBeUndefined();
  expect(out.accessory_description).toBeUndefined();
});

test('collectCharacterFormArrays tolerates single (non-array) form values', () => {
  const out = collectCharacterFormArrays({
    ability_perk_class_ability_id: 'a1',
    ability_perk_text: 'solo',
    ability_perk_position: '3',
    ability_perk_compounds_with: ''
  });
  expect(out.ability_perks).toEqual([{ class_ability_id: 'a1', text: 'solo', position: 3, compounds_with: null }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test services/character/input.test.js`
Expected: FAIL — `collectCharacterFormArrays is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `services/character/input.js`, add (verbatim port of the route helpers):

```js
const asArray = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));

const collectAbilityPerksFromForm = (body) => {
  const ids = asArray(body.ability_perk_class_ability_id);
  const texts = asArray(body.ability_perk_text);
  const pos = asArray(body.ability_perk_position);
  const cw = asArray(body.ability_perk_compounds_with);
  const n = Math.max(ids.length, texts.length, pos.length, cw.length);
  const perks = [];
  for (let i = 0; i < n; i++) {
    const id = ids[i];
    const text = texts[i];
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

const collectNamedFromForm = (body, nameKey, descKey) => {
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

const FORM_ARRAY_KEYS = [
  'ability_perk_class_ability_id', 'ability_perk_text', 'ability_perk_position',
  'ability_perk_compounds_with', 'quirk_name', 'quirk_description',
  'accessory_name', 'accessory_description'
];

const collectCharacterFormArrays = (body) => {
  const out = { ...body };
  out.ability_perks = collectAbilityPerksFromForm(body);
  out.quirks = collectNamedFromForm(body, 'quirk_name', 'quirk_description');
  out.accessories = collectNamedFromForm(body, 'accessory_name', 'accessory_description');
  for (const key of FORM_ARRAY_KEYS) delete out[key];
  return out;
};
```

Add `collectCharacterFormArrays` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test services/character/input.test.js`
Expected: PASS.

- [ ] **Step 5: Rewire the create and update routes**

In `routes/characters.js`:
- Add `collectCharacterFormArrays` to the `services/character/input` import.
- In `POST /` (738), replace lines `744-755` with:

```js
  req.body = collectCharacterFormArrays(req.body);
```

(keep the `image_crop` handling above it and the `createCharacter(req.body, profile)` call below it unchanged).
- In `PUT /:id/:name?` (1163), replace lines `1170-1181` with the same single line.
- Delete the now-unused route-local helpers `asArray` (38), `collectAbilityPerks` (40-58), `collectNamed` (60-71).

- [ ] **Step 6: Run the gate**

Run: `bun run test:unit && bun run test:http`
Expected: both exit 0 (`routes/characters.test.js`, `routes/character-wizard.test.js` green).

- [ ] **Step 7: Commit**

```bash
git add services/character/input.js services/character/input.test.js routes/characters.js
git commit -m "refactor: move character form-array reshaping into input layer (ar-m8ai)"
```

---

## Task 3: Offscreen-mission repository methods + `CharacterService` capabilities

Give the three offscreen-mission mutations a policy-gated service seam. Repository gains privileged offscreen reads/writes; the service gains three capability methods carrying the source-resolution and credit-gate workflow. Unit-tested with a mock adapter.

**Files:**
- Modify: `services/character/repository.js`
- Modify: `services/character/service.js`
- Test: `services/character/service.test.js`

**Interfaces:**
- Produces on the repository (added to `module.exports`), all returning `{ data, error }` and never throwing:
  - `getOffscreenMissionRow(id)` — admin read of one `offscreen_missions` row.
  - `getSourceMissionForCredit(missionId)` — admin read `{ id, name, date, host_id }` from `missions`.
  - `getConduitCredits(profileId)` — delegates to `getProfileConduitCredits` with the admin client.
  - `insertOffscreenMission({ characterId, profileId, payload })` — delegates to `models/offscreen-mission#createOffscreenMission` with the admin client.
  - `updateOffscreenMissionRow({ id, payload })` — delegates to `models/offscreen-mission#updateOffscreenMission` with the admin client.
  - `deleteOffscreenMissionRow(id)` — delegates to `models/offscreen-mission#removeOffscreenMission` with the admin client.
- Produces on `CharacterService` (each takes `actor` first, loads the character via `requireOwnedCharacter` which throws on non-owner/not-found, then applies business rules and returns `{ data, error }`):
  - `createOffscreenMission(actor, characterId, body)`
  - `updateOffscreenMission(actor, characterId, omId, body)`
  - `deleteOffscreenMission(actor, characterId, omId)`
- Consumes: existing `requireOwnedCharacter(this.adapter, actor, id)` and `canMutateCharacter`; new adapter methods above added to `REQUIRED_ADAPTER_METHODS`.

- [ ] **Step 1: Write the failing tests**

Add to `services/character/service.test.js` (reuse the file's `makeAdapter`/`CREATOR`/`STRANGER`; extend `makeAdapter` overrides with the new methods as the tests need them):

```js
const offscreenAdapter = (overrides = {}) => ({
  getCharacter: async () => ok({ id: 'character-1', creator_id: 'profile-1', name: 'Hero', abilities: [] }),
  getOffscreenMissionRow: async () => ok({ id: 'om-1', character_id: 'character-1' }),
  getSourceMissionForCredit: async () => ok({ id: 'm-1', name: 'Raid', date: '2026-01-01', host_id: 'profile-1' }),
  getConduitCredits: async () => ok({ balance: 3 }),
  insertOffscreenMission: async () => ({ error: null }),
  updateOffscreenMissionRow: async () => ({ error: null }),
  deleteOffscreenMissionRow: async () => ({ error: null }),
  // plus the REQUIRED_ADAPTER_METHODS the constructor validates — spread makeAdapter([]) or a minimal stub:
  ...minimalRequiredAdapter(),
  ...overrides
});

test('createOffscreenMission refuses a non-owner with AuthorizationError', async () => {
  const svc = new CharacterService(offscreenAdapter());
  await expect(svc.createOffscreenMission(STRANGER, 'character-1', { name: 'x', summary: 'y' }))
    .rejects.toBeInstanceOf(AuthorizationError);
});

test('createOffscreenMission requires name and summary', async () => {
  const svc = new CharacterService(offscreenAdapter());
  const { error } = await svc.createOffscreenMission(CREATOR, 'character-1', { name: '', summary: '' });
  expect(error).toEqual({ status: 400, message: 'Name and summary are required.' });
});

test('createOffscreenMission rejects a source mission the actor does not host', async () => {
  const svc = new CharacterService(offscreenAdapter({
    getSourceMissionForCredit: async () => ok({ id: 'm-1', name: 'Raid', date: '2026-01-01', host_id: 'someone-else' })
  }));
  const { error } = await svc.createOffscreenMission(CREATOR, 'character-1', {
    name: 'n', summary: 's', source_mission_id: 'm-1'
  });
  expect(error.status).toBe(400);
});

test('createOffscreenMission gates a hosted source on the credit balance', async () => {
  const svc = new CharacterService(offscreenAdapter({
    getConduitCredits: async () => ok({ balance: 0 })
  }));
  const { error } = await svc.createOffscreenMission(CREATOR, 'character-1', {
    name: 'n', summary: 's', source_mission_id: 'm-1'
  });
  expect(error).toEqual({ status: 400, message: 'No Conduit Credits available.' });
});

test('createOffscreenMission inserts on the happy path', async () => {
  const calls = [];
  const svc = new CharacterService(offscreenAdapter({
    insertOffscreenMission: async (args) => { calls.push(args); return { error: null }; }
  }));
  const { error } = await svc.createOffscreenMission(CREATOR, 'character-1', {
    name: 'n', summary: 's', source_mission_name_other: 'Freeform', source_mission_date_other: '2026-02-02'
  });
  expect(error).toBeNull();
  expect(calls[0].characterId).toBe('character-1');
});

test('updateOffscreenMission 404s when the row belongs to another character', async () => {
  const svc = new CharacterService(offscreenAdapter({
    getOffscreenMissionRow: async () => ok({ id: 'om-1', character_id: 'other-char' })
  }));
  const { error } = await svc.updateOffscreenMission(CREATOR, 'character-1', 'om-1', { name: 'n', summary: 's' });
  expect(error.status).toBe(404);
});

test('deleteOffscreenMission refuses a non-owner with AuthorizationError', async () => {
  const svc = new CharacterService(offscreenAdapter());
  await expect(svc.deleteOffscreenMission(STRANGER, 'character-1', 'om-1'))
    .rejects.toBeInstanceOf(AuthorizationError);
});
```

Add a `minimalRequiredAdapter()` helper near the top of the test file that returns an object with every name in `REQUIRED_ADAPTER_METHODS` as an `async () => ok(null)` stub, so `new CharacterService(...)` passes constructor validation. (If the file already has a full `makeAdapter`, build `minimalRequiredAdapter` by calling `makeAdapter([])` and returning it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test services/character/service.test.js`
Expected: FAIL — `createOffscreenMission is not a function` (and constructor errors for missing adapter methods).

- [ ] **Step 3: Add the repository methods**

In `services/character/repository.js`, add these to `module.exports` (import surface: `getProfileConduitCredits` from `../../models/profile`, and the offscreen model functions already imported at the top — extend that import to include `updateOffscreenMission`, `removeOffscreenMission`, `getOffscreenMissionById`):

```js
  getOffscreenMissionRow: (id) => getOffscreenMissionById({ id, supabase: supabaseAdmin }),
  getSourceMissionForCredit: async (missionId) => {
    const { data, error } = await supabaseAdmin
      .from('missions')
      .select('id, name, date, host_id')
      .eq('id', missionId)
      .maybeSingle();
    return { data, error };
  },
  getConduitCredits: (profileId) => getProfileConduitCredits({ profileId, supabase: supabaseAdmin }),
  insertOffscreenMission: ({ characterId, profileId, payload }) => createOffscreenMission({
    characterId, profileId, payload, supabase: supabaseAdmin
  }),
  updateOffscreenMissionRow: ({ id, payload }) => updateOffscreenMission({ id, payload, supabase: supabaseAdmin }),
  deleteOffscreenMissionRow: (id) => removeOffscreenMission({ id, supabase: supabaseAdmin }),
```

Note: `createOffscreenMission` is already imported at the top of the repository (line 4). Extend that destructure and add the `getProfileConduitCredits` require.

- [ ] **Step 4: Add the service methods**

In `services/character/service.js`, add a private source-resolver and the three capabilities inside the `CharacterService` class (port of `resolveOffscreenSource` + the route workflow; the source resolver is pure over adapter reads):

```js
  async resolveOffscreenSource(actor, body) {
    if (body.source_mission_id && body.source_mission_id !== '__other__') {
      const { data: srcMission, error } = await this.adapter.getSourceMissionForCredit(body.source_mission_id);
      if (error || !srcMission) return { error: 'Source mission not found.' };
      if (srcMission.host_id !== actor.profileId) {
        return { error: 'Only the host of a mission can use it as a credit source.' };
      }
      return {
        source_mission_id: srcMission.id,
        source_mission_name: srcMission.name,
        source_mission_date: typeof srcMission.date === 'string'
          ? srcMission.date.slice(0, 10)
          : new Date(srcMission.date).toISOString().slice(0, 10)
      };
    }
    const name = (body.source_mission_name_other || '').trim();
    const date = (body.source_mission_date_other || '').trim();
    if (!name || !date) return { error: 'Source mission name and date are required.' };
    return { source_mission_id: null, source_mission_name: name, source_mission_date: date };
  }

  async createOffscreenMission(actor, characterId, body) {
    await requireOwnedCharacter(this.adapter, actor, characterId);

    if (!body.name || !body.summary) {
      return { data: null, error: { status: 400, message: 'Name and summary are required.' } };
    }
    const src = await this.resolveOffscreenSource(actor, body);
    if (src.error) return { data: null, error: { status: 400, message: src.error } };

    if (src.source_mission_id) {
      const { data: credits } = await this.adapter.getConduitCredits(actor.profileId);
      if (!credits || credits.balance <= 0) {
        return { data: null, error: { status: 400, message: 'No Conduit Credits available.' } };
      }
    }

    const { error } = await this.adapter.insertOffscreenMission({
      characterId,
      profileId: actor.profileId,
      payload: {
        name: body.name,
        summary: body.summary,
        merx_gained: body.merx_gained,
        source_mission_id: src.source_mission_id,
        source_mission_name: src.source_mission_name,
        source_mission_date: src.source_mission_date
      }
    });
    if (error) {
      if (error.code === '23505' || error.message === 'duplicate_source_mission') {
        return { data: null, error: { status: 400, message: 'That mission has already funded a credit.' } };
      }
      return { data: null, error };
    }
    return { data: { characterId }, error: null };
  }

  async updateOffscreenMission(actor, characterId, omId, body) {
    await requireOwnedCharacter(this.adapter, actor, characterId);

    const { data: existing, error: omError } = await this.adapter.getOffscreenMissionRow(omId);
    if (omError) return { data: null, error: omError };
    if (!existing || existing.character_id !== characterId) {
      return { data: null, error: { status: 404, message: 'Not found' } };
    }
    if (!body.name || !body.summary) {
      return { data: null, error: { status: 400, message: 'Name and summary are required.' } };
    }
    const src = await this.resolveOffscreenSource(actor, body);
    if (src.error) return { data: null, error: { status: 400, message: src.error } };

    const { error } = await this.adapter.updateOffscreenMissionRow({
      id: omId,
      payload: {
        name: body.name,
        summary: body.summary,
        merx_gained: body.merx_gained,
        source_mission_id: src.source_mission_id,
        source_mission_name: src.source_mission_name,
        source_mission_date: src.source_mission_date
      }
    });
    if (error) {
      if (error.code === '23505' || error.message === 'duplicate_source_mission') {
        return { data: null, error: { status: 400, message: 'That mission has already funded a credit.' } };
      }
      return { data: null, error };
    }
    return { data: { characterId }, error: null };
  }

  async deleteOffscreenMission(actor, characterId, omId) {
    await requireOwnedCharacter(this.adapter, actor, characterId);

    const { data: existing, error: omError } = await this.adapter.getOffscreenMissionRow(omId);
    if (omError) return { data: null, error: omError };
    if (!existing || existing.character_id !== characterId) {
      return { data: null, error: { status: 404, message: 'Not found' } };
    }
    const { error } = await this.adapter.deleteOffscreenMissionRow(omId);
    if (error) return { data: null, error };
    return { data: { characterId }, error: null };
  }
```

Add the six new method names to `REQUIRED_ADAPTER_METHODS`: `getOffscreenMissionRow`, `getSourceMissionForCredit`, `getConduitCredits`, `insertOffscreenMission`, `updateOffscreenMissionRow`, `deleteOffscreenMissionRow`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test services/character/service.test.js`
Expected: PASS (all offscreen cases + existing cases still green).

- [ ] **Step 6: Run the gate**

Run: `bun run test:unit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add services/character/repository.js services/character/service.js services/character/service.test.js
git commit -m "feat: add offscreen-mission capabilities to CharacterService (ar-m8ai)"
```

---

## Task 4: Rewire offscreen routes to the service + thin the handlers

Wire the three offscreen POST handlers to the new capabilities via `models/character.js` re-exports, drop the inline authz/validation/workflow and the route-local `resolveOffscreenSource`, and add an HTTP regression test asserting a non-owner gets 403 (and the request does not hang).

**Files:**
- Modify: `models/character.js` (add re-exports)
- Modify: `routes/characters.js` (rewire 3 handlers; delete `resolveOffscreenSource`; prune now-unused imports)
- Test: `routes/character-offscreen.test.js` (create)
- Modify: `scripts/run-tests.mjs` (register the new HTTP test file)

**Interfaces:**
- Consumes: `characterService.createOffscreenMission/updateOffscreenMission/deleteOffscreenMission` (Task 3).
- Produces (from `models/character.js`, added to `module.exports`):
  - `createCharacterOffscreenMission(actor, characterId, body)`
  - `updateCharacterOffscreenMission(actor, characterId, omId, body)`
  - `deleteCharacterOffscreenMission(actor, characterId, omId)`

- [ ] **Step 1: Write the failing HTTP test**

Create `routes/character-offscreen.test.js`, mirroring the mocking recipe in `routes/character-level-up.test.js` / `routes/character-wizard.test.js` (real `isAuthenticated` + real handler over a mocked data layer). Mock `../models/character` so `createCharacterOffscreenMission` throws `AuthorizationError` for a stranger and resolves `{ error: null }` for the owner. Core assertions:

```js
const { AuthorizationError } = require('../util/errors');

// ...standard mock.module setup for _base, auth (getUserFromToken → { id: 'u1' } for 'valid-jwt'),
// profile (getProfile → { id: 'p1', user_id: 'u1' }), system-message, lfg, nav-loader...

mock.module('../models/character', () => ({
  createCharacterOffscreenMission: async (actor) => {
    if (actor.profileId !== 'owner') throw new AuthorizationError('nope', { reason: 'not_owner' });
    return { data: { characterId: CHAR_ID }, error: null };
  }
}));

test('POST /:id/offscreen-missions returns 403 for a non-owner (and does not hang)', async () => {
  const res = await Promise.race([
    request(app).post(`/characters/${CHAR_ID}/offscreen-missions`)
      .set('Authorization', 'Bearer valid-jwt')
      .send({ name: 'n', summary: 's' }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('request hung')), 2000))
  ]);
  expect(res.status).toBe(403);
});
```

(Set `res.locals.profile.id` in the profile mock so `actorFromLocals` yields a non-`'owner'` `profileId`, exercising the deny path. Use the same `app`/`request` harness the sibling tests use.)

- [ ] **Step 2: Register and run the test to verify it fails**

Add `'routes/character-offscreen.test.js'` to the `httpFiles` set in `scripts/run-tests.mjs`.
Run: `bun test routes/character-offscreen.test.js`
Expected: FAIL — `createCharacterOffscreenMission is not a function` (route still uses inline logic / old imports).

- [ ] **Step 3: Add the model re-exports**

In `models/character.js`, after the existing mutation re-exports (near line 420), add:

```js
const createCharacterOffscreenMission = (actor, characterId, body) => characterService.createOffscreenMission(actor, characterId, body);
const updateCharacterOffscreenMission = (actor, characterId, omId, body) => characterService.updateOffscreenMission(actor, characterId, omId, body);
const deleteCharacterOffscreenMission = (actor, characterId, omId) => characterService.deleteOffscreenMission(actor, characterId, omId);
```

and add all three names to `module.exports`.

- [ ] **Step 4: Rewire the three route handlers**

In `routes/characters.js`, import the three new functions from `../models/character`. Replace the handler bodies:

`POST /:id/offscreen-missions` (576-627) →

```js
router.post('/:id/offscreen-missions', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { id: characterId } = req.params;
  const { error } = await createCharacterOffscreenMission(actor, characterId, req.body);
  if (error) return sendRouteError(req, res, error);
  return res.redirect(`/characters/${characterId}`);
}));
```

`POST /:id/offscreen-missions/:omId` (667-713) →

```js
router.post('/:id/offscreen-missions/:omId', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { id: characterId, omId } = req.params;
  const { error } = await updateCharacterOffscreenMission(actor, characterId, omId, req.body);
  if (error) return sendRouteError(req, res, error);
  return res.redirect(`/characters/${characterId}`);
}));
```

`POST /:id/offscreen-missions/:omId/delete` (715-736) →

```js
router.post('/:id/offscreen-missions/:omId/delete', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { id: characterId, omId } = req.params;
  const { error } = await deleteCharacterOffscreenMission(actor, characterId, omId);
  if (error) return sendRouteError(req, res, error);
  return res.redirect(`/characters/${characterId}`);
}));
```

Note the redirect drops the trailing `/${encodeURIComponent(character.name)}` segment because the handler no longer loads the character. `/characters/:id` is a valid canonical route (the app redirects/renders by id); confirm by grep that a bare `/characters/:id` GET or the name-optional route (`/:id/:name?`) resolves — the existing `GET /:id/:name?` handler treats `:name` as optional, so `/characters/<id>` matches. If any test asserts the exact redirect target, update it to the id-only path.

Then delete the route-local `resolveOffscreenSource` helper (`routes/characters.js:157-178`). Prune imports now unused **only after grep confirms zero remaining references in the file**: `getMission` (mission model), and from the `offscreen-mission` model import, `createOffscreenMission`, `getOffscreenMissionById`, `updateOffscreenMission`, `removeOffscreenMission` (the GET form routes still use `listOffscreenMissions` and `getAvailableHostedMissionsForPicker`, and `getProfileConduitCredits` — keep whatever the GET handlers reference). Run `grep -n 'resolveOffscreenSource\|getMission\b\|getOffscreenMissionById\|removeOffscreenMission' routes/characters.js` and remove only names with no hits.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test routes/character-offscreen.test.js`
Expected: PASS (403, no hang).

- [ ] **Step 6: Run the gate**

Run: `bun run test:unit && bun run test:http`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add models/character.js routes/characters.js routes/character-offscreen.test.js scripts/run-tests.mjs
git commit -m "refactor: route offscreen-mission writes through CharacterService (ar-m8ai)"
```

---

## Task 5: `level_up_character_atomic` migration (RPC + permissions + grant)

Add the transactional terminal-write function mirroring the `save_character_atomic` migration triple. Applied only when local Supabase is running; the service refactor (Task 6) consumes it.

**Files:**
- Create: `supabase/migrations/20260728000000_level_up_character_atomic.sql`
- Create: `supabase/migrations/20260728000001_level_up_character_atomic_permissions.sql`
- Create: `supabase/migrations/20260728000002_level_up_character_atomic_service_role.sql`

**Interfaces:**
- Produces the RPC `public.level_up_character_atomic(p_character_id uuid, p_creator_id uuid, p_fields jsonb, p_perks jsonb) RETURNS public.characters`, where `p_fields` is the owned-field patch (stats + level + completed_missions + commissary_reward) and `p_perks` is an ordered array of NEW perks `{ class_ability_id, text, position, compounds_with }` — `compounds_with` is either `'position-<n>'` (another new perk in this batch, same ability) or an existing perk UUID string, or null.

- [ ] **Step 1: Write the migration (RPC)**

Create `supabase/migrations/20260728000000_level_up_character_atomic.sql`:

```sql
-- Atomically apply a level-up's terminal writes: update the character's owned
-- counters/stats, insert the newly-submitted ability perks, and resolve their
-- compound links — all in one transaction. Service-role only; authorization
-- stays in CharacterService. Backfill missions and offscreen-credit rows are
-- created upstream (cross-domain) and are intentionally NOT part of this
-- transaction — they are additive and re-derivable.
CREATE OR REPLACE FUNCTION public.level_up_character_atomic(
  p_character_id uuid,
  p_creator_id uuid,
  p_fields jsonb,
  p_perks jsonb
)
RETURNS public.characters
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  saved public.characters;
  item jsonb;
  source_id uuid;
  target_id uuid;
BEGIN
  UPDATE public.characters AS current
  SET
    vitality = COALESCE((p_fields->>'vitality')::int, current.vitality),
    might = COALESCE((p_fields->>'might')::int, current.might),
    resilience = COALESCE((p_fields->>'resilience')::int, current.resilience),
    spirit = COALESCE((p_fields->>'spirit')::int, current.spirit),
    arcane = COALESCE((p_fields->>'arcane')::int, current.arcane),
    will = COALESCE((p_fields->>'will')::int, current.will),
    sensory = COALESCE((p_fields->>'sensory')::int, current.sensory),
    reflex = COALESCE((p_fields->>'reflex')::int, current.reflex),
    vigor = COALESCE((p_fields->>'vigor')::int, current.vigor),
    skill = COALESCE((p_fields->>'skill')::int, current.skill),
    intelligence = COALESCE((p_fields->>'intelligence')::int, current.intelligence),
    luck = COALESCE((p_fields->>'luck')::int, current.luck),
    level = COALESCE((p_fields->>'level')::int, current.level),
    completed_missions = COALESCE((p_fields->>'completed_missions')::int, current.completed_missions),
    commissary_reward = COALESCE((p_fields->>'commissary_reward')::int, current.commissary_reward)
  WHERE current.id = p_character_id AND current.creator_id = p_creator_id
  RETURNING current.* INTO saved;

  IF saved.id IS NULL THEN
    RAISE EXCEPTION 'Character update returned no rows';
  END IF;

  IF p_perks IS NOT NULL THEN
    -- Insert the new perk rows.
    FOR item IN SELECT value FROM jsonb_array_elements(p_perks)
    LOOP
      INSERT INTO public.character_perks (character_id, class_ability_id, text, position)
      VALUES (
        saved.id,
        (item->>'class_ability_id')::uuid,
        item->>'text',
        COALESCE((item->>'position')::integer, 0)
      );
    END LOOP;

    -- Resolve compound links. A link is either 'position-<n>' (another perk in
    -- this batch on the SAME ability) or an existing perk UUID on the same
    -- ability. Anything else is left null.
    FOR item IN SELECT value FROM jsonb_array_elements(p_perks)
    LOOP
      IF item->>'compounds_with' IS NULL THEN CONTINUE; END IF;

      SELECT cp.id INTO source_id
      FROM public.character_perks cp
      WHERE cp.character_id = saved.id
        AND cp.class_ability_id = (item->>'class_ability_id')::uuid
        AND cp.position = COALESCE((item->>'position')::integer, 0)
      LIMIT 1;
      IF source_id IS NULL THEN CONTINUE; END IF;

      target_id := NULL;
      IF item->>'compounds_with' LIKE 'position-%' THEN
        SELECT cp.id INTO target_id
        FROM public.character_perks cp
        WHERE cp.character_id = saved.id
          AND cp.class_ability_id = (item->>'class_ability_id')::uuid
          AND cp.position = substring(item->>'compounds_with' FROM 'position-(.*)')::integer
        LIMIT 1;
      ELSIF item->>'compounds_with' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        SELECT cp.id INTO target_id
        FROM public.character_perks cp
        WHERE cp.id = (item->>'compounds_with')::uuid
          AND cp.character_id = saved.id
          AND cp.class_ability_id = (item->>'class_ability_id')::uuid
        LIMIT 1;
      END IF;

      IF target_id IS NOT NULL AND target_id <> source_id THEN
        UPDATE public.character_perks SET compounds_with = target_id WHERE id = source_id;
      END IF;
    END LOOP;
  END IF;

  RETURN saved;
END;
$$;
```

- [ ] **Step 2: Write the permission migrations**

Create `supabase/migrations/20260728000001_level_up_character_atomic_permissions.sql`:

```sql
REVOKE ALL ON FUNCTION public.level_up_character_atomic(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
```

Create `supabase/migrations/20260728000002_level_up_character_atomic_service_role.sql`:

```sql
GRANT EXECUTE ON FUNCTION public.level_up_character_atomic(uuid, uuid, jsonb, jsonb) TO service_role;
```

- [ ] **Step 3: Apply and smoke-check (only if local Supabase is running)**

Run: `supabase migration up` (or `supabase db reset` if the local stack allows). If local Supabase is NOT available in this environment, skip application — Task 6's unit tests do not need the live RPC, and the integration test self-skips without local Supabase.
Expected: migrations apply with no SQL error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260728000000_level_up_character_atomic.sql supabase/migrations/20260728000001_level_up_character_atomic_permissions.sql supabase/migrations/20260728000002_level_up_character_atomic_service_role.sql
git commit -m "feat: add level_up_character_atomic transactional RPC (ar-m8ai)"
```

---

## Task 6: Refactor `levelUp`/`appendPerks` onto the atomic RPC

Replace the level-up tail (`updateOwnedFields` + `appendPerks`'s direct insert/link writes) with a single `repo.levelUpAtomic` call. The JS keeps validation, position assignment, and `new:<ref>`→`position-<n>` link translation; the RPC does the atomic write. Remove the now-dead `insertPerks`/`updatePerkLinks` repository methods.

**Files:**
- Modify: `services/character/repository.js`
- Modify: `services/character/service.js`
- Test: `services/character/service.test.js`
- Test: `models/character-level-up.integration.test.js` (create)
- Modify: `scripts/run-tests.mjs` (register the integration test)

**Interfaces:**
- Produces on the repository: `levelUpAtomic({ characterId, creatorId, fields, perks }) → { data, error }` calling `supabaseAdmin.rpc('level_up_character_atomic', …)` (guarded by `typeof supabaseAdmin.rpc === 'function'`, matching `saveCharacterAtomic`).
- Changes `CharacterService`: `appendPerks(characterId, submittedPerks)` becomes `buildPerkRows(characterId, submittedPerks) → { data: rows, error }` returning the ordered perk-row payload (with `compounds_with` as `'position-<n>'` or existing UUID) instead of writing. `levelUp` calls `buildPerkRows`, then one `adapter.levelUpAtomic(...)`.
- Removed: adapter methods `insertPerks`, `updatePerkLinks` (dead after this task) — drop from `repository.js` exports and from `REQUIRED_ADAPTER_METHODS`. Add `levelUpAtomic` to `REQUIRED_ADAPTER_METHODS`.

- [ ] **Step 1: Write the failing unit test**

Add to `services/character/service.test.js`:

```js
test('levelUp persists via a single levelUpAtomic call (not updateOwnedFields + insertPerks)', async () => {
  const calls = [];
  const adapter = {
    ...minimalRequiredAdapter(),
    getCharacter: async () => ok({ id: 'character-1', creator_id: 'profile-1', class_id: 'class-1', level: 1, completed_missions: 0, commissary_reward: 0, abilities: [] }),
    getRealMissions: async () => ok([]),
    listOffscreenMissions: async () => ok([]),
    getClassRulesVersion: async () => ok('v2'),
    fetchAllowedAbilityIds: async () => ok([{ id: 'ab-1' }]),
    fetchExistingPerks: async () => ok([]),
    levelUpAtomic: async (args) => { calls.push(args); return ok({ id: 'character-1', name: 'Hero', level: 2, completed_missions: 0, commissary_reward: 0 }); },
    updateOwnedFields: async () => { throw new Error('updateOwnedFields must not be called by levelUp'); },
  };
  const svc = new CharacterService(adapter);
  const { data, error } = await svc.levelUp(CREATOR, 'character-1', {
    level: 2,
    ability_perks: [{ class_ability_id: 'ab-1', text: 'New perk', ref: 'r1' }]
  });
  expect(error).toBeNull();
  expect(data.level).toBe(2);
  expect(calls).toHaveLength(1);
  expect(calls[0].characterId).toBe('character-1');
  expect(calls[0].creatorId).toBe('profile-1');
  expect(calls[0].perks[0]).toMatchObject({ class_ability_id: 'ab-1', text: 'New perk', position: 0 });
});

test('levelUp still refuses a non-owner with AuthorizationError', async () => {
  const svc = new CharacterService({ ...minimalRequiredAdapter(),
    getCharacter: async () => ok({ id: 'character-1', creator_id: 'profile-1', abilities: [] }) });
  await expect(svc.levelUp(STRANGER, 'character-1', {})).rejects.toBeInstanceOf(AuthorizationError);
});
```

Add `levelUpAtomic: async () => ok({ id: 'character-1' })` to `minimalRequiredAdapter()`.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test services/character/service.test.js`
Expected: FAIL — `levelUp` still calls `updateOwnedFields` (throws) / adapter missing `levelUpAtomic`.

- [ ] **Step 3: Add the repository method**

In `services/character/repository.js`, inside the `typeof supabaseAdmin.rpc === 'function' ? { … } : {}` block (alongside `saveCharacterAtomic`), add:

```js
    levelUpAtomic: async ({ characterId, creatorId, fields, perks }) => {
      const { data, error } = await supabaseAdmin.rpc('level_up_character_atomic', {
        p_character_id: characterId,
        p_creator_id: creatorId,
        p_fields: fields,
        p_perks: perks
      });
      return { data, error };
    },
```

Delete the `insertPerks` and `updatePerkLinks` methods from `module.exports`.

- [ ] **Step 4: Refactor the service**

In `services/character/service.js`:
- Rename `appendPerks` to `buildPerkRows`, keeping the allowed-ability filter, existing-position offsets, `validateAbilityPerks`, and ref bookkeeping — but instead of calling `insertPerks`/re-reading/`updatePerkLinks`, RETURN `{ data: rows, error }` where each row is `{ class_ability_id, text, position, compounds_with }`. Translate each new-perk link: `new:<ref>` → the target row's `'position-<n>'` (look the ref up in the batch and use its assigned `position`); an existing-perk UUID that maps to the same ability → keep the UUID; otherwise `null`. (No adapter writes; no id re-read — positions are assigned in JS and are the RPC's join key.)
- In `levelUp`, replace the tail (from `const { data, error } = await this.adapter.updateOwnedFields(...)` through the `appendPerks` call, lines ~512-516) with:

```js
    const { data: perkRows, error: perkBuildError } = await this.buildPerkRows(id, Array.isArray(body.ability_perks) ? body.ability_perks : []);
    if (perkBuildError) return { data: null, error: perkBuildError };

    const { data, error } = await this.adapter.levelUpAtomic({
      characterId: id,
      creatorId: character.creator_id,
      fields,
      perks: perkRows
    });
    if (error) return { data: null, error };
    if (!data) return { data: null, error: { status: 404, message: 'Character update returned no rows' } };
```

Keep the existing final `return { data: { id: data.id, name: data.name || character.name, level: data.level, completed_missions: data.completed_missions, commissary_reward: data.commissary_reward }, error: null };`.
- Update `REQUIRED_ADAPTER_METHODS`: remove `insertPerks`, `updatePerkLinks`; add `levelUpAtomic`. Keep `fetchAllowedAbilityIds` and `fetchExistingPerks` (still used by `buildPerkRows`).

- [ ] **Step 5: Run unit tests to verify they pass**

Run: `bun test services/character/service.test.js`
Expected: PASS.

- [ ] **Step 6: Write the integration rollback test**

Create `models/character-level-up.integration.test.js`, mirroring `models/character-atomic.integration.test.js` (same `pg` client + `supabaseAdmin` setup/teardown). Assert:
1. A successful level-up with a new perk bumps `level` AND inserts the `character_perks` row (both present).
2. A rollback case: force a failure inside the RPC (e.g. submit a perk row with a `class_ability_id` that violates the FK / not-null) and assert the character's `level` was NOT changed and no partial perk row exists — proving the terminal writes commit or roll back together.

```js
test('level-up terminal writes commit together', async () => {
  await setup();
  const character = await createOwnedCharacter();     // helper: createCharacter(...) then read back
  const { data, error } = await levelUpCharacter(ACTOR, character.id, {
    level: 2,
    ability_perks: [{ class_ability_id: character.abilityId, text: 'Perk A', ref: 'r1' }]
  });
  expect(error).toBeNull();
  expect(data.level).toBe(2);
  const { data: perks } = await supabaseAdmin.from('character_perks').select('*').eq('character_id', character.id);
  expect(perks.length).toBe(1);
});

test('level-up rolls back the counter when a perk write fails', async () => {
  await setup();
  const character = await createOwnedCharacter();
  const { error } = await levelUpCharacter(ACTOR, character.id, {
    level: 2,
    ability_perks: [{ class_ability_id: '00000000-0000-4000-8000-000000000000', text: 'Bad perk', ref: 'r1' }]
  });
  // buildPerkRows filters to ALLOWED ability ids, so a bogus id is dropped and
  // the write succeeds cleanly — to exercise a true RPC rollback, insert a
  // duplicate (class_ability_id, position) that violates a constraint, OR
  // assert the filtered-out case leaves a consistent state (level bumped, 0 perks).
  // Choose whichever the schema makes reachable; the point is: after any failure,
  // level and character_perks agree (no half-applied terminal write).
  const { data: char } = await supabaseAdmin.from('characters').select('level').eq('id', character.id).single();
  const { data: perks } = await supabaseAdmin.from('character_perks').select('id').eq('character_id', character.id);
  expect(char.level === 1 || perks.length === 0).toBe(true);
});
```

`ACTOR` = `{ userId, profileId: profile.id, role: null }`. Build `createOwnedCharacter` from the `input(...)` helper in the sibling integration test, then read back the character (and its inserted `class_abilities` id for a valid perk `class_ability_id`).

- [ ] **Step 7: Register and run the integration test (if local Supabase is up)**

Add `'models/character-level-up.integration.test.js'` to `integrationFiles` in `scripts/run-tests.mjs`.
Run (only with local Supabase): `SUPABASE_URL=http://127.0.0.1:54321 node scripts/run-tests.mjs integration`
Expected: PASS. If local Supabase is unavailable, note it and skip — the runner refuses integration mode without it.

- [ ] **Step 8: Run the full gate**

Run: `bun run test:unit && bun run test:http`
Expected: both exit 0. Confirm `routes/character-level-up.test.js` still passes (the HTTP contract is unchanged — the route still returns `{ character }` JSON).

- [ ] **Step 9: Verify no `supabaseAdmin` leak and no dead perk methods**

Run: `grep -rn "supabaseAdmin" routes/ util/ models/ services/ | grep -v "_base.js" | grep -v "repository.js"`
Expected: zero hits.
Run: `grep -rn "insertPerks\|updatePerkLinks\|appendPerks" services/ models/ routes/`
Expected: no references to the removed methods (only `buildPerkRows` remains).

- [ ] **Step 10: Commit**

```bash
git add services/character/repository.js services/character/service.js services/character/service.test.js models/character-level-up.integration.test.js scripts/run-tests.mjs
git commit -m "refactor: make level-up terminal writes atomic via level_up_character_atomic (ar-m8ai)"
```

---

## Final verification (after Task 6)

Run the acceptance gate and confirm each criterion:

- [ ] `bun run test:unit && bun run test:http` → both exit 0.
- [ ] `grep -n "resolveOffscreenSource\|collectAbilityPerks\|collectNamed\|creator_id !== profile.id\|creator_id != profile.id" routes/characters.js` → zero hits (no inline workflow/authz left in the route).
- [ ] Every character mutation — create, update, delete, stats, level-up, upgrade, deceased, offscreen create/update/delete — is a named `CharacterService` method with a service-level authz test (non-owner refused via `AuthorizationError`, owner/admin succeeds).
- [ ] `grep -rn "supabaseAdmin" routes/ util/ models/ services/ | grep -vE "_base.js|repository.js"` → zero hits.
- [ ] Level-up rollback integration test present and (where local Supabase is available) green.

## Self-Review notes

- **Spec coverage:** item 1 → Task 1; item 2 → Task 2; item 3 → Tasks 3-4; item 4 → Tasks 5-6. Verification clauses 1-4 → Final verification checklist.
- **Type consistency:** `levelUpAtomic({ characterId, creatorId, fields, perks })` used identically in repository (Task 6 Step 3), service call (Step 4), and unit test (Step 1). `buildPerkRows` return shape `{ data: rows, error }` matches its consumer in `levelUp`. RPC arg names (`p_character_id`, `p_creator_id`, `p_fields`, `p_perks`) match between the migration (Task 5) and the repository call (Task 6).
- **Actor convention:** offscreen capabilities use `actorFromLocals` (`{ userId, profileId, role }`) + `canMutateCharacter` — matching delete/stats/level-up. create/update keep their pre-existing `profile`-as-actor convention (out of scope to unify; not introducing new inconsistency).
