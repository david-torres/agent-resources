# Friendly Error Affordances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace blank-page `PGRST116` errors with a styled, friendly full-page error (and inline HTMX notification), driven by one centralized classifier + `sendError` helper that all route sites and the global error handler share.

**Architecture:** A pure `classifyError(error, fallback)` maps Supabase/Postgres error codes to `{ status, title, message }`. A `sendError(req, res, error, opts)` helper branches on request context (HTMX → inline notification retargeted to `#alerts`; HTML → full-page `error` view inside the `main` layout; API → JSON). The global handler in `index.js` delegates to the same helper. ~179 `res.status(...).send(...)` sites across 8 route files are converted to `sendError`.

**Tech Stack:** Node + Express, express-handlebars (Bulma CSS), Supabase JS, `bun test`.

---

## File Structure

- Create: `util/http-error.js` — `classifyError` + `sendError` (one responsibility: turning errors into HTTP responses).
- Create: `util/http-error.test.js` — unit tests for both functions.
- Create: `views/error.handlebars` — full-page error (renders inside `main` layout).
- Create: `views/error-inline.handlebars` — HTMX fragment (`layout: false`).
- Modify: `index.js` — rewire global error handler to `sendError`; fix `#alert` → `#alerts`.
- Modify: `routes/characters.js`, `routes/classes.js`, `routes/missions.js`, `routes/pages.js`, `routes/lfg.js`, `routes/profile.js`, `routes/nav.js`, `routes/library.js` — convert send-sites to `sendError`.

---

## Task 1: Error classifier

**Files:**
- Create: `util/http-error.js`
- Test: `util/http-error.test.js`

- [ ] **Step 1: Write the failing test**

```js
// util/http-error.test.js
const { test, expect } = require('bun:test');
const { classifyError } = require('./http-error');

const FRIENDLY = "We couldn't find that, or you don't have access to it.";

test('PGRST116 maps to a friendly 404', () => {
  const d = classifyError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
  expect(d.status).toBe(404);
  expect(d.title).toBe('Not found');
  expect(d.message).toBe(FRIENDLY);
});

test('42501 (RLS/permission) maps to a friendly 403', () => {
  const d = classifyError({ code: '42501', message: 'permission denied' });
  expect(d.status).toBe(403);
  expect(d.title).toBe('No access');
  expect(d.message).toBe(FRIENDLY);
});

test('23505 (unique violation) maps to 409', () => {
  const d = classifyError({ code: '23505', message: 'duplicate key' });
  expect(d.status).toBe(409);
  expect(d.title).toBe('Already exists');
});

test('null error falls back to 404 Not found', () => {
  const d = classifyError(null);
  expect(d.status).toBe(404);
  expect(d.message).toBe(FRIENDLY);
});

test('fallback overrides win over the default mapping', () => {
  const d = classifyError(null, { status: 403, title: 'No access', message: 'Custom.' });
  expect(d.status).toBe(403);
  expect(d.title).toBe('No access');
  expect(d.message).toBe('Custom.');
});

test('unknown error is 500; non-production exposes the raw message', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const d = classifyError({ message: 'boom' });
  expect(d.status).toBe(500);
  expect(d.message).toBe('boom');
  process.env.NODE_ENV = prev;
});

test('unknown error in production hides the raw message', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const d = classifyError({ message: 'boom' });
  expect(d.status).toBe(500);
  expect(d.message).toBe('An unexpected error occurred. Please try again.');
  process.env.NODE_ENV = prev;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test util/http-error.test.js`
Expected: FAIL — `classifyError` is not exported / module missing.

- [ ] **Step 3: Write minimal implementation**

```js
// util/http-error.js
const FRIENDLY_NOT_FOUND = "We couldn't find that, or you don't have access to it.";
const isProd = () => process.env.NODE_ENV === 'production';

function classifyError(error, fallback = {}) {
  let base;
  switch (error && error.code) {
    case 'PGRST116':
      base = { status: 404, title: 'Not found', message: FRIENDLY_NOT_FOUND };
      break;
    case '42501':
      base = { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND };
      break;
    case '23505':
      base = { status: 409, title: 'Already exists', message: 'That already exists.' };
      break;
    default:
      if (!error) {
        base = { status: 404, title: 'Not found', message: FRIENDLY_NOT_FOUND };
      } else {
        base = {
          status: 500,
          title: 'Something went wrong',
          message: isProd() ? 'An unexpected error occurred. Please try again.' : String(error.message || error),
        };
      }
  }
  return {
    status: fallback.status != null ? fallback.status : base.status,
    title: fallback.title != null ? fallback.title : base.title,
    message: fallback.message != null ? fallback.message : base.message,
  };
}

module.exports = { classifyError, FRIENDLY_NOT_FOUND };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test util/http-error.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add util/http-error.js util/http-error.test.js
git commit -m "feat: add classifyError for friendly error mapping"
```

---

## Task 2: sendError helper

**Files:**
- Modify: `util/http-error.js`
- Test: `util/http-error.test.js`

- [ ] **Step 1: Write the failing test**

Append to `util/http-error.test.js`:

```js
const { sendError } = require('./http-error');

function mockRes() {
  const res = { statusCode: 200, headers: {}, headersSent: false };
  res.status = (s) => { res.statusCode = s; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.json = (b) => { res.body = b; res.headersSent = true; return res; };
  res.render = (view, data) => { res.rendered = { view, data }; res.headersSent = true; return res; };
  return res;
}
function mockReq({ htmx = false, html = true } = {}) {
  return {
    get: (h) => (h === 'HX-Request' && htmx ? 'true' : undefined),
    accepts: (t) => (t === 'html' ? html : false),
  };
}

test('sendError (HTMX) renders error-inline and retargets #alerts', () => {
  const res = mockRes();
  sendError(mockReq({ htmx: true }), res, { code: 'PGRST116' });
  expect(res.statusCode).toBe(404);
  expect(res.headers['HX-Retarget']).toBe('#alerts');
  expect(res.headers['HX-Reswap']).toBe('innerHTML');
  expect(res.rendered.view).toBe('error-inline');
  expect(res.rendered.data.layout).toBe(false);
});

test('sendError (HTML) renders the full error page', () => {
  const res = mockRes();
  sendError(mockReq({ htmx: false, html: true }), res, { code: 'PGRST116' });
  expect(res.statusCode).toBe(404);
  expect(res.rendered.view).toBe('error');
  expect(res.rendered.data.title).toBe('Not found');
});

test('sendError (API/JSON) returns json error', () => {
  const res = mockRes();
  sendError(mockReq({ htmx: false, html: false }), res, { code: 'PGRST116' });
  expect(res.statusCode).toBe(404);
  expect(res.body.error).toBeDefined();
});

test('sendError short-circuits when headers already sent', () => {
  const res = mockRes();
  res.headersSent = true;
  sendError(mockReq(), res, { code: 'PGRST116' });
  expect(res.rendered).toBeUndefined();
  expect(res.body).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test util/http-error.test.js`
Expected: FAIL — `sendError` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `util/http-error.js`, add the function and export it:

```js
function sendError(req, res, error, opts = {}) {
  if (res.headersSent) return;
  const d = classifyError(error, opts);
  if (req.get('HX-Request')) {
    res.set('HX-Retarget', '#alerts').set('HX-Reswap', 'innerHTML');
    return res.status(d.status).render('error-inline', { ...d, layout: false });
  }
  if (req.accepts('html')) {
    return res.status(d.status).render('error', d);
  }
  return res.status(d.status).json({ error: d.message });
}

module.exports = { classifyError, sendError, FRIENDLY_NOT_FOUND };
```

(Replace the existing single-line `module.exports` from Task 1 with this one.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test util/http-error.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add util/http-error.js util/http-error.test.js
git commit -m "feat: add sendError context-aware response helper"
```

---

## Task 3: Error views

**Files:**
- Create: `views/error.handlebars`
- Create: `views/error-inline.handlebars`

- [ ] **Step 1: Create the full-page view**

```handlebars
{{! views/error.handlebars — rendered inside the main layout }}
<div class="container">
  <div class="notification is-danger is-light">
    <h1 class="title is-4">{{title}}</h1>
    <p class="block">{{message}}</p>
    <a class="button" href="/">Back to home</a>
  </div>
</div>
```

- [ ] **Step 2: Create the inline (HTMX) view**

```handlebars
{{! views/error-inline.handlebars — rendered with { layout: false } }}
<div class="notification is-danger">{{message}}</div>
```

- [ ] **Step 3: Manual smoke check**

Run: `bun run index.js` then in another shell `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/characters/00000000-0000-0000-0000-000000000000`
Expected: `404` (after Task 6 converts the route; before that this still smoke-checks the server boots). Stop the server.

- [ ] **Step 4: Commit**

```bash
git add views/error.handlebars views/error-inline.handlebars
git commit -m "feat: add styled error page and inline error fragment"
```

---

## Task 4: Rewire the global error handler

**Files:**
- Modify: `index.js` (handler block starting at the `// Global error handler` comment)

- [ ] **Step 1: Replace the handler body**

Find the existing block:

```js
// Global error handler (must be after all route mounts)
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
```

Replace it with:

```js
// Global error handler (must be after all route mounts)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);
  return sendError(req, res, err);
});
```

- [ ] **Step 2: Add the require near the other requires at the top of `index.js`**

```js
const { sendError } = require('./util/http-error');
```

- [ ] **Step 3: Verify the server still boots**

Run: `bun run index.js`
Expected: `Server is running on port 3000` with no errors. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add index.js
git commit -m "refactor: route global error handler through sendError (fixes #alert→#alerts)"
```

---

## Conversion Tasks (5–12): one per route file

**Mechanical recipe — apply to every `res.status(...).send(...)` site that is NOT a `.json(...)` send:**

1. Add at the top of the file (with the other requires):
   `const { sendError } = require('../util/http-error');`
2. Transform each site:
   - `return res.status(400).send(error.message);`
     → `return sendError(req, res, error);`
   - `return res.status(400).send(error.message || error);`
     → `return sendError(req, res, error);`
   - `if (error || !x) return res.status(400).send(error ? error.message : 'X not found');`
     → `if (error || !x) return sendError(req, res, error, { message: 'X not found' });`
   - `return res.status(404).send('X not found');`
     → `return sendError(req, res, null, { message: 'X not found' });`
   - `return res.status(403).send('Forbidden');`
     → `return sendError(req, res, null, { status: 403, title: 'No access', message: "We couldn't find that, or you don't have access to it." });`
   - Existing `23505` special-cases that build a custom user message: keep the branch, but emit via
     `return sendError(req, res, error, { message: '<existing custom message>' });`
3. **Leave `res.status(...).json(...)` sites unchanged** (API routes already return JSON).
4. After editing the file, verify no raw send-sites remain and the suite is green (commands in each task).

The 8 tasks below differ only in file path and site count. Counts are current as of planning (`rg -c`), to confirm coverage:

| Task | File | Sites |
|---|---|---|
| 5 | `routes/profile.js` | 8 |
| 6 | `routes/nav.js` | 10 |
| 7 | `routes/pages.js` | 11 |
| 8 | `routes/lfg.js` | 17 |
| 9 | `routes/library.js` | 19 |
| 10 | `routes/classes.js` | 26 |
| 11 | `routes/missions.js` | 38 |
| 12 | `routes/characters.js` | 50 |

(Ascending by size so the recipe is validated on small files first.)

### Task 5: Convert `routes/profile.js`

**Files:** Modify `routes/profile.js`

- [ ] **Step 1: Add the require** — `const { sendError } = require('../util/http-error');` near the top.

- [ ] **Step 2: Apply the conversion recipe** to all 8 send-sites in the file.

- [ ] **Step 3: Verify no raw error-send sites remain**

Run: `rg -n "res\.status\([0-9]+\)\.send\(" routes/profile.js`
Expected: only `.json` sends or nothing; NO `.send(error` and NO `.send('Forbidden')`.

- [ ] **Step 4: Run the full suite**

Run: `bun test`
Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add routes/profile.js
git commit -m "refactor: route profile errors through sendError"
```

### Task 6: Convert `routes/nav.js`

**Files:** Modify `routes/nav.js`

- [ ] **Step 1: Add the require** — `const { sendError } = require('../util/http-error');`.
- [ ] **Step 2: Apply the conversion recipe** to all 10 send-sites.
- [ ] **Step 3: Verify** — Run: `rg -n "res\.status\([0-9]+\)\.send\(" routes/nav.js` — Expected: no `.send(error` / `.send('Forbidden')` remain.
- [ ] **Step 4: Run the full suite** — Run: `bun test` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add routes/nav.js
git commit -m "refactor: route nav errors through sendError"
```

### Task 7: Convert `routes/pages.js`

**Files:** Modify `routes/pages.js`

- [ ] **Step 1: Add the require** — `const { sendError } = require('../util/http-error');`. Note this file uses messages like `error?.message || 'Page not found'` and `error.message || 'Failed to load pages'`; convert to `sendError(req, res, error, { message: 'Page not found' })` (404 path) or `sendError(req, res, error)` (let the classifier choose status) as appropriate per site.
- [ ] **Step 2: Apply the conversion recipe** to all 11 send-sites.
- [ ] **Step 3: Verify** — Run: `rg -n "res\.status\([0-9]+\)\.send\(" routes/pages.js` — Expected: no `.send(error` remain.
- [ ] **Step 4: Run the full suite** — Run: `bun test` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add routes/pages.js
git commit -m "refactor: route pages errors through sendError"
```

### Task 8: Convert `routes/lfg.js`

**Files:** Modify `routes/lfg.js`

- [ ] **Step 1: Add the require** — `const { sendError } = require('../util/http-error');`.
- [ ] **Step 2: Apply the conversion recipe** to all 17 send-sites.
- [ ] **Step 3: Verify** — Run: `rg -n "res\.status\([0-9]+\)\.send\(" routes/lfg.js` — Expected: no `.send(error` / `.send('Forbidden')` remain.
- [ ] **Step 4: Run the full suite** — Run: `bun test` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add routes/lfg.js
git commit -m "refactor: route lfg errors through sendError"
```

### Task 9: Convert `routes/library.js`

**Files:** Modify `routes/library.js`

- [ ] **Step 1: Add the require** — `const { sendError } = require('../util/http-error');`.
- [ ] **Step 2: Apply the conversion recipe** to all 19 send-sites.
- [ ] **Step 3: Verify** — Run: `rg -n "res\.status\([0-9]+\)\.send\(" routes/library.js` — Expected: no `.send(error` / `.send('Forbidden')` remain.
- [ ] **Step 4: Run the full suite** — Run: `bun test` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add routes/library.js
git commit -m "refactor: route library errors through sendError"
```

### Task 10: Convert `routes/classes.js`

**Files:** Modify `routes/classes.js`

- [ ] **Step 1: Add the require** — `const { sendError } = require('../util/http-error');`. Note line ~459: `if (error || !cls) return res.status(400).send(error?.message || 'Class not found');` → `sendError(req, res, error, { message: 'Class not found' })`.
- [ ] **Step 2: Apply the conversion recipe** to all 26 send-sites.
- [ ] **Step 3: Verify** — Run: `rg -n "res\.status\([0-9]+\)\.send\(" routes/classes.js` — Expected: no `.send(error` / `.send('Forbidden')` remain.
- [ ] **Step 4: Run the full suite** — Run: `bun test` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add routes/classes.js
git commit -m "refactor: route classes errors through sendError"
```

### Task 11: Convert `routes/missions.js`

**Files:** Modify `routes/missions.js`

- [ ] **Step 1: Add the require** — `const { sendError } = require('../util/http-error');`.
- [ ] **Step 2: Apply the conversion recipe** to all 38 send-sites.
- [ ] **Step 3: Verify** — Run: `rg -n "res\.status\([0-9]+\)\.send\(" routes/missions.js` — Expected: no `.send(error` / `.send('Forbidden')` remain.
- [ ] **Step 4: Run the full suite** — Run: `bun test` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add routes/missions.js
git commit -m "refactor: route missions errors through sendError"
```

### Task 12: Convert `routes/characters.js`

**Files:** Modify `routes/characters.js`

- [ ] **Step 1: Add the require** — `const { sendError } = require('../util/http-error');`. Note the existing `23505` special-cases at lines ~397 and ~483 (duplicate source mission) — keep their branch logic and emit the custom message via `sendError(req, res, error, { message: '<existing message>' })`. Note line ~285 ownership/not-found and the `403 'Forbidden'` check at ~286.
- [ ] **Step 2: Apply the conversion recipe** to all 50 send-sites.
- [ ] **Step 3: Verify** — Run: `rg -n "res\.status\([0-9]+\)\.send\(" routes/characters.js` — Expected: no `.send(error` / `.send('Forbidden')` remain.
- [ ] **Step 4: Run the full suite** — Run: `bun test` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add routes/characters.js
git commit -m "refactor: route characters errors through sendError"
```

---

## Task 13: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Confirm no raw error sends remain anywhere in routes**

Run: `rg -n "\.send\(error" routes/`
Expected: no matches.

- [ ] **Step 2: Confirm the old retarget bug is gone**

Run: `rg -n "#alert\b" index.js views/`
Expected: matches are `#alerts` only (the layout region), no bare `#alert`.

- [ ] **Step 3: Full suite**

Run: `bun test`
Expected: PASS.

- [ ] **Step 4: Manual end-to-end smoke**

Run: `bun run index.js`; visit a character you don't own / a bogus UUID in the browser.
Expected: styled error page with nav + "Back to home", status 404, no raw PostgREST string. Stop the server.

---

## Self-Review Notes

- **Spec coverage:** Component 1 (classifier) → Task 1; Component 2 (sendError) → Task 2; Component 3 (error view) → Task 3; Component 4 (convert-all) → Tasks 5–12 + verify Task 13; Component 5 (global handler + `#alert`→`#alerts` fix) → Task 4 + Task 13 step 2. Testing section → Tasks 1–2 tests.
- **Type/name consistency:** `classifyError`, `sendError`, `FRIENDLY_NOT_FOUND`, view names `error` / `error-inline`, retarget `#alerts` used identically across all tasks.
- **No placeholders:** all foundational code shown in full; conversion recipe gives concrete before/after transforms plus per-file verification commands.
