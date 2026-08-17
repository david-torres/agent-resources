# Admin Unlocks Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `/library/manage` into a content-only page plus a new admin `/library/unlocks` dashboard that owns all grant/unlock/code UI with filterable cross-PDF tables.

**Architecture:** Express + Handlebars server-rendered pages. New list-all admin queries live in `services/rules/repository.js` (the only rules-domain consumer of `supabaseAdmin`), delegated through `models/rules.js`. The dashboard route stamps display state (`isExpired`, `isUsable`) server-side; a small inline script filters table rows client-side off data attributes. Grant/generate endpoints move the document id from the URL path to the request body (`rules_pdf_id` select in the form) — htmx captures `hx-post` paths at process time, so per-selection action-URL swapping does not work.

**Tech Stack:** Express, express-handlebars, Bulma CSS, Font Awesome icons, htmx, Supabase (postgrest joins), bun:test.

**Spec:** `docs/superpowers/specs/2026-08-16-admin-unlocks-dashboard-design.md`

## Global Constraints

- Test runner is `bun test` (`bun test path/to/file.test.js` for one file).
- No dead code: when a task replaces something, the same task deletes what it orphans (old routes, model functions, test cases).
- Follow existing error style: `sendError(req, res, error, { status?, message? })` from `util/http-error`.
- Timestamps in templates render with the existing `date_tz` helper: `{{date_tz this.unlocked_at}}`.
- All new admin routes use the existing `isAuthenticated, requireAdmin` middleware pair from `util/auth` (401 unauthenticated, 403 non-admin).
- Class unlocks are out of scope; touch nothing under `routes/classes.js`. `views/partials/unlock-code-result.handlebars` is shared with classes — reuse it, do not modify or delete it.
- Route order in `routes/library.js` matters: literal paths (`/unlocks`, `/codes`) must be registered before the `/:id` handlers.

---

### Task 1: List-all admin query helpers

**Files:**
- Modify: `services/rules/repository.js` (add two functions to `module.exports`)
- Modify: `models/rules.js` (add two delegating functions + exports)
- Test: `models/rules-admin-lists.test.js` (create)

**Interfaces:**
- Consumes: `supabaseAdmin` from `models/_base` (already wrapped by the repository's `withResult`).
- Produces:
  - `listAllUnlockGrantsAdmin(): Promise<{data: GrantRow[]|null, error}>` where `GrantRow = { user_id, profile_id, granted_by, unlocked_at, expires_at, profile: {id, name}|null, granter: {id, name}|null, rules_pdf: {id, title, edition} }`, ordered `unlocked_at` desc.
  - `listAllUnlockCodesAdmin(): Promise<{data: CodeRow[]|null, error}>` where `CodeRow = { id, code, rules_pdf_id, created_at, expires_at, max_uses, used_count, rules_pdf: {id, title, edition}, creator: {id, name}|null }`, ordered `created_at` desc.

- [ ] **Step 1: Write the failing test**

Create `models/rules-admin-lists.test.js`. Same fake-client mock.module pattern as `models/rules-codes.test.js`, but recording `from`/`select`/`order` calls (these queries have no `.eq` filter — that absence is part of the contract):

```js
const { mock, test, expect, afterAll } = require('bun:test');

const realBase = require('./_base');

// Records which table each query starts from, the select column string, and
// order calls; resolves with canned data.
const queries = [];
const fakeClient = {
    from(table) {
        const record = { table, select: null, orders: [], eqs: [] };
        queries.push(record);
        const chain = {
            select(cols) { record.select = cols; return chain; },
            eq(column, value) { record.eqs.push({ column, value }); return chain; },
            order(column, options) { record.orders.push({ column, options }); return chain; },
            then(onFulfilled, onRejected) {
                return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
            }
        };
        return chain;
    },
    rpc() { return Promise.resolve({ data: null, error: null }); }
};

mock.module('./_base', () => ({
    supabase: fakeClient,
    supabaseAdmin: fakeClient,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeClient
}));

delete require.cache[require.resolve('./rules')];
const { listAllUnlockGrantsAdmin, listAllUnlockCodesAdmin } = require('./rules');

afterAll(() => {
    mock.module('./_base', () => realBase);
    delete require.cache[require.resolve('./rules')];
});

test('listAllUnlockGrantsAdmin queries all unlocks with profile, granter, and pdf joins', async () => {
    queries.length = 0;
    const { data, error } = await listAllUnlockGrantsAdmin();
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(queries.length).toBe(1);
    const q = queries[0];
    expect(q.table).toBe('rules_pdf_unlocks');
    // Cross-PDF list: no rules_pdf_id filter.
    expect(q.eqs).toEqual([]);
    expect(q.select).toContain('profile:profiles!rules_pdf_unlocks_profile_id_fkey(id, name)');
    expect(q.select).toContain('granter:profiles!rules_pdf_unlocks_granted_by_fkey(id, name)');
    expect(q.select).toContain('rules_pdf:rules_pdfs(id, title, edition)');
    expect(q.orders).toEqual([{ column: 'unlocked_at', options: { ascending: false } }]);
});

test('listAllUnlockCodesAdmin queries all codes with pdf and creator joins', async () => {
    queries.length = 0;
    const { data, error } = await listAllUnlockCodesAdmin();
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(queries.length).toBe(1);
    const q = queries[0];
    expect(q.table).toBe('rules_pdf_unlock_codes');
    expect(q.eqs).toEqual([]);
    expect(q.select).toContain('used_count');
    expect(q.select).toContain('rules_pdf:rules_pdfs(id, title, edition)');
    expect(q.select).toContain('creator:profiles!rules_pdf_unlock_codes_created_by_fkey(id, name)');
    expect(q.orders).toEqual([{ column: 'created_at', options: { ascending: false } }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test models/rules-admin-lists.test.js`
Expected: FAIL — `listAllUnlockGrantsAdmin is not a function` (not exported yet).

- [ ] **Step 3: Write minimal implementation**

In `services/rules/repository.js`, add to the `module.exports` object (after `listUnlockGrantsAdmin`):

```js
  // Dashboard: every grant across every PDF, with the PDF joined in so
  // rows can be labeled without a second lookup.
  listAllUnlockGrantsAdmin: () => withResult(
    supabaseAdmin
      .from('rules_pdf_unlocks')
      .select(`
        user_id,
        profile_id,
        granted_by,
        unlocked_at,
        expires_at,
        profile:profiles!rules_pdf_unlocks_profile_id_fkey(id, name),
        granter:profiles!rules_pdf_unlocks_granted_by_fkey(id, name),
        rules_pdf:rules_pdfs(id, title, edition)
      `)
      .order('unlocked_at', { ascending: false })
  ),

  // Dashboard: every code across every PDF. Admin client: creator profiles
  // may not be public, and the codes table is admin-only under RLS.
  listAllUnlockCodesAdmin: () => withResult(
    supabaseAdmin
      .from('rules_pdf_unlock_codes')
      .select(`
        id,
        code,
        rules_pdf_id,
        created_at,
        expires_at,
        max_uses,
        used_count,
        rules_pdf:rules_pdfs(id, title, edition),
        creator:profiles!rules_pdf_unlock_codes_created_by_fkey(id, name)
      `)
      .order('created_at', { ascending: false })
  ),
```

In `models/rules.js`, next to `listRulesPdfUnlocks` add:

```js
const listAllUnlockGrantsAdmin = () => rulesRepository.listAllUnlockGrantsAdmin();
const listAllUnlockCodesAdmin = () => rulesRepository.listAllUnlockCodesAdmin();
```

and add both names to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test models/rules-admin-lists.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/rules/repository.js models/rules.js models/rules-admin-lists.test.js
git commit -m "feat: add cross-PDF admin list queries for unlocks and codes"
```

---

### Task 2: `library-unlocks.handlebars` dashboard view

**Files:**
- Create: `views/library-unlocks.handlebars`
- Test: `views/library-unlocks.test.js` (create)

**Interfaces:**
- Consumes (render context, produced by Task 3's route):
  - `rules`: array of `{ id, title, edition, is_active }` (all PDFs incl. inactive)
  - `grants`: `GrantRow` (Task 1) plus `isExpired: boolean`
  - `codes`: `CodeRow` (Task 1) plus `isUsable: boolean`
  - plus standard `profile`, `title`, `breadcrumbs`, `activeNav`
- Produces (form contract, consumed by Task 4's endpoints):
  - Grant form: plain `POST /library/unlocks` with fields `rules_pdf_id`, `profile_name`, `profile_id`, `expires_at`
  - Codes form: `hx-post="/library/codes"` with fields `rules_pdf_id`, `expires_at`, `max_uses`, `amount`, result target `#codeResult`

- [ ] **Step 1: Write the failing test**

Create `views/library-unlocks.test.js` (real-template render pattern from `views/my-classes.test.js`):

```js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const customHelpers = require('../util/handlebars');

const handlebarsHelpers = require('handlebars-helpers')();

function renderUnlocks(context) {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('breadcrumbs', fs.readFileSync(
    path.join(__dirname, 'partials', 'breadcrumbs.handlebars'), 'utf8'
  ));
  const src = fs.readFileSync(
    path.join(__dirname, 'library-unlocks.handlebars'), 'utf8'
  );
  return hb.compile(src)(context);
}

const PDF_A = '11111111-1111-4111-8111-111111111111';
const PDF_B = '22222222-2222-4222-8222-222222222222';

const RULES = [
  { id: PDF_A, title: 'Core Rules', edition: 'Advent v2', is_active: true },
  { id: PDF_B, title: 'Core Rules', edition: 'Advent v1', is_active: false }
];

const GRANTS = [
  {
    user_id: 'user-1',
    profile: { id: 'p1', name: 'Alice' },
    granter: { id: 'p9', name: 'Dave' },
    rules_pdf: { id: PDF_A, title: 'Core Rules', edition: 'Advent v2' },
    unlocked_at: '2026-08-01T00:00:00Z',
    expires_at: null,
    isExpired: false
  },
  {
    user_id: 'user-2',
    profile: { id: 'p2', name: 'Bob' },
    granter: null,
    rules_pdf: { id: PDF_B, title: 'Core Rules', edition: 'Advent v1' },
    unlocked_at: '2026-01-01T00:00:00Z',
    expires_at: '2026-02-01T00:00:00Z',
    isExpired: true
  }
];

const CODES = [
  {
    id: 'code-row-1',
    code: 'abc123def456ghi7',
    rules_pdf_id: PDF_A,
    created_at: '2026-08-10T00:00:00Z',
    expires_at: null,
    max_uses: 5,
    used_count: 2,
    rules_pdf: { id: PDF_A, title: 'Core Rules', edition: 'Advent v2' },
    creator: { id: 'p9', name: 'Dave' },
    isUsable: true
  },
  {
    id: 'code-row-2',
    code: 'zzz999yyy888xxx7',
    rules_pdf_id: PDF_A,
    created_at: '2026-07-01T00:00:00Z',
    expires_at: null,
    max_uses: 1,
    used_count: 1,
    rules_pdf: { id: PDF_A, title: 'Core Rules', edition: 'Advent v2' },
    creator: null,
    isUsable: false
  }
];

const CONTEXT = { rules: RULES, grants: GRANTS, codes: CODES, breadcrumbs: [] };

test('grant form posts rules_pdf_id to /library/unlocks', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain('action="/library/unlocks"');
  expect(html).toContain('name="rules_pdf_id"');
  expect(html).toContain('name="profile_name"');
  expect(html).toContain('name="profile_id"');
});

test('codes form hx-posts to /library/codes with a codeResult target', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain('hx-post="/library/codes"');
  expect(html).toContain('hx-target="#codeResult"');
  expect(html).toContain('id="codeResult"');
  expect(html).toContain('name="max_uses"');
  expect(html).toContain('name="amount"');
});

test('document selects label inactive PDFs', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain(`Core Rules — Advent v2`);
  expect(html).toContain(`Core Rules — Advent v1 (inactive)`);
});

test('unlock rows carry the filter data attributes', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain(`data-document-id="${PDF_A}" data-profile-name="Alice" data-expired="false"`);
  expect(html).toContain(`data-document-id="${PDF_B}" data-profile-name="Bob" data-expired="true"`);
});

test('expired grants render an Expired tag; non-expiring grants a No expiration tag', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain('>Expired<');
  expect(html).toContain('>No expiration<');
});

test('revoke button targets the grant row endpoint', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain(`hx-delete="/library/${PDF_A}/unlocks/user-1"`);
});

test('code rows carry data-usable and show used/max', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain('data-usable="true"');
  expect(html).toContain('data-usable="false"');
  expect(html).toContain('2/5');
  expect(html).toContain('1/1');
});

test('empty states render without tables', () => {
  const html = renderUnlocks({ rules: RULES, grants: [], codes: [], breadcrumbs: [] });
  expect(html).toContain('No unlocks yet.');
  expect(html).toContain('No codes yet.');
  expect(html).not.toContain('id="unlocks-table"');
  expect(html).not.toContain('id="codes-table"');
});

test('filter controls default to active unlocks and usable codes', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain('id="filter-document"');
  expect(html).toContain('id="filter-profile"');
  expect(html).toContain('<option value="active" selected>');
  expect(html).toContain('<option value="usable" selected>');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test views/library-unlocks.test.js`
Expected: FAIL — `ENOENT ... library-unlocks.handlebars`.

- [ ] **Step 3: Write the template**

Create `views/library-unlocks.handlebars`:

```handlebars
{{> breadcrumbs}}
<div class="level">
  <div class="level-left">
    <h1 class="title is-2">Unlock Dashboard</h1>
  </div>
  <div class="level-right">
    <a class="button" href="/library/manage">
      <span class="icon"><i class="fas fa-file-pdf"></i></span>
      <span>Manage Rules PDFs</span>
    </a>
  </div>
</div>

<div class="columns">
  <div class="column is-half">
    <div class="box">
      <h2 class="title is-4">Grant Access</h2>
      <form method="post" action="/library/unlocks">
        <div class="field">
          <label class="label" for="grant-document">Document</label>
          <div class="control">
            <div class="select is-fullwidth">
              <select name="rules_pdf_id" id="grant-document" required>
                {{#each rules}}
                <option value="{{this.id}}">{{this.title}} — {{this.edition}}{{#unless this.is_active}} (inactive){{/unless}}</option>
                {{/each}}
              </select>
            </div>
          </div>
        </div>
        <div class="field">
          <label class="label" for="grant-profile-name">Profile Name</label>
          <div class="control">
            <input class="input" type="text" name="profile_name" id="grant-profile-name" placeholder="Exact profile name">
          </div>
          <p class="help">Provide a profile name <em>or</em> ID below.</p>
        </div>
        <div class="field">
          <label class="label" for="grant-profile-id">Profile ID</label>
          <div class="control">
            <input class="input" type="text" name="profile_id" id="grant-profile-id" placeholder="UUID">
          </div>
        </div>
        <div class="field">
          <label class="label" for="grant-expires">Expires At (optional)</label>
          <div class="control">
            <input class="input" type="datetime-local" name="expires_at" id="grant-expires">
          </div>
          <p class="help">Leave blank for no expiration.</p>
        </div>
        <div class="field">
          <button class="button is-primary" type="submit">
            <span class="icon"><i class="fas fa-key"></i></span>
            <span>Grant Access</span>
          </button>
        </div>
      </form>
    </div>
  </div>
  <div class="column is-half">
    <div class="box">
      <h2 class="title is-4">Generate Unlock Codes</h2>
      <form hx-post="/library/codes" hx-target="#codeResult" hx-swap="innerHTML transition:true" hx-disabled-elt="input, button, select, textarea" hx-sync="this:abort" hx-on::after-request="if(event.detail.successful) this.reset()">
        <div class="field">
          <label class="label" for="codes-document">Document</label>
          <div class="control">
            <div class="select is-fullwidth">
              <select name="rules_pdf_id" id="codes-document" required>
                {{#each rules}}
                <option value="{{this.id}}">{{this.title}} — {{this.edition}}{{#unless this.is_active}} (inactive){{/unless}}</option>
                {{/each}}
              </select>
            </div>
          </div>
        </div>
        <div class="field">
          <label class="label" for="codes-expires">Expires At (optional)</label>
          <div class="control">
            <input class="input" type="datetime-local" name="expires_at" id="codes-expires">
          </div>
          <p class="help">Expiry of the code itself; redeemed unlocks are permanent.</p>
        </div>
        <div class="columns">
          <div class="column">
            <div class="field">
              <label class="label" for="codes-max-uses">Max Uses</label>
              <div class="control">
                <input class="input" type="number" min="1" name="max_uses" id="codes-max-uses" value="1">
              </div>
            </div>
          </div>
          <div class="column">
            <div class="field">
              <label class="label" for="codes-amount">Amount</label>
              <div class="control">
                <input class="input" type="number" min="1" name="amount" id="codes-amount" value="1">
              </div>
            </div>
          </div>
        </div>
        <div class="field">
          <div class="control">
            <button class="button is-primary" type="submit">
              <span class="icon"><i class="fas fa-key"></i></span>
              <span>Generate Code(s)</span>
            </button>
          </div>
        </div>
      </form>
      <div id="codeResult" class="mt-4"></div>
    </div>
  </div>
</div>

<div class="box">
  <h2 class="title is-4">Unlocks</h2>
  <div class="field is-grouped is-grouped-multiline">
    <div class="control">
      <div class="select">
        <select id="filter-document" aria-label="Filter by document">
          <option value="">All documents</option>
          {{#each rules}}
          <option value="{{this.id}}">{{this.title}} — {{this.edition}}{{#unless this.is_active}} (inactive){{/unless}}</option>
          {{/each}}
        </select>
      </div>
    </div>
    <div class="control is-expanded">
      <input class="input" type="text" id="filter-profile" placeholder="Filter by profile name" aria-label="Filter by profile name">
    </div>
    <div class="control">
      <div class="select">
        <select id="filter-unlock-status" aria-label="Filter unlocks by status">
          <option value="active" selected>Active</option>
          <option value="expired">Expired</option>
          <option value="all">All</option>
        </select>
      </div>
    </div>
  </div>

  {{#if grants.length}}
  <div class="table-container">
    <table class="table is-fullwidth is-striped" id="unlocks-table">
      <thead>
        <tr>
          <th>Profile</th>
          <th>Document</th>
          <th>Granted</th>
          <th>Granted by</th>
          <th>Expires</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {{#each grants}}
        <tr data-document-id="{{this.rules_pdf.id}}" data-profile-name="{{this.profile.name}}" data-expired="{{this.isExpired}}">
          <td>{{#if this.profile}}{{this.profile.name}}{{else}}<em>Unknown</em>{{/if}}</td>
          <td>{{this.rules_pdf.title}} — {{this.rules_pdf.edition}}</td>
          <td>{{date_tz this.unlocked_at}}</td>
          <td>{{#if this.granter}}{{this.granter.name}}{{else}}—{{/if}}</td>
          <td>
            {{#if this.expires_at}}
              {{date_tz this.expires_at}}
              {{#if this.isExpired}}<span class="tag is-danger is-light">Expired</span>{{/if}}
            {{else}}
              <span class="tag is-success is-light">No expiration</span>
            {{/if}}
          </td>
          <td class="has-text-right">
            <button class="button is-small is-danger"
                    hx-delete="/library/{{this.rules_pdf.id}}/unlocks/{{this.user_id}}"
                    hx-confirm="Revoke access for {{#if this.profile}}{{this.profile.name}}{{else}}this profile{{/if}}?"
                    hx-target="closest tr"
                    hx-swap="outerHTML">
              <span class="icon"><i class="fas fa-trash"></i></span>
            </button>
          </td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  </div>
  <p class="notification is-light" id="unlocks-no-match" hidden>No unlocks match the current filters.</p>
  {{else}}
  <p class="notification is-light">No unlocks yet.</p>
  {{/if}}
</div>

<div class="box">
  <h2 class="title is-4">Unlock Codes</h2>
  <div class="field is-grouped">
    <div class="control">
      <div class="select">
        <select id="filter-code-status" aria-label="Filter codes by status">
          <option value="usable" selected>Usable</option>
          <option value="not-usable">Exhausted / Expired</option>
          <option value="all">All</option>
        </select>
      </div>
    </div>
  </div>

  {{#if codes.length}}
  <div class="table-container">
    <table class="table is-fullwidth is-striped" id="codes-table">
      <thead>
        <tr>
          <th>Code</th>
          <th>Document</th>
          <th>Uses</th>
          <th>Expires</th>
          <th>Created</th>
          <th>Created by</th>
        </tr>
      </thead>
      <tbody>
        {{#each codes}}
        <tr data-document-id="{{this.rules_pdf.id}}" data-usable="{{this.isUsable}}">
          <td><code>{{this.code}}</code></td>
          <td>{{this.rules_pdf.title}} — {{this.rules_pdf.edition}}</td>
          <td>{{this.used_count}}/{{this.max_uses}}</td>
          <td>{{#if this.expires_at}}{{date_tz this.expires_at}}{{else}}Never{{/if}}</td>
          <td>{{date_tz this.created_at}}</td>
          <td>{{#if this.creator}}{{this.creator.name}}{{else}}—{{/if}}</td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  </div>
  <p class="notification is-light" id="codes-no-match" hidden>No codes match the current filters.</p>
  {{else}}
  <p class="notification is-light">No codes yet.</p>
  {{/if}}
</div>

<script>
(() => {
  const docFilter = document.getElementById('filter-document');
  const nameFilter = document.getElementById('filter-profile');
  const unlockStatus = document.getElementById('filter-unlock-status');
  const codeStatus = document.getElementById('filter-code-status');

  const filterTable = (tableId, noMatchId, rowMatches) => {
    const table = document.getElementById(tableId);
    if (!table) return;
    let visible = 0;
    table.querySelectorAll('tbody tr').forEach((row) => {
      const show = rowMatches(row);
      row.hidden = !show;
      if (show) visible += 1;
    });
    const noMatch = document.getElementById(noMatchId);
    if (noMatch) noMatch.hidden = visible > 0;
  };

  const applyFilters = () => {
    const doc = docFilter.value;
    const name = nameFilter.value.trim().toLowerCase();

    filterTable('unlocks-table', 'unlocks-no-match', (row) => {
      if (doc && row.dataset.documentId !== doc) return false;
      if (name && !(row.dataset.profileName || '').toLowerCase().includes(name)) return false;
      const expired = row.dataset.expired === 'true';
      if (unlockStatus.value === 'active' && expired) return false;
      if (unlockStatus.value === 'expired' && !expired) return false;
      return true;
    });

    filterTable('codes-table', 'codes-no-match', (row) => {
      if (doc && row.dataset.documentId !== doc) return false;
      const usable = row.dataset.usable === 'true';
      if (codeStatus.value === 'usable' && !usable) return false;
      if (codeStatus.value === 'not-usable' && usable) return false;
      return true;
    });
  };

  [docFilter, unlockStatus, codeStatus].forEach((el) => el.addEventListener('change', applyFilters));
  nameFilter.addEventListener('input', applyFilters);
  applyFilters();
})();
</script>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test views/library-unlocks.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add views/library-unlocks.handlebars views/library-unlocks.test.js
git commit -m "feat: add unlock dashboard view with filterable tables"
```

---

### Task 3: `GET /library/unlocks` dashboard route

**Files:**
- Modify: `routes/library.js` (new route after the `GET /manage` handler, which ends around line 133; also extend the `require('../models/rules')` destructure at lines 9–21)
- Test: `routes/library-unlocks.test.js` (create)

**Interfaces:**
- Consumes: `listAllUnlockGrantsAdmin`, `listAllUnlockCodesAdmin` (Task 1), `getRulesPdfs` (existing), view name `library-unlocks` (Task 2).
- Produces: render context `{ rules, grants (each + isExpired), codes (each + isUsable), profile, title: 'Unlock Dashboard', activeNav: 'library', breadcrumbs }` — the contract Task 2's view consumes. Later tasks (4) extend this test file.

- [ ] **Step 1: Write the failing test**

Create `routes/library-unlocks.test.js` (server + render-capture pattern from `routes/pages.test.js` and `routes/nav-manage-navbar.test.js`):

```js
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realRules = require('../models/rules');
const realPdf = require('../models/pdf');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');

const PDF_A = '11111111-1111-4111-8111-111111111111';

// Mutable per-test state.
let currentRole = 'admin';
let upsertCall = null;
let mintCall = null;

const RULES_ROWS = [
  { id: PDF_A, title: 'Core Rules', edition: 'Advent v2', is_active: true }
];
const GRANT_ROWS = [
  {
    user_id: 'user-1',
    profile: { id: 'p1', name: 'Alice' },
    granter: null,
    rules_pdf: { id: PDF_A, title: 'Core Rules', edition: 'Advent v2' },
    unlocked_at: '2026-08-01T00:00:00Z',
    expires_at: '2020-01-01T00:00:00Z' // already expired
  }
];
const CODE_ROWS = [
  {
    id: 'code-row-1',
    code: 'abc123',
    rules_pdf_id: PDF_A,
    created_at: '2026-08-10T00:00:00Z',
    expires_at: null,
    max_uses: 2,
    used_count: 2, // exhausted
    rules_pdf: { id: PDF_A, title: 'Core Rules', edition: 'Advent v2' },
    creator: { id: 'p9', name: 'Dave' }
  }
];

mock.module('../models/auth', () => ({
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
}));
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: 'admin-profile', user_id: 'u1', role: currentRole }),
  getProfileByNameAdmin: async (name) =>
    (name === 'Alice' ? { data: { id: 'p1', user_id: 'user-1' } } : { data: null }),
  getProfileByIdAdmin: async (id) =>
    (id === 'p1' ? { data: { id: 'p1', user_id: 'user-1' } } : { data: null }),
}));
mock.module('../models/rules', () => ({
  getRulesPdfs: async () => ({ data: RULES_ROWS, error: null }),
  getRulesPdf: async (id) =>
    (id === PDF_A
      ? { data: { id: PDF_A, title: 'Core Rules', edition: 'Advent v2' }, error: null }
      : { data: null, error: { message: 'not found' } }),
  createRulesPdf: async () => ({ data: null, error: null }),
  updateRulesPdf: async () => ({ data: null, error: null }),
  listRulesPdfUnlocks: async () => ({ data: [], error: null }),
  listRulesPdfUnlocksForUser: async () => ({ data: [], error: null }),
  upsertRulesPdfUnlock: async (payload) => { upsertCall = payload; return { data: payload, error: null }; },
  deleteRulesPdfUnlock: async () => ({ error: null }),
  createRulesPdfUnlockCodes: async (actor, opts) => {
    mintCall = { actor, opts };
    return { data: [{ code: 'new-code', max_uses: opts.maxUses, expires_at: opts.expiresAt }], error: null };
  },
  listRulesPdfUnlockCodes: async () => ({ data: [], error: null }),
  canViewRulesPdf: async () => ({ data: true, error: null }),
  listAllUnlockGrantsAdmin: async () => ({ data: GRANT_ROWS, error: null }),
  listAllUnlockCodesAdmin: async () => ({ data: CODE_ROWS, error: null }),
}));
mock.module('../models/pdf', () => ({
  storeRulesPdf: async () => ({ data: null, error: null }),
  deletePdfObject: async () => ({ error: null }),
  getSignedPdfUrl: async () => ({ data: null, error: null }),
  RULES_PDF_BUCKET: 'rules-pdfs',
}));
mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next(),
}));

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('./library')];
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  // Render capture: routes are exercised for their context, not their HTML.
  app.use((req, res, next) => {
    res.render = (view, ctx) => res.json({ view, ctx: ctx || {} });
    next();
  });
  app.use('/library', require('./library'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/rules', () => realRules);
  mock.module('../models/pdf', () => realPdf);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  delete require.cache[require.resolve('./library')];
});

const authHeaders = { Authorization: 'Bearer valid-jwt' };

test('GET /library/unlocks renders the dashboard with stamped display state', async () => {
  currentRole = 'admin';
  const res = await fetch(`${baseUrl}/library/unlocks`, { headers: authHeaders });
  expect(res.status).toBe(200);
  const { view, ctx } = await res.json();
  expect(view).toBe('library-unlocks');
  expect(ctx.rules).toEqual(RULES_ROWS);
  expect(ctx.grants.length).toBe(1);
  expect(ctx.grants[0].isExpired).toBe(true);
  expect(ctx.codes.length).toBe(1);
  expect(ctx.codes[0].isUsable).toBe(false); // exhausted: used_count == max_uses
  expect(ctx.title).toBe('Unlock Dashboard');
});

test('GET /library/unlocks rejects non-admins with 403', async () => {
  currentRole = 'user';
  const res = await fetch(`${baseUrl}/library/unlocks`, { headers: authHeaders });
  expect(res.status).toBe(403);
  currentRole = 'admin';
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test routes/library-unlocks.test.js`
Expected: FAIL — first test gets a 404 (route not defined; `/unlocks` matches nothing).

- [ ] **Step 3: Write the route**

In `routes/library.js`:

1. Extend the models destructure (lines 9–21) with `listAllUnlockGrantsAdmin` and `listAllUnlockCodesAdmin`.
2. Insert after the `GET /manage` handler (the block ending `});` around line 133) — before the `POST /` create handler, so literal paths beat `/:id`:

```js
// Admin: unlock dashboard — every grant and code across every PDF.
router.get('/unlocks', isAuthenticated, requireAdmin, async (req, res) => {
    const { profile } = res.locals;

    const [rulesResult, grantsResult, codesResult] = await Promise.all([
        getRulesPdfs({ includeInactive: true }),
        listAllUnlockGrantsAdmin(),
        listAllUnlockCodesAdmin()
    ]);

    const error = rulesResult.error || grantsResult.error || codesResult.error;
    if (error) {
        return sendError(req, res, error, { message: 'Failed to load unlock dashboard' });
    }

    // Display state is computed here, not in the template: the client-side
    // filter script reads it off data attributes.
    const now = new Date();
    const grants = (grantsResult.data || []).map((grant) => ({
        ...grant,
        isExpired: grant.expires_at ? new Date(grant.expires_at) <= now : false
    }));
    const codes = (codesResult.data || []).map((code) => ({
        ...code,
        isUsable: (!code.expires_at || new Date(code.expires_at) > now)
            && code.used_count < code.max_uses
    }));

    return res.render('library-unlocks', {
        profile,
        title: 'Unlock Dashboard',
        rules: rulesResult.data || [],
        grants,
        codes,
        activeNav: 'library',
        breadcrumbs: [
            { label: 'Library', href: '/library' },
            { label: 'Manage', href: '/library/manage' },
            { label: 'Unlocks', href: '/library/unlocks' }
        ]
    });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test routes/library-unlocks.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add routes/library.js routes/library-unlocks.test.js
git commit -m "feat: add admin unlock dashboard route"
```

---

### Task 4: Body-param grant/codes endpoints replace the path-param ones

**Files:**
- Modify: `routes/library.js` (add `POST /unlocks` and `POST /codes`; delete `POST /:id/unlocks` at ~lines 210–256, `POST /:id/codes` at ~lines 269–302, and `GET /:id/codes` at ~lines 304–310; drop the now-unused `listRulesPdfUnlockCodes` from the models destructure; add `isValidUuid` to the `util/validate` require on line 6)
- Test: `routes/library-unlocks.test.js` (extend — file created in Task 3)

**Interfaces:**
- Consumes: form field contract from Task 2 (`rules_pdf_id`, `profile_name`, `profile_id`, `expires_at`, `max_uses`, `amount`); existing `getProfileByNameAdmin`/`getProfileByIdAdmin`, `upsertRulesPdfUnlock`, `createRulesPdfUnlockCodes`, `parseExpiresAt`, `actorFromLocals`, `asyncHandler`; `isValidUuid` from `util/validate`.
- Produces: `POST /library/unlocks` (302 → `/library/unlocks` on success; 400 invalid `rules_pdf_id` or unknown profile; 404 unknown PDF) and `POST /library/codes` (renders `partials/unlock-code-result` with `layout: false`). `DELETE /library/:id/unlocks/:userId` remains as-is.

- [ ] **Step 1: Write the failing tests**

Append to `routes/library-unlocks.test.js`:

```js
test('POST /library/unlocks grants by profile name and redirects to the dashboard', async () => {
  upsertCall = null;
  const res = await fetch(`${baseUrl}/library/unlocks`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    redirect: 'manual',
    body: JSON.stringify({ rules_pdf_id: PDF_A, profile_name: 'Alice', expires_at: '' })
  });
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('/library/unlocks');
  expect(upsertCall).toEqual({
    userId: 'user-1',
    profileId: 'p1',
    rulesPdfId: PDF_A,
    expiresAt: null,
    grantedBy: 'admin-profile'
  });
});

test('POST /library/unlocks with a non-UUID rules_pdf_id is a 400', async () => {
  upsertCall = null;
  const res = await fetch(`${baseUrl}/library/unlocks`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
    redirect: 'manual',
    body: JSON.stringify({ rules_pdf_id: 'not-a-uuid', profile_name: 'Alice' })
  });
  expect(res.status).toBe(400);
  expect(upsertCall).toBeNull();
});

test('POST /library/unlocks with an unknown profile is a 400', async () => {
  upsertCall = null;
  const res = await fetch(`${baseUrl}/library/unlocks`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
    redirect: 'manual',
    body: JSON.stringify({ rules_pdf_id: PDF_A, profile_name: 'Nobody' })
  });
  expect(res.status).toBe(400);
  expect(upsertCall).toBeNull();
});

test('POST /library/codes mints codes for the selected document and renders the result partial', async () => {
  mintCall = null;
  const res = await fetch(`${baseUrl}/library/codes`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules_pdf_id: PDF_A, expires_at: '', max_uses: '5', amount: '3' })
  });
  expect(res.status).toBe(200);
  const { view } = await res.json();
  expect(view).toBe('partials/unlock-code-result');
  expect(mintCall.opts).toEqual({
    rulesPdfId: PDF_A,
    createdByProfileId: 'admin-profile',
    expiresAt: null,
    maxUses: 5,
    amount: 3
  });
});

test('the replaced path-param endpoints are gone', async () => {
  const unlocksRes = await fetch(`${baseUrl}/library/${PDF_A}/unlocks`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    redirect: 'manual',
    body: JSON.stringify({ profile_name: 'Alice' })
  });
  expect(unlocksRes.status).toBe(404);

  const codesPostRes = await fetch(`${baseUrl}/library/${PDF_A}/codes`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_uses: '1', amount: '1' })
  });
  expect(codesPostRes.status).toBe(404);

  const codesGetRes = await fetch(`${baseUrl}/library/${PDF_A}/codes`, { headers: authHeaders });
  expect(codesGetRes.status).toBe(404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test routes/library-unlocks.test.js`
Expected: the new tests FAIL — `POST /library/unlocks` currently falls through to `POST /:id` with `id='unlocks'` (rejected as a non-UUID param, not a grant), and the "gone" test fails because the old endpoints still respond.

- [ ] **Step 3: Move the endpoints**

In `routes/library.js`:

1. Change line 6 to `const { registerUuidParams, isValidUuid } = require('../util/validate');`.
2. Directly after the Task 3 `GET /unlocks` handler, add both new handlers. They are the old `/:id` handler bodies with `rules_pdf_id` sourced from `req.body` plus an explicit UUID check:

```js
// Admin: grant a user access to a rules PDF (document chosen in the form).
router.post('/unlocks', isAuthenticated, requireAdmin, async (req, res) => {
    const { rules_pdf_id, profile_name, profile_id, expires_at } = req.body;
    const { profile } = res.locals;

    if (!isValidUuid(rules_pdf_id)) {
        return sendError(req, res, null, { status: 400, message: 'Invalid rules PDF id' });
    }

    const { data: rulesPdf, error: loadError } = await getRulesPdf(rules_pdf_id);
    if (loadError || !rulesPdf) {
        return sendError(req, res, loadError, { status: 404, message: 'Rules PDF not found' });
    }

    let profileRecord = null;
    if (profile_id && profile_id.trim()) {
        const result = await getProfileByIdAdmin(profile_id.trim());
        if (result?.data) {
            profileRecord = result.data;
        }
    } else if (profile_name && profile_name.trim()) {
        const result = await getProfileByNameAdmin(profile_name.trim());
        if (result?.data) {
            profileRecord = result.data;
        }
    }

    if (!profileRecord) {
        return sendError(req, res, null, { status: 400, message: 'Profile not found' });
    }

    if (!profileRecord.user_id) {
        return sendError(req, res, null, { status: 400, message: 'Profile is missing a linked user' });
    }

    const { error } = await upsertRulesPdfUnlock({
        userId: profileRecord.user_id,
        profileId: profileRecord.id,
        rulesPdfId: rules_pdf_id,
        expiresAt: parseExpiresAt(expires_at),
        grantedBy: profile?.id || null
    });

    if (error) {
        return sendError(req, res, error, { message: 'Failed to grant access' });
    }

    return res.redirect('/library/unlocks');
});

// Admin: generate unlock codes (document chosen in the form).
router.post('/codes', isAuthenticated, requireAdmin, asyncHandler(async (req, res) => {
    const { rules_pdf_id, expires_at, max_uses, amount } = req.body;

    if (!isValidUuid(rules_pdf_id)) {
        return sendError(req, res, null, { status: 400, message: 'Invalid rules PDF id' });
    }

    const createdByProfileId = res.locals.profile.id;
    const count = parseInt(amount, 10) || 1;
    const actor = actorFromLocals(res.locals);
    const { data, error } = await createRulesPdfUnlockCodes(actor, {
        rulesPdfId: rules_pdf_id,
        createdByProfileId,
        expiresAt: parseExpiresAt(expires_at),
        maxUses: parseInt(max_uses, 10) || 1,
        amount: count
    });
    if (error) return sendError(req, res, error);

    if (count > 1) {
        return res.render('partials/unlock-code-result', {
            layout: false,
            codes: data
        });
    }

    if (!data || data.length === 0) {
        return sendError(req, res, null, { status: 400, message: 'Unlock code creation returned no rows' });
    }
    const codeRow = data[0];
    return res.render('partials/unlock-code-result', {
        layout: false,
        code: codeRow.code,
        max_uses: codeRow.max_uses,
        expires_at: codeRow.expires_at
    });
}));
```

3. Delete the three old handlers: `router.post('/:id/unlocks', ...)`, `router.post('/:id/codes', ...)`, and `router.get('/:id/codes', ...)`. Keep `router.delete('/:id/unlocks/:userId', ...)` untouched.
4. Remove `listRulesPdfUnlockCodes` from the models destructure (its only consumer was the deleted GET route).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test routes/library-unlocks.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add routes/library.js routes/library-unlocks.test.js
git commit -m "feat: move grant and code endpoints to body-param dashboard routes"
```

---

### Task 5: Slim `/library/manage` to content-only

**Files:**
- Modify: `views/library-manage.handlebars` (delete the grant/unlocks/codes sections — currently lines 131–246; add a dashboard button to the header level)
- Modify: `routes/library.js` (`GET /manage` handler at lines 105–133: drop the per-rule unlocks fan-out; remove `listRulesPdfUnlocks` from the models destructure)
- Modify: `models/rules.js` (delete `listRulesPdfUnlocks`, line 67–69, and its export)
- Modify: `services/rules/repository.js` (delete `listUnlockGrantsAdmin` — its only consumer was `listRulesPdfUnlocks`)
- Modify: `routes/library-unlocks.test.js` (remove the now-dead `listRulesPdfUnlocks` and `listRulesPdfUnlockCodes` keys from the `models/rules` mock)
- Modify: `models/rules-codes.test.js` (delete the `listRulesPdfUnlockCodes filters by rules_pdf_id` test and the function's import — the function was orphaned by Task 4 and is deleted here with the rest of the dead code)
- Modify: `models/rules.js` (delete `listRulesPdfUnlockCodes`, lines 134–146, and its export)
- Test: `views/library-manage.test.js` (create)

**Interfaces:**
- Consumes: nothing new. `GET /manage` context shrinks to `{ profile, title, rules, activeNav, breadcrumbs }` — `rules` no longer carries `.unlocks`.
- Produces: nothing consumed downstream; this is a removal task.

- [ ] **Step 1: Write the failing view test**

Create `views/library-manage.test.js` (template-source assertions, the light pattern at the top of `views/my-classes.test.js`):

```js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

const source = () => fs.readFileSync(
  path.join(__dirname, 'library-manage.handlebars'), 'utf8'
);

test('library-manage no longer renders any unlock or code UI', () => {
  expect(source()).not.toContain('Grant Access');
  expect(source()).not.toContain('Current Unlocks');
  expect(source()).not.toContain('Generate Unlock Codes');
  expect(source()).not.toContain('hx-delete');
  expect(source()).not.toContain('pdfCodeResult');
});

test('library-manage links to the unlock dashboard', () => {
  expect(source()).toContain('href="/library/unlocks"');
});

test('library-manage keeps the content-management forms', () => {
  expect(source()).toContain('Add New Rules PDF');
  expect(source()).toContain('Replace PDF');
  expect(source()).toContain('name="is_active"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test views/library-manage.test.js`
Expected: FAIL — the unlock sections are still present and there is no dashboard link.

- [ ] **Step 3: Slim the view and route, delete the orphaned code**

1. In `views/library-manage.handlebars`, delete everything from the `<div class="columns">` that opens the Grant Access / Current Unlocks split (line 131) through the `<div id="pdfCodeResult-{{this.id}}" ...></div>` line (246). The per-PDF box now ends after the edit form's Save button.
2. Replace the header's `level-right` (lines 6–11) with:

```handlebars
  <div class="level-right">
    <div class="buttons">
      <a class="button is-link is-light" href="/library/unlocks">
        <span class="icon"><i class="fas fa-key"></i></span>
        <span>Unlock Dashboard</span>
      </a>
      <a class="button" href="/library">
        <span class="icon"><i class="fas fa-arrow-left"></i></span>
        <span>Back to Library</span>
      </a>
    </div>
  </div>
```

3. In `routes/library.js`, replace the `GET /manage` handler body — the `rulesWithUnlocks` fan-out disappears:

```js
router.get('/manage', isAuthenticated, requireAdmin, async (req, res) => {
    const { profile } = res.locals;

    const { data: rules, error } = await getRulesPdfs({ includeInactive: true });
    if (error) {
        return sendError(req, res, error, { message: 'Failed to load rules PDFs' });
    }

    return res.render('library-manage', {
        profile,
        title: 'Manage Rules PDFs',
        rules: rules || [],
        activeNav: 'library',
        breadcrumbs: [
            { label: 'Library', href: '/library' },
            { label: 'Manage', href: '/library/manage' }
        ]
    });
});
```

4. Remove `listRulesPdfUnlocks` from the destructure in `routes/library.js`.
5. In `models/rules.js`, delete `listRulesPdfUnlocks` (and its comment) and `listRulesPdfUnlockCodes`, and both exports.
6. In `services/rules/repository.js`, delete `listUnlockGrantsAdmin` (keep its explanatory comment style on the remaining list-all functions).
7. In `models/rules-codes.test.js`, remove `listRulesPdfUnlockCodes` from the require destructure and delete the `listRulesPdfUnlockCodes filters by rules_pdf_id` test.
8. In `routes/library-unlocks.test.js`, remove the `listRulesPdfUnlocks` and `listRulesPdfUnlockCodes` keys from the `models/rules` mock.

- [ ] **Step 4: Run the affected tests**

Run: `bun test views/library-manage.test.js routes/library-unlocks.test.js models/rules-codes.test.js models/rules-admin-lists.test.js`
Expected: PASS across all four files.

- [ ] **Step 5: Verify nothing else referenced the deleted functions**

Run: `grep -rn "listRulesPdfUnlocks\b\|listRulesPdfUnlockCodes\|listUnlockGrantsAdmin" --include="*.js" .  | grep -v node_modules | grep -v listAllUnlock`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add views/library-manage.handlebars views/library-manage.test.js routes/library.js models/rules.js services/rules/repository.js models/rules-codes.test.js routes/library-unlocks.test.js
git commit -m "feat: slim library manage page to content-only, drop orphaned unlock queries"
```

---

### Task 6: Admin nav entry + full-suite verification

No TDD — seed files are config (per user's global CLAUDE.md, config changes skip TDD).

**Files:**
- Modify: `util/seed-nav.js` (add an Unlock Dashboard child after the Manage Navigation block, ~line 301)
- Modify: `supabase/seed.sql` (add an insert after the Manage Navigation insert, ~line 171)

**Interfaces:**
- Consumes: the Admin dropdown created earlier in each seed file (`adminId` variable in seed-nav.js; label-lookup subselect in seed.sql).
- Produces: nav row `Unlock Dashboard → /library/unlocks`, position 2 under Admin.

- [ ] **Step 1: Add the nav item to `util/seed-nav.js`**

After the `navManage` block (ends ~line 301), add:

```js
        const unlockDashboard = await createNavItemDirect({
            label: 'Unlock Dashboard',
            type: 'link',
            url: '/library/unlocks',
            icon: 'fas fa-key',
            parent_id: adminId,
            position: 2,
            requires_auth: true,
            requires_admin: true,
            is_active: true
        });
        if (unlockDashboard.error) console.error('Error creating Unlock Dashboard:', unlockDashboard.error);
        else console.log('Created Unlock Dashboard');
```

- [ ] **Step 2: Add the row to `supabase/seed.sql`**

After the Manage Navigation insert (ends ~line 171), add:

```sql
-- Unlock Dashboard (child of Admin, requires admin)
INSERT INTO nav_items (label, type, url, icon, parent_id, position, requires_auth, requires_admin, is_active)
VALUES (
    'Unlock Dashboard',
    'link',
    '/library/unlocks',
    'fas fa-key',
    (SELECT id FROM nav_items WHERE label = 'Admin' AND type = 'dropdown' LIMIT 1),
    2,
    true,
    true,
    true
);
```

- [ ] **Step 3: Run the full test suite**

Run: `bun test`
Expected: PASS — no regressions anywhere.

- [ ] **Step 4: Commit**

```bash
git add util/seed-nav.js supabase/seed.sql
git commit -m "feat: add unlock dashboard to admin nav seeds"
```

**Deployment note (flag to the user at the end):** seed files only shape fresh environments. The production nav_items row must be added once by hand — either via the `/nav/manage` admin UI (label `Unlock Dashboard`, URL `/library/unlocks`, icon `fas fa-key`, parent `Admin`, requires auth + admin) or by running the seed-nav script against production.
