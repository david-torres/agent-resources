# Code Review Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address security, correctness, and robustness issues surfaced in the 2026-04-17 code review of `agent-resources`.

**Architecture:** Five independent phases, each a self-contained improvement that leaves the app working. Phase 1 addresses user-facing security (XSS, URL schemes, search wildcards). Phase 2 fixes auth/session state correctness. Phase 3 fixes route/model bugs. Phase 4 adds atomicity and global error handling. Phase 5 stands up a test harness and covers new utilities.

**Tech Stack:** Node/Bun, Express 4, Handlebars, Supabase JS client, HTMX, `bun test`, `sanitize-html`.

**Skipped by user:** `.env` rotation / git-history audit (user confirmed `.env` was never committed).

**Execution note:** Phases are independent and individually shippable. Prefer sequential execution (1 → 5), but within a phase tasks build on each other — execute in order.

---

## Phase 1 — User-facing security

### Task 1.1: Install and wire a sanitized markdown helper

**Files:**
- Modify: `package.json`
- Create: `util/markdown.js`
- Test: `util/markdown.test.js`
- Modify: `index.js` (register helper)
- Modify: `util/handlebars.js` (export helper — optional, see step)

**Context:** Current templates render user content via `{{{markdown ...}}}` from `handlebars-helpers@0.10.0`, which passes raw HTML through. Every character/mission/LFG/profile/page/class description is a stored-XSS vector. Replace that helper with a wrapper that runs markdown output through `sanitize-html`.

- [ ] **Step 1: Add dependencies**

```bash
cd /home/dave/code/agent-resources
bun add marked sanitize-html
```

Verify:
```bash
bun pm ls | grep -E "marked|sanitize-html"
```
Expected: both packages listed.

- [ ] **Step 2: Write failing test**

Create `util/markdown.test.js`:

```js
const { test, expect } = require('bun:test');
const { renderMarkdown } = require('./markdown');

test('renders basic markdown to HTML', () => {
  expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
});

test('strips script tags', () => {
  const out = renderMarkdown('hello <script>alert(1)</script>');
  expect(out).not.toContain('<script');
  expect(out).not.toContain('alert(1)');
});

test('strips on* handlers', () => {
  const out = renderMarkdown('<img src=x onerror="alert(1)">');
  expect(out).not.toContain('onerror');
});

test('blocks javascript: hrefs', () => {
  const out = renderMarkdown('[click](javascript:alert(1))');
  expect(out).not.toContain('javascript:');
});

test('allows http and https links', () => {
  const out = renderMarkdown('[ok](https://example.com)');
  expect(out).toContain('href="https://example.com"');
});

test('returns empty string for nullish input', () => {
  expect(renderMarkdown(null)).toBe('');
  expect(renderMarkdown(undefined)).toBe('');
  expect(renderMarkdown('')).toBe('');
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun test util/markdown.test.js
```
Expected: all tests fail (module not found / function undefined). If `bun test` itself errors because no test setup exists yet, proceed — this is the first test and the harness is installed with Bun by default.

- [ ] **Step 4: Implement `util/markdown.js`**

```js
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: false,
  mangle: false
});

const allowedTags = sanitizeHtml.defaults.allowedTags.concat([
  'img', 'h1', 'h2'
]);

const allowedAttributes = {
  ...sanitizeHtml.defaults.allowedAttributes,
  img: ['src', 'alt', 'title'],
  a: ['href', 'name', 'target', 'rel']
};

const sanitizeOpts = {
  allowedTags,
  allowedAttributes,
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' })
  }
};

function renderMarkdown(input) {
  if (input == null || input === '') return '';
  const rendered = marked.parse(String(input));
  return sanitizeHtml(rendered, sanitizeOpts);
}

module.exports = { renderMarkdown };
```

- [ ] **Step 5: Verify tests pass**

```bash
bun test util/markdown.test.js
```
Expected: all 6 tests pass.

- [ ] **Step 6: Register as a Handlebars helper (SafeString) in `index.js`**

In `index.js`, import `Handlebars` via `express-handlebars`'s runtime so we can return a SafeString (otherwise the sanitized HTML will be escaped again). Easiest path: return the string from the helper and use `{{{markdown x}}}` (triple-stache); the helper already produces a safe HTML string.

Edit `index.js:4` to also import our helper (we will keep using triple-stache in templates, but now the string has been sanitized):

```js
const { renderMarkdown } = require('./util/markdown');
```

And in the handlebars `helpers` object (around `index.js:34-48`), add:

```js
markdown: renderMarkdown,
```

This **overrides** the `markdown` helper from `handlebars-helpers` because our key appears after the `...helpers` spread.

- [ ] **Step 7: Smoke-test in the browser**

```bash
bun run dev
```

Open any mission/character/LFG page with markdown content that previously rendered. Paste a malicious string into a character description (e.g. `<script>alert(1)</script>` followed by `**bold**`), save, reload: bold still bold, script gone.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock util/markdown.js util/markdown.test.js index.js
git commit -m "Sanitize markdown output to close stored-XSS vector"
```

---

### Task 1.2: Validate URL schemes on writeable URL fields

**Files:**
- Create: `util/url.js`
- Test: `util/url.test.js`
- Modify: `models/mission.js` (wherever `media_url`/`image_url` is written — `createMission`, `updateMission`)
- Modify: `models/character.js` (`createCharacter`, `updateCharacter` — `image_url`)
- Modify: `models/profile.js` (`updateUser` — `image_url`, any URL fields)
- Modify: `views/mission.handlebars:13` (defense-in-depth escape, optional)

**Context:** User input with `javascript:`, `data:`, or `vbscript:` URLs renders into `href`/`src` attributes via `{{mission.media_url}}`. Block at the write boundary so templates can trust stored values.

- [ ] **Step 1: Write failing test**

Create `util/url.test.js`:

```js
const { test, expect } = require('bun:test');
const { isSafeHttpUrl, sanitizeHttpUrl } = require('./url');

test('accepts http and https', () => {
  expect(isSafeHttpUrl('http://example.com')).toBe(true);
  expect(isSafeHttpUrl('https://example.com/path?q=1')).toBe(true);
});

test('rejects javascript: and data:', () => {
  expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
  expect(isSafeHttpUrl('JAVASCRIPT:alert(1)')).toBe(false);
  expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
});

test('rejects malformed', () => {
  expect(isSafeHttpUrl('not a url')).toBe(false);
  expect(isSafeHttpUrl('')).toBe(false);
  expect(isSafeHttpUrl(null)).toBe(false);
  expect(isSafeHttpUrl(undefined)).toBe(false);
});

test('sanitizeHttpUrl returns null for unsafe', () => {
  expect(sanitizeHttpUrl('javascript:alert(1)')).toBe(null);
  expect(sanitizeHttpUrl('')).toBe(null);
  expect(sanitizeHttpUrl(null)).toBe(null);
});

test('sanitizeHttpUrl returns normalized URL for safe', () => {
  expect(sanitizeHttpUrl('https://example.com')).toBe('https://example.com/');
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
bun test util/url.test.js
```
Expected: fail (module not found).

- [ ] **Step 3: Implement `util/url.js`**

```js
function isSafeHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeHttpUrl(value) {
  if (!isSafeHttpUrl(value)) return null;
  return new URL(value).toString();
}

module.exports = { isSafeHttpUrl, sanitizeHttpUrl };
```

- [ ] **Step 4: Verify tests pass**

```bash
bun test util/url.test.js
```
Expected: all 5 tests pass.

- [ ] **Step 5: Apply in `models/mission.js`**

Find `createMission` and `updateMission`. At the top of each, import the helper and normalize incoming `media_url`:

```js
const { sanitizeHttpUrl } = require('../util/url');
```

Inside each function, before the `.insert(...)` / `.update(...)` call:

```js
if ('media_url' in missionReq) {
  missionReq.media_url = missionReq.media_url ? sanitizeHttpUrl(missionReq.media_url) : null;
}
if ('image_url' in missionReq) {
  missionReq.image_url = missionReq.image_url ? sanitizeHttpUrl(missionReq.image_url) : null;
}
```

If either field is present but unsafe, it becomes `null` — prefer that to a 400 since the form UI doesn't surface field-level errors well for HTMX.

- [ ] **Step 6: Apply in `models/character.js`**

Find every `update`/`insert` on `characters` and apply the same guard to `image_url` (and any other URL column — grep the schema):

```bash
grep -n "image_url\|media_url\|video_url" models/character.js models/profile.js models/class.js
```

Wrap each write site with the `sanitizeHttpUrl` call as above.

- [ ] **Step 7: Apply in `models/profile.js` (`updateUser`)**

Same pattern for `image_url` and any other URL fields on profile/class.

- [ ] **Step 8: Manually verify**

```bash
bun run dev
```

In a mission form, set media URL to `javascript:alert(1)`, save, view mission. URL field should be blank (stored as null). No alert fires.

- [ ] **Step 9: Commit**

```bash
git add util/url.js util/url.test.js models/mission.js models/character.js models/profile.js models/class.js
git commit -m "Reject non-http(s) URLs at the write boundary"
```

---

### Task 1.3: Escape ilike wildcards in search queries

**Files:**
- Modify: `util/validate.js` (add helper)
- Test: `util/validate.test.js`
- Modify: `models/profile.js:141` (`searchProfiles`)
- Modify: `models/mission.js:194` (`searchPublicMissions`)
- Modify: `models/character.js:673` (`searchPublicCharacters`)

**Context:** `.ilike('name', \`%${query}%\`)` lets a user inject `%` or `_` to widen results or `\` to affect Postgres pattern matching. Escape these before building the pattern.

- [ ] **Step 1: Write failing test**

Create `util/validate.test.js`:

```js
const { test, expect } = require('bun:test');
const { isValidUuid, escapeLikePattern } = require('./validate');

test('isValidUuid accepts valid UUID', () => {
  expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
});

test('isValidUuid rejects non-UUID', () => {
  expect(isValidUuid('not-a-uuid')).toBe(false);
  expect(isValidUuid('')).toBe(false);
  expect(isValidUuid(null)).toBe(false);
  expect(isValidUuid(123)).toBe(false);
});

test('escapeLikePattern escapes wildcards', () => {
  expect(escapeLikePattern('100%')).toBe('100\\%');
  expect(escapeLikePattern('foo_bar')).toBe('foo\\_bar');
  expect(escapeLikePattern('back\\slash')).toBe('back\\\\slash');
});

test('escapeLikePattern leaves ordinary text', () => {
  expect(escapeLikePattern('hello world')).toBe('hello world');
});

test('escapeLikePattern returns empty for nullish', () => {
  expect(escapeLikePattern(null)).toBe('');
  expect(escapeLikePattern(undefined)).toBe('');
  expect(escapeLikePattern('')).toBe('');
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
bun test util/validate.test.js
```
Expected: `escapeLikePattern` tests fail (undefined).

- [ ] **Step 3: Add helper to `util/validate.js`**

Edit `util/validate.js` — add after `validateIdParam`:

```js
function escapeLikePattern(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

module.exports = { isValidUuid, validateIdParam, escapeLikePattern };
```

- [ ] **Step 4: Verify tests pass**

```bash
bun test util/validate.test.js
```
Expected: 5 tests pass.

- [ ] **Step 5: Apply in `models/profile.js:141`**

Replace:

```js
.ilike('name', `%${query}%`)
```

with:

```js
const { escapeLikePattern } = require('../util/validate');
// ...
.ilike('name', `%${escapeLikePattern(query.trim())}%`)
```

(add the `require` at the top of the file if not present).

- [ ] **Step 6: Apply in `models/mission.js:194`**

Same replacement for the `ilike` in `searchPublicMissions`.

- [ ] **Step 7: Apply in `models/character.js:673`**

Same replacement for the `ilike` in `searchPublicCharacters`.

- [ ] **Step 8: Grep for other ilike usages you may have missed**

```bash
grep -n "\.ilike(" models/
```
Apply the fix to every result.

- [ ] **Step 9: Smoke test**

```bash
bun run dev
```
Search for `100%` — should return literal name matches (or nothing), not "all names".

- [ ] **Step 10: Commit**

```bash
git add util/validate.js util/validate.test.js models/profile.js models/mission.js models/character.js
git commit -m "Escape wildcards in ilike search patterns"
```

---

## Phase 2 — Auth & session correctness

### Task 2.1: Remove service-role → anon-key fallback and rename env var

**Files:**
- Modify: `models/_base.js`
- Modify: `index.js`
- Modify: `.env.dist`
- Modify: `.env` (local only; do not commit)
- Modify: `README.md` if it documents env vars

**Context:** Two fixes in one commit because they're intertwined: (1) don't silently fall back to the anon key if service-role is missing; (2) rename `SUPABASE_KEY` → `SUPABASE_ANON_KEY` so the frontend-exposed variable has an honest name and can't be confused with the service role.

- [ ] **Step 1: Update `models/_base.js`**

Replace the file contents with:

```js
const { createClient } = require('@supabase/supabase-js');

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
};

const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
if (!process.env.SUPABASE_URL) {
  throw new Error('SUPABASE_URL is required');
}
if (!anonKey) {
  throw new Error('SUPABASE_ANON_KEY is required');
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
}

const supabase = createClient(process.env.SUPABASE_URL, anonKey, clientOptions);
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  clientOptions
);

module.exports = { supabase, supabaseAdmin, anonKey };
```

The `SUPABASE_KEY` fallback stays transitionally so this commit doesn't break local `.env` files; remove it in a follow-up once everyone's `.env` has been updated.

- [ ] **Step 2: Update `index.js:55-56`**

Replace:

```js
res.locals.supabaseKey = process.env.SUPABASE_KEY;
```

with:

```js
res.locals.supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
```

- [ ] **Step 3: Update `.env.dist`**

Replace `SUPABASE_KEY=` with `SUPABASE_ANON_KEY=`. Keep `SUPABASE_SERVICE_ROLE_KEY=`.

- [ ] **Step 4: Update local `.env`**

Rename the variable from `SUPABASE_KEY` to `SUPABASE_ANON_KEY`. Do not commit `.env`.

- [ ] **Step 5: Verify startup fails cleanly if env missing**

```bash
SUPABASE_SERVICE_ROLE_KEY= bun run index.js
```
Expected: process exits with `Error: SUPABASE_SERVICE_ROLE_KEY is required`.

Restore env and verify normal start:

```bash
bun run index.js
```
Expected: `Server is running on port 3000`.

- [ ] **Step 6: Commit**

```bash
git add models/_base.js index.js .env.dist
git commit -m "Fail fast on missing Supabase keys; rename SUPABASE_KEY to SUPABASE_ANON_KEY"
```

---

### Task 2.2: Replace `setSession` on shared client with per-request client

**Files:**
- Modify: `models/auth.js` (most likely location of `setSession` call — verify with grep)
- Modify: `models/_base.js` (add factory)
- Modify: `util/auth.js` (attach per-request client to `res.locals`)
- Grep for all call sites that assume a session-bearing `supabase` client

**Context:** The `supabase` singleton with `setSession` is shared across concurrent requests, causing user-session bleed. The recent fix was to route writes through `supabaseAdmin` — but any read that depended on RLS was still at risk. Replace the mutating `setSession` pattern with a per-request client whose `Authorization` header carries the user's JWT. Remaining code keeps using `supabase` (anon) for unauthenticated reads and `supabaseAdmin` for privileged mutations.

- [ ] **Step 1: Locate `setSession` usage**

```bash
grep -rn "setSession" models/ util/ routes/
```
Expected: at least one call in `models/auth.js` (`getUserFromToken`).

- [ ] **Step 2: Add factory to `models/_base.js`**

Append:

```js
const createUserClient = (accessToken) => {
  if (!accessToken) return supabase;
  return createClient(process.env.SUPABASE_URL, anonKey, {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
};

module.exports = { supabase, supabaseAdmin, anonKey, createUserClient };
```

- [ ] **Step 3: Rewrite `models/auth.js::getUserFromToken` to stop calling `setSession`**

Read `models/auth.js` first to see the exact shape. The goal:
- Take `accessToken, refreshToken`.
- Call `supabase.auth.getUser(accessToken)` (which validates without mutating client state).
- Return the `user` (or `false`/`null` on error) — same external contract.

Do **not** call `supabase.auth.setSession(...)` anywhere. If a caller needs an authenticated client for reads, use `createUserClient(accessToken)`.

- [ ] **Step 4: Grep callers of `getUserFromToken`**

```bash
grep -rn "getUserFromToken" util/ routes/
```
Expected: `util/auth.js` in both middlewares.

- [ ] **Step 5: In `util/auth.js`, expose the per-request client**

In both `isAuthenticated` and `authOptional`, after getting the user, build a per-request client:

```js
const { createUserClient } = require('../models/_base');
// ...
const authToken = getBearerToken(req);
const user = await getUserFromToken(authToken, req.headers['refresh-token']);
if (user) {
  res.locals.user = user;
  res.locals.supabaseUser = createUserClient(authToken);
  // ... rest unchanged
}
```

- [ ] **Step 6: Verify RLS-dependent reads**

`res.locals.supabaseUser` is now available to route handlers that need RLS-scoped reads. We aren't changing every call site in this task; that's task 2.2-followup. For now, the fix is that the **shared** client no longer carries user session state — so no cross-request bleed.

- [ ] **Step 7: Smoke-test auth flow**

```bash
bun run dev
```
Sign in, browse around, sign out, sign in as a second account. Verify: no 500s, correct profile shown on each account, no visibility of the other account's private data.

- [ ] **Step 8: Commit**

```bash
git add models/_base.js models/auth.js util/auth.js
git commit -m "Stop mutating shared Supabase client; expose per-request client via res.locals"
```

---

### Task 2.3: Validate `redirect-to` header and fix missing-referer crash

**Files:**
- Modify: `util/auth.js` (both middlewares)

**Context:** `req.headers['redirect-to']` is client-controlled and fed into a redirect URL (open-redirect vector if ever reused without `encodeURIComponent` on full URL). And `new URL(req.headers['referer']).pathname` throws if `referer` is missing.

- [ ] **Step 1: Extract helper**

Add near the top of `util/auth.js`:

```js
function isSameOriginPath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;   // protocol-relative
  return true;
}

function safeRefererPath(refererHeader) {
  if (typeof refererHeader !== 'string' || refererHeader.length === 0) return null;
  try {
    return new URL(refererHeader).pathname;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Guard `redirect-to` in `isAuthenticated` (line 17)**

Replace:

```js
const redirectUrl = req.headers['redirect-to'] || req.originalUrl;
```

with:

```js
const headerRedirect = req.headers['redirect-to'];
const redirectUrl = isSameOriginPath(headerRedirect) ? headerRedirect : req.originalUrl;
```

- [ ] **Step 3: Guard referer dereference (line 53)**

Replace:

```js
if (req.headers['redirect-to']) {
  const referer = new URL(req.headers['referer']).pathname;
  if (referer != req.headers['redirect-to']) {
    res.header('HX-Push-Url', req.headers['redirect-to']);
  }
}
```

with:

```js
const redirectTo = req.headers['redirect-to'];
if (isSameOriginPath(redirectTo)) {
  const referer = safeRefererPath(req.headers['referer']);
  if (referer !== redirectTo) {
    res.header('HX-Push-Url', redirectTo);
  }
}
```

- [ ] **Step 4: Apply identical change in `authOptional` (line 91)**

Same block replacement.

- [ ] **Step 5: Smoke test**

```bash
bun run dev
```
Trigger an HTMX request with `HX-Request` and no `Referer` header using curl:

```bash
curl -i -H "HX-Request: true" -H "redirect-to: /missions" http://localhost:3000/
```

Expected: 200 / 302 response with `HX-Redirect` set. **No 500 from URL parsing.**

Also try `-H "redirect-to: https://evil.com"` — expect the header to be ignored (no redirect to evil).

- [ ] **Step 6: Commit**

```bash
git add util/auth.js
git commit -m "Validate redirect-to as same-origin path and tolerate missing referer"
```

---

### Task 2.4: Remove duplicate `loadNavItems` calls in auth middlewares

**Files:**
- Modify: `util/auth.js:60, 99`

**Context:** `index.js:63` already mounts `loadNavItems` globally. Both `isAuthenticated` and `authOptional` then call `loadNavItems(req, res, () => {})` again — one extra DB query per authenticated request.

- [ ] **Step 1: Confirm the global mount loads before route middlewares**

Re-read `index.js:60-77` to confirm `app.use(loadNavItems)` is registered before route mounts. It is (line 63).

- [ ] **Step 2: Remove redundant calls**

In `util/auth.js:60`, remove:

```js
await loadNavItems(req, res, () => {});
```

Replace the enclosing `next();` call path so `next()` still fires. Specifically, the final block of `isAuthenticated` should be:

```js
    } else {
      res.locals.profile = null;
      res.locals.systemMessage = null;
    }

    if (req.headers['redirect-to']) {
      /* ... from Task 2.3 ... */
    }

    next();
  }
}
```

Do the same in `authOptional` (lines 71 and 99).

- [ ] **Step 3: Drop the unused import**

Remove the `const { loadNavItems } = require('./nav-loader');` line in `util/auth.js:4` if no other function in the file uses it.

- [ ] **Step 4: Smoke test**

```bash
bun run dev
```
Load any page as authed user. Nav still renders. Check server logs: only one `nav_items` query per request (add `console.log` inside `nav-loader.js` temporarily if unsure, then remove).

- [ ] **Step 5: Commit**

```bash
git add util/auth.js
git commit -m "Drop duplicate loadNavItems from auth middlewares"
```

---

### Task 2.5: Validate all UUID route params, not just `:id`

**Files:**
- Modify: `routes/missions.js`
- Modify: `routes/characters.js`
- Modify: `routes/classes.js`
- Modify: `routes/lfg.js`
- Modify: `routes/library.js`
- Modify: `routes/profile.js`

**Context:** `router.param('id', validateIdParam)` only fires for `:id`. Routes like `DELETE /missions/:id/editors/:profileId` and `POST /missions/:id/merge/:targetId` pass unvalidated UUIDs through to Supabase.

- [ ] **Step 1: Add a helper in `util/validate.js`**

```js
function registerUuidParams(router, names) {
  for (const name of names) {
    router.param(name, validateIdParam);
  }
}

module.exports = { isValidUuid, validateIdParam, escapeLikePattern, registerUuidParams };
```

- [ ] **Step 2: Apply in each route file**

Replace the single `router.param('id', validateIdParam);` line in each `routes/*.js` with:

```js
const { registerUuidParams } = require('../util/validate');
registerUuidParams(router, ['id', 'characterId', 'profileId', 'targetId', 'requestId', 'userId', 'tokenId']);
```

Include every param name that appears with `:` in any route within that file. Grep to find them:

```bash
grep -nE ":[a-zA-Z]+" routes/missions.js | grep -v "//"
```

Only include param names that should be UUIDs. Leave non-UUID params (like `:name` in the optional path component) out of the list.

- [ ] **Step 3: Manually verify one case**

```bash
curl -i http://localhost:3000/missions/550e8400-e29b-41d4-a716-446655440000/editors/not-a-uuid \
  -X DELETE -H "Authorization: Bearer <token>"
```
Expected: 400 "Invalid ID".

- [ ] **Step 4: Commit**

```bash
git add util/validate.js routes/
git commit -m "Validate all UUID route params, not only :id"
```

---

## Phase 3 — Route & model correctness

### Task 3.1: Fix unreachable `/missions/similar` route

**Files:**
- Modify: `routes/missions.js`

**Context:** `GET /missions/similar` at line 554 is unreachable because `router.param('id', validateIdParam)` on line 4 rejects `similar` as a non-UUID before the explicit handler is tried. Move literal paths above `/:id` routes.

- [ ] **Step 1: Cut the `/similar` block**

Cut `routes/missions.js:553-570` (the `// Search for similar missions` comment block + handler). Verify by reading lines 550-575 before cutting.

- [ ] **Step 2: Paste above the first `/:id` route**

Insert it above `router.get('/:id', authOptional, ...)` at line 218. It should sit next to the other literal-path routes (`/search`, `/s`, `/new`, `/import`).

- [ ] **Step 3: Verify**

```bash
bun run dev
curl -i "http://localhost:3000/missions/similar?date=2026-01-01&name=Test" \
  -H "Authorization: Bearer <token>"
```
Expected: 200 with rendered partial (or 400 for missing editor, but **not** "Invalid ID").

- [ ] **Step 4: Verify the mission-form UI**

Open a mission edit page that uses `views/mission-form.handlebars:11`. The HTMX call for similar missions should succeed and render suggestions.

- [ ] **Step 5: Commit**

```bash
git add routes/missions.js
git commit -m "Move /missions/similar above /:id so it's reachable"
```

---

### Task 3.2: Fix broken `character`/`characterId` refs in LFG create/update

**Files:**
- Modify: `models/lfg.js:148-234`

**Context:** `createLfgPost` deletes `postReq.character` on line 152 but then checks `postReq.character` again on line 170 (always false); if the check did pass, it references a non-existent `character` variable and uses `post.id` (array) instead of `post[0].id`. `updateLfgPost` has the same undefined-variable bug on line 199. Also missing `postError` null-check on line 190.

- [ ] **Step 1: Rewrite `createLfgPost`**

Replace `models/lfg.js:148-186` with:

```js
const createLfgPost = async (postReq, profile) => {
  postReq.creator_id = profile.id;

  const characterId = postReq.character || null;
  delete postReq.character;

  postReq.host_id = postReq.host_id === 'on' ? profile.id : null;
  postReq.is_public = postReq.is_public === 'on';
  postReq.date = moment.tz(postReq.date, profile.timezone).utc();

  const { data: postRows, error } = await supabase
    .from('lfg_posts')
    .insert(postReq)
    .select();

  if (error || !postRows || postRows.length === 0) {
    return { data: null, error: error || 'Failed to create LFG post' };
  }
  const post = postRows[0];

  if (characterId) {
    const { data: existingRequest } = await getLfgJoinRequestForUserAndPost(profile.id, post.id);
    if (existingRequest) {
      const { error: deleteErr } = await deleteJoinRequest(existingRequest.id);
      if (deleteErr) return { data: null, error: deleteErr };
    }

    const { data: joinRows, error: joinErr } = await joinLfgPost(post.id, profile.id, 'player', characterId);
    if (joinErr) return { data: null, error: joinErr };

    const { error: approveErr } = await updateJoinRequest(joinRows[0].id, 'approved');
    if (approveErr) return { data: null, error: approveErr };
  }

  return { data: post, error: null };
};
```

- [ ] **Step 2: Rewrite `updateLfgPost`**

Replace `models/lfg.js:188-234` with:

```js
const updateLfgPost = async (id, postReq, profile) => {
  const { data: post, error: postError } = await getLfgPost(id);
  if (postError || !post) return { data: null, error: postError || 'LFG post not found' };
  if (post.creator_id !== profile.id) return { data: null, error: 'Unauthorized' };

  const characterId = postReq.character || null;
  delete postReq.character;

  if (characterId) {
    const { data: existingRequest } = await getLfgJoinRequestForUserAndPost(profile.id, id);
    if (existingRequest) {
      const { error: deleteErr } = await deleteJoinRequest(existingRequest.id);
      if (deleteErr) return { data: null, error: deleteErr };
    }
    const { data: joinRows, error: joinErr } = await joinLfgPost(id, profile.id, 'player', characterId);
    if (joinErr) return { data: null, error: joinErr };
    const { error: approveErr } = await updateJoinRequest(joinRows[0].id, 'approved');
    if (approveErr) return { data: null, error: approveErr };
  }

  delete postReq.creator_name;
  delete postReq.host_name;
  delete postReq.join_requests;

  postReq.host_id = postReq.host_id === 'on' ? profile.id : null;
  postReq.is_public = postReq.is_public === 'on';
  postReq.date = moment.tz(postReq.date, profile.timezone).utc();

  const { data, error } = await supabase
    .from('lfg_posts')
    .update(postReq)     // only fields from the request, no stale merge
    .eq('id', id)
    .eq('creator_id', profile.id)
    .select();

  if (error) return { data: null, error };
  if (!data || data.length === 0) return { data: null, error: 'Update returned no rows' };
  return { data: data[0], error: null };
};
```

- [ ] **Step 3: Smoke test**

```bash
bun run dev
```
Create an LFG post as player with a character attached. Verify the post is created and the current user is auto-joined as an approved player.
Edit that post (same flow). Verify no 500 and the post updates correctly.

- [ ] **Step 4: Commit**

```bash
git add models/lfg.js
git commit -m "Fix broken character variable refs and missing null checks in LFG create/update"
```

---

### Task 3.3: Audit mutations for missing `supabaseAdmin` usage

**Files:**
- Modify: `models/character.js` (`createCharacter`, `updateCharacter`, `deleteCharacter`, trait/gear/ability setters)
- Modify: `models/lfg.js` (`joinLfgPost`, `deleteLfgPost`, `updateJoinRequest`, `deleteJoinRequest`)
- Modify: `models/class.js` (create/update/delete paths)
- Modify: `models/profile.js` (`updateUser`, `setDiscordId`)

**Context:** Commit `5355d36` switched mission mutations to `supabaseAdmin` because RLS was blocking legitimate writes. The same RLS shape applies to other tables. Either (a) port app-level authorization checks and use `supabaseAdmin`, or (b) fix RLS and use the per-request user client from Task 2.2. This task chooses (a) to match the established pattern.

- [ ] **Step 1: Identify current clients used**

```bash
grep -n "supabase\.from\|supabaseAdmin\.from" models/character.js models/lfg.js models/class.js models/profile.js
```

Build a table of function → table → operation (insert/update/delete) → current client.

- [ ] **Step 2: For each mutation that currently uses `supabase` (anon)**

Confirm there is an app-level authorization check (ownership / role) **before** the mutation. If not, add one mirroring the mission pattern:

```js
const { data: existing, error: fetchErr } = await supabaseAdmin
  .from('characters')
  .select('creator_id')
  .eq('id', id)
  .single();
if (fetchErr) return { data: null, error: fetchErr };
if (!existing || existing.creator_id !== profile.id) {
  return { data: null, error: 'Unauthorized' };
}
```

Then switch the mutation to `supabaseAdmin`.

- [ ] **Step 3: Do this for each model, one file per commit**

Order: `character.js`, `class.js`, `lfg.js`, `profile.js`.

For each file:
1. Make the changes.
2. Smoke-test the affected flows in the browser (create/update/delete for each entity).
3. Commit with a message like `Gate character mutations in app layer and route through supabaseAdmin`.

- [ ] **Step 4: Grep for any remaining anon-client writes**

```bash
grep -n "supabase\.from.*\(insert\|update\|delete\)" models/
```
Expected: zero results (or only intentional RLS-guarded paths with a comment explaining why).

- [ ] **Step 5: Final commit**

If anything remains after the per-file commits:

```bash
git add models/
git commit -m "Complete audit of mutation paths through supabaseAdmin"
```

---

### Task 3.4: Fix stale-field overwrite in `updateCharacter`

**Files:**
- Modify: `models/character.js:240`

**Context:** `updateCharacter` does `.update({ ...characterData, ...characterReq })` — `characterData` was read via `getCharacter` which attaches `.traits`, `.gear`, `.abilities` (deleted at 201/206/211 but any other joined field leaks through as a stale write).

- [ ] **Step 1: Read the function**

Read `models/character.js:180-260` to understand the full flow.

- [ ] **Step 2: Replace the merged spread with an explicit request-only update**

Change:

```js
.update({ ...characterData, ...characterReq })
```

to:

```js
.update(characterReq)
```

Remove the preceding `const { data: characterData } = await getCharacter(...)` read if its only purpose was to supply the spread (keep it if it's used for the authorization check — in which case, only select the fields the check needs).

- [ ] **Step 3: Smoke test**

Edit an existing character. Change only the name. Reload: name changed, traits/gear/abilities unchanged, `updated_at` advanced. Edit again without submitting any traits — traits still present (they're stored separately, not on the character row).

- [ ] **Step 4: Commit**

```bash
git add models/character.js
git commit -m "Only write request fields in updateCharacter; stop spreading stale read"
```

---

### Task 3.5: Encode dynamic segments in `HX-Location` URLs

**Files:**
- Modify: `routes/classes.js:413, 487, 572`
- Modify: `routes/missions.js` (if any `HX-Location` builds a slug)
- Modify: `routes/characters.js` (same)

**Context:** Interpolating class/character/mission names into URLs without `encodeURIComponent` produces malformed URLs for names with `/`, `?`, `#`, or spaces.

- [ ] **Step 1: Grep for `HX-Location`**

```bash
grep -n "HX-Location" routes/
```

- [ ] **Step 2: For each, wrap dynamic non-UUID segments in `encodeURIComponent`**

Example change:

```js
return res.header('HX-Location', `/classes/${newClassId}${slug}`)
```

becomes:

```js
const slug = newClass?.name ? `/${encodeURIComponent(newClass.name)}` : '';
return res.header('HX-Location', `/classes/${newClassId}${slug}`)
```

UUIDs don't need encoding; names and user-provided strings do.

- [ ] **Step 3: Smoke test**

Create a class named `Holy / War?`. After save, HTMX redirects to a URL where the slash and question mark are `%2F` and `%3F`. Page loads without error.

- [ ] **Step 4: Commit**

```bash
git add routes/
git commit -m "URL-encode dynamic path segments in HX-Location responses"
```

---

### Task 3.6: Null-check Supabase insert/update results

**Files:**
- Modify: `routes/missions.js:203`
- Modify: any other spot flagged by grep

**Context:** `const mission = missionRes[0]` crashes if RLS/ownership silently returns an empty array. Check for `!missionRes?.length` and surface a 400.

- [ ] **Step 1: Update `routes/missions.js:193-203`**

Replace:

```js
const { data: missionRes, error: missionError } = await createMission(...);
if (missionError) {
  return res.status(400).send(missionError.message);
}
const mission = missionRes[0];
```

with:

```js
const { data: missionRes, error: missionError } = await createMission(...);
if (missionError) {
  return res.status(400).send(missionError.message);
}
if (!missionRes || missionRes.length === 0) {
  return res.status(400).send('Mission creation returned no rows');
}
const mission = missionRes[0];
```

- [ ] **Step 2: Grep for the same pattern elsewhere**

```bash
grep -n "\[0\]" routes/ | grep -v "//"
```
Review each for the same null-check gap and fix as appropriate.

- [ ] **Step 3: Commit**

```bash
git add routes/
git commit -m "Null-check Supabase result arrays before indexing"
```

---

## Phase 4 — Atomicity & robustness

### Task 4.1: Global Express error handler + process hooks

**Files:**
- Modify: `index.js`

**Context:** Unhandled async rejections currently render Express's default HTML error page (with stack). Add a JSON/HTML-aware error handler + process-level rejection/uncaught hooks so one bad request can't silently taint server state.

- [ ] **Step 1: Add error handler in `index.js`**

Insert after all `app.use(...)` route mounts, before `app.listen`:

```js
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);

  const isHtmx = req.get('HX-Request');
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : String(err?.message || err);

  if (isHtmx) {
    res.set('HX-Retarget', '#alert').set('HX-Reswap', 'innerHTML');
    return res.status(500).send(`<div class="notification is-danger">${message}</div>`);
  }
  if (req.accepts('html')) {
    return res.status(500).send(message);
  }
  return res.status(500).json({ error: message });
});

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});
```

- [ ] **Step 2: Smoke-test**

Temporarily add a route that throws: `app.get('/_crash', () => { throw new Error('boom'); });`
Visit `/_crash`. Expected: 500 page (HTML) or JSON, log line in server output. Remove the test route.

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "Add global Express error handler and unhandledRejection hooks"
```

---

### Task 4.2: Make `mergeMissions` atomic via SQL function

**Files:**
- Create: `supabase/migrations/<timestamp>_merge_missions.sql` (or add to `schema.sql` — match the project's migration convention)
- Modify: `models/mission.js` (`mergeMissions`)

**Context:** The current implementation makes many sequential round-trips with no transaction. Partial failure leaves an orphaned secondary mission or half-moved child rows. Move the logic into a SQL function invoked via `supabaseAdmin.rpc`.

- [ ] **Step 1: Determine migration convention**

```bash
ls supabase/migrations 2>/dev/null || ls supabase/
```
If the repo uses a `supabase/migrations/` folder, add a new file there with `YYYYMMDDHHMMSS_merge_missions.sql`. If the convention is a monolithic `schema.sql`, append to it.

- [ ] **Step 2: Write the SQL function**

```sql
create or replace function public.merge_missions(
  primary_id uuid,
  secondary_id uuid,
  actor_profile_id uuid
) returns missions
language plpgsql
security definer
set search_path = public
as $$
declare
  primary_row missions;
  secondary_row missions;
  merged_summary text;
  merged_unregistered text[];
  earlier_date timestamptz;
begin
  select * into primary_row from missions where id = primary_id for update;
  if not found then raise exception 'Primary mission not found'; end if;

  select * into secondary_row from missions where id = secondary_id for update;
  if not found then raise exception 'Secondary mission not found'; end if;

  earlier_date := least(primary_row.date, secondary_row.date);
  merged_summary := coalesce(nullif(primary_row.summary, ''), '') ||
    case when secondary_row.summary is not null and secondary_row.summary <> ''
         then E'\n\n---\n\n' || secondary_row.summary
         else '' end;
  merged_unregistered := (
    select array_agg(distinct x) from unnest(
      coalesce(primary_row.unregistered_character_names, array[]::text[]) ||
      coalesce(secondary_row.unregistered_character_names, array[]::text[])
    ) as x
  );

  update missions set
    date = earlier_date,
    summary = nullif(merged_summary, ''),
    unregistered_character_names = merged_unregistered,
    media_url = coalesce(primary_row.media_url, secondary_row.media_url)
  where id = primary_id;

  insert into mission_characters (mission_id, character_id)
    select primary_id, character_id
    from mission_characters
    where mission_id = secondary_id
  on conflict do nothing;

  insert into mission_editors (mission_id, profile_id, added_by)
    select primary_id, profile_id, actor_profile_id
    from mission_editors
    where mission_id = secondary_id
  on conflict do nothing;

  if secondary_row.creator_id is not null and secondary_row.creator_id <> primary_row.creator_id then
    insert into mission_editors (mission_id, profile_id, added_by)
      values (primary_id, secondary_row.creator_id, actor_profile_id)
    on conflict do nothing;
  end if;

  delete from missions where id = secondary_id;

  select * into primary_row from missions where id = primary_id;
  return primary_row;
end;
$$;
```

Adjust column names to match the actual schema (read `schema.sql` for the `mission_editors` table shape — the `added_by` column may have a different name).

- [ ] **Step 3: Apply the migration**

Use whatever flow the project uses — `supabase db push`, direct `psql`, or running the SQL file against the dev DB. Document in `scripts/db-backup.sh` siblings if there's a `db:migrate` convention.

- [ ] **Step 4: Rewrite `mergeMissions` in `models/mission.js`**

Replace the body of `mergeMissions` (around line 670-765) with:

```js
const mergeMissions = async (primaryId, secondaryId, profile) => {
  const [canPrimary, canSecondary] = await Promise.all([
    canEditMission(primaryId, profile),
    canEditMission(secondaryId, profile)
  ]);
  if (!canPrimary || !canSecondary) {
    return { data: null, error: 'You must be able to edit both missions to merge them' };
  }

  const { data, error } = await supabaseAdmin.rpc('merge_missions', {
    primary_id: primaryId,
    secondary_id: secondaryId,
    actor_profile_id: profile.id
  });

  if (error) return { data: null, error };
  return await getMission(primaryId);
};
```

- [ ] **Step 5: Manually test**

Create two similar missions. Merge. Verify: one mission remains, with characters, editors, and earliest date — the other is gone. Re-run; RPC returns "Primary mission not found" instead of corrupting state.

- [ ] **Step 6: Commit**

```bash
git add supabase/ models/mission.js
git commit -m "Atomize mergeMissions via SECURITY DEFINER SQL function"
```

---

### Task 4.3: Consolidate UUID regex duplicates

**Files:**
- Modify: `routes/missions.js:488`
- Modify: `routes/pages.js:159`
- (`util/validate.js` already exports `isValidUuid`)

**Context:** Three copies of the same regex. One should exist.

- [ ] **Step 1: Replace inline UUID checks**

In `routes/missions.js`, replace the `uuidRegex` definition at line 488 and its usage with:

```js
const { isValidUuid } = require('../util/validate');
// ...
if (!isValidUuid(profile_id)) {
  return res.status(400).send('Invalid profile ID format');
}
```

(The `require` at the top of the file already imports from `util/validate` — reuse that line.)

- [ ] **Step 2: Same for `routes/pages.js:159`**

- [ ] **Step 3: Grep for leftover regex literals**

```bash
grep -rn "0-9a-f.\{8\}-" routes/ models/ util/
```
Expected: only the one in `util/validate.js`.

- [ ] **Step 4: Commit**

```bash
git add routes/
git commit -m "Reuse isValidUuid instead of inline UUID regex"
```

---

## Phase 5 — Test harness

### Task 5.1: Set up `bun test` and CI-friendly test script

**Files:**
- Modify: `package.json`

**Context:** Prior phases added tests under `util/*.test.js`. Wire them to `npm test` / `bun test`.

- [ ] **Step 1: Update `package.json` test script**

Change:

```json
"test": "echo \"Error: no test specified\" && exit 1",
```

to:

```json
"test": "bun test",
```

- [ ] **Step 2: Run the suite**

```bash
bun test
```
Expected: all tests from Tasks 1.1, 1.2, 1.3 pass.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "Wire bun test as the default test runner"
```

---

### Task 5.2: Test `util/crop.js`

**Files:**
- Create: `util/crop.test.js`

**Context:** `util/crop.js` is pure, has a clear contract, and is a good follow-up test for regression safety.

- [ ] **Step 1: Read the module**

```bash
cat util/crop.js
```

Identify exported functions and their contracts (e.g. `parseCrop`, `applyCrop`). Write tests for the happy path, boundary cases (negative, zero, >100%), and malformed input.

- [ ] **Step 2: Write tests**

Create `util/crop.test.js` with at least 5 tests covering:
- Valid crop string parses to expected object
- Out-of-range values are clamped or rejected (whichever the code does)
- Nullish input returns a safe default
- Round-trip: serialize(parse(x)) === x for a known-good input
- Malformed string (letters, missing commas) returns null / throws — match the code's actual contract

- [ ] **Step 3: Verify**

```bash
bun test util/crop.test.js
```
Expected: all pass against current code (no code changes — this is characterization testing).

- [ ] **Step 4: Commit**

```bash
git add util/crop.test.js
git commit -m "Add characterization tests for util/crop"
```

---

## Self-review checklist

- [x] **Spec coverage** — every review finding from the 2026-04-17 review is addressed (XSS 1.1, URL schemes 1.2, ilike 1.3, env var 2.1, session bleed 2.2, redirect-to 2.3, dup nav 2.4, param validation 2.5, unreachable route 3.1, LFG bug 3.2, admin audit 3.3, stale write 3.4, HX-Location 3.5, null-check 3.6, error handler 4.1, mergeMissions atomicity 4.2, regex dedup 4.3) or explicitly deferred (`.env` rotation — user excluded).
- [x] **No placeholders** — every code block is concrete; no "TBD" or "etc."
- [x] **Type consistency** — helper names (`renderMarkdown`, `isSafeHttpUrl`, `sanitizeHttpUrl`, `escapeLikePattern`, `isValidUuid`, `registerUuidParams`, `createUserClient`, `safeRefererPath`, `isSameOriginPath`) are consistent across tasks that reference them.

## Deferred (not in this plan)

- Move per-request `supabaseUser` client into route-level RLS reads (follow-up to 2.2).
- N+1 query cleanup in `models/lfg.js` list functions.
- SQL-side search for `searchSimilarMissions` using `pg_trgm`.
- Split `public/js/app.js` into modules.
- Introduce Prettier/ESLint and a consistent 2-space indent.
- Structured request logging (pino).
