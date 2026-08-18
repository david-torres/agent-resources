# First-Time User Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage get-started callout with a path-aware onboarding checklist (new-to-Enclave vs already-playing), backed by a `profiles.onboarding` jsonb column and a `rules_pdfs.free_access` flag that makes the quickstart PDF publicly readable.

**Architecture:** Step completion derives from real data wherever possible (name default, character count, LFG activity, starter-unlock expiry); only non-derivable bits (`path`, `dismissed`, `read_rules`, `redeemed`) live in the jsonb. A pure `computeOnboarding` function produces the card's render model; `loadOnboarding` wraps it with isolated reads; the card is a handlebars partial swapped via htmx POSTs to `/profile/onboarding`.

**Tech Stack:** Express + Handlebars + htmx + Bulma CSS, Supabase (Postgres), bun:test with the `freshRequire` helper for route tests, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-08-17-first-time-onboarding-design.md`

## Global Constraints

- Tests run with `bun test <file>` for a single file; the full unit suite is `bun run test:unit`.
- Route tests MUST use `test/helpers/fresh-require.js` (see `routes/library-unlocks.test.js` for the canonical pattern) — never `mock.module`.
- Model reads/writes return `{ data, error }`; they log and return errors, never throw.
- Onboarding side-writes (`read_rules`, `redeemed`, `dismissed`) are fire-and-forget: `.catch(() => {})`, never blocking the host response.
- The provisioning default profile name is exactly `` `Agent #${user_id}` `` (`services/profile/service.js:59`).
- The starter Advent PDF id is `STARTER_RULES_PDF_ID` from `util/starter-content.js`. `grantStarterUnlocks` is NOT modified.
- Copy rules: path buttons are "I'm new — show me the ropes" / "I already play"; the completed card headline is "You're all set, Agent."
- The old get-started notification block in `views/home.handlebars` is deleted, not kept alongside.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Migration — `profiles.onboarding` and `rules_pdfs.free_access`

**Files:**
- Create: `supabase/migrations/20260817000000_onboarding.sql`

**Interfaces:**
- Produces: `profiles.onboarding jsonb NOT NULL DEFAULT '{}'`; `rules_pdfs.free_access boolean NOT NULL DEFAULT false`. Every later task assumes these columns exist.

Migrations are config, not behavior — no TDD cycle. Consumers are tested in later tasks.

- [ ] **Step 1: Write the migration**

```sql
-- First-time onboarding state and the free-quickstart access flag.
-- profiles.onboarding holds only what real data cannot answer:
--   path: 'new' | 'veteran'   dismissed: bool
--   read_rules: bool          redeemed: bool
ALTER TABLE profiles
    ADD COLUMN onboarding jsonb NOT NULL DEFAULT '{}'::jsonb;

-- A free_access rules PDF is viewable by anyone, signed in or not
-- (the quickstart). All other PDFs keep the unlock requirement.
ALTER TABLE rules_pdfs
    ADD COLUMN free_access boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Verify the SQL parses and applies**

Run: `bun run setup` (idempotent; applies pending migrations) — or, if a local Supabase stack is not configured in this environment, verify with `psql --set ON_ERROR_STOP=1 -f` against a scratch DB if available; otherwise confirm by eyeballing that the file follows the exact `ALTER TABLE ... ADD COLUMN` shape of `supabase/migrations/20260815000001_home_recency.sql` and rely on CI/setup to apply it.
Expected: no errors; re-running is safe because each column is added exactly once (setup skips applied migrations).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260817000000_onboarding.sql
git commit -m "feat: add onboarding jsonb and rules_pdfs.free_access columns"
```

---

### Task 2: `patchOnboarding` model function

**Files:**
- Modify: `models/profile.js` (add function + export)
- Create: `models/profile-onboarding.test.js`

**Interfaces:**
- Consumes: `supabaseAdmin` from `models/_base.js`.
- Produces: `patchOnboarding(userId, patch)` → `Promise<{ data, error }>` where `data` is the merged onboarding object. Shallow-merges `patch` into the current `profiles.onboarding` for the row with that `user_id`. Exported from `models/profile.js`. Used by Tasks 7, 9, 10, 11.

- [ ] **Step 1: Write the failing test**

`models/profile-onboarding.test.js` — follow the `freshRequire` style so the fake `_base` is private to this file:

```js
const { test, expect } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');

// Records the update call; serves a canned current row for the read.
let currentOnboarding = { path: 'new' };
let updateCall = null;

const fakeAdmin = {
  from(table) {
    const chain = {
      select() { return chain; },
      eq(col, val) { chain._eq = { col, val }; return chain; },
      single() {
        return Promise.resolve({ data: { onboarding: currentOnboarding }, error: null });
      },
      update(values) {
        updateCall = { table, values, eq: null };
        const updChain = {
          eq(col, val) { updateCall.eq = { col, val }; return updChain; },
          select() { return updChain; },
          single() { return Promise.resolve({ data: { onboarding: values.onboarding }, error: null }); }
        };
        return updChain;
      }
    };
    return chain;
  }
};

const loadProfileModel = () => freshRequire(require.resolve('../models/profile'), new Map([
  [require.resolve('../models/_base'), {
    supabase: {}, supabaseAdmin: fakeAdmin, createUserClient: () => ({})
  }],
  // profile.js pulls these at require time; inert stand-ins keep the load pure.
  [require.resolve('../services/profile/service'), { profileService: {} }],
  [require.resolve('../services/profile/repository'), { profileRepository: {} }],
  [require.resolve('../util/starter-content'), { STARTER_RULES_PDF_ID: 'starter-pdf', STARTER_CLASS_UNLOCKS: {} }]
]));

test('patchOnboarding shallow-merges the patch into the existing jsonb', async () => {
  currentOnboarding = { path: 'new' };
  updateCall = null;
  const { patchOnboarding } = loadProfileModel();
  const { data, error } = await patchOnboarding('u1', { read_rules: true });
  expect(error).toBeNull();
  expect(data).toEqual({ path: 'new', read_rules: true });
  expect(updateCall.values.onboarding).toEqual({ path: 'new', read_rules: true });
  expect(updateCall.eq).toEqual({ col: 'user_id', val: 'u1' });
});

test('patchOnboarding treats a null current value as an empty object', async () => {
  currentOnboarding = null;
  updateCall = null;
  const { patchOnboarding } = loadProfileModel();
  const { data, error } = await patchOnboarding('u1', { dismissed: true });
  expect(error).toBeNull();
  expect(data).toEqual({ dismissed: true });
});
```

Note for the implementer: before writing the fakes, open `models/profile.js` and check its actual top-of-file `require` list; the `overrides` map must cover each *relative* require it makes (absolute-path keyed), the way `routes/library-unlocks.test.js` does for `routes/library.js`. Adjust the inert stand-ins to whatever it really imports (e.g. if it destructures `{ profileService }` vs default), keeping the two real fakes: `_base.supabaseAdmin` and nothing else.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test models/profile-onboarding.test.js`
Expected: FAIL — `patchOnboarding is not a function` (not exported yet).

- [ ] **Step 3: Implement `patchOnboarding` in `models/profile.js`**

Add near the other profile functions (ensure `supabaseAdmin` is in the `_base` destructure — add it if `profile.js` currently imports only `supabase`):

```js
// Shallow-merge a patch into profiles.onboarding for a user. Admin client:
// these writes happen from fire-and-forget hooks (PDF views, code redemption)
// where no user JWT client is guaranteed, and RLS must not silently eat them.
// Read-merge-write is safe here: one row, one user, negligible contention.
const patchOnboarding = async (userId, patch) => {
  const { data: row, error: readError } = await supabaseAdmin
    .from('profiles')
    .select('onboarding')
    .eq('user_id', userId)
    .single();
  if (readError) {
    console.error('patchOnboarding read failed:', readError);
    return { data: null, error: readError };
  }

  const merged = { ...(row?.onboarding || {}), ...patch };
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ onboarding: merged })
    .eq('user_id', userId)
    .select('onboarding')
    .single();
  if (error) {
    console.error('patchOnboarding write failed:', error);
    return { data: null, error };
  }
  return { data: data.onboarding, error: null };
};
```

Add `patchOnboarding` to the `module.exports` block.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test models/profile-onboarding.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full unit suite to catch fallout**

Run: `bun run test:unit`
Expected: PASS — the new export must not disturb existing profile tests.

- [ ] **Step 6: Commit**

```bash
git add models/profile.js models/profile-onboarding.test.js
git commit -m "feat: add patchOnboarding jsonb merge to profile model"
```

---

### Task 3: `canViewRulesPdf` honors `free_access`

**Files:**
- Modify: `models/rules.js:161-186` (`canViewRulesPdf`)
- Create: `models/rules-free-access.test.js`

**Interfaces:**
- Consumes: `rules_pdfs.free_access` column (Task 1).
- Produces: `canViewRulesPdf(userContext, rulesPdf)` returns `{ data: true }` whenever `rulesPdf.free_access` is truthy (and `storage_path` present) — before any admin/user/unlock check, so signed-out viewers pass. All other behavior unchanged. Used by Task 10.

- [ ] **Step 1: Write the failing test**

The free branch short-circuits before any repository call, so the real module can be required directly (model tests like `models/class-unlock-family.test.js` already require real `./_base`; the unit-test env provides the Supabase env vars).

```js
const { test, expect } = require('bun:test');
const { canViewRulesPdf } = require('./rules');

test('a free_access PDF is viewable with no user at all', async () => {
  const { data, error } = await canViewRulesPdf(
    { userId: null, role: null },
    { id: 'qs', storage_path: 'pdfs/qs.pdf', free_access: true }
  );
  expect(error).toBeNull();
  expect(data).toBe(true);
});

test('a free_access PDF with no stored file is still not viewable', async () => {
  const { data } = await canViewRulesPdf(
    { userId: null, role: null },
    { id: 'qs', storage_path: null, free_access: true }
  );
  expect(data).toBe(false);
});

test('a non-free PDF still refuses a signed-out viewer', async () => {
  const { data } = await canViewRulesPdf(
    { userId: null, role: null },
    { id: 'core', storage_path: 'pdfs/core.pdf', free_access: false }
  );
  expect(data).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test models/rules-free-access.test.js`
Expected: FAIL — first test gets `data: false` (free branch missing). Tests 2 and 3 pass already (existing guards).

- [ ] **Step 3: Add the free branch**

In `canViewRulesPdf`, immediately after the `storage_path` guard and before the admin check:

```js
    if (rulesPdf.free_access) {
        return { data: true, error: null };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test models/rules-free-access.test.js`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add models/rules.js models/rules-free-access.test.js
git commit -m "feat: free_access rules PDFs are viewable without an unlock"
```

---

### Task 4: Admin can mark a PDF free; library list shows it

**Files:**
- Modify: `routes/library.js` (GET `/` canView at ~line 83; POST `/` payload at ~line 276; POST `/:id` updates at ~line 305)
- Modify: `views/library-manage.handlebars` (create form ~line 43, edit form ~line 102)
- Modify: `views/library.handlebars` (tag row ~line 45)
- Test: extend `views/library-manage.test.js`; create `routes/library-free-access-admin.test.js`

**Interfaces:**
- Consumes: `free_access` column (Task 1). `normalizeBoolean` already imported in `routes/library.js`.
- Produces: `free_access` round-trips through the admin create/edit forms; the library list computes `canView = isAdmin || rule.free_access || (!!unlock && !isExpired)` and shows a "Free" tag. `getRulesPdfs` already `select('*')`, so no model change.

- [ ] **Step 1: Write the failing route test**

`routes/library-free-access-admin.test.js` — copy the scaffold of `routes/library-unlocks.test.js` verbatim (same `overrides` map, same express app assembly with the JSON render capture, same `authHeaders`), with these fakes recording writes:

```js
// In the fakeRules object for this file:
let createCall = null;
let updateCall = null;
// ...
  createRulesPdf: async (payload) => { createCall = payload; return { data: payload, error: null }; },
  updateRulesPdf: async (id, updates) => { updateCall = { id, updates }; return { data: updates, error: null }; },
  getRulesPdf: async (id) => ({ data: { id, title: 'Core', edition: 'Advent v1', storage_path: 'p.pdf' }, error: null }),
// and in models/pdf fake: storeRulesPdf: async () => ({ data: { path: 'stored.pdf' }, error: null }),
```

Multipart uploads are awkward in a bare fetch; POST `/:id` without a file exercises the same `free_access` line, so test the edit path:

```js
test('POST /library/:id passes free_access=true through to updateRulesPdf', async () => {
  currentRole = 'admin';
  updateCall = null;
  const res = await fetch(`${baseUrl}/library/some-id`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'title=Core&edition=Advent+v1&is_active=on&free_access=on',
    redirect: 'manual'
  });
  expect(res.status).toBe(302);
  expect(updateCall.updates.free_access).toBe(true);
});

test('POST /library/:id without the checkbox writes free_access=false', async () => {
  currentRole = 'admin';
  updateCall = null;
  const res = await fetch(`${baseUrl}/library/some-id`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'title=Core&edition=Advent+v1&is_active=on',
    redirect: 'manual'
  });
  expect(res.status).toBe(302);
  expect(updateCall.updates.free_access).toBe(false);
});

test('GET /library marks a free PDF viewable for a signed-out visitor', async () => {
  currentRole = 'user';
  // getRulesPdfs fake for this file returns one free row:
  // { id: 'qs', title: 'Quickstart', edition: 'Advent v1', is_active: true, free_access: true, storage_path: 'q.pdf' }
  const res = await fetch(`${baseUrl}/library`); // no auth header
  const { ctx } = await res.json();
  const allRules = ctx.ruleGroups.flatMap(g => [g.primary, ...(g.others || [])].filter(Boolean));
  const quickstart = allRules.find(r => r.id === 'qs');
  expect(quickstart.canView).toBe(true);
});
```

Note for the implementer: `groupRulesVersions` shapes `ruleGroups`; inspect one real `ctx.ruleGroups` entry (log it once) and adjust the flatten accordingly rather than trusting the sketch above — the assertion that matters is `canView === true` for the free row without auth.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test routes/library-free-access-admin.test.js`
Expected: FAIL — `updateCall.updates.free_access` is `undefined`; the signed-out `canView` is `false`.

- [ ] **Step 3: Wire `free_access` through `routes/library.js`**

GET `/` (~line 83):

```js
        const canView = isAdmin || !!rule.free_access || (!!unlock && !isExpired);
```

POST `/` payload (~line 276) — add to `payload`:

```js
        free_access: normalizeBoolean(req.body.free_access, false),
```

POST `/:id` (~line 305) — add to `updates`:

```js
        free_access: normalizeBoolean(req.body.free_access, false),
```

- [ ] **Step 4: Run route tests to verify they pass**

Run: `bun test routes/library-free-access-admin.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing view test, then add the form checkboxes and Free tag**

Extend `views/library-manage.test.js` (follow its existing render pattern) with a test that a rule row with `free_access: true` renders a checked `name="free_access"` checkbox, and the create form contains an unchecked one. Then in `views/library-manage.handlebars`:

Create form, after the `is_active` checkbox field (~line 45):

```handlebars
          <label class="checkbox ml-3">
            <input type="checkbox" name="free_access">
            Free (viewable by anyone, no unlock)
          </label>
```

Edit form, after its `is_active` checkbox (~line 104):

```handlebars
            <label class="checkbox ml-3">
              <input type="checkbox" name="free_access" {{#if this.free_access}}checked{{/if}}>
              Free
            </label>
```

In `views/library.handlebars`, next to the Active/Inactive tag (~line 45), add:

```handlebars
            {{#if this.primary.free_access}}
            <span class="tag is-success is-light">Free</span>
            {{/if}}
```

- [ ] **Step 6: Run the view test and full unit suite**

Run: `bun test views/library-manage.test.js && bun run test:unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add routes/library.js views/library-manage.handlebars views/library.handlebars views/library-manage.test.js routes/library-free-access-admin.test.js
git commit -m "feat: admin free_access flag for rules PDFs, free docs viewable in library"
```

---

### Task 5: Activity queries — `hasAnyGameActivity` and `countCharactersByCreator`

**Files:**
- Modify: `models/lfg.js` (add function + export)
- Modify: `models/character.js` (add function + export)
- Create: `models/onboarding-activity.test.js`

**Interfaces:**
- Produces:
  - `hasAnyGameActivity(profileId, client = supabase)` → `{ data: boolean, error }` — true if the profile hosts any `lfg_posts` row (any date) or has any `lfg_join_requests` row with `status = 'approved'`.
  - `countCharactersByCreator(profileId, client = supabase)` → `{ data: number, error }` — head count of `characters` rows by `creator_id`.
- Consumed by Task 6's `loadOnboarding` deps.

- [ ] **Step 1: Write the failing tests**

`models/onboarding-activity.test.js`, using a recording fake client in the style of `makeRecordingClient` in `models/class-unlock-family.test.js`, but returning `{ count }` shapes (head-count queries resolve `{ count, error }`, not `{ data }`):

```js
const { test, expect } = require('bun:test');
const { hasAnyGameActivity } = require('./lfg');
const { countCharactersByCreator } = require('./character');

// Fake that resolves each table's head-count query with a canned count.
const makeCountClient = (countsByTable) => ({
  from(table) {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      then(onFulfilled, onRejected) {
        return Promise.resolve({ count: countsByTable[table] ?? 0, error: null })
          .then(onFulfilled, onRejected);
      }
    };
    return chain;
  }
});

test('hasAnyGameActivity is true for a host with no joins', async () => {
  const client = makeCountClient({ lfg_posts: 2, lfg_join_requests: 0 });
  const { data, error } = await hasAnyGameActivity('p1', client);
  expect(error).toBeNull();
  expect(data).toBe(true);
});

test('hasAnyGameActivity is true for an approved joiner who never hosted', async () => {
  const client = makeCountClient({ lfg_posts: 0, lfg_join_requests: 1 });
  const { data } = await hasAnyGameActivity('p1', client);
  expect(data).toBe(true);
});

test('hasAnyGameActivity is false with neither', async () => {
  const client = makeCountClient({ lfg_posts: 0, lfg_join_requests: 0 });
  const { data } = await hasAnyGameActivity('p1', client);
  expect(data).toBe(false);
});

test('countCharactersByCreator returns the head count', async () => {
  const client = makeCountClient({ characters: 3 });
  const { data, error } = await countCharactersByCreator('p1', client);
  expect(error).toBeNull();
  expect(data).toBe(3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test models/onboarding-activity.test.js`
Expected: FAIL — neither function is exported.

- [ ] **Step 3: Implement both functions**

In `models/lfg.js` (near `getUpcomingForProfile`, ~line 258):

```js
// Any LFG involvement ever -- hosting a post (past or future) or holding an
// approved join. Head counts only; onboarding needs a boolean, not rows.
const hasAnyGameActivity = async (profileId, client = supabase) => {
  const { count: hosted, error: hostedError } = await client
    .from('lfg_posts')
    .select('id', { count: 'exact', head: true })
    .eq('creator_id', profileId);
  if (hostedError) {
    console.error(hostedError);
    return { data: null, error: hostedError };
  }
  if ((hosted || 0) > 0) return { data: true, error: null };

  const { count: joined, error: joinedError } = await client
    .from('lfg_join_requests')
    .select('lfg_post_id', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('status', 'approved');
  if (joinedError) {
    console.error(joinedError);
    return { data: null, error: joinedError };
  }
  return { data: (joined || 0) > 0, error: null };
};
```

In `models/character.js`:

```js
const countCharactersByCreator = async (profileId, client = supabase) => {
  const { count, error } = await client
    .from('characters')
    .select('id', { count: 'exact', head: true })
    .eq('creator_id', profileId);
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data: count || 0, error: null };
};
```

Add both to their files' `module.exports`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test models/onboarding-activity.test.js && bun run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add models/lfg.js models/character.js models/onboarding-activity.test.js
git commit -m "feat: add game-activity and character-count queries for onboarding"
```

---

### Task 6: The onboarding service — `computeOnboarding` + `loadOnboarding`

**Files:**
- Create: `services/home/onboarding.js`
- Create: `services/home/onboarding.test.js`

**Interfaces:**
- Consumes: `STARTER_RULES_PDF_ID` (`util/starter-content.js`); deps `countCharactersByCreator` (Task 5), `hasAnyGameActivity` (Task 5), `listRulesPdfUnlocksForUser` (`models/rules.js`, returns rows `{ rules_pdf_id, expires_at, unlocked_at }`), `getRulesPdfs` (`models/rules.js`).
- Produces (used by Tasks 7, 8, 9):

```js
// computeOnboarding(inputs) -- pure.
// inputs: {
//   profile: { user_id, name, onboarding },   // onboarding may be undefined
//   hasCharacters: boolean, hasMissions: boolean, inGame: boolean,
//   starterUnlock: { expires_at } | null,     // the STARTER_RULES_PDF_ID unlock row
//   freePdf: { id } | null,                   // first active free_access rules PDF
//   now: Date
// }
// returns: {
//   show, askPath, persistDismiss, path,        // path: 'new'|'veteran'|null
//   nameDone, learnDone, redeemDone, characterDone, gameDone, allDone,
//   adventDaysLeft,                             // integer >= 1, or null
//   adventHref, quickstartHref                  // '/library/<id>/view' or null
// }
//
// loadOnboarding({ profile, client, hasCharacters, hasMissions, now }, deps)
//   -- profile null (signed out): fetches only the free PDF, returns
//      { show: false, persistDismiss: false, quickstartHref }.
//   -- profile.onboarding.dismissed: returns { show: false, persistDismiss: false }
//      with no reads.
//   -- otherwise: fills whichever of hasCharacters/inGame/starterUnlock/freePdf
//      it wasn't handed (hasMissions defaults false when omitted), each read
//      isolated settle-style, then delegates to computeOnboarding.
module.exports = { computeOnboarding, loadOnboarding, defaultDeps };
```

- [ ] **Step 1: Write the failing tests**

`services/home/onboarding.test.js`:

```js
const { test, expect } = require('bun:test');
const { computeOnboarding, loadOnboarding } = require('./onboarding');
const { STARTER_RULES_PDF_ID } = require('../../util/starter-content');

const NOW = new Date('2026-08-17T12:00:00Z');
const base = () => ({
  profile: { user_id: 'u1', name: 'Dave', onboarding: {} },
  hasCharacters: false, hasMissions: false, inGame: false,
  starterUnlock: { expires_at: '2026-09-10T12:00:00Z' },
  freePdf: { id: 'qs-id' },
  now: NOW
});

test('a fresh profile with no path is asked the path question', () => {
  const m = computeOnboarding(base());
  expect(m.show).toBe(true);
  expect(m.askPath).toBe(true);
  expect(m.persistDismiss).toBe(false);
});

test('an account that already has characters is silently dismissed instead of quizzed', () => {
  const m = computeOnboarding({ ...base(), hasCharacters: true });
  expect(m.show).toBe(false);
  expect(m.persistDismiss).toBe(true);
});

test('an account with mission logs is silently dismissed too', () => {
  const m = computeOnboarding({ ...base(), hasMissions: true });
  expect(m.show).toBe(false);
  expect(m.persistDismiss).toBe(true);
});

test('a dismissed profile never shows the card', () => {
  const m = computeOnboarding({ ...base(), profile: { user_id: 'u1', name: 'Dave', onboarding: { dismissed: true } } });
  expect(m.show).toBe(false);
  expect(m.persistDismiss).toBe(false);
});

test('the default provisioning name does not count as name set', () => {
  const m = computeOnboarding({ ...base(), profile: { user_id: 'u1', name: 'Agent #u1', onboarding: { path: 'new' } } });
  expect(m.nameDone).toBe(false);
});

test('a chosen name counts, even one starting with Agent #', () => {
  const m = computeOnboarding({ ...base(), profile: { user_id: 'u1', name: 'Agent #7', onboarding: { path: 'new' } } });
  expect(m.nameDone).toBe(true);
});

test('steps derive on the new path', () => {
  const m = computeOnboarding({
    ...base(),
    profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new', read_rules: true } },
    hasCharacters: true, inGame: false
  });
  expect(m.path).toBe('new');
  expect(m.askPath).toBe(false);
  expect(m.nameDone).toBe(true);
  expect(m.learnDone).toBe(true);
  expect(m.characterDone).toBe(true);
  expect(m.gameDone).toBe(false);
  expect(m.allDone).toBe(false);
});

test('all four done on the veteran path flags allDone and persists the dismissal', () => {
  const m = computeOnboarding({
    ...base(),
    profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'veteran', redeemed: true } },
    hasCharacters: true, inGame: true
  });
  expect(m.allDone).toBe(true);
  expect(m.show).toBe(true);          // renders the "You're all set" state once
  expect(m.persistDismiss).toBe(true); // caller stores dismissed so it never re-renders
});

test('advent days-left counts up from now and links the starter PDF', () => {
  const m = computeOnboarding({ ...base(), profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } } });
  expect(m.adventDaysLeft).toBe(24);  // 2026-08-17T12:00Z -> 2026-09-10T12:00Z
  expect(m.adventHref).toBe(`/library/${STARTER_RULES_PDF_ID}/view`);
  expect(m.quickstartHref).toBe('/library/qs-id/view');
});

test('an expired starter unlock drops the advent link but keeps the quickstart', () => {
  const m = computeOnboarding({
    ...base(),
    profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } },
    starterUnlock: { expires_at: '2026-08-01T00:00:00Z' }
  });
  expect(m.adventDaysLeft).toBeNull();
  expect(m.adventHref).toBeNull();
  expect(m.quickstartHref).toBe('/library/qs-id/view');
});

test('a missing starter unlock behaves like an expired one', () => {
  const m = computeOnboarding({
    ...base(),
    profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } },
    starterUnlock: null
  });
  expect(m.adventDaysLeft).toBeNull();
});

// ---- loadOnboarding ----

const deps = (over = {}) => ({
  countCharactersByCreator: async () => ({ data: 0, error: null }),
  hasAnyGameActivity: async () => ({ data: false, error: null }),
  listRulesPdfUnlocksForUser: async () => ({
    data: [{ rules_pdf_id: STARTER_RULES_PDF_ID, expires_at: '2026-09-10T12:00:00Z' }], error: null
  }),
  getRulesPdfs: async () => ({
    data: [{ id: 'qs-id', is_active: true, free_access: true }, { id: 'core', is_active: true, free_access: false }],
    error: null
  }),
  ...over
});

test('loadOnboarding for a signed-out visitor returns only the quickstart link', async () => {
  const m = await loadOnboarding({ profile: null, client: {}, now: NOW }, deps());
  expect(m.show).toBe(false);
  expect(m.quickstartHref).toBe('/library/qs-id/view');
});

test('loadOnboarding short-circuits a dismissed profile with zero reads', async () => {
  let reads = 0;
  const counting = deps({
    countCharactersByCreator: async () => { reads++; return { data: 0, error: null }; },
    getRulesPdfs: async () => { reads++; return { data: [], error: null }; }
  });
  const m = await loadOnboarding(
    { profile: { user_id: 'u1', name: 'Dave', onboarding: { dismissed: true } }, client: {}, now: NOW },
    counting
  );
  expect(m.show).toBe(false);
  expect(reads).toBe(0);
});

test('loadOnboarding fills hasCharacters itself when the caller did not', async () => {
  const m = await loadOnboarding(
    { profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } }, client: {}, now: NOW },
    deps({ countCharactersByCreator: async () => ({ data: 2, error: null }) })
  );
  expect(m.characterDone).toBe(true);
});

test('loadOnboarding trusts a caller-supplied hasCharacters and skips that read', async () => {
  let called = false;
  const m = await loadOnboarding(
    { profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } }, client: {}, hasCharacters: true, hasMissions: false, now: NOW },
    deps({ countCharactersByCreator: async () => { called = true; return { data: 0, error: null }; } })
  );
  expect(m.characterDone).toBe(true);
  expect(called).toBe(false);
});

test('a failed read degrades that step, never the whole card', async () => {
  const m = await loadOnboarding(
    { profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } }, client: {}, now: NOW },
    deps({ hasAnyGameActivity: async () => { throw new Error('db down'); } })
  );
  expect(m.show).toBe(true);
  expect(m.gameDone).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test services/home/onboarding.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `services/home/onboarding.js`**

```js
const { STARTER_RULES_PDF_ID } = require('../../util/starter-content');
const { countCharactersByCreator } = require('../../models/character');
const { hasAnyGameActivity } = require('../../models/lfg');
const { listRulesPdfUnlocksForUser, getRulesPdfs } = require('../../models/rules');

const DAY_MS = 24 * 60 * 60 * 1000;

const defaultDeps = {
  countCharactersByCreator,
  hasAnyGameActivity,
  listRulesPdfUnlocksForUser,
  getRulesPdfs
};

// Same isolation contract as sections.js: a sick read degrades its own step
// to "not done" and the card still renders.
const settle = async (label, fallback, run) => {
  try {
    const { data, error } = await run();
    if (error) {
      console.error(`onboarding read "${label}" failed:`, error);
      return fallback;
    }
    return data;
  } catch (err) {
    console.error(`onboarding read "${label}" threw:`, err);
    return fallback;
  }
};

const viewHref = (id) => `/library/${id}/view`;

const hidden = (extra = {}) => ({
  show: false, askPath: false, persistDismiss: false, path: null,
  nameDone: false, learnDone: false, redeemDone: false,
  characterDone: false, gameDone: false, allDone: false,
  adventDaysLeft: null, adventHref: null, quickstartHref: null,
  ...extra
});

const computeOnboarding = ({ profile, hasCharacters, hasMissions, inGame, starterUnlock, freePdf, now }) => {
  const ob = profile.onboarding || {};
  const quickstartHref = freePdf ? viewHref(freePdf.id) : null;

  if (ob.dismissed) return hidden({ quickstartHref });

  const path = ob.path === 'new' || ob.path === 'veteran' ? ob.path : null;
  const askPath = !path;

  // The existing-account gate: never quiz a profile that plainly isn't new.
  if (askPath && (hasCharacters || hasMissions)) {
    return hidden({ persistDismiss: true, quickstartHref });
  }

  const expiresMs = starterUnlock?.expires_at ? Date.parse(starterUnlock.expires_at) : NaN;
  const adventDaysLeft = expiresMs > now.getTime()
    ? Math.ceil((expiresMs - now.getTime()) / DAY_MS)
    : null;

  const nameDone = profile.name !== `Agent #${profile.user_id}`;
  const learnDone = !!ob.read_rules;
  const redeemDone = !!ob.redeemed;
  const characterDone = !!hasCharacters;
  const gameDone = !!inGame;

  const allDone = !askPath && nameDone && characterDone && gameDone
    && (path === 'new' ? learnDone : redeemDone);

  return {
    show: true,
    askPath,
    persistDismiss: allDone, // "all set" renders once; the stored dismissal ends it
    path,
    nameDone, learnDone, redeemDone, characterDone, gameDone, allDone,
    adventDaysLeft,
    adventHref: adventDaysLeft ? viewHref(STARTER_RULES_PDF_ID) : null,
    quickstartHref
  };
};

const loadOnboarding = async ({ profile, client, hasCharacters, hasMissions, now = new Date() }, deps = defaultDeps) => {
  const findFreePdf = async () => {
    const rules = await settle('free-pdf', [], () => deps.getRulesPdfs({}));
    return rules.find(r => r.free_access && r.is_active) || null;
  };

  if (!profile) {
    const freePdf = await findFreePdf();
    return hidden({ quickstartHref: freePdf ? viewHref(freePdf.id) : null });
  }

  if (profile.onboarding?.dismissed) return hidden();

  const [resolvedHasCharacters, inGame, unlocks, freePdf] = await Promise.all([
    hasCharacters === undefined
      ? settle('character-count', 0, () => deps.countCharactersByCreator(profile.id, client)).then(n => n > 0)
      : hasCharacters,
    settle('game-activity', false, () => deps.hasAnyGameActivity(profile.id, client)),
    settle('starter-unlock', [], () => deps.listRulesPdfUnlocksForUser(profile.user_id)),
    findFreePdf()
  ]);

  return computeOnboarding({
    profile,
    hasCharacters: resolvedHasCharacters,
    hasMissions: hasMissions === undefined ? false : hasMissions,
    inGame,
    starterUnlock: unlocks.find(u => u.rules_pdf_id === STARTER_RULES_PDF_ID) || null,
    freePdf,
    now
  });
};

module.exports = { computeOnboarding, loadOnboarding, defaultDeps };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test services/home/onboarding.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add services/home/onboarding.js services/home/onboarding.test.js
git commit -m "feat: onboarding compute/load service with derived checklist state"
```

---

### Task 7: Wire onboarding into the homepage sections and route

**Files:**
- Modify: `services/home/sections.js`
- Modify: `routes/home.js:9-25`
- Test: extend `services/home/sections.test.js`

**Interfaces:**
- Consumes: `loadOnboarding` (Task 6), `patchOnboarding` (Task 2).
- Produces: `loadHomeSections` result gains an `onboarding` key (the Task 6 render model). `routes/home.js` persists `persistDismiss` fire-and-forget. Task 8's templates read `onboarding.*`.

- [ ] **Step 1: Write the failing tests**

Add to `services/home/sections.test.js` (extend `allGood()` and reuse its fixtures; `loadHomeSections` will take onboarding deps through the same `deps` object):

```js
const onboardingDeps = {
  countCharactersByCreator: ok(0),
  hasAnyGameActivity: ok(false),
  listRulesPdfUnlocksForUser: ok([]),
  getRulesPdfs: ok([{ id: 'qs-id', is_active: true, free_access: true }])
};

test('loadHomeSections computes onboarding for a signed-in player', async () => {
  const result = await loadHomeSections(
    { profile: { id: 'p1', user_id: 'u1', name: 'Agent #u1', onboarding: {} }, client },
    { ...allGood(), ...onboardingDeps, getRecentCharactersByCreator: ok([]), getRecentMissionsByCreator: ok([]) }
  );
  expect(result.onboarding.show).toBe(true);
  expect(result.onboarding.askPath).toBe(true);
});

test('loadHomeSections reuses its own character/mission reads for the onboarding gate', async () => {
  // Player has characters via the section read; the gate must see that
  // without a second count query.
  let countCalls = 0;
  const result = await loadHomeSections(
    { profile: { id: 'p1', user_id: 'u1', name: 'Agent #u1', onboarding: {} }, client },
    { ...allGood(), ...onboardingDeps, countCharactersByCreator: async () => { countCalls++; return { data: 9, error: null }; } }
  );
  expect(result.onboarding.show).toBe(false);       // has characters -> gated
  expect(result.onboarding.persistDismiss).toBe(true);
  expect(countCalls).toBe(0);
});

test('loadHomeSections gives a signed-out visitor the quickstart link only', async () => {
  const result = await loadHomeSections(
    { profile: null, client },
    { ...allGood(), ...onboardingDeps }
  );
  expect(result.onboarding.show).toBe(false);
  expect(result.onboarding.quickstartHref).toBe('/library/qs-id/view');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test services/home/sections.test.js`
Expected: FAIL — `result.onboarding` is `undefined`. Pre-existing tests must still pass.

- [ ] **Step 3: Wire the service**

In `services/home/sections.js`:

```js
const { loadOnboarding, defaultDeps: onboardingDefaultDeps } = require('./onboarding');
```

Merge the onboarding deps into `defaultDeps` (`...onboardingDefaultDeps`). At the end of `loadHomeSections`, after the existing reads:

```js
  const onboarding = await loadOnboarding({
    profile,
    client,
    hasCharacters: signedIn ? myCharacters.length > 0 : undefined,
    hasMissions: signedIn ? myMissions.length > 0 : undefined
  }, deps);
```

and add `onboarding` to the returned object. (Signed-out passes `profile: null`, and `loadOnboarding` handles it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test services/home/sections.test.js`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 5: Persist the dismissal from the route**

In `routes/home.js` GET `/`, after `loadHomeSections`:

```js
  if (sections.onboarding?.persistDismiss && res.locals.user) {
    // Fire-and-forget: the gate/completion write must never delay the page.
    patchOnboarding(res.locals.user.id, { dismissed: true }).catch(() => {});
  }
```

with `const { patchOnboarding } = require('../models/profile');` at the top. Confirm `res.locals.user` is set by `authOptional` (it is for signed-in requests; the guard covers signed-out).

- [ ] **Step 6: Run the full unit suite**

Run: `bun run test:unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/home/sections.js services/home/sections.test.js routes/home.js
git commit -m "feat: homepage loads onboarding state and persists its dismissal"
```

---

### Task 8: The onboarding card partial and homepage template

**Files:**
- Create: `views/partials/home-onboarding.handlebars`
- Modify: `views/home.handlebars` (delete lines 4-20, the get-started notification; add partial; add signed-out quickstart line)
- Test: extend `views/home.test.js`

**Interfaces:**
- Consumes: the `onboarding` render model (Task 6) and `profile` in template context.
- Produces: `#onboarding-card` markup whose htmx controls POST to `/profile/onboarding` (Task 9) with `hx-target="#onboarding-card" hx-swap="outerHTML"`. Task 9 re-renders this same partial with `layout: false`.

- [ ] **Step 1: Write the failing view tests**

In `views/home.test.js`: register the new partial in `render()`'s partial list (add `'home-onboarding'` to the loop array). Replace the old `'the get-started callout shows only when the player has no characters'` test (the callout is being deleted) with:

```js
const OB_ASK = {
  show: true, askPath: true, path: null, allDone: false,
  nameDone: false, learnDone: false, redeemDone: false, characterDone: false, gameDone: false,
  adventDaysLeft: null, adventHref: null, quickstartHref: '/library/qs-id/view'
};

test('a fresh player is asked whether they have played Enclave before', () => {
  const html = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: false, onboarding: OB_ASK });
  expect(html).toContain('Have you played Enclave before?');
  expect(html).toContain("I'm new — show me the ropes");
  expect(html).toContain('I already play');
  expect(html).toContain('hx-post="/profile/onboarding"');
  expect(html).not.toContain('Get started with Agent Resources');
});

test('the new path renders its four steps with derived check state', () => {
  const html = render({
    ...empty, profile: { name: 'Vex' }, hasCharacters: true,
    onboarding: {
      ...OB_ASK, askPath: false, path: 'new',
      nameDone: true, learnDone: false, characterDone: true, gameDone: false,
      adventDaysLeft: 24, adventHref: '/library/starter/view'
    }
  });
  expect(html).toContain('Set your agent name');
  expect(html).toContain('Learn the game');
  expect(html).toContain('24 days left');
  expect(html).toContain('href="/library/qs-id/view"');
  expect(html).toContain('Create your first character');
  expect(html).toContain('Find a game');
  expect(html).not.toContain('Redeem your unlock code');
});

test('the veteran path swaps the learn step for code redemption', () => {
  const html = render({
    ...empty, profile: { name: 'Vex' }, hasCharacters: false,
    onboarding: { ...OB_ASK, askPath: false, path: 'veteran' }
  });
  expect(html).toContain('Redeem your unlock code');
  expect(html).not.toContain('Learn the game');
});

test('a completed onboarding renders the all-set state', () => {
  const html = render({
    ...empty, profile: { name: 'Vex' }, hasCharacters: true,
    onboarding: { ...OB_ASK, askPath: false, path: 'new', allDone: true }
  });
  expect(html).toContain("You're all set, Agent");
});

test('a hidden onboarding renders no card at all', () => {
  const html = render({ ...empty, profile: { name: 'Vex' }, hasCharacters: true, onboarding: { ...OB_ASK, show: false } });
  expect(html).not.toContain('onboarding-card');
});

test('a signed-out visitor sees the free quickstart link', () => {
  const html = render({ ...empty, profile: null, onboarding: { ...OB_ASK, show: false } });
  expect(html).toContain('Read the free Quickstart');
  expect(html).toContain('href="/library/qs-id/view"');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test views/home.test.js`
Expected: FAIL — partial missing / old callout still present.

- [ ] **Step 3: Write the partial and rewire `home.handlebars`**

`views/partials/home-onboarding.handlebars`:

```handlebars
{{#if onboarding.show}}
<div id="onboarding-card" class="notification is-info is-light">
  {{#if onboarding.allDone}}
  <p class="is-size-5 has-text-weight-semibold mb-1">You're all set, Agent.</p>
  <p>Character created, game found. Good hunting out there.</p>
  {{else if onboarding.askPath}}
  <p class="is-size-5 has-text-weight-semibold mb-1">Welcome to Agent Resources</p>
  <p class="mb-3">Have you played Enclave before?</p>
  <div class="buttons">
    <button class="button is-primary" hx-post="/profile/onboarding"
      hx-vals='{"action":"path","path":"new"}' hx-target="#onboarding-card" hx-swap="outerHTML">
      I'm new &mdash; show me the ropes
    </button>
    <button class="button is-link is-outlined" hx-post="/profile/onboarding"
      hx-vals='{"action":"path","path":"veteran"}' hx-target="#onboarding-card" hx-swap="outerHTML">
      I already play
    </button>
  </div>
  {{else}}
  <div class="is-flex is-justify-content-space-between is-align-items-baseline">
    <p class="is-size-5 has-text-weight-semibold mb-2">Getting started</p>
    <div>
      <a class="is-size-7 mr-3" hx-post="/profile/onboarding"
        hx-vals='{"action":"switch"}' hx-target="#onboarding-card" hx-swap="outerHTML" href="#">
        {{#if (eq onboarding.path "new")}}Already play? Switch{{else}}New to Enclave? Switch{{/if}}
      </a>
      <a class="is-size-7" hx-post="/profile/onboarding"
        hx-vals='{"action":"dismiss"}' hx-target="#onboarding-card" hx-swap="outerHTML" href="#">Dismiss</a>
    </div>
  </div>
  <ul>
    <li class="mb-2">
      <span class="icon is-small mr-1"><i class="fas {{#if onboarding.nameDone}}fa-check has-text-success{{else}}fa-circle-notch{{/if}}"></i></span>
      <a href="/profile">Set your agent name</a>
    </li>
    {{#if (eq onboarding.path "new")}}
    <li class="mb-2">
      <span class="icon is-small mr-1"><i class="fas {{#if onboarding.learnDone}}fa-check has-text-success{{else}}fa-circle-notch{{/if}}"></i></span>
      <span>Learn the game &mdash;
        {{#if onboarding.quickstartHref}}<a href="{{onboarding.quickstartHref}}">read the free Quickstart</a>{{/if}}
        {{#if onboarding.adventHref}}{{#if onboarding.quickstartHref}} or {{/if}}<a href="{{onboarding.adventHref}}">dive into Enclave: Advent</a>
        <span class="has-text-grey">({{onboarding.adventDaysLeft}} days left on your free trial)</span>{{/if}}
      </span>
      <span class="is-size-7 has-text-grey ml-4 is-block">Prefer video?
        <a href="https://www.youtube.com/watch?v=aBVeIi6s6rE" target="_blank" rel="noopener">Watch the intro</a>
      </span>
    </li>
    {{else}}
    <li class="mb-2">
      <span class="icon is-small mr-1"><i class="fas {{#if onboarding.redeemDone}}fa-check has-text-success{{else}}fa-circle-notch{{/if}}"></i></span>
      <a href="/classes/redeem/bulk">Redeem your unlock code</a>
      {{#if onboarding.adventDaysLeft}}
      <span class="is-size-7 has-text-grey ml-4 is-block">Your account already includes Enclave: Advent free for {{onboarding.adventDaysLeft}} more days.</span>
      {{/if}}
    </li>
    {{/if}}
    <li class="mb-2">
      <span class="icon is-small mr-1"><i class="fas {{#if onboarding.characterDone}}fa-check has-text-success{{else}}fa-circle-notch{{/if}}"></i></span>
      <a href="/characters/new">Create your first character</a>
    </li>
    <li>
      <span class="icon is-small mr-1"><i class="fas {{#if onboarding.gameDone}}fa-check has-text-success{{else}}fa-circle-notch{{/if}}"></i></span>
      <a href="/lfg">Find a game</a>
    </li>
  </ul>
  {{/if}}
</div>
{{/if}}
```

In `views/home.handlebars`: delete the whole `{{#unless hasCharacters}}...{{/unless}}` notification block (lines 4-20) and put `{{> home-onboarding}}` in its place. In the signed-out block, after the video `</div>` and before the Kickstarter button div, add:

```handlebars
    {{#if onboarding.quickstartHref}}
    <p class="mt-4"><a href="{{onboarding.quickstartHref}}">Read the free Quickstart</a> &mdash; no account needed.</p>
    {{/if}}
```

Note: `render()` in the test registers the packaged `eq` helper already; the partial's `(eq onboarding.path "new")` subexpressions rely on it, same as `home-upcoming-games.handlebars`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test views/home.test.js`
Expected: PASS, including the pre-existing homepage tests.

- [ ] **Step 5: Commit**

```bash
git add views/partials/home-onboarding.handlebars views/home.handlebars views/home.test.js
git commit -m "feat: onboarding card partial replaces the get-started callout"
```

---

### Task 9: `POST /profile/onboarding`

**Files:**
- Modify: `routes/profile.js` (add route)
- Create: `routes/profile-onboarding.test.js`

**Interfaces:**
- Consumes: `patchOnboarding` (Task 2), `loadOnboarding` (Task 6), `isAuthenticated` from `util/auth`.
- Produces: `POST /profile/onboarding` accepting form/`hx-vals` body `{ action: 'path'|'switch'|'dismiss', path?: 'new'|'veteran' }`; responds with the re-rendered `partials/home-onboarding` (`layout: false`) so htmx swaps `#onboarding-card` in place. Invalid input → 400.

Behavior table:
- `action=path` with valid `path` → `patchOnboarding(userId, { path })`.
- `action=switch` → flip the stored path (`new` ⇄ `veteran`); if no path stored, 400.
- `action=dismiss` → `patchOnboarding(userId, { dismissed: true })`.
- Then reload: `loadOnboarding({ profile: refreshedProfile, client: res.locals.supabase })` — the profile in `res.locals` carries the *pre-write* jsonb, so build `refreshedProfile = { ...profile, onboarding: mergedData }` from `patchOnboarding`'s returned `data`.

- [ ] **Step 1: Write the failing route test**

`routes/profile-onboarding.test.js`, scaffolded exactly like `routes/library-unlocks.test.js` (freshRequire, express app with JSON render capture, `startHttpServer`). Overrides: `models/_base` inert, `models/auth` (`valid-jwt` → `{ id: 'u1' }`), `models/profile` fake with a recording `patchOnboarding` plus whatever profile getter `util/auth`'s `isAuthenticated` consults (check `util/auth.js` — mirror the library-unlocks fake: `getProfile: async () => ({ id: 'p1', user_id: 'u1', name: 'Agent #u1', role: 'user', onboarding: currentOnboarding })`), `services/home/onboarding` fake `loadOnboarding` returning a recognizable model, plus the same inert `util/system-message`, `models/lfg`, `util/nav-loader` stand-ins the library test uses. Mount `app.use('/profile', freshRequire(require.resolve('./profile'), overrides))`. Note: `routes/profile.js` will have its own require list — cover every relative require it makes, keeping real behavior only for the route file itself.

```js
let currentOnboarding = {};
let patchCalls = [];
// in the models/profile fake:
//   patchOnboarding: async (userId, patch) => {
//     patchCalls.push({ userId, patch });
//     currentOnboarding = { ...currentOnboarding, ...patch };
//     return { data: currentOnboarding, error: null };
//   }
// in the services/home/onboarding fake:
//   loadOnboarding: async ({ profile }) => ({ show: true, askPath: false, path: profile.onboarding.path || null })

const post = (body) => fetch(`${baseUrl}/profile/onboarding`, {
  method: 'POST',
  headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
  body
});

test('action=path stores the choice and re-renders the card partial', async () => {
  currentOnboarding = {}; patchCalls = [];
  const res = await post('action=path&path=new');
  expect(res.status).toBe(200);
  expect(patchCalls).toEqual([{ userId: 'u1', patch: { path: 'new' } }]);
  const { view, ctx } = await res.json();
  expect(view).toBe('partials/home-onboarding');
  expect(ctx.layout).toBe(false);
  expect(ctx.onboarding.path).toBe('new');
});

test('action=path rejects an unknown path', async () => {
  currentOnboarding = {}; patchCalls = [];
  const res = await post('action=path&path=wizard');
  expect(res.status).toBe(400);
  expect(patchCalls).toEqual([]);
});

test('action=switch flips the stored path', async () => {
  currentOnboarding = { path: 'new' }; patchCalls = [];
  const res = await post('action=switch');
  expect(res.status).toBe(200);
  expect(patchCalls).toEqual([{ userId: 'u1', patch: { path: 'veteran' } }]);
});

test('action=switch with no stored path is a 400', async () => {
  currentOnboarding = {}; patchCalls = [];
  const res = await post('action=switch');
  expect(res.status).toBe(400);
});

test('action=dismiss stores the dismissal', async () => {
  currentOnboarding = { path: 'new' }; patchCalls = [];
  const res = await post('action=dismiss');
  expect(res.status).toBe(200);
  expect(patchCalls).toEqual([{ userId: 'u1', patch: { dismissed: true } }]);
});

test('an unknown action is a 400', async () => {
  const res = await post('action=explode');
  expect(res.status).toBe(400);
});

test('the route requires authentication', async () => {
  const res = await fetch(`${baseUrl}/profile/onboarding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'action=dismiss'
  });
  expect([302, 401, 403]).toContain(res.status);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test routes/profile-onboarding.test.js`
Expected: FAIL — 404 (route missing).

- [ ] **Step 3: Implement the route**

In `routes/profile.js` (imports: `patchOnboarding` from `../models/profile`, `loadOnboarding` from `../services/home/onboarding`, `sendError` from `../util/http-error` — add whichever the file doesn't already pull in; `isAuthenticated` is already imported there, verify and reuse):

```js
router.post('/onboarding', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const userId = res.locals.user.id;
  const { action, path } = req.body;

  let patch;
  if (action === 'path' && (path === 'new' || path === 'veteran')) {
    patch = { path };
  } else if (action === 'switch' && (profile.onboarding?.path === 'new' || profile.onboarding?.path === 'veteran')) {
    patch = { path: profile.onboarding.path === 'new' ? 'veteran' : 'new' };
  } else if (action === 'dismiss') {
    patch = { dismissed: true };
  } else {
    return sendError(req, res, null, { status: 400, message: 'Invalid onboarding action' });
  }

  const { data: merged, error } = await patchOnboarding(userId, patch);
  if (error) {
    return sendError(req, res, error, { message: 'Failed to update onboarding' });
  }

  const onboarding = await loadOnboarding({
    profile: { ...profile, onboarding: merged },
    client: res.locals.supabase
  });

  return res.render('partials/home-onboarding', { layout: false, onboarding });
});
```

Register order note: if `routes/profile.js` has an `/:something` catch-all, place `/onboarding` above it.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test routes/profile-onboarding.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/profile.js routes/profile-onboarding.test.js
git commit -m "feat: POST /profile/onboarding sets path, switch, and dismiss"
```

---

### Task 10: Library view route — signed-out free viewing + `read_rules` marking

**Files:**
- Modify: `routes/library.js:343-400` (the `/:id/view` handler)
- Create: `routes/library-view-onboarding.test.js`

**Interfaces:**
- Consumes: `canViewRulesPdf` free branch (Task 3, already live via the real `models/rules` in this route), `patchOnboarding` (Task 2), `STARTER_RULES_PDF_ID` (`util/starter-content.js`).
- Produces: opening the quickstart (`free_access`) or the starter Advent PDF as a signed-in user fire-and-forgets `patchOnboarding(user.id, { read_rules: true })`. Signed-out viewing of a free PDF renders normally and writes nothing.

- [ ] **Step 1: Write the failing route test**

`routes/library-view-onboarding.test.js` — same freshRequire scaffold as `routes/library-unlocks.test.js`. Key fakes: `models/rules` serving `getRulesPdf` for two docs (`'qs'` with `free_access: true`, and the real `STARTER_RULES_PDF_ID` with `free_access: false`) and a real-ish `canViewRulesPdf` stand-in (`async (uc, pdf) => ({ data: !!pdf.free_access || !!uc.userId, error: null })`); `models/pdf` with `getSignedPdfUrl: async () => ({ data: 'https://signed.example/pdf', error: null })`; `models/profile` recording `patchOnboarding` calls (and resolving after a tick so the test can await a settled microtask queue).

```js
test('a signed-out visitor can open a free PDF and no onboarding write happens', async () => {
  patchCalls = [];
  const res = await fetch(`${baseUrl}/library/qs/view`); // no auth
  expect(res.status).toBe(200);
  const { view, ctx } = await res.json();
  expect(view).toBe('pdf-viewer');
  expect(ctx.pdfUrl).toBe('https://signed.example/pdf');
  await new Promise(r => setTimeout(r, 10));
  expect(patchCalls).toEqual([]);
});

test('a signed-in player opening the free quickstart marks read_rules', async () => {
  patchCalls = [];
  const res = await fetch(`${baseUrl}/library/qs/view`, { headers: authHeaders });
  expect(res.status).toBe(200);
  await new Promise(r => setTimeout(r, 10));
  expect(patchCalls).toEqual([{ userId: 'u1', patch: { read_rules: true } }]);
});

test('a signed-in player opening the starter Advent PDF marks read_rules', async () => {
  patchCalls = [];
  const { STARTER_RULES_PDF_ID } = require('../util/starter-content');
  const res = await fetch(`${baseUrl}/library/${STARTER_RULES_PDF_ID}/view`, { headers: authHeaders });
  expect(res.status).toBe(200);
  await new Promise(r => setTimeout(r, 10));
  expect(patchCalls).toEqual([{ userId: 'u1', patch: { read_rules: true } }]);
});

test('an ordinary gated PDF does not mark read_rules', async () => {
  patchCalls = [];
  // add a third fake doc 'core' (free_access: false, not the starter id)
  const res = await fetch(`${baseUrl}/library/core/view`, { headers: authHeaders });
  expect(res.status).toBe(200);
  await new Promise(r => setTimeout(r, 10));
  expect(patchCalls).toEqual([]);
});

test('a patchOnboarding failure does not break the viewer', async () => {
  patchFails = true; // make the fake reject
  const res = await fetch(`${baseUrl}/library/qs/view`, { headers: authHeaders });
  expect(res.status).toBe(200);
  patchFails = false;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test routes/library-view-onboarding.test.js`
Expected: signed-out free view already passes (Task 3); the `read_rules` tests FAIL (no write yet).

- [ ] **Step 3: Add the marking to the view route**

In `routes/library.js` `/:id/view`, just before the final `res.render('pdf-viewer', ...)`:

```js
    if (user && (rulesPdf.free_access || rulesPdf.id === STARTER_RULES_PDF_ID)) {
        // Learn-the-game step: fire-and-forget, the viewer never waits on it.
        patchOnboarding(user.id, { read_rules: true }).catch(() => {});
    }
```

Imports at the top of `routes/library.js`:

```js
const { patchOnboarding } = require('../models/profile');
const { STARTER_RULES_PDF_ID } = require('../util/starter-content');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test routes/library-view-onboarding.test.js && bun run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/library.js routes/library-view-onboarding.test.js
git commit -m "feat: opening the quickstart or starter Advent PDF marks read_rules"
```

---

### Task 11: Redeem route marks `redeemed`

**Files:**
- Modify: `routes/classes.js:206-275` (the `POST /redeem/bulk` handler)
- Create: `routes/classes-redeem-onboarding.test.js`

**Interfaces:**
- Consumes: `patchOnboarding` (Task 2), the existing `redeemAnyCode` loop.
- Produces: any successful redemption in the batch fire-and-forgets `patchOnboarding(userId, { redeemed: true })`; an all-failure batch writes nothing.

- [ ] **Step 1: Write the failing route test**

`routes/classes-redeem-onboarding.test.js` — freshRequire scaffold again, mounting `app.use('/classes', freshRequire(require.resolve('./classes'), overrides))`. `routes/classes.js` has a long require list; cover each relative require with inert fakes (same procedure as the note in Task 2 — read the file's requires first). The behavioral fakes: `util/redeem-code` with `redeemAnyCode: async (code) => code === 'good' ? { type: 'class', id: 'k1' } : { error: new Error('bad code') }`; `models/class` `getClass: async () => ({ data: { name: 'Thane' }, error: null })`; `models/profile` recording `patchOnboarding`.

```js
test('a batch with one good code marks redeemed once', async () => {
  patchCalls = [];
  const res = await fetch(`${baseUrl}/classes/redeem/bulk`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'codes=good%0Abad'
  });
  expect(res.status).toBe(200);
  await new Promise(r => setTimeout(r, 10));
  expect(patchCalls).toEqual([{ userId: 'u1', patch: { redeemed: true } }]);
});

test('an all-failure batch does not mark redeemed', async () => {
  patchCalls = [];
  const res = await fetch(`${baseUrl}/classes/redeem/bulk`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'codes=bad'
  });
  expect(res.status).toBe(200);
  await new Promise(r => setTimeout(r, 10));
  expect(patchCalls).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test routes/classes-redeem-onboarding.test.js`
Expected: FAIL — no `patchOnboarding` call.

- [ ] **Step 3: Add the marking**

In `routes/classes.js`, after the redemption loop and before the final `res.render('redeem-codes', ...)`:

```js
    if (results.some(r => r.success)) {
        // Onboarding step: fire-and-forget, redemption results render regardless.
        patchOnboarding(userId, { redeemed: true }).catch(() => {});
    }
```

with `patchOnboarding` added to the existing `require('../models/profile')` destructure (or a new one if classes.js doesn't import it yet).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test routes/classes-redeem-onboarding.test.js && bun run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/classes.js routes/classes-redeem-onboarding.test.js
git commit -m "feat: successful code redemption marks the onboarding redeemed step"
```

---

### Task 12: E2E — a fresh signup meets the path question

**Files:**
- Create: `e2e/specs/24-onboarding.spec.js`

**Interfaces:**
- Consumes: `supabaseAdmin` (`models/_base`), the sign-in flow pattern from `e2e/global-setup.js`, the running app + `/profile/onboarding` endpoint (Task 9) and card markup (Task 8).

- [ ] **Step 1: Write the spec**

A brand-new throwaway user (the fixture identities own characters, so they are gated out of onboarding by design). Create it with the admin API exactly as `ensurePlayer` does in `global-setup.js`, sign in through the real `/auth` form the way global-setup does (copy its form-fill/sign-in sequence — read that file's actual selectors before writing), then:

```js
const { test, expect } = require('@playwright/test');
const { supabaseAdmin } = require('../../models/_base');

const EMAIL = 'e2e-onboarding@testing.com';
const PASSWORD = 'e2e-onboarding-password';

let userId;

test.beforeAll(async () => {
  // Idempotent: delete a leftover from a previous run, then create fresh so
  // the profile has no characters, no path, and an unseen onboarding card.
  const { data: list } = await supabaseAdmin.auth.admin.listUsers();
  const existing = list.users.find(u => u.email === EMAIL);
  if (existing) await supabaseAdmin.auth.admin.deleteUser(existing.id);
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true
  });
  if (error) throw error;
  userId = data.user.id;
});

test.afterAll(async () => {
  if (userId) await supabaseAdmin.auth.admin.deleteUser(userId);
});

test('a fresh signup is asked the path question and gets the new-player checklist', async ({ page }) => {
  // Sign in through the real form (mirror global-setup's sequence).
  await page.goto('/auth');
  await page.fill('#sign-in-email', EMAIL);      // verify selector against auth.handlebars
  await page.fill('#sign-in-password', PASSWORD);
  await page.click('#sign-in-submit');
  await page.waitForURL('/');

  const card = page.locator('#onboarding-card');
  await expect(card).toContainText('Have you played Enclave before?');

  await card.getByRole('button', { name: /show me the ropes/ }).click();
  await expect(card).toContainText('Set your agent name');
  await expect(card).toContainText('Learn the game');
  await expect(card).toContainText('Create your first character');
  await expect(card).toContainText('Find a game');

  // The choice persisted: a hard reload still shows the checklist, not the question.
  await page.reload();
  await expect(page.locator('#onboarding-card')).toContainText('Set your agent name');
});
```

Before finalizing, open `e2e/global-setup.js`'s sign-in section and `views/auth.handlebars` and correct the selectors/URL waits to the real ones — the shape above is the contract, the selectors are illustrative.

- [ ] **Step 2: Run the spec**

Run: `bun run test:e2e -- e2e/specs/24-onboarding.spec.js` (or `npx playwright test e2e/specs/24-onboarding.spec.js`; match how other specs are invoked per `playwright.config.js`)
Expected: PASS against the locally running stack. If the local e2e stack isn't available in this environment, run the full unit suite instead and flag the spec for CI.

- [ ] **Step 3: Full suite sweep**

Run: `bun run test:unit && bun run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/24-onboarding.spec.js
git commit -m "test: e2e coverage for the first-time onboarding path question"
```
