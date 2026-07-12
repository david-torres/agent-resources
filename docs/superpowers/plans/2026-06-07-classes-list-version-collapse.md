# Classes List Version Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse each version family on the Classes list page to a single card showing the latest (leaf) version, with inline links to previous versions.

**Architecture:** A new pure util `groupClassVersions(classes)` partitions the already-fetched class list into version families (reusing the same-edition `base_class_id` adjacency from `util/class-family.js`), picks the chain leaf as the primary, and returns `{ primary, previous }` groups. The `GET /classes` route calls it (unless a specific `rules_version` filter is active, in which case it stays flat) and passes `classGroups` to the view, which renders the primary card plus a "Previous:" line of version links.

**Tech Stack:** Node.js, Express, Handlebars, `bun:test`. Grouping is in-memory; no schema or DB-query changes.

---

### Task 1: `groupClassVersions` pure util

**Files:**
- Create: `util/class-list-grouping.js`
- Test: `util/class-list-grouping.test.js`
- Reference (do not modify): `util/class-family.js` (`computeVersionFamily`)

- [ ] **Step 1: Write the failing tests**

Create `util/class-list-grouping.test.js`:

```js
const { test, expect, describe } = require('bun:test');
const { groupClassVersions } = require('./class-list-grouping');

// Minimal class row shape used by the grouping logic.
const cls = (id, { base = null, edition = 'advent', version = 'v1', created_at = '2026-01-01T00:00:00Z', name = id } = {}) => ({
  id,
  name,
  base_class_id: base,
  rules_edition: edition,
  rules_version: version,
  created_at
});

describe('groupClassVersions', () => {
  test('a single class becomes one group with empty previous', () => {
    const groups = groupClassVersions([cls('a')]);
    expect(groups.length).toBe(1);
    expect(groups[0].primary.id).toBe('a');
    expect(groups[0].previous).toEqual([]);
  });

  test('v1 -> v2 chain collapses to v2 with v1 in previous', () => {
    const v1 = cls('v1', { version: 'v1', created_at: '2026-01-01T00:00:00Z' });
    const v2 = cls('v2', { base: 'v1', version: 'v2', created_at: '2026-02-01T00:00:00Z' });
    const groups = groupClassVersions([v1, v2]);
    expect(groups.length).toBe(1);
    expect(groups[0].primary.id).toBe('v2');
    expect(groups[0].previous.map(c => c.id)).toEqual(['v1']);
  });

  test('different editions of the same name stay as separate groups', () => {
    const adv = cls('adv', { edition: 'advent', name: 'Stalker' });
    const asp = cls('asp', { base: 'adv', edition: 'aspirant', name: 'Stalker' });
    const groups = groupClassVersions([adv, asp]);
    expect(groups.length).toBe(2);
    expect(groups.map(g => g.primary.id).sort()).toEqual(['adv', 'asp']);
    for (const g of groups) expect(g.previous).toEqual([]);
  });

  test('branching family picks the newest-created leaf as primary', () => {
    const v1 = cls('v1', { created_at: '2026-01-01T00:00:00Z' });
    const a = cls('a', { base: 'v1', created_at: '2026-02-01T00:00:00Z' });
    const b = cls('b', { base: 'v1', created_at: '2026-03-01T00:00:00Z' });
    const groups = groupClassVersions([v1, a, b]);
    expect(groups.length).toBe(1);
    expect(groups[0].primary.id).toBe('b');
    expect(groups[0].previous.map(c => c.id)).toEqual(['a', 'v1']); // newest-first
  });

  test('a chain with a missing intermediate degrades into separate groups', () => {
    // v2's base (v1) is not in the list, so v2 cannot reach v3's branch via v1.
    const v2 = cls('v2', { base: 'missing-v1', version: 'v2', created_at: '2026-02-01T00:00:00Z' });
    const v3 = cls('v3', { base: 'v2', version: 'v2', created_at: '2026-03-01T00:00:00Z' });
    const lone = cls('lone', { base: 'missing-v1', version: 'v1', created_at: '2026-01-01T00:00:00Z' });
    const groups = groupClassVersions([v2, v3, lone]);
    // v2 <-> v3 connect; lone has no in-list neighbor.
    expect(groups.length).toBe(2);
    const byPrimary = Object.fromEntries(groups.map(g => [g.primary.id, g.previous.map(c => c.id)]));
    expect(byPrimary['v3']).toEqual(['v2']);
    expect(byPrimary['lone']).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test util/class-list-grouping.test.js`
Expected: FAIL — `groupClassVersions` is not exported / module not found.

- [ ] **Step 3: Write the implementation**

Create `util/class-list-grouping.js`:

```js
// Collapse a flat list of classes into version-family groups for the list page.
// Operates ONLY on the rows passed in (the viewer's accessible/filtered set),
// so we never surface a version the viewer can't see and a chain with a missing
// intermediate naturally splits. Family membership reuses the same-edition
// base_class_id adjacency from class-family.js.

const { computeVersionFamily } = require('./class-family');

// Pick the family leaf: the member with no same-edition child present in the
// group. Ties (branches) and "no clear leaf" resolve to the newest created_at.
const pickPrimary = (members) => {
  const ids = new Set(members.map(c => c.id));
  const hasInGroupChild = new Set();
  for (const c of members) {
    if (c.base_class_id && ids.has(c.base_class_id)) {
      const parent = members.find(m => m.id === c.base_class_id);
      if (parent && parent.rules_edition === c.rules_edition) {
        hasInGroupChild.add(c.base_class_id);
      }
    }
  }
  const leaves = members.filter(c => !hasInGroupChild.has(c.id));
  const candidates = leaves.length > 0 ? leaves : members;
  return candidates.slice().sort(byCreatedAtDesc)[0];
};

const byCreatedAtDesc = (a, b) =>
  new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();

// classes: array of full class rows (need id, base_class_id, rules_edition,
// created_at). Returns ordered array of { primary, previous }, group order
// following first appearance of each family among the input rows.
const groupClassVersions = (classes) => {
  const rows = Array.isArray(classes) ? classes.filter(c => c && c.id) : [];
  const byId = new Map(rows.map(c => [c.id, c]));
  const seen = new Set();
  const groups = [];

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    // Family restricted to in-list rows.
    const familyIds = computeVersionFamily(rows, row.id);
    const members = [];
    for (const fid of familyIds) {
      if (byId.has(fid)) {
        members.push(byId.get(fid));
        seen.add(fid);
      }
    }
    const primary = pickPrimary(members);
    const previous = members
      .filter(c => c.id !== primary.id)
      .sort(byCreatedAtDesc);
    groups.push({ primary, previous });
  }

  return groups;
};

module.exports = { groupClassVersions };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test util/class-list-grouping.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add util/class-list-grouping.js util/class-list-grouping.test.js
git commit -m "feat: groupClassVersions collapses class list to version families"
```

---

### Task 2: Wire grouping into the `GET /classes` route

**Files:**
- Modify: `routes/classes.js` (imports near line 31-34; handler at lines 57-90)

- [ ] **Step 1: Import the grouping util**

In `routes/classes.js`, after the existing `require('../util/redeem-code')` line (line 34), add:

```js
const { groupClassVersions } = require('../util/class-list-grouping');
```

- [ ] **Step 2: Build `classGroups` in the `GET /` handler**

In the `router.get('/', authOptional, ...)` handler, replace the render block (currently lines 75-89, starting at `const { data: classes, error } = await getClasses(...)`) with:

```js
    const { data: classes, error } = await getClasses(filters, res.locals.supabase);
    if (error) {
        return sendError(req, res, error);
    }

    // Collapse version families to their latest (leaf) version, UNLESS the user
    // explicitly filtered by a specific rules_version — then show each match flat.
    const versionFiltered = filters.rules_version === 'v1' || filters.rules_version === 'v2';
    const classGroups = versionFiltered
        ? (classes || []).map((c) => ({ primary: c, previous: [] }))
        : groupClassVersions(classes || []);

    res.render('classes', {
        profile,
        title: 'Classes',
        classGroups,
        filters: filters,
        isAdmin,
        activeNav: 'classes',
        breadcrumbs: [
            { label: 'Classes', href: '/classes' }
        ]
    });
```

Note: the `classes` local is intentionally dropped from the render — the view
now consumes `classGroups`.

- [ ] **Step 3: Verify the server boots and the route responds**

Run: `bun -e "require('./routes/classes.js'); console.log('route module loads')"`
Expected: prints `route module loads` with no error (confirms the new import resolves and the file parses).

- [ ] **Step 4: Commit**

```bash
git add routes/classes.js
git commit -m "feat: collapse class list into version groups on GET /classes"
```

---

### Task 3: Render grouped cards with previous-version links

**Files:**
- Modify: `views/classes.handlebars` (the class list loop, lines 93-145)

- [ ] **Step 1: Update the list loop to iterate groups**

In `views/classes.handlebars`, replace the entire `<!-- Class List -->` block
(currently lines 93-145, from `<div class="columns is-multiline" id="classList">`
through its closing — the `{{#each classes}} … {{/each}}` loop) with:

```handlebars
<!-- Class List -->
<div class="columns is-multiline" id="classList">
  <!-- loop over version-collapsed class groups -->
  {{#each classGroups}}
  <div class="column is-3">
    <div class="card">
      {{#if this.primary.image_url}}
      <div class="card-image">
        <a href="/classes/{{this.primary.id}}/{{this.primary.name}}">
          <div
            class="image-crop-render"
            data-cropped-image
            data-image-src="{{this.primary.image_url}}"
            data-crop-x="{{this.primary.image_crop.x}}"
            data-crop-y="{{this.primary.image_crop.y}}"
            data-crop-width="{{this.primary.image_crop.width}}"
            data-crop-height="{{this.primary.image_crop.height}}"
            role="img"
            aria-label="{{this.primary.name}}"
          ></div>
        </a>
      </div>
      {{/if}}
      <div class="card-content">
        <h5 class="title is-5"><a href="/classes/{{this.primary.id}}/{{this.primary.name}}">{{this.primary.name}}</a>
          {{#if (and ../isAdmin (not this.primary.is_public))}}
          <span class="tag is-dark is-light ml-2" title="Not public — only admins can see this">Private</span>
          {{/if}}
          {{#if (eq this.primary.status 'release')}}
          <span class="tag is-success is-light ml-2">
            <span class="icon is-small"><i class="fas fa-star"></i></span>
          </span>
          {{/if}}
          {{#if (eq this.primary.status 'beta')}}
          <span class="tag is-warning is-light ml-2">
            <span class="icon is-small"><i class="fas fa-flask"></i></span>
          </span>
          {{/if}}
          {{#if (eq this.primary.status 'alpha')}}
          <span class="tag is-danger is-light ml-2">
            <span class="icon is-small"><i class="fas fa-flask"></i></span>
          </span>
          {{/if}}
        </h5>
        <p class="subtitle is-7 has-text-grey mb-2">{{capitalize this.primary.rules_edition}} {{this.primary.rules_version}}</p>
        {{#if this.previous.length}}
        <p class="is-size-7 mb-2">
          Previous:
          {{#each this.previous}}
          <a class="tag is-light ml-1" href="/classes/{{this.id}}/{{this.name}}">{{this.rules_version}}</a>
          {{/each}}
        </p>
        {{/if}}
        {{#if this.primary.teaser}}
          <p>{{this.primary.teaser}}</p>
        {{/if}}
      </div>
    </div>
  </div>
  {{/each}}
</div>
```

- [ ] **Step 2: Confirm the template compiles**

Run:
```bash
bun -e "const hb=require('handlebars'); hb.compile(require('fs').readFileSync('views/classes.handlebars','utf8')); console.log('template compiles')"
```
Expected: prints `template compiles` (Handlebars parses the file without throwing). Helper registration (`eq`, `and`, `not`, `capitalize`) is provided by the app at runtime and is not exercised by compile alone.

- [ ] **Step 3: Commit**

```bash
git add views/classes.handlebars
git commit -m "feat: render collapsed class cards with previous-version links"
```

---

### Task 4: Full test run

- [ ] **Step 1: Run the whole suite**

Run: `bun test`
Expected: PASS, including the new `util/class-list-grouping.test.js`. No previously
passing tests regress (the route/view changes are not unit-tested elsewhere).

- [ ] **Step 2: Manual smoke check (optional, if a dev DB is available)**

Run: `bun run dev`, open `/classes`. Verify a class with a `v1 → v2` chain shows
one card for v2 with a "Previous: v1" link, and that selecting Rules Version = v1
in the filter shows v1 cards individually (no collapse).
