# Consolidate Service-Role Access Behind Repositories — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every `supabaseAdmin` (service-role, RLS-bypassing) usage behind per-domain repository modules, and route every privileged command through an actor-aware, policy-guarded service capability method.

**Architecture:** Five layers per domain — `models/_base.js` (constructs the clients), `services/<domain>/repository.js` (the only consumer of `supabaseAdmin`; all privileged reads + writes), `services/<domain>/policy.js` (pure authorization predicates), `services/<domain>/service.js` (capability methods taking an actor; load → policy → throw-or-mutate), and routes (build the actor, call capabilities, never import `supabaseAdmin`). Denials throw `AuthorizationError`, mapped to HTTP 403.

**Tech Stack:** Node.js/CommonJS, Express 4, `@supabase/supabase-js`, Bun test runner (`bun:test`, `mock.module`). Test entry: `scripts/run-tests.mjs` via `bun run test:unit` and `bun run test:http`.

## Global Constraints

- **Actor shape:** `{ userId, profileId, role }`, built by `actorFromLocals(res.locals)`. This matches the existing agent-read convention (`models/class.js` `resolveClassAgentAccess`, `canViewClassPdf`, `auth.js:128` `role === 'admin'`). Admin = `role === 'admin'`.
- **System actor:** internal, non-user-triggered privileged commands (badge recalculation, mission/character backfill, conduit denormalization) use the frozen `SYSTEM_ACTOR` (`role: 'system'`), never constructed from request input. Policies grant it unconditionally.
- **Denial contract:** a policy denial makes the capability method **throw `AuthorizationError`** (`code: 'forbidden'`, `status: 403`). Capability methods never return `{ error: 'Unauthorized' }`. Existing services that do so today are migrated to throw.
- **Only two files may import `supabaseAdmin`:** `models/_base.js` (defines it) and `services/*/repository.js`. Zero references in `routes/`, `util/`, and non-`_base` `models/`.
- **Repository return shape:** privileged reads and writes return Supabase-style `{ data, error }` (repositories do NOT throw — only the service's policy step throws). This keeps `console.error`/error-propagation behavior identical to today.
- **Preserve double-guarded writes:** every creator-only write is guarded twice today (JS `creator_id` compare + `.eq('creator_id', …)` SQL filter). The policy reproduces the JS check; the repository method keeps the `.eq('creator_id', …)` filter. Do not drop either.
- **Async route safety:** any route handler that can reach a throwing capability method must be wrapped with `asyncHandler` (or keep an explicit `try/catch → sendError`). Express 4 does not catch async throws.
- **No behavior change beyond authorization consolidation.** RLS policies, anon/RLS read paths (`res.locals.supabase` for web routes), and domain logic are unchanged. The one intentional behavioral change is the agent admin-read path (Task 12).
- **Verification gate (every task):** `bun run test:unit` and `bun run test:http` both exit 0. Paste the actual exit codes in the task report.

---

## Task ordering

1. Foundation (`util/*`)
2. `class` — reference domain (existing service; owner-or-admin)
3. `profile` — reference for a new service with self-only authz
4. `rules`
5. `pdf` (storage)
6. `badge`
7. `agent-token`
8. `bot-link` + `routes/agent.js` + `routes/bot-link.js` (depends on Task 7 repo)
9. `mission` (existing service; resolve no-authz flags)
10. `character` + `routes/characters.js` (existing service; net-new route surface)
11. `lfg` (existing service; large agent surface)
12. Agent admin-read path cleanup (`util/auth.js:149`) + final grep gate

Each domain task is an independently shippable slice: after it, that domain imports no `supabaseAdmin` outside its repository, its privileged commands are policy-guarded, and its authz tests pass. The suite stays green after every task because untouched domains keep their current model code.

---

### Task 1: Foundation — actor, error, async wrapper, 403 mapping

**Files:**
- Create: `util/errors.js`
- Create: `util/actor.js`
- Create: `util/async-handler.js`
- Modify: `util/http-error.js` (`classifyError` gains a `forbidden` → 403 case)
- Test: `util/errors.test.js`, `util/actor.test.js`, `util/async-handler.test.js`, `util/http-error.test.js` (extend if it exists; else create)

**Interfaces:**
- Produces:
  - `AuthorizationError` — `new AuthorizationError(message?, { reason? })`; fields `name='AuthorizationError'`, `code='forbidden'`, `status=403`, optional `reason`.
  - `actorFromLocals(locals) → { userId, profileId, role }`
  - `SYSTEM_ACTOR` — frozen `{ userId: null, profileId: null, role: 'system' }`
  - `isAdmin(actor) → boolean`, `isSystem(actor) → boolean`
  - `asyncHandler(fn) → (req,res,next) => void`
  - `classifyError` maps `code === 'forbidden'` (and `AuthorizationError`) to `{ status: 403 }`.

- [ ] **Step 1: Write failing tests**

`util/errors.test.js`:
```js
const { test, expect } = require('bun:test');
const { AuthorizationError } = require('./errors');

test('AuthorizationError carries a forbidden code and 403 status', () => {
  const err = new AuthorizationError('nope', { reason: 'not_owner' });
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe('AuthorizationError');
  expect(err.code).toBe('forbidden');
  expect(err.status).toBe(403);
  expect(err.reason).toBe('not_owner');
  expect(err.message).toBe('nope');
});

test('AuthorizationError has a default message', () => {
  expect(new AuthorizationError().message).toBe('Not authorized');
});
```

`util/actor.test.js`:
```js
const { test, expect } = require('bun:test');
const { actorFromLocals, SYSTEM_ACTOR, isAdmin, isSystem } = require('./actor');

test('actorFromLocals reads user id, profile id, and role', () => {
  const actor = actorFromLocals({ user: { id: 'u1' }, profile: { id: 'p1', role: 'admin' } });
  expect(actor).toEqual({ userId: 'u1', profileId: 'p1', role: 'admin' });
});

test('actorFromLocals tolerates missing user/profile', () => {
  expect(actorFromLocals({})).toEqual({ userId: null, profileId: null, role: null });
  expect(actorFromLocals(undefined)).toEqual({ userId: null, profileId: null, role: null });
});

test('SYSTEM_ACTOR is a frozen system-role actor', () => {
  expect(SYSTEM_ACTOR.role).toBe('system');
  expect(Object.isFrozen(SYSTEM_ACTOR)).toBe(true);
});

test('isAdmin / isSystem discriminate on role', () => {
  expect(isAdmin({ role: 'admin' })).toBe(true);
  expect(isAdmin({ role: 'user' })).toBe(false);
  expect(isSystem(SYSTEM_ACTOR)).toBe(true);
  expect(isSystem({ role: 'admin' })).toBe(false);
});
```

`util/async-handler.test.js`:
```js
const { test, expect } = require('bun:test');
const { asyncHandler } = require('./async-handler');

test('asyncHandler forwards a rejected promise to next', async () => {
  const boom = new Error('boom');
  let passed = null;
  const handler = asyncHandler(async () => { throw boom; });
  await handler({}, {}, (e) => { passed = e; });
  await new Promise((r) => setImmediate(r));
  expect(passed).toBe(boom);
});

test('asyncHandler does not call next on success', async () => {
  let called = false;
  const handler = asyncHandler(async (req, res) => { res.ok = true; });
  const res = {};
  await handler({}, res, () => { called = true; });
  await new Promise((r) => setImmediate(r));
  expect(res.ok).toBe(true);
  expect(called).toBe(false);
});
```

`util/http-error.test.js` (add this case; create the file with a require of `./http-error` if absent):
```js
const { test, expect } = require('bun:test');
const { AuthorizationError } = require('./errors');
const httpError = require('./http-error');

test('a forbidden-coded error classifies as 403', () => {
  // classifyError is not exported by default; assert via sendError capture instead.
  const res = { headersSent: false, statusCode: null, status(c){ this.statusCode = c; return this; }, json(){ return this; }, render(){ return this; }, format(map){ (map.default || (()=>{}))(); return this; }, type(){ return this; }, send(){ return this; } };
  const req = { accepts: () => 'json', headers: {}, xhr: true, get: () => undefined };
  httpError.sendError(req, res, new AuthorizationError('denied'));
  expect(res.statusCode).toBe(403);
});
```
> Note: inspect `util/http-error.js`'s `sendError` content-negotiation before finalizing this test's `res`/`req` doubles; adjust the doubles to whatever `sendError` actually calls so the assertion targets the resolved status. If `classifyError` is exported, prefer asserting `classifyError(new AuthorizationError()).status === 403` directly.

- [ ] **Step 2: Run tests, verify they fail** — `bun test util/errors.test.js util/actor.test.js util/async-handler.test.js` → FAIL (modules not defined).

- [ ] **Step 3: Implement**

`util/errors.js`:
```js
class AuthorizationError extends Error {
  constructor(message = 'Not authorized', { reason = null } = {}) {
    super(message);
    this.name = 'AuthorizationError';
    this.code = 'forbidden';
    this.status = 403;
    if (reason) this.reason = reason;
  }
}

module.exports = { AuthorizationError };
```

`util/actor.js`:
```js
// Who is performing a privileged command, derived from the request.
// Shape matches the existing agent-read convention ({ userId, profileId, role }).
const actorFromLocals = (locals = {}) => ({
  userId: (locals && locals.user && locals.user.id) || null,
  profileId: (locals && locals.profile && locals.profile.id) || null,
  role: (locals && locals.profile && locals.profile.role) || null,
});

// Trusted actor for internal, non-user-triggered privileged commands
// (badge recalculation, backfill, denormalization). Never built from input.
const SYSTEM_ACTOR = Object.freeze({ userId: null, profileId: null, role: 'system' });

const isAdmin = (actor) => !!actor && actor.role === 'admin';
const isSystem = (actor) => !!actor && actor.role === 'system';

module.exports = { actorFromLocals, SYSTEM_ACTOR, isAdmin, isSystem };
```

`util/async-handler.js`:
```js
// Forward a rejected async route handler to Express's error pipeline so a
// thrown AuthorizationError reaches the central handler (app.js) and maps to 403.
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { asyncHandler };
```

`util/http-error.js` — add a `forbidden` case to `classifyError`'s `switch (error && error.code)`, mirroring the existing `'42501'` 403 case:
```js
    case 'forbidden':
      base = { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND };
      break;
```

- [ ] **Step 4: Run tests, verify pass** — the four `util/*` test files pass.
- [ ] **Step 5: Green gate** — `bun run test:unit` and `bun run test:http` exit 0.
- [ ] **Step 6: Commit** — `feat: add actor context, AuthorizationError, async handler, 403 mapping (ar-ezes)`

---

### Task 2: `class` domain — reference implementation

The pattern every later domain follows. `class` already has `services/class/{service,input}.js`; this task adds `repository.js` + `policy.js`, moves all `class` admin access out of `models/class.js`, gives the service actor-aware capability methods, and rewires `routes/classes.js`.

**Files:**
- Create: `services/class/repository.js`, `services/class/policy.js`, `services/class/policy.test.js`, `services/class/repository.test.js`
- Modify: `services/class/service.js` (actor params, policy, throw), `services/class/service.test.js`
- Modify: `models/class.js` (delete inline adapter + admin queries; delegate to repository)
- Modify: `routes/classes.js` (build actor, pass to capabilities, `asyncHandler`, drop any direct authz now owned by the service)

**Admin sites to move into `services/class/repository.js`** (from `models/class.js`): `createUnlockCodes` insert (58), `fetchClassFamilyRows` read (99), `isClassUnlocked` read (130), `getUnlockedClasses` read (192), `getUnlockedClassIdsForUser` read (214), `listClassesForAgent` read (311), `getClassForAgent` read (345), `unlockClass` insert (406), and the inline adapter `createClassRow`/`updateClassRow`/`deleteClassRow`/`savePdfMetadataRow` (494–509).

**Repository method inventory** (`services/class/repository.js`, only consumer of `supabaseAdmin` for class). Each method holds the exact query currently inline; the model keeps the surrounding logic (e.g. `computeVersionFamily`, date math):
- Writes: `insertClass(data)`, `updateClass(id, data)`, `deleteClass(id)`, `saveClassPdfMetadata(id, data)`, `insertUnlockCodes(rows)`, `insertUnlock(payload)`
- Reads: `fetchClassFamilyRows()`, `activeUnlockRows({ userId, classIds, nowIso })`, `unlockedClassRows({ userId, nowIso })`, `unlockedClassIdRows({ userId, nowIso })`, `fetchClassByIdAdmin(id)`, `fetchClassesForAgentAdmin(filters, actor)`

- [ ] **Step 1: Write `services/class/policy.js` and its failing test.** Policy predicates are pure — no I/O.

```js
// services/class/policy.js
const { isAdmin, isSystem } = require('../../util/actor');

// A class may be edited or deleted by its creator or an admin.
const canManageClass = (actor, classRow) => {
  if (isSystem(actor) || isAdmin(actor)) return true;
  return !!actor && !!actor.profileId && !!classRow && actor.profileId === classRow.created_by;
};

// Only admins mint unlock codes for a class (today's requireAdmin route).
const canMintUnlockCodes = (actor) => isAdmin(actor) || isSystem(actor);

module.exports = { canManageClass, canMintUnlockCodes };
```

`services/class/policy.test.js`:
```js
const { test, expect } = require('bun:test');
const { canManageClass, canMintUnlockCodes } = require('./policy');

const cls = { id: 'c1', created_by: 'p1' };

test('creator may manage their class', () => {
  expect(canManageClass({ profileId: 'p1', role: 'user' }, cls)).toBe(true);
});
test('a non-creator non-admin may not manage the class', () => {
  expect(canManageClass({ profileId: 'p2', role: 'user' }, cls)).toBe(false);
});
test('admin and system may manage any class', () => {
  expect(canManageClass({ profileId: 'pX', role: 'admin' }, cls)).toBe(true);
  expect(canManageClass({ role: 'system' }, cls)).toBe(true);
});
test('only admin/system may mint unlock codes', () => {
  expect(canMintUnlockCodes({ role: 'admin' })).toBe(true);
  expect(canMintUnlockCodes({ role: 'system' })).toBe(true);
  expect(canMintUnlockCodes({ profileId: 'p1', role: 'user' })).toBe(false);
});
```

- [ ] **Step 2: Run policy test, verify fail, implement `policy.js`, verify pass.**

- [ ] **Step 3: Create `services/class/repository.js`.** Move each admin query listed above verbatim into its named method, following the shape of the existing inline adapter (`withClassWriteResult` → a shared `withResult` helper). Example (full file starts here; transcribe the remaining queries from `models/class.js` at the cited lines):
```js
const { supabaseAdmin } = require('../../models/_base');

const withResult = async (query) => {
  const { data, error } = await query;
  if (error) { console.error(error); return { data: null, error }; }
  return { data, error: null };
};

module.exports = {
  insertClass: (data) => withResult(supabaseAdmin.from('classes').insert([data]).select().single()),
  updateClass: (id, data) => withResult(supabaseAdmin.from('classes').update(data).eq('id', id).select().single()),
  deleteClass: async (id) => {
    const { error } = await supabaseAdmin.from('classes').delete().eq('id', id);
    if (error) console.error(error);
    return { error: error || null };
  },
  saveClassPdfMetadata: (id, data) => withResult(supabaseAdmin.from('classes').update(data).eq('id', id).select().single()),
  insertUnlockCodes: (rows) => withResult(supabaseAdmin.from('class_unlock_codes').insert(rows).select()),
  insertUnlock: (payload) => withResult(supabaseAdmin.from('class_unlocks').insert([payload]).select().single()),
  fetchClassFamilyRows: async () => {
    // returns raw rows or null on failure; caller applies computeVersionFamily
    try {
      const { data, error } = await supabaseAdmin.from('classes').select('id, base_class_id, rules_edition');
      if (error || !Array.isArray(data)) { if (error) console.error(error); return null; }
      return data;
    } catch (e) { console.error(e); return null; }
  },
  // activeUnlockRows / unlockedClassRows / unlockedClassIdRows / fetchClassByIdAdmin /
  // fetchClassesForAgentAdmin — move the queries at models/class.js:130,192,214,345,311.
};
```
Add a light `services/class/repository.test.js` that asserts the module exports every method name above (guards against a missed extraction); deep behavior is covered by the model/service tests that already exercise these paths.

- [ ] **Step 4: Rewrite `models/class.js`** to delegate: `require('../services/class/repository')`, delete the `supabaseAdmin` import and the inline adapter. Each former admin function now calls the repository and keeps its non-admin logic. The service is instantiated with the repository (see Step 5). Keep every exported function name in `module.exports` unchanged.

- [ ] **Step 5: Update `services/class/service.js`** — capability methods take `actor` first and enforce policy by throwing:
```js
const { AuthorizationError } = require('../../util/errors');
const { canManageClass, canMintUnlockCodes } = require('./policy');
const { normalizeClassInput } = require('./input');
// constructor receives the repository (was: adapter)
async updateClass(actor, id, input) {
  const { data: existing, error } = await this.repo.fetchClassByIdAdmin(id);
  if (error) return { data: null, error };
  if (!existing) throw new AuthorizationError('Class not found', { reason: 'not_found' });
  if (!canManageClass(actor, existing)) throw new AuthorizationError('Not the class owner', { reason: 'not_owner' });
  return this.repo.updateClass(id, normalizeClassInput(input));
}
```
`createClass(actor, input)` needs no ownership check (creator becomes owner) — set `created_by` from `actor.profileId`. `deleteClass(actor, id)` mirrors `updateClass`. `mintUnlockCodes(actor, params)` throws unless `canMintUnlockCodes(actor)`. Update `service.test.js` to (a) pass an actor, (b) assert denials **throw** `AuthorizationError` (was: returned `{error}`), (c) assert authorized calls reach the repo. Provide a fake repo in tests (same shape as the old fake adapter).

- [ ] **Step 6: Rewire `routes/classes.js`** — replace the direct owner-or-admin check at `classes.js:664-668` (for `PUT /classes/:id`) with `actorFromLocals(res.locals)` passed into `classService.updateClass(actor, id, input)`; wrap the handler in `asyncHandler`. Do the same for create/delete/unlock-code routes. Remove now-dead route-level authz that the service now owns. The route imports no `supabaseAdmin`.

- [ ] **Step 7: Green gate** — `bun run test:unit`, `bun run test:http` exit 0. Grep gate for this slice: `grep -rn "supabaseAdmin" models/class.js routes/classes.js` → zero.
- [ ] **Step 8: Commit** — `refactor: move class privileged access behind repository + actor policy (ar-ezes)`

---

### Task 3: `profile` domain — reference for a new service with self-only authz

**Files:** Create `services/profile/{repository,service,policy,policy.test,service.test}.js`; modify `models/profile.js`, `routes/profile.js`.

**Admin sites** (`models/profile.js`): `getProfile` self-read (25) + `class_unlocks` grant-gate read (45); `getProfileByIdAdmin` (72); `getProfileByNameAdmin` (77); `createProfile` insert (83); `updateUser` `auth.admin.updateUserById` (134) + `profiles` update (139); `setDiscordId` update (145); `searchProfilesAdmin` (179).

**Repository methods:** `fetchOwnProfile(userId)`, `fetchStarterUnlockRows(userId)`, `fetchProfileByIdAdmin(id)`, `fetchProfileByNameAdmin(name)`, `insertProfile(row)`, `updateAuthUser(userId, attrs)`, `updateProfileByUserId(userId, fields)`, `updateDiscord(userId, discordId, discordEmail)`, `searchProfilesAdmin(nameQuery)`.

**Policy** (`services/profile/policy.js`) — all profile mutations act on **self**:
```js
const { isAdmin, isSystem } = require('../../util/actor');
// Actor may mutate the profile owned by targetUserId (self), or is admin/system.
const canMutateOwnProfile = (actor, targetUserId) => {
  if (isSystem(actor) || isAdmin(actor)) return true;
  return !!actor && !!actor.userId && actor.userId === targetUserId;
};
module.exports = { canMutateOwnProfile };
```
`policy.test.js`: self → true; other user → false; admin/system → true.

**Service capabilities** (`services/profile/service.js`): `updateUser(actor, userId, email, password, fields)`, `setDiscordId(actor, userId, discordId, discordEmail)`, `createProfileForUser(actor, user)`. Each throws `AuthorizationError` unless `canMutateOwnProfile(actor, userId)`, then delegates to the repository. Because the routes always act on `res.locals.user.id`, denial is only reachable if an actor's id diverges from the target — the test asserts that a mismatched actor throws.

**Model:** `models/profile.js` delegates through the service/repository, drops `supabaseAdmin`. `getProfile` keeps its create-on-PGRST116 logic but reads via `repository.fetchOwnProfile` and creates via `service.createProfileForUser(SYSTEM_ACTOR, user)` (the self-provisioning path acts on the just-verified user; `getProfileByIdAdmin`/`getProfileByNameAdmin`/`searchProfilesAdmin` become thin pass-throughs to repository reads (they are `requireAdmin`-gated at their routes — no per-record ownership).

**Routes:** `routes/profile.js` builds `actor = actorFromLocals(res.locals)`, passes to `updateUser`/`setDiscordId`; wrap those handlers in `asyncHandler`. The `PUT /`, `POST /discord/sync`, `POST /discord/clear` handlers currently rely on `isAuthenticated` + self-scoping — keep `isAuthenticated`; the service now enforces self-authz explicitly.

**Tests:** policy unit tests; a service test that a mismatched actor throws and a self actor succeeds (fake repository). Green gate. Grep `models/profile.js routes/profile.js` → zero `supabaseAdmin`.

**Commit:** `refactor: move profile privileged access behind repository + self-authz policy (ar-ezes)`

---

### Task 4: `rules` domain

**Files:** Create `services/rules/{repository,service,policy,policy.test,service.test}.js`; modify `models/rules.js`, `routes/library.js`.

**Admin sites** (`models/rules.js`, service-role only): `listRulesPdfUnlocks` read (66, PURE-READ, admin-manage listing), `createRulesPdfUnlockCodes` insert (143, COMMAND, **admin-only**), `getRulesPdfFamilyIds` read (185, authz-support), `canViewRulesPdf` unlock read (220, authz-support). The other rules mutations use the anon client and are **out of scope** — do not touch them.

**Repository methods:** `listUnlockGrantsAdmin(pdfId)`, `insertUnlockCodes(rows)`, `fetchPdfFamilyIdsByTitle(title)`, `fetchActiveUnlockForUser({ userId, familyIds })`.

**Policy** (`services/rules/policy.js`): `canMintRulesUnlockCodes(actor) = isAdmin(actor) || isSystem(actor)`. Test: admin/system true; user false.

**Service:** `mintUnlockCodes(actor, params)` throws unless `canMintRulesUnlockCodes(actor)`, then `repository.insertUnlockCodes`. `getRulesPdfFamilyIds`/`canViewRulesPdf` are authorization-support reads used by the view path — expose them through the service as plain (non-throwing) reads that consult the repository; the view route already gates via `canViewRulesPdf`.

**Model/routes:** `models/rules.js` delegates and drops `supabaseAdmin`. `routes/library.js` `POST /library/:id/codes` (`requireAdmin`) builds the actor and calls `rulesService.mintUnlockCodes(actor, …)` under `asyncHandler`. `createdByProfileId` stays server-set from `res.locals.profile.id`.

**Tests + gate + commit:** `refactor: move rules privileged access behind repository + admin policy (ar-ezes)`

---

### Task 5: `pdf` domain (storage adapter)

**Files:** Create `services/pdf/repository.js` (+ a thin `services/pdf/service.js` if a capability seam helps; storage ops themselves carry no per-record ownership — the *calling* domain authorizes); modify `models/pdf.js`, and the call sites in `routes/classes.js`/`routes/library.js` only insofar as they import `supabaseAdmin` (they do not — they call `models/pdf.js`).

**Admin sites** (`models/pdf.js`, storage): upload (33), remove-previous (49), `getSignedPdfUrl` (93), `deletePdfObject` remove (106).

**Repository methods** (`services/pdf/repository.js`): `uploadObject(bucket, path, bytes, opts)`, `removeObject(bucket, path)`, `createSignedUrl(bucket, path, ttl)`. These are the only `supabaseAdmin.storage` consumers.

**Policy:** none inside `pdf` — the *class*/*rules* callers own authorization (class PDF: owner-or-admin, already enforced by `canManageClass` in Task 2 and the class-update route; rules PDF: `requireAdmin`). Document this in a header comment: "pdf storage is a persistence adapter; authorization belongs to the owning domain's policy."

**Model:** `models/pdf.js` keeps its validation/orchestration (`storeClassPdf`, `storeRulesPdf`, `deletePdfObject`, `getSignedPdfUrl`) but performs storage I/O via `services/pdf/repository.js`; drops `supabaseAdmin`.

**Tests:** a repository export-shape test; behavior stays covered by existing class/library PDF tests. Confirm `getSignedPdfUrl`'s view gating (`canViewClassPdf`/`canViewRulesPdf`) is unchanged. Green gate. Grep `models/pdf.js` → zero `supabaseAdmin`.

**Commit:** `refactor: move pdf storage access behind repository (ar-ezes)`

---

### Task 6: `badge` domain

**Files:** Create `services/badge/{repository,service,policy,policy.test,service.test}.js`; modify `models/badge.js`, `routes/badges.js`.

**Admin sites** (`models/badge.js`): counters `getMissionCounters` (10,19 PURE-READ), `recalculateMilestoneBadges` catalog read (57) + upsert (75, COMMAND system), `getMissionProfileIds` reads (105,106 COMMAND-support), `badgeImageUrl` storage (118 PURE-READ), `listProfileBadges` (129 PURE-READ), `getProfileBadges` catalog (182 PURE-READ), `getBadgeCatalog` (214 PURE-READ), `findGrantableBadge` (232, authz-support), `grantBadge` upsert (254, COMMAND **admin-only**), `revokeBadge` delete (272, COMMAND **admin-only**).

**Repository methods:** `countMissionsPlayed(profileId)`, `countMissionsHosted(profileId)`, `fetchActiveMilestoneBadges()`, `upsertProfileBadges(rows)`, `fetchMissionHostId(missionId)`, `fetchMissionCharacterCreators(missionId)`, `publicBadgeImageUrl(path)`, `listProfileBadgeRows(profileId)`, `fetchBadgeCatalog()`, `fetchGrantableBadgeBySlug(slug)`, `upsertGrantedBadge(row)`, `deleteProfileBadge({ profileId, badgeId })`.

**Policy** (`services/badge/policy.js`): `canGrantBadge(actor) = isAdmin(actor)`; `canRevokeBadge(actor) = isAdmin(actor)`. The milestone-category prohibition (`findGrantableBadge` blocks `category === 'milestone'`) stays as a domain guard inside the service, not the policy. `recalculateMilestoneBadges` is invoked with `SYSTEM_ACTOR` from mission/character hooks — policy grants system unconditionally, but recalc has no policy call at all (it is system-only by construction; expose it as `recalcMilestones(SYSTEM_ACTOR, profileId)` or keep it internal to the badge service and only callable via the domain).

**Service capabilities:** `grantBadge(actor, { targetProfileId, slug, ... })` throws unless `canGrantBadge(actor)`, then enforces the milestone guard, then `repository.upsertGrantedBadge`. `revokeBadge(actor, { targetProfileId, slug })` mirrors. Pure-read helpers stay non-throwing reads through the repository.

**Model/routes:** `models/badge.js` delegates, drops `supabaseAdmin`; preserve the counter comments (private missions must count). `routes/badges.js` `POST /grant` and `POST /revoke` (`isAuthenticated, requireAdmin`) build the actor and call the service under `asyncHandler`.

**Tests:** policy unit tests (admin grants, non-admin throws); service test that milestone slug is rejected and a non-admin actor throws. Green gate.

**Commit:** `refactor: move badge privileged access behind repository + admin policy (ar-ezes)`

---

### Task 7: `agent-token` domain

**Files:** Create `services/agent-token/{repository,service,policy,policy.test,service.test}.js`; modify `models/agent-token.js`. (No route changes yet; `util/auth.js`'s `verifyAgentToken` usage stays, now via the repository. `routes/agent.js`'s `agent_api_tokens` lookup moves here in Task 8.)

**Admin sites** (`models/agent-token.js`): `createAgentToken` insert (30, COMMAND self), `listAgentTokens` read (61, self read), `revokeAgentToken` update (86, COMMAND self-agent), `verifyAgentToken` lookup (110, auth read) + `last_used_at` update (122, system write). Plus, owned by this domain but currently in `routes/agent.js:94`: the `agent_api_tokens` `select('id, profile:profile_id(id,name)')` by id lookup (moved in Task 8).

**Repository methods:** `insertToken(row)`, `listTokens({ userId, profileId, includeRevoked })`, `revokeToken({ tokenId, userId, profileId })` (keep the `.eq('user_id').eq('profile_id').is('revoked_at', null)` scoping), `findTokenByHash(hash)`, `touchLastUsed(tokenId)`, `fetchTokenWithProfile(tokenId)` (for the Task-8 claim lookup).

**Policy** (`services/agent-token/policy.js`): `canManageOwnTokens(actor, ownerProfileId) = isAdmin/isSystem || actor.profileId === ownerProfileId`. `createAgentToken`/`revokeAgentToken` act on the caller's own profile; `verifyAgentToken` is the authentication primitive (no actor — it *produces* the actor) and does not go through policy.

**Service:** `createToken(actor, { name })` (owner = actor.profileId; throws only if a mismatched profileId is supplied), `revokeToken(actor, { tokenId })`, `listTokens(actor, opts)`. `verifyAgentToken` stays a plain function (used by middleware) that reads via the repository and issues the `last_used_at` write with `SYSTEM_ACTOR` semantics (no policy).

**Model:** `models/agent-token.js` delegates, drops `supabaseAdmin`. Keep `AGENT_TOKEN_PREFIX` export and `verifyAgentToken`'s external contract (used by `util/auth.js` and its tests) identical.

**Tests:** policy unit tests; service test that revoking another profile's token throws; verify `verifyAgentToken` still returns the `{ data: { userId, profile, tokenId, tokenName, tokenHint }, error }` shape `util/auth.js` depends on. Green gate.

**Commit:** `refactor: move agent-token privileged access behind repository + owner policy (ar-ezes)`

---

### Task 8: `bot-link` domain + `routes/agent.js` + `routes/bot-link.js`

Depends on Task 7 (agent-token repository owns the `agent_api_tokens` lookup).

**Files:** Create `services/bot-link/{repository,service,policy,policy.test,service.test}.js`; modify `models/bot-link.js`, `routes/agent.js`, `routes/bot-link.js`.

**Admin sites** — `models/bot-link.js`: `cleanupStaleLinks` delete (42, system), `countRecentPendingForDiscordId` read (50, rate-limit gate), `createPendingLink` insert (76, public), `getPendingLinkByCode` read (92), `attachTokenToPendingLink` update (101, authed web user), `consumePendingLink` update (124, public/possession). **`routes/agent.js`**: `agent_api_tokens` lookup (94 → **agent-token repo**, `fetchTokenWithProfile`), `pending_bot_links_raw_tokens` read (103) + delete (112 → **bot-link repo**). **`routes/bot-link.js`**: `pending_bot_links_raw_tokens` insert (53 → **bot-link repo**).

**Repository methods** (`services/bot-link/repository.js`): `deleteStaleLinks(olderThanIso)`, `countRecentPending(discordUserId, sinceIso)`, `insertPendingLink(row)`, `fetchPendingByCode(code)`, `attachToken({ code, agentTokenId })` (keep unconsumed/unexpired/not-already-attached guards), `consumePending({ code, discordUserId })`, and the raw-token stash: `stashRawToken({ agentTokenId, rawToken })`, `fetchRawToken(agentTokenId)`, `deleteRawToken(agentTokenId)`.

**Policy** (`services/bot-link/policy.js`) — authorization here is by protocol/possession, not identity, so keep it explicit and documented:
- `createPendingLink`, `consumePendingLink`, and the raw-token claim (`fetchRawToken`+`deleteRawToken`) are **public by design** (the Discord bot is unauthenticated) — authorized by possession of a valid, matching, token-attached `code` + `discord_user_id`. Policy functions return `true` for these but exist so the design records the decision (e.g. `canClaimByPossession(link, { code, discordUserId }) = link && link.code === code && link.discord_user_id === discordUserId && !link.consumed_at && link.agent_token_id`).
- `attachTokenToPendingLink` is performed by the authenticated web user who created the token — `canAttachToken(actor, link) = isSystem(actor) || (!!actor.profileId && link && link.agent_token_id == null)` (the token was just minted for this session).

**Service:** `startLink({ discordUserId })` (public; rate-limit via repository), `claimLink({ code, discordUserId })` (public; consume + disclose-and-purge the raw token, all via repository; throw `AuthorizationError` only if possession check fails — currently a 4xx JSON error, preserve status), `confirmLink(actor, { tokenName })` (authenticated; create token via agent-token service, stash raw token, attach). Preserve today's exact HTTP responses in the routes (`202 pending`, `404/410/409`, etc.).

**Routes:** `routes/agent.js` — remove `supabaseAdmin` import (19); the claim handler calls `botLinkService.claimLink(...)` and `agentTokenRepository.fetchTokenWithProfile(...)` via the agent-token service. `routes/bot-link.js` — remove `supabaseAdmin` import (12); the confirm handler calls `botLinkService.confirmLink(actor, ...)`. Public routes need no `asyncHandler`-403 mapping but must still forward errors; keep their existing explicit JSON error handling and status codes. `routes/bot-link.js:18` `isAuthenticated` stays.

**Tests:** policy unit tests for possession + attach; service tests for the rate-limit gate and a possession-mismatch claim; preserve the existing `routes/bot-link.test.js` behavior (update its `supabaseAdmin` mock to the new repository seam). Green gate. Grep `routes/agent.js routes/bot-link.js models/bot-link.js` → zero `supabaseAdmin`.

**Commit:** `refactor: move bot-link + agent-route privileged access behind repositories (ar-ezes)`

---

### Task 9: `mission` domain (existing service; resolve no-authz flags)

**Files:** Create `services/mission/{repository,policy,policy.test}.js`; modify `services/mission/service.js` (+ `service.test.js`), `models/mission.js`, and mission-edit routes in `routes/missions.js`.

**Admin sites** (`models/mission.js`): `setUnregisteredCharacterNames` (128), `addMissionEditor` (406), `removeMissionEditor` (421), `canEditMission` reads (442,459), `isCreator` read (485), and the inline adapter (708–724: `getHost`, `createMissionRow`, `updateMissionRow`, `deleteMissionRow`, `getCharacterCreator`, `upsertMissionCharacter`, `deleteMissionCharacter`, `mergeMissions` RPC).

**Repository:** move the inline adapter verbatim into `services/mission/repository.js`, plus `updateUnregisteredNames(missionId, names)`, `upsertEditor(row)`, `deleteEditor({ missionId, profileId })`, `fetchMissionPermissionRow(missionId)` (creator_id, host_id), `fetchEditorRow({ missionId, profileId })`, `fetchCreatorId(missionId)`.

**Policy** (`services/mission/policy.js`) — reproduce `canEditMission`/`isCreator`, now pure over pre-loaded rows:
- `canEditMission(actor, { mission, editorRow })` = system/admin, or `actor.profileId` ∈ {`mission.creator_id`, `mission.host_id`} or `editorRow` present.
- `isMissionCreator(actor, mission)` = system/admin or `actor.profileId === mission.creator_id`.

**Resolve the flagged no-authz mutations** (this is the security-hardening core of the task):
- `addCharacterToMission` / `removeCharacterFromMission`: today no check. New rule — the actor must pass `canEditMission`, **except** the internal backfill path (`routes/characters.js` `createBackfillMissionForCharacter`) which calls with `SYSTEM_ACTOR`. Capability: `addCharacter(actor, { missionId, characterId })` loads the permission row, throws unless `canEditMission`. Update the backfill caller to pass `SYSTEM_ACTOR`.
- `addMissionEditor` / `removeMissionEditor`: today gated only at the route. New rule — capability requires `isMissionCreator(actor, mission)`; throws otherwise. Verify the routes that expose editor management and pass the actor.
- `setUnregisteredCharacterNames`: preserve today's `canEditMission` gate, now via the policy inside the capability.

**Service:** convert `createMission`/`updateMission`/`deleteMission`/`addCharacter`/`removeCharacter`/`mergeMissions` to **throw** `AuthorizationError` on denial (was `{ error: 'Unauthorized' }`), keeping the same underlying checks (`updateMission` → `canEditMission`; `deleteMission` → creator-only `.eq('creator_id')` preserved; `mergeMissions` → dual `canEditMission`). Add `setUnregisteredNames`, `addEditor`, `removeEditor`, `addCharacter`, `removeCharacter` capabilities with the rules above. Update `service.test.js` to assert throws and to cover the newly-gated commands (including the `SYSTEM_ACTOR` backfill path).

**Model/routes:** `models/mission.js` delegates, drops `supabaseAdmin`. Callers of the changed functions build actors; wrap route handlers in `asyncHandler`. Update `routes/missions.js` and any mission-edit callers; internal callers use `SYSTEM_ACTOR`.

**Tests + gate:** Grep `models/mission.js` → zero `supabaseAdmin`. Green gate.

**Commit:** `refactor: move mission privileged access behind repository + policy; close addCharacter/editor authz gaps (ar-ezes)`

---

### Task 10: `character` domain + `routes/characters.js` (net-new route surface)

**Files:** Create `services/character/{repository,policy,policy.test}.js`; modify `services/character/service.js` (+ tests), `models/character.js`, `routes/characters.js`.

**Admin sites** — `models/character.js`: `deleteCharacter` probe+write (150,155), pure-read helpers `getCharacterTraits/Gear/Abilities/AbilityPerks` (162,168,213,262), `markCharacterDeceased` probe+write (364,370), `upgradeCharacterClass` probe+write (393,411), `searchCharactersForAgent` (554), `getCharacterForAgent` (587), and the inline adapter (618–662). **`routes/characters.js`**: `getOwnedCharacterForMutation` probe (86), `updateOwnedCharacterFields` write (103), `appendCharacterPerks` reads+writes (134,141,193,199,239), derivation reads (614,615,680,681,1389,1390,1399), level-up credit read (1344) + offscreen write (1377).

**Repository** (`services/character/repository.js`): move the inline adapter verbatim, plus `fetchCharacterOwnership(id)` (id, creator_id, class_id), `deleteCharacter({ id, creatorId })`, `setDeceased({ id, creatorId })`, `updateClass({ id, creatorId, classId, className })`, `updateOwnedFields({ id, creatorId, fields })`, the perk methods (`fetchAllowedAbilityIds`, `fetchExistingPerks`, `insertPerks`, `updatePerkLinks`), the trait/gear/ability/perk read helpers, and the agent-search reads. All `supabaseAdmin` for character lives here.

**Policy** (`services/character/policy.js`): `canMutateCharacter(actor, character)` = system/admin or `actor.profileId === character.creator_id`. (Reproduces the double-guard JS side; repository keeps the `.eq('creator_id')` filter.)

**Service capabilities** — existing `createCharacter`/`updateCharacter` convert to **throw**; add `deleteCharacter(actor, id)`, `markDeceased(actor, id, name)`, `upgradeClass(actor, id, targetClassId)`, and the **net-new** `updateStats(actor, id, fields)` and `levelUp(actor, id, payload)` (the `PATCH /:id/stats` and `POST /:id/level-up` route logic, including perk append and offscreen-credit spend, moved behind the service). Each loads ownership via the repository, throws unless `canMutateCharacter`, then mutates. The backfill/level-up internal mission writes call the mission service with `SYSTEM_ACTOR` (from Task 9).

**Model/routes:** `models/character.js` delegates, drops `supabaseAdmin`. `routes/characters.js` — remove `supabaseAdmin` import (23) and the inline helpers `getOwnedCharacterForMutation`/`updateOwnedCharacterFields`/`appendCharacterPerks` (their logic now lives in the service/repository — **delete**, do not leave behind per No-Dead-Code); handlers build the actor, call capabilities, and are wrapped in `asyncHandler`. Derivation pure-reads move to repository methods the route calls.

**Tests:** policy unit tests; service tests that a non-creator actor throws for delete/deceased/upgrade/stats/level-up and the creator succeeds; existing character route/wizard/level-up tests updated to the new seam. Grep `models/character.js routes/characters.js` → zero `supabaseAdmin`. Green gate.

**Commit:** `refactor: move character privileged access + stats/level-up routes behind repository + policy (ar-ezes)`

---

### Task 11: `lfg` domain (existing service; large agent surface)

**Files:** Create `services/lfg/{repository,policy,policy.test}.js`; modify `services/lfg/service.js` (+ tests), `models/lfg.js`, `routes/lfg.js`.

**Admin sites** (`models/lfg.js`, 30): `deleteLfgPost` (152,157), `joinLfgPost` reads+write (172,185,201), `syncConduitHostId` (234,242), `updateJoinRequest` (252,262), `deleteJoinRequest` (276,281), inline adapter (292–296), `closeLfgPost` (342,352), and the agent surface `getPostsWithRequestsBy` (430), `getPostsByJoiner` (449,458), `getPostForAgent` (509), `joinForAgent` (575,586,598), `leaveForAgent` (618), `updateRequestForAgent` (643,657), `listEligibleCharactersForAgent` (669).

**Repository** (`services/lfg/repository.js`): move the inline adapter verbatim, plus named methods for each site above (post CRUD/close, join-request CRUD, conduit sync, agent listings, eligibility reads). All `supabaseAdmin` for lfg lives here.

**Policy** (`services/lfg/policy.js`): `canManagePost(actor, post)` = system/admin or `actor.profileId === post.creator_id` (covers update/delete/close). `canModerateJoinRequest(actor, post)` = system/admin or host (`actor.profileId === post.creator_id`). `canJoinAsCharacter(actor, character)` = `actor.profileId === character.creator_id && !character.is_deceased` (player joins). `canManageOwnJoinRequest(actor, request)` = `actor.profileId === request.profile_id` (leave/withdraw).

**Resolve flagged no-authz mutations:** `updateJoinRequest` (approve/reject) — enforce `canModerateJoinRequest` in the capability (was caller-enforced). `deleteJoinRequest` (leave) — enforce `canManageOwnJoinRequest` (or host moderation) in the capability. `syncConduitHostId` is internal denormalization — `SYSTEM_ACTOR`, no policy.

**Service:** convert `createPost`/`updatePost` to **throw**; add `deletePost`, `closePost`, `join`, `updateJoinRequest`, `leave`, and actor-aware agent-surface capabilities (`listForAgent`, `getForAgent`, `joinForAgent`, `leaveForAgent`, `updateRequestForAgent`, `listEligibleCharactersForAgent`) that load via repository, apply policy, throw on denial. Preserve the agent routes' current status codes (`not_host` → 403, etc.). Update `service.test.js` for throws + the newly-gated commands.

**Model/routes:** `models/lfg.js` delegates, drops `supabaseAdmin`. `routes/lfg.js` and the agent lfg routes build actors, call capabilities, `asyncHandler`. Grep `models/lfg.js` → zero `supabaseAdmin`. Green gate.

**Commit:** `refactor: move lfg privileged access behind repository + policy; close join-request authz gaps (ar-ezes)`

---

### Task 12: Agent admin-read path cleanup + final grep gate

**Files:** Modify `util/auth.js` (`isAgentAuthenticated`), any model read functions still relying on `res.locals.supabase === supabaseAdmin` for agent requests, `util/auth.test.js`.

- [ ] **Step 1:** Remove `res.locals.supabase = supabaseAdmin` at `util/auth.js:149`. For agent requests, `res.locals.supabase` becomes the RLS/anon client (or is left unset where every read on the agent path now goes through a repository privileged read). The agent `actor` already carries `role`/`profileId`; agent read capabilities (added in Tasks 2/10/11 for class/character/lfg) authorize via that actor, not via an admin request client.
- [ ] **Step 2:** Audit every model read function that takes a `client`/`supabase` param and was being handed `supabaseAdmin` on the agent path (e.g. `getCharacter(id, res.locals.supabase)`, `getClass(id, res.locals.supabase)` in agent handlers). Route those through the domain's repository privileged read instead, so removing the admin client does not change what an agent can see.
- [ ] **Step 3:** Remove the now-unused `supabaseAdmin` import from `util/auth.js`. Update `util/auth.test.js` (it currently mocks `models/_base` including `supabaseAdmin`; adjust to the new expectation that `isAgentAuthenticated` no longer assigns the admin client).
- [ ] **Step 4: Final gate** — `grep -rn "supabaseAdmin" --include='*.js' routes/ util/ models/` returns hits **only** in `models/_base.js`. `grep -rn "supabaseAdmin" services/` returns hits only in `services/*/repository.js`. `bun run test:unit` and `bun run test:http` exit 0.
- [ ] **Step 5: Commit** — `refactor: remove agent admin-read path; supabaseAdmin now only in _base + repositories (ar-ezes)`

---

## Self-review notes (author)

- **Spec coverage:** (a) no route imports service-role client — Tasks 2–12 drop every route/`util` import; verified by Task 12 grep gate. (b) repositories encapsulate privileged persistence — every domain gets `services/<domain>/repository.js` as sole `supabaseAdmin` consumer. (c) services receive actor context + capability methods — every mutation becomes `capability(actor, …)` with a policy. (d) authz tests per privileged command — each domain adds `policy.test.js` and service throw-tests.
- **Decisions surfaced for the pre-flight review (see handoff):** (1) existing services migrate from returning `{error:'Unauthorized'}` to throwing `AuthorizationError`; (2) previously-unauthorized mutations (`addCharacterToMission`, editor management, `updateJoinRequest`, `deleteJoinRequest`, stats/level-up route helpers) gain policy checks plus a `SYSTEM_ACTOR` bypass for internal/backfill callers.
- **Type consistency:** actor is `{ userId, profileId, role }` everywhere; repositories return `{ data, error }`; only the service policy step throws.
- **Ordering safety:** each domain task is self-contained and leaves the suite green; Task 8 depends on Task 7; Task 12 runs last because it removes the compatibility admin-read client the agent path uses until every agent read is behind a repository.
