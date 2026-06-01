# "Private" Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a "Private" badge (lock icon + "Private") next to any non-public character, mission, class, profile, or LFG post — on its detail page and in list views.

**Architecture:** One reusable Handlebars partial `views/partials/private-badge.handlebars` owns the badge markup and the `is_public` guard; ~10 templates invoke it with the entity's `is_public` flag already in their scope. No backend, query, or schema changes.

**Tech Stack:** express-handlebars (Handlebars), Bulma `tag`, Font Awesome 7 (`fas fa-lock`), `bun test`.

---

## File Structure

- Create: `views/partials/private-badge.handlebars` — the badge + guard (single responsibility).
- Create: `views/partials/private-badge.test.js` — unit test compiling the partial.
- Modify (detail headers): `views/character.handlebars`, `views/mission.handlebars`, `views/class-view.handlebars`, `views/profile.handlebars`, `views/lfg-post.handlebars`.
- Modify (list rows): `views/character-list.handlebars`, `views/mission-list.handlebars`, `views/my-classes.handlebars`, `views/partials/lfg-my-posts.handlebars`, `views/partials/lfg-joined-posts.handlebars`.

**Not modified:** `views/partials/lfg-public-posts.handlebars` (its query filters `is_public = true`, so a private post can never appear there — the badge would never render). `views/profile-view.handlebars` (route 404s on non-public profiles, so it only ever renders public ones).

**Confirmed `is_public` is in scope** for every call site: characters/missions/classes/profiles load via `select('*')` (or already reference `this.is_public` in-template); `getProfile` selects `*`; LFG `getLfgPostsByCreator` and `getLfgPost` use `select('*')`, and `getLfgJoinedPosts` explicitly selects `is_public`.

---

## Task 1: Create the badge partial (TDD)

**Files:**
- Create: `views/partials/private-badge.handlebars`
- Test: `views/partials/private-badge.test.js`

- [ ] **Step 1: Write the failing test**

```js
// views/partials/private-badge.test.js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const src = fs.readFileSync(path.join(__dirname, 'private-badge.handlebars'), 'utf8');
const render = (ctx) => Handlebars.compile(src)(ctx).trim();

test('renders the Private badge when isPublic is false', () => {
  const html = render({ isPublic: false });
  expect(html).toContain('Private');
  expect(html).toContain('fa-lock');
  expect(html).toContain('tag');
});

test('renders nothing when isPublic is true', () => {
  expect(render({ isPublic: true })).toBe('');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test views/partials/private-badge.test.js`
Expected: FAIL — `private-badge.handlebars` does not exist (ENOENT).

- [ ] **Step 3: Create the partial**

```handlebars
{{#unless isPublic}}<span class="tag is-warning is-light ml-2" title="Only you can see this"><span class="icon is-small"><i class="fas fa-lock"></i></span><span>Private</span></span>{{/unless}}
```

Note: `{{#unless isPublic}}` renders the badge whenever `isPublic` is not truthy. Every call site confirmed to pass a real `is_public` boolean (see File Structure), so the relevant cases are `false` → badge and `true` → nothing.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test views/partials/private-badge.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add views/partials/private-badge.handlebars views/partials/private-badge.test.js
git commit -m "feat: add reusable private-badge partial"
```

---

## Task 2: Add badge to detail-page headers

**Files:** Modify `views/character.handlebars`, `views/mission.handlebars`, `views/class-view.handlebars`, `views/profile.handlebars`, `views/lfg-post.handlebars`

- [ ] **Step 1: character.handlebars** — inside the `<h1>` title, after the closing `{{/if}}` of the deceased block and before `</h1>`.

Find:
```handlebars
  {{#if character.is_deceased}}
  <span class="tag is-dark is-medium ml-2">
    <span class="icon"><i class="fas fa-skull"></i></span>
    <span>Deceased</span>
  </span>
  {{/if}}
</h1>
```
Replace the trailing `{{/if}}\n</h1>` so it becomes:
```handlebars
  {{/if}}
  {{> private-badge isPublic=character.is_public}}
</h1>
```

- [ ] **Step 2: mission.handlebars** — line 2.

Find: `<h1 class="title is-2">{{mission.name}}</h1>`
Replace with: `<h1 class="title is-2">{{mission.name}}{{> private-badge isPublic=mission.is_public}}</h1>`

- [ ] **Step 3: class-view.handlebars** — inside the `<h1>` that starts `<h1 class="title is-2">{{class.name}}`. Add the partial immediately after `{{class.name}}` (before the status-badge `{{#if}}` blocks).

Find: `<h1 class="title is-2">{{class.name}}`
Replace with: `<h1 class="title is-2">{{class.name}}{{> private-badge isPublic=class.is_public}}`

(Leave the existing "Public: Yes/No" text elsewhere in the file untouched.)

- [ ] **Step 4: profile.handlebars** — line 2. This is the owner's own profile page (the place an owner sees their own visibility).

Find: `<h2 class="title is-2">User Profile</h2>`
Replace with: `<h2 class="title is-2">User Profile{{> private-badge isPublic=profile.is_public}}</h2>`

- [ ] **Step 5: lfg-post.handlebars** — line 3.

Find: `  <h3 class="title is-4">{{post.title}}</h3>`
Replace with: `  <h3 class="title is-4">{{post.title}}{{> private-badge isPublic=post.is_public}}</h3>`

- [ ] **Step 6: Verify all five includes are present**

Run: `rg -n "private-badge" views/character.handlebars views/mission.handlebars views/class-view.handlebars views/profile.handlebars views/lfg-post.handlebars`
Expected: exactly one match per file (5 total).

- [ ] **Step 7: Verify templates still compile (server boots)**

Run: `PORT=3997 NODE_ENV=development timeout 5 bun run index.js`
Expected: prints `Server is running on port 3997` with no Handlebars parse error in output.

- [ ] **Step 8: Commit**

```bash
git add views/character.handlebars views/mission.handlebars views/class-view.handlebars views/profile.handlebars views/lfg-post.handlebars
git commit -m "feat: show Private badge on non-public detail pages"
```

---

## Task 3: Add badge to list views

**Files:** Modify `views/character-list.handlebars`, `views/mission-list.handlebars`, `views/my-classes.handlebars`, `views/partials/lfg-my-posts.handlebars`, `views/partials/lfg-joined-posts.handlebars`

- [ ] **Step 1: character-list.handlebars** — after the name link, before the deceased block (inside the `{{#each characters}}` loop).

Find:
```handlebars
            <a href="/characters/{{this.id}}/{{this.name}}">{{this.name}}</a>
            {{#if this.is_deceased}}
```
Replace with:
```handlebars
            <a href="/characters/{{this.id}}/{{this.name}}">{{this.name}}</a>
            {{> private-badge isPublic=this.is_public}}
            {{#if this.is_deceased}}
```

- [ ] **Step 2: mission-list.handlebars — "Your Missions" table name cell** (inside `{{#each missions}}`).

Find (the first occurrence):
```handlebars
        <td>
          {{this.name}}
          {{#if this.media_url}}
          <span class="icon has-text-info" title="Has video recording"><i class="fas fa-video"></i></span>
          {{/if}}
        </td>
```
Replace with:
```handlebars
        <td>
          {{this.name}}
          {{#if this.media_url}}
          <span class="icon has-text-info" title="Has video recording"><i class="fas fa-video"></i></span>
          {{/if}}
          {{> private-badge isPublic=this.is_public}}
        </td>
```

- [ ] **Step 3: mission-list.handlebars — "Missions You Can Edit" table name cell** (inside `{{#each editableMissions}}`, the cell containing the `Editor` tag).

Find:
```handlebars
          {{/if}}
          <span class="tag is-info is-light ml-2">Editor</span>
        </td>
```
Replace with:
```handlebars
          {{/if}}
          {{> private-badge isPublic=this.is_public}}
          <span class="tag is-info is-light ml-2">Editor</span>
        </td>
```

- [ ] **Step 4: my-classes.handlebars** — after the name link, before the status badges (inside `{{#each classes}}`).

Find: `          <span class="title is-4"><a href="/classes/{{this.id}}/{{this.name}}">{{this.name}}</a></span>`
Replace with:
```handlebars
          <span class="title is-4"><a href="/classes/{{this.id}}/{{this.name}}">{{this.name}}</a></span>
          {{> private-badge isPublic=this.is_public}}
```

(Leave the existing `<td>{{#if this.is_public}}Yes{{else}}No{{/if}}</td>` column untouched.)

- [ ] **Step 5: lfg-my-posts.handlebars** — after the title in the row cell (inside `{{#each ownPosts}}`).

Find: `        <td>{{this.title}}{{#if this.pending_request_count}}<span class="badge is-danger">{{this.pending_request_count}}</span>{{/if}}</td>`
Replace with: `        <td>{{this.title}}{{> private-badge isPublic=this.is_public}}{{#if this.pending_request_count}}<span class="badge is-danger">{{this.pending_request_count}}</span>{{/if}}</td>`

- [ ] **Step 6: lfg-joined-posts.handlebars** — after the title (inside `{{#each joinedPosts}}`).

Find: `    <h3 class="title is-4">{{this.title}}</h3>`
Replace with: `    <h3 class="title is-4">{{this.title}}{{> private-badge isPublic=this.is_public}}</h3>`

- [ ] **Step 7: Verify all five includes are present**

Run: `rg -n "private-badge" views/character-list.handlebars views/mission-list.handlebars views/my-classes.handlebars views/partials/lfg-my-posts.handlebars views/partials/lfg-joined-posts.handlebars`
Expected: character-list 1, mission-list 2, my-classes 1, lfg-my-posts 1, lfg-joined-posts 1 (6 matches total).

- [ ] **Step 8: Verify templates still compile (server boots)**

Run: `PORT=3997 NODE_ENV=development timeout 5 bun run index.js`
Expected: prints `Server is running on port 3997` with no Handlebars parse error.

- [ ] **Step 9: Commit**

```bash
git add views/character-list.handlebars views/mission-list.handlebars views/my-classes.handlebars views/partials/lfg-my-posts.handlebars views/partials/lfg-joined-posts.handlebars
git commit -m "feat: show Private badge in list views for non-public items"
```

---

## Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite green**

Run: `bun test`
Expected: PASS (includes the 2 new partial tests; no regressions).

- [ ] **Step 2: Partial-render sanity via the test harness**

Run: `bun test views/partials/private-badge.test.js`
Expected: 2 pass (badge present for `false`, empty for `true`).

- [ ] **Step 3: Confirm every intended call site exists and no stray sites**

Run: `rg -lc "private-badge" views/`
Expected: 11 files total — the partial itself is NOT listed (it doesn't reference its own name); the 10 call-site templates each appear, with `mission-list.handlebars` showing count 2.

- [ ] **Step 4: Manual visual check (optional, requires a logged-in session)**

Start the app, sign in, and view a private character/mission/class you own plus your profile if not public: the lock + "Private" badge appears next to the title and in the list row. View a public item: no badge.

---

## Self-Review Notes

- **Spec coverage:** partial → Task 1; detail badges for characters/missions/classes/profiles/LFG → Task 2; list badges → Task 3; "keep classes Yes/No text" honored (Task 2 Step 3, Task 3 Step 4 leave it). Spec deviation, intentional & documented: profiles use `profile.handlebars` not `profile-view.handlebars` (route 404s on private profiles); `lfg-public-posts` skipped (can never contain a private post).
- **Naming consistency:** partial name `private-badge`, hash key `isPublic`, entity flags `character.is_public` / `mission.is_public` / `class.is_public` / `profile.is_public` / `post.is_public` / `this.is_public` used consistently.
- **No placeholders:** every edit shows exact find/replace text and verification commands.
