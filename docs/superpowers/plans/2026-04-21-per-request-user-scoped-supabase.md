# Per-Request User-Scoped Supabase Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore RLS-as-source-of-truth for user-scoped reads by creating per-request JWT-carrying Supabase clients, so the anon-client-RLS-silently-returns-empty bug class cannot recur.

**Architecture:** Auth middleware creates a per-request Supabase client with the caller's JWT in `global.headers.Authorization` (using the existing `createUserClient(accessToken)` factory in `models/_base.js`). The client is attached to `res.locals.supabase`. Model read functions accept an optional trailing `client` parameter (default: the anon `supabase` export, preserving current behavior for unauthenticated callers). Routes pass `res.locals.supabase`. Agent-authenticated routes continue using `supabaseAdmin` with app-level authz via `actor` — this path is unchanged. Write functions continue using `supabaseAdmin` since authz is enforced at the caller.

**Tech Stack:** Node.js, Express, `@supabase/supabase-js`, `bun:test`, Postgres RLS

---

## Out of scope

- Converting writes to use `res.locals.supabase` — writes are already `supabaseAdmin` + app authz, the pattern is fine, don't churn.
- Reverting the previously-admin-patched reads from commits `48b5093`/`cc1a596` — they work correctly. Optional cosmetic work, not required for this plan.
- Agent endpoints (`routes/agent.js`) — agents have no Supabase JWT. Their model functions (`getCharacterForAgent`, `searchCharactersForAgent`, `listClassesForAgent`, etc.) stay on `supabaseAdmin`.

## Files mapped

- `util/auth.js` — middleware plumbing (`isAuthenticated`, `authOptional`, `isAgentAuthenticated` set `res.locals.supabase`)
- `util/supabase.js` — aggregate re-export; add `createUserClient` to the exported API
- `models/_base.js` — already exports `createUserClient`, no change
- `models/mission.js` — 6 read functions + callers
- `models/character.js` — `getOwnCharacters`, `getCharacter`, + callers
- `models/lfg.js` — `fetchProfileById`, `getLfgPost`, `getLfgJoinRequests`, `getLfgJoinedPosts`, join-post character fetch + callers
- `models/class.js` — `listUnlockCodes` + callers
- `routes/missions.js`, `routes/characters.js`, `routes/lfg.js`, `routes/classes.js` — pass `res.locals.supabase`
- New test: `util/auth.test.js` for middleware plumbing
- Extend existing tests for each migrated model function

## Shared test helper

Every migrated model function gets a tiny test that verifies it dispatches to the passed client, not the module-level default. Use this pattern (don't repeat code blocks in every task — just reference this helper):

```js
// Helper: makes a fake client that records the table it was hit with.
const makeSpyClient = (tableToRows = {}) => {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const rows = tableToRows[table] ?? [];
      const result = { data: rows, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (onF, onR) => Promise.resolve(result).then(onF, onR)
      };
      return chain;
    }
  };
};
```

---

## Phase 1: Middleware plumbing

### Task 1: Middleware sets `res.locals.supabase`

**Files:**
- Modify: `util/auth.js` (inside `isAuthenticated` around line 54, `authOptional` around line 93, `isAgentAuthenticated` around line 142)
- Create: `util/auth.test.js`

- [ ] **Step 1.1: Write the failing test**

Create `util/auth.test.js` with a test that exercises each middleware and asserts `res.locals.supabase` is set correctly:

```js
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

const realBase = require('../models/_base');

// Fakes we can identity-compare against.
const fakeAnon = { __name: 'anon', auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
const fakeAdmin = { __name: 'admin' };
const createdUserClients = [];
const fakeCreateUserClient = (token) => {
  const c = { __name: 'user', __token: token };
  createdUserClients.push(c);
  return c;
};

mock.module('../models/_base', () => ({
  supabase: fakeAnon,
  supabaseAdmin: fakeAdmin,
  anonKey: 'x',
  createUserClient: fakeCreateUserClient
}));

// Stub the other deps auth.js pulls in to avoid real DB / network.
mock.module('./supabase', () => ({
  getUserFromToken: async (token) => token === 'valid-jwt' ? { id: 'u1' } : false,
  getProfile: async () => ({ id: 'p1', user_id: 'u1' })
}));
mock.module('./system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../models/agent-token', () => ({
  verifyAgentToken: async () => ({ data: { userId: 'u1', profile: { id: 'p1' }, tokenId: 't1', tokenName: 'n', tokenHint: 'h' }, error: null }),
  AGENT_TOKEN_PREFIX: 'aat_'
}));
mock.module('./nav-loader', () => ({ populateNavItems: async () => {} }));

delete require.cache[require.resolve('./auth')];
const { isAuthenticated, authOptional, isAgentAuthenticated } = require('./auth');

afterAll(() => {
  mock.module('../models/_base', () => realBase);
  delete require.cache[require.resolve('./auth')];
});

const makeRes = () => ({ locals: {}, header() {}, set() {}, status() { return this; }, end() {}, redirect() {} });
const makeReq = (headers = {}) => ({ headers, get: (h) => headers[h.toLowerCase()], originalUrl: '/x' });

test('isAuthenticated attaches a user-scoped client built from the bearer token', async () => {
  const req = makeReq({ authorization: 'Bearer valid-jwt' });
  const res = makeRes();
  let nextCalled = false;
  await isAuthenticated(req, res, () => { nextCalled = true; });
  expect(nextCalled).toBe(true);
  expect(res.locals.supabase.__name).toBe('user');
  expect(res.locals.supabase.__token).toBe('valid-jwt');
});

test('authOptional without a token attaches the anon client', async () => {
  const req = makeReq({});
  const res = makeRes();
  await authOptional(req, res, () => {});
  expect(res.locals.supabase.__name).toBe('anon');
});

test('authOptional with a token attaches the user-scoped client', async () => {
  const req = makeReq({ authorization: 'Bearer valid-jwt' });
  const res = makeRes();
  await authOptional(req, res, () => {});
  expect(res.locals.supabase.__name).toBe('user');
});

test('isAgentAuthenticated attaches the admin client', async () => {
  const req = makeReq({ 'x-agent-token': 'aat_stub' });
  const res = makeRes();
  await isAgentAuthenticated(req, res, () => {});
  expect(res.locals.supabase.__name).toBe('admin');
});
```

- [ ] **Step 1.2: Run the test and watch all four cases fail**

```
cd /home/dave/code/agent-resources && bun test util/auth.test.js
```
Expected: all 4 tests fail with `expect(res.locals.supabase).toBe(...)` — `res.locals.supabase` is undefined.

- [ ] **Step 1.3: Wire up the middleware**

Edit `util/auth.js`:

At the top, add:
```js
const { supabase, supabaseAdmin, createUserClient } = require('../models/_base');
```

Inside `isAuthenticated`, after `res.locals.user = user;` (line 55), add:
```js
res.locals.supabase = createUserClient(authToken);
```

Inside `authOptional`, after `res.locals.user = user;` equivalent (around line 93 where token path begins), add the same line. In the no-token early-return branch (line 87), set `res.locals.supabase = supabase;` before `next()`.

Inside `isAgentAuthenticated`, after `res.locals.user = { id: data.userId };`, add:
```js
res.locals.supabase = supabaseAdmin;
```

Note: `createUserClient` returns the anon client when `authToken` is falsy (see `_base.js:28-34`), so the `authOptional` token path is correct.

- [ ] **Step 1.4: Run the test and confirm all four pass**

```
bun test util/auth.test.js
```
Expected: 4/4 pass.

- [ ] **Step 1.5: Run the full suite**

```
bun test
```
Expected: 64 pass, 0 fail (60 existing + 4 new).

- [ ] **Step 1.6: Commit**

```bash
git add util/auth.js util/auth.test.js
git commit -m "Attach per-request Supabase client in auth middleware

isAuthenticated and authOptional (when a bearer token is present) now
build a user-scoped Supabase client via createUserClient(token) and
attach it to res.locals.supabase, so downstream route handlers can run
RLS-gated reads that honor auth.uid(). authOptional without a token
falls back to the shared anon client; isAgentAuthenticated attaches
supabaseAdmin (agent traffic carries no JWT).

No route wires itself through res.locals.supabase yet; subsequent
commits migrate the model read paths one subsystem at a time."
```

---

## Phase 2: Mission reads (highest impact — Verrain hides 28/33 missions)

### Task 2: `getOwnMissions` accepts a client

**Files:**
- Modify: `models/mission.js:62-88`
- Modify: `routes/missions.js` (caller of `getOwnMissions`)
- Test: `models/mission.test.js` (new file)

- [ ] **Step 2.1: Write the failing test**

Create `models/mission.test.js`:

```js
const { test, expect, mock, afterAll } = require('bun:test');
const realBase = require('./_base');

const makeSpyClient = (tableToRows = {}) => {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const rows = tableToRows[table] ?? [];
      const result = { data: rows, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (onF, onR) => Promise.resolve(result).then(onF, onR)
      };
      return chain;
    }
  };
};

const defaultAnon = makeSpyClient({ missions: [] });
mock.module('./_base', () => ({
  supabase: defaultAnon,
  supabaseAdmin: makeSpyClient(),
  anonKey: 'x',
  createUserClient: () => defaultAnon
}));

delete require.cache[require.resolve('./mission')];
const { getOwnMissions } = require('./mission');

afterAll(() => {
  mock.module('./_base', () => realBase);
  delete require.cache[require.resolve('./mission')];
});

test('getOwnMissions uses the passed client (not the default anon)', async () => {
  const userClient = makeSpyClient({
    missions: [{ id: 'm1', creator_id: 'p1', characters: [] }]
  });
  const { data } = await getOwnMissions({ id: 'p1' }, userClient);
  expect(userClient.calls).toContain('missions');
  expect(defaultAnon.calls).not.toContain('missions');
  expect(data.length).toBe(1);
});

test('getOwnMissions falls back to the module-level client when no client passed', async () => {
  defaultAnon.calls.length = 0;
  await getOwnMissions({ id: 'p1' });
  expect(defaultAnon.calls).toContain('missions');
});
```

- [ ] **Step 2.2: Run the test and watch both fail**

```
bun test models/mission.test.js
```
Expected: `getOwnMissions` only takes one arg (`profile`) today — the second arg is ignored, so both assertions on `userClient.calls` fail.

- [ ] **Step 2.3: Edit `models/mission.js:62`**

Change the signature and the `supabase` reference:

```js
const getOwnMissions = async (profile, client = supabase) => {
  const { data, error } = await client
    .from('missions')
    .select(`
      *,
      characters:mission_characters(
        character:characters(
          id,
          name,
          is_deceased
        )
      )
    `)
    .eq('creator_id', profile.id)
    .order('date', { ascending: false });

  if (error) return { data: null, error };

  const transformedData = data.map(mission => ({
    ...mission,
    characters: mission.characters.map(mc => mc.character)
  }));

  return { data: transformedData, error };
};
```

- [ ] **Step 2.4: Run the test and confirm both pass**

```
bun test models/mission.test.js
```
Expected: 2/2 pass.

- [ ] **Step 2.5: Update the route caller**

In `routes/missions.js`, find the `getOwnMissions(profile)` call and change it to `getOwnMissions(profile, res.locals.supabase)`.

Run `grep -n "getOwnMissions" routes/*.js` to locate the call site.

- [ ] **Step 2.6: Full suite**

```
bun test
```
Expected: 66 pass, 0 fail.

- [ ] **Step 2.7: Manual verification**

Start the dev server (`bun dev`) and hit the My Missions page as a user with private missions. Expected: all missions appear (not just public).

This step cannot be automated without integration test infrastructure. If no dev auth token is handy, skip manual and rely on the test.

- [ ] **Step 2.8: Commit**

```bash
git add models/mission.js models/mission.test.js routes/missions.js
git commit -m "getOwnMissions: accept per-request client

Dashboard previously hid private missions because it read through the
shared anon client with no JWT. With the user-scoped client from
res.locals.supabase, auth.uid() is set and RLS returns the caller's
own rows."
```

### Task 3: `getMission` accepts a client

**Files:**
- Modify: `models/mission.js:31-60`
- Modify: `routes/missions.js`, `routes/characters.js`, `routes/lfg.js` (anywhere `getMission` is called)
- Test: `models/mission.test.js` (append)

- [ ] **Step 3.1: Append test**

```js
test('getMission uses the passed client', async () => {
  const userClient = makeSpyClient({
    missions: [{ id: 'm1', characters: [], host: null }]
  });
  await require('./mission').getMission('m1', userClient);
  expect(userClient.calls).toContain('missions');
});
```

- [ ] **Step 3.2: Run test, confirm fail**

`bun test models/mission.test.js` — new test fails because `getMission` ignores the second arg.

- [ ] **Step 3.3: Edit `models/mission.js:31`**

```js
const getMission = async (id, client = supabase) => {
  const { data, error } = await client
    .from('missions')
    .select(`... existing select ...`)
    .eq('id', id)
    .single();
  // ... unchanged body ...
};
```

- [ ] **Step 3.4: Run test, confirm pass**

- [ ] **Step 3.5: Update callers**

```bash
grep -rn "getMission(" routes/ | grep -v "getMissions("
```

For each hit, add `, res.locals.supabase` as the second arg.

- [ ] **Step 3.6: Full suite green, commit**

```bash
git add models/mission.js models/mission.test.js routes/
git commit -m "getMission: accept per-request client

Unauthenticated callers keep the public-only anon read; authenticated
routes pass res.locals.supabase so owners/hosts/editors see private
missions per RLS."
```

### Task 4: `getMissions` — exposed on public routes only

**Files:**
- Inspect: `routes/missions.js` callers of `getMissions` (no args — all-missions list)

- [ ] **Step 4.1: Locate callers**

```bash
grep -n "getMissions(" routes/ -r | grep -v "getOwnMissions\|getMissionEditors\|getMissionCharacters"
```

If the only caller is a public listing page (anon OK), leave `getMissions` as-is and skip this task. If there is an authenticated caller that needs to see private missions it hosts/edits, apply the same `client` param pattern.

- [ ] **Step 4.2: Apply if needed**

Same pattern as Task 3. Commit.

### Task 5: `getMissionEditors`, `getEditableMissions`, `searchSimilarMissions`, `getMissionCharacters`

**Files:**
- Modify: `models/mission.js` (locate each — use `grep -n "^const get\|^const search" models/mission.js`)
- Modify: route callers
- Test: `models/mission.test.js` (one assertion per function, following the Task 2 spy pattern)

- [ ] **Step 5.1: For each function, repeat the Task 2/3 cycle**

For each of `getMissionEditors`, `getEditableMissions`, `searchSimilarMissions`, `getMissionCharacters`:

1. Append a spy-client test.
2. Run, confirm fail.
3. Change signature to `(existingArgs, client = supabase)`; change `supabase.` to `client.`.
4. Run, confirm pass.
5. Update route callers to pass `res.locals.supabase`.

- [ ] **Step 5.2: Commit per function (one commit each is fine, or bundle if the diffs are small)**

```bash
git add models/mission.js models/mission.test.js routes/
git commit -m "mission reads: accept per-request client"
```

---

## Phase 3: Character reads

### Task 6: `getOwnCharacters`

**Files:**
- Modify: `models/character.js:7`
- Modify: `routes/characters.js:62-63` caller
- Test: `models/character.test.js` (append, reuse the existing `fakeAnon`/`fakeAdmin` setup)

- [ ] **Step 6.1: Append test to `models/character.test.js`**

Use the existing `makeClient` helper already in that file. Append:

```js
test('getOwnCharacters uses the passed client', async () => {
  const userClient = makeClient({
    characters: [{ id: 'c1', name: 'Whimsy', creator_id: 'p1' }]
  });
  const { getOwnCharacters } = require('./character');
  const { data } = await getOwnCharacters({ id: 'p1' }, userClient);
  expect(data.length).toBe(1);
});
```

- [ ] **Step 6.2: Run test, confirm fail**

- [ ] **Step 6.3: Edit `models/character.js:7`**

```js
const getOwnCharacters = async (profile, client = supabase) => {
  const { data, error } = await client.from('characters').select('*').eq('creator_id', profile.id);
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error };
};
```

- [ ] **Step 6.4: Route caller**

`routes/characters.js:63`:
```js
const { data: characters, error } = await getOwnCharacters(profile, res.locals.supabase);
```

- [ ] **Step 6.5: Full suite green, commit**

```bash
git add models/character.js models/character.test.js routes/characters.js
git commit -m "getOwnCharacters: accept per-request client"
```

### Task 7: `getCharacter`

**Files:**
- Modify: `models/character.js:31`
- Modify: `routes/characters.js` (multiple callers — grep)
- Test: append to `models/character.test.js`

- [ ] **Step 7.1: Append test**

```js
test('getCharacter uses the passed client for the characters SELECT', async () => {
  const userClient = makeClient({
    characters: [{ id: 'c1', name: 'Whimsy', creator_id: 'p1' }]
  });
  const { getCharacter } = require('./character');
  const { data } = await getCharacter('c1', userClient);
  expect(data.id).toBe('c1');
});
```

Note: the traits/gear/abilities sub-fetches stay on `supabaseAdmin` (already fixed). This test only covers the top-level character SELECT.

- [ ] **Step 7.2: Run, confirm fail**

- [ ] **Step 7.3: Edit `models/character.js:31`**

```js
const getCharacter = async (id, client = supabase) => {
  const { data, error } = await client.from('characters').select('*').eq('id', id).single();
  // ... keep the rest: getCharacterTraits/Gear/Abilities still use supabaseAdmin internally ...
};
```

- [ ] **Step 7.4: Route callers**

```bash
grep -n "getCharacter(" routes/characters.js
```

For each call, add `, res.locals.supabase`.

- [ ] **Step 7.5: Full suite green, commit**

```bash
git add models/character.js models/character.test.js routes/characters.js
git commit -m "getCharacter: accept per-request client"
```

---

## Phase 4: LFG reads

### Task 8: `fetchProfileById` helper

**Files:**
- Modify: `models/lfg.js` (internal helper; check exact line with `grep -n "fetchProfileById" models/lfg.js`)
- Test: `models/lfg.test.js` (new file — LFG has no test file yet; create with same `makeSpyClient` helper as mission.test.js)

- [ ] **Step 8.1: Decide on signature propagation**

`fetchProfileById` is used inside several other LFG helpers. To avoid a cascade of signature changes, take the caller's client as a threaded parameter: `fetchProfileById(id, client)`. Each public helper that uses it (`getLfgPost`, `getLfgJoinRequests`, etc.) also accepts a `client` and threads it through.

- [ ] **Step 8.2: Write tests for `getLfgPost`, `getLfgJoinedPosts`, `getLfgJoinRequests` using the spy-client pattern**

One test per function verifying the passed client is used.

- [ ] **Step 8.3: Run, confirm fail**

- [ ] **Step 8.4: Edit each function**

For each: `(existingArgs) => (existingArgs, client = supabase)`, replace `supabase.` inside with `client.`. Thread `client` into any nested calls to `fetchProfileById`.

- [ ] **Step 8.5: Update route callers in `routes/lfg.js` to pass `res.locals.supabase`**

- [ ] **Step 8.6: Manual verification — LFG list page shows creator/host names for private-profile users**

- [ ] **Step 8.7: Commit**

```bash
git add models/lfg.js models/lfg.test.js routes/lfg.js
git commit -m "lfg reads: accept per-request client"
```

### Task 9: Join-post character lookup

**Files:**
- Modify: `models/lfg.js:240`
- Test: `models/lfg.test.js` append

- [ ] **Step 9.1: Append test**

Spy-client asserting the passed client is used for the `characters` lookup inside `joinLfgPost`.

- [ ] **Step 9.2: Run, fail, edit, pass**

- [ ] **Step 9.3: Update route caller in `routes/lfg.js`**

- [ ] **Step 9.4: Full suite green, commit**

---

## Phase 5: Class unlock codes

### Task 10: `listUnlockCodes`

**Files:**
- Modify: `models/class.js:70` (or wherever `listUnlockCodes` lives — grep)
- Modify: `routes/classes.js`
- Test: extend `models/class.test.js`

- [ ] **Step 10.1: Locate**

```bash
grep -n "listUnlockCodes\|class_unlock_codes" models/class.js
```

- [ ] **Step 10.2: Spy-client test + signature change**

Same pattern. The route is admin-gated via `requireAdmin` middleware, so the authz story is unchanged.

- [ ] **Step 10.3: Commit**

```bash
git add models/class.js models/class.test.js routes/classes.js
git commit -m "listUnlockCodes: accept per-request client"
```

---

## Phase 6: Verification

### Task 11: Integration sanity check

- [ ] **Step 11.1: Start dev server, log in as user with private content**

```bash
bun dev
```

Hit these pages in the browser (or curl with a real bearer token):
- `/missions` — expect every private mission owned by the user to appear
- `/characters` — expect every private character owned by the user
- `/lfg` — expect creator names visible for any post whose creator has a private profile
- `/classes/<id>/unlock-codes` (as admin) — expect non-empty list

- [ ] **Step 11.2: Re-run full test suite from a clean state**

```bash
bun test
```

Expected: all previously-passing tests still pass; newly-added tests pass.

- [ ] **Step 11.3: Final commit if any cleanup required**

---

## Non-task reminders

- Every commit runs the full suite before pushing (`bun test` → expect 0 fails).
- Prefer small, subsystem-scoped commits over one big one. Rollback granularity matters for RLS changes.
- Do **not** touch agent routes (`routes/agent.js`, `*ForAgent` model functions) in this plan. They stay admin+actor.
- If a route needs `res.locals.supabase` but there's no auth middleware on the route, either (a) the route is public-only, in which case the function uses its default (`supabase` anon) — fine, or (b) the route needs middleware added. Decide per-case; do not silently pass `undefined`.
