# Library Version Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `GET /library`, show one card per document title (highest edition), with older editions as inline "Previous" tag links — mirroring the classes list version collapse.

**Architecture:** A new pure grouping util (`util/library-list-grouping.js`) collapses decorated `rules_pdfs` rows into `[{ primary, previous }]` by `title`, sorted `edition` desc / `created_at` desc. The `GET /library` route maps its already-decorated rows through it and passes `ruleGroups` to the view; the view renders `primary` per card and previous editions as tag links, only when `primary.canView`. `/library/manage` stays flat.

**Tech Stack:** Express 4 + express-handlebars, Bun runtime, `bun:test` for unit tests, Bulma CSS.

**Spec:** `docs/superpowers/specs/2026-08-16-library-version-collapse-design.md`

## Global Constraints

- Edition ordering is **plain string comparison** (descending), NOT semantic-version parsing; tie-break by `created_at` descending. (Spec: "This is plain string comparison, not semantic-version parsing.")
- The grouping util operates **only on the rows passed in** — no fetching, no filtering by `is_active`.
- Previous-version links render **only when `primary.canView` is true**. Locked and expired cards look exactly as they do today.
- Only `GET /library` collapses. Do not touch `/library/manage` or `views/library-manage.handlebars`.
- Replace the flat `{{#each rules}}` loop — do not leave the old iteration behind (No Dead Code rule).
- Run tests with `bun run test` (unit group; new test file is not in the http/integration allowlists in `scripts/run-tests.mjs`, so it runs in unit automatically).

---

### Task 1: Grouping util `groupRulesVersions` (TDD)

**Files:**
- Create: `util/library-list-grouping.js`
- Test: `util/library-list-grouping.test.js`

**Interfaces:**
- Consumes: nothing from other tasks. Input rows are plain objects needing `id`, `title`, `edition`, `created_at` (extra decorated fields like `canView` pass through untouched).
- Produces: `groupRulesVersions(rules) -> [{ primary, previous }]` where `primary` is one input row and `previous` is an array of input rows, exported via `module.exports = { groupRulesVersions }`. Task 2 imports this exact name.

- [ ] **Step 1: Write the failing tests**

Create `util/library-list-grouping.test.js` (mirrors the style of `util/class-list-grouping.test.js`):

```js
const { test, expect, describe } = require('bun:test');
const { groupRulesVersions } = require('./library-list-grouping');

// Minimal rules_pdf row shape used by the grouping logic.
const pdf = (id, { title = 'Advent', edition = 'v1', created_at = '2026-01-01T00:00:00Z' } = {}) => ({
  id,
  title,
  edition,
  created_at
});

describe('groupRulesVersions', () => {
  test('a single document becomes one group with empty previous', () => {
    const groups = groupRulesVersions([pdf('a')]);
    expect(groups.length).toBe(1);
    expect(groups[0].primary.id).toBe('a');
    expect(groups[0].previous).toEqual([]);
  });

  test('two editions of one title collapse to the highest edition', () => {
    const v1 = pdf('v1', { edition: 'v1' });
    const v2 = pdf('v2', { edition: 'v2' });
    const groups = groupRulesVersions([v2, v1]);
    expect(groups.length).toBe(1);
    expect(groups[0].primary.id).toBe('v2');
    expect(groups[0].previous.map(r => r.id)).toEqual(['v1']);
  });

  test('distinct titles stay as separate groups', () => {
    const a = pdf('a', { title: 'Advent' });
    const b = pdf('b', { title: 'Aspirant' });
    const groups = groupRulesVersions([a, b]);
    expect(groups.length).toBe(2);
    for (const g of groups) expect(g.previous).toEqual([]);
  });

  test('primary is picked by edition string regardless of input order', () => {
    const v1 = pdf('v1', { edition: 'v1' });
    const v2 = pdf('v2', { edition: 'v2' });
    const v3 = pdf('v3', { edition: 'v3' });
    const groups = groupRulesVersions([v1, v3, v2]);
    expect(groups.length).toBe(1);
    expect(groups[0].primary.id).toBe('v3');
    expect(groups[0].previous.map(r => r.id)).toEqual(['v2', 'v1']); // edition desc
  });

  test('equal editions tie-break by newest created_at', () => {
    const older = pdf('older', { edition: 'v1', created_at: '2026-01-01T00:00:00Z' });
    const newer = pdf('newer', { edition: 'v1', created_at: '2026-02-01T00:00:00Z' });
    const groups = groupRulesVersions([older, newer]);
    expect(groups.length).toBe(1);
    expect(groups[0].primary.id).toBe('newer');
    expect(groups[0].previous.map(r => r.id)).toEqual(['older']);
  });

  test('group order follows first appearance of each title in the input', () => {
    const b1 = pdf('b1', { title: 'Bestiary' });
    const a1 = pdf('a1', { title: 'Advent' });
    const b2 = pdf('b2', { title: 'Bestiary', edition: 'v2' });
    const groups = groupRulesVersions([b1, a1, b2]);
    expect(groups.map(g => g.primary.title)).toEqual(['Bestiary', 'Advent']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test util/library-list-grouping.test.js`
Expected: FAIL — cannot resolve module `./library-list-grouping`.

- [ ] **Step 3: Write the implementation**

Create `util/library-list-grouping.js`:

```js
// Collapse a flat list of rules PDFs into title-family groups for the library
// page. Versions of a document are rows sharing a title and differing by
// edition (see util/rules-family.js). Operates ONLY on the rows passed in
// (the viewer's set), so we never surface a version the viewer can't see.

// Highest edition first, by plain string comparison — the same ordering the
// list query uses — with newest created_at breaking ties.
const byEditionDesc = (a, b) => {
  const ea = String(a.edition || '');
  const eb = String(b.edition || '');
  if (ea !== eb) return ea < eb ? 1 : -1;
  return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
};

// rules: array of rules_pdf rows (need id, title, edition, created_at).
// Returns ordered array of { primary, previous }, group order following
// first appearance of each title among the input rows.
const groupRulesVersions = (rules) => {
  const rows = Array.isArray(rules) ? rules.filter(r => r && r.id) : [];
  const membersByTitle = new Map();
  for (const row of rows) {
    if (!membersByTitle.has(row.title)) membersByTitle.set(row.title, []);
    membersByTitle.get(row.title).push(row);
  }
  return [...membersByTitle.values()].map((members) => {
    const sorted = members.slice().sort(byEditionDesc);
    return { primary: sorted[0], previous: sorted.slice(1) };
  });
};

module.exports = { groupRulesVersions };
```

(`Map` preserves insertion order, which gives the first-appearance group order.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test util/library-list-grouping.test.js`
Expected: 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add util/library-list-grouping.js util/library-list-grouping.test.js
git commit -m "feat: add title-family grouping util for the library list"
```

---

### Task 2: Wire route and view to render collapsed groups

**Files:**
- Modify: `routes/library.js` (import block near line 26; `GET /` render call at lines 92-101)
- Modify: `views/library.handlebars` (card grid, lines 34-90)

**Interfaces:**
- Consumes: `const { groupRulesVersions } = require('../util/library-list-grouping');` from Task 1 — takes the decorated rows array, returns `[{ primary, previous }]`.
- Produces: the `library` view now receives `ruleGroups` (array of `{ primary, previous }`) instead of `rules`. Each `primary`/`previous` entry is a decorated rule row (`id`, `title`, `edition`, `is_active`, `isUnlocked`, `isExpired`, `canView`, `expires_at`).

There are no route- or view-level tests for this page (matching the classes precedent), so this task is wiring verified by the full unit suite plus the template rendering successfully.

- [ ] **Step 1: Import the util in the route**

In `routes/library.js`, after the existing `expandRulesUnlocksByTitle` import (line 26), add:

```js
const { groupRulesVersions } = require('../util/library-list-grouping');
```

- [ ] **Step 2: Pass groups to the view**

In the `GET /` handler, replace the `rules: rulesWithAccess,` line of the `res.render('library', {...})` call (line 95) with:

```js
        ruleGroups: groupRulesVersions(rulesWithAccess),
```

The decoration block above it (lines 77-90) is unchanged — every version keeps its own `canView`. Do not touch `/manage` or any other handler.

- [ ] **Step 3: Rewrite the card grid in the view**

In `views/library.handlebars`, replace everything from `{{#if rules.length}}` (line 34) through the closing `{{/if}}` (line 90) with:

```hbs
{{#if ruleGroups.length}}
<div class="columns is-multiline">
  {{#each ruleGroups}}
  <div class="column is-full-tablet is-half-desktop">
    <div class="card">
      <div class="card-content">
        <div class="content">
          <p class="title is-4">{{this.primary.title}}</p>
          <p class="subtitle is-6">Edition: {{this.primary.edition}}</p>
          {{#if ../isAdmin}}
          <p>
            <span class="tag {{#if this.primary.is_active}}is-success{{else}}is-danger{{/if}} is-light">
              {{#if this.primary.is_active}}Active{{else}}Inactive{{/if}}
            </span>
          </p>
          {{/if}}
          {{#if this.primary.canView}}
          <div class="notification is-success is-light">
            <span class="icon-text">
              <span class="icon"><i class="fas fa-unlock"></i></span>
              <span>Access granted</span>
            </span>
            {{#if this.primary.expires_at}}
            <br>
            <span class="is-size-7">Expires {{date_tz this.primary.expires_at}}</span>
            {{/if}}
          </div>
          <a class="button is-link is-fullwidth" href="/library/{{this.primary.id}}/view">
            <span class="icon"><i class="fas fa-file-pdf"></i></span>
            <span>Open PDF</span>
          </a>
          {{#if this.previous.length}}
          <p class="is-size-7 mt-3 mb-0">
            Previous:
            {{#each this.previous}}
            <a class="tag is-light ml-1" href="/library/{{this.id}}/view">{{this.edition}}</a>
            {{/each}}
          </p>
          {{/if}}
          {{else if this.primary.isUnlocked}}
          <div class="notification is-warning is-light">
            <span class="icon-text">
              <span class="icon"><i class="fas fa-hourglass-end"></i></span>
              <span>Access expired {{date_tz this.primary.expires_at}}</span>
            </span>
          </div>
          {{else}}
          <div class="notification is-light">
            <span class="icon-text">
              <span class="icon"><i class="fas fa-lock"></i></span>
              <span>Unlock required</span>
            </span>
          </div>
          {{/if}}
        </div>
      </div>
    </div>
  </div>
  {{/each}}
</div>
{{else}}
<div class="notification is-light">
  No rules PDFs available yet. Check back soon.
</div>
{{/if}}
```

Notes: the `Previous:` row sits inside the `canView` branch only (locked/expired cards hide it, per spec). The header, Character Sheets box, and everything above line 34 are untouched. The old flat `{{#each rules}}` loop must be fully gone — no commented-out remains.

- [ ] **Step 4: Run the unit suite**

Run: `bun run test`
Expected: all tests pass (including the 6 from Task 1).

- [ ] **Step 5: Verify no stale references to the old view variable**

Run: `grep -n "each rules" views/library.handlebars; grep -n "rules:" routes/library.js`
Expected: no `{{#each rules}}` match in the view; the only `rules:` render keys left in `routes/library.js` belong to the `/manage` handler (which stays flat).

- [ ] **Step 6: Commit**

```bash
git add routes/library.js views/library.handlebars
git commit -m "feat: collapse library document versions into a single card"
```
