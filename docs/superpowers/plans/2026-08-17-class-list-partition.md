# Class List Released/PCC Partition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the public class list page (`GET /classes`) into a "Released Classes" section (cards with thumbnails) followed by a "Player-Created Classes (PCCs)" section (cards without thumbnails).

**Architecture:** A new `partitionClassGroups` helper in `util/class-filter.js` reuses the profile page's released/PCC rule on the version-grouped `{ primary, previous }` shape. The route partitions after filtering + version grouping and passes `releasedGroups`/`pccGroups` to the template. The card markup is extracted into a `class-group-card` partial with a `showImage` flag so the two sections share it.

**Tech Stack:** Express + Handlebars (express-handlebars with `handlebars-helpers`), Bun test runner, Bulma CSS.

**Spec:** `docs/superpowers/specs/2026-08-17-class-list-partition-design.md`

## Global Constraints

- Partition rule (verbatim from spec): a class is in the PCC section when `is_player_created` is true AND `status !== 'release'`; everything else — officials and released PCCs — is in the Released section. No class appears in both.
- Section headings copy, exact: `Released Classes` and `Player-Created Classes (PCCs)` (matches the profile page).
- PCC cards render NO image markup at all, even when the class has `image_url` set.
- The old single `classGroups` render variable is replaced, not kept alongside (no dead code).
- Each section (heading + grid) renders only when its partition is non-empty.
- Tests use `bun test <file>` for a single file; the full unit suite is `bun run test` (runs from repo root `/home/dave/code/agent-resources`).
- Colocated `*.test.js` files under `util/` and `views/` are picked up by the unit suite automatically — do not edit `scripts/run-tests.mjs`.

---

### Task 1: `partitionClassGroups` helper

**Files:**
- Modify: `util/class-filter.js`
- Test: `util/class-filter.test.js`

**Interfaces:**
- Consumes: the `{ primary, previous }` group shape produced by `groupClassVersions` (`util/class-list-grouping.js`); `primary` is a class row with `is_player_created` (boolean) and `status` (string).
- Produces: `partitionClassGroups(groups) -> { released: Group[], pcc: Group[] }`, exported from `util/class-filter.js`. Order within each partition preserves input order. Non-array input returns `{ released: [], pcc: [] }`. Task 2's route code imports exactly this name.

- [ ] **Step 1: Write the failing tests**

Append to the end of `util/class-filter.test.js` (after the existing `partitionProfileClasses` describe block):

```js
describe('partitionClassGroups', () => {
  const grp = (id, { pcc = false, status = 'release' } = {}) => ({
    primary: { id, is_player_created: pcc, status },
    previous: []
  });

  test('groups with official primaries go to released regardless of status', () => {
    const groups = [grp('off-rel'), grp('off-alpha', { status: 'alpha' })];
    const { released, pcc } = partitionClassGroups(groups);
    expect(released.map(g => g.primary.id)).toEqual(['off-rel', 'off-alpha']);
    expect(pcc).toEqual([]);
  });

  test('a released-PCC group graduates into the released section', () => {
    const { released, pcc } = partitionClassGroups([grp('pcc-rel', { pcc: true, status: 'release' })]);
    expect(released.map(g => g.primary.id)).toEqual(['pcc-rel']);
    expect(pcc).toEqual([]);
  });

  test('unreleased PCC groups go to the pcc partition, order preserved', () => {
    const groups = [
      grp('pcc-beta', { pcc: true, status: 'beta' }),
      grp('off'),
      grp('pcc-alpha', { pcc: true, status: 'alpha' })
    ];
    const { released, pcc } = partitionClassGroups(groups);
    expect(released.map(g => g.primary.id)).toEqual(['off']);
    expect(pcc.map(g => g.primary.id)).toEqual(['pcc-beta', 'pcc-alpha']);
  });

  test('no group appears in both partitions', () => {
    const groups = [
      grp('off'),
      grp('pcc-rel', { pcc: true, status: 'release' }),
      grp('pcc-beta', { pcc: true, status: 'beta' })
    ];
    const { released, pcc } = partitionClassGroups(groups);
    const ids = [...released, ...pcc].map(g => g.primary.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(groups.length);
  });

  test('handles non-array input', () => {
    expect(partitionClassGroups(null)).toEqual({ released: [], pcc: [] });
    expect(partitionClassGroups(undefined)).toEqual({ released: [], pcc: [] });
  });
});
```

Also update the require at the top of the file to import the new function:

```js
const { filterClassListsByIds, partitionProfileClasses, partitionClassGroups } = require('./class-filter');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test util/class-filter.test.js`
Expected: FAIL — the new `partitionClassGroups` tests fail with "partitionClassGroups is not a function" (the existing tests still pass).

- [ ] **Step 3: Implement, sharing the predicate with `partitionProfileClasses`**

In `util/class-filter.js`, replace the whole `partitionProfileClasses` function and the `module.exports` line with:

```js
// The one released/PCC rule (spec: docs/superpowers/specs/
// 2026-08-17-class-list-partition-design.md): a PCC belongs in the PCC
// section only until it is released — on release it graduates into the
// official/released section.
const isUnreleasedPcc = (cls) => !!(cls && cls.is_player_created && cls.status !== 'release');

// Split a profile's public classes into the two sections shown on the profile
// view. A PCC that has been released (status='release') has been incorporated
// into the game, so it graduates into the official "released" section and drops
// out of the PCC section — no class appears in both.
const partitionProfileClasses = (classes) => {
  const list = Array.isArray(classes) ? classes : [];
  const released = [];
  const pcc = [];
  for (const cls of list) {
    (isUnreleasedPcc(cls) ? pcc : released).push(cls);
  }
  return { released, pcc };
};

// Same rule applied to the version-grouped shape from class-list-grouping.js:
// partitions an array of { primary, previous } groups by each group's primary.
const partitionClassGroups = (groups) => {
  const list = Array.isArray(groups) ? groups : [];
  const released = [];
  const pcc = [];
  for (const group of list) {
    (isUnreleasedPcc(group && group.primary) ? pcc : released).push(group);
  }
  return { released, pcc };
};

module.exports = { filterClassListsByIds, partitionProfileClasses, partitionClassGroups };
```

Leave `filterClassListsByIds` and the file's top comment untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test util/class-filter.test.js`
Expected: PASS — all tests in the file, including the pre-existing `partitionProfileClasses` ones (they prove the refactor didn't change the profile page's behavior).

- [ ] **Step 5: Commit**

```bash
git add util/class-filter.js util/class-filter.test.js
git commit -m "feat: add partitionClassGroups sharing the released/PCC rule"
```

---

### Task 2: Two-section class list page (partial + template + route)

**Files:**
- Create: `views/partials/class-group-card.handlebars`
- Modify: `views/classes.handlebars:93-153` (the `<!-- Class List -->` block through end of file)
- Modify: `routes/classes.js` (imports around line 34; the `GET /` handler, lines 97-115)
- Test: `views/classes.test.js` (new file)

**Interfaces:**
- Consumes: `partitionClassGroups(groups)` from `util/class-filter.js` (Task 1).
- Produces: template render variables `releasedGroups` and `pccGroups` (each an array of `{ primary, previous }`), replacing `classGroups`; partial `class-group-card` invoked as `{{> class-group-card this showImage=true}}` (context = one group; omit `showImage` to suppress art).

- [ ] **Step 1: Write the failing view tests**

Create `views/classes.test.js` (pattern follows `views/my-classes.test.js` — render the real template through Handlebars with production helpers and partials):

```js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const customHelpers = require('../util/handlebars');

const handlebarsHelpers = require('handlebars-helpers')();

const partialSource = (name) => fs.readFileSync(
  path.join(__dirname, 'partials', `${name}.handlebars`), 'utf8'
);

function renderClasses(context) {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('breadcrumbs', partialSource('breadcrumbs'));
  hb.registerPartial('section-heading', partialSource('section-heading'));
  hb.registerPartial('class-group-card', partialSource('class-group-card'));
  const src = fs.readFileSync(path.join(__dirname, 'classes.handlebars'), 'utf8');
  return hb.compile(src)(context);
}

const group = (id, name, { image = false, status = 'release', previous = [] } = {}) => ({
  primary: {
    id,
    name,
    status,
    is_public: true,
    rules_edition: 'advent',
    rules_version: 'v1',
    image_url: image ? `https://cdn.example/${id}.png` : null,
    image_crop: image ? { x: 0, y: 0, width: 100, height: 100 } : null,
    teaser: `${name} teaser`
  },
  previous
});

const baseContext = (overrides = {}) => ({
  filters: { rules_edition: '', rules_version: '', status: '' },
  isAdmin: false,
  releasedGroups: [],
  pccGroups: [],
  ...overrides
});

test('released section renders its heading and thumbnail art', () => {
  const html = renderClasses(baseContext({
    releasedGroups: [group('rel-1', 'Gunslinger', { image: true })]
  }));
  expect(html).toContain('Released Classes');
  expect(html).toContain('image-crop-render');
  expect(html).toContain('/classes/rel-1/Gunslinger');
});

test('PCC cards render no image markup even when the class has art', () => {
  const html = renderClasses(baseContext({
    pccGroups: [group('pcc-1', 'Homebrew', { image: true, status: 'beta' })]
  }));
  expect(html).toContain('Player-Created Classes (PCCs)');
  expect(html).toContain('/classes/pcc-1/Homebrew');
  expect(html).not.toContain('image-crop-render');
  expect(html).not.toContain('card-image');
});

test('released section appears before the PCC section', () => {
  const html = renderClasses(baseContext({
    releasedGroups: [group('rel-1', 'Gunslinger')],
    pccGroups: [group('pcc-1', 'Homebrew', { status: 'beta' })]
  }));
  const releasedAt = html.indexOf('Released Classes');
  const pccAt = html.indexOf('Player-Created Classes (PCCs)');
  expect(releasedAt).toBeGreaterThan(-1);
  expect(pccAt).toBeGreaterThan(releasedAt);
});

test('an empty partition hides its whole section', () => {
  const onlyReleased = renderClasses(baseContext({
    releasedGroups: [group('rel-1', 'Gunslinger')]
  }));
  expect(onlyReleased).not.toContain('Player-Created Classes (PCCs)');

  const onlyPcc = renderClasses(baseContext({
    pccGroups: [group('pcc-1', 'Homebrew', { status: 'beta' })]
  }));
  expect(onlyPcc).not.toContain('Released Classes');

  const empty = renderClasses(baseContext());
  expect(empty).not.toContain('Released Classes');
  expect(empty).not.toContain('Player-Created Classes (PCCs)');
});

test('previous-version links still render inside a card', () => {
  const html = renderClasses(baseContext({
    releasedGroups: [group('rel-2', 'Librarian', {
      previous: [{ id: 'rel-old', name: 'Librarian', rules_version: 'v1' }]
    })]
  }));
  expect(html).toContain('Previous:');
  expect(html).toContain('/classes/rel-old/Librarian');
});

test('admin-only Private tag renders only for admins on non-public classes', () => {
  const privateGroup = group('priv-1', 'Secret');
  privateGroup.primary.is_public = false;
  const asAdmin = renderClasses(baseContext({ isAdmin: true, releasedGroups: [privateGroup] }));
  expect(asAdmin).toContain('Private');
  const asUser = renderClasses(baseContext({ isAdmin: false, releasedGroups: [privateGroup] }));
  expect(asUser).not.toContain('Private');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test views/classes.test.js`
Expected: FAIL — `partialSource('class-group-card')` throws ENOENT (the partial doesn't exist yet).

- [ ] **Step 3: Create the card partial**

Create `views/partials/class-group-card.handlebars`. This is the markup currently at `views/classes.handlebars:97-151`, with three changes: context is the group itself (`primary.…` instead of `this.primary.…`), the image block is additionally gated on `showImage`, and the admin check uses `@root.isAdmin` (partials don't inherit the `../` parent frame):

```handlebars
<div class="column is-3">
  <div class="card">
    {{#if (and showImage primary.image_url)}}
    <div class="card-image">
      <a href="/classes/{{primary.id}}/{{primary.name}}">
        <div
          class="image-crop-render"
          data-cropped-image
          data-image-src="{{primary.image_url}}"
          data-crop-x="{{primary.image_crop.x}}"
          data-crop-y="{{primary.image_crop.y}}"
          data-crop-width="{{primary.image_crop.width}}"
          data-crop-height="{{primary.image_crop.height}}"
          role="img"
          aria-label="{{primary.name}}"
        ></div>
      </a>
    </div>
    {{/if}}
    <div class="card-content">
      <h5 class="title is-5"><a href="/classes/{{primary.id}}/{{primary.name}}">{{primary.name}}</a>
        {{#if (and @root.isAdmin (not primary.is_public))}}
        <span class="tag is-dark is-light ml-2" title="Not public — only admins can see this">Private</span>
        {{/if}}
        {{#if (eq primary.status 'release')}}
        <span class="tag is-success is-light ml-2">
          <span class="icon is-small"><i class="fas fa-star"></i></span>
        </span>
        {{/if}}
        {{#if (eq primary.status 'beta')}}
        <span class="tag is-warning is-light ml-2">
          <span class="icon is-small"><i class="fas fa-flask"></i></span>
        </span>
        {{/if}}
        {{#if (eq primary.status 'alpha')}}
        <span class="tag is-danger is-light ml-2">
          <span class="icon is-small"><i class="fas fa-flask"></i></span>
        </span>
        {{/if}}
      </h5>
      <p class="subtitle is-7 has-text-grey mb-2">{{capitalize primary.rules_edition}} {{primary.rules_version}}</p>
      {{#if previous.length}}
      <p class="is-size-7 mb-2">
        Previous:
        {{#each previous}}
        <a class="tag is-light ml-1" href="/classes/{{this.id}}/{{this.name}}">{{this.rules_version}}</a>
        {{/each}}
      </p>
      {{/if}}
      {{#if primary.teaser}}
        <p>{{primary.teaser}}</p>
      {{/if}}
    </div>
  </div>
</div>
```

- [ ] **Step 4: Rewrite the class-list block of the page template**

In `views/classes.handlebars`, replace everything from `<!-- Class List -->` (line 93) to the end of the file with:

```handlebars
<!-- Class List -->
{{#if releasedGroups.length}}
{{> section-heading tag="h2" class="title is-4" id="released-classes" title="Released Classes"}}
<div class="columns is-multiline" id="classList">
  {{#each releasedGroups}}
  {{> class-group-card this showImage=true}}
  {{/each}}
</div>
{{/if}}

{{#if pccGroups.length}}
{{> section-heading tag="h2" class="title is-4" id="player-created-classes" title="Player-Created Classes (PCCs)"}}
<div class="columns is-multiline" id="pccClassList">
  {{#each pccGroups}}
  {{> class-group-card this}}
  {{/each}}
</div>
{{/if}}
```

The old inline card markup is deleted entirely — the partial is its only home now. (Nothing in `public/js` selects `#classList`; keeping the id on the released grid is just continuity for CSS/devtools.)

- [ ] **Step 5: Wire the route**

In `routes/classes.js`:

1. Extend the util import block (after line 34, next to the `groupClassVersions` require):

```js
const { partitionClassGroups } = require('../util/class-filter');
```

2. In the `GET /` handler, after the existing `classGroups` computation (lines 99-102), partition and change the render call — `classGroups` is no longer passed:

```js
    // Collapse version families to their latest (leaf) version, UNLESS the user
    // explicitly filtered by a specific rules_version — then show each match flat.
    const versionFiltered = !!filters.rules_version;
    const classGroups = versionFiltered
        ? (classes || []).map((c) => ({ primary: c, previous: [] }))
        : groupClassVersions(classes || []);
    // Released classes (officials + graduated PCCs) lead the page; unreleased
    // PCCs get their own art-free section below.
    const { released: releasedGroups, pcc: pccGroups } = partitionClassGroups(classGroups);

    res.render('classes', {
        profile,
        title: 'Classes',
        releasedGroups,
        pccGroups,
        filters: filters,
        isAdmin,
        activeNav: 'classes',
        breadcrumbs: [
            { label: 'Classes', href: '/classes' }
        ]
    });
```

- [ ] **Step 6: Run the view tests to verify they pass**

Run: `bun test views/classes.test.js`
Expected: PASS (all 6 tests).

- [ ] **Step 7: Run the full unit suite**

Run: `bun run test`
Expected: PASS — nothing else referenced the `classGroups` render variable, and the `class-filter` refactor is covered by Task 1's tests. If anything fails, fix before committing.

- [ ] **Step 8: Commit**

```bash
git add views/partials/class-group-card.handlebars views/classes.handlebars views/classes.test.js routes/classes.js
git commit -m "feat: split class list into released and PCC sections"
```
